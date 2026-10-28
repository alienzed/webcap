"""Assistant conversations are durable, independent of Story navigation, and fail loudly."""

import json

import pytest

from tool.server import config, director_chat_history as history


@pytest.fixture
def sessions(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_state_root", lambda: tmp_path / "app-data" / "state")
    return tmp_path / "app-data" / "state" / "director_chats"


def test_roundtrip_persists_messages_draft_and_explicit_snapshot(sessions):
    created = history.create_chat("storyboard")
    assert created["mode"] == "storyboard"
    assert (sessions / created["id"] / "conversation.json").exists()

    saved = history.save_chat(created["id"], {
        "expectedRevision": 0,
        "title": "Brainstorming a new ending",
        "messages": [
            {"role": "user", "content": "Review these Scenes"},
            {"role": "assistant", "content": "Scene 4 feels abrupt."},
        ],
        "draft": "Let's rewrite Scene 4",
        "workshop": {"storyId": "story-1", "sceneId": "scene-4",
                     "expectedPrompt": "Original timed shots", "shots": "[Shot 1] ..."},
        "attachments": {
            "story:example": {
                "key": "story:example", "label": "Story: Test",
                "content": '{"concept":"A brief story."}',
            },
            "section:Lighting": {"label": "Lighting", "content": "Soft morning light"},
        },
    })
    assert saved["revision"] == 1
    assert history.open_chat(created["id"])["messages"][1]["content"] == "Scene 4 feels abrupt."
    assert history.open_chat(created["id"])["draft"] == "Let's rewrite Scene 4"
    assert history.open_chat(created["id"])["workshop"]["sceneId"] == "scene-4"
    assert "section:Lighting" in history.open_chat(created["id"])["attachments"]

    on_disk = json.loads((sessions / created["id"] / "conversation.json").read_text())
    assert on_disk["title"] == "Brainstorming a new ending"
    assert history.list_chats()["activeByMode"]["storyboard"] == created["id"]


def test_multiple_independent_conversations_and_active_history(sessions):
    first = history.create_chat("chat")
    storyboard = history.create_chat("storyboard")
    second = history.create_chat("chat")

    assert len(history.list_chats()["chats"]) == 3
    assert history.list_chats()["activeByMode"] == {
        "chat": second["id"], "storyboard": storyboard["id"]
    }
    history.open_chat(first["id"])
    assert history.list_chats()["activeByMode"]["chat"] == first["id"]
    history.open_chat(second["id"], activate=False)
    assert history.list_chats()["activeByMode"]["chat"] == first["id"]

    history.delete_chat(first["id"])
    assert not (sessions / first["id"]).exists()
    assert "chat" not in history.list_chats()["activeByMode"]
    assert len(history.list_chats()["chats"]) == 2
    assert history.open_chat(storyboard["id"])["messages"] == []


def test_stale_revision_cannot_overwrite_a_newer_conversation(sessions):
    chat = history.create_chat("chat")
    edit = {
        "expectedRevision": 0, "title": "First",
        "messages": [{"role": "user", "content": "Original"}],
        "draft": "", "attachments": {},
    }
    history.save_chat(chat["id"], edit)
    with pytest.raises(RuntimeError, match="changed elsewhere"):
        history.save_chat(chat["id"], {**edit, "title": "Stale"})
    assert history.open_chat(chat["id"])["title"] == "First"


def test_reject_invalid_messages_mode_and_ids(sessions):
    with pytest.raises(ValueError, match="mode"):
        history.create_chat("random")
    chat = history.create_chat("chat")
    with pytest.raises(ValueError, match="message"):
        history.save_chat(chat["id"], {
            "expectedRevision": 0, "title": "Invalid",
            "messages": [{"role": "system", "content": "Pretend"}],
            "draft": "", "attachments": {},
        })
    with pytest.raises(ValueError, match="conversation ID"):
        history.open_chat("../../secrets")
    with pytest.raises(FileNotFoundError):
        history.open_chat("20261027T155000.000000Z-deadbeef")
    assert history.open_chat(chat["id"])["revision"] == 0


def test_history_routes(sessions):
    from tool.server.app import app

    client = app.test_client()
    created = client.post("/fs/director/chats", json={"mode": "storyboard"})
    assert created.status_code == 201
    chat_id = created.json["chat"]["id"]
    saved = client.put("/fs/director/chats/" + chat_id, json={
        "expectedRevision": 0, "title": "Storyboard idea",
        "messages": [{"role": "user", "content": "Remember this"}],
        "draft": "More ideas", "attachments": {},
    })
    assert saved.status_code == 200
    assert saved.json["chat"]["revision"] == 1
    assert client.get("/fs/director/chats").json["chats"][0]["id"] == chat_id
    assert client.get("/fs/director/chats/" + chat_id).json["chat"]["draft"] == "More ideas"
    assert client.delete("/fs/director/chats/" + chat_id).status_code == 200
    assert client.get("/fs/director/chats/" + chat_id).status_code == 404


def test_studio_operations_are_separate_from_dialogue_and_bounded(sessions):
    chat = history.create_chat("storyboard")
    assert chat["operations"] == []
    receipt = {
        "kind": "brief.apply", "label": "Updated Concept / overview",
        "storyId": "story-1", "sceneIds": [], "at": "2026-10-28T12:00:00Z",
    }
    saved = history.save_chat(chat["id"], {
        "expectedRevision": 0, "title": "Working idea", "draft": "",
        "messages": [{"role": "user", "content": "Use that as the concept"}],
        "attachments": {}, "operations": [receipt],
    })
    assert saved["messages"] == [{"role": "user", "content": "Use that as the concept"}]
    assert saved["operations"] == [receipt]
    # Legacy clients that omit operations may still update a conversation.
    next_saved = history.save_chat(chat["id"], {
        "expectedRevision": 1, "title": "Working idea", "draft": "",
        "messages": saved["messages"], "attachments": {},
    })
    assert next_saved["operations"] == [receipt]
    with pytest.raises(ValueError, match="25"):
        history.save_chat(chat["id"], {
            "expectedRevision": 2, "title": "Working idea", "draft": "",
            "messages": saved["messages"], "attachments": {},
            "operations": [receipt] * 26,
        })
    assert history.open_chat(chat["id"])["operations"] == [receipt]


def test_studio_receipts_reject_full_scene_or_extra_payload(sessions):
    chat = history.create_chat("storyboard")
    with pytest.raises(ValueError, match="invalid fields"):
        history.save_chat(chat["id"], {
            "expectedRevision": 0, "title": "Test", "draft": "",
            "messages": [], "attachments": {},
            "operations": [{
                "kind": "scene.create", "label": "Created",
                "storyId": "story-1", "sceneIds": [], "at": "2026-10-28T12:00:00Z",
                "prompt": "A giant prompt that does not belong in history",
            }],
        })
