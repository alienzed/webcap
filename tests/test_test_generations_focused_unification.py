"""Focused Test/Batch/Campaign launch and scoped epoch explorer parity."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_native_regular_and_campaign_launch_controls():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    finder = (ROOT / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    for key in ("test-generations-inline-count", "test-generations-inline-auto-vl",
                "epoch-finder-back-to-tests",
                "test-generations-prompt", "test-generations-aspect",
                "test-generations-megapixels", "test-generations-duration",
                "test-generations-seed",
                "test-generations-master-select", "test-generations-sweep-mode",
                "epoch-finder-run-choices",
                "epoch-finder-epoch-picker", "epoch-finder-reference-workspace",
                "epoch-finder-start", "epoch-finder-back", "epoch-finder-next"):
        assert 'id="' + key + '"' in html, key
    assert "test-generations-base-include" in js  # dynamically rendered by native candidate controller
    assert "el('test-generations-run-btn').onclick = startRun;" in js
    assert "criteria.repeat = repeat;" in js
    assert "criteria.autoVl = autoVl;" in js
    assert "function testRunCriteria()" in js
    assert "refreshSessions();" in js
    assert "preserveSingleSeed: count === 1" in js
    assert "def enqueue_repeated(folder_path, criteria):" in (ROOT / "tool/server/epoch_test_bench.py").read_text(encoding="utf-8")
    assert "epoch-finder-back-to-tests" in finder
    assert "showMode('tests')" in finder
    assert "window.epochFinderShowMode = showMode" in finder


def test_epoch_media_is_explicitly_scoped_and_bounded():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool/js/run_analytics.js").read_text(encoding="utf-8")
    server = (ROOT / "tool/server/epoch_finder.py").read_text(encoding="utf-8")
    assert 'id="run-analytics-epoch-media-dialog"' in html
    assert 'id="run-analytics-epoch-media-grid"' in html
    assert 'data-epoch-media-job' in js
    assert 'data-epoch-media-epoch' in js
    assert "limit:8" in js
    assert "checkpoints:[scope.jobId+':'+scope.epoch]" in js
    assert "epochMediaLoad(false)" in js
    assert "window.runAnalyticsViewEpoch" in js
    assert "data-view-epoch-media" in (ROOT / "tool/js/epoch_finder.js").read_text(encoding="utf-8")
    assert "epochMediaLoad(true)" in js
    assert "workspace_gallery" in server
    assert 'checkpoint_ids and source_job + ":" + str(epoch)' in server
    assert "window.openTestBenchAnalyticsSession" in js
    assert "window.epochFinderInspectCampaign" in js
    test_js = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    assert "data-test-epoch-media-job" in test_js
    assert "runAnalyticsViewEpoch" in test_js
    assert 'el(\'epoch-media-dialog\').close()' in js


def test_original_four_destinations_and_review_survive():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    for mode in ("tests", "finder", "references", "analytics"):
        assert 'data-test-workspace-mode="' + mode + '"' in html
    for control in ("test-generations-view-grid-btn", "test-generations-view-compare-btn",
                    "test-generations-preview-sort", "test-generations-ask-vl",
                    "test-generations-sessions-list",
                    "run-analytics-chart", "run-analytics-table",
                    "test-references-gallery", "epoch-finder-shortlist"):
        assert 'id="' + control + '"' in html, control
    assert "syncCompareVideos" in js
    assert "test_batch" not in (ROOT / "tool/js/run_analytics.js").read_text(encoding="utf-8")


def test_batch_ui_and_coordinator_are_retired():
    html = (ROOT / "tool/tool.html").read_text(encoding="utf-8")
    js = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/styles.css").read_text(encoding="utf-8")
    for old in ("test-generations-batch-summary", "test-generations-batch-modal",
                "test-generations-batch-results", "test-generations-batch-btn"):
        assert f'id="{old}"' not in html
        assert f"el('{old}')" not in js
    assert "function testRunCriteria()" in js
    assert js.count("var criteria = testRunCriteria();") == 0  # shared builder is validated through try/catch
    assert "criteria = testRunCriteria();" in js
    assert "function refreshServerTestBatches()" not in js
    assert "function syncTestBatchStopActions(batches)" not in js
    assert ".test-generations-batch-summary" not in css
    assert not (ROOT / "tool/server/test_batch.py").exists()
    assert 'id="test-generations-multi-actions"' not in html
