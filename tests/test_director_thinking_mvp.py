import pytest

from tool.server import director_model_calibration
from tool.server import storyboard_llm_runtime as runtime


@pytest.mark.parametrize("response, expected", [
    ({"thinking": {"values": [True, False]}}, True),
    ({"thinking": {"values": [True]}}, False),
    ({"capabilities": ["completion", "thinking"]}, True),
    ({"capabilities": ["completion"]}, False),
])
def test_thinking_metadata_requires_switchable_model(monkeypatch, response, expected):
    monkeypatch.setattr(runtime, "_director_config", lambda: {"mode": "remote"})
    monkeypatch.setattr(runtime, "_remote_is_ollama", lambda: True)
    monkeypatch.setattr(runtime, "_remote_native_http_json", lambda *args, **kwargs: response)
    assert runtime.advertised_thinking("remote-1::test-model") is expected


@pytest.mark.parametrize("thinking, expected", [(True, "high"), (False, "none"), (None, None)])
def test_ollama_per_request_thinking_control(monkeypatch, thinking, expected):
    sent = {}
    monkeypatch.setattr(runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(runtime, "_model_record", lambda *_args: {})
    monkeypatch.setattr(runtime, "_director_config", lambda: {"mode": "remote", "max_tokens": None})
    monkeypatch.setattr(runtime, "_remote_is_ollama", lambda: True)
    monkeypatch.setattr(runtime, "_set_activity", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(runtime, "_ollama_running_model", lambda *_args: {"contextSize": 8192})

    def reply(_path, **kwargs):
        sent.update(kwargs["payload"])
        return {"choices": [{"message": {"content": "12"}, "finish_reason": "stop"}]}

    monkeypatch.setattr(runtime, "_remote_http_json_cancellable", reply)
    result = runtime.chat("remote-1::test-model", [{"role": "user", "content": "7+5?"}], thinking=thinking)
    assert result["text"] == "12"
    assert sent.get("reasoning_effort") == expected
    assert ("reasoning_effort" in sent) is (expected is not None)


@pytest.mark.parametrize("thinking", [True, False])
def test_llama_cpp_thinking_control(monkeypatch, thinking):
    sent = {}
    monkeypatch.setattr(runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(runtime, "_model_record", lambda *_args: {})
    monkeypatch.setattr(runtime, "_director_config", lambda: {"mode": "local", "max_tokens": None})
    monkeypatch.setattr(runtime, "_ensure_local_model_loaded", lambda *_args: None)
    monkeypatch.setattr(runtime, "_relay_log_updates", lambda: None)
    monkeypatch.setattr(runtime, "_set_activity", lambda *_args, **_kwargs: None)

    def reply(_path, **kwargs):
        sent.update(kwargs["payload"])
        return {"choices": [{"message": {"content": "12"}, "finish_reason": "stop"}]}

    monkeypatch.setattr(runtime, "_http_json", reply)
    result = runtime.chat("local::test-model", [{"role": "user", "content": "7+5?"}],
                          gpu_reserved=True, thinking=thinking)
    assert result["text"] == "12"
    assert sent["chat_template_kwargs"]["enable_thinking"] is thinking
    assert sent["reasoning_effort"] == ("high" if thinking else "none")


def test_thinking_report_boolean_is_persisted_by_normalization():
    report = {
        "modelRef": "local::director.gguf", "runtimeId": "local",
        "modelId": "director.gguf", "contextMode": "runtime",
        "status": "complete", "attempts": [], "thinking": True,
    }
    normalized = director_model_calibration.normalize_report(report)
    assert normalized["thinking"] is True
    assert director_model_calibration.normalize_report({**report, "thinking": False})["thinking"] is False
