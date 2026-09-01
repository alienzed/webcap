import json
import hashlib
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME, default_training_config_epochs
from .training_profiles import KREA2_PROFILE_ID, MINIMAX_H3_PROFILE_ID, WAN21_PROFILE_ID, WAN22_PROFILE_ID, config_for_stage, profile as training_profile

ASPECT_RATIOS = {
    "square": 1.0,
    "43": 4 / 3,
    "34": 3 / 4,
    "169": 16 / 9,
    "916": 9 / 16,
}
AR_TOL = 0.05
MAX_SQUARE_DIM = 768
MAX_NON_SQUARE_LONG = 1280
MAX_NON_SQUARE_SHORT = 768
MAX_IMAGE_MFP = 600
H3_QUALITY_MAX_IMAGE_MFP = 1008
IMAGE_BUCKET_MAX_UPSCALE_RATIO = 1.15

TRAINING_MODE_TARGETS = {
    "poc": {
        "square": (384, 384),
        "43": (448, 336),
        "34": (336, 448),
        "169": (512, 288),
        "916": (288, 512),
    },
    "normal": {
        "square": (512, 512),
        "43": (640, 480),
        "34": (480, 640),
        "169": (736, 416),
        "916": (416, 736),
    },
    "quality": {
        "square": (768, 768),
        "43": (1024, 768),
        "34": (768, 1024),
        "169": (1024, 576),
        "916": (576, 1024),
    },
}

H3_QUALITY_IMAGE_TARGETS = {
    "square": (768, 768),
    "43": (1024, 768),
    "34": (768, 1024),
    "169": (1344, 768),
    "916": (768, 1344),
}

IMAGE_MODE_CAPS = {
    # Fast, forgiving defaults for quick proofs.
    "poc": {
        "square_dim": 512,
        "non_square_long": 768,
        "non_square_short": 512,
    },
    # Balanced quality while staying within practical local training limits.
    "normal": {
        "square_dim": 768,
        "non_square_long": 1024,
        "non_square_short": 768,
    },
    # Snob mode can stay close to normal; quality bias comes from bucket choice.
    "quality": {
        "square_dim": 768,
        "non_square_long": 1024,
        "non_square_short": 768,
    },
}

PREP_MANIFEST_NAME = "prep_manifest.json"
VIDEO_MFP_LIMIT = 11000
# H3 buckets use 32x32 latent cells. 11,900 cells is 12.19 raw MegaFramePixels.
H3_VIDEO_MFP_LIMIT = 11900
# Conservative ceilings for uncalibrated active H3 video roles.  A matching
# calibration replaces (rather than clamps) the matching role/aspect ceiling.
H3_VIDEO_MODE_CEILINGS = {
    "normal": {
        "square": {"temporal": (352, 352), "detail": (736, 736)},
        "43": {"temporal": (416, 320), "detail": (896, 672)},
        "34": {"temporal": (320, 416), "detail": (672, 896)},
        "169": {"temporal": (448, 256), "detail": (1024, 576)},
        "916": {"temporal": (256, 448), "detail": (576, 1024)},
    },
    "quality": {
        "square": {"temporal": (352, 352), "detail": (736, 736)},
        "43": {"temporal": (416, 320), "detail": (896, 672)},
        "34": {"temporal": (320, 416), "detail": (672, 896)},
        "169": {"temporal": (448, 256), "detail": (1024, 576)},
        "916": {"temporal": (256, 448), "detail": (576, 1024)},
    },
}
# Calibration is only valid inside the model/probe envelope.  These are video
# limits, not image caps: H3 images retain their existing resolution classes.
H3_VIDEO_ABSOLUTE_CEILINGS = {
    "square": (768, 768), "43": (1024, 768), "34": (768, 1024),
    "169": (1344, 768), "916": (768, 1344),
}
REPEAT_TARGET_STEPS = {
    "poc": {"hi": 5000, "lo": 20000},
    "normal": {"hi": 5000, "lo": 20000},
    "quality": {"hi": 5000, "lo": 20000},
}
TRAINING_PLAN_FILE_NAME = "training_plan.json"
VIDEO_TEMPORAL_REPEAT_WEIGHT = 1.0
VIDEO_DETAIL_REPEAT_WEIGHT = 0.25
IMAGE_REPEAT_WEIGHT = 1.0
# Roles are data, not model-specific selection branches.  POC keeps one cheaper
# temporal role; Normal and Quality add a shorter, high-detail role.
VIDEO_ROLE_TABLE = {
    WAN22_PROFILE_ID: {
        "poc": (("temporal", 33, VIDEO_TEMPORAL_REPEAT_WEIGHT),),
        "normal": (("temporal", 37, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 13, VIDEO_DETAIL_REPEAT_WEIGHT)),
        "quality": (("temporal", 37, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 13, VIDEO_DETAIL_REPEAT_WEIGHT)),
    },
    WAN21_PROFILE_ID: {
        "poc": (("temporal", 33, VIDEO_TEMPORAL_REPEAT_WEIGHT),),
        "normal": (("temporal", 37, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 13, VIDEO_DETAIL_REPEAT_WEIGHT)),
        "quality": (("temporal", 37, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 13, VIDEO_DETAIL_REPEAT_WEIGHT)),
    },
    MINIMAX_H3_PROFILE_ID: {
        "poc": (("temporal", 34, VIDEO_TEMPORAL_REPEAT_WEIGHT),),
        "normal": (("temporal", 68, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 17, VIDEO_DETAIL_REPEAT_WEIGHT)),
        "quality": (("temporal", 68, VIDEO_TEMPORAL_REPEAT_WEIGHT), ("detail", 17, VIDEO_DETAIL_REPEAT_WEIGHT)),
    },
}


def normalize_training_generate_mode(mode):
    text = str(mode or "normal").strip().lower()
    if text not in TRAINING_MODE_TARGETS:
        text = "normal"
    return text


def repeat_targets_for_mode(mode: str):
    normalized = normalize_training_generate_mode(mode)
    targets = REPEAT_TARGET_STEPS[normalized]
    return int(targets["hi"]), int(targets["lo"])


_EPOCHS_PATTERN = re.compile(rb"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)


def read_epochs_from_training_config(path: Path, fallback: int):
    if not path.exists() or not path.is_file():
        return int(fallback)
    try:
        raw = path.read_bytes()
    except OSError:
        return int(fallback)
    match = _EPOCHS_PATTERN.search(raw)
    if not match:
        return int(fallback)
    return max(1, int(match.group(1)))


def solve_repeat_scalar(entries, target_steps: int, epochs: int):
    base = 0.0
    for entry in entries:
        base += float(entry["sample_count"]) * float(entry["repeat_weight"])
    if base <= 0:
        return 1, 0.0
    scalar = int(math.ceil(float(target_steps) / (float(epochs) * base)))
    if scalar < 1:
        scalar = 1
    return scalar, base


def build_repeats(entries, scalar: int):
    repeats = []
    for entry in entries:
        repeats.append(max(1, int(math.ceil(float(scalar) * float(entry["repeat_weight"])))))
    return repeats


def estimate_steps(entries, repeats, epochs: int):
    per_epoch = 0
    for idx, entry in enumerate(entries):
        per_epoch += int(entry["sample_count"]) * int(repeats[idx])
    return int(epochs) * int(per_epoch)


def estimate_kind_exposures(entries, repeats, epochs: int, kind: str):
    selected_entries = []
    selected_repeats = []
    for idx, entry in enumerate(entries):
        if entry.get("kind") == kind:
            selected_entries.append(entry)
            selected_repeats.append(repeats[idx])
    return estimate_steps(selected_entries, selected_repeats, epochs)


def training_plan_entries(entries, repeats):
    """Return the auditable, per-stanza view of a generated dataset."""
    output = []
    for index, entry in enumerate(entries):
        bucket = entry.get("bucket")
        output.append({
            "kind": entry.get("kind"),
            "ar": entry.get("ar_label"),
            "role": entry.get("role"),
            "bucket": list(bucket) if bucket else [],
            "files": list(entry.get("files") or []),
            "eligibleCount": int(entry.get("sample_count") or 0),
            "nativeCount": int(entry.get("native_count", entry.get("sample_count", 0)) or 0),
            "upscaledCount": int(entry.get("upscaled_count") or 0),
            "limitingFiles": list(entry.get("limiting_files") or []),
            "numRepeats": int(repeats[index]),
            "repeatWeight": float(entry.get("repeat_weight", 1.0) or 1.0),
            "sourceDir": str(entry.get("sourceDir") or ""),
            "detailIntent": bool(entry.get("detail_intent")),
        })
    return output


def build_dataset_config_artifacts(folder_path: Path, manifest, dataset_root: Path, mode: str = "normal", profile_id: str = "", config_paths=None, selection_snapshot_lines=None):
    folder = Path(folder_path)
    dataset_root = Path(dataset_root)
    generate_mode = normalize_training_generate_mode(mode)
    lines = []
    lines.append(f"[INFO] Training generate mode: {generate_mode}")

    video_entries = build_video_blocks(
        dataset_root,
        manifest.get("videos", []),
        lines,
        mode=generate_mode,
        profile_id=profile_id,
        require_files=False,
    )
    lines.append(f"[INFO] Built {len(video_entries)} video directory block(s).")
    image_only_set = len(video_entries) == 0

    image_groups = {}
    for row in manifest.get("images", []):
        if not isinstance(row, dict):
            continue
        prepared_path = str(row.get("prepared_path") or "").strip()
        ar_label = str(row.get("ar") or "").strip()
        width = to_pos_int(row.get("width"))
        height = to_pos_int(row.get("height"))
        if not prepared_path or ar_label not in ASPECT_RATIOS or not width or not height:
            continue
        dir_name = Path(prepared_path).parent.name
        image_groups.setdefault((dir_name, ar_label), []).append((Path(prepared_path).name, width, height))
    lines.append(f"[INFO] Found {len(image_groups)} prepared image folder(s).")

    hi_image_entries = []
    lo_image_entries = []
    for (dir_name, ar_label), images in sorted(image_groups.items(), key=lambda item: item[0][0].lower()):
        image_dir = dataset_root / dir_name
        lines.append(f"[INFO] {dir_name}: {len(images)} image(s)")
        if not images:
            continue

        hi_selections, hi_unsupported = choose_image_resolution_classes(
            ar_label, images, mode=generate_mode, noise_profile="hi", profile_id=profile_id,
        )
        lo_selections, lo_unsupported = choose_image_resolution_classes(
            ar_label, images, mode=generate_mode, noise_profile="lo", profile_id=profile_id,
        )
        if hi_unsupported:
            lines.append(f"[WARN] {image_dir.name} (HI): minimum bucket still exceeds the 15% upscale policy: " + ", ".join(hi_unsupported))
        if lo_unsupported:
            lines.append(f"[WARN] {image_dir.name} (LO): minimum bucket still exceeds the 15% upscale policy: " + ", ".join(lo_unsupported))
        if not hi_selections:
            lines.append(f"[WARN] {image_dir.name} (HI): no image bucket selected.")
        else:
            hi_label = "bucket" if len(hi_selections) == 1 else "bucket(s)"
            lines.append(
                f"[INFO] {image_dir.name}: selected HI image {hi_label}: "
                + ", ".join(f"{item['bucket'][0]}x{item['bucket'][1]}" for item in hi_selections)
            )
            for selection in hi_selections:
                hi_bucket = selection["bucket"]
                lines.append(
                    f"[INFO] {image_dir.name} (HI) stanza {hi_bucket[0]}x{hi_bucket[1]}: "
                    f"{len(selection['images'])} image(s), {selection['native_count']} native, "
                    f"{selection['upscaled_count']} slight-upscale"
                )
                hi_image_entries.append({
                    "kind": "image", "path": image_dir, "ar_label": ar_label,
                    "bucket": hi_bucket, "role": "image",
                    "files": [image[0] for image in selection["images"]],
                    "native_count": selection["native_count"],
                    "upscaled_count": selection["upscaled_count"],
                    "limiting_files": selection.get("limiting_files", []),
                    "sample_count": max(1, len(selection["images"])),
                    "repeat_weight": IMAGE_REPEAT_WEIGHT,
                })
        if not lo_selections:
            lines.append(f"[WARN] {image_dir.name} (LO): no image bucket selected.")
        else:
            lo_label = "bucket" if len(lo_selections) == 1 else "bucket(s)"
            lines.append(
                f"[INFO] {image_dir.name}: selected LO image {lo_label}: "
                + ", ".join(f"{item['bucket'][0]}x{item['bucket'][1]}" for item in lo_selections)
            )
            for selection in lo_selections:
                lo_bucket = selection["bucket"]
                lines.append(
                    f"[INFO] {image_dir.name} (LO) stanza {lo_bucket[0]}x{lo_bucket[1]}: "
                    f"{len(selection['images'])} image(s), {selection['native_count']} native, "
                    f"{selection['upscaled_count']} slight-upscale"
                )
                lo_image_entries.append({
                    "kind": "image", "path": image_dir, "ar_label": ar_label,
                    "bucket": lo_bucket, "role": "image",
                    "files": [image[0] for image in selection["images"]],
                    "native_count": selection["native_count"],
                    "upscaled_count": selection["upscaled_count"],
                    "limiting_files": selection.get("limiting_files", []),
                    "sample_count": max(1, len(selection["images"])),
                    "repeat_weight": IMAGE_REPEAT_WEIGHT,
                })

    hi_entries = []
    hi_entries.extend(video_entries)
    hi_entries.extend(hi_image_entries)
    lo_entries = []
    lo_entries.extend(video_entries)
    lo_entries.extend(lo_image_entries)

    single_stage_profiles = {
        KREA2_PROFILE_ID: "krea2",
        WAN21_PROFILE_ID: "wan21",
        MINIMAX_H3_PROFILE_ID: "h3",
    }
    single_stage = str(profile_id or "") in single_stage_profiles
    krea2_profile = str(profile_id or "") == KREA2_PROFILE_ID
    single_stage_name = single_stage_profiles.get(str(profile_id or ""), "wan21")
    lo_run_entries = lo_image_entries if krea2_profile else lo_entries
    if krea2_profile and not lo_run_entries:
        raise ValueError("Krea2 Raw requires at least one prepared image.")
    if krea2_profile and manifest.get("videos"):
        excluded_videos = sum(1 for row in manifest.get("videos", []) if isinstance(row, dict))
        lines.append(f"[INFO] Krea2 Raw: excluded {excluded_videos} prepared video(s).")
    if profile_id == MINIMAX_H3_PROFILE_ID and not lo_run_entries:
        minimum_h3_frames = 34 if generate_mode == "poc" else 17
        raise ValueError(f"MiniMax H3 requires at least one prepared image or one video with at least {minimum_h3_frames} frames.")
    hi_target_steps, lo_target_steps = repeat_targets_for_mode(generate_mode)
    default_hi_epochs, default_lo_epochs = default_training_config_epochs()
    config_paths = dict(config_paths or {})
    hi_config_path = config_paths.get("hi", folder / HI_CONFIG_NAME)
    lo_stage = single_stage_name if single_stage else "lo"
    lo_config_path = config_paths.get(lo_stage, folder / (config_for_stage(profile_id, lo_stage, generate_mode)["file"] if profile_id else LO_CONFIG_NAME))
    hi_epochs = read_epochs_from_training_config(hi_config_path, default_hi_epochs)
    lo_epochs = read_epochs_from_training_config(lo_config_path, default_lo_epochs)
    hi_scalar, hi_base = solve_repeat_scalar(hi_entries, hi_target_steps, hi_epochs)
    lo_scalar, lo_base = solve_repeat_scalar(lo_run_entries, lo_target_steps, lo_epochs)
    hi_repeats = build_repeats(hi_entries, hi_scalar)
    lo_repeats = build_repeats(lo_run_entries, lo_scalar)
    hi_est = estimate_steps(hi_entries, hi_repeats, hi_epochs)
    lo_est = estimate_steps(lo_run_entries, lo_repeats, lo_epochs)
    hi_image_exposures = estimate_kind_exposures(hi_entries, hi_repeats, hi_epochs, "image")
    hi_video_exposures = estimate_kind_exposures(hi_entries, hi_repeats, hi_epochs, "video")
    lo_image_exposures = estimate_kind_exposures(lo_run_entries, lo_repeats, lo_epochs, "image")
    lo_video_exposures = estimate_kind_exposures(lo_run_entries, lo_repeats, lo_epochs, "video")
    training_stages = {
        "hi": {"epochs": hi_epochs, "targetSteps": hi_target_steps, "estimatedSteps": hi_est, "estimatedImageExposures": hi_image_exposures, "estimatedVideoExposures": hi_video_exposures, "datasetEntries": training_plan_entries(hi_entries, hi_repeats)},
        "lo": {"epochs": lo_epochs, "targetSteps": lo_target_steps, "estimatedSteps": lo_est, "estimatedImageExposures": lo_image_exposures, "estimatedVideoExposures": lo_video_exposures, "datasetEntries": training_plan_entries(lo_run_entries, lo_repeats)},
    }
    if single_stage:
        training_stages = {
            single_stage_name: {"epochs": lo_epochs, "targetSteps": lo_target_steps, "estimatedSteps": lo_est, "estimatedImageExposures": lo_image_exposures, "estimatedVideoExposures": lo_video_exposures, "datasetEntries": training_plan_entries(lo_run_entries, lo_repeats)},
        }
    training_plan = {
        "version": 2,
        "mode": generate_mode,
        "profileId": str(profile_id or "wan22_t2v"),
        "stages": training_stages,
    }
    lines.append(f"[INFO] Repeat targeting HI: target={hi_target_steps}, epochs={hi_epochs}, base={hi_base:.2f}, scalar={hi_scalar}, est_steps={hi_est}")
    lines.append(f"[INFO] Repeat targeting LO: target={lo_target_steps}, epochs={lo_epochs}, base={lo_base:.2f}, scalar={lo_scalar}, est_steps={lo_est}")
    if image_only_set:
        lines.append("[INFO] Image-only set detected: repeats solved from target steps.")

    hi_blocks = []
    lo_blocks = []
    for idx, entry in enumerate(hi_entries):
        hi_blocks.append(render_dataset_entry(entry, hi_repeats[idx]))
    for idx, entry in enumerate(lo_run_entries):
        lo_blocks.append(render_dataset_entry(entry, lo_repeats[idx]))

    hi_text = render_dataset_toml(hi_blocks, selection_snapshot_lines)
    lo_text = render_dataset_toml(lo_blocks, selection_snapshot_lines)
    return {
        "hiText": hi_text,
        "loText": lo_text,
        "plan": training_plan,
        "log": "\n".join(lines) + "\n",
    }


def generate_dataset_configs(folder_path: Path, mode: str = "normal", write_selection_snapshot_comments: bool = False, profile_id: str = ""):
    folder = Path(folder_path)
    dataset_root = folder / "auto_dataset"
    manifest_path = dataset_root / PREP_MANIFEST_NAME
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing prep manifest: {manifest_path}")
    manifest = load_prep_manifest(manifest_path)
    snapshot_lines = build_selection_snapshot_comment_lines(folder, dataset_root, manifest) if write_selection_snapshot_comments else None
    artifacts = build_dataset_config_artifacts(
        folder,
        manifest,
        dataset_root,
        mode=mode,
        profile_id=profile_id,
        selection_snapshot_lines=snapshot_lines,
    )
    lines = [artifacts["log"].rstrip()]
    metadata = {}
    for row in manifest.get("images", []):
        prepared_path = str(row.get("prepared_path") or "")
        directory = Path(prepared_path).parent.name
        if not directory:
            continue
        metadata.setdefault(directory, []).append({
            "name": Path(prepared_path).name,
            "width": to_pos_int(row.get("width")),
            "height": to_pos_int(row.get("height")),
        })
    metadata_path = dataset_root / "webcap_dataset_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    lines.append(f"[INFO] Wrote metadata cache: {metadata_path}")
    training_plan_path = dataset_root / TRAINING_PLAN_FILE_NAME
    training_plan_path.write_text(json.dumps(artifacts["plan"], indent=2), encoding="utf-8")
    lines.append(f"[INFO] Wrote training plan: {training_plan_path}")
    single_stage = str(profile_id or "") in {KREA2_PROFILE_ID, WAN21_PROFILE_ID, MINIMAX_H3_PROFILE_ID}
    if single_stage:
        train_path = folder / "dataset.train.toml"
        train_path.write_text(artifacts["loText"], encoding="utf-8")
        lines.append(f"[INFO] Wrote {train_path}")
    else:
        hi_path = folder / "dataset.hi.toml"
        lo_path = folder / "dataset.lo.toml"
        hi_path.write_text(artifacts["hiText"], encoding="utf-8")
        lo_path.write_text(artifacts["loText"], encoding="utf-8")
        lines.append(f"[INFO] Wrote {hi_path}")
        lines.append(f"[INFO] Wrote {lo_path}")

    return "\n".join(lines) + "\n"


def load_prep_manifest(manifest_path: Path):
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Prep manifest is not an object.")
    videos = data.get("videos", [])
    images = data.get("images", [])
    if not isinstance(videos, list):
        raise ValueError("Prep manifest videos must be a list.")
    if not isinstance(images, list):
        raise ValueError("Prep manifest images must be a list.")
    return data


def video_roles_for_profile(profile_id: str, mode: str):
    selected_profile_id = str(profile_id or WAN22_PROFILE_ID).strip().lower()
    generate_mode = normalize_training_generate_mode(mode)
    return VIDEO_ROLE_TABLE.get(selected_profile_id, {}).get(generate_mode, ())


def _h3_calibrated_ceiling(frames: int, ar_label: str):
    runtime_config = app_config.config if isinstance(app_config.config, dict) else {}
    training = runtime_config.get("training") if isinstance(runtime_config.get("training"), dict) else {}
    calibration = training.get("h3_calibration")
    if calibration is None:
        return None
    if not isinstance(calibration, dict):
        raise ValueError("training.h3_calibration must be an object.")
    safe_shapes = calibration.get("safe_shapes")
    if safe_shapes is None:
        return None
    if not isinstance(safe_shapes, dict):
        raise ValueError("training.h3_calibration.safe_shapes must be an object.")
    by_aspect = safe_shapes.get(str(frames))
    if by_aspect is None:
        return None
    if not isinstance(by_aspect, dict):
        raise ValueError("training.h3_calibration.safe_shapes." + str(frames) + " must be an object.")
    source_aspect = {"916": "169", "34": "43"}.get(ar_label, ar_label)
    shape = by_aspect.get(source_aspect)
    if shape is None:
        return None
    if not isinstance(shape, list) or len(shape) != 2 or not all(
        isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in shape
    ):
        raise ValueError(
            "training.h3_calibration.safe_shapes." + str(frames) + "." + source_aspect
            + " must be a two-item positive-integer shape."
        )
    if ar_label in ("916", "34"):
        return shape[1], shape[0]
    return shape[0], shape[1]


def _h3_calibration_campaign():
    runtime_config = app_config.config if isinstance(app_config.config, dict) else {}
    training = runtime_config.get("training") if isinstance(runtime_config.get("training"), dict) else {}
    calibration = training.get("h3_calibration")
    if calibration is None:
        return ""
    if not isinstance(calibration, dict):
        raise ValueError("training.h3_calibration must be an object.")
    return str(calibration.get("campaign") or "").strip()


def _h3_video_limit(profile_id: str, mode: str, ar_label: str, role: str):
    """Return the effective active-role H3 ceiling and its authority."""
    generate_mode = normalize_training_generate_mode(mode)
    baseline = H3_VIDEO_MODE_CEILINGS[generate_mode][ar_label][role]
    role_frames = next(
        (frames for name, frames, _weight in video_roles_for_profile(profile_id, generate_mode) if name == role),
        None,
    )
    calibrated = _h3_calibrated_ceiling(role_frames, ar_label) if role_frames else None
    if not calibrated:
        return {"ceiling": baseline, "source": "baseline", "campaign": ""}
    absolute = H3_VIDEO_ABSOLUTE_CEILINGS[ar_label]
    if calibrated[0] > absolute[0] or calibrated[1] > absolute[1]:
        raise ValueError(
            "H3 calibration " + str(role_frames) + "f " + ar_label + " "
            + str(calibrated[0]) + "x" + str(calibrated[1])
            + " exceeds the H3 model/probe envelope " + str(absolute[0]) + "x" + str(absolute[1]) + "."
        )
    return {"ceiling": calibrated, "source": "calibration", "campaign": _h3_calibration_campaign()}


def video_bucket_ladder(profile_id: str, mode: str, ar_label: str, role: str, frames: int):
    """Return one authoritative selectable/default video ladder for a role."""
    generate_mode = normalize_training_generate_mode(mode)
    selected_profile_id = str(profile_id or "").strip().lower()
    active_h3_role = selected_profile_id == MINIMAX_H3_PROFILE_ID and generate_mode != "poc"
    if active_h3_role:
        limit_info = _h3_video_limit(selected_profile_id, generate_mode, ar_label, role)
        ceiling = limit_info["ceiling"]
        absolute = H3_VIDEO_ABSOLUTE_CEILINGS[ar_label]
        candidates = [
            (w, h) for w, h, _area in generate_candidates_with_caps(
                ar_label,
                H3_VIDEO_ABSOLUTE_CEILINGS["square"][0],
                max(absolute),
                min(absolute),
            )
            if w <= ceiling[0] and h <= ceiling[1]
        ]
        # The old MFP heuristic remains a conservative baseline safeguard.  A
        # measured calibration is authoritative for exactly its frame/aspect.
        if limit_info["source"] == "baseline":
            candidates = [shape for shape in candidates if mfp(shape[0], shape[1], frames) <= H3_VIDEO_MFP_LIMIT]
        if limit_info["source"] == "calibration" and ceiling not in candidates:
            candidates.append(ceiling)
            candidates.sort(key=lambda shape: shape[0] * shape[1], reverse=True)
        default_candidates = candidates[1:] if len(candidates) > 1 else candidates
        return {
            "selectable": candidates,
            "defaults": default_candidates,
            "ceiling": ceiling,
            "defaultCeiling": default_candidates[0] if default_candidates else None,
            "source": limit_info["source"],
            "campaign": limit_info["campaign"],
        }

    ceiling = TRAINING_MODE_TARGETS[generate_mode][ar_label]
    if selected_profile_id == MINIMAX_H3_PROFILE_ID:
        role_frames = next((value for name, value, _weight in video_roles_for_profile(selected_profile_id, generate_mode) if name == role), None)
        calibrated = _h3_calibrated_ceiling(role_frames, ar_label) if role_frames else None
        if calibrated:
            ceiling = min(ceiling[0], calibrated[0]), min(ceiling[1], calibrated[1])
    candidates = [
        (w, h) for w, h, _area in generate_candidates(ar_label)
        if w <= ceiling[0] and h <= ceiling[1] and mfp(w, h, frames) <= VIDEO_MFP_LIMIT
    ]
    return {
        "selectable": candidates,
        "defaults": candidates,
        "ceiling": ceiling,
        "defaultCeiling": candidates[0] if candidates else None,
        "source": "baseline",
        "campaign": "",
    }


def video_role_ceiling(profile_id: str, mode: str, ar_label: str, role: str):
    frames = next(
        (value for name, value, _weight in video_roles_for_profile(profile_id, mode) if name == role),
        1,
    )
    return video_bucket_ladder(profile_id, mode, ar_label, role, frames)["ceiling"]


def _native_video_support(clips, bucket):
    return [clip for clip in clips if clip["width"] >= bucket[0] and clip["height"] >= bucket[1]]


def _choose_common_video_bucket(ar_label, clips, frames, profile_id, mode, role):
    candidates = video_bucket_ladder(profile_id, mode, ar_label, role, frames)["defaults"]
    if not candidates:
        return None, []
    for bucket in candidates:
        if len(_native_video_support(clips, bucket)) == len(clips):
            return bucket, []
    bucket = candidates[-1]
    unsupported = [clip["file"] for clip in clips if clip not in _native_video_support(clips, bucket)]
    return bucket, unsupported


def _choose_optional_detail_bucket(ar_label, clips, frames, profile_id, mode, role):
    for bucket in video_bucket_ladder(profile_id, mode, ar_label, role, frames)["defaults"]:
        members = _native_video_support(clips, bucket)
        if len(members) >= 2:
            return bucket, members
    return None, []


def build_video_blocks(dataset_root: Path, videos, lines, mode: str = "normal", profile_id: str = "", require_files=True):
    generate_mode = normalize_training_generate_mode(mode)
    selected_profile_id = str(profile_id or WAN22_PROFILE_ID).strip().lower()
    selected_profile = training_profile(selected_profile_id)
    model_fps = selected_profile.get("videoFps")
    roles = video_roles_for_profile(selected_profile_id, generate_mode)
    grouped = {key: [] for key in ASPECT_RATIOS}
    for row in videos:
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "").strip()
        width = to_pos_int(row.get("width"))
        height = to_pos_int(row.get("height"))
        prepared_path = str(row.get("prepared_path") or "").strip()
        frames = coerce_frames(row, model_fps)
        if ar_label not in grouped or not width or not height or not prepared_path or not frames:
            lines.append(f"[WARN] Skipped video {row.get('file') or prepared_path or '<unknown>'}: missing supported AR, dimensions, or frame metadata.")
            continue
        abs_prepared = dataset_root / prepared_path
        if require_files and not abs_prepared.exists():
            lines.append(f"[WARN] Skipped video {Path(prepared_path).name}: prepared media is missing.")
            continue
        grouped[ar_label].append({"file": Path(prepared_path).name, "width": width, "height": height, "frames": frames, "path": abs_prepared})

    entries = []
    if not roles:
        return entries
    temporal_role = roles[0]
    detail_role = roles[1] if len(roles) > 1 else None
    for ar_label, clips in grouped.items():
        if not clips:
            continue
        temporal_name, temporal_frames, temporal_weight = temporal_role
        minimum_frames = detail_role[1] if detail_role else temporal_frames
        too_short = [clip for clip in clips if clip["frames"] < minimum_frames]
        if too_short:
            lines.append(f"[WARN] {ar_label}: skipped {len(too_short)} clip(s) shorter than {minimum_frames} frames: " + ", ".join(clip["file"] for clip in too_short))
        temporal_clips = [clip for clip in clips if clip["frames"] >= temporal_frames]
        if temporal_clips:
            bucket, unsafe = _choose_common_video_bucket(
                ar_label, temporal_clips, temporal_frames, selected_profile_id, generate_mode, temporal_name,
            )
            if bucket:
                if unsafe:
                    lines.append(f"[WARN] {ar_label} temporal {bucket[0]}x{bucket[1]} @ {temporal_frames} exceeds native support for: " + ", ".join(unsafe))
                lines.append(f"[INFO] {ar_label}: temporal {bucket[0]}x{bucket[1]} @ {temporal_frames} ({len(temporal_clips)} clip(s))")
                entries.append({"kind": "video", "role": temporal_name, "ar_label": ar_label, "dir_path": (dataset_root / ar_label).as_posix(), "bucket": (bucket[0], bucket[1], temporal_frames), "files": [clip["file"] for clip in temporal_clips], "sample_count": len(temporal_clips), "native_count": len(temporal_clips) - len(unsafe), "upscaled_count": len(unsafe), "limiting_files": unsafe, "repeat_weight": temporal_weight})

        if not detail_role:
            continue
        detail_name, detail_frames, detail_weight = detail_role
        detail_eligible = [clip for clip in clips if clip["frames"] >= detail_frames]
        mandatory = [clip for clip in detail_eligible if clip["frames"] < temporal_frames]
        if mandatory:
            bucket, unsafe = _choose_common_video_bucket(
                ar_label, mandatory, detail_frames, selected_profile_id, generate_mode, detail_name,
            )
            if not bucket:
                continue
            members = list(mandatory)
            members.extend(clip for clip in temporal_clips if clip not in members and clip in _native_video_support(temporal_clips, bucket))
        else:
            bucket, members = _choose_optional_detail_bucket(
                ar_label, detail_eligible, detail_frames, selected_profile_id, generate_mode, detail_name,
            )
            unsafe = []
        if not bucket or not members:
            continue
        if unsafe:
            lines.append(f"[WARN] {ar_label} detail {bucket[0]}x{bucket[1]} @ {detail_frames} exceeds native support for mandatory clips: " + ", ".join(unsafe))
        lines.append(f"[INFO] {ar_label}: detail {bucket[0]}x{bucket[1]} @ {detail_frames} ({len(members)} clip(s), bundle subset)")
        entries.append({"kind": "video", "role": detail_name, "ar_label": ar_label, "dir_path": (dataset_root / ar_label).as_posix(), "bucket": (bucket[0], bucket[1], detail_frames), "files": [clip["file"] for clip in members], "sample_count": len(members), "native_count": len(members) - len(unsafe), "upscaled_count": len(unsafe), "limiting_files": unsafe, "repeat_weight": detail_weight, "detail_intent": True})
    return entries


def to_pos_int(value):
    try:
        parsed = int(value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def to_pos_float(value):
    try:
        parsed = float(value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def coerce_frames(record, model_fps=None):
    frames = to_pos_int(record.get("frames"))
    source_fps = to_pos_float(record.get("fps"))
    duration = to_pos_float(record.get("duration"))
    target_fps = to_pos_float(model_fps)
    if target_fps and duration:
        return max(1, int(duration * target_fps))
    if target_fps and frames and source_fps:
        return max(1, int((float(frames) / source_fps) * target_fps))
    return frames


def render_video_block(dir_path: str, bucket, num_repeats: int = 1, detail_intent=False):
    repeats = int(num_repeats) if isinstance(num_repeats, int) else 1
    if repeats < 1:
        repeats = 1
    lines = [
        "[[directory]]",
        f'path = "{dir_path}"',
        f"num_repeats = {repeats}",
        'group = "videos"',
        "# webcap_detail_subset = true" if detail_intent else "",
        "size_buckets = [",
    ]
    w, h, frames = bucket
    mfp_val = (w * h * frames) / 1_000_000
    lines.append(f"  [{w}, {h}, {frames}],  # MegaFramePixels: {mfp_val:.2f}M")
    lines.append("]")
    return "\n".join(line for line in lines if line)


def generate_candidates(ar_label: str):
    return generate_candidates_with_caps(
        ar_label,
        MAX_SQUARE_DIM,
        MAX_NON_SQUARE_LONG,
        MAX_NON_SQUARE_SHORT,
    )


def generate_image_candidates(ar_label: str, mode: str = "normal"):
    generate_mode = normalize_training_generate_mode(mode)
    caps = IMAGE_MODE_CAPS.get(generate_mode, IMAGE_MODE_CAPS["normal"])
    return generate_candidates_with_caps(
        ar_label,
        caps["square_dim"],
        caps["non_square_long"],
        caps["non_square_short"],
    )


def generate_candidates_with_caps(ar_label: str, max_square_dim: int, max_long: int, max_short: int):
    target_ar = ASPECT_RATIOS[ar_label]
    candidates = []
    if ar_label == "square":
        for dim in range(256, max_square_dim + 1, 32):
            candidates.append((dim, dim, dim * dim))
        candidates.sort(key=lambda item: item[2], reverse=True)
        return candidates

    seen = set()
    for short_side in range(256, max_short + 1, 32):
        if target_ar >= 1:
            h = short_side
            w = snap_32_nearest(h * target_ar)
        else:
            w = short_side
            h = snap_32_nearest(w / target_ar)
        if w < 256 or h < 256:
            continue
        if max(w, h) > max_long:
            continue
        if min(w, h) > max_short:
            continue
        if abs((w / float(h)) - target_ar) > AR_TOL:
            continue
        key = (w, h)
        if key in seen:
            continue
        seen.add(key)
        candidates.append((w, h, w * h))
    candidates.sort(key=lambda item: item[2], reverse=True)
    return candidates


def snap_32_nearest(value):
    low = int(math.floor(value / 32.0) * 32)
    high = int(math.ceil(value / 32.0) * 32)
    if low == high:
        return low
    if (value - low) <= (high - value):
        return low
    return high


def target_dimensions_for_short_side(ar_label: str, short_side: int):
    short_side = max(256, snap_32_nearest(short_side))
    if ar_label == "square":
        return (short_side, short_side)
    target_ar = ASPECT_RATIOS[ar_label]
    if target_ar >= 1:
        h = short_side
        w = snap_32_nearest(h * target_ar)
    else:
        w = short_side
        h = snap_32_nearest(w / target_ar)
    return (max(256, w), max(256, h))


def resolve_image_target(ar_label: str, mode: str = "normal", noise_profile: str = "lo"):
    generate_mode = normalize_training_generate_mode(mode)
    target_w, target_h = TRAINING_MODE_TARGETS[generate_mode][ar_label]
    if str(noise_profile or "lo").strip().lower() != "hi":
        return (target_w, target_h)
    short_side = max(256, min(target_w, target_h) - 32)
    return target_dimensions_for_short_side(ar_label, short_side)


def choose_image_bucket(ar_label: str, images, mode: str = "normal", noise_profile: str = "lo"):
    """Choose one direct-folder image bucket for an entire AR cohort."""
    generate_mode = normalize_training_generate_mode(mode)
    candidates = [
        (w, h, area)
        for (w, h, area) in generate_image_candidates(ar_label, mode=generate_mode)
        if mfp(w, h, 1) <= MAX_IMAGE_MFP and w <= resolve_image_target(ar_label, generate_mode, noise_profile)[0] and h <= resolve_image_target(ar_label, generate_mode, noise_profile)[1]
    ]
    if not candidates:
        raise ValueError(f"No image bucket candidates under image mfp limit for AR={ar_label}")
    if not images:
        return None, []
    for selected in candidates:
        bucket = (selected[0], selected[1])
        if all(image[1] * IMAGE_BUCKET_MAX_UPSCALE_RATIO >= bucket[0] and image[2] * IMAGE_BUCKET_MAX_UPSCALE_RATIO >= bucket[1] for image in images):
            break
    else:
        selected = candidates[-1]
        bucket = (selected[0], selected[1])

    native = [image for image in images if image[1] >= bucket[0] and image[2] >= bucket[1]]
    upscaled = [image for image in images if image not in native]
    over_limit = [image[0] for image in upscaled if image[1] * IMAGE_BUCKET_MAX_UPSCALE_RATIO < bucket[0] or image[2] * IMAGE_BUCKET_MAX_UPSCALE_RATIO < bucket[1]]
    limiting_ratio = max(max(bucket[0] / float(image[1]), bucket[1] / float(image[2])) for image in images)
    limiting_files = [image[0] for image in images if max(bucket[0] / float(image[1]), bucket[1] / float(image[2])) == limiting_ratio]
    return {"bucket": bucket, "images": list(images), "native_count": len(native), "upscaled_count": len(upscaled), "limiting_files": limiting_files}, over_limit


def image_bucket_compatibility(image, bucket, max_upscale: float = IMAGE_BUCKET_MAX_UPSCALE_RATIO):
    _, image_w, image_h = image
    bucket_w, bucket_h = bucket
    if image_w >= bucket_w and image_h >= bucket_h:
        return "native"
    if image_w * float(max_upscale) >= bucket_w and image_h * float(max_upscale) >= bucket_h:
        return "slight_upscale"
    return ""


def assign_images_to_resolution_classes(images, buckets, max_upscale: float = IMAGE_BUCKET_MAX_UPSCALE_RATIO):
    """Assign each image once to the largest compatible selected bucket."""
    normalized_buckets = []
    seen = set()
    for raw_bucket in buckets:
        try:
            bucket = (int(raw_bucket[0]), int(raw_bucket[1]))
        except (IndexError, TypeError, ValueError):
            raise ValueError("Image bucket must contain positive width and height.")
        if bucket[0] <= 0 or bucket[1] <= 0:
            raise ValueError("Image bucket must contain positive width and height.")
        if bucket not in seen:
            seen.add(bucket)
            normalized_buckets.append(bucket)
    normalized_buckets.sort(key=lambda item: (item[0] * item[1], item[0], item[1]), reverse=True)
    classes = {
        bucket: {"bucket": bucket, "images": [], "native_count": 0, "upscaled_count": 0}
        for bucket in normalized_buckets
    }
    unsupported = []
    for image in images:
        selected_bucket = None
        compatibility = ""
        for bucket in normalized_buckets:
            compatibility = image_bucket_compatibility(image, bucket, max_upscale=max_upscale)
            if compatibility:
                selected_bucket = bucket
                break
        if selected_bucket is None:
            unsupported.append(image[0])
            continue
        selected = classes[selected_bucket]
        selected["images"].append(image)
        if compatibility == "native":
            selected["native_count"] += 1
        else:
            selected["upscaled_count"] += 1
    return [classes[bucket] for bucket in normalized_buckets if classes[bucket]["images"]], unsupported


def _h3_quality_image_candidates(ar_label: str):
    target_w, target_h = H3_QUALITY_IMAGE_TARGETS[ar_label]
    candidates = generate_candidates_with_caps(
        ar_label,
        target_w if ar_label == "square" else max(target_w, target_h),
        max(target_w, target_h),
        min(target_w, target_h),
    )
    target = (target_w, target_h, target_w * target_h)
    if target[:2] not in {(width, height) for width, height, _area in candidates}:
        candidates.append(target)
        candidates.sort(key=lambda item: item[2], reverse=True)
    return [
        candidate for candidate in candidates
        if candidate[0] <= target_w
        and candidate[1] <= target_h
        and mfp(candidate[0], candidate[1], 1) <= H3_QUALITY_MAX_IMAGE_MFP
    ]


def choose_image_resolution_classes(
    ar_label: str,
    images,
    mode: str = "normal",
    noise_profile: str = "lo",
    profile_id: str = "",
):
    """Split H3 Quality stills so one small image cannot cap the full AR cohort."""
    generate_mode = normalize_training_generate_mode(mode)
    if str(profile_id or "").strip().lower() != MINIMAX_H3_PROFILE_ID or generate_mode != "quality":
        selection, unsupported = choose_image_bucket(
            ar_label, images, mode=generate_mode, noise_profile=noise_profile,
        )
        return ([selection] if selection else []), unsupported

    candidates = _h3_quality_image_candidates(ar_label)
    if not candidates:
        raise ValueError(f"No H3 Quality image bucket candidates for AR={ar_label}")
    buckets = [(width, height) for width, height, _area in candidates]
    supported = [
        image for image in images
        if any(image_bucket_compatibility(image, bucket) for bucket in buckets)
    ]
    unsupported = [image[0] for image in images if image not in supported]
    if not supported:
        return [], unsupported

    # Preserve up to three useful resolution tiers. The final tier must cover
    # everything left so unusual small images cannot silently disappear.
    selected_buckets = []
    remaining = list(supported)
    for class_index in range(3):
        if not remaining:
            break
        final_class = class_index == 2
        selected = next(
            (
                bucket for bucket in buckets
                if bucket not in selected_buckets
                and (
                    all(image_bucket_compatibility(image, bucket) for image in remaining)
                    if final_class
                    else any(image_bucket_compatibility(image, bucket) for image in remaining)
                )
            ),
            None,
        )
        if selected is None:
            unsupported.extend(image[0] for image in remaining)
            break
        selected_buckets.append(selected)
        remaining = [image for image in remaining if not image_bucket_compatibility(image, selected)]

    classes, remaining_unsupported = assign_images_to_resolution_classes(supported, selected_buckets)
    unsupported.extend(remaining_unsupported)
    unsupported = list(dict.fromkeys(unsupported))
    classes.sort(key=lambda item: (item["bucket"][0] * item["bucket"][1], item["bucket"][0], item["bucket"][1]))
    return classes, unsupported


def mfp(w: int, h: int, frames: int):
    return (w // 32) * (h // 32) * frames


def render_image_block(image_dir: Path, ar_label: str, bucket, num_repeats: int = 1):
    repeats = int(num_repeats) if isinstance(num_repeats, int) else 1
    if repeats < 1:
        repeats = 1
    lines = [
        "[[directory]]",
        f'path = "{image_dir.as_posix()}"',
        f"num_repeats = {repeats}",
        'group = "images"',
        "size_buckets = [",
    ]
    w, h = bucket
    mfp_val = (w * h * 1) / 1_000_000
    lines.append(f"  [{w}, {h}, 1],  # MegaFramePixels: {mfp_val:.2f}M")
    lines.append("]")
    return "\n".join(lines)


def render_dataset_entry(entry, num_repeats: int):
    kind = entry["kind"]
    if kind == "video":
        return render_video_block(
            entry["dir_path"],
            entry["bucket"],
            num_repeats=num_repeats,
            detail_intent=bool(entry.get("detail_intent")),
        )
    if kind == "image":
        return render_image_block(entry["path"], entry["ar_label"], entry["bucket"], num_repeats=num_repeats)
    raise ValueError(f"Unknown dataset entry kind: {kind}")


def normalize_snapshot_caption(text):
    return " ".join(str(text or "").replace("\r\n", " ").replace("\n", " ").split())


def escape_comment_value(value):
    text = normalize_snapshot_caption(value)
    text = text.replace("#", "\\#")
    return text


def build_selection_snapshot_comment_lines(folder: Path, dataset_root: Path, manifest):
    selection = manifest.get("selection")
    if not isinstance(selection, dict):
        raise RuntimeError("Prep manifest is missing required selection metadata.")

    mode = str(selection.get("mode") or "").strip()
    if mode not in ("all", "visible_subset"):
        raise RuntimeError(f"Invalid selection mode in prep manifest: {mode}")
    selected_count = selection.get("selected_count")
    total_count = selection.get("total_count")
    selected_files = selection.get("selected_files")
    criteria = selection.get("criteria")
    if not isinstance(selected_count, int) or selected_count < 0:
        raise RuntimeError("Prep manifest has invalid selection.selected_count.")
    if not isinstance(total_count, int) or total_count < 0:
        raise RuntimeError("Prep manifest has invalid selection.total_count.")
    if not isinstance(selected_files, list):
        raise RuntimeError("Prep manifest has invalid selection.selected_files.")
    if not isinstance(criteria, dict):
        raise RuntimeError("Prep manifest has invalid selection.criteria.")

    prepared_entries = []
    for row in (manifest.get("videos") or []):
        if not isinstance(row, dict):
            continue
        prepared_entries.append(row)
    for row in (manifest.get("images") or []):
        if not isinstance(row, dict):
            continue
        prepared_entries.append(row)
    if not prepared_entries:
        raise RuntimeError("Prep manifest contains no prepared media entries for snapshot.")

    grouped = {}
    trained_files_for_hash = []
    for row in prepared_entries:
        file_name = str(row.get("file") or "").strip()
        prepared_rel = str(row.get("prepared_path") or "").strip()
        if not file_name or not prepared_rel:
            raise RuntimeError("Prep manifest contains malformed prepared media entry.")
        media_path = dataset_root / prepared_rel
        caption_path = media_path.with_suffix(".txt")
        if not caption_path.exists() or not caption_path.is_file():
            raise RuntimeError(f"Prepared caption file missing for media: {prepared_rel}")
        caption_text = normalize_snapshot_caption(caption_path.read_text(encoding="utf-8"))
        if not caption_text:
            raise RuntimeError(f"Prepared caption text is empty for media: {prepared_rel}")
        bucket = Path(prepared_rel).parent.as_posix() or "."
        grouped.setdefault(bucket, []).append((file_name, caption_text))
        trained_files_for_hash.append(file_name)

    for bucket_name in list(grouped.keys()):
        grouped[bucket_name] = sorted(grouped[bucket_name], key=lambda item: item[0].lower())
    bucket_names = sorted(grouped.keys(), key=lambda name: name.lower())
    trained_files_sorted = sorted(trained_files_for_hash, key=lambda name: name.lower())
    selection_hash_input = "\n".join(trained_files_sorted).encode("utf-8")
    selection_hash = hashlib.sha256(selection_hash_input).hexdigest()

    lines = []
    lines.append("# --- webcap selection snapshot v1 ---")
    lines.append(f"# snapshot.generated_at: {datetime.now(timezone.utc).isoformat()}")
    source_folder_value = criteria.get("source_folder") if isinstance(criteria, dict) else None
    if not source_folder_value:
        source_folder_value = folder.as_posix()
    lines.append(f"# snapshot.source_folder: {escape_comment_value(source_folder_value)}")
    lines.append(f"# snapshot.prepared_mode: {mode}")
    lines.append(f"# snapshot.selected_count: {selected_count}")
    lines.append(f"# snapshot.total_count: {total_count}")
    lines.append(f"# snapshot.prepared_count: {len(trained_files_sorted)}")
    lines.append(f"# snapshot.selection_hash: sha256:{selection_hash}")
    lines.append("# snapshot.criteria.begin: true")
    for key in sorted(criteria.keys(), key=lambda k: str(k).lower()):
        value = criteria.get(key)
        lines.append(f"# criteria.{key}: {escape_comment_value(value)}")
    lines.append("# snapshot.criteria.end: true")
    lines.append("# snapshot.files.begin: true")
    for bucket_name in bucket_names:
        lines.append(f"# bucket: {escape_comment_value(bucket_name)}")
        for file_name, caption_text in grouped[bucket_name]:
            # Only print file name, omit caption text
            lines.append(
                "# file: " + escape_comment_value(file_name)
                # + " | caption: " + escape_comment_value(caption_text)
            )
    lines.append("# snapshot.files.end: true")
    lines.append("# --- end webcap selection snapshot ---")
    return lines


def render_dataset_toml(blocks, snapshot_lines=None):
    chunks = ["enable_ar_bucket = true"]
    chunks.extend(blocks)
    body = "\n\n".join(chunks).rstrip() + "\n"
    if not snapshot_lines:
        return body
    return "\n".join(snapshot_lines).rstrip() + "\n\n" + body
