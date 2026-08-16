import json
import re
import shutil
import uuid
from pathlib import Path

from .dataset_config import build_dataset_config_artifacts
from .dataset_prep import (
    build_dataset_manifest,
    normalize_fallback_captions,
    resolve_prepared_caption_text,
    write_prepared_caption,
)
from .permissions import normalize_path_permissions
from .training_config_files import with_dataset_path, with_output_dir
from .training_profiles import config_for_stage, normalize_mode, profile_for_mode, profile_slug
from .training_runtime import to_wsl_path


_DIRECTORY_PATH_PATTERN = re.compile(
    r'^(\s*path\s*=\s*)["\']([^"\']+)["\'](\s*(?:#.*)?)$',
    re.MULTILINE,
)


def _rewrite_dataset_directories(text, media_root, distribution):
    count = 0

    def replace(match):
        nonlocal count
        directory_name = Path(match.group(2).replace("\\", "/")).name
        if not directory_name:
            raise ValueError("Dataset TOML contains an empty directory path.")
        target = to_wsl_path(Path(media_root) / directory_name, distribution)
        count += 1
        return match.group(1) + '"' + target + '"' + match.group(3)

    updated = _DIRECTORY_PATH_PATTERN.sub(replace, text)
    if count < 1:
        raise ValueError("Dataset TOML is missing directory paths.")
    return updated


def _selected_stages(profile, stages):
    value = str(stages or "both").strip().lower()
    if value == "both":
        return ("hi", "lo")
    available = {item["id"] for item in profile["configs"]}
    if value not in available:
        raise ValueError("Training stage does not belong to the selected profile: " + value)
    return (value,)


def materialize_training_bundle(
    folder_path,
    group_root,
    profile_id,
    mode,
    stages,
    selected_media,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
    output_dirs=None,
    distribution="",
    bundle_parent="datasets",
):
    folder = Path(folder_path)
    group = Path(group_root)
    selected_mode = normalize_mode(mode)
    selected_profile = profile_for_mode(profile_id, selected_mode)
    stage_names = _selected_stages(selected_profile, stages)
    output_dirs = dict(output_dirs or {})
    manifest = build_dataset_manifest(
        folder,
        selected_media=selected_media,
        selection_criteria=selection_criteria,
        total_media_count=total_media_count,
    )
    bundle_name = profile_slug(profile_id) + "-" + selected_mode + "-" + uuid.uuid4().hex[:12]
    bundle = group / ".webcap" / bundle_parent / bundle_name
    configs_root = bundle / "configs"
    media_root = bundle / "media"
    configs_root.mkdir(parents=True, exist_ok=False)
    media_root.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(bundle)
    normalize_path_permissions(configs_root)
    normalize_path_permissions(media_root)

    fallback_by_name = normalize_fallback_captions(fallback_captions)
    copied_rows = []
    for kind in ("images", "videos"):
        for row in manifest.get(kind, []):
            source = folder / str(row["file"])
            destination = media_root / str(row["prepared_path"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            normalize_path_permissions(destination.parent)
            shutil.copy2(source, destination)
            normalize_path_permissions(destination)
            caption_text, used_fallback = resolve_prepared_caption_text(source, fallback_by_name)
            if not caption_text:
                raise RuntimeError("Train requires captions or primer fallbacks for: " + source.name)
            write_prepared_caption(source, destination.parent, caption_text)
            row["caption"] = True
            row["fallback_caption"] = bool(used_fallback)
            copied_rows.append(row)

    resolved = {
        item["id"]: item
        for item in selected_profile["configs"]
        if item["id"] in stage_names
    }
    bundle_artifacts = {}
    config_paths = {}
    for stage in stage_names:
        item = resolved[stage]
        source_dataset = folder / item["dataset"]
        source_config = folder / item["file"]
        if not source_dataset.is_file() or not source_config.is_file():
            raise FileNotFoundError("Missing inspected training TOML for " + stage + ".")
        dataset_target = configs_root / item["dataset"]
        dataset_target.write_text(
            _rewrite_dataset_directories(source_dataset.read_text(encoding="utf-8"), media_root, distribution),
            encoding="utf-8",
        )
        normalize_path_permissions(dataset_target)
        dataset_wsl = to_wsl_path(dataset_target, distribution)
        output_dir = str(output_dirs.get(stage) or "").strip()
        if not output_dir:
            raise ValueError("Missing effective output directory for " + stage + ".")
        config_text = source_config.read_text(encoding="utf-8")
        config_text = with_dataset_path(config_text, dataset_wsl)
        config_text = with_output_dir(config_text, output_dir)
        config_target = configs_root / item["file"]
        config_target.write_text(config_text, encoding="utf-8")
        normalize_path_permissions(config_target)
        bundle_artifacts[stage + "Config"] = config_target
        bundle_artifacts[stage + "Dataset"] = dataset_target
        config_paths[stage] = source_config

    plan_artifacts = build_dataset_config_artifacts(
        folder,
        manifest,
        media_root,
        mode=selected_mode,
        profile_id=profile_id,
        config_paths=config_paths,
    )
    plan_path = bundle / "training_plan.json"
    plan_path.write_text(json.dumps(plan_artifacts["plan"], indent=2), encoding="utf-8")
    normalize_path_permissions(plan_path)
    manifest_path = bundle / "dataset_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    normalize_path_permissions(manifest_path)
    bundle_artifacts["manifest"] = manifest_path
    bundle_artifacts["plan"] = plan_path
    return {
        "path": bundle,
        "artifacts": bundle_artifacts,
        "manifest": manifest,
        "plan": plan_artifacts["plan"],
        "capturedItemCount": len(copied_rows),
    }
