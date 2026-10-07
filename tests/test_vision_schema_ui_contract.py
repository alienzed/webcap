from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_schema_assist_is_contextual_and_reuses_existing_vision_and_schema_paths():
    html = _read("tool/tool.html")
    script = _read("tool/js/vision_schema_assist.js")
    checklist = _read("tool/js/checklist_state.js")
    main = _read("tool/js/main.js")

    assert 'id="vision-schema-open-btn"' in html
    assert html.index('id="vision-schema-open-btn"') < html.index('id="checklist-settings-btn"')
    assert 'id="vision-schema-modal"' in html
    assert 'id="vision-schema-scan-btn"' in html
    assert 'id="vision-schema-tags-btn"' in html
    assert 'id="vision-schema-skip-btn"' in html
    assert 'id="vision-schema-proposal-heading"' in html
    assert 'id="vision-schema-suggest-btn"' not in html
    assert 'src="/static/js/vision_schema_assist.js"' in html
    assert html.index('src="/static/js/caption_vision.js"') < html.index('src="/static/js/vision_schema_assist.js"')

    assert "operation: 'scan_sight'" in script
    assert "operation: 'save_sight'" in script
    assert "operation: 'analyze'" in script
    assert "operation: 'synthesize'" in script
    assert "operation: 'suggest_tags'" in script
    assert "waitForCaptionAssistJob(payload.job)" in script
    assert "cancelCaptionAssistJob(schemaState.currentVisionJobId)" in script
    assert "mergeChecklistSchemaVocabulary(mutations)" in script
    assert "assignChecklistTagToMediaKey(item.key, candidate.group, candidate.term" in script

    assert "function addChecklistGroup(requirementLabel, options)" in checklist
    assert "function mergeChecklistKeywordTermsForRequirement(requirementLabel, terms, options)" in checklist
    assert "function mergeChecklistSchemaVocabulary(mutations)" in checklist
    assert "if (addChecklistGroup(val)) addInput.value = '';" in main


def test_schema_assist_keeps_scan_ephemeral_and_schema_mutations_explicit():
    script = _read("tool/js/vision_schema_assist.js")

    assert "localStorage" not in script
    assert "sessionStorage" not in script
    assert "scanStopRequested" in script
    assert "schemaStarting" in script
    assert "schemaRequestToken" in script
    html = _read("tool/tool.html")
    assert "Discovery changes vocabulary only; it does not tag media." in html
    assert "Add Selected to Vocabulary" in html
    assert "check.checked = !term.alreadyExists;" in script
    assert "check.disabled = false;" in script
    assert "function canonicalExistingGroup(name)" in script
    assert "function runDiscovery()" in script
    assert "runScan({ discoverAfter: true });" in script
    assert "function currentVocabularyGroup()" in script
    assert "function skipCurrentVocabularyGroup()" in script
    assert "scanBtn.onclick = runDiscovery;" in script
    assert "skipBtn.onclick = skipCurrentVocabularyGroup;" in script
    assert "applyBtn.onclick = applySelected;" in script



def test_discover_vocabulary_is_single_action_and_one_group_at_a_time():
    html = _read("tool/tool.html")
    script = _read("tool/js/vision_schema_assist.js")

    assert html.count('id="vision-schema-scan-btn"') == 1
    assert ">Discover Vocabulary</button>" in html
    assert "Structured Sight</strong>" not in html
    assert "vision-schema-evidence-column" not in html
    assert "Merge Selected Vocabulary" not in html
    assert "schemaState.reviewIndex = 0;" in script
    assert "Group ' + String(groupIndex + 1) + ' of ' + String(groups.length)" in script
    assert "String(term.support || 0) + ' items'" in script
    assert "advanceVocabularyReview(message);" in script


def test_schema_assist_materializes_only_explicitly_selected_tag_candidates():
    script = _read("tool/js/vision_schema_assist.js")

    assert "check.checked = candidate.confidence === 'high';" in script
    assert "function selectedTagCandidates()" in script
    assert "function applySelectedTags()" in script
    assert "candidate.existing" in script
    assert "mergeChecklistSchemaVocabulary(vocabularyMutations)" in script
    assert "assignChecklistTagToMediaKey(item.key, candidate.group, candidate.term, { skipRefresh: true })" in script
    assert "schemaState.scopeFiles = getVisibleMediaSelectionForTraining();" in script


def test_guided_tag_pass_reuses_grid_and_keeps_new_vocabulary_out_of_primary_flow():
    html = _read("tool/tool.html")
    script = _read("tool/js/vision_schema_assist.js")
    grid_actions = _read("tool/js/media_grid_actions.js")
    grid_tiles = _read("tool/js/media_grid_tiles.js")
    workbench = _read("tool/js/group_workbench.js")

    assert 'id="guided-tag-pass-open-btn"' in html
    assert 'id="media-grid-guided-pass"' in html
    assert 'id="vision-schema-raw-output"' in html
    assert "window.openGuidedTagPass = openGuidedTagPass;" in script
    assert "appendRawResponse(fileName, result.text);" in script
    assert "if (!candidate || !candidate.existing) return;" in script
    assert "mediaGridReplaceSelection(Array.from(selected));" in script
    assert "mediaGridState." not in script
    assert "onTermMutation" in workbench
    assert "handleGuidedTagPassGridTermMutation" not in workbench
    assert "window.syncGuidedTagPassWorkbenchHighlight" in grid_tiles
    assert "window.openGuidedTagPass({ source: 'grid' });" in grid_actions
    assert "openMediaGridSurface();" in script
