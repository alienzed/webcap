from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assert 'id="test-generations-pane"' in html
    assert "test-generations-modal" not in script
    assert "el('test-generations-workspace')" in script
    assert "training-tests-actions" in script
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
    assert "detail.textContent = String(failure.error || 'Generation failed.');" in script
    assert "(results.length + failures.length) < total" in script
    assert "host.innerHTML = html" not in script
    assert "Previews appear as each LoRA finishes." in script
    assert "aspectRatio: aspectRatio" in script
    assert "megapixels: megapixels" in script
    assert "duration: duration" in script
    assert "seed: seed" in script

    assert ".test-generations-pane" in css
    assert ".test-generations-workspace" in css
    assert ".test-generations-results" in css
    assert ".test-generations-result-card video" in css
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
    assert "grid-template-columns: repeat(auto-fill, 280px);" in results_rule
    assert "justify-content: start;" in results_rule
    assert "flex: 1 1 0;" in results_rule
    assert "grid-auto-rows: max-content;" in results_rule

    video_rule = css.split(".test-generations-result-card video {", 1)[1].split("}", 1)[0]
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


def test_recent_test_sets_are_workspace_history_not_current_set_details():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    rail_start = html.index('<aside class="test-generations-rail">')
    rail_end = html.index('</aside>', rail_start)
    recent_list = html.index('id="test-generations-recent-sets-list"')
    render_block = script.split("function renderRecentTestSets(items)", 1)[1].split("function syncActivityButton(payload)", 1)[0]

    assert rail_start < recent_list < rail_end
    assert '<details id="test-generations-recent-drawer"' not in html
    assert "sessionCount" in render_block
    assert "item.completed" not in render_block
    assert "item.total" not in render_block
    assert "item.failed" not in render_block
    assert "item.status" not in render_block
    assert ".test-generations-recent-sets" in css
    assert "flex-direction: column;" in css


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
    assert "removeCandidate(remove.dataset.removeCandidate, currentSession)" in script
    assert "button.disabled = false;" in script
    assert "queueCancel.disabled = false;" in script
    assert "remove.disabled = false;" in script
    assert "row.dataset.sessionName = name;" in script
    assert "row.dataset.queueJobId = String(job.id || '');" in script
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
    assert ".test-generations-result-footer" in css


def test_active_session_row_uses_live_polled_progress():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function sessionStatusText(session)" in script
    assert "function syncVisibleSessionProgress(status)" in script
    assert "meta.textContent = sessionStatusText(session);" in script
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
    assert "window.refreshTestBenchActivity = refreshActivityButton" in script
    assert "activityButton.classList.toggle('test-running', !!active)" in script
    assert ".activity-rail-btn.test-running::after" in (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    assert "window.testGenerationsFolderLoaded()" in ui_script

    assert "function setRunSettingsDisabled" not in script
    controls_block = script.split("function syncActiveRunControls(status)", 1)[1].split("function renderStatus(status)", 1)[0]
    assert "runBtn.disabled = active" not in controls_block
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;" in controls_block
    assert "test-generations-stop-btn" not in script
    assert "dataset.sessionStop = name;" in script
    assert "stopRun(stop);" in script
    assert ".disabled = !!disabled" not in controls_block

    assert "if (!currentSession || currentSession === activeSession)" in script
    assert "savedPrompt.trim()" in script
    assert "saveTestBenchState(prompt);" in script
    assert "if (nextSeed) nextSeed.value = String(randomSeed());" in script



def test_live_test_status_surfaces_comfy_job_progress_and_errors_to_console():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function formatElapsedMs(milliseconds)" in script
    assert "function liveStatusDetails(status)" in script
    assert "Comfy ' + comfyStatus" in script
    assert "Job ' + jobId.slice(0, 8)" in script
    assert "candidateStartedAt || status.startedAt" in script
    assert "comfyLastContactAt" in script
    assert "liveStatusDetails(status)" in script
    assert "console.error('[Test Generations]', err);" in script


def test_compare_polling_preserves_video_elements_and_refreshes_navigation_only():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    compare_block = script.split("function renderCompare(status)", 1)[1].split("function renderResults(status)", 1)[0]

    assert "var compareKey = resultFolder + '|'" in compare_block
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
    assert "video.muted = true;" in compare_block



def test_test_bench_shows_frozen_session_metadata_separately_from_next_run():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "Next run" in script
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
    assert "status.aspectRatio" in script
    assert "status.megapixels" in script
    assert "status.duration" in script
    assert "status.seed" in script
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
    assert "test-generations-form-title" in script
    assert "? 'Test Generations'" in shell
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


def test_recent_test_sets_reuse_existing_session_history():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert 'id="test-generations-recent-sets-list"' in html
    assert "def recent_test_sets(limit=8):" in backend
    assert '"recent": recent_test_sets()' in backend
    assert "function renderRecentTestSets(items)" in script
    assert "function openTestBenchFolder(folder)" in script
    assert "data.recentTestOpen" not in script
    assert "dataset.recentTestOpen" in script


def test_test_execution_is_h3_gated_even_when_workspace_is_opened_indirectly():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    assert "function isTestModelSupported()" in script
    assert "runBtn.disabled = !prepared || !prepared.count || !selectedCandidateFiles().length || !supported;" in script
    assert "if (!isTestModelSupported())" in script
    assert "New Test runs currently require MiniMax H3 as the working model." in script
    assert "syncLaunchVisibility();" in script[script.index("function testGenerationsFolderLoaded()"):script.index("function stagedFileParts(", script.index("function testGenerationsFolderLoaded()"))]
    assert "syncActiveRunControls(currentStatus);" in script
    assert ".test-generations-video-transport, video, button" in script


def test_recent_test_sets_are_cached_during_active_test_polling():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    assert '_recent_sets_cache = {"expires": 0.0, "items": []}' in backend
    assert 'time.monotonic() + 10.0' in backend


def test_saved_test_history_does_not_require_external_staging_folder():
    backend = (ROOT / "tool" / "server" / "epoch_test_bench.py").read_text(encoding="utf-8")

    prepare_start = backend.index("def prepare(folder_path):")
    prepare_end = backend.index("\ndef status(", prepare_start)
    prepare = backend[prepare_start:prepare_end]
    assert "except ValueError:" in prepare
    assert "loras = []" in prepare
    assert '"sessions": list_sessions(folder_path)' in prepare
    start_start = backend.index("def start_queued(folder_path")
    assert "_h3_test_directory(folder_path)" in backend[start_start:]
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
    assert 'id="test-generations-open-results-btn"' in html
    assert "var selectedCandidates = null;" in script
    assert "dataset.candidateSelect" in script
    assert "selectedFiles: selectedFiles" in script
    assert "selectedFiles: selectedCandidateFiles()" in script
    assert "Array.isArray(state.testGenerationSettings.selectedFiles)" in script
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
    assert "function openResultsFolder(folder)" in script
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
    assert "def start_queued(" in backend
    assert 'operation == "test_enqueue"' in backend
    assert 'operation == "test_queue"' in backend
    assert 'operation == "test_queue_cancel"' in backend
    assert 'operation == "test_queue_clear"' in backend
    assert "_pending_tests = []" in backend
    assert "_reserve_gpu_for_test_generations" in backend
    assert "_queue_retry" not in backend
    assert "Pause Training before starting Test Generations." in backend
    assert "enqueue_test_response" not in backend




def test_test_generations_rail_has_clear_working_history_navigation_hierarchy():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'class="test-generations-library-panel test-generations-staged-panel"' in html
    assert 'class="test-generations-library-section test-generations-sessions"' in html
    assert 'class="test-generations-library-section test-generations-recent-sets"' in html
    assert "grid-template-columns: minmax(400px, 430px) minmax(0, 1fr);" in css
    assert ".test-generations-library-section > .test-generations-library-heading" in css
    assert ".test-generations-recent-sets {" in css

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

    assert 'id="test-generations-rail-toggle-btn"' in html
    assert "function syncTestRailCollapseUi()" in script
    assert "function toggleTestRailCollapsed()" in script
    assert "el('test-generations-rail-toggle-btn').onclick = toggleTestRailCollapsed;" in script
    assert ".test-generations-body.test-generations-rail-collapsed {" in css
    assert ".test-generations-body.test-generations-rail-collapsed .test-generations-rail {" in css
    assert ".test-generations-rail-toggle-btn {" in css

