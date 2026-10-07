from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_review_dataset_assistant_remains_optional_chat_mode_but_does_not_own_qa_deep_scan():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "review_assistant.js").read_text(encoding="utf-8")
    qa = (ROOT / "tool" / "js" / "qa_workbench.js").read_text(encoding="utf-8")

    assert 'src="/static/js/review_assistant.js"' in html
    assert "id: 'review-dataset'" in script
    assert "'/fs/director/chat'" in script
    assert "'/fs/director/job?job='" in script
    assert "/fs/review/assistant" not in script
    assert "/caption/save" not in script
    assert "label: 'Full review'" in script
    assert "label: 'Consistency'" in script
    assert "label: 'Balance'" in script
    assert "label: 'Outliers'" in script
    assert "'/fs/qa/deep-scan'" in qa
    assert "window.bindReviewAssistantButton();" not in qa
