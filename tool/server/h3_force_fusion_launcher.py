"""H3 training entrypoint used when WebCap's image-adapter option is enabled.

Runs inside diffusion-pipe's Python environment. All ordinary H3 runs continue
using train.py directly.
"""
import os
import runpy
import sys
import time

repo = os.getcwd()
sys.path.insert(0, repo)

import toml
import utils.common

try:
    config_path = sys.argv[sys.argv.index("--config") + 1]
except (ValueError, IndexError) as exc:
    raise RuntimeError("H3 image-adapter fusion requires --config") from exc

model_config = toml.load(config_path)["model"]
if model_config.get("type") != "minimax_h3" or not model_config.get("merge_adapters"):
    raise RuntimeError("H3 image-adapter fusion was selected but the captured config does not enable an H3 adapter")

sys.path.insert(0, os.path.join(repo, "submodules/ComfyUI"))
from comfy.cli_args import args

args.disable_pinned_memory = True
import comfy.model_management as mm
import comfy.model_patcher as mp

if mm.MAX_PINNED_MEMORY > 0:
    raise RuntimeError("Could not disable ComfyUI pinned memory for H3 adapter fusion")

original_patch_model = mp.ModelPatcher.patch_model


def patch_model(self, *positional, **kwargs):
    # This is the exact diffusion-pipe adapter-merge call, not its normal load.
    if kwargs.get("device_to") == "cuda" and kwargs.get("lowvram_model_memory") == 4 * 1024**3:
        print("[webcap] H3 image adapter: forcing complete weight fusion", flush=True)
        started = time.monotonic()
        kwargs["force_patch_weights"] = True
        result = original_patch_model(self, *positional, **kwargs)
        remaining = sum(
            isinstance(fn, mp.LowVramPatch)
            for module in self.model.diffusion_model.modules()
            for fn in (
                list(getattr(module, "weight_function", []) or [])
                + list(getattr(module, "bias_function", []) or [])
            )
        )
        print(
            f"[webcap] H3 adapter fusion: {time.monotonic() - started:.1f}s, "
            f"remaining deferred patches: {remaining}",
            flush=True,
        )
        if remaining:
            raise RuntimeError(f"H3 adapter fusion incomplete: {remaining} deferred patches remain")
        return result
    return original_patch_model(self, *positional, **kwargs)


mp.ModelPatcher.patch_model = patch_model
print("[webcap] H3 adapter fusion: ComfyUI pinned memory disabled", flush=True)
runpy.run_path(os.path.join(repo, "train.py"), run_name="__main__")
