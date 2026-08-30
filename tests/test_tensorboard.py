import pytest

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_runner


class FakeResponse:
    def __init__(self, text):
        self.text = text.encode("utf-8")

    def read(self, size):
        return self.text[:size]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_tensorboard_config_defaults_and_validation():
    base = {
        "filesystem": {"root": "C:/training", "models": ""},
        "training": {"enabled_profiles": ["wan22_t2v"]},
    }
    normalized = app_config.validate_config_payload(base)

    assert normalized["training"]["tensorboard_port"] == 6006
    assert normalized["training"]["tensorboard_bruteforce_control"] is False

    base["training"]["tensorboard_port"] = 7007
    base["training"]["tensorboard_bruteforce_control"] = True
    normalized = app_config.validate_config_payload(base)
    assert normalized["training"]["tensorboard_port"] == 7007
    assert normalized["training"]["tensorboard_bruteforce_control"] is True

    base["training"]["tensorboard_port"] = 0
    with pytest.raises(ValueError, match="tensorboard_port"):
        app_config.validate_config_payload(base)
    base["training"]["tensorboard_port"] = 6006.5
    with pytest.raises(ValueError, match="tensorboard_port"):
        app_config.validate_config_payload(base)
    base["training"]["tensorboard_port"] = 6006
    base["training"]["tensorboard_bruteforce_control"] = "yes"
    with pytest.raises(ValueError, match="tensorboard_bruteforce_control"):
        app_config.validate_config_payload(base)


def test_tensorboard_probe_requires_tensorboard_identity(monkeypatch):
    monkeypatch.setattr(training_runner.urllib.request, "urlopen", lambda *args, **kwargs: FakeResponse("<title>TensorBoard</title>"))
    assert training_runner._probe_tensorboard(6006) == (True, "")

    monkeypatch.setattr(training_runner.urllib.request, "urlopen", lambda *args, **kwargs: FakeResponse("<title>Other app</title>"))
    running, diagnostic = training_runner._probe_tensorboard(6006)
    assert running is False
    assert "did not identify" in diagnostic


def test_tensorboard_control_is_disabled_without_opt_in(monkeypatch):
    monkeypatch.setattr(training_runner.app_config, "config", {"training": {"tensorboard_port": 6006}})
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: pytest.fail("WSL must not run while control is disabled"))

    payload, status = training_runner.tensorboard_control_response("start")

    assert status == 403
    assert payload["ok"] is False


def test_tensorboard_control_route_accepts_only_an_action():
    response = app_module.app.test_client().post(
        "/fs/training_runner/tensorboard/control",
        json={"action": "start", "port": 6006},
    )

    assert response.status_code == 400
    assert "requires only an action" in response.get_json()["error"]


def test_tensorboard_process_scan_and_termination_are_exact(monkeypatch):
    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        return (0, "412\n913\n", "") if "/proc/" in command else (0, "", "")

    monkeypatch.setattr(training_runner, "_run_wsl", fake_run)
    settings = {"wslDistribution": "Ubuntu_W"}
    pids = training_runner._tensorboard_matching_pids(settings, "/mnt/w/training/output/runs")
    training_runner._terminate_tensorboard_pids(settings, pids)

    assert pids == ["412", "913"]
    assert "target_logdir=/mnt/w/training/output/runs" in commands[0]
    assert "--logdir" in commands[0]
    assert "pkill" not in commands[1]
    assert "kill -TERM" in commands[1]
    assert "kill -KILL" in commands[1]


def test_tensorboard_start_uses_global_runs_root_and_not_client_input(tmp_path, monkeypatch):
    commands = []
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(training_runner.app_config, "config", {
        "training": {"tensorboard_port": 6011, "tensorboard_bruteforce_control": True},
    })
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {
        "activate": "/env/bin/activate",
        "condaExecutable": "",
        "condaEnvironment": "",
        "wslDistribution": "Ubuntu_W",
    })
    monkeypatch.setattr(training_runner, "_localhost_port_occupied", lambda port: False)
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution: "/mnt/w/" + path.name)
    monkeypatch.setattr(training_runner, "_ensure_runtime_dirs", lambda: None)
    monkeypatch.setattr(training_runner, "_wait_for_tensorboard", lambda port, timeout: (True, ""))
    monkeypatch.setattr(training_runner, "_tensorboard_status_payload", lambda: {"running": True, "port": 6011, "url": "http://localhost:6011", "controlEnabled": True, "diagnostic": ""})

    def fake_run(command, **kwargs):
        commands.append((command, kwargs))
        return 0, "", ""

    monkeypatch.setattr(training_runner, "_run_wsl", fake_run)
    payload, status = training_runner.tensorboard_control_response("start")

    assert status == 200
    assert payload["ok"] is True
    assert len(commands) == 1
    assert "tensorboard --logdir /mnt/w/runs --port 6011" in commands[0][0]
    assert commands[0][1]["distribution"] == "Ubuntu_W"
