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
