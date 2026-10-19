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
