"""Fizgig MiniMax H3 adapter. No Diffusion Pipe runner dependencies.

This module plans immutable headless Fizgig commands from WebCap's captured
media and an explicitly selected Fizgig recipe. It does not launch work.
The shared runner must own queue, GPU, process identity and Console logging.
"""

import json
import math
import re
import shlex
import tomllib
from pathlib import Path, PurePosixPath


_STATE_SUFFIX = re.compile(r"^.+-\d{6}-state$")
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
_EPOCH_PROGRESS = re.compile(
    r"\bepoch\s+(\d+)/(\d+)\s+avr_loss=([0-9.eE+-]+)\s+"
    r"step=(\d+)\s+([0-9.eE+-]+)s/step"
)


def _absolute(value, label):
    path = str(value or "").strip()
    if not path or not path.startswith("/") or any(p == ".." for p in PurePosixPath(path).parts):
        raise ValueError("Fizgig " + label + " must be an absolute Linux path.")
    return path


def _toml_string(value):
    return json.dumps(str(value), ensure_ascii=False)


def _positive_int(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError("Fizgig " + label + " must be a positive integer.")
    return value


def dataset_from_capture(captured_dataset_toml, cache_root):
    """Convert reviewed image-only directory memberships without touching the Set.

    DP supports per-directory explicit buckets. Fizgig uses area-based bucketing,
    so this intentionally supports one image target per directory. Other shapes
    must be investigated rather than silently flattened.
    """
    cache = _absolute(cache_root, "cache root")
    try:
        source = tomllib.loads(captured_dataset_toml)
    except (TypeError, tomllib.TOMLDecodeError) as exc:
        raise ValueError("Invalid captured H3 dataset TOML.") from exc
    directories = source.get("directory")
    if not isinstance(directories, list) or not directories:
        raise ValueError("Captured H3 dataset has no directory entries.")
    result = [
        "[general]", 'caption_extension = ".txt"', "batch_size = 1",
        "num_repeats = 1", "enable_bucket = true", "bucket_no_upscale = true",
    ]
    members = []
    used_paths = set()
    for i, block in enumerate(directories):
        if not isinstance(block, dict):
            raise ValueError("Captured H3 dataset entry must be a table.")
        image_dir = _absolute(block.get("path"), "captured image directory")
        if image_dir in used_paths:
            raise ValueError("Captured H3 dataset repeats an image directory: " + image_dir)
        used_paths.add(image_dir)
        if str(block.get("group") or "images").lower() != "images":
            raise ValueError("Fizgig image-only bridge does not yet translate captured video/voice buckets.")
        buckets = block.get("size_buckets")
        if not isinstance(buckets, list) or len(buckets) != 1:
            raise ValueError("Fizgig bridge requires exactly one captured image bucket per directory.")
        shape = buckets[0]
        if not isinstance(shape, list) or len(shape) != 3 or shape[2] != 1:
            raise ValueError("Fizgig bridge cannot translate a non-image bucket.")
        width, height, _ = shape
        if any(isinstance(v, bool) or not isinstance(v, int) or v <= 0 or v % 32 for v in (width, height)):
            raise ValueError("Fizgig image resolutions must be positive multiples of 32.")
        repeats = _positive_int(block.get("num_repeats", 1), "dataset repeats")
        cache_dir = str(PurePosixPath(cache) / ("%03d" % i))
        result.extend([
            "", "[[datasets]]",
            "image_directory = " + _toml_string(image_dir),
            "cache_directory = " + _toml_string(cache_dir),
            "resolution = [" + str(width) + ", " + str(height) + "]",
            "num_repeats = " + str(repeats),
            "photos_only = true",
        ])
        members.append({"path": image_dir, "cache": cache_dir, "resolution": [width, height], "repeats": repeats})
    return {"toml": "\n".join(result) + "\n", "directories": members}


def plan_h3(
    captured_dataset_toml, *, dataset_path, cache_root, output_dir, output_name,
    python_path, dit_path, vae_path, text_encoder_path, rank, learning_rate,
    epochs, save_every_n_epochs, seed, adapter_path="", ema_decay=0.0,
    resume_state="", blocks_to_swap=-1, photo_blocks="20-49",
):
    """Create cache→text→train commands; nothing is executed or downloaded.

    The recipe is explicit: DP's optimizer, shifts, dropout and checkpoints
    are NOT assumed to have interchangeable semantics in Fizgig.
    """
    dataset_path = _absolute(dataset_path, "dataset config")
    output_dir = _absolute(output_dir, "output directory")
    python_path = _absolute(python_path, "Python interpreter")
    dit_path = _absolute(dit_path, "diffusion model")
    vae_path = _absolute(vae_path, "video VAE")
    text_encoder_path = _absolute(text_encoder_path, "text encoder")
    adapter_path = _absolute(adapter_path, "training adapter") if adapter_path else ""
    cache = dataset_from_capture(captured_dataset_toml, cache_root)
    if not _SAFE_NAME.fullmatch(str(output_name or "")):
        raise ValueError("Fizgig output name must contain only letters, numbers, _, - or dots.")
    rank = _positive_int(rank, "LoRA rank")
    epochs = _positive_int(epochs, "epochs")
    save_every_n_epochs = _positive_int(save_every_n_epochs, "save interval")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ValueError("Fizgig seed must be a nonnegative integer.")
    try:
        learning_rate = float(learning_rate)
        ema_decay = float(ema_decay)
    except (TypeError, ValueError) as exc:
        raise ValueError("Fizgig LR and EMA must be numeric.") from exc
    if not 0 < learning_rate <= 1 or not 0 <= ema_decay < 1:
        raise ValueError("Fizgig learning rate or EMA is out of range.")
    if isinstance(blocks_to_swap, bool) or not isinstance(blocks_to_swap, int) or blocks_to_swap < -1:
        raise ValueError("Fizgig blocks_to_swap must be -1 or a nonnegative integer.")
    resume_state = _absolute(resume_state, "resume state") if resume_state else ""
    if resume_state and not _STATE_SUFFIX.fullmatch(PurePosixPath(resume_state).name):
        raise ValueError("Fizgig resume requires an explicit *-NNNNNN-state directory.")
    if resume_state and (PurePosixPath(resume_state).parent != PurePosixPath(output_dir)
                         or not PurePosixPath(resume_state).name.startswith(output_name + "-")):
        raise ValueError("Fizgig resume state must belong to this exact output run.")
    if photo_blocks and not re.fullmatch(r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*", str(photo_blocks)):
        raise ValueError("Fizgig photo block targeting must be comma-separated block indices/ranges.")
    def cmd(parts):
        return " ".join(shlex.quote(str(item)) for item in parts)
    root = [python_path, "src/fizgig/families/cache.py", "--family", "minimax", "--dataset_config", dataset_path]
    latents = cmd(root + ["--stage", "latents", "--model", vae_path, "--skip_existing"])
    text = cmd(root + ["--stage", "text", "--model", text_encoder_path, "--skip_existing"])
    train = [
        python_path, "src/fizgig/families/train.py", "--family", "minimax",
        "--dataset_config", dataset_path,
        "--dit", dit_path, "--vae", vae_path, "--text_encoder", text_encoder_path,
        "--output_dir", output_dir, "--output_name", output_name,
        "--network_dim", rank, "--network_alpha", rank,
        "--learning_rate", learning_rate, "--max_train_epochs", epochs,
        "--save_every_n_epochs", save_every_n_epochs, "--seed", seed,
        "--save_state", "--save_state_on_train_end", "--keep_last_n_states", 2,
        "--precision", "auto", "--blocks_to_swap", blocks_to_swap,
        "--optimizer_type", "adamw", "--ema_decay", ema_decay,
    ]
    # H3 image training intentionally defaults to Fizgig's 20-49 identity block window.
    # Passing an explicit empty string remains an opt-in all-block experiment.
    if photo_blocks:
        train += ["--family_option", "photo_blocks=" + str(photo_blocks)]
    if adapter_path:
        train += ["--training_adapter", adapter_path]
    if resume_state:
        train += ["--resume", resume_state]
    return {
        "datasetToml": cache["toml"],
        "directories": cache["directories"],
        "commands": {"latents": latents, "text": text, "train": cmd(train)},
        "phases": [
            {"name": "latents", "command": latents},
            {"name": "text", "command": text},
            {"name": "train", "command": cmd(train)},
        ],
        "outputDir": output_dir,
        "outputName": output_name,
        "pauseSentinel": str(PurePosixPath(output_dir) / ".pause_requested"),
        "resumeState": resume_state,
        "adapterPath": adapter_path,
        "emaDecay": ema_decay,
        "photoBlocks": photo_blocks,
    }


def saved_artifacts(output_dir, output_name, filenames):
    """Inspect exact direct children; never conflate resumable state with a LoRA."""
    _absolute(output_dir, "output directory")
    if not _SAFE_NAME.fullmatch(str(output_name or "")):
        raise ValueError("Invalid Fizgig output name.")
    epochs, states = {}, {}
    for name in filenames:
        item = str(name)
        match = re.fullmatch(re.escape(output_name) + r"-(\d{6})\.safetensors", item)
        state = re.fullmatch(re.escape(output_name) + r"-(\d{6})-state", item)
        if match:
            epochs[int(match.group(1))] = str(PurePosixPath(output_dir) / item)
        elif state:
            states[int(state.group(1))] = str(PurePosixPath(output_dir) / item)
    return {"epochs": dict(sorted(epochs.items())), "states": dict(sorted(states.items()))}


def observe_h3(log_tail):
    """Read Fizgig's actual epoch-completion log, without guessing progress."""
    matches = list(_EPOCH_PROGRESS.finditer(str(log_tail or "")))
    if not matches:
        return {}
    epoch, epochs, loss, step, seconds = matches[-1].groups()
    values = float(loss), float(seconds)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("Fizgig reported non-finite epoch loss or step time.")
    return {
        "phase": "train",
        "epoch": int(epoch),
        "epochs": int(epochs),
        "step": int(step),
        "loss": values[0],
        "secondsPerStep": values[1],
    }


def read_loss_points(run_dir, output_name):
    """Read on demand, never from the normal frequent status-poll path.

    Fizgig StepLog writes records in batches of 20:
    .fizgig_loss_NAME.jsonl: {"s": step, "e": epoch, "l": loss, "lr": optional}.
    """
    if not _SAFE_NAME.fullmatch(str(output_name or "")):
        raise ValueError("Invalid Fizgig output name.")
    path = Path(run_dir) / (".fizgig_loss_" + output_name + ".jsonl")
    if not path.exists():
        return []
    result = []
    with path.open(encoding="utf-8") as stream:
        for line_number, raw in enumerate(stream, start=1):
            if not raw.strip():
                continue
            try:
                event = json.loads(raw)
                step, epoch, loss = int(event["s"]), int(event["e"]), float(event["l"])
                lr = event.get("lr")
                if lr is not None:
                    lr = float(lr)
            except (TypeError, ValueError, KeyError, AttributeError) as exc:
                raise ValueError(f"Invalid Fizgig loss record at line {line_number}: {path}") from exc
            if step < 0 or epoch < 1 or not math.isfinite(loss) or (lr is not None and not math.isfinite(lr)):
                raise ValueError(f"Invalid Fizgig loss values at line {line_number}: {path}")
            result.append({"step": step, "epoch": epoch, "loss": loss, **({"lr": lr} if lr is not None else {})})
    return result


def inspect_h3(run_dir, output_name, *, include_loss=False):
    """Inspect actual Fizgig outputs; a state folder name is not proof of a saved state.

    The trainer writes training_state.json *last* as the state commit marker.
    This does not check whether a checkpoint is fresh relative to a pause
    request; the shared runner must compare evidence around process exit.
    """
    root = Path(run_dir)
    if not root.is_dir():
        raise FileNotFoundError("Fizgig output directory is unavailable: " + str(root))
    artifacts = saved_artifacts(str(root), output_name, [p.name for p in root.iterdir()])
    candidates = [
        {"epoch": epoch, "path": path}
        for epoch, path in artifacts["epochs"].items()
        if Path(path).is_file()
    ]
    resume_points = []
    for epoch, name in artifacts["states"].items():
        state_dir = Path(name)
        marker = state_dir / "training_state.json"
        if not marker.is_file():
            continue  # an uncommitted / interrupted state is not resumable
        try:
            payload = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("Unreadable Fizgig state commit marker: " + str(marker)) from exc
        if not isinstance(payload, dict) or payload.get("epoch") != epoch:
            raise ValueError("Fizgig state epoch does not match its checkpoint directory: " + str(marker))
        missing = [
            filename for filename in ("lora.safetensors", "optimizer.pt", "rng.pt")
            if not (state_dir / filename).is_file()
        ]
        if missing:
            raise ValueError("Committed Fizgig resume state is incomplete: " + str(state_dir)
                             + " (missing " + ", ".join(missing) + ")")
        resume_points.append({"id": str(state_dir), "epoch": epoch, "step": payload.get("global_step")})
    return {
        "candidates": candidates,
        "resumePoints": resume_points,
        "checkpointVerified": bool(resume_points),
        "lossPoints": read_loss_points(root, output_name) if include_loss else None,
    }
