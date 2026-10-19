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


def test_optional_fresh_takes_use_server_owned_revision_handoff():
    root = Path(__file__).parents[1]
    html = (root / "tool/tool.html").read_text()
    ui = (root / "tool/js/storyboard.js").read_text()
    app = (root / "tool/server/app.py").read_text()
    runner = (root / "tool/server/llm_runner.py").read_text()

    assert 'id="storyboard-director-tools-generate-takes"' in html
    assert "generateFreshTakes: generateFreshTakes === true" in ui
    assert '"generateFreshTakes": data.get("generateFreshTakes") is True' in app
    revision = runner.split(
        'if client == "storyboard" and context.get("operation") == "revise_scenes_sequence":', 1
    )[1].split('    try:\n        if client in {"chat", "caption"}:', 1)[0]
    assert 'if context.get("generateFreshTakes") is True:' in revision
    assert 'start_generation(str(context["storyId"]), scene_id)' in revision
    assert revision.index("completed += 1") < revision.index('if context.get("generateFreshTakes") is True:')
    assert revision.index('if context.get("generateFreshTakes") is True:') < revision.index('status="completed", result=')
    modal_submit = ui.split("function runDirectorToolsRevision()", 1)[1].split("function bindUi()", 1)[0]
    assert "enqueueSceneGeneration(" not in modal_submit


def test_coherence_uses_one_queue_job_and_isolates_scene_prompts():
    root = Path(__file__).parents[1]
    ui = (root / "tool/js/storyboard.js").read_text()
    app = (root / "tool/server/app.py").read_text()
    runner = (root / "tool/server/llm_runner.py").read_text()
    assert "operation: 'check_coherence_sequence'" in ui
    assert 'if operation == "check_coherence_sequence":' in app
    assert 'context.get("operation") == "check_coherence_sequence"' in runner
    batch = runner.split('context.get("operation") == "check_coherence_sequence":', 1)[1].split(
        'if client == "storyboard" and context.get("operation") == "revise_scenes_sequence":', 1
    )[0]
    assert 'build_request(story, scene_id, "check_coherence")' in batch
    assert 'apply_director_prompt' not in batch
    assert '"originalPrompt": original' in batch
    assert '"prompt": str(data["prompt"])' in batch
    assert "showCoherenceReview(storyId, result.scenes || [], modelId)" in ui
    assert "Apply Selected" in ui


def test_revise_scenes_follows_authoritative_progress_without_new_polling():
    root = Path(__file__).parents[1]
    runner = (root / "tool/server/llm_runner.py").read_text()
    ui = (root / "tool/js/storyboard.js").read_text()
    batch = runner.split(
        'if client == "storyboard" and context.get("operation") == "revise_scenes_sequence":', 1
    )[1].split('    try:\\n        if client in {"chat", "caption"}:', 1)[0]
    assert '"sceneId": scene_id' in batch
    assert batch.index('"sceneId": scene_id') < batch.index('result = run_contract(')
    receipt = ui.split("function directorJobRequest(jobId, consume)", 1)[1].split("\\n  function ", 1)[0]
    assert "followRevisionProgress(body.job);" in receipt
    follower = ui.split("function followRevisionProgress(job)", 1)[1].split("\\n  function ", 1)[0]
    assert "job.operation !== 'revise_scenes_sequence'" in follower
    assert "job.status !== 'running'" in follower
    assert "progress.phase !== 'Revising Scenes'" in follower
    assert "followVisibleWorkingScene(job.storyId, progress.sceneId, true)" in follower
    visible = ui.split("function followVisibleWorkingScene(storyId, sceneId, visualOnly)", 1)[1].split("\\n  function ", 1)[0]
    assert "if (!visualOnly) clearSceneNewTakeCount(targetSceneId);" in visible
    assert "if (!visualOnly && typeof window.syncShellLocationRoute" in visible
