"""Epoch Finder workflow-level queue contracts.

The queue coordinates campaign sequencing only. It must never reorder individual
inference or LLM jobs, start a paused campaign, or automatically resume after restart.
"""
import threading
import time

from tool.server import epoch_finder


def test_multiple_campaign_launches_are_fifo_without_new_execution_lane(tmp_path, monkeypatch):
    entered = []
    release = threading.Event()
    saved = {}

    def fake_load(folder, campaign_id):
        return saved[campaign_id]

    def fake_update(folder, campaign, **fields):
        campaign.update(fields)

    def fake_run(folder, campaign_id, control):
        entered.append(campaign_id)
        if campaign_id == "a" or campaign_id == "b":
            release.wait(timeout=2)
        with epoch_finder._worker_lock:
            epoch_finder._workers.pop(campaign_id, None)
            epoch_finder._controls.pop(campaign_id, None)
            while epoch_finder._pending_campaigns:
                target, next_id = epoch_finder._pending_campaigns.pop(0)
                if saved[next_id]["status"] == "queued":
                    epoch_finder._start_campaign_worker_locked(target, next_id)
                    break

    monkeypatch.setattr(epoch_finder, "_load", fake_load)
    monkeypatch.setattr(epoch_finder, "_update", fake_update)
    monkeypatch.setattr(epoch_finder, "_run", fake_run)
    # Isolate the process-global coordinator between test invocations.
    with epoch_finder._worker_lock:
        assert not any(t.is_alive() for t in epoch_finder._workers.values())
        epoch_finder._pending_campaigns.clear()

    for key in ("a", "b", "c"):
        saved[key] = {"status": "paused"}
        epoch_finder._launch(tmp_path, key)

    assert saved["b"]["status"] == "queued"
    assert saved["c"]["status"] == "queued"
    assert entered == ["a"]
    release.set()
    deadline = time.monotonic() + 3
    while len(entered) != 3 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert entered == ["a", "b", "c"]

    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        with epoch_finder._worker_lock:
            if not epoch_finder._workers:
                break
        time.sleep(0.01)
    with epoch_finder._worker_lock:
        assert not epoch_finder._workers
        assert not epoch_finder._pending_campaigns
