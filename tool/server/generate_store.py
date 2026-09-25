import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

from . import config as app_config


MANIFEST_NAME = "generation.json"

_logger = logging.getLogger(__name__)


def generation_root():
    root = Path(app_config.FS_ROOT) / "output" / "generations"
    root.mkdir(parents=True, exist_ok=True)
    return root


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

        root = Path(app_config.FS_ROOT)
        relative_media = str(media_path.relative_to(root)).replace("\\", "/")
        relative_manifest = str((directory / MANIFEST_NAME).relative_to(root)).replace("\\", "/")

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
            "version": 1,
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

def list_results(limit=100):
    found = []
    root = generation_root()
    for manifest in root.glob("*/*/" + MANIFEST_NAME):
        try:
            payload = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            payload = dict(payload)
            payload["storageId"] = manifest.parent.parent.name + "/" + manifest.parent.name
            found.append(payload)
    found.sort(key=lambda item: int(item.get("createdAt") or 0), reverse=True)
    return found[:max(1, min(int(limit or 100), 500))]


def resolve_result_media(relative_path):
    value = str(relative_path or "").strip()
    if not value:
        raise ValueError("Generate media path is empty.")
    candidate = (Path(app_config.FS_ROOT) / value).resolve()
    root = generation_root().resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Generate media path is outside the generation store.") from exc
    if not candidate.is_file():
        raise FileNotFoundError("Generated media does not exist.")
    return candidate
