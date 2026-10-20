"""Read/delete historical Director assessment cache for Storage Manager only.

The old assessment executor is retired. Never create or resume these runs.
Model Assessment owns all new probing and its separate journals.
"""
import json

from . import config as app_config


ROOT_NAME = "director-model-assessments"
ASSESSMENT_VERSION = 1


def assessment_root():
    return app_config.app_cache_root() / ROOT_NAME


def _assessment_path(assessment_id):
    value = str(assessment_id or "").strip()
    if not value or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in value):
        raise ValueError("Director assessment ID is invalid.")
    return assessment_root() / (value + ".json")


def get_assessment(assessment_id):
    path = _assessment_path(assessment_id)
    if not path.is_file():
        raise FileNotFoundError("Director assessment does not exist: " + str(assessment_id))
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError("Could not read Director assessment: " + str(exc)) from exc
    if not isinstance(record, dict) or record.get("version") != ASSESSMENT_VERSION:
        raise RuntimeError("Director assessment has an unsupported format.")
    if record.get("status") == "running":
        record["status"] = "incomplete"  # Retired executor cannot remain active.
    return record


def list_assessments():
    root = assessment_root()
    if not root.is_dir():
        return []
    rows = []
    for path in root.glob("*.json"):
        record = get_assessment(path.stem)
        model = record.get("model") if isinstance(record.get("model"), dict) else {}
        attempts = record.get("attempts") if isinstance(record.get("attempts"), list) else []
        rows.append({
            "id": str(record.get("id") or path.stem),
            "status": str(record.get("status") or ""),
            "startedAt": str(record.get("startedAt") or ""),
            "finishedAt": str(record.get("finishedAt") or ""),
            "model": model,
            "summary": record.get("summary") or {},
            "error": str(record.get("error") or ""),
            "attemptCount": len(attempts),
            "active": False,
            "bytes": path.stat().st_size,
        })
    rows.sort(key=lambda item: item.get("startedAt") or "", reverse=True)
    return rows


def delete_assessment(assessment_id):
    path = _assessment_path(assessment_id)
    if not path.is_file():
        raise FileNotFoundError("Director assessment does not exist: " + str(assessment_id))
    path.unlink()
    return True
