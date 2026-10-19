"""Focused server-owned Test batch lifecycle and comparison contracts."""
import time

import pytest

from tool.server import test_batch


def test_question_and_comparison_preserve_numbered_groups():
    groups = [{"id": "G1", "label": "Shape", "options": ["round", "square"], "expected": 2},
              {"id": "G2", "label": "Color", "options": ["blue", "red"], "expected": 1}]
    question = test_batch._question(groups)
    assert "G1 (Shape): 1=round; 2=square" in question
    rows = test_batch._compare("G1: 2\nG2: unclear", groups)
    assert [(row["result"], row["selected"]) for row in rows] == [
        ("match", 2), ("unclear", None)]
    assert test_batch._compare("G1: none", groups)[0]["result"] == "mismatch"


def test_generation_only_batch_completes_without_vl(monkeypatch, tmp_path):
    sessions = {}
    updates = []
    def fake_request(folder, operation, criteria):
        assert operation == "test_enqueue"
        session = "session-" + str(len(sessions))
        sessions[session] = {"status": "complete", "results": [{"mediaFile": session + ".png"}]}
        return {"job": {"id": session}}
    monkeypatch.setattr(test_batch, "handle_request", fake_request)
    monkeypatch.setattr(test_batch, "open_session", lambda folder, session: sessions[session])
    monkeypatch.setattr(test_batch, "_assess", lambda *args: updates.append(args))
    with test_batch._LOCK:
        test_batch._BATCHES.clear()
    batch = test_batch.enqueue_batch(
        tmp_path, "test-set", 3, {"modelId": "model", "prompt": "prompt",
                                 "selectedFiles": ["a"], "settings": {}},
        False, "")
    for _ in range(100):
        current = next(b for b in test_batch.snapshot()["batches"] if b["id"] == batch["id"])
        if current["status"] not in {"queued", "running"}:
            break
        time.sleep(0.01)
    assert current["status"] == "complete"
    assert len(current["sessions"]) == 3
    assert current["finished"] == 3
    assert current["evaluated"] == 0
    assert not updates
    assert len({sessions[s]["results"][0]["mediaFile"] for s in current["sessions"]}) == 3


def test_cancellation_leaves_accepted_sessions_intact(monkeypatch, tmp_path):
    sessions = {}
    def fake_request(folder, operation, criteria):
        session = "session-" + str(len(sessions))
        sessions[session] = {"status": "running", "results": []}
        return {"job": {"id": session}}
    monkeypatch.setattr(test_batch, "handle_request", fake_request)
    monkeypatch.setattr(test_batch, "open_session", lambda folder, session: sessions[session])
    with test_batch._LOCK:
        test_batch._BATCHES.clear()
    batch = test_batch.enqueue_batch(
        tmp_path, "test-set", 1, {"modelId": "model", "prompt": "prompt",
                                 "selectedFiles": ["a"], "settings": {}},
        False, "")
    for _ in range(100):
        if test_batch.snapshot()["batches"][0]["sessions"]:
            break
        time.sleep(0.01)
    test_batch.cancel_batch(batch["id"])
    for _ in range(100):
        if test_batch.snapshot()["batches"][0]["status"] == "stopped":
            break
        time.sleep(0.01)
    assert test_batch.snapshot()["batches"][0]["status"] == "stopped"
    assert sessions["session-0"]["status"] == "running"


def test_single_validated_session_preserves_explicit_seed(monkeypatch, tmp_path):
    submitted = []
    def fake_request(folder, operation, criteria):
        assert operation == "test_enqueue"
        submitted.append(dict(criteria.get("settings") or {}))
        return {"job": {"id": "single-test"}}
    monkeypatch.setattr(test_batch, "handle_request", fake_request)
    monkeypatch.setattr(test_batch, "open_session", lambda folder, session: {"status": "complete", "results": []})
    monkeypatch.setattr(test_batch, "list_vision_models", lambda: [{"id": "vision"}])
    with test_batch._LOCK:
        test_batch._BATCHES.clear()
    batch = test_batch.enqueue_batch(
        tmp_path, "test-set", 1, {"modelId": "model", "prompt": "prompt",
                                 "selectedFiles": ["a"], "settings": {"seed": "12345"}},
        True, "vision", preserve_single_seed=True)
    for _ in range(100):
        snapshot = next(b for b in test_batch.snapshot()["batches"] if b["id"] == batch["id"])
        if snapshot["status"] not in {"queued", "running"}:
            break
        time.sleep(0.01)
    assert snapshot["status"] == "complete"
    assert submitted == [{"seed": "12345"}]
