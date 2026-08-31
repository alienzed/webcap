"""Structured, set-owned training review plans.

The trainer still consumes TOML.  This module keeps the small amount of intent
that TOML cannot express (empty enabled buckets, target-step budgets and role
membership) in the folder state, renders app-owned dataset TOMLs, and returns
an auditable launch review before anything is captured.
"""

import hashlib
import json
import math
import re
import threading
import tomllib
from copy import deepcopy
from pathlib import Path

from .dataset_config import (
    ASPECT_RATIOS,
    IMAGE_BUCKET_MAX_UPSCALE_RATIO,
    build_dataset_config_artifacts,
    build_repeats,
    coerce_frames,
    estimate_kind_exposures,
    estimate_steps,
    generate_image_candidates,
    image_bucket_compatibility,
    render_dataset_entry,
    solve_repeat_scalar,
    training_plan_entries,
    video_role_ceiling,
    video_roles_for_profile,
    mfp,
)
from .dataset_prep import build_dataset_manifest
from . import config as app_config
from .training_action import managed_action_children, read_action
from .folder_state_store import read_folder_state, write_folder_state_atomic
from .permissions import normalize_path_permissions
from .training_config_files import apply_review_config_settings, reset_training_config_file
from .training_profiles import (
    KREA2_PROFILE_ID,
    MINIMAX_H3_PROFILE_ID,
    WAN22_PROFILE_ID,
    config_for_stage,
    profile_for_mode,
    profile_run,
)
from .training_setup import DATASET_ROOT_PLACEHOLDER, ensure_training_setup


TRAINING_PLAN_VERSION = 1
REVIEW_PLAN_VERSION = 3
_review_lock = threading.RLock()


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


def _json_fingerprint(payload):
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _file_fingerprint(path):
    target = Path(path)
    return "sha256:" + hashlib.sha256(target.read_bytes()).hexdigest()


def _stage_names(profile, run_id):
    selected, selected_run = profile_run(profile["id"], run_id or profile["runs"][0]["id"])
    return tuple(selected_run["stages"]), selected_run


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
        images = {}
        for entry in data.get("datasetEntries", []):
            if entry.get("kind") != "image":
                continue
            ar_label = str(entry.get("ar") or "")
            bucket = entry.get("bucket") or []
            if ar_label in ASPECT_RATIOS and len(bucket) >= 2:
                images.setdefault(ar_label, []).append([int(bucket[0]), int(bucket[1])])
        stages[stage] = {"targetSteps": int(data.get("targetSteps") or _default_target_steps(stage)), "imageBuckets": images}
    return {"version": TRAINING_PLAN_VERSION, "revision": 1, "stages": stages, "videoRoles": _normal_roles(profile_id), "datasetFingerprints": {}}


def _folder_plan_state(folder):
    state_path = Path(folder) / ".webcap_state.json"
    state = read_folder_state(state_path)
    raw = state.get("trainingPlan")
    if not isinstance(raw, dict) or raw.get("version") != TRAINING_PLAN_VERSION or not isinstance(raw.get("profiles"), dict):
        raw = {"version": TRAINING_PLAN_VERSION, "profiles": {}}
    return state_path, state, raw


def _write_profile_plan(folder, profile_id, profile_plan, expected_revision=None):
    with _review_lock:
        state_path, state, root = _folder_plan_state(folder)
        current = root["profiles"].get(profile_id)
        current_revision = int(current.get("revision") or 0) if isinstance(current, dict) else 0
        if expected_revision is not None and current_revision != int(expected_revision):
            raise ValueError("Training Review changed in another window. Reload the review and retry.")
        updated = deepcopy(profile_plan)
        updated["version"] = TRAINING_PLAN_VERSION
        updated["revision"] = current_revision + 1
        root["profiles"][profile_id] = updated
        state["trainingPlan"] = root
        write_folder_state_atomic(state_path, state)
        return updated


def _read_profile_plan(folder, profile_id, manifest, setup):
    with _review_lock:
        state_path, state, root = _folder_plan_state(folder)
        plan = root["profiles"].get(profile_id)
        if isinstance(plan, dict) and plan.get("version") == TRAINING_PLAN_VERSION:
            return deepcopy(plan)
        plan = _default_profile_plan(folder, profile_id, manifest, setup)
        root["profiles"][profile_id] = plan
        state["trainingPlan"] = root
        write_folder_state_atomic(state_path, state)
        return deepcopy(plan)


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
    return output


def normalize_profile_plan(raw, profile_id, setup):
    source = raw if isinstance(raw, dict) else {}
    valid_stages = [item["id"] for item in setup["configs"]]
    output = {"version": TRAINING_PLAN_VERSION, "revision": int(source.get("revision") or 0), "stages": {}, "videoRoles": [], "datasetFingerprints": {}}
    if isinstance(source.get("customDataset"), dict):
        output["customDataset"] = deepcopy(source["customDataset"])
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
    selected = sorted((tuple(item) for item in buckets), key=lambda item: item[0] * item[1], reverse=True)
    assigned = {bucket: [] for bucket in selected}
    uncovered = []
    for image in rows:
        chosen, status = None, ""
        for bucket in selected:
            status = image_bucket_compatibility(image, bucket, IMAGE_BUCKET_MAX_UPSCALE_RATIO)
            if status:
                chosen = bucket
                break
        if chosen is None:
            uncovered.append(image[0])
            continue
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
    return {"version": REVIEW_PLAN_VERSION, "profileId": profile_id, "mode": "review", "stages": stages, "excluded": all_excluded}


def _render_stage_dataset(stage_plan):
    entries = stage_plan.get("datasetEntries") or []
    lines = ["# webcap_training_review = 1", "# This file is generated from the Training Review plan."]
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
        lines.append(render_dataset_entry(rendered, int(entry.get("numRepeats") or 1)))
    return "\n\n".join(lines) + "\n"


def _dataset_paths(setup):
    return {item["id"]: item["dataset"] for item in setup["configs"]}


def _write_structured_datasets(folder, setup, review_plan, profile_plan):
    fingerprints = dict(profile_plan.get("datasetFingerprints") or {})
    for stage, filename in _dataset_paths(setup).items():
        text = _render_stage_dataset((review_plan.get("stages") or {}).get(stage, {}))
        destination = Path(folder) / filename
        destination.write_text(text, encoding="utf-8")
        normalize_path_permissions(destination)
        fingerprints[stage] = _file_fingerprint(destination)
    profile_plan["datasetFingerprints"] = fingerprints


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
    try:
        parsed = tomllib.loads(text)
    except tomllib.TOMLDecodeError:
        return None
    directories = parsed.get("directory")
    if not isinstance(directories, list):
        return None
    imported = deepcopy(profile_plan)
    stage_plan = imported.get("stages", {}).get(stage)
    if not isinstance(stage_plan, dict):
        return None
    stage_plan["imageBuckets"] = {}
    roles = {item["id"]: item for item in imported.get("videoRoles", [])}
    for role in roles.values():
        role["buckets"] = {}
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
            stage_plan["imageBuckets"].setdefault(ar_label, []).append([bucket[0], bucket[1]])
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
        role["buckets"].setdefault(ar_label, []).append([bucket[0], bucket[1]])
    return imported


def _sync_dataset_edits(folder, setup, profile_id, profile_plan):
    """Keep user TOMLs intact unless their simple bucket shape maps to Review."""
    fingerprints = profile_plan.get("datasetFingerprints") if isinstance(profile_plan.get("datasetFingerprints"), dict) else {}
    current = deepcopy(profile_plan)
    imported_any = False
    for config in setup["configs"]:
        stage = config["id"]
        path = Path(folder) / config["dataset"]
        try:
            text = path.read_text(encoding="utf-8")
            fingerprint = _file_fingerprint(path)
        except (OSError, UnicodeError):
            continue
        if text.startswith("# webcap_training_review = 1") or fingerprints.get(stage) == fingerprint:
            continue
        imported = _import_representable_dataset(text, profile_id, stage, current)
        if imported is None:
            current["customDataset"] = {"stage": stage, "message": path.name + " has custom dataset stanzas. Reset buckets to return to structured controls."}
            return current, False
        current = imported
        imported_any = True
    current.pop("customDataset", None)
    return current, imported_any


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


def _candidate_counts(profile_id, profile_plan, manifest, ladders):
    image_by_aspect = {ar: [] for ar in ASPECT_RATIOS}
    for (_directory, ar_label), rows in _image_rows(manifest).items():
        image_by_aspect.setdefault(ar_label, []).extend(rows)
    output = {"images": {}, "videos": {}}
    for stage, stage_plan in (profile_plan.get("stages") or {}).items():
        output["images"][stage] = {}
        for ar_label, candidates in ladders.get("images", {}).items():
            enabled = [tuple(item) for item in (stage_plan.get("imageBuckets") or {}).get(ar_label, [])]
            output["images"][stage][ar_label] = {}
            for candidate in candidates:
                bucket = tuple(candidate)
                assignments, _uncovered = _assign_images(image_by_aspect.get(ar_label, []), list(dict.fromkeys(enabled + [bucket])))
                output["images"][stage][ar_label][str(bucket[0]) + "x" + str(bucket[1])] = len(assignments.get(bucket, []))

    profile = profile_for_mode(profile_id, "normal")
    model_fps = profile.get("videoFps")
    video_by_aspect = {ar: [] for ar in ASPECT_RATIOS}
    for row in manifest.get("videos", []):
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "")
        try:
            width, height = int(row.get("width")), int(row.get("height"))
        except (TypeError, ValueError):
            continue
        frames = coerce_frames(row, model_fps)
        if ar_label in video_by_aspect and frames:
            video_by_aspect[ar_label].append((width, height, int(frames)))
    for role in profile_plan.get("videoRoles", []):
        role_name = role["id"]
        role_frames = int(role["frames"])
        output["videos"][role_name] = {}
        for ar_label, candidates in (ladders.get("videos", {}).get(role_name) or {}).items():
            enabled = [tuple(item) for item in (role.get("buckets") or {}).get(ar_label, [])]
            output["videos"][role_name][ar_label] = {}
            for candidate in candidates:
                bucket = tuple(candidate)
                selected = sorted(set(enabled + [bucket]), key=lambda item: item[0] * item[1], reverse=True)
                count = 0
                for width, height, frames in video_by_aspect.get(ar_label, []):
                    if frames < role_frames or not selected:
                        continue
                    chosen = next((item for item in selected if width >= item[0] and height >= item[1]), selected[-1])
                    if chosen == bucket:
                        count += 1
                output["videos"][role_name][ar_label][str(bucket[0]) + "x" + str(bucket[1])] = count
    return output


def _effective_tomls(folder, setup):
    output = {}
    for item in setup["configs"]:
        config_path = Path(folder) / item["file"]
        dataset_path = Path(folder) / item["dataset"]
        output[item["id"]] = {
            "configName": item["file"],
            "configText": config_path.read_text(encoding="utf-8"),
            "datasetName": item["dataset"],
            "datasetText": dataset_path.read_text(encoding="utf-8"),
        }
    return output


def prepare_training_review(folder, profile_id, run_id="", selected_media=None, selection_criteria=None, total_media_count=None, fallback_captions=None, persist=True, resume_action_id=""):
    folder = Path(folder)
    if resume_action_id:
        action_root, action = read_action(str(resume_action_id))
        try:
            relative_folder = folder.resolve().relative_to(Path(app_config.FS_ROOT).resolve()).as_posix()
        except ValueError as exc:
            raise ValueError("Training set is outside the configured root.") from exc
        if action.get("folder") != relative_folder:
            raise ValueError("The selected checkpoint belongs to another set.")
        plan_path = action_root / "record" / "training_plan.json"
        try:
            reviewed = json.loads(plan_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("The selected checkpoint has no readable immutable Training Review.") from exc
        if not isinstance(reviewed, dict) or not isinstance(reviewed.get("stages"), dict):
            raise ValueError("The selected checkpoint has an invalid immutable Training Review.")
        record_review = action.get("record", {}).get("review") if isinstance(action.get("record"), dict) else {}
        effective = {}
        for stage in reviewed["stages"]:
            try:
                item = config_for_stage(profile_id, stage, action.get("mode") or "normal")
                config_path = action_root / "record" / "configs" / item["file"]
                dataset_path = action_root / "record" / "configs" / item["dataset"]
                effective[stage] = {
                    "configName": item["file"], "configText": config_path.read_text(encoding="utf-8"),
                    "datasetName": item["dataset"], "datasetText": dataset_path.read_text(encoding="utf-8"),
                }
            except (OSError, ValueError):
                continue
        return {
            "ok": True, "profileId": profile_id, "runId": run_id,
            "reviewFingerprint": str(record_review.get("fingerprint") or _json_fingerprint(reviewed)),
            "plan": {"revision": 0, "stages": {}, "videoRoles": []}, "review": reviewed,
            "blockers": [], "warnings": list(record_review.get("warnings") or []), "ladders": {"images": {}, "videos": {}},
            "customDataset": False, "readOnly": True, "resumeActionId": str(resume_action_id),
            "effectiveToml": effective, "candidateCounts": {"images": {}, "videos": {}},
        }
    selected_media = list(selected_media or [])
    setup = _normal_setup(folder, profile_id, selected_media, selection_criteria, total_media_count)
    review_setup = _setup_for_run(setup, profile_id, run_id)
    manifest = build_dataset_manifest(folder, selected_media=selected_media, selection_criteria=selection_criteria, total_media_count=total_media_count)
    profile_plan = normalize_profile_plan(_read_profile_plan(folder, profile_id, manifest, setup), profile_id, setup)
    profile_plan, imported_manual_dataset = _sync_dataset_edits(folder, review_setup, profile_id, profile_plan)
    profile_plan = normalize_profile_plan(profile_plan, profile_id, setup)
    reviewed = _build_review_plan(folder, profile_id, review_setup, manifest, profile_plan)
    blockers = []
    warnings = []
    if not selected_media:
        blockers.append({"code": "no_visible_media", "message": "No visible media items are selected for training.", "files": []})
    fallback = fallback_captions if isinstance(fallback_captions, dict) else {}
    for name in selected_media:
        source = folder / str(name)
        caption = source.with_suffix(".txt")
        try:
            caption_ok = caption.is_file() and bool(caption.read_text(encoding="utf-8").strip())
        except OSError:
            caption_ok = False
        if not caption_ok and not str(fallback.get(str(name)) or "").strip():
            blockers.append({"code": "missing_caption", "message": "No caption or fallback is available.", "files": [str(name)]})
    excluded = reviewed.get("excluded") or []
    if excluded:
        warnings.append({"code": "excluded_media", "message": str(len(excluded)) + " selected media item(s) are not covered by the current bucket plan.", "files": [item.get("file") for item in excluded]})
    usable = sum(len(stage.get("datasetEntries") or []) for stage in reviewed.get("stages", {}).values())
    if not usable:
        blockers.append({"code": "no_trainable_media", "message": "The reviewed plan contains no trainable media.", "files": []})
    custom_dataset = profile_plan.get("customDataset") if isinstance(profile_plan.get("customDataset"), dict) else None
    if custom_dataset:
        blockers.append({"code": "custom_dataset", "message": custom_dataset["message"], "files": []})
    if persist and not custom_dataset:
        _write_structured_datasets(folder, review_setup, reviewed, profile_plan)
        # Fingerprints are bookkeeping, not a user edit, so preserve revision.
        with _review_lock:
            state_path, state, root = _folder_plan_state(folder)
            saved = deepcopy(profile_plan)
            saved["revision"] = int((root["profiles"].get(profile_id) or {}).get("revision") or profile_plan.get("revision") or 1)
            root["profiles"][profile_id] = saved
            state["trainingPlan"] = root
            write_folder_state_atomic(state_path, state)
            profile_plan = saved
    fingerprint = _json_fingerprint({
        "profile": profile_id, "run": run_id, "plan": profile_plan, "review": reviewed,
        "selection": manifest.get("selection"), "fallback": sorted((str(k), str(v)) for k, v in fallback.items()),
        "configs": {item["id"]: _file_fingerprint(folder / item["file"]) for item in setup["configs"]},
    })
    ladders = _ladders(profile_id, profile_plan, manifest)
    return {
        "ok": not blockers, "profileId": profile_id, "runId": run_id, "reviewFingerprint": fingerprint,
        "plan": profile_plan, "review": reviewed, "blockers": blockers, "warnings": warnings,
        "ladders": ladders, "candidateCounts": _candidate_counts(profile_id, profile_plan, manifest, ladders),
        "effectiveToml": _effective_tomls(folder, review_setup), "customDataset": custom_dataset or False,
    }


def update_training_review(folder, profile_id, payload):
    source = payload if isinstance(payload, dict) else {}
    selected_media = list(source.get("selected_media") or [])
    selection_criteria = source.get("selection_criteria")
    total_media_count = source.get("total_media_count")
    setup = _normal_setup(folder, profile_id, selected_media, selection_criteria, total_media_count)
    manifest = build_dataset_manifest(folder, selected_media=selected_media, selection_criteria=selection_criteria, total_media_count=total_media_count)
    current = _read_profile_plan(folder, profile_id, manifest, setup)
    expected = source.get("revision")
    if expected is not None and int(expected) != int(current.get("revision") or 0):
        raise ValueError("Training Review changed in another window. Reload the review and retry.")
    reset = str(source.get("reset") or "")
    if reset in ("settings", "all"):
        for config in setup["configs"]:
            reset_training_config_file(folder, config["file"], profile_id=profile_id, mode="normal")
    if reset in ("buckets", "all"):
        current = _default_profile_plan(folder, profile_id, manifest, setup)
    if isinstance(source.get("plan"), dict) and reset not in ("buckets", "all"):
        current = source["plan"]
    normalized = normalize_profile_plan(current, profile_id, setup)
    settings = source.get("settings") if isinstance(source.get("settings"), dict) else {}
    valid_stages = {item["id"]: item for item in setup["configs"]}
    for stage, values in settings.items():
        if stage not in valid_stages or not isinstance(values, dict):
            raise ValueError("Training Review received an unknown config stage.")
        path = Path(folder) / valid_stages[stage]["file"]
        path.write_text(apply_review_config_settings(path.read_text(encoding="utf-8"), values), encoding="utf-8")
        normalize_path_permissions(path)
    saved = _write_profile_plan(folder, profile_id, normalized, expected_revision=expected)
    return prepare_training_review(
        folder, profile_id, source.get("runId") or "", selected_media, selection_criteria, total_media_count,
        source.get("fallback_captions"), persist=True,
    )


def _initializer_id(action_id, stage, relative_export):
    return hashlib.sha256((str(action_id) + "\0" + str(stage) + "\0" + str(relative_export)).encode("utf-8")).hexdigest()[:24]


def _adapter_shape(path):
    try:
        parsed = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError):
        return None
    adapter = parsed.get("adapter") if isinstance(parsed.get("adapter"), dict) else {}
    rank = adapter.get("rank")
    if not isinstance(rank, int) or isinstance(rank, bool) or rank <= 0:
        return None
    # These are adapter-shape settings, not runtime choices.  If either is
    # present in both configs it must agree for an existing LoRA to load.
    shape = {"rank": rank}
    for key in ("type", "target_modules"):
        if key in adapter:
            shape[key] = adapter[key]
    return shape


def _optimizer_lr(path):
    try:
        parsed = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, tomllib.TOMLDecodeError):
        return None
    optimizer = parsed.get("optimizer") if isinstance(parsed.get("optimizer"), dict) else {}
    value = optimizer.get("lr")
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0 else None


def _initializer_compatibility(folder, profile_id, stage, action_root):
    target = config_for_stage(profile_id, stage, "normal")
    source_shape = _adapter_shape(Path(action_root) / "record" / "configs" / target["file"])
    target_shape = _adapter_shape(Path(folder) / target["file"])
    if source_shape is None or target_shape is None:
        return False, "Could not verify the source or current adapter shape."
    for key in set(source_shape) | set(target_shape):
        if source_shape.get(key) != target_shape.get(key):
            return False, "Initializer adapter " + key.replace("_", " ") + " does not match the current model settings."
    return True, ""


def discover_saved_initializers(folder, profile_id, stage):
    """Discover only current-set managed epoch exports, never arbitrary files."""
    try:
        relative_folder = Path(folder).resolve().relative_to(Path(app_config.FS_ROOT).resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("Training set is outside the configured root.") from exc
    wanted_stage = str(stage or "").strip()
    output = []
    for action_root, action in managed_action_children():
        if action.get("folder") != relative_folder or action.get("profileId") != profile_id:
            continue
        for record in (action.get("outputs") or {}).get(wanted_stage, []):
            if not isinstance(record, dict):
                continue
            relative_run = str(record.get("path") or "")
            run_dir = action_root / relative_run
            try:
                run_dir.resolve().relative_to(action_root.resolve())
            except ValueError:
                continue
            if not run_dir.is_dir() or run_dir.is_symlink():
                continue
            for export in run_dir.iterdir():
                match = re.match(r"^epoch(\d+)$", export.name, re.IGNORECASE)
                if not match or not export.is_dir() or export.is_symlink():
                    continue
                weights = [child for child in export.iterdir() if child.is_file() and not child.is_symlink() and child.suffix.lower() == ".safetensors"]
                relative_export = export.relative_to(action_root).as_posix()
                shape_ok, shape_reason = _initializer_compatibility(folder, profile_id, wanted_stage, action_root)
                compatible = len(weights) == 1 and shape_ok
                source_config = action_root / "record" / "configs" / config_for_stage(profile_id, wanted_stage, "normal")["file"]
                output.append({
                    "exportId": _initializer_id(action.get("actionId"), wanted_stage, relative_export),
                    "actionId": action.get("actionId"), "runName": action.get("runName") or action.get("actionId"),
                    "stage": wanted_stage, "epoch": int(match.group(1)), "path": relative_export,
                    "weights": [{"name": child.name, "bytes": child.stat().st_size} for child in weights],
                    "optimizerLr": _optimizer_lr(source_config),
                    "compatible": compatible,
                    "reason": "" if compatible else ("Initializer directory must contain exactly one direct .safetensors file." if len(weights) != 1 else shape_reason),
                })
    output.sort(key=lambda item: (item["compatible"], item["epoch"]), reverse=True)
    return output


def resolve_saved_initializer(folder, profile_id, stage, action_id, export_id):
    candidate = next((item for item in discover_saved_initializers(folder, profile_id, stage)
                      if item["actionId"] == str(action_id or "") and item["exportId"] == str(export_id or "")), None)
    if candidate is None:
        raise ValueError("Saved LoRA initializer is unavailable or no longer compatible.")
    if not candidate["compatible"]:
        raise ValueError(candidate["reason"])
    action_root = next((root for root, data in managed_action_children() if data.get("actionId") == candidate["actionId"]), None)
    if action_root is None:
        raise ValueError("Initializer action is unavailable.")
    export = action_root / candidate["path"]
    return {**candidate, "sourcePath": export}
