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
    assert "Testing unavailable for selected Base Model." in script


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
    assert "grid-template-columns: minmax(0, 1fr) auto;" in css
    assert ".test-generations-view-tab.active" in css
    assert "border-bottom-color: var(--accent);" in css
    assert "setAttribute('aria-selected'" in script


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-pane"' in html
    assert "el('test-generations-workspace')" in script
    assert "training-tests-actions" in script
    assert ".training-run-setup-actions" not in script
    assert "document.querySelector('.editor-surface')" not in script
    assert "workspace-test-open" in script
    assert "test-generations-aspect" in script
    assert "test-generations-megapixels" in script
    assert "test-generations-duration" in script
    assert "test-generations-seed" in script
    assert "test-generations-results" in script
    assert "card.dataset.resultKey = resultKey" in script
    assert "host.insertBefore(card, pending || null)" in script
    assert "pending.querySelector('.test-generations-result-name').textContent" in script
    assert "var failures = status && Array.isArray(status.failures) ? status.failures : [];" in script
    assert "placeholder.textContent = 'Generation failed';" in script
    assert "detail.textContent = String(failure.error || 'Generation failed.');" in script
    assert "(results.length + failures.length) < total" in script
    assert "host.innerHTML = html" not in script
    assert "Previews appear as each LoRA finishes." in script
    assert "settings: settings" in script
    assert "var declaredSettings = prepared && Array.isArray(prepared.settings)" in script
    assert "test-generations-dimensions" in script
    assert "settings.seed" in script

    assert ".test-generations-pane" in css
    assert ".test-generations-workspace" in css
    assert ".test-generations-results" in css
    assert ".test-generations-result-card video" in css
    assert ".test-generations-result-card img" in css
    assert ".test-generations-setup-overview" in css
    assert ".test-generations-setup-options" in css
    assert 'id="test-generations-files-count"' in html
    assert 'id="test-generations-sessions-count"' in html
    assert 'id="test-generations-clear-sessions-btn"' in html
    assert "countEl.textContent = String(count)" in script
    assert "countEl.textContent = String(items.length + queued.length)" in script
    assert 'class="test-generations-library"' in html
    assert "<details>" not in html
    body_rule = css.split(".test-generations-body {", 1)[1].split("}", 1)[0]
    assert "grid-template-columns: minmax(400px, 430px) minmax(0, 1fr);" in body_rule
    assert 'class="test-generations-rail"' in html
    controls_rule = css.split(".test-generations-controls {", 1)[1].split("}", 1)[0]
    assert "display: flex;" in controls_rule
    assert "flex-direction: column;" in controls_rule
    assert ".test-generations-library-panel" in css
    assert ".test-generations-library-heading" in css
    shell_css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    assert 'id="test-generations-workspace"' in html
    assert ".app-frame.workspace-test-open > .test-generations-workspace" in shell_css
    assert 'src="/static/js/test_generations.js"' in html



def test_test_generation_previews_keep_stable_width_and_natural_height():
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    results_rule = css.split(".test-generations-results {", 1)[1].split("}", 1)[0]
    assert "display: grid;" in results_rule
    assert "grid-template-columns: repeat(auto-fill, 280px);" in results_rule
    assert "justify-content: start;" in results_rule
    assert "flex: 1 1 0;" in results_rule
    assert "grid-auto-rows: max-content;" in results_rule

    video_rule = css.split(".test-generations-result-card video,\n.test-generations-result-card img {", 1)[1].split("}", 1)[0]
    assert "width: 100%;" in video_rule
    assert "height: auto;" in video_rule
    assert "aspect-ratio:" not in video_rule
    assert "object-fit:" not in video_rule


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
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-recent-prompts-btn"' in html
    assert "function openRecentPromptsMenu(button)" in script
    assert "Array.isArray(testActivity.recentPrompts)" in script
    assert "function applyRecentPrompt(item)" in script
    assert "saveTestPromptDraft(prompt);" in script
    assert "saveTestBenchState(prompt);" in script
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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-sessions-count" in script
    assert "test-generations-sessions-list" in script
    assert "test_open_session" in script
    assert "test_delete_session" in script
    assert "dataset.removeCandidate" in script
    assert "function removeCandidate(fileName, sessionName)" in script
    assert "session: String(sessionName || '')" in script
    assert "removeCandidate(button.dataset.fileName, '')" in script
    assert "function removeCurrentSessionCandidate(button)" in script
    assert "window.confirm(" in script
    assert "This deletes the staged LoRA and its result from the current session. Other sessions are unchanged." in script
    removal_block = script.split("function removeCurrentSessionCandidate(button)", 1)[1].split("function bindUi()", 1)[0]
    assert removal_block.index("if (!confirmed) return;") < removal_block.index("button.disabled = true;")
    assert removal_block.index("button.disabled = true;") < removal_block.index("removeCandidate(candidateFile, currentSession)")
    assert "button.disabled = false;" in removal_block
    assert "removeCurrentSessionCandidate(remove);" in script
    assert "button.disabled = true;" in script
    assert "button.disabled = false;" in script
    assert "queueCancel.disabled = false;" in script
    assert "row.dataset.sessionName = name;" in script
    assert "row.dataset.queueJobId = String(job.id || '');" in script
    assert "openSession(row.dataset.sessionName);" in script
    assert "open.dataset.sessionFolderOpen = resultFolder;" in script
    assert "openResultsFolder(folderOpen.dataset.sessionFolderOpen);" in script
    assert "open.dataset.sessionOpen" not in script
    assert ".test-generations-session-row" in css
    assert ".test-generations-session-row:not([data-queue-job-id])" in css
    assert ".test-generations-session-group" in css
    assert ".test-generations-session-progress" in css
    assert ".test-generations-result-footer" in css



def test_session_list_groups_running_queue_then_finished():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderSessions(sessions, queuedJobs)", 1)[1].split("function refreshSessions()", 1)[0]

    assert "appendGroup('Running', activeItems.length, 'is-running')" in block
    assert "appendGroup('Queued', queued.length, 'is-queued')" in block
    assert "appendGroup('Finished', historyItems.length, 'is-history')" in block
    assert block.index("appendGroup('Running'") < block.index("appendGroup('Queued'")
    assert block.index("appendGroup('Queued'") < block.index("appendGroup('Completed'")


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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function sessionStatusText(session)" in script
    assert "function syncVisibleSessionProgress(status)" in script
    assert "meta.textContent = sessionStatusText(session);" in script
    render_block = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "syncVisibleSessionProgress(status || {});" in render_block



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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    ui_script = (ROOT / "tool" / "js" / "ui.js").read_text(encoding="utf-8")

    assert 'id="activity-test-btn"' in html
    assert "function refreshActivityButton()" in script
    assert "function openTestBenchActivity(target)" in script
    assert "window.testGenerationsFolderLoaded = testGenerationsFolderLoaded" in script
    assert "window.openTestBenchForFolder = openTestBenchForSetFolder" in script
    assert "window.refreshTestBenchActivity = refreshActivityButton" in script
    assert "activityButton.classList.toggle('test-running', !!active)" in script
    assert ".activity-rail-btn.test-running::after" in (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    assert "window.testGenerationsFolderLoaded()" in ui_script

    assert "function setRunSettingsDisabled" not in script
    controls_block = script.split("function syncActiveRunControls(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "runBtn.disabled = active" not in controls_block
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;" in controls_block
    assert 'id="test-generations-stop-btn"' in html
    assert "function syncActiveTestCard(status)" in script
    assert "el('test-generations-stop-btn').onclick = function () { stopRun(this); };" in script
    assert "dataset.sessionStop = name;" not in script
    assert "data-session-stop" not in script
    assert ".disabled = !!disabled" not in controls_block

    assert "if (currentSession === activeSession)" in script
    assert "savedPrompt.trim()" not in script
    assert "saveTestBenchState(prompt);" in script
    assert "if (nextSeed) nextSeed.value = String(randomSeed());" in script

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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var currentSessionFolder = '';" in script
    assert "var currentSessionModel = '';" in script
    assert "currentSessionFolder === launchFolder" in script
    assert "currentSessionModel === requestedModelId" in script
    assert "request('test_open_session', { session: rememberedSession })" in script
    assert "function selectSessionStatus(status)" in script
    assert "currentSession = String(status.session || '');" in script
    assert "request('test_open_session', { session: currentSession })" in script


def test_test_polling_keeps_active_worker_status_separate_from_selected_preview():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]

    assert "syncActiveTestCard(status);" in poll
    assert "if (currentSession === activeSession)" in poll
    assert "else if (selectedPreviewLive)" in poll
    assert "renderStatus(selectedStatus);" in poll
    assert "selectedPreviewLive" in poll
    assert "testStatusHasPendingWork(currentStatus)" in poll
    assert "testStatusHasPendingWork(status) || testStatusHasPendingWork(currentStatus)" in poll

    assert "refreshActivityButtonIfDue(15000);" in poll
    assert "refreshSessionsIfDue(10000).catch(showError);" in poll
    assert "pollTimer = setTimeout(pollStatus, 4000);" in poll
    assert "function refreshActivityButtonIfDue(intervalMs)" in script
    assert "function refreshSessionsIfDue(intervalMs)" in script


def test_test_preview_polling_survives_inter_job_queued_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    helper = script.split("function testStatusHasPendingWork(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "'starting', 'queued', 'running', 'stopping'" in helper
    assert "total > processed" not in helper

    open_session = script.split("function openSession(sessionName)", 1)[1].split("function removeDeletedSessionRow", 1)[0]
    assert "if (testStatusHasPendingWork(status)) pollStatus();" in open_session


def test_active_test_card_is_separate_from_selected_session_results():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-active"' in html
    assert 'id="test-generations-active-progress"' in html
    assert 'id="test-generations-active-current"' in html
    assert 'id="test-generations-active-meta"' in html
    assert "syncActiveTestCard(status);" in script
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]
    assert "syncActiveTestCard(status);" in poll
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "statusEl.textContent = live ? '' : statusText(status);" in render
    assert ".test-generations-active {" in css
    assert ".test-generations-stop-btn {" in css
    assert "min-height: 160px;" in css


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
    script = (ROOT / "tool" / "js" / "console_panel.js").read_text(encoding="utf-8")

    assert "div.textContent = String(msg);" in script
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
    assert "copy.appendChild(rating);" in footer_block

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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]

    assert "var compareKey = sessionName + '|'" in compare_block
    assert "host.dataset.compareKey = compareKey" in compare_block
    assert "host.querySelector('.test-generations-compare-stage')" in compare_block
    assert "existingPrevious.disabled = compareIndex <= 0;" in compare_block
    assert "existingNext.disabled = compareIndex >= results.length - 2;" in compare_block
    assert "existingPosition.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);" in compare_block
    assert compare_block.index("existingNext.disabled = compareIndex >= results.length - 2;") < compare_block.index("return;")
    assert compare_block.index("return;") < compare_block.index("host.innerHTML = '';")
    assert "if (resultsView === 'compare') renderCompare(status || {});" in script



def test_compare_videos_start_muted():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    preview_block = script.split("function appendTestPreview(container, sessionName, result, options)", 1)[1].split("function candidateFileForResult", 1)[0]
    assert "appendTestPreview(item, sessionName, result, { muted: true })" in compare_block
    assert "video.muted = !!(options && options.muted);" in preview_block



def test_test_bench_shows_frozen_session_metadata_separately_from_next_run():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "Next run" in script
    assert "test-generations-session-meta" not in html
    assert "test-generations-session-info-btn" in script
    assert "test-generations-session-details" in script
    assert "function sessionMetaText(status)" in script
    assert "function renderSessionMeta(status)" in script
    assert "function extractPromptColorTargets(prompt)" in script
    assert "function extractPromptExpectations(prompt)" in script
    assert "function extractHairPromptItems(prompt)" in script
    assert "function extractNamedPromptItems(prompt, terms, type)" in script
    assert "function renderPromptExpectations(prompt)" in script
    assert "TEST_PROMPT_COLOR_SWATCHES" in script
    assert "TEST_PROMPT_HAIR_STYLES" in script
    assert "TEST_PROMPT_ACCESSORIES" in script
    assert "TEST_PROMPT_SCENE_OBJECTS" in script
    assert "matching\\s+(.+)" in script
    assert "Only direct prompt correlations are shown." in script
    assert "title=\"" in script
    assert "status.resolvedPrompt || status.prompt" in script
    assert "renderPromptExpectations(resolvedPrompt)" in script
    assert "status.sourcePrompt" in script
    assert "status.aspectRatio" in script
    assert "status.megapixels" in script
    assert "status.duration" in script
    assert "status.seed" in script
    assert ".test-generations-session-details" in css
    assert ".test-generations-session-info-grid" in css
    assert "grid-template-columns: minmax(300px, 30%) minmax(0, 70%);" in css
    assert "max-width: 700px;" not in css
    assert "width: 100%;" in css
    assert "box-sizing: border-box;" in css
    assert ".test-generations-prompt-expectations" in css
    assert ".test-generations-expectation-table" in css
    assert ".test-generations-expectation-row" in css
    assert "grid-template-columns: 72px minmax(0, 1fr) 92px minmax(0, .9fr);" in css
    assert ".test-generations-color-swatch" in css
    assert ".test-generations-session-prompt pre" in css

    details_block = script.split("details.innerHTML = [", 1)[1].split("].join('');", 1)[0]
    assert details_block.index("renderPromptExpectations(resolvedPrompt)") < details_block.index("test-generations-session-prompts")


def test_test_identity_is_owned_by_shell_header():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert "test-generations-form-title" in script
    assert "? 'Test Generations'" in shell
    assert "window.closeTestBenchActivity" in shell



def test_test_generations_follows_current_set_without_source_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert "var testSource" not in script
    assert "pendingTestSource" not in script
    assert "function refreshTestSourceBrowser" not in script
    assert "function chooseTestSource" not in script
    assert "resolvedCriteria.source" not in script
    assert 'id="test-generations-source-folders"' not in html
    assert 'id="test-generations-source-path"' not in html

    open_pane = script.split("function openPane()", 1)[1].split("function startRun()", 1)[0]
    assert "launchFolder = owningSetFolder((state && state.folder) || '');" in open_pane
    assert "Test Generations requires a current Set." in open_pane
    assert "request('test_prepare', { modelId: getWorkingModelProfileId() })" in open_pane

def test_test_generation_sessions_are_not_training_set_contexts():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")

    blacklist = common.split("function isBlacklistedSetSubfolderName", 1)[1].split("function isSetFolderPath", 1)[0]
    assert "n === 'test-generations'" in blacklist


def test_test_generations_can_skip_the_base_rendition_for_one_batch():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "baseInclude.id = 'test-generations-base-include';" in script
    assert "baseInclude.checked = includeBase;" in script
    assert "baseInclude.disabled = true;" not in script
    assert "includeBase: includeBase" in script


def test_rendered_test_status_resynchronizes_run_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    render_block = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]

    assert "syncActiveRunControls(status || {});" in render_block


def test_test_workspace_markup_is_static_and_behavior_only_binds_it():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert html.count('id="test-generations-pane"') == 1
    assert html.count('id="test-generations-run-btn"') == 1
    assert "document.createElement('section')" not in script
    assert "node.innerHTML = [" not in script
    assert "workspace.appendChild(node)" not in script
    assert "function bindUi()" in script
    assert "bindUi();" in script


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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function isTestModelSupported()" in script
    assert "function refreshSupportedTestModels()" in script
    assert "fetch('/fs/test_generations/models')" in script
    assert "supportedTestModelIds.indexOf(String(getWorkingModelProfileId() || '')) !== -1" in script
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;" in script
    assert "if (!isTestModelSupported())" in script
    assert "Test Generations is not available for the selected Base Model." in script
    assert "syncLaunchVisibility();" in script[script.index("function testGenerationsFolderLoaded()"):script.index("function stagedFileParts(", script.index("function testGenerationsFolderLoaded()"))]
    assert "syncActiveRunControls(currentStatus);" in script
    assert ".test-generations-video-transport, video, button" in script


def test_recent_test_sets_are_cached_during_active_test_polling():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert '_recent_sets_cache = {"expires": 0.0, "items": []}' in backend
    assert 'time.monotonic() + 10.0' in backend




def test_saved_test_history_is_central_and_set_scoped():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert 'Path(app_config.FS_ROOT) / ".webcap" / TEST_RESULTS_DIR' in backend
    assert "def _session_directories(folder_path):" in backend
    assert "def _session_belongs_to_folder(folder_path, session_directory, payload=None):" in backend
    assert "def list_sessions(folder_path, model_id=None):" in backend
    assert "def status(folder_path, model_id=None):" in backend
    assert '"ownerFolder": folder' in backend
    assert '"source": str(request.get("source") or "")' not in backend

def test_test_generations_has_no_legacy_rate_review_workflow():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")

    assert 'id="test-generations-rate-items-btn"' not in html
    assert "data-session-rate" not in script

def test_test_generations_reuses_normal_folder_review_for_assessment():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert 'id="test-generations-session-name"' in html
    assert 'id="test-generations-open-results-btn"' not in html
    assert "var selectedCandidates = null;" in script
    assert "dataset.candidateSelect" in script
    assert "selectedFiles: selectedFiles" in script
    assert "selectedFiles: selectedCandidateFiles()" in script
    assert "Array.isArray(state.testGenerationSettings.selectedFiles)" in script
    assert "selectedCandidates = new Set(savedSelection === null ? files : savedSelection);" in script
    assert 'id="test-generations-master-select"' in html
    assert "function syncCandidateMasterSelect(files)" in script
    assert "master.indeterminate = selectedCount > 0 && selectedCount < available.length;" in script
    assert "baseName.textContent = 'Base';" in script
    assert "baseDetail.textContent = 'Reference comparison';" in script
    assert "baseInclude.checked = includeBase;" in script
    assert "baseInclude.disabled = true;" not in script
    assert "includeBase: includeBase" in script
    assert "var allSelected = !!files.length && files.every" in script
    assert "selectedCandidates = allSelected ? new Set() : new Set(files);" in script
    assert "name: name" in script
    assert "candidateScores" in script
    assert "function openResultsFolder(folder)" in script
    assert "setWorkspaceSurface('default')" in script
    assert "refreshCurrentDirectory();" in script
    assert "★ " in script

    staged_rule = css.split(".test-generations-staged-row {", 1)[1].split("}", 1)[0]
    assert "grid-template-columns: auto minmax(0, 1fr) auto;" in staged_rule



def test_test_generations_surfaces_save_and_selected_epoch_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert '"candidateMetadata": _staged_candidate_metadata(loras, model)' in backend
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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert "request('test_enqueue'" in script
    assert "request('test_queue', { modelId: modelId })" in script
    assert "request('test_queue_cancel'" in script
    assert "request('test_queue_clear', { modelId: currentTestModelId() })" in script
    assert "var queuedTestJobs = [];" in script
    assert "remove.dataset.queueCancel" in script
    assert "queueCancel.dataset.queueCancel" in script
    assert 'id="test-generations-clear-queue-btn"' in html
    assert "/fs/training_runner/stop" not in script
    assert "refreshTrainingRunnerStatus();" not in script
    assert "def enqueue(" in backend
    assert "def queued_jobs(" in backend
    assert "def cancel_queued(" in backend
    assert "def clear_queued(" in backend
    assert "def start_queued(" in backend
    assert 'operation == "test_enqueue"' in backend
    assert 'operation == "test_queue"' in backend
    assert 'operation == "test_queue_cancel"' in backend
    assert 'operation == "test_queue_clear"' in backend
    assert "EXECUTION_LANE = \"test-generations\"" in backend
    assert "execution_enqueue(" in backend
    assert "execution_claim_next(" in backend
    assert "_reserve_gpu_for_test_generations" in backend






def test_test_generations_rail_is_candidate_focused_without_source_browser():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'class="test-generations-library-panel test-generations-staged-panel"' in html
    assert 'id="test-generations-source-folders"' not in html
    assert "function refreshTestSourceBrowser()" not in script
    assert ".test-generations-source-folders" not in css
    assert "No staged candidates for this Set." in script
    assert "candidate' + (count === 1 ? '' : 's')" in script

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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    block = script.split("function renderStagedFiles(payload)", 1)[1].split("function sessionStatusText", 1)[0]
    assert "remove.dataset.fileName = String(fileName || '');" in block
    assert "remove.title = 'Remove this Test candidate';" in block
    assert "row.appendChild(remove);" in block

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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    render_block = script.split("function renderWildcardDirector()", 1)[1].split("function renderWildcardAnalysis", 1)[0]
    assert "sourceBrowser" not in render_block
    assert "button.disabled = wildcardDirector.busy || !wildcardDirector.modelId;" in render_block
    assert "Generate a wildcard prompt from this Set's captions" in render_block

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
    assert "wildcardValues.join(' · ')" in script
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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "currentSession =" not in render

    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]
    assert "selectSessionStatus(" not in poll
    assert "if (currentSession === activeSession)" in poll
    assert "else if (selectedPreviewLive)" in poll

    start = script.split("function startRun()", 1)[1].split("function stopRun", 1)[0]
    assert "selectSessionStatus(" not in start
    assert "if (currentSession === String(startedStatus.session || '')) renderStatus(startedStatus);" in start

    activity = script.split("function openTestBenchActivity(target)", 1)[1].split("function openTestBenchActivityMenu", 1)[0]
    assert "testActivity.active[0]" not in activity


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
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    candidates = (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")

    assert 'id="test-generations-candidates-btn"' in html
    assert "function syncCandidatesButton(payload)" in script
    assert "payload.candidateRuns" in script
    assert "runs.length === 1" in script
    assert "openTrainingCandidates({ id: jobId, folder: folder }" in script
    assert "refreshStagedFilesAfterCandidates" in script
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
    assert "strength.title = 'Strength';" in script
    assert "candidateStrengths: selectedStrengths" in script
    assert "Strength must be between -2 and 2." in script
    assert ".test-generations-candidate-strength" in css


def test_global_director_model_control_lives_in_header():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'id="app-header-director-control"' in html
    assert 'id="app-header-director-model"' in html
    assert 'id="app-header-director-refresh"' in html
    assert "function refreshApplicationDirectorModels()" in shell
    assert "setDirectorModelPreference('webcap.director.model'" in shell
    assert "webcap:director-model-changed" in shell
    assert ".app-header-director-control" in css
    assert "column-gap: 12px;" in css
    assert 'id="test-generations-wildcard-model"' not in html
    assert ".generate-director-model-tools > select" in css
    assert ".storyboard-director-model-tools" in css
    assert ".director-chat-model-tools" in css


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
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    enqueue_block = script.split("request('test_enqueue'", 1)[1].split("function stopRun", 1)[0]
    assert "var startedStatus = payload && payload.latest ? payload.latest : null;" in enqueue_block
    assert "selectSessionStatus(startedStatus);" in enqueue_block
    assert "if (currentSession === String(startedStatus.session || '')) renderStatus(startedStatus);" not in enqueue_block


def test_results_header_renders_persisted_wildcard_values():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    meta_block = script.split("function renderSessionMeta(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "Array.isArray(status.wildcardValues)" in meta_block
    assert "wildcardTagline.textContent = wildcardValues.join(' · ');" in meta_block
