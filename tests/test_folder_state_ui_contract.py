from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_folder_state_reads_legacy_caption_affixes_but_persists_only_canonical_wrappers():
    source = _read("tool/js/folder_state.js")

    assert "sanitizeAffixMap(src.caption_term_wrappers || src.caption_term_affixes, false)" in source

    sanitizer_start = source.index("function sanitizeFolderState")
    sanitizer_end = source.index("/**\n * Save the folder state", sanitizer_start)
    sanitizer = source[sanitizer_start:sanitizer_end]
    assert "caption_term_wrappers: captionTermWrappers" in sanitizer
    assert "caption_term_affixes:" not in sanitizer

    capture_start = source.index("function captureCurrentFolderStateSave")
    capture_end = source.index("/**\n * Apply the given folder state", capture_start)
    capture = source[capture_start:capture_end]
    assert "caption_term_wrappers:" in capture
    assert "caption_term_affixes:" not in capture


def test_incomplete_media_filter_is_retired_without_removing_checklist_progress():
    html = _read("tool/tool.html")
    source_paths = (
        "tool/js/constants.js",
        "tool/js/ui.js",
        "tool/js/media.js",
        "tool/js/main.js",
        "tool/js/smart_set.js",
        "tool/js/folder_state.js",
        "tool/server/smart_set.py",
    )

    assert 'id="advanced-filter-incomplete"' not in html
    assert "<strong>Incomplete</strong>: requirement groups" not in _read("tool/js/ui.js")
    for path in source_paths:
        code = _read(path)
        assert "advancedFilterIncompleteEl" not in code, path
        assert "incomplete_only" not in code, path

    # The item metadata panel's checklist progress is independent of the retired filter.
    details = _read("tool/js/item_details.js")
    assert "function computeRequirementProgressForMediaKey(" in details
    assert "var progress = computeRequirementProgressForMediaKey(currentMediaKey);" in details

    folder_state = _read("tool/js/folder_state.js")
    assert "media_filters: {" in folder_state
    assert "tag_mismatch_only: !!mediaFilters.tag_mismatch_only" in folder_state
    assert "needs_ai_validation_only: !!mediaFilters.needs_ai_validation_only" in folder_state
