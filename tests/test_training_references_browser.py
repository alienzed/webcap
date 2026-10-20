"""Contract coverage for the concept-first Training References browser."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_reference_browser_uses_run_defaults_and_concept_first_groups():
    script = (ROOT / "tool/js/test_references.js").read_text(encoding="utf-8")
    assert "GENERIC_GROUPS = new Set(" in script
    for name in ("viewpoint", "position", "hair", "body", "clothing", "lighting", "background"):
        assert "'" + name + "'" in script
    assert "function prioritizedGroups()" in script
    assert "function showGroup(group)" in script
    assert "function showTerm(term)" in script
    assert "var preferred = groups.find(" in script
    assert "runs[0] ? runs[0].jobId" in script
    assert "reference_vocabulary" in script
    assert "reference_candidates" in script
    assert "reference_selection_save" in script
    assert "reference_selection_remove" in script
    assert "window.testReferencesChoice = function" in script
    assert "localStorage" not in script


def test_reference_browser_has_no_duplicate_navigation_controls():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    section = html.split('id="test-references-screen"', 1)[1].split('id="run-analytics-screen"', 1)[0]
    for name in ("run", "groups", "tags", "gallery", "previous", "next", "refresh", "selected-count", "preview"):
        assert 'id="test-references-' + name + '"' in section
    assert 'id="test-references-skip"' not in section
    assert 'id="test-references-option"' not in section
    assert 'id="test-references-group"' not in section


def test_reference_run_order_is_explicit_and_campaign_reuses_scoped_saved_choice():
    server = (ROOT / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    finder = (ROOT / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    assert 'sorted(runs, key=lambda run: float(run.get("createdAt") or 0), reverse=True)' in server
    assert "item.groups.some(function (group)" in finder
    assert "window.testReferencesChoice(els('run').value, group, item.option)" in finder
    assert "candidate.group === group && candidate.media === chosen.media" in finder
    assert "window.testReferencesChoice(els('run').value, item.group" not in finder
