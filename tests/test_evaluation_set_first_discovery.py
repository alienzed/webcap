"""Set-owned managed checkpoint recovery without Training queue/history indexes."""
import pytest
from tool.server import training_runner


def _action(tmp_path, jobs=("saved-job",), outputs=("run",)):
    action_root = tmp_path / "001-action"
    for name in outputs:
        folder = action_root / "output" / name / "epoch12"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "model.safetensors").write_bytes(b"saved")
    return action_root, {
        "actionId": "set/001-action", "folder": "sets/example",
        "runName": "Set H3", "requestedStages": ["h3"],
        "jobs": {"h3": [{"id": job} for job in jobs]}, "candidateRevision": 1,
    }


def test_managed_checkpoint_resolves_original_job_after_history_cleared(tmp_path, monkeypatch):
    action = _action(tmp_path)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda _: tmp_path)
    monkeypatch.setattr(training_runner, "managed_actions_for_folder", lambda _: [action])
    monkeypatch.setattr(training_runner, "_read_state_readonly", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "_find_history_job", lambda *_: None)
    monkeypatch.setattr(training_runner, "_candidate_staged_run_snapshot_for_job",
                        lambda *_: pytest.fail("No staged Test LoRA is required"))
    raw, run = training_runner._candidate_run_snapshot("sets/example", "saved-job")
    assert raw == str(action[0] / "output" / "run")
    assert run["id"] == "saved-job"
    assert run["stages"] == "h3"
    assert training_runner._candidate_safetensors_path(
        "sets/example", "saved-job", 12
    ).name == "model.safetensors"


def test_managed_checkpoint_refuses_ambiguous_job_or_output(tmp_path, monkeypatch):
    action = _action(tmp_path, jobs=("saved-job", "resumed-job"))
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda _: tmp_path)
    monkeypatch.setattr(training_runner, "managed_actions_for_folder", lambda _: [action])
    assert training_runner._candidate_managed_run_snapshot_for_job(
        "sets/example", "saved-job"
    ) is None

    action = _action(tmp_path, outputs=("run", "revision"))
    monkeypatch.setattr(training_runner, "managed_actions_for_folder", lambda _: [action])
    assert training_runner._candidate_managed_run_snapshot_for_job(
        "sets/example", "saved-job"
    ) is None


def test_managed_checkpoint_does_not_cross_sets(tmp_path, monkeypatch):
    action_root, action = _action(tmp_path)
    action["folder"] = "sets/elsewhere"
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda _: tmp_path)
    monkeypatch.setattr(training_runner, "managed_actions_for_folder",
                        lambda _: [(action_root, action)])
    assert training_runner._candidate_managed_run_snapshot_for_job(
        "sets/example", "saved-job"
    ) is None
