from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_training_history_promotes_recorded_epoch_and_step_progress():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    progress = (ROOT / "tool" / "server" / "training_progress.py").read_text(encoding="utf-8")

    assert "details.push('Epoch '" in script
    assert "details.push('Step '" in script
    assert "details.push('LR '" in script
    assert 'progress["plannedSteps"] = planned_steps' in progress
    assert 'progress["lr"] = learning_rate_matches[-1].strip()' in progress


def test_training_history_has_no_index_only_clear_or_remove_controls():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'Training History' in html
    assert 'Recent Runs' not in html
    assert 'training-history-clear-btn' not in html
    assert 'data-training-history-clear' not in script
    assert 'clearTrainingHistory' not in script
    assert 'data-training-history-clear' not in workspace
    assert '/fs/training_history/clear' not in app
    assert '/fs/training_history/job/clear' not in app


def test_training_history_offers_curve_analysis_for_an_available_resume_run():
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")

    assert 'item["candidateRunAvailable"]' in history
    assert 'job.candidateRunAvailable' in script


def test_training_history_loads_timing_for_completed_and_finished_early_rows():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")

    assert "['completed', 'finished_early']" in script
    assert "visibleJobs.forEach(function (job)" in script
    assert "loadTrainingHistoryMetrics(job);" in script
    assert "trainingHistoryFact('Finished', formatTrainingHistoryTime(job.finishedAt))" in script


def test_queued_resumes_show_checkpoint_progress_and_remaining_work():
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")

    assert "buildQueuedResumePointHtml(queuedJob)" in runner
    assert "' epochs remaining'" in runner
    assert "' steps remaining'" in runner
    assert "def _populate_queued_resume_point" in backend
    assert 'job["resumePoint"] = resume_point' in backend
    assert "_populate_queued_resume_point(job)" in backend


def test_training_history_shows_captured_run_settings_and_short_unnamed_identity():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")

    assert "trainingHistoryRunSummary(job)" in script
    assert "'dropout '" in script
    assert "'shift '" in script
    assert "' items'" in script
    assert "'Run ' + sequence" in script
    assert "def run_summary_from_capture" in history
    assert 'summary["lr"]' in history
    assert 'summary["dropout"]' in history
    assert 'summary["shift"]' in history



def test_folder_backed_training_history_contract():
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")

    assert 'JOB_RECORD_FILE_NAME = "job.json"' in history
    assert "def _write_job_record(" in history
    assert "def _job_records_for_actions(" in history
    assert "managed_actions_for_folder(folder)" in history
    assert "managed_actions()" in history
    assert "_write_recent_runs(recent)" not in history[history.index("def record_job("):history.index("def history_payload(")]
    assert "record_job(folder_path, job)" in runner
    assert "clear_history_job" not in runner
    assert "historyHidden" not in runner
