import pytest

from tool.server import director_model_test_store as model_test


@pytest.fixture(autouse=True)
def clear_model_test_session():
    model_test.clear_session()
    yield
    model_test.clear_session()


def test_protocol_is_fixed_versioned_expansion_task():
    assert model_test.PROTOCOL["id"] == "expansion-v1"
    assert len(model_test.PROTOCOL["messages"]) == 1
    prompt = model_test.PROTOCOL["defaultPrompt"]
    assert model_test.PROTOCOL["messages"][0]["content"] == prompt
    assert "production-ready cinematic generation prompt" in prompt
    assert "Use your judgment" in prompt
    assert "350–500 words" in prompt


def test_session_freezes_models_and_keeps_each_run_in_memory():
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
    ], prompt="Custom benchmark prompt.")

    assert session["status"] == "running"
    assert session["protocol"]["prompt"] == "Custom benchmark prompt."
    assert session["protocol"]["messages"] == [{"role": "user", "content": "Custom benchmark prompt."}]
    assert [item["modelRef"] for item in session["models"]] == [
        "macbook::qwen3:8b",
        "local::gemma.gguf",
    ]
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
    current = model_test.current_session()
    assert current["runs"][0]["text"] == "Expanded prompt."


def test_failed_run_is_data_and_does_not_fail_session():
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
    assert model_test.current_session()["runs"][0]["status"] == "failed"


def test_run_must_belong_to_frozen_session():
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


def test_protocol_run_uses_session_frozen_prompt(monkeypatch):
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

    session = model_test.start_session([{
        "modelRef": "macbook::qwen3:8b",
        "runtimeId": "macbook",
        "runtimeName": "MacBook Pro",
        "modelId": "qwen3:8b",
        "label": "qwen3:8b",
    }], prompt="Frozen custom benchmark.")

    from tool.server import llm_runner
    monkeypatch.setattr(llm_runner, "enqueue", fake_enqueue)

    job = model_test.enqueue_protocol_run(session["id"], "macbook::qwen3:8b")

    assert job == {"jobId": "job-1"}
    assert captured["client"] == "chat"
    assert captured["modelRef"] == "macbook::qwen3:8b"
    assert captured["contract"]["operation"] == "freeform_chat"
    assert captured["contract"]["messages"] == [{"role": "user", "content": "Frozen custom benchmark."}]
    assert captured["label"] == "Director Model Test"


def test_clear_session_discards_current_results():
    session = model_test.start_session([{
        "modelRef": "local::qwen.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "qwen.gguf",
        "label": "qwen.gguf",
    }])

    assert model_test.current_session()["id"] == session["id"]
    model_test.clear_session()
    assert model_test.current_session() is None
    with pytest.raises(FileNotFoundError):
        model_test._read_session(session["id"])


def test_model_test_is_isolated_to_diagnostics_and_feature_modules():
    root = __import__("pathlib").Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    app = (root / "tool" / "server" / "app.py").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")
    diagnostics = (root / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    llm_runner = (root / "tool" / "server" / "llm_runner.py").read_text(encoding="utf-8")
    runtime = (root / "tool" / "server" / "storyboard_llm_runtime.py").read_text(encoding="utf-8")

    assert 'id="diagnostics-modal"' in html
    assert 'data-diagnostics-tab="director"' in html
    assert 'id="director-model-test-settings"' in html
    assert '/static/js/diagnostics.js' in html
    assert '/static/js/director_model_test.js' in html
    assert "directorModelTestRefresh()" in diagnostics
    assert "register_director_model_test_routes(app)" in app
    assert "/fs/director/job" in frontend
    assert "/fs/director/activity" in frontend
    assert "/fs/storyboard/director" in frontend
    assert "director_model_test" not in llm_runner
    assert "director_model_test" not in runtime


def test_empty_custom_prompt_is_rejected():
    with pytest.raises(ValueError, match="prompt is required"):
        model_test.start_session([{
            "modelRef": "local::qwen.gguf",
            "runtimeId": "local",
            "runtimeName": "Local",
            "modelId": "qwen.gguf",
            "label": "qwen.gguf",
        }], prompt="   ")


def test_model_test_surfaces_live_status_without_extra_polling():
    root = __import__("pathlib").Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")
    styles = (root / "tool" / "css" / "modals.css").read_text(encoding="utf-8")

    assert 'id="director-model-test-summary-status"' in html
    assert 'id="director-model-test-status" class="app-settings-status director-model-test-status"' in html
    assert 'aria-live="polite"' in html
    assert 'class="director-model-test-models"' in html

    assert "directorModelTestState.session = meta.session || null;" in frontend
    assert "function directorModelTestRenderStatus()" in frontend
    assert "directorModelTestState.currentPhase = phase;" in frontend
    assert "directorModelTestRunOne(model, index + 1)" in frontend
    assert "'Starting test · '" in frontend

    assert ".director-model-test-status[data-state=\"running\"]::before" in styles
    assert ".director-model-test-models .app-settings-runtime-scope" in styles



def test_calibration_protocol_is_progressive_and_versioned():
    protocol = model_test.calibration_protocol()

    assert protocol["contextSteps"] == [4096, 8192, 16384, 32768, 65536, 98304, 131072, 163840]
    assert protocol["outputSteps"] == [512, 1024, 2048, 4096, 8192, 12288, 16384, 24576, 32768]
    assert protocol["outputItemCounts"]["512"] == 12
    assert protocol["outputItemCounts"]["32768"] == 1440
    assert protocol["proseSectionCounts"]["512"] == 2
    assert protocol["proseSectionCounts"]["32768"] == 160
    assert protocol["marker"] == model_test.CALIBRATION_MARKER
    assert protocol["proseMarker"] == model_test.PROSE_MARKER
    prompt = model_test._calibration_output_prompt(4096)
    prose_prompt = model_test._calibration_prose_prompt(4096)
    assert "exactly 180 numbered items" in prompt
    assert model_test.CALIBRATION_MARKER in prompt
    assert "exactly 20 consecutively numbered sections" in prose_prompt
    assert "100-140 words" in prose_prompt
    assert model_test.PROSE_MARKER in prose_prompt


def test_context_calibration_enqueues_local_runtime_override(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        "tool.server.storyboard_llm_runtime.list_models",
        lambda reload=False: [{
            "id": "local::director.gguf",
            "runtimeId": "local",
            "runtimeName": "Local",
            "modelId": "director.gguf",
            "label": "director.gguf",
        }],
    )

    def fake_enqueue(client, model_ref, contract, context=None, label=""):
        captured.update({
            "client": client,
            "modelRef": model_ref,
            "contract": contract,
            "context": context,
            "label": label,
        })
        return {"jobId": "calibration-job"}

    monkeypatch.setattr("tool.server.llm_runner.enqueue", fake_enqueue)

    job = model_test.enqueue_calibration_run(
        "local::director.gguf",
        "context",
        16384,
    )

    assert job == {"jobId": "calibration-job"}
    assert captured["client"] == "chat"
    assert captured["context"]["runtimeOverrides"] == {
        "contextSize": 16384,
        "maxTokens": 64,
    }
    assert captured["contract"]["messages"][0]["content"] == "Reply with exactly: CONTEXT_OK"


def test_output_calibration_uses_proven_local_context(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        "tool.server.storyboard_llm_runtime.list_models",
        lambda reload=False: [{
            "id": "local::director.gguf",
            "runtimeId": "local",
            "runtimeName": "Local",
            "modelId": "director.gguf",
            "label": "director.gguf",
        }],
    )
    monkeypatch.setattr(
        "tool.server.llm_runner.enqueue",
        lambda client, model_ref, contract, context=None, label="": captured.update({
            "context": context,
            "contract": contract,
        }) or {"jobId": "output-job"},
    )

    model_test.enqueue_calibration_run(
        "local::director.gguf",
        "output",
        4096,
        context_size=24576,
    )

    assert captured["context"]["runtimeOverrides"] == {
        "maxTokens": 4096,
        "contextSize": 24576,
    }
    assert model_test.CALIBRATION_MARKER in captured["contract"]["messages"][0]["content"]



def test_prose_calibration_uses_same_output_and_context_limits(monkeypatch):
    captured = {}

    monkeypatch.setattr(
        "tool.server.storyboard_llm_runtime.list_models",
        lambda reload=False: [{
            "id": "local::director.gguf",
            "runtimeId": "local",
            "runtimeName": "Local",
            "modelId": "director.gguf",
            "label": "director.gguf",
        }],
    )
    monkeypatch.setattr(
        "tool.server.llm_runner.enqueue",
        lambda client, model_ref, contract, context=None, label="": captured.update({
            "context": context,
            "contract": contract,
            "label": label,
        }) or {"jobId": "prose-job"},
    )

    model_test.enqueue_calibration_run(
        "local::director.gguf",
        "prose",
        12288,
        context_size=65536,
    )

    assert captured["context"]["runtimeOverrides"] == {
        "maxTokens": 12288,
        "contextSize": 65536,
    }
    assert model_test.PROSE_MARKER in captured["contract"]["messages"][0]["content"]
    assert captured["label"] == "Director Long-form Calibration"

def test_remote_context_calibration_is_rejected(monkeypatch):
    monkeypatch.setattr(
        "tool.server.storyboard_llm_runtime.list_models",
        lambda reload=False: [{
            "id": "remote::qwen",
            "runtimeId": "remote",
            "runtimeName": "Remote",
            "modelId": "qwen",
            "label": "qwen",
        }],
    )

    with pytest.raises(ValueError, match="local llama.cpp"):
        model_test.enqueue_calibration_run("remote::qwen", "context", 8192)



def test_model_test_diagnostics_exposes_progressive_calibration_controls():
    root = __import__("pathlib").Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    frontend = (root / "tool" / "js" / "director_model_test.js").read_text(encoding="utf-8")

    assert 'id="director-model-test-calibrate"' in html
    assert 'id="director-model-test-clear-calibration"' in html
    assert 'id="director-model-test-calibration-profiles"' in html
    assert "function directorModelTestStartCalibration()" in frontend
    assert "function directorModelTestCalibrationAttempt(" in frontend
    assert "outputItemCounts" in frontend
    assert "proseSectionCounts" in frontend
    assert "WEB_CAP_LONGFORM_COMPLETE" in frontend
    assert "'prose'" in frontend
    assert "finish_reason=" in frontend
    assert "save_calibration_profile" in frontend
    assert "save_calibration_report" in frontend
    assert "directorModelTestCalibrationFailureKind" in frontend
    assert "CONTEXT_OK" in frontend



def test_advertised_capability_hints_do_not_require_live_model_discovery():
    hints = model_test.list_capability_hints()

    glm = next(
        item for item in hints
        if "glm-4.7-30b-a3b-20-2-heretic" in item.get("match", [])
    )
    assert glm["recommendedContextMin"] == 8192
    assert glm["recommendedContextMax"] == 16384
    assert any("loop" in note.lower() for note in glm["notes"])


def test_lowest_output_probe_is_small_but_structured():
    prompt = model_test._calibration_output_prompt(512)
    prose = model_test._calibration_prose_prompt(512)

    assert "exactly 12 numbered items" in prompt
    assert "exactly 2 consecutively numbered sections" in prose
