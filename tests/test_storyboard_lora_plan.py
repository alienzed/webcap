import copy
import pytest

from tool.server import storyboard_store


def test_storyboard_lora_plan_preserves_existing_and_stale_guard(monkeypatch):
    story = {
        "id": "story-1", "updatedAt": "v1", "directorLoraPlanning": True,
        "loras": [{"name": "existing.safetensors", "strength": 0.9}],
        "sceneOrder": ["s1"], "scenes": {"s1": {
            "id": "s1", "loras": [{"name": "manual.safetensors", "strength": 1}],
            "storyLoraOverrides": [],
        }}
    }
    saved = []
    monkeypatch.setattr(storyboard_store, "load_story", lambda story_id: copy.deepcopy(story))
    monkeypatch.setattr(storyboard_store, "_write_json_atomic", lambda path, value: saved.append(value))
    monkeypatch.setattr(storyboard_store, "_story_path", lambda story_id: "unused.json")
    monkeypatch.setattr(storyboard_store, "_utc_now", lambda: "v2")
    from tool.server import lora_library
    monkeypatch.setattr(lora_library, "catalogue", lambda: [
        {"stage": "h3", "name": "new.safetensors", "enriched": True, "enrichment": {"trainedWords": []}},
    ])
    monkeypatch.setattr(lora_library, "resolve_for_inference",
                        lambda stage, names: {name: name for name in names})
    updated = storyboard_store.apply_lora_plan.__wrapped__ if hasattr(
        storyboard_store.apply_lora_plan, "__wrapped__") else storyboard_store.apply_lora_plan
    # The decorated public mutation is the integration boundary; its wrapper
    # may additionally acquire the normal Storyboard persistence lock.
    result = updated("story-1", "v1", [{"name": "new.safetensors", "strength": 0.8}], [])
    assert len(saved) == 1
    assert [item["name"] for item in result["loras"]] == ["existing.safetensors", "new.safetensors"]
    assert result["scenes"]["s1"]["loras"][0]["name"] == "manual.safetensors"
    with pytest.raises(RuntimeError, match="changed"):
        updated("story-1", "old", [], [])
