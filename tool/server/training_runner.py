import json
import logging
import math
import os
import re
import shlex
import shutil
import threading
import time
import uuid
from pathlib import Path

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_commands import build_training_command_plan
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME, KREA2_CONFIG_NAME, WAN21_CONFIG_NAME, with_output_dir
from .training_profiles import config_for_stage, profile_run
from .dataset_config import repeat_targets_for_mode
from .training_history import (
    HISTORY_FILE_NAME,
    discover_runs,
    validate_resumable_run_for_path,
    resume_point_from_directory,
    host_path_for_training_path,
    training_output_group_for_folder,
)
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
    build_training_launcher,
    configured_training_settings as _training_settings,
    has_conda_runtime,
    run_wsl as _run_wsl,
    to_wsl_path as _to_wsl_path,
)


RUNNER_DIR_NAME = TRAINING_RUNTIME_DIR_NAME
STATE_FILE_NAME = "queue.json"
STATE_VERSION = 4
ACTIVE_STATUSES = {"starting", "running", "stopping", "unconfirmed"}
TERMINAL_OUTCOMES = {"completed", "finished_early"}
FAILED_OUTCOMES = {"failed", "interrupted", "stopped"}
_lock = threading.Lock()
_monitor_lock = threading.Lock()
_monitor_thread = None
_handoff_job_id = ""
_startup_checked = False
_logger = logging.getLogger(__name__)
_CHECKPOINT_SAVE_PATH_PATTERN = re.compile(r"Saving model checkpoint:\s+(.+?)[/\\]global_step\d+[/\\]")

_JOB_FIELDS = (
    "id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel",
    "resumeFromCheckpoint", "resumeStage", "createdAt", "outputRoot", "effectiveOutputDir", "outputSlug",
    "launchGroupId", "sequence", "launchGroupRoot", "artifactDir", "parentJobId", "finishAfterEpoch",
)
_RECENT_FIELDS = (
    "id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel",
    "status", "createdAt", "startedAt", "finishedAt", "error", "completionNote", "exitCode",
    "failureExcerpt", "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence",
    "launchGroupRoot", "artifactDir", "logPath", "outputRunPath", "resumeFromCheckpoint", "resumeStage",
    "progress", "parentJobId",
)


def _runtime_root():
    return Path(app_config.FS_ROOT) / RUNNER_DIR_NAME


def _state_path():
    return _runtime_root() / STATE_FILE_NAME


def _ensure_runtime_dirs():
    _runtime_root().mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(_runtime_root())


def _default_state():
    return {"version": STATE_VERSION, "jobs": [], "recentRuns": []}


class TrainingStateError(RuntimeError):
    pass


def _clean_string(value):
    return str(value or "").strip()


def _serialized_job(job):
    serialized = {field: job.get(field) for field in _JOB_FIELDS if field in job}
    if not _clean_string(serialized.get("artifactDir")) and _clean_string(job.get("artifactPath")):
        serialized["artifactDir"] = _clean_string(job.get("artifactPath"))
    serialized["id"] = _clean_string(serialized.get("id"))
    serialized["folder"] = _clean_string(serialized.get("folder"))
    serialized["stages"] = _clean_string(serialized.get("stages"))
    serialized["artifactDir"] = _clean_string(serialized.get("artifactDir"))
    if not serialized["id"] or not serialized["folder"] or not serialized["stages"] or not serialized["artifactDir"]:
        raise TrainingStateError("Training queue contains an incomplete job intent.")
    return serialized


def _serialized_recent(job):
    serialized = {field: job.get(field) for field in _RECENT_FIELDS if field in job}
    serialized["id"] = _clean_string(serialized.get("id"))
    if not serialized["id"]:
        raise TrainingStateError("Recent Runs contains an entry without an ID.")
    return serialized


def _serialized_state(state):
    if not isinstance(state, dict):
        raise TrainingStateError("Training state must be a JSON object.")
    jobs = state.get("jobs")
    recent = state.get("recentRuns")
    if not isinstance(jobs, list) or not isinstance(recent, list):
        raise TrainingStateError("Training state must contain jobs and recentRuns lists.")
    if any(not isinstance(job, dict) for job in jobs):
        raise TrainingStateError("Training queue contains an invalid job intent.")
    if any(not isinstance(job, dict) for job in recent):
        raise TrainingStateError("Recent Runs contains an invalid entry.")
    clean_jobs = [_serialized_job(job) for job in jobs]
    clean_recent = [_serialized_recent(job) for job in recent]
    job_ids = [job["id"] for job in clean_jobs]
    recent_ids = [job["id"] for job in clean_recent]
    if len(job_ids) != len(set(job_ids)):
        raise TrainingStateError("Training queue contains duplicate job IDs.")
    if len(recent_ids) != len(set(recent_ids)):
        raise TrainingStateError("Recent Runs contains duplicate job IDs.")
    if set(job_ids) & set(recent_ids):
        raise TrainingStateError("A training job cannot be both queued and in Recent Runs.")
    return {"version": STATE_VERSION, "jobs": clean_jobs, "recentRuns": clean_recent}


def _compact_legacy_recent(job):
    status = _clean_string(job.get("status"))
    if status == "cancelled":
        return None
    record = {field: job.get(field) for field in _RECENT_FIELDS if field in job}
    record["id"] = _clean_string(job.get("id"))
    if not record["id"]:
        return None
    record["status"] = status or "interrupted"
    if "artifactDir" not in record and job.get("artifactPath"):
        record["artifactDir"] = job.get("artifactPath")
    return record


def _legacy_history_records():
    root = Path(app_config.FS_ROOT)
    records = []
    if not root.is_dir():
        return records
    for path in root.rglob(HISTORY_FILE_NAME):
        if _runtime_root() in path.parents or "auto_dataset" in path.parts:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise TrainingStateError("Could not migrate set training metadata; it was left unchanged: " + str(path)) from exc
        if not isinstance(data, dict) or data.get("version") not in (3, STATE_VERSION):
            raise TrainingStateError("Set training metadata is invalid; it was left unchanged: " + str(path))
        legacy_jobs = data.get("jobs") or []
        if not isinstance(legacy_jobs, list) or any(not isinstance(job, dict) for job in legacy_jobs):
            raise TrainingStateError("Set training history is invalid; it was left unchanged: " + str(path))
        try:
            relative = str(path.parent.relative_to(root)).replace("\\", "/")
        except ValueError:
            relative = ""
        for job in legacy_jobs:
            candidate = dict(job)
            if relative:
                candidate["folder"] = relative
            compact = _compact_legacy_recent(candidate)
            if compact:
                records.append(compact)
    return records


def _legacy_current_candidate(parsed):
    jobs = [job for job in parsed.get("jobs") or [] if isinstance(job, dict)]
    active_id = _clean_string(parsed.get("activeJobId"))
    if active_id:
        active = next((job for job in jobs if _clean_string(job.get("id")) == active_id), None)
        if active and _clean_string(active.get("status")) in ACTIVE_STATUSES | {"paused"}:
            return active
        if active and _clean_string(active.get("status")) == "interrupted":
            bundle = _clean_string(active.get("artifactDir") or active.get("artifactPath"))
            try:
                has_pid_file = bool(bundle) and (host_path_for_training_path(bundle) / "pid").is_file()
            except (OSError, RuntimeError, ValueError):
                has_pid_file = False
            if active.get("pid") or has_pid_file:
                return active
    active = next((job for job in jobs if _clean_string(job.get("status")) in ACTIVE_STATUSES | {"paused"}), None)
    if active:
        return active
    # A legacy interrupted record with a PID is the only additional candidate
    # worth preserving as current work. The version-4 observer will verify only
    # this one job and will never search for additional runners.
    for job in jobs:
        if _clean_string(job.get("status")) != "interrupted":
            continue
        bundle = _clean_string(job.get("artifactDir") or job.get("artifactPath"))
        try:
            has_pid_file = bool(bundle) and (host_path_for_training_path(bundle) / "pid").is_file()
        except (OSError, RuntimeError, ValueError):
            has_pid_file = False
        if job.get("pid") or has_pid_file:
            return job
    return None


def _migrate_v3_state(parsed):
    raw_jobs = parsed.get("jobs")
    if not isinstance(raw_jobs, list) or any(not isinstance(job, dict) for job in raw_jobs):
        raise TrainingStateError("Existing version-3 training jobs are invalid; the state was left unchanged.")
    legacy_jobs = list(raw_jobs)
    legacy_ids = [_clean_string(job.get("id")) for job in legacy_jobs]
    valid_statuses = ACTIVE_STATUSES | TERMINAL_OUTCOMES | FAILED_OUTCOMES | {"queued", "paused", "cancelled"}
    if any(not job_id for job_id in legacy_ids) or len(legacy_ids) != len(set(legacy_ids)):
        raise TrainingStateError("Existing version-3 training job IDs are invalid; the state was left unchanged.")
    if any(_clean_string(job.get("status")) not in valid_statuses for job in legacy_jobs):
        raise TrainingStateError("Existing version-3 training job status is invalid; the state was left unchanged.")
    current = _legacy_current_candidate(parsed)
    current_id = _clean_string((current or {}).get("id"))
    pending = []
    if current:
        pending.append(_serialized_job(current))
    for job in legacy_jobs:
        job_id = _clean_string(job.get("id"))
        if not job_id or job_id == current_id:
            continue
        if _clean_string(job.get("status")) in ACTIVE_STATUSES | {"queued", "paused"}:
            pending.append(_serialized_job(job))

    recent_by_id = {}
    for record in _legacy_history_records():
        recent_by_id[record["id"]] = record
    for job in legacy_jobs:
        if _clean_string(job.get("id")) == current_id:
            continue
        if _clean_string(job.get("status")) in TERMINAL_OUTCOMES | FAILED_OUTCOMES:
            record = _compact_legacy_recent(job)
            if record:
                recent_by_id[record["id"]] = record
    for job in pending:
        recent_by_id.pop(job["id"], None)

    migrated = _serialized_state({
        "jobs": pending,
        "recentRuns": sorted(
            recent_by_id.values(),
            key=lambda job: float(job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0),
            reverse=True,
        ),
    })
    _write_state(migrated)
    _strip_legacy_history_files()
    return migrated


def _strip_legacy_history_files():
    root = Path(app_config.FS_ROOT)
    if not root.is_dir():
        return
    for path in root.rglob(HISTORY_FILE_NAME):
        if _runtime_root() in path.parents or "auto_dataset" in path.parts:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise TrainingStateError("Could not reduce set training metadata; it was left unchanged: " + str(path)) from exc
        if not isinstance(data, dict) or data.get("version") not in (3, STATE_VERSION):
            raise TrainingStateError("Set training metadata is invalid; it was left unchanged: " + str(path))
        replacement = {"version": STATE_VERSION}
        output_group = _clean_string(data.get("outputGroup"))
        if output_group:
            replacement["outputGroup"] = output_group
        tmp = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with tmp.open("x", encoding="utf-8") as handle:
                json.dump(replacement, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
            normalize_path_permissions(path)
        finally:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass


def _read_state():
    _ensure_runtime_dirs()
    path = _state_path()
    if not path.exists():
        return _default_state()
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TrainingStateError("Could not read the existing training queue state; it was left unchanged: " + str(path)) from exc
    if not isinstance(parsed, dict):
        raise TrainingStateError("Existing training queue state is not a JSON object; it was left unchanged: " + str(path))
    if parsed.get("version") == 3:
        return _migrate_v3_state(parsed)
    if parsed.get("version") != STATE_VERSION:
        raise TrainingStateError("Unsupported training queue state version; it was left unchanged: " + str(path))
    return _serialized_state(parsed)


def _write_state(state):
    _ensure_runtime_dirs()
    path = _state_path()
    payload = _serialized_state(state)
    tmp = path.with_name("." + path.name + "." + str(os.getpid()) + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass
    normalize_path_permissions(path)


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
        for job in state.get("recentRuns", []):
            folder = str(job.get("folder") or "").strip().replace("\\", "/").strip("/")
            if folder == old_folder:
                job["folder"] = new_folder
            elif folder.startswith(prefix):
                job["folder"] = new_folder + folder[len(old_folder):]
            else:
                continue
            changed += 1
        if changed:
            _write_state(state)
        return changed


def _job_dir(job):
    """Job-owned artifacts live beside trainer output, not in the queue state area."""
    path = _clean_string((job or {}).get("artifactDir")) if isinstance(job, dict) else ""
    if not path:
        raise TrainingStateError("Training job has no WebCap bundle path.")
    try:
        candidate = host_path_for_training_path(path).resolve()
    except (OSError, RuntimeError, ValueError) as exc:
        raise TrainingStateError("Training job bundle path could not be resolved.") from exc
    owned_root = (Path(app_config.FS_ROOT) / "output" / "runs").resolve()
    try:
        relative = candidate.relative_to(owned_root)
    except ValueError as exc:
        raise TrainingStateError("Training job bundle is outside WebCap's output area.") from exc
    job_id = _clean_string((job or {}).get("id"))
    parts = relative.parts
    if len(parts) < 4 or tuple(parts[-3:-1]) != (".webcap", "jobs") or parts[-1] != job_id:
        raise TrainingStateError("Training job bundle path does not match its job ID.")
    return candidate


def _job_action_path(job):
    return _job_dir(job) / "action"




def _find_job(state, job_id):
    for job in state.get("jobs", []):
        if str(job.get("id") or "") == str(job_id or ""):
            return job
    return None


def _find_history_job(state, folder, job_id):
    folder_text = _clean_string(folder)
    wanted = str(job_id or "").strip()
    if not wanted:
        return None
    return next(
        (
            job for job in state.get("recentRuns", [])
            if str(job.get("id") or "") == wanted
            and (not folder_text or _clean_string(job.get("folder")) == folder_text)
        ),
        None,
    )





def _training_profile(folder_path):
    try:
        plan = json.loads((Path(folder_path) / "auto_dataset" / "training_plan.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        plan = {}
    mode = str(plan.get("mode") or "").lower() if isinstance(plan, dict) else ""
    return mode if mode in ("poc", "normal", "quality") else "unknown"




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
            stage["sampleExposures"] = exposures
            stage["microBatchSize"] = micro_batch
            stage["estimatedSteps"] = int(math.ceil(float(exposures) / float(micro_batch)))
        planned[stage_name] = stage
    return planned




def _read_training_plan(folder_path):
    path = Path(folder_path) / "auto_dataset" / "training_plan.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    stages = parsed.get("stages") if isinstance(parsed, dict) else None
    return stages if isinstance(stages, dict) else {}


def _default_progress_plan():
    hi_steps, lo_steps = repeat_targets_for_mode("normal")
    return {
        "hi": {"estimatedSteps": hi_steps},
        "lo": {"estimatedSteps": lo_steps},
    }


def _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage):
    if not str(resume_from_checkpoint or "").strip():
        return ""
    if stages in ("hi", "lo", "krea2", "wan21"):
        return stages
    value = str(resume_stage or "lo").strip().lower()
    if value not in ("hi", "lo"):
        raise ValueError("Resume stage must be hi or lo.")
    return value


def _build_runner_script(job, settings, artifacts, job_dir):
    stages = _normalize_training_stages(job.get("stages"))
    if stages in ("krea2", "wan21"):
        config_key = "krea2" if stages == "krea2" else "wan21"
        artifact_key = config_key + "Config"
        config_path = artifacts[artifact_key]
        hi_path = config_path
        lo_path = config_path
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
    )
    result_wsl = _to_wsl_path(job_dir / "result.json", distribution)
    pid_wsl = _to_wsl_path(job_dir / "pid", distribution)
    action_wsl = _to_wsl_path(Path(job_dir) / "action", distribution)
    lines = [
        "#!/usr/bin/env bash",
        "set -uo pipefail",
        "PID_FILE=" + shlex.quote(pid_wsl),
        "RESULT_FILE=" + shlex.quote(result_wsl),
        "ACTION_FILE=" + shlex.quote(action_wsl),
        "echo $$ > \"$PID_FILE\"",
        "write_result() { local tmp=\"${RESULT_FILE}.tmp.$$\"; printf '{\\\"status\\\":\\\"%s\\\",\\\"exitCode\\\":%s,\\\"finishedAt\\\":%s}\\n' \"$1\" \"$2\" \"$(date +%s)\" > \"$tmp\" && mv -f \"$tmp\" \"$RESULT_FILE\"; }",
        "finish_requested_stop() { case \"$(cat \"$ACTION_FILE\" 2>/dev/null || true)\" in pause|finish) echo '[webcap] requested stop'; write_result stopped 130; exit 130 ;; esac; }",
        "trap 'echo [webcap] stopped; write_result stopped 130; exit 130' INT TERM",
        "cd " + shlex.quote(settings["cwd"]) + " || { echo '[webcap] training working directory is unavailable'; write_result failed 1; exit 1; }",
    ]
    if settings["activate"] and not has_conda_runtime(settings):
        lines.append("source " + shlex.quote(settings["activate"]) + " || { echo '[webcap] training activation failed'; write_result failed 1; exit 1; }")
    if resume_stage:
        lines.append("printf '%s\\n' " + shlex.quote(
            "[webcap] resume stage=" + resume_stage + " checkpoint=" + str(job.get("resumeFromCheckpoint") or "")
        ))
    if stages in ("hi", "both"):
        lines.extend([
            "echo '[webcap] stage=hi'",
            "printf '%s\\n' " + shlex.quote("[webcap] command hi: " + command_plan["hiCommand"]),
            command_plan["hiCommand"],
            "HI_CODE=$?",
            "finish_requested_stop",
            "if [ \"$HI_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
            "if [ \"$HI_CODE\" -ne 0 ]; then echo '[webcap] HI failed'; write_result failed \"$HI_CODE\"; exit \"$HI_CODE\"; fi",
        ])
    if stages in ("lo", "both"):
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
    lines.extend(["echo '[webcap] completed'", "write_result completed 0"])
    script = "\n".join(lines) + "\n"
    return script, {"hi": hi_wsl, "lo": lo_wsl, "krea2": lo_wsl if stages == "krea2" else "", "wan21": lo_wsl if stages == "wan21" else "", "usedSnapshot": True}


def _write_result_record(job, status, exit_code, error=""):
    path = _job_dir(job) / "result.json"
    payload = {"status": status, "exitCode": int(exit_code), "finishedAt": time.time()}
    if error:
        payload["error"] = str(error)[:2000]
    tmp = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        normalize_path_permissions(path)
    finally:
        try:
            tmp.unlink()
        except FileNotFoundError:
            pass


def _launch_artifacts(job, artifacts):
    stage = _clean_string(job.get("stages"))
    config_key = stage + "Config"
    source = Path(artifacts[config_key])
    target = _job_dir(job) / source.name
    rendered = with_output_dir(
        source.read_text(encoding="utf-8"),
        _clean_string(job.get("effectiveOutputDir")),
    )
    target.write_text(rendered, encoding="utf-8")
    normalize_path_permissions(target)
    launch_artifacts = dict(artifacts)
    launch_artifacts[config_key] = target
    return launch_artifacts


def _write_runner_script(job, settings, artifacts):
    job_dir = _job_dir(job)
    script, resolved = _build_runner_script(job, settings, artifacts, job_dir)
    path = job_dir / "runner.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    normalize_path_permissions(path)
    return path, resolved


def _launch_job(job, folder_path):
    job_dir = _job_dir(job)
    job_dir.mkdir(parents=True, exist_ok=True)
    for child in list(job_dir.iterdir()):
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    if _clean_string(job.get("resumeFromCheckpoint")):
        try:
            validate_resumable_run_for_path(
                folder_path,
                _clean_string(job.get("resumeStage") or job.get("stages")),
                job["resumeFromCheckpoint"],
            )
        except ValueError as exc:
            _write_result_record(job, "failed", 1, "Resume failed: " + str(exc))
            return False
    stages = _clean_string(job.get("stages")) or "both"
    try:
        _, _, artifacts, settings, checks = _build_launch_preflight(job["folder"], stages)
    except Exception as exc:
        _write_result_record(job, "failed", 1, "Launch checks failed: " + str(exc))
        return False
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    if blockers:
        blocker_messages = []
        for item in blockers:
            text = str(item.get("message") or item.get("id") or "Preflight blocker").strip()
            details = str(item.get("details") or "").strip()
            blocker_messages.append(text + ((" — " + details) if details else ""))
        _write_result_record(job, "failed", 1, "Preflight failed: " + "; ".join(blocker_messages))
        return False
    try:
        launch_artifacts = _launch_artifacts(job, artifacts)
        script_path, _ = _write_runner_script(job, settings, launch_artifacts)
    except Exception as exc:
        _write_result_record(job, "failed", 1, "Could not prepare the launch bundle: " + str(exc))
        return False
    script_wsl = _to_wsl_path(script_path, settings["wslDistribution"])
    log_path = job_dir / "run.log"
    log_wsl = _to_wsl_path(log_path, settings["wslDistribution"])
    launch = "setsid bash " + shlex.quote(script_wsl) + " > " + shlex.quote(log_wsl) + " 2>&1 < /dev/null & echo $!"
    code, stdout, stderr = _run_wsl(launch, timeout=15, distribution=settings["wslDistribution"])
    pid = (stdout or "").strip().splitlines()[-1] if (stdout or "").strip() else ""
    if code != 0 or not pid.isdigit():
        error = (stderr or stdout).strip() or "Could not launch the managed training runner (exit " + str(code) + ")."
        _write_result_record(job, "failed", code or 1, error)
        return False
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
    if parsed.get("status") not in ("completed", "failed", "stopped"):
        return "unknown", None, "Runner result has an invalid status: " + str(path)
    try:
        int(parsed.get("exitCode"))
        float(parsed.get("finishedAt"))
    except (TypeError, ValueError):
        return "unknown", None, "Runner result is incomplete: " + str(path)
    return "result", parsed, ""

def _job_wsl_distribution(job):
    return _clean_string(_training_settings()["wslDistribution"])

def _job_runner_pid(job):
    """Use only the PID written by this job's runner."""
    try:
        recorded = (_job_dir(job) / "pid").read_text(encoding="utf-8").strip()
        if recorded.isdigit():
            return int(recorded)
    except OSError:
        pass
    return 0


def _job_runner_script_wsl(job):
    return _to_wsl_path(_job_dir(job) / "runner.sh", _job_wsl_distribution(job))


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
        return "running", ""
    return "absent", "Recorded runner PID is now used by a different process."


def _request_job_action(job, action):
    pid = _job_runner_pid(job)
    if pid <= 0:
        return "WebCap has no recorded runner PID, so it cannot send the " + action + " request safely."
    process_state, detail = _inspect_job_runner(job)
    if process_state != "running":
        return detail or "WebCap could not verify the recorded runner process."
    action_path = _job_action_path(job)
    action_path.write_text(action, encoding="utf-8")
    normalize_path_permissions(action_path)
    code, stdout, stderr = _run_wsl(
        "kill -INT -- -" + str(pid), timeout=8, distribution=_job_wsl_distribution(job)
    )
    if code != 0:
        try:
            action_path.unlink()
        except OSError:
            pass
        return (stderr or stdout or "Could not send the " + action + " request.").strip()
    return ""




def _bind_job_run_path_from_log(job, log_text):
    """Remember the trainer-authored timestamp directory once a checkpoint is saved."""
    if job.get("outputRunPath"):
        return
    matches = _CHECKPOINT_SAVE_PATH_PATTERN.findall(str(log_text or ""))
    if not matches:
        return
    job["outputRunPath"] = matches[-1].strip().strip("'\"")
    job["updatedAt"] = time.time()


def _sync_job_log_evidence(job):
    log_path = _job_dir(job) / "run.log"
    job["logPath"] = str(log_path)
    if not log_path.is_file():
        return "", None
    try:
        log_mtime = log_path.stat().st_mtime
        tail = _read_log_tail(log_path)
    except OSError:
        return "", None
    if "[webcap] stage=wan21" in tail:
        job["stage"] = "wan21"
    elif "[webcap] stage=krea2" in tail:
        job["stage"] = "krea2"
    elif "[webcap] stage=lo" in tail:
        job["stage"] = "lo"
    elif "[webcap] stage=hi" in tail:
        job["stage"] = "hi"
    stage = _clean_string(job.get("stage") or job.get("stages"))
    config_path = _job_dir(job) / (
        KREA2_CONFIG_NAME if stage == "krea2" else WAN21_CONFIG_NAME if stage == "wan21"
        else HI_CONFIG_NAME if stage == "hi" else LO_CONFIG_NAME
    )
    job["snapshot"] = {stage: str(config_path)}
    try:
        folder_path = app_config.safe_join_fs_root(job["folder"])
        job["progressPlan"] = _plan_run_steps(
            _read_training_plan(folder_path) or _default_progress_plan(),
            job["snapshot"],
        )
    except Exception:
        job["progressPlan"] = _default_progress_plan()
    _bind_job_run_path_from_log(job, tail)
    _sync_job_progress(job, tail)
    return tail, log_mtime


def _job_action(job):
    try:
        return (_job_action_path(job).read_text(encoding="utf-8").strip().lower())
    except OSError:
        return ""


def _job_started_at(job):
    for path in (_job_dir(job) / "pid", _job_dir(job) / "run.log"):
        try:
            return path.stat().st_mtime
        except OSError:
            continue
    return 0


def _latest_checkpoint(job):
    folder_path = app_config.safe_join_fs_root(job["folder"])
    stage = _clean_string(job.get("stages"))
    candidates = []
    explicit = _clean_string(job.get("resumeFromCheckpoint"))
    if explicit:
        candidates.append(explicit)
    transient = dict(job)
    tail = _read_log_tail(_job_dir(job) / "run.log", byte_count=32768)
    _bind_job_run_path_from_log(transient, tail)
    logged = _clean_string(transient.get("outputRunPath"))
    if logged and logged not in candidates:
        candidates.append(logged)
    try:
        output_root = host_path_for_training_path(job.get("effectiveOutputDir"))
        latest_markers = sorted(
            output_root.rglob("latest"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        ) if output_root.is_dir() else []
    except (OSError, RuntimeError):
        latest_markers = []
    for marker in latest_markers:
        candidate = _to_wsl_path(marker.parent, _job_wsl_distribution(job))
        if candidate not in candidates:
            candidates.append(candidate)
    for candidate in candidates:
        try:
            validate_resumable_run_for_path(folder_path, stage, candidate)
            return candidate
        except (OSError, RuntimeError, ValueError):
            continue
    return ""


def _refresh_job(job):
    """Derive one public job view from its bundle and its exact recorded process."""
    job.setdefault("status", "queued")
    job.setdefault("stage", "queued")
    job["logPath"] = str(_job_dir(job) / "run.log")
    started_at = _job_started_at(job)
    if started_at:
        job["startedAt"] = started_at
    tail, log_mtime = _sync_job_log_evidence(job)
    if log_mtime is not None:
        job["lastLogAt"] = log_mtime
    action = _job_action(job)
    if action:
        job["actionRequested"] = action

    result_state, result, result_error = _read_result_evidence(job)
    if result_state == "unknown":
        job["status"] = "unconfirmed"
        job["stage"] = "unconfirmed"
        job["confirmationNote"] = result_error
        return job
    if result_state == "result":
        result_status = _clean_string(result.get("status")) or "failed"
        exit_code = int(result.get("exitCode") or 0)
        job["exitCode"] = exit_code
        job["finishedAt"] = float(result.get("finishedAt") or time.time())
        if result_status == "completed":
            job["status"] = "completed"
        elif result_status == "stopped" and action == "finish":
            job["status"] = "finished_early"
        elif result_status == "stopped" and action == "pause":
            job["status"] = "queued"
            job["stage"] = "queued"
            job["confirmationNote"] = "Queue paused. Resume retries this stage."
            checkpoint = _latest_checkpoint(job)
            if checkpoint:
                job["resumeFromCheckpoint"] = checkpoint
                job["resumeStage"] = _clean_string(job.get("stages"))
                try:
                    folder_path = app_config.safe_join_fs_root(job["folder"])
                    job["resumePoint"] = resume_point_from_directory(folder_path, job["stages"], checkpoint)
                except Exception as exc:
                    job["resumePointError"] = str(exc)
            return job
        else:
            job["status"] = "failed"
        job["stage"] = job["status"]
        if job["status"] == "failed":
            job["error"] = _clean_string(result.get("error")) or (
                "Training process exited with code " + str(exit_code) + ". Open the run log for details."
            )
            if tail:
                job["failureExcerpt"] = tail[-8192:]
        _annotate_completed_job(job)
        _annotate_finished_early_job(job)
        return job

    has_launch_evidence = any(
        (_job_dir(job) / name).exists()
        for name in ("runner.sh", "pid", "run.log")
    )
    if not has_launch_evidence:
        checkpoint = _latest_checkpoint(job)
        if checkpoint:
            job["resumeFromCheckpoint"] = checkpoint
            job["resumeStage"] = _clean_string(job.get("stages"))
            try:
                folder_path = app_config.safe_join_fs_root(job["folder"])
                job["resumePoint"] = resume_point_from_directory(folder_path, job["stages"], checkpoint)
            except Exception as exc:
                job["resumePointError"] = str(exc)
        return job

    process_state, process_detail = _inspect_job_runner(job)
    if process_state == "running":
        job["pid"] = _job_runner_pid(job)
        job["runnerVerified"] = True
        if action in ("pause", "finish"):
            job["status"] = "stopping"
            job["stage"] = "stopping"
        else:
            job["status"] = "running" if _log_has_progress(tail) else "starting"
            if job["stage"] == "queued":
                job["stage"] = "starting"
        return job
    if process_state == "unknown":
        job["status"] = "unconfirmed"
        job["stage"] = "unconfirmed"
        job["confirmationNote"] = process_detail or "Runner confirmation is temporarily unavailable."
        return job

    job["status"] = "interrupted"
    job["stage"] = "interrupted"
    job["error"] = process_detail or "Training runner disappeared without writing a result."
    checkpoint = _latest_checkpoint(job)
    if checkpoint:
        job["resumeFromCheckpoint"] = checkpoint
        job["resumeStage"] = _clean_string(job.get("stages"))
    return job














def validate_response(folder, stages="both", resume_from_checkpoint="", resume_stage="", profile_id="", run_id=""):
    try:
        if profile_id or run_id:
            _, selected_run = profile_run(profile_id, run_id, stages)
            stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
        payload = _preflight_payload(folder, stages)
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
            "artifactDir": str(_runtime_root() / "diagnostic"),
            "snapshot": ({"krea2": str(artifacts["krea2Config"])} if stages == "krea2" else {"wan21": str(artifacts["wan21Config"])} if stages == "wan21" else {"hi": str(artifacts["hiConfig"]), "lo": str(artifacts["loConfig"])}),
            "stages": stages,
            "resumeFromCheckpoint": str(resume_from_checkpoint or "").strip(),
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




























# Version 4 deliberately keeps lifecycle evidence out of queue.json. These
# definitions replace the persisted status-machine entry points above while the
# remaining launch/config helpers stay shared.

def _recent_record(view):
    record = {field: view.get(field) for field in _RECENT_FIELDS if field in view}
    record["id"] = _clean_string(view.get("id"))
    record["status"] = _clean_string(view.get("status"))
    record["finishedAt"] = float(view.get("finishedAt") or time.time())
    if isinstance(record.get("error"), str):
        record["error"] = record["error"][:1000]
    if isinstance(record.get("failureExcerpt"), str):
        record["failureExcerpt"] = record["failureExcerpt"][-8192:]
    return record


def _remember_recent(state, view):
    record = _recent_record(view)
    state["recentRuns"] = [
        item for item in state.get("recentRuns", [])
        if _clean_string(item.get("id")) != record["id"]
    ]
    state["recentRuns"].insert(0, record)


def _first_view(state):
    jobs = state.get("jobs") or []
    return _refresh_job(dict(jobs[0])) if jobs else None


def _launch_first(state):
    global _handoff_job_id, _startup_checked
    _startup_checked = True
    if not state.get("jobs"):
        _handoff_job_id = ""
        return False, "The training queue is empty."
    intent = state["jobs"][0]
    launch_job = dict(intent)
    checkpoint = _latest_checkpoint(launch_job)
    if checkpoint:
        launch_job["resumeFromCheckpoint"] = checkpoint
        launch_job["resumeStage"] = _clean_string(launch_job.get("stages"))
        intent["resumeFromCheckpoint"] = checkpoint
        intent["resumeStage"] = _clean_string(intent.get("stages"))
    else:
        launch_job.pop("resumeFromCheckpoint", None)
        launch_job.pop("resumeStage", None)
        intent.pop("resumeFromCheckpoint", None)
        intent.pop("resumeStage", None)
    _write_state(state)
    try:
        folder_path = app_config.safe_join_fs_root(launch_job["folder"])
        launched = _launch_job(launch_job, folder_path)
    except Exception as exc:
        _write_result_record(launch_job, "failed", 1, "Could not launch training: " + str(exc))
        launched = False
    _handoff_job_id = intent["id"] if launched else ""
    return launched, "" if launched else "Training did not start. Correct the reported problem, then Resume."


def _observe_state(state):
    """Observe only the first intent and advance only a permitted live session."""
    global _handoff_job_id, _startup_checked
    changed = False
    view = _first_view(state)
    if view is None:
        _handoff_job_id = ""
        _startup_checked = True
        return changed

    job_id = _clean_string(view.get("id"))
    status = _clean_string(view.get("status"))
    startup_pass = not _startup_checked
    _startup_checked = True

    if status in ("starting", "running", "stopping"):
        # A verified first runner is sufficient to reattach after restart.
        _handoff_job_id = job_id
        durable = state["jobs"][0]
        target_epoch = int(durable.get("finishAfterEpoch") or 0)
        progress = view.get("progress") if isinstance(view.get("progress"), dict) else {}
        current_epoch = int(progress.get("epoch") or 0)
        if target_epoch > 0 and current_epoch > target_epoch:
            error = _request_job_action(view, "finish")
            if not error:
                durable.pop("finishAfterEpoch", None)
                changed = True
        return changed

    if status == "unconfirmed":
        return changed

    if status in TERMINAL_OUTCOMES:
        may_handoff = not startup_pass and _handoff_job_id == job_id
        _remember_recent(state, view)
        state["jobs"].pop(0)
        _handoff_job_id = ""
        changed = True
        if may_handoff and state["jobs"]:
            _launch_first(state)
        return changed

    # Pause, failure, or confirmed disappearance always leaves this same intent
    # first and requires an explicit Resume.
    _handoff_job_id = ""
    return changed


def _monitor_loop():
    while True:
        try:
            with _lock:
                state = _read_state()
                if _observe_state(state):
                    _write_state(state)
        except Exception:
            _logger.exception("Training queue observer failed; queue intent was left unchanged.")
        time.sleep(2)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(target=_monitor_loop, name="webcap-training-runner", daemon=True)
        _monitor_thread.start()


def start_observer():
    """Start the browser-independent first-job observer."""
    _ensure_monitor_started()


def _public_job(job):
    fields = (
        "id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel",
        "artifactDir", "resumeFromCheckpoint", "resumeStage", "resumePoint", "resumePointError",
        "outputRunPath", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt",
        "lastLogAt", "error", "confirmationNote", "completionNote", "exitCode", "failureExcerpt",
        "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence",
        "launchGroupRoot", "parentJobId", "progress", "progressPlan", "actionRequested",
        "finishAfterEpoch", "finishScheduledAt",
    )
    payload = {field: job.get(field) for field in fields if field in job}
    folder = _clean_string(job.get("folder"))
    try:
        available = bool(folder) and Path(app_config.safe_join_fs_root(folder)).is_dir()
    except (OSError, ValueError):
        available = False
    if not available:
        payload["sourceUnavailable"] = "Set folder is currently unavailable."
    output_path = _clean_string(job.get("outputRunPath") or job.get("outputRoot"))
    if output_path:
        payload["outputAvailable"] = _path_available(output_path, directory=True)
    return payload


def _queue_views(state):
    views = []
    for index, intent in enumerate(state.get("jobs", [])):
        if index == 0:
            views.append(_refresh_job(dict(intent)))
            continue
        queued = dict(intent)
        queued["status"] = "queued"
        queued["stage"] = "queued"
        explicit = _clean_string(queued.get("resumeFromCheckpoint"))
        if explicit:
            try:
                folder_path = app_config.safe_join_fs_root(queued["folder"])
                queued["resumePoint"] = resume_point_from_directory(
                    folder_path, queued["stages"], explicit
                )
            except Exception as exc:
                queued["resumePointError"] = str(exc)
        views.append(queued)
    return views


def _queue_status_payload(state):
    views = _queue_views(state)
    first = views[0] if views else None
    first_status = _clean_string((first or {}).get("status"))
    active_id = (
        _clean_string(first.get("id"))
        if first_status in ("starting", "running", "stopping", "unconfirmed")
        else ""
    )
    waiting = bool(first) and not active_id
    reason = ""
    if waiting:
        if first_status in ("failed", "interrupted"):
            reason = _clean_string(first.get("error")) or "Training stopped unexpectedly. Correct the problem, then Resume."
        elif _job_action(first) == "pause":
            reason = "Queue paused by the user."
        else:
            reason = "Queue waiting for Start or Resume."
    elif first_status == "unconfirmed":
        reason = _clean_string(first.get("confirmationNote"))
    return {
        "ok": True,
        "activeJobId": active_id,
        "queuePaused": waiting,
        "queuePauseReason": reason,
        "runnerNotice": "",
        "jobs": [_public_job(job) for job in views],
    }


def _new_job(folder, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id="", profile_id="", run_id="", launch_group=None):
    job_id = uuid.uuid4().hex[:12]
    folder, folder_path = _resolve_folder(folder)
    stages = _normalize_training_stages(stages)
    selected_profile, _ = profile_run(profile_id, run_id, stages)
    config_meta = config_for_stage(selected_profile["id"], stages)
    output_slug = config_meta["outputSlug"]
    distribution = _training_settings()["wslDistribution"]
    resume_path = _clean_string(resume_from_checkpoint)

    group_root = Path(launch_group) if launch_group else training_output_group_for_folder(folder_path, create=True)
    if group_root is None:
        raise RuntimeError("Could not reserve a training output group.")
    output_root = group_root / output_slug
    output_root.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(output_root)
    effective_output_dir = _to_wsl_path(output_root, distribution)

    job_dir = group_root / ".webcap" / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    normalize_path_permissions(job_dir)
    sequence_match = re.match(r"^([0-9A-Z]{3})-", group_root.name)
    action_run_id = _clean_string(run_id)
    job_run_id = stages if selected_profile["id"] == "wan22_t2v" and action_run_id == "both" else action_run_id
    job = {
        "id": job_id,
        "folder": folder,
        "stages": stages,
        "profileId": selected_profile["id"],
        "runId": job_run_id,
        "actionRunId": action_run_id,
        "datasetTarget": _training_profile(folder_path),
        "modelLabel": selected_profile["label"],
        "createdAt": time.time(),
        "outputRoot": str(output_root),
        "effectiveOutputDir": effective_output_dir,
        "outputSlug": output_slug,
        "launchGroupId": group_root.name,
        "sequence": sequence_match.group(1) if sequence_match else "",
        "launchGroupRoot": str(group_root),
        "artifactDir": str(job_dir),
        "parentJobId": _clean_string(parent_job_id),
    }
    if resume_path:
        job["resumeFromCheckpoint"] = resume_path
        job["resumeStage"] = _clean_string(resume_stage or stages)
    return job


def start_response(folder, queue=False, stages="both", resume_from_checkpoint="", resume_stage="", parent_job_id="", profile_id="", run_id=""):
    del queue
    if parent_job_id and not _clean_string(resume_from_checkpoint):
        return {"ok": False, "error": "Historical resume requires a checkpoint path; refusing to start a new run."}, 400
    try:
        selected_profile, selected_run = profile_run(profile_id, run_id, stages)
        stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
        _, folder_path, _, _, checks = _build_launch_preflight(folder, stages)
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 400
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    preflight = {"checks": checks, "summary": {"blockers": len(blockers), "warnings": 0}}
    if blockers:
        return {"ok": False, "error": "Launch checks failed.", "preflight": preflight}, 400

    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        queue_was_empty = not state["jobs"]
        job_stages = ("hi", "lo") if stages == "both" else (stages,)
        needs_new_output = any(
            not (_clean_string(resume_from_checkpoint) and resume_stage == job_stage)
            for job_stage in job_stages
        )
        launch_group = training_output_group_for_folder(folder_path, create=True) if needs_new_output else None
        jobs = []
        for job_stage in job_stages:
            stage_resume = resume_from_checkpoint if resume_stage == job_stage else ""
            jobs.append(_new_job(
                _clean_string(folder), job_stage, stage_resume,
                job_stage if stage_resume else "", parent_job_id,
                selected_profile["id"], selected_run["id"], launch_group,
            ))
        state["jobs"].extend(jobs)
        _write_state(state)
        launched = False
        if queue_was_empty:
            launched, _ = _launch_first(state)
        return {
            "ok": True,
            "job": _public_job(_refresh_job(dict(jobs[0]))),
            "jobs": [_public_job(job) for job in jobs],
            "queued": not launched,
        }, 200


def folder_statuses_for_folders(folder_paths):
    with _lock:
        try:
            state = _read_state()
            views = _queue_views(state)
        except TrainingStateError:
            _logger.exception("Training queue state is unavailable; omitting folder training badges.")
            return {}
    active_id = _clean_string(views[0].get("id")) if views and views[0].get("status") in ACTIVE_STATUSES else ""
    result = {}
    for folder_path in folder_paths:
        path = Path(folder_path)
        try:
            folder = str(path.relative_to(app_config.FS_ROOT)).replace("\\", "/")
        except ValueError:
            continue
        index = next((i for i, job in enumerate(views) if _clean_string(job.get("folder")) == folder), None)
        if index is not None:
            job = views[index]
            if index == 0 and _clean_string(job.get("id")) == active_id:
                result[path] = {"status": "training", "label": "Training", "jobId": active_id, "stage": job.get("stages")}
            else:
                result[path] = {"status": "queued", "label": "Queued #" + str(index + 1), "queuePosition": index + 1}
            continue
        try:
            stages = [stage for stage in ("hi", "lo", "krea2", "wan21") if (path / ("config." + stage + ".toml")).is_file()]
            completed = {
                _clean_string(job.get("stages"))
                for job in state.get("recentRuns", [])
                if _clean_string(job.get("folder")) == folder and job.get("status") in TERMINAL_OUTCOMES
            }
            if stages and all(stage in completed for stage in stages):
                result[path] = {"status": "trained", "label": "Trained"}
            elif completed:
                result[path] = {"status": "partial", "label": "Partially trained"}
            elif all((path / name).is_file() for name in (HI_CONFIG_NAME, LO_CONFIG_NAME, "dataset.hi.toml", "dataset.lo.toml")) and _prepared_dataset_is_ready(path):
                needs_review, partial_count, touched_count = _needs_partial_annotation_caption_review(path)
                result[path] = (
                    {"status": "caption-review", "label": "Caption review needed (" + str(partial_count) + " of " + str(touched_count) + ")"}
                    if needs_review else {"status": "ready", "label": "Ready to train"}
                )
            else:
                result[path] = {"status": "never", "label": ""}
        except Exception:
            _logger.exception("Could not determine training status for folder: %s", path)
            result[path] = {"status": "error", "label": "Training status unavailable"}
    return result


def status_response():
    with _lock:
        _ensure_monitor_started()
        try:
            state = _read_state()
            if _observe_state(state):
                _write_state(state)
        except TrainingStateError as exc:
            return {"ok": False, "stateError": True, "error": str(exc)}, 409
        return _queue_status_payload(state), 200


def _path_available(raw_path, directory=False):
    try:
        path = host_path_for_training_path(raw_path)
        return path.is_dir() if directory else path.is_file()
    except (OSError, RuntimeError, ValueError):
        return False


def _history_view(record):
    item = _public_job(dict(record))
    output_path = _clean_string(item.get("outputRunPath") or item.get("outputRoot"))
    if output_path:
        item["outputAvailable"] = _path_available(output_path, directory=True)
    try:
        log_path = str(_job_dir(record) / "run.log")
    except TrainingStateError:
        log_path = ""
    if log_path:
        item["logPath"] = log_path
        item["logAvailable"] = _path_available(log_path)
    else:
        item["logAvailable"] = False
    resume_path = _clean_string(item.get("outputRunPath") or item.get("resumeFromCheckpoint"))
    if resume_path:
        item["resumeAvailable"] = _path_available(resume_path, directory=True)
    return item


def history_payload(folder):
    folder_text = _clean_string(folder)
    if not folder_text:
        raise ValueError("Training folder is required.")
    folder_path = app_config.safe_join_fs_root(folder_text)
    with _lock:
        state = _read_state()
        jobs = [
            _history_view(job) for job in state.get("recentRuns", [])
            if _clean_string(job.get("folder")) == folder_text
        ]
    return {
        "version": STATE_VERSION,
        "jobs": jobs,
        "runs": discover_runs(folder_path),
        "resumeDefaults": {},
    }


def all_history_payload(query="", folder=""):
    del query
    folder_text = _clean_string(folder)
    with _lock:
        state = _read_state()
        jobs = [
            _history_view(job) for job in state.get("recentRuns", [])
            if not folder_text or _clean_string(job.get("folder")) == folder_text
        ]
    return {"version": STATE_VERSION, "jobs": jobs}


def _validated_bundle_path(record):
    raw = _clean_string(record.get("artifactDir"))
    job_id = _clean_string(record.get("id"))
    if not raw or not job_id:
        return None
    try:
        candidate = host_path_for_training_path(raw).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    owned_root = (Path(app_config.FS_ROOT) / "output" / "runs").resolve()
    try:
        relative = candidate.relative_to(owned_root)
    except ValueError:
        return None
    parts = relative.parts
    if len(parts) < 4 or tuple(parts[-3:-1]) != (".webcap", "jobs") or parts[-1] != job_id:
        return None
    return candidate


def _delete_unreferenced_bundle(state, record):
    path = _validated_bundle_path(record)
    if path is None:
        return False
    raw = str(path)
    for item in state.get("jobs", []) + state.get("recentRuns", []):
        other = _validated_bundle_path(item)
        if other is not None and str(other) == raw:
            return False
    if path.is_dir():
        try:
            shutil.rmtree(path)
            for parent in (path.parent, path.parent.parent):
                try:
                    parent.rmdir()
                except OSError:
                    break
            return True
        except OSError:
            _logger.exception("Could not remove WebCap training bundle: %s", path)
    return False


def clear_history_response(folder, job_id):
    folder_text = _clean_string(folder)
    job_id = _clean_string(job_id)
    if not folder_text or not job_id:
        return {"ok": False, "error": "Folder and job ID are required."}, 400
    with _lock:
        state = _read_state()
        record = _find_history_job(state, folder_text, job_id)
        if record is None:
            return {"ok": True, "cleared": False}, 200
        state["recentRuns"] = [
            item for item in state["recentRuns"]
            if not (
                _clean_string(item.get("id")) == job_id
                and _clean_string(item.get("folder")) == folder_text
            )
        ]
        _write_state(state)
        deleted = _delete_unreferenced_bundle(state, record)
        return {"ok": True, "cleared": True, "bundleDeleted": deleted}, 200


def clear_all_history_response(folder=""):
    folder_text = _clean_string(folder)
    with _lock:
        state = _read_state()
        removed = [
            item for item in state["recentRuns"]
            if not folder_text or _clean_string(item.get("folder")) == folder_text
        ]
        state["recentRuns"] = [
            item for item in state["recentRuns"]
            if folder_text and _clean_string(item.get("folder")) != folder_text
        ]
        _write_state(state)
        deleted = sum(1 for item in removed if _delete_unreferenced_bundle(state, item))
        return {"ok": True, "cleared": len(removed), "bundlesDeleted": deleted}, 200


def history_output_path(folder, job_id):
    with _lock:
        state = _read_state()
        job = _find_history_job(state, folder, job_id)
        if job is None:
            raise ValueError("Training history entry was not found.")
        raw = _clean_string(job.get("outputRunPath") or job.get("outputRoot"))
        if not raw:
            raise ValueError("Training history entry has no output directory.")
        path = host_path_for_training_path(raw)
        if not path.is_dir():
            raise FileNotFoundError("Training output directory is unavailable: " + raw)
        return path


def gpu_status_response():
    return {"ok": True, "gpu": _gpu_snapshot()}, 200


def log_response(job_id, offset=0, tail=False, folder=""):
    with _lock:
        state = _read_state()
        intent = _find_job(state, job_id)
        job = _refresh_job(dict(intent)) if intent else _find_history_job(state, folder, job_id)
        if not job:
            return {"error": "Training job not found"}, 404
        path = _job_dir(job) / "run.log"
        try:
            position = max(0, int(offset or 0))
        except (TypeError, ValueError):
            position = 0
        if not path.exists():
            return {"ok": True, "job": _public_job(job), "offset": 0, "nextOffset": 0, "text": ""}, 200
        with open(path, "rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            position = max(0, size - 65536) if tail else min(position, size)
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
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id) or _find_history_job(state, folder, job_id)
        if not job:
            raise ValueError("Training job not found")
        path = _job_dir(job) / "run.log"
        if not path.is_file():
            raise FileNotFoundError("Training log is not available yet")
        return path


def output_path_for_job(job_id):
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id) or _find_history_job(state, "", job_id)
        if not job:
            raise ValueError("Training job was not found.")
        view = _refresh_job(dict(job)) if _find_job(state, job_id) else job
        raw = _clean_string(view.get("outputRunPath") or view.get("outputRoot"))
        if not raw:
            raise ValueError("Training job has no output directory.")
        path = host_path_for_training_path(raw)
        if not path.is_dir():
            raise FileNotFoundError("Training output directory is unavailable: " + raw)
        return path


def stop_response(job_id, cancel=False, pause=False, finish=False):
    global _handoff_job_id
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id)
        if not job:
            return {"ok": False, "error": "Training job not found"}, 404
        index = state["jobs"].index(job)
        view = _refresh_job(dict(job)) if index == 0 else dict(job, status="queued", stage="queued")
        if cancel:
            if index == 0 and view.get("status") in ("starting", "running", "stopping", "unconfirmed"):
                return {"ok": False, "error": "A running or unconfirmed job cannot be canceled. Pause or Finish it first."}, 400
            state["jobs"].pop(index)
            if index == 0:
                _handoff_job_id = ""
            _write_state(state)
            deleted = _delete_unreferenced_bundle(state, job)
            return {"ok": True, "job": _public_job(view), "bundleDeleted": deleted}, 200
        if not pause and not finish:
            return {"ok": False, "error": "Stop is not available. Use Pause or Finish."}, 400
        if index != 0 or view.get("status") not in ("starting", "running"):
            return {"ok": False, "error": "Training job is not running."}, 400
        action = "finish" if finish else "pause"
        error = _request_job_action(view, action)
        if error:
            status = 409 if "recorded runner PID" in error or "verify" in error else 502
            return {"ok": False, "error": error, "job": _public_job(view)}, status
        if finish:
            job.pop("finishAfterEpoch", None)
            _write_state(state)
        return {"ok": True, "job": _public_job(_refresh_job(dict(job)))}, 200


def finish_schedule_response(job_id, epoch=None, cancel=False):
    with _lock:
        state = _read_state()
        if not state["jobs"] or _clean_string(state["jobs"][0].get("id")) != _clean_string(job_id):
            return {"ok": False, "error": "Active training job not found"}, 404
        job = state["jobs"][0]
        view = _refresh_job(dict(job))
        if cancel:
            job.pop("finishAfterEpoch", None)
            _write_state(state)
            return {"ok": True, "job": _public_job(view)}, 200
        if view.get("status") not in ("starting", "running"):
            return {"ok": False, "error": "Only a running training job can schedule Finish."}, 400
        raw_epoch = _clean_string(epoch)
        if not raw_epoch.isdigit() or int(raw_epoch) <= 0:
            return {"ok": False, "error": "Finish epoch must be a positive whole number."}, 400
        target_epoch = int(raw_epoch)
        progress = view.get("progress") if isinstance(view.get("progress"), dict) else {}
        current_epoch = int(progress.get("epoch") or 0)
        planned_epochs = int(progress.get("epochs") or 0)
        stage = _clean_string(progress.get("stage"))
        if current_epoch <= 0 or planned_epochs <= 0:
            return {"ok": False, "error": "Wait until the runner reports its current epoch before scheduling Finish."}, 409
        if target_epoch < current_epoch or target_epoch >= planned_epochs:
            return {"ok": False, "error": "Finish epoch must be between the current and final epoch."}, 400
        config_path = _job_dir(view) / (
            KREA2_CONFIG_NAME if stage == "krea2" else WAN21_CONFIG_NAME if stage == "wan21"
            else HI_CONFIG_NAME if stage == "hi" else LO_CONFIG_NAME
        )
        save_every_epochs = _read_config_positive_int(config_path, "save_every_n_epochs", 0)
        if save_every_epochs <= 0 or target_epoch % save_every_epochs:
            return {"ok": False, "error": "Finish epoch must be a configured saved epoch."}, 400
        job["finishAfterEpoch"] = target_epoch
        _write_state(state)
        return {"ok": True, "job": _public_job(_refresh_job(dict(job)))}, 200


def reorder_response(job_id, direction):
    if direction not in ("up", "down"):
        return {"ok": False, "error": "Queue direction must be up or down."}, 400
    with _lock:
        state = _read_state()
        views = _queue_views(state)
        first_active = bool(views and views[0].get("status") in ACTIVE_STATUSES)
        indexes = list(range(1 if first_active else 0, len(state["jobs"])))
        current = next((index for index in indexes if _clean_string(state["jobs"][index].get("id")) == _clean_string(job_id)), None)
        if current is None:
            return {"ok": False, "error": "Queued training job not found."}, 404
        position = indexes.index(current)
        target_position = position - 1 if direction == "up" else position + 1
        if target_position < 0 or target_position >= len(indexes):
            return {"ok": False, "error": "Training job cannot move further in the queue."}, 400
        target = indexes[target_position]
        state["jobs"][current], state["jobs"][target] = state["jobs"][target], state["jobs"][current]
        _write_state(state)
        return {"ok": True, "jobs": _queue_status_payload(state)["jobs"]}, 200


def resume_queue_response():
    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        if not state["jobs"]:
            return {"ok": False, "error": "The training queue is empty.", "jobs": []}, 400
        view = _first_view(state)
        if view.get("status") in ("starting", "running", "stopping", "unconfirmed"):
            return {"ok": False, "error": "The first training job is already running or cannot yet be confirmed.", "jobs": _queue_status_payload(state)["jobs"]}, 409
        launched, error = _launch_first(state)
        payload = _queue_status_payload(state)
        if not launched:
            payload["ok"] = False
            payload["error"] = error
            return payload, 409
        return payload, 200
