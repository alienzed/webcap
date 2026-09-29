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
    assert 'id="storyboard-story-tags"' not in html
    assert 'id="storyboard-story-status"' in html
    assert 'id="storyboard-story-target-scenes"' in html
    assert 'id="storyboard-story-aspect-ratio"' in html
    assert 'id="storyboard-story-megapixels"' in html
    assert "Inherit · " in storyboard
    assert "Generation prompt" in storyboard
    assert "durationSeconds" in storyboard
    assert "seedMode" in storyboard
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
    assert "generated Takes will be permanently deleted" in storyboard


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
    assert "pendingStorySave: null" in storyboard
    assert "var previous = storyState.storySavePromise;" in storyboard
    assert "var saveKey = sceneSaveKey(storyId, sceneId);" in storyboard
    assert "var previous = storyState.sceneSavePromises[saveKey];" in storyboard
    assert "return Promise.all(pending).then(function () {" in storyboard
    assert "saveStoryNow(storyTarget);" in storyboard
    assert "saveSceneNow(target.sceneId, target);" in storyboard


def test_storyboard_autosaves_capture_story_and_scene_identity_before_debounce():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    story_schedule = storyboard.split("function scheduleStorySave()", 1)[1].split("\n  function ", 1)[0]
    assert "storyState.pendingStorySave = {" in story_schedule
    assert "storyId: storyState.story.id" in story_schedule
    assert "payload: storyPayloadFromUi()" in story_schedule
    assert "saveStoryNow(target)" in story_schedule

    scene_schedule = storyboard.split("function scheduleSceneSave(sceneId)", 1)[1].split("\n  function ", 1)[0]
    assert "var saveKey = sceneSaveKey(storyId, sceneId);" in scene_schedule
    assert "storyId: storyId" in scene_schedule
    assert "sceneId: sceneId" in scene_schedule
    assert "payload: scenePayloadFromUi(sceneId)" in scene_schedule
    assert "saveSceneNow(sceneId, target)" in scene_schedule


def test_storyboard_routine_autosave_state_does_not_pollute_global_console():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    save_state = storyboard.split("function setSaveState(text)", 1)[1].split("function storyTagsText", 1)[0]

    assert "text !== 'Saving...'" in save_state
    assert "text !== 'Unsaved changes'" in save_state
    assert "reportConsoleInfo('Storyboard', text);" in save_state


def test_storyboard_local_director_status_messages_are_mirrored_to_console():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    develop = storyboard.split("function setDevelopStatus(text)", 1)[1].split("\n  function ", 1)[0]
    repair = storyboard.split("function setRepairStatus(text)", 1)[1].split("\n  function ", 1)[0]
    scene = storyboard.split("function updateSceneDirectorStatus(sceneId, text)", 1)[1].split("\n  function ", 1)[0]

    assert "reportConsoleInfo('Storyboard', message);" in develop
    assert "reportConsoleInfo('Storyboard', message);" in repair
    assert "reportConsoleInfo(generationConsoleLabel(sceneId), message);" in scene

def test_storyboard_story_switching_and_save_results_are_story_scoped():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "openStoryRequestId: 0" in storyboard
    open_block = storyboard.split("function openStory(storyId)", 1)[1].split("\n  function ", 1)[0]
    assert "var requestId = ++storyState.openStoryRequestId;" in open_block
    assert "if (requestId !== storyState.openStoryRequestId) return null;" in open_block
    assert "Storyboard Story response identity mismatch." in open_block
    assert open_block.index("requestId !== storyState.openStoryRequestId") < open_block.index("storyState.story = payload.story;")

    story_save = storyboard.split("function saveStoryNow(target)", 1)[1].split("\n  function ", 1)[0]
    assert "String(storyState.story.id || '') === String(storyId)" in story_save
    assert story_save.index("String(storyState.story.id || '') === String(storyId)") < story_save.index("storyState.story = payload.story;")

    scene_save = storyboard.split("function saveSceneNow(sceneId, target)", 1)[1].split("\n  function ", 1)[0]
    assert "String(storyState.story.id || '') === String(storyId)" in scene_save
    assert scene_save.index("String(storyState.story.id || '') === String(storyId)") < scene_save.index("storyState.story = payload.story;")

    queue_refresh = storyboard.split("function refreshGenerationQueue(storyId)", 1)[1].split("\n  function ", 1)[0]
    assert "String(storyState.story.id || '') !== String(storyId)" in queue_refresh


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
    assert 'id="app-settings-storyboard-context-size" type="number" min="1024" step="1" placeholder="Auto"' in html
    assert 'id="app-settings-storyboard-max-tokens" type="number" min="1" step="1" placeholder="Auto"' in html
    assert "contextSizeValue === '' ? null" in settings
    assert "maxTokensValue === '' ? null" in settings
    assert "~/llama.cpp/build/bin/llama-server" in html

    assert "['general', 'training', 'storyboard', 'advanced']" in settings
    assert "out.storyboard.director.llama_server" in settings
    assert "base.storyboard.director.llama_server" in settings
    assert "appSettingsStoryboardLlamaServerEl" in constants
    assert "App Settings > Storyboard > llama-server executable" in runtime



def test_storyboard_director_tools_has_sparse_scene_healing_pass():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert 'id="storyboard-repair-instruction"' in html
    assert 'id="storyboard-repair-scenes-btn"' in html
    assert "function repairScenes()" in storyboard
    assert "operation: 'repair_scenes'" in storyboard
    assert "kind: 'repair'" in storyboard
    assert "function restoreLastRepair()" in storyboard
    assert "restore_last_scene_repair" in storyboard
    assert 'if operation == "restore_last_scene_repair":' in app
    protection = storyboard.split("function setDirectorTargetProtected(target, protectedState)", 1)[1].split("function syncDirectorPendingControls", 1)[0]
    region_protection = storyboard.split("function setDirectorRegionProtected(region, protectedState)", 1)[1].split("function setDirectorTargetProtected", 1)[0]
    assert "target.kind === 'scene-prompt' || target.kind === 'repair'" in protection
    assert "document.querySelector('.storyboard-scene-workspace')" in protection
    assert "region.inert = !!protectedState;" in region_protection
    assert "region.classList.toggle('director-protected', !!protectedState);" in region_protection
    scene_payload = storyboard.split("function scenePayloadFromUi(sceneId)", 1)[1].split("\n  function ", 1)[0]
    assert "directorTargetPending({ kind: 'repair'" in scene_payload
    assert "delete payload.summary;" in scene_payload
    assert "delete payload.prompt;" in scene_payload
    assert 'llm_storyboard_target_busy(story_id, "repair")' in app


def test_storyboard_director_region_overlays_match_coarse_semantic_scopes():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    protection = storyboard.split("function setDirectorTargetProtected(target, protectedState)", 1)[1].split("function syncDirectorPendingControls", 1)[0]
    targeting = storyboard.split("function directorActivityTargetElement()", 1)[1].split("function positionDirectorActivity()", 1)[0]
    positioning = storyboard.split("function positionDirectorActivity()", 1)[1].split("function directorActivityForTargetQueue", 1)[0]

    assert "setDirectorRegionProtected(el('storyboard-story-authoring'), protectedState);" in protection
    assert "setDirectorRegionProtected(document.querySelector('.storyboard-scene-workspace'), protectedState);" in protection
    assert "target.kind === 'scene-prompt' || target.kind === 'repair'" in protection
    assert "target.kind === 'concept'" in protection
    assert "concept.disabled = !!protectedState;" in protection
    assert "target.kind === 'story-action'" in protection
    assert "data-story-action-disabled" in protection

    assert "target.kind === 'scene-prompt'" in targeting
    assert "target.kind === 'scenes'" in targeting
    assert "target.kind === 'repair'" in targeting
    assert "return document.querySelector('.storyboard-scene-workspace');" in targeting
    assert "kind === 'scene-prompt'" in positioning
    assert "kind === 'scenes'" in positioning
    assert "kind === 'repair'" in positioning
    assert "var fillsField = kind === 'concept';" in positioning

    assert ".storyboard-scene-workspace.director-protected" in css
    assert ".storyboard-story-authoring.director-protected" in css


def test_storyboard_restore_repair_does_not_use_story_wide_director_lock():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    restore = storyboard.split("function restoreLastRepair()", 1)[1].split("\n  function ", 1)[0]
    assert "directorTargetBlocked" not in restore
    route = app.split('if operation == "restore_last_scene_repair":', 1)[1].split('if operation == "restore_previous_prompt":', 1)[0]
    assert 'llm_storyboard_target_busy(story_id, "scenes")' in route
    assert "llm_storyboard_story_busy(story_id)" not in route


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
    assert "applyDirectorResultToVisibleStory" in storyboard
    assert "previousConcept" in storyboard


def test_storyboard_director_captures_unsaved_target_before_locking_it():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    for function_name in ("defineInvariants", "expandConcept", "developStory", "runDirector"):
        block = storyboard.split("function " + function_name, 1)[1].split("\n  function ", 1)[0]
        assert block.index("var saveBarrier = flushPendingSaves();") < block.index("setDirectorPending(directorTarget, true);")
        assert "saveBarrier.then(function () {" in block


def test_storyboard_director_pending_state_is_target_scoped():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "pendingTargets: {}" in storyboard
    assert "pendingOrder: []" in storyboard
    assert "function directorTargetKey(target)" in storyboard
    assert "return 'story-concept:' + storyId;" in storyboard
    assert "return 'story-scenes:' + storyId;" in storyboard
    assert "return 'scene-prompt:' + storyId + ':' + String(target.sceneId);" in storyboard
    assert "function directorTargetsConflict(a, b)" in storyboard
    assert "function directorTargetBlocked(target)" in storyboard
    assert "function setDirectorPending(target, pending)" in storyboard
    assert "function syncDirectorPendingControls()" in storyboard
    assert "var directorTarget = { kind: 'concept', storyId: storyId };" in storyboard
    assert "var directorTarget = { kind: 'scenes', storyId: storyId };" in storyboard
    assert "var directorTarget = { kind: 'scene-prompt', storyId: storyId, sceneId: sceneId };" in storyboard
    protection = storyboard.split("function setDirectorTargetProtected(target, protectedState)", 1)[1].split("function syncDirectorPendingControls", 1)[0]
    assert "target.kind === 'concept'" in protection
    assert "target.kind === 'scene-prompt'" in protection
    assert "target.kind === 'scenes'" in protection
    assert "#storyboard-story-overview button" in protection
    assert "querySelectorAll('input, textarea, select')" not in protection
    assert ".storyboard-director-activity.is-detached-target" in (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")


def test_storyboard_scene_director_result_is_backend_owned_not_browser_written():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")
    run_block = storyboard.split("function runDirector(sceneId, operation)", 1)[1].split("function setDevelopStatus", 1)[0]

    assert "operation: 'update_scene'" not in run_block
    assert "applyDirectorResultToVisibleStory" in run_block
    assert "apply_director_prompt" in runner
    assert "def apply_director_prompt" in store
    assert "previousPrompt" in store
    assert "restore_previous_prompt" in storyboard
    assert "promptDirectorJobId: promptDirectorJobId" in storyboard
    assert "delete payload.promptDirectorJobId;" in storyboard


def test_storyboard_director_conflicts_are_visible_and_target_scoped():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")

    assert 'id="storyboard-restore-concept-btn"' in html
    assert "function directorTargetBlocked(target)" in storyboard
    assert "reportError(new Error('That Scene prompt already has Director work pending.'))" in storyboard
    assert "expandButton.disabled = directorTargetBlocked" not in storyboard
    assert "button.disabled = blocked" not in storyboard
    assert "Storyboard Director target already has pending work." in runner
    assert "storyState.director.busy = storyState.director.pendingOrder.length > 0;" in storyboard
    assert "function restorePreviousConcept()" in storyboard
    assert "operation: 'restore_previous_concept'" in storyboard


def test_storyboard_director_requests_use_shared_llm_queue():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")

    assert "function waitForDirectorJob(job)" in storyboard
    assert "function directorJobPollDelay(job)" in storyboard
    assert "return String(job && job.status || '') === 'queued' ? 2000 : 1000;" in storyboard
    assert "setTimeout(resolve, directorJobPollDelay(current))" in storyboard
    assert "'/fs/director/job?job='" in storyboard
    assert "queued: 'Queued…'" in storyboard
    assert "function directorActivityForTargetQueue(activity, queue)" in storyboard
    assert "values[0] && values[0].queue" in storyboard
    assert '"queue": queue' in app
    assert "'Next in queue'" in storyboard
    assert "'Queue #'" in storyboard
    assert "'Waiting for Director'" in storyboard
    assert "'Waiting for Inference'" in storyboard
    assert "'Waiting for Training'" in storyboard
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
    assert "return applyDirectorResultToVisibleStory(job);" in storyboard
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
    assert "function directorLiveStats(activity)" in storyboard
    assert "activity.slot" in storyboard
    assert "' generated'" in storyboard
    assert "' output Auto'" in storyboard
    assert ".storyboard-director-activity" in css
    assert "position: absolute;" in css




def test_storyboard_director_activity_poll_failure_does_not_fake_preparing():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    refresh = storyboard.split("function refreshDirectorActivity()", 1)[1].split("function startDirectorActivity", 1)[0]

    assert "reportError(err);" in refresh
    assert "activityErrorReported" in refresh
    assert "renderDirectorActivity({ phase: 'preparing', active: true }, null);" not in refresh


def test_storyboard_director_activity_shows_completion_telemetry():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function directorCompletionStats(activity)" in storyboard
    assert "usage.prompt_tokens" in storyboard
    assert "usage.completion_tokens" in storyboard
    assert "timings.predicted_per_second" in storyboard
    assert "prompt_tokens_details" in storyboard
    assert "cached_tokens" in storyboard
    assert "cached_n" in storyboard
    assert "' tok/s'" in storyboard
    assert "'% ctx'" in storyboard


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
    assert "getDirectorModelPreference('webcap.storyboard.directorModel')" in storyboard
    assert "setDirectorModelPreference('webcap.storyboard.directorModel', this.value)" in storyboard
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


def test_storyboard_director_activity_stays_scoped_to_origin_story():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    target_block = storyboard.split("function directorActivityTargetElement()", 1)[1].split("function positionDirectorActivity()", 1)[0]
    assert "targetStoryId && targetStoryId !== currentStoryId" in target_block
    assert "return null;" in target_block
    assert "var detachedTarget = !!kind && !target;" in storyboard
    assert "if (storyState.director.busy && storyState.director.activityTarget) positionDirectorActivity();" in storyboard


def test_director_model_load_meter_stays_visible_when_size_is_unavailable():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    generate = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    for script in (storyboard, generate):
        assert "Model size unavailable" in script
        assert "Waiting for memory sample…" in script
        loading_block = script.split("function updateDirectorModelLoad(activity, system)", 1)[1].split("function directorTrendPath", 1)[0]
        assert "meter.classList.remove('hidden');" in loading_block
        assert "if (!isFinite(modelSizeBytes) || modelSizeBytes <= 0)" in loading_block


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
    assert "<strong>Story Overview</strong>" in html
    assert ">Hide Overview</button>" in html
    assert ">Show Overview</button>" in html
    assert "Story Context" not in html
    assert ">Collapse Story</button>" not in html
    assert ">Expand Story</button>" not in html
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
    assert ".storyboard-story-panel-heading > strong" in css
    assert ".storyboard-scene-progress-work" in css


def test_storyboard_scene_title_lives_in_main_form_and_story_switch_reopens_context():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    scene_main = storyboard.split("'<div class=\"storyboard-scene-main\">'", 1)[1].split("'<div class=\"storyboard-prompt-block\">'", 1)[0]

    assert "'<header class=\"storyboard-scene-header\">'" not in storyboard
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


def test_storyboard_visual_atmosphere_presets_cover_distinctive_styles():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    for preset_id in (
        "fashion-runway-editorial",
        "luxury-fashion-film",
        "studio-beauty-campaign",
        "theatrical-stage",
        "retro-70s-celluloid",
        "retro-80s-neon",
        "y2k-gloss",
        "sun-drenched-mediterranean",
        "pastel-pop",
        "minimal-architectural",
        "clinical-sterile",
        "romantic-soft-focus",
        "surreal-dream-logic",
        "expressionist-shadow",
        "coastal-natural-light",
        "kinetic-music-video",
    ):
        assert "id: '" + preset_id + "'" in storyboard


def test_storyboard_can_define_character_and_location_invariants_from_concept():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert 'id="storyboard-invariant-define"' in html
    assert "Define from Concept" in html
    assert "function defineInvariants()" in storyboard
    assert "operation: 'define_invariants'" in storyboard
    assert "location: 'Location'" in storyboard
    assert '"location"' in store


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
    assert "function initStorySections()" in storyboard
    assert "function storyInvariantsFromUi()" in storyboard
    assert "data-story-invariant-row" in storyboard
    assert '"invariants": _normalize_story_invariants' in store
    assert ".storyboard-invariant-row" in css


def test_storyboard_story_context_has_persisted_local_collapsible_sections():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    for section in ("story", "continuity", "director", "defaults"):
        assert f'data-story-section="{section}"' in html

    assert 'data-story-section="planning"' not in html
    assert 'data-story-section="loras"' not in html
    assert 'data-story-section="story" open' in html
    assert 'data-story-section="continuity" open' not in html
    assert "var STORY_SECTION_DEFAULTS = {" in storyboard
    assert "story: true" in storyboard
    assert "continuity: false" in storyboard
    assert "director: false" in storyboard
    assert "defaults: false" in storyboard
    assert "function initStorySections()" in storyboard
    assert "'webcap.storyboard.storySection.' + sectionName" in storyboard
    assert ".storyboard-story-section:not([open]) > .storyboard-story-section-body" in css

    overview_surface = html.split('id="storyboard-story-overview"', 1)[1].split('<div class="storyboard-story-utility-shelf"', 1)[0]
    utility_shelf = html.split('<div class="storyboard-story-utility-shelf"', 1)[1].split('<div class="storyboard-scene-workspace">', 1)[0]
    story_section = overview_surface.split('data-story-section="story"', 1)[1].split("</details>", 1)[0]
    continuity_section = overview_surface.split('data-story-section="continuity"', 1)[1].split("</details>", 1)[0]
    director_section = utility_shelf.split('data-story-section="director"', 1)[1].split("</details>", 1)[0]
    defaults_section = utility_shelf.split('data-story-section="defaults"', 1)[1].split("</details>", 1)[0]

    assert 'id="storyboard-story-title"' in story_section
    assert 'id="storyboard-story-icon"' in story_section
    assert 'id="storyboard-story-status"' in story_section
    assert 'id="storyboard-story-concept"' in story_section
    assert 'id="storyboard-story-style"' in story_section
    assert 'id="storyboard-invariant-define"' in continuity_section
    assert 'class="storyboard-continuity-summary"' in continuity_section
    continuity_summary = continuity_section.split('<summary class="storyboard-continuity-summary">', 1)[1].split("</summary>", 1)[0]
    assert 'id="storyboard-invariant-define"' in continuity_summary
    assert 'id="storyboard-invariant-add"' in continuity_summary
    assert 'id="storyboard-invariants-list"' in continuity_section
    add_invariant = storyboard.split("el('storyboard-invariant-add').addEventListener('click'", 1)[1].split("});", 1)[0]
    assert "continuitySection.open = true" in add_invariant
    assert "invariantRowHtml({ kind: 'character', title: '', text: '' }, true)" in add_invariant

    assert 'class="storyboard-director-tools-drawer"' in utility_shelf
    assert 'class="storyboard-scene-defaults"' in utility_shelf
    assert 'data-story-section="continuity"' not in utility_shelf
    assert html.index('id="storyboard-develop-btn"') < html.index('data-story-section="director"')
    assert 'id="storyboard-repair-instruction"' in director_section
    assert 'id="storyboard-repair-scenes-btn"' in director_section
    assert 'id="storyboard-restore-repair-btn"' in director_section

    assert 'id="storyboard-story-target-scenes"' in overview_surface
    assert 'id="storyboard-story-aspect-ratio"' not in overview_surface
    assert 'id="storyboard-story-megapixels"' not in overview_surface
    assert 'id="storyboard-story-lora-list"' not in overview_surface
    assert 'id="storyboard-story-aspect-ratio"' in defaults_section
    assert 'id="storyboard-story-megapixels"' in defaults_section
    assert 'id="storyboard-story-lora-list"' in defaults_section
    assert 'id="storyboard-story-lora-picker"' in defaults_section

    assert ".storyboard-story-utility-shelf" in css
    assert "grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);" in css
    assert ".storyboard-story-utility-shelf > .storyboard-director-tools-drawer > .storyboard-story-section-body" in css
    assert ".storyboard-story-utility-shelf > .storyboard-scene-defaults > .storyboard-story-section-body" in css

    payload_block = storyboard.split("function storyPayloadFromUi()", 1)[1].split("\n  function ", 1)[0]
    assert "storySection" not in payload_block
    assert "storyboard-story-tags" not in payload_block
    assert 'storyboard-list-section-title">Stories</div>' in storyboard
    assert 'storyboard-list-section-title">Recent</div>' not in storyboard


def test_storyboard_develop_scenes_is_primary_story_to_scenes_handoff():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    handoff = html.split('<div class="storyboard-develop-row">', 1)[1].split('<div class="storyboard-story-utility-shelf"', 1)[0]
    assert handoff.count('id="storyboard-story-target-scenes"') == 1
    assert handoff.count('id="storyboard-scene-count-auto"') == 1
    assert handoff.count('id="storyboard-develop-btn"') == 1
    assert handoff.count('id="storyboard-develop-status"') == 1
    assert handoff.index('id="storyboard-story-target-scenes"') < handoff.index('id="storyboard-develop-btn"')
    assert "Turn the Story Overview above into the Scene plan." not in handoff
    assert "Scene plan" not in handoff

    assert ".storyboard-develop-controls" in css
    assert ".storyboard-target-scenes-inline" in css
    assert ".storyboard-scene-count-auto" in css
    assert ".storyboard-develop-controls .storyboard-primary-btn" in css
    assert ".storyboard-develop-row > .storyboard-save-state" in css

    payload_block = storyboard.split("function storyPayloadFromUi()", 1)[1].split("\n  function ", 1)[0]
    assert "targetSceneCount: el('storyboard-scene-count-auto').getAttribute('aria-pressed') === 'true'" in payload_block
    assert "? null" in payload_block
    assert "el('storyboard-scene-count-auto').onclick" in storyboard


def test_storyboard_director_scene_plan_lock_excludes_scene_defaults():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    protection = storyboard.split("function setDirectorTargetProtected(target, protectedState)", 1)[1].split("function syncDirectorPendingControls", 1)[0]
    scenes = protection.split("if (target.kind === 'scenes')", 1)[1].split("if (target.kind === 'scene-prompt')", 1)[0]
    assert "#storyboard-story-overview button" in scenes
    assert ".storyboard-director-tools-drawer button" in scenes
    assert "storyboard-story-aspect-ratio" not in scenes
    assert "storyboard-story-megapixels" not in scenes
    assert "storyboard-story-lora" not in scenes
    assert "control.dataset.directorScenesDisabled = '1';" in scenes

    story_action = protection.split("if (target.kind === 'story-action')", 1)[1].split("if (target.kind === 'concept')", 1)[0]
    assert "#storyboard-story-overview button" in story_action
    assert ".storyboard-director-tools-drawer button" in story_action
    assert "#storyboard-story-authoring button" not in story_action
    assert "storyboard-story-aspect-ratio" not in story_action

def test_storyboard_continuity_header_actions_do_not_toggle_disclosure():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert "document.querySelector('.storyboard-continuity-summary .storyboard-invariants-actions').addEventListener('click'" in storyboard
    assert "event.preventDefault();" in storyboard
    assert "event.stopPropagation();" in storyboard
    assert ".storyboard-invariants-actions" in css


def test_storyboard_switching_stories_clears_stale_director_locks():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    block = storyboard.split("function syncDirectorPendingControls()", 1)[1].split("\n  function ", 1)[0]
    assert "setDirectorTargetProtected(conceptTarget, directorTargetPending(conceptTarget));" in block
    assert "setDirectorTargetProtected(repairTarget, directorTargetPending(repairTarget));" in block
    assert "scenesTarget" not in block


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
    assert ".storyboard-story-section" in css
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
    assert "var takesInitiallyOpen = takeOrder.length > 0 || sceneGenerationJobs.length > 0;" in storyboard
    assert "'<details class=\"storyboard-takes\"' + (takesInitiallyOpen ? ' open' : '') + '>'" in storyboard
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


def test_storyboard_progression_card_owns_scene_status_and_actions():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    progression = storyboard.split("function renderSceneProgression(order)", 1)[1].split("\n  function ", 1)[0]
    assert "storyboard-scene-progress-card" in progression
    assert "storyState.sceneViewMode === 'focus' && sceneId === active" in progression
    assert "storyboard-scene-progress-menu" in progression
    assert 'data-scene-action="duplicate"' in progression
    assert 'data-scene-action="up"' in progression
    assert 'data-scene-action="down"' in progression
    assert 'data-scene-action="delete"' in progression
    assert "sceneProgressionIndicatorsHtml(sceneId)" in progression
    assert "is-generating" in storyboard
    assert "is-queued" in storyboard
    assert "storyboard-scene-progress-badge" in storyboard
    assert ".storyboard-scene-progress-card.has-selected-take" in css
    assert ".storyboard-scene-progress-card.active" in css
    assert "box-shadow: inset 0 -3px 0 var(--accent);" in css
    assert ".storyboard-scene-progress-work.is-generating" in css
    assert "position: fixed;" in css.split(".storyboard-scene-menu-popover {", 1)[1].split("}", 1)[0]


def test_storyboard_takes_open_on_first_activity_without_forcing_manual_reopen():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    sync_block = storyboard.split("function syncSceneTakeDom(sceneId)", 1)[1].split("\n  function ", 1)[0]
    assert "var hadNoTakeActivity = !grid.querySelector('[data-take-id], [data-generation-job-id]');" in sync_block
    assert "if (hadNoTakeActivity && (takeOrder.length || jobs.length))" in sync_block
    assert "takesDetails.open = true;" in sync_block


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


def test_storyboard_scene_cards_visually_mark_selected_take_state():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert "storyboard-scene-overview-card' + (scene.selectedTakeId ? ' has-selected-take' : '')" in storyboard
    assert "(scene.selectedTakeId ? ' has-selected-take' : '')" in storyboard
    assert ".storyboard-scene-progress-card.has-selected-take" in css
    assert ".storyboard-scene.has-selected-take" not in css
    assert ".storyboard-scene-overview-card.has-selected-take" in css


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
    assert "Turbo active" in storyboard
    assert ".storyboard-generation-settings" in css
    assert ".storyboard-conditioning-panel" in css
    generation_block = storyboard.split("'<section class=\"storyboard-inspector-section storyboard-generation-inspector\">'", 1)[1].split("'<section class=\"storyboard-inspector-section storyboard-conditioning-panel\">'", 1)[0]
    assert generation_block.index('class="storyboard-generation-settings"') < generation_block.index('data-scene-generate')
    assert 'Wildcards intended' not in generation_block
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

def test_storyboard_generate_scenes_reuses_existing_scene_generation_path():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-generate-scenes-btn"' in html
    assert ">Generate Scenes</button>" in html
    assert "function enqueueSceneGeneration(storyId, sceneId)" in storyboard
    assert "function generateScenes()" in storyboard
    assert "storyState.story.sceneOrder.slice()" in storyboard
    assert "return enqueueSceneGeneration(storyId, sceneId).catch(reportError);" in storyboard
    assert "el('storyboard-generate-scenes-btn').onclick = generateScenes;" in storyboard
    assert "return enqueueSceneGeneration(storyId, sceneId);" in storyboard
    assert ".storyboard-scenes-heading-actions" in css
    heading = html.split('<div class="storyboard-scenes-heading">', 1)[1].split('</div>\n                            <div id="storyboard-scene-progression"', 1)[0]
    left = heading.split('<div class="storyboard-scenes-heading-left">', 1)[1].split('</div>\n                                <div class="storyboard-view-toggle"', 1)[0]
    actions = heading.split('<div class="storyboard-scenes-heading-actions">', 1)[1]
    assert 'id="storyboard-generate-scenes-btn"' in left
    assert 'id="storyboard-generate-scenes-btn"' not in actions
    assert 'class="storyboard-director-header"' in actions


def test_storyboard_generation_polling_preserves_existing_take_media_nodes():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function syncGenerationJobCard(job, card)" in storyboard
    assert "webcap:inference-queue-snapshot" in storyboard
    assert "function syncStoryboardInferenceSnapshot(queue)" in storyboard
    assert "var seenJobIds = Object.create(null);" in storyboard
    assert "function pollGeneration(storyId, jobId, delayOverride)" in storyboard
    assert "? (generationJobIsExecuting(current) ? 2000 : 8000)" in storyboard
    assert "}, delay);" in storyboard
    assert "if (generationJobIsExecuting(job)) pollGeneration(storyId, job.jobId);" in storyboard
    assert "card.querySelector('.storyboard-take-pending-media strong')" in storyboard

    snapshot_block = storyboard.split("function syncStoryboardInferenceSnapshot(queue)", 1)[1].split(
        "\n  function generationJobsForScene", 1
    )[0]
    missing_job_block = snapshot_block.split(
        "Object.keys(storyState.generationJobs).forEach(function (jobId) {", 1
    )[1].split("\n    });", 1)[0]
    assert "clearGenerationPoll(jobId);" in missing_job_block
    assert "pollGeneration(storyId, jobId, 0);" in missing_job_block
    assert "delete storyState.generationJobs[jobId];" not in missing_job_block

    refresh_block = storyboard.split("function refreshGenerationQueue(storyId)", 1)[1].split(
        "\n  function generationAction", 1
    )[0]
    assert "storyState.generationJobs = {};" not in refresh_block
    assert "Object.keys(storyState.generationPolls).forEach(clearGenerationPoll);" not in refresh_block
    assert "var seenJobIds = Object.create(null);" in refresh_block
    assert "pollGeneration(storyId, jobId, 0);" in refresh_block

    take_sync = storyboard.split("function syncSceneTakeDom(sceneId)", 1)[1].split(
        "\n  function mergeFetchedSceneTakeState", 1
    )[0]
    assert "if (!take || sceneTakeCardById(grid, takeId)) return;" in take_sync
    assert "insertAdjacentHTML" in take_sync
    assert ".innerHTML =" not in take_sync
    assert "renderScenes();" not in take_sync

    poll_block = storyboard.split("function pollGeneration(storyId, jobId)", 1)[1].split(
        "\n  function refreshGenerationQueue", 1
    )[0]
    completed_block = poll_block.split("if (job.status === 'completed') {", 1)[1]
    assert "mergeFetchedSceneTakeState(storyId, job.sceneId, storyPayload.story);" in completed_block
    assert "renderScenes();" not in completed_block

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
    assert "previousPrompt" in script
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

def test_storyboard_scene_cards_surface_unseen_manual_director_completion():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert "sceneCompletions: {}" in storyboard
    assert "function markSceneDirectorCompletion(storyId, sceneId, operation)" in storyboard
    assert "job.clearCorrection === true" in storyboard
    assert "sceneDirectorCompletionHtml(sceneId)" in storyboard
    assert "data-scene-director-completion" in storyboard
    assert "Refine completed while you were elsewhere." in storyboard
    assert "Write with Director completed while you were elsewhere." in storyboard
    assert "clearSceneDirectorCompletion(storyState.story.id, sceneId);" in storyboard
    assert ".storyboard-scene-progress-director-complete" in css


def test_storyboard_refine_completion_is_scene_specific_persistent_and_self_clearing():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert '"refineComplete": refine_complete' in store
    assert 'operation=operation' in (ROOT / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")
    assert "function syncSceneRefineState(sceneId)" in storyboard
    assert "(scene.refineComplete ? '✓' : 'Refine')" in storyboard
    assert "currentCorrection.value = '';" in storyboard
    assert "currentScene.refineComplete = !!savedScene.refineComplete;" in storyboard
    assert "currentScene.refineComplete = false;" in storyboard
    assert "scheduleSceneSave(correctionSceneId);" in storyboard
    assert "target.operation === 'refine_prompt'" in storyboard
    assert "currentScene.durationSeconds = savedScene.durationSeconds;" in storyboard
    assert "currentDuration.value = savedScene.durationSeconds == null ? '' : savedScene.durationSeconds;" in storyboard



def test_storyboard_sequence_view_uses_lightweight_editor_timeline():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'class="storyboard-sequence-timeline"' in storyboard
    assert 'class="storyboard-sequence-timeline-header"' in storyboard
    assert '--sequence-clip-seconds:' in storyboard
    assert "durationSeconds" in storyboard
    assert "Export preview" in storyboard
    assert ".storyboard-sequence-timeline {" in css
    assert ".storyboard-sequence-card {" in css
    assert "calc(var(--sequence-clip-seconds) * 18px)" in css
    assert ".storyboard-sequence-label {" in css
    assert ".storyboard-sequence-output-label {" in css


def test_storyboard_sequence_encoding_warning_is_explicit_and_highlights_affected_takes():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    assembly = (ROOT / "tool" / "server" / "storyboard_assembly.py").read_text(encoding="utf-8")

    assert "This requires encoding" in storyboard
    assert "data-sequence-warnings" in storyboard
    assert "data-sequence-encode" in storyboard
    assert "storyState.sequenceEncodingWarnings" in storyboard
    assert "warningByTake" in storyboard
    assert "requires-encoding" in storyboard
    assert ".storyboard-sequence-card.requires-encoding" in css
    assert ".storyboard-sequence-card-warning" in css
    assert 'encode: !!encode' in storyboard
    assert 'storyState.sequenceEncodingWarnings = [];' in storyboard
    assert 'def _analyze_streams(items):' in assembly
    assert 'def _normalize_clip(' in assembly

def test_storyboard_takes_display_live_and_persisted_generation_elapsed_time():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    generation = (ROOT / "tool" / "server" / "storyboard_generation.py").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    assert "function formatGenerationElapsedMs(value)" in storyboard
    assert "function generationJobStatusText(job)" in storyboard
    assert "return formatInferenceJobStatus({" in storyboard
    assert "progress: job && job.progress" in storyboard
    assert "formatGenerationElapsedMs(take && take.elapsedMs)" in storyboard
    assert "elapsed_ms = int((time.monotonic() - started) * 1000)" in generation
    assert '"elapsedMs": elapsed_ms' in generation
    assert '"elapsedMs",' in store


def test_storyboard_enqueue_refreshes_shared_inference_queue_immediately():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    block = storyboard.split("function enqueueSceneGeneration(storyId, sceneId)", 1)[1].split("\n  function ", 1)[0]
    assert "return window.refreshInferenceQueue().then(function () {" in block
    assert "return job;" in block


def test_inference_drawer_refreshes_before_rendering_when_opened():
    inference = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")

    block = inference.split("function setOpen(open)", 1)[1].split("\n  function ", 1)[0]
    assert "if (state.open) {" in block
    assert "refresh().then(schedule);" in block
    assert block.index("refresh().then(schedule);") < block.index("render();")


def test_storyboard_director_activity_exposes_hard_stop_control():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    styles = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="storyboard-director-stop"' in html
    assert "function stopDirectorJob()" in storyboard
    assert "operation: 'stop_or_cancel'" in storyboard
    assert "directorWasStopped(err)" in storyboard
    assert ".director-stop-btn {" in styles
    assert "position: absolute;" in styles
    assert "right: 4px;" in styles
    assert "bottom: 3px;" in styles


def test_storyboard_director_stop_dismisses_only_the_stopped_activity_target():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    stop_block = storyboard.split("function stopDirectorJob()", 1)[1].split("function startDirectorActivity()", 1)[0]
    render_block = storyboard.split("function renderDirectorActivity(activity, system)", 1)[1].split("function directorActivityActive()", 1)[0]
    pending_block = storyboard.split("function setDirectorPending(target, pending)", 1)[1].split("function defineInvariants()", 1)[0]

    assert "dismissedActivityTargetKey = directorTargetKey(storyState.director.activityTarget)" in stop_block
    assert "card.classList.add('hidden')" in stop_block
    assert "storyState.director.dismissedActivityTargetKey === activityTargetKey" in render_block
    assert "visible = !dismissed &&" in render_block
    assert "storyState.director.dismissedActivityTargetKey === key" in pending_block



def test_storyboard_first_cut_lock_is_story_scoped_and_sequence_readiness_is_derived():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    protection = storyboard.split("function setDirectorTargetProtected(target, protectedState)", 1)[1].split("\n  function ", 1)[0]
    assert "String(target.storyId || '') !== String(storyState.story.id || '')" in protection
    assert "#storyboard-story-overview button, #storyboard-story-overview input" in protection
    assert "#storyboard-story-authoring button, #storyboard-story-authoring input" not in protection
    assert "[data-story-action-cancel]" in protection

    pending_controls = storyboard.split("function syncDirectorPendingControls()", 1)[1].split("\n  function ", 1)[0]
    assert "document.querySelectorAll('[data-story-action-disabled=\"1\"]')" in pending_controls
    assert "delete control.dataset.storyActionDisabled;" in pending_controls

    readiness = storyboard.split("function renderStoryReadiness()", 1)[1].split("\n  function ", 1)[0]
    assert "scenesWithTake" in readiness
    assert "sequenceButton.classList.toggle('is-ready', sequenceReady);" in readiness
    assert "#storyboard-scenes-sequence-btn.is-ready:not(.active)" in css



def test_storyboard_plan_replacement_controls_follow_story_generation_state():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "function storyHasPendingGeneration(storyId)" in storyboard
    assert "function syncPlanReplacementControls()" in storyboard
    assert "developButton.disabled = developBlocked;" in storyboard
    assert "firstCutButton.disabled = firstCutBlocked;" in storyboard
    assert "pending Take generation before replacing its Scene plan" in storyboard
    assert "pending Take generation before starting First Cut" in storyboard
    assert "syncPlanReplacementControls();" in storyboard


def test_storyboard_queued_first_cut_prevents_new_take_generation():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "var queuedFirstCut = !!queuedFirstCutForStory(storyId);" in storyboard
    assert "#storyboard-generate-scenes-btn, #storyboard-scenes-list [data-scene-generate]" in storyboard
    assert "control.dataset.firstCutQueuedDisabled = '1';" in storyboard
    assert "Remove this Story from the First Cut queue before adding new Take generation." in storyboard
    assert "var activeFirstCut = storyState.storyAction" in storyboard
    assert "control.dataset.storyActionDisabled = '1';" in storyboard

def test_storyboard_first_cut_queue_is_session_only_story_scoped_fifo():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    assert "storyActionQueue: []" in storyboard
    assert "function queuedFirstCutForStory(storyId)" in storyboard
    assert "function firstCutQueueDisplayPosition(action)" in storyboard
    assert "function removeQueuedFirstCut(storyId)" in storyboard
    assert "function runFirstCut(action)" in storyboard
    assert "function startNextFirstCut()" in storyboard
    assert "storyState.storyActionQueue.push(action);" in storyboard
    assert "var candidate = storyState.storyActionQueue.shift();" in storyboard
    assert "button.textContent = anotherRunning ? 'Queue First Cut' : 'First Cut';" in storyboard
    assert "'First Cut queued #' + String(firstCutQueueDisplayPosition(queuedFirstCut))" in storyboard
    assert "removeQueuedFirstCut(storyId);" in storyboard
    assert "window.localStorage.setItem('webcap.storyboard.firstCut" not in storyboard
    assert "operation: 'queue_first_cut'" not in storyboard


def test_storyboard_queued_first_cut_freezes_model_but_reads_story_at_start():
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")

    start = storyboard.split("function startFirstCut()", 1)[1].split("\n  function ", 1)[0]
    run = storyboard.split("function runFirstCut(action)", 1)[1].split("\n  function ", 1)[0]

    assert "modelId: modelId" in start
    assert "storyState.storyActionQueue.push(action);" in start
    assert "var modelId = String(action.modelId || '');" in run
    assert "request(null, 'story=' + encodeURIComponent(storyId))" in run
    assert "replaceExisting = Array.isArray(actionStory && actionStory.sceneOrder)" in run
    assert "setDirectorPending(directorTarget, true);" in run
    assert "startNextFirstCut();" in run



def test_storyboard_director_actions_and_invariants_keep_compact_affordances():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    for control_id in (
        "storyboard-first-cut-btn",
        "storyboard-expand-concept-btn",
        "storyboard-invariant-define",
        "storyboard-repair-scenes-btn",
        "storyboard-develop-btn",
    ):
        control = html.split(f'id="{control_id}"', 1)[1].split(">", 1)[0]
        assert "storyboard-director-action" in control

    assert 'class="review-captions-btn storyboard-director-action" data-director-write' in storyboard
    assert 'class="review-captions-btn storyboard-director-action" data-director-refine' in storyboard
    assert "function invariantRowHtml(item, expanded)" in storyboard
    assert 'class="storyboard-invariant-row' in storyboard
    assert "data-story-invariant-toggle" in storyboard
    assert "function setInvariantRowOpen(row, open)" in storyboard
    assert "storyboard-invariant-summary" not in storyboard
    assert "Untitled invariant" not in storyboard
    assert "No continuity note yet." not in storyboard
    assert ".storyboard-director-action::before" in css
    assert ".storyboard-invariant-row-head" in css
    assert ".storyboard-invariant-body" in css
    assert ".storyboard-invariant-summary" not in css


def test_storyboard_story_rail_is_full_by_default_and_manually_compactable():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")

    assert 'id="storyboard-library-compact-toggle"' in html
    assert "storyLibraryCompact: window.localStorage.getItem('webcap.storyboard.storyLibraryCompact') === '1'" in storyboard
    assert "function setStoryLibraryCompact(compact)" in storyboard
    assert "story-library-compact" in storyboard
    assert ".storyboard-workspace.story-library-compact" in css
    assert ".storyboard-library:hover" not in css
    assert "story-library-pinned" not in css
    assert "story-library-pinned" not in storyboard


def test_storyboard_story_icon_is_optional_persisted_and_visible_in_library():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "storyboard.css").read_text(encoding="utf-8")
    store = (ROOT / "tool" / "server" / "storyboard_store.py").read_text(encoding="utf-8")

    story_section = html.split('data-story-section="story"', 1)[1].split("</details>", 1)[0]
    assert story_section.index('id="storyboard-story-title"') < story_section.index('id="storyboard-story-icon"') < story_section.index('id="storyboard-story-status"')
    assert 'id="storyboard-story-icon-trigger"' in story_section
    assert 'id="storyboard-story-icon-menu"' in story_section
    assert 'type="hidden"' in story_section.split('id="storyboard-story-icon"', 1)[1].split(">", 1)[0]
    assert "var STORY_RAIL_ICONS = {" in storyboard
    assert "var STORY_ICON_LABELS = {" in storyboard
    assert "function storyRailIconHtml(story)" in storyboard
    assert "function renderStoryIconPicker()" in storyboard
    assert "function setStoryIconSelection(iconName)" in storyboard
    assert "storyboard-story-rail-icon" in storyboard
    assert "icon: el('storyboard-story-icon').value" in storyboard
    assert ".storyboard-icon-picker-menu" in css
    assert "grid-template-columns: repeat(6" in css
    assert len(store.split("VALID_STORY_ICONS = {", 1)[1].split("}", 1)[0].split(",")) >= 30
    assert '"icon": icon' in store
    assert '"icon": source.get("icon") or ""' in store


def test_assistant_exposes_storyboard_revise_scenes_only_when_context_is_available():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assistant = (ROOT / "tool" / "js" / "director_chat.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    shell_css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert 'aria-label="Assistant"' in html
    assert 'id="director-chat-mode-row"' in html
    assert 'id="director-chat-mode-switch"' in html
    assert 'id="storyboard-assistant-btn"' in html
    assert 'storyboard-director-action' in html.split('id="storyboard-assistant-btn"', 1)[1].split(">", 1)[0]

    assert "window.registerAssistantMode = registerContextMode" in assistant
    assert "window.refreshAssistantModes = syncModeUi" in assistant
    assert "window.openAssistant" in assistant
    assert "data-assistant-mode=\"chat\"" in assistant
    assert "mode.execute" in assistant
    assert ".director-chat-mode-switch" in shell_css

    mode = storyboard.split("window.registerAssistantMode({", 1)[1].split("});", 1)[0]
    assert "id: 'revise-scenes'" in mode
    assert "label: 'Revise Scenes'" in mode
    assert "!workspace.classList.contains('hidden')" in mode
    assert "storyState.story" in mode
    assert "Array.isArray(storyState.story.sceneOrder)" in mode
    assert "storyState.story.sceneOrder.length > 0" in mode
    assert "return reviseScenes(request && request.instruction, request && request.modelId)" in mode

    assert "function reviseScenes(instruction, modelId)" in storyboard
    assert "function repairScenes()" in storyboard
    assert "return reviseScenes(instruction, storyState.director.modelId)" in storyboard
    assert "window.openAssistant({ mode: hasScenes ? 'revise-scenes' : 'chat' })" in storyboard


def test_assistant_chat_remains_freeform_and_separate_from_contextual_modes():
    assistant = (ROOT / "tool" / "js" / "director_chat.js").read_text(encoding="utf-8")

    assert "activeMode: 'chat'" in assistant
    assert "if (state.activeMode === 'chat') return state.messages;" in assistant
    assert "state.modeMessages" in assistant
    assert "requestJson('/fs/director/chat'" in assistant
    assert "if (mode)" in assistant
    assert "mode.execute({" in assistant
