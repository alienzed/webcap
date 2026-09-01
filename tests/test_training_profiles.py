from tool.server.training_profiles import (
    KREA2_PROFILE_ID,
    MINIMAX_H3_PROFILE_ID,
    WAN21_PROFILE_ID,
    WAN22_PROFILE_ID,
    profile,
    profile_run,
)


def test_training_profiles_expose_only_their_valid_runs_and_artifacts():
    wan22 = profile(WAN22_PROFILE_ID)
    assert [item["id"] for item in wan22["runs"]] == ["hi", "lo"]
    assert wan22["videoFps"] == 16
    assert set(wan22["datasetFiles"]) == {"dataset.hi.toml", "dataset.lo.toml"}
    assert tuple(wan22["configs"][0]["modelIdentityKeys"]) == ("type", "ckpt_path", "transformer_path")

    krea = profile(KREA2_PROFILE_ID)
    assert tuple(krea["mediaKinds"]) == ("image",)
    assert krea["videoFps"] is None
    assert krea["configs"][0]["file"] == "config.krea2.toml"
    assert tuple(krea["datasetFiles"]) == ("dataset.train.toml",)
    assert tuple(krea["configs"][0]["modelIdentityKeys"]) == ("type", "diffusion_model")

    wan21 = profile(WAN21_PROFILE_ID)
    assert wan21["configs"][0]["file"] == "config.wan21.toml"
    assert wan21["videoFps"] == 16
    assert tuple(profile_run(WAN21_PROFILE_ID, "train")[1]["stages"]) == ("wan21",)
    assert tuple(wan21["configs"][0]["modelIdentityKeys"]) == ("type", "ckpt_path")

    h3 = profile(MINIMAX_H3_PROFILE_ID)
    assert tuple(h3["mediaKinds"]) == ("image", "video")
    assert h3["videoFps"] == 24
    assert h3["configs"][0]["file"] == "config.h3.toml"
    assert tuple(h3["datasetFiles"]) == ("dataset.train.toml",)
    assert tuple(profile_run(MINIMAX_H3_PROFILE_ID, "train")[1]["stages"]) == ("h3",)
    assert tuple(h3["configs"][0]["modelIdentityKeys"]) == ("type", "diffusion_model")
