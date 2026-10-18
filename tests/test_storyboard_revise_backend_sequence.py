"""Revise Scenes uses one server-owned LLM queue job per Story request."""
from pathlib import Path


def test_revision_queue_operation_is_routed():
    source = (Path(__file__).parents[1] / "tool/server/llm_runner.py").read_text()
    assert 'context.get("operation") == "revise_scenes_sequence"' in source
    assert 'scene_contract = build_request(story, scene_id, "refine_prompt", instruction=instruction)' in source
    assert '"revisedSceneCount": completed' in source


def test_revise_scenes_browser_submits_one_job():
    source = (Path(__file__).parents[1] / "tool/js/storyboard.js").read_text()
    start = source.index("  function reviseScenes(instruction, modelId)")
    end = source.index("\n  function ", start + 10)
    block = source[start:end]
    assert "operation: 'revise_scenes_sequence'" in block
    assert "runSceneDirectorPass(" not in block
