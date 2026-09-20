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
