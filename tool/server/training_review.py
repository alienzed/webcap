"""Set-owned TOML review data and bucket visualizations for training."""

import hashlib
import json
import math
import re
import tomllib
from copy import deepcopy
from pathlib import Path

from .dataset_config import (
    ASPECT_RATIOS,
    build_dataset_config_artifacts,
    build_repeats,
    coerce_frames,
    estimate_kind_exposures,
    estimate_steps,
    generate_image_candidates,
    render_dataset_entry,
    render_dataset_toml,
    solve_repeat_scalar,
    training_plan_entries,
    video_role_ceiling,
    video_roles_for_profile,
    mfp,
)
from .dataset_prep import build_dataset_manifest
from .training_profiles import (
    KREA2_PROFILE_ID,
    MINIMAX_H3_PROFILE_ID,
    WAN22_PROFILE_ID,
    profile_for_mode,
    profile_run,
)
from .training_setup import DATASET_ROOT_PLACEHOLDER, ensure_training_setup
from .training_history import discover_runs


TRAINING_PLAN_VERSION = 1
VIDEO_ROLE_METADATA_PREFIX = "# webcap_video_role = "


def _number(value, label, minimum=0.0):
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " must be a number.") from exc
    if not math.isfinite(parsed) or parsed < minimum:
        raise ValueError(label + " is outside the supported range.")
    return parsed


def _positive_int(value, label):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " must be a positive integer.") from exc
    if parsed <= 0:
        raise ValueError(label + " must be a positive integer.")
    return parsed


def _normal_setup(folder, profile_id, selected_media, selection_criteria, total_media_count):
    ensure_training_setup(
        folder,
        profile_id,
        "normal",
        selected_media=selected_media,
        selection_criteria=selection_criteria,
        total_media_count=total_media_count,
    )
    return profile_for_mode(profile_id, "normal")


def _setup_for_run(setup, profile_id, run_id):
    _selected_profile, selected_run = profile_run(profile_id, run_id or setup["runs"][0]["id"])
    stages = set(selected_run["stages"])
    selected = deepcopy(setup)
    selected["configs"] = tuple(item for item in setup["configs"] if item["id"] in stages)
    selected["datasetFiles"] = tuple(item["dataset"] for item in selected["configs"])
    return selected


def _default_target_steps(stage):
    return 5000 if stage == "hi" else 20000


def _normal_roles(profile_id):
    return [
        {"id": name, "enabled": True, "frames": int(frames), "weight": float(weight), "buckets": {}}
        for name, frames, weight in video_roles_for_profile(profile_id, "normal")
    ]


def _supported_frames(profile_id, role):
    values = set()
    for mode in ("poc", "normal", "quality"):
        for name, frames, _weight in video_roles_for_profile(profile_id, mode):
            if name == role:
                values.add(int(frames))
    return sorted(values)


def _candidate_image_buckets(ar_label, profile_id):
    # Quality supplies the intentionally reachable upper envelope. H3's former
    # Quality images have a larger landscape/portrait ceiling than the generic
    # model ladder, so retain its useful explicit maxima.
    candidates = [(int(w), int(h)) for w, h, _area in generate_image_candidates(ar_label, "quality")]
    if profile_id == MINIMAX_H3_PROFILE_ID:
        extra = {
            "square": (768, 768), "43": (1024, 768), "34": (768, 1024),
            "169": (1344, 768), "916": (768, 1344),
        }.get(ar_label)
        if extra and extra not in candidates:
            candidates.insert(0, extra)
    return list(dict.fromkeys(candidates))


def _candidate_video_buckets(ar_label, profile_id, role, frames):
    ceiling = video_role_ceiling(profile_id, "quality", ar_label, role)
    out = []
    for width, height, _area in generate_image_candidates(ar_label, "quality"):
        # The ceiling captures the calibrated model shape; the cell budget also
        # applies when a user chooses a supported frame-count variant.
        limit = 11900 if profile_id == MINIMAX_H3_PROFILE_ID else 11000
        if width <= ceiling[0] and height <= ceiling[1] and mfp(width, height, int(frames)) <= limit:
            out.append((int(width), int(height)))
    return list(dict.fromkeys(out))


def _cluster_targets(values, candidates):
    """Choose one to three obvious native-resolution clusters.

    This is intentionally modest: gaps must be visible and each resulting
    group must have enough items to be useful.  It is a default, never an
    exclusion rule, and users may still select any supported target.
    """
    ordered = sorted(float(value) for value in values if value > 0)
    if not ordered or not candidates:
        return []
    minimum = max(3, int(math.ceil(len(ordered) * 0.15)))
    breaks = []
    for index in range(1, len(ordered)):
        ratio = ordered[index] / ordered[index - 1]
        if ratio >= 1.20 and index >= minimum and len(ordered) - index >= minimum:
            breaks.append((ratio, index))
    chosen_breaks = sorted((index for _ratio, index in sorted(breaks, reverse=True)[:2]))
    groups, start = [], 0
    for stop in chosen_breaks + [len(ordered)]:
        groups.append(ordered[start:stop])
        start = stop
    output = []
    for group in groups:
        median = group[len(group) // 2]
        target = min(candidates, key=lambda bucket: (abs(math.log(min(bucket) / median)), -min(bucket)))
        if target not in output:
            output.append(target)
    return output[:3]


def _clustered_buckets(manifest, profile_id, role="", frames=1):
    by_aspect = {label: [] for label in ASPECT_RATIOS}
    key = "videos" if role else "images"
    for row in manifest.get(key, []):
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        try:
            width, height = int(row.get("width")), int(row.get("height"))
        except (TypeError, ValueError):
            continue
        if ar_label in by_aspect and width > 0 and height > 0:
            by_aspect[ar_label].append(min(width, height))
    return {
        ar_label: [[width, height] for width, height in _cluster_targets(
            values,
            _candidate_video_buckets(ar_label, profile_id, role, frames) if role else _candidate_image_buckets(ar_label, profile_id),
        )]
        for ar_label, values in by_aspect.items() if values
    }


def _default_profile_plan(folder, profile_id, manifest, setup):
    config_paths = {item["id"]: Path(folder) / item["file"] for item in setup["configs"]}
    default = build_dataset_config_artifacts(
        folder,
        manifest,
        DATASET_ROOT_PLACEHOLDER,
        mode="normal",
        profile_id=profile_id,
        config_paths=config_paths,
    )["plan"]
    stages = {}
    for stage, data in default.get("stages", {}).items():
        images = _clustered_buckets(manifest, profile_id)
        stages[stage] = {"targetSteps": int(data.get("targetSteps") or _default_target_steps(stage)), "imageBuckets": images}
    roles = _normal_roles(profile_id)
    for role in roles:
        role["buckets"] = _clustered_buckets(manifest, profile_id, role["id"], role["frames"])
    return {"version": TRAINING_PLAN_VERSION, "stages": stages, "videoRoles": roles}


def _normalize_bucket_list(raw, candidates, label):
    source = raw if isinstance(raw, list) else []
    valid = set(candidates)
    output = []
    seen = set()
    for row in source:
        if not isinstance(row, (list, tuple)) or len(row) != 2:
            raise ValueError(label + " contains an invalid bucket.")
        bucket = (_positive_int(row[0], label + " width"), _positive_int(row[1], label + " height"))
        if bucket not in valid:
            raise ValueError(label + " contains a bucket outside this model's supported ladder.")
        if bucket not in seen:
            seen.add(bucket)
            output.append([bucket[0], bucket[1]])
    if len(output) > 3:
        raise ValueError(label + " contains more than three targets.")
    return output


def normalize_profile_plan(raw, profile_id, setup):
    source = raw if isinstance(raw, dict) else {}
    valid_stages = [item["id"] for item in setup["configs"]]
    output = {"version": TRAINING_PLAN_VERSION, "stages": {}, "videoRoles": []}
    raw_stages = source.get("stages") if isinstance(source.get("stages"), dict) else {}
    for stage in valid_stages:
        item = raw_stages.get(stage) if isinstance(raw_stages.get(stage), dict) else {}
        image_buckets = item.get("imageBuckets") if isinstance(item.get("imageBuckets"), dict) else {}
        normalized_images = {}
        for ar_label in ASPECT_RATIOS:
            if ar_label not in image_buckets:
                continue
            normalized_images[ar_label] = _normalize_bucket_list(
                image_buckets.get(ar_label), _candidate_image_buckets(ar_label, profile_id), stage + " " + ar_label + " image buckets",
            )
        output["stages"][stage] = {
            "targetSteps": _positive_int(item.get("targetSteps", _default_target_steps(stage)), stage + " target steps"),
            "imageBuckets": normalized_images,
        }
    raw_roles = source.get("videoRoles") if isinstance(source.get("videoRoles"), list) else []
    by_role = {str(item.get("id") or ""): item for item in raw_roles if isinstance(item, dict)}
    for default in _normal_roles(profile_id):
        source_role = by_role.get(default["id"], default)
        role = default["id"]
        frames = _positive_int(source_role.get("frames", default["frames"]), role + " frame count")
        if frames not in _supported_frames(profile_id, role):
            raise ValueError(role + " frame count is not supported by this model.")
        buckets = source_role.get("buckets") if isinstance(source_role.get("buckets"), dict) else {}
        normalized_buckets = {}
        for ar_label in ASPECT_RATIOS:
            if ar_label not in buckets:
                continue
            normalized_buckets[ar_label] = _normalize_bucket_list(
                buckets.get(ar_label), _candidate_video_buckets(ar_label, profile_id, role, frames), role + " " + ar_label + " video buckets",
            )
        output["videoRoles"].append({
            "id": role,
            "enabled": bool(source_role.get("enabled", default["enabled"])),
            "frames": frames,
            "weight": _number(source_role.get("weight", default["weight"]), role + " weight", 0.000001),
            "buckets": normalized_buckets,
        })
    return output


def _config_settings(path):
    try:
        text = Path(path).read_text(encoding="utf-8")
        parsed = tomllib.loads(text)
    except (OSError, UnicodeError, tomllib.TOMLDecodeError) as exc:
        raise ValueError("Could not read training config " + Path(path).name + ": " + str(exc)) from exc
    optimizer = parsed.get("optimizer") if isinstance(parsed.get("optimizer"), dict) else {}
    adapter = parsed.get("adapter") if isinstance(parsed.get("adapter"), dict) else {}
    return {
        "optimizerLr": optimizer.get("lr"),
        "adapterRank": adapter.get("rank"),
        "adapterDropout": adapter.get("dropout", ""),
        "forceConstantLr": parsed.get("force_constant_lr", ""),
    }


def _image_rows(manifest):
    groups = {}
    for row in manifest.get("images", []):
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        prepared = str(row.get("prepared_path") or "")
        try:
            width, height = int(row.get("width")), int(row.get("height"))
        except (TypeError, ValueError):
            continue
        if ar_label not in ASPECT_RATIOS or not prepared or width <= 0 or height <= 0:
            continue
        directory = Path(prepared).parent.as_posix()
        groups.setdefault((directory, ar_label), []).append((Path(prepared).name, width, height))
    return groups


def _assign_images(rows, buckets):
    selected = list(dict.fromkeys(tuple(item) for item in buckets))
    assigned = {bucket: [] for bucket in selected}
    uncovered = []
    for image in rows:
        if not selected:
            uncovered.append(image[0])
            continue
        # Resolution is a fitting preference, not an exclusion gate.  Use the
        # same native-short-edge distance the chart reports, so the visible
        # target marker and the generated dataset assignment always agree.
        chosen = min(
            selected,
            key=lambda bucket: abs(math.log(min(bucket) / float(min(image[1], image[2])))),
        )
        status = "native" if image[1] >= chosen[0] and image[2] >= chosen[1] else "upscaled"
        assigned[chosen].append((image, status))
    return assigned, uncovered


def _build_review_plan(folder, profile_id, setup, manifest, profile_plan):
    image_groups = _image_rows(manifest)
    video_groups = {ar: [] for ar in ASPECT_RATIOS}
    profile = profile_for_mode(profile_id, "normal")
    model_fps = profile.get("videoFps")
    for row in manifest.get("videos", []):
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        prepared = str(row.get("prepared_path") or "")
        try:
            width, height = int(row.get("width")), int(row.get("height"))
        except (TypeError, ValueError):
            continue
        frames = coerce_frames(row, model_fps)
        if ar_label not in video_groups or not prepared or width <= 0 or height <= 0 or not frames:
            continue
        video_groups[ar_label].append({"file": Path(prepared).name, "directory": Path(prepared).parent.as_posix(), "width": width, "height": height, "frames": int(frames)})

    stages = {}
    all_excluded = []
    role_lookup = {item["id"]: item for item in profile_plan.get("videoRoles", [])}
    for config in setup["configs"]:
        stage = config["id"]
        stage_settings = profile_plan["stages"].get(stage, {})
        entries = []
        excluded = []
        for (directory, ar_label), rows in image_groups.items():
            buckets = stage_settings.get("imageBuckets", {}).get(ar_label, [])
            assignments, uncovered = _assign_images(rows, buckets)
            for filename in uncovered:
                excluded.append({"file": filename, "kind": "image", "ar": ar_label, "reason": "no_enabled_bucket"})
            for bucket, members in assignments.items():
                if not members:
                    continue
                native = sum(1 for _item, status in members if status == "native")
                files = [item[0][0] for item in members]
                entries.append({
                    "kind": "image", "role": "image", "ar_label": ar_label,
                    "path": (DATASET_ROOT_PLACEHOLDER / directory), "dir_path": (DATASET_ROOT_PLACEHOLDER / directory).as_posix(),
                    "sourceDir": directory, "bucket": bucket, "files": files,
                    "sample_count": len(files), "native_count": native, "upscaled_count": len(files) - native,
                    "limiting_files": [], "repeat_weight": 1.0,
                })
        for role_name, role in role_lookup.items():
            if not role.get("enabled"):
                continue
            frames = int(role["frames"])
            for ar_label, clips in video_groups.items():
                if not clips:
                    continue
                buckets = [tuple(item) for item in role.get("buckets", {}).get(ar_label, [])]
                buckets.sort(key=lambda item: item[0] * item[1], reverse=True)
                assignments = {bucket: [] for bucket in buckets}
                for clip in clips:
                    if clip["frames"] < frames:
                        excluded.append({"file": clip["file"], "kind": "video", "ar": ar_label, "role": role_name, "reason": "too_short"})
                        continue
                    if not buckets:
                        excluded.append({"file": clip["file"], "kind": "video", "ar": ar_label, "role": role_name, "reason": "no_enabled_bucket"})
                        continue
                    native = next((bucket for bucket in buckets if clip["width"] >= bucket[0] and clip["height"] >= bucket[1]), None)
                    bucket = native or buckets[-1]
                    assignments[bucket].append((clip, bool(native)))
                for bucket, members in assignments.items():
                    if not members:
                        continue
                    files = [item[0]["file"] for item in members]
                    native_count = sum(1 for _item, native in members if native)
                    directories = {item[0]["directory"] for item in members}
                    # A review entry never mixes source directories, which keeps
                    # capture subsets explicit even for manually grouped media.
                    for directory in directories:
                        scoped = [item for item in members if item[0]["directory"] == directory]
                        scoped_files = [item[0]["file"] for item in scoped]
                        scoped_native = sum(1 for _item, native in scoped if native)
                        entries.append({
                            "kind": "video", "role": role_name, "ar_label": ar_label,
                            "path": (DATASET_ROOT_PLACEHOLDER / directory), "dir_path": (DATASET_ROOT_PLACEHOLDER / directory).as_posix(),
                            "sourceDir": directory, "bucket": (bucket[0], bucket[1], frames), "files": scoped_files,
                            "sample_count": len(scoped_files), "native_count": scoped_native,
                            "upscaled_count": len(scoped_files) - scoped_native, "limiting_files": [],
                            "repeat_weight": float(role["weight"]), "detail_intent": role_name == "detail",
                        })
        target = int(stage_settings.get("targetSteps") or _default_target_steps(stage))
        config_path = Path(folder) / config["file"]
        settings = _config_settings(config_path)
        try:
            epochs = int(tomllib.loads(config_path.read_text(encoding="utf-8")).get("epochs") or 1)
        except (OSError, UnicodeError, tomllib.TOMLDecodeError):
            epochs = 1
        scalar, _base = solve_repeat_scalar(entries, target, epochs)
        repeats = build_repeats(entries, scalar)
        stages[stage] = {
            "epochs": epochs, "targetSteps": target, "estimatedSteps": estimate_steps(entries, repeats, epochs),
            "estimatedImageExposures": estimate_kind_exposures(entries, repeats, epochs, "image"),
            "estimatedVideoExposures": estimate_kind_exposures(entries, repeats, epochs, "video"),
            "datasetEntries": training_plan_entries(entries, repeats), "settings": settings,
        }
        all_excluded.extend(dict(item, stage=stage) for item in excluded)
    return {"version": TRAINING_PLAN_VERSION, "profileId": profile_id, "mode": "review", "stages": stages, "excluded": all_excluded}


def _review_bucket_comment_lines(entry, profile_id):
    bucket = entry.get("bucket") or []
    if len(bucket) < 2:
        raise ValueError("Training Review dataset entry is missing a bucket shape.")
    kind = str(entry.get("kind") or "")
    role = str(entry.get("role") or "")
    ar_label = str(entry.get("ar") or "")
    width, height = int(bucket[0]), int(bucket[1])
    frames = int(bucket[2]) if len(bucket) >= 3 else 1
    candidates = (
        _candidate_image_buckets(ar_label, profile_id)
        if kind == "image"
        else _candidate_video_buckets(ar_label, profile_id, role, frames)
    )
    ordered = sorted(candidates, key=lambda shape: min(shape))
    current = (width, height)
    index = ordered.index(current) if current in ordered else -1
    lower = ordered[index - 1] if index > 0 else None
    higher = ordered[index + 1] if index >= 0 and index + 1 < len(ordered) else None
    label = "images" if kind == "image" else (role or "video")
    count = int(entry.get("eligibleCount") or 0)
    native = int(entry.get("nativeCount") or 0)
    resized = int(entry.get("upscaledCount") or 0)
    lines = [
        "# WebCap Review: " + label + " · " + ASPECT_LABELS.get(ar_label, ar_label),
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


def _render_stage_dataset(stage_plan, profile_plan, profile_id):
    entries = stage_plan.get("datasetEntries") or []
    lines = ["# webcap_training_review = 1", "# This file is generated from the Training Review plan."]
    # Diffusion Pipe represents a video role only when it has a trainable
    # directory stanza. Keep its direct Review settings in this canonical TOML
    # comment so an enabled role with no eligible clips cannot lose its bucket.
    for role in profile_plan.get("videoRoles") or []:
        lines.append(VIDEO_ROLE_METADATA_PREFIX + json.dumps({
            "id": role.get("id"),
            "enabled": bool(role.get("enabled")),
            "frames": int(role.get("frames") or 0),
            "weight": float(role.get("weight") or 0),
            "buckets": role.get("buckets") or {},
        }, separators=(",", ":"), sort_keys=True))
    blocks = []
    for entry in entries:
        bucket = entry.get("bucket") or []
        if entry.get("kind") == "image":
            rendered = {
                "kind": "image", "path": DATASET_ROOT_PLACEHOLDER / str(entry.get("sourceDir") or entry.get("ar") or "images"),
                "ar_label": entry.get("ar"), "bucket": (bucket[0], bucket[1]),
            }
        else:
            rendered = {
                "kind": "video", "dir_path": (DATASET_ROOT_PLACEHOLDER / str(entry.get("sourceDir") or entry.get("ar") or "videos")).as_posix(),
                "bucket": (bucket[0], bucket[1], bucket[2]), "detail_intent": entry.get("role") == "detail",
            }
        blocks.append("\n".join(_review_bucket_comment_lines(entry, profile_id) + [render_dataset_entry(rendered, int(entry.get("numRepeats") or 1))]))
    lines.append(render_dataset_toml(blocks).rstrip())
    return "\n\n".join(lines) + "\n"


def _dataset_paths(setup):
    return {item["id"]: item["dataset"] for item in setup["configs"]}


def _write_structured_datasets(folder, setup, review_plan, profile_plan, profile_id, stages=None):
    wanted_stages = set(stages) if stages is not None else None
    for stage, filename in _dataset_paths(setup).items():
        if wanted_stages is not None and stage not in wanted_stages:
            continue
        text = _render_stage_dataset((review_plan.get("stages") or {}).get(stage, {}), profile_plan, profile_id)
        destination = Path(folder) / filename
        destination.write_text(text, encoding="utf-8")


def _closest_aspect(bucket, profile_id, kind, role="", frames=1):
    """Find the sole ladder aspect containing a manually selected bucket."""
    matches = []
    for ar_label in ASPECT_RATIOS:
        candidates = _candidate_image_buckets(ar_label, profile_id) if kind == "image" else _candidate_video_buckets(ar_label, profile_id, role, frames)
        if tuple(bucket[:2]) in candidates:
            matches.append(ar_label)
    return matches[0] if len(matches) == 1 else ""


def _import_representable_dataset(text, profile_id, stage, profile_plan):
    """Import a simple hand edit without guessing at custom stanza semantics."""
    # A malformed existing TOML is an error, not a custom configuration.  The
    # caller deliberately lets this exception reach the route/log so it never
    # gets mistaken for a safe alternative and silently overwritten.
    parsed = tomllib.loads(text)
    directories = parsed.get("directory", [])
    if not isinstance(directories, list) or (not directories and set(parsed) - {"enable_ar_bucket"}):
        return None
    imported = deepcopy(profile_plan)
    stage_plan = imported.get("stages", {}).get(stage)
    if not isinstance(stage_plan, dict):
        return None
    stage_plan["imageBuckets"] = {}
    roles = {item["id"]: item for item in imported.get("videoRoles", [])}
    for role in roles.values():
        role["buckets"] = {}
    for line in text.splitlines():
        if not line.startswith(VIDEO_ROLE_METADATA_PREFIX):
            continue
        try:
            saved = json.loads(line[len(VIDEO_ROLE_METADATA_PREFIX):])
        except json.JSONDecodeError as exc:
            raise ValueError("Could not read WebCap video-role metadata in the dataset TOML: " + str(exc)) from exc
        if not isinstance(saved, dict) or str(saved.get("id") or "") not in roles:
            return None
        role = roles[str(saved["id"])]
        role["enabled"] = bool(saved.get("enabled"))
        role["frames"] = saved.get("frames")
        role["weight"] = saved.get("weight")
        role["buckets"] = saved.get("buckets") if isinstance(saved.get("buckets"), dict) else {}
    for item in directories:
        if not isinstance(item, dict) or set(item) - {"path", "num_repeats", "group", "size_buckets"}:
            return None
        group = str(item.get("group") or "")
        buckets = item.get("size_buckets")
        if group not in ("images", "videos") or not isinstance(buckets, list) or len(buckets) != 1:
            return None
        bucket = buckets[0]
        if not isinstance(bucket, list) or len(bucket) != 3 or not all(isinstance(value, int) and value > 0 for value in bucket):
            return None
        if group == "images":
            if bucket[2] != 1:
                return None
            ar_label = _closest_aspect(bucket, profile_id, "image")
            if not ar_label:
                return None
            selected = stage_plan["imageBuckets"].setdefault(ar_label, [])
            selected.append([bucket[0], bucket[1]])
            # The TOML can be perfectly valid while expressing a bucket mix
            # that the intentionally small Review UI cannot represent.  Treat
            # it as a custom dataset instead of rejecting it as a bad file.
            if len(selected) > 3:
                return None
            continue
        possible = []
        for role_name, role in roles.items():
            if int(role["frames"]) != bucket[2]:
                continue
            ar_label = _closest_aspect(bucket, profile_id, "video", role_name, bucket[2])
            if ar_label:
                possible.append((role, ar_label))
        if len(possible) != 1:
            return None
        role, ar_label = possible[0]
        selected = role["buckets"].setdefault(ar_label, [])
        if [bucket[0], bucket[1]] not in selected:
            selected.append([bucket[0], bucket[1]])
        if len(selected) > 3:
            return None
    return imported


def _ladders(profile_id, review_plan, manifest):
    present_aspects = set()
    for group in (_image_rows(manifest),):
        present_aspects.update(ar for _directory, ar in group)
    present_aspects.update(str(row.get("ar") or "") for row in manifest.get("videos", []) if isinstance(row, dict))
    output = {"images": {}, "videos": {}}
    for ar_label in sorted(present_aspects):
        if ar_label in ASPECT_RATIOS:
            output["images"][ar_label] = [[w, h] for w, h in _candidate_image_buckets(ar_label, profile_id)]
    for role in review_plan.get("videoRoles", []):
        name = role["id"]
        output["videos"][name] = {
            ar: [[w, h] for w, h in _candidate_video_buckets(ar, profile_id, name, int(role["frames"]))]
            for ar in output["images"]
        }
    return output


def discover_saved_initializers(folder, profile_id, stage):
    """List explicit current-set epoch exports for the Init LoRA picker.

    This is intentionally invoked only by the Init LoRA UI. It is not part of
    startup/recovery and never searches unrelated output roots.
    """
    wanted_stage = str(stage or "").strip().lower()
    if wanted_stage not in ("hi", "lo", "krea2", "wan21", "h3"):
        return []
    result = []
    for run in discover_runs(folder, wanted_stage):
        run_path = Path(str(run.get("runPath") or run.get("path") or ""))
        try:
            exports = list(run_path.iterdir())
        except OSError:
            continue
        for export in exports:
            match = re.match(r"^epoch(\d+)$", export.name, re.IGNORECASE)
            if not match or not export.is_dir() or export.is_symlink():
                continue
            try:
                weights = [child for child in export.iterdir() if child.is_file() and not child.is_symlink() and child.suffix.lower() == ".safetensors"]
            except OSError:
                continue
            if len(weights) != 1:
                continue
            export_id = hashlib.sha256((str(run.get("resumeActionId") or "") + "\0" + str(export)).encode("utf-8")).hexdigest()[:24]
            result.append({
                "exportId": export_id,
                "actionId": str(run.get("resumeActionId") or ""),
                "runName": str(run.get("runName") or run.get("name") or "run"),
                "stage": wanted_stage,
                "epoch": int(match.group(1)),
                "sourcePath": str(export),
                "weights": [{"name": weights[0].name, "bytes": weights[0].stat().st_size}],
                "compatible": True,
                "reason": "",
            })
    return sorted(result, key=lambda item: item["epoch"], reverse=True)


def resolve_saved_initializer(folder, profile_id, stage, action_id, export_id):
    candidate = next((item for item in discover_saved_initializers(folder, profile_id, stage)
                      if item["actionId"] == str(action_id or "") and item["exportId"] == str(export_id or "")), None)
    if candidate is None:
        raise ValueError("The selected LoRA checkpoint is unavailable.")
    return {**candidate, "sourcePath": Path(candidate["sourcePath"])}


# The Review used to persist a parallel plan inside .webcap_state.json.  The
# canonical dataset TOML is now the only editable authority; these definitions
# deliberately replace the older state-backed implementation above.
def _set_toml_review(folder, profile_id, run_id, selected_media, selection_criteria, total_media_count):
    expected_setup = profile_for_mode(profile_id, "normal")
    missing_datasets = {
        item["dataset"] for item in expected_setup["configs"]
        if not (Path(folder) / item["dataset"]).is_file()
    }
    setup = _normal_setup(folder, profile_id, selected_media, selection_criteria, total_media_count)
    review_setup = _setup_for_run(setup, profile_id, run_id)
    manifest = build_dataset_manifest(folder, selected_media=selected_media, selection_criteria=selection_criteria, total_media_count=total_media_count)
    plan = _default_profile_plan(folder, profile_id, manifest, review_setup)
    custom = None
    materialized_stages = {
        config["id"] for config in review_setup["configs"]
        if config["dataset"] in missing_datasets
    }
    for config in review_setup["configs"]:
        config_path = Path(folder) / config["file"]
        dataset_path = Path(folder) / config["dataset"]
        # Required TOMLs are intentionally read here.  A bad existing file is
        # an operation failure, never a signal to silently replace it.
        tomllib.loads(config_path.read_text(encoding="utf-8"))
        if config["id"] in materialized_stages:
            continue
        dataset_text = dataset_path.read_text(encoding="utf-8")
        imported = _import_representable_dataset(dataset_text, profile_id, config["id"], plan)
        if imported is None:
            custom = {"stage": config["id"], "datasetName": config["dataset"], "message": dataset_path.name + " is custom. Edit the raw TOML or Reset dataset to return to bucket controls."}
            break
        plan = imported
    plan = normalize_profile_plan(plan, profile_id, review_setup)
    plan["profileId"] = profile_id
    review = _build_review_plan(folder, profile_id, review_setup, manifest, plan)
    if materialized_stages:
        _write_structured_datasets(folder, review_setup, review, plan, profile_id, materialized_stages)
    return setup, review_setup, manifest, plan, review, custom


IMPACT_BANDS = ("down20", "down", "near", "up", "up20")
ASPECT_LABELS = {"43": "4:3", "34": "3:4", "169": "16:9", "916": "9:16", "square": "Square"}


def _impact_band(scale_ratio):
    if scale_ratio < 0.80:
        return "down20"
    if scale_ratio < 0.95:
        return "down"
    if scale_ratio <= 1.05:
        return "near"
    if scale_ratio <= 1.20:
        return "up"
    return "up20"


def _empty_impact_counts():
    return {band: 0 for band in IMPACT_BANDS}


def _selected_targets(buckets):
    return [tuple(item) for item in buckets if isinstance(item, (list, tuple)) and len(item) == 2]


def _closest_target(short_edge, targets):
    if not targets:
        return ()
    return min(targets, key=lambda target: abs(math.log(min(target) / float(short_edge))))


def _video_assignment(width, height, targets):
    """Match the existing Temporal/Detail bucket-selection semantics."""
    ordered = sorted(targets, key=lambda target: target[0] * target[1], reverse=True)
    return next((target for target in ordered if width >= target[0] and height >= target[1]), ordered[-1] if ordered else ())


def _distribution_group(rows, targets, frames=None, assign_target=None):
    target_counts = {target: 0 for target in targets}
    native = []
    impact = _empty_impact_counts()
    for row in rows:
        width, height = int(row["width"]), int(row["height"])
        short_edge = min(width, height)
        target = (assign_target(width, height, targets) if assign_target else _closest_target(short_edge, targets)) if row.get("eligible", True) else ()
        scale_ratio = min(target) / float(short_edge) if target else 1.0
        band = _impact_band(scale_ratio)
        if target:
            target_counts[target] += 1
            impact[band] += 1
        native.append({
            "file": str(row.get("file") or ""),
            "width": width,
            "height": height,
            "edge": short_edge,
            "nativeShortEdge": short_edge,
            "target": list(target),
            "assignedTarget": list(target),
            "scaleRatio": scale_ratio,
            "impactBand": band,
            "eligible": bool(row.get("eligible", True)),
        })
    group = {
        "count": len(native),
        "eligibleCount": sum(1 for row in native if row["eligible"]),
        "native": native,
        "targets": [{"shape": list(target), "assignedCount": target_counts[target]} for target in targets],
        "impact": impact,
    }
    if frames is not None:
        group["frames"] = int(frames)
    return group


def _distribution_payload(manifest, plan):
    """Return chart-shaped source facts for the Review chart, including source filenames."""
    output = {"images": {}, "videos": {}, "impact": {"images": _empty_impact_counts(), "videos": {}}}
    image_buckets = {}
    for stage in (plan.get("stages") or {}).values():
        for ar_label, buckets in (stage.get("imageBuckets") or {}).items():
            image_buckets.setdefault(ar_label, [])
            for bucket in _selected_targets(buckets):
                if bucket not in image_buckets[ar_label]:
                    image_buckets[ar_label].append(bucket)
    image_rows = {ar_label: [] for ar_label in ASPECT_RATIOS}
    for row in manifest.get("images") or []:
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        try:
            width, height = int(row["width"]), int(row["height"])
        except (KeyError, TypeError, ValueError):
            continue
        if ar_label in image_rows and width > 0 and height > 0:
            image_rows[ar_label].append({"file": str(row.get("file") or ""), "width": width, "height": height})
    for ar_label, rows in image_rows.items():
        if not rows:
            continue
        group = _distribution_group(rows, image_buckets.get(ar_label, []))
        output["images"][ar_label] = group
        for band, count in group["impact"].items():
            output["impact"]["images"][band] += count

    profile = profile_for_mode(str(plan.get("profileId") or ""), "normal") if plan.get("profileId") else None
    model_fps = profile.get("videoFps") if profile else None
    video_rows = {ar_label: [] for ar_label in ASPECT_RATIOS}
    for row in manifest.get("videos") or []:
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        try:
            width, height = int(row["width"]), int(row["height"])
        except (KeyError, TypeError, ValueError):
            continue
        frames = coerce_frames(row, model_fps)
        if ar_label in video_rows and width > 0 and height > 0 and frames:
            video_rows[ar_label].append({"file": str(row.get("file") or ""), "width": width, "height": height, "frames": int(frames)})
    for role in plan.get("videoRoles") or []:
        role_name = str(role.get("id") or "")
        frames = int(role.get("frames") or 0)
        if not role_name or not frames:
            continue
        role_groups = {}
        role_impact = _empty_impact_counts()
        for ar_label, rows in video_rows.items():
            if not rows:
                continue
            eligible_rows = [dict(row, eligible=int(row["frames"]) >= frames) for row in rows]
            group = _distribution_group(
                eligible_rows,
                _selected_targets((role.get("buckets") or {}).get(ar_label, [])),
                frames,
                assign_target=_video_assignment,
            )
            role_groups[ar_label] = group
            for band, count in group["impact"].items():
                role_impact[band] += count
        output["videos"][role_name] = role_groups
        output["impact"]["videos"][role_name] = role_impact
    return output


def _distribution_warnings(distribution, manifest):
    warnings = []
    invalid = [row for row in manifest.get("skipped") or [] if str(row.get("reason") or "") == "invalid_aspect_ratio"]
    if invalid:
        warnings.append({
            "code": "invalid_ar",
            "view": "",
            "message": str(len(invalid)) + " item(s) have an invalid aspect ratio and remain outside the existing cohorts.",
            "files": [],
        })
    views = [("images", "", distribution.get("images") or {})]
    views.extend(("videos", str(role), groups) for role, groups in (distribution.get("videos") or {}).items())
    for kind, role, groups in views:
        for ar_label, group in groups.items():
            eligible = [row for row in group.get("native") or [] if row.get("eligible", True) and row.get("target")]
            substantial = sum(1 for row in eligible if row.get("impactBand") in ("down20", "up20"))
            if substantial:
                label = (role + " video") if role else "image"
                warnings.append({
                    "code": "substantial_resize",
                    "view": role or "images",
                    "ar": ar_label,
                    "message": str(substantial) + " of " + str(len(eligible)) + " " + label + " item(s) in " + ASPECT_LABELS.get(ar_label, ar_label) + " will resize more than 20%.",
                    "files": [],
                })
            total = len(eligible)
            if total >= 8:
                for target in group.get("targets") or []:
                    assigned = int(target.get("assignedCount") or 0)
                    if 0 < assigned <= max(2, int(math.floor(total * 0.10))):
                        shape = target.get("shape") or []
                        warnings.append({
                            "code": "small_bucket",
                            "view": role or "images",
                            "ar": ar_label,
                            "message": str(shape[0]) + "×" + str(shape[1]) + " receives only " + str(assigned) + " item(s) in " + ASPECT_LABELS.get(ar_label, ar_label) + ".",
                            "files": [],
                        })
    return warnings


def prepare_training_review(folder, profile_id, run_id="", selected_media=None, selection_criteria=None, total_media_count=None, fallback_captions=None, persist=True):
    """Read the canonical TOMLs and return a renderable bucket report.

    ``persist`` remains accepted for older callers, but Review is no longer an
    immutable resume record and opening it never writes a dataset TOML.
    """
    folder = Path(folder)
    selected_media = list(selected_media or [])
    setup, review_setup, manifest, plan, review, custom = _set_toml_review(
        folder, profile_id, run_id, selected_media, selection_criteria, total_media_count,
    )
    blockers = []
    warnings = []
    if not selected_media:
        blockers.append({"code": "no_visible_media", "message": "No visible media items are selected for training.", "files": []})
    fallback = fallback_captions if isinstance(fallback_captions, dict) else {}
    for name in selected_media:
        source = folder / str(name)
        caption = source.with_suffix(".txt")
        if not caption.is_file() and not str(fallback.get(str(name)) or "").strip():
            blockers.append({"code": "missing_caption", "message": "No caption or fallback is available.", "files": [str(name)]})
    distribution = _distribution_payload(manifest, plan)
    warnings.extend(_distribution_warnings(distribution, manifest))
    if not custom and not any((stage.get("datasetEntries") or []) for stage in (review.get("stages") or {}).values()):
        blockers.append({"code": "no_trainable_media", "message": "The selected buckets contain no trainable media.", "files": []})
    ladders = _ladders(profile_id, plan, manifest)
    return {
        "ok": not blockers, "profileId": profile_id, "runId": run_id,
        "plan": plan, "review": review, "blockers": blockers, "warnings": warnings,
        "ladders": ladders,
        "customDataset": custom or False, "distribution": distribution,
    }


def update_training_review(folder, profile_id, payload):
    source = payload if isinstance(payload, dict) else {}
    folder = Path(folder)
    selected_media = list(source.get("selected_media") or [])
    selection_criteria = source.get("selection_criteria")
    total_media_count = source.get("total_media_count")
    run_id = source.get("runId") or ""
    setup, review_setup, manifest, current, _review, custom = _set_toml_review(
        folder, profile_id, run_id, selected_media, selection_criteria, total_media_count,
    )
    reset = str(source.get("reset") or "")
    if reset == "buckets":
        current = _default_profile_plan(folder, profile_id, manifest, review_setup)
        custom = None
    elif isinstance(source.get("plan"), dict) and not custom:
        current = source["plan"]
    current = normalize_profile_plan(current, profile_id, review_setup)
    reviewed = _build_review_plan(folder, profile_id, review_setup, manifest, current)
    if not custom:
        _write_structured_datasets(folder, review_setup, reviewed, current, profile_id)
    return prepare_training_review(
        folder, profile_id, run_id, selected_media, selection_criteria, total_media_count,
        source.get("fallback_captions"), persist=False,
    )
