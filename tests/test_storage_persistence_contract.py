"""Prevent browser persistence and retired global filesystem roots."""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_frontend_avoids_localstorage():
    files = sorted((ROOT / "tool" / "js").glob("*.js")) + [ROOT / "tool" / "tool.html"]
    assert files
    for file in files:
        source = re.sub(r"/\*.*?\*/", "", file.read_text(encoding="utf-8"), flags=re.DOTALL)
        lines = [str(i) for i, line in enumerate(source.splitlines(), 1)
                 if re.search(r"\blocalStorage\b", line) and not line.lstrip().startswith("//")]
        assert not lines, f"{file.relative_to(ROOT)} uses localStorage at {', '.join(lines)}"


def test_retired_global_paths_are_not_reintroduced():
    config = (ROOT / "tool/server/config.py").read_text(encoding="utf-8")
    training = (ROOT / "tool/server/training_runner.py").read_text(encoding="utf-8")
    bench = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    assert "def training_runtime_root(" not in config
    assert "def _jobs_root(" not in training
    assert "def _artifact_root(" not in training
    assert ' / ".webcap" / "jobs"' not in training
    assert "def _legacy_central_session_root(" not in bench
    assert ' / ".webcap" / TEST_RESULTS_DIR' not in bench


def test_training_requires_recorded_job_artifacts(tmp_path, monkeypatch):
    from tool.server import training_runner

    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    owned = tmp_path / "output/runs/example/jobs/job-1"
    assert training_runner._job_dir({"id": "job-1", "artifactDir": str(owned)}) == owned
    with pytest.raises(RuntimeError, match="no recorded artifact directory"):
        training_runner._job_dir({"id": "legacy"})
    assert not (tmp_path / ".webcap_training").exists()
    assert not (tmp_path / ".webcap").exists()
