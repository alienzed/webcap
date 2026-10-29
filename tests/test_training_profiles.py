import pytest

from tool.server.training_profiles import (
    KREA2_PROFILE_ID,
    MINIMAX_H3_PROFILE_ID,
    WAN21_PROFILE_ID,
    WAN22_PROFILE_ID,
    profile,
    profile_run,
    profiles,
)


def test_training_profiles_expose_only_their_valid_runs_and_artifacts():
    wan22 = profile(WAN22_PROFILE_ID)
    assert [item["id"] for item in wan22["runs"]] == ["hi", "lo"]
    assert wan22["videoFps"] == 16
    assert set(wan22["datasetFiles"]) == {"dataset.hi.toml", "dataset.lo.toml"}
    assert tuple(wan22["configs"][0]["modelIdentityKeys"]) == ("type", "ckpt_path", "transformer_path")
    assert tuple(profile_run(WAN22_PROFILE_ID, "hi")[1]["stages"]) == ("hi",)
    assert tuple(profile_run(WAN22_PROFILE_ID, "lo")[1]["stages"]) == ("lo",)
    with pytest.raises(ValueError, match="Unknown run option"):
        profile_run(WAN22_PROFILE_ID, "both")

    krea = profile(KREA2_PROFILE_ID)
    assert tuple(krea["mediaKinds"]) == ("image",)
    assert krea["videoFps"] is None
    assert krea["configs"][0]["file"] == "config.krea2.toml"
    assert tuple(krea["datasetFiles"]) == ("dataset.krea2.toml",)
    assert tuple(krea["configs"][0]["modelIdentityKeys"]) == ("type", "diffusion_model")

    wan21 = profile(WAN21_PROFILE_ID)
    assert wan21["configs"][0]["file"] == "config.wan21.toml"
    assert wan21["videoFps"] == 16
    assert tuple(wan21["datasetFiles"]) == ("dataset.wan21.toml",)
    assert tuple(profile_run(WAN21_PROFILE_ID, "train")[1]["stages"]) == ("wan21",)
    assert tuple(wan21["configs"][0]["modelIdentityKeys"]) == ("type", "ckpt_path")

    h3 = profile(MINIMAX_H3_PROFILE_ID)
    assert tuple(h3["mediaKinds"]) == ("image", "video")
    assert h3["videoFps"] == 24
    assert h3["configs"][0]["file"] == "config.h3.toml"
    assert tuple(h3["datasetFiles"]) == ("dataset.h3.toml",)
    assert tuple(profile_run(MINIMAX_H3_PROFILE_ID, "train")[1]["stages"]) == ("h3",)
    assert tuple(h3["configs"][0]["modelIdentityKeys"]) == ("type", "diffusion_model")


def test_training_profiles_have_no_setup_mode_layer():
    for item in profiles():
        assert "mode" not in item
        assert "setups" not in item
        assert isinstance(item["configs"], list)
        assert isinstance(item["datasetFiles"], list)


def test_krea2_video_only_setup_is_visible_but_not_trainable(tmp_path, monkeypatch):
    from tool.server import training_setup

    folder = tmp_path / "video_set"
    folder.mkdir()
    (folder / "clip.mp4").write_bytes(b"video")

    def create_config(path, profile_id):
        (path / "config.krea2.toml").write_text("[model]\\ntype = 'krea2'\\n", encoding="utf-8")

    monkeypatch.setattr(training_setup, "ensure_training_config_files", create_config)
    payload = training_setup.ensure_training_setup(
        folder, KREA2_PROFILE_ID, selected_media=["clip.mp4"], allow_incompatible=True
    )
    assert payload["ready"] is False
    assert "images only" in payload["reason"]
    assert (folder / "config.krea2.toml").exists()
    assert not (folder / "dataset.krea2.toml").exists()

    with pytest.raises(ValueError, match="requires at least one prepared image"):
        training_setup.ensure_training_setup(
            folder, KREA2_PROFILE_ID, selected_media=["clip.mp4"]
        )
