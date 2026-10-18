from pathlib import Path

import pytest

from tool.server import media_explorer


def _media(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"sample")


def test_discovery_includes_saved_references_and_deduplicates_usage(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    _media(tmp_path / "generations/day/job/result.png")
    _media(tmp_path / "generations/day/job/references/style.png")
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: [{
        "storageId": "day/job", "createdAt": 100, "mediaPath": "generations/day/job/result.png",
        "modelId": "krea2", "rating": 4,
        "references": {"style": "generations/day/job/references/style.png",
                       "mood": "generations/day/job/references/style.png"},
    }])
    result = media_explorer.list_media()
    assert result["total"] == 2
    assert {item["role"] for item in result["items"]} == {"generated", "reference"}
    reference = next(item for item in result["items"] if item["role"] == "reference")
    assert len(reference["uses"]) == 2
    assert reference["rating"] is None


def test_sort_occurs_before_paging(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    records = []
    for name, rating, created in (("z", 1, 100), ("a", 5, 200), ("m", 3, 300)):
        path = f"generations/day/{name}/result.png"
        _media(tmp_path / path)
        records.append({"storageId": "day/" + name, "createdAt": created,
                        "mediaPath": path, "rating": rating})
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: records)
    page = media_explorer.list_media(limit=1, offset=1, sort="rating")
    assert page["total"] == 3
    assert page["items"][0]["storageId"] == "day/m"
    named = media_explorer.list_media(limit=2, sort="name")
    assert len(named["items"]) == 2
    with pytest.raises(ValueError, match="sort"):
        media_explorer.list_media(sort="unsupported")


def test_missing_media_not_listed_and_outside_root_not_served(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    outside = tmp_path.parent / "outside-media-test.png"
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: [
        {"storageId": "one", "createdAt": 1, "mediaPath": "../outside-media-test.png"},
        {"storageId": "two", "createdAt": 2, "mediaPath": "generations/missing.png"},
    ])
    assert media_explorer.list_media()["total"] == 0


def test_explicit_full_scan_has_complete_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    seen = []
    def records(limit):
        seen.append(limit)
        return []
    monkeypatch.setattr(media_explorer, "list_results", records)
    recent = media_explorer.list_media()
    complete = media_explorer.list_media(full="1")
    assert seen == [500, None]
    assert recent["complete"] is False
    assert complete["complete"] is True
    assert "all results" in complete["scope"]


def test_test_session_discovery_uses_owner_media_route(monkeypatch, tmp_path):
    import json
    root = tmp_path / "output"
    session = root / "test-generations" / "sets" / "demo" / "sessions" / "one"
    session.mkdir(parents=True)
    (session / "frame.png").write_bytes(b"img")
    (session / "test.json").write_text(json.dumps({
        "ownerFolder": "sets/demo", "modelId": "krea2",
        "startedAt": 100, "results": [{"mediaFile": "frame.png"}]
    }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: root)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: session if name == "one" else None)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {"frame.png": 5})
    result = media_explorer.list_media(source="test")
    assert result["total"] == 1
    item = result["items"][0]
    assert item["source"] == "test"
    assert item["rating"] == 5
    assert "/fs/test_generations/media?" in item["mediaUrl"]
    assert "folder=sets%2Fdemo" in item["mediaUrl"]


def test_legacy_session_discovered_for_known_owner(monkeypatch, tmp_path):
    import json
    output = tmp_path / "output"
    central = output / "test-generations" / "central"
    legacy = tmp_path / "sets" / "demo" / "test-generations" / "legacy"
    for session in (central, legacy):
        session.mkdir(parents=True)
        (session / "result.png").write_bytes(b"x")
        (session / "test.json").write_text(json.dumps({
            "ownerFolder": "sets/demo", "startedAt": 100,
            "results": [{"mediaFile": "result.png"}],
        }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: output)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: central if name == "central" else legacy)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {})
    found = media_explorer.list_media(source="test")
    assert found["total"] == 2
    assert any("sets/demo/test-generations/legacy/result.png" in item["id"]
               for item in found["items"])


def test_full_scan_finds_legacy_only_set_without_owner_field(monkeypatch, tmp_path):
    import json
    output = tmp_path / "output"
    output.mkdir()
    legacy = tmp_path / "sets" / "only-legacy" / "test-generations" / "session-1"
    legacy.mkdir(parents=True)
    (legacy / "render.png").write_bytes(b"img")
    (legacy / "test.json").write_text(json.dumps({
        "startedAt": 42, "results": [{"mediaFile": "render.png"}]
    }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: output)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: legacy if str(owner).endswith("only-legacy") else None)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {})
    assert media_explorer.list_media(source="test")["total"] == 0
    full = media_explorer.list_media(source="test", full="1")
    assert full["total"] == 1
    assert full["items"][0]["ownerFolder"] == "sets/only-legacy"
