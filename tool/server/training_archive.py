import errno
import json
import os
import re
import shutil
import time
import uuid
from pathlib import Path, PurePosixPath

from . import config as app_config
from .execution_queue import lane_snapshot as execution_lane_snapshot
from .epoch_test_bench import clear_sessions as clear_test_sessions, session_cleanup_status as test_session_cleanup_status
from .training_action import read_action
from .training_candidates import aggregate_detailed_loss_by_epoch, map_detailed_loss_to_epochs, read_loss_events, smooth_step_loss
from .training_history import all_history_payload, clear_history_job
from .training_run_manifest import read_run_manifest, record_archive_metadata
from .training_runner import action_live_job_ids, candidate_run_snapshot, candidate_run_snapshot_from_provenance, candidate_staged_run_snapshot
from .training_test_paths import test_copy_destination, test_source_path


_EPOCH_RE = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_RE = re.compile(r"^global_step\d+$", re.IGNORECASE)
ARCHIVABLE_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted"}


def archive_root():
    return Path(app_config.FS_ROOT) / "output" / "archive"


def _sibling_output_directories(output_root, run_dir):
    return [
        path for path in Path(output_root).iterdir()
        if path.name != ".webcap"
        and path.is_dir()
        and not path.is_symlink()
        and path.resolve() != Path(run_dir).resolve()
    ]


def _safe_archive_name(value):
    name = str(value or "").strip()
    if not name or name in {".", ".."} or Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("Archive name must be a single folder name.")
    return name


def _archive_metrics_from_events(detailed_events, epoch_events, selected_epoch, retained_epochs):
    selected_epoch = int(selected_epoch)
    completed = sorted(epoch_events, key=lambda point: int(point["axis"]))
    epoch_by_number = {int(point["axis"]): point for point in completed}
    selected_event = epoch_by_number.get(selected_epoch)
    if selected_event is None:
        raise ValueError("Selected epoch has no completed TensorBoard epoch-loss point.")

    mapped = map_detailed_loss_to_epochs(detailed_events, epoch_events)
    robust_points = aggregate_detailed_loss_by_epoch(mapped, epoch_events)
    robust_by_epoch = {int(point["epoch"]): point for point in robust_points}
    selected_robust = robust_by_epoch.get(selected_epoch)
    if selected_robust is None:
        raise ValueError("Selected epoch has no detailed TensorBoard loss samples.")

    completed_epochs = set(robust_by_epoch)
    step_points = sorted([
        {"step": int(point["step"]), "epoch": int(point["epoch"]), "loss": float(point["loss"])}
        for point in mapped
        if int(point["epoch"]) in completed_epochs
    ], key=lambda point: point["step"])
    smoothed = [
        point for point in smooth_step_loss(step_points)
        if int(point["epoch"]) == selected_epoch
    ]
    smoothed_loss = float(smoothed[-1]["loss"]) if smoothed else None

    selected_index = next(index for index, point in enumerate(completed) if int(point["axis"]) == selected_epoch)
    starting = completed[0]
    comparison_index = max(0, selected_index - 5)
    comparison = completed[comparison_index]
    selected_loss = float(selected_event["loss"])
    starting_loss = float(starting["loss"])
    comparison_loss = float(comparison["loss"])

    first_wall_time = min(
        [float(point["wallTime"]) for point in detailed_events] +
        [float(point["wallTime"]) for point in epoch_events]
    )
    selected_wall_time = float(selected_event["wallTime"])
    previous_wall_time = (
        float(completed[selected_index - 1]["wallTime"])
        if selected_index > 0 else first_wall_time
    )

    return {
        "selectedEpoch": selected_epoch,
        "step": int(selected_robust["endStep"]),
        "stepStart": int(selected_robust["startStep"]),
        "stepEnd": int(selected_robust["endStep"]),
        "epochLoss": selected_loss,
        "smoothedLoss": smoothed_loss,
        "startingEpoch": int(starting["axis"]),
        "startingLoss": starting_loss,
        "lossReductionPercent": (
            ((starting_loss - selected_loss) / starting_loss) * 100.0
            if starting_loss else None
        ),
        "recentComparisonEpoch": int(comparison["axis"]),
        "recentComparisonLoss": comparison_loss,
        "recentWindowEpochs": max(0, selected_epoch - int(comparison["axis"])),
        "recentLossChangePercent": (
            ((selected_loss - comparison_loss) / comparison_loss) * 100.0
            if comparison_loss else None
        ),
        "trainingSecondsToSelected": max(0.0, selected_wall_time - first_wall_time),
        "selectedEpochSeconds": max(0.0, selected_wall_time - previous_wall_time),
        "epochLossPoints": [
            {"epoch": int(point["axis"]), "loss": float(point["loss"])}
            for point in completed
        ],
        "savedEpochs": sorted({selected_epoch} | {int(value) for value in retained_epochs}),
    }


def archive_metrics(archive_name):
    name = _safe_archive_name(archive_name)
    directory = archive_root() / name
    if not directory.is_dir() or directory.is_symlink():
        raise FileNotFoundError("Archived training run is unavailable: " + name)
    manifest_path = directory / "webcap-run.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise FileNotFoundError("Archive is missing webcap-run.json: " + name)
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("Archive manifest is unreadable: " + name) from exc
    run_id = str(raw.get("runId") or "").strip()
    manifest = read_run_manifest(directory, run_id)
    archive = manifest.get("archive")
    if not isinstance(archive, dict):
        raise ValueError("Archive manifest has no archive metadata: " + name)
    selected_epoch = archive.get("selectedEpoch")
    if selected_epoch is None:
        raise ValueError("Archive manifest has no selected epoch: " + name)
    retained = archive.get("retainedAlternateEpochs") if isinstance(archive.get("retainedAlternateEpochs"), list) else []
    checkpoint_wall_time = archive.get("resumeCheckpointWallTime")
    branch_started_at = archive.get("resumeBranchStartedAt")
    if (checkpoint_wall_time is None) != (branch_started_at is None):
        raise ValueError("Archive manifest has incomplete resume-branch metadata: " + name)
    detailed_events, epoch_events = (
        read_loss_events(directory, checkpoint_wall_time, branch_started_at)
        if checkpoint_wall_time is not None
        else read_loss_events(directory)
    )
    return _archive_metrics_from_events(detailed_events, epoch_events, selected_epoch, retained)


def _epoch_directories(run_dir):
    rows = {}
    for child in Path(run_dir).iterdir():
        if not child.is_dir() or child.is_symlink():
            continue
        match = _EPOCH_RE.fullmatch(child.name)
        if match:
            rows[int(match.group(1))] = child
    return rows


def _global_step_directories(run_dir):
    return [
        child for child in Path(run_dir).iterdir()
        if child.is_dir() and not child.is_symlink() and _STEP_RE.fullmatch(child.name)
    ]


def _staged_candidates(folder, run_dir, action_id, stage):
    root, parts = test_copy_destination(stage, folder)
    directory = root.joinpath(*parts)
    if not directory.exists():
        return []
    if not directory.is_dir() or directory.is_symlink():
        raise RuntimeError("Configured staged Test directory is invalid.")
    wanted_run = Path(run_dir).resolve(strict=True)
    wanted_action = str(action_id or "").strip()
    matches = []
    for candidate in directory.iterdir():
        if candidate.suffix.lower() != ".safetensors" or candidate.is_symlink() or not candidate.is_file():
            continue
        sidecar = candidate.with_suffix(".webcap.json")
        if not sidecar.is_file() or sidecar.is_symlink():
            continue
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Staged Test provenance is unreadable: " + sidecar.name) from exc
        if not isinstance(payload, dict) or payload.get("version") != 1:
            raise RuntimeError("Staged Test provenance is invalid: " + sidecar.name)
        try:
            candidate_run_dir, candidate_run = candidate_run_snapshot_from_provenance(payload)
        except (LookupError, FileNotFoundError):
            continue
        if candidate_run_dir == wanted_run and str(candidate_run.get("actionId") or "").strip() == wanted_action:
            matches.append((candidate, sidecar, payload))
    return matches


def _active_test_candidate_names(folder):
    folder_key = str(folder or "").strip().replace("\\", "/").strip("/")
    active = set()
    snapshot = execution_lane_snapshot("inference", include_terminal=False)
    for job in snapshot.get("jobs") or []:
        if not isinstance(job, dict):
            continue
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "test":
            continue
        if str(metadata.get("folder") or "").strip().replace("\\", "/").strip("/") != folder_key:
            continue
        candidate = str(metadata.get("candidateFile") or "").strip()
        if candidate:
            active.add(candidate)
    return active


def _production_path(selected):
    stage = str(selected.get("savedStage") or "").strip().lower()
    destination = str(selected.get("savedDestination") or "").strip()
    file_name = str(selected.get("savedFileName") or "").strip()
    if not stage or not file_name:
        raise RuntimeError("Selected epoch has no recorded production LoRA. Save/Select it again before archiving.")
    root = test_source_path(stage, destination)
    path = root / file_name
    if path.is_symlink() or not path.is_file():
        raise FileNotFoundError("Recorded production LoRA is unavailable: " + file_name)
    return path


def _context(folder, job_id="", stage="", staged_file_name=""):
    staged_source = bool(str(staged_file_name or "").strip())
    if staged_source:
        _candidate, provenance, run_dir, run = candidate_staged_run_snapshot(folder, stage, staged_file_name)
        effective_job_id = str(run.get("id") or provenance.get("sourceJobId") or "").strip()
    else:
        if not str(job_id or "").strip():
            raise ValueError("Training job ID is required.")
        run_dir, run = candidate_run_snapshot(folder, job_id)
        effective_job_id = str(job_id)
    status = str(run.get("status") or "").strip()
    if not staged_source and status not in ARCHIVABLE_STATUSES:
        raise RuntimeError("Training run is not terminal and cannot be archived.")
    action_id = str(run.get("actionId") or "").strip()
    if not action_id:
        raise RuntimeError("Training run has no managed action identity.")
    action_root, action = read_action(action_id)
    output_root = action_root / "output"
    if run_dir.parent != output_root.resolve():
        raise RuntimeError("Recorded trainer run is not owned by the expected managed action output.")
    manifest = read_run_manifest(run_dir, action_id)
    selected = manifest.get("selected")
    if not isinstance(selected, dict):
        raise RuntimeError("Finalize & Archive requires a selected epoch.")
    selected_epoch = int(selected.get("epoch"))
    epochs = _epoch_directories(run_dir)
    if selected_epoch not in epochs:
        raise FileNotFoundError("Selected epoch folder is unavailable.")
    safetensors = [
        path for path in epochs[selected_epoch].iterdir()
        if path.is_file() and not path.is_symlink() and path.suffix.lower() == ".safetensors"
    ]
    if len(safetensors) != 1:
        raise RuntimeError("Selected epoch must contain exactly one .safetensors artifact before archival.")
    production = _production_path(selected)
    live_jobs = action_live_job_ids(action_id)
    if live_jobs:
        raise RuntimeError("Training action still has live or queued work: " + ", ".join(live_jobs))
    staged = _staged_candidates(folder, run_dir, action_id, str(run.get("stages") or "").strip().lower())
    set_folder = app_config.safe_join_fs_root(folder)
    test_cleanup = test_session_cleanup_status(set_folder)
    if test_cleanup["active"]:
        raise RuntimeError(
            "Stop active or queued Test Generations work before archiving this Set: "
            + ", ".join(test_cleanup["active"])
        )
    active_test = _active_test_candidate_names(folder)
    targeted_active = [candidate.name for candidate, _sidecar, _payload in staged if candidate.name in active_test]
    if targeted_active:
        raise RuntimeError("Staged Test candidates are still referenced by active Test work: " + ", ".join(targeted_active))
    sibling_outputs = _sibling_output_directories(output_root, run_dir)
    related = [
        job for job in all_history_payload(folder=folder).get("jobs") or []
        if str(job.get("id") or "") != effective_job_id
    ]
    return {
        "runDir": run_dir,
        "run": run,
        "jobId": effective_job_id,
        "stagedFileName": str(staged_file_name or "").strip(),
        "actionRoot": action_root,
        "action": action,
        "actionId": action_id,
        "outputRoot": output_root,
        "manifest": manifest,
        "selected": selected,
        "selectedEpoch": selected_epoch,
        "epochs": epochs,
        "globalSteps": _global_step_directories(run_dir),
        "production": production,
        "staged": staged,
        "testCleanup": test_cleanup,
        "siblingOutputs": sibling_outputs,
        "relatedRuns": related,
    }


def _staged_alternate_candidates(context):
    rows = []
    seen = set()
    for candidate, _sidecar, payload in context["staged"]:
        try:
            epoch = int(payload.get("sourceEpoch"))
        except (TypeError, ValueError):
            raise RuntimeError("Staged Test provenance has no usable source epoch: " + candidate.name)
        if epoch == context["selectedEpoch"]:
            continue
        if epoch not in context["epochs"]:
            raise RuntimeError("Staged Test candidate points to an unavailable epoch: " + candidate.name)
        if epoch in seen:
            continue
        seen.add(epoch)
        rows.append({"epoch": epoch, "fileName": candidate.name})
    rows.sort(key=lambda row: row["epoch"])
    return rows


def preview(folder, job_id="", stage="", staged_file_name=""):
    context = _context(folder, job_id, stage=stage, staged_file_name=staged_file_name)
    alternates = _staged_alternate_candidates(context)
    return {
        "jobId": str(context.get("jobId") or ""),
        "stagedFileName": str(context.get("stagedFileName") or ""),
        "folder": str(folder),
        "runName": str(context["run"].get("runName") or ""),
        "stage": str(context["run"].get("stages") or ""),
        "archiveName": context["runDir"].name,
        "selectedEpoch": context["selected"],
        "productionFileName": context["production"].name,
        "availableAlternateCandidates": alternates,
        "availableAlternateEpochs": [row["epoch"] for row in alternates],
        "epochCount": len(context["epochs"]),
        "globalStepCount": len(context["globalSteps"]),
        "stagedCandidateCount": len(context["staged"]),
        "testSessionCount": int(context["testCleanup"].get("count") or 0),
        "relatedRunCount": len(context["relatedRuns"]),
        "siblingOutputCount": len(context["siblingOutputs"]),
        "willRemoveActionRoot": not context["siblingOutputs"],
        "runSummary": context["run"].get("runSummary") if isinstance(context["run"].get("runSummary"), dict) else {},
    }


def _tree_signature(root):
    result = {}
    base = Path(root)
    for path in base.rglob("*"):
        if path.is_symlink():
            raise RuntimeError("Archive source contains a symlink: " + str(path))
        if path.is_file():
            result[path.relative_to(base).as_posix()] = path.stat().st_size
    return result


def _move_archive(source, destination):
    try:
        os.replace(source, destination)
        return
    except OSError as exc:
        if exc.errno != errno.EXDEV:
            raise
    temporary = destination.with_name("." + destination.name + "." + uuid.uuid4().hex + ".tmp")
    shutil.copytree(source, temporary)
    if _tree_signature(source) != _tree_signature(temporary):
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError("Cross-filesystem archive verification failed; source was left intact.")
    os.replace(temporary, destination)
    shutil.rmtree(source)


def finalize(folder, job_id, archive_name, retain_epochs=None, stage="", staged_file_name=""):
    context = _context(folder, job_id, stage=stage, staged_file_name=staged_file_name)
    destination_name = _safe_archive_name(archive_name)
    retained = sorted({int(value) for value in (retain_epochs or [])})
    if context["selectedEpoch"] in retained:
        raise ValueError("The production Selected epoch is not an archive alternate.")
    staged_alternates = {row["epoch"] for row in _staged_alternate_candidates(context)}
    unknown = [epoch for epoch in retained if epoch not in staged_alternates]
    if unknown:
        raise ValueError("Requested retained epoch is not present in the staged candidate folder: " + ", ".join(map(str, unknown)))
    for epoch in retained:
        artifacts = [
            path for path in context["epochs"][epoch].iterdir()
            if path.is_file() and not path.is_symlink() and path.suffix.lower() == ".safetensors"
        ]
        if len(artifacts) != 1:
            raise RuntimeError("Retained alternate epoch " + str(epoch) + " must contain exactly one .safetensors artifact.")

    root = archive_root()
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise RuntimeError("Archive root is symlinked.")
    destination = root / destination_name
    if destination.exists() or destination.is_symlink():
        raise FileExistsError("Archive destination already exists: " + destination_name)

    archived_at = time.time()
    record_archive_metadata(
        context["runDir"],
        context["actionId"],
        {
            "archivedAt": archived_at,
            "archiveName": destination_name,
            "sourceJobId": str(context.get("jobId") or ""),
            "sourceFolder": str(folder),
            "runName": str(context["run"].get("runName") or ""),
            "stage": str(context["run"].get("stages") or ""),
            "runSummary": context["run"].get("runSummary") if isinstance(context["run"].get("runSummary"), dict) else {},
            "resumeCheckpointWallTime": context["run"].get("resumeCheckpointWallTime"),
            "resumeBranchStartedAt": context["run"].get("resumeBranchStartedAt"),
            "productionFileName": context["production"].name,
            "selectedEpoch": context["selectedEpoch"],
            "retainedAlternateEpochs": retained,
        },
    )

    _move_archive(context["runDir"], destination)

    archived_epochs = _epoch_directories(destination)
    for epoch, path in archived_epochs.items():
        if epoch not in retained:
            shutil.rmtree(path)
    for path in _global_step_directories(destination):
        shutil.rmtree(path)

    for candidate, sidecar, _payload in context["staged"]:
        candidate.unlink()
        sidecar.unlink()

    action_removed = False
    if not context["siblingOutputs"]:
        output_root = context["outputRoot"]
        unexpected = [path for path in output_root.iterdir() if path.name != ".webcap"]
        if unexpected:
            raise RuntimeError(
                "Managed action output contains unexpected residual artifacts after archival: "
                + ", ".join(sorted(path.name for path in unexpected))
            )
        shutil.rmtree(context["actionRoot"])
        action_removed = True
        try:
            context["actionRoot"].parent.rmdir()
        except OSError:
            pass

    set_folder = app_config.safe_join_fs_root(folder)
    if context.get("jobId"):
        clear_history_job(set_folder, context["jobId"])
    last_training_archive = {
        "archivedAt": archived_at,
        "archiveName": destination_name,
        "runName": str(context["run"].get("runName") or ""),
        "stage": str(context["run"].get("stages") or ""),
        "selectedEpoch": context["selectedEpoch"],
        "productionFileName": context["production"].name,
    }
    test_cleanup_warning = ""
    removed_test_sessions = 0
    try:
        removed_test_sessions = clear_test_sessions(set_folder)
    except (OSError, RuntimeError, ValueError) as exc:
        test_cleanup_warning = str(exc)
    return {
        "archiveName": destination_name,
        "archivePath": str(destination),
        "selectedEpoch": context["selectedEpoch"],
        "retainedAlternateEpochs": retained,
        "removedStagedCandidates": len(context["staged"]),
        "removedTestSessions": removed_test_sessions,
        "testCleanupWarning": test_cleanup_warning,
        "lastTrainingArchive": last_training_archive,
        "actionRemoved": action_removed,
    }


def list_archives():
    root = archive_root()
    if not root.exists():
        return []
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError("Archive root is invalid.")
    rows = []
    for directory in sorted(root.iterdir(), key=lambda path: path.name.lower()):
        if not directory.is_dir() or directory.is_symlink():
            continue
        manifest_path = directory / "webcap-run.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            rows.append({
                "name": directory.name,
                "invalid": True,
                "error": "Archive is missing webcap-run.json.",
            })
            continue
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            rows.append({
                "name": directory.name,
                "invalid": True,
                "error": "Archive manifest is unreadable.",
            })
            continue
        run_id = str(raw.get("runId") or "").strip()
        try:
            manifest = read_run_manifest(directory, run_id)
        except (OSError, RuntimeError, ValueError) as exc:
            rows.append({
                "name": directory.name,
                "invalid": True,
                "error": "Archive manifest is invalid: " + str(exc),
            })
            continue
        archive = manifest.get("archive")
        if not isinstance(archive, dict):
            rows.append({
                "name": directory.name,
                "invalid": True,
                "error": "Archive manifest has no archive metadata.",
            })
            continue
        rows.append({
            "name": directory.name,
            "runId": run_id,
            "archivedAt": archive.get("archivedAt"),
            "sourceFolder": archive.get("sourceFolder"),
            "runName": archive.get("runName"),
            "stage": archive.get("stage"),
            "runSummary": archive.get("runSummary") if isinstance(archive.get("runSummary"), dict) else {},
            "selectedEpoch": archive.get("selectedEpoch"),
            "productionFileName": archive.get("productionFileName"),
            "retainedAlternateEpochs": archive.get("retainedAlternateEpochs") if isinstance(archive.get("retainedAlternateEpochs"), list) else [],
        })
    rows.sort(key=lambda row: (bool(row.get("invalid")), -float(row.get("archivedAt") or 0), str(row.get("name") or "").lower()))
    return rows
