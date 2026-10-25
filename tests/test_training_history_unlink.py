"""History-only removal must not affect artifacts or active training ownership."""

from tool.server import app as app_module
from tool.server import config as app_config
from tool.server import training_history


def test_history_remove_unlists_only_target_and_preserves_same_output_files(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(app_config, "training_history_state_path", lambda: tmp_path / ".state" / "recent_runs.json")
    folder = tmp_path / "sets" / "subject"
    folder.mkdir(parents=True)
    run_dir = tmp_path / "output" / "runs" / "shared"
    checkpoint = run_dir / "global_step10"
    checkpoint.mkdir(parents=True)
    (run_dir / "latest").write_text("global_step10\n", encoding="utf-8")
    (checkpoint / "weights.dat").write_bytes(b"still-here")
    log = tmp_path / "training.log"
    log.write_text("still here", encoding="utf-8")

    for identifier in ("paused-attempt", "continued-attempt"):
        training_history.record_job(folder, {
            "id": identifier, "folder": "sets/subject", "stages": "h3",
            "status": "stopped", "outputRunPath": str(run_dir), "logPath": str(log),
        })
    client = app_module.app.test_client()
    response = client.post("/fs/training_history/job/remove", json={
        "folder": "sets/subject", "jobId": "paused-attempt",
    })
    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "removedHistory": 1}
    remaining = training_history.read_history(folder)["jobs"]
    assert [job["id"] for job in remaining] == ["continued-attempt"]
    assert (checkpoint / "weights.dat").read_bytes() == b"still-here"
    assert (run_dir / "latest").read_text(encoding="utf-8") == "global_step10\n"
    assert log.read_text(encoding="utf-8") == "still here"

    missing = client.post("/fs/training_history/job/remove", json={
        "folder": "sets/subject", "jobId": "paused-attempt",
    })
    assert missing.status_code == 404
    assert [job["id"] for job in training_history.read_history(folder)["jobs"]] == ["continued-attempt"]


def test_history_remove_requires_exact_record_target():
    client = app_module.app.test_client()
    response = client.post("/fs/training_history/job/remove", json={"folder": "", "jobId": ""})
    assert response.status_code == 400
    assert "Folder and Training History job ID" in response.get_json()["error"]
