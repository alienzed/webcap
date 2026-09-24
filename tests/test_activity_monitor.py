from tool.server import activity_monitor


def test_activity_snapshot_projects_existing_domain_state(monkeypatch):
    monkeypatch.setattr(activity_monitor, "inference_snapshot", lambda include_terminal=False: {
        "paused": False,
        "pauseReason": "",
        "jobs": [
            {
                "id": "infer-active",
                "status": "running",
                "startedAt": 100.0,
                "metadata": {
                    "client": "storyboard",
                    "label": "Scene 04 Take",
                    "storyId": "story-1",
                    "sceneId": "scene-4",
                    "modelId": "h3",
                },
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
                "id": "llm-queued",
                "status": "queued",
                "queuePosition": 1,
                "metadata": {
                    "client": "storyboard",
                    "label": "Story: develop story",
                    "operation": "develop_story",
                    "modelId": "director.gguf",
                },
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
    monkeypatch.setattr(activity_monitor, "execution_recent_snapshot", lambda lane, limit=30: (
        [{
            "id": lane + "-done",
            "status": "completed",
            "finishedAt": 120.0 if lane == "inference" else 110.0,
            "metadata": {
                "client": "generate" if lane == "inference" else "storyboard",
                "label": "Done",
                "operation": "write_prompt",
            },
        }]
    ))
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
    assert [item["id"] for item in payload["recent"]] == [
        "inference-done",
        "llm-done",
        "train-done",
    ]
    assert payload["queues"]["inference"]["running"] == 1
    assert payload["queues"]["inference"]["queued"] == 1
    assert payload["queues"]["training"]["queued"] == 1
    assert payload["queues"]["director"]["queued"] == 1
