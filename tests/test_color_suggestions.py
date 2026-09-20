import json

from PIL import Image

import tool.server.app as app_module
import tool.server.color_suggestions as color_module
import tool.server.media as media_module


def test_solid_red_image_produces_red_suggestion(tmp_path):
    path = tmp_path / "red.png"
    Image.new("RGB", (96, 96), (220, 35, 35)).save(path)

    payload = color_module.analyze_image_color_suggestions(path)

    assert payload["version"] == color_module.COLOR_SUGGESTIONS_VERSION
    assert payload["method"] == color_module.COLOR_SUGGESTIONS_METHOD
    assert payload["suggestions"]
    assert payload["suggestions"][0]["name"] == "red"
    assert payload["suggestions"][0]["share"] > 0.9


def test_skin_like_beige_is_downweighted_not_removed(tmp_path):
    path = tmp_path / "beige.png"
    Image.new("RGB", (96, 96), (210, 190, 160)).save(path)

    payload = color_module.analyze_image_color_suggestions(path)
    names = {entry["name"] for entry in payload["suggestions"]}

    assert payload["downweighted_skin_pixels"] > 0
    assert names & {"beige", "tan", "brown"}


def test_color_suggestions_route_caches_in_media_metadata(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    folder.mkdir(parents=True)
    Image.new("RGB", (80, 80), (30, 80, 190)).save(folder / "blue.png")

    monkeypatch.setattr(media_module, "safe_join_fs_root", lambda rel: root / rel)
    calls = []
    real_analyze = media_module.analyze_image_color_suggestions

    def counted(path):
        calls.append(path.name)
        return real_analyze(path)

    monkeypatch.setattr(media_module, "analyze_image_color_suggestions", counted)
    client = app_module.app.test_client()

    first = client.get("/fs/color_suggestions?folder=set&file=blue.png")
    second = client.get("/fs/color_suggestions?folder=set&file=blue.png")

    assert first.status_code == 200
    assert second.status_code == 200
    assert calls == ["blue.png"]
    assert first.get_json()["suggestions"][0]["name"] == "blue"

    metadata = json.loads((folder / "media_metadata.json").read_text(encoding="utf-8"))
    assert metadata["blue.png"]["color_suggestions"]["version"] == color_module.COLOR_SUGGESTIONS_VERSION


def test_media_metadata_exposes_cached_color_suggestions(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    folder.mkdir(parents=True)
    Image.new("RGB", (80, 80), (220, 35, 35)).save(folder / "red.png")

    monkeypatch.setattr(media_module, "safe_join_fs_root", lambda rel: root / rel)
    client = app_module.app.test_client()

    assert client.get("/fs/color_suggestions?folder=set&file=red.png").status_code == 200
    response = client.get("/fs/media_metadata?folder=set")
    row = next(entry for entry in response.get_json() if entry["file"] == "red.png")

    assert row["color_suggestions"]["version"] == color_module.COLOR_SUGGESTIONS_VERSION
    assert row["color_suggestions"]["suggestions"][0]["name"] == "red"


def test_color_suggestions_route_rejects_nested_file_paths(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(media_module, "safe_join_fs_root", lambda rel: root / rel)

    client = app_module.app.test_client()
    response = client.get("/fs/color_suggestions?folder=set&file=../outside.png")

    assert response.status_code == 400
