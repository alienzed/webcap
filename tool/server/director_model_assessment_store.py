import json
import os
import secrets
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions


ASSESSMENT_VERSION = 1
ROOT_NAME = "director-model-assessments"
_active_assessment_ids = set()


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def assessment_root():
    return app_config.app_cache_root() / ROOT_NAME


def _assessment_path(assessment_id):
    assessment_id = str(assessment_id or "").strip()
    if not assessment_id or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for ch in assessment_id):
        raise ValueError("Director assessment ID is invalid.")
    return assessment_root() / (assessment_id + ".json")


def _copy(value):
    return json.loads(json.dumps(value))


def _write(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix="." + path.name + ".",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = handle.name
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        normalize_path_permissions(path)
    finally:
        if temporary_path and os.path.exists(temporary_path):
            try:
                os.unlink(temporary_path)
            except OSError:
                pass


def _read(assessment_id):
    path = _assessment_path(assessment_id)
    if not path.is_file():
        raise FileNotFoundError("Director assessment does not exist: " + str(assessment_id))
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("Could not read Director assessment: " + str(exc)) from exc
    if not isinstance(payload, dict) or payload.get("version") != ASSESSMENT_VERSION:
        raise RuntimeError("Director assessment has an unsupported format.")
    return payload


def _normalize_model(model):
    model = model if isinstance(model, dict) else {}
    model_ref = str(model.get("modelRef") or model.get("id") or "").strip()
    runtime_id = str(model.get("runtimeId") or "").strip()
    model_id = str(model.get("modelId") or "").strip()
    if not model_ref or not runtime_id or not model_id:
        raise ValueError("Director assessment requires modelRef, runtimeId, and modelId.")
    try:
        size_bytes = max(0, int(model.get("sizeBytes") or 0))
    except (TypeError, ValueError):
        size_bytes = 0
    return {
        "modelRef": model_ref,
        "runtimeId": runtime_id,
        "runtimeName": str(model.get("runtimeName") or "").strip(),
        "modelId": model_id,
        "label": str(model.get("label") or model_id).strip(),
        "sizeBytes": size_bytes,
    }


def start_assessment(model, advertised=None):
    frozen_model = _normalize_model(model)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    assessment_id = stamp + "-" + secrets.token_hex(4)
    payload = {
        "version": ASSESSMENT_VERSION,
        "id": assessment_id,
        "status": "running",
        "startedAt": _now_iso(),
        "finishedAt": "",
        "model": frozen_model,
        "advertised": _copy(advertised) if isinstance(advertised, dict) else None,
        "summary": {},
        "error": "",
        "attempts": [],
    }
    _write(_assessment_path(assessment_id), payload)
    _active_assessment_ids.add(assessment_id)
    return _copy(payload)


def _normalize_attempt(attempt):
    attempt = attempt if isinstance(attempt, dict) else {}
    kind = str(attempt.get("kind") or "").strip()
    if kind not in {"context", "output", "prose"}:
        raise ValueError("Director assessment attempt kind is invalid.")
    status = str(attempt.get("status") or "").strip()
    if status not in {"passed", "failed", "stopped"}:
        raise ValueError("Director assessment attempt status is invalid.")
    try:
        target = int(attempt.get("target"))
    except (TypeError, ValueError) as exc:
        raise ValueError("Director assessment attempt target must be an integer.") from exc
    if target <= 0:
        raise ValueError("Director assessment attempt target must be positive.")

    normalized = {
        "kind": kind,
        "target": target,
        "status": status,
        "prompt": str(attempt.get("prompt") or ""),
        "text": str(attempt.get("text") or ""),
        "reasoning": str(attempt.get("reasoning") or ""),
        "finishReason": str(attempt.get("finishReason") or ""),
        "error": str(attempt.get("error") or ""),
        "failureKind": str(attempt.get("failureKind") or "").strip(),
        "note": str(attempt.get("note") or "").strip(),
    }
    for field in ("promptTokens", "completionTokens", "observedContextSize"):
        try:
            normalized[field] = max(0, int(attempt.get(field) or 0))
        except (TypeError, ValueError):
            normalized[field] = 0
    for field in ("totalSeconds", "tokensPerSecond"):
        try:
            normalized[field] = max(0.0, float(attempt.get(field) or 0))
        except (TypeError, ValueError):
            normalized[field] = 0.0
    return normalized


def update_assessment(assessment_id, attempts, summary=None, *, final=False, status="", error=""):
    payload = _read(assessment_id)
    if not isinstance(attempts, list):
        raise ValueError("Director assessment attempts must be a list.")
    payload["attempts"] = [_normalize_attempt(item) for item in attempts]
    payload["summary"] = _copy(summary) if isinstance(summary, dict) else {}
    payload["error"] = str(error or "")
    if final:
        final_status = str(status or "incomplete").strip()
        if final_status not in {"complete", "incomplete", "error", "stopped"}:
            raise ValueError("Director assessment final status is invalid.")
        payload["status"] = final_status
        payload["finishedAt"] = _now_iso()
    else:
        payload["status"] = "running"
        payload["finishedAt"] = ""
    _write(_assessment_path(assessment_id), payload)
    if final:
        _active_assessment_ids.discard(str(assessment_id))
    return _copy(payload)


def get_assessment(assessment_id):
    payload = _read(assessment_id)
    if payload.get("status") == "running" and str(assessment_id) not in _active_assessment_ids:
        payload["status"] = "incomplete"
        payload["error"] = payload.get("error") or "Assessment interrupted before finalization; no assessment is active in this server session."
    return _copy(payload)


def list_assessments():
    root = assessment_root()
    if not root.is_dir():
        return []
    rows = []
    for path in root.glob("*.json"):
        payload = get_assessment(path.stem)
        attempts = payload.get("attempts") if isinstance(payload.get("attempts"), list) else []
        rows.append({
            "id": str(payload.get("id") or path.stem),
            "status": str(payload.get("status") or ""),
            "startedAt": str(payload.get("startedAt") or ""),
            "finishedAt": str(payload.get("finishedAt") or ""),
            "model": _copy(payload.get("model")) if isinstance(payload.get("model"), dict) else {},
            "summary": _copy(payload.get("summary")) if isinstance(payload.get("summary"), dict) else {},
            "error": str(payload.get("error") or ""),
            "attemptCount": len(attempts),
            "active": str(payload.get("id") or path.stem) in _active_assessment_ids,
            "bytes": path.stat().st_size,
        })
    rows.sort(key=lambda item: item.get("startedAt") or "", reverse=True)
    return rows


def delete_assessment(assessment_id):
    assessment_id = str(assessment_id or "").strip()
    if assessment_id in _active_assessment_ids:
        raise RuntimeError("Active Director assessment evidence cannot be deleted while it is being written.")
    path = _assessment_path(assessment_id)
    try:
        path.unlink()
    except FileNotFoundError:
        raise FileNotFoundError("Director assessment does not exist: " + str(assessment_id))
    return True


def clear_assessments():
    if _active_assessment_ids:
        raise RuntimeError("Active Director assessment evidence cannot be cleared while it is being written.")
    root = assessment_root()
    if not root.is_dir():
        return 0
    deleted = 0
    for path in root.glob("*.json"):
        path.unlink()
        deleted += 1
    return deleted
