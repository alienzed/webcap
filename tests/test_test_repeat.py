"""Exercise native Repeat and session VL functions without importing the full media stack."""
import ast
import re
import secrets
import sys
import types
from pathlib import Path

from pytest import MonkeyPatch


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tool/server/epoch_test_bench.py"


def functions(*names):
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert set(node.name for node in nodes) == set(names)
    namespace = {"__package__": "tool.server", "secrets": secrets, "re": re}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


def test_repeat_submits_independent_sessions_with_distinct_seeds(tmp_path):
    ns = functions("enqueue_repeated")
    calls = []

    def fake_enqueue(folder, prompt, **kwargs):
        calls.append(kwargs)
        return {"operation": "test_enqueue", "latest": {"session": "s" + str(len(calls))}}
    ns["enqueue"] = fake_enqueue
    ns["list_vision_models"] = lambda: []
    with MonkeyPatch.context() as patch:
        module = types.ModuleType("tool.server.storyboard_llm_runtime")
        module.list_vision_models = lambda: []
        patch.setitem(sys.modules, "tool.server.storyboard_llm_runtime", module)
        out = ns["enqueue_repeated"](tmp_path, {
            "repeat": 3, "prompt": "hello", "settings": {"seed": "42"},
            "selectedFiles": ["epoch.safetensors"],
        })
    assert [x["session"] for x in out["sessions"]] == ["s1", "s2", "s3"]
    assert len({x["settings"]["seed"] for x in calls}) == 3
    assert all(x["selected_files"] == ["epoch.safetensors"] for x in calls)


def test_repeat_one_preserves_seed_and_checked_vision(tmp_path):
    ns = functions("enqueue_repeated")
    submitted = []
    ns["enqueue"] = lambda folder, prompt, **kwargs: (
        submitted.append(kwargs) or {"latest": {"session": "s1"}}
    )
    with MonkeyPatch.context() as patch:
        module = types.ModuleType("tool.server.storyboard_llm_runtime")
        module.list_vision_models = lambda: [{"id": "vl"}]
        patch.setitem(sys.modules, "tool.server.storyboard_llm_runtime", module)
        ns["enqueue_repeated"](tmp_path, {
            "repeat": 1, "autoVl": True, "vlModel": "vl",
            "prompt": "hello", "settings": {"seed": "42"},
        })
    assert submitted[0]["auto_vl_model"] == "vl"
    assert submitted[0]["settings"]["seed"] == "42"


def test_partial_enqueue_returns_accepted_sessions_and_error(tmp_path):
    ns = functions("enqueue_repeated")
    attempts = []

    def fake_enqueue(folder, prompt, **kwargs):
        attempts.append(1)
        if len(attempts) == 2:
            raise RuntimeError("offline")
        return {"latest": {"session": "accepted"}}
    ns["enqueue"] = fake_enqueue
    with MonkeyPatch.context() as patch:
        module = types.ModuleType("tool.server.storyboard_llm_runtime")
        module.list_vision_models = lambda: []
        patch.setitem(sys.modules, "tool.server.storyboard_llm_runtime", module)
        response = ns["enqueue_repeated"](tmp_path, {"repeat": 3, "prompt": "hello"})
    assert len(response["sessions"]) == 1
    assert "offline" in response["errors"][0]


def test_numbered_vision_evidence_and_manual_priority(tmp_path):
    ns = functions("_test_auto_vl_question", "_test_auto_vl_compare", "complete_test_auto_vl")
    groups = [{"id": "G1", "options": ["red", "blue"], "expected": 2}]
    assert "G1" in ns["_test_auto_vl_question"](groups)
    assert ns["_test_auto_vl_compare"]("G1: 2", groups)[0]["result"] == "match"
    calls = []
    ns["app_config"] = types.SimpleNamespace(safe_join_fs_root=lambda name: tmp_path)
    ns["_session_directory"] = lambda folder, session: tmp_path
    ns["_session_vision_state"] = lambda directory: {}
    ns["update_vision"] = lambda folder, session, criteria: calls.append(criteria)
    context = {"testFolder": "set", "testSession": "s1", "testMedia": "a.png",
               "testQuestion": "G1", "testGroups": groups, "testModel": "vl"}
    ns["complete_test_auto_vl"](context, "G1: 2", 18)
    assert calls[0]["assessment"]["comparison"][0]["result"] == "match"
    ns["_session_vision_state"] = lambda directory: {"byMedia": {"a.png": {}}}
    ns["complete_test_auto_vl"](context, "G1: 1", 20)
    assert len(calls) == 1
