"""Configured-root LoRA profile discovery. No ComfyUI dependency or persistent index."""
from pathlib import Path, PurePosixPath

from . import config as app_config
from .training_history import host_path_for_training_path
from .model_epoch_profile import _read_object, save_enrichment, validate_enrichment
from .training_test_paths import TEST_COPY_STAGE_LABELS


def roots():
    config = app_config.load_config_from_disk()
    training = config.get("training") if isinstance(config.get("training"), dict) else {}
    entries = training.get("test_copy_roots") if isinstance(training.get("test_copy_roots"), dict) else {}
    result = {}
    for stage in TEST_COPY_STAGE_LABELS:
        raw = str(entries.get(stage) or "").strip()
        if raw:
            result[stage] = Path(host_path_for_training_path(raw)).resolve()
    return result


def _checkpoint(stage, relative):
    configured = roots()
    if stage not in configured:
        raise ValueError("No configured model root for stage: " + str(stage))
    root = configured[stage]
    if not root.is_dir():
        raise FileNotFoundError("Configured LoRA root does not exist: " + str(root))
    raw = str(relative or "").replace("\\", "/")
    path = PurePosixPath(raw)
    if not raw or path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError("Invalid model-root relative LoRA path.")
    if path.suffix.lower() != ".safetensors":
        raise ValueError("Expected a safetensors LoRA.")
    candidate = root.joinpath(*path.parts)
    if any(parent.is_symlink() for parent in [candidate] + list(candidate.parents) if parent == root or root in parent.parents):
        raise ValueError("Symlinked LoRA paths are not supported.")
    if not candidate.is_file() or not candidate.resolve().is_relative_to(root):
        raise FileNotFoundError("LoRA not found inside configured model root.")
    return candidate


def catalogue():
    result = []
    for stage, root in roots().items():
        if not root.is_dir():
            raise FileNotFoundError("Configured LoRA root does not exist: " + str(root))
        for path in root.rglob("*.safetensors"):
            if path.is_symlink() or not path.is_file() or any(parent.is_symlink() for parent in path.parents if root in parent.parents):
                continue
            relative = path.relative_to(root).as_posix()
            sidecar = path.with_suffix(".webcap.json")
            metadata = _read_object(sidecar)
            profile = metadata.get("modelProfile") or {}
            if not isinstance(profile, dict):
                raise ValueError("Invalid modelProfile in " + str(sidecar))
            enrichment = profile.get("enrichment")
            enriched = isinstance(enrichment, dict) and bool(enrichment)
            if enriched:
                enrichment = validate_enrichment(enrichment)
            result.append({
                "stage": stage, "path": relative, "name": relative,
                "enriched": enriched, "enrichment": enrichment if enriched else None,
            })
    return sorted(result, key=lambda item: (item["stage"], item["path"].casefold()))


def profile(stage, relative, enrichment=None):
    path = _checkpoint(stage, relative)
    if enrichment is not None:
        return save_enrichment(path, enrichment)
    data = _read_object(path.with_suffix(".webcap.json"))
    profile_data = data.get("modelProfile") or {}
    if not isinstance(profile_data, dict):
        raise ValueError("Invalid LoRA profile.")
    return profile_data
