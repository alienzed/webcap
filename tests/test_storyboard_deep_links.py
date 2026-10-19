from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_storyboard_hash_round_trips_story_and_scene():
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    assert "storyId: String(params.get('story') || '')" in shell
    assert "sceneId: String(params.get('scene') || '')" in shell
    assert "params.set('story', storyTarget.storyId)" in shell
    assert "params.set('scene', storyTarget.sceneId)" in shell
    assert "window.openStoryboardActivity({ storyId: route.storyId, sceneId: route.sceneId })" in shell


def test_storyboard_activity_navigation_selects_exact_scene():
    storyboard = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
    activity = (ROOT / "tool/js/activity_monitor.js").read_text(encoding="utf-8")
    assert "window.getStoryboardRouteTarget = getStoryboardRouteTarget;" in storyboard
    assert "navigationId !== storyState.navigationRequestId" in storyboard
    assert "return setSceneViewMode('focus', targetSceneId).then(function ()" in storyboard
    assert "sceneOrder || []).indexOf(targetSceneId) === -1" in storyboard
    assert "throw new Error('Storyboard Scene no longer exists:" in storyboard
    assert "window.openStoryboardActivity(target);" in activity
    assert "storyId: String(item.storyId || '')" in activity
    assert "sceneId: String(item.sceneId || '')" in activity


def test_story_load_does_not_wait_for_optional_status_calls():
    storyboard = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
    block = storyboard.split("  function openStory(storyId) {", 1)[1].split("\n  function createStory()", 1)[0]
    assert "refreshGenerationQueue(storyId).catch(reportError);" in block
    assert "reconcileDirectorJobs().catch(reportError);" in block
    assert "return storyState.story;" in block
    assert "throw err;" in block


def test_storyboard_bookmark_survives_shell_startup_and_async_scene_focus():
    main = (ROOT / "tool/js/main.js").read_text(encoding="utf-8")
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")

    # Snapshot the incoming URL before shell initialization can replaceState it.
    assert main.index("applyInitialShellLocationRoute();") < main.index("initializeWorkspaceShell();", main.index("DOMContentLoaded"))
    assert "var initialShellLocationRoute = parseShellLocationRoute();" in shell

    # The first Story render chooses its initial Scene; it cannot overwrite the
    # bookmarked Scene while the async navigation is still in progress.
    restore = shell.split("function restoreInitialShellLocationRoute() {", 1)[1].split("function normalizeWorkspaceSurface", 1)[0]
    assert "initialShellLocationRestoring = true;" in restore
    assert "initialShellLocationRestored || initialShellLocationRestoring" in restore
    assert "return window.openStoryboardActivity({ storyId: route.storyId, sceneId: route.sceneId });" in restore
    assert restore.index("return window.openStoryboardActivity") < restore.index("initialShellLocationRoute = null;", restore.index(".finally("))
    assert "initialShellLocationRoute && !initialShellLocationRestored" in shell
    assert "return setSceneViewMode('focus', targetSceneId).then(function ()" in storyboard


def test_storyboard_deep_links_are_not_blocked_by_folder_model_refresh():
    main = (ROOT / "tool/js/main.js").read_text(encoding="utf-8")
    boot = main.split("addEventListener('DOMContentLoaded', function () {", 1)[1]
    assert "if (startupRoute && startupRoute.workspace === 'storyboard') restoreInitialShellLocationRoute();" in boot
    assert boot.index("restoreInitialShellLocationRoute();") < boot.index("refreshTrainingRunnerStatus")


def test_storyboard_scene_mutations_update_bookmarked_location():
    storyboard = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
    render = storyboard.split("  function renderStory() {", 1)[1].split("  function refreshLibrary()", 1)[0]
    assert "window.syncShellLocationRoute();" in render
    follow = storyboard.split("  function followVisibleWorkingScene(", 1)[1].split("  function sceneDirectorCompletionKey", 1)[0]
    assert "window.syncShellLocationRoute();" in follow
    insert = storyboard.split("} else if (operation === 'insert_scene')", 1)[1].split("} else if (operation === 'define_invariants')", 1)[0]
    assert "window.syncShellLocationRoute();" in insert


def test_storyboard_missing_bookmark_is_not_silently_replaced():
    shell = (ROOT / "tool/js/workspace_shell.js").read_text(encoding="utf-8")
    restore = shell.split("function restoreInitialShellLocationRoute() {", 1)[1].split("function normalizeWorkspaceSurface", 1)[0]
    assert "selected.storyId === route.storyId" in restore
    assert "selected.sceneId === route.sceneId" in restore
    assert "if ((!route.storyId || selected.storyId === route.storyId)" in restore


def test_director_blocker_has_one_job_aware_activity_action():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool/js/storyboard.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/storyboard.css").read_text(encoding="utf-8")

    assert html.count('id="storyboard-director-view-activity"') == 1
    assert "card.querySelector('[data-view-activity]')" not in storyboard
    assert "activityLink = document.createElement('button')" not in storyboard
    assert "activityButton.dataset.directorJobId = jobId;" in storyboard
    handler = storyboard.split("el('storyboard-director-view-activity').onclick", 1)[1].split("};", 1)[0]
    assert "this.dataset.directorJobId" in handler
    assert "window.focusActivityJob(jobId);" in handler
    assert "window.setActivityDrawerOpen(true);" in handler
    assert "grid-area: action;" in css
    assert 'grid-template-areas: "label" "phase" "detail" "action" "stop";' in css
    assert ".storyboard-director-activity [data-view-activity]" not in css
