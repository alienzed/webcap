"""App-owned training model profiles.

Profiles describe the small, safe surface WebCap needs to generate and launch
known Diffusion Pipe configurations.  They intentionally do not expose custom
commands or arbitrary user supplied profile files.
"""

from copy import deepcopy


WAN22_PROFILE_ID = "wan22_t2v"
KREA2_PROFILE_ID = "krea2_raw"
WAN21_PROFILE_ID = "wan21_t2v_14b"


_PROFILES = {
    WAN22_PROFILE_ID: {
        "id": WAN22_PROFILE_ID,
        "label": "Wan2.2 T2V",
        "command": {"launcher": "standard_deepspeed"},
        "mediaKinds": ("image", "video"),
        "datasetFiles": ("dataset.hi.toml", "dataset.lo.toml"),
        "configs": (
            {"id": "hi", "file": "config.hi.toml", "dataset": "dataset.hi.toml", "label": "High Noise", "outputSlug": "wan22-hi"},
            {"id": "lo", "file": "config.lo.toml", "dataset": "dataset.lo.toml", "label": "Low Noise", "outputSlug": "wan22-lo"},
        ),
        "runs": (
            {"id": "both", "label": "HI → LO", "stages": ("hi", "lo")},
            {"id": "hi", "label": "HI only", "stages": ("hi",)},
            {"id": "lo", "label": "LO only", "stages": ("lo",)},
        ),
    },
    KREA2_PROFILE_ID: {
        "id": KREA2_PROFILE_ID,
        "label": "Krea2 Raw",
        "command": {"launcher": "standard_deepspeed"},
        "mediaKinds": ("image",),
        "datasetFiles": ("dataset.train.toml",),
        "configs": (
            {"id": "krea2", "file": "config.krea2.toml", "dataset": "dataset.train.toml", "label": "Krea2 Raw", "outputSlug": "krea2-raw"},
        ),
        "runs": (
            {"id": "train", "label": "Train", "stages": ("krea2",)},
        ),
    },
    WAN21_PROFILE_ID: {
        "id": WAN21_PROFILE_ID,
        "label": "Wan2.1 T2V 14B",
        "command": {"launcher": "standard_deepspeed"},
        "mediaKinds": ("image", "video"),
        "datasetFiles": ("dataset.train.toml",),
        "configs": (
            {"id": "wan21", "file": "config.wan21.toml", "dataset": "dataset.train.toml", "label": "Wan2.1 T2V 14B", "outputSlug": "wan21-t2v"},
        ),
        "runs": (
            {"id": "train", "label": "Train", "stages": ("wan21",)},
        ),
    },
}

_LEGACY_STAGES = {
    "both": (WAN22_PROFILE_ID, "both"),
    "hi": (WAN22_PROFILE_ID, "hi"),
    "lo": (WAN22_PROFILE_ID, "lo"),
    "krea2": (KREA2_PROFILE_ID, "train"),
}


def profiles():
    """Return JSON-safe profile metadata for the UI."""
    return [deepcopy(profile) for profile in _PROFILES.values()]


def profile(profile_id):
    key = str(profile_id or "").strip().lower()
    if key not in _PROFILES:
        raise ValueError("Unknown training profile: " + str(profile_id or ""))
    return _PROFILES[key]


def run(profile_id, run_id):
    selected = profile(profile_id)
    key = str(run_id or "").strip().lower()
    for item in selected["runs"]:
        if item["id"] == key:
            return item
    raise ValueError("Unknown run option for " + selected["label"] + ": " + str(run_id or ""))


def profile_run(profile_id=None, run_id=None, stages=None):
    """Resolve new profile/run input or one of the retained legacy stages."""
    if profile_id:
        selected = profile(profile_id)
        selected_run = run(profile_id, run_id or selected["runs"][0]["id"])
        return selected, selected_run
    legacy = str(stages or "both").strip().lower()
    if legacy not in _LEGACY_STAGES:
        raise ValueError("Training stage must be hi, lo, both, or krea2.")
    mapped_profile, mapped_run = _LEGACY_STAGES[legacy]
    return profile(mapped_profile), run(mapped_profile, mapped_run)


def config_for_stage(profile_id, stage):
    selected = profile(profile_id)
    key = str(stage or "").strip().lower()
    for config in selected["configs"]:
        if config["id"] == key:
            return config
    raise ValueError("Unknown configuration stage for " + selected["label"] + ": " + str(stage or ""))


def profile_config_files(profile_id):
    return tuple(config["file"] for config in profile(profile_id)["configs"])


def profile_dataset_files(profile_id):
    return tuple(profile(profile_id)["datasetFiles"])


def legacy_stage_for(profile_id, run_id):
    """The existing runner stores one stage string per managed job."""
    selected = run(profile_id, run_id)
    stages = selected["stages"]
    if tuple(stages) == ("hi", "lo"):
        return "both"
    return stages[0]
