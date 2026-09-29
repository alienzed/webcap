import json

import pytest

from tool.server import config as app_config
from tool.server import director_model_test_store as model_test


@pytest.fixture
def model_test_root(tmp_path, monkeypatch):
    monkeypatch.setattr(app_config, "FS_ROOT", tmp_path)
    return tmp_path


def test_protocol_is_fixed_versioned_expansion_task():
    assert model_test.PROTOCOL["id"] == "expansion-v1"
    assert model_test.PROTOCOL["sourceText"] == "A woman waits alone at a rainy bus stop at night."
    assert len(model_test.PROTOCOL["messages"]) == 1
    prompt = model_test.PROTOCOL["messages"][0]["content"]
    assert "Preserve the subject, action, setting, and tone." in prompt
    assert "do not introduce new characters" in prompt
    assert "under 250 words" in prompt


def test_session_freezes_models_and_persists_each_run(model_test_root):
    session = model_test.start_session([
        {
            "modelRef": "macbook::qwen3:8b",
            "runtimeId": "macbook",
            "runtimeName": "MacBook Pro",
            "modelId": "qwen3:8b",
            "label": "qwen3:8b",
            "sizeBytes": 1234,
        },
        {
            "modelRef": "local::gemma.gguf",
            "runtimeId": "local",
            "runtimeName": "Local",
            "modelId": "gemma.gguf",
            "label": "gemma.gguf",
            "sizeBytes": 5678,
        },
    ])

    assert session["status"] == "running"
    assert [item["modelRef"] for item in session["models"]] == [
        "macbook::qwen3:8b",
        "local::gemma.gguf",
    ]
    session_path = model_test_root / ".webcap_model_tests" / (session["id"] + ".json")
    assert session_path.is_file()

    saved = model_test.save_run(session["id"], {
        "modelRef": "macbook::qwen3:8b",
        "status": "completed",
        "queueSeconds": 1.25,
        "runtimeSeconds": 12.5,
        "preparingSeconds": 0.5,
        "loadingSeconds": 0,
        "generatingSeconds": 12,
        "totalSeconds": 13.75,
        "promptTokens": 100,
        "completionTokens": 200,
        "totalTokens": 300,
        "tokensPerSecond": 16.67,
        "outputWords": 140,
        "outputChars": 900,
        "usage": {"prompt_tokens": 100, "completion_tokens": 200, "total_tokens": 300},
        "backendTimings": {"predicted_per_second": 16.67},
        "text": "Expanded prompt.",
    })

    assert len(saved["runs"]) == 1
    assert saved["runs"][0]["runtimeName"] == "MacBook Pro"
    assert saved["runs"][0]["completionTokens"] == 200
    on_disk = json.loads(session_path.read_text(encoding="utf-8"))
    assert on_disk["runs"][0]["text"] == "Expanded prompt."


def test_failed_run_is_data_and_does_not_fail_session(model_test_root):
    session = model_test.start_session([{
        "modelRef": "offline::qwen",
        "runtimeId": "offline",
        "runtimeName": "Offline PC",
        "modelId": "qwen",
        "label": "qwen",
        "sizeBytes": 0,
    }])

    saved = model_test.save_run(session["id"], {
        "modelRef": "offline::qwen",
        "status": "failed",
        "error": "Could not connect to the configured Director endpoint.",
    })
    finished = model_test.finish_session(session["id"])

    assert saved["runs"][0]["status"] == "failed"
    assert "connect" in saved["runs"][0]["error"]
    assert finished["status"] == "completed"
    assert model_test.list_sessions()[0]["failedCount"] == 1


def test_run_must_belong_to_frozen_session(model_test_root):
    session = model_test.start_session([{
        "modelRef": "local::qwen.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "qwen.gguf",
        "label": "qwen.gguf",
    }])

    with pytest.raises(ValueError, match="does not belong"):
        model_test.save_run(session["id"], {
            "modelRef": "remote::other",
            "status": "completed",
        })


def test_protocol_run_uses_existing_chat_lane(monkeypatch):
    captured = {}

    def fake_enqueue(client, model_ref, contract, context=None, label=""):
        captured.update({
            "client": client,
            "modelRef": model_ref,
            "contract": contract,
            "context": context,
            "label": label,
        })
        return {"jobId": "job-1"}

    from tool.server import llm_runner
    monkeypatch.setattr(llm_runner, "enqueue", fake_enqueue)

    job = model_test.enqueue_protocol_run("macbook::qwen3:8b")

    assert job == {"jobId": "job-1"}
    assert captured["client"] == "chat"
    assert captured["modelRef"] == "macbook::qwen3:8b"
    assert captured["contract"]["operation"] == "freeform_chat"
    assert captured["contract"]["messages"] == model_test.PROTOCOL["messages"]
    assert captured["label"] == "Director Model Test"


def test_delete_session_removes_persisted_file(model_test_root):
    session = model_test.start_session([{
        "modelRef": "local::qwen.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "qwen.gguf",
        "label": "qwen.gguf",
    }])

    model_test.delete_session(session["id"])

    assert model_test.list_sessions() == []
    with pytest.raises(FileNotFoundError):
        model_test._read_session(session["id"])


def test_model_test_is_isolated_to_settings_and_feature_modules():
    root = __import__("pathlib").Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    app = (root / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")
    llm_runner = (root / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")
    runtime = (root / "tool" / "server" / "storyboard_llm_runtime.py").read_text(encoding="utf-8")

    assert 'id="director-model-test-settings"' in html
    assert '/static/js/director_model_test.js' in html
    assert "register_director_model_test_routes(app)" in app
    assert "/fs/director/job" in frontend
    assert "/fs/director/activity" in frontend
    assert "/fs/storyboard/director" in frontend
    assert "director_model_test" not in llm_runner
    assert "director_model_test" not in runtime
