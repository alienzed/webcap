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
    assert "getDirectorModelPreference()" in scan
    assert "Select an available Vision model before running Set Intelligence." in scan
    assert "Select a Director model before running Set Intelligence." in scan
    assert "operation: 'scan_sight'" in scan
    assert "operation: 'save_sight'" in scan
    assert "Skipped — no Vision model selected." not in scan
    assert "includeFaceFocus: true" in scan
    assert "includeSelectionPose: true" in scan
    assert 'record["vision_sight"]' in media


def test_set_intelligence_hides_supporting_analyzers_and_raw_output_by_default():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")

    assert "WebCap analysis</strong>" not in html
    assert "Face Focus, MediaPipe pose" not in html
    assert 'id="set-scan-details"' in html
    assert '<summary>Scan details</summary>' in html
    assert "details.classList.toggle('hidden', !setScanState.rawResponses.length);" in scan
    assert "Next: review the vocabulary" in html
