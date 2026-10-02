from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_generate_is_first_class_static_activity():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    shell = (ROOT / "tool" / "js" / "workspace_shell.js").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "generate.css").read_text(encoding="utf-8")

    assert 'id="activity-generate-btn"' in html
    assert 'id="generate-workspace"' in html
    assert 'data-workspace-root="generate"' in html
    assert 'id="generate-prompt"' in html
    assert 'id="generate-model"' in html
    assert 'id="generate-director-model"' in html
    assert 'id="generate-lora-list"' in html
    assert 'id="generate-reference-first_frame"' in html
    assert 'id="generate-reference-last_frame"' in html
    assert 'id="inference-queue-drawer"' in html
    assert 'data-inference-queue-toggle' in html
    assert 'id="generate-results"' in html

    assert "workspace === 'generate'" in shell
    assert "navigation.activity === 'generate'" in shell
    assert "window.openGenerateActivity" in shell
    assert "window.closeGenerateActivity" in shell

    assert "function openGenerateActivity()" in script
    assert "function runGenerate()" in script
    assert "function runDirector(operation)" in script
    assert "window.refreshInferenceQueue" in script
    assert "postJson('/fs/generate'" in script
    assert "uploadReference(file)" in script

    assert ".app-frame.workspace-generate-open > .app" in css
    assert ".generate-create-view" in css
    assert ".generate-stage-panel" in css
    assert ".generate-takes-panel" in css
    assert ".generate-results" in css


def test_generate_reuses_concepts_not_storyboard_dom():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "storyboard-scene" not in script
    assert "storyboard-generation" not in script
    assert "storyId" not in script
    assert "sceneId" not in script
    assert "entryState" not in script
    assert "exitState" not in script


def test_generate_results_refresh_on_queue_transitions_without_perpetual_polling():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function resultKey(result)" in script
    assert "card.dataset.resultKey = resultKey(result)" in script
    assert "host.querySelectorAll('.generate-result-card[data-result-key]')" in script
    assert "if (!key || existingKeys[key]) return;" in script
    assert "host.insertBefore(buildResultCard(result), host.firstChild)" in script
    assert "host.innerHTML = results.map" not in script
    assert "webcap:inference-queue-snapshot" in script
    assert "refreshTrackedGenerateJobs(queue)" in script
    assert "return refreshResultsNeeded ? refreshResults() : jobs;" in script
    assert "function schedulePoll()" not in script
    assert "generateState.timer" not in script

