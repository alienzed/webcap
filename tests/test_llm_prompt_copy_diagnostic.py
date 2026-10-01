from pathlib import Path

import pytest

from tool.server import config as app_config
from tool.server import execution_queue
from tool.server import llm_runner
from tool.server import storyboard_llm_runtime


ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def llm_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", Path(tmp_path))
    monkeypatch.setattr(app_config, "output_root", lambda: Path(tmp_path) / "output")
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
    execution_queue.ephemeral_lane("llm").clear()
    llm_runner._startup_reconciled = True
    llm_runner._monitor_thread = None
    llm_runner._local_gpu_drain_until = 0.0
    storyboard_llm_runtime.clear_stop_request()
    monkeypatch.setattr(llm_runner, "_ensure_monitor_started", lambda: None)
    return tmp_path


def test_enqueue_returns_exact_freeform_request_without_polluting_queue_snapshots(llm_root):
    job = llm_runner.enqueue(
        "chat",
        "qwen",
        {
            "operation": "freeform_chat",
            "messages": [
                {"role": "user", "content": "  Hi  "},
                {"role": "assistant", "content": " Hello "},
                {"role": "user", "content": " Continue "},
            ],
        },
        label="Director Chat",
    )

    assert job["request"] == {
        "messages": [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello"},
            {"role": "user", "content": "Continue"},
        ],
        "messageCount": 3,
        "contentChars": len("Hi") + len("Hello") + len("Continue"),
    }

    queued = llm_runner.job_status(job["jobId"])
    assert "request" not in queued
    snapshot = llm_runner.snapshot()
    assert snapshot["jobs"]
    assert "request" not in snapshot["jobs"][0]


def test_enqueue_returns_exact_contract_prompt_as_single_outbound_message(llm_root):
    job = llm_runner.enqueue(
        "storyboard",
        "qwen",
        {"operation": "expand_concept", "prompt": "  Expand this concept.  ", "output": "text"},
        context={"storyId": "story-1", "sceneId": "", "operation": "expand_concept"},
        label="Story: expand concept",
    )

    assert job["request"] == {
        "messages": [{"role": "user", "content": "Expand this concept."}],
        "messageCount": 1,
        "contentChars": len("Expand this concept."),
    }


def test_llm_activity_cards_expose_copy_only_prompt_diagnostics():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assistant = (ROOT / "tool" / "js" / "director_chat.js").read_text(encoding="utf-8")
    storyboard = (ROOT / "tool" / "js" / "storyboard.js").read_text(encoding="utf-8")
    generate = (ROOT / "tool" / "js" / "generate.js").read_text(encoding="utf-8")
    test_generations = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")

    for control_id in (
        "director-chat-prompt-copy",
        "storyboard-director-prompt-copy",
        "generate-director-prompt-copy",
        "test-generations-director-prompt-copy",
    ):
        assert f'id="{control_id}"' in html

    assert "JSON.stringify(request.messages, null, 2)" in assistant
    assert "payload.job.request || null" in assistant
    assert "requestByJobId" in storyboard
    assert "JSON.stringify(request.messages, null, 2)" in storyboard
    assert "response.job && response.job.request || null" in generate
    assert "JSON.stringify(request.messages, null, 2)" in generate
    assert "payload.job && payload.job.request || null" in test_generations
    assert "JSON.stringify(request.messages, null, 2)" in test_generations

    for script in (assistant, storyboard, generate, test_generations):
        assert "Prompt sent · " in script

    assert "<pre" not in html
