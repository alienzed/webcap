"""Revise Scenes uses one server-owned LLM queue job per Story request."""
from pathlib import Path


def test_revision_queue_operation_is_routed():
    source = (Path(__file__).parents[1] / "tool/server/llm_runner.py").read_text()
    assert 'context.get("operation") == "revise_scenes_sequence"' in source
    assert 'scene_contract = build_request(story, scene_id, "refine_prompt", instruction=instruction)' in source
    assert '"revisedSceneCount": completed' in source


def test_revise_scenes_browser_submits_one_job():
    source = (Path(__file__).parents[1] / "tool/js/storyboard.js").read_text()
    start = source.index("  function reviseScenes(instruction, modelId, generateFreshTakes)")
    end = source.index("\n  function ", start + 10)
    block = source[start:end]
    assert "operation: 'revise_scenes_sequence'" in block
    assert "runSceneDirectorPass(" not in block


def test_fresh_takes_handoff_is_server_owned_and_opt_in():
    root = Path(__file__).parents[1]
    app = (root / "tool/server/app.py").read_text()
    runner = (root / "tool/server/llm_runner.py").read_text()
    ui = (root / "tool/js/storyboard.js").read_text()
    html = (root / "tool/tool.html").read_text()
    assert 'id="storyboard-director-tools-generate-takes"' in html
    assert '"generateFreshTakes": data.get("generateFreshTakes") is True' in app
    revision = runner.split('if client == "storyboard" and context.get("operation") == "revise_scenes_sequence":', 1)[1].split('    try:\\n        if client in {"chat", "caption"}:', 1)[0]
    assert 'if context.get("generateFreshTakes") is True:' in revision
    assert 'start_generation(str(context["storyId"]), scene_id)' in revision
    assert revision.index('if context.get("generateFreshTakes") is True:') > revision.index('completed += 1')
    assert 'generateFreshTakes: generateFreshTakes === true' in ui
    assert 'return enqueueSceneGeneration(storyId, sceneId);' not in ui.split('function runDirectorToolsRevision()', 1)[1].split('function bindUi()', 1)[0]
