from pathlib import Path
import tomllib

from .dataset_config import build_dataset_config_artifacts
from .dataset_prep import build_dataset_manifest
from .training_config_files import ensure_training_config_files, reset_training_config_file
from .training_profiles import WAN22_PROFILE_ID, config_for_stage, normalize_mode, profile_for_mode


DATASET_ROOT_PLACEHOLDER = Path("__WEBCAP_DATASET_ROOT__")


def resolved_setup(profile_id, mode):
    return profile_for_mode(profile_id, normalize_mode(mode))


def setup_file_names(profile_id, mode):
    selected = resolved_setup(profile_id, mode)
    return tuple(
        [item["file"] for item in selected["configs"]]
        + [item["dataset"] for item in selected["configs"]]
    )


def ensure_training_setup(
    folder_path,
    profile_id,
    mode,
    selected_media=None,
    selection_criteria=None,
    total_media_count=None,
    reset_file="",
):
    folder = Path(folder_path)
    selected = resolved_setup(profile_id, mode)
    selected_mode = selected["mode"]
    reset_name = str(reset_file or "").strip()
    known_configs = {item["file"] for item in selected["configs"]}
    known_datasets = {item["dataset"] for item in selected["configs"]}
    if reset_name and reset_name not in known_configs | known_datasets:
        raise ValueError("File does not belong to the selected training setup: " + reset_name)

    ensure_training_config_files(folder, profile_id=selected["id"], mode=selected_mode)
    for item in selected["configs"]:
        dataset_path = folder / item["dataset"]
        if dataset_path.exists() and dataset_path.name != reset_name:
            tomllib.loads(dataset_path.read_text(encoding="utf-8"))
    if reset_name in known_configs:
        reset_training_config_file(
            folder,
            reset_name,
            profile_id=selected["id"],
            mode=selected_mode,
        )

    missing_datasets = [item for item in selected["configs"] if not (folder / item["dataset"]).is_file()]
    reset_dataset = next((item for item in selected["configs"] if item["dataset"] == reset_name), None)
    targets = list(missing_datasets)
    if reset_dataset is not None and reset_dataset not in targets:
        targets.append(reset_dataset)
    if targets:
        manifest = build_dataset_manifest(
            folder,
            selected_media=selected_media,
            selection_criteria=selection_criteria,
            total_media_count=total_media_count,
        )
        config_paths = {
            item["id"]: folder / item["file"]
            for item in selected["configs"]
        }
        artifacts = build_dataset_config_artifacts(
            folder,
            manifest,
            DATASET_ROOT_PLACEHOLDER,
            profile_id=selected["id"],
            config_paths=config_paths,
        )
        for item in targets:
            text = artifacts["hiText"] if selected["id"] == WAN22_PROFILE_ID and item["id"] == "hi" else artifacts["loText"]
            destination = folder / item["dataset"]
            destination.write_text(text, encoding="utf-8")

    return {
        "profileId": selected["id"],
        "mode": selected_mode,
        "files": list(setup_file_names(selected["id"], selected_mode)),
    }
