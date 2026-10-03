import json

import pytest

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


def test_managed_workflow_records_provider_identity_before_submission(monkeypatch):
    events = []
    monkeypatch.setattr(inference_runtime.uuid, "uuid4", lambda: "provider-1")

    def update(job_id, details):
        events.append(("update", job_id, dict(details)))

    def submit(url, method="GET", payload=None, timeout=10):
        assert events == [
            ("update", "webcap-1", {"providerJobId": "provider-1", "providerStatus": "submitting"})
        ]
        assert url.endswith("/prompt")
        assert payload["prompt_id"] == "provider-1"
        events.append(("submit", payload["prompt_id"]))
        return {"prompt_id": "provider-1"}

    monkeypatch.setattr(inference_runtime, "execution_update_job", update)
    monkeypatch.setattr(inference_runtime, "_read_json_response", submit)

    assert inference_runtime.queue_managed_workflow("webcap-1", {"node": {}}) == "provider-1"
    assert events[-1] == ("update", "webcap-1", {"providerStatus": "pending"})


def test_managed_workflow_keeps_provider_identity_when_submission_fails(monkeypatch):
    updates = []
    monkeypatch.setattr(inference_runtime.uuid, "uuid4", lambda: "provider-2")
    monkeypatch.setattr(
        inference_runtime,
        "execution_update_job",
        lambda job_id, details: updates.append((job_id, dict(details))),
    )
    monkeypatch.setattr(
        inference_runtime,
        "_read_json_response",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConnectionError("provider dropped")),
    )

    with pytest.raises(ConnectionError, match="provider dropped"):
        inference_runtime.queue_managed_workflow("webcap-2", {"node": {}})

    assert updates == [
        ("webcap-2", {"providerJobId": "provider-2", "providerStatus": "submitting"})
    ]


def test_webcap_queue_job_ids_only_returns_webcap_client_ids():
    snapshot = {
        "running": [[0, "owned-1", {}, {"client_id": "webcap-owned-1"}, []]],
        "pending": [
            [1, "other", {}, {"client_id": "someone-else"}, []],
            [2, "owned-2", {}, {"client_id": "webcap-owned-2"}, []],
        ],
    }

    assert inference_runtime.webcap_queue_job_ids(snapshot) == ["owned-1", "owned-2"]
