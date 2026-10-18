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


def training_suggestions(folder, job_id):
    """Read captured tag vocabulary as suggestions, not proven capabilities.

    Derived results are ephemeral: only explicitly approved enrichment is saved.
    """
    from .epoch_reference import reference_vocabulary
    groups = reference_vocabulary(folder, job_id)
    options = {}
    for group in groups:
        label = str(group.get("group") or "").strip()
        terms = group.get("terms") or []
        if not label:
            continue
        values = [str(item["term"]).strip() for item in terms
                  if isinstance(item, dict) and str(item.get("term") or "").strip()]
        if values:
            options[label] = list(dict.fromkeys(values))
    from .epoch_reference import training_wildcard_members
    from .caption_ops import list_media_files, load_caption_text
    members = training_wildcard_members(folder, job_id)
    captions = []
    for name in list_media_files(folder):
        if name not in members:
            continue
        value = str(load_caption_text(folder, name).get("caption") or "").strip()
        if value:
            captions.append(value[:600])
        if len(captions) >= 40:
            break
    return {"promptOptions": options, "trainedWords": [],
            "captionSamples": captions,
            "source": "captured_membership_current_annotations",
            "evidenceLevel": "training_membership_only_not_validated"}


def director_enrichment_request(checkpoint_profile, suggestions):
    """Create review-only metadata suggestions for the existing LLM queue."""
    if not isinstance(checkpoint_profile, dict):
        raise ValueError("Profile context must be an object.")
    sources = checkpoint_profile.get("sources") or {}
    compact = {
        "checkpoint": checkpoint_profile.get("checkpoint"),
        "embedded": sources.get("embedded") or {},
        "existingEnrichment": ((sources.get("webcap") or {}).get("modelProfile") or {}).get("enrichment") or {},
        "externalDescription": (sources.get("sidecar") or {}).get("description") or (sources.get("civitai") or {}).get("description") or "",
        "externalTrainedWords": (sources.get("civitai") or {}).get("trainedWords") or [],
        "capturedVocabulary": (suggestions or {}).get("promptOptions") or {},
        "currentCaptionSamples": (suggestions or {}).get("captionSamples") or [],
    }
    schema = {
        "type": "object", "additionalProperties": False,
        "required": ["description", "trainedWords", "guidance", "promptOptions"],
        "properties": {
            "description": {"type": "string"},
            "trainedWords": {"type": "array", "items": {"type": "string"}},
            "guidance": {"type": "string"},
            "promptOptions": {"type": "object", "additionalProperties": {
                "type": "array", "items": {"type": "string"}}},
        },
    }
    return {
        "operation": "epoch_profile_enrichment", "output": "json",
        "response_schema": schema,
        "prompt": (
            "Suggest human-reviewable LoRA profile metadata from the supplied evidence. "
            "Use only observed training terminology and imported facts. "
            "Do not claim quality, reliable generation, or supported generalization "
            "from tags alone. Do not infer trigger words as proven unless explicitly "
            "supplied. Preserve the user's existing wording when appropriate. "
            "Return concise description, key phrases, named variation groups, "
            "and optional generation guidance as JSON. Nothing is automatically saved.\\n"
            + json.dumps(compact, ensure_ascii=False)[:18000]
        ),
    }


def embed_profile_in_saved_copy(checkpoint, enrichment):
    """Explicitly rewrite a saved/exported LoRA with portable header metadata.

    Tensor bytes and tensor offsets remain intact. The authoritative training
    checkpoint must never be passed by the calling route.
    """
    import shutil
    checkpoint = Path(checkpoint)
    if not checkpoint.is_file() or checkpoint.is_symlink() or checkpoint.suffix.lower() != ".safetensors":
        raise ValueError("Saved LoRA must be an existing regular safetensors file.")
    profile = {"schemaVersion": 1, "enrichment": validate_enrichment(enrichment)}
    target_metadata = json.dumps(profile, ensure_ascii=False, separators=(",", ":"))
    temporary = checkpoint.with_name("." + checkpoint.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with checkpoint.open("rb") as source:
            prefix = source.read(8)
            if len(prefix) != 8:
                raise ValueError("Saved LoRA header is truncated.")
            header_size = struct.unpack("<Q", prefix)[0]
            if header_size < 2 or header_size > 16 * 1024 * 1024:
                raise ValueError("Saved LoRA header exceeds the supported limit.")
            header = json.loads(source.read(header_size))
            if not isinstance(header, dict):
                raise ValueError("Saved LoRA header is invalid.")
            metadata = header.get("__metadata__", {})
            if not isinstance(metadata, dict):
                raise ValueError("Saved LoRA metadata is invalid.")
            if any(not isinstance(k, str) or not isinstance(v, str)
                   for k, v in metadata.items()):
                raise ValueError("Saved LoRA metadata must contain string values.")
            header["__metadata__"] = {**metadata, "webcap.profile": target_metadata}
            new_header = json.dumps(header, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            new_header += b" " * (-len(new_header) % 8)
            if len(new_header) > 16 * 1024 * 1024:
                raise ValueError("New safetensors metadata exceeds the supported header limit.")
            with temporary.open("xb") as output:
                output.write(struct.pack("<Q", len(new_header)))
                output.write(new_header)
                shutil.copyfileobj(source, output, length=8 * 1024 * 1024)
                output.flush()
                os.fsync(output.fileno())
        with temporary.open("rb") as check:
            new_size = struct.unpack("<Q", check.read(8))[0]
            checked = json.loads(check.read(new_size))
        if checked.get("__metadata__", {}).get("webcap.profile") != target_metadata:
            raise ValueError("Embedded profile did not verify after writing.")
        shutil.copymode(checkpoint, temporary)
        os.replace(temporary, checkpoint)
    finally:
        temporary.unlink(missing_ok=True)
    return {"embedded": True, "checkpoint": checkpoint.name}


def director_context_for_selected_loras(loras):
    """Read only profiles embedded in the exact ComfyUI-selected LoRAs.

    Caller decides whether an unavailable profile is a blocking error. This
    text is advisory: scene/user intent always outranks model metadata.
    """
    from . import inference_runtime
    if not isinstance(loras, list):
        raise ValueError("LoRA selection must be an array.")
    lines = []
    for selected in loras:
        name = str((selected or {}).get("name") or "").strip()
        if not name:
            continue
        result = inference_runtime.lora_embedded_profile(name)
        profile = result.get("modelProfile")
        if not profile:
            continue
        info = profile["enrichment"]
        parts = []
        if info.get("description"):
            parts.append("Description: " + info["description"][:600])
        if info.get("trainedWords"):
            parts.append("Key phrases: " + ", ".join(info["trainedWords"][:24])[:800])
        if info.get("promptOptions"):
            selected_groups = list(info["promptOptions"].items())[:12]
            parts.append("Trained options: " + "; ".join(
                str(k)[:60] + ": " + ", ".join(v[:16])[:420]
                for k, v in selected_groups
            )[:3000])
        if info.get("guidance"):
            parts.append("Guidance: " + info["guidance"][:800])
        if parts:
            lines.append("LoRA " + name + "\\n" + "\\n".join(parts))
    return ("[SELECTED LORA MODEL VOCABULARY]\\n"
            "This is descriptive metadata, not a request to change the scene. "
            "Apply relevant key phrases only when consistent with the user's creative intent. "
            "Do not add unrelated trained options merely because they exist.\\n"
            + "\\n\\n".join(lines)) if lines else ""
