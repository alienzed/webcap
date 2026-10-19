"""Unified workspace contract: read-only evidence and lossless legacy fallback."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def test_unified_workspace_integrates_with_existing_routes():
    html=(ROOT/"tool/tool.html").read_text(encoding="utf-8")
    js=(ROOT/"tool/js/test_generations_unified.js").read_text(encoding="utf-8")
    finder=(ROOT/"tool/server/epoch_finder.py").read_text(encoding="utf-8")
    for marker in ('id="test-unified-gallery"','id="test-unified-inspector"',
                   'id="test-unified-builder"','id="test-unified-experiments"',
                   'id="test-unified-checkpoints"','id="test-unified-legacy"'):
        assert marker in html
    assert 'src="/static/js/test_generations_unified.js"' in html
    assert "def workspace_gallery(folder_path" in finder
    assert 'if operation == "workspace_gallery":' in finder
    assert "operation:'workspace_gallery'" in js
    assert "window.epochFinderInspectCampaign" in js
    assert "window.openTestBenchAnalyticsSession" in js
    assert "window.epochFinderShowMode" in js

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
    for marker in ('id="test-generations-run-btn"','id="test-generations-batch-btn"',
                   'id="epoch-finder-start"','id="epoch-finder-pause"',
                   'id="epoch-finder-resume"','id="epoch-finder-stop"',
                   'id="run-analytics-director"','id="test-references-gallery"'):
        assert marker in html
