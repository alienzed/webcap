from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def test_regular_build_is_default_with_native_review_fallback():
    tests=(ROOT/"tool/js/test_generations.js").read_text(encoding="utf-8")
    unified=(ROOT/"tool/js/test_generations_unified.js").read_text(encoding="utf-8")
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    assert "window.epochFinderPrepare(launchFolder);" in tests
    assert "window.testGenerationsUnifiedNativeRoute();" in tests
    assert "window.epochFinderShowMode('tests');" in tests
    assert "window.testGenerationsUnifiedDestination=function(destination)" in unified
    assert "window.testGenerationsUnifiedNativeRoute=function()" in unified
    assert "exitToNative();" in unified
    assert "window.testGenerationsUnifiedOpen=function()" in unified
    for id in ("test-generations-body","epoch-finder-screen","test-references-screen",
               "run-analytics-screen","test-unified-workspace","test-unified-legacy"):
        assert 'id="'+id+'"' in html
