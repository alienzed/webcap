import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from flask import jsonify, request

from . import config as app_config


SESSION_VERSION = 1
DEFAULT_PROMPT = "Expand the source concept below into a polished, production-ready cinematic generation prompt suitable for a high-quality text-to-video model.\n\nDevelop the scene with useful visual specificity. Enrich the environment, composition, camera perspective and movement, lighting, weather, physical motion, textures, body language, spatial relationships, atmosphere, and small observable details that would help the generation model create a coherent and convincing scene.\n\nUse your judgment about which details are worth developing. Preserve the identity, setting, mood, and essential situation of the source concept while making it substantially richer and more visually complete.\n\nKeep the scene internally consistent from beginning to end. Details such as the subject's appearance and clothing, location, weather, lighting, time of day, and overall atmosphere should remain coherent throughout the prompt.\n\nWrite the result as one directly usable generation prompt rather than commentary, analysis, an outline, or an explanation of your choices.\n\nAim for approximately 350–500 words.\n\nSource concept:\n\nA woman in her early thirties stands alone at a nearly empty roadside bus stop late at night. She wears a dark green wool coat over office clothes and carries a small black shoulder bag. It has been raining for some time. The pavement is wet and reflective, but the rain is now light. She looks tired and slightly cold, occasionally checking the empty road for the bus. A glass shelter beside her is lit by a single cool fluorescent tube. Across the road are closed storefronts with their signs turned off. The mood is quiet, lonely, and realistic rather than frightening. Nothing dramatic happens; she simply waits."
PROTOCOL = {
    "id": "expansion-v1",
    "title": "Prompt expansion",
    "description": "Expand one cinematic concept into a production-ready generation prompt.",
    "defaultPrompt": DEFAULT_PROMPT,
    "messages": [
        {
            "role": "user",
            "content": DEFAULT_PROMPT,
        }
    ],
}

def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _store_dir():
    path = app_config.director_model_test_root()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _session_path(session_id):
    session_id = str(session_id or "").strip()
    if not session_id or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for ch in session_id):
        raise ValueError("Invalid Director model test session ID.")
    return _store_dir() / (session_id + ".json")


def _read_session(session_id):
    path = _session_path(session_id)
    if not path.is_file():
        raise FileNotFoundError("Director model test session does not exist: " + str(session_id))
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise RuntimeError("Director model test session is invalid.")
    return payload


def _write_session(session):
    if not isinstance(session, dict):
        raise ValueError("Director model test session must be an object.")
    path = _session_path(session.get("id"))
    temporary = path.with_name("." + path.name + "." + secrets.token_hex(4) + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(session, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        try:
            if temporary.exists():
                temporary.unlink()
        except OSError:
            pass
    return session


def _model_snapshot(model):
    model = model if isinstance(model, dict) else {}
    model_ref = str(model.get("modelRef") or model.get("id") or "").strip()
    if not model_ref:
        raise ValueError("Director model test model reference is required.")
    try:
        size_bytes = max(0, int(model.get("sizeBytes") or 0))
    except (TypeError, ValueError):
        size_bytes = 0
    return {
        "modelRef": model_ref,
        "runtimeId": str(model.get("runtimeId") or "").strip(),
        "runtimeName": str(model.get("runtimeName") or "").strip(),
        "modelId": str(model.get("modelId") or "").strip(),
        "label": str(model.get("label") or model.get("modelId") or model_ref).strip(),
        "sizeBytes": size_bytes,
    }


def start_session(models, prompt=None):
    if not isinstance(models, list) or not models:
        raise ValueError("Choose at least one Director model to test.")
    prompt = str(prompt if prompt is not None else DEFAULT_PROMPT).strip()
    if not prompt:
        raise ValueError("Director model test prompt is required.")
    frozen_models = [_model_snapshot(model) for model in models]
    model_refs = [model["modelRef"] for model in frozen_models]
    if len(set(model_refs)) != len(model_refs):
        raise ValueError("Director model test model references must be unique.")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    session = {
        "version": SESSION_VERSION,
        "id": stamp + "-" + secrets.token_hex(3),
        "protocol": {
            **json.loads(json.dumps(PROTOCOL)),
            "prompt": prompt,
            "messages": [{"role": "user", "content": prompt}],
        },
        "status": "running",
        "startedAt": _now_iso(),
        "finishedAt": "",
        "models": frozen_models,
        "runs": [],
    }
    return _write_session(session)


def save_run(session_id, run):
    session = _read_session(session_id)
    if session.get("status") not in {"running", "stopped"}:
        raise ValueError("Director model test session is already finished.")
    run = run if isinstance(run, dict) else {}
    model_ref = str(run.get("modelRef") or "").strip()
    frozen = next((model for model in session.get("models", []) if model.get("modelRef") == model_ref), None)
    if frozen is None:
        raise ValueError("Director model test run does not belong to this session.")

    status = str(run.get("status") or "").strip()
    if status not in {"completed", "failed", "stopped"}:
        raise ValueError("Director model test run status is invalid.")

    numeric_fields = (
        "queueSeconds",
        "runtimeSeconds",
        "preparingSeconds",
        "loadingSeconds",
        "generatingSeconds",
        "totalSeconds",
        "promptTokens",
        "completionTokens",
        "totalTokens",
        "tokensPerSecond",
        "outputWords",
        "outputChars",
    )
    normalized = {
        **frozen,
        "status": status,
        "startedAt": str(run.get("startedAt") or ""),
        "finishedAt": str(run.get("finishedAt") or ""),
        "usage": run.get("usage") if isinstance(run.get("usage"), dict) else {},
        "backendTimings": run.get("backendTimings") if isinstance(run.get("backendTimings"), dict) else {},
        "text": str(run.get("text") or ""),
        "error": str(run.get("error") or ""),
    }
    for field in numeric_fields:
        value = run.get(field)
        try:
            normalized[field] = max(0.0, float(value)) if value not in (None, "") else 0
        except (TypeError, ValueError):
            normalized[field] = 0

    existing_index = next(
        (index for index, item in enumerate(session.get("runs", [])) if item.get("modelRef") == model_ref),
        None,
    )
    if existing_index is None:
        session.setdefault("runs", []).append(normalized)
    else:
        session["runs"][existing_index] = normalized
    return _write_session(session)


def finish_session(session_id, status="completed"):
    session = _read_session(session_id)
    status = str(status or "").strip()
    if status not in {"completed", "stopped", "failed"}:
        raise ValueError("Director model test session status is invalid.")
    session["status"] = status
    session["finishedAt"] = _now_iso()
    return _write_session(session)


def list_sessions():
    sessions = []
    for path in _store_dir().glob("*.json"):
        try:
            with path.open("r", encoding="utf-8") as handle:
                session = json.load(handle)
        except (OSError, ValueError, TypeError):
            continue
        if not isinstance(session, dict):
            continue
        runs = session.get("runs") if isinstance(session.get("runs"), list) else []
        sessions.append({
            "id": str(session.get("id") or path.stem),
            "protocolId": str((session.get("protocol") or {}).get("id") or ""),
            "status": str(session.get("status") or ""),
            "startedAt": str(session.get("startedAt") or ""),
            "finishedAt": str(session.get("finishedAt") or ""),
            "modelCount": len(session.get("models") or []),
            "runCount": len(runs),
            "completedCount": sum(1 for run in runs if run.get("status") == "completed"),
            "failedCount": sum(1 for run in runs if run.get("status") == "failed"),
        })
    sessions.sort(key=lambda item: item.get("startedAt") or "", reverse=True)
    return sessions


def delete_session(session_id):
    path = _session_path(session_id)
    if not path.is_file():
        raise FileNotFoundError("Director model test session does not exist: " + str(session_id))
    path.unlink()
    return str(session_id)


def enqueue_protocol_run(session_id, model_ref):
    from .llm_runner import enqueue

    session = _read_session(session_id)
    model_ref = str(model_ref or "").strip()
    if not model_ref:
        raise ValueError("Choose a Director model to test.")
    if not any(model.get("modelRef") == model_ref for model in session.get("models", [])):
        raise ValueError("Director model test model does not belong to this session.")

    protocol = session.get("protocol") if isinstance(session.get("protocol"), dict) else {}
    messages = protocol.get("messages") if isinstance(protocol.get("messages"), list) else None
    if not messages:
        raise RuntimeError("Director model test session is missing its frozen prompt.")

    return enqueue(
        "chat",
        model_ref,
        {
            "operation": "freeform_chat",
            "messages": json.loads(json.dumps(messages)),
        },
        context={},
        label="Director Model Test",
    )


def register_routes(app):
    @app.route("/app/director-model-test", methods=["GET", "POST", "DELETE"])
    def director_model_test_route():
        try:
            if request.method == "GET":
                session_id = str(request.args.get("id") or "").strip()
                if session_id:
                    return jsonify({"ok": True, "session": _read_session(session_id)})
                return jsonify({
                    "ok": True,
                    "protocol": PROTOCOL,
                    "sessions": list_sessions(),
                })

            if request.method == "DELETE":
                session_id = str(request.args.get("id") or "").strip()
                return jsonify({"ok": True, "sessionId": delete_session(session_id)})

            data = request.get_json(silent=True) or {}
            action = str(data.get("action") or "").strip()
            if action == "start":
                return jsonify({"ok": True, "session": start_session(data.get("models"), data.get("prompt"))}), 201
            if action == "enqueue":
                return jsonify({
                    "ok": True,
                    "job": enqueue_protocol_run(data.get("sessionId"), data.get("modelRef")),
                }), 202
            if action == "save_run":
                return jsonify({
                    "ok": True,
                    "session": save_run(data.get("sessionId"), data.get("run")),
                })
            if action == "finish":
                return jsonify({
                    "ok": True,
                    "session": finish_session(data.get("sessionId"), data.get("status") or "completed"),
                })
            raise ValueError("Unsupported Director model test action.")
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404
        except Exception as exc:
            app.logger.exception("DIRECTOR MODEL TEST FAILED: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 400
