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


def test_studio_story_access_is_reference_only_and_survives_reopen(sessions):
    chat = history.create_chat("storyboard")
    assert chat["storyAccess"] is None
    saved = history.save_chat(chat["id"], {
        "expectedRevision": 0, "title": "Story development",
        "messages": [{"role": "user", "content": "Let's talk about Scene 1"}],
        "draft": "", "attachments": {},
        "storyAccess": {"storyId": "story-123", "label": "A Story"},
    })
    assert saved["storyAccess"] == {"storyId": "story-123", "label": "A Story"}
    assert "concept" not in json.dumps(saved["storyAccess"])
    assert history.open_chat(chat["id"])["storyAccess"]["storyId"] == "story-123"
    edited = history.save_chat(chat["id"], {
        "expectedRevision": 1, "title": "Story development",
        "messages": saved["messages"], "draft": "", "attachments": {},
    })
    assert edited["storyAccess"] == saved["storyAccess"]
    revoked = history.save_chat(chat["id"], {
        "expectedRevision": 2, "title": "Story development",
        "messages": saved["messages"], "draft": "", "attachments": {},
        "storyAccess": None,
    })
    assert revoked["storyAccess"] is None


def test_studio_readiness_roundtrips_without_becoming_project_storage(sessions):
    chat = history.create_chat("storyboard")
    readiness = {
        "checks": [{
            "name": "Concept", "scope": "project", "ready": True,
            "content": "The first Scene establishes the central encounter.",
        }],
        "readHints": ["project.concept", "scene.current.summary"],
        "writeHint": "scene-edit", "sceneId": "scene-12",
    }
    history.save_chat(chat["id"], {
        "expectedRevision": 0, "title": "Creative development",
        "messages": [{"role": "user", "content": "Let's develop the scene."}],
        "draft": "", "readiness": readiness,
    })
    assert history.open_chat(chat["id"])["readiness"] == readiness
    assert "readiness" in json.loads((sessions / chat["id"] / "conversation.json").read_text())


def test_studio_readiness_rejects_unsupported_dimensions(sessions):
    chat = history.create_chat("storyboard")
    with pytest.raises(ValueError, match="invalid assessment"):
        history.save_chat(chat["id"], {
            "expectedRevision": 0, "title": "Invalid",
            "messages": [], "draft": "",
            "readiness": {
                "checks": [{"name": "Made up", "scope": "project", "ready": True, "content": "a"}],
                "readHints": [], "writeHint": "", "sceneId": "",
            },
        })
    assert history.open_chat(chat["id"])["revision"] == 0


def test_studio_readiness_staleness_survives_reopen_and_legacy_payloads(sessions):
    chat = history.create_chat("storyboard")
    base = {
        "checks": [{"name": "Concept", "scope": "project",
                    "ready": True, "content": "Central idea is clear."}],
        "readHints": ["project.concept"], "writeHint": "project", "sceneId": "",
    }
    saved = history.save_chat(chat["id"], {
        "expectedRevision": 0, "title": "Developing", "messages": [],
        "draft": "", "readiness": {**base, "stale": True},
    })
    assert saved["readiness"]["stale"] is True
    assert history.open_chat(chat["id"])["readiness"]["checks"] == base["checks"]
    updated = history.save_chat(chat["id"], {
        "expectedRevision": 1, "title": "Developing", "messages": [],
        "draft": "", "readiness": {**base, "stale": False},
    })
    assert updated["readiness"]["stale"] is False
    legacy = history.save_chat(chat["id"], {
        "expectedRevision": 2, "title": "Developing", "messages": [],
        "draft": "", "readiness": base,
    })
    assert legacy["readiness"] == base


def test_studio_readiness_stale_marker_requires_boolean(sessions):
    chat = history.create_chat("storyboard")
    with pytest.raises(ValueError, match="freshness"):
        history.save_chat(chat["id"], {
            "expectedRevision": 0, "title": "Invalid",
            "messages": [], "draft": "",
            "readiness": {"checks": [], "readHints": [],
                          "writeHint": "", "sceneId": "", "stale": "yes"},
        })

def test_studio_creative_capture_persists_without_authorizing_project_mutation(sessions):
    chat = history.create_chat("storyboard")
    base = {"checks": [], "readHints": [], "writeHint": "project", "sceneId": ""}
    capture = {"field": "concept", "content": "A concrete creative premise.", "sceneId": ""}
    saved = history.save_chat(chat["id"], {
        "expectedRevision": 0, "title": "Developing", "messages": [],
        "draft": "", "readiness": {**base, "capture": capture},
    })
    assert saved["readiness"]["capture"] == capture
    assert history.open_chat(chat["id"])["readiness"]["capture"] == capture
    assert saved["operations"] == []

    with pytest.raises(ValueError, match="creative capture"):
        history.save_chat(chat["id"], {
            "expectedRevision": 1, "title": "Invalid", "messages": [],
            "draft": "", "readiness": {**base, "capture":
                {"field": "concept", "content": "", "sceneId": ""}},
        })
    with pytest.raises(ValueError, match="creative capture"):
        history.save_chat(chat["id"], {
            "expectedRevision": 1, "title": "Invalid", "messages": [],
            "draft": "", "readiness": {**base, "capture":
                {"field": "style", "content": "Neon", "sceneId": "scene-12"}},
        })
    assert history.open_chat(chat["id"])["revision"] == 1
