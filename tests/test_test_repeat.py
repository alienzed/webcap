"""Repeat submits regular Test sessions; VL receipts belong to each session."""
from pathlib import Path

import pytest

from tool.server import epoch_test_bench as bench


def test_repeat_submits_independent_sessions_with_distinct_seeds(monkeypatch, tmp_path):
    accepted = []

    def fake_enqueue(folder, prompt, **kwargs):
        accepted.append(dict(kwargs))
        return {"operation": "test_enqueue", "latest": {
            "session": "session-" + str(len(accepted)), "status": "queued",
        }}
    monkeypatch.setattr(bench, "enqueue", fake_enqueue)
    response = bench.enqueue_repeated(tmp_path, {
        "repeat": 3, "prompt": "test", "settings": {"seed": "42"},
        "selectedFiles": ["epoch.safetensors"], "modelId": "h3",
    })
    assert len(accepted) == 3
    assert len(response["sessions"]) == 3
    seeds = [call["settings"]["seed"] for call in accepted]
    assert len(set(seeds)) == 3
    assert all(0 <= int(seed) <= 4294967295 for seed in seeds)
    assert all(call["selected_files"] == ["epoch.safetensors"] for call in accepted)
    assert all(call["auto_vl_model"] == "" for call in accepted)


def test_repeat_one_preserves_seed_and_opted_in_vl(monkeypatch, tmp_path):
    from tool.server import storyboard_llm_runtime
    monkeypatch.setattr(storyboard_llm_runtime, "list_vision_models", lambda: [{"id": "vl-model"}])
    accepted = []

    def fake_enqueue(folder, prompt, **kwargs):
        accepted.append(kwargs)
        return {"operation": "test_enqueue", "latest": {"session": "single"}}
    monkeypatch.setattr(bench, "enqueue", fake_enqueue)
    result = bench.enqueue_repeated(tmp_path, {
        "repeat": 1, "autoVl": True, "vlModel": "vl-model",
        "prompt": "test", "settings": {"seed": "42"},
    })
    assert result["sessions"] == [{"session": "single"}]
    assert accepted[0]["settings"]["seed"] == "42"
    assert accepted[0]["auto_vl_model"] == "vl-model"


def test_partial_repeat_submission_keeps_accepted_sessions_visible(monkeypatch, tmp_path):
    called = []

    def fake_enqueue(folder, prompt, **kwargs):
        called.append(1)
        if len(called) == 2:
            raise RuntimeError("Provider offline")
        return {"operation": "test_enqueue", "latest": {"session": "accepted"}}
    monkeypatch.setattr(bench, "enqueue", fake_enqueue)
    result = bench.enqueue_repeated(tmp_path, {"repeat": 3, "prompt": "test"})
    assert len(called) == 2
    assert result["sessions"] == [{"session": "accepted"}]
    assert "Provider offline" in result["errors"][0]


def test_vision_comparison_matches_existing_numbered_evidence():
    groups = [{"id": "G1", "options": ["red", "blue"], "expected": 2},
              {"id": "G2", "options": ["front", "rear"], "expected": 1}]
    question = bench._test_auto_vl_question(groups)
    assert "G1" in question and "G2" in question
    rows = bench._test_auto_vl_compare("G1: 2\nG2: unclear", groups)
    assert rows[0]["result"] == "match"
    assert rows[1]["result"] == "unclear"


def test_auto_vl_receipt_writes_existing_session_evidence(monkeypatch, tmp_path):
    writes = []
    monkeypatch.setattr(bench.app_config, "safe_join_fs_root", lambda path: tmp_path)
    monkeypatch.setattr(bench, "_session_directory", lambda folder, session: tmp_path)
    monkeypatch.setattr(bench, "_session_vision_state", lambda path: {})
    monkeypatch.setattr(bench, "update_vision", lambda folder, session, criteria: writes.append(criteria))
    context = {"testFolder": "set", "testSession": "s1", "testMedia": "a.png",
               "testQuestion": "G1", "testGroups": [{"id": "G1", "expected": 1,
               "options": ["red", "blue"]}], "testModel": "vl"}
    bench.complete_test_auto_vl(context, "G1: 1", 18)
    assert len(writes) == 1
    assert writes[0]["mediaFile"] == "a.png"
    assert writes[0]["assessment"]["comparison"][0]["result"] == "match"
    assert writes[0]["assessment"]["elapsedMs"] == 18
    monkeypatch.setattr(bench, "_session_vision_state", lambda path: {"byMedia": {"a.png": {}}})
    bench.complete_test_auto_vl(context, "G1: 2", 20)
    assert len(writes) == 1  # Do not overwrite explicit session-level evidence.
