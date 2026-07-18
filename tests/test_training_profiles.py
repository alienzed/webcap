from tool.server.training_profiles import KREA2_PROFILE_ID, WAN21_PROFILE_ID, WAN22_PROFILE_ID, profile, profile_run


def test_training_profiles_expose_only_their_valid_runs_and_artifacts():
    wan22 = profile(WAN22_PROFILE_ID)
    assert [item["id"] for item in wan22["runs"]] == ["both", "hi", "lo"]
    assert set(wan22["datasetFiles"]) == {"dataset.hi.toml", "dataset.lo.toml"}

    krea = profile(KREA2_PROFILE_ID)
    assert tuple(krea["mediaKinds"]) == ("image",)
    assert krea["configs"][0]["file"] == "config.krea2.toml"
    assert tuple(krea["datasetFiles"]) == ("dataset.train.toml",)

    wan21 = profile(WAN21_PROFILE_ID)
    assert wan21["configs"][0]["file"] == "config.wan21.toml"
    assert tuple(profile_run(WAN21_PROFILE_ID, "train")[1]["stages"]) == ("wan21",)
