from tool.server import training_runtime


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
