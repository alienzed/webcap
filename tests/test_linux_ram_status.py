import io
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from tool.server import app as app_module


def test_linux_ram_counts_reclaimable_cache_as_available(monkeypatch):
    monkeypatch.setattr(app_module, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(app_module.sys, "platform", "linux")
    data = "MemTotal:       32768000 kB\nMemFree:          200000 kB\nMemAvailable:   18000000 kB\nCached:         15000000 kB\n"
    with patch("builtins.open", return_value=io.StringIO(data)) as opened:
        ram = app_module._system_ram_status()
    opened.assert_called_once_with("/proc/meminfo", encoding="utf-8")
    assert ram == {"available": True, "total": 32768000 * 1024,
                   "used": (32768000 - 18000000) * 1024,
                   "free": 18000000 * 1024}


@pytest.mark.parametrize("content", [
    "MemTotal: 12000 kB\nMemFree: 100 kB\n",
    "MemTotal: 12000 kB\nMemAvailable: garbage kB\n",
    "MemTotal: 12000 kB\nMemAvailable: 13000 kB\n",
])
def test_linux_ram_rejects_incomplete_or_invalid_meminfo(monkeypatch, content):
    monkeypatch.setattr(app_module, "os", SimpleNamespace(name="posix"))
    monkeypatch.setattr(app_module.sys, "platform", "linux")
    with patch("builtins.open", return_value=io.StringIO(content)):
        with pytest.raises((OSError, ValueError)):
            app_module._system_ram_status()
