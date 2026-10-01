import json
import os
import tempfile
from datetime import datetime, timezone

from . import config as app_config
from .permissions import normalize_path_permissions


PROFILE_VERSION = 1
FILENAME = "director-model-calibration.json"


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _path():
    return app_config.app_diagnostics_root() / FILENAME


def _empty_document():
    return {"version": PROFILE_VERSION, "profiles": {}}


def _read_document():
    path = _path()
    if not path.exists():
        return _empty_document()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("Could not read Director model calibration profiles: " + str(exc)) from exc
    if not isinstance(payload, dict) or payload.get("version") != PROFILE_VERSION:
        raise RuntimeError("Director model calibration profile file has an unsupported format.")
    profiles = payload.get("profiles")
    if not isinstance(profiles, dict):
        raise RuntimeError("Director model calibration profile file is missing its profiles object.")
    return payload


def _write_document(payload):
    path = _path()
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


def _positive_int(value, field):
    if isinstance(value, bool):
        raise ValueError(field + " must be a positive integer.")
    try:
        value = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(field + " must be a positive integer.") from exc
    if value <= 0:
        raise ValueError(field + " must be a positive integer.")
    return value


def _normalize_attempt(attempt):
    attempt = attempt if isinstance(attempt, dict) else {}
    kind = str(attempt.get("kind") or "").strip()
    if kind not in {"context", "output"}:
        raise ValueError("Director calibration attempt kind is invalid.")
    status = str(attempt.get("status") or "").strip()
    if status not in {"passed", "failed"}:
        raise ValueError("Director calibration attempt status is invalid.")
    normalized = {
        "kind": kind,
        "target": _positive_int(attempt.get("target"), "Director calibration attempt target"),
        "status": status,
        "finishReason": str(attempt.get("finishReason") or ""),
        "error": str(attempt.get("error") or ""),
    }
    for field in ("promptTokens", "completionTokens", "observedContextSize"):
        value = attempt.get(field)
        if value in (None, ""):
            normalized[field] = 0
            continue
        try:
            normalized[field] = max(0, int(value))
        except (TypeError, ValueError):
            normalized[field] = 0
    for field in ("totalSeconds", "tokensPerSecond"):
        value = attempt.get(field)
        try:
            normalized[field] = max(0.0, float(value)) if value not in (None, "") else 0.0
        except (TypeError, ValueError):
            normalized[field] = 0.0
    return normalized


def list_profiles():
    profiles = _read_document()["profiles"]
    return [json.loads(json.dumps(profiles[key])) for key in sorted(profiles)]


def get_profile(model_ref):
    model_ref = str(model_ref or "").strip()
    if not model_ref:
        return None
    profile = _read_document()["profiles"].get(model_ref)
    return json.loads(json.dumps(profile)) if isinstance(profile, dict) else None


def save_profile(profile):
    profile = profile if isinstance(profile, dict) else {}
    model_ref = str(profile.get("modelRef") or "").strip()
    runtime_id = str(profile.get("runtimeId") or "").strip()
    model_id = str(profile.get("modelId") or "").strip()
    if not model_ref or not runtime_id or not model_id:
        raise ValueError("Director calibration profile requires modelRef, runtimeId, and modelId.")

    max_tokens = _positive_int(profile.get("maxTokens"), "Director calibration maxTokens")
    context_mode = str(profile.get("contextMode") or "").strip()
    if context_mode not in {"calibrated", "runtime"}:
        raise ValueError("Director calibration contextMode must be calibrated or runtime.")

    context_size = profile.get("contextSize")
    if context_mode == "calibrated":
        context_size = _positive_int(context_size, "Director calibration contextSize")
    else:
        try:
            context_size = max(0, int(context_size or 0))
        except (TypeError, ValueError):
            context_size = 0

    attempts = profile.get("attempts")
    if not isinstance(attempts, list) or not attempts:
        raise ValueError("Director calibration profile requires calibration attempts.")

    normalized_attempts = [_normalize_attempt(item) for item in attempts]
    if not any(
        attempt["kind"] == "output"
        and attempt["status"] == "passed"
        and attempt["target"] == max_tokens
        for attempt in normalized_attempts
    ):
        raise ValueError("Director calibration maxTokens must match a passed output attempt.")
    if context_mode == "calibrated" and not any(
        attempt["kind"] == "context"
        and attempt["status"] == "passed"
        and attempt["target"] == context_size
        for attempt in normalized_attempts
    ):
        raise ValueError("Director calibration contextSize must match a passed context attempt.")

    normalized = {
        "version": PROFILE_VERSION,
        "modelRef": model_ref,
        "runtimeId": runtime_id,
        "runtimeName": str(profile.get("runtimeName") or "").strip(),
        "modelId": model_id,
        "label": str(profile.get("label") or model_id).strip(),
        "contextMode": context_mode,
        "contextSize": context_size,
        "maxTokens": max_tokens,
        "calibratedAt": _now_iso(),
        "attempts": normalized_attempts,
    }

    payload = _read_document()
    payload["profiles"][model_ref] = normalized
    _write_document(payload)
    return json.loads(json.dumps(normalized))


def clear_profiles():
    path = _path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    return []
