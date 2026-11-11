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


def test_training_history_has_separate_safe_unlink_and_destructive_delete():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")

    assert "Training History" in html
    assert 'id="training-history-clear-btn"' not in html
    assert 'data-training-history-clear="' not in script
    assert "function clearTrainingHistory()" not in script
    assert "clearTrainingHistoryJob(" not in workspace
    assert '@app.route("/fs/training_history/clear"' not in app
    assert '@app.route("/fs/training_history/job/clear"' not in app
    assert "def clear_history(folder_path=None)" not in history
    assert "def clear_history_job(" in history
    assert 'data-training-history-remove="' in script
    assert '/fs/training_history/job/remove' in script
    assert '@app.route("/fs/training_history/job/remove"' in app
    assert "training_clear_history_job(" in app
    assert 'data-training-history-delete="' in script
    assert 'data-training-history-finalize="' in script


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
    assert "archive_run_session_cleanup_status" in backend
    assert 'path.name != ".webcap"' in backend
    assert "saveFolderStateForCurrentRoot()" not in script


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



def test_h3_training_history_recovers_image_shift_and_focused_blocks(tmp_path):
    import json
    from tool.server import training_history
    from tool.server.training_config_files import H3_FOCUSED_EXCLUDE_MODULES

    captured = tmp_path / "capture"
    captured.mkdir()

    def captured_summary(extra="", include_image_shift=True):
        config = (
            '[model]\n'
            'diffusion_model = "/models/standard_h3.safetensors"\n'
            'cfg = 4\nshift = 8\n'
            + ('image_shift = 1.5\n' if include_image_shift else '')
            + '[adapter]\ntype = "lora"\n' + extra
        )
        (captured / "config.h3.toml").write_text(config, encoding="utf-8")
        return training_history.run_summary_from_capture(captured, "h3")

    normal = captured_summary()
    assert normal["shift"] == 8
    assert normal["imageShift"] == 1.5
    assert normal["focusedH3Blocks"] is False

    focused = captured_summary("exclude_modules = " + json.dumps(H3_FOCUSED_EXCLUDE_MODULES) + "\n")
    assert focused["focusedH3Blocks"] is True

    old_job = {
        "stages": "h3", "recordPath": str(captured), "folder": "",
        "runSummary": {"trainingVariant": "CFG", "shift": 8},
    }
    viewed = training_history._history_job_view(old_job)
    assert viewed["runSummary"]["focusedH3Blocks"] is True
    assert viewed["runSummary"]["imageShift"] == 1.5
    assert "focusedH3Blocks" not in old_job["runSummary"]

    custom = captured_summary("exclude_modules = " + json.dumps(r"^blocks\.0") + "\n")
    assert "focusedH3Blocks" not in custom

    legacy = captured_summary(include_image_shift=False)
    assert "imageShift" not in legacy
    assert legacy["focusedH3Blocks"] is False


def test_training_history_labels_h3_image_shift_and_focused_blocks():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    assert "trainingHistoryMetric('Image shift'" in script
    assert "trainingHistoryMetric('Focused H3 blocks'" in script
    assert "'Video shift'" in script
    assert "typeof runConfig.focusedH3Blocks === 'boolean'" in script


def test_metadata_backed_training_history_contract():
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")

    assert 'RECENT_RUNS_FILE_NAME = "recent_runs.json"' in history
    assert "def _write_recent_runs(" in history
    record = history[history.index("def record_job("):history.index("def history_payload(")]
    assert "_write_recent_runs(recent)" in record
    assert "record_job(folder_path, job)" in runner
    assert "clear_history_job" in runner
    assert "historyHidden" not in runner



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
    assert 'isinstance(merged, list)' in history
    assert 'def _h3_uses_premerged_image_adapter(' in history
    assert 'def _h3_uses_image_adapter(' in history
    assert 'h3_fields = ("trainingVariant", "imageShift", "focusedH3Blocks")' in history


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


def test_h3_image_adapter_resume_is_inherited_not_selectable():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    review = (ROOT / "tool" / "js" / "training_review.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "training_runner.py").read_text(encoding="utf-8")
    assert 'id="training-run-h3-adapter-inherited"' in html
    assert "h3MethodOption.classList.toggle('hidden', stage !== 'h3')" in review
    assert "h3AdapterCheckbox.disabled = resumeH3" in review
    assert "h3AdapterCheckbox.indeterminate = resumeH3" in review
    assert "savedVariant === 'on' || savedVariant === 'legacy'" in review
    assert "savedVariant === 'off'" in review
    assert 'data-h3-method=' in history
    assert 'id="training-run-h3-method"' in html
    assert "data-image-adapter=" in history
    assert "if (usingResume) { delete settings.h3ImageTrainingAdapter; delete settings.h3TrainingMethod; }" in runner
    assert "Start a fresh run to change this variant" in backend


def test_training_history_groups_only_known_physical_run_identity():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    assert 'item["physicalRunKey"]' in history
    assert 'function trainingHistoryGroupJobs(jobs)' in script
    assert "job.physicalRunKey" in script
    assert "['output', String(job.folder || ''), physical]" in script
    assert "['job', String(job.folder || ''), String(job.id || index)]" in script
    assert "group.jobs.some(function (job) { return trainingHistoryMatchesSearch(job, searchText); })" in script
    assert 'data-training-history-group="' in script
    assert "trainingHistoryOpenGroups[group.key]" in script
    assert "var visibleGroups = trainingWorkspaceState.historyExpanded ? groups : groups.slice(0, 2)" in script
    assert "(!groupedAttempt ? '<button type=\"button\" data-training-history-delete=" in script


def test_training_archive_unlinks_only_attempts_sharing_physical_output():
    archive = (ROOT / "tool" / "server" / "training_archive.py").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "server" / "training_history.py").read_text(encoding="utf-8")
    assert 'physical_key = str(run_dir.resolve(strict=False))' in archive
    assert 'str(job.get("physicalRunKey") or "") == physical_key' in archive
    assert 'history_ids = [context["jobId"]] + [job["id"] for job in context["relatedRuns"]]' in archive
    assert 'clear_history_jobs(set_folder, history_ids)' in archive
    assert 'def clear_history_jobs(folder_path, job_ids):' in history


def test_history_prefers_captured_lr_and_displays_rank_in_both_views():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    assert "function trainingHistoryLearningRate(job)" in script
    assert "return formatTrainingRunLearningRate(summary.lr);" in script
    assert "return String(job && job.progress && job.progress.lr || '').trim();" in script
    assert "var learningRate = trainingHistoryLearningRate(job);" in script
    assert "trainingHistoryMetric('LR', learningRate)" in script
    assert "trainingHistoryMetric('Rank', Number(runConfig.rank) > 0" in script
    assert "var currentLr = trainingHistoryLearningRate(representative);" in script
    assert "training-history-group-setting" in script
    assert "var currentRank = Number(currentSettings.rank);" in script
    assert "currentDropout" in script


def test_older_partial_history_summary_recovers_each_attempt_config(tmp_path):
    from tool.server import training_history

    def make_capture(name, lr, rank):
        directory = tmp_path / name
        directory.mkdir()
        (directory / "config.h3.toml").write_text(
            'epochs = 100\n'
            '[model]\n'
            'diffusion_model = "/models/h3.safetensors"\n'
            'cfg = 1\n'
            'shift = 8\n'
            'image_shift = 1\n'
            '[adapter]\n'
            'type = "lora"\n'
            'rank = ' + str(rank) + '\n'
            'dropout = 0.1\n'
            '[optimizer]\n'
            'lr = ' + str(lr) + '\n',
            encoding="utf-8",
        )
        return directory

    first = make_capture("first", 0.0001, 16)
    resumed = make_capture("resumed", 0.0002, 32)
    base = {"stages": "h3", "folder": "", "runSummary": {"shift": 8}, "progress": {"lr": "0.00009"}}
    earlier = training_history._history_job_view({**base, "recordPath": str(first)})
    later = training_history._history_job_view({**base, "recordPath": str(resumed)})
    assert earlier["runSummary"]["lr"] == 0.0001
    assert earlier["runSummary"]["rank"] == 16
    assert later["runSummary"]["lr"] == 0.0002
    assert later["runSummary"]["rank"] == 32
    assert earlier["runSummary"]["dropout"] == later["runSummary"]["dropout"] == 0.1
    assert earlier["runSummary"]["epochs"] == later["runSummary"]["epochs"] == 100
    assert earlier["progress"]["lr"] == later["progress"]["lr"] == "0.00009"
    assert base["runSummary"] == {"shift": 8}


def test_history_hides_only_redundant_finished_early_receipts():
    script = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    progress = (ROOT / "tool" / "server" / "training_progress.py").read_text(encoding="utf-8")
    assert "function trainingHistoryCompletionNote(job)" in script
    assert "job.status === 'finished_early'" in script
    assert "var completionNote = trainingHistoryCompletionNote(job);" in script
    assert "(completionNote ? '<div class=" in script
    assert 'job["completionNote"] = "Finished early"' in progress
    assert "trainingHistoryMetric('Dropout'" in script
    assert "return note === generated ? '' : note;" in script
    assert "var stepOpensCheckpoint = canOpenCheckpointRun && checkpointStepMatch" in script
    assert "stepOpensCheckpoint ? 'data-training-history-run=" in script
    assert "(stepOpensCheckpoint ? '' : trainingHistoryMetric(" in script
