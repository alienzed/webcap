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
    assert 'id="storyboard-story-pinned"' in html
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
    assert "Continuity &amp; notes" in storyboard
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


def test_storyboard_scene_removal_is_recoverable():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert "Removed Scenes" in storyboard
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


def test_storyboard_take_generation_uses_global_console_and_recovers_button_on_failure():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    console = (ROOT / "tool" / "js" / "console_panel.js").read_text(encoding="utf-8")

    assert "function reportConsoleInfo(source, message)" in console
    assert "function reportGenerationStatus(sceneId, job, previousJob)" in storyboard
    assert "reportConsoleInfo(generationConsoleLabel(sceneId)" in storyboard
    assert "syncGenerationButton(sceneId, null);" in storyboard
    assert "throw new Error(job.error || 'Storyboard generation failed.');" in storyboard
    assert "data-generation-status" not in storyboard
    assert ".storyboard-generation-status" not in css


def test_storyboard_take_generation_ui_supports_scene_queue_state():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "job.status === 'queued'" in storyboard
    assert "Take generation queued" in storyboard
    assert "Queued…" in storyboard
    assert "job.status === 'queued' || job.status === 'running'" in storyboard


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


def test_storyboard_scene_focus_mode_bounds_authoring_width_and_has_overview():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-scenes-overview-btn"' in html
    assert 'id="storyboard-scenes-focus-btn"' in html
    assert 'id="storyboard-scene-prev-btn"' in html
    assert 'id="storyboard-scene-next-btn"' in html
    assert "sceneViewMode:" in storyboard
    assert "data-scene-open" in storyboard
    assert "function setSceneViewMode(mode, sceneId)" in storyboard
    assert "grid-template-columns: minmax(560px, 720px) 220px 300px;" in css
    assert "min-height: 320px;" in css
    assert "grid-template-columns: repeat(auto-fit, minmax(220px, 280px));" in css


def test_storyboard_scene_has_dedicated_conditioning_column():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'class="storyboard-scene-conditioning"' in storyboard
    assert 'class="storyboard-scene-column-heading">Generation</div>' in storyboard
    assert 'class="storyboard-scene-column-heading">Conditioning</div>' in storyboard
    assert "Base LoRA active" in storyboard
    assert ".storyboard-scene-conditioning" in css
    assert "grid-template-columns: minmax(0, 1fr) minmax(220px, 250px) minmax(280px, 320px);" in css



def test_storyboard_conditioning_lora_status_and_inherited_rows_render():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "var loraStatusTitle =" in storyboard
    assert "var loraStatusText =" in storyboard
    assert 'data-story-lora-inherited-list' in storyboard
    assert 'class="storyboard-lora-subtitle">Inherited from Story</span>' in storyboard
    assert 'class="storyboard-lora-subtitle">Scene only</span>' in storyboard
