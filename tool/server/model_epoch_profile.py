"""Portable, checkpoint-owned LoRA metadata without loading tensor weights.

The .webcap.json file is WebCap's editable overlay and may also contain staged
provenance/assessments. Unknown keys are retained on write.
"""
import json
import os
import struct
import uuid
from pathlib import Path


def _read_object(path):
    if not path.is_file():
        return {}
    if path.is_symlink():
        raise ValueError("Metadata path must be a regular file: " + str(path))
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Model metadata must be a JSON object: " + str(path))
    return value


def embedded_metadata(checkpoint):
    """Read only the bounded safetensors header, never tensor data."""
    path = Path(checkpoint)
    if path.suffix.lower() != ".safetensors":
        raise ValueError("Expected a safetensors checkpoint.")
    with path.open("rb") as handle:
        header_size_bytes = handle.read(8)
        if len(header_size_bytes) != 8:
            raise ValueError("Truncated safetensors header.")
        header_size = struct.unpack("<Q", header_size_bytes)[0]
        if header_size < 2 or header_size > 16 * 1024 * 1024:
            raise ValueError("Safetensors header size is invalid or exceeds the metadata reader limit.")
        header_bytes = handle.read(header_size)
        if len(header_bytes) != header_size:
            raise ValueError("Truncated safetensors header.")
    header = json.loads(header_bytes)
    if not isinstance(header, dict):
        raise ValueError("Invalid safetensors header.")
    metadata = header.get("__metadata__", {})
    if not isinstance(metadata, dict) or any(not isinstance(k, str) or not isinstance(v, str)
                                             for k, v in metadata.items()):
        raise ValueError("Invalid embedded safetensors metadata.")
    return metadata


def read_sources(checkpoint):
    """Expose separate raw sources; never silently conflate provenance and advice."""
    path = Path(checkpoint)
    if path.suffix.lower() != ".safetensors":
        raise ValueError("Expected a safetensors checkpoint.")
    return {
        "embedded": embedded_metadata(path),
        "webcap": _read_object(path.with_suffix(".webcap.json")),
        "sidecar": _read_object(path.with_suffix(".json")),
        "civitai": _read_object(path.with_suffix(".civitai.info")),
    }


def _normalize_strings(values, field):
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        raise ValueError(field + " must be an array of strings.")
    return [v.strip() for v in values if v.strip()]


def validate_enrichment(value):
    """Only user-owned enrichment is editable; raw imported fields remain intact."""
    if not isinstance(value, dict):
        raise ValueError("Enrichment must be an object.")
    allowed = {"description", "trainedWords", "promptOptions", "guidance"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError("Unsupported enrichment fields: " + ", ".join(sorted(unknown)))
    result = {}
    if "description" in value:
        if not isinstance(value["description"], str):
            raise ValueError("Description must be text.")
        result["description"] = value["description"].strip()
    if "trainedWords" in value:
        result["trainedWords"] = _normalize_strings(value["trainedWords"], "trainedWords")
    if "guidance" in value:
        if not isinstance(value["guidance"], str):
            raise ValueError("Guidance must be text.")
        result["guidance"] = value["guidance"].strip()
    if "promptOptions" in value:
        groups = value["promptOptions"]
        if not isinstance(groups, dict) or any(not isinstance(k, str) or not k.strip()
                                                for k in groups):
            raise ValueError("Prompt options must be named groups.")
        result["promptOptions"] = {k.strip(): _normalize_strings(v, "promptOptions." + k)
                                   for k, v in groups.items()}
    return result


def save_enrichment(checkpoint, enrichment):
    """Atomically merge edits into the existing WebCap sidecar; never rewrite tensors."""
    path = Path(checkpoint)
    if path.suffix.lower() != ".safetensors" or not path.is_file() or path.is_symlink():
        raise ValueError("Checkpoint must be an existing regular safetensors file.")
    sidecar = path.with_suffix(".webcap.json")
    payload = _read_object(sidecar)
    profile = payload.get("modelProfile", {})
    if not isinstance(profile, dict):
        raise ValueError("Existing modelProfile is invalid.")
    payload["modelProfile"] = {**profile, "schemaVersion": 1,
                               "enrichment": validate_enrichment(enrichment)}
    temporary = sidecar.with_name("." + sidecar.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, sidecar)
    finally:
        temporary.unlink(missing_ok=True)
    return payload["modelProfile"]
