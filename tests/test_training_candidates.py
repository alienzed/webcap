import json
import sys
import types
from types import SimpleNamespace

import pytest

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_candidates, training_runner


def _events(values, epoch=1, start=0):
    return [
        {"axis": start + index, "loss": value, "wallTime": float(start + index), "order": index}
        for index, value in enumerate(values)
    ]


def _mapped_points(values):
    return [{"sample": index, "epoch": 1, "loss": value} for index, value in enumerate(values)]


def test_normalization_keeps_latest_finite_event_and_mapping_uses_epoch_completion_boundaries():
    events = [
        SimpleNamespace(step=3, value=0.8, wall_time=10),
        SimpleNamespace(step=3, value=0.7, wall_time=11),
        SimpleNamespace(step=4, value=float("nan"), wall_time=12),
    ]
    assert training_candidates.normalize_epoch_loss_events(events) == [{"epoch": 3, "loss": 0.7}]
    detailed = [
        {"axis": 10, "loss": 1.0, "wallTime": 1.0, "order": 0},
        {"axis": 11, "loss": 0.9, "wallTime": 2.0, "order": 1},
        {"axis": 12, "loss": 0.8, "wallTime": 3.1, "order": 2},
    ]
    epochs = [
        {"axis": 1, "loss": 0.9, "wallTime": 2.0, "order": 0},
        {"axis": 2, "loss": 0.8, "wallTime": 3.0, "order": 1},
    ]
    assert [point["epoch"] for point in training_candidates.map_detailed_loss_to_epochs(detailed, epochs)] == [1, 1, 3]


def _fake_tensorboard(monkeypatch, streams, reload_error=None):
    module = types.ModuleType("tensorboard.backend.event_processing.event_accumulator")

    class FakeAccumulator:
        def __init__(self, *_args, **_kwargs):
            pass

        def Reload(self):
            if reload_error:
                raise reload_error
            return self

        def Tags(self):
            return {"scalars": list(streams)}

        def Scalars(self, tag):
            return streams[tag]

    module.EventAccumulator = FakeAccumulator
    monkeypatch.setitem(sys.modules, "tensorboard", types.ModuleType("tensorboard"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend", types.ModuleType("tensorboard.backend"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend.event_processing", types.ModuleType("tensorboard.backend.event_processing"))
    monkeypatch.setitem(sys.modules, "tensorboard.backend.event_processing.event_accumulator", module)


def test_tensorboard_reader_requires_both_streams_and_handles_invalid_data(tmp_path, monkeypatch):
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(FileNotFoundError, match="No TensorBoard event files"):
        training_candidates.read_loss_events(empty)
    run = tmp_path / "run"
    run.mkdir()
    (run / "events.out.tfevents.fake").write_bytes(b"fixture")
    _fake_tensorboard(monkeypatch, {"train/epoch_loss": []})
    with pytest.raises(ValueError, match="train/loss is unavailable"):
        training_candidates.read_loss_events(run)
    _fake_tensorboard(monkeypatch, {"train/loss": [], "train/epoch_loss": []})
    with pytest.raises(ValueError, match="train/loss has no finite"):
        training_candidates.read_loss_events(run)


def test_detailed_smoother_rejects_isolated_upward_and_downward_raw_spikes():
    stable = [1.0] * 12 + [2.4] + [1.0] * 12
    downward = [1.0] * 12 + [0.1] + [1.0] * 12
    assert training_candidates.smooth_detailed_loss_points(_mapped_points(stable))[12]["loss"] == pytest.approx(1.0)
    assert training_candidates.smooth_detailed_loss_points(_mapped_points(downward))[12]["loss"] == pytest.approx(1.0)


def test_basin_exit_supports_upward_and_later_lower_regimes_without_selecting_the_tail():
    upward = _mapped_points([1.0, .9, .7, .5, .5, .5, .5, .7, .9])
    lower = _mapped_points([1.0, .9, .7, .5, .5, .5, .5, .3, .3, .3, .3])
    assert training_candidates._resolved_exit([point["loss"] for point in upward], 6, .5, .05) == "upward"
    assert training_candidates._resolved_exit([point["loss"] for point in lower], 6, .5, .05) == "lower"
    lower_basins = training_candidates.detect_loss_basins(lower, lower)
    assert not lower_basins or lower_basins[-1]["confirmed"] is False


def test_basin_interval_merging_and_dominance_prevent_candidate_explosion():
    values = [1.0, .9, .7, .5, .5, .5, .5, .7, .9]
    assert training_candidates._merge_basin_intervals([(3, 5), (4, 6)], values, .02) == [(3, 6)]
    detailed = _events([1.0] * 10 + [.8] * 10 + [.6] * 10 + [.5] * 10 + [.5] * 10 + [.8] * 10)
    epochs = [{"axis": index + 1, "loss": loss, "wallTime": index * 10 + 9, "order": index} for index, loss in enumerate([1.0, .8, .6, .5, .5, .8])]
    analysis = training_candidates.analyze_loss_points(detailed, epochs)
    assert len(analysis["candidates"]) == 1
    assert analysis["candidates"][0]["epoch"] in {4, 5}


def test_unresolved_final_descent_or_plateau_is_not_a_candidate():
    descent = _mapped_points([1.0, .9, .8, .7, .6, .5, .4])
    plateau = _mapped_points([1.0, .9, .7, .5, .5, .5, .5])
    assert not [basin for basin in training_candidates.detect_loss_basins(descent, descent) if basin["confirmed"]]
    assert not [basin for basin in training_candidates.detect_loss_basins(plateau, plateau) if basin["confirmed"]]


def test_artifact_status_is_separate_and_read_only(tmp_path):
    run = tmp_path / "run"
    epoch = run / "epoch5"
    epoch.mkdir(parents=True)
    (epoch / "adapter.safetensors").write_bytes(b"weights")
    assert training_candidates.artifact_for_epoch(run, 5) == {"available": True, "status": "available", "fileName": "adapter.safetensors"}
    (epoch / "second.safetensors").write_bytes(b"weights")
    assert training_candidates.artifact_for_epoch(run, 5) == {"available": False, "status": "ambiguous"}


def test_candidate_endpoint_resolves_only_recorded_job_and_is_read_only(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "sets" / "subject"
    run = root / "runs" / "one"
    folder.mkdir(parents=True)
    run.mkdir(parents=True)
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({"version": 3, "activeJobId": "job-1", "jobs": [{"id": "job-1", "folder": "sets/subject", "outputRunPath": str(run), "status": "running", "progress": {"epoch": 12, "epochs": 70}}]}), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_analyze_run_directory", lambda path: {"analysisVersion": 2, "epochLossPoints": [{"epoch": 1, "loss": 1.0}], "epochSmoothedPoints": [], "detailedLossPoints": [], "detailedSmoothedPoints": [], "basins": [], "candidates": []})
    before = state_path.read_bytes()
    response = app_module.app.test_client().get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1")
    assert response.status_code == 200
    assert response.get_json()["run"]["status"] == "running"
    assert state_path.read_bytes() == before
    assert app_module.app.test_client().get("/fs/training_candidates?folder=..%2Felsewhere&jobId=job-1").status_code == 404
