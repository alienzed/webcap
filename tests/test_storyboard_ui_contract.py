from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_storyboard_is_a_first_class_independent_workspace():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="activity-storyboard-btn"' in html
    assert 'aria-controls="storyboard-workspace"' in html
    assert 'id="storyboard-workspace"' in html
    assert 'data-workspace-root="storyboard"' in html
    assert 'id="storyboard-library-list"' in html
    assert 'id="storyboard-scenes-list"' in html
    assert '/static/js/storyboard.js' in html
    assert '/static/css/storyboard.css' in html

    assert "if (workspace === 'storyboard') return 'storyboard';" in shell
    assert "route.workspace === 'storyboard'" in shell
    assert "navigation.activity === 'storyboard'" in shell
    assert "workspace !== 'storyboard'" in shell
    assert "openStoryboardActivity" in shell

    assert "current set" not in storyboard.lower()
    assert "state.folder" not in storyboard
    assert "test-generations" not in storyboard
    assert "training" not in storyboard.lower()
    assert ".workspace-storyboard-open > .app" in css


def test_storyboard_inherited_megapixels_seed_from_story_default_on_focus():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function seedInheritedSceneMegapixels(input)" in storyboard
    assert "defaults.megapixels == null ? 0.2 : defaults.megapixels" in storyboard
    focus_block = storyboard.split("addEventListener('focusin'", 1)[1].split("addEventListener('keydown'", 1)[0]
    assert 'data-scene-field="megapixels"' in focus_block
    assert "seedInheritedSceneMegapixels(inheritedMegapixels)" in focus_block


def test_storyboard_phase_one_is_manual_first_and_provider_independent():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert 'id="storyboard-story-concept"' in html
    assert 'id="storyboard-story-style"' in html
    assert 'id="storyboard-sequence-preview"' in html
    assert 'id="storyboard-story-tags"' in html
    assert 'id="storyboard-story-status"' in html
    assert 'id="storyboard-story-target-scenes"' in html
    assert 'id="storyboard-story-aspect-ratio"' in html
    assert 'id="storyboard-story-megapixels"' in html
    assert "Inherit · " in storyboard
    assert "Generation prompt" in storyboard
    assert "durationSeconds" in storyboard
    assert "seedMode" in storyboard
    assert "wildcardsEnabled" in storyboard
    assert "loras" in store
    assert "references" in store
    assert "takeOrder" in store
    assert "selectedTakeId" in store
    assert "add_take_upload" in store
    assert "rate_take" in store
    assert "select_take" in store
    assert "data-take-upload" in storyboard
    assert "data-take-action=\"remove\"" in storyboard
    assert "remove_take" in storyboard
    assert "restore_take" in storyboard
    assert "set_scene_reference_from_take" in storyboard
    assert "data-reference-previous" in storyboard
    assert "data-reference-apply" in storyboard
    assert "data-scene-generate" in storyboard
    assert "data-scene-lora-add" in storyboard
    assert "data-scene-lora-name" in storyboard
    assert "/fs/storyboard/generation/capabilities" in storyboard
    assert "/fs/storyboard/generation" in storyboard
    assert "Generation prompt" in storyboard
    assert "Scene intent" in storyboard
    assert "Entry state" in storyboard
    assert "Exit state" in storyboard
    assert "Notes" in storyboard
    assert "storyboard-scene-disclosure" in storyboard
    assert "seedMode: randomSeed ? 'random' : 'fixed'" in storyboard
    assert 'data-scene-field="seedMode"' not in storyboard
    assert "Selected sequence" in storyboard
    assert "Export Sequence" in storyboard
    assert "/fs/storyboard/assembly" in storyboard
    assert "data-sequence-export" in storyboard

    assert "ollama" not in app.lower()
    assert "test-generations" not in storyboard
    assert "training-btn" not in storyboard
    assert "fetch('/fs/storyboard'" not in storyboard  # request helper builds the URL once.


def test_storyboard_story_library_owns_management_actions():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert 'id="storyboard-delete-story-btn"' not in html
    assert 'id="storyboard-story-pinned"' not in html
    assert 'data-story-action="duplicate"' in storyboard
    assert 'data-story-action="pin"' in storyboard
    assert 'data-story-action="archive"' in storyboard
    assert 'data-story-action="export"' in storyboard
    assert 'data-story-action="delete"' in storyboard
    assert "function duplicateStory(storyId)" in storyboard
    assert "function deleteStory(storyId, title)" in storyboard
    assert "This cannot be undone." in storyboard
    assert "operation: 'duplicate_story'" in storyboard
    assert "operation: 'delete_story'" in storyboard
    assert 'if operation == "duplicate_story":' in app
    assert 'if operation == "delete_story":' in app
    assert "stop_storyboard_jobs(story_id)" in app
    assert "def duplicate_story(story_id):" in store
    assert "def delete_story(story_id):" in store
    assert "shutil.rmtree(directory)" in store



def test_storyboard_story_action_menu_escapes_library_scroll_clipping():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert "function positionStoryActionMenu(menu)" in storyboard
    assert "getBoundingClientRect()" in storyboard
    assert "closeStoryActionMenus(storyMenu)" in storyboard
    assert "storyLibraryList.addEventListener('scroll'" in storyboard
    popover_rule = css.split(".storyboard-story-menu-popover {", 1)[1].split("}", 1)[0]
    assert "position: fixed;" in popover_rule
    assert "z-index: 200;" in popover_rule


def test_storyboard_scene_removal_is_recoverable():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert "function removedScenesHtml(removedScenes)" in storyboard
    assert "'<details class=\"storyboard-removed-scenes\">'" in storyboard
    assert "storyboard-restore-scene-btn" in storyboard
    assert "restore_scene" in storyboard
    assert '"removedScenes"' in store
    assert 'scene["removedAt"]' in store
    assert "def restore_scene" in store


def test_storyboard_document_records_file_based_guardrails():
    doc = (ROOT / "docs" / "storyboard.md").read_text(encoding="utf-8")

    assert "No database." in doc
    assert "<filesystem.root>/output/storyboards/" in doc
    assert "story.json" in doc
    assert "Storyboard is additive, not invasive." in doc
    assert "WebCap owns meaning; providers own execution" in doc
    assert "Phase 1 - Manual-first functional Storyboard" in doc


def test_storyboard_save_barrier_waits_for_inflight_autosaves():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "storySavePromise: null" in storyboard
    assert "sceneSavePromises: {}" in storyboard
    assert "var previous = storyState.storySavePromise;" in storyboard
    assert "var previous = storyState.sceneSavePromises[sceneId];" in storyboard
    assert "return Promise.all(pending).then(function () {" in storyboard
    assert "saveStoryNow().catch(reportError);" in storyboard
    assert "saveSceneNow(sceneId).catch(reportError);" in storyboard

def test_storyboard_director_configuration_is_first_class_app_setting():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")
    constants = (ROOT / "tool" / "js" / "constants.js").read_text(encoding="utf-8")
    runtime = (ROOT / "tool" / "server" / "storyboard_llm_runtime.py").read_text(encoding="utf-8")

    assert 'data-app-settings-tab="storyboard"' in html
    assert 'data-app-settings-panel="storyboard"' in html
    assert 'id="app-settings-storyboard-llama-server"' in html
    assert 'id="app-settings-storyboard-port"' in html
    assert 'id="app-settings-storyboard-context-size"' in html
    assert 'id="app-settings-storyboard-max-tokens"' in html
    assert "~/llama.cpp/build/bin/llama-server" in html

    assert "['general', 'training', 'storyboard', 'advanced']" in settings
    assert "out.storyboard.director.llama_server" in settings
    assert "base.storyboard.director.llama_server" in settings
    assert "appSettingsStoryboardLlamaServerEl" in constants
    assert "App Settings > Storyboard > llama-server executable" in runtime



def test_storyboard_can_develop_concept_directly_into_scenes():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'id="storyboard-develop-btn"' in html
    assert 'id="storyboard-develop-status"' in html
    assert "function developStory()" in storyboard
    assert "operation: 'develop_story'" in storyboard
    assert "replaceExisting: hasScenes" in storyboard
    assert "Existing Scenes and Takes will remain recoverable" in storyboard
    assert "Develop Again" in storyboard


def test_storyboard_can_expand_a_rough_concept_before_developing_scenes():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'id="storyboard-expand-concept-btn"' in html
    assert "function expandConcept()" in storyboard
    assert "operation: 'expand_concept'" in storyboard
    assert "storyState.story = payload.story;" in storyboard
    assert "previousConcept" in storyboard


def test_storyboard_director_pending_state_is_target_scoped():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "pendingTargets: {}" in storyboard
    assert "pendingOrder: []" in storyboard
    assert "function directorTargetKey(target)" in storyboard
    assert "return 'story-plan:' + storyId;" in storyboard
    assert "return 'scene-prompt:' + storyId + ':' + String(target.sceneId);" in storyboard
    assert "function directorTargetPending(target)" in storyboard
    assert "function setDirectorPending(target, pending)" in storyboard
    assert "function syncDirectorPendingControls()" in storyboard
    assert "setStoryDirectorInputsDisabled" not in storyboard
    assert "var directorTarget = { kind: 'concept', storyId: storyId };" in storyboard
    assert "var directorTarget = { kind: 'scenes', storyId: storyId };" in storyboard
    assert "var directorTarget = { kind: 'scene-prompt', storyId: storyId, sceneId: sceneId };" in storyboard
    assert "detachedScenePrompt = kind === 'scene-prompt' && !target" in storyboard
    assert "promptDirectorJobId: String(payload.jobId || '')" in storyboard
    assert "if (currentPrompt) currentPrompt.value = generatedPrompt;" in storyboard
    assert ".storyboard-director-activity.is-detached-target" in (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")


def test_storyboard_director_story_plan_conflicts_but_scene_targets_queue_independently():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'id="storyboard-restore-concept-btn"' in html
    assert "busy: false" in storyboard
    assert "storyPlanPending" in storyboard
    assert "node.disabled = storyPlanPending;" in storyboard
    assert "button.disabled = pending;" in storyboard
    assert "select.disabled = false;" in storyboard
    assert "if (directorTargetPending(directorTarget)) return;" in storyboard
    assert "storyState.director.busy = storyState.director.pendingOrder.length > 0;" in storyboard
    assert "function restorePreviousConcept()" in storyboard
    assert "operation: 'restore_previous_concept'" in storyboard


def test_storyboard_director_requests_use_shared_llm_queue():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")

    assert "function waitForDirectorJob(job)" in storyboard
    assert "'/fs/director/job?job='" in storyboard
    assert "queued: 'Queued…'" in storyboard
    waiter = storyboard.split("function waitForDirectorJob(job)", 1)[1].split("function directorRequest", 1)[0]
    assert "renderDirectorActivity(" not in waiter
    assert "enqueue_llm(" in app
    assert '@app.route("/fs/director/job", methods=["GET", "POST"])' in app
    assert 'EXECUTION_LANE = "llm"' in runner
    assert '"storyboard"' in runner
    assert '"generate"' in runner


def test_storyboard_director_jobs_reconcile_after_browser_refresh():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert '@app.route("/fs/director/queue", methods=["GET"])' in app
    assert "llm_snapshot(include_terminal=_request_bool_arg(\"includeTerminal\"))" in app
    assert "function directorQueueSnapshot(includeTerminal)" in storyboard
    assert "function reconcileDirectorJobs()" in storyboard
    assert "function watchRecoveredDirectorJob(job)" in storyboard
    assert "function applyRecoveredDirectorResult(job)" in storyboard
    assert "return reconcileDirectorJobs();" in storyboard
    assert "directorJobRequest(current.jobId, false)" in storyboard
    assert "return consumeDirectorJob(current.jobId);" in storyboard
    assert "promptDirectorJobId" in storyboard
    assert "promptDirectorJobId" in store
    assert "scene.promptDirectorJobId" in storyboard


def test_storyboard_director_has_non_modal_live_activity():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-director-activity"' in html
    assert "<strong>Director</strong>" in html
    assert "function refreshDirectorActivity()" in storyboard
    assert "directorActivityRequest('/fs/director/activity')" in storyboard
    assert "directorActivityRequest('/fs/system_status')" in storyboard
    assert "Loading model…" in storyboard
    assert "Generating response…" in storyboard
    assert ".storyboard-director-activity" in css
    assert "position: absolute;" in css


def test_storyboard_director_activity_rejects_stale_terminal_state():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function directorActivityForCurrentRun(activity)" in storyboard
    assert "var terminal = ['complete', 'error'].indexOf(phase) !== -1;" in storyboard
    assert "if (activityTime >= localStartedAt) return activity;" in storyboard
    assert "phase: 'preparing'," in storyboard
    assert "renderDirectorActivity(directorActivityForCurrentRun(values[0]), values[1]);" in storyboard

    finish = storyboard.split("function finishDirectorActivity()", 1)[1].split("function updateSceneDirectorStatus", 1)[0]
    assert "if (terminal && (!localStartedAt || activityTime >= localStartedAt))" in finish
    assert "staleCard.classList.add('hidden');" in finish



def test_storyboard_uses_shared_director_preference_without_eager_preload():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    assert "DIRECTOR_MODEL_STORAGE_KEY = 'webcap.director.model'" in common
    assert "getSharedDirectorModelPreference('webcap.storyboard.directorModel')" in storyboard
    assert "setSharedDirectorModelPreference(this.value)" in storyboard
    assert "scheduleDirectorPreload" not in storyboard
    assert "preloadDirectorModel" not in storyboard


def test_storyboard_prompt_pipeline_is_visible_without_changing_authoring_schema():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")
    generation = (ROOT / "tool" / "server" / "storyboard_generation.py").read_text(encoding="utf-8")

    assert "Prompt pipeline" in storyboard
    assert 'data-director-preview="write_prompt"' in storyboard
    assert 'data-director-preview="refine_prompt"' in storyboard
    assert "function previewDirectorRequest(sceneId, operation)" in storyboard
    assert "previewOnly: true" in storyboard
    assert "directorContractPreviewText(payload.contract)" in storyboard
    assert 'if bool(data.get("previewOnly")):' in app

    assert "Effective H3 Input" in storyboard
    assert "Exact prompt sent to ComfyUI" in storyboard
    assert "take.effectiveInput" in storyboard
    assert '"effectiveInput": effective_input' in generation
    assert '"effectiveInput",' in store
    assert ".storyboard-take-effective-input" in css


def test_storyboard_take_generation_uses_global_console_and_visible_pending_cards():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    console = (ROOT / "tool" / "js" / "console_panel.js").read_text(encoding="utf-8")

    assert "function reportConsoleInfo(source, message)" in console
    assert "function reportGenerationStatus(sceneId, job, previousJob)" in storyboard
    assert "reportConsoleInfo(generationConsoleLabel(sceneId)" in storyboard
    assert "storyboard-take-pending" in storyboard
    assert "data-generation-action=\"cancel\"" in storyboard
    assert "data-generation-action=\"stop\"" in storyboard
    assert "throw new Error(job.error || 'Storyboard generation failed.');" in storyboard
    assert ".storyboard-take-pending" in css
    assert ".storyboard-take-pending-indicator" in css


def test_storyboard_take_generation_ui_supports_multiple_jobs_per_scene():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function generationJobsForScene(sceneId)" in storyboard
    assert "storyState.generationJobs[job.jobId] = job;" in storyboard
    assert "Generate Another Take" in storyboard
    assert "Take generation queued" in storyboard
    assert "queuePosition" in storyboard
    assert "refreshGenerationQueue(storyId)" in storyboard
    assert "generationJobIsActive(job)" in storyboard


def test_storyboard_takes_can_be_named_and_loras_filtered():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert "data-take-label" in storyboard
    assert "function labelTake(sceneId, takeId, label)" in storyboard
    assert "operation: 'label_take'" in storyboard
    assert 'if operation == "label_take":' in app
    assert "def label_take(" in store
    assert "takeMetaLabel(take)" in storyboard
    assert "data-scene-lora-picker" in storyboard
    assert "function loraOptions(selectedName)" in storyboard
    assert "function loraNamesMatching(query, excludedNames)" in storyboard
    assert ".storyboard-lora-picker" in css


def test_storyboard_story_loras_are_inherited_and_overridable_in_scenes():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert 'id="storyboard-story-lora-list"' in html
    assert 'id="storyboard-story-lora-add"' in html
    assert 'id="storyboard-story-lora-picker"' in html
    assert "storyLoraOverrides" in storyboard
    assert "data-story-lora-global-enabled" in storyboard
    assert "storyboard-lora-row-story" in storyboard
    assert "data-story-lora-inherited-row" in storyboard
    assert "data-story-lora-enabled" in storyboard
    assert "data-story-lora-scene-strength" in storyboard
    assert "function syncStoryLorasIntoScenes()" in storyboard
    assert "def resolve_scene_loras(story, scene):" in store
    assert ".storyboard-story-authoring" in css


def test_storyboard_director_settings_support_remote_openai_compatible_endpoint():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")
    constants = (ROOT / "tool" / "js" / "constants.js").read_text(encoding="utf-8")
    runtime = (ROOT / "tool" / "server" / "storyboard_llm_runtime.py").read_text(encoding="utf-8")

    assert 'id="app-settings-storyboard-director-mode"' in html
    assert 'id="app-settings-storyboard-endpoint"' in html
    assert "Remote OpenAI-compatible" in html
    assert "out.storyboard.director.mode" in settings
    assert "out.storyboard.director.endpoint" in settings
    assert "appSettingsStoryboardDirectorModeEl" in constants
    assert "appSettingsStoryboardEndpointEl" in constants
    assert 'settings.get("mode", "local") == "remote"' in runtime
    assert '"/chat/completions"' in runtime



def test_storyboard_lora_chooser_is_single_searchable_field():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'data-scene-lora-filter' not in storyboard
    assert 'data-scene-lora-picker' in storyboard
    assert 'data-lora-picker-menu' in storyboard
    assert 'data-lora-picker-menu' in html
    assert "function loraNamesMatching(query, excludedNames)" in storyboard
    assert "key.indexOf(needle) !== -1" in storyboard
    assert "renderLoraPickerMenu(picker);" in storyboard
    assert "picker.focus();" in storyboard
    assert "picker.value = '';" in storyboard


def test_storyboard_director_activity_floats_over_context_without_reflow():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert "function directorActivityTargetElement()" in storyboard
    assert "function positionDirectorActivity()" in storyboard
    assert "function startDirectorActivity()" in storyboard
    assert "setDirectorPending(directorTarget, true);" in storyboard
    assert "storyState.director.activityTarget = storyState.director.pendingTargets[storyState.director.pendingOrder[0]]" in storyboard
    assert ".storyboard-director-activity {" in css
    assert "position: absolute;" in css
    assert "fillsField = kind === 'concept' || kind === 'scene-prompt' || kind === 'scenes'" in storyboard
    assert "card.style.height = Math.round(height) + 'px';" in storyboard
    assert "kind === 'scenes'" in storyboard
    assert "storyboard-story-concept" in storyboard
    assert "bottomAlignedTop" not in storyboard
    assert "is-story-plan-overlay" not in storyboard
    assert ".storyboard-director-activity.is-field-overlay" in css
    activity_css = css.split(".storyboard-director-activity {", 1)[1].split("}", 1)[0]
    picker_css = css.split(".storyboard-lora-picker-menu {", 1)[1].split("}", 1)[0]
    assert "pointer-events: none;" in activity_css
    assert "z-index: 60;" in picker_css
    assert "#storyboard-director-activity-trend svg" in css
    assert "'>VRAM ' + Math.round(vramPercent) + '%</span>'" in storyboard
    assert "'>RAM ' + Math.round(ramPercent) + '%</span>'" in storyboard
    assert "' used of '" in storyboard
    assert "detail.innerHTML = parts.join(' · ');" in storyboard
    assert 'id="storyboard-director-model-load"' in html
    assert "function updateDirectorModelLoad(activity, system)" in storyboard
    assert "activity.modelSizeBytes" in storyboard
    assert "ramDelta + vramDelta" in storyboard
    assert "Approximate model residency from RAM + VRAM growth since loading began." in storyboard
    assert "min-height: 72px;" in css


def test_storyboard_compact_header_places_controls_with_their_owned_surfaces():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'class="storyboard-editor-header"' not in html
    assert 'class="storyboard-story-panel-heading"' in html
    assert 'id="storyboard-story-expand-toggle"' in html
    scenes_heading = html.split('class="storyboard-scenes-heading"', 1)[1].split('</div>\n                            <div id="storyboard-scene-progression"', 1)[0]
    assert 'id="storyboard-director-model"' in scenes_heading
    assert 'id="storyboard-scenes-overview-btn"' in scenes_heading
    assert 'id="storyboard-scenes-focus-btn"' in scenes_heading
    assert 'data-inference-queue-toggle' not in scenes_heading
    assert 'id="inference-queue-rail-btn"' in html
    assert "storyboard-scene-progress-work" in storyboard
    assert "generationJobsForScene(sceneId)" in storyboard
    assert "button.setAttribute('aria-pressed', active ? 'true' : 'false');" in storyboard
    assert "grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);" in css
    assert ".storyboard-view-toggle .review-captions-btn.active" in css
    assert "box-shadow: inset 0 -2px 0 var(--accent);" in css
    assert ".storyboard-story-panel-heading" in css
    assert ".storyboard-scene-progress-work" in css


def test_storyboard_scene_title_lives_in_main_form_and_story_switch_reopens_context():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    header_block = storyboard.split("'<header class=\"storyboard-scene-header\">'", 1)[1].split("'</header>'", 1)[0]
    scene_main = storyboard.split("'<div class=\"storyboard-scene-main\">'", 1)[1].split("'<div class=\"storyboard-prompt-block\">'", 1)[0]

    assert 'data-scene-field="title"' not in header_block
    assert 'storyboard-scene-title-field' in scene_main
    assert '<span>Title</span><input data-scene-field="title"' in scene_main
    assert '<span>Scene intent</span>' in scene_main
    assert "var previousStoryId = storyState.story && storyState.story.id;" in storyboard
    assert "if (previousStoryId !== payload.story.id && storyState.storyCollapsed) setStoryCollapsed(false);" in storyboard
    assert "if (storyState.storyCollapsed) setStoryCollapsed(false);" in storyboard
    assert ".storyboard-scene-title-field input" in css


def test_storyboard_visual_atmosphere_has_editable_presets():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-story-style-preset"' in html
    assert '<option value="">Custom…</option>' in html
    assert "var STORY_STYLE_PRESETS = [" in storyboard
    assert "Naturalistic cinematic" in storyboard
    assert "Moody noir" in storyboard
    assert "Dreamy ethereal" in storyboard
    assert "Documentary handheld" in storyboard
    assert "Clean commercial" in storyboard
    assert "Warm intimate drama" in storyboard
    assert "Cool futuristic sci-fi" in storyboard
    assert "Stylized painterly" in storyboard
    assert "Gritty urban realism" in storyboard
    assert "Epic high-contrast" in storyboard
    assert "function renderStoryStylePresetSelector()" in storyboard
    assert "function applyStoryStylePreset(presetId)" in storyboard
    assert "select.value = storyStylePresetIdForText(textarea.value);" in storyboard
    assert "textarea.value = preset.text;" in storyboard
    assert "storyboard-story-style').addEventListener('input'" in storyboard
    assert ".storyboard-style-preset" in css


def test_storyboard_story_can_collapse_and_supports_structured_invariants():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert 'id="storyboard-story-toggle"' in html
    assert 'id="storyboard-story-authoring"' in html
    assert 'id="storyboard-invariant-add"' in html
    assert 'id="storyboard-invariants-list"' in html
    assert "function setStoryCollapsed(collapsed)" in storyboard
    assert "function storyInvariantsFromUi()" in storyboard
    assert "data-story-invariant-row" in storyboard
    assert '"invariants": _normalize_story_invariants' in store
    assert ".storyboard-invariant-row" in css


def test_storyboard_story_context_is_a_collapsible_middle_column():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'class="storyboard-scene-workspace"' in html
    assert 'id="storyboard-story-authoring"' in html
    assert "editor.classList.toggle('story-collapsed'" in storyboard
    assert "grid-template-columns: minmax(580px, 640px) minmax(0, 1fr);" in css
    assert ".storyboard-editor-scroll.story-collapsed" in css
    assert ".storyboard-story-authoring" in css
    assert "grid-template-columns: 1fr;" in css
    assert ".storyboard-scene-workspace" in css


def test_storyboard_scene_focus_mode_scrolls_naturally_and_has_peer_sequence_view():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-scenes-overview-btn"' in html
    assert 'id="storyboard-scenes-focus-btn"' in html
    assert 'id="storyboard-scenes-sequence-btn"' in html
    assert 'id="storyboard-scene-progression"' in html
    assert "sceneViewMode:" in storyboard
    assert "['overview', 'focus', 'sequence']" in storyboard
    assert "data-scene-open" in storyboard
    assert "data-scene-progress" in storyboard
    assert "data-scene-progress-add" in storyboard
    assert "newTakeCounts:" in storyboard
    assert "function markSceneNewTake(sceneId)" in storyboard
    assert "function clearSceneNewTakeCount(sceneId)" in storyboard
    assert "storyboard-scene-progress-badge" in storyboard
    assert "markSceneNewTake(job.sceneId);" in storyboard
    assert "function setSceneViewMode(mode, sceneId)" in storyboard
    assert ".storyboard-scene-progress-badge" in css
    assert "overflow-y: auto;" in css
    assert "scrollbar-gutter: stable;" in css
    assert ".storyboard-scenes-list.is-focus" in css
    assert "overflow: visible;" in css
    assert "height: auto;" in css
    assert "'<details class=\"storyboard-takes\" open>'" in storyboard
    assert 'class="storyboard-takes-summary"' in storyboard
    assert "takeSummaryParts" in storyboard
    assert ".storyboard-takes {" in css
    assert "grid-area: takes;" in css
    assert "container-type: inline-size;" in css
    assert "@container (min-width: 1450px)" in css
    assert "grid-template-areas:" in css
    assert '"body takes"' in css
    assert ".storyboard-takes-grid" in css
    assert ".storyboard-take-media {" in css
    assert "aspect-ratio: var(--take-aspect, 16 / 9);" in css
    assert "#storyboard-story-expand-toggle" in css
    scenes_heading = css.split(".storyboard-scenes-heading {", 1)[1].split("}", 1)[0]
    progression = css.split(".storyboard-scene-progression {", 1)[1].split("}", 1)[0]
    assert "position: sticky;" not in scenes_heading
    assert "position: sticky;" not in progression
    assert ".storyboard-scene-inspector" in css
    inspector = css.split(".storyboard-scene-inspector {", 1)[1].split("}", 1)[0]
    assert "position: sticky;" in inspector


def test_storyboard_director_provenance_is_subtle_and_persistent():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert "promptDirectorModel" in storyboard
    assert "promptDirectorModel" in store
    assert "planDirectorModel" in store
    assert "Scene plan originated from Director model " in storyboard
    assert "Last populated by Director model " in storyboard
    assert "promptValue === String(currentScene.prompt || '')" in storyboard
    assert "promptDirectorModel: promptDirectorModel" in storyboard


def test_storyboard_scene_continuity_is_collapsible():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'class="storyboard-scene-disclosure storyboard-continuity-details"' in storyboard
    assert "<span>Continuity</span>" in storyboard
    assert "Entry + Exit defined" in storyboard
    assert 'data-scene-field="entryState"' in storyboard
    assert 'data-scene-field="exitState"' in storyboard


def test_storyboard_scene_uses_large_visible_generation_and_conditioning_inspector():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'class="storyboard-scene-inspector"' in storyboard
    assert 'class="storyboard-inspector-section storyboard-generation-inspector"' in storyboard
    assert 'class="storyboard-generation-settings"' in storyboard
    assert 'class="storyboard-inspector-section storyboard-conditioning-panel"' in storyboard
    assert "conditioningSummaryParts" in storyboard
    assert "Base LoRA active" in storyboard
    assert ".storyboard-generation-settings" in css
    assert ".storyboard-conditioning-panel" in css
    generation_block = storyboard.split("'<section class=\"storyboard-inspector-section storyboard-generation-inspector\">'", 1)[1].split("'<section class=\"storyboard-inspector-section storyboard-conditioning-panel\">'", 1)[0]
    assert generation_block.index('class="storyboard-generation-settings"') < generation_block.index('data-scene-generate')
    assert generation_block.index('Wildcards intended') < generation_block.index('data-scene-generate')
    generate_css = css.split(".storyboard-generation-inspector .storyboard-generate-btn {", 1)[1].split("}", 1)[0]
    assert "min-height: 48px;" in generate_css
    assert "var(--accent)" in generate_css
    assert '.storyboard-generation-inspector .storyboard-generate-btn::before' in css



def test_storyboard_conditioning_lora_status_and_inherited_rows_render():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "var loraStatusTitle =" in storyboard
    assert "var loraStatusText =" in storyboard
    assert 'data-story-lora-inherited-list' in storyboard
    assert 'class="storyboard-lora-subtitle">Inherited from Story</span>' in storyboard
    assert 'class="storyboard-lora-subtitle">Scene only</span>' in storyboard

def test_storyboard_generation_polling_preserves_existing_take_media_nodes():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function syncGenerationJobCard(job)" in storyboard
    assert "syncGenerationJobCard(job);" in storyboard
    assert "card.querySelector('.storyboard-take-pending-media strong')" in storyboard
    active_block = storyboard.split("if (generationJobIsActive(job)) {", 1)[1].split("return;", 1)[0]
    assert "renderScenes();" not in active_block

def test_storyboard_take_deletion_is_explicit_destructive_and_selected_aware():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'data-take-action="delete"' in storyboard
    assert "function deleteTake(sceneId, takeId)" in storyboard
    assert "cannot be undone" in storyboard
    assert "Deleting it will leave the Scene without a selected Take." in storyboard
    assert "operation: 'delete_take'" in storyboard
    assert "def delete_take(" in store
    assert 'if operation == "delete_take":' in app

def test_storyboard_roundoff_has_prompt_restore_manual_refs_and_readiness_summary():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'id="storyboard-progress-summary"' in html
    assert "previousPrompts: {}" in script
    assert "function restoreSceneDirectorPrompt(sceneId)" in script
    assert 'data-director-restore' in script
    assert "Restore Previous" in script
    assert "function uploadSceneReference(sceneId, role, file)" in script
    assert "'/fs/storyboard/reference_upload'" in script
    assert 'data-reference-upload' in script
    assert "function renderStoryReadiness()" in script
    assert "' needs Take'" in script
    assert "' needs selection'" in script
    assert "'s selected'" in script
