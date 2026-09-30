from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_review_dataset_assistant_stays_local_to_review_and_existing_chat():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "review_assistant.js").read_text(encoding="utf-8")

    assert 'id="review-output-assistant-btn"' in html
    assert 'src="/static/js/review_assistant.js"' in html
    assert "id: 'review-dataset'" in script
    assert "getVisibleReviewItems()" in script
    assert "buildCombinedCaptionsText(items)" in script
    assert "'/fs/director/chat'" in script
    assert "'/fs/director/job?job='" in script
    assert "/fs/review/assistant" not in script
    assert "/caption/save" not in script
    assert "window.openAssistant({ mode: 'review-dataset' })" in script
