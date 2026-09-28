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
