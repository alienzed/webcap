import json
from io import BytesIO
from pathlib import Path

import pytest

from tool.server import storyboard_store


@pytest.fixture
def storyboard_fs(tmp_path, monkeypatch):
    monkeypatch.setattr(storyboard_store.app_config, "FS_ROOT", str(tmp_path))
    return tmp_path


def test_story_create_list_and_reload(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Storm Hotel",
        "concept": "Arrival during a storm.",
        "style": "Rain-soaked neo-noir horror.",
        "invariants": [
            {"kind": "character", "title": "Mara", "text": "Mara keeps the same dark bob and red coat."},
            {"kind": "sound", "title": "Score", "text": "Low analog synth, no vocals."},
        ],
        "tags": ["storm", "hotel", "Storm"],
        "pinned": True,
    })

    assert story["title"] == "Storm Hotel"
    assert story["style"] == "Rain-soaked neo-noir horror."
    assert story["invariants"] == [
        {"kind": "character", "title": "Mara", "text": "Mara keeps the same dark bob and red coat."},
        {"kind": "sound", "title": "Score", "text": "Low analog synth, no vocals."},
    ]
    assert story["tags"] == ["storm", "hotel"]
    assert story["status"] == "active"
    assert story["targetSceneCount"] == 12
    assert story["generationDefaults"] == {"aspectRatio": "4:3 (Standard)", "megapixels": 0.2}

    path = storyboard_fs / "output" / "storyboards" / story["id"] / "story.json"
    assert path.is_file()
    assert (path.parent / "takes").is_dir()

    loaded = storyboard_store.load_story(story["id"])
    assert loaded["id"] == story["id"]
    assert storyboard_store.list_stories()[0]["title"] == "Storm Hotel"


def test_duplicate_story_copies_authoring_but_not_generated_artifacts(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Source Story",
        "concept": "A motel at night.",
        "style": "Neo-noir.",
        "invariants": [{"kind": "world", "title": "Weather", "text": "Heavy rain."}],
        "tags": ["motel"],
        "pinned": True,
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Arrival",
        "prompt": "A car arrives at a motel.",
        "loras": [{"name": "character.safetensors", "strength": 0.8}],
    })
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "take.mp4", BytesIO(b"video")
    )
    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])

    duplicate = storyboard_store.duplicate_story(story["id"])

    assert duplicate["id"] != story["id"]
    assert duplicate["title"] == "Source Story Copy"
    assert duplicate["concept"] == story["concept"]
    assert duplicate["style"] == story["style"]
    assert duplicate["invariants"] == story["invariants"]
    assert duplicate["tags"] == story["tags"]
    assert duplicate["status"] == "active"
    assert duplicate["pinned"] is False
    assert len(duplicate["sceneOrder"]) == 1

    copied_scene = duplicate["scenes"][duplicate["sceneOrder"][0]]
    assert copied_scene["id"] != scene["id"]
    assert copied_scene["title"] == scene["title"]
    assert copied_scene["prompt"] == scene["prompt"]
    assert copied_scene["loras"] == scene["loras"]
    assert copied_scene["takes"] == {}
    assert copied_scene["removedTakes"] == {}
    assert copied_scene["takeOrder"] == []
    assert copied_scene["selectedTakeId"] is None
    assert copied_scene["references"] == []

    duplicate_dir = storyboard_fs / "output" / "storyboards" / duplicate["id"]
    assert (duplicate_dir / "story.json").is_file()
    assert not (duplicate_dir / "exports").exists()



def test_story_generation_defaults_and_scene_inheritance_are_persisted(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Story",
        "targetSceneCount": 14,
        "generationDefaults": {"aspectRatio": "16:9 (Widescreen)", "megapixels": 0.35},
    })
    story, inherited = storyboard_store.add_scene(story["id"], {"title": "Inherited"})
    story, overridden = storyboard_store.add_scene(story["id"], {
        "title": "Override",
        "aspectRatio": "9:16 (Portrait Widescreen)",
        "megapixels": 0.5,
    })

    assert story["targetSceneCount"] == 14
    assert story["generationDefaults"] == {"aspectRatio": "16:9 (Widescreen)", "megapixels": 0.35}
    assert inherited["aspectRatio"] is None
    assert inherited["megapixels"] is None
    assert storyboard_store.resolve_scene_generation_defaults(story, inherited) == {
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.35,
    }
    assert storyboard_store.resolve_scene_generation_defaults(story, overridden) == {
        "aspectRatio": "9:16 (Portrait Widescreen)",
        "megapixels": 0.5,
    }

def test_delete_story_permanently_removes_complete_story_directory(storyboard_fs):
    story = storyboard_store.create_story({"title": "Disposable Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "take.mp4", BytesIO(b"video")
    )
    story_dir = storyboard_fs / "output" / "storyboards" / story["id"]
    (story_dir / "references" / "manual").mkdir(parents=True)
    (story_dir / "references" / "manual" / "reference.png").write_bytes(b"reference")
    (story_dir / "exports").mkdir()
    (story_dir / "exports" / "selected-sequence.mp4").write_bytes(b"export")
    assert (story_dir / take["mediaPath"]).is_file()

    deleted_id = storyboard_store.delete_story(story["id"])

    assert deleted_id == story["id"]
    assert not story_dir.exists()
    assert storyboard_store.list_stories() == []
    with pytest.raises(FileNotFoundError):
        storyboard_store.load_story(story["id"])


def test_story_scene_lifecycle(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {
        "title": "Arrival",
        "summary": "A car reaches the hotel.",
        "entryState": "The road is empty in heavy rain.",
        "exitState": "The car has stopped beneath the hotel awning.",
        "prompt": "A car arrives.",
        "durationSeconds": 8,
        "seedMode": "fixed",
        "seed": 42,
    })
    story, second = storyboard_store.add_scene(story["id"], {"title": "Lobby"})

    assert story["sceneOrder"] == [first["id"], second["id"]]
    assert first["seed"] == 42
    assert first["durationSeconds"] == 8
    assert first["entryState"] == "The road is empty in heavy rain."
    assert first["exitState"] == "The car has stopped beneath the hotel awning."

    story, updated = storyboard_store.update_scene(
        story["id"],
        first["id"],
        {
            "prompt": "A car arrives in heavy rain.",
            "promptDirectorModel": "director.gguf",
            "promptDirectorJobId": "job-123",
            "durationSeconds": 10,
        },
    )
    assert updated["prompt"].endswith("heavy rain.")
    assert updated["promptDirectorModel"] == "director.gguf"
    assert updated["promptDirectorJobId"] == "job-123"
    assert updated["seed"] == 42
    assert updated["durationSeconds"] == 10

    story, duplicate = storyboard_store.duplicate_scene(story["id"], first["id"])
    assert story["sceneOrder"][1] == duplicate["id"]
    assert duplicate["prompt"] == updated["prompt"]
    assert duplicate["promptDirectorModel"] == "director.gguf"
    assert duplicate["promptDirectorJobId"] == "job-123"
    assert duplicate["entryState"] == updated["entryState"]
    assert duplicate["exitState"] == updated["exitState"]
    assert duplicate["takes"] == {}
    assert duplicate["takeOrder"] == []

    reordered = storyboard_store.reorder_scenes(
        story["id"],
        [second["id"], duplicate["id"], first["id"]],
    )
    assert reordered["sceneOrder"][0] == second["id"]

    removed = storyboard_store.delete_scene(story["id"], duplicate["id"])
    assert duplicate["id"] not in removed["scenes"]
    assert duplicate["id"] in removed["removedScenes"]
    assert "removedAt" in removed["removedScenes"][duplicate["id"]]

    restored = storyboard_store.restore_scene(story["id"], duplicate["id"])
    assert duplicate["id"] in restored["scenes"]
    assert duplicate["id"] not in restored["removedScenes"]
    assert restored["sceneOrder"] == [second["id"], duplicate["id"], first["id"]]


def test_reorder_requires_every_scene_exactly_once(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {})
    story, second = storyboard_store.add_scene(story["id"], {})

    with pytest.raises(ValueError):
        storyboard_store.reorder_scenes(story["id"], [first["id"]])

    with pytest.raises(ValueError):
        storyboard_store.reorder_scenes(story["id"], [first["id"], first["id"]])


def test_invalid_story_id_does_not_escape_root(storyboard_fs):
    with pytest.raises(ValueError):
        storyboard_store.load_story("../outside")


def test_story_json_is_human_readable(storyboard_fs):
    story = storyboard_store.create_story({"title": "Readable"})
    path = storyboard_fs / "output" / "storyboards" / story["id"] / "story.json"
    text = path.read_text(encoding="utf-8")
    assert "\n  \"title\": \"Readable\"" in text
    assert json.loads(text)["title"] == "Readable"


def test_take_upload_freezes_scene_provenance_and_can_be_rated_and_selected(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story", "style": "1980s exercise-video horror."})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Studio",
        "prompt": "A woman enters an empty aerobics studio.",
        "durationSeconds": 8,
        "seedMode": "fixed",
        "seed": 123,
        "wildcardsEnabled": True,
    })

    story, take = storyboard_store.add_take_upload(
        story["id"],
        scene["id"],
        "render.mp4",
        BytesIO(b"not-a-real-video"),
    )

    take_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert take_path.read_bytes() == b"not-a-real-video"
    assert take["sourceFilename"] == "render.mp4"
    assert take["prompt"] == "A woman enters an empty aerobics studio."
    assert take["durationSeconds"] == 8
    assert take["seed"] == 123
    assert take["wildcardsEnabled"] is True
    assert story["scenes"][scene["id"]]["takeOrder"] == [take["id"]]

    story, rated = storyboard_store.rate_take(story["id"], scene["id"], take["id"], 4)
    assert rated["rating"] == 4
    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    assert story["scenes"][scene["id"]]["selectedTakeId"] == take["id"]


def test_take_removal_is_reversible_without_deleting_media(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "still.png", BytesIO(b"png-bytes")
    )
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]

    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    story = storyboard_store.remove_take(story["id"], scene["id"], take["id"])
    current = story["scenes"][scene["id"]]
    assert take["id"] not in current["takes"]
    assert take["id"] in current["removedTakes"]
    assert current["selectedTakeId"] is None
    assert media_path.read_bytes() == b"png-bytes"

    story = storyboard_store.restore_take(story["id"], scene["id"], take["id"])
    current = story["scenes"][scene["id"]]
    assert take["id"] in current["takes"]
    assert take["id"] not in current["removedTakes"]
    assert current["takeOrder"] == [take["id"]]


def test_scene_reference_from_image_take_is_semantic_and_clearable(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, source = storyboard_store.add_scene(story["id"], {"title": "Source"})
    story, target = storyboard_store.add_scene(story["id"], {"title": "Target"})
    story, take = storyboard_store.add_take_upload(
        story["id"], source["id"], "still.png", BytesIO(b"png-bytes")
    )

    story, reference = storyboard_store.set_scene_reference_from_take(
        story["id"], target["id"], "first_frame", source["id"], take["id"], "last"
    )
    assert reference == {
        "role": "first_frame",
        "source": "take",
        "sourceSceneId": source["id"],
        "sourceTakeId": take["id"],
        "frame": "last",
        "mediaPath": take["mediaPath"],
    }
    assert story["scenes"][target["id"]]["references"] == [reference]

    story = storyboard_store.clear_scene_reference(story["id"], target["id"], "first_frame")
    assert story["scenes"][target["id"]]["references"] == []


def test_restore_scene_returns_to_original_order(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {"title": "First"})
    story, second = storyboard_store.add_scene(story["id"], {"title": "Second"})
    story, third = storyboard_store.add_scene(story["id"], {"title": "Third"})

    story = storyboard_store.delete_scene(story["id"], second["id"])
    assert story["sceneOrder"] == [first["id"], third["id"]]

    story = storyboard_store.restore_scene(story["id"], second["id"])
    assert story["sceneOrder"] == [first["id"], second["id"], third["id"]]


def test_restore_take_returns_to_original_order(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, first = storyboard_store.add_take_upload(story["id"], scene["id"], "first.png", BytesIO(b"1"))
    story, second = storyboard_store.add_take_upload(story["id"], scene["id"], "second.png", BytesIO(b"2"))
    story, third = storyboard_store.add_take_upload(story["id"], scene["id"], "third.png", BytesIO(b"3"))

    story = storyboard_store.remove_take(story["id"], scene["id"], second["id"])
    story = storyboard_store.restore_take(story["id"], scene["id"], second["id"])

    assert story["scenes"][scene["id"]]["takeOrder"] == [first["id"], second["id"], third["id"]]


def test_restore_multiple_scenes_preserves_original_order(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, first = storyboard_store.add_scene(story["id"], {"title": "First"})
    story, second = storyboard_store.add_scene(story["id"], {"title": "Second"})
    story, third = storyboard_store.add_scene(story["id"], {"title": "Third"})
    story, fourth = storyboard_store.add_scene(story["id"], {"title": "Fourth"})

    story = storyboard_store.delete_scene(story["id"], second["id"])
    story = storyboard_store.delete_scene(story["id"], third["id"])
    story = storyboard_store.restore_scene(story["id"], second["id"])
    story = storyboard_store.restore_scene(story["id"], third["id"])

    assert story["sceneOrder"] == [first["id"], second["id"], third["id"], fourth["id"]]


def test_restore_multiple_takes_preserves_original_order(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, first = storyboard_store.add_take_upload(story["id"], scene["id"], "first.png", BytesIO(b"1"))
    story, second = storyboard_store.add_take_upload(story["id"], scene["id"], "second.png", BytesIO(b"2"))
    story, third = storyboard_store.add_take_upload(story["id"], scene["id"], "third.png", BytesIO(b"3"))
    story, fourth = storyboard_store.add_take_upload(story["id"], scene["id"], "fourth.png", BytesIO(b"4"))

    story = storyboard_store.remove_take(story["id"], scene["id"], second["id"])
    story = storyboard_store.remove_take(story["id"], scene["id"], third["id"])
    story = storyboard_store.restore_take(story["id"], scene["id"], second["id"])
    story = storyboard_store.restore_take(story["id"], scene["id"], third["id"])

    assert story["scenes"][scene["id"]]["takeOrder"] == [first["id"], second["id"], third["id"], fourth["id"]]


def test_scene_loras_are_persisted_ordered_and_duplicated(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Scene",
        "loras": [
            {"name": "characters/alice.safetensors", "strength": 0.8},
            {"name": "styles/noir.safetensors", "strength": 0.55},
        ],
    })

    assert scene["loras"] == [
        {"name": "characters/alice.safetensors", "strength": 0.8},
        {"name": "styles/noir.safetensors", "strength": 0.55},
    ]

    story, duplicate = storyboard_store.duplicate_scene(story["id"], scene["id"])
    assert duplicate["loras"] == scene["loras"]

    with pytest.raises(ValueError, match="duplicates"):
        storyboard_store.update_scene(story["id"], scene["id"], {
            "loras": [
                {"name": "same.safetensors", "strength": 1},
                {"name": "same.safetensors", "strength": 0.5},
            ],
        })


def test_apply_developed_plan_replaces_active_scenes_and_preserves_old_takes(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story", "concept": "A short film.", "targetSceneCount": 2})
    story, old_scene = storyboard_store.add_scene(story["id"], {"title": "Old", "prompt": "Old prompt"})
    story, old_take = storyboard_store.add_take_upload(
        story["id"], old_scene["id"], "old.mp4", BytesIO(b"old-video")
    )
    old_media = storyboard_fs / "output" / "storyboards" / story["id"] / old_take["mediaPath"]

    plan = {
        "scenes": [
            {
                "title": "Opening",
                "summary": "A woman enters a quiet lobby.",
                "entryState": "She stands outside the lobby doors.",
                "exitState": "She is inside the lobby.",
                "prompt": "integrated_multimodal_description: [Shot 1] She enters.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: None.",
                "suggestedDurationSeconds": 6,
                "continuity": {"continuesPreviousScene": False, "carryForward": []},
            },
            {
                "title": "Desk",
                "summary": "She approaches the empty desk.",
                "entryState": "She is inside the lobby.",
                "exitState": "She stands at the empty desk.",
                "prompt": "integrated_multimodal_description: [Shot 1] She crosses the lobby.\n\noverall_soundscape: Footsteps.\n\nnon_diegetic_music: Low drone.",
                "suggestedDurationSeconds": 8,
                "continuity": {"continuesPreviousScene": True, "carryForward": ["She remains inside the hotel."]},
            },
        ]
    }

    developed = storyboard_store.apply_developed_plan(story["id"], plan, model_id="director.gguf")

    assert len(developed["sceneOrder"]) == 2
    assert old_scene["id"] not in developed["scenes"]
    assert old_scene["id"] in developed["removedScenes"]
    assert developed["removedScenes"][old_scene["id"]]["removedReason"] == "replaced_by_develop_story"
    assert old_media.read_bytes() == b"old-video"
    assert developed["development"]["model"] == "director.gguf"
    assert developed["development"]["plan"] == plan

    first = developed["scenes"][developed["sceneOrder"][0]]
    assert first["title"] == "Opening"
    assert first["durationSeconds"] == 6
    assert "integrated_multimodal_description" in first["prompt"]
    assert first["promptDirectorModel"] == "director.gguf"
    assert first["planDirectorModel"] == "director.gguf"


def test_apply_developed_plan_rejects_wrong_scene_count_or_out_of_range_duration(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story", "targetSceneCount": 2})
    with pytest.raises(ValueError, match="requests exactly 2"):
        storyboard_store.apply_developed_plan(story["id"], {"scenes": []})

    bad_scene = {
        "title": "Too long",
        "summary": "Too much happens.",
        "entryState": "Start.",
        "exitState": "End.",
        "prompt": "Prompt.",
        "suggestedDurationSeconds": 20,
        "continuity": {"continuesPreviousScene": False, "carryForward": []},
    }
    with pytest.raises(ValueError, match="between 4 and 15"):
        storyboard_store.apply_developed_plan(story["id"], {"scenes": [bad_scene, dict(bad_scene)]})


def test_concept_expansion_preserves_one_previous_version(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story", "concept": "One sentence."})

    expanded = storyboard_store.apply_concept_expansion(
        story["id"],
        "A richer concept with characters, conflict, and an ending.",
    )

    assert expanded["concept"].startswith("A richer concept")
    assert expanded["previousConcept"] == "One sentence."

    restored = storyboard_store.restore_previous_concept(story["id"])
    assert restored["concept"] == "One sentence."
    assert restored["previousConcept"] is None


def test_restore_scene_clears_replanning_removal_metadata(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Old Scene"})
    plan = {
        "scenes": [
            {
                "title": "New One",
                "summary": "First.",
                "entryState": "Start one.",
                "exitState": "End one.",
                "prompt": "Prompt one.",
                "suggestedDurationSeconds": 6,
                "continuity": {"continuesPreviousScene": False, "carryForward": []},
            },
            {
                "title": "New Two",
                "summary": "Second.",
                "entryState": "Start two.",
                "exitState": "End two.",
                "prompt": "Prompt two.",
                "suggestedDurationSeconds": 6,
                "continuity": {"continuesPreviousScene": True, "carryForward": []},
            },
        ]
    }
    developed = storyboard_store.apply_developed_plan(story["id"], plan)
    assert developed["removedScenes"][scene["id"]]["removedReason"] == "replaced_by_develop_story"

    restored = storyboard_store.restore_scene(story["id"], scene["id"])
    assert "removedReason" not in restored["scenes"][scene["id"]]


def test_developed_plan_rejects_schema_shape_drift(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    base_scene = {
        "title": "Scene",
        "summary": "Summary.",
        "entryState": "Start.",
        "exitState": "End.",
        "prompt": "Prompt.",
        "suggestedDurationSeconds": 6,
        "continuity": {"continuesPreviousScene": False, "carryForward": []},
    }

    bad_top = {"scenes": [dict(base_scene), dict(base_scene)], "extra": True}
    with pytest.raises(ValueError, match="unsupported fields"):
        storyboard_store.apply_developed_plan(story["id"], bad_top)

    bad_scene = dict(base_scene)
    bad_scene["extra"] = "nope"
    with pytest.raises(ValueError, match="missing or unsupported fields"):
        storyboard_store.apply_developed_plan(story["id"], {"scenes": [bad_scene, dict(base_scene)]})

    bad_type = dict(base_scene)
    bad_type["title"] = 42
    with pytest.raises(ValueError, match="invalid title"):
        storyboard_store.apply_developed_plan(story["id"], {"scenes": [bad_type, dict(base_scene)]})


def test_take_label_is_editable_and_persists(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene", "prompt": "Prompt"})
    import io
    story, take = storyboard_store.add_take_upload(story["id"], scene["id"], "take.mp4", io.BytesIO(b"video"))

    story, take = storyboard_store.label_take(story["id"], scene["id"], take["id"], "Best expression")

    assert take["label"] == "Best expression"
    loaded = storyboard_store.load_story(story["id"])
    assert loaded["scenes"][scene["id"]]["takes"][take["id"]]["label"] == "Best expression"


def test_story_loras_are_inherited_with_sparse_scene_overrides(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Story",
        "loras": [
            {"name": "characters/alice.safetensors", "strength": 0.8},
            {"name": "styles/film.safetensors", "strength": 0.5},
            {"name": "styles/noir.safetensors", "strength": 0.9, "enabled": False},
        ],
    })
    assert story["loras"][2]["enabled"] is False

    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Scene",
        "storyLoraOverrides": [
            {"name": "characters/alice.safetensors", "strength": 0.65},
            {"name": "styles/film.safetensors", "enabled": False},
            {"name": "styles/noir.safetensors", "enabled": True},
        ],
        "loras": [{"name": "clothing/dress.safetensors", "strength": 0.7}],
    })

    assert storyboard_store.resolve_scene_loras(story, scene) == [
        {"name": "characters/alice.safetensors", "strength": 0.65},
        {"name": "clothing/dress.safetensors", "strength": 0.7},
    ]

    story = storyboard_store.update_story(story["id"], {
        "loras": [
            {"name": "characters/alice.safetensors", "strength": 0.95},
            {"name": "styles/film.safetensors", "strength": 0.6},
        ],
    })
    scene = story["scenes"][scene["id"]]
    assert storyboard_store.resolve_scene_loras(story, scene)[0]["strength"] == 0.65

    story, duplicate = storyboard_store.duplicate_scene(story["id"], scene["id"])
    assert duplicate["storyLoraOverrides"] == scene["storyLoraOverrides"]


def test_scene_local_lora_cannot_duplicate_inherited_story_lora(storyboard_fs):
    story = storyboard_store.create_story({
        "title": "Story",
        "loras": [{"name": "characters/alice.safetensors", "strength": 0.8}],
    })
    story, scene = storyboard_store.add_scene(story["id"], {
        "title": "Scene",
        "loras": [{"name": "characters/alice.safetensors", "strength": 0.5}],
    })

    with pytest.raises(ValueError, match="duplicates a Story LoRA"):
        storyboard_store.resolve_scene_loras(story, scene)

def test_delete_take_permanently_removes_active_media_and_selection(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "take.png", BytesIO(b"image")
    )
    story = storyboard_store.select_take(story["id"], scene["id"], take["id"])
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert media_path.is_file()

    deleted = storyboard_store.delete_take(story["id"], scene["id"], take["id"])

    current = deleted["scenes"][scene["id"]]
    assert take["id"] not in current["takes"]
    assert take["id"] not in current["takeOrder"]
    assert current["selectedTakeId"] is None
    assert not media_path.exists()


def test_delete_take_permanently_removes_soft_removed_take(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "take.png", BytesIO(b"image")
    )
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    story = storyboard_store.remove_take(story["id"], scene["id"], take["id"])
    assert take["id"] in story["scenes"][scene["id"]]["removedTakes"]

    deleted = storyboard_store.delete_take(story["id"], scene["id"], take["id"])

    assert take["id"] not in deleted["scenes"][scene["id"]]["removedTakes"]
    assert not media_path.exists()


def test_delete_take_refuses_media_used_as_live_image_reference(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, source_scene = storyboard_store.add_scene(story["id"], {"title": "Source"})
    story, target_scene = storyboard_store.add_scene(story["id"], {"title": "Target"})
    story, take = storyboard_store.add_take_upload(
        story["id"], source_scene["id"], "take.png", BytesIO(b"image")
    )
    story, reference = storyboard_store.set_scene_reference_from_take(
        story["id"],
        target_scene["id"],
        "first_frame",
        source_scene["id"],
        take["id"],
        "last",
    )
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    assert reference["mediaPath"] == take["mediaPath"]

    with pytest.raises(RuntimeError, match="used as a Scene reference"):
        storyboard_store.delete_take(story["id"], source_scene["id"], take["id"])

    loaded = storyboard_store.load_story(story["id"])
    assert take["id"] in loaded["scenes"][source_scene["id"]]["takes"]
    assert media_path.is_file()


def test_delete_take_rolls_back_metadata_when_media_delete_fails(storyboard_fs, monkeypatch):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})
    story, take = storyboard_store.add_take_upload(
        story["id"], scene["id"], "take.png", BytesIO(b"image")
    )
    media_path = storyboard_fs / "output" / "storyboards" / story["id"] / take["mediaPath"]
    original_unlink = Path.unlink

    def fail_media_unlink(path, *args, **kwargs):
        if path == media_path:
            raise OSError("media is locked")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_media_unlink)

    with pytest.raises(OSError, match="media is locked"):
        storyboard_store.delete_take(story["id"], scene["id"], take["id"])

    loaded = storyboard_store.load_story(story["id"])
    assert take["id"] in loaded["scenes"][scene["id"]]["takes"]
    assert take["id"] in loaded["scenes"][scene["id"]]["takeOrder"]
    assert media_path.is_file()

def test_uploaded_scene_reference_is_story_owned_and_replaces_cleanly(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})

    story, first = storyboard_store.set_scene_reference_upload(
        story["id"], scene["id"], "first_frame", "first.png", BytesIO(b"first")
    )
    first_path = storyboard_fs / "output" / "storyboards" / story["id"] / first["mediaPath"]
    assert first["source"] == "upload"
    assert first["sourceFilename"] == "first.png"
    assert first_path.read_bytes() == b"first"

    story, second = storyboard_store.set_scene_reference_upload(
        story["id"], scene["id"], "first_frame", "second.webp", BytesIO(b"second")
    )
    second_path = storyboard_fs / "output" / "storyboards" / story["id"] / second["mediaPath"]
    assert not first_path.exists()
    assert second_path.read_bytes() == b"second"
    assert [
        item["role"] for item in story["scenes"][scene["id"]]["references"]
    ] == ["first_frame"]

    cleared = storyboard_store.clear_scene_reference(story["id"], scene["id"], "first_frame")
    assert cleared["scenes"][scene["id"]]["references"] == []
    assert not second_path.exists()


def test_uploaded_scene_reference_rejects_video(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, scene = storyboard_store.add_scene(story["id"], {"title": "Scene"})

    with pytest.raises(ValueError, match="must be an image"):
        storyboard_store.set_scene_reference_upload(
            story["id"], scene["id"], "first_frame", "clip.mp4", BytesIO(b"video")
        )

def test_take_reference_replaces_and_cleans_manual_upload(storyboard_fs):
    story = storyboard_store.create_story({"title": "Story"})
    story, source_scene = storyboard_store.add_scene(story["id"], {"title": "Source"})
    story, target_scene = storyboard_store.add_scene(story["id"], {"title": "Target"})
    story, take = storyboard_store.add_take_upload(
        story["id"], source_scene["id"], "source.png", BytesIO(b"take")
    )
    story, uploaded = storyboard_store.set_scene_reference_upload(
        story["id"], target_scene["id"], "first_frame", "manual.png", BytesIO(b"manual")
    )
    uploaded_path = storyboard_fs / "output" / "storyboards" / story["id"] / uploaded["mediaPath"]
    assert uploaded_path.is_file()

    story, reference = storyboard_store.set_scene_reference_from_take(
        story["id"], target_scene["id"], "first_frame", source_scene["id"], take["id"], "last"
    )

    assert reference["source"] == "take"
    assert not uploaded_path.exists()
