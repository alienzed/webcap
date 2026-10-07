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
    assert 'src="/static/js/vision_schema_assist.js"' in html
    assert html.index('src="/static/js/caption_vision.js"') < html.index('src="/static/js/vision_schema_assist.js"')

    assert "requestVisionImageCaptionDescription(mediaItem" in script
    assert "operation: 'save_sight'" in script
    assert "operation: 'analyze'" in script
    assert "operation: 'synthesize'" in script
    assert "waitForCaptionAssistJob(payload.job)" in script
    assert "cancelCaptionAssistJob(schemaState.currentVisionJobId)" in script
    assert "addChecklistGroup(group)" in script
    assert "mergeChecklistKeywordTermsForRequirement(group, mutation.terms)" in script

    assert "function addChecklistGroup(requirementLabel)" in checklist
    assert "function mergeChecklistKeywordTermsForRequirement(requirementLabel, terms)" in checklist
    assert "if (addChecklistGroup(val)) addInput.value = '';" in main


def test_schema_assist_keeps_scan_ephemeral_and_schema_mutations_explicit():
    script = _read("tool/js/vision_schema_assist.js")

    assert "localStorage" not in script
    assert "sessionStorage" not in script
    assert "scanStopRequested" in script
    assert "Nothing changes until you apply selected vocabulary." in _read("tool/tool.html")
    assert "check.checked = !term.alreadyExists;" in script
    assert "applyBtn.onclick = applySelected;" in script
