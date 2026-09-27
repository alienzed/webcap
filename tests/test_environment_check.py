from tool.server import environment_check


def test_environment_report_stops_training_checks_when_runtime_path_missing(monkeypatch):
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: "wsl.exe")
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: "/usr/bin/" + name if name in {"ffmpeg", "ffprobe", "deface"} else None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(environment_check.importlib.util, "find_spec", lambda name: object())

    report = environment_check.build_environment_report({"training": {}})

    assert report["ok"] is True
    assert report["summary"]["core"]["ready"] is True
    assert report["summary"]["training"]["ready"] is False
    failed = {item["id"] for item in report["checks"] if not item["ok"]}
    assert "training_cwd_configured" in failed
    assert "training_python" not in {item["id"] for item in report["checks"]}


def test_environment_report_flags_partial_conda_configuration(monkeypatch):
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: "wsl.exe")
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(environment_check.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(environment_check, "_training_shell", lambda *args, **kwargs: (0, "", ""))

    report = environment_check.build_environment_report({
        "training": {
            "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
            "conda_executable": "/home/user/miniconda3/bin/conda",
            "conda_environment": "",
        }
    })

    failed = {item["id"] for item in report["checks"] if not item["ok"]}
    assert "training_conda_config" in failed


def test_environment_report_surfaces_training_versions(monkeypatch):
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: "wsl.exe")
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: "/usr/bin/" + name if name in {"ffmpeg", "ffprobe", "deface"} else None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(environment_check.importlib.util, "find_spec", lambda name: object())

    def fake_training_shell(settings, command):
        if "sys.version" in command:
            return 0, '{"version":"3.12.4","executable":"/env/bin/python"}\n', ""
        if "import json,torch" in command:
            return 0, '{"torch":"2.12.0","cuda_build":"13.0","cuda_available":true,"device_count":1,"devices":["RTX 5090"]}\n', ""
        if "nvidia-smi" in command:
            return 0, "NVIDIA RTX 5090, 590.00, 32607\n", ""
        if "--version" in command:
            return 0, "0.17.6\n", ""
        return 0, "", ""

    monkeypatch.setattr(environment_check, "_training_shell", fake_training_shell)

    report = environment_check.build_environment_report({
        "training": {
            "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
        }
    })

    checks = {item["id"]: item for item in report["checks"]}
    assert checks["training_python"]["ok"] is True
    assert "3.12.4" in checks["training_python"]["details"]
    assert checks["training_torch_cuda"]["ok"] is True
    assert "torch 2.12.0" in checks["training_torch_cuda"]["details"]
    assert "RTX 5090" in checks["training_torch_cuda"]["details"]
