import json

from tool.server import training_preflight
from tool.server import training_runner
from tool.server.training_runtime import training_runtime_settings


def test_gpu_snapshot_reports_compact_gpu_and_process_data(monkeypatch):
    commands = []
    monkeypatch.setattr(training_preflight, "configured_training_settings", lambda: {"wslDistribution": "Ubuntu_W"})

    def fake_run(command, **kwargs):
        commands.append((command, kwargs))
        if "--query-gpu" in command:
            return 0, "0, NVIDIA RTX, 92, 18842, 24576, 67, 302.14\n", ""
        return 0, "1234, python, 18600\n", ""

    monkeypatch.setattr(training_preflight, "run_wsl", fake_run)

    payload, status = training_runner.gpu_status_response()

    assert status == 200
    assert payload["gpu"]["available"] is True
    assert payload["gpu"]["gpus"] == [{
        "index": "0", "name": "NVIDIA RTX", "utilization": "92", "memoryUsed": "18842",
        "memoryTotal": "24576", "temperature": "67", "powerDraw": "302.14",
    }]
    assert payload["gpu"]["processes"] == [{"pid": "1234", "name": "python", "memoryUsed": "18600"}]
    assert len(commands) == 2
    assert all(kwargs["distribution"] == "Ubuntu_W" for _, kwargs in commands)

def test_gpu_snapshot_reports_unavailable_without_raising(monkeypatch):
    monkeypatch.setattr(training_preflight, "configured_training_settings", lambda: {"wslDistribution": "Ubuntu_W"})
    monkeypatch.setattr(training_preflight, "run_wsl", lambda *args, **kwargs: (127, "", "nvidia-smi not found"))

    payload, status = training_runner.gpu_status_response()

    assert status == 200
    assert payload["gpu"]["available"] is False
    assert payload["gpu"]["gpus"] == []
    assert payload["gpu"]["error"] == "nvidia-smi not found"

def test_invalid_training_toml_is_a_job_local_preflight_blocker(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    (folder / "auto_dataset").mkdir(parents=True)
    (folder / "config.lo.toml").write_text("not valid toml = [\n", encoding="utf-8")
    (folder / "dataset.lo.toml").write_text("[[directory]]\npath = '/data'\n", encoding="utf-8")
    for name in ("config.hi.toml", "dataset.hi.toml"):
        (folder / name).write_text("value = 1\n", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(training_preflight, "resolve_folder", lambda value: ("set", folder))
    monkeypatch.setattr(training_preflight, "configured_training_settings", lambda: {"cwd": "/pipe", "wslDistribution": ""})
    monkeypatch.setattr(training_preflight, "wsl_executable", lambda: "wsl.exe")

    _, _, _, _, checks = training_preflight.build_launch_preflight("set", "lo")
    failed = [item for item in checks if not item["ok"]]

    assert [item["id"] for item in failed] == ["training_toml"]
    assert "config.lo.toml" in failed[0]["details"]

def test_krea_preflight_accepts_mixed_manifest_when_generated_dataset_is_image_only(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    auto_dataset = folder / "auto_dataset"
    auto_dataset.mkdir(parents=True)
    (folder / "config.krea2.toml").write_text("[model]\ntype = 'krea2'\n", encoding="utf-8")
    (folder / "dataset.train.toml").write_text(
        "[[directory]]\npath = '/images'\ngroup = 'images'\n",
        encoding="utf-8",
    )
    (auto_dataset / "prep_manifest.json").write_text(
        json.dumps({
            "images": [{"prepared_path": "square_img/image.png", "caption": True}],
            "videos": [{"prepared_path": "169/clip.mp4", "caption": True}],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(training_preflight, "resolve_folder", lambda value: ("set", folder))
    monkeypatch.setattr(
        training_preflight,
        "configured_training_settings",
        lambda: training_runtime_settings({"diffusion_pipe_wsl": "/pipe"}),
    )
    monkeypatch.setattr(training_preflight, "wsl_executable", lambda: "wsl.exe")
    monkeypatch.setattr(
        training_preflight,
        "wsl_check",
        lambda check_id, severity, settings, command, message: training_preflight.make_check(
            check_id, severity, True, message
        ),
    )

    _, _, _, _, checks = training_preflight.build_preflight("set", "krea2")

    assert not [item for item in checks if item["severity"] == "blocker" and not item["ok"]]
    assert "krea2_image_only" not in [item["id"] for item in checks]


def test_h3_preflight_requires_h3_config_and_shared_dataset(tmp_path):
    folder = tmp_path / "set"
    auto_dataset = folder / "auto_dataset"
    auto_dataset.mkdir(parents=True)
    (folder / "config.h3.toml").write_text("[model]\ntype = 'minimax_h3'\n", encoding="utf-8")
    (folder / "dataset.train.toml").write_text("[[directory]]\npath = '/data'\n", encoding="utf-8")
    (auto_dataset / "prep_manifest.json").write_text("{}", encoding="utf-8")

    artifacts, missing = training_preflight.resolve_artifacts("set", folder, "h3")

    assert missing == []
    assert artifacts["h3Config"].name == "config.h3.toml"
    assert artifacts["trainDataset"].name == "dataset.train.toml"
