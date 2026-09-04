import json
import logging
import math
import os
import re
import hashlib
import shlex
import socket
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath

from . import config as app_config
from .training_commands import build_h3_command_plan, build_training_command_plan
from .training_profiles import config_for_stage, normalize_mode, profile, profile_for_mode, profile_run, profiles as training_profiles
from .training_bundle import materialize_training_bundle
from .training_review import prepare_training_review, resolve_saved_initializer
from .dataset_config import repeat_targets
from .training_history import completed_stages, discover_runs, validate_resumable_run_for_path, resume_point_for_path, resume_point_from_directory, host_path_for_training_path, output_root_for_folder, read_history, record_job, clear_history_job, resolve_managed_resume
from .training_action import allocate_action, action_id_for_root, action_paths, fingerprint_files, read_action, update_action
from .training_preflight import (
    build_launch_preflight as _build_launch_preflight,
    gpu_snapshot as _gpu_snapshot,
    make_check as _make_check,
    needs_partial_annotation_caption_review as _needs_partial_annotation_caption_review,
    preflight_payload as _preflight_payload,
    prepared_dataset_is_ready as _prepared_dataset_is_ready,
    resolve_folder as _resolve_folder,
)
from .training_progress import (
    annotate_completed_job as _annotate_completed_job,
    annotate_finished_early_job as _annotate_finished_early_job,
    log_has_progress as _log_has_progress,
    normalize_training_stages as _normalize_training_stages,
    read_log_tail as _read_log_tail,
    sync_job_progress as _sync_job_progress,
)
from .training_runtime import (
    TRAINING_RUNTIME_DIR_NAME,
    activation_prefix as _activation_prefix,
    build_runtime_command as _build_runtime_command,
    build_training_launcher,
    configured_training_settings as _training_settings,
    has_conda_runtime,
    run_wsl as _run_wsl,
    to_wsl_path as _to_wsl_path,
    uses_native_wsl_shell as _uses_native_wsl_shell,
    wsl_executable as _wsl_executable,
)


RUNNER_DIR_NAME = TRAINING_RUNTIME_DIR_NAME
STATE_FILE_NAME = "queue.json"
JOB_DIR_NAME = "jobs"
ACTIVE_STATUSES = {"starting", "running", "stopping"}
QUEUE_STATUSES = {"queued"}
HISTORY_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted"}
TERMINAL_STATUSES = HISTORY_STATUSES | {"cancelled"}
_lock = threading.Lock()
_monitor_lock = threading.Lock()
_monitor_thread = None
_startup_reconciled = False
_state_file_seen = None
_persisted_managed_job_ids = set()
_logger = logging.getLogger(__name__)
_CHECKPOINT_SAVE_PATH_PATTERN = re.compile(r"Saving model checkpoint:\s+(.+?)[/\\]global_step\d+[/\\]")
_TRAINING_LOG_TIMESTAMP_PATTERN = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})\]", re.MULTILINE)
_DISTRIBUTED_SOCKET_HOLD_REASON = (
    "Queue held: PyTorch distributed could not open its server socket because the address is already in use. "
    "Stop the other training process before continuing."
)
_legacy_active_time_cache = {}
_SAVE_PAUSE_TRAINING_STAGES = {"hi", "lo", "krea2", "wan21", "h3"}
_TENSORBOARD_PROBE_TIMEOUT_SECONDS = 0.75
_TENSORBOARD_PROBE_BYTES = 8192


def _runtime_root():
    return Path(app_config.FS_ROOT) / RUNNER_DIR_NAME


def _state_path():
    return _runtime_root() / STATE_FILE_NAME


def _jobs_root():
    return _runtime_root() / JOB_DIR_NAME


def _ensure_runtime_dirs():
    _runtime_root().mkdir(parents=True, exist_ok=True)


def _default_state():
    # Queue fields are additive. Keep the established version so existing
    # queues remain readable across the action-layout transition.
    return {"version": 3, "activeJobId": "", "jobs": [], "queuePaused": False, "queuePauseReason": ""}


class TrainingStateError(RuntimeError):
    pass


def _state_job_ids(state, path):
    jobs = state.get("jobs") if isinstance(state, dict) else None
    if not isinstance(jobs, list):
        raise TrainingStateError("Existing training queue jobs are invalid; the state was left unchanged: " + str(path))
    job_ids = []
    for job in jobs:
        job_id = str(job.get("id") or "") if isinstance(job, dict) else ""
        if not job_id:
            raise TrainingStateError("Existing training queue contains a job without an ID; the state was left unchanged: " + str(path))
        job_ids.append(job_id)
    if len(job_ids) != len(set(job_ids)):
        raise TrainingStateError("Existing training queue contains duplicate job IDs; the state was left unchanged: " + str(path))
    return set(job_ids)


def _managed_job_ids(state):
    return {
        str(job["id"])
        for job in state.get("jobs", [])
        if str(job.get("status") or "") in ACTIVE_STATUSES | QUEUE_STATUSES
    }


def _read_state():
    global _state_file_seen, _persisted_managed_job_ids
    _ensure_runtime_dirs()
    path = _state_path()
    if not path.exists():
        _state_file_seen = None
        _persisted_managed_job_ids = set()
        return _default_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TrainingStateError("Could not read the existing training queue state; it was left unchanged: " + str(path)) from exc
    if not isinstance(parsed, dict):
        raise TrainingStateError("Existing training queue state is not a JSON object; it was left unchanged: " + str(path))
    if parsed.get("version") not in (3, 4):
        raise TrainingStateError("Unsupported training queue state version; the state was left unchanged: " + str(path))
    # Version 4 has the same additive queue shape; normalize it on the next
    # ordinary state write.
    parsed["version"] = 3
    parsed.setdefault("activeJobId", "")
    parsed.setdefault("jobs", [])
    parsed.setdefault("queuePaused", False)
    parsed.setdefault("queuePauseReason", "")
    _state_job_ids(parsed, path)
    _persisted_managed_job_ids = _managed_job_ids(parsed)
    _state_file_seen = path
    return parsed


def _write_state(state, retired_job_ids=()):
    global _state_file_seen, _persisted_managed_job_ids
    _ensure_runtime_dirs()
    path = _state_path()
    job_ids = _state_job_ids(state, path)
    allowed_retirements = {str(job_id) for job_id in retired_job_ids}
    missing_job_ids = _persisted_managed_job_ids - job_ids - allowed_retirements if _state_file_seen == path else set()
    if missing_job_ids:
        raise TrainingStateError(
            "Refusing to remove managed training jobs from queue state: " + ", ".join(sorted(missing_job_ids))
        )
    tmp = path.with_name("." + path.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(state, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
    _state_file_seen = path
    _persisted_managed_job_ids = _managed_job_ids(state)


def recover_state_response():
    """Recovery is deliberately manual: WebCap must not replace queue state."""
    return {"ok": False, "error": "Queue recovery is manual. Fix, move aside, or delete the queue file yourself."}, 409


def _sync_job_history(job):
    if job.get("historyHidden") or job.get("status") not in HISTORY_STATUSES:
        return ""
    folder = str(job.get("folder") or "").strip()
    if not folder:
        return "Training outcome has no set folder."
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        record_job(folder_path, job)
    except Exception as exc:
        return "Could not add training outcome to Recent Runs: " + str(exc)
    return ""


def _sync_histories(state):
    errors = []
    for job in state.get("jobs", []):
        error = _sync_job_history(job)
        if error:
            errors.append(error)
    return errors


def _retire_terminal_jobs(state):
    """Keep only scheduler work; Recent Runs never gates queue retirement."""
    retained = []
    retired_job_ids = set()
    for job in state.get("jobs", []):
        status = str(job.get("status") or "")
        job_id = str(job.get("id") or "")
        if status == "cancelled" or status in HISTORY_STATUSES:
            retired_job_ids.add(job_id)
            continue
        retained.append(job)
    state["jobs"] = retained
    return retired_job_ids


def _persist_reconciled_state(state):
    history_errors = _sync_histories(state) or []
    for error in history_errors:
        _logger.error(error)
    retired_job_ids = _retire_terminal_jobs(state)
    if retired_job_ids:
        _write_state(state, retired_job_ids=retired_job_ids)
    else:
        _write_state(state)


def relocate_folder_jobs(old_folder, new_folder):
    """Keep persisted jobs attached when a set is renamed through WebCap."""
    old_folder = str(old_folder or "").strip().replace("\\", "/").strip("/")
    new_folder = str(new_folder or "").strip().replace("\\", "/").strip("/")
    if not old_folder or not new_folder or old_folder == new_folder:
        return 0
    with _lock:
        state = _read_state()
        changed = 0
        prefix = old_folder + "/"
        for job in state.get("jobs", []):
            folder = str(job.get("folder") or "").strip().replace("\\", "/").strip("/")
            if folder == old_folder:
                job["folder"] = new_folder
            elif folder.startswith(prefix):
                job["folder"] = new_folder + folder[len(old_folder):]
            else:
                continue
            job["updatedAt"] = time.time()
            changed += 1
        if changed:
            _write_state(state)
        return changed


def _job_dir(job):
    """Job-owned artifacts live beside trainer output, not in the queue state area."""
    if isinstance(job, dict) and (job.get("artifactPath") or job.get("artifactDir")):
        return Path(job.get("artifactPath") or job.get("artifactDir"))
    job_id = job.get("id") if isinstance(job, dict) else job
    return _jobs_root() / str(job_id)


def _job_action_path(job):
    return _job_dir(job) / "action"


def _artifact_root(folder_path, stage):
    root = output_root_for_folder(folder_path, stage if stage in ("hi", "lo", "krea2", "wan21", "h3") else "hi")
    return root / ".webcap" / "jobs"


def _find_job(state, job_id):
    for job in state.get("jobs", []):
        if str(job.get("id") or "") == str(job_id or ""):
            return job
    return None


def _find_history_job(folder, job_id):
    folder_text = str(folder or "").strip()
    wanted = str(job_id or "").strip()
    if not folder_text or not wanted:
        return None
    try:
        folder_path = app_config.safe_join_fs_root(folder_text)
    except ValueError:
        return None
    return next(
        (job for job in read_history(folder_path).get("jobs", []) if str(job.get("id") or "") == wanted),
        None,
    )


def _active_training_metrics_for_job(folder, job_id, seen=None):
    """Return a complete cumulative active-time total, or None when history cannot prove one."""
    wanted = str(job_id or "").strip()
    visited = set(seen or ())
    if not wanted or wanted in visited:
        return None
    visited.add(wanted)
    job = _find_history_job(folder, wanted)
    if not job or str(job.get("status") or "") not in {"completed", "finished_early"}:
        return None
    if job.get("activeTrainingTimingComplete") is True:
        try:
            return max(0, float(job.get("activeTrainingSeconds") or 0))
        except (TypeError, ValueError):
            return None

    log_path = Path(str(job.get("logPath") or "") or str(job.get("artifactDir") or "") + "/run.log")
    try:
        stat = log_path.stat()
    except OSError:
        return None
    parent_id = str(job.get("parentJobId") or "").strip()
    cache_key = (str(folder or ""), wanted, str(log_path), stat.st_size, stat.st_mtime_ns, parent_id)
    cached = _legacy_active_time_cache.get(cache_key)
    if cached is not None:
        return cached

    first_timestamp = None
    last_timestamp = None
    saw_resume_before_timestamp = False
    try:
        with log_path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                if first_timestamp is None and line.startswith("[webcap] resume "):
                    saw_resume_before_timestamp = True
                match = _TRAINING_LOG_TIMESTAMP_PATTERN.match(line)
                if not match:
                    continue
                value = datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S,%f")
                if first_timestamp is None:
                    first_timestamp = value
                last_timestamp = value
    except (OSError, ValueError):
        return None
    if first_timestamp is None or last_timestamp is None:
        return None
    own_seconds = max(0.0, (last_timestamp - first_timestamp).total_seconds())
    if saw_resume_before_timestamp:
        parent_seconds = _active_training_metrics_for_job(folder, parent_id, visited)
        if parent_seconds is None:
            return None
        own_seconds += parent_seconds
    _legacy_active_time_cache[cache_key] = own_seconds
    return own_seconds


def history_metrics_response(folder, job_id):
    """Lazy timing endpoint; history listing never scans trainer logs."""
    with _lock:
        metrics = _active_training_metrics_for_job(folder, job_id)
    return {
        "ok": True,
        "metrics": {"activeTrainingSeconds": round(metrics) if metrics is not None else None},
    }, 200


def _start_active_training_session(job, started_at=None):
    job.pop("activeTrainingSessionFinalizedAt", None)
    job["activeTrainingSessionStartedAt"] = float(started_at or time.time())
    job.setdefault("activeTrainingSeconds", 0)
    job.setdefault("activeTrainingTimingComplete", True)


def _finish_active_training_session(job, finished_at=None):
    if job.get("activeTrainingSessionFinalizedAt") is not None:
        return
    if job.get("activeTrainingTimingComplete") is not True:
        job.pop("activeTrainingSessionStartedAt", None)
        job["activeTrainingSessionFinalizedAt"] = float(finished_at or time.time())
        return
    started_at = job.pop("activeTrainingSessionStartedAt", None)
    if started_at is None and "activeTrainingSeconds" not in job:
        started_at = job.get("startedAt")
    try:
        elapsed = max(0.0, float(finished_at or time.time()) - float(started_at))
        job["activeTrainingSeconds"] = max(0.0, float(job.get("activeTrainingSeconds") or 0)) + elapsed
    except (TypeError, ValueError):
        job["activeTrainingTimingComplete"] = False
        job.pop("activeTrainingSeconds", None)
    job["activeTrainingSessionFinalizedAt"] = float(finished_at or time.time())

def _file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _input_evidence(bundle_path, stages):
    bundle = Path(bundle_path)
    digest = hashlib.sha256()
    count = 0
    for source in (sorted((bundle / "media").rglob("*"), key=lambda path: path.as_posix().lower()) if (bundle / "media").is_dir() else []):
        if not source.is_file() or source.suffix.lower() == ".txt":
            continue
        prepared = source.relative_to(bundle / "media").as_posix()
        name = source.name
        count += 1
        digest.update(name.encode("utf-8"))
        caption = source.with_suffix(".txt")
        try:
            digest.update(caption.read_bytes())
        except OSError:
            digest.update(b"<missing-caption>")
    config_paths = sorted(bundle.glob("*.toml"), key=lambda path: path.name.lower())
    config_digest = hashlib.sha256()
    for path in config_paths:
        config_digest.update(path.name.encode("utf-8"))
        try:
            config_digest.update(path.read_bytes())
        except OSError:
            config_digest.update(b"<missing>")
    return {"count": count, "fingerprint": "sha256:" + digest.hexdigest(), "configFingerprint": "sha256:" + config_digest.hexdigest()}


def _model_identity(artifacts, profile_id="wan22_t2v", stage="hi"):
    source = ""
    pattern = re.compile(r"^\s*(?:model|model_path|checkpoint|base_model|ckpt_path|diffusion_model|transformer_path)\s*=\s*[\"']?([^\"'\n#]+)", re.MULTILINE | re.IGNORECASE)
    key = str(stage) + "Config"
    try:
        match = pattern.search(Path(artifacts[key]).read_text(encoding="utf-8"))
    except (KeyError, OSError):
        match = None
    if match:
        source = match.group(1).strip()
    source_name = Path(source).name if source else ""
    if source_name.lower().endswith((".safetensors", ".ckpt", ".pt")):
        source_name = Path(source_name).stem
    label = profile(profile_id)["label"]
    return {"label": label, "source": source}


def _read_config_positive_int(path, key, fallback=0):
    try:
        text = Path(str(path or "")).read_text(encoding="utf-8")
    except OSError:
        return int(fallback)
    match = re.search(r"^\s*" + re.escape(key) + r"\s*=\s*(\d+)\s*(?:#.*)?$", text, re.MULTILINE)
    return max(1, int(match.group(1))) if match else int(fallback)


def _plan_run_steps(progress_plan, snapshot):
    """Translate generated sample exposures into the trainer's visible batch steps."""
    if not isinstance(progress_plan, dict):
        return progress_plan
    planned = {}
    for stage_name, stage_plan in progress_plan.items():
        stage = dict(stage_plan) if isinstance(stage_plan, dict) else {}
        exposures = int(stage.get("estimatedSteps") or 0)
        has_generated_shape = exposures > 0 and int(stage.get("epochs") or 0) > 0
        if has_generated_shape:
            micro_batch = _read_config_positive_int(snapshot.get(stage_name), "micro_batch_size_per_gpu", 1)
            image_micro_batch = _read_config_positive_int(snapshot.get(stage_name), "image_micro_batch_size_per_gpu", micro_batch)
            image_exposures = int(stage.get("estimatedImageExposures") or 0)
            video_exposures = int(stage.get("estimatedVideoExposures") or 0)
            stage["sampleExposures"] = exposures
            stage["microBatchSize"] = micro_batch
            stage["imageMicroBatchSize"] = image_micro_batch
            if image_exposures or video_exposures:
                stage["estimatedSteps"] = int(math.ceil(float(image_exposures) / float(image_micro_batch))) + int(math.ceil(float(video_exposures) / float(micro_batch)))
            else:
                stage["estimatedSteps"] = int(math.ceil(float(exposures) / float(micro_batch)))
        planned[stage_name] = stage
    return planned


def _read_training_plan(bundle_path):
    path = Path(bundle_path) / "training_plan.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    stages = parsed.get("stages") if isinstance(parsed, dict) else None
    return stages if isinstance(stages, dict) else {}


def _default_progress_plan():
    hi_steps, lo_steps = repeat_targets()
    return {
        "hi": {"estimatedSteps": hi_steps},
        "lo": {"estimatedSteps": lo_steps},
    }


def _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage):
    if not str(resume_from_checkpoint or "").strip():
        return ""
    if stages in ("hi", "lo", "krea2", "wan21", "h3"):
        return stages
    value = str(resume_stage or "lo").strip().lower()
    if value not in ("hi", "lo"):
        raise ValueError("Resume stage must be hi or lo.")
    return value


def _build_runner_script(job, settings, artifacts, job_dir):
    stages = _normalize_training_stages(job.get("stages"))
    if stages in ("krea2", "wan21", "h3"):
        config_key = stages
        artifact_key = config_key + "Config"
        config_path = artifacts[artifact_key]
        hi_path = config_path
        lo_path = config_path
    elif stages == "hi":
        hi_path = artifacts["hiConfig"]
        lo_path = hi_path
    elif stages == "lo":
        lo_path = artifacts["loConfig"]
        hi_path = lo_path
    else:
        hi_path = artifacts["hiConfig"]
        lo_path = artifacts["loConfig"]
    distribution = settings["wslDistribution"]
    hi_wsl = _to_wsl_path(hi_path, distribution)
    lo_wsl = _to_wsl_path(lo_path, distribution)
    resume_stage = _normalize_resume_stage(stages, job.get("resumeFromCheckpoint"), job.get("resumeStage"))
    resume_path = str(job.get("resumeFromCheckpoint") or "").strip()
    if resume_path and not resume_path.startswith("/"):
        resume_path = _to_wsl_path(resume_path, distribution)
    command_plan = build_training_command_plan(
        hi_wsl,
        lo_wsl,
        build_training_launcher(settings),
        resume_path,
        resume_stage,
        reset_dataloader=bool(resume_path and not job.get("resumeOutputId")),
    )
    h3_command_plan = build_h3_command_plan(
        lo_wsl,
        build_training_launcher(settings),
        resume_path if resume_stage == "h3" else "",
        reset_dataloader=bool(resume_path and not job.get("resumeOutputId")),
    ) if stages == "h3" else None
    result_wsl = _to_wsl_path(job_dir / "result.json", distribution)
    pid_wsl = _to_wsl_path(job_dir / "pid", distribution)
    action_wsl = _to_wsl_path(_job_action_path(job), distribution)
    lines = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        "PID_FILE=" + shlex.quote(pid_wsl),
        "RESULT_FILE=" + shlex.quote(result_wsl),
        "ACTION_FILE=" + shlex.quote(action_wsl),
        "echo $$ > \"$PID_FILE\"",
        "write_result() { local tmp=\"${RESULT_FILE}.tmp.$$\"; printf '{\\\"status\\\":\\\"%s\\\",\\\"exitCode\\\":%s,\\\"finishedAt\\\":%s}\\n' \"$1\" \"$2\" \"$(date +%s)\" > \"$tmp\" && mv -f \"$tmp\" \"$RESULT_FILE\"; }",
        "finish_requested_stop() { case \"$(cat \"$ACTION_FILE\" 2>/dev/null || true)\" in pause|finish|stop) echo '[webcap] requested stop'; write_result stopped 130; exit 130 ;; esac; }",
        "trap 'echo [webcap] stopped; write_result stopped 130; exit 130' INT TERM",
        "cd " + shlex.quote(settings["cwd"]) + " || { echo '[webcap] training working directory is unavailable'; write_result failed 1; exit 1; }",
    ]
    if settings["activate"] and not has_conda_runtime(settings):
        lines.append("source " + shlex.quote(settings["activate"]) + " || { echo '[webcap] training activation failed'; write_result failed 1; exit 1; }")
    if resume_stage:
        lines.append("printf '%s\\n' " + shlex.quote(
            "[webcap] resume stage=" + resume_stage + " checkpoint=" + str(job.get("resumeFromCheckpoint") or "")
        ))
    if stages == "hi":
        lines.extend([
            "echo '[webcap] stage=hi'",
            "printf '%s\\n' " + shlex.quote("[webcap] command hi: " + command_plan["hiCommand"]),
            command_plan["hiCommand"],
            "HI_CODE=$?",
            "finish_requested_stop",
            "if [ \"$HI_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
            "if [ \"$HI_CODE\" -ne 0 ]; then echo '[webcap] HI failed'; write_result failed \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
        ])
    if stages == "lo":
        lines.extend([
            "echo '[webcap] stage=lo'",
            "printf '%s\\n' " + shlex.quote("[webcap] command lo: " + command_plan["loCommand"]),
            command_plan["loCommand"],
            "LO_CODE=$?",
            "finish_requested_stop",
            "if [ \"$LO_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
            "if [ \"$LO_CODE\" -ne 0 ]; then echo '[webcap] LO failed'; write_result failed \"$LO_CODE\"; exit \"$LO_CODE\"; fi",
        ])
    if stages in ("krea2", "wan21"):
        stage_title = "Krea2" if stages == "krea2" else "Wan2.1"
        stage_code = "KREA2" if stages == "krea2" else "WAN21"
        lines.extend([
            "echo '[webcap] stage=" + stages + "'",
            "printf '%s\\n' " + shlex.quote("[webcap] command " + stages + ": " + command_plan["loCommand"]),
            command_plan["loCommand"],
            stage_code + "_CODE=$?",
            "finish_requested_stop",
            "if [ \"$" + stage_code + "_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$" + stage_code + "_CODE\"; exit \"$" + stage_code + "_CODE\"; fi",
            "if [ \"$" + stage_code + "_CODE\" -ne 0 ]; then echo '[webcap] " + stage_title + " failed'; write_result failed \"$" + stage_code + "_CODE\"; exit \"$" + stage_code + "_CODE\"; fi",
        ])
    if stages == "h3":
        if settings.get("h3SplitCachePhase", False):
            lines.extend([
                "echo '[webcap] stage=h3-cache'",
                "printf '%s\\n' " + shlex.quote("[webcap] command h3 cache: " + h3_command_plan["cacheCommand"]),
                h3_command_plan["cacheCommand"],
                "H3_CACHE_CODE=$?",
                "finish_requested_stop",
                "if [ \"$H3_CACHE_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$H3_CACHE_CODE\"; exit \"$H3_CACHE_CODE\"; fi",
                "if [ \"$H3_CACHE_CODE\" -ne 0 ]; then echo '[webcap] MiniMax H3 cache failed'; write_result failed \"$H3_CACHE_CODE\"; exit \"$H3_CACHE_CODE\"; fi",
            ])
        h3_command = h3_command_plan["trainCommand"] if settings.get("h3SplitCachePhase", False) else h3_command_plan["singleCommand"]
        lines.extend([
            "echo '[webcap] stage=h3'",
            "printf '%s\\n' " + shlex.quote("[webcap] command h3: " + h3_command),
            h3_command,
            "H3_CODE=$?",
            "finish_requested_stop",
            "if [ \"$H3_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$H3_CODE\"; exit \"$H3_CODE\"; fi",
            "if [ \"$H3_CODE\" -ne 0 ]; then echo '[webcap] MiniMax H3 failed'; write_result failed \"$H3_CODE\"; exit \"$H3_CODE\"; fi",
        ])
    lines.extend(["echo '[webcap] completed'", "write_result completed 0"])
    script = "\n".join(lines) + "\n"
    return script, {"hi": hi_wsl, "lo": lo_wsl, "krea2": lo_wsl if stages == "krea2" else "", "wan21": lo_wsl if stages == "wan21" else "", "h3": lo_wsl if stages == "h3" else "", "usedSnapshot": False}


def _write_runner_script(job, settings, artifacts):
    job_dir = _job_dir(job)
    script, resolved = _build_runner_script(job, settings, artifacts, job_dir)
    path = job_dir / "runner.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    job["runnerScript"] = str(path)
    job["resolvedConfigs"] = dict(resolved, usedSnapshot=True)
    return path


def _launch_artifacts(job, artifacts):
    """Launch only the immutable artifacts captured when the job was queued."""
    return dict(artifacts)


def _launch_job(job, folder_path):
    launch_time = time.time()
    if not job.get("startedAt"):
        job["startedAt"] = launch_time
    job["updatedAt"] = launch_time
    job["status"] = "starting"
    job["stage"] = "launch"
    captured_artifacts = {
        key: Path(value)
        for key, value in (job.get("bundleArtifacts") or {}).items()
    }
    settings = _training_settings()
    job_dir = _job_dir(job)
    result_path = job_dir / "result.json"
    if result_path.exists():
        result_path.unlink()
    action_path = _job_action_path(job)
    if action_path.exists():
        action_path.unlink()
    try:
        launch_artifacts = _launch_artifacts(job, captured_artifacts)
        script_path = _write_runner_script(job, settings, launch_artifacts)
    except Exception as exc:
        job["status"] = "failed"
        job["stage"] = "launch"
        job["failureScope"] = "job"
        job["error"] = "Could not prepare the launch bundle: " + str(exc)
        job["finishedAt"] = time.time()
        return False
    script_wsl = _to_wsl_path(script_path, settings["wslDistribution"])
    log_path = job_dir / "run.log"
    log_wsl = _to_wsl_path(log_path, settings["wslDistribution"])
    launch = "setsid bash " + shlex.quote(script_wsl) + " > " + shlex.quote(log_wsl) + " 2>&1 < /dev/null & echo $!"
    code, stdout, stderr = _run_wsl(launch, timeout=15, distribution=settings["wslDistribution"])
    pid = (stdout or "").strip().splitlines()[-1] if (stdout or "").strip() else ""
    if code != 0 or not pid.isdigit():
        job["status"] = "failed"
        job["stage"] = "launch"
        job["error"] = (stderr or stdout).strip() or "Could not launch the managed training runner (exit " + str(code) + ")."
        job["finishedAt"] = time.time()
        return False
    job.update({
        "status": "starting",
        "stage": "starting",
        "pid": int(pid),
        "runnerScriptWsl": script_wsl,
        "runnerVerified": True,
        "updatedAt": time.time(),
        "logPath": str(log_path),
        "error": "",
    })
    _start_active_training_session(job)
    return True


def _read_result_evidence(job):
    path = _job_dir(job) / "result.json"
    if not path.exists():
        return "absent", None, ""
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return "unknown", None, "Runner result exists but could not be read: " + str(exc)
    if not isinstance(parsed, dict):
        return "unknown", None, "Runner result exists but is not a JSON object: " + str(path)
    return "result", parsed, ""

def _job_wsl_distribution(job):
    runtime = job.get("runtime") if isinstance(job.get("runtime"), dict) else {}
    return str(runtime.get("wslDistribution") or _training_settings()["wslDistribution"] or "").strip()

def _job_runner_pid(job):
    """Use the PID recorded by the runner when it is available."""
    try:
        recorded = (_job_dir(job) / "pid").read_text(encoding="utf-8").strip()
        if recorded.isdigit():
            return int(recorded)
    except OSError:
        pass
    try:
        return int(job.get("pid") or 0)
    except (TypeError, ValueError):
        return 0


def _job_runner_script_wsl(job):
    recorded = str(job.get("runnerScriptWsl") or "").strip()
    if recorded:
        return recorded
    script = str(job.get("runnerScript") or "").strip()
    if not script:
        script = str(_job_dir(job) / "runner.sh")
    if script.startswith("/"):
        return script
    return _to_wsl_path(script, _job_wsl_distribution(job))


def _inspect_job_runner(job):
    pid = _job_runner_pid(job)
    if pid <= 0:
        return "unknown", "Runner PID is not available."
    try:
        script_wsl = _job_runner_script_wsl(job)
    except Exception as exc:
        return "unknown", "Could not resolve the runner script in WSL: " + str(exc)
    proc_dir = "/proc/" + str(pid)
    command = (
        "if [ ! -d " + shlex.quote(proc_dir) + " ]; then exit 3; fi; "
        "if [ ! -r " + shlex.quote(proc_dir + "/cmdline") + " ]; then exit 4; fi; "
        "tr '\\0' '\\n' < " + shlex.quote(proc_dir + "/cmdline")
    )
    code, stdout, stderr = _run_wsl(command, timeout=8, distribution=_job_wsl_distribution(job))
    if code == 3:
        return "absent", ""
    if code != 0:
        detail = (stderr or stdout).strip() or "process inspection exited with code " + str(code)
        return "unknown", "Could not inspect the runner process: " + detail
    arguments = [line.strip() for line in (stdout or "").splitlines() if line.strip()]
    if script_wsl in arguments:
        job["pid"] = pid
        job["runnerScriptWsl"] = script_wsl
        return "running", ""
    return "absent", "Recorded runner PID is now used by a different process."


def _request_job_action(job, action, confirmation_note=""):
    pid = _job_runner_pid(job)
    if pid <= 0:
        return "WebCap has no recorded runner PID, so it cannot send the " + action + " request safely."
    if not job.get("runnerVerified"):
        return "WebCap has not verified the recorded runner process, so it cannot send the " + action + " request safely."
    action_path = _job_action_path(job)
    action_path.write_text(action, encoding="utf-8")
    code, stdout, stderr = _run_wsl(
        "kill -INT -- -" + str(pid), timeout=8, distribution=_job_wsl_distribution(job)
    )
    if code != 0:
        try:
            action_path.unlink()
        except OSError:
            pass
        return (stderr or stdout or "Could not send the " + action + " request.").strip()
    job["actionRequested"] = action
    job["actionRequestedAt"] = time.time()
    job["status"] = "stopping"
    job["stage"] = "stopping"
    job["confirmationNote"] = confirmation_note or action.capitalize() + " requested. Waiting for the runner result."
    job["updatedAt"] = time.time()
    return ""


def _checkpointed_stop_run_directory(job):
    """Find the one Diffusion-Pipe run belonging to this managed job."""
    raw_run_path = str(job.get("outputRunPath") or "").strip()
    if raw_run_path:
        run_dir = host_path_for_training_path(raw_run_path)
        if not run_dir.is_dir():
            raise ValueError("Recorded training run directory is unavailable: " + raw_run_path)
        return run_dir
    root = Path(str(job.get("outputRoot") or "").strip())
    if not root.is_dir():
        raise ValueError("The training output directory is not ready yet.")
    stage = str(job.get("stage") or job.get("stages") or "").strip()
    snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
    source_config = Path(str(snapshot.get(stage) or ""))
    if not source_config.is_file():
        raise ValueError("The captured training config is unavailable, so WebCap cannot identify this run safely.")
    source_hash = hashlib.sha256(source_config.read_bytes()).hexdigest()
    started_at = float(job.get("startedAt") or 0)
    matches = []
    for candidate in root.iterdir():
        if not candidate.is_dir() or candidate.name == ".webcap":
            continue
        try:
            if candidate.stat().st_mtime + 1 < started_at:
                continue
            copied_config = candidate / source_config.name
            if copied_config.is_file() and hashlib.sha256(copied_config.read_bytes()).hexdigest() == source_hash:
                matches.append(candidate)
        except OSError:
            continue
    if len(matches) != 1:
        detail = "none" if not matches else str(len(matches))
        raise ValueError("WebCap could not identify exactly one active training run (found " + detail + ").")
    job["outputRunPath"] = str(matches[0])
    return matches[0]


def _latest_checkpoint_mtime(run_dir):
    try:
        return (Path(run_dir) / "latest").stat().st_mtime
    except OSError:
        return 0.0


def _recorded_runner_action(job):
    action = str(job.get("actionRequested") or "").strip()
    if action:
        return action
    try:
        action = _job_action_path(job).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return action if action in ("pause", "finish", "stop") else ""


def _request_checkpointed_stop(job, action):
    """Ask Diffusion-Pipe to save its current state and exit without signalling it."""
    if action not in ("pause", "finish"):
        raise ValueError("Checkpointed stop action must be Pause or Finish.")
    action_label = "Pause" if action == "pause" else "Finish"
    if str(job.get("actionRequested") or "") == action:
        return ""
    if job.get("actionRequested"):
        return "Another runner action is already pending."
    if str(job.get("stage") or "") not in _SAVE_PAUSE_TRAINING_STAGES:
        return action_label + " is available once training has started; caching and setup do not have a resumable checkpoint."
    pid = _job_runner_pid(job)
    if pid <= 0:
        return "WebCap has no recorded runner PID, so it cannot request " + action_label + " safely."
    if not job.get("runnerVerified"):
        return "WebCap has not verified the recorded runner process, so it cannot request " + action_label + " safely."
    try:
        run_dir = _checkpointed_stop_run_directory(job)
    except (OSError, RuntimeError, ValueError) as exc:
        return str(exc)
    action_path = _job_action_path(job)
    try:
        action_path.write_text(action, encoding="utf-8")
        (run_dir / "save_quit").touch(exist_ok=True)
    except OSError as exc:
        try:
            if action_path.read_text(encoding="utf-8").strip() == action:
                action_path.unlink()
        except OSError:
            pass
        return "Could not request the Diffusion-Pipe checkpoint save: " + str(exc)
    job["actionRequested"] = action
    job["actionRequestedAt"] = time.time()
    job["checkpointedStopLatestMtime"] = _latest_checkpoint_mtime(run_dir)
    job["status"] = "stopping"
    job["stage"] = "saving"
    job["confirmationNote"] = action_label + " requested. Waiting for the current step and checkpoint save."
    job["updatedAt"] = time.time()
    return ""


def _checkpointed_stop_error(job, action):
    action_label = "Pause" if action == "pause" else "Finish"
    raw_run_path = str(job.get("outputRunPath") or "").strip()
    if not raw_run_path:
        return action_label + " ended without a recorded training run."
    try:
        run_dir = host_path_for_training_path(raw_run_path)
        latest_mtime = _latest_checkpoint_mtime(run_dir)
        baseline_mtime = float(job.get("checkpointedStopLatestMtime") or job.get("savePauseLatestMtime") or 0)
        if latest_mtime <= baseline_mtime:
            return action_label + " ended without a newly written checkpoint."
        folder_path = app_config.safe_join_fs_root(job["folder"])
        validate_resumable_run_for_path(folder_path, str(job.get("stages") or ""), raw_run_path)
    except (OSError, RuntimeError, ValueError) as exc:
        return action_label + " checkpoint could not be verified: " + str(exc)
    return ""


def _trigger_scheduled_finish(job):
    target_epoch = int(job.get("finishAfterEpoch") or 0)
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    current_epoch = int(progress.get("epoch") or 0)
    if target_epoch <= 0 or current_epoch <= target_epoch:
        return False
    error = _request_checkpointed_stop(job, "finish")
    if error:
        job["error"] = "Scheduled Finish could not be sent after epoch " + str(target_epoch) + " saved: " + error
        job["updatedAt"] = time.time()
        return False
    job["finishTriggeredEpoch"] = target_epoch
    job.pop("finishAfterEpoch", None)
    job.pop("finishScheduledAt", None)
    job.pop("error", None)
    return True


def _bind_job_run_path_from_log(job, log_text):
    """Remember the trainer-authored timestamp directory once a checkpoint is saved."""
    if job.get("outputRunPath"):
        return
    matches = _CHECKPOINT_SAVE_PATH_PATTERN.findall(str(log_text or ""))
    if matches:
        job["outputRunPath"] = matches[-1].strip().strip("'\"")
        job["updatedAt"] = time.time()
        return
    # Diffusion Pipe normally logs the checkpoint path.  If that line has
    # rotated away, bind only one post-start timestamp directory whose copied
    # config is byte-identical to the captured immutable config.
    root = Path(str(job.get("outputRoot") or ""))
    config_path = Path(str((job.get("bundleArtifacts") or {}).get(str(job.get("stages") or "") + "Config") or ""))
    started = float(job.get("startedAt") or 0)
    if not root.is_dir() or not config_path.is_file():
        return
    try:
        wanted = hashlib.sha256(config_path.read_bytes()).hexdigest()
        candidates = []
        for child in root.iterdir():
            if not child.is_dir() or child.is_symlink() or child.stat().st_mtime < started:
                continue
            if any(hashlib.sha256(path.read_bytes()).hexdigest() == wanted for path in child.glob("config*.toml") if path.is_file()):
                candidates.append(child)
    except OSError:
        return
    if len(candidates) == 1:
        job["outputRunPath"] = str(candidates[0])
        job["updatedAt"] = time.time()


def _sync_job_log_evidence(job):
    log_path = Path(job.get("logPath") or "")
    if not log_path.is_file():
        return "", None
    try:
        log_mtime = log_path.stat().st_mtime
        tail = _read_log_tail(log_path)
    except OSError:
        return "", None
    if tail.rfind("[webcap] stage=h3-cache") > tail.rfind("[webcap] stage=h3\n"):
        job["stage"] = "caching"
    elif "[webcap] stage=h3" in tail:
        job["stage"] = "h3"
    elif "[webcap] stage=wan21" in tail:
        job["stage"] = "wan21"
    elif "[webcap] stage=krea2" in tail:
        job["stage"] = "krea2"
    elif "[webcap] stage=lo" in tail:
        job["stage"] = "lo"
    elif "[webcap] stage=hi" in tail:
        job["stage"] = "hi"
    _bind_job_run_path_from_log(job, tail)
    _sync_job_progress(job, tail)
    return tail, log_mtime


def _apply_terminal_job_status(job, result_status=""):
    requested_action = _recorded_runner_action(job)
    if requested_action in ("pause", "finish"):
        checkpoint_error = _checkpointed_stop_error(job, requested_action)
        if checkpoint_error:
            job["status"] = "interrupted"
            job["stage"] = "checkpoint_failed"
            job["error"] = checkpoint_error
        elif requested_action == "pause":
            _queue_paused_job(job)
        else:
            job["status"] = "completed" if result_status == "completed" else "finished_early"
    elif requested_action == "stop":
        job["status"] = "stopped"
    elif result_status == "stopped" or not result_status:
        job["status"] = "interrupted"
    else:
        job["status"] = result_status
    return requested_action


def _queue_paused_job(job):
    """Return paused work to the front as ordinary queued resume intent."""
    resume_path = str(job.get("outputRunPath") or "").strip()
    if resume_path:
        job["resumeFromCheckpoint"] = resume_path
        job["resumeStage"] = str(job.get("stages") or "")
        job["outputRunPath"] = ""
    else:
        job.pop("resumeFromCheckpoint", None)
        job.pop("resumeStage", None)
        job.pop("resumePoint", None)
        job.pop("resumePointError", None)
    for field in (
        "pid", "runnerVerified", "actionRequested", "actionRequestedAt", "startedAt", "finishedAt",
        "lastLogAt", "exitCode", "failureScope", "failureExcerpt", "completionNote", "confirmationNote",
        "finishAfterEpoch", "finishScheduledAt", "finishTriggeredEpoch", "progress", "error", "checkpointedStopLatestMtime", "savePauseLatestMtime",
    ):
        job.pop(field, None)
    job["status"] = "queued"
    job["stage"] = "queued"
    job["updatedAt"] = time.time()


def _record_unverified_runner(job, detail):
    """Expose missing runner evidence without inventing a new queue state."""
    message = (
        "WebCap could not verify the recorded training runner and left this job unchanged. "
        + str(detail or "No runner evidence is available.").strip()
    )
    job.pop("runnerVerified", None)
    if job.get("error") != message:
        job["error"] = message
        job["updatedAt"] = time.time()
    return {"holdReason": ""}


def _distributed_socket_hold_reason(log_text):
    text = str(log_text or "").lower()
    has_distributed_context = "torch.distributed" in text or "_create_c10d_store" in text
    has_server_socket_failure = "server socket has failed to listen" in text
    has_address_conflict = "eaddrinuse" in text or "address already in use" in text
    if has_distributed_context and has_server_socket_failure and has_address_conflict:
        return _DISTRIBUTED_SOCKET_HOLD_REASON
    return ""


def _remove_stale_terminal_history(job):
    folder = str(job.get("folder") or "").strip()
    if not folder:
        return
    try:
        clear_history_job(app_config.safe_join_fs_root(folder), job.get("id"))
    except (OSError, ValueError):
        _logger.warning("Could not remove stale terminal training history for recovered job %s", job.get("id"))


def _clear_terminal_projection(job):
    for field in ("finishedAt", "exitCode", "failureScope", "failureExcerpt", "completionNote", "error"):
        job.pop(field, None)


def _terminal_projection_signature(job):
    fields = (
        "status", "stage", "error", "completionNote", "exitCode", "failureScope", "failureExcerpt",
        "finishedAt", "resumeFromCheckpoint", "resumeStage", "outputRunPath", "progress",
    )
    return json.dumps({field: job.get(field) for field in fields}, sort_keys=True, default=str)


def _refresh_job(job):
    if str(job.get("status") or "") in QUEUE_STATUSES | {"cancelled"}:
        return {"holdReason": ""}
    prior_status = str(job.get("status") or "")
    result_state, result, result_error = _read_result_evidence(job)
    has_runner_evidence = bool(
        job.get("pid") or job.get("runnerScript") or job.get("runnerScriptWsl") or (_job_dir(job) / "pid").exists()
    )
    if result_state == "absent" and not has_runner_evidence:
        if prior_status in ACTIVE_STATUSES:
            return _record_unverified_runner(job, "Runner PID and script evidence are unavailable.")
        return {"holdReason": ""}
    if not job.get("progressPlan"):
        job["progressPlan"] = _default_progress_plan()
    if result_state == "result":
        prior_projection = _terminal_projection_signature(job)
        prior_updated_at = job.get("updatedAt")
        job.pop("runnerVerified", None)
        result_status = str(result.get("status") or "failed")
        tail, _ = _sync_job_log_evidence(job)
        failure_excerpt = tail[-8192:]
        job.pop("confirmationNote", None)
        job.pop("error", None)
        exit_code = int(result.get("exitCode") or 0)
        _finish_active_training_session(job, result.get("finishedAt"))
        requested_action = _apply_terminal_job_status(job, result_status)
        if job["status"] == "queued":
            return {"holdReason": "", "pauseQueue": requested_action == "pause"}
        if job["status"] == "interrupted" and result_status == "stopped" and requested_action not in ("finish", "stop", "pause"):
            job["error"] = "Runner stopped without a WebCap stop action."
        job["exitCode"] = exit_code
        if job["status"] == "failed":
            job["failureExcerpt"] = failure_excerpt
            job["failureScope"] = "system" if _distributed_socket_hold_reason(failure_excerpt) else "unknown"
            job["error"] = "Training process exited with code " + str(exit_code) + ". See failure details or open the run log."
        job["finishedAt"] = float(result.get("finishedAt") or time.time())
        job.pop("finishAfterEpoch", None)
        job.pop("finishScheduledAt", None)
        _annotate_completed_job(job)
        _annotate_finished_early_job(job)
        if _terminal_projection_signature(job) != prior_projection:
            job["updatedAt"] = time.time()
        elif prior_updated_at is not None:
            job["updatedAt"] = prior_updated_at
        else:
            job.pop("updatedAt", None)
        checkpoint_failed = requested_action in ("pause", "finish") and job["status"] == "interrupted"
        hold_reason = "Checkpoint-safe " + ("Pause" if requested_action == "pause" else "Finish") + " could not verify a new checkpoint. Queue held for manual recovery." if checkpoint_failed else (
            _distributed_socket_hold_reason(failure_excerpt) if job["status"] == "failed" and prior_status != "failed" else ""
        )
        return {"holdReason": hold_reason}
    now = time.time()
    tail, log_mtime = _sync_job_log_evidence(job)
    log_has_progress = _log_has_progress(tail)
    if log_mtime is not None:
        job["lastLogAt"] = log_mtime
    runner_pid = _job_runner_pid(job)
    if runner_pid:
        job["pid"] = runner_pid
    process_state, process_detail = _inspect_job_runner(job)
    if process_state == "running":
        if prior_status in HISTORY_STATUSES:
            _remove_stale_terminal_history(job)
        _clear_terminal_projection(job)
        job["runnerVerified"] = True
        job["status"] = "stopping" if job.get("actionRequested") else ("running" if log_has_progress else "starting")
        job.pop("confirmationNote", None)
        job["updatedAt"] = now
        _trigger_scheduled_finish(job)
        return {"holdReason": ""}
    if process_state == "unknown":
        if prior_status in ACTIVE_STATUSES:
            return _record_unverified_runner(job, result_error or process_detail)
        return {"holdReason": ""}
    if prior_status in ACTIVE_STATUSES and not job.get("actionRequested"):
        return _record_unverified_runner(
            job,
            result_error or "The recorded runner is no longer active and did not write a result record.",
        )
    prior_projection = _terminal_projection_signature(job)
    prior_updated_at = job.get("updatedAt")
    prior_finished_at = job.get("finishedAt")
    job.pop("confirmationNote", None)
    job.pop("runnerVerified", None)
    requested_action = _apply_terminal_job_status(job)
    if requested_action in ("pause", "finish"):
        _finish_active_training_session(job, now)
    if job["status"] == "queued":
        return {"holdReason": "", "pauseQueue": requested_action == "pause"}
    if requested_action not in ("finish", "stop"):
        job["error"] = result_error or process_detail or "Training runner is no longer available and did not write a result record."
    job["finishedAt"] = prior_finished_at if job["status"] == prior_status and prior_finished_at is not None else now
    job.pop("finishAfterEpoch", None)
    job.pop("finishScheduledAt", None)
    _annotate_finished_early_job(job)
    if _terminal_projection_signature(job) != prior_projection:
        job["updatedAt"] = now
    elif prior_updated_at is not None:
        job["updatedAt"] = prior_updated_at
    else:
        job.pop("updatedAt", None)
    checkpoint_failed = requested_action in ("pause", "finish") and job["status"] == "interrupted"
    return {
        "holdReason": "Checkpoint-safe " + ("Pause" if requested_action == "pause" else "Finish") + " could not verify a new checkpoint. Queue held for manual recovery."
        if checkpoint_failed else ""
    }


def _launch_next_queued_job(state):
    if state.get("queuePaused"):
        return
    if any(job.get("status") in ACTIVE_STATUSES for job in state.get("jobs", [])):
        return
    state["activeJobId"] = ""
    for job in state.get("jobs", []):
        if job.get("status") not in QUEUE_STATUSES:
            continue
        folder_path = app_config.safe_join_fs_root(job["folder"])
        _launch_job(job, folder_path)
        if job.get("status") in ACTIVE_STATUSES:
            state["activeJobId"] = job["id"]
            return
        if job.get("status") == "failed":
            continue


def _refresh_state(state):
    global _startup_reconciled
    hold_reason = ""
    pause_requested = False
    for job in state.get("jobs", []):
        if job.get("status") == "queued" and not job.get("progressPlan"):
            job["progressPlan"] = _default_progress_plan()
        if job.get("status") == "completed":
            _annotate_completed_job(job)
        outcome = _refresh_job(job) if job.get("status") not in QUEUE_STATUSES | {"cancelled"} else None
        if outcome and outcome.get("holdReason"):
            hold_reason = outcome["holdReason"]
        if outcome and outcome.get("pauseQueue"):
            pause_requested = True
    active_jobs = [job for job in state.get("jobs", []) if job.get("status") in ACTIVE_STATUSES]
    state["activeJobId"] = active_jobs[0]["id"] if active_jobs else ""
    if len(active_jobs) > 1:
        state["runnerNotice"] = (
            str(len(active_jobs)) + " managed runners are active or awaiting confirmation. "
            "The queue will wait until only derived terminal results remain."
        )
    else:
        state.pop("runnerNotice", None)
    if pause_requested:
        state["queuePaused"] = True
        state["queuePauseReason"] = state.get("queuePauseReason") or "Queue paused by the user."
    if hold_reason:
        state["queuePaused"] = True
        state["queuePauseReason"] = hold_reason
    queued_jobs = [job for job in state.get("jobs", []) if job.get("status") in QUEUE_STATUSES]
    if not _startup_reconciled and queued_jobs and not active_jobs:
        state["queuePaused"] = True
        state["queuePauseReason"] = state.get("queuePauseReason") or "Queue waiting for manual start after WebCap restarted."
    _startup_reconciled = True
    _launch_next_queued_job(state)


def _monitor_loop():
    while True:
        try:
            with _lock:
                state = _read_state()
                _refresh_state(state)
                _persist_reconciled_state(state)
        except Exception:
            _logger.exception("Training queue monitor failed; the existing queue state was not replaced.")
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(target=_monitor_loop, name="webcap-training-runner", daemon=True)
        _monitor_thread.start()


def start_observer():
    """Start queue observation independently of whether Training is open."""
    _ensure_monitor_started()


def _public_job(job):
    fields = ("id", "folder", "stages", "profileId", "profileLabel", "mode", "runId", "actionRunId", "datasetTarget", "modelLabel", "model", "input", "artifactDir", "artifactSummary", "actionId", "actionPath", "runName", "recordPath", "inputPath", "bundleSummary", "capturedItemCount", "resumeFromCheckpoint", "resumeStage", "resumePoint", "resumePointError", "resumeActionId", "resumeOutputId", "outputRunPath", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt", "updatedAt", "lastLogAt", "error", "confirmationNote", "completionNote", "exitCode", "failureScope", "failureExcerpt", "resolvedConfigs", "preflight", "outputRoot", "effectiveOutputDir", "outputSlug", "sequence", "parentJobId", "progress", "progressPlan", "actionRequested", "actionRequestedAt", "finishAfterEpoch", "finishScheduledAt", "finishTriggeredEpoch", "activeTrainingSeconds", "activeTrainingTimingComplete")
    payload = {field: job.get(field) for field in fields if field in job}
    if job.get("status") == "queued":
        folder = str(job.get("folder") or "").strip()
        try:
            available = bool(folder) and Path(app_config.safe_join_fs_root(folder)).is_dir()
        except ValueError:
            available = False
        if not available:
            payload["sourceUnavailable"] = "Set folder is currently unavailable; this job remains queued."
    return payload


def validate_response(folder, stages="", resume_from_checkpoint="", resume_stage="", resume_action_id="", resume_output_id="", profile_id="", run_id="", mode="normal", selected_media=None, fallback_captions=None, selection_criteria=None, total_media_count=None):
    try:
        _, selected_run = profile_run(profile_id, run_id)
        stages = selected_run["stages"][0]
        stages = _normalize_training_stages(stages)
        requested_resume = bool(resume_action_id or resume_output_id)
        if bool(resume_action_id) != bool(resume_output_id):
            raise ValueError("A managed resume requires both an action and output selection.")
        resume_path = str(resume_from_checkpoint or "").strip()
        if resume_path and requested_resume:
            raise ValueError("Choose either a managed checkpoint or a filesystem checkpoint, not both.")
        resume_stage = _normalize_resume_stage(stages, resume_path or ("managed" if requested_resume else ""), resume_stage)
        selected_mode = normalize_mode(mode)
        _, folder_path = _resolve_folder(folder)
        resume = resolve_managed_resume(folder_path, resume_action_id, resume_output_id, resume_stage) if requested_resume else (
            validate_resumable_run_for_path(folder_path, resume_stage, resume_path) if resume_path else None
        )
        payload = _preflight_payload(folder, stages, profile_id=profile_id, mode=selected_mode)
        settings = payload.pop("settings")
        artifacts = {key: Path(value) for key, value in payload.pop("artifacts").items()}
        blockers = [item for item in payload["checks"] if item["severity"] == "blocker" and not item["ok"]]
        if blockers:
            warnings = [item for item in payload["checks"] if item["severity"] == "warning" and not item["ok"]]
            payload["ok"] = False
            payload["summary"] = {"blockers": len(blockers), "warnings": len(warnings)}
            payload.pop("folderPath", None)
            return payload, 200
        diagnostic_job = {
            "id": "diagnostic",
            "snapshot": ({"krea2": str(artifacts["krea2Config"])} if stages == "krea2" else {"wan21": str(artifacts["wan21Config"])} if stages == "wan21" else {"h3": str(artifacts["h3Config"])} if stages == "h3" else {"hi": str(artifacts["hiConfig"]), "lo": str(artifacts["loConfig"])}),
            "stages": stages,
            "resumeFromCheckpoint": str(resume["runPath"]) if resume else "",
            "resumeStage": resume_stage,
        }
        try:
            script, resolved = _build_runner_script(diagnostic_job, settings, artifacts, _runtime_root() / "diagnostic")
            payload["runnerScript"] = script
            payload["resolvedConfigs"] = resolved
            code, stdout, stderr = _run_wsl(
                "bash -n -c " + shlex.quote(script),
                timeout=15,
                distribution=settings["wslDistribution"],
            )
            payload["checks"].append(_make_check(
                "runner_syntax", "blocker", code == 0,
                "Generated runner script has valid Bash syntax." if code == 0 else "Generated runner script has invalid Bash syntax.",
                (stdout + stderr).strip(),
            ))
        except Exception as exc:
            payload["runnerScript"] = ""
            payload["scriptError"] = str(exc)
            payload["checks"].append(_make_check("runner_syntax", "blocker", False, "Could not build the runner script.", str(exc)))
        blockers = [item for item in payload["checks"] if item["severity"] == "blocker" and not item["ok"]]
        warnings = [item for item in payload["checks"] if item["severity"] == "warning" and not item["ok"]]
        payload["ok"] = not blockers
        payload["summary"] = {"blockers": len(blockers), "warnings": len(warnings)}
        payload.pop("folderPath", None)
        return payload, 200
    except Exception as exc:
        return {"ok": False, "error": str(exc), "checks": [], "summary": {"blockers": 1, "warnings": 0}}, 400


def _new_job(
    folder,
    preflight,
    stages,
    bundle,
    output_root,
    effective_output_dir,
    resume_from_checkpoint="",
    resume_stage="",
    parent_job_id="",
    profile_id="",
    run_id="",
    mode="normal",
    action_root=None,
    run_name="",
    resume_action_id="",
    resume_output_id="",
    parent_active_seconds=None,
):
    job_id = uuid.uuid4().hex[:12]
    _, folder_path = _resolve_folder(folder)
    stages = _normalize_training_stages(stages)
    selected_profile, _ = profile_run(profile_id, run_id)
    selected_mode = normalize_mode(mode)
    config_meta = config_for_stage(selected_profile["id"], stages, selected_mode)
    output_slug = config_meta["outputSlug"]
    resume_path = str(resume_from_checkpoint or "").strip()
    distribution = _training_settings()["wslDistribution"]
    action_root = Path(action_root)
    job_dir = action_root / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    artifacts = {key: Path(value) for key, value in bundle["artifacts"].items()}
    snapshot = {stages: str(artifacts[stages + "Config"])}
    progress_plan = _plan_run_steps(_read_training_plan(bundle.get("recordPath") or bundle["path"]) or _default_progress_plan(), snapshot)
    input_evidence = _input_evidence(bundle.get("inputPath") or bundle["path"], stages)
    model = _model_identity(artifacts, selected_profile["id"], stages)
    sequence_match = re.match(r"^(\d+)-", action_root.name)
    action_run_id = str(run_id or "")
    return {
        "id": job_id,
        "folder": folder,
        "stages": stages,
        "profileId": selected_profile["id"],
        "profileLabel": selected_profile["label"],
        "mode": selected_mode,
        "runId": action_run_id,
        "actionRunId": action_run_id,
        "modelLabel": model["label"],
        "model": model,
        "datasetTarget": selected_mode,
        "input": input_evidence,
        "resumeFromCheckpoint": resume_path,
        "resumeStage": _normalize_resume_stage(stages, resume_path, resume_stage),
        "outputRunPath": "",
        "resumePoint": {},
        "status": "queued",
        "stage": "queued",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "snapshot": snapshot,
        "actionId": action_id_for_root(action_root),
        "actionPath": str(action_root),
        "runName": str(run_name or ""),
        "recordPath": str(bundle.get("recordPath") or bundle["path"]),
        "inputPath": str(bundle.get("inputPath") or bundle["path"]),
        "bundleArtifacts": {key: str(value) for key, value in artifacts.items()},
        "bundleSummary": bundle.get("summary") or {},
        "capturedItemCount": int(bundle.get("capturedItemCount") or 0),
        "artifactPath": str(job_dir),
        "artifactDir": str(job_dir),
        "progressPlan": progress_plan,
        "runtime": {"wslDistribution": distribution},
        "preflight": {"checks": preflight.get("checks", []), "blockers": preflight.get("summary", {}).get("blockers", 0)},
        "outputRoot": str(output_root),
        "effectiveOutputDir": effective_output_dir,
        "outputSlug": output_slug,
        "sequence": sequence_match.group(1) if sequence_match else "",
        "resumeActionId": str(resume_action_id or ""),
        "resumeOutputId": str(resume_output_id or ""),
        "parentJobId": str(parent_job_id or ""),
        "activeTrainingSeconds": float(parent_active_seconds or 0),
        "activeTrainingTimingComplete": parent_active_seconds is not None,
    }


def _bundle_from_action(action_id, profile_id, mode, stages):
    path, record_root, input_root, action = action_paths(action_id)
    selected = profile_for_mode(profile_id, mode)
    stage_names = (stages,)
    artifacts = {
        "manifest": input_root / "dataset_manifest.json",
        "plan": record_root / "training_plan.json",
    }
    summary_path = record_root / "bundle_summary.json"
    if summary_path.is_file():
        artifacts["summary"] = summary_path
    for stage in stage_names:
        item = next(item for item in selected["configs"] if item["id"] == stage)
        artifacts[stage + "Config"] = record_root / "configs" / item["file"]
        artifacts[stage + "Dataset"] = record_root / "configs" / item["dataset"]
    missing = [str(value) for value in artifacts.values() if not Path(value).is_file()]
    if missing:
        raise FileNotFoundError("Captured training files are missing: " + ", ".join(missing))
    try:
        manifest = json.loads(artifacts["manifest"].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.is_file() else {}
    except (OSError, ValueError):
        summary = {}
    rows = (manifest.get("images") or []) + (manifest.get("videos") or []) if isinstance(manifest, dict) else []
    return {"path": path, "recordPath": record_root, "inputPath": input_root, "artifacts": artifacts, "summary": summary, "capturedItemCount": len(rows), "action": action}


def _bundle_from_recorded_capture(action_id, capture_path, folder_path, profile_id, mode, stages):
    """Reuse a known action capture for Recent Runs and paused-resume launches."""
    action_root, action = read_action(action_id)
    expected_folder = Path(folder_path).resolve().relative_to(Path(app_config.FS_ROOT).resolve()).as_posix()
    if str(action.get("folder") or "") != expected_folder:
        raise ValueError("The recorded training capture belongs to another set.")
    if str(action.get("profileId") or "") != str(profile_id or ""):
        raise ValueError("The recorded training capture belongs to a different model.")
    if stages not in action.get("requestedStages", ()):
        raise ValueError("The recorded training capture does not include the selected training stage.")
    capture = Path(str(capture_path or "")).resolve()
    captures_root = (action_root / "captures").resolve()
    try:
        capture.relative_to(captures_root)
    except ValueError as exc:
        raise ValueError("The recorded training capture is outside its action folder.") from exc
    if not capture.is_dir() or capture.is_symlink():
        raise FileNotFoundError("The recorded training capture is unavailable: " + str(capture))
    selected = profile_for_mode(profile_id, mode)
    stage_names = (stages,)
    artifacts = {}
    for stage in stage_names:
        item = next((item for item in selected["configs"] if item["id"] == stage), None)
        if item is None:
            raise ValueError("The recorded capture does not support the selected training stage.")
        artifacts[stage + "Config"] = capture / item["file"]
        artifacts[stage + "Dataset"] = capture / item["dataset"]
    summary_path = capture / "summary.json"
    missing = [str(path) for path in list(artifacts.values()) + [summary_path] if not path.is_file()]
    if missing:
        raise FileNotFoundError("Recorded training capture is missing required files: " + ", ".join(missing))
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("Could not read recorded training capture summary: " + str(exc)) from exc
    if not isinstance(summary, dict):
        raise ValueError("Recorded training capture summary is invalid.")
    return {
        "path": capture,
        "recordPath": capture,
        "inputPath": capture,
        "artifacts": artifacts,
        "summary": summary,
        "capturedItemCount": int(summary.get("capturedItems") or 0),
        "action": action,
        "reused": True,
    }


def start_response(
    folder,
    queue=False,
    stages="",
    resume_from_checkpoint="",
    resume_stage="",
    parent_job_id="",
    run_name="",
    resume_action_id="",
    resume_output_id="",
    profile_id="",
    run_id="",
    mode="normal",
    selected_media=None,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
    initializer_action_id="",
    initializer_export_id="",
    initializer_stage="",
    initializer_custom_path="",
    force_constant_lr=None,
    reuse_capture_action_id="",
    reuse_capture_path="",
):
    try:
        selected_profile, selected_run = profile_run(profile_id, run_id)
        selected_mode = normalize_mode(mode)
        stages = _normalize_training_stages(selected_run["stages"][0])
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint or resume_output_id, resume_stage)
        _, folder_path = _resolve_folder(folder)
        reuse_capture = bool(str(reuse_capture_action_id or "").strip() or str(reuse_capture_path or "").strip())
        if reuse_capture and (not str(reuse_capture_action_id or "").strip() or not str(reuse_capture_path or "").strip()):
            raise ValueError("Recent Run resume requires its recorded action and capture path.")
        review = None if reuse_capture else prepare_training_review(
            folder_path, selected_profile["id"], selected_run["id"], selected_media,
            selection_criteria, total_media_count, fallback_captions, persist=False,
        )
        initializer = None
        if initializer_action_id or initializer_export_id or initializer_stage or initializer_custom_path:
            if reuse_capture:
                raise ValueError("A recorded-capture resume cannot add a LoRA initializer.")
            if resume_from_checkpoint or resume_output_id:
                raise ValueError("Checkpoint Resume and LoRA initialization cannot be combined.")
            if initializer_custom_path:
                initializer = {
                    "sourcePath": Path(str(initializer_custom_path).strip()),
                    "exportId": "custom",
                    "actionId": "",
                    "epoch": "",
                }
            else:
                initializer = resolve_saved_initializer(folder_path, selected_profile["id"], initializer_stage, initializer_action_id, initializer_export_id)
            initializer["stage"] = initializer_stage
            initializer["forceConstantLr"] = force_constant_lr
        resume_path = str(resume_from_checkpoint or "").strip()
        if bool(resume_action_id) != bool(resume_output_id):
            raise ValueError("A managed resume requires both an action and output selection.")
        if resume_path and resume_output_id:
            raise ValueError("Choose either a managed checkpoint or a filesystem checkpoint, not both.")
        resume_action = None
        if resume_output_id and not resume_path:
            resume = resolve_managed_resume(folder_path, resume_action_id, resume_output_id, resume_stage)
            resume_path = str(resume["runPath"])
            resume_action = resume["actionRoot"]
        elif resume_path:
            validate_resumable_run_for_path(folder_path, resume_stage, resume_path)
        if reuse_capture:
            action_root, action = read_action(str(reuse_capture_action_id).strip())
            bundle = _bundle_from_recorded_capture(
                str(reuse_capture_action_id).strip(), reuse_capture_path, folder_path,
                selected_profile["id"], selected_mode, stages,
            )
        elif resume_action is not None:
            action_root = resume_action
            action = read_action(action_id_for_root(action_root))[1]
        else:
            action_root, action = allocate_action(folder_path, selected_profile, selected_mode, (stages,), run_name)
        distribution = _training_settings()["wslDistribution"]
        output_root = action_root / "output"
        output_root.mkdir(parents=True, exist_ok=True)
        output_dir = _to_wsl_path(output_root, distribution)
        if not reuse_capture:
            bundle = materialize_training_bundle(
                folder_path, action_root, selected_profile["id"], selected_mode, stages, selected_media,
                fallback_captions=fallback_captions, selection_criteria=selection_criteria,
                total_media_count=total_media_count, output_dirs={stages: output_dir},
                distribution=distribution, review=review if not review.get("customDataset") else None,
                initializer=initializer,
            )
    except Exception as exc:
        return {"ok": False, "error": "Could not create the training capture: " + str(exc)}, 400

    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        active = _find_job(state, state.get("activeJobId")) if state.get("activeJobId") else None
        preflight = {"checks": [], "summary": {"blockers": 0, "warnings": 0}}
        job = _new_job(
            str(folder).strip(), preflight, stages, bundle, output_root, output_dir,
            resume_path, resume_stage, "", selected_profile["id"], selected_run["id"], selected_mode,
            action_root, str(action.get("runName") or run_name), resume_action_id, resume_output_id, 0,
        )
        def record_capture(data):
            if not reuse_capture:
                try:
                    capture_path = Path(bundle["path"]).relative_to(action_root).as_posix()
                except ValueError:
                    capture_path = str(Path(bundle["path"]))
                data.setdefault("captures", []).append({
                    "jobId": job["id"], "path": capture_path,
                    "createdAt": job["createdAt"], "count": int(bundle.get("capturedItemCount") or 0),
                })
            data.setdefault("jobs", {}).setdefault(job["stages"], []).append({
                "id": job["id"], "path": (Path("jobs") / job["id"]).as_posix(), "status": "queued", "createdAt": job["createdAt"],
            })
        update_action(action_id_for_root(action_root), record_capture)
        state["jobs"].append(job)
        if not active and not state.get("queuePaused"):
            _launch_next_queued_job(state)
        _write_state(state)
        return {"ok": True, "job": _public_job(job), "jobs": [_public_job(job)], "queued": job.get("status") == "queued"}, 200


def folder_statuses_for_folders(folder_paths):
    """Return the small training-status payload used by the folder backlog view."""
    with _lock:
        try:
            state = _read_state()
        except TrainingStateError:
            _logger.exception("Training queue state is unavailable; omitting folder training badges.")
            return {}
        jobs = list(state.get("jobs", []))
    queue_position = 0
    queued_by_folder = {}
    for job in jobs:
        if job.get("status") in QUEUE_STATUSES:
            queue_position += 1
            queued_by_folder.setdefault(str(job.get("folder") or ""), {"position": queue_position, "status": job.get("status")})
    result = {}
    for folder_path in folder_paths:
        path = Path(folder_path)
        try:
            folder = str(path.relative_to(app_config.FS_ROOT)).replace("\\", "/")
        except ValueError:
            continue
        matching = [job for job in jobs if str(job.get("folder") or "") == folder]
        active = next((job for job in matching if job.get("status") in ACTIVE_STATUSES), None)
        if active:
            result[path] = {"status": "training", "label": "Training", "jobId": active.get("id"), "stage": active.get("stages")}
        elif folder in queued_by_folder:
            queued = queued_by_folder[folder]
            result[path] = {"status": "queued", "label": "Queued #" + str(queued["position"]), "queuePosition": queued["position"]}
        else:
            try:
                # Folder navigation must not recursively scan potentially huge
                # trainer output trees just to render a status badge.
                required_stages, completed = completed_stages(path, include_discovered_runs=False)
            except Exception:
                _logger.exception("Could not determine training status for folder: %s", path)
                result[path] = {"status": "error", "label": "Training status unavailable"}
                continue
            if required_stages and len(completed) == len(required_stages):
                result[path] = {"status": "trained", "label": "Trained"}
            elif completed:
                result[path] = {"status": "partial", "label": "Partially trained"}
            elif any(
                all((path / name).is_file() for name in (
                    [item["file"] for item in setup["configs"]] + list(setup["datasetFiles"])
                ))
                for profile_item in training_profiles()
                for setup in profile_item["setups"].values()
            ) or (
                all((path / name).is_file() for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"))
                and _prepared_dataset_is_ready(path)
            ):
                needs_review, partial_count, touched_count = _needs_partial_annotation_caption_review(path)
                if needs_review:
                    result[path] = {
                        "status": "caption-review",
                        "label": "Caption review needed (" + str(partial_count) + " of " + str(touched_count) + ")",
                    }
                else:
                    result[path] = {"status": "ready", "label": "Ready to train"}
            else:
                result[path] = {"status": "never", "label": ""}
    return result


def status_response():
    with _lock:
        _ensure_monitor_started()
        try:
            state = _read_state()
        except TrainingStateError as exc:
            return {"ok": False, "stateError": True, "error": str(exc)}, 409
        _refresh_state(state)
        _persist_reconciled_state(state)
        return {
            "ok": True,
            "activeJobId": state.get("activeJobId") or "",
            "queuePaused": bool(state.get("queuePaused")),
            "queuePauseReason": str(state.get("queuePauseReason") or ""),
            "runnerNotice": str(state.get("runnerNotice") or ""),
            "jobs": [_public_job(job) for job in state.get("jobs", [])],
        }, 200


def clear_history_response(folder, job_id):
    folder_text = str(folder or "").strip()
    job_id = str(job_id or "").strip()
    if not folder_text or not job_id:
        return {"ok": False, "error": "Folder and job ID are required."}, 400
    with _lock:
        folder_path = app_config.safe_join_fs_root(folder_text)
        state = _read_state()
        job = _find_job(state, job_id)
        if job and str(job.get("folder") or "") == folder_text:
            job["historyHidden"] = True
            job["updatedAt"] = time.time()
        cleared = clear_history_job(folder_path, job_id)
        _write_state(state)
        return {"ok": True, "cleared": cleared}, 200


def gpu_status_response():
    return {"ok": True, "gpu": _gpu_snapshot()}, 200


def _tensorboard_settings():
    training = app_config.config.get("training") if isinstance(app_config.config, dict) else {}
    training = training if isinstance(training, dict) else {}
    port = training.get("tensorboard_port", 6006)
    if isinstance(port, bool):
        port = 6006
    try:
        port = int(port)
    except (TypeError, ValueError):
        port = 6006
    if port < 1 or port > 65535:
        port = 6006
    return {
        "port": port,
        "controlEnabled": training.get("tensorboard_bruteforce_control") is True,
    }


def _tensorboard_url(port):
    return "http://localhost:" + str(port)


def _probe_tensorboard(port):
    url = "http://127.0.0.1:" + str(port) + "/"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "WebCap TensorBoard status probe"})
        with urllib.request.urlopen(request, timeout=_TENSORBOARD_PROBE_TIMEOUT_SECONDS) as response:
            html = response.read(_TENSORBOARD_PROBE_BYTES).decode("utf-8", errors="replace").lower()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, socket.error) as exc:
        detail = str(getattr(exc, "reason", "") or exc).strip()
        return False, detail or "No service responded on the configured local port."
    if "tensorboard" not in html:
        return False, "A service responded on the configured port, but it did not identify itself as TensorBoard."
    return True, ""


def _localhost_port_occupied(port):
    try:
        connection = socket.create_connection(("127.0.0.1", int(port)), timeout=_TENSORBOARD_PROBE_TIMEOUT_SECONDS)
    except (OSError, ValueError):
        return False
    connection.close()
    return True


def _tensorboard_status_payload():
    settings = _tensorboard_settings()
    running, diagnostic = _probe_tensorboard(settings["port"])
    return {
        "running": running,
        "port": settings["port"],
        "url": _tensorboard_url(settings["port"]),
        "controlEnabled": settings["controlEnabled"],
        "diagnostic": diagnostic,
    }


def tensorboard_status_response():
    return {"ok": True, "tensorboard": _tensorboard_status_payload()}, 200


def _tensorboard_runs_root():
    return Path(app_config.FS_ROOT) / "output" / "runs"


def _tensorboard_log_path():
    return _runtime_root() / "tensorboard.log"


def _tensorboard_runtime_command(settings, wsl_logdir, port):
    command = "tensorboard --logdir " + shlex.quote(wsl_logdir) + " --port " + str(port)
    return _activation_prefix(settings) + _build_runtime_command(settings, command)


def _tensorboard_matching_pids(settings, wsl_logdir):
    # Read argv entries, rather than process text, so the logdir comparison remains exact.
    command = """target_logdir=%s
for proc in /proc/[0-9]*; do
  [ -r \"$proc/cmdline\" ] || continue
  pid=${proc##*/}
  mapfile -d '' -t args < \"$proc/cmdline\" || continue
  has_tensorboard=0
  has_logdir=0
  for i in \"${!args[@]}\"; do
    arg=${args[$i]}
    base=${arg##*/}
    case \"$base\" in
      tensorboard|tensorboard.exe|tensorboard.main|tensorboard.main.*) has_tensorboard=1 ;;
    esac
    if [ \"$arg\" = \"--logdir=$target_logdir\" ]; then has_logdir=1; fi
    if [ \"$arg\" = \"--logdir\" ] && [ \"${args[$((i + 1))]:-}\" = \"$target_logdir\" ]; then has_logdir=1; fi
  done
  if [ \"$has_tensorboard\" = 1 ] && [ \"$has_logdir\" = 1 ]; then printf '%%s\\n' \"$pid\"; fi
done""" % shlex.quote(wsl_logdir)
    code, stdout, stderr = _run_wsl(command, timeout=10, distribution=settings["wslDistribution"])
    if code != 0:
        detail = (stderr or stdout or "WSL process inspection failed.").strip()
        raise RuntimeError(detail)
    return sorted({line.strip() for line in stdout.splitlines() if line.strip().isdigit()}, key=int)


def _terminate_tensorboard_pids(settings, pids):
    safe_pids = [pid for pid in pids if str(pid).isdigit()]
    if not safe_pids:
        return
    joined = " ".join(shlex.quote(str(pid)) for pid in safe_pids)
    command = (
        "pids=(" + joined + "); "
        "kill -TERM -- \"${pids[@]}\" 2>/dev/null || true; "
        "sleep 1; "
        "for pid in \"${pids[@]}\"; do kill -0 \"$pid\" 2>/dev/null && kill -KILL -- \"$pid\" 2>/dev/null || true; done"
    )
    code, stdout, stderr = _run_wsl(command, timeout=8, distribution=settings["wslDistribution"])
    if code != 0:
        detail = (stderr or stdout or "WSL TensorBoard termination failed.").strip()
        raise RuntimeError(detail)


def _wait_for_tensorboard(port, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    diagnostic = ""
    while time.monotonic() < deadline:
        running, diagnostic = _probe_tensorboard(port)
        if running:
            return True, diagnostic
        time.sleep(0.25)
    return False, diagnostic


def tensorboard_control_response(action):
    action = str(action or "").strip().lower()
    if action not in {"start", "restart"}:
        return {"ok": False, "error": "TensorBoard action must be start or restart."}, 400
    settings = _tensorboard_settings()
    if not settings["controlEnabled"]:
        return {"ok": False, "error": "TensorBoard brute-force control is disabled in Training Settings."}, 403

    port = settings["port"]
    runtime_settings = _training_settings()
    log_path = _tensorboard_log_path()
    try:
        if action == "start":
            if _localhost_port_occupied(port):
                return {"ok": False, "error": "The configured TensorBoard port is already in use. Use Restart only for the matching global TensorBoard.", "logPath": str(log_path)}, 409
        else:
            runs_wsl_path = _to_wsl_path(_tensorboard_runs_root(), runtime_settings["wslDistribution"])
            pids = _tensorboard_matching_pids(runtime_settings, runs_wsl_path)
            if pids:
                _terminate_tensorboard_pids(runtime_settings, pids)
                if _localhost_port_occupied(port):
                    time.sleep(1)
                if _localhost_port_occupied(port):
                    return {"ok": False, "error": "The TensorBoard port is still in use after terminating the matching process.", "logPath": str(log_path)}, 409
            elif _localhost_port_occupied(port):
                return {"ok": False, "error": "The configured port is in use by a service WebCap could not verify as this global TensorBoard.", "logPath": str(log_path)}, 409

        runs_root = _tensorboard_runs_root()
        runs_root.mkdir(parents=True, exist_ok=True)
        _ensure_runtime_dirs()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_wsl_path = _to_wsl_path(log_path, runtime_settings["wslDistribution"])
        if action == "start":
            runs_wsl_path = _to_wsl_path(runs_root, runtime_settings["wslDistribution"])
        launch = "nohup " + _tensorboard_runtime_command(runtime_settings, runs_wsl_path, port) + " >> " + shlex.quote(log_wsl_path) + " 2>&1 < /dev/null &"
        code, stdout, stderr = _run_wsl(launch, timeout=10, distribution=runtime_settings["wslDistribution"])
        if code != 0:
            detail = (stderr or stdout or "WSL TensorBoard launch failed.").strip()
            return {"ok": False, "error": detail, "logPath": str(log_path)}, 502
        running, diagnostic = _wait_for_tensorboard(port, 10)
        if not running:
            detail = diagnostic or "TensorBoard did not become available within 10 seconds."
            return {"ok": False, "error": detail, "logPath": str(log_path)}, 502
    except Exception as exc:
        return {"ok": False, "error": str(exc), "logPath": str(log_path)}, 502
    return {"ok": True, "tensorboard": _tensorboard_status_payload(), "logPath": str(log_path)}, 200


def log_response(job_id, offset=0, tail=False, folder=""):
    with _lock:
        state = _read_state()
        _refresh_state(state)
        job = _find_job(state, job_id)
        _persist_reconciled_state(state)
        if not job:
            job = _find_history_job(folder, job_id)
        if not job:
            return {"error": "Training job not found"}, 404
        path = Path(job.get("logPath") or (_job_dir(job) / "run.log"))
        try:
            position = max(0, int(offset or 0))
        except (TypeError, ValueError):
            position = 0
        if not path.exists():
            return {"ok": True, "job": _public_job(job), "offset": 0, "nextOffset": 0, "text": ""}, 200
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            if tail:
                position = max(0, size - 65536)
            else:
                position = min(position, size)
            handle.seek(position)
            raw = handle.read(65536)
            next_offset = handle.tell()
        return {
            "ok": True,
            "job": _public_job(job),
            "offset": position,
            "nextOffset": next_offset,
            "text": raw.decode("utf-8", errors="replace"),
            "truncated": bool(tail and position > 0),
        }, 200


def log_path_for_job(job_id, folder=""):
    """Return the managed log path for a known job; never accept a caller path."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id) or _find_history_job(folder, job_id)
        if not job:
            raise ValueError("Training job not found")
        path = _job_dir(job) / "run.log"
        if not path.is_file():
            raise FileNotFoundError("Training log is not available yet")
        return path


def output_path_for_job(job_id):
    """Return the trainer-created run directory, or its parent before binding."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id)
        if not job:
            raise ValueError("Training job was not found.")
        raw_run_path = str(job.get("outputRunPath") or "").strip()
        if raw_run_path:
            path = host_path_for_training_path(raw_run_path)
            if not path.is_dir():
                raise FileNotFoundError("Recorded training run directory is unavailable: " + raw_run_path)
            return path
        raw_path = str(job.get("outputRoot") or "").strip()
        if not raw_path:
            raise ValueError("Training job has no effective output directory.")
        return Path(raw_path)


def action_path_for_job(job_id, folder=""):
    """Return the visible action parent for a known job; never accept a caller path."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id) or _find_history_job(folder, job_id)
        if not job:
            raise ValueError("Training job not found")
        path = Path(str(job.get("actionPath") or ""))
        if not path.is_dir():
            raise FileNotFoundError("Training action folder is unavailable")
        return path


def stop_response(job_id, cancel=False, pause=False, finish=False):
    with _lock:
        state = _read_state()
        _refresh_state(state)
        job = _find_job(state, job_id)
        if not job:
            return {"ok": False, "error": "Training job not found"}, 404
        if job.get("status") in QUEUE_STATUSES and cancel:
            job["status"] = "cancelled"
            job["stage"] = "cancelled"
            job["finishedAt"] = time.time()
            job["updatedAt"] = time.time()
            job["historyHidden"] = True
            folder = str(job.get("folder") or "").strip()
            if folder:
                clear_history_job(app_config.safe_join_fs_root(folder), job.get("id"))
            _write_state(state)
            return {"ok": True, "job": _public_job(job)}, 200
        if cancel:
            return {"ok": False, "error": "Only queued training jobs can be cancelled. Use Pause or Finish for the active job."}, 400
        if job.get("status") not in ACTIVE_STATUSES:
            return {"ok": False, "error": "Training job is not running."}, 400
        action = "pause" if pause else "finish" if finish else "stop"
        message = _request_checkpointed_stop(job, action) if action in ("pause", "finish") else _request_job_action(job, action)
        if message:
            job["error"] = message
            job["updatedAt"] = time.time()
            _write_state(state)
            status = 502 if message.startswith("Could not request the Diffusion-Pipe checkpoint save:") else 409 if (
                action in ("pause", "finish") or "no recorded runner PID" in message or "not verified" in message
            ) else 502
            return {"ok": False, "error": message, "job": _public_job(job)}, status
        if pause:
            state["queuePaused"] = True
            state["queuePauseReason"] = "Queue paused by the user."
        job.pop("finishAfterEpoch", None)
        job.pop("finishScheduledAt", None)
        _write_state(state)
        return {"ok": True, "job": _public_job(job)}, 200


def finish_schedule_response(job_id, epoch=None, cancel=False):
    with _lock:
        state = _read_state()
        _refresh_state(state)
        job = _find_job(state, job_id)
        if not job:
            return {"ok": False, "error": "Training job not found"}, 404
        if cancel:
            job.pop("finishAfterEpoch", None)
            job.pop("finishScheduledAt", None)
            job["updatedAt"] = time.time()
            _write_state(state)
            return {"ok": True, "job": _public_job(job)}, 200
        if job.get("status") not in ("starting", "running"):
            return {"ok": False, "error": "Only an active training job can schedule Finish."}, 400
        raw_epoch = str(epoch or "").strip()
        if not raw_epoch.isdigit() or int(raw_epoch) <= 0:
            return {"ok": False, "error": "Finish epoch must be a positive whole number."}, 400
        target_epoch = int(raw_epoch)
        progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
        current_epoch = int(progress.get("epoch") or 0)
        planned_epochs = int(progress.get("epochs") or 0)
        stage = str(progress.get("stage") or "")
        if current_epoch <= 0 or planned_epochs <= 0 or stage not in ("hi", "lo", "krea2", "wan21", "h3"):
            return {"ok": False, "error": "Wait until the runner reports its current epoch before scheduling Finish."}, 409
        if target_epoch < current_epoch:
            return {"ok": False, "error": "Finish epoch must be the current epoch or a future epoch."}, 400
        if target_epoch >= planned_epochs:
            return {"ok": False, "error": "Finish epoch must be before the planned final epoch."}, 400
        job["finishAfterEpoch"] = target_epoch
        job["finishScheduledAt"] = time.time()
        job.pop("finishTriggeredEpoch", None)
        job["updatedAt"] = time.time()
        _write_state(state)
        return {"ok": True, "job": _public_job(job)}, 200


def reorder_response(job_id, direction):
    if direction not in ("up", "down"):
        return {"ok": False, "error": "Queue direction must be up or down."}, 400
    with _lock:
        state = _read_state()
        queued_indexes = [index for index, job in enumerate(state.get("jobs", [])) if job.get("status") in QUEUE_STATUSES]
        current = next((index for index in queued_indexes if state["jobs"][index].get("id") == job_id), None)
        if current is None:
            return {"ok": False, "error": "Queued training job not found."}, 404
        queue_position = queued_indexes.index(current)
        target_position = queue_position - 1 if direction == "up" else queue_position + 1
        if target_position < 0 or target_position >= len(queued_indexes):
            return {"ok": False, "error": "Training job cannot move further in the queue."}, 400
        target = queued_indexes[target_position]
        state["jobs"][current], state["jobs"][target] = state["jobs"][target], state["jobs"][current]
        state["jobs"][current]["updatedAt"] = time.time()
        state["jobs"][target]["updatedAt"] = time.time()
        _persist_reconciled_state(state)
        return {"ok": True, "jobs": [_public_job(job) for job in state["jobs"]]}, 200


def resume_queue_response():
    with _lock:
        state = _read_state()
        _refresh_state(state)
        state["queuePaused"] = False
        state["queuePauseReason"] = ""
        _refresh_state(state)
        _persist_reconciled_state(state)
        if state.get("queuePaused") and not state.get("activeJobId"):
            return {
                "ok": False,
                "error": state.get("queuePauseReason") or "No queued training job was started.",
                "jobs": [_public_job(job) for job in state["jobs"]],
            }, 409
        return {"ok": True, "activeJobId": state.get("activeJobId") or "", "jobs": [_public_job(job) for job in state["jobs"]]}, 200
