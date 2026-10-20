def test_epoch_save_modal_is_shared_by_candidates_and_test_generations():
    candidates = (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")
    tests = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function openEpochSaveModal(context)" in candidates
    assert "window.openEpochSaveModal = openEpochSaveModal" in candidates
    assert "/fs/training_candidates/save" in candidates
    assert "keepLoraState.destination" in candidates
    assert "window.openEpochSaveModal({" in tests
    assert "candidateMetadata" in tests
    assert "stagedFileName: fileName" in tests
    assert "keepLoraState.stagedFileName" in candidates
    assert "keep-lora-modal" in html
    assert "keep-lora-filename" in html
    assert "keep-lora-folders" in html
    assert ".keep-lora-dialog" in css
    assert "Save &amp; Select" in html


from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_test_settings_use_comfy_dimensions_choices():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert '<select id="test-generations-dimensions"></select>' in html
    assert "payload.settingOptions && Array.isArray(payload.settingOptions.dimensions)" in script
    assert "dimensions.value = selectedDimensions" in script


def test_base_model_selector_stays_available_and_reprepares_test_workspace():
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "modelSelect.disabled = navigation.activity === 'test'" not in shell
    assert "Select the Base Model for Test Generations" in shell
    assert "if (isOpen()) openPane();" in script
    assert "Test Generations is not available for the selected Base Model." in script


def test_test_generations_guards_shared_working_model_dependency():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert html.index('src="/static/js/working_context.js"') < html.index('src="/static/js/test_generations.js"')
    assert "typeof window.getWorkingModelProfileId !== 'function'" in script
    assert "return String(window.getWorkingModelProfileId() || '');" in script
    assert "return supportedTestModelIds.indexOf(currentTestModelId()) !== -1;" in script
    assert "modelId: getWorkingModelProfileId()" not in script
    assert "String(getWorkingModelProfileId() || '')" not in script


def test_test_seed_uses_shared_32_bit_range():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-seed" type="number" min="0" max="4294967295"' in html
    assert "var values = new Uint32Array(1);" in script
    assert "return values[0];" in script


def test_test_wildcard_tagline_is_required_app_wiring():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-wildcard-tagline"' in html
    assert "if (!wildcardTagline) throw new Error('Test wildcard tagline is missing.');" in script


def test_test_results_header_promotes_view_tabs_without_legacy_rate_action():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'class="test-generations-view-tabs" role="tablist"' in html
    assert 'id="test-generations-view-grid-btn"' in html
    assert 'id="test-generations-view-compare-btn"' in html
    assert 'class="test-generations-results-actions"' not in html
    assert "grid-template-columns: minmax(0, 1fr) auto auto;" in css
    assert ".test-generations-view-tab.active" in css
    assert "border-bottom-color: var(--accent);" in css
    assert "setAttribute('aria-selected'" in script


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    for control in ("test-generations-pane", "test-generations-prompt",
                    "test-generations-run-btn", "test-generations-inline-count",
                    "test-generations-inline-auto-vl", "test-generations-results",
                    "test-generations-sessions-list", "test-generations-files-count"):
        assert f'id="{control}"' in html
    assert "card.dataset.resultKey = resultKey" in script
    assert "host.insertBefore(card, pending || null)" in script
    assert "placeholder.textContent = 'Generation failed';" in script
    assert "function renderResults(status)" in script
    assert ".test-generations-result-card video" in css
    assert ".test-generations-result-card img" in css

def test_test_generation_previews_keep_stable_width_and_natural_height():
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    results_rule = css.split(".test-generations-results {", 1)[1].split("}", 1)[0]
    assert "display: grid;" in results_rule
    assert "grid-template-columns: repeat(auto-fill, 500px);" in results_rule
    assert "grid-auto-rows: max-content;" in results_rule
    video_rule = css.split(".test-generations-result-card video,\n.test-generations-result-card img {", 1)[1].split("}", 1)[0]
    assert "width: 100%;" in video_rule
    assert "height: auto;" in video_rule

def test_test_generations_uses_explicit_workspace_root():
    shell_css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="test-generations-workspace"' in html
    assert ".app-frame.workspace-test-open > .app" in shell_css
    assert ".app-frame.workspace-test-open > .test-generations-workspace" in shell_css
    assert "grid-area: workspace;" in shell_css


def test_test_generations_does_not_mutate_underlying_workspace_surface():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    open_block = script.split("function openPane()", 1)[1].split("function startRun", 1)[0]
    assert "frame.classList.add('workspace-test-open');" in open_block
    assert "node.classList.remove('hidden');" in open_block
    assert "setWorkspaceSurface(" not in open_block


def test_test_generations_does_not_refresh_hidden_training_history_after_save():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    save_block = script.split("window.openEpochSaveModal({", 1)[1].split("});", 1)[0]
    assert "refreshStagedFilesAfterCandidates().catch(showError);" in save_block
    assert "refreshTrainingHistory" not in save_block


def test_test_navigation_uses_global_set_context_and_local_run_choice():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="app-header-set-select"' in html
    assert "function setApplicationSetContext(folder)" in shell
    assert "fetch('/fs/training_history/all')" in shell
    assert "status !== 'completed' && status !== 'finished_early'" in shell
    assert "label=\"Recent Sets\"" in shell
    assert "label=\"Training History\"" in shell
    assert "!historySeen[item.folder]" in shell
    assert "rememberShellRecentSet(targetFolder);" in shell
    assert "window.rememberApplicationSetContext = rememberShellRecentSet" in shell
    assert "window.prepareTestBenchSetSwitch(targetFolder);" in shell
    assert "window.setApplicationSetContext(targetFolder);" in script
    assert "openTrainingWorkspaceFolder(targetFolder);" not in script
    assert "function openCandidateRunMenu(button)" in script
    assert "if (runs.length === 1)" in script
    assert "showContextMenu(rect.left, rect.bottom + 4, runs.map" in script
    candidate_click = script.split("el('test-generations-candidates-btn').onclick", 1)[1].split("};", 1)[0]
    assert "event.stopPropagation();" in candidate_click
    assert "catch (err) { showError(err); }" in candidate_click
    prompts_click = script.split("el('test-generations-recent-prompts-btn').onclick", 1)[1].split("};", 1)[0]
    assert "event.stopPropagation();" in prompts_click


def test_test_prompt_can_reuse_recent_session_prompt_without_switching_set():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert 'id="test-generations-recent-prompts-btn"' in html
    assert "function openRecentPromptsMenu(button)" in script
    assert "Array.isArray(testActivity.recentPrompts)" in script
    recent = script.split("function applyRecentPrompt(item)", 1)[1].split("function openRecentPromptsMenu", 1)[0]
    assert "saveTestBenchState();" in recent
    assert "openPane()" not in recent
    assert "No recent Test prompts yet." in script

def test_recent_set_group_tracks_loaded_set_contexts():
    ui = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")
    assert "isSetFolderContext(path, state.items)" in ui
    assert "window.rememberApplicationSetContext(path);" in ui


def test_test_activity_is_permanent_and_recent_sets_are_not_in_the_test_pane():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="activity-test-btn" type="button" class="activity-rail-btn"' in html
    assert "activityButton.classList.remove('hidden');" in script



def test_test_activity_primary_click_uses_current_set_unless_target_is_explicit():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    block = script.split("function openTestBenchActivity(target)", 1)[1].split("function openTestBenchActivityMenu", 1)[0]
    assert "if (target.folder || target.modelId)" in block
    assert "openTestBenchSet(String(target.folder || ''), String(target.modelId || ''));" in block
    assert "if (isOpen())" in block
    assert "openPane();" in block

    pane = script.split("function openPane()", 1)[1].split("function startRun()", 1)[0]
    assert "launchFolder = owningSetFolder((state && state.folder) || '');" in pane

def test_test_generation_archive_lifecycle_is_visible_and_clearable():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    folder_state = (ROOT / "tool" / "js" / "folder_state.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert 'id="test-generations-clear-sessions-btn"' in html
    assert "function clearTestSessions()" in script
    assert "request('test_clear_sessions', {})" in script
    assert "function forgetTrackedTestSessions(folder, sessionName)" in script
    assert "delete trackedTestInferenceSessions[key];" in script
    assert "webcap:test-sessions-cleared" in script
    assert "function lastTrainingArchiveText()" in script
    assert "state.lastTrainingArchive" in script
    assert "last_training_archive" in folder_state
    assert 'operation == "test_clear_sessions"' in backend
    assert "def clear_sessions(folder_path):" in backend


def test_test_generation_sessions_and_candidate_removal_contract():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    assert "test-generations-sessions-list" in script
    assert "test_open_session" in script
    assert "test_delete_session" in script
    assert "function removeCandidate(fileName, sessionName)" in script
    assert "session: String(sessionName || '')" in script
    assert "function removeCurrentSessionCandidate(button)" in script
    removal = script.split("function removeCurrentSessionCandidate(button)", 1)[1].split("function bindUi()", 1)[0]
    assert "if (!confirmed) return;" in removal
    assert "removeCandidate(candidateFile, currentSession)" in removal
    assert removal.index("if (!confirmed) return;") < removal.index("removeCandidate(candidateFile, currentSession)")
    assert "window.confirm(" in removal
    assert "row.dataset.sessionName = name;" in script
    assert "row.dataset.queueJobId = jobId;" in script
    assert ".test-generations-session-row" in css
    assert ".test-generations-session-progress" in css

def test_session_list_groups_running_queue_then_finished():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderSessions(sessions, queuedJobs)", 1)[1].split("function refreshSessions()", 1)[0]
    assert "var order = { running: 0, queued: 1, history: 2 };" in block
    assert 'group.dataset.sessionGroup = key;' in block
    assert "function ensureGroup(key, label, count, className)" in block
    assert "function ensureRow(key)" in block
    assert "if (row) return row;" in block
    assert "host.insertBefore(group, next);" in block

def test_running_session_progress_uses_processed_over_total_and_updates_live():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    render_block = script.split("function renderSessions(sessions, queuedJobs)", 1)[1].split("function refreshSessions()", 1)[0]
    sync_block = script.split("function syncVisibleSessionProgress(status)", 1)[1].split("function renderSessions", 1)[0]

    assert "var processed = Math.max(0, completed + failed);" in render_block
    assert "processed / total * 100" in render_block
    assert "progress.className = 'test-generations-session-progress';" in render_block
    assert "progress.setAttribute('role', 'progressbar');" in render_block
    assert "var processed = Math.max(0, completed + failed);" in sync_block
    assert "fill.style.width = percent.toFixed(1) + '%';" in sync_block


def test_active_session_row_surfaces_live_elapsed_time():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    block = script.split("function sessionStatusText(session)", 1)[1].split("function syncVisibleSessionProgress", 1)[0]

    assert "session.candidateStartedAt || session.startedAt" in block
    assert "formatElapsedMs(Date.now() - startedAt)" in block

def test_active_session_row_uses_live_polled_progress():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "function sessionStatusText(session)" in script
    block = script.split("function syncVisibleSessionProgress(status)", 1)[1].split("function renderSessions", 1)[0]
    assert "meta.textContent = sessionStatusText(status);" in block
    assert "progress.setAttribute('aria-valuenow', String(processed));" in block
    assert "if (fill) fill.style.width = percent.toFixed(1) + '%';" in block
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "syncVisibleSessionProgress(status || {});" in render

def test_test_generations_persists_only_against_its_current_set():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "currentSession = String(status.session || '')" in script
    assert "function owningSetFolder(folder)" in script
    assert "launchFolder = owningSetFolder((state && state.folder) || '')" in script
    assert "folder: owningSetFolder(launchFolder || (state && state.folder) || '')" in script
    assert "window.closeTestBenchActivity = closePane" in script
    assert "String(state.folder || '') !== String(launchFolder || '')" in script
    assert "function stagedFileParts(fileName)" in script
    assert "function sessionLabel(sessionName)" in script
    assert "function syncSessionSelection()" in script

def test_test_generations_compare_mode_reuses_current_session_results():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-view-grid-btn" in script
    assert "test-generations-view-compare-btn" in script
    assert "function setResultsView(mode)" in script
    assert "function renderCompare(status)" in script
    assert "var pair = [results[compareIndex], results[compareIndex + 1]];" in script
    assert "compareIndex = Math.max(0, compareIndex - 1);" in script
    assert "compareIndex = Math.min(Math.max(0, results.length - 2), compareIndex + 1);" in script
    assert "function syncCompareVideos(videos)" in script
    assert "video.addEventListener('play'" in script
    assert "video.addEventListener('pause'" in script
    assert "video.addEventListener('seeked'" in script
    assert "video.addEventListener('ratechange'" in script
    assert "function buildResultFooter(result, options)" in script
    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    result_block = script.split("function renderResults(status)", 1)[1].split("function syncActiveRunControls(status)", 1)[0]
    assert "var remove = buildResultRemoveButton(result);" in compare_block
    assert "if (remove) item.appendChild(remove);" in compare_block
    assert "var remove = buildResultRemoveButton(result);" in result_block
    assert "if (remove) card.appendChild(remove);" in result_block
    assert "var remove = buildResultRemoveButton(failure);" in result_block
    assert "remove.dataset.removeCandidate = candidateFile" in script
    assert ".test-generations-compare-stage" in css
    assert "grid-template-columns: repeat(2, minmax(0, 1fr));" in css




def test_test_bench_activity_rail_and_live_session_contract():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="activity-test-btn"' in html
    assert "function refreshActivityButton()" in script
    assert "function openTestBenchActivity(target)" in script
    assert "window.testGenerationsFolderLoaded = testGenerationsFolderLoaded" in script
    assert "window.refreshTestBenchActivity = refreshActivityButton" in script
    controls = script.split("function syncActiveRunControls(status)", 1)[1].split("var TEST_PROMPT_COLOR_SWATCHES", 1)[0]
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCount || !supported;" in controls
    assert "Queue Test sessions." in controls
    assert "function syncVisibleSessionProgress(status)" in script
    assert "function pollStatus()" in script

def test_selected_test_session_is_preview_only_and_does_not_restore_working_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    selection = script.split("function selectSessionStatus(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "renderStatus(status);" in selection
    assert "test-generations-prompt" not in selection
    assert "test-generations-aspect" not in selection
    assert "test-generations-megapixels" not in selection
    assert "test-generations-duration" not in selection
    assert "test-generations-dimensions" not in selection
    assert "selectedCandidates" not in selection
    assert "setWorkingModelProfileId" not in selection
    assert "saveTestBenchState" not in selection
    assert "saveTestPromptDraft" not in selection
    assert "status.sourcePrompt" not in selection


def test_selected_test_session_rehydrates_across_navigation_and_queue_handoff():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "var currentSessionFolder = '';" in script
    assert "var currentSessionModel = '';" in script
    open_pane = script.split("function openPane()", 1)[1].split("function testRunCriteria()", 1)[0]
    assert "currentSessionFolder === launchFolder" in open_pane
    assert "currentSessionModel === requestedModelId" in open_pane
    assert "request('test_open_session', { session: currentSession })" in open_pane
    assert "request('test_open_session', { session: sessionToOpen })" in open_pane
    assert "if (generation !== openGeneration || !isOpen()) return;" in open_pane
    assert "function selectSessionStatus(status)" in script

def test_test_polling_keeps_active_worker_status_separate_from_selected_preview():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]
    assert "syncActiveRunControls(status);" in poll
    assert "if (currentSession === activeSession)" in poll
    assert "else if (selectedPreviewLive)" in poll
    assert "renderStatus(selectedStatus);" in poll
    assert "selectSessionStatus(" not in poll
    assert "testStatusHasPendingWork(currentStatus)" in poll
    assert "refreshActivityButtonIfDue(15000);" in poll
    assert "refreshSessionsIfDue(10000).catch(showError);" in poll
    assert "pollTimer = setTimeout(pollStatus, 4000);" in poll

def test_test_preview_polling_survives_inter_job_queued_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    helper = script.split("function testStatusHasPendingWork(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "'starting', 'queued', 'running', 'stopping'" in helper
    assert "total > processed" not in helper

    open_session = script.split("function openSession(sessionName)", 1)[1].split("function deleteSession(sessionName)", 1)[0]
    assert "if (testStatusHasPendingWork(status)) pollStatus();" in open_session


def test_active_test_card_is_separate_from_selected_session_results():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-sessions-list"' in html
    assert 'id="test-generations-results"' in html
    assert 'id="test-generations-status"' in html
    assert "function syncVisibleSessionProgress(status)" in script
    assert "function syncActiveRunControls(status)" in script
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "statusEl.textContent = live ? '' : statusText(status);" in render
    assert "renderResults(status || {});" in render

def test_live_test_status_surfaces_comfy_job_progress_and_errors_to_console():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function formatElapsedMs(milliseconds)" in script
    assert "function liveStatusDetails(status)" in script
    assert "formatInferenceProgress(status.progress)" in script
    assert "Comfy ' + comfyStatus" in script
    assert "Job ' + jobId.slice(0, 8)" in script
    assert "candidateStartedAt || status.startedAt" in script
    assert "comfyLastContactAt" in script
    assert "liveStatusDetails(status)" in script
    assert "reportConsoleError('Test Generations', err);" in script


def test_failed_test_cards_report_to_global_console_once():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var reportedFailureKeys = new Set();" in script
    assert "if (!reportedFailureKeys.has(diagnosticKey))" in script
    assert "reportedFailureKeys.add(diagnosticKey);" in script
    assert "reportConsoleError(" in script
    assert "failure.error || 'Generation failed.'" in script


def test_test_prepare_warnings_reach_global_console():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "Array.isArray(payload.warnings)" in script
    assert "reportConsoleWarning('Test Generations', warning);" in script


def test_global_console_reports_text_safely_and_marks_attention():
    script = (ROOT / "tool/js/console_panel.js").read_text(encoding="utf-8")
    assert "div.textContent = '[' + timestamp + '] ' + String(msg);" in script
    assert "div.innerHTML" not in script
    assert "function reportConsoleError(source, err)" in script
    assert "function reportConsoleWarning(source, message)" in script
    assert "markConsoleAttention(true)" in script

def test_test_result_footer_identity_timing_and_remove_contract():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function candidateIdentity(result)" in script
    assert "provenance.sourceRunSequence" in script
    assert "provenance.sourceEpoch" in script
    assert "provenance.sourceRevision" in script
    assert "identity.push('Rev ' + revision)" in script
    assert "replace(/-r\\d+$/i, '')" in script
    assert "Run ' + String(runSequence).padStart(2, '0')" in script
    assert "Epoch ' + String(epoch).trim()" in script
    assert "sourceFile.match(/^(.*)__epoch(\\d+)\\.safetensors$/i)" in script
    assert "(?:run[-_]?)?(\\d+)$" in script
    assert "primary: 'Base', secondary: ''" in script
    assert "function formatCandidateElapsed(milliseconds)" in script
    assert "if (!isFinite(value) || value < 0) return '';" in script
    assert "return hours + 'h ' + minutes + 'm';" in script
    assert "return minutes + 'm ' + seconds + 's';" in script
    assert "return seconds + 's';" in script
    assert "opts.failed ? 'Failed after ' + elapsed : elapsed" in script
    assert "source.title = identity.secondary;" in script
    assert "function buildResultRemoveButton(result)" in script
    assert "remove.textContent = '×';" in script
    assert "Remove this staged candidate and its result from this session." in script
    assert "secondaryRow.className = 'test-generations-result-secondary';" in script
    assert ".test-generations-result-source" in css
    assert ".test-generations-result-elapsed" in css
    assert ".test-generations-result-secondary" in css
    assert ".test-generations-result-remove" in css
    assert "position: absolute;" in css


def test_test_result_stars_are_shared_by_grid_and_compare():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "function buildResultRating(result, sessionName)" in script
    assert "function rateTestResult(button)" in script
    assert "function syncResultRatingButtons(sessionName, mediaFile, rating)" in script
    assert "request('test_rate_result'" in script
    assert "star.dataset.testSession = session;" in script
    assert "var rating = buildResultRating(result, opts.sessionName);" in script
    assert "star.textContent = value <= currentRating ? '★' : '☆';" in script
    assert "if (!opts.failed)" in script

    footer_block = script.split("function buildResultFooter(result, options)", 1)[1].split("function formatTestVideoTime", 1)[0]
    assert "secondaryRow.appendChild(rating);" in footer_block

    grid_handler = script.split("el('test-generations-results').onclick", 1)[1].split("el('test-generations-compare').onclick", 1)[0]
    compare_handler = script.split("el('test-generations-compare').onclick", 1)[1].split("el('test-generations-prompt').addEventListener", 1)[0]
    assert "rateTestResult(rating);" in grid_handler
    assert "rateTestResult(rating);" in compare_handler

    assert ".test-generations-result-rating" in css
    assert ".test-generations-result-star" in css
    assert '@app.route("/fs/folder_state/rating", methods=["POST"])' in backend


def test_history_mutations_do_not_replace_another_models_prepared_candidates():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "String(payload.modelId || '') === String(prepared.modelId || '')" in script


def test_test_rating_refresh_preserves_preview_dom():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    sync_block = script.split("function syncResultRatingButtons(sessionName, mediaFile, rating)", 1)[1].split("function rateTestResult(button)", 1)[0]
    assert "document.querySelectorAll" in sync_block
    assert "star.classList.toggle('active', active);" in sync_block
    assert "star.textContent = active ? '★' : '☆';" in sync_block

    rate_block = script.split("function rateTestResult(button)", 1)[1].split("function buildResultFooter", 1)[0]
    assert "var sessionName = String(button && button.dataset.testSession || '').trim();" in rate_block
    assert "request('test_rate_result'" in rate_block
    assert "syncResultRatingButtons(sessionName, mediaFile, payload && payload.rating);" in rate_block
    assert "request('test_rating_summary'" in rate_block


def test_result_card_transport_remains_always_visible_without_toggle():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    transport = script.split("function appendTestPreviewVideo(container, video)", 1)[1].split("function setResultsView(mode)", 1)[0]
    assert "video.controls = false;" in transport
    assert "container.appendChild(transport);" in transport


def test_compare_polling_preserves_video_elements_and_refreshes_navigation_only():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    assert "var compareKey = sessionName + '|'" in block
    assert "host.dataset.compareKey = compareKey;" in block
    assert "host.querySelector('.test-generations-compare-stage')" in block
    assert "existingPrevious.disabled = compareIndex <= 0;" in block
    assert "existingNext.disabled = compareIndex >= results.length - 2;" in block
    assert "existingPosition.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);" in block
    assert block.index("if (String(host.dataset.compareKey || '') === compareKey") < block.index("host.innerHTML = '';")
    assert "if (resultsView === 'compare') renderCompare(status || {});" in script

def test_compare_videos_start_muted():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    preview_block = script.split("function appendTestPreview(container, sessionName, result, options)", 1)[1].split("function candidateFileForResult", 1)[0]
    assert "appendTestPreview(item, sessionName, result, { muted: true })" in compare_block
    assert "video.muted = !!(options && options.muted);" in preview_block



def test_test_bench_shows_frozen_session_metadata_separately_from_next_run():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    assert 'id="test-generations-session-info-btn"' in html
    assert 'id="test-generations-session-details"' in html
    assert 'id="test-generations-prompt"' in html
    assert "function sessionMetaText(status)" in script
    assert "function renderSessionMeta(status)" in script
    meta = script.split("function renderSessionMeta(status)", 1)[1].split("function selectSessionStatus", 1)[0]
    assert "status.resolvedPrompt || status.prompt" in meta
    assert "status.sourcePrompt" in meta
    assert "renderPromptExpectations(resolvedPrompt)" in meta
    assert "details.innerHTML = markup;" in meta
    assert ".test-generations-session-details" in css
    assert ".test-generations-prompt-expectations" in css

def test_test_identity_is_owned_by_shell_header():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    assert 'id="test-workspace-main-tabs"' in html
    assert 'id="test-generations-pane"' in html
    assert 'id="test-generations-form-title"' not in html
    assert "window.closeTestBenchActivity" in shell
    assert "window.syncApplicationShellContext" in script

def test_test_generations_follows_current_set_without_source_state():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert "var testSource" not in script
    assert "function chooseTestSource" not in script
    assert 'id="test-generations-source-folders"' not in html
    open_pane = script.split("function openPane()", 1)[1].split("function testRunCriteria()", 1)[0]
    assert "launchFolder = owningSetFolder((state && state.folder) || '');" in open_pane
    assert "Test Generations requires a current Set." in open_pane
    assert "request('test_prepare', { modelId: currentTestModelId() })" in open_pane
    assert "request('test_prepare', { modelId: requestedModelId })" in open_pane

def test_test_generation_sessions_are_not_training_set_contexts():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")

    blacklist = common.split("function isBlacklistedSetSubfolderName", 1)[1].split("function isSetFolderPath", 1)[0]
    assert "n === 'test-generations'" in blacklist


def test_test_generations_can_skip_the_base_rendition_for_one_batch():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "baseInclude.id = 'test-generations-base-include';" in script
    assert "baseInclude.checked = includeBase;" in script
    assert "baseInclude.disabled = true;" not in script
    assert "includeBase: el('test-generations-base-include').checked" in script


def test_rendered_test_status_resynchronizes_run_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    render_block = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]

    assert "syncActiveRunControls(status || {});" in render_block


def test_test_workspace_markup_is_static_and_behavior_only_binds_it():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert html.count('id="test-generations-pane"') == 1
    assert html.count('id="test-generations-run-btn"') == 1
    assert "function bindUi()" in script
    assert "bindUi();" in script
    assert "row = document.createElement('div');" in script
    assert "row.dataset.sessionRowKey = key;" in script
    assert "function renderSessions(sessions, queuedJobs)" in script

def test_test_preview_controls_do_not_cover_video_frames():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "video.controls = true" not in script
    assert "function appendTestPreviewVideo(container, video)" in script
    assert "test-generations-video-transport" in script
    assert "test-generations-video-scrubber" in script
    assert ".test-generations-video-transport {" in css




def test_test_activity_menu_uses_recent_set_history():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert "def recent_test_sets(limit=8):" in backend
    assert "_central_session_root()" in backend
    assert '"modelId": model_id' in backend
    assert '"source": source' not in backend
    assert "function buildTestActivityContextActions()" in script
    assert "function openTestBenchSet(folder, modelId)" in script
    assert "var key = folder + '|' + modelId;" in script
    assert "openTestBenchSet(folder, modelId)" in script
    assert "Right-click for recent Test Sets" in script


def test_test_history_navigation_switches_the_global_set_explicitly():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    set_block = script.split("function openTestBenchSet(", 1)[1].split("function buildTestActivityContextActions", 1)[0]
    assert "setWorkingModelProfileId" in set_block
    assert "openTestBenchFolder(targetFolder);" in set_block
    assert "pendingLaunchFolder" not in set_block
    assert "openTrainingWorkspaceFolder" not in set_block

    pane_block = script.split("function openPane()", 1)[1].split("function startRun()", 1)[0]
    assert "launchFolder = owningSetFolder((state && state.folder) || '');" in pane_block

def test_test_execution_uses_backend_model_capabilities_even_when_workspace_is_opened_indirectly():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "function isTestModelSupported()" in script
    assert "function refreshSupportedTestModels()" in script
    assert "fetch('/fs/test_generations/models')" in script
    assert "supportedTestModelIds.indexOf(currentTestModelId()) !== -1;" in script
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCount || !supported;" in script
    assert "if (!isTestModelSupported())" in script
    assert "Test Generations is not available for the selected Base Model." in script
    assert "syncLaunchVisibility();" in script

def test_recent_test_sets_are_cached_during_active_test_polling():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert '_recent_sets_cache = {"expires": 0.0, "items": []}' in backend
    assert 'time.monotonic() + 10.0' in backend




def test_saved_test_history_is_central_and_set_scoped():
    backend = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    assert "def _session_directories(folder_path):" in backend
    assert "def _session_belongs_to_folder(folder_path, session_directory, payload=None):" in backend
    assert "def list_sessions(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):" in backend
    assert "def status(folder_path, model_id=None, session_snapshot=None, visible_snapshot=None):" in backend
    assert '"ownerFolder": folder' in backend
    assert '"source": str(request.get("source") or "")' not in backend

def test_test_generations_has_no_legacy_rate_review_workflow():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")

    assert 'id="test-generations-rate-items-btn"' not in html
    assert "data-session-rate" not in script

def test_test_generations_reuses_normal_folder_review_for_assessment():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-session-name"' not in html
    assert 'id="test-generations-open-results-btn"' not in html
    assert 'id="test-generations-master-select"' in html
    assert "var selectedCandidates = null;" in script
    assert "selectedCandidates = allSelected ? new Set() : new Set(files);" in script
    assert "function syncCandidateMasterSelect(files)" in script
    assert "master.indeterminate = selectedCount > 0 && selectedCount < available.length;" in script
    assert "includeBase: el('test-generations-base-include').checked" in script
    assert "function openResultsFolder(folder)" in script
    assert "refreshCurrentDirectory();" in script
    assert "function testRunCriteria()" in script

def test_test_generations_surfaces_save_and_selected_epoch_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert '"candidateMetadata": candidate_metadata' in backend
    assert "candidate_runs, candidate_metadata = _staged_candidate_catalog(loras, model)" in backend
    assert "candidate_selected_epoch_from_provenance(provenance)" in backend
    assert "data-save-candidate" in script
    assert "Save this epoch" in script
    assert "stagedFileName: archiveFileName" in script
    assert "test-generations-selected-mark" in script
    assert "test-generations-staged-row' + (metadata && metadata.selected ? ' is-selected' : '')" in script
    assert ".test-generations-staged-row.is-selected" in css
    assert ".test-generations-save-candidate.is-selected" in css

def test_test_candidate_removal_does_not_refresh_broader_session_list():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    block = script.split("function removeCandidate(fileName, sessionName)", 1)[1].split("function removeCurrentSessionCandidate", 1)[0]

    assert "renderStatus(payload.sessionStatus);" in block
    assert "refreshSessions();" not in block


def test_test_generations_queue_contract():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert "requestForFolder(folder, 'test_enqueue'" in script
    assert "request('test_queue', { modelId: modelId })" in script
    assert "request('test_queue_cancel'" in script
    assert "request('test_queue_clear', { modelId: currentTestModelId() })" in script
    assert 'id="test-generations-clear-queue-btn"' in html
    for method in ("enqueue", "queued_jobs", "cancel_queued", "clear_queued"):
        assert f"def {method}(" in backend
    assert 'SHARED_EXECUTION_LANE = "inference"' in backend
    assert "from .inference_runner import enqueue_test" in backend
    assert "latest = _enqueue_frozen_test_request(" in backend
    assert 'operation == "test_enqueue"' in backend
    assert 'operation == "test_queue"' in backend
    assert 'operation == "test_queue_cancel"' in backend
    assert 'operation == "test_queue_clear"' in backend

def test_test_generations_rail_is_candidate_focused_without_source_browser():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'class="test-generations-library-panel test-generations-staged-panel"' in html
    assert 'id="test-generations-source-folders"' not in html
    assert "function refreshTestSourceBrowser()" not in script
    assert ".test-generations-source-folders" not in css
    assert "No staged candidates for this Set." in script
    assert "countEl.textContent = String(count)" in script

def test_historical_test_session_errors_do_not_claim_current_failure():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var showSessionError = false;" in script
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "showSessionError && status && status.error" in render
    open_pane = script.split("function openPane()", 1)[1].split("function startRun()", 1)[0]
    assert "showSessionError = false;" in open_pane
    assert "initialStatus.status === 'running' || initialStatus.status === 'stopping'" in open_pane
    open_session = script.split("function openSession(sessionName)", 1)[1].split("function deleteSession(sessionName)", 1)[0]
    assert "showSessionError = true;" in open_session


def test_test_generations_sidebar_is_collapsible_like_media_rail():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-body"' in html
    assert 'id="test-generations-rail-toggle-btn"' in html
    assert "function syncTestRailCollapseUi()" in script
    assert "function toggleTestRailCollapsed()" in script
    assert "el('test-generations-rail-toggle-btn').onclick = toggleTestRailCollapsed;" in script
    assert ".test-generations-body.test-generations-rail-collapsed {" in css
    assert ".test-generations-body.test-generations-rail-collapsed .test-generations-rail {" in css
    assert ".test-generations-rail-toggle-btn {" in css

def test_test_sessions_project_shared_child_progress_and_targeted_stop():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var queued = Number(session && session.queued || 0);" in script
    assert "var running = Number(session && session.running || 0);" in script
    assert "' complete'" in script
    assert "' · ' + running + ' running'" in script
    assert "' · ' + queued + ' queued'" in script
    assert "request('test_stop', { session: String(stopBtn && stopBtn.dataset.sessionStop || '') })" in script

def test_test_session_polling_preserves_session_row_identity():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    start = script.index("function renderSessions(sessions, queuedJobs)")
    end = script.index("function refreshSessions()", start)
    renderer = script[start:end]

    assert "dataset.sessionRowKey" in renderer
    assert "function ensureRow(key)" in renderer
    assert "function placeRow(target, row, index)" in renderer
    assert "host.innerHTML = ''" not in renderer

def test_test_prompt_draft_uses_disk_backed_set_workspace():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function saveTestWorkspacePrompt(prompt)" in script
    assert "'test_save_workspace_prompt'" in script
    assert "payload.workspacePromptPresent === true" in script
    assert "saveTestWorkspacePrompt(this.value);" in script
    assert "saveTestWorkspacePrompt(prompt);" in script
    assert "webcap.test.promptDraft." not in script
    assert "window.localStorage" not in script
    assert "function testPromptDraftKey()" not in script
    assert "function loadTestPromptDraft()" not in script




def test_set_state_drops_obsolete_test_generation_prompt_fields():
    folder_state = (ROOT / "tool" / "js" / "folder_state.js").read_text(encoding="utf-8")

    assert "test_generation_prompt" not in folder_state
    assert "testGenerationPrompt" not in folder_state
    assert "test_generation_by_model" in folder_state
    assert "settings: (entry.settings && typeof entry.settings === 'object'" in folder_state
    assert "JSON.parse(JSON.stringify(src.test_generation_by_model))" not in folder_state


def test_test_generations_set_change_reloads_current_set_without_source_redirect():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    loaded_block = script.split("function testGenerationsFolderLoaded()", 1)[1].split("function isTestModelSupported", 1)[0]
    assert "pendingActivityFolder" in loaded_block
    assert "openPane();" in loaded_block
    assert "pendingSourceOwnerFolder" not in loaded_block

    open_block = script.split("function openPane()", 1)[1].split("function startRun", 1)[0]
    assert "state && state.folder" in open_block
    assert "refreshTestSourceBrowser" not in open_block
    assert "openTrainingWorkspaceFolder" not in script


def test_test_candidates_keep_explicit_delete_control():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderStagedFiles(payload)", 1)[1].split("function sessionStatusText", 1)[0]
    assert "remove.dataset.fileName = String(fileName || '');" in block
    assert "remove.title = 'Remove this Test candidate';" in block
    assert "actions.appendChild(remove);" in block
    assert "row.appendChild(actions);" in block

def test_test_generations_can_generate_and_edit_wildcard_prompt_in_modal():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-wildcard-btn"' in html
    assert 'class="review-captions-btn test-generations-wildcard-wand"' in html
    assert 'id="test-generations-wildcard-model"' not in html
    assert 'id="test-generations-wildcard-refresh"' not in html
    assert 'id="test-generations-wildcard-modal"' in html
    assert 'role="dialog" aria-modal="true" aria-labelledby="test-generations-wildcard-title"' in html
    assert 'id="test-generations-wildcard-focus"' in html
    assert 'id="test-generations-wildcard-analysis"' in html
    assert 'id="test-generations-wildcard-output"' in html
    assert 'id="test-generations-wildcard-dimension-list"' in html
    assert 'id="test-generations-wildcard-preview"' in html
    assert 'id="test-generations-wildcard-shuffle"' in html
    assert 'id="test-generations-wildcard-regenerate"' in html
    assert 'id="test-generations-wildcard-use-btn"' in html

    assert "function openWildcardBuilder()" in script
    assert "function generateWildcardFromSet()" in script
    assert "function parseWildcardGroups(value)" in script
    assert "function renderWildcardDimensions()" in script
    assert "function shuffleWildcardPreview(index)" in script
    assert "focus: focus" in script
    assert "prompt.value = value;" in script
    assert "saveTestWorkspacePrompt(value);" in script
    assert "requestFolder" in script



def test_test_wildcard_uses_global_director_model_without_local_selector():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-wildcard-model"' not in html
    assert 'id="test-generations-wildcard-refresh"' not in html
    assert "getDirectorModelPreference('webcap.director.model')" in script
    assert "webcap:director-model-changed" in script


def test_test_wildcard_helper_is_optional_and_stays_with_current_set():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    open_block = script.split("function openPane()", 1)[1].split("function startRun", 1)[0]
    assert "wildcardDirector.analysis = null;" in open_block
    assert "renderWildcardAnalysis(null);" in open_block
    assert "Director unavailable." in open_block
    assert "reportConsoleError('Test Generations', err);" in open_block
    assert "refreshTestSourceBrowser" not in open_block


def test_test_wildcard_uses_current_set_without_source_owner_gate():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    render = script.split("function renderWildcardDirector()", 1)[1].split("function renderWildcardAnalysis", 1)[0]
    assert "sourceBrowser" not in render
    assert "wildcardDirector.modelId = getDirectorModelPreference('webcap.director.model');" in render
    assert "if (!wildcardDirector.available || !wildcardDirector.modelId)" in render
    assert "button.disabled = wildcardDirector.busy;" in render
    assert "Generate a wildcard prompt from this Set" in render

def test_wildcard_builder_footer_buttons_stay_compact_and_single_line():
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert ".test-generations-wildcard-footer > button" in css
    assert ".test-generations-wildcard-footer-actions > button" in css
    assert "width: auto;" in css
    assert "white-space: nowrap;" in css
    assert "#test-generations-wildcard-use-btn" in css


def test_generated_wildcard_review_uses_modal_and_derived_dimension_controls():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'class="keep-lora-modal test-generations-wildcard-modal hidden"' in html
    assert 'data-escape-close-id="test-generations-wildcard-close"' in html
    assert ".test-generations-wildcard-dialog" in css
    assert ".test-generations-wildcard-dimension-row" in css
    assert "#test-generations-wildcard-preview" in css
    assert "group.options.length + ' options'" in script
    assert "reroll.dataset.wildcardReroll" in script
    assert "Derived from the wildcard text; edit the text freely." in html


def test_wildcard_builder_can_close_while_analysis_runs_and_does_not_mislabel_edited_groups():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    close_block = script.split("function closeWildcardBuilder()", 1)[1].split("function shuffleWildcardPreview", 1)[0]
    assert "wildcardDirector.busy" not in close_block

    label_block = script.split("function wildcardGroupLabel", 1)[1].split("function resolveWildcardPreview", 1)[0]
    assert "sameOptions" in label_block
    assert "semanticOptions.every" in label_block


def test_test_results_header_surfaces_resolved_wildcard_choices():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-wildcard-tagline"' in html
    assert "Array.isArray(status.wildcardValues)" in script
    assert "Array.isArray(status.wildcardSummary)" in script
    assert "var wildcardHeader = wildcardSummary.length ? wildcardSummary : wildcardValues;" in script
    assert "wildcardHeader.join(' · ')" in script
    assert "<strong>Results</strong>" not in html
    assert ".test-generations-wildcard-tagline" in css
    assert "font-size: 18px !important;" in css
    assert "font-weight: 400;" in css


def test_test_results_media_and_ratings_use_session_identity_not_fs_root_navigation():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert "'/fs/test_generations/media?folder='" in script
    assert "'&session=' + encodeURIComponent(String(sessionName || ''))" in script
    assert "request('test_rate_result'" in script
    assert '@app.route("/fs/test_generations/media", methods=["GET"])' in app
    assert "def resolve_result_media(folder_path, session_name, media_name):" in backend
    assert "def rate_result(folder_path, session_name, media_name, rating):" in backend


def test_test_result_grid_identity_is_session_scoped_when_output_root_is_external():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderResults(status)", 1)[1].split("function syncActiveRunControls(status)", 1)[0]

    assert "var resultScope = sessionName + '|' + resultFolder;" in block
    assert "host.dataset.resultScope = resultScope;" in block


def test_external_output_test_sessions_keep_open_action():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "open.dataset.sessionReveal = resultFolder ? '' : name;" in script
    assert "function revealTestSession(sessionName)" in script
    assert "body: JSON.stringify({ area: 'tests', id: name, folder: '' })" in script
    assert "data-session-rate" not in script

def test_test_generations_background_updates_never_choose_a_session():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "currentSession =" not in render
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]
    assert "selectSessionStatus(" not in poll
    assert "if (currentSession === activeSession)" in poll
    assert "else if (selectedPreviewLive)" in poll
    launch = script.split("function startRun()", 1)[1].split("function stopRun", 1)[0]
    assert "var previousSession = currentSession;" in launch
    assert "currentSession === previousSession && !testVl.running" in launch
    assert "selectSessionStatus(first);" in launch

def test_test_generations_selection_changes_only_at_explicit_navigation_seams():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function selectSessionStatus(status)" in script
    open_session = script.split("function openSession(sessionName)", 1)[1].split("function deleteSession", 1)[0]
    assert "selectSessionStatus(status);" in open_session

    open_pane = script.split("function openPane()", 1)[1].split("function startRun()", 1)[0]
    assert "selectSessionStatus(selectedStatus);" in open_pane
    assert "initialStatus && initialStatus.session" in open_pane
    assert "? selectSessionStatus(initialStatus)" in open_pane



def test_test_generations_director_queue_preserves_remote_runtime_identity():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    queued_block = script.split("if (String(job.status || '') === 'queued'", 1)[1].split("return Object.assign", 1)[0]
    assert "runtimeMode: activity && activity.runtimeMode" in queued_block
    assert "runtimeProvider: activity && activity.runtimeProvider" in queued_block
    assert "showRemoteModelTelemetry = phaseName !== 'queued'" in script


def test_test_generations_exposes_training_candidates_link_from_unique_run_provenance():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    candidates = (ROOT / "tool/js/training_candidates.js").read_text(encoding="utf-8")
    assert 'id="test-generations-candidates-btn"' in html
    block = script.split("function syncCandidatesButton(payload)", 1)[1].split("\n  function ", 1)[0]
    assert "payload.candidateRuns" in block
    assert "run.jobId && run.folder" in block
    assert "button.classList.toggle('hidden', !runs.length);" in block
    assert "button.textContent = 'Runs';" in block
    assert "trainingCandidatesCloseHook" in candidates
    assert "options && typeof options.onClose === 'function'" in candidates

def test_test_result_cards_show_frozen_megapixels_and_candidate_strength():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function testResultMegapixels(status)" in script
    assert "function testResultStrength(status, result)" in script
    assert "metadata.push(String(megapixels) + ' MP');" in script
    assert "metadata.push('Strength ' + String(strength));" in script
    assert "buildResultFooter(result, { sessionName: sessionName, status: status })" in script
    assert "buildResultFooter(failure, { failed: true, status: status })" in script
    assert ".test-generations-result-metadata" in css


def test_test_generations_strength_control_is_per_candidate_row():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-candidate-strength" in script
    assert "strength.dataset.candidateStrength" in script
    assert "strength.min = '-2';" in script
    assert "strength.max = '2';" in script
    assert "strength.step = '0.05';" in script
    assert "strength.title = 'Override weight (blank uses default)';" in script
    assert "candidateStrengths: strengths" in script
    assert "Strength must be between -2 and 2." in script
    assert ".test-generations-candidate-strength" in css



def test_test_generation_default_weight_inherits_unless_candidate_overridden():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "defaultWeightLabel.textContent = 'Default weight';" in script
    assert "defaultWeight.id = 'test-generations-default-strength';" in script
    assert "baseRow.appendChild(defaultWeightLabel);" in script
    assert ".test-generations-default-strength-label" in css
    assert "defaultStrength: defaultCandidateStrength" in script
    assert "var savedDefault = savedSettings.defaultStrength;" in script
    assert "if (!hasSavedDefault && savedStrength === defaultCandidateStrength) return;" in script
    assert "strength.placeholder = String(defaultCandidateStrength);" in script
    assert "delete candidateStrengths[strengthFile];" in script
    assert "input.placeholder = String(defaultCandidateStrength);" in script
    assert "input.value = String(defaultCandidateStrength);" in script
    assert ": String(defaultCandidateStrength);" in script
    assert "if (strengthValue === defaultCandidateStrength) delete candidateStrengths[strengthFile];" in script
    assert "Object.prototype.hasOwnProperty.call(candidateStrengths || {}, file)" in script
    assert "strengths[file] = weight;" in script
    assert "Default weight must be between -2 and 2." in script

def test_global_director_model_control_lives_in_header():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/workspace_shell.css").read_text(encoding="utf-8")
    assert 'id="app-header-director-control"' in html
    assert 'id="app-header-director-model"' in html
    assert "function refreshApplicationDirectorModels()" in shell
    assert "setDirectorModelPreference('webcap.director.model', selected);" in shell
    assert "webcap:director-model-changed" in shell
    assert ".app-header-director-control" in css
    assert 'id="test-generations-wildcard-model"' not in html

def test_primer_template_assistant_uses_existing_template_editor():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "primer_settings.js").read_text(encoding="utf-8")

    assert 'id="primer-template-wand-btn"' in html
    assert 'id="primer-template-candidate"' in html
    assert 'id="primer-template-candidate-use"' in html
    assert "function buildPrimerTemplateAssistRequest()" in script
    assert "getChecklistKeywordTermsForRequirement(label)" in script
    assert "getChecklistGroupTermAffixes(label, term, '')" in script
    assert "getChecklistPrimerSeparatorForRequirement(label)" in script
    assert "getPrimerMappingsRows()" in script
    assert "validatePrimerTemplateCandidate" in script
    assert "Template Assist invented an unavailable placeholder" in script
    assert "templateEl.dispatchEvent(new Event('input', { bubbles: true }))" in script
    assert "fetch(url, options || {})" in script
    assert "'/caption/template-assist'" in script


def test_new_test_run_selects_returned_session_for_results_header():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    launch = script.split("function startRun()", 1)[1].split("function stopRun", 1)[0]
    assert "requestForFolder(folder, 'test_enqueue', criteria)" in launch
    assert "var first = payload && payload.sessions && payload.sessions[0] || payload.latest;" in launch
    assert "currentSession === previousSession && !testVl.running" in launch
    assert "selectSessionStatus(first);" in launch
    assert "refreshSessions();" in launch

def test_results_header_renders_persisted_wildcard_values():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    meta_block = script.split("function renderSessionMeta(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "Array.isArray(status.wildcardValues)" in meta_block
    assert "Array.isArray(status.wildcardSummary)" in meta_block
    assert "wildcardTagline.textContent = wildcardHeader.join(' · ');" in meta_block


def test_test_sessions_do_not_reinsert_unchanged_groups_or_apply_stale_poll_responses():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    renderer = script.split("function renderSessions(sessions, queuedJobs)", 1)[1].split("function refreshSessions()", 1)[0]
    assert "if (group.nextElementSibling !== next) host.insertBefore(group, next);" in renderer
    assert "else if (group.nextElementSibling)" in renderer
    assert "var expected = groups[order[key]]" not in renderer
    refresh = script.split("function refreshSessions()", 1)[1].split("function refreshSessionsIfDue", 1)[0]
    assert "mutationVersion !== sessionsMutationVersion" in refresh


def test_test_session_deletion_reconciles_authoritative_rows_without_implicit_selection():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    deletion = script.split("function deleteSession(sessionName)", 1)[1].split("function removeCandidate", 1)[0]
    assert "renderSessions(payload.sessions, queuedTestJobs);" in deletion
    assert "selectSessionStatus(payload.latest)" not in deletion
    assert "renderStatus({ status: 'idle' });" in deletion
    assert "refreshSessions()" not in deletion
    assert "Permanently delete Test session" in script
    assert "sessionsMutationVersion += 1;" in deletion


def test_test_candidate_mutations_and_ratings_preserve_unaffected_dom():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    mutation = script.split("function removeCandidate(fileName, sessionName)", 1)[1].split("function removeCurrentSessionCandidate", 1)[0]
    assert "row.remove();" in mutation
    assert "syncStagedSummary(prepared);" in mutation
    assert "if (localRemoval)" in mutation
    rating = script.split("function rateTestResult(button)", 1)[1].split("function buildResultRemoveButton", 1)[0]
    assert "syncStagedCandidateScores(prepared.candidateScores);" in rating
    assert "renderStagedFiles(prepared);" not in rating
    assert "row.dataset.stagedFile" in script
    assert "Remove staged Test candidate " in script


def test_test_session_details_and_empty_compare_are_not_rebuilt_on_refresh():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    details = script.split("function renderSessionMeta(status)", 1)[1].split("function selectSessionStatus", 1)[0]
    assert "if (markup !== lastSessionDetailsMarkup)" in details
    compare = script.split("function renderCompare(status)", 1)[1].split("function renderResults", 1)[0]
    assert "if (host.dataset.compareKey !== 'empty')" in compare


def test_test_generations_sweep_is_opt_in_and_avoids_destructive_result_actions():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    assert 'id="test-generations-normal-mode"' in html
    assert 'id="test-generations-sweep-mode"' in html
    assert 'id="test-generations-sweep-weights"' in html
    assert "var sweepMode = false;" in script
    assert "if (sweepMode) criteria.sweepWeights = parseSweepWeights(sweepWeights);" in script
    assert "sweepMode = false;" in script
    assert "if (result && result.strength !== undefined && result.strength !== null) return null;" in script
    assert "identity.primary += ' · Weight ' + String(result.strength);" in script
    assert "defaultStrength: defaultCandidateStrength" in script
    assert ".test-generations-sweep-setup" in css


def test_staged_candidates_show_recorded_h3_variant_without_guessing():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert '"trainingVariant": str(run_summary.get("trainingVariant") or "") if stage == "h3" else ""' in backend
    assert "metadata.trainingVariant === 'Image Adapter'" in script
    assert "imageMark.innerHTML = trainingH3ImageModelIconHtml();" in script
    assert "runName.textContent = parts.detail;" in script
    assert "runName.title = parts.detail;" in script
    assert "copy.appendChild(heading);" in script
    assert "copy.appendChild(metrics);" in script


def test_wildcard_request_includes_active_set_group_vocabulary():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    generator = script.split("function generateWildcardFromSet()", 1)[1].split("function pane()", 1)[0]
    assert "var requestFolder = owningSetFolder(" in generator
    assert "folder: requestFolder" in generator
    assert "vocabulary: testPlanningVocabulary()" in generator
    assert "function testPlanningVocabulary()" in script
    assert "getRequirementGroupAlias" in script
    assert "getChecklistKeywordTermsForRequirement" in script

def test_test_vl_batch_is_ephemeral_and_session_scoped():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-ask-vl"' in html
    assert 'id="test-generations-vl-detail"' in html
    assert "captionAssistRequestJson('/fs/test_generations/vision-question'" in script
    assert "function queueTestVlForSession(status, selectedResults)" in script
    assert "function stopTestVl()" in script
    assert "var testVlRuns = Object.create(null);" in script
    assert "testVl.scope !== testVlScope(currentStatus)" in script
    assert "saveFolderStateForCurrentRoot()" not in script.split("function runTestVlBatch()", 1)[1].split("function", 1)[0]

def test_test_vl_results_are_comparison_first_with_collapsed_diagnostics():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-vl-comparison"' in html
    assert '<details id="test-generations-vl-technical">' in html
    assert '<details id="test-generations-vl-agreements">' in html
    assert "testVlComparisonTable(mismatches, groups, entry)" in script
    assert "testVlComparisonTable(unclear, groups, entry)" in script
    assert "testVlComparisonTable(matches, groups, entry)" in script
    assert "el('test-generations-vl-technical').open = keepTechnical;" in script
    assert "escapeHtml(g.expectedText)" not in script
    assert "escapeHtml(expected)" in script
    assert "escapeHtml(observed)" in script
    assert ".test-generations-vl-table" in css


def test_test_vl_comparison_heading_and_table_share_one_grid_item():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    # The grid must position entire sections, not headings in one column and
    # their tables in the next. Cover all three independently displayed groups.
    for condition, heading, rows in (
        ("mismatches", "Differences", "mismatches"),
        ("nearMatches", "Related colors · partial credit", "nearMatches"),
        ("unclear", "Unclear", "unclear"),
    ):
        expected = (
            f"""if ({condition}.length) visible += '<div class="test-generations-vl-comparison-group"><strong>{heading}</strong>' """
            f"+ testVlComparisonTable({rows}, groups, entry) + '</div>';")
        assert expected in script
    assert ".test-generations-vl-comparison { display:grid;" in css
    assert ".test-generations-vl-comparison-group { min-width:0; }" in css


def test_test_vl_counting_overrides_remain_browser_memory_only():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "disabledGroups: new Set()" in script
    assert "testVl.disabledGroups = new Set();" in script
    assert "function testVlScore(comparison, ignoredGroups)" in script
    assert "function testVlCandidateScores(results)" in script
    assert "entry.ignoredGroups = new Set();" in script
    assert "testVlScore(entry.comparison, entry.ignoredGroups)" in script
    assert "syncTestVlCandidateRows();" in script
    assert "function refreshTestVlScores()" in script
    assert 'id="test-generations-vl-filters"' in html
    assert 'id="test-generations-vl-filter-options"' in html
    assert "data-test-vl-count=" in script
    assert ".test-generations-vl-row-count" in css
    assert "test_store_vision_result" not in script


def test_test_vl_session_scoring_audit_contract():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "testVl.disabledGroups = new Set();" in script
    assert "currentStatus.sweepWeights) return totals;" in script
    assert "function renderTestVlCard(card, result, candidateScores)" in script
    assert "var candidateScores = testVlCandidateScores(results);" in script
    assert "renderTestVlCard(card, result, candidateScores);" in script
    assert "testVlCreditText(score.count) + ' weighted agreement'" in script
    assert "testVlCreditText(epochScore.count) + ' weighted attributes'" in script
    assert "epochScore.matches / epochScore.count" in script

def test_candidate_summary_keeps_controls_on_top_line_and_compacts_scores():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "row.appendChild(strength);" in script
    assert "row.appendChild(actions);" in script
    assert "copy.appendChild(heading);" in script
    assert "copy.appendChild(metrics);" in script
    assert "detail.title = scoreCount ? scoreCount + ' rating'" in script
    assert "label.textContent = score && score.count" in script
    assert "Math.round(100 * score.matches / score.count) + '%'" in script
    assert "metrics.appendChild(label);" in script
    assert ".test-generations-staged-heading," in css
    assert ".test-generations-staged-metrics {" in css


def test_session_vision_assessments_restore_and_preview_both_epoch_metrics():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    state = (ROOT / "tool/server/folder_state_store.py").read_text(encoding="utf-8")
    assert "function restoreTestVl(status)" in script
    assert "status && status.testVision" in script
    assert "function saveTestVl(changes, sessionName, folderName)" in script
    assert "requestForFolder(folder, 'test_vision_update'" in script
    assert "testVlSaveQueue = save.catch(function () {});" in script
    assert "data-test-manual-epoch-score" in script
    assert "Math.round(100 * epochScore.matches / epochScore.count)" in script
    assert "Epoch VL agreement" in script
    assert 'if operation == "test_vision_update":' in backend
    assert 'visible["testVision"] = _session_vision_state(session_directory)' in backend
    assert 'state["test_vision"] = vision' in state

def test_test_vision_save_order_and_inference_success_survives_persistence_error():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "var testVlSaveQueue = Promise.resolve();" in script
    assert "testVlSaveQueue = save.catch(function () {});" in script
    assert "reportConsoleError('Save Test VL assessment', err);" in script
    assert "entry.saveError = '';" in script
    assert "saveError: String(err.message || err)" in script
    assert "if (item.saveError) button.textContent += ' !';" in script
    assert "if (entry.saveError) summary.textContent += ' · not saved: '" in script

def test_test_result_compact_three_rows_and_vl_model_provenance():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    for marker in ("label.appendChild(source);", "primaryRow.appendChild(label);",
                   "secondaryRow.appendChild(metadataRow);", "secondaryRow.appendChild(rating);",
                   "evaluation.appendChild(vlButton);",
                   "manualScore.dataset.testManualEpochScore = '1';",
                   "vlScore.dataset.testVlEpochScore = '1';"):
        assert marker in script
    assert "entry.modelId = run.model;" in script
    assert "modelId: savedEntry.modelId || ''" in script
    assert "Unknown (previous assessment)" in script
    assert 'id="test-generations-vl-model"' in html
    assert ".test-generations-result-evaluation" in css

def test_candidate_sorting_reuses_existing_scores_and_preserves_rows():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-candidate-sort"' in html
    assert '<option value="original">' in html
    assert '<option value="rating" selected>' in html
    assert '<option value="vl">' in html
    assert ".test-generations-candidate-toolbar" in css
    assert "button.textContent = 'Runs';" in script

    sorter = script.split("function sortStagedCandidateRows()", 1)[1].split("function syncStagedCandidateScores", 1)[0]
    assert "prepared.files.map" in sorter
    assert "prepared.candidateScores || {}" in sorter
    assert "(prepared.candidateVisionScores || {})" in sorter
    assert "scoreB.matches / totalB - scoreA.matches / totalA" in sorter
    assert "if (countA !== countB) return countB - countA;" in sorter
    assert "if (totalA !== totalB) return totalB - totalA;" in sorter
    assert "return original.get(fileA) - original.get(fileB);" in sorter
    assert "rows.every(function (row, index) { return row === ordered[index]; })" in sorter
    assert "host.insertBefore(ordered[i], next);" in sorter
    assert "innerHTML" not in sorter
    assert "row.appendChild(strength);" in script
    assert "row.appendChild(actions);" in script

    assert "sortStagedCandidateRows();" in script.split("function syncStagedCandidateScores", 1)[1].split("function parseSweepWeights", 1)[0]
    assert "sortStagedCandidateRows();" in script.split("function syncTestVlCandidateRows", 1)[1].split("function testVlComparisonTable", 1)[0]
    assert "candidateSort = this.value;" in script
    assert "candidateSort = 'rating';" in script


def test_repeat_has_no_separate_batch_lifecycle():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    backend = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    assert "criteria.repeat = repeat;" in script
    assert "criteria.autoVl = autoVl;" in script
    assert "def enqueue_repeated(folder_path, criteria):" in backend
    assert 'id="test-generations-inline-count"' in html
    assert 'id="test-generations-inline-auto-vl"' in html
    assert "runTestBatch(" not in script
    assert "refreshServerTestBatches(" not in script
    assert 'id="test-generations-batch-modal"' not in html
    assert not (ROOT / "tool/server/test_batch.py").exists()

def test_candidate_vl_aggregates_use_saved_scores_not_selected_session():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    candidate_rows = script.split("function syncTestVlCandidateRows()", 1)[1].split("function testVlComparisonTable", 1)[0]
    assert "prepared && prepared.candidateVisionScores || {}" in candidate_rows
    assert "testVlCandidateScores(currentStatus && currentStatus.results)" not in candidate_rows
    assert '"candidateVisionScores": _candidate_vision_scores(' in backend
    assert "prepared.candidateVisionScores = payload.candidateVisionScores || {};" in script
    assert 'if payload.get("sweepWeights"):' in backend
    assert 'if group.get("result") not in ("match", "mismatch"):' in backend


def test_preview_sort_is_session_local_and_preserves_keyed_cards():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    assert 'id="test-generations-preview-sort"' in html
    assert 'aria-label="Sort Test previews"' in html
    assert ".test-generations-preview-tools" in css
    assert "var previewSort = 'original';" in script
    assert "function sortedTestPreviewRows(results)" in script
    assert "function sortTestPreviewCards(status)" in script
    assert "function refreshTestPreviewOrder()" in script
    assert "testVlScore(entry.comparison, entry.ignoredGroups)" in script
    assert "if (previewSort === 'rating') refreshTestPreviewOrder();" in script
    assert "if (previewSort === 'vl') refreshTestPreviewOrder();" in script
    assert "el('test-generations-preview-sort').onchange" in script
    assert "previewSort = 'original';" in script.split("function openPane()", 1)[1].split("function populateControls", 1)[0]
    sorter = script.split("function sortTestPreviewCards(status)", 1)[1].split("function refreshTestPreviewOrder()", 1)[0]
    assert "if (card.nextSibling !== next) host.insertBefore(card, next);" in sorter
    assert "host.innerHTML" not in sorter
    compare = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    assert "sortedTestPreviewRows(" in compare
    assert "sortTestPreviewCards(status);" in script.split("function renderResults(status)", 1)[1].split("function syncActiveRunControls", 1)[0]


def test_repeat_launch_is_native_and_session_owned():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    backend = (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    assert 'Repeat <input id="test-generations-inline-count"' in html
    assert 'id="test-generations-session-name"' not in html
    assert "criteria.repeat = repeat;" in script
    assert "criteria.autoVl = autoVl;" in script
    assert "requestForFolder(folder, 'test_enqueue', criteria)" in script
    assert "def enqueue_repeated(folder_path, criteria):" in backend
    assert "def complete_test_auto_vl(context, answer, elapsed_ms):" in backend
    assert "def _queue_test_auto_vl(folder_path, session_name, media_file):" in backend
    assert "refreshServerTestBatches" not in script
    assert "test_generations/batches" not in script
    assert 'id="test-generations-multi-actions"' not in html


def test_launch_action_stays_inside_repeat_and_vl_panel():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    launch = html.split('<div class="test-generations-launch-options">', 1)[1]
    launch = launch.split('<div id="test-generations-status"', 1)[0]
    assert launch.index('id="test-generations-inline-launch-summary"') < launch.index('id="test-generations-run-btn"')
    assert launch.index('id="test-generations-run-btn"') < launch.index('</section>')
