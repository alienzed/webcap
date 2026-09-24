import pytest

from tool.server import storyboard_llm_runtime


def test_director_capacity_defaults_defer_to_runtime():
    assert storyboard_llm_runtime.DEFAULT_CONTEXT_SIZE is None
    assert storyboard_llm_runtime.DEFAULT_MAX_TOKENS is None


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


def test_normalize_models_keeps_reported_size_metadata():
    models = storyboard_llm_runtime._normalize_models({
        "data": [{
            "id": "director",
            "path": "/models/director.gguf",
            "status": {"value": "unloaded"},
            "size": 123456,
        }]
    })

    assert models[0]["sizeBytes"] == 123456


def test_model_file_size_stats_selected_model_in_configured_directory(monkeypatch, tmp_path):
    models_dir = tmp_path / "text_encoders"
    models_dir.mkdir()
    model_path = models_dir / "director.gguf"
    model_path.write_bytes(b"x" * 4096)

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"models_dir": models_dir, "mode": "local"},
    )

    assert storyboard_llm_runtime._model_file_size({
        "id": "director",
        "path": r"C:\\anything\\director.gguf",
    }) == 4096


def test_model_file_size_adds_gguf_suffix_for_llama_model_stem(monkeypatch, tmp_path):
    models_dir = tmp_path / "text_encoders"
    models_dir.mkdir()
    model_path = models_dir / "director.gguf"
    model_path.write_bytes(b"x" * 6144)

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"models_dir": models_dir, "mode": "local"},
    )

    assert storyboard_llm_runtime._model_file_size({
        "id": "director",
        "path": "director",
    }) == 6144


def test_model_file_size_uses_model_id_when_runtime_path_is_empty(monkeypatch, tmp_path):
    models_dir = tmp_path / "text_encoders"
    models_dir.mkdir()
    model_path = models_dir / "director.gguf"
    model_path.write_bytes(b"x" * 8192)

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"models_dir": models_dir, "mode": "local"},
    )

    assert storyboard_llm_runtime._model_file_size({
        "id": "director.gguf",
        "path": "",
    }) == 8192


def test_model_file_size_fails_loudly_when_filename_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"models_dir": tmp_path, "mode": "local"},
    )

    with pytest.raises(FileNotFoundError, match="model filename is missing"):
        storyboard_llm_runtime._model_file_size({})


def test_model_file_size_fails_loudly_when_stat_fails(monkeypatch, tmp_path):
    models_dir = tmp_path / "text_encoders"
    models_dir.mkdir()

    monkeypatch.setattr(
        storyboard_llm_runtime,
        "_director_config",
        lambda: {"models_dir": models_dir, "mode": "local"},
    )

    with pytest.raises(OSError, match="Could not stat Storyboard Director model file") as exc:
        storyboard_llm_runtime._model_file_size({"path": "missing.gguf"})

    assert str(models_dir / "missing.gguf") in str(exc.value)


def test_director_activity_completion_preserves_usage_timings_and_context():
    storyboard_llm_runtime._set_activity(
        "preparing",
        model_id="director",
        operation="develop_story",
        active=True,
        context_size=16384,
    )
    storyboard_llm_runtime._set_activity(
        "complete",
        model_id="director",
        operation="develop_story",
        active=False,
        usage={"prompt_tokens": 2000, "completion_tokens": 500, "total_tokens": 2500},
        timings={"predicted_per_second": 40.5, "cached_n": 1200},
    )

    activity = storyboard_llm_runtime.activity_status()

    assert activity["contextSize"] == 16384
    assert activity["usage"]["prompt_tokens"] == 2000
    assert activity["usage"]["completion_tokens"] == 500
    assert activity["timings"]["predicted_per_second"] == 40.5
    assert activity["timings"]["cached_n"] == 1200


def test_loading_activity_exposes_selected_model_size(monkeypatch, tmp_path):
    model_path = tmp_path / "director.gguf"
    model_path.write_bytes(b"x" * 4096)
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "list_models",
        lambda reload=False: [{
            "id": "director",
            "status": "unloaded",
            "path": str(model_path),
        }],
    )
    monkeypatch.setattr(storyboard_llm_runtime, "_load_model", lambda _model_id: None)

    storyboard_llm_runtime._ensure_local_model_loaded("director")
    activity = storyboard_llm_runtime.activity_status()

    assert activity["phase"] == "loading_model"
    assert activity["model"] == "director"
    assert activity["modelSizeBytes"] == 4096


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
    assert captured["payload"]["temperature"] == 0.2
    assert captured["payload"]["top_p"] == 0.85
    assert captured["payload"]["presence_penalty"] == 0.0
    assert captured["payload"]["frequency_penalty"] == 0.0
    assert captured["payload"]["top_k"] == 40
    assert captured["payload"]["min_p"] == 0.05
    assert captured["payload"]["repeat_penalty"] == 1.0
    assert captured["payload"]["seed"] == -1
    assert captured["payload"]["max_tokens"] == 4096
    assert calls == [
        "server",
        "reserve",
        "free-comfy",
        "ensure:qwen-large",
        "release",
    ]


def test_chat_omits_max_tokens_when_limit_is_auto(monkeypatch):
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_server", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_model_record", lambda model_id: {"id": model_id})
    monkeypatch.setattr(storyboard_llm_runtime, "_reserve_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_free_comfy_models", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_ensure_local_model_loaded", lambda model_id: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_release_gpu", lambda: None)
    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: {
        "mode": "local",
        "llama_server": "",
        "models_dir": None,
        "port": 8189,
        "context_size": None,
        "max_tokens": None,
    })

    captured = {}

    def fake_http(path, method="GET", payload=None, timeout=30):
        captured["payload"] = payload
        return {"choices": [{"message": {"content": "done"}}]}

    monkeypatch.setattr(storyboard_llm_runtime, "_http_json", fake_http)

    result = storyboard_llm_runtime.chat("director", [{"role": "user", "content": "Write."}])

    assert result["text"] == "done"
    assert "max_tokens" not in captured["payload"]


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


def test_director_sampling_profiles_are_explicit_and_conservative():
    develop = storyboard_llm_runtime._sampling_profile("develop_story")
    expand = storyboard_llm_runtime._sampling_profile("expand_concept")
    refine = storyboard_llm_runtime._sampling_profile("refine_prompt")

    assert develop == {
        "temperature": 0.2,
        "top_p": 0.85,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
    }
    assert expand["temperature"] > develop["temperature"]
    assert refine["temperature"] < develop["temperature"]


def test_run_contract_exposes_lifecycle_activity(monkeypatch):
    observed = {}

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None, sampling=None):
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


def test_owned_router_omits_context_size_when_limit_is_auto(tmp_path, monkeypatch):
    calls = []
    health = iter([False, True])

    class FakeProcess:
        def poll(self):
            return None

    storyboard_llm_runtime._process = None
    storyboard_llm_runtime._log_handle = None
    storyboard_llm_runtime._server_settings_signature = None

    settings = {
        "mode": "local",
        "llama_server": "/new/llama-server",
        "models_dir": tmp_path / "text_encoders",
        "port": 8189,
        "context_size": None,
        "max_tokens": None,
    }

    def fake_popen(command, **_kwargs):
        calls.append(command)
        return FakeProcess()

    monkeypatch.setattr(storyboard_llm_runtime, "_director_config", lambda: settings)
    monkeypatch.setattr(storyboard_llm_runtime, "_resolve_executable", lambda: "/new/llama-server")
    monkeypatch.setattr(storyboard_llm_runtime, "_runtime_dir", lambda: tmp_path)
    monkeypatch.setattr(storyboard_llm_runtime, "_health_ok", lambda: next(health))
    monkeypatch.setattr(storyboard_llm_runtime.subprocess, "Popen", fake_popen)

    try:
        storyboard_llm_runtime._ensure_server()
        assert "--ctx-size" not in calls[0]
        assert storyboard_llm_runtime._server_settings_signature == (
            "/new/llama-server",
            str(tmp_path / "text_encoders"),
            8189,
            None,
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

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None, sampling=None):
        captured["model"] = model_id
        captured["messages"] = messages
        captured["schema"] = response_schema
        captured["sampling"] = sampling
        return {"text": '{"scenes": []}', "model": model_id}

    monkeypatch.setattr(storyboard_llm_runtime, "chat", fake_chat)

    result = storyboard_llm_runtime.run_contract("director", {
        "prompt": "Develop it.",
        "output": "json",
        "response_schema": schema,
    })

    assert captured["schema"] == schema
    assert captured["sampling"] == storyboard_llm_runtime._sampling_profile("")
    assert result["data"] == {"scenes": []}


def test_run_contract_renders_structured_h3_result(monkeypatch):
    schema = {
        "type": "object",
        "properties": {
            "integrated_multimodal_description": {"type": "string"},
            "overall_soundscape": {"type": "string"},
            "non_diegetic_music": {"type": "string"},
        },
    }

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None, sampling=None):
        assert response_schema == schema
        return {
            "text": (
                '{"integrated_multimodal_description":"She turns toward the door.",'
                '"overall_soundscape":"Room tone.",'
                '"non_diegetic_music":"N/A"}'
            ),
            "model": model_id,
        }

    monkeypatch.setattr(storyboard_llm_runtime, "chat", fake_chat)

    result = storyboard_llm_runtime.run_contract("director", {
        "operation": "write_prompt",
        "prompt": "Write it.",
        "output": "json",
        "response_schema": schema,
        "result_renderer": {
            "type": "h3_base",
            "mode": "I2VA",
            "duration": 6,
            "shared_context": "Mara: dark bob and pale raincoat.\nLobby: dark terrazzo and brass fixtures.",
        },
    })

    assert result["data"]["overall_soundscape"] == "Room tone."
    assert result["text"].startswith(
        "For the target video, at 0.00 seconds into the target video, "
        "<Picture 1> (from [Shot 1]) is fully referenced.\n\n"
        "integrated_multimodal_description: [Shot 1] Continuity anchors — Mara: dark bob and pale raincoat. "
        "Lobby: dark terrazzo and brass fixtures. She turns toward the door."
    )
    assert result["text"].endswith(
        "overall_soundscape: Room tone.\n\nnon_diegetic_music: N/A"
    )


def test_refine_renderer_uses_optional_returned_duration(monkeypatch):
    schema = {
        "type": "object",
        "properties": {
            "integrated_multimodal_description": {"type": "string"},
            "overall_soundscape": {"type": "string"},
            "non_diegetic_music": {"type": "string"},
            "durationSeconds": {"type": "number"},
        },
    }

    def fake_chat(model_id, messages, response_schema=None, max_tokens=None, sampling=None):
        return {
            "text": (
                '{"integrated_multimodal_description":"She crosses the room.",'
                '"overall_soundscape":"Room tone.",'
                '"non_diegetic_music":"N/A",'
                '"durationSeconds":12}'
            ),
            "model": model_id,
        }

    monkeypatch.setattr(storyboard_llm_runtime, "chat", fake_chat)

    result = storyboard_llm_runtime.run_contract("director", {
        "operation": "refine_prompt",
        "prompt": "Refine it.",
        "output": "json",
        "response_schema": schema,
        "result_renderer": {
            "type": "h3_base",
            "mode": "L2VA",
            "duration": 10,
            "duration_field": "durationSeconds",
            "shared_context": "",
        },
    })

    assert result["durationOverride"] == 12
    assert "12.00-second mark" in result["text"]


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
        "json_schema": {
            "name": "storyboard_response",
            "schema": schema,
        },
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

    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    result = storyboard_llm_runtime.chat(
        "qwen-remote",
        [{"role": "user", "content": "Write."}],
        response_schema=schema,
    )

    assert result["text"] == "remote prompt"
    assert captured["path"] == "/chat/completions"
    assert captured["payload"]["model"] == "qwen-remote"
    assert captured["payload"]["response_format"] == {
        "type": "json_schema",
        "json_schema": {"name": "storyboard_response", "schema": schema},
    }
    assert "reasoning_effort" not in captured["payload"]
    assert "chat_template_kwargs" not in captured["payload"]
    assert captured["payload"]["temperature"] == 0.2
    assert captured["payload"]["top_p"] == 0.85
    assert captured["payload"]["presence_penalty"] == 0.0
    assert captured["payload"]["frequency_penalty"] == 0.0
    assert "top_k" not in captured["payload"]
    assert "min_p" not in captured["payload"]
    assert "repeat_penalty" not in captured["payload"]
    assert "seed" not in captured["payload"]
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
