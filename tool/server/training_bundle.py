import json
import os
import re
import shutil
import tomllib
import uuid
from pathlib import Path

from .dataset_config import assign_images_to_resolution_classes, build_dataset_config_artifacts, coerce_frames, video_roles_for_profile
from .dataset_prep import (
    build_dataset_manifest,
    normalize_fallback_captions,
    resolve_prepared_caption_text,
    write_prepared_caption,
)
from .training_config_files import apply_captured_initializer, with_dataset_path, with_output_dir
from .training_profiles import config_for_stage, normalize_mode, profile_for_mode
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


def _valid_video_buckets(value):
    if not isinstance(value, list) or not value:
        return None
    buckets = []
    for raw in value:
        if not isinstance(raw, list) or len(raw) != 3:
            return None
        width, height, frames = raw
        if not all(isinstance(item, int) and not isinstance(item, bool) for item in raw):
            return None
        if width <= 0 or height <= 0 or frames <= 1:
            return None
        buckets.append((width, height, frames))
    return buckets


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
    if destination.exists():
        if destination.is_file() and os.path.samefile(source, destination):
            return
        raise FileExistsError("Captured materialized target already exists: " + str(destination))
    shutil.copy2(source, destination)


def _captured_review_comment_lines(entry, kind, bucket, ladders):
    ar_label = str(entry.get("ar") or "")
    role = str(entry.get("role") or "")
    width, height = int(bucket[0]), int(bucket[1])
    frames = int(bucket[2]) if kind == "video" else 1
    candidates = (
        ((ladders or {}).get("images") or {}).get(ar_label, [])
        if kind == "image"
        else ((((ladders or {}).get("videos") or {}).get(role, {}) or {}).get(ar_label, []))
    )
    ordered = sorted(
        [tuple(shape[:2]) for shape in candidates if isinstance(shape, list) and len(shape) >= 2],
        key=lambda shape: min(shape),
    )
    current = (width, height)
    index = ordered.index(current) if current in ordered else -1
    lower = ordered[index - 1] if index > 0 else None
    higher = ordered[index + 1] if index >= 0 and index + 1 < len(ordered) else None
    count = int(entry.get("eligibleCount") or 0)
    native = int(entry.get("nativeCount") or 0)
    resized = int(entry.get("upscaledCount") or 0)
    label = "images" if kind == "image" else (role or "video")
    lines = [
        "# WebCap Review: " + label + (" · " + ar_label if ar_label else ""),
        "# bucket: " + str(width) + " × " + str(height) + " × " + str(frames) + " frame" + ("s" if frames != 1 else ""),
        "# assigned: " + str(count) + " item" + ("s" if count != 1 else "") + " · " + str(native) + " near/native · " + str(resized) + " resized",
    ]
    siblings = []
    if lower:
        siblings.append("lower " + str(lower[0]) + " × " + str(lower[1]))
    if higher:
        siblings.append("higher " + str(higher[0]) + " × " + str(higher[1]))
    if siblings:
        lines.append("# adjacent supported targets: " + " · ".join(siblings))
    return lines


def _materialize_review_stage_dataset(stage, stage_plan, media_root, distribution, ladders=None):
    """Materialize the exact reviewed memberships into isolated directories."""
    lines = ["# Captured from WebCap Training Review", "# Every directory below is an immutable reviewed subset.", "enable_ar_bucket = true"]
    entries = stage_plan.get("datasetEntries") if isinstance(stage_plan, dict) else []
    if not isinstance(entries, list):
        entries = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        bucket = entry.get("bucket") or []
        kind = str(entry.get("kind") or "")
        if kind not in ("image", "video") or len(bucket) != (2 if kind == "image" else 3):
            raise ValueError("Training Review contains an invalid captured bucket.")
        source_dir = str(entry.get("sourceDir") or "").strip()
        if not source_dir:
            raise ValueError("Training Review entry is missing its source directory.")
        target_dir = Path(media_root) / "review" / str(stage) / (str(index).zfill(3) + "-" + kind)
        for filename in entry.get("files") or []:
            name = Path(str(filename)).name
            if not name or name != str(filename):
                raise ValueError("Training Review contains an unsafe media filename.")
            source = Path(media_root) / source_dir / name
            caption = source.with_suffix(".txt")
            if not source.is_file() or not caption.is_file():
                raise FileNotFoundError("Reviewed captured source is unavailable: " + str(source))
            _link_or_copy(source, target_dir / name)
            _link_or_copy(caption, target_dir / caption.name)
        wsl_path = to_wsl_path(target_dir, distribution)
        values = list(bucket) if kind == "video" else [bucket[0], bucket[1], 1]
        lines.extend([""] + _captured_review_comment_lines(entry, kind, values, ladders) + ["[[directory]]", 'path = "' + wsl_path + '"', "num_repeats = " + str(int(entry.get("numRepeats") or 1)), 'group = "' + ("images" if kind == "image" else "videos") + '"'])
        if kind == "video" and str(entry.get("role") or ""):
            lines.append("# webcap_dataset_role = " + str(entry.get("role")))
        if bool(entry.get("detailIntent")):
            lines.append("# webcap_detail_subset = true")
        lines.append("size_buckets = [")
        lines.append("  [" + ", ".join(str(int(value)) for value in values) + "],")
        lines.append("]")
    rendered = "\n".join(lines) + "\n"
    try:
        tomllib.loads(rendered)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError("Captured Training Review dataset is invalid: " + str(exc)) from exc
    return rendered


def _capture_initializer(initializer, input_root):
    if not isinstance(initializer, dict):
        return None
    source = Path(initializer.get("sourcePath") or "")
    export_id = str(initializer.get("exportId") or "custom")
    safe_export_id = re.sub(r"[^A-Za-z0-9_.-]+", "-", export_id).strip(".-") or "custom"
    destination = Path(input_root) / "initializer" / safe_export_id
    destination.mkdir(parents=True, exist_ok=False)
    if source.is_file():
        shutil.copy2(source, destination / source.name)
        return {"path": destination, "files": [destination / source.name]}
    if not source.is_dir():
        raise FileNotFoundError("Initializer path is unavailable.")
    copied = []
    for child in source.iterdir():
        if not child.is_file():
            continue
        target = destination / child.name
        shutil.copy2(child, target)
        copied.append(target)
    weights = [item for item in copied if item.suffix.lower() == ".safetensors"]
    if len(weights) != 1:
        raise ValueError("Captured initializer must contain exactly one direct .safetensors file.")
    return {"path": destination, "files": copied}


def _action_relative_or_direct_path(path, action_root):
    try:
        return Path(path).relative_to(Path(action_root)).as_posix()
    except ValueError:
        return str(Path(path))


def _copy_or_convert_bundle_video(source, destination, target_fps, source_fps):
    """Capture source video exactly as supplied; Diffusion Pipe owns decoding."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return {"action": "copied"}


def _detail_subset_members(rows, bucket, profile_id, mode):
    roles = video_roles_for_profile(profile_id, mode)
    if len(roles) < 2:
        return []
    temporal_frames = int(roles[0][1])
    detail_frames = int(roles[1][1])
    selected_profile = profile_for_mode(profile_id, mode)
    members = []
    for row in rows:
        frames = coerce_frames(row, selected_profile.get("videoFps"))
        width = row.get("width")
        height = row.get("height")
        if not frames or not isinstance(width, int) or not isinstance(height, int) or frames < detail_frames:
            continue
        native = width >= bucket[0] and height >= bucket[1]
        mandatory = frames < temporal_frames
        if mandatory or native:
            if mandatory and not native:
                print(f"[WARN] Detail subset keeps {row.get('file')} at {bucket[0]}x{bucket[1]} despite exceeding native resolution.", flush=True)
            members.append(row)
    return members


def _warn_unsafe_direct_stanza(data, source_name, manifest, profile_id, mode):
    """Audit manual/generative direct stanzas without changing their meaning."""
    group = str(data.get("group") or "").strip().lower()
    buckets = data.get("size_buckets")
    if group not in ("images", "videos") or not isinstance(buckets, list):
        return
    rows = manifest.get("images" if group == "images" else "videos", [])
    source_rows = [
        row for row in rows
        if isinstance(row, dict) and Path(str(row.get("prepared_path") or "")).parent.name == source_name
    ]
    if not source_rows:
        print(f"[WARN] Direct {group} stanza {source_name} has no captured source rows to audit.", flush=True)
        return
    selected_profile = profile_for_mode(profile_id, mode)
    for bucket in buckets:
        if not isinstance(bucket, list) or len(bucket) != 3 or not all(isinstance(value, int) for value in bucket):
            print(f"[WARN] Direct {group} stanza {source_name} has an invalid size bucket; preserving it exactly.", flush=True)
            continue
        width, height, frames = bucket
        unsafe = []
        for row in source_rows:
            if group == "videos":
                actual_frames = coerce_frames(row, selected_profile.get("videoFps"))
                if not actual_frames or actual_frames < frames:
                    continue
            source_width = row.get("width")
            source_height = row.get("height")
            if not isinstance(source_width, int) or not isinstance(source_height, int):
                continue
            if source_width < width or source_height < height:
                unsafe.append(str(row.get("file") or "<unknown>"))
        if unsafe:
            print(
                f"[WARN] Direct {group} stanza {source_name} bucket {width}x{height}x{frames} may upscale: "
                + ", ".join(unsafe) + "; preserving saved TOML.",
                flush=True,
            )


def _materialize_dataset_config(text, media_root, distribution, manifest, stage, profile_id="", mode=""):
    prefix, blocks = _directory_blocks(text)
    if not blocks:
        return _rewrite_dataset_directories(text, media_root, distribution)
    videos_by_dir = {}
    for row in manifest.get("videos", []):
        if isinstance(row, dict):
            videos_by_dir.setdefault(Path(str(row.get("prepared_path") or "")).parent.name, []).append(row)

    materialize_image_classes = (
        str(profile_id or "").strip().lower() == "minimax_h3"
        and str(mode or "").strip().lower() == "quality"
    )
    images_by_dir = {}
    if materialize_image_classes:
        for row in manifest.get("images", []):
            if isinstance(row, dict):
                images_by_dir.setdefault(Path(str(row.get("prepared_path") or "")).parent.name, []).append(row)

    image_block_indexes = set()
    image_blocks_by_dir = {}
    for index, block in enumerate(blocks):
        data = block["data"]
        if not materialize_image_classes or str(data.get("group") or "").strip().lower() != "images":
            continue
        buckets = _valid_image_buckets(data.get("size_buckets"))
        if not buckets or len(buckets) != 1:
            # User-edited multi-bucket stanzas retain the existing direct-folder
            # behavior. Generated H3 Quality stanzas always contain one bucket.
            materialize_image_classes = False
            image_block_indexes.clear()
            image_blocks_by_dir.clear()
            break
        source_name = _directory_name(data.get("path"))
        image_block_indexes.add(index)
        image_blocks_by_dir.setdefault(source_name, []).append({"index": index, "bucket": buckets[0]})

    rendered_image_dirs = {}
    for source_name, source_blocks in image_blocks_by_dir.items():
        rows = images_by_dir.get(source_name)
        if not rows:
            raise ValueError("Image directory does not match captured media: " + source_name)
        owners = {}
        for source_block in source_blocks:
            bucket = source_block["bucket"]
            if bucket in owners:
                raise ValueError(f"Duplicate image bucket {bucket[0]}x{bucket[1]} for directory: {source_name}")
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
            print(
                f"[WARN] H3 Quality image classes for {source_name} do not cover: "
                + ", ".join(sorted(unsupported, key=str.lower))
                + "; preserving the direct captured folder.",
                flush=True,
            )
            image_block_indexes.difference_update(item["index"] for item in source_blocks)
            continue
        for item in classes:
            bucket = item["bucket"]
            class_dir = media_root / f"{source_name}__{bucket[0]}x{bucket[1]}"
            for image in item["images"]:
                source = media_root / source_name / image[0]
                caption = source.with_suffix(".txt")
                if not source.is_file() or not caption.is_file():
                    raise FileNotFoundError("Captured image class source is missing: " + str(source))
                _link_or_copy(source, class_dir / source.name)
                _link_or_copy(caption, class_dir / caption.name)
                compatibility = "native" if image[1] >= bucket[0] and image[2] >= bucket[1] else "slight_upscale"
                rows_by_name[image[0]].setdefault("imageClassAssignments", {})[str(stage)] = {
                    "bucket": [bucket[0], bucket[1]],
                    "membership": compatibility,
                    "directory": class_dir.relative_to(media_root).as_posix(),
                }
            rendered_image_dirs[owners[bucket]] = class_dir

    output = [prefix]
    rendered_count = 0
    for index, block in enumerate(blocks):
        if index in image_block_indexes:
            class_dir = rendered_image_dirs.get(index)
            if class_dir is not None:
                output.append(_rewrite_directory_path(block["raw"], to_wsl_path(class_dir, distribution)))
                rendered_count += 1
            continue
        data = block["data"]
        source_name = _directory_name(data.get("path"))
        is_detail = str(data.get("group") or "").strip().lower() == "videos" and "webcap_detail_subset = true" in block["raw"]
        if not is_detail:
            _warn_unsafe_direct_stanza(data, source_name, manifest, profile_id, mode)
            output.append(_rewrite_directory_path(block["raw"], to_wsl_path(Path(media_root) / source_name, distribution)))
            rendered_count += 1
            continue
        buckets = _valid_video_buckets(data.get("size_buckets"))
        if not buckets or len(buckets) != 1:
            print(f"[WARN] Detail stanza for {source_name} is not one explicit video bucket; using the direct folder.", flush=True)
            output.append(_rewrite_directory_path(block["raw"], to_wsl_path(Path(media_root) / source_name, distribution)))
            rendered_count += 1
            continue
        bucket = buckets[0]
        members = _detail_subset_members(videos_by_dir.get(source_name, []), bucket, profile_id, mode)
        if not members:
            print(f"[WARN] Detail subset {source_name} {bucket[0]}x{bucket[1]}x{bucket[2]} has no eligible clips; omitting stanza.", flush=True)
            continue
        subset_dir = media_root / "video_detail" / f"{source_name}__{bucket[0]}x{bucket[1]}x{bucket[2]}"
        for row in members:
            name = Path(str(row.get("prepared_path") or "")).name
            source = media_root / source_name / name
            caption = source.with_suffix(".txt")
            if not source.is_file() or not caption.is_file():
                raise FileNotFoundError("Captured detail source is missing: " + str(source))
            _link_or_copy(source, subset_dir / source.name)
            _link_or_copy(caption, subset_dir / caption.name)
            row.setdefault("videoDetailAssignments", {})[str(stage)] = {
                "bucket": [bucket[0], bucket[1], bucket[2]],
                "directory": subset_dir.relative_to(media_root).as_posix(),
            }
        output.append(_rewrite_directory_path(block["raw"], to_wsl_path(subset_dir, distribution)))
        rendered_count += 1
    rendered = "".join(output)
    try:
        tomllib.loads(rendered)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError("Generated run dataset TOML is invalid: " + str(exc)) from exc
    return rendered


def _build_bundle_summary(selected_profile, selected_mode, manifest, plan, bundle_artifacts):
    capture_actions = {}
    media_by_directory = {}
    for kind in ("images", "videos"):
        for row in manifest.get(kind, []):
            action = str(row.get("action") or ("copied" if kind == "images" else "unknown"))
            capture_actions[action] = capture_actions.get(action, 0) + 1
            directory = Path(str(row.get("prepared_path") or "")).parent.name
            if directory:
                key = kind + ":" + directory
                media_by_directory[key] = media_by_directory.get(key, 0) + 1

    datasets = []
    for artifact_key, artifact_path in bundle_artifacts.items():
        if not artifact_key.endswith("Dataset"):
            continue
        _, blocks = _directory_blocks(Path(artifact_path).read_text(encoding="utf-8"))
        entries = []
        for block in blocks:
            data = block["data"]
            path = str(data.get("path") or "")
            path_parts = Path(path.replace("\\", "/")).parts
            directory = Path(path.replace("\\", "/")).name
            group = str(data.get("group") or "")
            kind = "videos" if group == "videos" else "images"
            is_detail = group == "videos" and "video_detail" in path_parts
            role_match = re.search(r"(?m)^\s*#\s*webcap_dataset_role\s*=\s*([A-Za-z0-9_-]+)\s*$", block["raw"])
            declared_role = role_match.group(1) if role_match else ""
            detail_count = sum(
                1
                for row in manifest.get("videos", [])
                if isinstance(row, dict)
                and any(
                    str(assignment.get("directory") or "").endswith(directory)
                    for assignment in (row.get("videoDetailAssignments") or {}).values()
                    if isinstance(assignment, dict)
                )
            )
            entries.append({
                "group": group,
                "directory": directory,
                "path": path,
                "role": declared_role or ("detail" if is_detail else ("temporal" if group == "videos" else "image")),
                "mediaCount": detail_count if is_detail else media_by_directory.get(kind + ":" + directory),
                "numRepeats": int(data.get("num_repeats") or 1),
                "sizeBuckets": data.get("size_buckets") or [],
            })
        datasets.append({"artifact": artifact_key, "entries": entries})

    return {
        "version": 2,
        "profileId": selected_profile["id"],
        "profileLabel": selected_profile["label"],
        "mode": selected_mode,
        "capturedItems": sum(capture_actions.values()),
        "captureActions": capture_actions,
        "skipped": list(manifest.get("skipped") or []),
        "datasets": datasets,
    }


def _selected_stages(profile, stages):
    value = str(stages or "").strip().lower()
    available = {item["id"] for item in profile["configs"]}
    if value not in available:
        raise ValueError("Training stage does not belong to the selected profile: " + value)
    return (value,)


def materialize_training_bundle(
    folder_path,
    action_root,
    profile_id,
    mode,
    stages,
    selected_media,
    fallback_captions=None,
    selection_criteria=None,
    total_media_count=None,
    output_dirs=None,
    distribution="",
    review=None,
    initializer=None,
    capture_root=None,
):
    folder = Path(folder_path)
    action = Path(action_root)
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
    capture_root = Path(capture_root) if capture_root else action / "captures" / uuid.uuid4().hex
    configs_root = capture_root
    input_root = capture_root
    media_root = capture_root / "media"
    capture_root.mkdir(parents=True, exist_ok=False)
    media_root.mkdir(parents=True, exist_ok=True)

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
                shutil.copy2(source, destination)
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

    captured_initializer = _capture_initializer(initializer, input_root) if initializer else None

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
        reviewed_stage = ((review or {}).get("review") or {}).get("stages", {}).get(stage) if isinstance(review, dict) else None
        dataset_text = (
            _materialize_review_stage_dataset(stage, reviewed_stage, media_root, distribution, (review or {}).get("ladders"))
            if isinstance(reviewed_stage, dict)
            else _materialize_dataset_config(
                source_dataset.read_text(encoding="utf-8"), media_root, distribution, manifest, stage,
                profile_id=profile_id, mode=selected_mode,
            )
        )
        dataset_target.write_text(dataset_text, encoding="utf-8")
        dataset_wsl = to_wsl_path(dataset_target, distribution)
        output_dir = str(output_dirs.get(stage) or "").strip()
        if not output_dir:
            raise ValueError("Missing effective output directory for " + stage + ".")
        config_text = source_config.read_text(encoding="utf-8")
        config_text = with_dataset_path(config_text, dataset_wsl)
        config_text = with_output_dir(config_text, output_dir)
        if captured_initializer and str(initializer.get("stage") or "") == stage:
            config_text = apply_captured_initializer(
                config_text,
                to_wsl_path(captured_initializer["path"], distribution),
                initializer.get("forceConstantLr"),
            )
        config_target = configs_root / item["file"]
        config_target.write_text(config_text, encoding="utf-8")
        bundle_artifacts[stage + "Config"] = config_target
        bundle_artifacts[stage + "Dataset"] = dataset_target
        config_paths[stage] = source_config

    plan_artifacts = {"plan": (review or {}).get("review")} if isinstance(review, dict) and isinstance((review or {}).get("review"), dict) else build_dataset_config_artifacts(
        folder, manifest, media_root, mode=selected_mode, profile_id=profile_id, config_paths=config_paths,
    )
    summary = _build_bundle_summary(
        selected_profile,
        selected_mode,
        manifest,
        plan_artifacts["plan"],
        bundle_artifacts,
    )
    summary_path = capture_root / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    bundle_artifacts["summary"] = summary_path
    if captured_initializer:
        bundle_artifacts["initializer"] = captured_initializer["path"]
    return {
        "path": capture_root,
        "recordPath": capture_root,
        "inputPath": input_root,
        "artifacts": bundle_artifacts,
        "manifest": manifest,
        "plan": plan_artifacts["plan"],
        "summary": summary,
        "capturedItemCount": len(copied_rows),
        "initializer": {
            "actionId": initializer.get("actionId"), "exportId": initializer.get("exportId"),
            "stage": initializer.get("stage"), "epoch": initializer.get("epoch"),
            "capturedPath": _action_relative_or_direct_path(captured_initializer["path"], action),
        } if captured_initializer else {},
    }
