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



def test_training_history_surfaces_selected_epoch_as_completed_decision_state():
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'item["selectedEpoch"] = selected_run_epoch' in history
    assert "var selectedEpoch = job.selectedEpoch" in script
    assert "'Selected Epoch ' + Math.round(selectedEpochNumber).toLocaleString()" in script
    assert "has-selected-epoch" in script
    assert "training-history-selected-mark" in script
    assert ".training-history-item.has-selected-epoch" in css

def test_training_history_exposes_finalize_and_archive_lifecycle():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_archive.py").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'data-training-history-tab="history"' in html
    assert 'data-training-history-tab="archive"' in html
    assert 'id="training-archive-modal"' in html
    assert 'data-training-history-finalize="' in script
    assert '">Archive</button>' in script
    assert "openTrainingArchiveModal(" in workspace
    assert "/fs/training_archive/preview" in app
    assert "/fs/training_archive/finalize" in app
    assert "Selected epoch has no recorded production LoRA" in backend
    assert "retainedAlternateEpochs" in backend
    assert "removedStagedCandidates" in backend
    assert "removedTestSessions" in backend
    assert "testCleanupWarning" in backend
    assert "setMarkerWarning" in backend
    assert "archive_run_session_cleanup_status" in backend
    assert 'path.name != ".webcap"' in backend
    assert "set_last_training_archive" in backend
    assert "saveFolderStateForCurrentRoot()" not in script
    assert "archive.setMarkerWarning" in script


def test_finalize_archive_uses_staged_candidate_folder_as_retention_truth_and_surfaces_legacy_archive_errors():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_archive.py").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert '"availableAlternateCandidates": alternates' in backend
    assert 'payload.get("sourceEpoch")' in backend
    assert "Requested retained epoch is not present in the staged candidate folder" in backend
    assert '"invalid": True' in backend
    assert '"Archive is missing webcap-run.json."' in backend
    assert "Archive issue" in script
    assert "preview.availableAlternateCandidates" in script
    assert "candidate.fileName" in script
    assert "No staged candidate LoRAs available to retain." in script
    assert "preview.testSessionCount" in script
    assert "Finalized and archived, but Archive refresh failed:" in script
    assert ".training-archive-alternate small" in css


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
    assert "record_job(folder_path, job)" in runner
    assert "clear_history_job" in runner
    assert "historyHidden" in runner



def test_training_archive_lazily_surfaces_selected_epoch_loss_context():
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_archive.py").read_text(encoding="utf-8")
    state = (ROOT / "tool" / "js" / "training_workspace_state.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "/fs/training_archive/metrics" in app
    assert "def archive_metrics(" in backend
    assert "read_loss_events" in backend
    assert '"lossReductionPercent"' in backend
    assert '"recentLossChangePercent"' in backend
    assert '"trainingSecondsToSelected"' in backend
    assert '"selectedEpochSeconds"' in backend
    assert "archiveMetrics: {}" in state
    assert "loadTrainingArchiveMetrics" in script
    assert "trainingArchiveLossChart" in script
    assert 'data-training-archive-details="' in script
    assert "archiveList.onclick" in workspace
    assert ".training-archive-analysis" in css


def test_checkpoint_picker_groups_previous_saved_resume_points():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")

    assert 'Previous saved resumable points' in script
    assert 'data-checkpoint-tag=' in script
    assert "resumeCheckpointTag" in runner


def test_history_continue_epoch_extension_is_job_scoped():
    runner = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")

    assert "def _history_continue_epoch_plan(" in runner
    assert "target - observed_epoch <= 5" in runner
    assert "def _apply_history_continue_epoch_plan(" in runner
    assert 'job["bundleArtifacts"][stage + "Config"] = str(copied)' in runner
    assert 'job["snapshot"][stage] = str(copied)' in runner
    assert '"continueEpochs"' in history
    assert 'continue_epochs=data.get("continueEpochs")' in app
    assert "window.prompt(" in script
    assert "continueEpochs: epochs" in script
    assert "parentJobId: job.id" in script


def test_h3_image_checkpoint_marker_uses_recorded_model_identity():
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")

    assert "function trainingH3ImageModelLabel(job)" in runner
    assert "job.stages !== 'h3'" in runner
    assert "minimax_h3_fl2va_pruned_int8_convrot_image_adapter_fused.safetensors" in runner
    assert "trainingH3ImageModelLabel(queuedJob)" in runner
    assert "trainingH3ImageModelLabel(job)" in runner
    assert "trainingH3ImageModelLabel(job)" in history
    assert "Premerged H3 image-training checkpoint" in history
    assert '"source": source' in backend


def test_training_history_identifies_custom_named_runs_and_recorded_h3_variant():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")

    assert "runDisplayName !== 'Run ' + runSequence" in script
    assert "job.id || runIdentity" not in script
    assert "escapeHtml(runIdentityLabel)" in script
    assert "runConfig.trainingVariant" in script
    assert '"trainingVariant"' in history
    assert '"minimax_h3_image_training_adapter.safetensors"' in history
    assert 'isinstance(merged_adapters, list)' in history
    assert 'model_source == merged_source' in history
    assert '"trainingVariant" not in item["runSummary"]' in history


def test_image_adapted_indicator_is_visible_in_history_queue_and_active_run():
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function trainingH3ImageModelIconHtml()" in runner
    assert 'class="training-image-adapter-icon"' in runner
    assert "trainingH3ImageModelIconHtml() + escapeHtml(imageModelLabel)" in runner
    assert "trainingVariant === 'Image Adapter' ? trainingH3ImageModelIconHtml()" in history
    assert "trainingH3ImageModelIconHtml() + escapeHtml(imageModelLabel)" in history
    assert ".training-image-adapter-icon" in css


def test_h3_variant_classifies_only_recognized_image_adapter(tmp_path, monkeypatch):
    from tool.server import training_history

    monkeypatch.setattr(training_history, "h3_premerged_image_model_path",
                        lambda: "/models/minimax_h3_fl2va_pruned_int8_convrot_image_adapter_fused.safetensors")
    capture = tmp_path / "capture"
    capture.mkdir()

    def variant(checkpoint, adapters=None):
        lines = ['[model]', 'diffusion_model = "' + checkpoint + '"']
        if adapters is not None:
            lines.append('merge_adapters = [' + ', '.join('"' + value + '"' for value in adapters) + ']')
        (capture / "config.h3.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
        return training_history.run_summary_from_capture(capture, "h3")["trainingVariant"]

    regular = "/models/standard_h3.safetensors"
    fused = "/models/minimax_h3_fl2va_pruned_int8_convrot_image_adapter_fused.safetensors"
    image_adapter = "/models/adapters/minimax_h3_image_training_adapter.safetensors"
    assert variant(regular) == "Standard"
    assert variant(fused) == "Image Adapter"
    assert variant(regular, [image_adapter]) == "Image Adapter"
    assert variant(regular, ["/models/adapters/unrelated.safetensors"]) == "Standard"
    assert variant(regular, []) == "Standard"


def test_training_history_hides_internal_job_id_and_redundant_run_number():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")

    assert "runDisplayName !== 'Run ' + runSequence" in script
    assert "runIdentityLabel ? '<span" in script
    assert "job.id || runIdentity" not in script
    assert "escapeHtml(runIdentity)" not in script
    assert "job.runName, job.sequence" in script
