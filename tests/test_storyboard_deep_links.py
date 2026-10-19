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
