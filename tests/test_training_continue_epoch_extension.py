"""Filesystem-only regression checks for captured Training History continuation."""

from pathlib import Path

import pytest

from tool.server import training_runner


def test_continue_prompts_near_target_without_mutating_capture(tmp_path, monkeypatch):
    original = tmp_path / "original.toml"
    original.write_text("epochs = 100\n", encoding="utf-8")
    run = tmp_path / "run"
    run.mkdir()
    (run / "latest").write_text("epoch97\n", encoding="utf-8")
    (run / "epoch97").mkdir()
    monkeypatch.setattr(training_runner, "host_path_for_training_path", lambda _: run)
    monkeypatch.setattr(training_runner, "_validated_resume_checkpoint", lambda *_: None)
    bundle = {"artifacts": {"h3Config": str(original)}}

    prompt = training_runner._history_continue_epoch_plan(bundle, "h3", "checkpoint")
    assert prompt == {
        "epochExtensionRequired": True, "lastEpoch": 97,
        "plannedEpochs": 100, "remainingEpochs": 3,
    }

    planned = training_runner._history_continue_epoch_plan(
        bundle, "h3", "checkpoint", requested_epochs=140,
    )
    assert planned == {"epochs": 140, "capturedEpochs": 100}
    assert original.read_text(encoding="utf-8") == "epochs = 100\n"

    with pytest.raises(ValueError, match="must exceed"):
        training_runner._history_continue_epoch_plan(
            bundle, "h3", "checkpoint", requested_epochs=100,
        )


def test_continue_rewrites_only_new_job_config(tmp_path):
    original = tmp_path / "capture.toml"
    original.write_text("epochs = 100\n", encoding="utf-8")
    job_dir = tmp_path / "new-job"
    job_dir.mkdir()
    job = {
        "artifactDir": str(job_dir),
        "snapshot": {"h3": str(original)},
        "bundleArtifacts": {"h3Config": str(original)},
        "progressPlan": {"h3": {"epochs": 100, "estimatedSteps": 800}},
        "trainingSettings": {},
        "runSummary": {},
    }

    training_runner._apply_history_continue_epoch_plan(job, "h3", 140, 100)
    copied = Path(job["snapshot"]["h3"])
    assert copied.parent == job_dir
    assert copied.read_text(encoding="utf-8").startswith("epochs = 140")
    assert original.read_text(encoding="utf-8") == "epochs = 100\n"
    assert job["bundleArtifacts"]["h3Config"] == str(copied)
    assert job["continueEpochs"] == 140
    assert job["progressPlan"]["h3"]["estimatedSteps"] == 1120
