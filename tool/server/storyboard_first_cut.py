"""Server-owned First Cut batches.

Session-only orchestration. The existing LLM and inference lanes own execution;
this module only sequences Storyboard operations and records batch ownership.
"""
import copy
import logging
import threading
import time
import uuid

from .storyboard_llm_contract import build_request
from .storyboard_store import load_story
from .storyboard_generation import start_generation, generation_action, generation_queue
from .llm_runner import enqueue, job_status, action as llm_action, storyboard_story_busy

_LOG = logging.getLogger(__name__)
_LOCK = threading.RLock()
_BATCHES = []
_WORKER_RUNNING = False
_FINISHED = {"complete", "failed", "stopped"}
_LLM_FINISHED = {"completed", "failed", "cancelled", "stopped", "interrupted"}
_CONTINUITY_INSTRUCTION = (
    "Review this Scene against the Story overview, visual atmosphere, continuity "
    "invariants, and the preceding Scene. Repair meaningful continuity gaps, "
    "contradictions, missing generation-critical context, or prompt omissions "
    "while preserving the Scene's intended action, chronology, and narrative "
    "purpose. If it is already coherent and complete, leave it unchanged."
)


class _Stopped(Exception):
    pass


def _public(batch):
    return {key: copy.deepcopy(value) for key, value in batch.items()
            if key not in {"cancelled"}}


def snapshot():
    with _LOCK:
        return {"batches": [_public(batch) for batch in _BATCHES]}


def _check(batch):
    with _LOCK:
        if batch["cancelled"]:
            raise _Stopped("First Cut stopped.")


def _stage(batch, phase, detail=""):
    with _LOCK:
        batch["phase"] = phase
        batch["detail"] = detail


def _director(batch, operation, scene_id="", instruction="", replace=False):
    _check(batch)
    story = load_story(batch["storyId"])
    contract = build_request(story, scene_id, operation, instruction=instruction)
    context = {
        "storyId": batch["storyId"],
        "sceneId": scene_id,
        "operation": operation,
        "replaceExisting": bool(replace),
        "sourceInstruction": instruction,
    }
    job = enqueue(
        "storyboard", batch["modelId"], contract, context=context,
        label="Story: " + operation.replace("_", " "),
    )
    job_id = str(job["jobId"])
    with _LOCK:
        batch["llmJobId"] = job_id
        cancelled = batch["cancelled"]
    if cancelled:
        llm_action("cancel_job", job_id)
        raise _Stopped("First Cut stopped.")
    while True:
        _check(batch)
        try:
            current = job_status(job_id)
        except FileNotFoundError as exc:
            raise RuntimeError("First Cut Director job disappeared: " + job_id) from exc
        status = str(current.get("status") or "")
        if status in _LLM_FINISHED:
            with _LOCK:
                batch["llmJobId"] = ""
            if status != "completed":
                raise RuntimeError(current.get("error") or ("Director job " + status))
            return
        # Polling only reads the authoritative LLM lane. No timing-based failure gate.
        time.sleep(0.4)


def _execute(batch):
    story_id = batch["storyId"]
    _check(batch)
    story = load_story(story_id)
    if storyboard_story_busy(story_id):
        raise RuntimeError("Story already has Director work pending.")
    if generation_queue(story_id).get("jobs"):
        raise RuntimeError("Story has pending Take generation.")

    replace = bool(story.get("sceneOrder"))
    _stage(batch, "Expanding Concept")
    _director(batch, "expand_concept")
    _stage(batch, "Defining Continuity")
    _director(batch, "define_invariants")
    _stage(batch, "Developing Scenes")
    _director(batch, "develop_story", replace=replace)

    story = load_story(story_id)
    scene_ids = list(story.get("sceneOrder") or [])
    if not scene_ids:
        raise RuntimeError("First Cut developed no Scenes.")
    with _LOCK:
        batch["sceneCount"] = len(scene_ids)
    for index, scene_id in enumerate(scene_ids):
        _stage(batch, "Refining Scenes", str(index + 1) + " / " + str(len(scene_ids)))
        _director(batch, "refine_prompt", scene_id, _CONTINUITY_INSTRUCTION)

    for index, scene_id in enumerate(scene_ids):
        _check(batch)
        _stage(batch, "Queuing First Takes", str(index + 1) + " / " + str(len(scene_ids)))
        job = start_generation(story_id, scene_id)
        with _LOCK:
            batch["takeJobIds"].append(str(job["jobId"]))
            cancelled = batch["cancelled"]
        if cancelled:
            generation_action("stop", str(job["jobId"]))
            raise _Stopped("First Cut stopped.")


def _run():
    global _WORKER_RUNNING
    while True:
        with _LOCK:
            batch = next((b for b in _BATCHES if b["status"] == "queued"), None)
            if batch is None:
                _WORKER_RUNNING = False
                return
            batch["status"] = "running"
            batch["startedAt"] = time.time()
        try:
            _execute(batch)
            with _LOCK:
                if batch["cancelled"]:
                    batch["status"] = "stopped"
                else:
                    batch["status"] = "complete"
                    batch["phase"] = "Complete"
                    batch["detail"] = "First Takes queued."
        except _Stopped:
            with _LOCK:
                batch["status"] = "stopped"
                batch["phase"] = "Stopped"
                batch["detail"] = "Completed steps were kept."
        except Exception as exc:
            _LOG.exception("FIRST CUT FAILED: story=%s batch=%s", batch["storyId"], batch["id"])
            with _LOCK:
                batch["status"] = "stopped" if batch["cancelled"] else "failed"
                batch["phase"] = "Stopped" if batch["cancelled"] else "Failed"
                batch["detail"] = str(exc)
        finally:
            with _LOCK:
                batch["finishedAt"] = time.time()
                batch["llmJobId"] = ""


def enqueue_batch(story_id, model_id):
    global _WORKER_RUNNING
    if not story_id or not model_id:
        raise ValueError("A Story and Director model are required.")
    load_story(story_id)
    with _LOCK:
        if any(b["storyId"] == story_id and b["status"] in {"queued", "running"} for b in _BATCHES):
            raise ValueError("This Story already has a First Cut running or queued.")
        if storyboard_story_busy(story_id):
            raise ValueError("This Story has Director work in progress.")
        batch = {
            "id": uuid.uuid4().hex,
            "storyId": story_id,
            "modelId": model_id,
            "status": "queued",
            "phase": "Queued",
            "detail": "",
            "queuedAt": time.time(),
            "startedAt": 0,
            "finishedAt": 0,
            "sceneCount": 0,
            "llmJobId": "",
            "takeJobIds": [],
            "cancelled": False,
        }
        _BATCHES.append(batch)
        if not _WORKER_RUNNING:
            _WORKER_RUNNING = True
            threading.Thread(target=_run, name="webcap-first-cut", daemon=True).start()
        return _public(batch)


def cancel_batch(batch_id):
    with _LOCK:
        batch = next((b for b in _BATCHES if b["id"] == batch_id), None)
        if batch is None:
            raise FileNotFoundError("First Cut batch not found.")
        if batch["status"] in _FINISHED:
            return _public(batch)
        batch["cancelled"] = True
        active = batch["status"] == "running"
        batch["status"] = "stopping" if active else "stopped"
        batch["phase"] = "Stopping" if active else "Stopped"
        batch["detail"] = "Stopping owned work." if active else "Removed from queue."
        llm_id = batch["llmJobId"]
        takes = list(batch["takeJobIds"])
    if llm_id:
        llm_action("cancel_job", llm_id)
    for job_id in takes:
        try:
            generation_action("stop", job_id)
        except (ValueError, FileNotFoundError):
            # A Take that has already completed is deliberately retained.
            pass
    return _public(batch)


def register_routes(app):
    from flask import jsonify, request

    @app.route("/fs/storyboard/first-cut", methods=["GET", "POST"])
    def storyboard_first_cut_route():
        try:
            if request.method == "GET":
                return jsonify({"ok": True, **snapshot()})
            data = request.get_json(silent=True) or {}
            operation = str(data.get("operation") or "").strip()
            if operation == "enqueue":
                batch = enqueue_batch(
                    str(data.get("storyId") or "").strip(),
                    str(data.get("modelId") or "").strip(),
                )
            elif operation == "cancel":
                batch = cancel_batch(str(data.get("batchId") or "").strip())
            else:
                raise ValueError("Unsupported First Cut operation.")
            return jsonify({"ok": True, "batch": batch, **snapshot()})
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404
        except Exception as exc:
            app.logger.exception("FIRST CUT ACTION FAILED: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 400
