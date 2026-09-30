from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_review_workspace_exposes_contextual_assistant_action():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "review_assistant.js").read_text(encoding="utf-8")
    assistant = (ROOT / "tool" / "js" / "director_chat.js").read_text(encoding="utf-8")

    assert 'id="review-output-assistant-btn"' in html
    assert 'src="/static/js/review_assistant.js"' in html
    assert html.index('src="/static/js/director_chat.js"') < html.index('src="/static/js/review_assistant.js"')
    assert "id: 'review-dataset'" in script
    assert "Read-only analysis of the current visible caption set. Captions are never changed." in script
    assert "getVisibleReviewItems()" in script
    assert "files: files" in script
    assert "'/fs/review/assistant'" in script
    assert "/caption/save" not in script
    assert "window.openAssistant({" in script
    assert "instruction: DEFAULT_REVIEW_INSTRUCTION" in script
    assert "Object.prototype.hasOwnProperty.call(target, 'instruction')" in assistant


def test_review_assistant_mode_is_only_available_in_live_review_scope():
    script = (ROOT / "tool" / "js" / "review_assistant.js").read_text(encoding="utf-8")

    assert "el('review-output-surface')" in script
    assert "workspace.classList.contains('hidden')" in script
    assert "getReviewAvailability()" in script
    assert "available: reviewWorkspaceAvailable" in script


def test_review_assistant_uses_shared_llm_stop_semantics():
    script = (ROOT / "tool" / "js" / "review_assistant.js").read_text(encoding="utf-8")

    assert "'/fs/director/job?job='" in script
    assert "operation: 'stop_or_cancel'" in script
    assert "cancel: cancelReviewDataset" in script
