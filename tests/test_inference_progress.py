import json

from tool.server import inference_runtime


def test_progress_message_normalizes_legacy_comfy_progress():
    message = json.dumps({
        "type": "progress",
        "data": {
            "prompt_id": "job-1",
            "node": "42",
            "value": 21,
            "max": 50,
        },
    })

    assert inference_runtime._progress_from_message(message, "job-1") == {
        "value": 21.0,
        "max": 50.0,
        "percent": 42.0,
        "step": 21,
        "steps": 50,
        "node": "42",
    }


def test_progress_message_normalizes_progress_state_running_node():
    message = json.dumps({
        "type": "progress_state",
        "data": {
            "prompt_id": "job-1",
            "nodes": {
                "11": {"value": 1, "max": 1, "state": "finished", "display_node_id": "11"},
                "42": {"value": 8, "max": 20, "state": "running", "display_node_id": "Sampler"},
            },
        },
    })

    assert inference_runtime._progress_from_message(message, "job-1") == {
        "value": 8.0,
        "max": 20.0,
        "percent": 40.0,
        "step": 8,
        "steps": 20,
        "node": "Sampler",
    }


def test_progress_message_ignores_unrelated_jobs_and_unknown_shapes():
    assert inference_runtime._progress_from_message(
        json.dumps({"type": "progress", "data": {"prompt_id": "other", "value": 1, "max": 2}}),
        "job-1",
    ) == {}
    assert inference_runtime._progress_from_message(
        json.dumps({"type": "status", "data": {"prompt_id": "job-1"}}),
        "job-1",
    ) == {}


def test_progress_socket_url_uses_provider_host_and_job_scoped_client_id(monkeypatch):
    monkeypatch.setattr(inference_runtime, "COMFY_BASE_URL", "http://127.0.0.1:8188")
    assert inference_runtime._progress_socket_url("abc") == "ws://127.0.0.1:8188/ws?clientId=webcap-abc"
