import json
import sys
import types
from types import SimpleNamespace
from pathlib import Path

import pytest

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_candidates, training_runner


def _epoch_events(values, start_epoch=1, samples_per_epoch=5, start_step=900, step_stride=1):
    detailed, boundaries, order = [], [], 0
    for offset, value in enumerate(values):
        epoch = start_epoch + offset
        boundary_time = float(epoch * 100)
        for sample in range(samples_per_epoch):
            detailed.append({"axis": start_step + (offset * samples_per_epoch + sample) * step_stride, "loss": value + (-.001 if sample == 0 else .001 if sample == samples_per_epoch - 1 else 0), "wallTime": boundary_time - samples_per_epoch + sample, "order": order})
            order += 1
        boundaries.append({"axis": epoch, "loss": value, "wallTime": boundary_time, "order": offset})
    return detailed, boundaries


def _detailed_epoch_events(samples_by_epoch, start_epoch=1, start_step=900, step_stride=1):
    detailed, boundaries, order = [], [], 0
    for offset, samples in enumerate(samples_by_epoch):
        epoch = start_epoch + offset
        boundary_time = float(epoch * 100)
        for sample, value in enumerate(samples):
            detailed.append({"axis": start_step + (sum(len(previous) for previous in samples_by_epoch[:offset]) + sample) * step_stride, "loss": value, "wallTime": boundary_time - len(samples) + sample, "order": order})
            order += 1
        boundaries.append({"axis": epoch, "loss": training_candidates._median(samples), "wallTime": boundary_time, "order": offset})
    return detailed, boundaries


def _robust(values, start_epoch=1, start_step=900, step_stride=100):
    return [{"epoch": start_epoch + index, "startStep": start_step + index * step_stride, "endStep": start_step + (index + 1) * step_stride - 1, "step": start_step + (index + 1) * step_stride - 1, "loss": value} for index, value in enumerate(values)]


def _fake_tensorboard(monkeypatch, streams):
    module = types.ModuleType("tensorboard.backend.event_processing.event_accumulator")

    class FakeAccumulator:
        def __init__(self, *_args, **_kwargs):
            pass
        def Reload(self):
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


def test_scalar_normalization_and_mapping_are_deterministic_across_pause_gaps():
    events = [
        SimpleNamespace(step=3, value=.8, wall_time=10),
        SimpleNamespace(step=3, value=.7, wall_time=11),
        SimpleNamespace(step=4, value=float("nan"), wall_time=12),
    ]
    assert training_candidates.normalize_scalar_events(events) == [{"axis": 3, "loss": .7, "wallTime": 11.0, "order": 1}]
    detailed = [{"axis": 1, "loss": .2, "wallTime": 99, "order": 0}, {"axis": 2, "loss": .2, "wallTime": 17000, "order": 1}]
    boundaries = [{"axis": 41, "loss": .2, "wallTime": 100, "order": 0}, {"axis": 42, "loss": .2, "wallTime": 18000, "order": 1}]
    assert [point["epoch"] for point in training_candidates.map_detailed_loss_to_epochs(detailed, boundaries)] == [41, 42]


def test_tensorboard_reader_requires_both_streams(tmp_path, monkeypatch):
    run = tmp_path / "run"
    run.mkdir()
    (run / "events.out.tfevents.fake").write_bytes(b"fixture")
    _fake_tensorboard(monkeypatch, {"train/epoch_loss": []})
    with pytest.raises(ValueError, match="train/loss is unavailable"):
        training_candidates.read_loss_events(run)


def test_epoch_median_aggregation_rejects_isolated_step_spikes():
    mapped = [{"sample": index, "step": 900 + index, "epoch": 7, "loss": value} for index, value in enumerate([.2, .2, .2, 8.0, -.5])]
    complete = [{"axis": 7, "loss": .2, "wallTime": 10, "order": 0}]
    assert training_candidates.aggregate_detailed_loss_by_epoch(mapped, complete) == [{"epoch": 7, "step": 904, "startStep": 900, "endStep": 904, "loss": .2}]


def test_display_ema_preserves_detailed_metadata_and_damps_short_noise():
    points = [
        {"step": 10, "epoch": 1, "loss": 0.0},
        {"step": 11, "epoch": 1, "loss": 1.0},
        {"step": 12, "epoch": 1, "loss": 0.0},
    ]
    smoothed = training_candidates.smooth_step_loss_ema(points)
    assert len(smoothed) == len(points)
    assert [(point["step"], point["epoch"]) for point in smoothed] == [(10, 1), (11, 1), (12, 1)]
    assert smoothed[0]["loss"] == points[0]["loss"]
    assert 0 < smoothed[1]["loss"] < points[1]["loss"]

    sustained = training_candidates.smooth_step_loss_ema([
        {"step": index, "epoch": 2, "loss": 0.0 if index < 100 else 1.0}
        for index in range(600)
    ])
    assert sustained[-1]["loss"] > .99


def test_settled_detector_handles_valley_shelf_and_current_tail_without_monotonic_descent():
    valley_trend, valley = training_candidates.detect_settled_regions(_robust([1.0, .8, .6, .5, .5, .5, .7, .9]))
    shelf_trend, shelf = training_candidates.detect_settled_regions(_robust([1.0, .8, .7, .69, .70, .69, .70]))
    _, descent = training_candidates.detect_settled_regions(_robust([1.0, .9, .8, .7, .6, .5, .4]))
    assert valley_trend and len(valley) == 1 and valley[0]["current"] is False
    assert shelf_trend and len(shelf) == 1 and shelf[0]["current"] is True
    assert descent == []


def test_one_region_groups_small_minima_but_separate_plateaus_remain_separate():
    _, regions = training_candidates.detect_settled_regions(_robust([1.0, .8, .62, .60, .61, .60, .62, .61, .62, .8, .55, .54, .55, .54, .55]))
    assert len(regions) == 2
    assert regions[0]["endEpoch"] < regions[1]["startEpoch"]


def test_representative_uses_displayed_trend_then_raw_loss_then_earlier_epoch():
    robust = _robust([.20, .16, .14, .13, .125, .128, .12, .15])
    trend = training_candidates._centered_median(robust)
    # The raw low is epoch 7, but its neighbors lift the displayed trend above
    # epoch 6, whose centered-median value is the lowest plotted point.
    assert min(robust, key=lambda point: point["loss"])["epoch"] == 7
    selected = training_candidates._representative_index(robust, trend, 0, len(robust) - 1)
    assert robust[selected]["epoch"] == 6

    tied_trend = _robust([.4, .1, .1, .4])
    raw_tie_break = _robust([.4, .15, .12, .4])
    exact_tie = _robust([.4, .12, .12, .4])
    assert raw_tie_break[training_candidates._representative_index(raw_tie_break, tied_trend, 0, 3)]["epoch"] == 3
    assert exact_tie[training_candidates._representative_index(exact_tie, tied_trend, 0, 3)]["epoch"] == 2


def _quiet_detailed_samples(base):
    return [base - .0003, base - .0001, base, base + .0001, base + .0003, base - .0002, base, base + .0002, base]


def test_detailed_stream_is_observational_and_preserves_step_mapping():
    quiet = [_quiet_detailed_samples(.2) for _ in range(7)]
    noisy = [samples[:] for samples in quiet]
    noisy[2][1:4] = [.18, .22, .2]
    detailed, boundaries = _detailed_epoch_events(quiet)
    noisy_detailed, noisy_boundaries = _detailed_epoch_events(noisy)
    analysis = training_candidates.analyze_loss_points(detailed, boundaries)
    noisy_analysis = training_candidates.analyze_loss_points(noisy_detailed, noisy_boundaries)
    assert analysis["regions"] == noisy_analysis["regions"]
    assert analysis["candidates"] == noisy_analysis["candidates"]
    assert analysis["stepLossPoints"] != noisy_analysis["stepLossPoints"]
    assert len(analysis["smoothedStepLossPoints"]) == len(analysis["stepLossPoints"])
    assert [point["step"] for point in analysis["smoothedStepLossPoints"]] == [point["step"] for point in analysis["stepLossPoints"]]
    assert all({"step", "epoch", "loss"} <= point.keys() for point in analysis["stepLossPoints"])
    assert all(point["step"] == next(item["endStep"] for item in training_candidates.aggregate_detailed_loss_by_epoch(training_candidates.map_detailed_loss_to_epochs(detailed, boundaries), boundaries) if item["epoch"] == point["epoch"]) for point in analysis["epochLossPoints"])


def test_startup_epochs_are_displayed_but_cannot_change_candidate_math():
    base, boundaries = _epoch_events([5.0, 1.0, .8, .7, .7, .7, .75], start_step=0, step_stride=100)
    changed, changed_boundaries = _epoch_events([.01, 1.0, .8, .7, .7, .7, .75], start_step=0, step_stride=100)
    analysis = training_candidates.analyze_loss_points(base, boundaries)
    changed_analysis = training_candidates.analyze_loss_points(changed, changed_boundaries)
    assert analysis["stepLossPoints"][0]["step"] == 0
    assert analysis["smoothedStepLossPoints"][0]["step"] == 0
    assert analysis["epochLossPoints"][0]["epoch"] == 1
    assert analysis["regions"] == changed_analysis["regions"]
    assert analysis["candidates"] == changed_analysis["candidates"]
    assert all(region["startStep"] >= training_candidates.MIN_CANDIDATE_STEP for region in analysis["regions"])


def test_strong_descent_after_startup_has_no_candidates_but_gentle_shelf_can_settle():
    descending, descending_boundaries = _epoch_events([1.0, .9, .8, .7, .6, .5, .4], samples_per_epoch=7)
    shelf, shelf_boundaries = _epoch_events([1.0, .8, .7, .69, .70, .69, .70])
    assert training_candidates.analyze_loss_points(descending, descending_boundaries)["candidates"] == []
    assert len(training_candidates.analyze_loss_points(shelf, shelf_boundaries)["candidates"]) == 1


def test_display_ema_payload_does_not_change_candidate_decisions(monkeypatch):
    detailed, boundaries = _epoch_events([1.0, .8, .7, .69, .70, .69, .70])
    with_overlay = training_candidates.analyze_loss_points(detailed, boundaries)
    monkeypatch.setattr(training_candidates, "smooth_step_loss_ema", lambda _points: [])
    without_overlay = training_candidates.analyze_loss_points(detailed, boundaries)
    assert with_overlay["regions"] == without_overlay["regions"]
    assert with_overlay["candidates"] == without_overlay["candidates"]


def test_region_explanations_describe_existing_evidence_without_affecting_selection():
    local_minimum = _robust([.5, .3, .4])
    plateau = _robust([1.0, .95, .95, .95, 1.0])
    fallback = _robust([1.0, .9, .8])
    assert training_candidates._region_explanation(local_minimum, [1], .1, 0, 2, 1, False, False) == ("local_minimum", "Local minimum")
    assert training_candidates._region_explanation(plateau, [1, 2, 3], .1, 0, 4, 0, False, False) == ("settled_plateau", "Settled plateau")
    assert training_candidates._region_explanation(fallback, [], .1, 0, 2, 0, False, False) == ("stable_region", "Stable region")
    assert training_candidates._region_explanation(local_minimum, [1], .1, 0, 2, 1, False, True) == ("post_disturbance_recovery", "Post-disturbance recovery")
    assert training_candidates._region_explanation(local_minimum, [1], .1, 0, 2, 1, True, True) == ("post_disturbance_recovery", "Current stable region · Post-disturbance recovery")


def test_region_saved_epoch_coverage_is_descriptive_and_omits_ambiguous_exports(tmp_path, monkeypatch):
    region = {"startEpoch": 2, "endEpoch": 5, "startStep": 900, "endStep": 904, "representativeEpoch": 2, "current": False, "kind": "stable_region", "label": "Stable region"}
    monkeypatch.setattr(training_candidates, "detect_settled_regions", lambda _points: ([], [region.copy()]))
    monkeypatch.setattr(training_candidates, "saved_artifacts_for_run", lambda _run: [
        {"epoch": 3, "fileName": "adapter-3.safetensors", "status": "available"},
        {"epoch": 4, "status": "ambiguous"},
        {"epoch": 6, "fileName": "adapter-6.safetensors", "status": "available"},
    ])
    analysis = training_candidates.analyze_loss_points([{"axis": 904, "loss": .2, "wallTime": 1, "order": 0}], [{"axis": 2, "loss": .2, "wallTime": 2, "order": 0}], run_dir=tmp_path)
    assert analysis["regions"][0]["savedEpochs"] == [3]
    assert analysis["candidates"][0]["savedEpochs"] == [3]
    assert analysis["candidates"][0]["epoch"] == 2
    assert analysis["candidates"][0]["artifact"]["status"] == "not_saved"


def test_real_50_epoch_regression_produces_small_distinct_settled_regions():
    values = [
        .244616, .192672, .201754, .200584, .186273, .194946, .181427, .175269, .184652, .189563,
        .170429, .178791, .174557, .188900, .172462, .172363, .176209, .186988, .163758, .187866,
        .170530, .180993, .177459, .163516, .168297, .171025, .176144, .162607, .173430, .175931,
        .199464, .166525, .170053, .152046, .159221, .160112, .160943, .164999, .153819, .146868,
        .169877, .182762, .173788, .151289, .155444, .160209, .158670, .158595, .151187, .155247,
    ]
    detailed, boundaries = _epoch_events(values, samples_per_epoch=7)
    analysis = training_candidates.analyze_loss_points(detailed, boundaries)
    regions = analysis["regions"]
    assert 2 <= len(regions) <= 5
    assert any(region["startEpoch"] <= 40 <= region["endEpoch"] for region in regions)
    assert any(region["current"] and region["startEpoch"] <= 50 for region in regions)
    assert not any(region["startEpoch"] <= 41 <= region["endEpoch"] and region["startEpoch"] <= 44 <= region["endEpoch"] for region in regions)
    assert 2 <= len(regions) <= 5
    assert all(candidate["epoch"] == next(region["representativeEpoch"] for region in regions if region["startEpoch"] == candidate["startEpoch"] and region["endEpoch"] == candidate["endEpoch"]) for candidate in analysis["candidates"])


def test_artifact_status_is_separate_and_read_only(tmp_path):
    run = tmp_path / "run"
    epoch = run / "epoch5"
    epoch.mkdir(parents=True)
    (epoch / "adapter.safetensors").write_bytes(b"weights")
    assert training_candidates.artifact_for_epoch(run, 5) == {"available": True, "status": "available", "fileName": "adapter.safetensors"}
    (epoch / "second.safetensors").write_bytes(b"weights")
    assert training_candidates.artifact_for_epoch(run, 5) == {"available": False, "status": "ambiguous"}


def test_saved_artifact_enumeration_describes_only_real_epoch_directories(tmp_path, monkeypatch):
    run = tmp_path / "run"
    available = run / "epoch11"
    ambiguous = run / "epoch18"
    empty = run / "epoch22"
    available.mkdir(parents=True)
    ambiguous.mkdir()
    empty.mkdir()
    (available / "adapter.safetensors").write_bytes(b"weights")
    (ambiguous / "one.safetensors").write_bytes(b"weights")
    (ambiguous / "two.safetensors").write_bytes(b"weights")
    (run / "epoch-not-a-number").mkdir()
    symlinked = run / "epoch29"
    symlinked.mkdir()
    (symlinked / "ignored.safetensors").write_bytes(b"weights")
    original_is_symlink = Path.is_symlink
    monkeypatch.setattr(Path, "is_symlink", lambda path: path.name == "epoch29" or original_is_symlink(path))
    assert training_candidates.saved_artifacts_for_run(run) == [
        {"epoch": 11, "fileName": "adapter.safetensors", "status": "available"},
        {"epoch": 18, "status": "ambiguous"},
    ]


def test_candidate_endpoint_resolves_recorded_job_and_remains_read_only(tmp_path, monkeypatch):
    root, folder, run = tmp_path / "root", tmp_path / "root" / "sets" / "subject", tmp_path / "root" / "runs" / "one"
    folder.mkdir(parents=True)
    run.mkdir(parents=True)
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({"version": 3, "activeJobId": "job-1", "jobs": [{"id": "job-1", "folder": "sets/subject", "outputRunPath": str(run), "status": "running", "progress": {"epoch": 12, "epochs": 70}}]}), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    epoch_directory = run / "epoch12"
    epoch_directory.mkdir()
    monkeypatch.setattr(training_runner, "_analyze_run_directory", lambda path: {"analysisVersion": 5, "stepLossPoints": [], "smoothedStepLossPoints": [], "epochLossPoints": [], "analysisPoints": [], "regions": [], "candidates": [], "savedArtifacts": []})
    before = state_path.read_bytes()
    client = app_module.app.test_client()
    response = client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1")
    assert response.status_code == 200 and response.get_json()["analysis"]["analysisVersion"] == 5
    assert state_path.read_bytes() == before
    opened = []
    monkeypatch.setattr(app_module, "open_path_in_explorer_response", lambda path: opened.append(path) or app_module.jsonify({"ok": True}))
    assert client.post("/fs/training_candidates/open_run", json={"folder": "sets/subject", "jobId": "job-1"}).status_code == 200
    assert client.post("/fs/training_candidates/open_epoch", json={"folder": "sets/subject", "jobId": "job-1", "epoch": "12"}).status_code == 200
    assert opened == [run, epoch_directory]
    assert client.post("/fs/training_candidates/open_epoch", json={"folder": "sets/subject", "jobId": "job-1", "epoch": "../12"}).status_code == 400
    assert client.post("/fs/training_candidates/open_epoch", json={"folder": "sets/subject", "jobId": "job-1", "epoch": "0"}).status_code == 400
    assert client.post("/fs/training_candidates/open_epoch", json={"folder": "sets/subject", "jobId": "job-1", "epoch": "99"}).status_code == 422
    assert state_path.read_bytes() == before
