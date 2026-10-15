"""One-time MiniMax H3 INT8 ConvRot image-adapter fusion and checkpoint export.

Run from the diffusion-pipe repository in its Python environment. The existing
source and adapter stay unchanged. The result is published only after an
independent ComfyUI CPU-load round trip has passed.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import resource
import sys
import time


def model_paths(config):
    import toml

    model = toml.load(config)["model"]
    if model.get("type") != "minimax_h3":
        raise ValueError("This exporter only supports MiniMax H3")
    paths = model.get("merge_adapters") or []
    if not isinstance(paths, list) or not paths:
        raise ValueError("Captured H3 config has no merge_adapters")
    source = Path(model["diffusion_model"]).expanduser().resolve()
    adapters = [Path(p).expanduser().resolve() for p in paths]
    for path in [source, *adapters]:
        if not path.is_file():
            raise FileNotFoundError(path)
    if source.suffix != ".safetensors":
        raise ValueError("Expected a safetensors H3 checkpoint")
    return model, source, adapters


def quantized_layers(state):
    import torch

    layers = {}
    for name, tensor in state.items():
        if not name.endswith(".comfy_quant"):
            continue
        if tensor.dtype != torch.uint8:
            raise RuntimeError("Unexpected quantization marker type: " + name)
        marker = json.loads(tensor.detach().cpu().numpy().tobytes())
        layers[name] = marker
    return layers


def digest_tensor(tensor):
    # Convert only selected verification tensors, never the full model.
    import torch
    v = tensor.detach().to("cpu").contiguous().view(-1).view(torch.uint8)
    return hashlib.sha256(memoryview(v.numpy())).hexdigest()


def selected_digests(state, patch_names):
    names = []
    for name in sorted(patch_names):
        key = name.removeprefix("diffusion_model.")
        if key in state:
            names.append(key)
            if key.endswith(".weight"):
                stem = key[:-len("weight")]
                names.extend(k for k in (stem + "weight_scale", stem + "comfy_quant") if k in state)
    if not names:
        raise RuntimeError("No patched H3 weights are present in the fused model state")
    # Spread the checks across the model rather than looking only at early blocks.
    indices = {0, len(names) // 4, len(names) // 2, (3 * len(names)) // 4, len(names) - 1}
    return {names[i]: digest_tensor(state[names[i]]) for i in sorted(indices)}


def prepare_runtime(repo):
    sys.path.insert(0, str(repo))
    import utils.common

    sys.path.insert(0, str(repo / "submodules" / "ComfyUI"))
    from comfy.cli_args import args
    args.disable_pinned_memory = True

    import models.minimax_h3  # diffusion-pipe's H3 compatibility patches
    import comfy.model_management as mm
    import comfy.model_patcher as mp
    import comfy.sd
    import comfy.utils
    import torch
    from utils.common import DTYPE_MAP

    if mm.MAX_PINNED_MEMORY > 0:
        raise RuntimeError("ComfyUI pinned memory was not disabled")
    return torch, mp, comfy.sd, comfy.utils, DTYPE_MAP


def verify(export_file, manifest_file, publish_to=None):
    from safetensors import safe_open

    manifest = json.loads(Path(manifest_file).read_text(encoding="utf-8"))
    expected = manifest["state"]
    with safe_open(export_file, framework="pt", device="cpu") as reader:
        keys = set(reader.keys())
        if keys != set(expected):
            raise RuntimeError("Export tensor keys differ: missing={} extra={}".format(
                len(set(expected) - keys), len(keys - set(expected))))
        for name, details in expected.items():
            if list(reader.get_slice(name).get_shape()) != details["shape"]:
                raise RuntimeError("Export tensor shape mismatch: " + name)
        for name, digest in manifest["digests"].items():
            if digest_tensor(reader.get_tensor(name)) != digest:
                raise RuntimeError("Export tensor digest mismatch: " + name)
        quant_state = {name: reader.get_tensor(name) for name in keys if name.endswith(".comfy_quant")}
        quant = quantized_layers(quant_state)
        if quant != manifest["quant"]:
            raise RuntimeError("Export changed its quantization metadata")
    print("[verify] Safetensors header, fused tensor digests, and ConvRot metadata verified", flush=True)

    torch, mp, sd, utils, DTYPE_MAP = prepare_runtime(Path.cwd())
    model = sd.load_diffusion_model(
        str(export_file),
        model_options={
            "dtype": DTYPE_MAP[manifest["dtype"]],
            "load_device": torch.device("cpu"),
            "offload_device": torch.device("cpu"),
        },
        disable_dynamic=True,
    )
    loaded = model.model.diffusion_model.state_dict()
    if set(loaded) != set(expected):
        raise RuntimeError("Reloaded model lost or added tensors")
    for key, tensor in loaded.items():
        if list(tensor.shape) != expected[key]["shape"] or str(tensor.dtype) != expected[key]["dtype"]:
            raise RuntimeError("Reloaded H3 tensor structure mismatch: " + key)
    for name, digest in manifest["digests"].items():
        if digest_tensor(loaded[name]) != digest:
            raise RuntimeError("Reloaded H3 tensor digest mismatch: " + name)
    if quantized_layers(loaded) != manifest["quant"]:
        raise RuntimeError("Reloaded H3 lost ConvRot quantization")
    print("[verify] ComfyUI CPU reload passed ({} tensors, {} quantized layers)".format(
        len(loaded), len(manifest["quant"])), flush=True)
    if publish_to is not None:
        target = Path(publish_to)
        if target.exists():
            raise FileExistsError("Output already exists: " + str(target))
        os.replace(export_file, target)
        Path(manifest_file).unlink(missing_ok=True)
        print("[export] PASS: " + str(target), flush=True)


def export(config_path, output_arg):
    from safetensors.torch import save_file

    model_config, source, adapters = model_paths(config_path)
    target = (Path(output_arg).expanduser().resolve() if output_arg else
              source.with_name(source.stem + "_image_adapter_fused.safetensors"))
    if target == source or target in adapters:
        raise ValueError("Output cannot overwrite the source model or adapter")
    if target.suffix != ".safetensors":
        raise ValueError("Output must end in .safetensors")
    if target.exists():
        raise FileExistsError("Output already exists: " + str(target))
    if not target.parent.is_dir():
        raise FileNotFoundError("Output directory does not exist: " + str(target.parent))
    partial = target.with_name(target.name + ".partial.safetensors")
    manifest_path = target.with_name(target.name + ".verify.json")
    if partial.exists() or manifest_path.exists():
        raise FileExistsError("Leftover export artifacts exist; inspect and remove them before retrying")

    print("[export] Source: " + str(source), flush=True)
    print("[export] Adapters: " + ", ".join(map(str, adapters)), flush=True)
    print("[export] Target: " + str(target), flush=True)
    torch, mp, sd, utils, DTYPE_MAP = prepare_runtime(Path.cwd())
    dtype = DTYPE_MAP[model_config["dtype"]]
    start = time.monotonic()
    patcher = sd.load_diffusion_model(str(source), model_options={"dtype": dtype}, disable_dynamic=True)
    for path in adapters:
        delta = utils.load_torch_file(str(path), safe_load=True)
        patcher, _ = sd.load_lora_for_models(patcher, None, delta, 1.0, 0.0)
        del delta
    original_state = patcher.model.diffusion_model.state_dict()
    original_quant = quantized_layers(original_state)
    del original_state
    patch_names = set(patcher.patches)
    if not patch_names:
        raise RuntimeError("No H3 patches matched the adapter")
    print("[export] Applying {} patches with eager fusion...".format(len(patch_names)), flush=True)
    patcher.set_model_compute_dtype(dtype)
    with torch.no_grad():
        patcher.patch_model(device_to="cuda", lowvram_model_memory=4 * 1024**3,
                            force_patch_weights=True)
    torch.cuda.synchronize()
    missing = patch_names - set(patcher.backup)
    remaining = sum(
        isinstance(fn, mp.LowVramPatch)
        for module in patcher.model.diffusion_model.modules()
        for fn in (list(getattr(module, "weight_function", []) or []) +
                   list(getattr(module, "bias_function", []) or []))
    )
    if missing or remaining:
        raise RuntimeError("Fusion incomplete: {} patches unapplied; {} deferred patches".format(
            len(missing), remaining))
    print("[export] Fused in {:.1f}s; no deferred patches".format(time.monotonic() - start), flush=True)

    # Export fused tensors, NOT ModelPatcher.state_dict_for_saving(): the latter
    # would apply stored patch records a second time during serialization.
    state = patcher.model.diffusion_model.state_dict()
    quant = quantized_layers(state)
    convrot = [k for k, v in quant.items() if v.get("format") == "int8_tensorwise" and v.get("convrot")]
    if not convrot:
        raise RuntimeError("Refusing to export: loaded model has no INT8 ConvRot layers")
    if quant != original_quant:
        raise RuntimeError("Fusion changed the model quantization format or ConvRot layer metadata")
    digests = selected_digests(state, patch_names)
    manifest = {
        "dtype": model_config["dtype"], "quant": quant,
        "state": {k: {"dtype": str(v.dtype), "shape": list(v.shape)} for k, v in state.items()},
        "digests": digests,
    }
    print("[export] {} tensors, {} INT8 ConvRot layers; writing...".format(len(state), len(convrot)), flush=True)
    # Patches now live in weights; release original-weight backups before saving.
    patcher.backup.clear()
    patcher.patches.clear()
    try:
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        # No BF16 expansion and no generic save_checkpoint GPU full-model load.
        save_file({k: v.contiguous() for k, v in state.items()}, str(partial),
                  metadata={"format": "pt", "export": "h3_eager_image_adapter_fusion"})
        print("[export] Saved {:.2f} GiB. Checking in a fresh process...".format(
            partial.stat().st_size / 1024**3), flush=True)
        print("[export] Peak process RAM: {:.1f} GiB".format(
            resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024**2), flush=True)
        # Replace the exporter so only one giant H3 model exists at a time.
        os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve()),
                                 "--verify", str(partial), "--manifest", str(manifest_path),
                                 "--publish", str(target)])
    except Exception:
        # Retain an incomplete checkpoint for diagnosis, never publish it.
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="Captured H3 TOML with merge_adapters")
    parser.add_argument("--output", help="New .safetensors path (default: beside original)")
    parser.add_argument("--verify", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--manifest", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--publish", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.verify:
        if not args.manifest:
            parser.error("--verify requires --manifest")
        verify(args.verify, args.manifest, args.publish)
    else:
        if not args.config:
            parser.error("--config is required")
        export(args.config, args.output)


if __name__ == "__main__":
    main()
