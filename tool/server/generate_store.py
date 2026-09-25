import json
import logging
import os
import shutil
import tempfile
import threading
import time
import uuid
from pathlib import Path

from . import config as app_config
from .folder_state_store import read_folder_state, set_media_rating


MANIFEST_NAME = "generation.json"
PROMPT_LIBRARY_VERSION = 1
PROMPT_LIBRARY_NAME = "prompts.json"

_logger = logging.getLogger(__name__)
_PROMPT_LIBRARY_LOCK = threading.RLock()


def generation_root():
    root = app_config.output_root() / "generations"
    root.mkdir(parents=True, exist_ok=True)
    return root


def prompt_library_path():
    root = app_config.output_root() / "prompts"
    root.mkdir(parents=True, exist_ok=True)
    return root / PROMPT_LIBRARY_NAME


def _read_prompt_library():
    path = prompt_library_path()
    if not path.is_file():
        return {"version": PROMPT_LIBRARY_VERSION, "prompts": []}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Generate Prompt Library is unreadable.") from exc
    if not isinstance(payload, dict) or payload.get("version") != PROMPT_LIBRARY_VERSION:
        raise RuntimeError("Generate Prompt Library has an unsupported format.")
    prompts = payload.get("prompts")
    if not isinstance(prompts, list):
        raise RuntimeError("Generate Prompt Library prompts must be an array.")
    return payload


def list_prompts():
    with _PROMPT_LIBRARY_LOCK:
        payload = _read_prompt_library()
        prompts = [dict(item) for item in payload["prompts"] if isinstance(item, dict)]
    prompts.sort(key=lambda item: int(item.get("updatedAt") or 0), reverse=True)
    return prompts


def save_prompt(name, prompt, prompt_id=""):
    clean_name = str(name or "").strip()
    clean_prompt = str(prompt or "").strip()
    clean_id = str(prompt_id or "").strip()
    if not clean_name:
        raise ValueError("Prompt name is required.")
    if not clean_prompt:
        raise ValueError("Prompt text is required.")
    with _PROMPT_LIBRARY_LOCK:
        payload = _read_prompt_library()
        now = int(time.time() * 1000)
        if clean_id:
            item = next((candidate for candidate in payload["prompts"] if isinstance(candidate, dict) and str(candidate.get("id") or "") == clean_id), None)
            if item is None:
                raise FileNotFoundError("Saved prompt does not exist.")
            item["name"] = clean_name
            item["prompt"] = clean_prompt
            item["updatedAt"] = now
        else:
            item = {"id": uuid.uuid4().hex, "name": clean_name, "prompt": clean_prompt, "createdAt": now, "updatedAt": now}
            payload["prompts"].append(item)
        _atomic_write_json(prompt_library_path(), payload)
        return dict(item)


def delete_prompt(prompt_id):
    clean_id = str(prompt_id or "").strip()
    if not clean_id:
        raise ValueError("Prompt ID is required.")
    with _PROMPT_LIBRARY_LOCK:
        payload = _read_prompt_library()
        for index, item in enumerate(payload["prompts"]):
            if isinstance(item, dict) and str(item.get("id") or "") == clean_id:
                removed = payload["prompts"].pop(index)
                _atomic_write_json(prompt_library_path(), payload)
                return dict(removed)
    raise FileNotFoundError("Saved prompt does not exist.")


def reference_root():
    root = Path(app_config.FS_ROOT) / ".webcap_runtime" / "generate-references"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _atomic_write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temp_name, path)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def save_reference(upload):
    filename = Path(str(upload.filename or "reference")).name
    token = str(int(time.time() * 1000)) + "-" + os.urandom(6).hex()
    directory = reference_root() / token
    directory.mkdir(parents=True, exist_ok=False)
    path = directory / filename
    upload.save(path)
    return {
        "id": token,
        "name": filename,
        "path": str(path.relative_to(Path(app_config.FS_ROOT))).replace("\\", "/"),
    }


def cleanup_references(references):
    root = reference_root().resolve()
    values = references.values() if isinstance(references, dict) else references or []
    removed = 0
    for relative_path in values:
        value = str(relative_path or "").strip()
        if not value:
            continue
        candidate = (Path(app_config.FS_ROOT) / value).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            continue
        if candidate.is_file():
            candidate.unlink()
            removed += 1
        parent = candidate.parent
        while parent != root:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
    return removed


def resolve_reference_path(relative_path):
    value = str(relative_path or "").strip()
    if not value:
        raise ValueError("Generate reference path is empty.")
    candidate = (Path(app_config.FS_ROOT) / value).resolve()
    root = reference_root().resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Generate reference path is outside the reference store.") from exc
    if not candidate.is_file():
        raise FileNotFoundError("Generate reference image does not exist.")
    return candidate


def persist_result(job_id, request, output_ref, media_bytes, provider_job_id, elapsed_ms):
    created_at = int(time.time() * 1000)
    day = time.strftime("%Y-%m-%d", time.localtime(created_at / 1000))
    directory = generation_root() / day / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)

    try:
        suffix = Path(str(output_ref.get("filename") or "")).suffix.lower()
        if not suffix:
            suffix = ".bin"
        media_name = "result" + suffix
        media_path = directory / media_name
        media_path.write_bytes(media_bytes)

        root = app_config.output_root().resolve()
        relative_media = str(media_path.resolve().relative_to(root)).replace("\\", "/")
        relative_manifest = str((directory / MANIFEST_NAME).resolve().relative_to(root)).replace("\\", "/")

        persisted_references = {}
        source_references = request.get("references") if isinstance(request.get("references"), dict) else {}
        for role, relative_path in source_references.items():
            source = resolve_reference_path(relative_path)
            target_dir = directory / "references"
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / (str(role) + "-" + source.name)
            shutil.copy2(source, target)
            persisted_references[str(role)] = str(target.relative_to(root)).replace("\\", "/")

        payload = {
            "version": 2,
            "jobId": str(job_id),
            "createdAt": created_at,
            "modelId": str(request.get("modelId") or ""),
            "mediaKind": str(request.get("mediaKind") or ""),
            "sourcePrompt": str(request.get("sourcePrompt") or request.get("prompt") or ""),
            "resolvedPrompt": str(request.get("prompt") or ""),
            "settings": request.get("settings") if isinstance(request.get("settings"), dict) else {},
            "seed": (request.get("settings") or {}).get("seed"),
            "loras": request.get("loras") if isinstance(request.get("loras"), list) else [],
            "references": persisted_references,
            "wildcardsEnabled": bool(request.get("wildcardsEnabled")),
            "workflowFile": str(request.get("workflowFile") or ""),
            "providerJobId": str(provider_job_id or ""),
            "elapsedMs": int(elapsed_ms or 0),
            "mediaPath": relative_media,
            "manifestPath": relative_manifest,
        }
        manifest_path = directory / MANIFEST_NAME
        _atomic_write_json(manifest_path, payload)
        try:
            from .storage_manager import register_usage
            owned_files = [media_path, manifest_path]
            owned_files.extend(root / relative for relative in persisted_references.values())
            register_usage(
                "generate",
                day + "/" + str(job_id),
                bytes_used=sum(int(path.stat().st_size) for path in owned_files),
                file_count=len(owned_files),
                source="producer",
            )
        except Exception as exc:
            _logger.warning("Could not register Generate storage usage: %s", exc)
        return payload
    except Exception:
        try:
            shutil.rmtree(directory)
        except OSError:
            _logger.exception("Could not clean partial Generate result directory %s.", directory)
        raise

def result_for_job(job_id):
    wanted = str(job_id or "").strip()
    if not wanted:
        return None
    root = generation_root()
    if not root.is_dir():
        return None
    # Result directories are keyed by job ID under day folders. Probe the
    # deterministic child path in each day directory instead of scanning every
    # manifest.
    for day_dir in root.iterdir():
        if day_dir.is_symlink() or not day_dir.is_dir():
            continue
        manifest = day_dir / wanted / MANIFEST_NAME
        if not manifest.is_file():
            continue
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and str(payload.get("jobId") or "") == wanted:
            media_name = Path(str(payload.get("mediaPath") or "")).name
            if not media_name or not (manifest.parent / media_name).is_file():
                continue
            return _listed_result_payload(manifest, payload)
    return None


def _output_relative(path):
    return str(Path(path).resolve().relative_to(app_config.output_root().resolve())).replace("\\", "/")


def _result_directory(storage_id):
    value = str(storage_id or "").strip().replace("\\", "/")
    if not value:
        raise ValueError("Generation storage ID is required.")
    root = generation_root().resolve()
    candidate = (root / value).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Generation storage ID is outside the generation store.") from exc
    if not candidate.is_dir():
        raise FileNotFoundError("Generated result does not exist.")
    return candidate


def _listed_result_payload(manifest, payload):
    listed = dict(payload)
    directory = manifest.parent
    media_name = Path(str(listed.get("mediaPath") or "")).name
    media_path = directory / media_name if media_name else None
    if media_path is not None and media_path.is_file():
        listed["mediaPath"] = _output_relative(media_path)
    listed["manifestPath"] = _output_relative(manifest)

    references = listed.get("references") if isinstance(listed.get("references"), dict) else {}
    normalized_references = {}
    for role, stored_path in references.items():
        name = Path(str(stored_path or "")).name
        candidate = directory / "references" / name if name else None
        normalized_references[str(role)] = (
            _output_relative(candidate)
            if candidate is not None and candidate.is_file()
            else str(stored_path or "")
        )
    listed["references"] = normalized_references
    listed["storageId"] = manifest.parent.parent.name + "/" + manifest.parent.name
    state = read_folder_state(directory / ".webcap_state.json")
    ratings = state.get("ratings_by_media") if isinstance(state.get("ratings_by_media"), dict) else {}
    try:
        listed["rating"] = max(0, min(5, int(ratings.get(media_name, 0) or 0)))
    except (TypeError, ValueError):
        listed["rating"] = 0
    return listed


def rate_result(storage_id, rating):
    directory = _result_directory(storage_id)
    manifest_path = directory / MANIFEST_NAME
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise FileNotFoundError("Generation manifest does not exist.")
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Generation manifest is unreadable.") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("Generation manifest is not a JSON object.")
    media_name = Path(str(payload.get("mediaPath") or "")).name
    if not media_name:
        raise ValueError("Generation manifest has no media path.")
    normalized = set_media_rating(directory / ".webcap_state.json", media_name, rating)
    return {
        "storageId": str(storage_id or "").strip().replace("\\", "/"),
        "mediaKey": media_name,
        "rating": normalized,
    }


def list_results(limit=100):
    found = []
    root = generation_root()
    for manifest in root.glob("*/*/" + MANIFEST_NAME):
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            found.append(_listed_result_payload(manifest, payload))
    found.sort(key=lambda item: int(item.get("createdAt") or 0), reverse=True)
    return found[:max(1, min(int(limit or 100), 500))]


def resolve_result_media(relative_path):
    value = str(relative_path or "").strip()
    if not value:
        raise ValueError("Generate media path is empty.")
    candidate = (app_config.output_root() / value).resolve()
    root = generation_root().resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Generate media path is outside the generation store.") from exc
    if not candidate.is_file():
        raise FileNotFoundError("Generated media does not exist.")
    return candidate
