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


def test_training_history_keeps_metadata_index_and_clear_controls():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'Training History' in html
    assert 'training-history-clear-btn' in html
    assert '>Clear All History</button>' in html
    assert 'data-training-history-clear' in script
    assert 'function clearTrainingHistory()' in script
    assert 'clearTrainingHistoryJob(clearId)' in workspace
    assert '/fs/training_history/clear' in app
    assert '/fs/training_history/job/clear' in app


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



def test_metadata_backed_training_history_contract():
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")

    assert 'RECENT_RUNS_FILE_NAME = "recent_runs.json"' in history
    assert "def _write_recent_runs(" in history
    record = history[history.index("def record_job("):history.index("def history_payload(")]
    assert "_write_recent_runs(recent)" in record
    assert "def _managed_job_record_paths(" not in history
    assert "def _job_records(" not in history
    assert "record_job(folder_path, job)" in runner
    assert "clear_history_job" in runner
    assert "historyHidden" in runner
