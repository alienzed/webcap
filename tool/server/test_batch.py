"""Session-only, server-owned Test Generations batches.

Owns orchestration, not execution. Normal Test sessions and caption LLM jobs remain
owned by their existing queues and persistent Test session files.
"""
import copy
import logging
import re
import secrets
import threading
import time
import uuid

from .caption_vision import build_vision_question_messages, vision_media_data_url
from .epoch_test_bench import handle_request, open_session, resolve_result_media, update_vision
from .llm_runner import action as llm_action, enqueue as enqueue_llm, job_status
from .storyboard_llm_runtime import list_vision_models

_LOG = logging.getLogger(__name__)
_LOCK = threading.RLock()
_BATCHES = []
_TERMINAL = {"complete", "stopped", "failed", "interrupted", "missing"}
_LLM_TERMINAL = {"completed", "failed", "cancelled", "stopped", "interrupted"}


class _Stopped(Exception):
    pass


def _public(batch):
    visible = copy.deepcopy({k: v for k, v in batch.items()
                             if k not in {"cancelled", "folderPath"}})
    visible["statuses"] = {}
    for session in visible["sessions"]:
        try:
            status = open_session(batch["folderPath"], session)
            visible["statuses"][session] = {"status": status.get("status", "unknown")}
        except FileNotFoundError:
            visible["statuses"][session] = {"status": "missing"}
    return visible


def snapshot():
    with _LOCK:
        batches = list(_BATCHES)
    return {"batches": [_public(batch) for batch in batches]}


def _check(batch):
    with _LOCK:
        if batch["cancelled"]:
            raise _Stopped("Batch stopped.")


def _stage(batch, phase, detail=""):
    with _LOCK:
        batch["phase"] = phase
        batch["detail"] = detail


def _error(batch, detail):
    _LOG.error("TEST BATCH %s: %s", batch["id"], detail)
    with _LOCK:
        batch["errors"].append(str(detail))
        batch["detail"] = str(detail)


def _media_file(result):
    return str(result.get("mediaFile") or result.get("outputVideo") or "") if isinstance(result, dict) else ""


def _question(groups):
    if not groups:
        return "Describe this image using only visible evidence, including distinctive details."
    prefix = ('Inspect the image and choose the best visible option for EVERY numbered attribute below. '
              'Respond with exactly one line per group, e.g. G1: 2. Use only the option number, '
              'or "unclear" if you cannot see it, or "none" if no option fits. '
              'If "(absent)" is an option, select its number when that attribute is absent. '
              'Do not assume any option is present; use only visible evidence.\n\n')
    return prefix + "\n".join(
        str(g["id"]) + " (" + str(g.get("label") or "") + "): " +
        "; ".join(str(i + 1) + "=" + str(option or "(absent)")
                  for i, option in enumerate(g.get("options") or []))
        for g in groups
    )


def _compare(answer, groups):
    lines = str(answer or "").splitlines()
    rows = []
    for group in groups:
        options = group.get("options") or []
        group_id = str(group["id"])
        matches = [re.sub(r"^\s*" + re.escape(group_id) + r"\s*[:=-]\s*", "", line, flags=re.I).strip()
                   for line in lines if re.match(r"^\s*" + re.escape(group_id) + r"\s*[:=-]\s*", line, flags=re.I)]
        observed = matches[0] if len(matches) == 1 else ""
        selected = int(observed) if observed.isdecimal() and 0 < int(observed) <= len(options) else None
        expected = group.get("expected")
        expected_text = "unresolved" if expected is None else (options[expected - 1] or "(absent)")
        selected_text = (options[selected - 1] or "(absent)") if selected is not None else (observed or "unclear")
        result = ("unclear" if expected is None else
                  ("match" if selected == expected else "mismatch") if selected is not None else
                  "mismatch" if re.fullmatch(r"none(?: of these)?", observed, flags=re.I) else "unclear")
        rows.append({"id": group_id, "label": group.get("label"), "expected": expected,
                     "selected": selected, "expectedText": expected_text,
                     "selectedText": selected_text, "result": result})
    return rows


def _assess(batch, session, status, result):
    _check(batch)
    media = _media_file(result)
    groups = status.get("wildcardEvaluationGroups") or []
    question = _question(groups)
    _stage(batch, "Evaluating", session + " · " + media)
    source = resolve_result_media(batch["folderPath"], session, media)
    messages = build_vision_question_messages(question, vision_media_data_url(source))
    start = time.monotonic()
    job = enqueue_llm("caption", batch["vlModel"],
                      {"operation": "vision_question", "messages": messages},
                      context={}, label="Test Generations Batch Ask VL")
    job_id = str(job["jobId"])
    with _LOCK:
        batch["vlJobId"] = job_id
        stopped = batch["cancelled"]
    if stopped:
        llm_action("cancel_job", job_id)
        raise _Stopped()
    try:
        while True:
            _check(batch)
            current = job_status(job_id)
            state = str(current.get("status") or "")
            if state in _LLM_TERMINAL:
                if state != "completed":
                    raise RuntimeError(current.get("error") or "Ask VL job " + state)
                response = str((current.get("result") or {}).get("text") or "").strip() or "(empty response)"
                _check(batch)
                update_vision(batch["folderPath"], session, {
                    "mediaFile": media, "assessment": {
                        "text": response, "question": question,
                        "comparison": _compare(response, groups),
                        "modelId": batch["vlModel"],
                        "elapsedMs": int((time.monotonic() - start) * 1000),
                    },
                })
                with _LOCK:
                    batch["evaluated"] += 1
                return
            time.sleep(0.4)
    finally:
        with _LOCK:
            if batch["vlJobId"] == job_id:
                batch["vlJobId"] = ""


def _run(batch):
    folder = batch["folderPath"]
    criteria = batch["criteria"]
    used = set()
    with _LOCK:
        batch["status"] = "running"
        batch["startedAt"] = time.time()
    try:
        _stage(batch, "Queuing")
        for index in range(batch["count"]):
            _check(batch)
            seed = secrets.randbits(32)
            while seed in used:
                seed = secrets.randbits(32)
            used.add(seed)
            named = dict(criteria)
            settings = dict(criteria.get("settings") or {})
            settings["seed"] = str(seed)
            named["settings"] = settings
            name = str(criteria.get("name") or "Batch Test")[:110]
            named["name"] = name + ((" " + str(index + 1) + "/" + str(batch["count"])) if batch["count"] > 1 else "")
            try:
                response = handle_request(folder, "test_enqueue", named)
                session = str((response.get("job") or {}).get("id") or "")
                if not session:
                    raise RuntimeError("Test enqueue returned no session ID.")
                with _LOCK:
                    batch["sessions"].append(session)
            except Exception as exc:
                _error(batch, "Session " + str(index + 1) + " enqueue: " + str(exc))
                raise
        _stage(batch, "Generating + VL" if batch["autoVl"] else "Generating",
               "All Test sessions submitted.")
        assessed = set()
        while True:
            _check(batch)
            pending = []
            for session in list(batch["sessions"]):
                _check(batch)
                try:
                    status = open_session(folder, session)
                except FileNotFoundError:
                    status = {"status": "missing", "results": []}
                terminal = str(status.get("status") or "") in _TERMINAL
                if not terminal:
                    pending.append(session)
                    continue
                if session in assessed:
                    continue
                assessed.add(session)
                results = [r for r in status.get("results") or [] if _media_file(r)]
                with _LOCK:
                    batch["finished"] += 1
                    batch["previews"] += len(results)
                if status.get("status") in {"failed", "interrupted", "missing"} or status.get("failed") or status.get("failures"):
                    _error(batch, session + ": generation failed or incomplete.")
                if batch["autoVl"]:
                    for result in results:
                        try:
                            _assess(batch, session, status, result)
                        except _Stopped:
                            raise
                        except Exception as exc:
                            _error(batch, session + " · " + _media_file(result) + ": " + str(exc))
            if not pending:
                break
            _stage(batch, "Generating + VL" if batch["autoVl"] else "Generating",
                   str(batch["finished"]) + "/" + str(len(batch["sessions"])) + " sessions terminal")
            time.sleep(2)
        _stage(batch, "Complete", "Completed with errors." if batch["errors"] else "Sessions ready for review.")
        with _LOCK:
            batch["status"] = "complete"
    except _Stopped:
        _stage(batch, "Stopped", "Already accepted Test sessions continue.")
        with _LOCK:
            batch["status"] = "stopped"
    except Exception as exc:
        _LOG.exception("TEST BATCH FAILED: %s", batch["id"])
        _stage(batch, "Failed", str(exc))
        with _LOCK:
            batch["status"] = "failed"
            batch["errors"].append(str(exc))
    finally:
        with _LOCK:
            batch["finishedAt"] = time.time()
            batch["vlJobId"] = ""


def enqueue_batch(folder_path, folder, count, criteria, auto_vl, vl_model):
    if not isinstance(criteria, dict):
        raise ValueError("Batch Test criteria are required.")
    if not 1 <= count <= 20:
        raise ValueError("Batch count must be between 1 and 20.")
    if not criteria.get("modelId") or not criteria.get("prompt") or not criteria.get("selectedFiles"):
        raise ValueError("Batch requires model, prompt and selected candidates.")
    if auto_vl:
        available = {str(item.get("id") or "") for item in list_vision_models()}
        if not vl_model or vl_model not in available:
            raise ValueError("Select an available Vision model.")
    with _LOCK:
        if any(b["folder"] == folder and b["status"] in {"queued", "running", "stopping"} for b in _BATCHES):
            raise ValueError("This Set already has an active Test batch.")
        batch = {
            "id": uuid.uuid4().hex, "folder": folder, "folderPath": folder_path,
            "count": count, "criteria": copy.deepcopy(criteria),
            "autoVl": bool(auto_vl), "vlModel": vl_model if auto_vl else "",
            "sessions": [], "finished": 0, "previews": 0, "evaluated": 0,
            "errors": [], "status": "queued", "phase": "Queued", "detail": "",
            "queuedAt": time.time(), "startedAt": 0, "finishedAt": 0,
            "vlJobId": "", "cancelled": False,
        }
        _BATCHES.append(batch)
        # Retain a small in-memory history; server restart discards it.
        completed = [b for b in _BATCHES if b["status"] in {"complete", "stopped", "failed"}]
        retained = {b["id"] for b in completed[-12:]}
        _BATCHES[:] = [b for b in _BATCHES
                       if b["status"] not in {"complete", "stopped", "failed"} or b["id"] in retained]
    threading.Thread(target=_run, args=(batch,), name="webcap-test-batch", daemon=True).start()
    return _public(batch)


def cancel_batch(batch_id):
    with _LOCK:
        batch = next((b for b in _BATCHES if b["id"] == batch_id), None)
        if batch is None:
            raise FileNotFoundError("Test batch not found.")
        if batch["status"] in {"complete", "stopped", "failed"}:
            return _public(batch)
        batch["cancelled"] = True
        batch["status"] = "stopping"
        batch["phase"] = "Stopping"
        job_id = batch["vlJobId"]
    if job_id:
        llm_action("cancel_job", job_id)
    return _public(batch)


def register_routes(app, safe_join_fs_root):
    from flask import jsonify, request

    @app.route("/fs/test_generations/batches", methods=["GET", "POST"])
    def test_generations_batches_route():
        try:
            if request.method == "GET":
                return jsonify({"ok": True, **snapshot()})
            data = request.get_json(silent=True) or {}
            operation = str(data.get("operation") or "").strip()
            if operation == "enqueue":
                folder = str(data.get("folder") or "").strip()
                folder_path = safe_join_fs_root(folder)
                batch = enqueue_batch(folder_path, folder, int(data.get("count") or 0),
                                      data.get("criteria"), bool(data.get("autoVl")),
                                      str(data.get("vlModel") or ""))
            elif operation == "cancel":
                batch = cancel_batch(str(data.get("batchId") or ""))
            else:
                raise ValueError("Unsupported Test Batch operation.")
            return jsonify({"ok": True, "batch": batch, **snapshot()})
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404
        except Exception as exc:
            app.logger.exception("TEST BATCH ACTION FAILED: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 400
