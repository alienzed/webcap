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
    assert 'id="set-scan-open-count"' in html
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
    assert 'id="set-scan-context-card"' not in html
    assert "Broad discovery, optionally guided by existing groups" in html
    assert 'id="set-scan-item-view"' in html
    assert 'id="set-scan-quality-summary"' in html
    assert 'id="set-scan-force-mode"' not in html
    assert 'class="set-scan-sight-shell"' in html
    assert "itemView.onclick = function () { openSightReviewForFile(el('set-scan-item-select').value); };" in scan
    assert "forceBtn.onclick = function () { runSetIntelligence('open'); };" in scan
    assert 'id="set-scan-details"' in html
    assert "<strong>Vision report</strong>" in html
    assert 'id="set-scan-report-count"' in html
    assert "currentRawResponse" in scan
    assert "rawResponses" in scan
    assert "rawResponseIndex" in scan
    assert "showRawResponse(fileName, 'Sight', result.text, result.sight);" in scan
    assert "responseSelect.onchange = selectRawResponse;" in scan
    assert "rescanBtn.onclick = function () { runSetIntelligence(); };" in scan
    assert "'Resume ' + String(openMissing) + ' Sight'" in scan
    assert "rescanBtn.disabled = !scopeCount || !!(coverage.known && !openMissing);" in scan
    assert "operation: 'intelligence_report'" in scan
    assert "function restoreCachedIntelligence(" in scan
    assert "if (setScanState.hasRun) return;" not in scan
    assert "Checking saved Sight for " in scan
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
    assert 'var files = setScanState.running ? setScanState.files.slice() : getSetIntelligenceScopeFiles();' in scan
    assert "if (!files.length) {\n      setCoverage(0, 0);" in scan
    assert 'entireSetToggle.onchange = openSetIntelligence;' in scan
    assert 'openVisionSchemaAssist();' in scan
    assert "openGuidedTagPass({ source: 'set' });" in scan
    assert 'schemaState.scopeFiles = getCurrentSetMediaFileNames();' in schema
    assert "if (opts.source === 'set') {\n      return getCurrentSetMediaFileNames();" in schema


def test_prepare_set_sight_retry_and_unlimited_output_contract():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")
    app = _read("tool/server/app.py")
    assert 'id="set-scan-item-select"' in html
    assert 'id="set-scan-item-retry"' in html
    assert 'id="set-scan-bad-retry"' in html
    assert "save_sight_attempt" in scan
    assert "item.issue || !item.structured" in scan
    assert "operation == \"save_sight_attempt\"" in app
    assert '"maxTokens": 1800' not in app


def test_sight_review_large_live_preview_and_explicit_source_switch():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")
    backend = _read("tool/server/vision_schema_assist.py")
    media = _read("tool/server/media.py")
    assert 'id="set-scan-preview-image"' in html
    assert 'id="set-scan-preview-video"' in html
    assert 'id="set-scan-preview-text"' in html
    assert 'id="sight-review-model"' in html
    assert 'id="sight-review-activate"' in html
    assert "operation:'sight_review'" in scan
    assert "operation:'activate_sight'" in scan
    assert "model_collection=\"vision_sights\"" in backend
    assert "model_collection=\"vision_sight_attempts\"" in backend
    assert 'next_info["vision_sights"] = cached["vision_sights"]' in media
    assert 'next_info["vision_sight_attempts"] = cached["vision_sight_attempts"]' in media
