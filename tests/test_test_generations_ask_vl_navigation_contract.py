"""Keep interactive Ask VL tied to its originating Test session during navigation."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ask_vl_switching_sessions_does_not_cancel_running_work():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    status_render = script.split("function renderStatus(status)", 1)[1].split("function testStatusHasPendingWork", 1)[0]
    results_render = script.split("function renderResults(status)", 1)[1].split("function syncActiveRunControls(status)", 1)[0]
    ask_vl = script.split("function runTestVlBatch()", 1)[1].split("function el(id)", 1)[0]

    assert "stopTestVl()" not in status_render
    assert "stopTestVl()" not in results_render
    assert "if (testVl.running || testVl.loadedScope === scope) return;" in script
    assert "askVlForTestPreview(folder, session, file, model, testVl.question" in ask_vl
    assert "}, session).then(function ()" in ask_vl
    assert "testVl.running = false;\n      // If a different session is displayed, restore its saved VL presentation now.\n      restoreTestVl(currentStatus);" in ask_vl

    # Surface navigation still cancels interactive Ask VL; this is session-only.
    open_pane = script.split("function openPane()", 1)[1].split("function openTestBatchDialog()", 1)[0]
    close_pane = script.split("function closePane()", 1)[1].split("function populateControls", 1)[0]
    assert "stopTestVl();" in open_pane
    assert "stopTestVl();" in close_pane
