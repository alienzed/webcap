from tool.server import training_runtime


def test_configured_training_root_permission_repair_uses_full_root(monkeypatch):
    commands = []
    monkeypatch.setattr(training_runtime.app_config, "FS_ROOT", r"W:\training")
    monkeypatch.setattr(
        training_runtime.app_config,
        "config",
        {"training": {"wsl_distribution": "Ubuntu_W"}},
    )
    monkeypatch.setattr(training_runtime, "to_wsl_path", lambda path, distribution: "/mnt/w/training")
    monkeypatch.setattr(
        training_runtime,
        "run_wsl",
        lambda command, timeout, distribution: commands.append((command, timeout, distribution)) or (0, "", ""),
    )

    error = training_runtime.repair_configured_training_root_permissions()

    assert error == ""
    assert commands == [(
        "chmod -R 775 -- /mnt/w/training",
        600,
        "Ubuntu_W",
    )]


def test_configured_training_root_permission_repair_reports_failure(monkeypatch):
    monkeypatch.setattr(training_runtime.app_config, "FS_ROOT", r"W:\training")
    monkeypatch.setattr(training_runtime, "to_wsl_path", lambda path, distribution: "/mnt/w/training")
    monkeypatch.setattr(
        training_runtime,
        "run_wsl",
        lambda command, timeout, distribution: (1, "", "chmod: Permission denied"),
    )

    error = training_runtime.repair_configured_training_root_permissions()

    assert error == "Could not restore training-root permissions: chmod: Permission denied"


def test_boot_critical_permission_repair_targets_root_and_runtime_directory(monkeypatch):
    commands = []
    monkeypatch.setattr(training_runtime.app_config, "FS_ROOT", r"W:\training")
    monkeypatch.setattr(
        training_runtime.app_config,
        "config",
        {"training": {"wsl_distribution": "Ubuntu_W"}},
    )
    monkeypatch.setattr(training_runtime, "to_wsl_path", lambda path, distribution: "/mnt/w/training")
    monkeypatch.setattr(
        training_runtime,
        "run_wsl",
        lambda command, timeout, distribution: commands.append((command, timeout, distribution)) or (0, "", ""),
    )

    error = training_runtime.repair_boot_critical_training_permissions()

    assert error == ""
    assert commands == [(
        "chmod 775 -- /mnt/w/training && if [ -e /mnt/w/training/.webcap_training ]; then chmod -R 775 -- /mnt/w/training/.webcap_training; fi",
        30,
        "Ubuntu_W",
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
