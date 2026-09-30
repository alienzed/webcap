from tool.server import environment_check


def _stub_optional_probes(monkeypatch):
    monkeypatch.setattr(environment_check.inference_runtime, "system_stats", lambda: {"system": {"os": "test"}, "devices": []})
    monkeypatch.setattr(environment_check, "_http_json", lambda *args, **kwargs: {"data": []})


def test_environment_report_stops_training_checks_when_runtime_path_missing(monkeypatch):
    _stub_optional_probes(monkeypatch)
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
    _stub_optional_probes(monkeypatch)
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
    _stub_optional_probes(monkeypatch)
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


def test_environment_report_groups_optional_capabilities(monkeypatch):
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: None)
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: "/usr/bin/" + name if name in {"ffmpeg", "ffprobe", "deface", "llama-server"} else None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(environment_check.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(environment_check.inference_runtime, "system_stats", lambda: {"system": {"os": "Windows"}, "devices": [{"name": "RTX 5090"}]})

    report = environment_check.build_environment_report({
        "filesystem": {"models": "C:\\models"},
        "storyboard": {"director": {"mode": "local"}},
        "training": {},
    })

    assert report["summary"]["inference"]["ready"] is True
    assert report["summary"]["director"]["ready"] is True
    assert report["summary"]["optional_analysis"]["ready"] is True
    checks = {item["id"]: item for item in report["checks"]}
    assert checks["inference_comfyui"]["group"] == "inference"
    assert checks["package_websocket"]["group"] == "inference"
    assert checks["package_websocket"]["required"] is False
    assert checks["director_llama_server"]["ok"] is True
    assert checks["package_mediapipe"]["group"] == "optional_analysis"
    assert checks["package_imageio"]["group"] == "optional_analysis"


def test_environment_report_remote_director_failure_is_group_local(monkeypatch):
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: None)
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: "/usr/bin/" + name if name in {"ffmpeg", "ffprobe"} else None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(environment_check.importlib.util, "find_spec", lambda name: object())
    monkeypatch.setattr(environment_check.inference_runtime, "system_stats", lambda: (_ for _ in ()).throw(ConnectionError("offline")))
    monkeypatch.setattr(environment_check, "_http_json", lambda *args, **kwargs: (_ for _ in ()).throw(ConnectionError("remote offline")))

    report = environment_check.build_environment_report({
        "storyboard": {"director": {"mode": "remote", "endpoint": "http://director.example/v1"}},
        "training": {},
    })

    assert report["ok"] is True
    assert report["summary"]["director"]["ready"] is False
    assert report["summary"]["inference"]["ready"] is False
    checks = {item["id"]: item for item in report["checks"]}
    assert "remote offline" in checks["director_remote_endpoint"]["details"]


def test_optional_package_guidance_points_to_diagnostics_repair(monkeypatch):
    _stub_optional_probes(monkeypatch)
    monkeypatch.setattr(environment_check, "uses_native_wsl_shell", lambda: False)
    monkeypatch.setattr(environment_check, "wsl_executable", lambda: None)
    monkeypatch.setattr(environment_check.shutil, "which", lambda name: "/usr/bin/" + name if name in {"ffmpeg", "ffprobe"} else None)
    monkeypatch.setattr(environment_check, "_host_command", lambda *args, **kwargs: (0, "pip 25", ""))
    monkeypatch.setattr(
        environment_check.importlib.util,
        "find_spec",
        lambda name: None if name in {"mediapipe", "imageio"} else object(),
    )

    report = environment_check.build_environment_report({"training": {}})
    checks = {item["id"]: item for item in report["checks"]}

    assert checks["package_mediapipe"]["required"] is False
    assert "Diagnostics > Health > Install / Repair Python Requirements" in checks["package_mediapipe"]["guidance"]
    assert checks["package_imageio"]["required"] is False
    assert report["summary"]["optional_analysis"]["ready"] is True
