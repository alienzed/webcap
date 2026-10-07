from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_set_scan_is_primary_set_tools_intelligence_entry_point():
    html = _read("tool/tool.html")
    scan = _read("tool/js/set_scan.js")
    review = _read("tool/js/review_output.js")

    assert '<summary class="sidebar-drawer-summary">Set Tools</summary>' in html
    assert 'id="set-scan-open-btn"' in html
    assert 'id="discover-vocabulary-set-btn"' in html
    assert 'id="guided-tag-pass-open-btn"' in html
    assert 'id="set-scan-modal"' in html
    assert 'src="/static/js/set_scan.js"' in html
    assert html.index('src="/static/js/caption_vision.js"') < html.index('src="/static/js/set_scan.js"')
    assert html.index('src="/static/js/set_scan.js"') < html.index('src="/static/js/vision_schema_assist.js"')
    assert "getCurrentSetMediaFileNames()" in scan
    assert "includeFaceFocus: true" in scan
    assert "includeSelectionPose: true" in scan
    assert "if (!model)" in scan
    assert "Skipped — no Vision model selected." in scan
    assert "operation: 'scan_sight'" in scan
    assert "operation: 'save_sight'" in scan
    assert "Set scan complete." in scan
    assert "scanBtn.classList.toggle('hidden'" in review
    assert "discoverBtn.classList.toggle('hidden'" in review


def test_set_scan_reuses_existing_caches_and_keeps_llm_optional():
    scan = _read("tool/js/set_scan.js")
    media = _read("tool/server/media.py")

    assert "refreshMediaResolutionCache({" in scan
    assert "/fs/vision_schema?folder=" in scan
    assert "!item.structured" in scan
    assert "currentVisionModel" not in scan
    assert "getCaptionVisionModelId()" in scan
    assert "director" not in scan.lower()
    assert 'record["vision_sight"]' in media
    assert '"inventory": dict(vision_sight.get("inventory") or {})' in media
