from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_color_suggestions_are_lazy_and_group_scoped():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    group_workbench = (ROOT / "tool" / "js" / "group_workbench.js").read_text(encoding="utf-8")
    feature = (ROOT / "tool" / "js" / "color_suggestions.js").read_text(encoding="utf-8")

    assert '/static/js/color_suggestions.js' in html
    assert "isColorSuggestionRequirement(requirementLabel)" in group_workbench
    assert "renderColorSuggestionsForGroup(groupEl, requirementLabel, mediaKey, terms)" in group_workbench
    assert "label === 'color' || label === 'colour'" in feature
    assert "/fs/color_suggestions?folder=" in feature
    assert "requestColorSuggestionsForMediaKey(mediaKey)" in feature


def test_detecting_colors_does_not_mutate_group_taxonomy():
    feature = (ROOT / "tool" / "js" / "color_suggestions.js").read_text(encoding="utf-8")

    request_start = feature.index("function requestColorSuggestionsForMediaKey")
    apply_start = feature.index("function applyColorSuggestionToRequirement")
    request_block = feature[request_start:apply_start]

    assert "setChecklistKeywordTermsForRequirement" not in request_block
    assert "addTagToMediaKey" not in request_block


def test_unmatched_color_click_adds_group_term_and_scoped_assignment_in_one_folder_state_write():
    feature = (ROOT / "tool" / "js" / "color_suggestions.js").read_text(encoding="utf-8")
    item_details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")

    assert "setChecklistKeywordTermsForRequirement(requirement, localTerms)" in feature
    assert "assignChecklistTagToMediaKey(key, requirement, term" in feature
    assert "skipSave: true" in feature
    assert "writeCapturedFolderState(capturedSave).then" in feature
    assert "changes were rolled back" in feature
    assert "checklistAssignmentsByMedia = previousAssignments" in feature
    assert "if (!opts.skipSave)" in item_details
    assert "if (!opts.skipUndo" in item_details


def test_existing_group_colors_rank_before_novel_suggestions():
    feature = (ROOT / "tool" / "js" / "color_suggestions.js").read_text(encoding="utf-8")

    assert "if (aExisting !== bExisting) return bExisting - aExisting;" in feature
    assert "inGroup ? term : ('+ ' + term)" in feature
