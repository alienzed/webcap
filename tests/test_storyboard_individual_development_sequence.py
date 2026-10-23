"""Individual Scene development remains one Director job across all model calls."""
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_backend_owns_the_complete_sequence():
    app = (ROOT / "tool/server/app.py").read_text()
    runner = (ROOT / "tool/server/llm_runner.py").read_text()
    batch = runner.split('context.get("operation") == "develop_scenes_sequence":', 1)[1].split(
        'context.get("operation") == "check_coherence_sequence":', 1
    )[0]
    assert 'if operation == "develop_scenes_sequence":' in app
    assert '"sourceUpdatedAt": str(story.get("updatedAt") or "")' in app
    assert 'build_request(story, "", "develop_story_outline")' in batch
    assert '"develop_story_scene", development=' in batch
    assert '"previousScene": authored[-1] if authored else None' in batch
    assert batch.index('for index in range(total):') < batch.index('apply_developed_plan(')
    assert 'with _mutation_lock:' in batch
    assert 'check_stopped()' in batch
    assert 'source_revision' in batch
    assert '"phase": "Developing Scenes"' in batch
    assert '"phase": "Applying Scenes"' in batch


def test_browser_submits_one_job_and_uses_job_progress():
    js = (ROOT / "tool/js/storyboard.js").read_text()
    individual = js.split('function developStoryIndividually(', 1)[1].split(
        '\n  function suggestStoryboardLoras()', 1
    )[0]
    assert individual.count('directorRequest({') == 1
    assert "operation: 'develop_scenes_sequence'" in individual
    assert "operation: 'develop_story_scene'" not in individual
    assert "operation: 'apply_individual_development'" not in individual
    assert "operation === 'develop_scenes_sequence'" in js
    assert "var developing = operation === 'develop_scenes_sequence';" in js
