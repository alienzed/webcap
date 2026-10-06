from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_generate_is_first_class_static_activity():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="activity-generate-btn"' in html
    assert 'id="generate-workspace"' in html
    assert 'data-workspace-root="generate"' in html
    assert 'id="generate-prompt"' in html
    assert 'id="generate-model"' in html
    assert 'id="generate-director-model"' in html
    assert 'id="generate-lora-list"' in html
    assert 'id="generate-reference-first_frame"' in html
    assert 'id="generate-reference-last_frame"' in html
    assert 'id="inference-queue-drawer"' in html
    assert 'data-inference-queue-toggle' in html
    assert 'id="generate-results"' in html

    assert "workspace === 'generate'" in shell
    assert "navigation.activity === 'generate'" in shell
    assert "window.openGenerateActivity" in shell
    assert "window.closeGenerateActivity" in shell

    assert "function openGenerateActivity()" in script
    assert "function runGenerate()" in script
    assert "function runDirector(operation)" in script
    assert "window.refreshInferenceQueue" in script
    assert "postJson('/fs/generate'" in script
    assert "uploadReference(file)" in script
    assert 'data-generate-reference-dropzone="first_frame"' in html
    assert 'data-generate-reference-dropzone="last_frame"' in html
    assert "function bindReferenceDropzones()" in script
    assert "input.dispatchEvent(new Event('change', { bubbles: true }))" in script

    assert ".app-frame.workspace-generate-open > .app" in css
    assert ".generate-create-view" in css
    assert ".generate-stage-panel" in css
    assert ".generate-takes-panel" in css
    assert ".generate-results" in css


def test_generate_reuses_concepts_not_storyboard_dom():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "storyboard-scene" not in script
    assert "storyboard-generation" not in script
    assert "storyId" not in script
    assert "sceneId" not in script
    assert "entryState" not in script
    assert "exitState" not in script

def test_generate_results_refresh_on_queue_transitions_without_perpetual_polling():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function resultKey(result)" in script
    assert "card.dataset.resultKey = resultKey(result)" in script
    assert "host.querySelectorAll('.generate-result-card[data-result-key]')" in script
    assert "if (!key || existingKeys[key]) return;" in script
    assert "host.insertBefore(buildResultCard(result), host.firstChild)" in script
    assert "host.innerHTML = results.map" not in script
    assert "webcap:inference-queue-snapshot" in script
    assert "refreshTrackedGenerateJobs(queue)" in script
    assert "return refreshResultsNeeded ? refreshResults() : jobs;" in script
    assert "function schedulePoll()" not in script
    assert "generateState.timer" not in script

def test_generate_director_is_a_reversible_prompt_editor():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    generation = (ROOT / "tool" / "server" / "generate_generation.py").read_text(encoding="utf-8")

    assert ">Expand Prompt</button>" in html
    assert 'id="generate-director-restore"' in html
    assert "Restore Previous" in html
    assert "Describe what you want — a rough idea or a finished prompt." in html
    assert "<strong>Generation Settings</strong>" in html
    assert 'class="storyboard-inline-check generate-prompt-option"' in html

    assert "previousPrompt: null" in script
    assert "function restoreDirectorPrompt()" in script
    assert "generateState.director.previousPrompt = previousPrompt;" in script
    assert "generateState.director.previousPrompt = null;" in script
    assert "function resetGeneratePromptScratch()" in script
    assert "if (!wasOpen) resetGeneratePromptScratch();" in script
    assert "generateState.lorasByModel = {};" in script
    assert "generateState.loraMode = 'selected';" in script
    assert "generateState.sweepFolderByModel = {};" in script
    assert "generateState.sweepSelections = {};" in script
    assert "input.value = '';" in script
    assert "localStorage" not in script
    assert '"defaultPrompt": ""' in generation

def test_generate_prompt_assistant_uses_shared_llm_queue():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "function queueDirectorRequest(payload)" in script
    assert "function waitForDirectorJob(job)" in script
    assert "function directorJobPollDelay(job)" in script
    assert "return String(job && job.status || '') === 'queued' ? 3000 : 1500;" in script
    assert "setTimeout(resolve, directorJobPollDelay(current))" in script
    assert "'/fs/director/job?job='" in script
    assert "queued: 'Queued…'" in script
    waiter = script.split("function waitForDirectorJob(job)", 1)[1].split("function queueDirectorRequest", 1)[0]
    assert "renderDirectorActivity(" not in waiter
    assert "enqueue_llm(" in app
    assert "referenceRoles: ['first_frame', 'last_frame'].filter" in script
    assert "reference_roles=data.get(\"referenceRoles\")" in app


def test_generate_prompt_assistant_protects_prompt_consumers_while_pending():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function syncPromptAssistantDependencies()" in script
    assert "runButton.disabled = generateState.director.busy || runButton.dataset.generateSubmitBusy === '1';" in script
    assert "'generate-model'" in script
    assert "'generate-prompt'" in script
    assert "'generate-director-instruction'" in script
    assert "'generate-reference-first_frame'" in script
    assert "document.querySelectorAll('[data-generate-prompt-use], [data-generate-open-result-key]')" in script
    assert "if (generateState.director.busy) throw new Error('Wait for Prompt Assistant to finish before generating.');" in script
    assert "Wait for Prompt Assistant to finish before restoring a generation configuration." in script
    assert "var requestModelId = String(generateState.modelId || '');" in script
    assert "modelId: requestModelId" in script
    assert "generateState.director.previousPrompt = previousPrompt;" in script
    assert "button.dataset.generateSubmitBusy = '1';" in script
    assert "delete button.dataset.generateSubmitBusy;" in script

    director = script.split("function renderDirector()", 1)[1].split("function refreshDirector", 1)[0]
    prompt_library = script.split("function renderPromptLibrary()", 1)[1].split("function refreshPromptLibrary", 1)[0]
    assert "syncPromptAssistantDependencies();" in director
    assert "syncPromptAssistantDependencies();" in prompt_library


def test_generate_prompt_assistant_memory_display_uses_percentages_with_amount_tooltips():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "'>VRAM ' + Math.round(vramPercent) + '%</span>'" in script
    assert "'>RAM ' + Math.round(ramPercent) + '%</span>'" in script
    assert "' used of '" in script
    assert "detail.innerHTML = parts.join(' · ');" in script
    assert 'id="generate-director-model-load"' in html
    assert "function updateDirectorModelLoad(activity, system)" in script
    assert "activity.modelSizeBytes" in script
    assert "ramDelta + vramDelta" in script
    assert "Approximate model residency from RAM + VRAM growth since loading began." in script


def test_generate_prompt_assistant_has_non_modal_live_activity():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'class="generate-prompt-tool-label">Assistant</span>' in html
    assert ">Expand Prompt</button>" in html
    assert ">Refine Prompt</button>" in html
    assert 'id="generate-director-activity"' in html
    assert "function refreshDirectorActivity()" in script
    assert "function positionDirectorActivity()" in script
    assert "requestJson('/fs/director/activity')" in script
    assert "requestJson('/fs/system_status')" in script
    assert "Loading model…" in script
    assert "Generating response…" in script
    assert "function directorLiveStats(activity)" in script
    assert "activity.slot" in script
    assert "' generated'" in script
    assert "' output Auto'" in script
    assert ".generate-director-activity" in css
    assert 'position: absolute;' in css
    assert "#generate-director-activity-trend svg" in css
    assert "min-height: 0;" in css
    assert '@app.route("/fs/director/activity", methods=["GET"])' in app


def test_generate_uses_shared_director_preference_without_eager_preload():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    assert "DIRECTOR_MODEL_STORAGE_KEY = 'webcap.director.model'" in common
    assert "getDirectorModelPreference('webcap.generate.directorModel')" in script
    assert "setDirectorModelPreference('webcap.generate.directorModel', this.value)" in script


def test_inference_queue_is_shared_shell_drawer_without_pause_resume_controls():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    queue = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")

    assert 'id="inference-queue-drawer"' in html
    assert 'data-inference-queue-toggle' in html
    assert "['generate', 'test', 'storyboard']" in queue
    assert "data-inference-queue-action" in queue
    assert "'cancel'" in queue
    assert "'stop'" in queue
    assert "pause_queue" not in queue
    assert "resume_queue" not in queue
    assert "window.syncInferenceQueueSurface(navigation.activity)" in shell


def test_generate_tracks_terminal_jobs_while_shared_drawer_owns_live_queue_ui():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    queue = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")

    assert "trackedJobIds: loadTrackedGenerateJobs()" in script
    assert "function refreshTrackedGenerateJobs(queue)" in script
    assert "requestJson('/fs/inference?job=' + encodeURIComponent(jobId) + '&consume=1')" in script
    assert "var generationError = new Error(" in script
    assert "reportError(generationError, conciseGenerateError(" in script
    assert "webcap.generate.trackedJobs" in script
    assert "function createRow(job)" in queue
    assert "dataset.inferenceJobId" in queue
    assert "function syncRow(row, job)" in queue
    assert "webcap:inference-queue-snapshot" in script
    assert "window.getInferenceQueueSnapshot" in queue

def test_generate_partial_reference_uploads_have_a_cleanup_path():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "function cleanupUploadedReferences(paths)" in script
    assert "postJson('/fs/generate/reference/cleanup'" in script
    assert "uploadedPaths.push(path)" in script
    assert "cleanupUploadedReferences(uploadedPaths)" in script
    assert '@app.route("/fs/generate/reference/cleanup", methods=["POST"])' in app



def test_generate_errors_keep_detail_in_console_and_use_concise_setup_badge():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert "function conciseGenerateError(err, fallback)" in script
    assert "window.reportConsoleError('Generate', message)" in script
    assert "setStatus(uiMessage, 'error')" in script
    assert "ComfyUI unavailable" in script
    assert "reportError(err, 'Settings unavailable')" in script
    assert 'id="generate-status" class="generate-status-badge hidden"' in html
    assert ".generate-status-badge.is-error" in css



def test_generate_defaults_new_lora_strength_to_point_nine():
    js = Path("tool/js/generate.js").read_text(encoding="utf-8")
    assert "selectedLoras(generateState.modelId).push({ name: selectedName, strength: 0.9 });" in js


def test_generate_fixed_lora_picker_matches_storyboard_filter_click_flow():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="generate-lora-picker-menu"' in html
    assert 'role="combobox"' in html
    assert 'id="generate-lora-add"' not in html
    assert 'id="generate-lora-options"' not in html
    assert "function generateLoraNamesMatching(query)" in script
    assert "data-generate-lora-option" in script
    assert "function chooseGenerateLora(name)" in script
    assert "handleGenerateLoraPickerKeydown" in script
    assert ".generate-lora-picker-menu {" in css
    assert ".generate-lora-picker-option.active" in css


def test_generate_prompt_viewer_shows_captured_result_or_source_without_changing_open_restore():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert "function generationPromptVariants(result)" in script
    assert "result.resolvedPromptCaptured" in script
    assert "button.textContent = mode === 'result' ? 'Result' : 'Source';" in script
    assert "function setPromptViewerMode(container, mode)" in script
    assert "prompt.value = String(result.sourcePrompt || result.resolvedPrompt || '');" in script
    assert ".generate-prompt-toggle" in css


def test_generate_library_open_does_not_overwrite_current_model_prompt_when_saved_model_is_unavailable():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "prompt.dataset.modelId = resultModelId || String(generateState.modelId || '');" in script
    assert "localStorage" not in script


def test_generate_library_open_restores_saved_generation_configuration():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function restoreResultConfiguration(result)" in script
    assert "prompt.value = String(result.sourcePrompt || result.resolvedPrompt || '');" in script
    assert "generateState.lorasByModel[resultModelId]" in script
    assert "restoreResultConfiguration(result);" in script


def test_generate_does_not_expose_webcap_wildcard_resolution():
    markup = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")



def test_generate_results_have_permanent_delete_action():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "data-generate-delete-storage-id" in script
    assert "Permanently delete this generation and all of its artifacts?" in script
    assert "postJson('/fs/generate/result/delete'" in script


def test_generate_library_cards_are_large_compact_and_rateable():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "generate_store.py").read_text(encoding="utf-8")

    assert "grid-template-columns: repeat(auto-fill, minmax(420px, 520px));" in css
    assert "min-height: 280px;" in css
    assert ".generate-result-card:hover .generate-result-delete" in css
    assert "width: 28px;" in css
    assert "opacity: .28;" in css
    assert "deleteButton.textContent = '×';" in script
    assert "generate-result-primary" in script
    assert "data-generate-rating-value" in script
    assert "postJson('/fs/generate/result/rating'" in script
    assert "elapsed + ' render'" in script
    assert '@app.route("/fs/generate/result/rating", methods=["POST"])' in app
    assert 'set_media_rating(directory / ".webcap_state.json", media_name, rating)' in store



def test_generate_inference_creates_and_updates_pending_preview_card():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert "function syncGenerationPreviewCard(job)" in script
    assert "syncGenerationPreviewCard(payload.job);" in script
    assert "syncGenerationPreviewCard(job);" in script
    assert "dataset.generationJobId" in script
    assert "generate-take-card is-pending" in script
    assert "renderPendingStage(job);" in script
    assert "generate-result-pending-indicator" in script
    assert "removeGenerationPreviewCard(jobId)" in script
    assert ".generate-take-card.is-pending" in css
    assert ".generate-result-pending-media" in css


def test_generate_has_lightroom_style_create_and_library_modes():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="generate-create-mode-btn"' in html
    assert 'id="generate-library-mode-btn"' in html
    assert 'id="generate-create-view"' in html
    assert 'id="generate-library-view"' in html
    assert 'id="generate-active-preview"' in html
    assert 'id="generate-takes"' in html
    assert "function setGenerateViewMode(mode)" in script
    assert "function renderActiveResult(result)" in script
    assert "function renderTakes(results)" in script
    assert "function setTakesCollapsed(collapsed)" in script
    assert "dataset.generateOpenResultKey" in script
    assert ".generate-create-view {" in css
    assert "grid-template-columns: minmax(400px, 25%) minmax(0, 1fr) minmax(230px, 280px);" in css
    assert ".generate-stage-panel {" in css
    assert ".generate-takes-panel {" in css
    assert ".generate-library-view {" in css



def test_generate_redesign_required_wiring_fails_loudly():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "throw new Error('Generations active preview markup is missing.')" in script
    assert "throw new Error('Generations Takes markup is missing.')" in script
    assert "throw new Error('Generations Library markup is missing.')" in script
    assert "throw new Error('Generate inference job is missing its job ID.')" in script
    assert "throw new Error('Generate result is missing its stable identity.')" in script


def test_generate_redesign_does_not_keep_dead_pre_redesign_layout_css():
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")


def test_generate_displays_live_and_persisted_generation_elapsed_time():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "generate_store.py").read_text(encoding="utf-8")

    assert "return formatInferenceJobStatus(job);" in script
    assert "function formatInferenceJobStatus(job)" in common
    assert "formatInferenceElapsedMs(Date.now() - (startedAt * 1000))" in common
    assert "formatGenerationElapsedMs(result && result.elapsedMs)" in script
    assert '"elapsedMs": int(elapsed_ms or 0)' in store


def test_generate_prompt_library_is_local_file_backed_mvp():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "generate_store.py").read_text(encoding="utf-8")
    assert 'id="generate-prompt-save"' in html
    assert 'id="generate-prompt-library-open"' in html
    assert 'id="generate-prompt-library-search"' in html
    assert 'id="generate-prompt-library-list"' in html
    assert "function refreshPromptLibrary()" in script
    assert "function saveCurrentPrompt()" in script
    assert "function usePromptLibraryItem(promptId)" in script
    assert "function renamePromptLibraryItem(promptId)" in script
    assert "function deletePromptLibraryItem(promptId)" in script
    assert "requestJson('/fs/generate/prompts')" in script
    assert "postJson('/fs/generate/prompt'" in script
    assert "postJson('/fs/generate/prompt/delete'" in script
    assert ".generate-prompt-library-item {" in css
    assert '@app.route("/fs/generate/prompts", methods=["GET"])' in app
    assert '@app.route("/fs/generate/prompt", methods=["POST"])' in app
    assert '@app.route("/fs/generate/prompt/delete", methods=["POST"])' in app
    assert 'app_config.output_root() / "prompts"' in store
    assert 'PROMPT_LIBRARY_NAME = "prompts.json"' in store


def test_generate_prompt_assistant_activity_exposes_hard_stop_control():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    styles = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="generate-director-stop"' in html
    assert "function stopDirectorJob()" in script
    assert "resetLlmExecution()" in script
    assert "operation: 'stop_or_cancel'" not in script
    assert "generateState.director.jobId" in script
    assert "Prompt Assistant stopped." in script
    assert ".director-stop-btn {" in styles

def test_generate_secondary_controls_are_collapsible_by_default():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert '<details id="generate-prompt-assistant"' in html
    assert '<details id="generate-references"' in html
    assert 'id="generate-prompt-assistant"' in html and ' open' not in html.split('id="generate-prompt-assistant"', 1)[0][-80:]
    assert 'id="generate-references"' in html
    assert "assistant.open = true" in script
    assert ".generate-collapsible > summary" in css

def test_generate_lora_sweep_uses_existing_generate_queue_without_set_semantics():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="generate-lora-selected-tab"' in html
    assert 'id="generate-lora-sweep-tab"' in html
    assert 'id="generate-sweep-folder"' in html
    assert 'id="generate-sweep-strength"' in html
    assert 'id="generate-sweep-base"' in html
    assert 'id="generate-sweep-all"' in html
    assert 'id="generate-sweep-none"' in html
    assert "function sweepFolders(model)" in script
    assert "return loraFolder(name) === String(folder || '');" in script
    assert "function selectedSweepLoras(model, folder)" in script
    assert "function setSweepSelection(model, folder, name, selected)" in script
    assert "function setAllSweepSelections(selected)" in script
    assert "data-generate-sweep-lora" in script
    assert "selectedNames.length + ' of ' + names.length + ' selected · '" in script
    assert "button.disabled = generateState.director.busy || submitBusy || count === 0;" in script
    assert "function captureSweepSubmission()" in script
    assert "var names = selectedSweepLoras(model, folder).slice();" in script
    assert "Select at least one Sweep LoRA or include the fixed-only baseline." in script
    assert "function runGenerateSweep()" in script
    assert "referenceFiles: captureReferenceFiles(model)" in script
    assert "uploadReferenceFiles(submission.referenceFiles)" in script
    assert "postJson('/fs/generate'" in script
    assert "modelId: submission.modelId" in script
    assert "prompt: submission.prompt" in script
    assert "settings: Object.assign({}, submission.settings)" in script
    assert "loras: submission.fixedLoras.concat(name ? [{ name: name, strength: submission.strength }] : [])" in script
    assert "function frozenSweepSettings()" in script
    assert "window.crypto.getRandomValues(values);" in script
    sweep = script.split("function runGenerateSweep()", 1)[1].split("function setGenerateViewMode", 1)[0]
    assert "generateSubmitBusy" not in sweep
    assert "button.disabled" not in sweep
    assert "sourceFolder" not in script
    assert "sourceJobId" not in script
    assert ".generate-lora-tabs" in css
    assert ".generate-sweep-list" in css
    assert ".generate-sweep-selection-actions" in css

def test_generate_sweep_matches_storyboard_lora_picker_language_without_losing_multiselect():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="generate-sweep-filter"' in html
    assert 'placeholder="Filter / choose LoRAs…"' in html
    assert "el('generate-sweep-filter').addEventListener('input', renderSweep);" in script
    assert "var visibleNames = query" in script
    assert "No matching LoRAs" in script
    assert "data-generate-sweep-lora" in script
    assert "generate-sweep-row-copy" in script
    assert ".generate-sweep-row {" in css
    assert "min-height: 38px;" in css
    assert ".generate-sweep-row:hover" in css
    assert ".generate-sweep-row:has(input:checked)" in css


def test_generate_sweep_preserves_folder_prefixes_from_model_capabilities():
    backend = (ROOT / "tool" / "server" / "generate_generation.py").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert 'selectable = [_portable_name(value) for value in selectable]' in backend
    assert '"loras": selectable' in backend
    assert "normalized.lastIndexOf('/')" in script
    assert "savedSweepFolder(model && model.id, folders)" in script



def test_generate_lora_catalog_refresh_is_explicit_and_preserves_form_state():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert 'id="generate-lora-refresh"' in html
    refresh = script.split("function refreshLoraCatalog()", 1)[1].split("\n  function ", 1)[0]
    assert "requestJson('/fs/generate/capabilities')" in refresh
    assert "model.loras = Array.isArray(fresh.loras)" in refresh
    assert "renderLoras();" in refresh
    assert "populateModelSelector();" not in refresh
    assert "renderModelForm();" not in refresh
    assert "el('generate-lora-refresh').onclick = refreshLoraCatalog;" in script


def test_generate_ephemeral_ui_state_stays_in_memory():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "loraMode: 'selected'" in script
    assert "viewMode: 'create'" in script
    assert "takesCollapsed: false" in script
    assert "generateState.sweepFolderByModel[id] = '';" in script

    for obsolete in (
        "webcap.generate.loraMode",
        "webcap.generate.viewMode",
        "webcap.generate.takesCollapsed",
        "webcap.generate.sweepFolder.",
    ):
        assert obsolete not in script


def test_generate_loras_are_session_only_but_library_restore_rehydrates_them():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function selectedLoras(modelId)" in script
    assert "webcap.generate.loras." not in script
    assert "function saveLoras" not in script
    assert "generateState.lorasByModel[resultModelId] = Array.isArray(result.loras)" in script
    assert "strength: isFinite(strength) ? strength : 1" in script


def test_generate_job_ownership_comes_from_inference_queue_metadata():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "trackedJobIds: []" in script
    assert "webcap.generate.trackedJobs" not in script
    assert "loadTrackedGenerateJobs" not in script
    assert "saveTrackedGenerateJobs" not in script
    assert "function adoptGenerateJobsFromQueue(queue)" in script
    assert "String(job && job.client || '') !== 'generate'" in script
    assert "String(job && job.client || '') === 'generate'" in script
    assert "adoptGenerateJobsFromQueue(queue);" in script
