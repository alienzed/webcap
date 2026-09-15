import tool.server.app as app_module
import tool.server.duplicate_candidates as duplicate_module


def _touch(folder, name, content=b"media"):
    path = folder / name
    path.write_bytes(content)
    return path


def _meta(sha, dhash="0000000000000000", resolution="100x100", **extra):
    return {
        "resolution": resolution,
        "size": 100,
        "visual_hash": {
            "version": 1,
            "sha256": sha,
            "dhash": dhash,
            "bits": 64,
        },
        **extra,
    }


def test_exact_groups_unrelated_filenames(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    _touch(folder, "alpha.png")
    _touch(folder, "final.png")
    payload = duplicate_module.build_duplicate_candidates(folder, {
        "alpha.png": _meta("same"),
        "final.png": _meta("same"),
    })

    assert payload["group_count"] == 1
    assert payload["groups"][0]["match_type"] == "exact"
    assert [item["file"] for item in payload["groups"][0]["items"]] == ["alpha.png", "final.png"]
    assert "sha256" not in payload["groups"][0]["items"][0]


def test_exact_video_group_keeps_video_metadata(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    _touch(folder, "clip.mp4")
    _touch(folder, "export.mp4")
    payload = duplicate_module.build_duplicate_candidates(folder, {
        "clip.mp4": _meta("same-video", duration=8.4, fps=24.0),
        "export.mp4": _meta("same-video", duration=8.4, fps=24.0),
    })

    item = payload["groups"][0]["items"][0]
    assert payload["groups"][0]["match_type"] == "exact"
    assert item["kind"] == "video"
    assert item["duration"] == 8.4
    assert item["fps"] == 24.0


def test_fuzzy_groups_are_kind_and_aspect_conservative(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ["a.png", "b.png", "video.mp4", "wide.png"]:
        _touch(folder, name)
    payload = duplicate_module.build_duplicate_candidates(folder, {
        "a.png": _meta("a", "0000000000000000"),
        "b.png": _meta("b", "000000000000003f"),
        "video.mp4": _meta("c", "000000000000003f", duration=2.0, fps=24.0),
        "wide.png": _meta("d", "000000000000003f", resolution="200x100"),
    })

    assert payload["group_count"] == 1
    assert payload["groups"][0]["match_type"] == "similar"
    assert [item["file"] for item in payload["groups"][0]["items"]] == ["a.png", "b.png"]


def test_complete_link_grouping_does_not_join_a_b_c_chain(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ["a.png", "b.png", "c.png"]:
        _touch(folder, name)
    payload = duplicate_module.build_duplicate_candidates(folder, {
        "a.png": _meta("a", "0000000000000000"),
        "b.png": _meta("b", "000000000000003f"),
        "c.png": _meta("c", "0000000000000fff"),
    })

    assert payload["group_count"] == 1
    assert [item["file"] for item in payload["groups"][0]["items"]] == ["a.png", "b.png"]


def test_exact_pair_can_join_a_coherent_fuzzy_member(tmp_path):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ["a.png", "b.png", "edited.png"]:
        _touch(folder, name)
    payload = duplicate_module.build_duplicate_candidates(folder, {
        "a.png": _meta("same", "0000000000000000"),
        "b.png": _meta("same", "0000000000000000"),
        "edited.png": _meta("other", "000000000000003f"),
    })

    assert payload["groups"][0]["match_type"] == "similar"
    assert [item["file"] for item in payload["groups"][0]["items"]] == ["a.png", "b.png", "edited.png"]


def test_route_respects_scope_and_empty_selection(tmp_path, monkeypatch):
    root = tmp_path / "root"
    folder = root / "set"
    folder.mkdir(parents=True)
    _touch(folder, "visible.png")
    _touch(folder, "hidden.png")
    monkeypatch.setattr(duplicate_module.app_config, "FS_ROOT", root)
    calls = []

    def metadata_for_scope(*_args, **kwargs):
        calls.append(kwargs.get("scoped_filenames"))
        return {
            "visible.png": _meta("visible"),
            "hidden.png": _meta("hidden"),
        }

    monkeypatch.setattr(duplicate_module, "update_media_metadata", metadata_for_scope)
    client = app_module.app.test_client()
    response = client.post("/fs/duplicate_candidates", json={"folder": "set", "selected_media": ["visible.png"]})
    empty_response = client.post("/fs/duplicate_candidates", json={"folder": "set", "selected_media": []})

    assert response.status_code == 200
    assert response.get_json()["population_count"] == 1
    assert response.get_json()["group_count"] == 0
    assert calls == [["visible.png"]]
    assert empty_response.status_code == 200
    assert empty_response.get_json()["population_count"] == 0


def test_route_rejects_missing_folder_and_bad_scope():
    client = app_module.app.test_client()
    assert client.post("/fs/duplicate_candidates", json={}).status_code == 400
    assert client.post("/fs/duplicate_candidates", json={"folder": "set", "selected_media": "bad"}).status_code == 400
