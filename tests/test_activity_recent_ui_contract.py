from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_recent_history_reveals_duration_and_absolute_finish_time():
    js = (ROOT / "tool/js/activity_monitor.js").read_text(encoding="utf-8")
    css = (ROOT / "tool/css/workspace_shell.css").read_text(encoding="utf-8")

    assert "duration ? 'Ran ' + duration" in js
    assert "wait ? 'Queued ' + wait" in js
    assert "syncRecentFinishedTime(age, item)" in js
    assert "syncRecentFinishedTime(row.querySelector('time'), item)" in js
    assert "date.toLocaleString(undefined, sameDay" in js
    assert "element.title = clock" in js
    assert ".activity-monitor-details .activity-monitor-recent-copy small {\n  display: block;" in css
