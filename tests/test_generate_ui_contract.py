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
    assert 'id="generate-queue-list"' in html
    assert 'id="generate-results"' in html

    assert "workspace === 'generate'" in shell
    assert "navigation.activity === 'generate'" in shell
    assert "window.openGenerateActivity" in shell
    assert "window.closeGenerateActivity" in shell

    assert "function openGenerateActivity()" in script
    assert "function runGenerate()" in script
    assert "function runDirector(operation)" in script
    assert "requestJson('/fs/inference')" in script
    assert "postJson('/fs/generate'" in script
    assert "uploadReference(file)" in script

    assert ".app-frame.workspace-generate-open > .app" in css
    assert ".generate-authoring" in css
    assert ".generate-queue-panel" in css
    assert ".generate-results" in css


def test_generate_reuses_concepts_not_storyboard_dom():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "storyboard-scene" not in script
    assert "storyboard-generation" not in script
    assert "storyId" not in script
    assert "sceneId" not in script
    assert "entryState" not in script
    assert "exitState" not in script

def test_generate_result_polling_preserves_existing_media_nodes():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "function resultKey(result)" in script
    assert "card.dataset.resultKey = resultKey(result)" in script
    assert "host.querySelectorAll('.generate-result-card[data-result-key]')" in script
    assert "if (!key || existingKeys[key]) return;" in script
    assert "host.insertBefore(buildResultCard(result), host.firstChild)" in script
    assert "host.innerHTML = results.map" not in script

def test_generate_director_is_a_reversible_prompt_editor():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    generation = (ROOT / "tool" / "server" / "generate_generation.py").read_text(encoding="utf-8")

    assert ">Expand with Director</button>" in html
    assert 'id="generate-director-restore"' in html
    assert "Restore Previous" in html
    assert "Describe what you want — a rough idea or a finished prompt." in html
    assert "Valid work queues even while Training owns the GPU." not in html
    assert "<strong>Setup</strong>" in html
    assert "<strong>Output</strong>" in html
    assert 'id="generate-status" class="generate-status-badge hidden"' in html
    assert ".generate-status-badge" in css
    assert ".generate-status-badge.is-error" in css

    assert "previousPrompt: null" in script
    assert "function restoreDirectorPrompt()" in script
    assert "generateState.director.previousPrompt = previousPrompt;" in script
    assert "generateState.director.previousPrompt = null;" in script
    assert "Storyboard prompt is injected at runtime." in script
    assert "window.localStorage.removeItem(promptStorageKey)" in script
    assert "function reportError(err, uiMessage)" in script
    assert "if (uiMessage) setStatus(uiMessage, 'error');" in script
    assert "if (status) status.textContent = message;" not in script
    assert "function conciseGenerateError(err, fallback)" in script
    assert "return 'ComfyUI unavailable';" in script
    assert "status.title = tone === 'error' ? 'See Console for details.' : '';" in script
    assert '"defaultPrompt": ""' in generation

def test_generate_tracks_terminal_jobs_and_preserves_queue_dom_identity():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")

    assert "trackedJobIds: loadTrackedGenerateJobs()" in script
    assert "function refreshTrackedGenerateJobs()" in script
    assert "requestJson('/fs/inference?job=' + encodeURIComponent(jobId))" in script
    assert "reportError(new Error(" in script
    assert "webcap.generate.trackedJobs" in script

    queue_start = script.index("function renderQueue()")
    queue_end = script.index("function refreshQueue()", queue_start)
    queue_code = script[queue_start:queue_end]
    assert "dataset.inferenceJobId" in queue_code
    assert "host.querySelectorAll('.generate-queue-row[data-inference-job-id]')" in queue_code
    assert "syncQueueRow(row, job)" in queue_code
    assert "host.innerHTML = jobs.map" not in queue_code

def test_generate_partial_reference_uploads_have_a_cleanup_path():
    script = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "function cleanupUploadedReferences(paths)" in script
    assert "postJson('/fs/generate/reference/cleanup'" in script
    assert "uploadedPaths.push(path)" in script
    assert "cleanupUploadedReferences(uploadedPaths)" in script
    assert '@app.route("/fs/generate/reference/cleanup", methods=["POST"])' in app

