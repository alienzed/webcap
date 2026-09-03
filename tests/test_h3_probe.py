import csv
import importlib.util
import json
import shutil
import tomllib
from pathlib import Path

import pytest

import tool.server.app as app_module
import tool.server.config as config_module
import tool.server.h3_probe as h3_probe_module


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
SCRIPT_PATH = SCRIPTS_DIR / "h3_shape_probe.py"


def load_probe_script():
    spec = importlib.util.spec_from_file_location("h3_shape_probe_test", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def h3_config_text():
    return """output_dir = \"/output\"
dataset = \"/dataset.toml\"
epochs = 100
save_every_n_epochs = 1
checkpoint_every_n_epochs = 5
steps_per_print = 10
compile = true
activation_checkpointing = true
micro_batch_size_per_gpu = 1
"""


def test_fixed_plan_is_exact_90_shape_campaign():
    probe = load_probe_script()
    plan = json.loads((SCRIPTS_DIR / "h3_shape_probe_plan.json").read_text(encoding="utf-8"))
    assert plan["version"] == 2
    assert plan["rungStep"] == 32
    assert sum(len(ladder["shapes"]) for ladder in plan["ladders"]) == 90
    assert probe._validate_plan(plan) == plan["ladders"]

    expected = {
        (34, "169"): (12, [736, 416], [1344, 768]),
        (34, "square"): (7, [576, 576], [768, 768]),
        (34, "43"): (10, [640, 480], [1024, 768]),
        (68, "169"): (8, [512, 288], [896, 512]),
        (68, "square"): (10, [384, 384], [672, 672]),
        (68, "43"): (9, [416, 320], [768, 576]),
        (102, "169"): (7, [384, 224], [736, 416]),
        (102, "square"): (8, [320, 320], [544, 544]),
        (102, "43"): (8, [352, 256], [640, 480]),
        (17, "169"): (6, [1088, 608], [1344, 768]),
        (17, "square"): (2, [736, 736], [768, 768]),
        (17, "43"): (3, [928, 704], [1024, 768]),
    }
    for ladder in plan["ladders"]:
        shapes = ladder["shapes"]
        count, start, end = expected[(ladder["frames"], ladder["aspect"])]
        assert (len(shapes), shapes[0], shapes[-1]) == (count, start, end)
        assert all(width % 32 == 0 and height % 32 == 0 for width, height in shapes)
        short_edges = [min(width, height) for width, height in shapes]
        assert all(right - left == 32 for left, right in zip(short_edges, short_edges[1:]))
        if ladder["frames"] in (68, 102):
            mfps = [probe.mfp(width, height, ladder["frames"]) for width, height in shapes]
            assert ladder["terminal"] == "sentinel"
            assert sum(value > 30 for value in mfps) == 1
            assert mfps[-1] > 30
            assert all(value <= 30 for value in mfps[:-1])
        else:
            assert ladder["terminal"] == "model_cap"


def test_probe_config_changes_only_probe_owned_values():
    probe = load_probe_script()
    rendered = probe.build_probe_config(h3_config_text(), "/run/dataset.toml", "/run/output")
    assert 'dataset = "/run/dataset.toml"' in rendered
    assert 'output_dir = "/run/output"' in rendered
    assert "epochs = 6" in rendered
    assert "save_every_n_epochs = 7" in rendered
    assert "checkpoint_every_n_epochs = 7" in rendered
    assert "steps_per_print = 1" in rendered
    assert "compile = true" in rendered
    assert "activation_checkpointing = true" in rendered
    assert "micro_batch_size_per_gpu = 1" in rendered


def test_candidates_have_isolated_media_and_cache_namespaces(tmp_path):
    probe = load_probe_script()
    config = tmp_path / "config.toml"
    config.write_text(h3_config_text(), encoding="utf-8")
    video = tmp_path / "source.mp4"
    caption = tmp_path / "source.txt"
    video.write_bytes(b"video")
    caption.write_text("caption", encoding="utf-8")
    results = tmp_path / "results"
    results.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    seed = {"video": video, "caption": caption, "config": config, "results": results}
    first = probe.prepare_candidate(seed, {"frames": 34, "aspect": "169"}, 736, 416, work)
    second = probe.prepare_candidate(seed, {"frames": 68, "aspect": "square"}, 384, 384, work)

    assert first["mediaDir"] != second["mediaDir"]
    assert first["mediaDir"] == work / "media" / "34f" / "169-736x416"
    assert second["mediaDir"] == work / "media" / "68f" / "square-384x384"
    assert (first["mediaDir"] / video.name).read_bytes() == b"video"
    assert (second["mediaDir"] / caption.name).read_text(encoding="utf-8") == "caption"
    for candidate in (first, second):
        dataset = tomllib.loads(candidate["datasetPath"].read_text(encoding="utf-8"))
        assert dataset["directory"] == [{
            "path": str(candidate["mediaDir"]).replace("\\", "/"),
            "num_repeats": 1,
            "group": "videos",
            "size_buckets": [candidate["shape"]],
        }]
        request = json.loads((candidate["probeDir"] / "request.json").read_text(encoding="utf-8"))
        assert "--cache_only" in request["cacheCommand"]
        assert "--trust_cache" not in request["cacheCommand"]
        assert "--cache_only" not in request["trainCommand"]
        assert "--trust_cache" in request["trainCommand"]


def test_candidate_caches_then_trains_with_separate_telemetry(tmp_path, monkeypatch):
    probe = load_probe_script()
    config = tmp_path / "config.toml"
    config.write_text(h3_config_text(), encoding="utf-8")
    video = tmp_path / "source.mp4"
    caption = tmp_path / "source.txt"
    video.write_bytes(b"video")
    caption.write_text("caption", encoding="utf-8")
    results = tmp_path / "results"
    results.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    candidate = probe.prepare_candidate(
        {"video": video, "caption": caption, "config": config, "results": results},
        {"frames": 34, "aspect": "169"}, 736, 416, work,
    )
    calls = []

    class FakeSampler:
        def __init__(self, _path):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    def fake_run(command, _cwd, log_path, post_warmup_timeout=None, **_kwargs):
        calls.append((command, post_warmup_timeout))
        if "--cache_only" in command:
            Path(log_path).write_text("cache complete\n", encoding="utf-8")
        else:
            Path(log_path).write_text(
                "\n".join("step=" + str(index) + ", iter time (s): 20.0" for index in range(1, 7)) + "\n",
                encoding="utf-8",
            )
        return {"exitCode": 0, "timedOut": False}

    monkeypatch.setattr(probe, "TelemetrySampler", FakeSampler)
    monkeypatch.setattr(probe, "run_command", fake_run)
    monkeypatch.setattr(probe, "telemetry_summary", lambda path: {
        "peakGpuMemoryMiB": 999 if Path(path) == candidate["cacheTelemetryPath"] else 100,
        "gpuMemoryTotalMiB": 1000,
        "memoryPressureEvidence": True,
    })
    result = probe.execute_probe(candidate, baseline_seconds=2.0)
    assert result["status"] == "unsafe_slow"
    assert result["slowThresholdSeconds"] == 20.0
    assert result["slowStepCount"] == 4
    assert "--cache_only" in calls[0][0]
    assert "--trust_cache" not in calls[0][0]
    assert "--cache_only" not in calls[1][0]
    assert "--trust_cache" in calls[1][0]
    assert calls[1][1] == 120.0
    assert result["cacheTelemetry"]["peakGpuMemoryMiB"] == 999
    assert result["telemetry"]["peakGpuMemoryMiB"] == 100
    assert result["telemetry"]["spillEvidence"] is True

    safe_result = probe.execute_probe(candidate, baseline_seconds=20.0)
    assert safe_result["status"] == "completed"
    assert safe_result["telemetry"]["memoryPressureEvidence"] is True
    assert safe_result["telemetry"]["spillEvidence"] is False


def test_cache_oom_stops_before_training(tmp_path, monkeypatch):
    probe = load_probe_script()
    config = tmp_path / "config.toml"
    video = tmp_path / "source.mp4"
    caption = tmp_path / "source.txt"
    config.write_text(h3_config_text(), encoding="utf-8")
    video.write_bytes(b"video")
    caption.write_text("caption", encoding="utf-8")
    results = tmp_path / "results"
    results.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    candidate = probe.prepare_candidate(
        {"video": video, "caption": caption, "config": config, "results": results},
        {"frames": 34, "aspect": "169"}, 736, 416, work,
    )
    calls = []

    class FakeSampler:
        def __init__(self, _path):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    def fake_run(command, _cwd, log_path, post_warmup_timeout=None):
        calls.append(command)
        Path(log_path).write_text("CUDA out of memory\n", encoding="utf-8")
        return {"exitCode": 1, "timedOut": False}

    monkeypatch.setattr(probe, "TelemetrySampler", FakeSampler)
    monkeypatch.setattr(probe, "run_command", fake_run)
    result = probe.execute_probe(candidate, baseline_seconds=None)

    assert result["status"] == "oom"
    assert result["terminalReason"] == "cache_oom"
    assert result["cacheExitCode"] == 1
    assert result["trainCommand"] is None
    assert result["trainExitCode"] is None
    assert len(calls) == 1


def test_saved_result_reclassification_marks_single_clear_spill_unsafe():
    probe = load_probe_script()
    status, median = probe.classify_saved_result({
        "status": "completed",
        "cacheExitCode": 0,
        "trainExitCode": 0,
        "timedOut": False,
        "measuredStepSeconds": [27.8, 28.1, 28.4, 28.7],
        "telemetry": {"peakGpuMemoryMiB": 1000, "gpuMemoryTotalMiB": 2000},
    }, baseline_seconds=2.298)
    assert status == "unsafe_slow"
    assert median == pytest.approx(28.25)


@pytest.mark.parametrize(("train_log", "expected_status"), [
    ("CUDA out of memory\n", "oom"),
    ("trainer exited unexpectedly\n", "trainer_failed"),
])
def test_training_failures_are_classified_after_successful_cache(tmp_path, monkeypatch, train_log, expected_status):
    probe = load_probe_script()
    config = tmp_path / "config.toml"
    video = tmp_path / "source.mp4"
    caption = tmp_path / "source.txt"
    config.write_text(h3_config_text(), encoding="utf-8")
    video.write_bytes(b"video")
    caption.write_text("caption", encoding="utf-8")
    results = tmp_path / "results"
    results.mkdir()
    work = tmp_path / "work"
    work.mkdir()
    candidate = probe.prepare_candidate(
        {"video": video, "caption": caption, "config": config, "results": results},
        {"frames": 34, "aspect": "169"}, 736, 416, work,
    )
    calls = []

    class FakeSampler:
        def __init__(self, _path):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    def fake_run(command, _cwd, log_path, post_warmup_timeout=None, **_kwargs):
        calls.append(command)
        is_cache = "--cache_only" in command
        Path(log_path).write_text("cache complete\n" if is_cache else train_log, encoding="utf-8")
        return {"exitCode": 0 if is_cache else 1, "timedOut": False}

    monkeypatch.setattr(probe, "TelemetrySampler", FakeSampler)
    monkeypatch.setattr(probe, "run_command", fake_run)
    result = probe.execute_probe(candidate, baseline_seconds=2.0)

    assert result["status"] == expected_status
    assert result["cacheExitCode"] == 0
    assert result["trainExitCode"] == 1
    assert "--cache_only" in calls[0]
    assert "--trust_cache" in calls[1]


def test_telemetry_uses_all_gpus_and_reports_memory_pressure(tmp_path):
    probe = load_probe_script()
    telemetry_path = tmp_path / "telemetry.csv"
    with telemetry_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=[
            "captured_at", "gpu_index", "gpu_uuid", "gpu_memory_used_mib", "gpu_memory_total_mib",
            "gpu_utilization_percent", "mem_available_kib", "swap_total_kib", "swap_free_kib",
        ])
        writer.writeheader()
        writer.writerows([
            {"gpu_index": "0", "gpu_uuid": "GPU-0", "gpu_memory_used_mib": "100", "gpu_memory_total_mib": "4000", "mem_available_kib": str(10 * 1024 * 1024), "swap_free_kib": str(4 * 1024 * 1024)},
            {"gpu_index": "1", "gpu_uuid": "GPU-1", "gpu_memory_used_mib": "300", "gpu_memory_total_mib": "4000", "mem_available_kib": str(10 * 1024 * 1024), "swap_free_kib": str(4 * 1024 * 1024)},
            {"gpu_index": "0", "gpu_uuid": "GPU-0", "gpu_memory_used_mib": "200", "gpu_memory_total_mib": "4000", "mem_available_kib": str(7 * 1024 * 1024), "swap_free_kib": str(4 * 1024 * 1024)},
            {"gpu_index": "1", "gpu_uuid": "GPU-1", "gpu_memory_used_mib": "2000", "gpu_memory_total_mib": "4000", "mem_available_kib": str(7 * 1024 * 1024), "swap_free_kib": str(4 * 1024 * 1024)},
        ])
    summary = probe.telemetry_summary(telemetry_path)
    assert summary["activeGpuIndex"] == "1"
    assert summary["peakGpuMemoryMiB"] == 2000
    assert summary["minimumGpuFreeMiB"] == 2000
    assert summary["hostAvailableDropKiB"] == 3 * 1024 * 1024
    assert summary["memoryPressureEvidence"] is True


def test_saved_result_reclassification_enforces_exact_vram_headroom():
    probe = load_probe_script()
    base = {
        "status": "completed",
        "cacheExitCode": 0,
        "trainExitCode": 0,
        "timedOut": False,
        "measuredStepSeconds": [2.0, 2.1, 2.0, 2.1],
        "telemetry": {"peakGpuMemoryMiB": 32000, "gpuMemoryTotalMiB": 32680},
    }
    assert probe.classify_saved_result(base, baseline_seconds=2.0)[0] == "completed"
    base["telemetry"]["gpuMemoryTotalMiB"] = 32679
    assert probe.classify_saved_result(base, baseline_seconds=2.0)[0] == "unsafe_vram"
    base["telemetry"] = {"peakGpuMemoryMiB": 32000}
    assert probe.classify_saved_result(base, baseline_seconds=2.0)[0] == "telemetry_failed"


def test_persist_calibration_reloads_current_config_and_preserves_unrelated_changes(tmp_path):
    probe = load_probe_script()
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"training": {"conda_environment": "old"}, "unrelated": {"value": 1}}), encoding="utf-8")
    calibration = {"hardware": {"total_ram_mib": 1, "gpu_model": "GPU", "total_vram_mib": 1}, "results": {}}
    _config, loaded = probe.load_persistent_calibration(path, calibration["hardware"])
    path.write_text(json.dumps({"training": {"conda_environment": "new"}, "unrelated": {"value": 2}}), encoding="utf-8")
    loaded["results"]["34f/169-736x416"] = {"status": "completed", "median_step_seconds": 2.0}
    probe.persist_calibration(path, loaded)
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["training"]["conda_environment"] == "new"
    assert saved["unrelated"] == {"value": 2}
    assert saved["training"]["h3_calibration"] == loaded


def test_run_campaign_persists_and_reuses_completed_result_with_baseline(tmp_path, monkeypatch):
    probe = load_probe_script()
    plan = {"version": 2, "rungStep": 32, "ladders": [{"frames": 34, "aspect": "169", "terminal": "model_cap", "shapes": [[736, 416], [768, 448]]}]}
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps(plan), encoding="utf-8")
    config_path = tmp_path / "config.json"
    hardware = {"total_ram_mib": 64, "gpu_model": "GPU", "total_vram_mib": 32}
    config_path.write_text(json.dumps({"training": {"h3_calibration": {"hardware": hardware, "results": {"34f/169-736x416": {"status": "completed", "median_step_seconds": 3.0}}}}}), encoding="utf-8")
    seed = {"plan": plan_path, "results": tmp_path / "results", "seedPath": tmp_path / "seed.json", "video": tmp_path / "video.mp4", "caption": tmp_path / "video.txt", "config": tmp_path / "base.toml"}
    calls = []
    monkeypatch.setattr(probe, "_validate_plan", lambda value: value["ladders"])
    monkeypatch.setattr(probe, "current_hardware", lambda: hardware)
    monkeypatch.setattr(probe, "derived_safe_shapes", lambda _ladders, _results: (1, {}))
    def prepare(_seed, ladder, width, height, _work):
        root = seed["results"] / probe.candidate_name(ladder["frames"], ladder["aspect"], width, height)
        root.mkdir(parents=True)
        return {"frames": ladder["frames"], "aspect": ladder["aspect"], "shape": [width, height, ladder["frames"]], "mfp": 1.0, "probeDir": root, "resultPath": root / "result.json"}
    def execute(candidate, baseline, **_kwargs):
        calls.append((candidate["shape"][:2], baseline))
        return {"status": "completed", "medianStepSeconds": 4.0, "telemetry": {"minimumGpuFreeMiB": 1000, "peakGpuMemoryMiB": 2000}}
    monkeypatch.setattr(probe, "prepare_candidate", prepare)
    monkeypatch.setattr(probe, "execute_probe", execute)
    assert probe.run_campaign(seed, config_path) == "completed"
    assert calls == [([768, 448], 3.0)]
    assert json.loads(config_path.read_text(encoding="utf-8"))["training"]["h3_calibration"]["results"]["34f/169-768x448"]["status"] == "completed"


@pytest.mark.parametrize("status", ["oom", "unsafe_slow", "unsafe_vram"])
def test_persisted_decisive_result_settles_only_its_ladder(status):
    probe = load_probe_script()
    plan = json.loads((SCRIPTS_DIR / "h3_shape_probe_plan.json").read_text(encoding="utf-8"))
    ladders = probe._validate_plan(plan)
    results = {"34f/169-736x416": {"status": status}}
    settled, safe_shapes = probe.derived_safe_shapes(ladders, results)
    assert settled == 1
    assert safe_shapes is None


def test_safe_model_cap_and_sentinel_publish_expected_ceiling_without_102f():
    probe = load_probe_script()
    ladders = probe._validate_plan(json.loads((SCRIPTS_DIR / "h3_shape_probe_plan.json").read_text(encoding="utf-8")))
    results = {}
    for ladder in ladders:
        for width, height in ladder["shapes"]:
            results[probe.candidate_name(ladder["frames"], ladder["aspect"], width, height)] = {"status": "completed", "median_step_seconds": 2.0}
    settled, safe_shapes = probe.derived_safe_shapes(ladders, results)
    assert settled == 12
    assert set(safe_shapes) == {"17", "34", "68"}
    assert safe_shapes["34"]["169"] == [1344, 768]
    assert safe_shapes["68"]["169"] == [864, 480]


def test_hardware_mismatch_and_malformed_persistent_state_fail_loudly(tmp_path):
    probe = load_probe_script()
    path = tmp_path / "config.json"
    hardware = {"total_ram_mib": 64, "gpu_model": "GPU", "total_vram_mib": 32}
    path.write_text(json.dumps({"training": {"h3_calibration": {"hardware": hardware, "results": {"bad": {"status": "completed"}}}}}), encoding="utf-8")
    with pytest.raises(ValueError, match="hardware differs"):
        probe.load_persistent_calibration(path, {**hardware, "total_vram_mib": 33})
    with pytest.raises(ValueError, match="unknown candidate"):
        config_module._validate_h3_calibration(json.loads(path.read_text(encoding="utf-8"))["training"]["h3_calibration"])


@pytest.mark.parametrize("status", ["cache_failed", "trainer_failed", "telemetry_failed"])
def test_nonconclusive_probe_failures_are_not_persisted(status):
    probe = load_probe_script()
    assert probe.compact_persistent_result({"status": status, "telemetry": {}}) is None


def test_prepare_route_captures_exact_video_and_returns_command(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    folder = fs_root / "set"
    folder.mkdir(parents=True)
    source = folder / "probe.mp4"
    source.write_bytes(b"video")
    source.with_suffix(".txt").write_text("probe caption", encoding="utf-8")
    (folder / "config.h3.toml").write_text(h3_config_text(), encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)
    scoped = []
    def metadata(_folder, scoped_filenames=None):
        scoped.append(scoped_filenames)
        return {"probe.mp4": {"fps": 24, "duration": 10.0}}
    monkeypatch.setattr(h3_probe_module, "update_media_metadata", metadata)

    def copy_capture(src, dest, target_fps, source_fps):
        assert target_fps == 24
        assert source_fps == 24
        shutil.copy2(src, dest)
        return {"action": "copied"}

    monkeypatch.setattr(h3_probe_module, "_copy_or_convert_bundle_video", copy_capture)
    monkeypatch.setattr(h3_probe_module, "configured_training_settings", lambda: {"cwd": "/opt/diffusion-pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": ""})
    monkeypatch.setattr(h3_probe_module, "to_wsl_path", lambda value, _distribution: "/mnt/probe/" + Path(value).name)
    response = app_module.app.test_client().post("/fs/h3_probe/prepare", json={"folder": "set", "fileName": "probe.mp4"})
    assert response.status_code == 200
    payload = response.get_json()
    seed_path = Path(payload["seedPath"])
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    assert seed["source"]["captureAction"] == "copied"
    assert (seed_path.parent / seed["source"]["video"]).read_bytes() == b"video"
    assert (seed_path.parent / seed["source"]["caption"]).read_text(encoding="utf-8") == "probe caption."
    assert (seed_path.parent / seed["plan"]).is_file()
    assert "h3_shape_probe.py" in payload["command"]
    assert scoped == [["probe.mp4"]]


def test_prepare_route_uses_canonical_config_when_set_has_none(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    folder = fs_root / "set"
    folder.mkdir(parents=True)
    source = folder / "probe.mp4"
    source.write_bytes(b"video")
    source.with_suffix(".txt").write_text("probe caption", encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)
    monkeypatch.setattr(h3_probe_module, "update_media_metadata", lambda _folder, scoped_filenames=None: {"probe.mp4": {"fps": 24, "duration": 10.0}})

    def copy_capture(src, dest, _fps, _source_fps):
        shutil.copy2(src, dest)
        return {"action": "copied"}

    monkeypatch.setattr(h3_probe_module, "_copy_or_convert_bundle_video", copy_capture)
    monkeypatch.setattr(h3_probe_module, "render_training_config_template", lambda name, _folder: h3_config_text() + "# " + name + "\n")
    monkeypatch.setattr(h3_probe_module, "configured_training_settings", lambda: {"cwd": "/opt/diffusion-pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": ""})
    monkeypatch.setattr(h3_probe_module, "to_wsl_path", lambda value, _distribution: "/mnt/probe/" + Path(value).name)
    response = app_module.app.test_client().post("/fs/h3_probe/prepare", json={"folder": "set", "fileName": "probe.mp4"})
    assert response.status_code == 200
    seed_path = Path(response.get_json()["seedPath"])
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    assert seed["baseConfigSource"] == "template"
    assert (seed_path.parent / seed["baseConfig"]).read_text(encoding="utf-8") == h3_config_text() + "# config.h3.toml\n"


def test_prepare_route_fails_visibly_without_saved_caption(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    folder = fs_root / "set"
    folder.mkdir(parents=True)
    (folder / "probe.mp4").write_bytes(b"video")
    (folder / "config.h3.toml").write_text(h3_config_text(), encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)
    response = app_module.app.test_client().post("/fs/h3_probe/prepare", json={"folder": "set", "fileName": "probe.mp4"})
    assert response.status_code == 400
    assert "saved non-empty caption" in response.get_json()["error"]


def test_start_and_stop_h3_probe_use_detached_runtime_state(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    probe_root = fs_root / ".webcap_training" / "h3-probes" / "h3-test"
    probe_root.mkdir(parents=True)
    seed_path = probe_root / "seed.json"
    seed_path.write_text("{}", encoding="utf-8")
    config_path = tmp_path / "config.json"
    config_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)
    monkeypatch.setattr(config_module, "CONFIG_PATH", config_path)
    monkeypatch.setattr(h3_probe_module, "prepare_h3_probe", lambda _folder, _file: {
        "ok": True, "probeId": "h3-test", "seedPath": str(seed_path), "command": "ignored",
    })
    monkeypatch.setattr(h3_probe_module, "configured_training_settings", lambda: {
        "cwd": "/pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": "",
    })
    monkeypatch.setattr(h3_probe_module, "to_wsl_path", lambda value, _distribution: str(value))
    launches = []

    def fake_run_wsl(command, timeout, distribution):
        launches.append(command)
        return (0, "4242\n", "")

    monkeypatch.setattr(h3_probe_module, "run_wsl", fake_run_wsl)
    payload = h3_probe_module.start_h3_probe("set", "clip.mp4")
    assert payload["status"] == "running"
    assert "--publish-config" in launches[0]
    runtime_path = probe_root / "runtime.json"
    assert json.loads(runtime_path.read_text(encoding="utf-8"))["pid"] == 4242

    monkeypatch.setattr(h3_probe_module, "_active_runtime_path", lambda: runtime_path)
    stopped = h3_probe_module.stop_h3_probe()
    assert stopped["status"] == "stopping"
    assert any("kill -INT -- -4242" in command for command in launches)
