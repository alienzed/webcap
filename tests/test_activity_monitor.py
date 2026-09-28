from tool.server import activity_monitor


def test_activity_snapshot_projects_existing_domain_state(monkeypatch):
    monkeypatch.setattr(activity_monitor, "inference_snapshot", lambda include_terminal=False: {
        "paused": False,
        "pauseReason": "",
        "jobs": [
            {
                "jobId": "infer-active",
                "status": "running",
                "startedAt": 100.0,
                "client": "storyboard",
                "label": "Scene 04 Take",
                "storyId": "story-1",
                "sceneId": "scene-4",
                "modelId": "h3",
            },
            {
                "id": "infer-queued",
                "status": "queued",
                "queuePosition": 1,
                "metadata": {"client": "generate", "label": "Portrait"},
            },
        ],
    })
    monkeypatch.setattr(activity_monitor, "llm_snapshot", lambda include_terminal=False: {
        "paused": False,
        "pauseReason": "",
        "jobs": [
            {
                "jobId": "llm-queued",
                "status": "queued",
                "queuePosition": 1,
                "client": "storyboard",
                "label": "Story: develop story",
                "operation": "develop_story",
                "modelId": "director.gguf",
            },
        ],
    })
    monkeypatch.setattr(activity_monitor, "training_status_response", lambda: ({
        "ok": True,
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [
            {
                "id": "train-active",
                "status": "running",
                "runName": "Clothing H3",
                "folder": "sets/clothing",
                "stages": "h3",
                "startedAt": 90.0,
                "progress": {"epoch": 47, "epochs": 90},
            },
            {"id": "train-queued", "status": "queued"},
        ],
    }, 200))
    monkeypatch.setattr(activity_monitor, "storage_scan_status", lambda: {
        "ok": True,
        "scan": {
            "id": "scan-1",
            "status": "running",
            "phase": "measuring",
            "startedAt": 95.0,
            "itemsMeasured": 4,
            "itemsTotal": 10,
            "bytesScanned": 1234,
        },
    })
    monkeypatch.setattr(activity_monitor, "execution_recent_snapshot", lambda lane, limit=30: [])
    monkeypatch.setattr(activity_monitor, "training_recent_jobs", lambda: [
        {
            "id": "train-done",
            "status": "completed",
            "runName": "Old Run",
            "folder": "sets/old",
            "finishedAt": 105.0,
        },
    ])

    payload = activity_monitor.activity_snapshot(limit=10)

    assert payload["ok"] is True
    assert {item["kind"] for item in payload["active"]} == {"storyboard", "training", "storage"}
    assert [item["id"] for item in payload["recent"]] == ["train-done"]
    assert payload["queues"]["inference"]["running"] == 1
    assert payload["queues"]["inference"]["queued"] == 1
    assert payload["queues"]["training"]["queued"] == 1
    assert payload["queues"]["director"]["queued"] == 1


def test_activity_recent_is_limited_to_client_session(monkeypatch):
    monkeypatch.setattr(activity_monitor, "inference_snapshot", lambda include_terminal=False: {"paused": False, "pauseReason": "", "jobs": []})
    monkeypatch.setattr(activity_monitor, "llm_snapshot", lambda include_terminal=False: {"paused": False, "pauseReason": "", "jobs": []})
    monkeypatch.setattr(activity_monitor, "training_status_response", lambda: ({"ok": True, "queuePaused": False, "queuePauseReason": "", "jobs": []}, 200))
    monkeypatch.setattr(activity_monitor, "storage_scan_status", lambda: {"ok": True, "scan": {}})
    monkeypatch.setattr(activity_monitor, "execution_recent_snapshot", lambda lane, limit=30: [
        {"id": lane + "-old", "status": "completed", "finishedAt": 90.0, "metadata": {"client": "generate" if lane == "inference" else "storyboard"}},
        {"id": lane + "-new", "status": "failed" if lane == "llm" else "completed", "finishedAt": 110.0, "error": "boom" if lane == "llm" else "", "metadata": {"client": "generate" if lane == "inference" else "storyboard"}},
    ])
    monkeypatch.setattr(activity_monitor, "training_recent_jobs", lambda: [
        {"id": "training-old", "status": "completed", "finishedAt": 80.0},
        {"id": "training-new", "status": "completed", "finishedAt": 120.0},
    ])

    payload = activity_monitor.activity_snapshot(limit=10, since=100.0)

    assert [item["id"] for item in payload["recent"]] == ["training-new", "llm-new", "inference-new"]


def test_activity_snapshot_keeps_other_domains_when_execution_state_is_unavailable(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("execution queue unavailable")

    monkeypatch.setattr(activity_monitor, "inference_snapshot", unavailable)
    monkeypatch.setattr(activity_monitor, "llm_snapshot", unavailable)
    monkeypatch.setattr(activity_monitor, "training_status_response", lambda: ({
        "ok": True,
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [{"id": "train-active", "status": "running", "runName": "Training", "startedAt": 10.0}],
    }, 200))
    monkeypatch.setattr(activity_monitor, "training_recent_jobs", lambda: [])
    monkeypatch.setattr(activity_monitor, "storage_scan_status", lambda: {"ok": True, "scan": {}})

    payload = activity_monitor.activity_snapshot(limit=10)

    assert payload["ok"] is True
    assert [item["id"] for item in payload["active"]] == ["train-active"]
    assert payload["queues"]["inference"]["unavailable"] is True
    assert payload["queues"]["director"]["unavailable"] is True
    assert {item["area"] for item in payload["errors"]} == {"inference", "director"}
