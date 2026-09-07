from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_grouped_metadata_selection_uses_the_rendered_ratio_group_as_its_focus_set():
    script = (ROOT / "tool" / "js" / "preview_pane.js").read_text(encoding="utf-8")

    assert "function getMetadataFocusContext(fileName)" in script
    assert "if (!reviewMetadataTableState.grouped)" in script
    assert "var focusFiles = [fileName];" in script
    assert "scopedRows.filter(function (row) { return String((row && row.file) || '') === fileName; })[0]" in script
    assert "var bucket = mapAspectRatioToBucket(selectedRow.aspect);" in script
    assert "mapAspectRatioToBucket(row && row.aspect) === bucket" in script
    assert "source: 'Media Metadata · Aspect Ratio ' + bucket" in script
    assert "sortRows" not in script[script.index("function getMetadataFocusContext(fileName)"):script.index("function wireMetadataFileLinks()")]
    assert "selectByFileName(fileName, focusContext.files, focusContext.source, 'review');" in script
    assert "focusFiles: focusContext.files" in script
    assert "focusSource: focusContext.source" in script
    assert "reportType: 'review'" in script
