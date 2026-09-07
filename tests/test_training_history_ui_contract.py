from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_recent_runs_promotes_recorded_epoch_and_step_progress():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    progress = (ROOT / "tool" / "server" / "training_progress.py").read_text(encoding="utf-8")

    assert "details.push('Epoch '" in script
    assert "details.push('Step '" in script
    assert 'progress["plannedSteps"] = planned_steps' in progress
