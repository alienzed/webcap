import json
import sys
import types
from types import SimpleNamespace

import pytest

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_candidates, training_runner


def _points(values):
    return [{"epoch": index + 1, "loss": value} for index, value in enumerate(values)]


def _candidate_epochs(values):
    result = training_candidates.analyze_epoch_loss_points(_points(values))
    return [item["epoch"] for item in result["candidates"]], result


def test_normalize_epoch_loss_events_keeps_latest_finite_event_per_epoch():
    events = [
        SimpleNamespace(step=3, value=0.8, wall_time=10),
        SimpleNamespace(step=3, value=0.7, wall_time=11),
        SimpleNamespace(step=4, value=float("nan"), wall_time=12),
        SimpleNamespace(step=5, value=0.6, wall_time=13),
    ]
    assert training_candidates.normalize_epoch_loss_events(events) == [
        {"epoch": 3, "loss": 0.7}, {"epoch": 5, "loss": 0.6},
    ]


def _fake_tensorboard(monkeypatch, tags, events=None, reload_error=None):
    module = types.ModuleType("tensorboard.backend.event_processing.event_accumulator")

    class FakeAccumulator:
        def __init__(self, *_args, **_kwargs):
            pass

        def Reload(self):
            if reload_error:
                raise reload_error
            return self

        def Tags(self):
            return {"scalars": tags}

        def Scalars(self, _tag):
            return events or []

    module.EventAccumulator = FakeAccumulator
    monkeypatch.setitem(sys.modules, "tensorboard", types.ModuleType("tensorboard"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend", types.ModuleType("tensorboard.backend"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend.event_processing", types.ModuleType("tensorboard.backend.event_processing"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend.event_processing.event_accumulator", module)


def test_tensorboard_reader_handles_missing_scalar_and_corrupt_data(tmp_path, monkeypatch):
    empty_run = tmp_path / "empty-run"
    empty_run.mkdir()
    with pytest.raises(FileNotFoundError, match="No TensorBoard event files"):
        training_candidates.read_epoch_loss_events(empty_run)

    run = tmp_path / "run"
    run.mkdir()
    (run / "events.out.tfevents.fake").write_bytes(b"fixture")
    _fake_tensorboard(monkeypatch, [], [])
    with pytest.raises(ValueError, match="train/epoch_loss is unavailable"):
        training_candidates.read_epoch_loss_events(run)

    _fake_tensorboard(monkeypatch, ["train/epoch_loss"], reload_error=RuntimeError("incomplete event"))
    with pytest.raises(ValueError, match="Could not read TensorBoard"):
        training_candidates.read_epoch_loss_events(run)


def test_tensorboard_reader_normalizes_repeated_fixture_events(tmp_path, monkeypatch):
    run = tmp_path / "run"
    run.mkdir()
    (run / "events.out.tfevents.fake").write_bytes(b"fixture")
    _fake_tensorboard(monkeypatch, ["train/epoch_loss"], [
        SimpleNamespace(step=2, value=0.8, wall_time=1),
        SimpleNamespace(step=2, value=0.7, wall_time=2),
        SimpleNamespace(step=3, value=float("inf"), wall_time=3),
    ])

    assert training_candidates.read_epoch_loss_events(run) == [{"epoch": 2, "loss": 0.7}]


def test_short_curve_and_unresolved_tail_do_not_become_candidates():
    short, _ = _candidate_epochs([1.0, 0.9])
    descending, _ = _candidate_epochs([1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4])
    late, analysis = _candidate_epochs([1.0, 0.9, 0.8, 0.65, 0.5, 0.49, 0.5, 0.48, 0.47])

    assert short == []
    assert descending == []
    assert late == []
    assert any(not basin["confirmed"] for basin in analysis["basins"])


def test_broad_stable_valley_becomes_one_candidate_after_exit():
    epochs, analysis = _candidate_epochs([1.0, 0.95, 0.9, 0.7, 0.5, 0.49, 0.5, 0.7, 0.9, 1.0])

    assert epochs == [5]
    assert analysis["basins"] == [{"startEpoch": 5, "endEpoch": 7, "representativeEpoch": 5, "confirmed": True}]


def test_isolated_downward_spike_is_not_a_valley():
    epochs, analysis = _candidate_epochs([1.0, 0.95, 0.9, 0.2, 0.9, 0.95, 1.0])

    assert epochs == []
    assert analysis["basins"] == []


def test_neighboring_minima_share_one_basin_but_distinct_valleys_remain_distinct():
    one_basin, _ = _candidate_epochs([1.0, 0.9, 0.7, 0.5, 0.49, 0.5, 0.51, 0.7, 0.9, 1.0])
    two_basins, _ = _candidate_epochs([
        1.0, 0.9, 0.7, 0.5, 0.49, 0.5, 0.7, 0.9, 1.0,
        0.9, 0.7, 0.45, 0.44, 0.45, 0.7, 0.9,
    ])

    assert len(one_basin) == 1
    assert two_basins == [4, 12]


def test_broad_plateau_and_noisy_stable_low_region_each_remain_one_candidate():
    plateau, _ = _candidate_epochs([1.0, 0.9, 0.7, 0.5, 0.5, 0.5, 0.5, 0.7, 0.9])
    noisy, _ = _candidate_epochs([1.0, 0.95, 0.9, 0.7, 0.51, 0.49, 0.5, 0.48, 0.52, 0.7, 0.9])

    assert len(plateau) == 1
    assert len(noisy) == 1


def test_late_valley_becomes_a_candidate_only_after_a_sustained_exit():
    unresolved, _ = _candidate_epochs([1.0, 0.95, 0.9, 0.8, 0.7, 0.5, 0.49, 0.5, 0.48, 0.47])
    resolved, _ = _candidate_epochs([1.0, 0.95, 0.9, 0.8, 0.7, 0.5, 0.49, 0.5, 0.7, 0.9, 1.0])

    assert unresolved == []
    assert len(resolved) == 1


def test_artifact_lookup_is_separate_from_curve_candidate(tmp_path):
    run = tmp_path / "run"
    epoch = run / "epoch5"
    epoch.mkdir(parents=True)
    (epoch / "adapter.safetensors").write_bytes(b"weights")
    analysis = training_candidates.analyze_epoch_loss_points(
        _points([1.0, 0.95, 0.9, 0.7, 0.5, 0.49, 0.5, 0.7, 0.9, 1.0]), run,
    )

    assert analysis["candidates"][0]["epoch"] == 5
    assert analysis["candidates"][0]["artifact"] == {"available": True, "status": "available", "fileName": "adapter.safetensors"}
    (epoch / "second.safetensors").write_bytes(b"weights")
    assert training_candidates.artifact_for_epoch(run, 5) == {"available": False, "status": "ambiguous"}


def test_candidate_endpoint_resolves_only_the_recorded_job_and_is_read_only(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "sets" / "subject"
    run = root / "runs" / "one"
    folder.mkdir(parents=True)
    run.mkdir(parents=True)
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({
        "version": 3,
        "activeJobId": "job-1",
        "jobs": [{"id": "job-1", "folder": "sets/subject", "outputRunPath": str(run), "status": "running", "progress": {"epoch": 12, "epochs": 70}}],
    }), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_analyze_run_directory", lambda path: {
        "analysisVersion": 1, "scalarTag": "train/epoch_loss", "points": [{"epoch": 1, "loss": 1.0}],
        "smoothedPoints": [{"epoch": 1, "loss": 1.0}], "basins": [], "candidates": [],
    })
    before = state_path.read_bytes()

    client = app_module.app.test_client()
    response = client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1")

    assert response.status_code == 200
    assert response.get_json()["run"]["status"] == "running"
    assert state_path.read_bytes() == before
    escaped = client.get("/fs/training_candidates?folder=..%2Felsewhere&jobId=job-1")
    assert escaped.status_code == 404
