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


def test_test_seed_uses_shared_32_bit_range():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert 'id="test-generations-seed" type="number" min="0" max="4294967295"' in html
    assert "var values = new Uint32Array(1);" in script
    assert "return values[0];" in script


def test_test_results_header_promotes_view_tabs_and_keeps_rate_as_the_only_action():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'class="test-generations-view-tabs" role="tablist"' in html
    assert 'id="test-generations-view-grid-btn"' in html
    assert 'id="test-generations-view-compare-btn"' in html
    assert 'id="test-generations-rate-items-btn"' in html
    assert 'id="test-generations-open-results-btn"' not in html
    assert 'class="test-generations-results-actions"' in html
    assert "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);" in css
    assert ".test-generations-view-tab.active" in css
    assert "border-bottom-color: var(--accent);" in css
    assert "setAttribute('aria-selected'" in script


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-pane"' in html
    assert "test-generations-modal" not in script
    assert "el('test-generations-workspace')" in script
    assert "test-generations-run-btn" in script
    assert ".training-run-setup-actions" not in script
    assert "document.querySelector('.editor-surface')" not in script
    assert "test-generations-active" not in script
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
    assert "reportConsoleError(" in script
    assert "String(failure.error || 'Generation failed.')" in script
    assert "(results.length + failures.length) < total" in script
    assert "host.innerHTML = html" not in script
    assert "pendingPlaceholder.textContent = 'Generating…';" in script
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
    assert "grid-template-columns: repeat(auto-fill, 500px);" in results_rule
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


def test_test_activity_is_permanent_and_recent_sets_are_not_in_the_test_pane():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="activity-test-btn" type="button" class="activity-rail-btn"' in html
    assert 'id="test-generations-recent-sets-list"' not in html
    assert "function renderRecentTestSets(items)" not in script
    assert ".test-generations-recent-sets" not in css
    assert "activityButton.classList.remove('hidden');" in script


def test_test_activity_primary_click_respects_current_set_before_global_activity():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    block = script.split("function openTestBenchActivity()", 1)[1].split("function openTestBenchActivityMenu", 1)[0]
    assert "var currentFolder = String(state && state.folder || '');" in block
    assert "if (currentFolder)" in block
    assert "openTestBenchFolder(currentFolder);" in block
    assert block.index("openTestBenchFolder(currentFolder);") < block.index("testActivity.active")
    assert "if (active && active.folder) openTestBenchFolder(String(active.folder));" in block


def test_test_generation_sessions_and_candidate_removal_contract():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-sessions-count" in script
    assert "test-generations-sessions-list" in script
    assert "test_open_session" in script
    assert "test_delete_session" in script
    assert "dataRemoveCandidate" not in script
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
    assert "row.dataset.queueJobId = jobId;" in script
    assert "openSession(row.dataset.sessionName);" in script
    assert "open.dataset.sessionFolderOpen = resultFolder;" in script
    assert "rate.dataset.sessionRate = resultFolder;" in script
    assert "var unrated = Number(session.unrated || 0);" in script
    assert "rate.classList.toggle('hidden', !resultFolder || unrated <= 0);" in script
    assert "openResultsFolder(folderOpen.dataset.sessionFolderOpen);" in script
    assert "openResultsFolder(rate.dataset.sessionRate, { rateItems: true });" in script
    assert "open.dataset.sessionOpen" not in script
    assert ".test-generations-session-row" in css
    assert ".test-generations-session-row:not([data-queue-job-id])" in css
    assert ".test-generations-session-group" in css
    assert ".test-generations-session-progress" in css
    assert ".test-generations-result-footer" in css



def test_session_list_groups_running_queue_then_finished():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    block = script.split("function renderSessions(sessions, queuedJobs)", 1)[1].split("function refreshSessions()", 1)[0]

    assert "ensureGroup('running', 'Running', activeItems.length, 'is-running')" in block
    assert "ensureGroup('queued', 'Queued', queued.length, 'is-queued')" in block
    assert "ensureGroup('history', 'Finished', historyItems.length, 'is-history')" in block
    assert block.index("ensureGroup('running'") < block.index("ensureGroup('queued'")
    assert block.index("ensureGroup('queued'") < block.index("ensureGroup('history'")


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
    assert "meta.textContent = sessionStatusText(status);" in script
    render_block = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "syncVisibleSessionProgress(status || {});" in render_block


def test_test_generations_closes_on_training_navigation_and_clears_session_state():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "currentSession = String(status.session || '')" in script
    assert "function owningSetFolder(folder)" in script
    assert "launchFolder = owningSetFolder(state && state.folder || '')" in script
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
    assert "function openTestBenchActivity()" in script
    assert "window.testGenerationsFolderLoaded = testGenerationsFolderLoaded" in script
    assert "window.openTestBenchForFolder = openTestBenchFolder" in script
    assert "window.refreshTestBenchActivity = refreshActivityButton" in script
    assert "activityButton.classList.toggle('test-running', !!active)" in script
    assert ".activity-rail-btn.test-running::after" in (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    assert "window.testGenerationsFolderLoaded()" in ui_script

    assert "function setRunSettingsDisabled" not in script
    controls_block = script.split("function syncActiveRunControls(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "runBtn.disabled = active" not in controls_block
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;" in controls_block
    assert 'id="test-generations-stop-btn"' not in html
    assert "function syncActiveTestCard(status)" not in script
    assert "stop.dataset.sessionStop = name;" in script
    assert "request('test_stop', { session: String(stopBtn && stopBtn.dataset.sessionStop || '') })" in script
    assert ".disabled = !!disabled" not in controls_block

    assert "if (!currentSession || currentSession === activeSession)" in script
    assert "function savedTestModelState()" in script
    assert "function captureTestBenchSave(prompt)" in script
    assert "state.testGenerationByModel[modelId]" in script
    assert "saveTestBenchState(prompt);" in script
    assert "if (nextSeed) nextSeed.value = String(randomSeed());" in script



def test_selected_test_session_rehydrates_across_navigation_and_queue_handoff():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "var currentSessionFolder = '';" in script
    assert "var currentSessionModel = '';" in script
    assert "currentSessionFolder === launchFolder" in script
    assert "currentSessionModel === requestedModelId" in script
    assert "request('test_open_session', { session: rememberedSession })" in script
    assert "var selectedWasLive = !!(" in script
    assert "currentSession !== activeSession" in script
    assert "request('test_open_session', { session: currentSession })" in script


def test_test_polling_keeps_active_worker_status_separate_from_selected_preview():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]

    assert "syncActiveRunControls(status);" in poll
    assert "if (!currentSession || currentSession === activeSession)" in poll
    assert "else if (selectedWasLive)" in poll
    assert "renderStatus(selectedStatus);" in poll


def test_active_test_state_lives_in_stable_session_rows_separate_from_selected_results():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-active"' not in html
    assert "function syncVisibleSessionProgress(status)" in script
    assert "row.dataset.sessionName = name;" in script
    assert "stop.dataset.sessionStop = name;" in script
    poll = script.split("function pollStatus()", 1)[1].split("function showError", 1)[0]
    assert "var activeSession = String(status && status.session || '');" in poll
    assert "if (!currentSession || currentSession === activeSession)" in poll
    assert "else if (selectedWasLive)" in poll
    render = script.split("function renderStatus(status)", 1)[1].split("function pollStatus()", 1)[0]
    assert "syncVisibleSessionProgress(status || {});" in render
    assert "statusEl.textContent = live ? '' : statusText(status);" in render
    assert ".test-generations-session-progress" in css
    assert ".test-generations-stop-btn {" in css


def test_live_test_status_surfaces_comfy_job_progress_and_errors_to_console():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function formatElapsedMs(milliseconds)" in script
    assert "function liveStatusDetails(status)" in script
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

    assert "function buildResultRating(result, resultFolder)" in script
    assert "function rateTestResult(button)" in script
    assert "function syncResultRatingButtons(resultFolder, mediaFile, rating)" in script
    assert "setMediaRating(resultFolder, mediaFile, rating)" in script
    assert "star.dataset.ratingFolder = ratingFolder;" in script
    assert "var rating = buildResultRating(result, opts.resultFolder);" in script
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

    sync_block = script.split("function syncResultRatingButtons(resultFolder, mediaFile, rating)", 1)[1].split("function rateTestResult(button)", 1)[0]
    assert "document.querySelectorAll" in sync_block
    assert "star.classList.toggle('active', active);" in sync_block
    assert "star.textContent = active ? '★' : '☆';" in sync_block

    rate_block = script.split("function rateTestResult(button)", 1)[1].split("function buildResultFooter", 1)[0]
    assert "var resultFolder = String(button && button.dataset.ratingFolder || '').trim();" in rate_block
    assert "setMediaRating(resultFolder, mediaFile, rating)" in rate_block
    assert "syncResultRatingButtons(resultFolder, mediaFile, payload && payload.rating);" in rate_block
    assert "request('test_rating_summary'" in rate_block
    assert "request('test_rate_result'" not in script


def test_result_card_transport_remains_always_visible_without_toggle():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    transport = script.split("function appendTestPreviewVideo(container, video)", 1)[1].split("function setResultsView(mode)", 1)[0]
    assert "video.controls = false;" in transport
    assert "container.appendChild(transport);" in transport
    assert "controlsToggle" not in script
    assert "toggleControls" not in script


def test_compare_polling_preserves_video_elements_and_refreshes_navigation_only():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]

    assert "var compareKey = resultFolder + '|'" in compare_block
    assert "host.dataset.compareKey = compareKey" in compare_block
    assert "host.querySelector('.test-generations-compare-stage')" in compare_block
    assert "existingPrevious.disabled = compareIndex <= 0;" in compare_block
    assert "existingNext.disabled = compareIndex >= results.length - 2;" in compare_block
    assert "existingPosition.textContent = (compareIndex + 1) + ' / ' + (results.length - 1);" in compare_block
    stable_branch = compare_block.index("if (String(host.dataset.compareKey || '') === compareKey")
    rebuild = compare_block.index("host.innerHTML = '';")
    assert stable_branch < compare_block.index("existingNext.disabled = compareIndex >= results.length - 2;", stable_branch)
    assert compare_block.index("return;", stable_branch) < rebuild
    assert "if (resultsView === 'compare') renderCompare(status || {});" in script



def test_compare_videos_start_muted():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]
    preview_block = script.split("function appendTestPreview(container, resultFolder, result, options)", 1)[1].split("function candidateFileForResult", 1)[0]
    assert "appendTestPreview(item, resultFolder, result, { muted: true })" in compare_block
    assert "video.muted = !!(options && options.muted);" in preview_block



def test_test_bench_shows_frozen_session_metadata_separately_from_next_run():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assert "Next run" in html
    assert "test-generations-session-meta" in script
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
    assert "var settings = status.settings && typeof status.settings === 'object' ? status.settings : status;" in script
    assert "settings.aspectRatio" in script
    assert "settings.megapixels" in script
    assert "settings.duration" in script
    assert "settings.dimensions" in script
    assert "settings.seed" in script
    assert ".test-generations-session-details" in css
    assert ".test-generations-session-info-grid" in css
    assert ".test-generations-session-detail-column" not in css
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
    assert "Run details" not in details_block
    assert "test-generations-session-detail-grid" not in details_block
    assert details_block.index("renderPromptExpectations(resolvedPrompt)") < details_block.index("test-generations-session-prompts")


def test_test_identity_is_owned_by_shell_header():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert "test-generations-close-btn" not in script
    assert "test-generations-header" not in script
    assert ".test-generations-header" not in css
    assert "test-generations-form-title" not in script
    assert "workspaceTitle.textContent = 'Test Generations'" in shell
    assert "window.closeTestBenchActivity" in shell

def test_test_generations_canonicalizes_session_paths_to_owning_set():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function owningSetFolder(folder)" in script
    assert "var marker = '/test-generations/'" in script
    assert "folder: owningSetFolder(launchFolder || (state && state.folder) || '')" in script
    assert "operation: operation" in script
    assert "body.criteria = criteria" in script
    assert "fetch('/fs/test_generations'" in script
    assert "__test_generations__" not in script
    assert "fetch('/fs/training_setup'" not in script
    assert "launchFolder = owningSetFolder(state && state.folder || '')" in script


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
    assert "document.createElement('section')" in script
    assert "group.dataset.sessionGroup = key;" in script
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


def test_test_activity_menu_reuses_recent_session_history_for_explicit_cross_set_navigation():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert "def recent_test_sets(limit=8):" in backend
    assert '"recent": recent_test_sets()' in backend
    assert "function buildTestActivityContextActions()" in script
    assert "function openTestBenchActivityMenu(event)" in script
    assert "showContextMenu(event.clientX, event.clientY, actions);" in script
    assert "activityButton.oncontextmenu = openTestBenchActivityMenu;" in script
    assert "recentActions.length >= 5" in script
    assert "folder === currentFolder" in script
    assert "seen[folder]" in script
    assert "function openTestBenchFolder(folder)" in script


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


def test_saved_test_history_does_not_require_external_staging_folder():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    prepare_start = backend.index("def prepare(folder_path, model_id=None):")
    prepare_end = backend.index("\ndef status(", prepare_start)
    prepare = backend[prepare_start:prepare_end]
    assert "except ValueError:" in prepare
    assert "loras = []" in prepare
    assert '"sessions": list_sessions(folder_path)' in prepare
    enqueue_start = backend.index("def enqueue(folder_path")
    assert "_test_directory(folder_path, model)" in backend[backend.index("def _new_inference_request("):enqueue_start]
    assert 'operation == "test_start"' not in backend

def test_test_generations_rate_items_reuses_unrated_single_item_review():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")

    assert 'id="test-generations-rate-items-btn"' in html
    assert "openResultsFolder(this.dataset.resultFolder, { rateItems: true });" in script
    assert "function initializeRatingReview(folder)" in script
    assert "clearCaptionFilterInputs();" in script
    assert "querySelector('input[value=\"no_star\"]')" in script
    assert "noStarInput.checked = true;" in script
    assert "var unratedItems = getFilteredMediaItems(false);" in script
    assert "selectPathMedia(unratedItems[0])" in script
    assert "function completeRatingReviewIfFinished()" in script
    assert "if (!hasOnlyUnratedFilter()) return false;" in script
    assert "if (getFilteredMediaItems(false).length) return false;" in script
    assert "clearCaptionFilterInputs();" in script
    assert "openTestBenchFolder(setFolder);" in script
    assert "window.testGenerationsRatingChanged = completeRatingReviewIfFinished;" in script
    assert "window.testGenerationsRatingChanged();" in item_details


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
    assert "Array.isArray(savedSettings.selectedFiles)" in script
    assert "selectedCandidates = new Set(savedSelection === null ? files : savedSelection);" in script
    assert 'id="test-generations-master-select"' in html
    assert 'id="test-generations-select-all-btn"' not in html
    assert 'id="test-generations-deselect-all-btn"' not in html
    assert "function syncCandidateMasterSelect(files)" in script
    assert "master.indeterminate = selectedCount > 0 && selectedCount < available.length;" in script
    assert "baseName.textContent = 'Base';" in script
    assert "baseDetail.textContent = 'Reference comparison';" in script
    assert "baseInclude.checked = includeBase;" in script
    assert "baseInclude.disabled = true;" not in script
    assert "includeBase: includeBase" in script
    assert "var allSelected = !!files.length && files.every" in script
    assert "selectedCandidates = allSelected ? new Set() : new Set(files);" in script
    assert 'id="test-generations-reset-prompt-btn"' not in html
    assert "test-generations-reset-prompt-btn" not in script
    assert "name: name" in script
    assert "candidateScores" in script
    assert "function openResultsFolder(folder, options)" in script
    assert "setWorkspaceSurface('default')" in script
    assert "refreshCurrentDirectory();" in script
    assert "★ " in script

    staged_rule = css.split(".test-generations-staged-row {", 1)[1].split("}", 1)[0]
    assert "grid-template-columns: auto minmax(0, 1fr) auto;" in staged_rule


def test_test_generations_queue_contract():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    assert "request('test_enqueue'" in script
    assert "request('test_queue')" in script
    assert "request('test_queue_cancel'" in script
    assert "request('test_queue_clear')" in script
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
    assert "def start_queued(" not in backend
    assert 'operation == "test_enqueue"' in backend
    assert 'operation == "test_queue"' in backend
    assert 'operation == "test_queue_cancel"' in backend
    assert 'operation == "test_queue_clear"' in backend
    assert 'SHARED_EXECUTION_LANE = "inference"' in backend
    assert "inferenceJobs" in backend
    assert "execution_lane_snapshot(SHARED_EXECUTION_LANE" in backend
    assert "_reserve_gpu_for_test_generations" not in backend
    assert "_queue_retry" not in backend
    assert "Pause Training before starting Test Generations." not in backend
    assert "enqueue_test_response" not in backend




def test_test_generations_rail_stays_scoped_to_current_set_work():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'class="test-generations-library-panel test-generations-staged-panel"' in html
    assert 'class="test-generations-library-panel test-generations-sessions"' in html
    assert 'class="test-generations-library-section test-generations-recent-sets"' not in html
    assert "grid-template-columns: minmax(400px, 430px) minmax(0, 1fr);" in css

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

