import json
import math
import sys
import time
import types
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from pathlib import Path

import pytest

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_candidates, training_runner
from tool.server import training_candidate_v3_score_regions as v3, training_candidate_v5_stable_step_zones as v5


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


def test_display_smoothing_preserves_detailed_metadata_and_damps_short_noise():
    points = [
        {"step": 10, "epoch": 1, "loss": 0.0},
        {"step": 11, "epoch": 1, "loss": 1.0},
        {"step": 12, "epoch": 1, "loss": 0.0},
    ]
    smoothed = training_candidates.smooth_step_loss(points)
    assert len(smoothed) == len(points)
    assert [(point["step"], point["epoch"]) for point in smoothed] == [(10, 1), (11, 1), (12, 1)]
    assert smoothed[1]["loss"] == 0
    assert smoothed[1]["loss"] < points[1]["loss"]

    sustained = training_candidates.smooth_step_loss([
        {"step": index, "epoch": 2, "loss": 0.0 if index < 100 else 1.0}
        for index in range(600)
    ])
    assert sustained[-1]["loss"] > .99


def test_algorithm_dispatch_is_explicit_and_unknown_algorithms_fail_loudly(monkeypatch):
    detailed, boundaries = _epoch_events([1.0, .8, .7, .69, .70, .69, .70])
    seen = []
    for algorithm in ("v5", "v3"):
        monkeypatch.setitem(training_candidates.ALGORITHMS, algorithm, lambda _detailed, _checkpoints, name=algorithm: seen.append(name) or {"analysisPoints": [], "regions": []})
    for algorithm in ("v5", "v3"):
        training_candidates.analyze_loss_points(detailed, boundaries, algorithm=algorithm)
    assert seen == ["v5", "v3"]
    with pytest.raises(ValueError, match="Unknown candidate analysis algorithm"):
        training_candidates.analyze_loss_points(detailed, boundaries, algorithm="not-an-algorithm")


def test_v3_receives_epoch_loss_on_the_epoch_axis(monkeypatch):
    detailed, boundaries = _epoch_events([9.0, 8.0, 7.0, 6.0], samples_per_epoch=3)
    captured = {}

    def detector(points, _checkpoints):
        captured["points"] = points
        return {"analysisPoints": [], "regions": []}

    monkeypatch.setitem(training_candidates.ALGORITHMS, "v3", detector)
    training_candidates.analyze_loss_points(detailed, boundaries, algorithm="v3")
    assert [(point["step"], point["epoch"], point["loss"]) for point in captured["points"]] == [
        (1, 1, 9.0), (2, 2, 8.0), (3, 3, 7.0), (4, 4, 6.0),
    ]
    assert [point["optimizerStep"] for point in captured["points"]] == [902, 905, 908, 911]


@pytest.mark.parametrize("algorithm", ["v5"])
def test_non_v3_detectors_still_receive_detailed_step_loss_points(monkeypatch, algorithm):
    detailed, boundaries = _epoch_events([1.0, .8, .7, .69], samples_per_epoch=3)
    captured = {}

    def detector(points, checkpoints):
        captured["points"] = points
        captured["checkpoints"] = checkpoints
        return {"analysisPoints": [], "regions": []}

    monkeypatch.setitem(training_candidates.ALGORITHMS, algorithm, detector)
    result = training_candidates.analyze_loss_points(detailed, boundaries, algorithm=algorithm)
    assert captured["points"] == result["stepLossPoints"]
    mapped = training_candidates.map_detailed_loss_to_epochs(detailed, boundaries)
    assert captured["checkpoints"] == training_candidates.aggregate_detailed_loss_by_epoch(mapped, boundaries)


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


def test_region_saved_epoch_coverage_is_descriptive_and_omits_ambiguous_exports(tmp_path, monkeypatch):
    region = {"startEpoch": 2, "endEpoch": 5, "startStep": 900, "endStep": 904, "representativeEpoch": 2, "current": False, "kind": "stable_region", "label": "Stable region"}
    monkeypatch.setitem(training_candidates.ALGORITHMS, "v3", lambda _points, _checkpoints: {"analysisPoints": [], "regions": [region.copy()]})
    monkeypatch.setattr(training_candidates, "saved_artifacts_for_run", lambda _run: [
        {"epoch": 3, "fileName": "adapter-3.safetensors", "status": "available"},
        {"epoch": 4, "status": "ambiguous"},
        {"epoch": 6, "fileName": "adapter-6.safetensors", "status": "available"},
    ])
    analysis = training_candidates.analyze_loss_points([{"axis": 904, "loss": .2, "wallTime": 1, "order": 0}], [{"axis": 2, "loss": .2, "wallTime": 2, "order": 0}], run_dir=tmp_path, algorithm="v3")
    assert analysis["regions"][0]["savedEpochs"] == [3]
    assert analysis["candidates"][0]["savedEpochs"] == [3]
    assert analysis["candidates"][0]["epoch"] == 2
    assert analysis["candidates"][0]["artifact"]["status"] == "not_saved"


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
    state_path.write_text(json.dumps({"version": 3, "activeJobId": "job-1", "jobs": [
        {"id": "job-1", "folder": "sets/subject", "outputRunPath": str(run), "status": "running", "progress": {"epoch": 12, "epochs": 70}},
        {"id": "job-2", "folder": "sets/subject", "resumeFromCheckpoint": str(run), "outputRunPath": "", "status": "queued"},
    ]}), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    epoch_directory = run / "epoch12"
    epoch_directory.mkdir()
    monkeypatch.setattr(training_runner, "_analyze_run_directory", lambda path, algorithm: {"analysisVersion": 11, "algorithm": algorithm, "stepLossPoints": [], "smoothedStepLossPoints": [], "epochLossPoints": [], "analysisPoints": [], "regions": [], "candidates": [], "savedArtifacts": []})
    before = state_path.read_bytes()
    client = app_module.app.test_client()
    response = client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1")
    assert response.status_code == 200 and response.get_json()["analysis"]["analysisVersion"] == 11
    assert response.get_json()["analysis"]["algorithm"] == "v5"
    resumed = client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-2")
    assert resumed.status_code == 200 and resumed.get_json()["analysis"]["algorithm"] == "v5"
    for algorithm in ("v3",):
        switched = client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1&algorithm=" + algorithm)
        assert switched.status_code == 200
        assert switched.get_json()["analysis"]["algorithm"] == algorithm
    assert client.get("/fs/training_candidates?folder=sets%2Fsubject&jobId=job-1&algorithm=nope").status_code == 422
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


def _copy_to_test_fixture(tmp_path, monkeypatch, stage="h3", subfolder="az"):
    root = tmp_path / "root"
    folder = root / "sets" / "subject"
    run = root / "runs" / "one"
    epoch = run / "epoch12"
    destination_root = tmp_path / "test-root"
    folder.mkdir(parents=True)
    epoch.mkdir(parents=True)
    destination_root.mkdir()
    source = epoch / "adapter_model_epoch12.safetensors"
    source.write_bytes(b"test weights")
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({"version": 3, "jobs": [{
        "id": "job-1", "folder": "sets/subject", "outputRunPath": str(run),
        "stages": stage, "stage": "caching", "status": "running",
    }]}), encoding="utf-8")
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    roots = {key: "" for key in ("h3", "krea2", "wan21", "hi", "lo")}
    roots[stage] = str(destination_root)
    monkeypatch.setattr(training_runner.app_config, "load_config_from_disk", lambda: {
        "training": {"test_copy_roots": roots, "test_copy_subfolder": subfolder}
    })
    return source, destination_root


@pytest.mark.parametrize("stage", ["h3", "krea2", "wan21", "hi", "lo"])
def test_copy_candidate_to_configured_stage_root_uses_recorded_stages(tmp_path, monkeypatch, stage):
    source, destination_root = _copy_to_test_fixture(tmp_path, monkeypatch, stage=stage)
    result = training_runner.copy_candidate_epoch_to_test("sets/subject", "job-1", 12)
    destination = destination_root / "az" / "subject" / source.name
    assert Path(result["destination"]) == destination
    assert destination.read_bytes() == b"test weights"
    assert source.read_bytes() == b"test weights"


def test_copy_candidate_reuses_set_directory_and_refuses_filename_collision(tmp_path, monkeypatch):
    source, destination_root = _copy_to_test_fixture(tmp_path, monkeypatch)
    destination = destination_root / "az" / "subject" / source.name
    destination.parent.mkdir(parents=True)
    second_epoch = source.parent.parent / "epoch13"
    second_epoch.mkdir()
    second_source = second_epoch / "adapter_model_epoch13.safetensors"
    second_source.write_bytes(b"second weights")
    training_runner.copy_candidate_epoch_to_test("sets/subject", "job-1", 13)
    assert (destination.parent / second_source.name).read_bytes() == b"second weights"
    destination.write_bytes(b"existing destination")
    response = app_module.app.test_client().post(
        "/fs/training_candidates/copy_to_test",
        json={"folder": "sets/subject", "jobId": "job-1", "epoch": 12},
    )
    assert response.status_code == 409
    assert destination.read_bytes() == b"existing destination"


def test_open_test_folder_requires_existing_destination_and_never_creates_it(tmp_path, monkeypatch):
    source, destination_root = _copy_to_test_fixture(tmp_path, monkeypatch)
    expected = destination_root / "az" / "subject"
    client = app_module.app.test_client()
    opened = []
    monkeypatch.setattr(app_module, "open_path_in_explorer_response", lambda path: opened.append(path) or app_module.jsonify({"ok": True}))

    missing = client.post("/fs/training_candidates/open_test", json={"folder": "sets/subject", "jobId": "job-1"})
    assert missing.status_code == 422
    assert not expected.exists()
    assert opened == []

    training_runner.copy_candidate_epoch_to_test("sets/subject", "job-1", 12)
    opened_response = client.post("/fs/training_candidates/open_test", json={"folder": "sets/subject", "jobId": "job-1"})
    assert opened_response.status_code == 200
    assert opened == [expected.resolve()]
    assert (expected / source.name).read_bytes() == b"test weights"
    assert client.post("/fs/training_candidates/open_test", json={"folder": "sets/subject", "jobId": "job-1", "epoch": 12}).status_code == 400
    monkeypatch.setattr(app_module, "training_runner_candidate_test_folder_path", lambda folder, job_id: (_ for _ in ()).throw(OSError("test folder permission denied")))
    failed = client.post("/fs/training_candidates/open_test", json={"folder": "sets/subject", "jobId": "job-1"})
    assert failed.status_code == 400
    assert failed.get_json()["error"] == "test folder permission denied"


def test_copy_candidate_concurrent_requests_create_one_file(tmp_path, monkeypatch):
    source, destination_root = _copy_to_test_fixture(tmp_path, monkeypatch, subfolder="")
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(training_runner.copy_candidate_epoch_to_test, "sets/subject", "job-1", 12) for _ in range(2)]
    outcomes = []
    for future in futures:
        try:
            outcomes.append(future.result())
        except FileExistsError:
            outcomes.append("conflict")
    assert outcomes.count("conflict") == 1
    assert len([item for item in outcomes if item != "conflict"]) == 1
    assert (destination_root / "subject" / source.name).read_bytes() == b"test weights"


def test_copy_candidate_revalidates_source_and_removes_only_its_partial_destination(tmp_path, monkeypatch):
    source, destination_root = _copy_to_test_fixture(tmp_path, monkeypatch)
    (source.parent / "second.safetensors").write_bytes(b"second")
    with pytest.raises(ValueError, match="exactly one"):
        training_runner.copy_candidate_epoch_to_test("sets/subject", "job-1", 12)
    (source.parent / "second.safetensors").unlink()

    def interrupted_copy(source_file, destination_file):
        destination_file.write(b"partial")
        raise OSError("interrupted")

    monkeypatch.setattr(training_runner.shutil, "copyfileobj", interrupted_copy)
    with pytest.raises(OSError, match="interrupted"):
        training_runner.copy_candidate_epoch_to_test("sets/subject", "job-1", 12)
    assert not (destination_root / "az" / "subject" / source.name).exists()


def test_copy_candidate_requires_saved_root_and_rejects_extra_request_fields(tmp_path, monkeypatch):
    _source, _destination_root = _copy_to_test_fixture(tmp_path, monkeypatch)
    unavailable_root = tmp_path / "unavailable-root"
    monkeypatch.setattr(training_runner.app_config, "load_config_from_disk", lambda: {
        "training": {"test_copy_roots": {"h3": str(unavailable_root)}, "test_copy_subfolder": ""}
    })
    client = app_module.app.test_client()
    unavailable = client.post("/fs/training_candidates/copy_to_test", json={"folder": "sets/subject", "jobId": "job-1", "epoch": 12})
    assert unavailable.status_code == 422
    monkeypatch.setattr(training_runner.app_config, "load_config_from_disk", lambda: {
        "training": {"test_copy_roots": {}, "test_copy_subfolder": ""}
    })
    missing = client.post("/fs/training_candidates/copy_to_test", json={"folder": "sets/subject", "jobId": "job-1", "epoch": 12})
    assert missing.status_code == 400
    assert "H3 root" in missing.get_json()["error"]
    open_missing = client.post("/fs/training_candidates/open_test", json={"folder": "sets/subject", "jobId": "job-1"})
    assert open_missing.status_code == 400
    assert "H3 root" in open_missing.get_json()["error"]
    invalid = client.post("/fs/training_candidates/copy_to_test", json={"folder": "sets/subject", "jobId": "job-1", "epoch": 12, "path": "no"})
    assert invalid.status_code == 400

# Physical step-space fixtures: the same curve is sampled at different densities.
def _curve(spacing=1, shape=None, end=2000, epoch_steps=200, spikes=()):
    if shape is None:
        shape = lambda step: 1 - .001 * min(step, 600)
    points = [{"step": step, "epoch": step // epoch_steps + 1,
               "loss": shape(step) + .001 * math.sin(step * .37)}
              for step in range(0, end, spacing)]
    for index in spikes:
        points[index]["loss"] += 8 if index % 2 else -8
    checkpoints = []
    for epoch in sorted({p["epoch"] for p in points}):
        samples = [p for p in points if p["epoch"] == epoch]
        checkpoints.append({"epoch": epoch, "startStep": samples[0]["step"],
                            "endStep": samples[-1]["step"], "step": samples[-1]["step"],
                            "loss": training_candidates._median([p["loss"] for p in samples])})
    return points, checkpoints


def test_v3_preserves_the_canonical_epoch_score_scalars_formula():
    points = [{"step": index, "epoch": 1, "loss": loss} for index, loss in enumerate(
        [1.0] * 8 + [.5] * 8
    )]
    scores = v3._scores(points)
    assert (v3.WINDOW, v3.ALPHA, v3.TREND_WINDOW, v3.TREND_WEIGHT) == (5, .3, 8, .4)
    assert (v3.REGIME_CONFIRM_STEPS, v3.REGIME_DROP_FRAC, v3.REGIME_MIN_STEP_FRAC) == (3, .15, .15)
    assert (v3.DEPTH_GATE, v3.REGION_STEP_FRAC, v3.MAX_PER_REGION, v3.MAX_REGIONS) == (.5, .15, 5, 6)
    assert scores[:8] == [0] * 8
    assert scores[8] > scores[9] > 0


def test_v3_trend_bonus_is_zero_before_the_full_trend_window():
    bonus = v3._trend_bonus([1 - index * .03 for index in range(16)])
    assert bonus[:v3.TREND_WINDOW] == [0] * v3.TREND_WINDOW
    assert bonus[v3.TREND_WINDOW] > 0


def test_v3_confirmed_regime_starts_at_the_first_confirmation_point():
    points = [{"step": index, "epoch": 1, "loss": loss} for index, loss in enumerate([1.0] * 8 + [.5] * 8)]
    _scores, first_step = v3._score_details(points)
    assert first_step == 8


def test_v3_preregime_minima_cannot_create_groups():
    points = [{"step": index, "epoch": 1, "loss": loss} for index, loss in enumerate(
        [1.0, .1, 1.0, .2, .3, .4, .5, .6, .7, .8, .9, 1.0, 1.1, 1.2, 1.3, 1.4]
    )]
    scores, first_step = v3._score_details(points)
    assert v3._groups(points, scores, first_step) == []


def test_v3_groups_eligible_epoch_candidates_by_original_region_distance():
    points = [{"step": index * 10, "epoch": 1, "loss": loss} for index, loss in enumerate(
        [1.0, .8, 1.0, .8, 1.0, .8, 1.0, .8, 1.0, .8, 1.0]
    )]
    groups = v3._groups(points, [0, .9, 0, .8, 0, .7, 0, .6, 0, .5, 0])
    assert [group["center"]["step"] for group in groups] == [10, 30, 50, 70, 90]
    assert all(len(group["members"]) <= v3.MAX_PER_REGION for group in groups)


def test_v3_epoch_spacing_is_independent_of_nonuniform_optimizer_steps():
    points = []
    for epoch in range(1, 32):
        optimizer_step = epoch if epoch <= 10 else 100 + epoch if epoch < 13 else 9000 + epoch
        loss = .1 if epoch == 10 else .2 if epoch == 13 else .8 + epoch * .01
        points.append({"step": epoch, "epoch": epoch, "optimizerStep": optimizer_step, "loss": loss})
    _scores, first_regime_step = v3._score_details(points)
    candidate_scores = [
        0 if point["epoch"] not in {10, 13} else .9 if point["epoch"] == 10 else .8
        for point in points
    ]
    groups = v3._groups(points, candidate_scores, first_regime_step)
    assert first_regime_step == 8
    assert len(groups) == 1
    assert [member["epoch"] for member in groups[0]["members"]] == [10, 13]


def test_v3_maps_ranked_epoch_centers_to_webcap_checkpoints():
    losses = [1.0] * 8 + [.5] * 8
    checkpoints = _robust(losses, step_stride=137)
    epoch_loss = [{"step": point["epoch"], "epoch": point["epoch"], "optimizerStep": point["endStep"], "loss": point["loss"]} for point in checkpoints]
    result = v3.detect(epoch_loss, checkpoints)
    regions = result["regions"]
    assert 1 <= len(regions) <= v3.MAX_REGIONS
    assert all(region["kind"] == "ranked_score_region" for region in regions)
    assert all(region["representativeEpoch"] in {point["epoch"] for point in checkpoints} for region in regions)
    assert [point["step"] for point in result["analysisPoints"]] == [point["endStep"] for point in checkpoints]


def _v5_curve(end, basins=(), base=1.0):
    def loss(step):
        return base - sum(depth * max(0.0, 1 - abs(step - center) / radius)
                          for center, depth, radius in basins)

    points = [{"step": step, "epoch": step // 200 + 1, "loss": loss(step)} for step in range(end)]
    checkpoints = [
        {"epoch": epoch, "startStep": (epoch - 1) * 200, "endStep": min(end - 1, epoch * 200 - 1),
         "step": min(end - 1, epoch * 200 - 1), "loss": loss(min(end - 1, epoch * 200 - 1))}
        for epoch in range(1, (end - 1) // 200 + 2)
    ]
    return points, checkpoints


def test_v5_returns_the_fixed_ema_it_analyzes():
    points = [
        {"step": 0, "epoch": 1, "loss": 1.0},
        {"step": 1, "epoch": 1, "loss": .5},
        {"step": 2, "epoch": 1, "loss": .5},
    ]
    checkpoints = [{"epoch": 1, "startStep": 0, "endStep": 2, "step": 2, "loss": .5}]
    analysis = v5.detect(points, checkpoints)["analysisPoints"]
    assert [point["loss"] for point in analysis] == pytest.approx([1.0, .99, .9802])


def test_v5_centered_trends_use_optimizer_steps_not_array_indexes():
    points = [{"step": step, "epoch": 1, "loss": loss} for step, loss in [
        (0, 0.0), (1, 0.0), (2, 0.0), (100, 10.0), (150, 20.0), (200, 30.0),
    ]]
    trend = v5._centered_trend(points, 100)
    assert trend["values"][3] == pytest.approx(15.0)


def test_v5_raw_peak_does_not_create_a_basin_by_itself():
    points, checkpoints = _v5_curve(7_000, [(3_000, .35, 900)])
    points[5_500]["loss"] += 10
    regions = v5.detect(points, checkpoints)["regions"]
    assert regions
    assert all(abs(region["floorCenterStep"] - 5_500) > 500 for region in regions)


def test_v5_short_scale_only_dip_cannot_enter_the_normal_pool():
    points, _checkpoints = _v5_curve(6_000)
    for point in points:
        step = point["step"]
        point["loss"] = 1.0 - step * .00005 - .02 * max(0.0, 1 - abs(step - 3_000) / 50)
    ema = v5._ema_points(points)
    minima = {width: v5._nms_minima(v5._raw_minima(v5._centered_trend(ema, width)), width)
              for width in v5.TREND_WIDTHS}
    assert any(abs(item["step"] - 3_000) < 100 for item in minima[100])
    assert all(not any(abs(item["step"] - 3_000) < 100 for item in minima[width])
               for width in (250, 500, 1000))


def test_v5_persistent_basin_and_recovered_floor_produce_separate_regions():
    points, checkpoints = _v5_curve(8_500, [(2_500, .35, 900), (5_500, .33, 900)])
    regions = v5.detect(points, checkpoints)["regions"]
    centers = [region["floorCenterStep"] for region in regions]
    anchors = [region["anchorStep"] for region in regions]
    assert any(abs(center - 2_500) < 500 for center in centers)
    assert any(abs(center - 5_500) < 500 for center in centers)
    assert all(abs(left - right) >= v5.FINAL_NMS_STEPS for left in anchors for right in anchors if left != right)


def test_v5_historical_floor_rejects_a_materially_inferior_later_shelf():
    hypotheses = [
        {"anchor": {"step": 1_000, "loss": .2, "prominence": .02}},
        {"anchor": {"step": 3_000, "loss": .8, "prominence": .02}},
    ]
    assert v5._apply_floor_compatibility(hypotheses) == pytest.approx(.04)
    assert hypotheses[0]["floorCompatible"] is True
    assert hypotheses[1]["floorCompatible"] is False


def test_v5_strong_recovered_floor_can_use_its_anchor_prominence_but_weak_shelf_cannot():
    hypotheses = [
        {"anchor": {"step": 1_000, "loss": .2, "prominence": .02}},
        {"anchor": {"step": 3_000, "loss": .3, "prominence": .15}},
        {"anchor": {"step": 5_000, "loss": .3, "prominence": .01}},
    ]
    assert v5._apply_floor_compatibility(hypotheses) == pytest.approx(.04)
    assert hypotheses[1]["floorCompatible"] is True
    assert hypotheses[2]["floorCompatible"] is False


def test_v5_nms_drops_a_weak_neighboring_dip_and_rep_projects_after_the_smoothed_floor():
    points, checkpoints = _v5_curve(7_000, [(3_000, .4, 900), (3_550, .08, 200)])
    checkpoints.extend([
        {"epoch": 99, "startStep": 2_900, "endStep": 3_000, "step": 3_000, "loss": .6},
        {"epoch": 100, "startStep": 3_450, "endStep": 3_500, "step": 3_500, "loss": .8},
    ])
    checkpoints.sort(key=lambda point: point["endStep"])
    regions = v5.detect(points, checkpoints)["regions"]
    nearby = [region for region in regions if 2_000 < region["anchorStep"] < 4_000]
    assert len(nearby) == 1
    assert nearby[0]["representativeEpoch"] == 16


def test_v5_startup_descent_ends_only_after_sustained_flattening():
    trend = {"steps": list(range(0, 4_501, 500)),
             "values": [10, 9.5, 9, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5]}
    assert v5._startup_end_step(trend) == 2_000


def test_v5_later_descent_is_not_reclassified_as_startup():
    trend = {"steps": list(range(0, 4_501, 500)),
             "values": [10, 10, 10, 10, 9.5, 9, 8.5, 8, 7.5, 7]}
    assert v5._startup_end_step(trend) is None


def test_v5_brief_flattening_does_not_confirm_startup_end():
    trend = {"steps": list(range(0, 5_501, 500)),
             "values": [10, 9.5, 9, 8.5, 8.5, 8.5, 8, 7.5, 7, 6.5, 6, 5.5]}
    assert v5._startup_end_step(trend) is None


def test_v5_ambiguous_startup_without_flattening_fails_open():
    trend = {"steps": list(range(0, 5_501, 500)),
             "values": [10 - .5 * index for index in range(12)]}
    assert v5._startup_end_step(trend) is None


def test_v5_startup_quota_leaves_slots_for_later_hypotheses():
    def hypothesis(step, score):
        return {"anchor": {"step": step, "loss": 1.0}, "basinScore": score,
                "prominenceScore": score, "persistenceScore": 1.0}

    hypotheses = [hypothesis(step, 10 - index) for index, step in enumerate((500, 1_300, 2_100, 3_000, 3_800, 4_600))]
    selected = []
    v5._accept(selected, v5._ranked(hypotheses), 5, startup_end_step=2_100)
    assert len(selected) == 5
    assert sum(item["anchor"]["step"] <= 2_100 for item in selected) == v5.MAX_STARTUP_REGIONS
    assert any(item["anchor"]["step"] > 2_100 for item in selected)


def test_v5_startup_candidates_are_not_reserved():
    def hypothesis(step, score):
        return {"anchor": {"step": step, "loss": 1.0}, "basinScore": score,
                "prominenceScore": score, "persistenceScore": 1.0}

    startup = [hypothesis(500, .2), hypothesis(1_300, .1)]
    later = [hypothesis(3_000 + index * 800, 10 - index) for index in range(v5.MAX_REGIONS)]
    selected = []
    v5._accept(selected, v5._ranked(startup + later), v5.MAX_REGIONS, startup_end_step=1_500)
    assert len(selected) == v5.MAX_REGIONS
    assert all(item["anchor"]["step"] > 1_500 for item in selected)


def test_v5_representative_prefers_nearest_checkpoint_after_floor_over_trend_loss():
    floor_center = {"step": 1_550}
    trend_250 = {"steps": [1_500, 1_600, 1_800], "values": [0.0, 10.0, -10.0]}
    representative = v5._representative(floor_center, [
        {"epoch": 1, "endStep": 1_500}, {"epoch": 2, "endStep": 1_600},
        {"epoch": 3, "endStep": 1_800},
    ], trend_250, 1_000, 2_000)
    assert representative["endStep"] == 1_600


def test_v5_representative_allows_exact_natural_basin_boundary():
    floor_center = {"step": 1_950}
    trend_250 = {"steps": [1_900, 2_000], "values": [0.0, 10.0]}
    representative = v5._representative(floor_center, [
        {"epoch": 1, "endStep": 1_900}, {"epoch": 2, "endStep": 2_000},
    ], trend_250, 1_000, 2_000)
    assert representative["endStep"] == 2_000


def test_v5_representative_uses_nearest_prefloor_checkpoint_when_needed():
    floor_center = {"step": 1_950}
    trend_250 = {"steps": [1_500, 1_800], "values": [0.0, 10.0]}
    representative = v5._representative(floor_center, [
        {"epoch": 1, "endStep": 1_500}, {"epoch": 2, "endStep": 1_800},
    ], trend_250, 1_000, 2_000)
    assert representative["endStep"] == 1_800


def test_v5_representative_stays_inside_natural_basin():
    floor_center = {"step": 1_950}
    trend_250 = {"steps": [1_800, 2_050], "values": [10.0, 0.0]}
    representative = v5._representative(floor_center, [
        {"epoch": 1, "endStep": 1_800}, {"epoch": 2, "endStep": 2_050},
    ], trend_250, 1_000, 2_000)
    assert representative["endStep"] == 1_800


def test_v5_no_inside_checkpoint_uses_nearest_floor_and_minimal_expansion():
    floor_center = {"step": 1_500}
    trend_250 = {"steps": [800, 1_500, 2_200, 3_000], "values": [0.0, 0.0, 0.0, -10.0]}
    start, end = 1_000, 2_000
    representative = v5._representative(floor_center, [
        {"epoch": 1, "endStep": 800}, {"epoch": 2, "endStep": 2_200},
        {"epoch": 3, "endStep": 3_000},
    ], trend_250, start, end)
    start = min(start, representative["endStep"])
    end = max(end, representative["endStep"])
    assert representative["endStep"] == 2_200
    assert (start, end) == (1_000, 2_200)


def test_v5_fallback_is_nonempty_and_result_count_is_bounded():
    points, checkpoints = _v5_curve(5_000)
    regions = v5.detect(points, checkpoints)["regions"]
    assert 1 <= len(regions) <= v5.MAX_REGIONS


def test_v5_is_practical_on_twenty_thousand_detailed_points():
    points, checkpoints = _v5_curve(20_000, [(4_000, .3, 900), (10_000, .35, 900), (16_000, .4, 900)])
    started = time.perf_counter()
    result = v5.detect(points, checkpoints)
    assert time.perf_counter() - started < 3
    assert len(result["analysisPoints"]) == 20_000
    assert 1 <= len(result["regions"]) <= v5.MAX_REGIONS


@pytest.mark.parametrize("algorithm", ["v3", "v5"])
def test_all_dispatch_display_and_artifact_independence(algorithm, tmp_path, monkeypatch):
    points, checkpoints = _curve()
    detailed = [{"axis": p["step"], "loss": p["loss"], "wallTime": p["step"], "order": i} for i, p in enumerate(points)]
    epochs = [{"axis": p["epoch"], "loss": p["loss"], "wallTime": p["endStep"], "order": i} for i, p in enumerate(checkpoints)]
    before = training_candidates.analyze_loss_points(detailed, epochs, algorithm=algorithm)
    assert before["algorithm"] == algorithm and before["analysisVersion"] == 13
    (tmp_path / "epoch5").mkdir()
    (tmp_path / "epoch5" / "adapter.safetensors").write_bytes(b"fixture")
    after = training_candidates.analyze_loss_points(detailed, epochs, run_dir=tmp_path, algorithm=algorithm)
    assert [dict(r, savedEpochs=[]) for r in before["regions"]] == [dict(r, savedEpochs=[]) for r in after["regions"]]
    assert before["smoothedStepLossPoints"] == training_candidates.smooth_step_loss(points)
    monkeypatch.setattr(training_candidates, "smooth_step_loss", lambda points: [])
    hidden = training_candidates.analyze_loss_points(detailed, epochs, algorithm=algorithm)
    assert hidden["regions"] == before["regions"]


def test_display_centering_spike_rejection_and_density():
    shape = lambda step: .4 if step < 1000 else .6
    dense, _ = _curve(shape=shape, spikes=(351, 750))
    sparse, _ = _curve(shape=shape, spacing=5)
    smoothed = training_candidates.smooth_step_loss(dense)
    reduced = training_candidates.smooth_step_loss(sparse)
    assert max(abs(p["loss"] - .4) for p in smoothed[300:800]) < .002
    crossing = next(p["step"] for p in smoothed if p["loss"] >= .5)
    assert abs(crossing - 1000) <= 5
    lookup = {p["step"]: p["loss"] for p in smoothed}
    assert max(abs(lookup[p["step"]] - p["loss"]) for p in reduced) < .03
