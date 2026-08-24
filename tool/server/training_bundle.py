import json
import os
import re
import shutil
import subprocess
import tomllib
import uuid
from pathlib import Path

from .dataset_config import assign_images_to_resolution_classes, build_dataset_config_artifacts
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
_DIRECTORY_HEADER_PATTERN = re.compile(r"^\s*\[\[directory\]\]\s*$", re.MULTILINE)


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


def _directory_blocks(text):
    matches = list(_DIRECTORY_HEADER_PATTERN.finditer(text))
    if not matches:
        return text, []
    prefix = text[:matches[0].start()]
    blocks = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        raw = text[match.start():end]
        try:
            parsed = tomllib.loads(raw)
        except tomllib.TOMLDecodeError as exc:
            raise ValueError("Could not read dataset directory stanza: " + str(exc)) from exc
        directories = parsed.get("directory")
        if not isinstance(directories, list) or len(directories) != 1 or not isinstance(directories[0], dict):
            raise ValueError("Dataset TOML directory stanza is invalid.")
        blocks.append({"raw": raw, "data": directories[0]})
    return prefix, blocks


def _directory_name(value):
    name = Path(str(value or "").replace("\\", "/")).name
    if not name:
        raise ValueError("Dataset TOML contains an empty directory path.")
    return name


def _rewrite_directory_path(block, target):
    replaced, count = _DIRECTORY_PATH_PATTERN.subn(
        lambda match: match.group(1) + '"' + target + '"' + match.group(3),
        block,
        count=1,
    )
    if count != 1:
        raise ValueError("Dataset TOML directory stanza is missing a path.")
    return replaced


def _replace_size_buckets(block, bucket):
    match = re.search(r"^\s*size_buckets\s*=", block, re.MULTILINE)
    if not match:
        raise ValueError("Image directory stanza is missing size_buckets.")
    start = block.find("[", match.end())
    if start < 0:
        raise ValueError("Image directory stanza has invalid size_buckets.")
    depth = 0
    quote = ""
    comment = False
    end = None
    for index in range(start, len(block)):
        char = block[index]
        if comment:
            if char == "\n":
                comment = False
            continue
        if quote:
            if char == quote and block[index - 1] != "\\":
                quote = ""
            continue
        if char in ("'", '"'):
            quote = char
            continue
        if char == "#":
            comment = True
            continue
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise ValueError("Image directory stanza has unterminated size_buckets.")
    indent_match = re.search(r"(^|\n)([ \t]*)size_buckets\s*=", block[match.start():])
    indent = indent_match.group(2) if indent_match else ""
    replacement = f"{indent}size_buckets = [[{bucket[0]}, {bucket[1]}, 1]]"
    return block[:match.start()] + replacement + block[end:]


def _valid_image_buckets(value):
    if not isinstance(value, list) or not value:
        return None
    buckets = []
    for raw in value:
        if not isinstance(raw, list) or len(raw) != 3:
            return None
        width, height, frames = raw
        if not all(isinstance(item, int) and not isinstance(item, bool) for item in raw):
            return None
        if width <= 0 or height <= 0 or frames != 1:
            return None
        buckets.append((width, height))
    return buckets


def _link_or_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(destination.parent)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)
    normalize_path_permissions(destination)


def _source_matches_target_fps(source_fps, target_fps):
    try:
        return abs(float(source_fps) - float(target_fps)) <= 0.1
    except (TypeError, ValueError):
        return False


def _video_transcode_temp_path(destination):
    return destination.with_name(destination.stem + ".webcap-transcoding" + destination.suffix)


def _error_excerpt(error):
    detail = str(getattr(error, "stderr", "") or str(error)).strip()
    return " ".join(detail.split())[:500]


def _copy_or_convert_bundle_video(source, destination, target_fps, source_fps):
    """Copy a video already at the model FPS, or make a bundle-local CFR copy."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(destination.parent)
    if not target_fps or _source_matches_target_fps(source_fps, target_fps):
        shutil.copy2(source, destination)
        normalize_path_permissions(destination)
        return {"action": "copied"}

    temporary = _video_transcode_temp_path(destination)
    try:
        if temporary.exists():
            temporary.unlink()
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(source),
                "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "0",
                "-vf", f"fps={int(target_fps)}:round=near,format=yuv420p",
                "-vsync", "cfr",
                "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
                "-crf", "10", "-preset", "slow", "-c:a", "copy", str(temporary),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        os.replace(temporary, destination)
        normalize_path_permissions(destination)
        return {"action": "transcoded"}
    except (OSError, subprocess.CalledProcessError) as error:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        detail = _error_excerpt(error)
        print(
            "[WARN] Could not normalize video to " + str(target_fps) + " FPS: " + source.name
            + "; copying the source unchanged. " + detail,
            flush=True,
        )
        try:
            shutil.copy2(source, destination)
            normalize_path_permissions(destination)
            return {"action": "copied_fallback", "error": detail}
        except OSError as copy_error:
            fallback_detail = _error_excerpt(copy_error)
            print(
                "[WARN] Could not capture video after normalization fallback: " + source.name
                + "; skipping it. " + fallback_detail,
                flush=True,
            )
            return {"action": None, "error": fallback_detail}


def _materialize_dataset_config(text, media_root, distribution, manifest, stage):
    prefix, blocks = _directory_blocks(text)
    if not blocks:
        return _rewrite_dataset_directories(text, media_root, distribution)

    image_rows_by_dir = {}
    for row in manifest.get("images", []):
        if not isinstance(row, dict):
            continue
        prepared_path = str(row.get("prepared_path") or "")
        name = Path(prepared_path).parent.name
        if name:
            image_rows_by_dir.setdefault(name, []).append(row)

    image_blocks_by_dir = {}
    for index, block in enumerate(blocks):
        data = block["data"]
        if str(data.get("group") or "").strip().lower() != "images":
            continue
        buckets = _valid_image_buckets(data.get("size_buckets"))
        if buckets is None:
            raise ValueError("Image directory stanza must contain positive [width, height, 1] size_buckets.")
        source_name = _directory_name(data.get("path"))
        image_blocks_by_dir.setdefault(source_name, []).append({"index": index, "buckets": buckets})

    rendered_classes = {}
    for source_name, source_blocks in image_blocks_by_dir.items():
        rows = image_rows_by_dir.get(source_name)
        if not rows:
            raise ValueError("Image directory does not match captured media: " + source_name)
        owners = {}
        for source_block in source_blocks:
            for bucket in source_block["buckets"]:
                if bucket in owners:
                    raise ValueError(
                        f"Duplicate image bucket {bucket[0]}x{bucket[1]} for directory: {source_name}"
                    )
                owners[bucket] = source_block["index"]
        images = []
        rows_by_name = {}
        for row in rows:
            name = Path(str(row.get("prepared_path") or "")).name
            try:
                width = int(row.get("width"))
                height = int(row.get("height"))
            except (TypeError, ValueError):
                raise ValueError("Captured image is missing dimensions: " + name)
            images.append((name, width, height))
            rows_by_name[name] = row
        classes, unsupported = assign_images_to_resolution_classes(images, owners.keys())
        if unsupported:
            raise ValueError(
                f"Image bucket assignment exceeds the 15% upscale limit for {source_name}: "
                + ", ".join(sorted(unsupported, key=str.lower))
            )
        classes.sort(key=lambda item: (item["bucket"][0] * item["bucket"][1], item["bucket"][0], item["bucket"][1]))
        for item in classes:
            bucket = item["bucket"]
            class_dir = media_root / "image_classes" / str(stage) / f"{source_name}__{bucket[0]}x{bucket[1]}"
            for image, compatibility in [
                (image, "native" if image[1] >= bucket[0] and image[2] >= bucket[1] else "slight_upscale")
                for image in item["images"]
            ]:
                base = media_root / source_name / image[0]
                caption = base.with_suffix(".txt")
                if not base.is_file() or not caption.is_file():
                    raise FileNotFoundError("Captured image view source is missing: " + str(base))
                _link_or_copy(base, class_dir / base.name)
                _link_or_copy(caption, class_dir / caption.name)
                row = rows_by_name[image[0]]
                assignments = row.setdefault("imageClassAssignments", {})
                assignments[str(stage)] = {
                    "bucket": [bucket[0], bucket[1]],
                    "membership": compatibility,
                    "directory": class_dir.relative_to(media_root).as_posix(),
                }
            rendered_classes.setdefault(owners[bucket], []).append((bucket, class_dir))

    output = [prefix]
    for index, block in enumerate(blocks):
        if index in rendered_classes:
            for bucket, class_dir in rendered_classes[index]:
                target = to_wsl_path(class_dir, distribution)
                image_block = _rewrite_directory_path(block["raw"], target)
                output.append(_replace_size_buckets(image_block, bucket))
            continue
        if any(index == item["index"] for items in image_blocks_by_dir.values() for item in items):
            continue
        source_name = _directory_name(block["data"].get("path"))
        output.append(_rewrite_directory_path(block["raw"], to_wsl_path(Path(media_root) / source_name, distribution)))
    rendered = "".join(output)
    try:
        tomllib.loads(rendered)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError("Generated run dataset TOML is invalid: " + str(exc)) from exc
    return rendered


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
        captured_kind_rows = []
        for row in manifest.get(kind, []):
            source = folder / str(row["file"])
            destination = media_root / str(row["prepared_path"])
            if kind == "videos":
                capture = _copy_or_convert_bundle_video(
                    source,
                    destination,
                    selected_profile.get("videoFps"),
                    row.get("fps"),
                )
                if not capture.get("action"):
                    manifest.setdefault("skipped", []).append({
                        "file": source.name,
                        "reason": "bundle_video_capture_failed",
                        "error": capture.get("error") or "unknown error",
                    })
                    continue
                row["action"] = capture["action"]
                row["target_fps"] = selected_profile.get("videoFps")
            else:
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
            captured_kind_rows.append(row)
            copied_rows.append(row)
        manifest[kind] = captured_kind_rows

    if not copied_rows:
        raise RuntimeError("No media could be captured for training.")

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
            _materialize_dataset_config(
                source_dataset.read_text(encoding="utf-8"),
                media_root,
                distribution,
                manifest,
                stage,
            ),
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
