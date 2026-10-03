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
    return {"version": PROFILE_VERSION, "profiles": {}, "reports": {}}


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
    reports = payload.get("reports")
    if reports is None:
        payload["reports"] = {}
    elif not isinstance(reports, dict):
        raise RuntimeError("Director model calibration profile file has an invalid reports object.")
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
    if kind not in {"context", "output", "prose"}:
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
        "failureKind": str(attempt.get("failureKind") or "").strip(),
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



def _report_abilities(attempts, context_mode, context_size, max_tokens):
    passed = [attempt for attempt in attempts if attempt["status"] == "passed"]
    structured_output = max(
        [attempt["target"] for attempt in passed if attempt["kind"] == "output"],
        default=0,
    )
    coherent_output = max(
        [attempt["target"] for attempt in passed if attempt["kind"] == "prose"],
        default=0,
    )
    proven_context = context_size if context_mode == "calibrated" else max(
        [attempt.get("observedContextSize", 0) for attempt in passed],
        default=0,
    )
    return {
        "responds": bool(passed),
        "contextTokens": max(0, int(proven_context or 0)),
        "structuredOutputTokens": max(0, int(structured_output or 0)),
        "coherentOutputTokens": max(0, int(coherent_output or max_tokens or 0)),
    }


MODEL_PATHOLOGY_FAILURE_KINDS = {"empty", "looping", "leakage", "garbled"}


def _report_pathologies(attempts):
    return sorted({
        str(attempt.get("failureKind") or "").strip()
        for attempt in attempts
        if attempt.get("status") == "failed"
        and str(attempt.get("failureKind") or "").strip() in MODEL_PATHOLOGY_FAILURE_KINDS
    })


def _report_health(attempts, context_mode, context_size, max_tokens, status):
    if status == "stopped":
        return "stopped"

    failed = [attempt for attempt in attempts if attempt["status"] == "failed"]
    pathologies = _report_pathologies(attempts)

    # Only evidence about emitted model output becomes a model-health warning.
    # Runtime/transport failures, probe-contract misses, and exhausted request
    # budgets are assessment outcomes, not model pathologies.
    if pathologies:
        return "warning" if max_tokens > 0 else "likely-unusable"

    if max_tokens > 0:
        if any(attempt.get("failureKind") == "capacity" for attempt in failed):
            return "limited"
        if failed:
            return "assessment-incomplete"
        return "healthy"

    if failed:
        return "assessment-failed"
    if attempts:
        return "assessment-incomplete"
    return "unknown"


def _report_with_derived_fields(report):
    if not isinstance(report, dict):
        return None

    value = json.loads(json.dumps(report))
    attempts = value.get("attempts")
    attempts = [_normalize_attempt(item) for item in attempts] if isinstance(attempts, list) else []
    value["attempts"] = attempts

    context_mode = str(value.get("contextMode") or "").strip()
    try:
        context_size = max(0, int(value.get("contextSize") or 0))
    except (TypeError, ValueError):
        context_size = 0
    try:
        max_tokens = max(0, int(value.get("maxTokens") or 0))
    except (TypeError, ValueError):
        max_tokens = 0
    status = str(value.get("status") or "incomplete").strip()

    value["health"] = _report_health(attempts, context_mode, context_size, max_tokens, status)
    value["pathologies"] = _report_pathologies(attempts)
    value["abilities"] = _report_abilities(attempts, context_mode, context_size, max_tokens)
    return value


def list_reports():
    reports = _read_document()["reports"]
    return [
        _report_with_derived_fields(reports[key])
        for key in sorted(reports)
        if isinstance(reports.get(key), dict)
    ]


def get_report(model_ref):
    model_ref = str(model_ref or "").strip()
    if not model_ref:
        return None
    return _report_with_derived_fields(_read_document()["reports"].get(model_ref))


def save_report(report):
    report = report if isinstance(report, dict) else {}
    model_ref = str(report.get("modelRef") or "").strip()
    runtime_id = str(report.get("runtimeId") or "").strip()
    model_id = str(report.get("modelId") or "").strip()
    if not model_ref or not runtime_id or not model_id:
        raise ValueError("Director calibration report requires modelRef, runtimeId, and modelId.")

    context_mode = str(report.get("contextMode") or "").strip()
    if context_mode not in {"calibrated", "runtime"}:
        raise ValueError("Director calibration report contextMode must be calibrated or runtime.")

    attempts = report.get("attempts")
    if not isinstance(attempts, list):
        raise ValueError("Director calibration report attempts must be a list.")
    normalized_attempts = [_normalize_attempt(item) for item in attempts]

    try:
        context_size = max(0, int(report.get("contextSize") or 0))
    except (TypeError, ValueError):
        context_size = 0
    try:
        max_tokens = max(0, int(report.get("maxTokens") or 0))
    except (TypeError, ValueError):
        max_tokens = 0

    status = str(report.get("status") or "incomplete").strip()
    if status not in {"complete", "incomplete", "error", "stopped"}:
        raise ValueError("Director calibration report status is invalid.")

    normalized = {
        "version": PROFILE_VERSION,
        "modelRef": model_ref,
        "runtimeId": runtime_id,
        "runtimeName": str(report.get("runtimeName") or "").strip(),
        "modelId": model_id,
        "label": str(report.get("label") or model_id).strip(),
        "contextMode": context_mode,
        "contextSize": context_size,
        "maxTokens": max_tokens,
        "status": status,
        "error": str(report.get("error") or ""),
        "health": _report_health(normalized_attempts, context_mode, context_size, max_tokens, status),
        "pathologies": _report_pathologies(normalized_attempts),
        "abilities": _report_abilities(normalized_attempts, context_mode, context_size, max_tokens),
        "updatedAt": _now_iso(),
        "attempts": normalized_attempts,
    }

    payload = _read_document()
    payload["reports"][model_ref] = normalized
    _write_document(payload)
    return json.loads(json.dumps(normalized))



def begin_calibration(model_ref):
    model_ref = str(model_ref or "").strip()
    if not model_ref:
        raise ValueError("Director calibration modelRef is required.")
    payload = _read_document()
    payload["profiles"].pop(model_ref, None)
    payload["reports"].pop(model_ref, None)
    if payload["profiles"] or payload["reports"]:
        _write_document(payload)
    else:
        path = _path()
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return {
        "profiles": list_profiles(),
        "reports": list_reports(),
    }

def clear_calibration():
    path = _path()
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    return {"profiles": [], "reports": []}

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
    if not any(
        attempt["kind"] == "prose"
        and attempt["status"] == "passed"
        and attempt["target"] == max_tokens
        for attempt in normalized_attempts
    ):
        raise ValueError("Director calibration maxTokens must also match a passed long-form prose attempt.")
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
    payload = _read_document()
    payload["profiles"] = {}
    if payload.get("reports"):
        _write_document(payload)
    else:
        path = _path()
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    return []
