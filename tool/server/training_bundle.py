import json
import os
import re
import shutil
import subprocess
import tomllib
import uuid
from pathlib import Path

from .dataset_config import build_dataset_config_artifacts, coerce_frames, video_roles_for_profile
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

    output = [prefix]
    rendered_count = 0
    for block in blocks:
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
                "role": "detail" if is_detail else ("temporal" if group == "videos" else "image"),
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
        "trainingPlan": plan,
        "datasets": datasets,
    }


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
                profile_id=profile_id,
                mode=selected_mode,
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
    summary = _build_bundle_summary(
        selected_profile,
        selected_mode,
        manifest,
        plan_artifacts["plan"],
        bundle_artifacts,
    )
    summary_path = bundle / "bundle_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    normalize_path_permissions(summary_path)
    bundle_artifacts["manifest"] = manifest_path
    bundle_artifacts["plan"] = plan_path
    bundle_artifacts["summary"] = summary_path
    return {
        "path": bundle,
        "artifacts": bundle_artifacts,
        "manifest": manifest,
        "plan": plan_artifacts["plan"],
        "summary": summary,
        "capturedItemCount": len(copied_rows),
    }
