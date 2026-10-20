"""Keep interactive Ask VL tied to its originating Test session during navigation."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ask_vl_switching_sessions_does_not_cancel_running_work():
    script = (ROOT / "tool/js/test_generations.js").read_text(encoding="utf-8")
    render = script.split("function renderStatus(status)", 1)[1].split("function testStatusHasPendingWork", 1)[0]
    close = script.split("function closePane()", 1)[1].split("function openPane()", 1)[0]
    restore = script.split("function restoreTestVl(status)", 1)[1].split("function testVlQuestion", 1)[0]
    session = script.split("function queueTestVlForSession(status, selectedResults)", 1)[1].split("\n  function ", 1)[0]
    assert "stopTestVl()" not in render
    assert "stopTestVl()" not in close
    assert "var running = testVlRuns[scope];" in restore
    assert "testVl.entries = running.entries;" in restore
    assert "var scope = folder + '|' + session;" in session
    assert "testVlRuns[scope] = run;" in script
    assert "delete testVlRuns[scope];" in script
    assert "askVlForTestPreview(run.folder, run.session, file, run.model, run.question" in script

