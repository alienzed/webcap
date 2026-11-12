from tool.server import training_runtime
from types import SimpleNamespace

import pytest


@pytest.mark.parametrize("distribution", ["", "Ubuntu_W"])
def test_windows_training_keeps_wsl_and_selected_distribution(monkeypatch, distribution):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        return SimpleNamespace(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(training_runtime, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(training_runtime, "wsl_executable", lambda: "wsl.exe")
    monkeypatch.setattr(training_runtime.subprocess, "run", run)
    assert training_runtime.run_wsl("nvidia-smi", distribution=distribution) == (0, "ok", "")
    expected = ["wsl.exe"]
    if distribution:
        expected += ["--distribution", distribution]
    assert calls == [expected + ["--", "bash", "-lc", "nvidia-smi"]]


def test_training_runtime_h3_split_cache_phase_defaults_false_and_maps_true():
    assert training_runtime.training_runtime_settings({})["h3SplitCachePhase"] is False
    assert training_runtime.training_runtime_settings({"h3_split_cache_phase": True})["h3SplitCachePhase"] is True


def test_wsl_path_conversion_keeps_existing_wsl_paths(monkeypatch):
    monkeypatch.setattr(training_runtime, "run_wsl", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("wslpath should not run")))

    assert training_runtime.to_wsl_path("/mnt/w/training/config.hi.toml", "Ubuntu_W") == "/mnt/w/training/config.hi.toml"

def test_native_wsl_runner_uses_the_current_bash_shell(monkeypatch):
    captured = {}

    class Result:
        returncode = 0
        stdout = "ok"
        stderr = ""

    def fake_run(args, **kwargs):
        captured["args"] = args
        return Result()

    monkeypatch.setattr(training_runtime.os, "name", "posix")
    monkeypatch.setattr(training_runtime.subprocess, "run", fake_run)

    assert training_runtime.run_wsl("echo ok", distribution="Ubuntu_W") == (0, "ok", "")
    assert captured["args"] == ["bash", "-lc", "echo ok"]
