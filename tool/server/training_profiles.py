"""App-owned training model profiles.

Profiles describe the small, safe surface WebCap needs to generate and launch
known Diffusion Pipe configurations.  They intentionally do not expose custom
commands or arbitrary user supplied profile files.
"""

from copy import deepcopy


WAN22_PROFILE_ID = "wan22_t2v"
KREA2_PROFILE_ID = "krea2_raw"
WAN21_PROFILE_ID = "wan21_t2v_14b"
MINIMAX_H3_PROFILE_ID = "minimax_h3"
TRAINING_MODES = ("poc", "normal", "quality")

_PROFILE_SLUGS = {
    WAN22_PROFILE_ID: "wan22",
    KREA2_PROFILE_ID: "krea2",
    WAN21_PROFILE_ID: "wan21",
    MINIMAX_H3_PROFILE_ID: "h3",
}


_PROFILES = {
    WAN22_PROFILE_ID: {
        "id": WAN22_PROFILE_ID,
        "label": "Wan2.2 T2V",
        "command": {"launcher": "standard_deepspeed"},
        "mediaKinds": ("image", "video"),
        "videoFps": 16,
        "datasetFiles": ("dataset.hi.toml", "dataset.lo.toml"),
        "configs": (
            {"id": "hi", "file": "config.hi.toml", "dataset": "dataset.hi.toml", "label": "Wan2.2 High Noise", "outputSlug": "wan22-hi", "modelIdentityKeys": ("type", "ckpt_path", "transformer_path")},
            {"id": "lo", "file": "config.lo.toml", "dataset": "dataset.lo.toml", "label": "Wan2.2 Low Noise", "outputSlug": "wan22-lo", "modelIdentityKeys": ("type", "ckpt_path", "transformer_path")},
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
        "videoFps": None,
        "datasetFiles": ("dataset.train.toml",),
        "configs": (
            {"id": "krea2", "file": "config.krea2.toml", "dataset": "dataset.train.toml", "label": "Krea2 Raw", "outputSlug": "krea2-raw", "modelIdentityKeys": ("type", "diffusion_model")},
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
        "videoFps": 16,
        "datasetFiles": ("dataset.train.toml",),
        "configs": (
            {"id": "wan21", "file": "config.wan21.toml", "dataset": "dataset.train.toml", "label": "Wan2.1 T2V 14B", "outputSlug": "wan21-t2v", "modelIdentityKeys": ("type", "ckpt_path")},
        ),
        "runs": (
            {"id": "train", "label": "Train", "stages": ("wan21",)},
        ),
    },
    MINIMAX_H3_PROFILE_ID: {
        "id": MINIMAX_H3_PROFILE_ID,
        "label": "MiniMax H3",
        "command": {"launcher": "standard_deepspeed"},
        "mediaKinds": ("image", "video"),
        "videoFps": 24,
        "videoCapturePolicy": "normalize_fps",
        "datasetFiles": ("dataset.train.toml",),
        "configs": (
            {"id": "h3", "file": "config.h3.toml", "dataset": "dataset.train.toml", "label": "MiniMax H3", "outputSlug": "minimax-h3", "modelIdentityKeys": ("type", "diffusion_model")},
        ),
        "runs": (
            {"id": "train", "label": "Train", "stages": ("h3",)},
        ),
    },
}

PROFILE_IDS = tuple(_PROFILES)

_LEGACY_STAGES = {
    "both": (WAN22_PROFILE_ID, "both"),
    "hi": (WAN22_PROFILE_ID, "hi"),
    "lo": (WAN22_PROFILE_ID, "lo"),
    "krea2": (KREA2_PROFILE_ID, "train"),
}


def normalize_mode(mode):
    value = str(mode or "normal").strip().lower()
    if value not in TRAINING_MODES:
        raise ValueError("Unknown training mode: " + str(mode or ""))
    return value


def profile_slug(profile_id):
    selected = profile(profile_id)
    return _PROFILE_SLUGS[selected["id"]]


def resolved_config(profile_id, config_id, mode="normal"):
    selected = profile(profile_id)
    selected_mode = normalize_mode(mode)
    base = None
    for item in selected["configs"]:
        if item["id"] == str(config_id or "").strip().lower():
            base = item
            break
    if base is None:
        raise ValueError("Unknown configuration stage for " + selected["label"] + ": " + str(config_id or ""))
    slug = profile_slug(profile_id)
    stage_suffix = "." + base["id"] if selected["id"] == WAN22_PROFILE_ID else ""
    resolved = deepcopy(base)
    resolved["legacyFile"] = base["file"]
    resolved["legacyDataset"] = base["dataset"]
    resolved["file"] = f"config.{slug}.{selected_mode}{stage_suffix}.toml"
    resolved["dataset"] = f"dataset.{slug}.{selected_mode}{stage_suffix}.toml"
    resolved["mode"] = selected_mode
    return resolved


def profile_for_mode(profile_id, mode="normal"):
    selected = deepcopy(profile(profile_id))
    selected_mode = normalize_mode(mode)
    selected["mode"] = selected_mode
    selected["slug"] = profile_slug(profile_id)
    selected["configs"] = tuple(
        resolved_config(profile_id, item["id"], selected_mode)
        for item in selected["configs"]
    )
    selected["datasetFiles"] = tuple(item["dataset"] for item in selected["configs"])
    return selected


def profiles():
    """Return JSON-safe profile metadata for the UI."""
    out = []
    for selected in _PROFILES.values():
        item = deepcopy(selected)
        item["slug"] = profile_slug(selected["id"])
        item["setups"] = {
            mode: {
                "configs": list(profile_for_mode(selected["id"], mode)["configs"]),
                "datasetFiles": list(profile_for_mode(selected["id"], mode)["datasetFiles"]),
            }
            for mode in TRAINING_MODES
        }
        out.append(item)
    return out


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


def config_for_stage(profile_id, stage, mode="normal"):
    return resolved_config(profile_id, stage, mode)


def config_for_id(config_id):
    """Return one supported model config by its globally unique id."""
    key = str(config_id or "").strip().lower()
    for selected in _PROFILES.values():
        for config in selected["configs"]:
            if config["id"] == key:
                return config
    raise ValueError("Unknown training configuration: " + str(config_id or ""))


def profile_config_files(profile_id, mode="normal"):
    return tuple(config["file"] for config in profile_for_mode(profile_id, mode)["configs"])


def profile_dataset_files(profile_id, mode="normal"):
    return tuple(profile_for_mode(profile_id, mode)["datasetFiles"])


def legacy_stage_for(profile_id, run_id):
    """The existing runner stores one stage string per managed job."""
    selected = run(profile_id, run_id)
    stages = selected["stages"]
    if tuple(stages) == ("hi", "lo"):
        return "both"
    return stages[0]
