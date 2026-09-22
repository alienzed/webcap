import pytest

from tool.server import storyboard_llm_runtime


def test_normalize_models_exposes_local_gguf_identity_and_status():
    payload = {
        "data": [
            {
                "id": "qwen-small",
                "path": "/models/director/qwen-small.gguf",
                "status": {"value": "unloaded"},
            },
            {
                "id": "qwen-large",
                "path": "/models/director/qwen-large.gguf",
                "status": {"value": "loaded"},
            },
        ]
    }

    models = storyboard_llm_runtime._normalize_models(payload)

    assert [model["id"] for model in models] == ["qwen-large", "qwen-small"]
    assert models[0]["label"] == "qwen-large.gguf"
    assert models[0]["status"] == "loaded"


def test_chat_uses_selected_model_disables_thinking_and_releases_gpu(monkeypatch):
    calls = []

    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: calls.append("server"))
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: calls.append("reserve"))
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: calls.append("load:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_model_status", lambda model_id: "loaded")
    monkeypatch.setattr(storyboard_llm_runtime, "_unload_model", lambda model_id: calls.append("unload:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "llama_server": "",
            "models_dir": None,
            "port": 8189,
            "context_size": 8192,
            "max_tokens": 4096,
        },
    )

    captured = {}

    def fake_http(path, method="GET", payload=None, timeout=30):
        captured["path"] = path
        captured["method"] = method
        captured["payload"] = payload
        return {
            "choices": [{"message": {"content": "final prompt"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 4},
        }

    monkeypatch.setattr(storyboard_llm_runtime, "_http_json", fake_http)

    result = storyboard_llm_runtime.chat(
        "qwen-large",
        [{"role": "user", "content": "Write the scene."}],
    )

    assert result["text"] == "final prompt"
    assert captured["path"] == "/v1/chat/completions"
    assert captured["payload"]["model"] == "qwen-large"
    assert captured["payload"]["reasoning_effort"] == "none"
    assert captured["payload"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert calls == [
        "server",
        "reserve",
        "free-comfy",
        "load:qwen-large",
        "unload:qwen-large",
        "release",
    ]


def test_chat_stops_owned_router_if_model_cannot_be_confirmed_unloaded(monkeypatch):
    calls = []
    owned_process = object()

    monkeypatch.setattr(storyboard_llm_runtime, "_process", owned_process)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_status", lambda model_id: "loaded")
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))
    monkeypatch.setattr(storyboard_llm_runtime, "stop_server", lambda: calls.append("stop"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "llama_server": "",
            "models_dir": None,
            "port": 8189,
            "context_size": 8192,
            "max_tokens": 4096,
        },
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_http_json",
        lambda *args, **kwargs: {"choices": [{"message": {"content": "prompt"}}]},
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_unload_model",
        lambda _model_id: (_ for _ in ()).throw(RuntimeError("still loaded")),
    )

    result = storyboard_llm_runtime.chat(
        "qwen-large",
        [{"role": "user", "content": "Write."}],
    )

    assert result["text"] == "prompt"
    assert calls == ["stop", "release"]


def test_chat_keeps_gpu_reserved_if_external_router_cannot_unload(monkeypatch):
    calls = []

    monkeypatch.setattr(storyboard_llm_runtime, "_process", None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: calls.append("reserve"))
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_status", lambda model_id: "loaded")
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "llama_server": "",
            "models_dir": None,
            "port": 8189,
            "context_size": 8192,
            "max_tokens": 4096,
        },
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_http_json",
        lambda *args, **kwargs: {"choices": [{"message": {"content": "prompt"}}]},
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_unload_model",
        lambda _model_id: (_ for _ in ()).throw(RuntimeError("still loaded")),
    )

    with pytest.raises(RuntimeError, match="GPU reservation is being kept"):
        storyboard_llm_runtime.chat(
            "qwen-large",
            [{"role": "user", "content": "Write."}],
        )

    assert calls == ["reserve"]


def test_run_contract_requires_prompt(monkeypatch):
    with pytest.raises(ValueError, match="prompt is empty"):
        storyboard_llm_runtime.run_contract("model", {"prompt": ""})


def test_ensure_server_accepts_compatible_existing_router(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_process", None)
    monkeypatch.setattr(storyboard_llm_runtime, "_health_ok", lambda: True)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_http_json",
        lambda *args, **kwargs: {
            "data": [{
                "id": "existing-model",
                "path": "/models/existing-model.gguf",
                "status": {"value": "unloaded"},
            }]
        },
    )

    storyboard_llm_runtime._ensure_server()
