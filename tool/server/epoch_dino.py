"""DINOv2 whole-image reference scoring; CPU-only to respect shared GPU ownership.

The full Hugging Face model snapshot must be present below the configured
models/text_encoders folder. Never downloads models automatically.
"""
import hashlib
import json
from pathlib import Path

from . import config as app_config

_MODEL = None
_PROCESSOR = None
_MODEL_DIR = None


def _model_directory():
    root_value = str(app_config.config.get("filesystem", {}).get("models") or "").strip()
    if not root_value:
        raise RuntimeError("Configure the WebCap models directory before DINO evaluation.")
    root = Path(root_value).expanduser().resolve() / "text_encoders"
    if not root.is_dir():
        raise RuntimeError("Missing model folder: " + str(root))
    candidates = [root] + [p for p in root.iterdir() if p.is_dir() and not p.is_symlink()]
    for directory in sorted(candidates):
        if not (directory / "config.json").is_file() or not (directory / "preprocessor_config.json").is_file():
            continue
        try:
            config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if config.get("model_type") == "dinov2" and (
            (directory / "model.safetensors").is_file() or (directory / "pytorch_model.bin").is_file()
        ):
            return directory
    raise RuntimeError("DINOv2 full Hugging Face snapshot (config, processor and weights) not found under " + str(root))


def preflight():
    """Check offline model and optional dependencies without loading weights."""
    import importlib.util
    directory = _model_directory()
    for dependency in ("torch", "transformers", "safetensors"):
        if importlib.util.find_spec(dependency) is None:
            raise RuntimeError("DINOv2 requires " + dependency + " in WebCap's Python environment.")
    return directory


def _encoder():
    global _MODEL, _PROCESSOR, _MODEL_DIR
    directory = _model_directory()
    if _MODEL is not None and _MODEL_DIR == str(directory):
        return _PROCESSOR, _MODEL, directory
    try:
        from transformers import AutoImageProcessor, AutoModel
    except ImportError as exc:
        raise RuntimeError("DINOv2 requires optional torch and transformers dependencies.") from exc
    processor = AutoImageProcessor.from_pretrained(str(directory), local_files_only=True)
    model = AutoModel.from_pretrained(str(directory), local_files_only=True).to("cpu").eval()
    _MODEL, _PROCESSOR, _MODEL_DIR = model, processor, str(directory)
    return processor, model, directory


def _fingerprint(path, directory):
    import os
    stat = path.stat()
    weight = directory / "model.safetensors"
    if not weight.is_file():
        weight = directory / "pytorch_model.bin"
    weight_stat = weight.stat()
    processor_stat = (directory / "preprocessor_config.json").stat()
    return hashlib.sha256(json.dumps(
        [str(path.resolve()), stat.st_size, stat.st_mtime_ns, str(directory.resolve()),
         weight_stat.st_size, weight_stat.st_mtime_ns, processor_stat.st_mtime_ns],
        separators=(",", ":")).encode()).hexdigest()


def _vector(path, cache_dir):
    import torch
    from PIL import Image, ImageOps
    processor, model, directory = _encoder()
    key = _fingerprint(path, directory)
    cache = cache_dir / (key + ".json")
    if cache.is_file():
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("version") == 1 and isinstance(data.get("embedding"), list):
            return torch.tensor(data["embedding"], dtype=torch.float32)
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        inputs = processor(images=image, return_tensors="pt")
    with torch.inference_mode():
        output = model(**inputs)
        vector = torch.nn.functional.normalize(output.last_hidden_state[:, 0, :].float(), dim=-1)[0].cpu()
    cache_dir.mkdir(parents=True, exist_ok=True)
    from .epoch_test_bench import _atomic_write_json
    _atomic_write_json(cache, {"version": 1, "embedding": vector.tolist()})
    return vector


def compare_images(reference_path, generated_path, cache_dir):
    """Return cosine similarity, not a calibrated probability."""
    import torch
    reference, generated = Path(reference_path), Path(generated_path)
    for path in (reference, generated):
        if path.is_symlink() or not path.is_file():
            raise ValueError("DINOv2 source must be an existing regular image.")
    a = _vector(reference, Path(cache_dir))
    b = _vector(generated, Path(cache_dir))
    return round(float(torch.dot(a, b)), 6)
