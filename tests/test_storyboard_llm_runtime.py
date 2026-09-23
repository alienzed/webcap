import pytest

from tool.server import storyboard_llm_runtime


def test_director_capacity_defaults_leave_room_for_whole_story_output():
    assert storyboard_llm_runtime.DEFAULT_CONTEXT_SIZE == 16384
    assert storyboard_llm_runtime.DEFAULT_MAX_TOKENS == 8192


def test_completion_result_rejects_token_limit_truncation():
    response = {
        "choices": [{
            "message": {"content": "{\"scenes\": [\"partial\"]}"},
            "finish_reason": "length",
        }]
    }

    with pytest.raises(RuntimeError, match="output was truncated"):
        storyboard_llm_runtime._completion_result(response, "director")


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


def test_chat_uses_selected_model_disables_thinking_retains_model_and_releases_gpu(monkeypatch):
    calls = []

    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: calls.append("server"))
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: calls.append("reserve"))
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_ensure_local_model_loaded",
        lambda model_id: calls.append("ensure:" + model_id),
    )
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
        "ensure:qwen-large",
        "release",
    ]


def test_ensure_local_model_loaded_reuses_loaded_selection(monkeypatch):
    calls = []
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "list_models",
        lambda reload=False: [
            {"id": "qwen-large", "status": "loaded"},
            {"id": "qwen-small", "status": "unloaded"},
        ],
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: calls.append("load:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_unload_model", lambda model_id: calls.append("unload:" + model_id))

    assert storyboard_llm_runtime._ensure_local_model_loaded("qwen-large") is False
    assert calls == []


def test_ensure_local_model_loaded_switches_models(monkeypatch):
    calls = []
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "list_models",
        lambda reload=False: [
            {"id": "qwen-large", "status": "loaded"},
            {"id": "qwen-small", "status": "unloaded"},
        ],
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: calls.append("load:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_unload_model", lambda model_id: calls.append("unload:" + model_id))

    assert storyboard_llm_runtime._ensure_local_model_loaded("qwen-small") is True
    assert calls == ["unload:qwen-large", "load:qwen-small"]

def test_chat_stops_owned_router_if_model_cannot_be_confirmed_unloaded(monkeypatch):
    calls = []
    owned_process = object()

    monkeypatch.setattr(storyboard_llm_runtime, "_process", owned_process)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_local_model_loaded", lambda model_id: None)
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
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("completion failed")),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_unload_model",
        lambda _model_id: (_ for _ in ()).throw(RuntimeError("still loaded")),
    )

    with pytest.raises(RuntimeError, match="completion failed"):
        storyboard_llm_runtime.chat(
            "qwen-large",
            [{"role": "user", "content": "Write."}],
        )

    assert calls == ["stop", "release"]


def test_chat_keeps_gpu_reserved_if_external_router_cannot_unload(monkeypatch):
    calls = []

    monkeypatch.setattr(storyboard_llm_runtime, "_process", None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: calls.append("reserve"))
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_local_model_loaded", lambda model_id: None)
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
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("completion failed")),
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


def test_release_loaded_model_for_gpu_work_unloads_local_model(monkeypatch):
    calls = []

    class FakeProcess:
        def poll(self):
            return None

    monkeypatch.setattr(storyboard_llm_runtime, "_process", FakeProcess())
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"mode": "local"},
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_http_json",
        lambda *args, **kwargs: {
            "data": [{"id": "qwen-large", "path": "/qwen.gguf", "status": {"value": "loaded"}}]
        },
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_unload_model", lambda model_id: calls.append(model_id))

    assert storyboard_llm_runtime.release_loaded_model_for_gpu_work() is True
    assert calls == ["qwen-large"]


def test_release_loaded_model_for_gpu_work_is_noop_for_remote_mode(monkeypatch):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"mode": "remote"},
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_health_ok",
        lambda: pytest.fail("Remote mode must not inspect a local llama.cpp runtime."),
    )

    assert storyboard_llm_runtime.release_loaded_model_for_gpu_work() is False


def test_preload_model_is_noop_for_remote_mode(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "remote"})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_ensure_server",
        lambda: pytest.fail("Remote preload must not start or inspect local llama.cpp."),
    )

    result = storyboard_llm_runtime.preload_model("remote-model")

    assert result == {"loaded": False, "reason": "remote", "model": "remote-model"}


def test_preload_model_skips_already_loaded_model(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "local"})
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_model_record",
        lambda model_id: {"id": model_id, "status": "loaded", "path": "/model.gguf"},
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_try_reserve_gpu",
        lambda: pytest.fail("Already-loaded preload must not reserve the GPU."),
    )

    result = storyboard_llm_runtime.preload_model("qwen")

    assert result["loaded"] is False
    assert result["reason"] == "already_loaded"


def test_preload_model_skips_when_inference_is_waiting(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "local"})
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_model_record",
        lambda model_id: {"id": model_id, "status": "unloaded", "path": "/model.gguf"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_inference_has_launchable_work", lambda: True)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_try_reserve_gpu",
        lambda: pytest.fail("Inference waiting must prevent speculative GPU reservation."),
    )

    result = storyboard_llm_runtime.preload_model("qwen")

    assert result["reason"] == "inference_waiting"


def test_preload_model_skips_when_training_or_gpu_owner_wins(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "local"})
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_model_record",
        lambda model_id: {"id": model_id, "status": "unloaded", "path": "/model.gguf"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_inference_has_launchable_work", lambda: False)
    monkeypatch.setattr(storyboard_llm_runtime, "_try_reserve_gpu", lambda: False)

    result = storyboard_llm_runtime.preload_model("qwen")

    assert result["reason"] == "gpu_busy"


def test_preload_model_skips_if_current_free_vram_is_insufficient(monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "local"})
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_model_record",
        lambda model_id: {"id": model_id, "status": "unloaded", "path": "/model.gguf"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_inference_has_launchable_work", lambda: False)
    monkeypatch.setattr(storyboard_llm_runtime, "_try_reserve_gpu", lambda: True)
    monkeypatch.setattr(storyboard_llm_runtime, "_gpu_free_mib", lambda: 4000.0)
    monkeypatch.setattr(storyboard_llm_runtime, "_preload_required_mib", lambda _model: 6000.0)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_ensure_local_model_loaded",
        lambda _model_id: pytest.fail("Insufficient VRAM must not load the model."),
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))

    result = storyboard_llm_runtime.preload_model("qwen")

    assert result["reason"] == "insufficient_vram"
    assert calls == ["release"]


def test_preload_model_loads_without_freeing_comfy_and_releases_reservation(monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {"mode": "local"})
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: calls.append("server"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_model_record",
        lambda model_id: {"id": model_id, "status": "unloaded", "path": "/model.gguf"},
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_inference_has_launchable_work", lambda: False)
    monkeypatch.setattr(storyboard_llm_runtime, "_try_reserve_gpu", lambda: calls.append("reserve") or True)
    monkeypatch.setattr(storyboard_llm_runtime, "_gpu_free_mib", lambda: 20000.0)
    monkeypatch.setattr(storyboard_llm_runtime, "_preload_required_mib", lambda _model: 6000.0)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_ensure_local_model_loaded",
        lambda model_id: calls.append("load:" + model_id) or True,
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))

    result = storyboard_llm_runtime.preload_model("qwen")

    assert result["loaded"] is True
    assert result["reason"] == "loaded"
    assert calls == ["server", "reserve", "load:qwen", "release"]
    final = storyboard_llm_runtime.activity_status()
    assert final["active"] is False
    assert final["phase"] == "complete"
    assert final["operation"] == "preload"


def test_run_contract_exposes_lifecycle_activity(monkeypatch):
    observed = {}

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None):
        observed.update(storyboard_llm_runtime.activity_status())
        return {"text": "prompt", "model": model_id}

    monkeypatch.setattr(storyboard_llm_runtime, "chat", fake_chat)

    result = storyboard_llm_runtime.run_contract(
        "qwen-large",
        {"operation": "refine_prompt", "prompt": "Refine me.", "output": "text"},
    )

    assert result["text"] == "prompt"
    assert observed["active"] is True
    assert observed["phase"] == "preparing"
    assert observed["model"] == "qwen-large"
    assert observed["operation"] == "refine_prompt"
    final = storyboard_llm_runtime.activity_status()
    assert final["active"] is False
    assert final["phase"] == "complete"


def test_run_contract_requires_prompt(monkeypatch):
    with pytest.raises(ValueError, match="prompt is empty"):
        storyboard_llm_runtime.run_contract("model", {"prompt": ""})


def test_ensure_server_accepts_compatible_existing_router(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_process", None)
    monkeypatch.setattr(storyboard_llm_runtime, "_server_settings_signature", None)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "llama_server": "",
            "models_dir": tmp_path / "text_encoders",
            "port": 8189,
            "context_size": 8192,
            "max_tokens": 4096,
        },
    )
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


def test_owned_router_restarts_when_runtime_settings_change(tmp_path, monkeypatch):
    calls = []
    health = iter([False, True])

    class FakeProcess:
        def poll(self):
            return None

    storyboard_llm_runtime._process = FakeProcess()
    storyboard_llm_runtime._log_handle = None
    storyboard_llm_runtime._server_settings_signature = ("old", "/old/models", 8189, 4096)

    settings = {
        "llama_server": "/new/llama-server",
        "models_dir": tmp_path / "text_encoders",
        "port": 8189,
        "context_size": 8192,
        "max_tokens": 4096,
    }

    def fake_stop():
        calls.append("stop")
        storyboard_llm_runtime._process = None
        storyboard_llm_runtime._server_settings_signature = None
        if storyboard_llm_runtime._log_handle is not None:
            storyboard_llm_runtime._log_handle.close()
            storyboard_llm_runtime._log_handle = None

    def fake_popen(command, **_kwargs):
        calls.append(command)
        return FakeProcess()

    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: settings)
    monkeypatch.setattr(storyboard_llm_runtime, "_resolve_executable", lambda: "/new/llama-server")
    monkeypatch.setattr(storyboard_llm_runtime, "_runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(storyboard_llm_runtime, "_health_ok", lambda: next(health))
    monkeypatch.setattr(storyboard_llm_runtime, "_stop_server_locked", fake_stop)
    monkeypatch.setattr(storyboard_llm_runtime.subprocess, "Popen", fake_popen)

    try:
        storyboard_llm_runtime._ensure_server()
        assert calls[0] == "stop"
        assert calls[1][0] == "/new/llama-server"
        assert "--ctx-size" in calls[1]
        assert "8192" in calls[1]
        assert storyboard_llm_runtime._server_settings_signature == (
            "/new/llama-server",
            str(tmp_path / "text_encoders"),
            8189,
            8192,
        )
    finally:
        if storyboard_llm_runtime._log_handle is not None:
            storyboard_llm_runtime._log_handle.close()
        storyboard_llm_runtime._log_handle = None
        storyboard_llm_runtime._process = None
        storyboard_llm_runtime._server_settings_signature = None


def test_run_contract_parses_schema_constrained_json(monkeypatch):
    schema = {"type": "object", "properties": {"scenes": {"type": "array"}}}
    captured = {}

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None):
        captured["model"] = model_id
        captured["messages"] = messages
        captured["schema"] = response_schema
        return {"text": '{"scenes": []}', "model": model_id}

    monkeypatch.setattr(storyboard_llm_runtime, "chat", fake_chat)

    result = storyboard_llm_runtime.run_contract("director", {
        "prompt": "Develop it.",
        "output": "json",
        "response_schema": schema,
    })

    assert captured["schema"] == schema
    assert result["data"] == {"scenes": []}


def test_chat_wraps_json_schema_for_llama_cpp(monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_local_model_loaded", lambda model_id: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_status", lambda model_id: "unloaded")
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {
        "llama_server": "",
        "models_dir": None,
        "port": 8189,
        "context_size": 8192,
        "max_tokens": 4096,
    })

    def fake_http(path, method="GET", payload=None, timeout=30):
        calls.append(payload)
        return {"choices": [{"message": {"content": '{"ok": true}'}}]}

    monkeypatch.setattr(storyboard_llm_runtime, "_http_json", fake_http)

    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    storyboard_llm_runtime.chat("director", [{"role": "user", "content": "x"}], response_schema=schema)

    assert calls[-1]["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "storyboard_response", "schema": schema},
    }


def test_chat_uses_external_llm_gpu_reservation_without_double_claim(monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_reserve_gpu",
        lambda: pytest.fail("Queued LLM execution already owns the GPU."),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_release_gpu",
        lambda: pytest.fail("Queued LLM execution owns GPU release."),
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_local_model_loaded", lambda model_id: calls.append("load:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_model_status", lambda model_id: "loaded")
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "mode": "local",
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
        lambda *args, **kwargs: {"choices": [{"message": {"content": "queued response"}}]},
    )

    result = storyboard_llm_runtime.chat(
        "qwen",
        [{"role": "user", "content": "Write."}],
        gpu_reserved=True,
    )

    assert result["text"] == "queued response"
    assert calls == ["free-comfy", "load:qwen"]


def test_remote_chat_uses_openai_compatible_endpoint_without_local_gpu_management(monkeypatch):
    calls = []
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: calls.append("server"))
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: calls.append("reserve"))
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: calls.append("free-comfy"))
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda model_id: calls.append("load:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_unload_model", lambda model_id: calls.append("unload:" + model_id))
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: calls.append("release"))
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "mode": "remote",
            "endpoint": "http://director-box:11434/v1",
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
        return {"choices": [{"message": {"content": "remote prompt"}}]}

    monkeypatch.setattr(storyboard_llm_runtime, "_http_json", fake_http)

    result = storyboard_llm_runtime.chat(
        "qwen-remote",
        [{"role": "user", "content": "Write."}],
    )

    assert result["text"] == "remote prompt"
    assert captured["path"] == "/chat/completions"
    assert captured["payload"]["model"] == "qwen-remote"
    assert "reasoning_effort" not in captured["payload"]
    assert "chat_template_kwargs" not in captured["payload"]
    assert calls == ["server"]


def test_remote_server_url_preserves_openai_api_prefix(monkeypatch):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {
            "mode": "remote",
            "endpoint": "http://director-box:11434/v1/",
            "port": 8189,
        },
    )

    assert storyboard_llm_runtime._server_url("/models") == "http://director-box:11434/v1/models"
