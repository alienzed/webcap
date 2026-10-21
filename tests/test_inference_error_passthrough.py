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


def test_comfyui_execution_failure_keeps_message_node_type_and_traceback():
    job = {
        "status": "failed",
        "execution_error": {
            "node_id": "128",
            "node_type": "PatchSageAttention",
            "exception_type": "ModuleNotFoundError",
            "exception_message": "No module named 'triton'",
            "traceback": [
                '  File "nodes/model_optimization_nodes.py", line 30, in get_sage_func\n',
                '    from sageattention import sageattn\n',
                "ModuleNotFoundError: No module named 'triton'\n",
            ],
        },
    }
    detail = inference_runtime._format_error(job)
    assert detail.startswith("ModuleNotFoundError: No module named 'triton' (128 / PatchSageAttention)")
    assert "from sageattention import sageattn" in detail
    assert detail.endswith("ModuleNotFoundError: No module named 'triton'")


def test_comfyui_execution_failure_without_traceback_remains_explicit():
    assert inference_runtime._format_error({"status": "failed"}) == "ComfyUI reported an execution error."
    assert inference_runtime._format_error({
        "status": "failed",
        "error": "CUDA allocation failed",
        "execution_error": {"node_type": "Sampler", "traceback": None},
    }) == "CUDA allocation failed (Sampler)"


def test_failed_provider_job_raises_full_diagnostic(monkeypatch):
    monkeypatch.setattr(inference_runtime, "_open_progress_socket", lambda *_args: None)
    monkeypatch.setattr(inference_runtime, "execution_get_job", lambda *_args: {})
    monkeypatch.setattr(inference_runtime, "execution_update_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(inference_runtime, "read_job", lambda *_args: {
        "status": "failed",
        "execution_error": {
            "exception_message": "No module named 'triton'",
            "exception_type": "ModuleNotFoundError",
            "node_id": "128",
            "node_type": "PatchSageAttention",
            "traceback": ["  File \"sageattention/core.py\", line 2\n", "    import triton\n"],
        },
    })
    with pytest.raises(RuntimeError) as exc:
        inference_runtime.wait_for_output("provider-id", "webcap-id", lambda *_args: None)
    assert "ModuleNotFoundError: No module named 'triton'" in str(exc.value)
    assert "import triton" in str(exc.value)
