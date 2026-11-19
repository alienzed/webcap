from types import SimpleNamespace

from tool.server import app as app_module


def test_macos_ram_uses_sysctl_and_vm_stat(monkeypatch):
    monkeypatch.setattr(app_module.sys, "platform", "darwin")
    responses = iter([
        SimpleNamespace(returncode=0, stdout=str(16 * 1024 ** 3) + "\n", stderr=""),
        SimpleNamespace(
            returncode=0,
            stdout=(
                "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
                "Pages free:                               100000.\n"
                "Pages active:                             500000.\n"
                "Pages inactive:                           200000.\n"
                "Pages speculative:                         50000.\n"
            ),
            stderr="",
        ),
    ])
    monkeypatch.setattr(app_module.subprocess, "run", lambda *args, **kwargs: next(responses))

    ram = app_module._system_ram_status()

    expected_free = 350000 * 16384
    assert ram == {
        "available": True,
        "total": 16 * 1024 ** 3,
        "used": 16 * 1024 ** 3 - expected_free,
        "free": expected_free,
    }


def test_system_status_measures_nearest_existing_disk_and_labels_apple_gpu(tmp_path, monkeypatch):
    missing_root = tmp_path / "sets" / "not-created-yet"
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", missing_root)
    monkeypatch.setattr(app_module.sys, "platform", "darwin")
    monkeypatch.setattr(app_module.os, "uname", lambda: SimpleNamespace(machine="arm64"))
    monkeypatch.setattr(app_module, "_system_ram_status", lambda: {
        "available": True, "total": 100, "used": 40, "free": 60,
    })
    monkeypatch.setattr(
        app_module,
        "training_runner_gpu_status_response",
        lambda: (_ for _ in ()).throw(AssertionError("macOS must not poll nvidia-smi")),
    )
    measured = {}

    def disk_usage(path):
        measured["path"] = path
        return SimpleNamespace(total=1000, used=400, free=600)

    monkeypatch.setattr(app_module.shutil, "disk_usage", disk_usage)

    payload = app_module.app.test_client().get("/fs/system_status").get_json()

    assert measured["path"] == tmp_path
    assert payload["disk"]["available"] is True
    assert payload["disk"]["path"] == str(missing_root)
    assert payload["disk"]["measuredPath"] == str(tmp_path)
    assert payload["gpu"]["unsupported"] is True
    assert payload["gpu"]["label"] == "Apple GPU"
