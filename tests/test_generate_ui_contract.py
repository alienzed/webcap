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

    assert ".app-frame.workspace-generate-open > .app" in css
    assert ".generate-create-view" in css
    assert ".generate-stage-panel" in css
    assert ".generate-takes-panel" in css
    assert ".generate-queue-panel" not in html
    assert ".generate-results" in css


def test_generate_reuses_concepts_not_storyboard_dom():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "storyboard-scene" not in script
    assert "storyboard-generation" not in script
    assert "storyId" not in script
    assert "sceneId" not in script
    assert "entryState" not in script
    assert "exitState" not in script

def test_generate_result_polling_preserves_existing_media_nodes():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function resultKey(result)" in script
    assert "card.dataset.resultKey = resultKey(result)" in script
    assert "host.querySelectorAll('.generate-result-card[data-result-key]')" in script
    assert "if (!key || existingKeys[key]) return;" in script
    assert "host.insertBefore(buildResultCard(result), host.firstChild)" in script
    assert "host.innerHTML = results.map" not in script

def test_generate_director_is_a_reversible_prompt_editor():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    generation = (ROOT / "tool" / "server" / "generate_generation.py").read_text(encoding="utf-8")

    assert ">Expand Prompt</button>" in html
    assert 'id="generate-director-restore"' in html
    assert "Restore Previous" in html
    assert "Describe what you want — a rough idea or a finished prompt." in html
    assert "Valid work queues even while Training owns the GPU." not in html
    assert "<strong>Generation Settings</strong>" in html
    assert "<strong>Setup</strong>" not in html
    assert "<strong>Output</strong>" not in html
    assert 'class="storyboard-inline-check generate-prompt-option"' in html

    assert "previousPrompt: null" in script
    assert "function restoreDirectorPrompt()" in script
    assert "generateState.director.previousPrompt = previousPrompt;" in script
    assert "generateState.director.previousPrompt = null;" in script
    assert "Storyboard prompt is injected at runtime." in script
    assert "window.localStorage.removeItem(promptStorageKey)" in script
    assert '"defaultPrompt": ""' in generation

def test_generate_prompt_assistant_uses_shared_llm_queue():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "function queueDirectorRequest(payload)" in script
    assert "function waitForDirectorJob(job)" in script
    assert "function directorJobPollDelay(job)" in script
    assert "return String(job && job.status || '') === 'queued' ? 2000 : 1000;" in script
    assert "setTimeout(resolve, directorJobPollDelay(current))" in script
    assert "'/fs/director/job?job='" in script
    assert "queued: 'Queued…'" in script
    waiter = script.split("function waitForDirectorJob(job)", 1)[1].split("function queueDirectorRequest", 1)[0]
    assert "renderDirectorActivity(" not in waiter
    assert "enqueue_llm(" in app
    assert "referenceRoles: ['first_frame', 'last_frame'].filter" in script
    assert "reference_roles=data.get(\"referenceRoles\")" in app


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

    assert ">Prompt Assistant</label>" in html
    assert ">Expand Prompt</button>" in html
    assert ">Refine Prompt</button>" in html
    assert 'id="generate-director-activity"' in html
    assert "function refreshDirectorActivity()" in script
    assert "function positionDirectorActivity()" in script
    assert "requestJson('/fs/director/activity')" in script
    assert "requestJson('/fs/system_status')" in script
    assert "Loading model…" in script
    assert "Generating response…" in script
    assert ".generate-director-activity" in css
    assert 'position: absolute;' in css
    assert "#generate-director-activity-trend svg" in css
    assert "min-height: 86px;" in css
    assert '@app.route("/fs/director/activity", methods=["GET"])' in app


def test_generate_uses_shared_director_preference_without_eager_preload():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    assert "DIRECTOR_MODEL_STORAGE_KEY = 'webcap.director.model'" in common
    assert "getDirectorModelPreference('webcap.generate.directorModel')" in script
    assert "setDirectorModelPreference('webcap.generate.directorModel', this.value)" in script
    assert "scheduleDirectorPreload" not in script
    assert "preloadDirectorModel" not in script
    assert '@app.route("/fs/director/preload"' not in app


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
    assert 'id="generate-status" class="generate-status-badge hidden"' in html
    assert ".generate-status-badge.is-error" in css



def test_generate_defaults_new_lora_strength_to_point_nine():
    js = Path("tool/js/generate.js").read_text(encoding="utf-8")
    assert "items.push({ name: name, strength: 0.9 });" in js


def test_generate_library_open_restores_saved_generation_configuration():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function restoreResultConfiguration(result)" in script
    assert "prompt.value = String(result.sourcePrompt || result.resolvedPrompt || '');" in script
    assert "generateState.lorasByModel[resultModelId]" in script
    assert "wildcards.checked = !!result.wildcardsEnabled;" in script
    assert "restoreResultConfiguration(result);" in script


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

    assert ".generate-authoring" not in css
    assert ".generate-results-panel" not in css
    assert ".generate-results-heading" not in css

def test_generate_displays_live_and_persisted_generation_elapsed_time():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "generate_store.py").read_text(encoding="utf-8")

    assert "function formatGenerationElapsedMs(value)" in script
    assert "var startedAt = Number(job && job.startedAt || 0);" in script
    assert "formatGenerationElapsedMs(Date.now() - (startedAt * 1000))" in script
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
