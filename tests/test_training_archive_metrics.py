import json

import pytest

from tool.server import training_archive
from tool.server.training_archive import _archive_metrics_from_events


def test_archive_metrics_describe_selected_epoch_without_scoring_quality():
    epoch_events = [
        {"axis": 1, "loss": 1.00, "wallTime": 100.0, "order": 0},
        {"axis": 2, "loss": 0.80, "wallTime": 160.0, "order": 1},
        {"axis": 3, "loss": 0.65, "wallTime": 220.0, "order": 2},
        {"axis": 4, "loss": 0.55, "wallTime": 280.0, "order": 3},
        {"axis": 5, "loss": 0.48, "wallTime": 340.0, "order": 4},
        {"axis": 6, "loss": 0.40, "wallTime": 400.0, "order": 5},
    ]
    detailed_events = [
        {"axis": 1, "loss": 1.10, "wallTime": 70.0, "order": 0},
        {"axis": 10, "loss": 0.90, "wallTime": 90.0, "order": 1},
        {"axis": 11, "loss": 0.85, "wallTime": 120.0, "order": 2},
        {"axis": 20, "loss": 0.75, "wallTime": 150.0, "order": 3},
        {"axis": 21, "loss": 0.70, "wallTime": 180.0, "order": 4},
        {"axis": 30, "loss": 0.60, "wallTime": 210.0, "order": 5},
        {"axis": 31, "loss": 0.60, "wallTime": 240.0, "order": 6},
        {"axis": 40, "loss": 0.50, "wallTime": 270.0, "order": 7},
        {"axis": 41, "loss": 0.52, "wallTime": 300.0, "order": 8},
        {"axis": 50, "loss": 0.44, "wallTime": 330.0, "order": 9},
        {"axis": 51, "loss": 0.42, "wallTime": 360.0, "order": 10},
        {"axis": 60, "loss": 0.38, "wallTime": 390.0, "order": 11},
    ]

    metrics = _archive_metrics_from_events(detailed_events, epoch_events, 6, [3, 5])

    assert metrics["selectedEpoch"] == 6
    assert metrics["step"] == 60
    assert metrics["stepStart"] == 51
    assert metrics["stepEnd"] == 60
    assert metrics["epochLoss"] == pytest.approx(0.40)
    assert metrics["smoothedLoss"] is not None
    assert metrics["startingEpoch"] == 1
    assert metrics["startingLoss"] == pytest.approx(1.00)
    assert metrics["lossReductionPercent"] == pytest.approx(60.0)
    assert metrics["recentComparisonEpoch"] == 1
    assert metrics["recentWindowEpochs"] == 5
    assert metrics["recentLossChangePercent"] == pytest.approx(-60.0)
    assert metrics["trainingSecondsToSelected"] == pytest.approx(330.0)
    assert metrics["selectedEpochSeconds"] == pytest.approx(60.0)
    assert metrics["savedEpochs"] == [3, 5, 6]
    assert len(metrics["epochLossPoints"]) == 6



def test_archive_metrics_reuses_persisted_resume_branch_boundary(tmp_path, monkeypatch):
    root = tmp_path / "archive"
    directory = root / "resumed"
    directory.mkdir(parents=True)
    (directory / "webcap-run.json").write_text('{"runId":"action/run"}', encoding="utf-8")
    manifest = {
        "archive": {
            "selectedEpoch": 6,
            "retainedAlternateEpochs": [5],
            "resumeCheckpointWallTime": 150.0,
            "resumeBranchStartedAt": 250.0,
        }
    }
    observed = {}

    monkeypatch.setattr(training_archive, "archive_root", lambda: root)
    monkeypatch.setattr(training_archive, "read_run_manifest", lambda _directory, _run_id: manifest)

    def fake_read_loss_events(run_dir, checkpoint_wall_time=None, branch_started_at=None):
        observed["runDir"] = run_dir
        observed["checkpointWallTime"] = checkpoint_wall_time
        observed["branchStartedAt"] = branch_started_at
        return ["detailed"], ["epoch"]

    monkeypatch.setattr(training_archive, "read_loss_events", fake_read_loss_events)
    monkeypatch.setattr(
        training_archive,
        "_archive_metrics_from_events",
        lambda detailed, epoch, selected, retained: {
            "detailed": detailed,
            "epoch": epoch,
            "selected": selected,
            "retained": retained,
        },
    )

    metrics = training_archive.archive_metrics("resumed")

    assert observed["runDir"] == directory
    assert observed["checkpointWallTime"] == 150.0
    assert observed["branchStartedAt"] == 250.0
    assert metrics["selected"] == 6
    assert metrics["retained"] == [5]


def test_archive_metrics_rejects_incomplete_resume_branch_metadata(tmp_path, monkeypatch):
    root = tmp_path / "archive"
    directory = root / "broken"
    directory.mkdir(parents=True)
    (directory / "webcap-run.json").write_text('{"runId":"action/run"}', encoding="utf-8")

    monkeypatch.setattr(training_archive, "archive_root", lambda: root)
    monkeypatch.setattr(
        training_archive,
        "read_run_manifest",
        lambda _directory, _run_id: {
            "archive": {
                "selectedEpoch": 6,
                "retainedAlternateEpochs": [],
                "resumeCheckpointWallTime": 150.0,
            }
        },
    )

    with pytest.raises(ValueError, match="incomplete resume-branch metadata"):
        training_archive.archive_metrics("broken")


def test_finalize_persists_resume_branch_boundary(tmp_path, monkeypatch):
    run_dir = tmp_path / "run"
    epoch_dir = run_dir / "epoch6"
    epoch_dir.mkdir(parents=True)
    (epoch_dir / "adapter.safetensors").write_bytes(b"x")
    archive_dir = tmp_path / "archive"
    captured = {}

    context = {
        "runDir": run_dir,
        "run": {
            "runName": "Resumed run",
            "stages": "h3",
            "runSummary": {},
            "resumeCheckpointWallTime": 150.0,
            "resumeBranchStartedAt": 250.0,
        },
        "actionId": "action/run",
        "epochs": {6: epoch_dir},
        "selectedEpoch": 6,
        "production": tmp_path / "selected.safetensors",
        "staged": [],
        "siblingOutputs": [tmp_path / "another-output"],
        "outputRoot": tmp_path / "output",
        "actionRoot": tmp_path / "action",
    }

    monkeypatch.setattr(training_archive, "_context", lambda _folder, _job_id: context)
    monkeypatch.setattr(training_archive, "archive_root", lambda: archive_dir)
    monkeypatch.setattr(training_archive, "_staged_alternate_candidates", lambda _context: [])
    monkeypatch.setattr(
        training_archive,
        "record_archive_metadata",
        lambda _run_dir, _action_id, metadata: captured.update(metadata),
    )
    monkeypatch.setattr(training_archive, "clear_history_job", lambda _folder, _job_id: None)
    monkeypatch.setattr(training_archive, "clear_test_sessions", lambda _folder: 0)
    monkeypatch.setattr(training_archive.app_config, "safe_join_fs_root", lambda _folder: tmp_path / "set")
    monkeypatch.setattr(training_archive, "_move_archive", lambda _source, _destination: None)
    monkeypatch.setattr(training_archive, "_epoch_directories", lambda _directory: {})
    monkeypatch.setattr(training_archive, "_global_step_directories", lambda _directory: [])

    training_archive.finalize("set", "job", "resumed-archive", [])

    assert captured["resumeCheckpointWallTime"] == 150.0
    assert captured["resumeBranchStartedAt"] == 250.0


def test_staged_archive_cleanup_groups_candidates_by_timestamp_run_not_job_id(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    for name, job_id in (("old.safetensors", "old-job"), ("resumed.safetensors", "new-job")):
        candidate = staged / name
        candidate.write_bytes(b"x")
        candidate.with_suffix(".webcap.json").write_text(json.dumps({
            "version": 1,
            "sourceJobId": job_id,
            "sourceFolder": "sets/subject",
            "sourceEpoch": 12,
            "sourceFileName": name,
            "stage": "h3",
        }), encoding="utf-8")

    monkeypatch.setattr(training_archive, "test_copy_destination", lambda stage, folder: (tmp_path, ["staged"]))
    monkeypatch.setattr(
        training_archive,
        "candidate_run_snapshot_from_provenance",
        lambda payload: (run_dir.resolve(), {"actionId": "003-h3"}),
    )

    matches = training_archive._staged_candidates("sets/subject", run_dir, "003-h3", "h3")

    assert {candidate.name for candidate, _sidecar, _payload in matches} == {
        "old.safetensors",
        "resumed.safetensors",
    }
