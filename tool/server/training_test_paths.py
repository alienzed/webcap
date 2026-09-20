from pathlib import Path

from . import config as app_config
from .training_history import host_path_for_training_path


TEST_COPY_STAGE_LABELS = {
    "h3": "H3",
    "krea2": "Krea 2",
    "wan21": "Wan 2.1",
    "hi": "Wan 2.2 High",
    "lo": "Wan 2.2 Low",
}


def test_copy_destination(stage, set_name):
    """Return the configured Copy to Test root and relative destination parts."""
    selected_stage = str(stage or "").strip().lower()
    if selected_stage not in TEST_COPY_STAGE_LABELS:
        raise ValueError("No supported Copy to Test model stage was provided.")

    selected_set_name = str(set_name or "").strip()
    if not selected_set_name or selected_set_name in (".", ".."):
        raise ValueError("The current set has no usable folder name.")

    saved_config = app_config.load_config_from_disk()
    training = saved_config.get("training") if isinstance(saved_config.get("training"), dict) else {}
    roots = training.get("test_copy_roots") if isinstance(training.get("test_copy_roots"), dict) else {}
    root_text = str(roots.get(selected_stage) or "").strip()
    if not root_text:
        raise ValueError(
            "Configure the Copy to Test "
            + TEST_COPY_STAGE_LABELS[selected_stage]
            + " root in Training Settings."
        )

    root = Path(host_path_for_training_path(root_text))
    subfolder = str(training.get("test_copy_subfolder") or "").strip()
    parts = ([subfolder] if subfolder else []) + [selected_set_name]
    return root, parts


def test_copy_path(stage, set_name):
    root, parts = test_copy_destination(stage, set_name)
    return root.joinpath(*parts)
