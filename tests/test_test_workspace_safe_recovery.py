"""Evaluation opens with the native Prompt Tests form and keeps native review destinations."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]


def test_evaluation_uses_existing_native_surfaces_and_warm_return():
    tests=(ROOT/"tool/js/test_generations.js").read_text(encoding="utf-8")
    finder=(ROOT/"tool/js/epoch_finder.js").read_text(encoding="utf-8")
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    assert "window.epochFinderPrepare(launchFolder);" in tests
    assert "window.epochFinderShowMode('tests');" in tests
    assert "window.testGenerationsUnifiedNativeRoute();" not in tests
    assert "window.epochFinderShowMode = showMode;" in finder
    assert "if (warmReturn)" in tests
    for id in ("test-generations-body","epoch-finder-screen","test-references-screen",
               "run-analytics-screen","epoch-finder-manual-matrix"):
        assert 'id="'+id+'"' in html
