"""Unified workspace contract: read-only evidence and lossless legacy fallback."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def test_evaluation_surfaces_use_native_controllers_without_reparenting():
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    finder=(ROOT/"tool/js/epoch_finder.js").read_text(encoding="utf-8")
    backend=(ROOT/"tool/server/epoch_finder.py").read_text(encoding="utf-8")
    for mode in ("tests","screening","finder","analytics","references"):
        assert f'data-test-workspace-mode="{mode}"' in html
    assert 'id="test-unified-builder"' not in html
    assert 'id="test-unified-gallery"' not in html
    assert 'src="/static/js/test_generations_unified.js"' not in html
    assert "window.epochFinderShowMode = showMode;" in finder
    assert "def workspace_gallery(folder_path" in backend
    assert 'if operation == "workspace_gallery":' in backend


def test_results_are_read_only_and_provenance_scoped():
    finder=(ROOT/"tool/server/epoch_finder.py").read_text(encoding="utf-8")
    gallery=finder.split("def workspace_gallery(",1)[1].split("def command(",1)[0]
    assert 'provenance.get("sourceJobId")' in gallery
    assert 'provenance.get("sourceEpoch")' in gallery
    assert 'source_folder !=' in gallery
    assert 'source_job, epoch = "", None' in gallery
    for forbidden in ('_save(', '_update(', '_launch(', '_delete(', '.unlink(', 'thread.start('):
        assert forbidden not in gallery

def test_original_workflows_remain_available():
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    for marker in ('id="test-generations-run-btn"','id="test-generations-inline-count"',
                   'id="epoch-finder-start"','id="epoch-finder-pause"',
                   'id="epoch-finder-resume"','id="epoch-finder-stop"',
                   'id="run-analytics-director"','id="test-references-gallery"'):
        assert marker in html


def test_insights_and_references_keep_their_own_live_dom():
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    js=(ROOT/"tool/js/epoch_finder.js").read_text(encoding="utf-8")
    for element in ("test-generations-body","epoch-finder-screen",
                    "test-references-screen","run-analytics-screen"):
        assert f'id="{element}"' in html
    assert "document.getElementById('test-references-screen').classList.toggle" in js
    assert "document.getElementById('run-analytics-screen').classList.toggle" in js
