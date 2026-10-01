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
from .training_action import read_action
from .training_history import all_history_payload, clear_history_job
from .training_run_manifest import read_run_manifest, record_archive_metadata
from .training_runner import action_live_job_ids, candidate_run_snapshot
from .training_test_paths import test_copy_destination, test_source_path


_EPOCH_RE = re.compile(r"^epoch(\d+)$", re.IGNORECASE)
_STEP_RE = re.compile(r"^global_step\d+$", re.IGNORECASE)
ARCHIVABLE_STATUSES = {"completed", "finished_early", "failed", "stopped", "interrupted"}


def archive_root():
    return Path(app_config.FS_ROOT) / "output" / "archive"


def _safe_archive_name(value):
    name = str(value or "").strip()
    if not name or name in {".", ".."} or Path(name).name != name or "/" in name or "\\" in name:
        raise ValueError("Archive name must be a single folder name.")
    return name


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


def _staged_candidates(folder, job_id, stage):
    set_name = PurePosixPath(str(folder or "").replace("\\", "/")).name
    root, parts = test_copy_destination(stage, set_name)
    directory = root.joinpath(*parts)
    if not directory.exists():
        return []
    if not directory.is_dir() or directory.is_symlink():
        raise RuntimeError("Configured staged Test directory is invalid.")
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
        if str(payload.get("sourceJobId") or "").strip() == str(job_id):
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


def _context(folder, job_id):
    run_dir, run = candidate_run_snapshot(folder, job_id)
    status = str(run.get("status") or "").strip()
    if status not in ARCHIVABLE_STATUSES:
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
    staged = _staged_candidates(folder, job_id, str(run.get("stages") or "").strip().lower())
    active_test = _active_test_candidate_names(folder)
    targeted_active = [candidate.name for candidate, _sidecar, _payload in staged if candidate.name in active_test]
    if targeted_active:
        raise RuntimeError("Staged Test candidates are still referenced by active Test work: " + ", ".join(targeted_active))
    sibling_outputs = [
        path for path in output_root.iterdir()
        if path.is_dir() and not path.is_symlink() and path.resolve() != run_dir
    ]
    related = [
        job for job in all_history_payload(folder=folder).get("jobs") or []
        if str(job.get("id") or "") != str(job_id)
    ]
    return {
        "runDir": run_dir,
        "run": run,
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
        "siblingOutputs": sibling_outputs,
        "relatedRuns": related,
    }


def preview(folder, job_id):
    context = _context(folder, job_id)
    alternates = sorted(epoch for epoch in context["epochs"] if epoch != context["selectedEpoch"])
    return {
        "jobId": str(job_id),
        "folder": str(folder),
        "runName": str(context["run"].get("runName") or ""),
        "stage": str(context["run"].get("stages") or ""),
        "archiveName": context["runDir"].name,
        "selectedEpoch": context["selected"],
        "productionFileName": context["production"].name,
        "availableAlternateEpochs": alternates,
        "epochCount": len(context["epochs"]),
        "globalStepCount": len(context["globalSteps"]),
        "stagedCandidateCount": len(context["staged"]),
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


def finalize(folder, job_id, archive_name, retain_epochs=None):
    context = _context(folder, job_id)
    destination_name = _safe_archive_name(archive_name)
    retained = sorted({int(value) for value in (retain_epochs or [])})
    if context["selectedEpoch"] in retained:
        raise ValueError("The production Selected epoch is not an archive alternate.")
    unknown = [epoch for epoch in retained if epoch not in context["epochs"]]
    if unknown:
        raise ValueError("Requested retained epoch is unavailable: " + ", ".join(map(str, unknown)))
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

    record_archive_metadata(
        context["runDir"],
        context["actionId"],
        {
            "archivedAt": time.time(),
            "archiveName": destination_name,
            "sourceJobId": str(job_id),
            "sourceFolder": str(folder),
            "runName": str(context["run"].get("runName") or ""),
            "stage": str(context["run"].get("stages") or ""),
            "runSummary": context["run"].get("runSummary") if isinstance(context["run"].get("runSummary"), dict) else {},
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
        if any(output_root.iterdir()):
            raise RuntimeError("Managed action output contains unexpected residual artifacts after archival.")
        shutil.rmtree(context["actionRoot"])
        action_removed = True
        try:
            context["actionRoot"].parent.rmdir()
        except OSError:
            pass

    clear_history_job(app_config.safe_join_fs_root(folder), job_id)
    return {
        "archiveName": destination_name,
        "archivePath": str(destination),
        "selectedEpoch": context["selectedEpoch"],
        "retainedAlternateEpochs": retained,
        "removedStagedCandidates": len(context["staged"]),
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
            raise RuntimeError("Archive is missing webcap-run.json: " + directory.name)
        try:
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError("Archive manifest is unreadable: " + directory.name) from exc
        run_id = str(raw.get("runId") or "").strip()
        manifest = read_run_manifest(directory, run_id)
        archive = manifest.get("archive")
        if not isinstance(archive, dict):
            raise RuntimeError("Archive manifest has no archive metadata: " + directory.name)
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
    rows.sort(key=lambda row: float(row.get("archivedAt") or 0), reverse=True)
    return rows
