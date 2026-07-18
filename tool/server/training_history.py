import json
import os
import re
import shlex
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path, PurePosixPath

from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import output_dir_from_config, training_config_path
from .training_profiles import profiles


HISTORY_FILE_NAME = ".webcap_training.json"
HISTORY_VERSION = 3
_EPOCH_PATTERN = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_PATTERN = re.compile(r"^global_step(\d+)$", re.IGNORECASE)
_EPOCH_CONFIG_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_RUN_STAGE_PATTERN = re.compile(r"(?:^|[-_.])(hi|lo|krea2|wan21)(?:$|[-_.])", re.IGNORECASE)
_DATASET_CONFIG_PATTERN = re.compile(r"^\s*dataset\s*=\s*[\"']([^\"']+)[\"']\s*(?:#.*)?$", re.MULTILINE)
_NOISE_MODEL_PATTERN = re.compile(r"\b(high|low)[_ -]?noise(?:[_ -]?model)?\b", re.IGNORECASE)


def output_root_for_folder(folder_path, stage="hi"):
    return host_path_for_training_path(output_root_path_for_folder(folder_path, stage))


def output_root_path_for_folder(folder_path, stage="hi"):
    folder = Path(folder_path)
    configured = output_dir_from_config(folder, stage) if stage in ("hi", "lo", "krea2", "wan21") else None
    if configured:
        return str(configured)
    return str(Path(app_config.FS_ROOT) / "output" / "runs" / folder.name)


def _wsl_distribution():
    training = app_config.config.get("training") if isinstance(app_config.config, dict) else {}
    return str(training.get("wsl_distribution") or "").strip() if isinstance(training, dict) else ""


def host_path_for_training_path(path):
    value = str(path or "").strip()
    if not value or os.name != "nt" or not value.startswith("/"):
        return Path(value)
    executable = shutil.which("wsl.exe") or shutil.which("wsl")
    if not executable:
        raise RuntimeError("wsl.exe was not found while resolving the configured training output path.")
    args = [executable]
    distribution = _wsl_distribution()
    if distribution:
        args.extend(["--distribution", distribution])
    args.extend(["--", "bash", "-lc", "wslpath -w " + shlex.quote(value)])
    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=10, check=False)
    except Exception as exc:
        raise RuntimeError("Could not resolve the configured training output path: " + str(exc)) from exc
    converted = (completed.stdout or "").strip()
    if completed.returncode != 0 or not converted:
        raise RuntimeError((completed.stderr or completed.stdout or "Could not resolve the configured training output path.").strip())
    return Path(converted)


def _training_path_for_entry(entry, host_root, training_root):
    path = Path(entry)
    root = Path(host_root)
    raw_root = str(training_root or "")
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        return str(path)
    if raw_root.startswith("/"):
        return str(PurePosixPath(raw_root) / PurePosixPath(relative))
    return str(path)


def output_roots_for_folder(folder_path):
    roots = []
    folder = Path(folder_path)
    stages = [stage for stage in ("hi", "lo", "krea2", "wan21") if training_config_path(folder, stage).is_file()] or ["hi", "lo"]
    for stage in stages:
        root = output_root_for_folder(folder_path, stage)
        if root not in roots:
            roots.append(root)
    runs_root = Path(app_config.FS_ROOT) / "output" / "runs"
    launch_pattern = re.compile(r"^[0-9A-Z]{3}-" + re.escape(folder.name) + r"$")
    slugs = {
        config["outputSlug"]
        for item in profiles()
        for config in item["configs"]
    }
    if runs_root.is_dir():
        for launch_root in runs_root.iterdir():
            if not launch_root.is_dir() or not launch_pattern.match(launch_root.name):
                continue
            for slug in slugs:
                stage_root = launch_root / slug
                if stage_root.is_dir() and stage_root not in roots:
                    roots.append(stage_root)
    return roots


def _history_path(folder_path):
    return Path(folder_path) / HISTORY_FILE_NAME


def _configured_epochs(folder_path, stage):
    try:
        text = (Path(folder_path) / ("config." + stage + ".toml")).read_text(encoding="utf-8")
    except OSError:
        return 0
    match = _EPOCH_CONFIG_PATTERN.search(text)
    return int(match.group(1)) if match else 0


def _stage_from_run_name(name):
    matches = _RUN_STAGE_PATTERN.findall(str(name or ""))
    return matches[-1].lower() if matches else ""


def _stage_from_run_config(entry):
    """Identify a run's noise stage from the config copied beside its checkpoints."""
    for config_path in sorted(Path(entry).glob("*.toml")):
        named_stage = _stage_from_run_name(config_path.name)
        if named_stage:
            return named_stage
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue
        dataset_stage = _stage_from_run_name(config_text)
        if dataset_stage:
            return dataset_stage
        noise_model = _NOISE_MODEL_PATTERN.search(config_text)
        if noise_model:
            return "hi" if noise_model.group(1).lower() == "high" else "lo"
    return ""


def _set_name_from_run_config(entry, fallback_name):
    for config_path in sorted(Path(entry).glob("*.toml")):
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue
        match = _DATASET_CONFIG_PATTERN.search(config_text)
        if not match:
            continue
        dataset_path = match.group(1).strip().replace("\\", "/")
        set_name = Path(dataset_path).parent.name
        if set_name and set_name != ".":
            return set_name
    return str(fallback_name or "")


def _run_belongs_to_set(entry, set_name):
    """Reject a run when its saved dataset config names another set."""
    for config_path in sorted(Path(entry).glob("*.toml")):
        try:
            config_text = config_path.read_text(encoding="utf-8")
        except OSError:
            continue
        match = _DATASET_CONFIG_PATTERN.search(config_text)
        if not match:
            continue
        dataset_path = match.group(1).strip().replace("\\", "/")
        saved_set_name = Path(dataset_path).parent.name
        if saved_set_name and saved_set_name != ".":
            return saved_set_name == str(set_name or "")
    # Older/manual runs without their saved config remain discoverable.
    return True


def _run_artifact_state(entry, expected_epochs):
    highest_epoch = 0
    highest_step = 0
    try:
        children = list(entry.iterdir())
    except OSError:
        return False, 0, 0
    for child in children:
        epoch = _EPOCH_PATTERN.match(child.name)
        step = _STEP_PATTERN.match(child.name)
        if epoch:
            highest_epoch = max(highest_epoch, int(epoch.group(1)))
        if step:
            highest_step = max(highest_step, int(step.group(1)))
    completed = bool(expected_epochs and highest_epoch >= expected_epochs)
    return completed, highest_epoch, highest_step


def _resume_artifacts(entry):
    """Return the DeepSpeed latest marker only when it names a real checkpoint."""
    directory = Path(entry)
    latest = directory / "latest"
    if not latest.is_file():
        return []
    try:
        tag = latest.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return []
    if not _STEP_PATTERN.match(tag) or not (directory / tag).is_dir():
        return []
    return [latest]


def _is_checkpoint_artifact(entry):
    name = Path(entry).name
    return name.lower() == "latest" or bool(_STEP_PATTERN.match(name)) or bool(_EPOCH_PATTERN.match(name))


def _default_history(folder_path):
    return {
        "version": HISTORY_VERSION,
        "outputRoot": str(output_root_for_folder(folder_path)),
        "jobs": [],
        "runs": [],
    }


def read_history(folder_path):
    path = _history_path(folder_path)
    if not path.exists():
        return _default_history(folder_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_history(folder_path)
    if not isinstance(data, dict) or data.get("version") != HISTORY_VERSION:
        return _default_history(folder_path)
    data["outputRoot"] = str(output_root_for_folder(folder_path))
    if not isinstance(data.get("jobs"), list):
        data["jobs"] = []
    if not isinstance(data.get("runs"), list):
        data["runs"] = []
    return data


def _write_history(folder_path, data):
    path = _history_path(folder_path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)
    normalize_path_permissions(path)


def discover_runs(folder_path, stage=""):
    folder = Path(folder_path)
    root_stages = (stage,) if stage in ("hi", "lo", "krea2", "wan21") else tuple(
        item for item in ("hi", "lo", "krea2", "wan21") if training_config_path(folder, item).is_file()
    ) or ("hi", "lo")
    roots = []
    for root_stage in root_stages:
        training_root = output_root_path_for_folder(folder_path, root_stage)
        host_root = output_root_for_folder(folder_path, root_stage)
        if not any(item[0] == host_root for item in roots):
            roots.append((host_root, training_root))
    for host_root in output_roots_for_folder(folder_path):
        if not any(item[0] == host_root for item in roots):
            roots.append((host_root, str(host_root)))
    runs = []
    seen = set()
    for root, training_root in roots:
        matching_stages = [name for name in ("hi", "lo", "krea2", "wan21") if output_root_for_folder(folder_path, name) == root]
        root_stage = matching_stages[0] if len(matching_stages) == 1 else ""
        if not root.exists() or not root.is_dir():
            continue
        candidates = [root] if _resume_artifacts(root) else []
        try:
            candidates.extend(root.iterdir())
        except OSError:
            continue
        for entry in candidates:
            # WebCap stores job snapshots under <output>/.webcap.  Those are not
            # trainer runs and must never become resume candidates.
            if not entry.is_dir() or entry.name.startswith(".") or _is_checkpoint_artifact(entry) or entry in seen:
                continue
            try:
                modified = entry.stat().st_mtime
            except OSError:
                continue
            seen.add(entry)
            if not _run_belongs_to_set(entry, Path(folder_path).name):
                continue
            entry_stage = root_stage or _stage_from_run_name(entry.name) or _stage_from_run_config(entry)
            if stage in ("hi", "lo", "krea2", "wan21") and entry_stage != stage:
                continue
            expected_epochs = _configured_epochs(folder_path, entry_stage) if entry_stage else 0
            completed, highest_epoch, highest_step = _run_artifact_state(entry, expected_epochs)
            resume_artifacts = _resume_artifacts(entry)
            checkpoint = resume_artifacts[0] if resume_artifacts else None
            checkpoint_tag = ""
            if checkpoint:
                checkpoint_tag = checkpoint.read_text(encoding="utf-8").strip().splitlines()[0].strip()
            training_path = _training_path_for_entry(entry, root, training_root)
            runs.append({
                # DeepSpeed expects the run directory, then resolves its own
                # latest marker or checkpoint tag inside that directory.
                "path": training_path,
                "runPath": training_path,
                "name": entry.name,
                "setName": _set_name_from_run_config(entry, Path(folder_path).name),
                "stage": entry_stage,
                "modifiedAt": modified,
                "checkpointAvailable": bool(checkpoint),
                "checkpointName": checkpoint.name if checkpoint else "",
                "checkpointTag": checkpoint_tag,
                "completed": completed,
                "epoch": highest_epoch or None,
                "steps": highest_step or None,
                "expectedEpochs": expected_epochs or None,
            })
    return sorted(runs, key=lambda run: run["modifiedAt"], reverse=True)


def resumable_run_for_path(folder_path, stage, run_path):
    wanted = str(run_path or "").strip()
    if not wanted:
        return {}
    return next((
        run for run in discover_runs(folder_path, stage)
        if run.get("checkpointAvailable") and str(run.get("path") or "") == wanted
    ), {})


def resume_point_for_path(folder_path, stage, run_path):
    run = resumable_run_for_path(folder_path, stage, run_path)
    if not run:
        return {}
    return {
        "checkpointTag": run.get("checkpointTag") or "",
        "epoch": run.get("epoch"),
        "step": run.get("steps"),
        "expectedEpochs": run.get("expectedEpochs"),
        "completed": bool(run.get("completed")),
    }


def ranked_resumable_runs(folder_path, stage, job=None):
    runs = [run for run in discover_runs(folder_path, stage) if run.get("checkpointAvailable")]
    job = job if isinstance(job, dict) else {}
    preferred_path = str(job.get("outputRunPath") or "").strip()
    started_at = float(job.get("startedAt") or job.get("createdAt") or 0)
    progress = job.get("progress") if isinstance(job.get("progress"), dict) else {}
    expected_step = float(progress.get("step") or 0)
    expected_epoch = float(progress.get("epoch") or 0)

    def timestamp_distance(run):
        if not started_at:
            return float("inf")
        try:
            stamp = datetime.strptime(str(run.get("name") or ""), "%Y%m%d_%H-%M-%S").timestamp()
        except ValueError:
            return float("inf")
        return abs(stamp - started_at)

    def progress_distance(run):
        if expected_step and run.get("steps"):
            return abs(float(run["steps"]) - expected_step)
        if expected_epoch and run.get("epoch"):
            return abs(float(run["epoch"]) - expected_epoch)
        return float("inf")

    return sorted(runs, key=lambda run: (
        0 if str(run.get("path") or "") == preferred_path else 1,
        progress_distance(run),
        timestamp_distance(run),
        -float(run.get("modifiedAt") or 0),
    ))


def summarize_history(folder_path):
    history = read_history(folder_path)
    jobs = history.get("jobs") or []
    latest = jobs[-1] if jobs else None
    return {
        "status": str((latest or {}).get("status") or "never"),
        "updatedAt": (latest or {}).get("updatedAt") or (latest or {}).get("finishedAt") or (latest or {}).get("createdAt") or 0,
    }


def record_job(folder_path, job):
    history = read_history(folder_path)
    runs = discover_runs(folder_path, str(job.get("stages") or ""))
    record_fields = (
        "id", "folder", "stages", "profileId", "runId", "actionRunId", "datasetTarget", "modelLabel", "resumeFromCheckpoint", "resumeStage", "resumePoint", "outputRunPath", "status", "stage",
        "createdAt", "startedAt", "finishedAt", "updatedAt", "error", "completionNote", "exitCode", "parentJobId",
        "outputRoot", "effectiveOutputDir", "outputSlug", "launchGroupId", "sequence", "launchGroupRoot", "progress", "model", "input", "artifactDir", "artifactSummary",
    )
    record = {field: job.get(field) for field in record_fields if field in job}
    for field in ("error", "completionNote"):
        if isinstance(record.get(field), str):
            record[field] = record[field][:1000]
    if isinstance(record.get("model"), dict):
        record["model"] = {
            "label": str(record["model"].get("label") or "")[:160],
            "source": str(record["model"].get("source") or "")[:512],
        }
    latest_run = runs[0] if runs else {}
    record["artifactSummary"] = {
        "runCount": len(runs), "latestName": latest_run.get("name", ""),
        "checkpointAvailable": bool(latest_run.get("checkpointAvailable")),
        "epoch": latest_run.get("epoch"), "steps": latest_run.get("steps"),
    }
    existing = history["jobs"]
    for index, item in enumerate(existing):
        if str(item.get("id") or "") == str(record.get("id") or ""):
            existing[index] = record
            break
    else:
        existing.append(record)
    # Discovery data can be large. It is response-only, never persisted in the index.
    history["runs"] = []
    _write_history(folder_path, history)
    history["runs"] = runs
    return history


def history_payload(folder_path):
    history = read_history(folder_path)
    history["runs"] = discover_runs(folder_path)
    defaults = {}
    for stage in ("hi", "lo", "krea2", "wan21"):
        stage_jobs = [job for job in history.get("jobs") or [] if str(job.get("stages") or "") == stage]
        job = max(stage_jobs, key=lambda item: float(item.get("startedAt") or item.get("createdAt") or 0), default={})
        run = next(iter(ranked_resumable_runs(folder_path, stage, job)), {})
        if run:
            defaults[stage] = run["path"]
    history["resumeDefaults"] = defaults
    return history


def all_history_payload(query="", folder=""):
    """Return persisted history rows; presentation filtering happens in the browser."""
    root = Path(app_config.FS_ROOT)
    jobs = []
    for path in root.rglob(HISTORY_FILE_NAME):
        if ".webcap_training" in path.parts or "auto_dataset" in path.parts:
            continue
        set_folder = path.parent
        try:
            relative = str(set_folder.relative_to(root)).replace("\\", "/")
        except ValueError:
            continue
        history = read_history(set_folder)
        for job in history.get("jobs") or []:
            if not isinstance(job, dict):
                continue
            if job.get("status") == "cancelled":
                continue
            item = dict(job)
            item["folder"] = relative
            jobs.append(item)
    jobs.sort(key=lambda job: float(job.get("finishedAt") or job.get("startedAt") or job.get("createdAt") or 0), reverse=True)
    return {"version": HISTORY_VERSION, "jobs": jobs}


def history_job_output_path(folder_path, job_id):
    wanted = str(job_id or "").strip()
    job = next((item for item in read_history(folder_path).get("jobs", []) if str(item.get("id") or "") == wanted), None)
    if not job or not str(job.get("outputRoot") or "").strip():
        raise ValueError("Training history entry has no effective output directory.")
    return Path(job["outputRoot"])


def clear_history(folder_path=None):
    """Clear indexes only; job bundles and trainer artifacts are deliberately untouched."""
    root = Path(app_config.FS_ROOT)
    paths = [_history_path(folder_path)] if folder_path else list(root.rglob(HISTORY_FILE_NAME))
    cleared = 0
    for path in paths:
        try:
            if path.exists():
                path.unlink()
                cleared += 1
        except OSError:
            continue
    return cleared


def clear_history_job(folder_path, job_id):
    """Remove one history index entry without touching its logs or training artifacts."""
    history = read_history(folder_path)
    wanted_id = str(job_id or "").strip()
    if not wanted_id:
        return False
    original = history.get("jobs") or []
    retained = [job for job in original if str(job.get("id") or "") != wanted_id]
    if len(retained) == len(original):
        return False
    history["jobs"] = retained
    _write_history(folder_path, history)
    return True


def completed_stages(folder_path):
    folder = Path(folder_path)
    stages = [stage for stage in ("hi", "lo", "krea2", "wan21") if (folder / ("config." + stage + ".toml")).is_file()]
    history = read_history(folder)
    completed = set()
    for job in history.get("jobs") or []:
        if job.get("status") not in ("completed", "finished_early"):
            continue
        stage = str(job.get("stages") or "")
        if stage == "both":
            completed.update(stages)
        elif stage in stages:
            completed.add(stage)
    for stage in stages:
        if any(run.get("completed") for run in discover_runs(folder, stage)):
            completed.add(stage)
    return stages, completed
