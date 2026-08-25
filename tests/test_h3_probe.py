import importlib.util
import json
import shutil
from pathlib import Path

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


def test_probe_plan_keeps_known_anchor_first_and_102_landscape_capped():
    plan = json.loads((SCRIPTS_DIR / "h3_shape_probe_plan.json").read_text(encoding="utf-8"))
    assert plan["ladders"][0] == {
        "frames": 34,
        "aspect": "169",
        "shapes": [[672, 384], [736, 416], [800, 448], [864, 480], [896, 512]],
    }
    capped = next(item for item in plan["ladders"] if item["frames"] == 102 and item["aspect"] == "169")
    assert capped["shapes"] == [[448, 256]]
    assert capped["testPlanCap"] is True


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


def test_campaign_stops_one_ladder_and_continues_the_next(tmp_path, monkeypatch):
    probe = load_probe_script()
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps({"ladders": [
        {"frames": 34, "aspect": "169", "shapes": [[672, 384], [800, 448], [864, 480]]},
        {"frames": 68, "aspect": "square", "shapes": [[352, 352], [384, 384]]},
    ]}), encoding="utf-8")
    seed_path = tmp_path / "seed.json"
    seed_path.write_text("{}", encoding="utf-8")
    seed = {"plan": plan_path, "results": tmp_path / "results", "seedPath": seed_path, "video": tmp_path / "source.mp4", "config": tmp_path / "config.toml"}
    calls = []

    def fake_execute(_seed, ladder, width, height, baseline):
        calls.append((ladder["frames"], width, height, baseline))
        status = "oom" if (ladder["frames"], width) == (34, 800) else "completed"
        return {
            "mfp": 1.0,
            "status": status,
            "medianStepSeconds": 2.0 if status == "completed" else None,
            "baselineSeconds": baseline,
            "cacheExitCode": 0,
            "trainExitCode": 1 if status == "oom" else 0,
            "timedOut": False,
        }

    monkeypatch.setattr(probe, "execute_probe", fake_execute)
    assert probe.run_campaign(seed) == "completed"
    assert calls == [
        (34, 672, 384, None),
        (34, 800, 448, 2.0),
        (68, 352, 352, None),
        (68, 384, 384, 2.0),
    ]
    summary = (tmp_path / "results" / "summary.csv").read_text(encoding="utf-8")
    assert "oom" in summary
    assert "864" not in summary


def test_campaign_stops_entirely_on_trainer_failure(tmp_path, monkeypatch):
    probe = load_probe_script()
    plan_path = tmp_path / "plan.json"
    plan_path.write_text(json.dumps({"ladders": [
        {"frames": 34, "aspect": "169", "shapes": [[672, 384]]},
        {"frames": 68, "aspect": "square", "shapes": [[352, 352]]},
    ]}), encoding="utf-8")
    seed_path = tmp_path / "seed.json"
    seed_path.write_text("{}", encoding="utf-8")
    seed = {"plan": plan_path, "results": tmp_path / "results", "seedPath": seed_path, "video": tmp_path / "source.mp4", "config": tmp_path / "config.toml"}
    calls = []

    def fake_execute(_seed, ladder, width, height, baseline):
        calls.append((ladder["frames"], width, height, baseline))
        return {
            "mfp": 1.0, "status": "trainer_failed", "medianStepSeconds": None, "baselineSeconds": baseline,
            "cacheExitCode": 0, "trainExitCode": 1, "timedOut": False,
        }

    monkeypatch.setattr(probe, "execute_probe", fake_execute)
    assert probe.run_campaign(seed) == "trainer_failed"
    assert calls == [(34, 672, 384, None)]


def test_execute_probe_writes_isolated_inputs_and_timing_result(tmp_path, monkeypatch):
    probe = load_probe_script()
    source_video = tmp_path / "source.mp4"
    source_caption = tmp_path / "source.txt"
    config = tmp_path / "config.toml"
    source_video.write_bytes(b"video")
    source_caption.write_text("caption", encoding="utf-8")
    config.write_text(h3_config_text(), encoding="utf-8")
    seed = {"video": source_video, "caption": source_caption, "config": config, "results": tmp_path / "results"}

    class FakeSampler:
        def __init__(self, _path):
            pass

        def start(self):
            pass

        def stop(self):
            pass

    def fake_run(_args, _cwd, log_path, post_warmup_timeout=None):
        if post_warmup_timeout is None:
            Path(log_path).write_text("cache complete\n", encoding="utf-8")
            return {"exitCode": 0, "timedOut": False}
        Path(log_path).write_text(
            "\n".join("step=" + str(index) + ", iter time (s): 20.0" for index in range(1, 7)) + "\n",
            encoding="utf-8",
        )
        return {"exitCode": 0, "timedOut": False}

    monkeypatch.setattr(probe, "TelemetrySampler", FakeSampler)
    monkeypatch.setattr(probe, "run_command", fake_run)
    result = probe.execute_probe(seed, {"frames": 34, "aspect": "169"}, 800, 448, baseline_seconds=1.0)
    probe_dir = tmp_path / "results" / "34f" / "169-800x448"
    assert result["status"] == "timing_limit"
    assert (probe_dir / "media" / "source.mp4").read_bytes() == b"video"
    assert 'size_buckets = [[800, 448, 34]]' in (probe_dir / "dataset.toml").read_text(encoding="utf-8")
    rendered_config = (probe_dir / "config.toml").read_text(encoding="utf-8")
    assert "epochs = 6" in rendered_config
    assert "compile = true" in rendered_config
    record = json.loads((probe_dir / "result.json").read_text(encoding="utf-8"))
    assert record["trainCommand"][0] == "deepspeed"
    assert record["medianStepSeconds"] == 20.0


def test_prepare_route_captures_exact_video_and_returns_command(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    folder = fs_root / "set"
    folder.mkdir(parents=True)
    source = folder / "probe.mp4"
    source.write_bytes(b"video")
    source.with_suffix(".txt").write_text("probe caption", encoding="utf-8")
    (folder / "config.h3.normal.toml").write_text(h3_config_text(), encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)
    monkeypatch.setattr(h3_probe_module, "update_media_metadata", lambda _folder: {"probe.mp4": {"fps": 24}})

    def copy_capture(src, dest, target_fps, source_fps):
        assert target_fps == 24
        assert source_fps == 24
        shutil.copy2(src, dest)
        return {"action": "copied"}

    monkeypatch.setattr(h3_probe_module, "_copy_or_convert_bundle_video", copy_capture)
    monkeypatch.setattr(h3_probe_module, "configured_training_settings", lambda: {
        "cwd": "/opt/diffusion-pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": "",
    })
    monkeypatch.setattr(h3_probe_module, "to_wsl_path", lambda value, _distribution: "/mnt/probe/" + Path(value).name)

    response = app_module.app.test_client().post("/fs/h3_probe/prepare", json={"folder": "set", "fileName": "probe.mp4"})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    seed_path = Path(payload["seedPath"])
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    assert seed["source"]["captureAction"] == "copied"
    assert (seed_path.parent / seed["source"]["video"]).read_bytes() == b"video"
    assert (seed_path.parent / seed["source"]["caption"]).read_text(encoding="utf-8") == "probe caption."
    assert (seed_path.parent / seed["baseConfig"]).read_text(encoding="utf-8") == h3_config_text()
    assert (seed_path.parent / seed["plan"]).is_file()
    assert "h3_shape_probe.py" in payload["command"]
    assert "--seed" in payload["command"]


def test_prepare_route_fails_visibly_without_saved_caption(tmp_path, monkeypatch):
    fs_root = tmp_path / "fs"
    folder = fs_root / "set"
    folder.mkdir(parents=True)
    (folder / "probe.mp4").write_bytes(b"video")
    (folder / "config.h3.normal.toml").write_text(h3_config_text(), encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", fs_root)

    response = app_module.app.test_client().post("/fs/h3_probe/prepare", json={"folder": "set", "fileName": "probe.mp4"})
    assert response.status_code == 400
    assert "saved non-empty caption" in response.get_json()["error"]
