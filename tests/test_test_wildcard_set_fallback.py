"""Wildcard mining should remain usable without a resolvable training-run filter."""

from tool.server import app as app_module
from tool.server import epoch_reference


def _request(monkeypatch, *, job_id="", members=None, failure=None):
    seen = {}
    monkeypatch.setattr(app_module, "list_media_files", lambda folder: ["one.png", "two.png"])
    monkeypatch.setattr(app_module, "load_caption_text",
                        lambda folder, name: {"caption": "Caption " + name})
    monkeypatch.setattr(app_module, "_resolve_folder", lambda folder: __import__("pathlib").Path("/tmp"))
    monkeypatch.setattr(app_module, "read_folder_state", lambda path: {
        "caption_group_tags_by_media": {
            "one.png": {"Shape": ["triangle"]},
            "two.png": {"Shape": ["teardrop"]},
        }
    })
    monkeypatch.setattr(app_module, "test_wildcard_build_request",
                        lambda captions, **kwargs: (seen.update(captions=captions, **kwargs) or {"operation": "wildcard"}))
    monkeypatch.setattr(app_module, "enqueue_llm",
                        lambda *args, **kwargs: {"jobId": "director-1"})
    if failure is not None:
        def fail_filter(folder, job):
            raise failure
        monkeypatch.setattr(epoch_reference, "training_wildcard_members", fail_filter)
    else:
        monkeypatch.setattr(epoch_reference, "training_wildcard_members",
                            lambda folder, job: members if members is not None else {"one.png"})
    response = app_module.app.test_client().post(
        "/fs/test_generations/wildcard",
        json={"folder": "sets/demo", "jobId": job_id, "directorModel": "director"},
    )
    return response, seen


def test_no_training_run_mines_entire_set(monkeypatch):
    response, seen = _request(monkeypatch)
    assert response.status_code == 202
    assert response.get_json()["sourceScope"] == "set"
    assert response.get_json()["warning"] == ""
    assert seen["captions"] == ["Caption one.png", "Caption two.png"]


def test_valid_run_limits_wildcard_to_captured_members(monkeypatch):
    response, seen = _request(monkeypatch, job_id="run-1", members={"two.png"})
    assert response.status_code == 202
    assert response.get_json()["sourceScope"] == "training_run"
    assert seen["captions"] == ["Caption two.png"]


def test_missing_run_uses_set_and_reports_warning(monkeypatch):
    response, seen = _request(monkeypatch, job_id="lost", failure=LookupError("Training job not found"))
    assert response.status_code == 202
    assert "Training job not found" in response.get_json()["warning"]
    assert response.get_json()["sourceScope"] == "set"
    assert len(seen["captions"]) == 2


def test_run_without_remaining_matching_media_uses_set(monkeypatch):
    response, seen = _request(monkeypatch, job_id="old", members={"removed.png"})
    assert response.status_code == 202
    assert "No current Set media match" in response.get_json()["warning"]
    assert len(seen["captions"]) == 2


def test_unexpected_error_does_not_become_set_fallback(monkeypatch):
    response, _ = _request(monkeypatch, job_id="broken", failure=TypeError("unexpected bug"))
    assert response.status_code == 400
    assert "unexpected bug" in response.get_json()["error"]
