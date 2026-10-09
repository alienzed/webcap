from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_set_intelligence_is_the_single_set_tools_entry_point():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")
    review = _read("tool/js/review_output.js")

    assert '<summary class="sidebar-drawer-summary">Set Tools</summary>' in html
    assert 'id="set-intelligence-open-btn"' in html
    assert 'id="discover-vocabulary-set-btn"' not in html
    assert 'id="guided-tag-pass-open-btn"' not in html
    assert 'id="set-scan-modal"' in html
    assert 'id="set-scan-response-select"' in html
    assert 'id="set-scan-open-card"' in html
    assert 'id="set-scan-context-card"' in html
    assert 'id="set-scan-open-count"' in html
    assert 'id="set-scan-context-count"' in html
    assert 'id="set-scan-rescan-btn"' in html
    assert 'id="set-intelligence-primary-btn"' in html
    assert 'id="set-intelligence-guided-btn"' in html
    assert 'id="set-intelligence-qa-btn"' in html
    assert 'src="/static/js/set_scan.js"' in html
    assert "openVisionSchemaAssist();" in scan
    assert "openGuidedTagPass({ source: 'set' });" in scan
    assert "setWorkspaceSurface('reviewOutput');" in scan
    assert "intelligenceBtn.classList.toggle('hidden'" in review


def test_set_intelligence_requires_llm_observation_and_interpretation():
    scan = _read("tool/js/set_scan.js")
    media = _read("tool/server/media.py")

    assert "loadCaptionVisionCapabilities()" in scan
    assert "getCaptionVisionModelId()" in scan
    assert "Select an available Vision model before running Set Intelligence." in scan
    assert "Select a Director model before running Set Intelligence." not in scan
    assert "operation: 'scan_sight'" in scan
    assert "operation: 'save_sight'" in scan
    assert "operation: 'scan_vocabulary_sight'" in scan
    assert "operation: 'save_vocabulary_sight'" in scan
    assert "captionTemplate: context.captionTemplate" in scan
    assert "existingGroups: context.groups" in scan
    assert "Skipped — no Vision model selected." not in scan
    assert "includeFaceFocus: true" in scan
    assert "includeSelectionPose: true" in scan
    assert 'record["vision_sight"]' in media


def test_set_intelligence_keeps_actionable_coverage_visible_and_raw_report_secondary():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")

    assert "WebCap analysis</strong>" not in html
    assert "Face Focus, MediaPipe pose" not in html
    assert 'id="set-scan-open-card"' in html
    assert 'id="set-scan-context-card"' in html
    assert "Broad image read, independent of vocabulary" in html
    assert "Second image read guided by groups, terms, and caption structure" in html
    assert 'id="set-scan-details"' in html
    assert "<strong>Vision report</strong>" in html
    assert 'id="set-scan-report-count"' in html
    assert "currentRawResponse" in scan
    assert "rawResponses" in scan
    assert "rawResponseIndex" in scan
    assert "showRawResponse(fileName, 'Open Sight', result.text);" in scan
    assert "showRawResponse(fileName, 'Context Sight', result.text);" in scan
    assert "responseSelect.onchange = selectRawResponse;" in scan
    assert "rescanBtn.onclick = runSetIntelligence;" in scan
    assert "'Resume ' + String(openMissing) + ' Open Sight'" in scan
    assert "'Resume ' + String(contextMissing) + ' Context Sight'" in scan
    assert "'Refresh ' + String(contextStale) + ' Context Sight'" in scan
    assert "rescanBtn.classList.toggle('hidden', !actionLabel);" in scan
    assert "operation: 'intelligence_report'" in scan
    assert "function restoreCachedIntelligence(" in scan
    assert "if (setScanState.hasRun) return;" not in scan
    assert "Checking saved Open Sight and Context Sight against the current Set" in scan
    assert "function recordSetIntelligenceFailure(" in scan
    assert "Set understood with gaps" in scan
    assert "Previous report preserved." in scan
    assert "setScanState.hasRun = false;" in scan
    assert "Next: review the vocabulary" in html


def test_set_intelligence_coverage_is_designed_for_readability_not_microcopy():
    css = _read("tool/css/modals.css")

    assert ".set-scan-evidence-grid" in css
    assert "font-size: 30px;" in css
    assert ".set-scan-evidence-detail" in css
    assert ".set-scan-details summary" in css
    assert "font-size: 15px;" in css
    assert ".set-scan-subtitle" in css
    assert "font-size: 14px;" in css


def test_set_intelligence_uses_visible_training_scope_with_explicit_full_set_override():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")
    schema = _read("tool/js/vision_schema_assist.js")

    assert 'id="set-scan-entire-set" type="checkbox"' in html
    assert 'id="set-scan-scope-summary"' in html
    assert 'return entireSet.checked ? getCurrentSetMediaFileNames() : getVisibleMediaSelectionForTraining();' in scan
    assert 'var files = getSetIntelligenceScopeFiles();' in scan
    assert "if (!files.length) {\n      setCoverage(0, 0, 0, 0, true);" in scan
    assert 'entireSetToggle.onchange = openSetIntelligence;' in scan
    assert 'openVisionSchemaAssist();' in scan
    assert "openGuidedTagPass({ source: 'set' });" in scan
    assert 'schemaState.scopeFiles = getCurrentSetMediaFileNames();' in schema
    assert "if (opts.source === 'set') {\n      return getCurrentSetMediaFileNames();" in schema
