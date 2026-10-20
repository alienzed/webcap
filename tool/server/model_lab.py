import json
import os
import secrets
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions


RUN_VERSION = 1
ASSESSMENT_PROTOCOL = "webcap-model-assessment-structured-v1"
# Existing identical production probes can be reused; legacy prose never qualifies as JSON evidence.
LEGACY_COMPATIBLE_KINDS = {"director_thinking", "language_synthesis", "language_challenge", "vision_open", "vision_group_aware"}
ROOT_NAME = "model-lab-runs"
DEFAULT_SAMPLE_COUNT = 8
MAX_SAMPLE_COUNT = 24
DEFAULT_ACTIVE_TIMEOUT_SECONDS = 60 * 60
FAILURE_CIRCUIT_BREAKER = 3
POLL_SECONDS = 0.75
_TERMINAL_JOB_STATES = {"completed", "failed", "cancelled", "stopped", "interrupted"}

_lock = threading.RLock()
_active = {}


class ModelLabStopped(RuntimeError):
    pass


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _copy(value):
    return json.loads(json.dumps(value))


def run_root():
    return app_config.app_cache_root() / ROOT_NAME


def _run_path(run_id):
    run_id = str(run_id or "").strip()
    if not run_id or any(ch not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for ch in run_id):
        raise ValueError("Model Lab run ID is invalid.")
    return run_root() / (run_id + ".json")


def _write(path, payload):
    # Windows readers do not share delete access: keep a status read from
    # holding the destination open during atomic replacement.
    with _lock:
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
                json.dump(payload, handle, indent=2, ensure_ascii=False)
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


def _read_raw(run_id):
    with _lock:
        path = _run_path(run_id)
        if not path.is_file():
            raise FileNotFoundError("Model Lab run does not exist: " + str(run_id))
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError("Could not read Model Lab run: " + str(exc)) from exc
        if not isinstance(payload, dict) or payload.get("version") != RUN_VERSION:
            raise RuntimeError("Model Lab run has an unsupported format.")
        return payload


def _active_record(run_id):
    with _lock:
        return _active.get(str(run_id or ""))


def _reconcile_interrupted(payload):
    run_id = str(payload.get("id") or "")
    changed_reviews = False
    for review in (payload.get("qualityReviews") or {}).values():
        if isinstance(review, dict) and review.get("status") == "running" and not _active_record("quality:" + run_id):
            review["status"] = "interrupted"
            review["finishedAt"] = review.get("finishedAt") or _now_iso()
            review["error"] = "Quality review interrupted by restart; run it again explicitly."
            changed_reviews = True
    if changed_reviews:
        _write_run(payload)
    if payload.get("status") != "running" or _active_record(run_id):
        return payload

    changed = False
    for attempt in payload.get("attempts") if isinstance(payload.get("attempts"), list) else []:
        if isinstance(attempt, dict) and attempt.get("status") == "running":
            attempt["status"] = "interrupted"
            attempt["finishedAt"] = _now_iso()
            attempt["error"] = attempt.get("error") or "Probe interrupted before completion."
            changed = True

    payload["status"] = "interrupted"
    payload["finishedAt"] = payload.get("finishedAt") or _now_iso()
    payload["error"] = payload.get("error") or (
        "Run was interrupted before finalization. Resume explicitly to continue unfinished probes."
    )
    changed = True
    if changed:
        _write_run(payload)
    return payload


def get_run(run_id):
    with _lock:
        return _copy(_reconcile_interrupted(_read_raw(run_id)))


def capability_run_summaries():
    """Compact per-probe outcomes for Diagnostics; never expose raw model output."""
    summaries = []
    for row in list_runs():
        if not row.get("id") or row.get("status") == "error":
            summaries.append({
                "id": row.get("id"), "status": row.get("status"),
                "startedAt": row.get("startedAt"), "error": row.get("error"),
                "models": {},
            })
            continue
        run = get_run(row["id"])
        models = {}
        attempts = list(run.get("attempts") or [])
        for source in (run.get("reused") or {}).values():
            previous = get_run(source["runId"])
            attempts.extend(a for a in previous.get("attempts") or [] if a.get("id") == source["attemptId"])
        # Keep one effective outcome per exact probe identity. A recovered failure
        # is not an enduring failure, and historical retries are not extra coverage.
        by_probe = {}
        for attempt in attempts:
            key = _attempt_key(attempt.get("kind"), attempt.get("modelRef"), attempt.get("file"))
            prior = by_probe.get(key)
            if prior is None or attempt.get("status") == "completed" or prior.get("status") != "completed":
                by_probe[key] = attempt
        for attempt in by_probe.values():
            ref = str(attempt.get("modelRef") or "")
            kind = str(attempt.get("kind") or "")
            if not ref or not kind:
                continue
            by_kind = models.setdefault(ref, {})
            entry = by_kind.setdefault(kind, {"status": "", "error": "", "counts": {}})
            status = str(attempt.get("status") or "interrupted")
            entry["counts"][status] = entry["counts"].get(status, 0) + 1
            result = attempt.get("result") or {}
            if (result.get("usage") or {}).get("completion_tokens") and attempt.get("finishedAt"):
                entry["measurement"] = {
                    "startedAt": attempt.get("startedAt"), "finishedAt": attempt["finishedAt"],
                    "result": {key: result.get(key) for key in ("usage", "timings", "requestSeconds", "contextSize", "finishReason")},
                }
            if attempt.get("error") and str(attempt["error"]) not in entry["error"]:
                entry["error"] += (" · " if entry["error"] else "") + str(attempt["error"])
            entry.setdefault("throughputSamples", [])
            entry.setdefault("outputTokenSamples", [])
            timings = result.get("timings") if isinstance(result.get("timings"), dict) else {}
            usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
            rate = timings.get("predicted_per_second")
            if isinstance(rate, (int, float)) and not isinstance(rate, bool) and rate > 0:
                entry.setdefault("generationSpeedSamples", []).append(round(float(rate), 2))
            tokens = usage.get("completion_tokens") or timings.get("predicted_n")
            if not rate and isinstance(tokens, (int, float)) and tokens > 0:
                seconds = result.get("requestSeconds")
                if not isinstance(seconds, (int, float)) or seconds <= 0:
                    try:
                        seconds = (datetime.fromisoformat(attempt["finishedAt"].replace("Z", "+00:00")) -
                                   datetime.fromisoformat(attempt["startedAt"].replace("Z", "+00:00"))).total_seconds()
                    except (KeyError, ValueError, TypeError):
                        seconds = 0
                if seconds and seconds > 0:
                    rate = float(tokens) / seconds
                    entry["speedBasis"] = "effective throughput including overhead"
            if isinstance(rate, (int, float)) and not isinstance(rate, bool) and 0 < rate < 10000000:
                entry["throughputSamples"].append(round(float(rate), 2))
            if isinstance(tokens, (int, float)) and not isinstance(tokens, bool) and 0 < tokens < 10000000:
                entry["outputTokenSamples"].append(round(float(tokens), 2))
            if kind == "director_thinking":
                entry["supported"] = status == "completed" and bool(str(result.get("reasoning") or "").strip())
            if kind.startswith("director_scene_plan_") and status == "completed":
                entry["verifiedOutputTokens"] = max(entry.get("verifiedOutputTokens", 0),
                    int(result.get("verifiedOutputTokens") or 0))
            if kind.startswith("director_writing") and status == "completed":
                # A completed LLM job alone does not prove a long-form target.
                # The calibration protocol owns real 8K/16K qualification.
                entry["maxRequestedTokens"] = max(entry.get("maxRequestedTokens", 0),
                    int(kind.rsplit("_", 1)[-1]) if kind.rsplit("_", 1)[-1].isdigit() else 2048)
            entry["status"] = next((value for value in (
                "failed", "running", "interrupted", "skipped", "completed"
            ) if entry["counts"].get(value)), status)
        summaries.append({
            "id": row["id"], "status": row.get("status"),
            "startedAt": row.get("startedAt"), "folder": row.get("folder"),
            "depth": run.get("depth", "quick"),
            "error": row.get("error", ""), "models": models,
            "importedFrom": run.get("importedFrom"),
            "qualityReviews": _copy(run.get("qualityReviews") or {}),
        })
    return summaries


def list_runs():
    root = run_root()
    if not root.is_dir():
        return []
    rows = []
    for path in root.glob("*.json"):
        try:
            payload = get_run(path.stem)
        except Exception as exc:
            rows.append({
                "id": path.stem,
                "status": "error",
                "startedAt": "",
                "finishedAt": "",
                "folder": "",
                "error": str(exc),
                "attemptCount": 0,
                "summary": {},
                "active": False,
            })
            continue
        rows.append({
            "id": str(payload.get("id") or path.stem),
            "status": str(payload.get("status") or ""),
            "startedAt": str(payload.get("startedAt") or ""),
            "finishedAt": str(payload.get("finishedAt") or ""),
            "folder": str(payload.get("folder") or ""),
            "error": str(payload.get("error") or ""),
            "attemptCount": len(payload.get("attempts") or []),
            "summary": _copy(payload.get("summary") or {}),
            "progress": _copy(payload.get("progress") or {}),
            "modelCount": len(payload.get("visionModels") or []) + len(payload.get("directorModels") or []),
            "active": bool(_active_record(payload.get("id"))),
        })
    rows.sort(key=lambda row: row.get("startedAt") or "", reverse=True)
    return rows


def _normalize_model(model, role):
    model = model if isinstance(model, dict) else {}
    model_ref = str(model.get("modelRef") or model.get("id") or "").strip()
    runtime_id = str(model.get("runtimeId") or "").strip()
    model_id = str(model.get("modelId") or "").strip()
    if not model_ref:
        raise ValueError("Model Lab " + role + " model reference is required.")
    return {
        "modelRef": model_ref,
        "runtimeId": runtime_id,
        "runtimeName": str(model.get("runtimeName") or "").strip(),
        "modelId": model_id or model_ref,
        "label": str(model.get("label") or model_id or model_ref).strip(),
        "sizeBytes": max(0, int(model.get("sizeBytes") or 0)),
    }


def _normalize_models(models, role):
    out = []
    seen = set()
    for raw in models if isinstance(models, list) else []:
        model = _normalize_model(raw, role)
        if model["modelRef"] in seen:
            continue
        seen.add(model["modelRef"])
        out.append(model)
    return out


def _normalize_groups(groups):
    out = []
    seen = set()
    for raw in groups if isinstance(groups, list) else []:
        if not isinstance(raw, dict):
            continue
        group = " ".join(str(raw.get("group") or "").split()).strip()
        if not group or group.casefold() in seen:
            continue
        seen.add(group.casefold())
        terms = []
        term_seen = set()
        for raw_term in raw.get("terms") if isinstance(raw.get("terms"), list) else []:
            term = " ".join(str(raw_term or "").split()).strip()
            if not term or term.casefold() in term_seen:
                continue
            term_seen.add(term.casefold())
            terms.append(term)
        out.append({"group": group, "terms": terms})
    return out


def _even_sample(values, limit):
    values = [str(value or "").strip() for value in values if str(value or "").strip()]
    if len(values) <= limit:
        return values
    if limit <= 1:
        return values[:1]
    last = len(values) - 1
    indices = []
    for index in range(limit):
        position = round(index * last / (limit - 1))
        if position not in indices:
            indices.append(position)
    return [values[index] for index in indices]


def _supported_media(folder, files):
    from .caption_ops import _resolve_folder
    from .caption_vision import VISION_MEDIA_EXTS

    folder_path = _resolve_folder(folder)
    out = []
    for name in files if isinstance(files, list) else []:
        name = str(name or "").strip()
        if not name:
            continue
        path = folder_path / name
        if path.is_file() and path.suffix.casefold() in VISION_MEDIA_EXTS:
            out.append(name)
    return out


def _model_by_ref(models, model_ref):
    model_ref = str(model_ref or "").strip()
    return next((model for model in models if model.get("modelRef") == model_ref), None)


def _reusable_evidence(run):
    """Index saved completed probes once; never repeat them or copy large model outputs.

    Only identical local evidence can satisfy a new assessment. Imported evidence
    describes another host; its timing is not a local speed measurement.
    """
    reused = {}
    failures = {}
    selected = {m["modelRef"] for m in run["directorModels"] + run["allVisionModels"]}
    for item in list_runs():
        if item.get("status") in {"running", "error"}:
            continue
        previous = get_run(item["id"])
        if previous.get("importedFrom"):
            continue
        same_protocol = previous.get("assessmentProtocol") == ASSESSMENT_PROTOCOL
        for attempt in reversed(previous.get("attempts") or []):
            kind = str(attempt.get("kind") or "")
            ref = str(attempt.get("modelRef") or "")
            filename = str(attempt.get("file") or "")
            if ref not in selected or not (same_protocol or kind in LEGACY_COMPATIBLE_KINDS):
                continue
            if kind.startswith("vision_"):
                if kind not in {"vision_open", "vision_group_aware"}:
                    continue
                if previous.get("folder") != run["folder"] or filename not in run["files"]:
                    continue
                if kind == "vision_group_aware" and previous.get("groups") != run["groups"]:
                    continue
            elif kind.startswith("set_") or kind.startswith("vision:"):
                continue
            key = _attempt_key(kind, ref, filename)
            if key in reused:
                continue
            if attempt.get("status") == "completed":
                reused[key] = {"runId": previous["id"], "attemptId": attempt["id"]}
                failures.pop(key, None)
            elif attempt.get("status") == "failed" and key not in failures:
                failures[key] = True
    return reused, failures


def _new_run_payload(config):
    config = config if isinstance(config, dict) else {}
    folder = str(config.get("folder") or "").strip()

    try:
        sample_count = int(config.get("sampleCount") or DEFAULT_SAMPLE_COUNT)
    except (TypeError, ValueError) as exc:
        raise ValueError("Model Lab sampleCount must be an integer.") from exc
    sample_count = max(2, min(MAX_SAMPLE_COUNT, sample_count))
    depth = str(config.get("depth") or "quick").strip().lower()
    if depth not in {"quick", "deep"}:
        raise ValueError("Model Lab depth must be quick or deep.")

    vision_models = _normalize_models(config.get("visionModels"), "Vision")
    director_models = _normalize_models(config.get("directorModels"), "Director")
    if not vision_models and not director_models:
        raise ValueError("Choose at least one Vision or Director model for Model Assessment.")
    if vision_models and not folder:
        raise ValueError("Vision assessment needs a Set folder.")
    files = _supported_media(folder, config.get("files")) if folder else []
    if vision_models and len(files) < 2:
        raise ValueError("Vision assessment needs at least two supported Set media items.")
    sample_files = _even_sample(files, sample_count) if vision_models else []

    groups = _normalize_groups(config.get("groups"))
    reference_vision_ref = str(config.get("referenceVisionRef") or "").strip()
    reference_director_ref = str(config.get("referenceDirectorRef") or "").strip()

    all_vision = list(vision_models)
    reference_vision = config.get("referenceVision") if isinstance(config.get("referenceVision"), dict) else None
    if reference_vision_ref and not _model_by_ref(all_vision, reference_vision_ref):
        if reference_vision:
            model = _normalize_model(reference_vision, "reference Vision")
            if model["modelRef"] != reference_vision_ref:
                raise ValueError("Reference Vision model does not match referenceVisionRef.")
            all_vision.append(model)
        else:
            raise ValueError("Reference Vision model details are required.")

    all_directors = list(director_models)
    reference_director = config.get("referenceDirector") if isinstance(config.get("referenceDirector"), dict) else None
    if reference_director_ref and not _model_by_ref(all_directors, reference_director_ref):
        if reference_director:
            model = _normalize_model(reference_director, "reference Director")
            if model["modelRef"] != reference_director_ref:
                raise ValueError("Reference Director model does not match referenceDirectorRef.")
            all_directors.append(model)
        else:
            raise ValueError("Reference Director model details are required.")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_id = stamp + "-" + secrets.token_hex(4)
    run = {
        "version": RUN_VERSION,
        "assessmentProtocol": ASSESSMENT_PROTOCOL,
        "id": run_id,
        "status": "running",
        "startedAt": _now_iso(),
        "finishedAt": "",
        "folder": folder,
        "depth": depth,
        "files": sample_files,
        "groups": groups,
        "visionModels": vision_models,
        "directorModels": director_models,
        "allVisionModels": all_vision,
        "allDirectorModels": all_directors,
        "referenceVisionRef": reference_vision_ref,
        "referenceDirectorRef": reference_director_ref,
        "options": {
            "sampleCount": len(sample_files),
            "activeTimeoutSeconds": DEFAULT_ACTIVE_TIMEOUT_SECONDS,
            "failureCircuitBreaker": FAILURE_CIRCUIT_BREAKER,
        },
        "progress": {
            "phase": "starting",
            "currentModelRef": "",
            "currentFile": "",
            "currentKind": "",
        },
        "summary": {},
        "error": "",
        "attempts": [],
        "qualityReviews": {},
    }
    run["reused"], run["previousFailures"] = _reusable_evidence(run)
    return run


def _write_run(run):
    if run.get("assessmentProtocol") == ASSESSMENT_PROTOCOL:
        run["work"] = _assessment_work(run)
    _write(_run_path(run["id"]), run)


def _attempt_key(kind, model_ref, file_name=""):
    return "|".join((str(kind or ""), str(model_ref or ""), str(file_name or "")))


def _attempt_completed(run, kind, model_ref, file_name=""):
    return _completed_attempt(run, kind, model_ref, file_name) is not None


def _completed_attempt(run, kind, model_ref, file_name=""):
    key = _attempt_key(kind, model_ref, file_name)
    for attempt in reversed(run.get("attempts") or []):
        if (
            isinstance(attempt, dict)
            and _attempt_key(attempt.get("kind"), attempt.get("modelRef"), attempt.get("file")) == key
            and attempt.get("status") == "completed"
        ):
            return attempt
    reused = (run.get("reused") or {}).get(key)
    if reused:
        source = get_run(reused["runId"])
        return next((attempt for attempt in source.get("attempts") or []
                     if attempt.get("id") == reused["attemptId"] and attempt.get("status") == "completed"), None)
    return None


def _summarize(run):
    attempts = [attempt for attempt in run.get("attempts") or [] if isinstance(attempt, dict)]
    by_model = {}
    for attempt in attempts:
        model_ref = str(attempt.get("modelRef") or "")
        if not model_ref:
            continue
        row = by_model.setdefault(model_ref, {
            "completed": 0,
            "failed": 0,
            "interrupted": 0,
            "skipped": 0,
            "kinds": {},
        })
        status = str(attempt.get("status") or "")
        if status in row:
            row[status] += 1
        kind = str(attempt.get("kind") or "")
        if kind:
            kind_row = row["kinds"].setdefault(kind, {"completed": 0, "failed": 0, "interrupted": 0, "skipped": 0})
            if status in kind_row:
                kind_row[status] += 1
    return {
        "attempts": len(attempts),
        "completed": sum(1 for attempt in attempts if attempt.get("status") == "completed"),
        "failed": sum(1 for attempt in attempts if attempt.get("status") == "failed"),
        "interrupted": sum(1 for attempt in attempts if attempt.get("status") == "interrupted"),
        "skipped": sum(1 for attempt in attempts if attempt.get("status") == "skipped"),
        "byModel": by_model,
    }


def _persist_progress(run, **updates):
    run["progress"].update({key: value for key, value in updates.items()})
    run["summary"] = _summarize(run)
    _write_run(run)


def _append_attempt(run, attempt):
    run.setdefault("attempts", []).append(attempt)
    run["summary"] = _summarize(run)
    _write_run(run)


def _update_attempt(run, attempt_id, **updates):
    attempt = next(
        (row for row in run.get("attempts") or [] if isinstance(row, dict) and row.get("id") == attempt_id),
        None,
    )
    if attempt is None:
        raise RuntimeError("Model Lab attempt disappeared while running.")
    attempt.update(updates)
    run["summary"] = _summarize(run)
    _write_run(run)
    return attempt


def _active_stop_event(run_id):
    active = _active_record(run_id)
    return active.get("stopEvent") if isinstance(active, dict) else None


def _set_current_job(run_id, job_id):
    with _lock:
        active = _active.get(run_id)
        if active is not None:
            active["jobId"] = str(job_id or "")


def _mark_retry(run, kind, role, model_ref, file_name):
    if run.get("retryPhase"):
        return
    key = _attempt_key(kind, model_ref, file_name)
    deferred = run.setdefault("deferredRetries", [])
    if not any(_attempt_key(row["kind"], row["modelRef"], row["file"]) == key for row in deferred):
        deferred.append({"kind": kind, "role": role, "modelRef": model_ref, "file": file_name})


def _probe_job(run, *, kind, role, model_ref, file_name="", enqueue):
    if _attempt_completed(run, kind, model_ref, file_name):
        return _completed_attempt(run, kind, model_ref, file_name)
    key = _attempt_key(kind, model_ref, file_name)
    # Failed probes wait until all missing work for this model has been attempted.
    if not run.get("retryPhase") and (run.get("previousFailures") or {}).get(key):
        _mark_retry(run, kind, role, model_ref, file_name)
        return {"kind": kind, "status": "deferred", "modelRef": model_ref, "file": file_name}

    stop_event = _active_stop_event(run["id"])
    if stop_event is not None and stop_event.is_set():
        raise ModelLabStopped("Model Lab stop requested.")

    attempt_id = "p-" + secrets.token_hex(6)
    attempt = {
        "id": attempt_id,
        "kind": kind,
        "role": role,
        "modelRef": model_ref,
        "file": file_name,
        "status": "running",
        "startedAt": _now_iso(),
        "finishedAt": "",
        "jobId": "",
        "error": "",
        "result": {},
        "retry": bool(run.get("retryPhase")),
    }
    _append_attempt(run, attempt)
    _persist_progress(
        run,
        phase="retry" if run.get("retryPhase") else role,
        currentModelRef=model_ref,
        currentFile=file_name,
        currentKind=kind,
        executionStatus="submitting",
    )

    job_id = ""
    try:
        queued = enqueue()
        job_id = str(queued.get("jobId") or queued.get("id") or "")
        if not job_id:
            raise RuntimeError("Model Lab probe did not receive an LLM job ID.")
        _set_current_job(run["id"], job_id)
        _update_attempt(run, attempt_id, jobId=job_id)

        active_started = None
        last_job_status = ""
        while True:
            if stop_event is not None and stop_event.is_set():
                from .llm_runner import cancel_job
                try:
                    cancel_job(job_id)
                except Exception:
                    pass
                raise ModelLabStopped("Model Lab stop requested.")

            from .llm_runner import job_status
            job = job_status(job_id, consume=False)
            status = str(job.get("status") or "")
            if status != last_job_status:
                last_job_status = status
                _persist_progress(run, executionStatus=status)
            started_at = float(job.get("startedAt") or 0)
            if started_at > 0 and active_started is None:
                active_started = time.monotonic()
            if (
                active_started is not None
                and time.monotonic() - active_started > int(run["options"]["activeTimeoutSeconds"])
                and status not in _TERMINAL_JOB_STATES
            ):
                from .llm_runner import cancel_job
                try:
                    cancel_job(job_id)
                except Exception:
                    pass
                raise TimeoutError(
                    "Probe exceeded active timeout of {} seconds.".format(
                        run["options"]["activeTimeoutSeconds"]
                    )
                )

            if status in _TERMINAL_JOB_STATES:
                if status != "completed":
                    raise RuntimeError(str(job.get("error") or ("LLM job ended as " + status)))
                result = job.get("result") if isinstance(job.get("result"), dict) else {}
                required_result = {"vision_open": "sight", "vision_group_aware": "vocabularySight"}.get(kind)
                validation_error = ""
                if kind.startswith("director_scene_plan_"):
                    try:
                        expected = int(kind.rsplit("_", 1)[-1]) // 256
                        plan = json.loads(str(result.get("text") or ""))
                        scenes = plan.get("scenes") if isinstance(plan, dict) else None
                        if not isinstance(scenes, list) or len(scenes) != max(2, expected):
                            raise ValueError("Wrong number of Storyboard Scenes.")
                        for scene in scenes:
                            if not isinstance(scene, dict) or not all(
                                isinstance(scene.get(field), str) and scene[field].strip()
                                for field in ("title", "summary", "prompt")
                            ) or not isinstance(scene.get("suggestedDurationSeconds"), (int, float)):
                                raise ValueError("Storyboard Scene is incomplete.")
                            if len(scene["prompt"].split()) < 80 or not 6 <= scene["suggestedDurationSeconds"] <= 15:
                                raise ValueError("Storyboard Scene has insufficient prompt detail or invalid duration.")
                        if str(result.get("finishReason") or "").lower() == "length":
                            raise ValueError("Structured response was truncated at its token budget.")
                        # Provider completion usage may include hidden/separate reasoning.
                        # Do not call those tokens verified answer output.
                        result["verifiedOutputTokens"] = (int(
                            (result.get("usage") or {}).get("completion_tokens") or 0
                        ) if not str(result.get("reasoning") or "").strip() else 0)
                    except (ValueError, TypeError, KeyError) as exc:
                        validation_error = "Storyboard structured-output validation failed: " + str(exc)
                if required_result and not isinstance(result.get(required_result), dict):
                    validation_error = result.get("structureWarning") or "Vision returned no usable structured evidence."
                    if not str(result.get("text") or "").strip():
                        validation_error = "Vision returned no answer text" + (
                            " (token budget exhausted during reasoning)." if result.get("reasoning") and result.get("finishReason") == "length"
                            else "."
                        )
                _update_attempt(
                    run,
                    attempt_id,
                    status="failed" if validation_error else "completed",
                    error=validation_error,
                    finishedAt=_now_iso(),
                    result=result,
                )
                if validation_error:
                    _mark_retry(run, kind, role, model_ref, file_name)
                try:
                    job_status(job_id, consume=True)
                except Exception:
                    pass
                return next(row for row in run["attempts"] if row.get("id") == attempt_id)
            time.sleep(POLL_SECONDS)
    except ModelLabStopped:
        _update_attempt(
            run,
            attempt_id,
            status="interrupted",
            finishedAt=_now_iso(),
            error="Stopped by user.",
        )
        raise
    except Exception as exc:
        _update_attempt(
            run,
            attempt_id,
            status="failed",
            finishedAt=_now_iso(),
            error=str(exc),
        )
        _mark_retry(run, kind, role, model_ref, file_name)
        return next(row for row in run["attempts"] if row.get("id") == attempt_id)
    finally:
        _set_current_job(run["id"], "")


def _skip_attempt(run, kind, role, model_ref, file_name, reason):
    if _attempt_completed(run, kind, model_ref, file_name):
        return
    _append_attempt(run, {
        "id": "p-" + secrets.token_hex(6),
        "kind": kind,
        "role": role,
        "modelRef": model_ref,
        "file": file_name,
        "status": "skipped",
        "startedAt": _now_iso(),
        "finishedAt": _now_iso(),
        "jobId": "",
        "error": str(reason or ""),
        "result": {},
    })


def _failed_attempt(run, kind, role, model_ref, file_name, error):
    _append_attempt(run, {
        "id": "p-" + secrets.token_hex(6),
        "kind": kind,
        "role": role,
        "modelRef": model_ref,
        "file": file_name,
        "status": "failed",
        "startedAt": _now_iso(),
        "finishedAt": _now_iso(),
        "jobId": "",
        "error": str(error or ""),
        "result": {},
    })


def _vision_records(run, model_ref):
    open_records = []
    vocabulary_records = []
    for file_name in run["files"]:
        open_attempt = _completed_attempt(run, "vision_open", model_ref, file_name)
        if open_attempt:
            sight = (open_attempt.get("result") or {}).get("sight")
            if isinstance(sight, dict):
                open_records.append({"file": file_name, **sight})
        vocab_attempt = _completed_attempt(run, "vision_group_aware", model_ref, file_name)
        if vocab_attempt:
            sight = (vocab_attempt.get("result") or {}).get("vocabularySight")
            if isinstance(sight, dict):
                vocabulary_records.append({
                    "file": file_name,
                    "caption": str(sight.get("caption") or ""),
                    "matches": list(sight.get("matches") or []),
                })
    return open_records, vocabulary_records


def _analysis_from_records(open_records, vocabulary_records, vision_model):
    from .vision_schema_assist import mine_sight_records, mine_vocabulary_sight_records

    open_analysis = mine_sight_records(open_records, limit=180)
    vocabulary_analysis = mine_vocabulary_sight_records(vocabulary_records)
    evidence = []
    for index, row in enumerate(open_analysis.get("evidence") or [], start=1):
        copied = dict(row)
        copied["id"] = "o{:03d}".format(index)
        copied["source"] = "open"
        copied["suggestedGroup"] = ""
        evidence.append(copied)
    evidence.extend(vocabulary_analysis.get("evidence") or [])
    return {
        "version": 1,
        "visionModel": vision_model,
        "itemCount": len(open_records),
        "openItemCount": len(open_records),
        "schemaAwareItemCount": len(vocabulary_records),
        "evidenceCount": len(evidence),
        "evidence": evidence,
    }


def _run_vision_model(run, model):
    from .caption_vision import resolve_caption_vision_media
    from .llm_runner import enqueue
    from .vision_schema_assist import (
        build_vision_schema_sight_messages,
        build_vision_vocabulary_sight_messages,
    )

    model_ref = model["modelRef"]
    consecutive_failures = 0

    for file_name in run["files"]:
        if consecutive_failures >= run["options"]["failureCircuitBreaker"]:
            _skip_attempt(
                run,
                "vision_open",
                "vision",
                model_ref,
                file_name,
                "Skipped after consecutive model failures.",
            )
            if run["groups"]:
                _skip_attempt(
                    run,
                    "vision_group_aware",
                    "vision",
                    model_ref,
                    file_name,
                    "Skipped after consecutive model failures.",
                )
            continue

        try:
            media = resolve_caption_vision_media(run["folder"], file_name)
        except Exception as exc:
            _skip_attempt(
                run,
                "vision_open",
                "vision",
                model_ref,
                file_name,
                "Media preparation failed: " + str(exc),
            )
            if run["groups"]:
                _skip_attempt(
                    run,
                    "vision_group_aware",
                    "vision",
                    model_ref,
                    file_name,
                    "Media preparation failed: " + str(exc),
                )
            continue

        attempt = _probe_job(
            run,
            kind="vision_open",
            role="vision",
            model_ref=model_ref,
            file_name=file_name,
            enqueue=lambda media=media: enqueue(
                "caption",
                model_ref,
                {
                    "operation": "vision_schema_sight",
                    "messages": build_vision_schema_sight_messages(media),
                },
                context={"assessmentEvidence": True},
                label="Model Lab · Open Vision",
            ),
        )
        if attempt.get("status") == "completed":
            consecutive_failures = 0
        elif attempt.get("status") != "deferred":
            consecutive_failures += 1

        if not run["groups"]:
            continue
        if consecutive_failures >= run["options"]["failureCircuitBreaker"]:
            _skip_attempt(
                run,
                "vision_group_aware",
                "vision",
                model_ref,
                file_name,
                "Skipped after consecutive model failures.",
            )
            continue

        attempt = _probe_job(
            run,
            kind="vision_group_aware",
            role="vision",
            model_ref=model_ref,
            file_name=file_name,
            enqueue=lambda media=media: enqueue(
                "caption",
                model_ref,
                {
                    "operation": "vision_vocabulary_sight",
                    "messages": build_vision_vocabulary_sight_messages(media, run["groups"]),
                },
                context={
                    "assessmentEvidence": True,
                    "existingGroups": run["groups"],
                },
                label="Model Lab · Group-aware Vision",
            ),
        )
        if attempt.get("status") == "completed":
            consecutive_failures = 0
        elif attempt.get("status") != "deferred":
            consecutive_failures += 1


def _synthetic_analysis():
    evidence = [
        {
            "id": "s001",
            "source": "open",
            "category": "quality",
            "suggestedGroup": "",
            "label": "bikini top: tiny triangular cups",
            "count": 3,
            "media": ["sample-a", "sample-b", "sample-c"],
            "examples": ["sample-a", "sample-b", "sample-c"],
            "contexts": [],
        },
        {
            "id": "s002",
            "source": "schema",
            "category": "group",
            "suggestedGroup": "BT Shape",
            "label": "micro triangle",
            "count": 3,
            "media": ["sample-a", "sample-b", "sample-c"],
            "examples": ["sample-a", "sample-b", "sample-c"],
            "contexts": [],
        },
        {
            "id": "s003",
            "source": "schema",
            "category": "group",
            "suggestedGroup": "BT Shape",
            "label": "bandeau",
            "count": 2,
            "media": ["sample-d", "sample-e"],
            "examples": ["sample-d", "sample-e"],
            "contexts": [],
        },
        {
            "id": "s004",
            "source": "other",
            "category": "other",
            "suggestedGroup": "Connector",
            "label": "metal ring connector",
            "count": 4,
            "media": ["sample-a", "sample-c", "sample-d", "sample-f"],
            "examples": ["sample-a", "sample-c", "sample-d", "sample-f"],
            "contexts": [],
        },
    ]
    return {
        "version": 1,
        "visionModel": "synthetic",
        "itemCount": 6,
        "openItemCount": 6,
        "schemaAwareItemCount": 6,
        "evidenceCount": len(evidence),
        "evidence": evidence,
    }


def _run_schema_pair(run, model_ref, analysis, existing_groups, prefix):
    from .llm_runner import enqueue
    from .vision_schema_contract import build_challenge_request, build_request

    synthesis_kind = prefix + "_synthesis"
    challenge_kind = prefix + "_challenge"

    synthesis = _probe_job(
        run,
        kind=synthesis_kind,
        role="director",
        model_ref=model_ref,
        enqueue=lambda: enqueue(
            "schema",
            model_ref,
            build_request(analysis, existing_groups),
            context={},
            label="Model Lab · Vocabulary Synthesis",
        ),
    )
    if synthesis.get("status") != "completed":
        _skip_attempt(
            run,
            challenge_kind,
            "director",
            model_ref,
            "",
            "Challenge skipped because synthesis did not complete.",
        )
        return

    draft = (synthesis.get("result") or {}).get("schema")
    if not isinstance(draft, dict):
        _skip_attempt(
            run,
            challenge_kind,
            "director",
            model_ref,
            "",
            "Challenge skipped because synthesis returned no normalized schema.",
        )
        return

    _probe_job(
        run,
        kind=challenge_kind,
        role="director",
        model_ref=model_ref,
        enqueue=lambda: enqueue(
            "schema",
            model_ref,
            build_challenge_request(analysis, existing_groups, draft),
            context={},
            label="Model Lab · Vocabulary Challenge",
        ),
    )


def _run_reference_director_for_vision(run, vision_model):
    model_ref = str(run.get("referenceDirectorRef") or "")
    if not model_ref:
        return
    open_records, vocabulary_records = _vision_records(run, vision_model["modelRef"])
    prefix = "vision:{}:vocab".format(vision_model["modelRef"])
    if len(open_records) < 2:
        for kind in (prefix + "_synthesis", prefix + "_challenge"):
            _skip_attempt(
                run, kind, "director", model_ref, "",
                "Not enough completed open Vision probes for this Vision model.",
            )
        return
    analysis = _analysis_from_records(open_records, vocabulary_records, vision_model["modelRef"])
    _run_schema_pair(run, model_ref, analysis, run["groups"], prefix)


def _run_director_model(run, model):
    model_ref = model["modelRef"]
    from .llm_runner import enqueue

    # Thinking remains a small, directly useful Storyboard capability check.
    _probe_job(
        run, kind="director_thinking", role="director", model_ref=model_ref,
        enqueue=lambda: enqueue(
            "chat", model_ref,
            {"operation": "freeform_chat", "messages": [
                {"role": "user", "content": "Think briefly: what is 7 + 5? Answer with the number."}]},
            context={"runtimeOverrides": {"maxTokens": 128}, "assessmentEvidence": True, "thinking": True},
            label="Model Assessment · Thinking",
        ),
    )

    # Use WebCap's actual Storyboard Scene schema, rather than synthetic prose.
    # The generated Scene-plan JSON supplies capacity, speed and review evidence.
    from .storyboard_llm_contract import SCENE_PLAN_SCHEMA_PATH, _read_json
    scene_schema = _read_json(SCENE_PLAN_SCHEMA_PATH, "Storyboard Scene plan schema")
    for budget in ((2048, 4096, 8192, 16384) if run.get("depth") == "deep" else (2048,)):
        scene_count = max(2, budget // 256)
        prompt = (
            "Create a WebCap Storyboard Scene plan for a grounded, continuous cinematic sequence "
            "showing an urban night-shift maintenance worker investigating a malfunctioning elevator. "
            "Return exactly " + str(scene_count) + " distinct chronological Scenes, each with a "
            "descriptive title, concrete overview, a practical and detailed MiniMax H3 visual generation "
            "prompt of approximately 120-180 words, and a valid suggestedDurationSeconds. "
            "Maintain continuity across Scenes, avoid repeated descriptions, and use only JSON matching "
            "the supplied WebCap Scene-plan schema. Complete the final Scene without stopping early."
        )
        _probe_job(
            run, kind="director_scene_plan_" + str(budget), role="director", model_ref=model_ref,
            enqueue=lambda budget=budget, prompt=prompt: enqueue(
                "chat", model_ref, {
                    "operation": "assessment_scene_plan",
                    "messages": [{"role": "user", "content": prompt}],
                    "response_schema": scene_schema,
                }, context={"runtimeOverrides": {"maxTokens": budget}, "assessmentEvidence": True},
                label="Model Assessment · Storyboard JSON " + str(budget),
            ),
        )
    synthetic_groups = [
        {"group": "BT Shape", "terms": ["triangle", "bandeau"]},
        {"group": "BT Connector", "terms": ["chain"]},
    ]
    _run_schema_pair(run, model_ref, _synthetic_analysis(), synthetic_groups, "language")

    reference_vision_ref = str(run.get("referenceVisionRef") or "")
    if not reference_vision_ref:
        return
    open_records, vocabulary_records = _vision_records(run, reference_vision_ref)
    if len(open_records) < 2:
        for kind in ("set_vocabulary_synthesis", "set_vocabulary_challenge"):
            _skip_attempt(
                run, kind, "director", model_ref, "",
                "Reference Vision did not produce enough completed open probes.",
            )
        return
    analysis = _analysis_from_records(open_records, vocabulary_records, reference_vision_ref)
    _run_schema_pair(run, model_ref, analysis, run["groups"], "set_vocabulary")


def _retry_failed_model(run, model, role):
    ref = model["modelRef"]
    if not any(row["modelRef"] == ref for row in run.get("deferredRetries") or []):
        return
    run["retryPhase"] = True
    _persist_progress(run, phase="retry", currentModelRef=ref, currentFile="", currentKind="")
    try:
        if role == "vision":
            _run_vision_model(run, model)
        else:
            _run_director_model(run, model)
    finally:
        run.pop("retryPhase", None)
        run["deferredRetries"] = [row for row in run.get("deferredRetries") or []
                                  if row["modelRef"] != ref]


def _runner(run_id):
    try:
        run = _read_raw(run_id)
        run.pop("retryPhase", None)
        run["deferredRetries"] = []
        run["status"] = "running"
        run["finishedAt"] = ""
        run["error"] = ""
        _persist_progress(run, phase="vision", currentModelRef="", currentFile="", currentKind="")

        vision_refs = []
        for model in run.get("allVisionModels") or []:
            if model["modelRef"] in vision_refs:
                continue
            vision_refs.append(model["modelRef"])
            try:
                _run_vision_model(run, model)
                _retry_failed_model(run, model, "vision")
            except ModelLabStopped:
                raise
            except Exception as exc:
                _failed_attempt(
                    run,
                    "vision_model_error",
                    "vision",
                    model["modelRef"],
                    "",
                    "Vision model stage failed: " + str(exc),
                )
            if _active_stop_event(run_id).is_set():
                raise ModelLabStopped("Model Lab stop requested.")

        if run.get("referenceDirectorRef"):
            for model in run.get("visionModels") or []:
                try:
                    _run_reference_director_for_vision(run, model)
                except ModelLabStopped:
                    raise
                except Exception as exc:
                    _failed_attempt(
                        run,
                        "vision_vocabulary_error",
                        "director",
                        run.get("referenceDirectorRef"),
                        model["modelRef"],
                        "Vision vocabulary evaluation failed: " + str(exc),
                    )
                if _active_stop_event(run_id).is_set():
                    raise ModelLabStopped("Model Lab stop requested.")

        _persist_progress(run, phase="director", currentModelRef="", currentFile="", currentKind="")
        for model in run.get("directorModels") or []:
            try:
                _run_director_model(run, model)
                _retry_failed_model(run, model, "director")
            except ModelLabStopped:
                raise
            except Exception as exc:
                _failed_attempt(
                    run,
                    "director_model_error",
                    "director",
                    model["modelRef"],
                    "",
                    "Director model stage failed: " + str(exc),
                )
            if _active_stop_event(run_id).is_set():
                raise ModelLabStopped("Model Lab stop requested.")

        run["status"] = "completed"
        run["finishedAt"] = _now_iso()
        run["error"] = ""
        _persist_progress(run, phase="complete", currentModelRef="", currentFile="", currentKind="")
    except ModelLabStopped:
        run = _read_raw(run_id)
        run["status"] = "stopped"
        run["finishedAt"] = _now_iso()
        run["error"] = "Stopped by user."
        _persist_progress(run, phase="stopped", currentModelRef="", currentFile="", currentKind="")
    except Exception as exc:
        run = _read_raw(run_id)
        run["status"] = "error"
        run["finishedAt"] = _now_iso()
        run["error"] = str(exc)
        _persist_progress(run, phase="error", currentModelRef="", currentFile="", currentKind="")
    finally:
        with _lock:
            _active.pop(run_id, None)


def _start_thread(run_id):
    with _lock:
        if _active:
            active_id = next(iter(_active))
            raise RuntimeError("Another Model Lab run is already active: " + active_id)
        stop_event = threading.Event()
        thread = threading.Thread(
            target=_runner,
            args=(run_id,),
            name="webcap-model-lab-" + run_id,
            daemon=True,
        )
        _active[run_id] = {
            "thread": thread,
            "stopEvent": stop_event,
            "jobId": "",
        }
        thread.start()


def _planned_probes(run):
    """Frozen logical work units; a retry never adds another unit."""
    probes = []

    def include(kind, ref, file_name=""):
        probes.append(_attempt_key(kind, ref, file_name))

    for model in run.get("allVisionModels") or []:
        ref = model["modelRef"]
        for file_name in run.get("files") or []:
            include("vision_open", ref, file_name)
            if run.get("groups"):
                include("vision_group_aware", ref, file_name)

    reference_director = str(run.get("referenceDirectorRef") or "")
    if reference_director:
        for vision_model in run.get("visionModels") or []:
            prefix = "vision:" + vision_model["modelRef"] + ":vocab"
            include(prefix + "_synthesis", reference_director)
            include(prefix + "_challenge", reference_director)

    for model in run.get("directorModels") or []:
        ref = model["modelRef"]
        include("director_thinking", ref)
        include("director_scene_plan_2048", ref)
        if run.get("depth") == "deep":
            for budget in (4096, 8192, 16384):
                include("director_scene_plan_" + str(budget), ref)
        include("language_synthesis", ref)
        include("language_challenge", ref)
        if run.get("referenceVisionRef"):
            include("set_vocabulary_synthesis", ref)
            include("set_vocabulary_challenge", ref)
    return list(dict.fromkeys(probes))


def _assessment_work(run):
    """Only count planned probes, never incidental retries or stage errors."""
    planned = _planned_probes(run)
    keys = set(planned)
    latest = {}
    for attempt in run.get("attempts") or []:
        if not isinstance(attempt, dict):
            continue
        key = _attempt_key(attempt.get("kind"), attempt.get("modelRef"), attempt.get("file"))
        if key in keys and latest.get(key, {}).get("status") != "completed":
            latest[key] = attempt

    reused = run.get("reused") or {}
    previous_failures = run.get("previousFailures") or {}
    completed = reused_count = skipped = failed = deferred = running = 0
    for key in planned:
        attempt = latest.get(key)
        if key in reused or (attempt and attempt.get("status") == "completed"):
            completed += 1
            if key in reused:
                reused_count += 1
        elif not attempt:
            if key in previous_failures:
                deferred += 1
        elif attempt.get("status") == "skipped":
            skipped += 1
        elif attempt.get("status") == "running":
            running += 1
        elif attempt.get("status") == "failed":
            if run.get("status") == "completed" or attempt.get("retry"):
                failed += 1
            else:
                deferred += 1
    resolved = completed + skipped + failed
    return {
        "planned": len(planned),
        "completed": completed,
        "reused": reused_count,
        "skipped": skipped,
        "failed": failed,
        "deferred": deferred,
        "running": running,
        "remaining": len(planned) - resolved,
        "resolved": resolved,
    }


def _pending_probe_plan(run):
    """Only schedule missing/failed work, using the same plan as progress."""
    missing = retry = 0
    for key in _planned_probes(run):
        if key in (run.get("reused") or {}):
            continue
        if key in (run.get("previousFailures") or {}):
            retry += 1
        else:
            missing += 1
    return {"missing": missing, "retry": retry, "total": missing + retry}



def start_run(config):
    run = _new_run_payload(config)
    run["plan"] = _pending_probe_plan(run)
    if not run["plan"]["total"]:
        run["status"] = "completed"
        run["finishedAt"] = _now_iso()
        run["noWork"] = True
        run["work"] = _assessment_work(run)
        return run
    with _lock:
        _write_run(run)
        try:
            _start_thread(run["id"])
        except Exception:
            run["status"] = "error"
            run["finishedAt"] = _now_iso()
            run["error"] = "Could not start Model Lab runner."
            _write_run(run)
            raise
    return get_run(run["id"])


def resume_run(run_id):
    with _lock:
        run = get_run(run_id)
        if run.get("importedFrom"):
            raise ValueError("Imported assessments are historical evidence. Start a new assessment to test on this machine.")
        if run["status"] == "completed":
            raise ValueError("Completed Model Lab runs do not need to resume.")
        if _active_record(run_id):
            return run

        run["status"] = "running"
        run["finishedAt"] = ""
        run["error"] = ""
        _write_run(run)
        _start_thread(run_id)
    return get_run(run_id)


def stop_run(run_id):
    active = _active_record(run_id)
    if not active:
        run = get_run(run_id)
        return run
    active["stopEvent"].set()
    job_id = str(active.get("jobId") or "")
    if job_id:
        from .llm_runner import cancel_job
        try:
            cancel_job(job_id)
        except Exception:
            pass
    return get_run(run_id)


def delete_run(run_id):
    with _lock:
        if _active_record(run_id):
            raise RuntimeError("Active Model Lab run cannot be deleted.")
        path = _run_path(run_id)
        try:
            path.unlink()
        except FileNotFoundError:
            raise FileNotFoundError("Model Lab run does not exist: " + str(run_id))
    return True


def model_catalog():
    from .storyboard_llm_runtime import list_models, list_vision_models

    directors = []
    for model in list_models(reload=False):
        directors.append(_normalize_model({
            "id": model.get("id"),
            "runtimeId": model.get("runtimeId"),
            "runtimeName": model.get("runtimeName"),
            "modelId": model.get("modelId"),
            "label": model.get("label"),
            "sizeBytes": model.get("sizeBytes"),
        }, "Director"))

    visions = []
    for model in list_vision_models(reload=False):
        visions.append(_normalize_model({
            "id": model.get("id"),
            "runtimeId": model.get("runtimeId"),
            "runtimeName": model.get("runtimeName"),
            "modelId": model.get("modelId"),
            "label": model.get("label"),
            "sizeBytes": model.get("sizeBytes"),
        }, "Vision"))

    return {
        "directors": directors,
        "visions": visions,
        "directorWarnings": list(getattr(list_models, "last_warnings", []) or []),
        "visionWarnings": list(getattr(list_vision_models, "last_warnings", []) or []),
    }


def register_routes(app):
    from flask import jsonify, request

    @app.route("/app/model-lab", methods=["GET", "POST", "DELETE"])
    def model_lab_route():
        try:
            if request.method == "GET":
                if request.args.get("export") == "1":
                    from .assessment_transfer import export_results
                    response = jsonify(export_results())
                    response.headers["Content-Disposition"] = 'attachment; filename="webcap-assessments.json"'
                    return response
                run_id = str(request.args.get("run") or "").strip()
                payload = {
                    "ok": True,
                    "runs": list_runs(),
                    "models": model_catalog(),
                }
                if request.args.get("summary") == "1":
                    payload["capabilityRuns"] = capability_run_summaries()
                if run_id:
                    payload["run"] = get_run(run_id)
                return jsonify(payload)

            if request.method == "DELETE":
                run_id = str(request.args.get("run") or "").strip()
                delete_run(run_id)
                return jsonify({"ok": True, "runs": list_runs()})

            data = request.get_json(silent=True) or {}
            action = str(data.get("action") or "").strip()
            if action == "import":
                from .assessment_transfer import import_results
                return jsonify({"ok": True, **import_results(data.get("bundle"), data.get("runtimeMap"))})
            if action == "judge":
                from .model_lab_quality import start_review
                run = start_review(data.get("runId"), data.get("modelRef"), data.get("judgeModelRef"))
                return jsonify({"ok": True, "run": run, "runs": list_runs()})
            if action == "stop_judge":
                from .model_lab_quality import stop_review
                run = stop_review(data.get("runId"))
                return jsonify({"ok": True, "run": run, "runs": list_runs()})
            if action == "start":
                run = start_run(data.get("config"))
                return jsonify({"ok": True, "run": run, "noWork": bool(run.get("noWork")),
                                "plan": run.get("plan"), "runs": list_runs()}), (200 if run.get("noWork") else 201)
            if action == "resume":
                run = resume_run(data.get("runId"))
                return jsonify({"ok": True, "run": run, "runs": list_runs()})
            if action == "stop":
                run = stop_run(data.get("runId"))
                return jsonify({"ok": True, "run": run, "runs": list_runs()})
            raise ValueError("Unsupported Model Lab action.")
        except FileNotFoundError as exc:
            return jsonify({"ok": False, "error": str(exc)}), 404
        except Exception as exc:
            app.logger.exception("MODEL LAB FAILED: %s", exc)
            return jsonify({"ok": False, "error": str(exc)}), 400
