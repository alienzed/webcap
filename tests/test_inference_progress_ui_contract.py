from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_inference_progress_formatting_is_shared_across_surfaces():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    generate = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    tests = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    queue = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")

    assert "function formatInferenceProgress(progress)" in common
    assert "function formatInferenceJobStatus(job)" in common
    assert "return formatInferenceJobStatus(job);" in generate
    assert "return formatInferenceJobStatus({" in storyboard
    assert "formatInferenceProgress(status.progress)" in tests
    assert "formatInferenceProgress(job.progress)" in queue


def test_inference_progress_formatter_has_elapsed_fallback_without_eta():
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")

    assert "formatInferenceElapsedMs(Date.now() - (startedAt * 1000))" in common
    assert "ETA" not in common



def test_queued_inference_position_is_compact_without_changing_active_status():
    queue = (ROOT / "tool" / "js" / "inference_queue.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")

    assert "job.queuePosition ? '#' + String(job.queuePosition) : 'Queued'" in queue
    assert "'Queued · position #' + String(job.queuePosition)" in queue
    assert "if (status === 'running') return 'Running';" in queue
    assert "if (status === 'backlog') return 'Backlog';" in queue
    assert "row.appendChild(position);" not in queue
    assert "heading.appendChild(position);" in queue
    assert "heading.appendChild(title);" in queue
    assert "copy.appendChild(heading);" in queue
    assert "grid-template-columns: 76px minmax(0, 1fr) auto;" not in css
    assert "grid-template-columns: minmax(0, 1fr) auto;" in css
    assert ".inference-queue-heading {" in css
    assert ".inference-queue-heading strong {" in css
    style = css.split(".inference-queue-row.status-queued .inference-queue-position {", 1)[1].split("}", 1)[0]
    assert "padding: 0;" in style
    assert "border: 0;" in style
    assert "background: transparent;" in style
