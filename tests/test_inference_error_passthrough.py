import pytest

from tool.server import inference_runtime


def test_comfyui_validation_payload_preserved_if_prompt_id_missing(monkeypatch):
    response = {
        "error": {"type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation"},
        "node_errors": {
            "42": {"class_type": "CheckpointLoaderSimple", "errors": [
                {"message": "Value not in list: ckpt_name: missing_model.safetensors"}
            ]}
        },
    }
    monkeypatch.setattr(inference_runtime, "_read_json_response", lambda *_args, **_kwargs: response)
    with pytest.raises(RuntimeError) as info:
        inference_runtime._submit_workflow({"42": {}}, "expected-id")
    detail = str(info.value)
    assert "ComfyUI did not accept the requested inference job ID" in detail
    assert "prompt_outputs_failed_validation" in detail
    assert "missing_model.safetensors" in detail
    assert '"node_errors"' in detail


def test_comfyui_http_error_keeps_original_validation_body(monkeypatch):
    body = '{"error":"Prompt outputs failed validation","node_errors":{"42":{"errors":[{"message":"Missing custom node"}]}}}'
    def fail(*_args, **_kwargs):
        raise inference_runtime.ComfyHttpError(400, body)
    monkeypatch.setattr(inference_runtime, "_read_json_response", fail)
    with pytest.raises(inference_runtime.ComfyHttpError) as info:
        inference_runtime._submit_workflow({"42": {}}, "expected-id")
    assert body in str(info.value)
