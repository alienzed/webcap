from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_duplicates_review_tab_and_script_are_wired():
    html = _read("tool/tool.html")
    constants = _read("tool/js/constants.js")

    assert 'data-review-detail-tab="duplicates"' in html
    assert 'id="duplicate-candidates-pane"' in html
    assert 'id="duplicate-candidates-list"' in html
    assert html.index('src="/static/js/media_grid_actions.js"') < html.index('src="/static/js/duplicate_candidates.js"') < html.index('src="/static/js/main.js"')
    assert "duplicateCandidateGroups" in constants
    assert "duplicateCandidatesParentFocusSet" in constants


def test_duplicate_ui_uses_visible_scope_and_existing_grid_prune_paths():
    duplicate_script = _read("tool/js/duplicate_candidates.js")
    review_script = _read("tool/js/review_output.js")
    single_prune = _read("tool/js/media_actions.js")
    grid_prune = _read("tool/js/media_grid_actions.js")

    assert "getFilteredMediaItems(false)" in duplicate_script
    assert "'/fs/duplicate_candidates'" in duplicate_script
    assert "selected_media: scopeFiles" in duplicate_script
    assert "activateFocusSet(files, label, 'duplicateCandidates')" in duplicate_script
    assert "openMediaGridSurface();" in duplicate_script
    assert "if (reportType === 'duplicateCandidates')" in review_script
    assert "returnToDuplicateCandidatesReport();" in review_script
    assert "removeDuplicateCandidateFile(mediaItem.key);" in single_prune
    assert "pickReplacementVisibleMediaItem" in single_prune
    assert "removeDuplicateCandidateFile(key);" in grid_prune
    assert "/media/prune" not in duplicate_script
    assert "prune.textContent = 'Prune';" in duplicate_script
    assert "media.onclick = function () { selectByFileName(item.file); };" in duplicate_script
    assert "event.stopPropagation();" in duplicate_script
    assert "pruneMedia({ key: item.file, fileName: item.file }, { selectReplacement: false })" in duplicate_script
    assert "Keep" not in duplicate_script
    assert "Delete" not in duplicate_script
