from pathlib import Path

import tool.server.config as config_module


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_group_assignments_have_separate_persisted_identity_from_unscoped_tags():
    checklist = _read("tool/js/checklist_state.js")
    details = _read("tool/js/item_details.js")
    folder_state = _read("tool/js/folder_state.js")

    assert "var checklistAssignmentsByMedia = {}" in checklist
    assert "caption_group_tags_by_media" in checklist
    assert "caption_group_tags_by_media" in folder_state
    assert "function getUnscopedTagsForMediaKey(mediaKey)" in details
    assert "getChecklistAssignedTermsForMediaKey(mediaKey)" in details
    assert "Group annotations must use assignChecklistTagToMediaKey()." in details


def test_scoping_a_group_tag_consumes_matching_unscoped_tag_without_flattening_identity():
    checklist = _read("tool/js/checklist_state.js")
    details = _read("tool/js/item_details.js")

    assign_block = checklist.split("function assignChecklistTagToMediaKey", 1)[1].split(
        "function unassignChecklistTagFromMediaKey", 1
    )[0]
    assert "consumeUnscopedTagForMediaKey(key, term" in assign_block
    assert "opts.consumeUnscoped !== false" in assign_block
    assert "hasChecklistAssignedTagForMediaKey(key, requirement, term)" in assign_block
    assert "entry.term + ' · ' + entry.requirement" in details
    assert "tag + ' · unscoped'" in details


def test_group_workbench_selection_never_uses_generic_tag_presence_as_group_state():
    workbench = _read("tool/js/group_workbench.js")

    assert "hasChecklistAssignedTagForMediaKey" in workbench
    assert "assignChecklistTagToMediaKey" in workbench
    assert "unassignChecklistTagFromMediaKey" in workbench
    assert "hasTagForMediaKey(" not in workbench


def test_primer_resolves_group_placeholders_from_assignments_and_legacy_tag_mappings_from_unscoped_tags():
    folder_state = _read("tool/js/folder_state.js")

    primer_block = folder_state.split("function buildPrimerFromConfig", 1)[1]
    assert "getChecklistAssignmentEntriesForMediaKey(mediaKey)" in primer_block
    assert "normalizeRequirementPrimerKey(entry.requirement)" in primer_block
    assert "renderChecklistGroupTermWithAffixes(entry.requirement, entry.term, mediaKey)" in primer_block
    assert "getUnscopedTagsForMediaKey(mediaKey)" in primer_block
    assert "getRequirementDefaultPrimerMappings()" not in primer_block


def test_group_term_styling_is_scoped_locally_and_in_global_config():
    checklist = _read("tool/js/checklist_state.js")
    modal = _read("tool/js/checklist_modals.js")
    app_settings = _read("tool/js/app_settings.js")
    server_config = _read("tool/server/config.py")

    assert "var checklistTermWrappersByGroup = {}" in checklist
    assert "var checklistTermDescriptorDefaultsByGroup = {}" in checklist
    assert "function openChecklistTermAffixesModal(requirementLabel, termText)" in modal
    assert "setChecklistGroupTermWrapper(requirement, term" in modal
    assert "setChecklistGroupTermDescriptorDefault(requirement, term" in modal
    assert "termWrappersByGroup" in app_settings
    assert 'requirements.get("termWrappersByGroup")' in server_config


def test_orphaned_group_assignment_keeps_saved_group_wrapper_available():
    checklist = _read("tool/js/checklist_state.js")

    wrapper_block = checklist.split("function getChecklistGlobalGroupWrapper", 1)[1].split(
        "function getChecklistGlobalGroupWrapperPrefix", 1
    )[0]
    assert "getConfigRequirementTermWrappersByGroup()" in wrapper_block
    assert "isChecklistGroupTermPinnedGlobally" not in wrapper_block


def test_group_vocabulary_changes_do_not_delete_stored_assignments():
    checklist = _read("tool/js/checklist_state.js")

    vocabulary_block = checklist.split("function setChecklistKeywordTermsForRequirement", 1)[1].split(
        "function getChecklistGroupTermsCatalog", 1
    )[0]
    assert "checklistAssignmentsByMedia" not in vocabulary_block
    assert "unassignChecklistTagFromMediaKey" not in vocabulary_block


def test_prompt_expectations_do_not_merge_all_hair_colours_by_type():
    script = _read("tool/js/test_generations.js")

    expectations = script.split("function extractPromptExpectations", 1)[1].split(
        "function escapePromptExpectationTitle", 1
    )[0]
    assert "if (type === 'Hair') return true;" not in expectations
    assert "return promptTargetsMatch(item.target, colorItem.target);" in expectations


def test_config_sanitizer_preserves_group_scoped_wrappers():
    payload = {
        "requirements": {
            "termWrappersByGroup": {
                "Hair": {
                    "Brown": {"prefix": "dark", "suffix": "hair"},
                },
                "Background": {
                    "Brown": {"prefix": "warm", "suffix": ""},
                },
            }
        }
    }

    clean = config_module.validate_config_payload(payload)

    assert clean["requirements"]["termWrappersByGroup"] == {
        "Hair": {"brown": {"prefix": "dark", "suffix": "hair"}},
        "Background": {"brown": {"prefix": "warm", "suffix": ""}},
    }


def test_scoped_caption_match_requires_scoped_rendered_evidence():
    checklist = _read("tool/js/checklist_state.js")

    helper = checklist.split("function checklistGroupTermAppearsInCaptionText", 1)[1].split(
        "function checklistGroupTermAppearsInCurrentCaption", 1
    )[0]
    assert "renderChecklistGroupTermWithAffixes(requirementLabel, term, key)" in helper
    assert "if (rendered && rendered.toLowerCase() !== term.toLowerCase())" in helper
    rendered_branch = helper.split("if (rendered && rendered.toLowerCase() !== term.toLowerCase())", 1)[1]
    assert "return captionContainsPhrase(text, rendered);" in rendered_branch
    assert "return captionContainsTagWithAllowances(text, term);" in rendered_branch

    requirement = checklist.split("function requirementKeywordsMatch", 1)[1].split(
        "function getChecklistSelectedTagsForRequirementForMediaKey", 1
    )[0]
    assert "checklistGroupTermAppearsInCaptionText(requirement, assignedTerms[i], mediaKey, captionText)" in requirement
    assert "captionContainsPhrase(captionValue, term)" not in requirement


def test_group_workbench_passes_media_key_to_scoped_caption_matching():
    workbench = _read("tool/js/group_workbench.js")

    assert "requirementKeywordsMatch(requirementLabel, captionText, mediaKey)" in workbench


def test_full_item_copy_paste_preserves_unscoped_and_scoped_identity():
    details = _read("tool/js/item_details.js")

    paste = details.split("function pasteClipboardTagsToMediaKey", 1)[1].split(
        "function pasteClipboardTagsToCurrentItem", 1
    )[0]
    assert "mergeTagsIntoMediaKey(key, clipboard.unscoped || [])" in paste
    assert "consumeUnscoped: false" in paste
    assert "consumeUnscoped: true" not in paste


def test_focused_quick_picks_do_not_hide_terms_selected_in_other_groups():
    focus = _read("tool/js/focused_annotation.js")

    quick_picks = focus.split("function buildFocusedAnnotationQuickPickEntries", 1)[1].split(
        "function buildFocusedAnnotationSetUsageEntries", 1
    )[0]
    assert "getChecklistAssignedTagsForMediaKey(mediaKey, requirementLabel)" in quick_picks
    assert "getSelectionPoseSuggestedTags(metadataRow, currentGroupTags)" in quick_picks
    assert "currentGroupTags.forEach(function (tag)" in quick_picks


def test_orphaned_global_wrapper_editor_keeps_global_ownership():
    modal = _read("tool/js/checklist_modals.js")

    assert "wrapperStoredGlobally" in modal
    assert "var isGlobal = !!checklistTermAffixesModalState.wrapperStoredGlobally;" in modal
    assert "if (isGlobal) return false;" in modal
    assert "var shouldSaveGlobalWrapper = isGlobal && (" in modal


def test_legacy_flat_tags_only_migrate_when_group_scope_is_unambiguous():
    checklist = _read("tool/js/checklist_state.js")
    details = _read("tool/js/item_details.js")

    migrate = checklist.split("function migrateLegacyChecklistAssignments", 1)[1].split(
        "function loadChecklistFromFolderState", 1
    )[0]
    assert "Object.prototype.hasOwnProperty.call(folderState, 'caption_group_tags_by_media')" in migrate
    assert "if (requirements.length !== 1) return;" in migrate
    assert "checklistLegacyScopedTermsByMedia" in migrate
    assert "migrateLegacyChecklistAssignments(folderState);" in checklist

    load_tags = details.split("function loadItemTagsFromFolderState", 1)[1].split(
        "function renderItemTagsPanel", 1
    )[0]
    assert "checklistLegacyScopedTermsByMedia[mediaKey][low]" in load_tags


def test_generic_frequent_tag_suggestions_only_use_unscoped_tags():
    details = _read("tool/js/item_details.js")

    helper = details.split("function buildUnscopedTagUsageEntries", 1)[1].split(
        "function renderItemTagsPanel", 1
    )[0]
    assert "getUnscopedTagsForMediaKey(item.key)" in helper

    render = details.split("function renderItemTagsPanel", 1)[1].split(
        "function refreshMediaResolutionCache", 1
    )[0]
    assert "buildUnscopedTagUsageEntries(20)" in render
    assert "getAnnotateStripGroups()" not in render


def test_caption_helper_catalog_includes_scoped_assignments_including_orphans():
    catalog = _read("tool/js/caption_helpers_catalog.js")

    terms = catalog.split("function getCaptionHelperCatalogTerms", 1)[1].split(
        "function captionPhraseBoundaryPattern", 1
    )[0]
    assert "checklistAssignmentsByMedia" in terms
    assert "getChecklistAssignmentEntriesForMediaKey(mediaKey)" in terms
    assert "entry.term" in terms


def test_incomplete_progress_does_not_render_empty_parentheses():
    details = _read("tool/js/item_details.js")

    progress = details.split("function computeRequirementProgressForMediaKey", 1)[1].split(
        "function computeReviewedProgressForMediaKey", 1
    )[0]
    assert "missing.push(requirementLabel);" in progress
    assert "terms.join(', ')" not in progress
