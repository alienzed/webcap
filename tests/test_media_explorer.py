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
