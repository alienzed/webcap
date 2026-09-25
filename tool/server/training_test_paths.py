from pathlib import Path, PurePosixPath

from . import config as app_config
from .training_history import host_path_for_training_path


TEST_COPY_STAGE_LABELS = {
    "h3": "H3",
    "krea2": "Krea 2",
    "wan21": "Wan 2.1",
    "hi": "Wan 2.2 High",
    "lo": "Wan 2.2 Low",
}


def _configured_test_root(stage):
    selected_stage = str(stage or "").strip().lower()
    if selected_stage not in TEST_COPY_STAGE_LABELS:
        raise ValueError("No supported Copy to Test model stage was provided.")

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
    return Path(host_path_for_training_path(root_text)), str(training.get("test_copy_subfolder") or "").strip()


def test_source_root(stage):
    """Return the configured browsable Test LoRA root for a model stage."""
    root, _subfolder = _configured_test_root(stage)
    return root


def test_source_for_set(stage, set_name):
    """Return the Copy to Test destination for a Set, relative to the browsable Test root."""
    selected_set_name = str(set_name or "").strip()
    if not selected_set_name or selected_set_name in (".", ".."):
        raise ValueError("The current set has no usable folder name.")
    _root, subfolder = _configured_test_root(stage)
    parts = ([subfolder] if subfolder else []) + [selected_set_name]
    return PurePosixPath(*parts).as_posix()


def test_source_path(stage, relative_path=""):
    """Resolve a Test Source beneath the configured model-specific Test root."""
    root = test_source_root(stage).resolve()
    raw = str(relative_path or "").strip().replace("\\", "/").strip("/")
    relative = PurePosixPath(raw)
    if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
        if raw:
            raise ValueError("Test Source must stay inside the configured Test LoRA root.")
        relative = PurePosixPath()

    candidate = root.joinpath(*relative.parts).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Test Source escaped the configured Test LoRA root.") from exc
    if candidate.is_symlink():
        raise ValueError("Test Source folders cannot be symlinks.")
    return candidate


def browse_test_source(stage, relative_path=""):
    """Return one shallow folder level plus directly testable LoRAs."""
    root = test_source_root(stage).resolve()
    directory = test_source_path(stage, relative_path)
    if not directory.is_dir():
        raise FileNotFoundError("Test Source folder does not exist: " + str(directory))

    folders = []
    files = []
    for entry in directory.iterdir():
        if entry.is_symlink():
            continue
        if entry.is_dir():
            folders.append(entry.name)
        elif entry.is_file() and entry.suffix.lower() == ".safetensors":
            files.append(entry.name)

    source = "" if directory == root else directory.relative_to(root).as_posix()
    parent = ""
    if source:
        parent_path = PurePosixPath(source).parent
        parent = "" if str(parent_path) == "." else parent_path.as_posix()
    return {
        "source": source,
        "parent": parent,
        "folders": sorted(folders, key=str.lower),
        "files": sorted(files, key=str.lower),
        "count": len(files),
    }


def test_copy_destination(stage, set_name):
    """Return the configured Copy to Test root and relative destination parts."""
    selected_stage = str(stage or "").strip().lower()
    if selected_stage not in TEST_COPY_STAGE_LABELS:
        raise ValueError("No supported Copy to Test model stage was provided.")

    selected_set_name = str(set_name or "").strip()
    if not selected_set_name or selected_set_name in (".", ".."):
        raise ValueError("The current set has no usable folder name.")

    root, subfolder = _configured_test_root(selected_stage)
    parts = ([subfolder] if subfolder else []) + [selected_set_name]
    return root, parts


def test_copy_path(stage, set_name):
    root, parts = test_copy_destination(stage, set_name)
    return root.joinpath(*parts)
