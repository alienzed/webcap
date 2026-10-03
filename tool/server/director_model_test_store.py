import json
import secrets
from datetime import datetime, timezone

from flask import jsonify, request

from .director_model_calibration import begin_calibration, clear_calibration, list_profiles, list_reports, save_profile, save_report
from .director_model_capabilities import capability_for_model, list_capability_hints
from .director_model_assessment_store import (
    delete_assessment,
    get_assessment,
    list_assessments,
    start_assessment,
    update_assessment,
)


SESSION_VERSION = 1
CONTEXT_STEPS = (4096, 8192, 16384, 32768, 65536, 98304, 131072, 163840)
OUTPUT_STEPS = (512, 1024, 2048, 4096, 8192, 12288, 16384, 24576, 32768)
OUTPUT_ITEM_COUNTS = {
    512: 12,
    1024: 30,
    2048: 90,
    4096: 180,
    8192: 360,
    12288: 540,
    16384: 720,
    24576: 1080,
    32768: 1440,
}
PROSE_SECTION_COUNTS = {
    512: 2,
    1024: 5,
    2048: 10,
    4096: 20,
    8192: 40,
    12288: 60,
    16384: 80,
    24576: 120,
    32768: 160,
}
CALIBRATION_MARKER = "WEB_CAP_CALIBRATION_COMPLETE"
PROSE_MARKER = "WEB_CAP_LONGFORM_COMPLETE"
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

_session = None


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _copy(value):
    return json.loads(json.dumps(value))


def _read_session(session_id):
    session_id = str(session_id or "").strip()
    if not isinstance(_session, dict) or str(_session.get("id") or "") != session_id:
        raise FileNotFoundError("Director model test session does not exist: " + session_id)
    return _copy(_session)


def _write_session(session):
    global _session
    if not isinstance(session, dict):
        raise ValueError("Director model test session must be an object.")
    _session = _copy(session)
    return _copy(_session)


def current_session():
    return _copy(_session) if isinstance(_session, dict) else None


def clear_session():
    global _session
    _session = None


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
        "contextSize",
    )
    normalized = {
        **frozen,
        "status": status,
        "startedAt": str(run.get("startedAt") or ""),
        "finishedAt": str(run.get("finishedAt") or ""),
        "usage": run.get("usage") if isinstance(run.get("usage"), dict) else {},
        "backendTimings": run.get("backendTimings") if isinstance(run.get("backendTimings"), dict) else {},
        "finishReason": str(run.get("finishReason") or ""),
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


def _calibration_output_prompt(target):
    target = int(target)
    item_count = OUTPUT_ITEM_COUNTS[target]
    return (
        "This is a deterministic output-capacity calibration. "
        "Write exactly " + str(item_count) + " numbered items, starting at 1 and ending at "
        + str(item_count) + ". Each item must be one concrete cinematic sentence of 12-18 words. "
        "Do not summarize, skip numbers, stop early, or add a preamble. "
        "After item " + str(item_count) + ", write this exact marker on its own line: "
        + CALIBRATION_MARKER + "."
    )


def _calibration_prose_prompt(target):
    target = int(target)
    section_count = PROSE_SECTION_COUNTS[target]
    return (
        "This is a long-form coherence and completion stress test. "
        "Write one continuous realistic suspense story divided into exactly "
        + str(section_count) + " consecutively numbered sections labelled 'Section 1:' through 'Section "
        + str(section_count) + ":'. Each section must contain 100-140 words of actual story prose, "
        "continue causally from the previous section, preserve character identities, locations, objects, "
        "injuries, time progression, and established facts, and materially advance the plot. "
        "Vary sentence structure and avoid recaps, filler, repeated paragraphs, outlines, commentary, or meta discussion. "
        "The story begins with a night-shift maintenance worker discovering that an elevator in an occupied office tower "
        "keeps stopping at a floor that does not appear on the building directory. Keep the events grounded and internally coherent. "
        "After Section " + str(section_count) + ", write this exact marker on its own line: "
        + PROSE_MARKER + "."
    )


def calibration_protocol():
    return {
        "contextSteps": list(CONTEXT_STEPS),
        "outputSteps": list(OUTPUT_STEPS),
        "outputItemCounts": {str(key): value for key, value in OUTPUT_ITEM_COUNTS.items()},
        "proseSectionCounts": {str(key): value for key, value in PROSE_SECTION_COUNTS.items()},
        "marker": CALIBRATION_MARKER,
        "proseMarker": PROSE_MARKER,
        "description": (
            "Calibration starts with small probes so limited models can establish useful capability before stress testing. "
            "Local llama.cpp context is tested progressively until a tier fails or the test range is exhausted. "
            "Each output tier must pass both a mechanical completion test and a coherent long-form prose test."
        ),
    }


def enqueue_calibration_run(model_ref, kind, target, context_size=None):
    from .llm_runner import enqueue
    from .storyboard_llm_runtime import list_models

    model_ref = str(model_ref or "").strip()
    kind = str(kind or "").strip()
    try:
        target = int(target)
    except (TypeError, ValueError) as exc:
        raise ValueError("Director calibration target must be an integer.") from exc

    models = list_models(reload=False)
    model = next((item for item in models if str(item.get("id") or "") == model_ref), None)
    if model is None:
        raise FileNotFoundError("Director calibration model is not available: " + model_ref)

    if kind == "context":
        if str(model.get("runtimeId") or "") != "local":
            raise ValueError("Context calibration is available only for the local llama.cpp runtime.")
        if target not in CONTEXT_STEPS:
            raise ValueError("Unsupported Director context calibration target.")
        messages = [{"role": "user", "content": "Reply with exactly: CONTEXT_OK"}]
        overrides = {"contextSize": target, "maxTokens": 64}
        label = "Director Context Calibration"
    elif kind in {"output", "prose"}:
        if target not in OUTPUT_STEPS:
            raise ValueError("Unsupported Director output calibration target.")
        messages = [{
            "role": "user",
            "content": _calibration_output_prompt(target) if kind == "output" else _calibration_prose_prompt(target),
        }]
        overrides = {"maxTokens": target}
        if str(model.get("runtimeId") or "") == "local" and context_size not in (None, ""):
            try:
                context_size = int(context_size)
            except (TypeError, ValueError) as exc:
                raise ValueError("Director output calibration contextSize must be an integer.") from exc
            if context_size not in CONTEXT_STEPS:
                raise ValueError("Director output calibration contextSize must be a proven context tier.")
            overrides["contextSize"] = context_size
        label = "Director Output Calibration" if kind == "output" else "Director Long-form Calibration"
    else:
        raise ValueError("Director calibration kind must be context, output, or prose.")

    return enqueue(
        "chat",
        model_ref,
        {
            "operation": "freeform_chat",
            "messages": messages,
        },
        context={"runtimeOverrides": overrides},
        label=label,
    )


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
                return jsonify({
                    "ok": True,
                    "protocol": PROTOCOL,
                    "calibrationProtocol": calibration_protocol(),
                    "calibrationProfiles": list_profiles(),
                    "calibrationReports": list_reports(),
                    "advertisedCapabilities": list_capability_hints(),
                    "assessmentRuns": list_assessments(),
                    "session": current_session(),
                })

            if request.method == "DELETE":
                clear_session()
                return jsonify({"ok": True})

            data = request.get_json(silent=True) or {}
            action = str(data.get("action") or "").strip()
            if action == "start":
                return jsonify({"ok": True, "session": start_session(data.get("models"), data.get("prompt"))}), 201
            if action == "enqueue":
                return jsonify({
                    "ok": True,
                    "job": enqueue_protocol_run(data.get("sessionId"), data.get("modelRef")),
                }), 202
            if action == "start_assessment":
                model = data.get("model") if isinstance(data.get("model"), dict) else {}
                advertised = capability_for_model(
                    model.get("modelRef") or model.get("id"),
                    model.get("modelId"),
                    model.get("label"),
                )
                return jsonify({
                    "ok": True,
                    "assessment": start_assessment(model, advertised=advertised),
                    "assessmentRuns": list_assessments(),
                }), 201
            if action == "update_assessment":
                return jsonify({
                    "ok": True,
                    "assessment": update_assessment(
                        data.get("assessmentId"),
                        data.get("attempts"),
                        data.get("summary"),
                        final=bool(data.get("final")),
                        status=data.get("status"),
                        error=data.get("error"),
                    ),
                    "assessmentRuns": list_assessments(),
                })
            if action == "get_assessment":
                return jsonify({
                    "ok": True,
                    "assessment": get_assessment(data.get("assessmentId")),
                })
            if action == "delete_assessment":
                delete_assessment(data.get("assessmentId"))
                return jsonify({
                    "ok": True,
                    "assessmentRuns": list_assessments(),
                })
            if action == "begin_calibration":
                begun = begin_calibration(data.get("modelRef"))
                return jsonify({
                    "ok": True,
                    "calibrationProfiles": begun["profiles"],
                    "calibrationReports": begun["reports"],
                })
            if action == "enqueue_calibration":
                return jsonify({
                    "ok": True,
                    "job": enqueue_calibration_run(data.get("modelRef"), data.get("kind"), data.get("target"), data.get("contextSize")),
                }), 202
            if action == "save_calibration_report":
                return jsonify({
                    "ok": True,
                    "report": save_report(data.get("report")),
                    "calibrationReports": list_reports(),
                })
            if action == "save_calibration_profile":
                return jsonify({
                    "ok": True,
                    "profile": save_profile(data.get("profile")),
                    "calibrationProfiles": list_profiles(),
                    "calibrationReports": list_reports(),
                })
            if action == "clear_calibration_profiles":
                cleared = clear_calibration()
                return jsonify({
                    "ok": True,
                    "calibrationProfiles": cleared["profiles"],
                    "calibrationReports": cleared["reports"],
                })
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
            if action == "clear":
                clear_session()
                return jsonify({"ok": True, "session": None})
            raise ValueError("Unsupported Director model test action.")
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404
        except Exception as exc:
            app.logger.exception("DIRECTOR MODEL TEST FAILED: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 400
