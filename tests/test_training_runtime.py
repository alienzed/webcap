from tool.server import training_runtime


def test_training_set_permission_repair_uses_wsl_directory_and_file_modes(tmp_path, monkeypatch):
    commands = []
    monkeypatch.setattr(training_runtime, "to_wsl_path", lambda path, distribution: "/mnt/d/training/set")
    monkeypatch.setattr(
        training_runtime,
        "run_wsl",
        lambda command, timeout, distribution: commands.append((command, timeout, distribution)) or (0, "", ""),
    )

    error = training_runtime.repair_training_set_permissions(tmp_path / "set", "Mint")

    assert error == ""
    assert commands == [(
        "chmod 775 -- /mnt/d/training/set && find /mnt/d/training/set -type d -exec chmod 775 {} + && find /mnt/d/training/set -type f -exec chmod 664 {} +",
        120,
        "Mint",
    )]

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
