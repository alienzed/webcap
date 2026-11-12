import subprocess
from types import SimpleNamespace

import pytest

from tool.server import app as app_module


def test_system_status_queries_host_without_training_runtime(monkeypatch, tmp_path):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return SimpleNamespace(stdout='0, "NVIDIA, GPU", 3, 1201, 16380, 42, 19.5\n')

    def training_probe():
        pytest.fail("Host telemetry must not query the training environment")

    monkeypatch.setattr(app_module.subprocess, "run", run)
    monkeypatch.setattr(app_module, "training_runner_gpu_status_response", training_probe)
    monkeypatch.setattr(app_module, "_system_ram_status", lambda: {"available": True})
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    with app_module.app.test_client() as client:
        response = client.get("/fs/system_status")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["gpu"]["available"] is True
    assert payload["gpu"]["gpus"] == [{
        "index": "0", "name": "NVIDIA, GPU", "utilization": "3", "memoryUsed": "1201",
        "memoryTotal": "16380", "temperature": "42", "powerDraw": "19.5",
    }]
    assert payload["ram"]["available"] is True
    assert payload["disk"]["available"] is True
    assert len(calls) == 1
    assert calls[0][0][0] == "nvidia-smi"
    assert calls[0][1]["timeout"] == 5
    assert calls[0][1]["check"] is True


@pytest.mark.parametrize("failure,detail", [
    (FileNotFoundError("nvidia-smi is not installed"), "not installed"),
    (subprocess.CalledProcessError(9, "nvidia-smi", stderr="NVIDIA driver communication failed"),
     "NVIDIA driver communication failed"),
    (subprocess.TimeoutExpired("nvidia-smi", 5), "timed out"),
])
def test_missing_or_failed_host_telemetry_preserves_other_system_status(monkeypatch, tmp_path, failure, detail):
    def run(*args, **kwargs):
        raise failure

    monkeypatch.setattr(app_module.subprocess, "run", run)
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(app_module, "_system_ram_status", lambda: {"available": True})
    with app_module.app.test_client() as client:
        response = client.get("/fs/system_status")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["gpu"]["available"] is False
    assert payload["gpu"]["gpus"] == []
    assert detail in payload["gpu"]["error"]
    assert payload["ram"]["available"] is True
    assert payload["disk"]["available"] is True
