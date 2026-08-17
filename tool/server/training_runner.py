import json
import logging
import math
import os
import re
import hashlib
import shlex
import threading
import time
import uuid
from pathlib import Path, PurePosixPath

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_commands import build_h3_command_plan, build_training_command_plan
from .training_profiles import config_for_stage, normalize_mode, profile_for_mode, profile_run, profiles as training_profiles
from .training_bundle import materialize_training_bundle
from .dataset_config import repeat_targets_for_mode
from .training_history import completed_stages, discover_runs, validate_resumable_run_for_path, resume_point_for_path, resume_point_from_directory, host_path_for_training_path, output_root_for_folder, read_history, record_job, clear_history_job, training_output_group_for_folder
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
_DISTRIBUTED_SOCKET_HOLD_REASON = (
    "Queue held: PyTorch distributed could not open its server socket because the address is already in use. "
    "Stop the other training process before continuing."
)


def _runtime_root():
    return Path(app_config.FS_ROOT) / RUNNER_DIR_NAME


def _state_path():
    return _runtime_root() / STATE_FILE_NAME


def _jobs_root():
    return _runtime_root() / JOB_DIR_NAME


def _ensure_runtime_dirs():
    _jobs_root().mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(_runtime_root())
    normalize_path_permissions(_jobs_root())


def _default_state():
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
    if parsed.get("version") != 3:
        raise TrainingStateError("Unsupported training queue state version; it was left unchanged: " + str(path))
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
    normalize_path_permissions(path)
    _state_file_seen = path
    _persisted_managed_job_ids = _managed_job_ids(state)


def recover_state_response():
    """Archive an unreadable queue state and start a fresh, empty queue."""
    global _state_file_seen, _persisted_managed_job_ids
    with _lock:
        _ensure_runtime_dirs()
        path = _state_path()
        archived_path = None
        if path.exists():
            archived_path = path.with_name(
                "queue.recovery." + time.strftime("%Y%m%d_%H%M%S") + "." + uuid.uuid4().hex + ".json"
            )
            os.replace(path, archived_path)
            normalize_path_permissions(archived_path)
        _state_file_seen = None
        _persisted_managed_job_ids = set()
        state = _default_state()
        _write_state(state)
        return {
            "ok": True,
            "archivedState": str(archived_path) if archived_path else "",
            "activeJobId": "",
            "queuePaused": False,
            "queuePauseReason": "",
            "jobs": [],
        }, 200


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

def _file_digest(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _input_evidence(bundle_path, stages="both"):
    bundle = Path(bundle_path)
    manifest_path = bundle / "dataset_manifest.json"
    digest = hashlib.sha256()
    count = 0
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    rows = (manifest.get("images") or []) + (manifest.get("videos") or []) if isinstance(manifest, dict) else []
    for row in sorted((item for item in rows if isinstance(item, dict)), key=lambda item: str(item.get("prepared_path") or item.get("file") or "")):
        prepared = str(row.get("prepared_path") or "")
        name = str(row.get("file") or prepared)
        if not prepared:
            continue
        count += 1
        digest.update(name.encode("utf-8"))
        caption = bundle / "media" / prepared
        caption = caption.with_suffix(".txt")
        try:
            digest.update(caption.read_bytes())
        except OSError:
            digest.update(b"<missing-caption>")
    config_paths = sorted((bundle / "configs").glob("*.toml"), key=lambda path: path.name.lower())
    config_paths.append(bundle / "training_plan.json")
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
    selected_profile, _ = profile_run(profile_id, None, stage)
    label = selected_profile["label"]
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
    hi_steps, lo_steps = repeat_targets_for_mode("normal")
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
    )
    h3_command_plan = build_h3_command_plan(
        lo_wsl,
        build_training_launcher(settings),
        resume_path if resume_stage == "h3" else "",
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
    if stages == "h3":
        if not resume_stage:
            lines.extend([
                "echo '[webcap] stage=h3-cache'",
                "printf '%s\\n' " + shlex.quote("[webcap] command h3 cache: " + h3_command_plan["cacheCommand"]),
                h3_command_plan["cacheCommand"],
                "H3_CACHE_CODE=$?",
                "finish_requested_stop",
                "if [ \"$H3_CACHE_CODE\" -eq 130 ]; then echo '[webcap] stopped'; write_result stopped \"$H3_CACHE_CODE\"; exit \"$H3_CACHE_CODE\"; fi",
                "if [ \"$H3_CACHE_CODE\" -ne 0 ]; then echo '[webcap] MiniMax H3 cache failed'; write_result failed \"$H3_CACHE_CODE\"; exit \"$H3_CACHE_CODE\"; fi",
            ])
        lines.extend([
            "echo '[webcap] stage=h3'",
            "printf '%s\\n' " + shlex.quote("[webcap] command h3: " + h3_command_plan["trainCommand"]),
            h3_command_plan["trainCommand"],
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
    normalize_path_permissions(path)
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
    if str(job.get("resumeFromCheckpoint") or "").strip():
        try:
            validate_resumable_run_for_path(
                folder_path,
                str(job.get("resumeStage") or job.get("stages") or ""),
                job["resumeFromCheckpoint"],
            )
        except ValueError as exc:
            job["status"] = "failed"
            job["stage"] = "resume"
            job["failureScope"] = "job"
            job["error"] = "Resume invariant failed: " + str(exc)
            job["finishedAt"] = time.time()
            return False
    stages = job.get("stages") or "both"
    captured_artifacts = {
        key: Path(value)
        for key, value in (job.get("bundleArtifacts") or {}).items()
    }
    _, _, artifacts, settings, checks = (
        _build_launch_preflight(
            job["folder"],
            stages,
            profile_id=job.get("profileId") or "",
            mode=job.get("mode") or "normal",
            artifacts_override=captured_artifacts,
        )
    )
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    job["preflight"] = {"checks": checks, "blockers": len(blockers)}
    if blockers:
        job["status"] = "failed"
        job["stage"] = "launch"
        job_local_checks = {"set_folder_exists", "training_artifacts", "training_toml"}
        job["failureScope"] = "job" if all(item.get("id") in job_local_checks for item in blockers) else "system"
        blocker_messages = []
        for item in blockers:
            text = str(item.get("message") or item.get("id") or "Preflight blocker").strip()
            details = str(item.get("details") or "").strip()
            blocker_messages.append(text + ((" — " + details) if details else ""))
        job["error"] = "Preflight failed: " + "; ".join(blocker_messages)
        job["finishedAt"] = time.time()
        return False
    job_dir = _job_dir(job)
    result_path = job_dir / "result.json"
    if result_path.exists():
        result_path.unlink()
    action_path = _job_action_path(job)
    if action_path.exists():
        action_path.unlink()
    try:
        launch_artifacts = _launch_artifacts(job, artifacts)
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
    job["actionRequested"] = action
    job["actionRequestedAt"] = time.time()
    job["status"] = "stopping"
    job["stage"] = "stopping"
    job["confirmationNote"] = confirmation_note or action.capitalize() + " requested. Waiting for the runner result."
    job["updatedAt"] = time.time()
    return ""


def _trigger_scheduled_finish(job):
    target_epoch = int(job.get("finishAfterEpoch") or 0)
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    current_epoch = int(progress.get("epoch") or 0)
    if target_epoch <= 0 or current_epoch <= target_epoch:
        return False
    error = _request_job_action(
        job,
        "finish",
        "Epoch " + str(target_epoch) + " saved. Finish requested; waiting for the runner result.",
    )
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
    if not matches:
        return
    job["outputRunPath"] = matches[-1].strip().strip("'\"")
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
    requested_action = str(job.get("actionRequested") or "")
    if requested_action == "pause":
        _queue_paused_job(job)
    elif requested_action == "finish" and result_status != "completed":
        job["status"] = "finished_early"
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
    else:
        job.pop("resumeFromCheckpoint", None)
        job.pop("resumeStage", None)
        job.pop("resumePoint", None)
        job.pop("resumePointError", None)
    for field in (
        "pid", "runnerVerified", "actionRequested", "actionRequestedAt", "startedAt", "finishedAt",
        "lastLogAt", "exitCode", "failureScope", "failureExcerpt", "completionNote", "confirmationNote",
        "finishAfterEpoch", "finishScheduledAt", "finishTriggeredEpoch", "progress", "error",
    ):
        job.pop(field, None)
    job["status"] = "queued"
    job["stage"] = "queued"
    job["updatedAt"] = time.time()


def _hold_job_for_manual_recovery(
    job,
    detail="",
    hold_reason="Previous runner could not be confirmed. Resume or cancel the first item.",
):
    """Keep uncertain work recoverable without occupying the active runner slot."""
    _queue_paused_job(job)
    job["error"] = str(detail or "WebCap could not confirm the previous runner.").strip()
    return {"holdReason": hold_reason}


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
            return _hold_job_for_manual_recovery(job, "Runner PID and script evidence are unavailable.")
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
        requested_action = _apply_terminal_job_status(job, result_status)
        if job["status"] == "queued":
            return {"holdReason": "", "pauseQueue": requested_action == "pause"}
        if job["status"] == "interrupted" and result_status == "stopped" and requested_action not in ("finish", "stop"):
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
        hold_reason = _distributed_socket_hold_reason(failure_excerpt) if job["status"] == "failed" and prior_status != "failed" else ""
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
            return _hold_job_for_manual_recovery(job, result_error or process_detail)
        return {"holdReason": ""}
    if prior_status in ACTIVE_STATUSES and not job.get("actionRequested"):
        return _hold_job_for_manual_recovery(
            job,
            result_error or "The previous runner is no longer active and did not write a result; this item remains first.",
            "Previous runner ended without a result. Resume or restart the first item.",
        )
    prior_projection = _terminal_projection_signature(job)
    prior_updated_at = job.get("updatedAt")
    prior_finished_at = job.get("finishedAt")
    job.pop("confirmationNote", None)
    job.pop("runnerVerified", None)
    requested_action = _apply_terminal_job_status(job)
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
    return {"holdReason": ""}


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
        if job.get("status") == "queued" and str(job.get("resumeFromCheckpoint") or "").strip():
            try:
                folder_path = app_config.safe_join_fs_root(job["folder"])
                stage = str(job.get("resumeStage") or job.get("stages") or "")
                job["resumePoint"] = resume_point_from_directory(folder_path, stage, job["resumeFromCheckpoint"])
                job.pop("resumePointError", None)
            except Exception as exc:
                job["resumePoint"] = {}
                job["resumePointError"] = str(exc)
        elif job.get("status") == "completed":
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
    queued_jobs = [job for job in state.get("jobs", []) if job.get("status") == "queued"]
    if not _startup_reconciled and queued_jobs and not any(job.get("runnerVerified") for job in active_jobs):
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
    """Start queue observation independently of whether the Training workspace is open."""
    _ensure_monitor_started()


def _public_job(job):
    fields = ("id", "folder", "stages", "profileId", "mode", "runId", "actionRunId", "datasetTarget", "modelLabel", "model", "input", "artifactDir", "artifactSummary", "bundlePath", "capturedItemCount", "resumeFromCheckpoint", "resumeStage", "resumePoint", "resumePointError", "outputRunPath", "status", "stage", "pid", "createdAt", "startedAt", "finishedAt", "updatedAt", "lastLogAt", "error", "confirmationNote", "completionNote", "exitCode", "failureScope", "failureExcerpt", "resolvedConfigs", "preflight", "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence", "launchGroupRoot", "parentJobId", "progress", "progressPlan", "actionRequested", "actionRequestedAt", "finishAfterEpoch", "finishScheduledAt", "finishTriggeredEpoch")
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


def validate_response(folder, stages="both", resume_from_checkpoint="", resume_stage="", profile_id="", run_id="", mode="normal"):
    try:
        if profile_id or run_id:
            _, selected_run = profile_run(profile_id, run_id, stages)
            stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
        selected_mode = normalize_mode(mode)
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
    launch_group=None,
):
    job_id = uuid.uuid4().hex[:12]
    _, folder_path = _resolve_folder(folder)
    stages = _normalize_training_stages(stages)
    selected_profile, _ = profile_run(profile_id, run_id, stages)
    selected_mode = normalize_mode(mode)
    config_meta = config_for_stage(selected_profile["id"], stages, selected_mode)
    output_slug = config_meta["outputSlug"]
    resume_path = str(resume_from_checkpoint or "").strip()
    distribution = _training_settings()["wslDistribution"]
    group_root = Path(launch_group)
    job_dir = group_root / ".webcap" / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=False)
    normalize_path_permissions(job_dir)
    artifacts = {key: Path(value) for key, value in bundle["artifacts"].items()}
    snapshot = {stages: str(artifacts[stages + "Config"])}
    progress_plan = _plan_run_steps(_read_training_plan(bundle["path"]) or _default_progress_plan(), snapshot)
    input_evidence = _input_evidence(bundle["path"], stages)
    model = _model_identity(artifacts, selected_profile["id"], stages)
    sequence_match = re.match(r"^([0-9A-Z]{3})-", group_root.name)
    action_run_id = str(run_id or "")
    job_run_id = stages if selected_profile["id"] == "wan22_t2v" and action_run_id == "both" else action_run_id
    return {
        "id": job_id,
        "folder": folder,
        "stages": stages,
        "profileId": selected_profile["id"],
        "mode": selected_mode,
        "runId": job_run_id,
        "actionRunId": action_run_id,
        "modelLabel": model["label"],
        "model": model,
        "datasetTarget": selected_mode,
        "input": input_evidence,
        "resumeFromCheckpoint": resume_path,
        "resumeStage": _normalize_resume_stage(stages, resume_path, resume_stage),
        "outputRunPath": resume_path,
        "resumePoint": resume_point_for_path(folder_path, stages, resume_path) if resume_path else {},
        "status": "queued",
        "stage": "queued",
        "createdAt": time.time(),
        "updatedAt": time.time(),
        "snapshot": snapshot,
        "bundlePath": str(bundle["path"]),
        "bundleArtifacts": {key: str(value) for key, value in artifacts.items()},
        "capturedItemCount": int(bundle.get("capturedItemCount") or 0),
        "artifactPath": str(job_dir),
        "artifactDir": str(job_dir),
        "progressPlan": progress_plan,
        "runtime": {"wslDistribution": distribution},
        "preflight": {"checks": preflight.get("checks", []), "blockers": preflight.get("summary", {}).get("blockers", 0)},
        "outputRoot": str(output_root),
        "effectiveOutputDir": effective_output_dir,
        "outputSlug": output_slug,
        "launchGroupId": group_root.name,
        "sequence": sequence_match.group(1) if sequence_match else "",
        "launchGroupRoot": str(group_root),
        "parentJobId": str(parent_job_id or ""),
    }


def _bundle_from_path(bundle_path, profile_id, mode, stages):
    path = Path(bundle_path)
    if not path.is_dir():
        raise FileNotFoundError("Captured training files are missing: " + str(path))
    selected = profile_for_mode(profile_id, mode)
    stage_names = ("hi", "lo") if stages == "both" else (stages,)
    artifacts = {
        "manifest": path / "dataset_manifest.json",
        "plan": path / "training_plan.json",
    }
    for stage in stage_names:
        item = next(item for item in selected["configs"] if item["id"] == stage)
        artifacts[stage + "Config"] = path / "configs" / item["file"]
        artifacts[stage + "Dataset"] = path / "configs" / item["dataset"]
    missing = [str(value) for value in artifacts.values() if not Path(value).is_file()]
    if missing:
        raise FileNotFoundError("Captured training files are missing: " + ", ".join(missing))
    try:
        manifest = json.loads(artifacts["manifest"].read_text(encoding="utf-8"))
    except (OSError, ValueError):
        manifest = {}
    rows = (manifest.get("images") or []) + (manifest.get("videos") or []) if isinstance(manifest, dict) else []
    return {"path": path, "artifacts": artifacts, "capturedItemCount": len(rows)}


def start_response(
    folder,
    queue=False,
    stages="both",
    resume_from_checkpoint="",
    resume_stage="",
    parent_job_id="",
    profile_id="",
    run_id="",
    mode="normal",
    selected_media=None,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
):
    if parent_job_id and not str(resume_from_checkpoint or "").strip():
        return {"ok": False, "error": "Historical resume requires a checkpoint path; refusing to start a new run."}, 400
    try:
        selected_profile, selected_run = profile_run(profile_id, run_id, stages)
        selected_mode = normalize_mode(mode)
        stages = selected_run["stages"][0] if len(selected_run["stages"]) == 1 else "both"
        stages = _normalize_training_stages(stages)
        resume_stage = _normalize_resume_stage(stages, resume_from_checkpoint, resume_stage)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}, 400
    try:
        _, folder_path = _resolve_folder(folder)
        parent = _find_history_job(folder, parent_job_id) if parent_job_id else None
        parent_bundle = str((parent or {}).get("bundlePath") or "").strip()
        if parent_job_id and not parent_bundle:
            return {"ok": False, "error": "The managed run has no captured training bundle."}, 400
        bundle = _bundle_from_path(parent_bundle, selected_profile["id"], selected_mode, stages) if parent_bundle else None
        _, folder_path, _, _, checks = _build_launch_preflight(
            folder,
            stages,
            profile_id=selected_profile["id"],
            mode=selected_mode,
            artifacts_override=bundle["artifacts"] if bundle else None,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}, 400
    blockers = [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    preflight = {"checks": checks, "summary": {"blockers": len(blockers), "warnings": 0}}
    if blockers:
        return {"ok": False, "error": "Launch checks failed.", "preflight": preflight}, 400
    with _lock:
        _ensure_monitor_started()
        state = _read_state()
        _refresh_state(state)
        active = _find_job(state, state.get("activeJobId")) if state.get("activeJobId") else None
        has_pending_queue = any(job.get("status") in QUEUE_STATUSES for job in state.get("jobs", []))
        if active and active.get("status") not in TERMINAL_STATUSES and not queue:
            _write_state(state)
            return {"ok": False, "error": "A managed training job is already active.", "activeJob": _public_job(active)}, 409
        # An explicit Train request is permission to start a fresh queue. A
        # stale hold from a previous terminal job must not leave the new job
        # queued forever when there is no active or pending work to protect.
        if not active and not has_pending_queue:
            state["queuePaused"] = False
            state["queuePauseReason"] = ""
        job_stages = ("hi", "lo") if stages == "both" else (stages,)
        if parent_bundle:
            launch_group = Path(bundle["path"]).parents[2]
        else:
            launch_group = training_output_group_for_folder(folder_path, create=True)

        output_roots = {}
        output_dirs = {}
        distribution = _training_settings()["wslDistribution"]
        for job_stage in job_stages:
            meta = config_for_stage(selected_profile["id"], job_stage, selected_mode)
            if resume_from_checkpoint and resume_stage == job_stage:
                effective = str(Path(resume_from_checkpoint).parent) if not str(resume_from_checkpoint).startswith("/") else str(PurePosixPath(resume_from_checkpoint).parent)
                output_dirs[job_stage] = effective.replace("\\", "/")
                output_roots[job_stage] = host_path_for_training_path(output_dirs[job_stage])
            else:
                output_root = launch_group / meta["outputSlug"]
                output_root.mkdir(parents=True, exist_ok=True)
                normalize_path_permissions(output_root)
                output_roots[job_stage] = output_root
                output_dirs[job_stage] = _to_wsl_path(output_root, distribution)
        if not parent_bundle:
            try:
                bundle = materialize_training_bundle(
                    folder_path,
                    launch_group,
                    selected_profile["id"],
                    selected_mode,
                    stages,
                    selected_media,
                    fallback_captions=fallback_captions,
                    selection_criteria=selection_criteria,
                    total_media_count=total_media_count,
                    output_dirs=output_dirs,
                    distribution=distribution,
                )
            except Exception as exc:
                return {"ok": False, "error": "Could not create the run dataset: " + str(exc)}, 400
        jobs = []
        for job_stage in job_stages:
            stage_resume = resume_from_checkpoint if resume_stage == job_stage else ""
            jobs.append(_new_job(
                str(folder).strip(),
                preflight,
                job_stage,
                bundle,
                output_roots[job_stage],
                output_dirs[job_stage],
                stage_resume,
                job_stage if stage_resume else "",
                parent_job_id,
                selected_profile["id"],
                selected_run["id"],
                selected_mode,
                launch_group,
            ))
        state["jobs"].extend(jobs)
        if not active or active.get("status") in TERMINAL_STATUSES:
            _launch_next_queued_job(state)
        _persist_reconciled_state(state)
        return {
            "ok": True,
            "job": _public_job(jobs[0]),
            "jobs": [_public_job(job) for job in jobs],
            "queued": jobs[0].get("status") == "queued",
        }, 200


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
            return {"ok": False, "stateError": True, "recoveryAvailable": True, "error": str(exc)}, 409
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


def bundle_path_for_job(job_id, folder=""):
    """Return captured inputs for a known job; never accept a caller path."""
    with _lock:
        state = _read_state()
        job = _find_job(state, job_id) or _find_history_job(folder, job_id)
        if not job:
            raise ValueError("Training job not found")
        path = Path(str(job.get("bundlePath") or ""))
        if not path.is_dir():
            raise FileNotFoundError("Captured training files are unavailable")
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
            return {"ok": False, "error": "Only queued training jobs can be cancelled. Use Pause, Stop, or Finish for the active job."}, 400
        if job.get("status") not in ACTIVE_STATUSES:
            return {"ok": False, "error": "Training job is not running."}, 400
        action = "pause" if pause else "finish" if finish else "stop"
        message = _request_job_action(job, action)
        if message:
            job["error"] = message
            job["updatedAt"] = time.time()
            _write_state(state)
            status = 409 if "no recorded runner PID" in message or "not verified" in message else 502
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
        snapshot = job.get("snapshot") if isinstance(job.get("snapshot"), dict) else {}
        save_every_epochs = _read_config_positive_int(snapshot.get(stage), "save_every_n_epochs", 0)
        if save_every_epochs <= 0:
            return {"ok": False, "error": "The launch snapshot has no save_every_n_epochs setting."}, 409
        if target_epoch % save_every_epochs:
            return {
                "ok": False,
                "error": "Epoch " + str(target_epoch) + " is not a configured save point; this run saves every " + str(save_every_epochs) + " epochs.",
            }, 400
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
