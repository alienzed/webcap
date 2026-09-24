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
    assert "'<details class="storyboard-removed-scenes">'" in storyboard
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


def test_storyboard_director_busy_state_only_protects_its_edit_target():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function setDirectorTargetProtected(target, protectedState)" in storyboard
    assert "setStoryDirectorInputsDisabled" not in storyboard
    assert "var directorTarget = { kind: 'concept' };" in storyboard
    assert "var directorTarget = { kind: 'scenes' };" in storyboard
    assert "var directorTarget = { kind: 'scene-prompt', sceneId: sceneId };" in storyboard
    assert "storyboard-delete-story-btn" not in storyboard.split("function setDirectorBusy", 1)[1].split("function expandConcept", 1)[0]


def test_storyboard_director_actions_share_one_busy_state_and_concept_restore():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert 'id="storyboard-restore-concept-btn"' in html
    assert "busy: false" in storyboard
    assert "function setDirectorBusy(busy)" in storyboard
    assert "if (!storyState.story || storyState.director.busy) return;" in storyboard
    assert "setDirectorBusy(true);" in storyboard
    assert "setDirectorBusy(false);" in storyboard
    assert "function restorePreviousConcept()" in storyboard
    assert "operation: 'restore_previous_concept'" in storyboard


def test_storyboard_director_requests_use_shared_llm_queue():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")

    assert "function waitForDirectorJob(job)" in storyboard
    assert "'/fs/director/job?job='" in storyboard
    assert "queued: 'Queued…'" in storyboard
    assert "enqueue_llm(" in app
    assert '@app.route("/fs/director/job", methods=["GET", "POST"])' in app
    assert 'EXECUTION_LANE = "llm"' in runner
    assert '"storyboard"' in runner
    assert '"generate"' in runner


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


def test_storyboard_uses_shared_director_preference_without_eager_preload():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    assert "DIRECTOR_MODEL_STORAGE_KEY = 'webcap.director.model'" in common
    assert "getSharedDirectorModelPreference('webcap.storyboard.directorModel')" in storyboard
    assert "setSharedDirectorModelPreference(this.value)" in storyboard
    assert "scheduleDirectorPreload" not in storyboard
    assert "preloadDirectorModel" not in storyboard


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
    assert "startDirectorActivity({ kind: 'concept' })" in storyboard
    assert "startDirectorActivity({ kind: 'scenes' })" in storyboard
    assert "startDirectorActivity({ kind: 'scene-prompt', sceneId: sceneId })" in storyboard
    assert ".storyboard-director-activity {" in css
    assert "position: absolute;" in css
    assert "width: 380px;" in css
    assert "#storyboard-director-activity-trend svg" in css
    assert "height: 54px;" in css


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
    assert "storyboard-scene-progress-work" in storyboard
    assert "generationJobsForScene(sceneId)" in storyboard
    assert ".storyboard-story-panel-heading" in css
    assert ".storyboard-scene-progress-work" in css


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


def test_storyboard_scene_focus_mode_bounds_authoring_width_and_has_overview():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-scenes-overview-btn"' in html
    assert 'id="storyboard-scenes-focus-btn"' in html
    assert 'id="storyboard-scene-progression"' in html
    assert "sceneViewMode:" in storyboard
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
    assert "grid-template-columns: minmax(720px, 900px) minmax(360px, 420px);" in css
    assert "min-height: 340px;" in css
    assert "position: sticky;" in css
    assert "overflow-x: auto;" in css
    assert "flex: 1 0 360px;" in css
    assert "grid-template-rows: auto minmax(0, 1fr) auto;" in css
    assert ".storyboard-take-media {" in css
    assert "aspect-ratio: auto;" in css
    assert "overflow: hidden;" in css


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
