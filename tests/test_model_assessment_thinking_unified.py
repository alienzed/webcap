from pathlib import Path

from tool.server import storyboard_llm_runtime as runtime


def test_unified_assessment_thinking_visible_without_legacy_report(monkeypatch):
    from tool.server import director_model_calibration, model_lab
    monkeypatch.setattr(director_model_calibration, "get_report", lambda _ref: None)
    monkeypatch.setattr(model_lab, "capability_run_summaries", lambda: [
        {"models": {"local::yes.gguf": {"director_thinking": {"status": "completed", "supported": True}},
                    "local::no.gguf": {"director_thinking": {"status": "failed", "supported": False}}}}
    ])
    models = [{"id": "local::yes.gguf"}, {"id": "local::no.gguf"}]
    runtime._attach_assessment_signals(models)
    assert models[0]["assessment"]["thinking"] is True
    assert models[1]["assessment"]["thinking"] is False


def test_actual_diagnostics_table_has_thinking_column():
    source = Path("tool/js/diagnostics.js").read_text(encoding="utf-8")
    assert "{key: 'thinking', name: 'Thinking'}" in source
    assert "panel.colSpan = 10" in source
    assert "tests.director_thinking" in source


def test_legacy_model_lab_tab_removed_but_advanced_access_preserved():
    html = Path("tool/tool.html").read_text(encoding="utf-8")
    assert 'id="diagnostics-tab-model-lab"' not in html
    assert 'id="diagnostics-assessment-lab"' in html
    assert 'id="diagnostics-panel-model-lab"' in html


def test_model_assessment_bulk_selection_uses_header_checkbox():
    html = Path("tool/tool.html").read_text(encoding="utf-8")
    source = Path("tool/js/diagnostics.js").read_text(encoding="utf-8")
    assert 'id="diagnostics-assessment-all"' not in html
    assert 'id="diagnostics-assessment-none"' not in html
    assert "selectAll.id = 'diagnostics-assessment-select-all'" in source
    assert "header.indeterminate = checked > 0 && checked < inputs.length" in source
