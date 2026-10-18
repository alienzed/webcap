"""Explicit permanent deletion of one completed physical Training run.

No scheduler transitions, archive operations, or automatic dependency repairs.
"""
import json
import shutil
from pathlib import Path

from . import config as app_config
from .training_action import read_action, update_action
from .training_history import _read_recent_runs, _write_recent_runs, _history_lock, host_path_for_training_path
from .training_test_paths import TEST_COPY_STAGE_LABELS, test_copy_destination


def _existing_or_absent(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Refusing to delete a symlink: " + str(path))
    return path


def _under(path, parent):
    path = Path(path).absolute()
    parent = Path(parent).absolute()
    if path == parent or parent not in path.parents:
        raise ValueError("Deletion target escapes its owning directory: " + str(path))
    return path


def _physical_path(job):
    raw = str(job.get("outputRunPath") or "").strip()
    if not raw:
        raise ValueError("This historical job has no recorded physical trainer run directory.")
    return Path(host_path_for_training_path(raw)).absolute()


def _preview_locked(folder, job_id):
    from . import training_runner as runner

    folder = str(folder or "").strip().replace("\\", "/").strip("/")
    app_config.safe_join_fs_root(folder)
    recent = _read_recent_runs()
    selected = next((job for job in recent["jobs"]
                     if job.get("id") == job_id and job.get("folder") == folder), None)
    if selected is None:
        raise LookupError("Training History entry not found.")
    physical = _physical_path(selected)
    action_id = str(selected.get("actionId") or "").strip()
    if not action_id:
        raise ValueError("Historical run has no recorded managed action identity.")
    action_root, action = read_action(action_id)
    action_root = Path(action_root).absolute()
    if str(action.get("folder") or "") != folder:
        raise ValueError("Historical action belongs to a different Set.")
    _under(physical, action_root / "output")
    if physical.parent != (action_root / "output").absolute():
        raise ValueError("Expected an immediate timestamped trainer output folder.")
    if physical.exists() and (not physical.is_dir() or physical.is_symlink()):
        raise ValueError("Trainer output target is not a normal directory.")

    matching = []
    for item in recent["jobs"]:
        if not isinstance(item, dict):
            continue
        raw = str(item.get("outputRunPath") or "").strip()
        if raw and _physical_path(item) == physical:
            matching.append(item)
    ids = {str(item.get("id") or "") for item in matching}
    state = runner._read_state_readonly()
    protected_statuses = runner.ACTIVE_STATUSES | runner.QUEUE_STATUSES
    for queued in state["jobs"]:
        if queued.get("status") in protected_statuses:
            referenced = [queued.get("outputRunPath"), queued.get("resumeFromCheckpoint")]
            if any(str(value or "").strip() and
                   (Path(host_path_for_training_path(value)).absolute() == physical or
                    physical in Path(host_path_for_training_path(value)).absolute().parents)
                   for value in referenced):
                raise RuntimeError("Active or queued Training depends on this run; finish/cancel that job first.")
            if str(queued.get("actionId") or "") == action_id:
                for item in matching:
                    if (queued.get("inputPath") and queued.get("inputPath") == item.get("inputPath")) or (
                        queued.get("recordPath") and queued.get("recordPath") == item.get("recordPath")
                    ):
                        raise RuntimeError("Active or queued Training uses a captured input from this run.")
        elif str(queued.get("id") or "") in ids:
            raise RuntimeError("Terminal Training queue handoff is pending; reconcile the Training queue first.")

    # Action leaves are individually owned; capture directories can be reused.
    paths = []
    remaining = [j for j in recent["jobs"] if j not in matching]
    for item in matching:
        owner_id = str(item.get("actionId") or "")
        owner_root, owner_action = read_action(owner_id)
        owner_root = Path(owner_root).absolute()
        for key, base in (("artifactDir", owner_root / "jobs"),
                          ("recordPath", owner_root / "captures"),
                          ("inputPath", owner_root / "captures")):
            raw = str(item.get(key) or "").strip()
            if not raw:
                continue
            target = Path(raw).absolute()
            _under(target, base)
            if key != "artifactDir" and any(
                other.get(key) == raw or other.get("inputPath") == raw or other.get("recordPath") == raw
                for other in remaining
            ):
                continue
            if key != "artifactDir":
                target = target if target.parent.name == "captures" else target.parent
                _under(target, owner_root / "captures")
            if target != physical and target not in paths:
                paths.append(target)

    # Verify matching Copy to Test files using the sidecar, not their filenames.
    copies = []
    for item in matching:
        stage = str(item.get("stages") or "").lower()
        if stage not in TEST_COPY_STAGE_LABELS:
            continue
        root, parts = test_copy_destination(stage, folder)
        directory = Path(root).joinpath(*parts)
        if not directory.is_dir() or directory.is_symlink():
            continue
        for sidecar in directory.glob("*.webcap.json"):
            if sidecar.is_symlink() or not sidecar.is_file():
                continue
            try:
                provenance = json.loads(sidecar.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(provenance, dict) or provenance.get("version") != 1:
                continue
            if str(provenance.get("sourceActionId") or "") != str(item.get("actionId") or ""):
                continue
            if str(provenance.get("sourceFolder") or "") != folder:
                continue
            run_path = str(provenance.get("sourceRunPath") or "")
            if not run_path or Path(host_path_for_training_path(run_path)).absolute() != physical:
                continue
            candidate = sidecar.with_name(sidecar.name[:-len(".webcap.json")] + ".safetensors") if sidecar.name.endswith(".webcap.json") else None
            if candidate is None:
                continue
            if candidate.is_symlink():
                raise ValueError("Refusing symlinked Test candidate.")
            if str(sidecar) not in [str(pair[1]) for pair in copies]:
                copies.append((candidate, sidecar))

    return {
        "folder": folder, "jobId": job_id, "output": physical,
        "artifacts": paths, "jobs": matching, "historyIds": ids,
        "candidateCopies": copies,
    }


def preview(folder, job_id):
    from . import training_runner as runner
    with runner._lock:
        with _history_lock:
            plan = _preview_locked(folder, job_id)
    return {"output": str(plan["output"]), "artifacts": [str(x) for x in plan["artifacts"]],
            "historyCount": len(plan["jobs"]), "candidateCount": len(plan["candidateCopies"])}


def delete(folder, job_id, delete_candidates=True):
    from . import training_runner as runner
    with runner._lock:
        with _history_lock:
            plan = _preview_locked(folder, job_id)
            targets = [plan["output"]] + plan["artifacts"]
            if delete_candidates:
                for candidate, sidecar in plan["candidateCopies"]:
                    for target in (candidate, sidecar):
                        if target.is_symlink():
                            raise ValueError("Refusing to delete symlinked candidate.")
                        target.unlink(missing_ok=True)
            for target in targets:
                _existing_or_absent(target)
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    raise ValueError("Expected a run-owned directory: " + str(target))
            # Reconcile only records associated with the deleted jobs/captures.
            # Keep other action records even when they share the logical action.
            by_action = {}
            for item in plan["jobs"]:
                by_action.setdefault(str(item.get("actionId") or ""), set()).add(str(item.get("id") or ""))
            for action_id, deleted_ids in by_action.items():
                if not action_id:
                    continue
                def prune_action(data):
                    data["captures"] = [
                        entry for entry in data.get("captures", [])
                        if str(entry.get("jobId") or "") not in deleted_ids
                    ]
                    jobs = data.get("jobs", {})
                    for stage, entries in jobs.items():
                        jobs[stage] = [
                            entry for entry in entries
                            if str(entry.get("id") or "") not in deleted_ids
                        ]
                update_action(action_id, prune_action)
            recent = _read_recent_runs()
            recent["jobs"] = [job for job in recent["jobs"]
                              if not (job.get("id") in plan["historyIds"] and
                                      job.get("folder") == plan["folder"])]
            _write_recent_runs(recent)
    return {"deletedHistory": len(plan["jobs"]), "deletedCandidates": len(plan["candidateCopies"]) if delete_candidates else 0}
