from tool.server import app as app_module


def test_test_generations_route_dispatches_to_test_bench_with_existing_error_shape(tmp_path, monkeypatch):
    root = tmp_path / "root"
    seen = {}

    monkeypatch.setattr(app_module, "safe_join_fs_root", lambda rel: root / rel)

    def handle_request(folder, operation, selection_criteria=None):
        seen.update(folder=folder, operation=operation, criteria=selection_criteria)
        return {"prepared": True}

    monkeypatch.setattr(app_module, "handle_epoch_test_bench_request", handle_request)
    client = app_module.app.test_client()

    response = client.post("/fs/test_generations", json={
        "folder": "sets/subject",
        "operation": "test_prepare",
        "criteria": {"selected_media": ["one.png"]},
    })

    assert response.status_code == 200
    assert response.get_json() == {"ok": True, "prepared": True}
    assert seen == {
        "folder": root / "sets/subject",
        "operation": "test_prepare",
        "criteria": {"selected_media": ["one.png"]},
    }

    monkeypatch.setattr(
        app_module,
        "handle_epoch_test_bench_request",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad test request")),
    )
    failure = client.post("/fs/test_generations", json={"folder": "sets/subject", "operation": "test_prepare"})

    assert failure.status_code == 400
    assert failure.get_json() == {"ok": False, "error": "bad test request"}


def test_test_source_route_distinguishes_set_default_from_explicit_root(monkeypatch):
    seen = []

    def browse(model_id, source, set_name):
        seen.append({"modelId": model_id, "source": source, "setName": set_name})
        return {
            "operation": "test_source_browse",
            "modelId": model_id,
            "source": "staged/demo" if source is None else source,
            "parent": "",
            "folders": ["run-a"],
            "files": ["epoch10.safetensors"],
            "count": 1,
        }

    monkeypatch.setattr(app_module, "test_generations_browse_source", browse)
    client = app_module.app.test_client()

    default_response = client.get("/fs/test_generations/source?modelId=minimax_h3&setName=demo")
    root_response = client.get("/fs/test_generations/source?modelId=minimax_h3&source=")

    assert default_response.status_code == 200
    assert root_response.status_code == 200
    assert seen == [
        {"modelId": "minimax_h3", "source": None, "setName": "demo"},
        {"modelId": "minimax_h3", "source": "", "setName": ""},
    ]


def test_test_generations_vision_question_uses_resolved_test_media_and_queues_only(monkeypatch, tmp_path):
    from tool.server import app as app_module

    media = tmp_path / "preview.mp4"
    media.write_bytes(b"video")
    seen = {}
    monkeypatch.setattr(app_module, "list_vision_models", lambda: [{"id": "vl-test"}])
    monkeypatch.setattr(app_module, "safe_join_fs_root", lambda folder: tmp_path / folder)
    monkeypatch.setattr(app_module, "test_generations_resolve_result_media",
                        lambda folder, session, file: (seen.update(folder=folder, session=session, file=file) or media))
    monkeypatch.setattr(app_module, "vision_media_data_url", lambda path: "data:image/png;base64,YQ==")
    monkeypatch.setattr(app_module, "enqueue_llm",
                        lambda lane, model, payload, context, label: (
                            seen.update(lane=lane, model=model, operation=payload["operation"],
                                        context=context, label=label) or {"jobId": "vl-1"}))
    response = app_module.app.test_client().post("/fs/test_generations/vision-question", json={
        "folder": "sets/demo", "session": "session-1", "media": "preview.mp4",
        "model": "vl-test", "question": "Describe the visible clothes."
    })
    assert response.status_code == 202
    assert response.get_json()["job"]["jobId"] == "vl-1"
    assert seen == {
        "folder": tmp_path / "sets/demo", "session": "session-1", "file": "preview.mp4",
        "lane": "caption", "model": "vl-test", "operation": "vision_question",
        "context": {}, "label": "Test Generations Ask VL"
    }


def test_test_generations_vision_question_rejects_unknown_model(monkeypatch):
    from tool.server import app as app_module
    monkeypatch.setattr(app_module, "list_vision_models", lambda: [{"id": "vl-test"}])
    response = app_module.app.test_client().post("/fs/test_generations/vision-question", json={
        "folder": "sets/demo", "session": "session-1", "media": "preview.png",
        "model": "unknown", "question": "Describe."
    })
    assert response.status_code == 400
    assert "Vision model" in response.get_json()["error"]


def test_runs_menu_discovers_same_set_training_runs_without_staged_candidates(tmp_path, monkeypatch):
    root = tmp_path / "root"
    monkeypatch.setattr(app_module, "safe_join_fs_root", lambda rel: root / rel)
    monkeypatch.setattr(app_module, "handle_epoch_test_bench_request", lambda *_args, **_kwargs: {
        "modelId": "minimax_h3",
        "candidateRuns": [
            {"folder": "sets/subject", "jobId": "run-staged", "runName": "Staged"},
            {"folder": "sets/subject", "jobId": "run-missing", "runName": "Removed"},
        ],
    })
    monkeypatch.setattr(
        app_module, "training_runner_candidate_run_available",
        lambda _folder, job_id: job_id != "run-missing",
    )
    seen = []
    def discover(folder):
        seen.append(folder)
        return [
            {"folder": "sets/subject", "jobId": "run-unstaged",
             "runName": "Unstaged", "modelId": "minimax_h3"},
            {"folder": "sets/subject", "jobId": "run-staged",
             "runName": "Duplicate", "modelId": "minimax_h3"},
            {"folder": "sets/subject", "jobId": "run-other-model",
             "runName": "Wrong model", "modelId": "krea2"},
        ]
    monkeypatch.setattr(app_module, "discover_test_candidate_runs", discover)

    response = app_module.app.test_client().post("/fs/test_generations", json={
        "folder": "sets/subject", "operation": "test_prepare",
    })
    assert response.status_code == 200
    assert seen == [root / "sets/subject"]
    assert [(run["jobId"], run["runName"]) for run in response.get_json()["candidateRuns"]] == [
        ("run-staged", "Staged"), ("run-unstaged", "Unstaged"),
    ]


def test_runs_menu_discovery_error_warns_without_blocking_test_prepare(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "safe_join_fs_root", lambda rel: tmp_path / rel)
    monkeypatch.setattr(app_module, "handle_epoch_test_bench_request", lambda *_args, **_kwargs: {
        "modelId": "minimax_h3",
        "files": ["candidate.safetensors"],
        "candidateRuns": [{"folder": "sets/subject", "jobId": "run-staged"}],
    })
    monkeypatch.setattr(app_module, "training_runner_candidate_run_available", lambda *_args: True)
    monkeypatch.setattr(
        app_module, "discover_test_candidate_runs",
        lambda _folder: (_ for _ in ()).throw(RuntimeError("Training queue unavailable")),
    )

    response = app_module.app.test_client().post("/fs/test_generations", json={
        "folder": "sets/subject", "operation": "test_prepare",
    })
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["files"] == ["candidate.safetensors"]
    assert [run["jobId"] for run in payload["candidateRuns"]] == ["run-staged"]
    assert "Training queue unavailable" in payload["warnings"][0]
