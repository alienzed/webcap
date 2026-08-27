import json
import hashlib
import math
import re
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from . import config as app_config
from .permissions import normalize_path_permissions
from .training_config_files import HI_CONFIG_NAME, LO_CONFIG_NAME, default_training_config_epochs
from .training_profiles import KREA2_PROFILE_ID, MINIMAX_H3_PROFILE_ID, WAN21_PROFILE_ID, WAN22_PROFILE_ID, config_for_stage, profile as training_profile

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

AR_CLASSES = {
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
IMAGE_MAX_SQUARE_DIM = 768
IMAGE_MAX_NON_SQUARE_LONG = 768
IMAGE_MAX_NON_SQUARE_SHORT = 768
MAX_IMAGE_MFP = 600
IMAGE_CLASS_MIN_UNIQUE = 3
IMAGE_CLASS_MAX_PER_AR = 3
IMAGE_CLASS_MAX_UPSCALE_RATIO = 1.15
ALT_MIN_IMAGE_SIDE = 256
NORMAL_SECOND_BUCKET_MIN_SCALE = 1.25
ALT_MAX_SQUARE_DIM = 1024
ALT_MAX_NON_SQUARE_LONG = 1280
ALT_MAX_NON_SQUARE_SHORT = 1024

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
VIDEO_FRAME_CANDIDATES = [37, 49, 45, 41, 33]
VIDEO_FRAME_CANDIDATES_POC = [33, 29, 25, 21, 17]
H3_VIDEO_FRAME_CANDIDATES_POC = [34]
MIN_VIDEO_FRAMES_FOR_STATS = 16
VIDEO_COVERAGE = 0.85
VIDEO_MFP_LIMIT = 11000
# H3 buckets use 32x32 latent cells. 11,900 cells is 12.19 raw MegaFramePixels
# for aligned dimensions; 800x448 at 34 frames has been verified trainable and
# is near the practical ceiling.
H3_VIDEO_MFP_LIMIT = 11900
# H3 defaults are deliberately app-owned policy.  The Normal and Quality tables
# start at the same conservative ceiling; later training-machine calibration can
# raise a Quality ceiling without changing class selection or bundle handling.
H3_VIDEO_TIER_POLICY = {
    "temporal": {"frames": 68, "repeat_weight": 2.0, "max_upscale": 1.10},
    "hybrid": {"frames": 34, "repeat_weight": 1.0, "max_upscale": 1.0},
    "spatial": {"frames": 17, "repeat_weight": 0.5, "max_upscale": 1.0, "min_support": 3},
}
H3_VIDEO_MODE_CEILINGS = {
    "normal": {
        "square": {"temporal": (352, 352), "hybrid": (512, 512), "spatial": (768, 768)},
        "43": {"temporal": (416, 320), "hybrid": (608, 448), "spatial": (928, 704)},
        "34": {"temporal": (320, 416), "hybrid": (448, 608), "spatial": (704, 928)},
        "169": {"temporal": (448, 256), "hybrid": (800, 448), "spatial": (1088, 608)},
        "916": {"temporal": (256, 448), "hybrid": (448, 800), "spatial": (608, 1088)},
    },
    "quality": {
        "square": {"temporal": (352, 352), "hybrid": (512, 512), "spatial": (768, 768)},
        "43": {"temporal": (416, 320), "hybrid": (608, 448), "spatial": (928, 704)},
        "34": {"temporal": (320, 416), "hybrid": (448, 608), "spatial": (704, 928)},
        "169": {"temporal": (448, 256), "hybrid": (800, 448), "spatial": (1088, 608)},
        "916": {"temporal": (256, 448), "hybrid": (448, 800), "spatial": (608, 1088)},
    },
}
H3_FRAME_TO_ROLE = {17: "spatial", 34: "hybrid", 68: "temporal"}
VIDEO_DETAIL_FRAMES = 13
VIDEO_DETAIL_MIN_COVERAGE = 0.35
VIDEO_DETAIL_MIN_SUPPORT = 2
POC_VIDEO_DETAIL_ENABLED = False
NORMAL_SECOND_BUCKET_MIN_SCALE_NON_SQUARE = 1.08
REPEAT_TARGET_STEPS = {
    "poc": {"hi": 5000, "lo": 20000},
    "normal": {"hi": 5000, "lo": 20000},
    "quality": {"hi": 5000, "lo": 20000},
}
TRAINING_PLAN_FILE_NAME = "training_plan.json"
VIDEO_DETAIL_REPEAT_WEIGHT = 0.25
VIDEO_MOTION_REPEAT_WEIGHT = 1.0
IMAGE_REPEAT_WEIGHT = 1.0
VIDEO_PROFILE_IDS = {WAN22_PROFILE_ID, WAN21_PROFILE_ID, MINIMAX_H3_PROFILE_ID}


def normalize_training_generate_mode(mode):
    text = str(mode or "normal").strip().lower()
    if text not in TRAINING_MODE_TARGETS:
        text = "normal"
    return text


def h3_calibration_settings():
    runtime_config = app_config.config if isinstance(app_config.config, dict) else {}
    training = runtime_config.get("training") if isinstance(runtime_config.get("training"), dict) else {}
    calibration = training.get("h3_calibration") if isinstance(training.get("h3_calibration"), dict) else None
    return calibration


def h3_video_mode_ceilings(mode: str):
    """Return H3 ceilings after applying the small, settings-backed calibration layer."""
    normalized_mode = normalize_training_generate_mode(mode)
    if normalized_mode == "poc":
        return {}, ""
    ceilings = {
        aspect: {role: tuple(shape) for role, shape in by_role.items()}
        for aspect, by_role in H3_VIDEO_MODE_CEILINGS[normalized_mode].items()
    }
    calibration = h3_calibration_settings()
    if not calibration:
        return ceilings, ""
    safe_shapes = calibration.get("safe_shapes") if isinstance(calibration.get("safe_shapes"), dict) else {}
    calibrated = {}
    for frame_key, by_aspect in safe_shapes.items():
        try:
            role = H3_FRAME_TO_ROLE.get(int(frame_key))
        except (TypeError, ValueError):
            role = None
        if not role or not isinstance(by_aspect, dict):
            continue
        for aspect, shape in by_aspect.items():
            if aspect not in ("169", "square", "43") or not isinstance(shape, list) or len(shape) != 2:
                continue
            calibrated[(aspect, role)] = (int(shape[0]), int(shape[1]))
            if aspect == "169":
                calibrated[("916", role)] = (int(shape[1]), int(shape[0]))
            elif aspect == "43":
                calibrated[("34", role)] = (int(shape[1]), int(shape[0]))
    for (aspect, role), shape in calibrated.items():
        built_in = H3_VIDEO_MODE_CEILINGS[normalized_mode][aspect][role]
        if normalized_mode == "quality":
            ceilings[aspect][role] = shape
        elif shape[0] <= built_in[0] and shape[1] <= built_in[1]:
            # Normal is allowed to become safer, never larger.
            ceilings[aspect][role] = shape
    return ceilings, str(calibration.get("campaign") or "")


def repeat_targets_for_mode(mode: str):
    normalized = normalize_training_generate_mode(mode)
    targets = REPEAT_TARGET_STEPS[normalized]
    return int(targets["hi"]), int(targets["lo"])


def video_resolution_cap(profile_id: str, mode: str, ar_label: str):
    selected_profile = str(profile_id or WAN22_PROFILE_ID).strip().lower()
    if selected_profile not in VIDEO_PROFILE_IDS:
        return None
    generate_mode = normalize_training_generate_mode(mode)
    return TRAINING_MODE_TARGETS[generate_mode][ar_label]


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
        if not prepared_path or ar_label not in AR_CLASSES or not width or not height:
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

        hi_classes, hi_unsupported = choose_image_resolution_classes(
            ar_label, images, mode=generate_mode, noise_profile="hi"
        )
        lo_classes, lo_unsupported = choose_image_resolution_classes(
            ar_label, images, mode=generate_mode, noise_profile="lo"
        )
        hi_buckets = [item["bucket"] for item in hi_classes]
        lo_buckets = [item["bucket"] for item in lo_classes]
        if hi_unsupported:
            lines.append(f"[WARN] {image_dir.name} (HI): {len(hi_unsupported)} image(s) smaller than every valid bucket:")
            for name in hi_unsupported:
                lines.append(f"  - {name}")
        if lo_unsupported:
            lines.append(f"[WARN] {image_dir.name} (LO): {len(lo_unsupported)} image(s) smaller than every valid bucket:")
            for name in lo_unsupported:
                lines.append(f"  - {name}")
        if not hi_buckets:
            lines.append(f"[WARN] {image_dir.name} (HI): no image buckets selected.")
        else:
            lines.append(
                f"[INFO] {image_dir.name}: selected HI image bucket(s): "
                + ", ".join(f"{w}x{h}" for (w, h) in hi_buckets)
            )
            for item in hi_classes:
                w, h = item["bucket"]
                lines.append(
                    f"[INFO] {image_dir.name} (HI) class {w}x{h}: "
                    f"{len(item['images'])} image(s), {item['native_count']} native, "
                    f"{item['upscaled_count']} slight-upscale"
                )
            hi_image_entries.append({
                "kind": "image",
                "path": image_dir,
                "ar_label": ar_label,
                "buckets": hi_buckets,
                "sample_count": max(1, sum(len(item["images"]) for item in hi_classes)),
                "repeat_weight": IMAGE_REPEAT_WEIGHT,
            })
        if not lo_buckets:
            lines.append(f"[WARN] {image_dir.name} (LO): no image buckets selected.")
        else:
            lines.append(
                f"[INFO] {image_dir.name}: selected LO image bucket(s): "
                + ", ".join(f"{w}x{h}" for (w, h) in lo_buckets)
            )
            for item in lo_classes:
                w, h = item["bucket"]
                lines.append(
                    f"[INFO] {image_dir.name} (LO) class {w}x{h}: "
                    f"{len(item['images'])} image(s), {item['native_count']} native, "
                    f"{item['upscaled_count']} slight-upscale"
                )
            lo_image_entries.append({
                "kind": "image",
                "path": image_dir,
                "ar_label": ar_label,
                "buckets": lo_buckets,
                "sample_count": max(1, sum(len(item["images"]) for item in lo_classes)),
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
    if krea2_profile and video_entries:
        excluded_videos = sum(int(entry["sample_count"]) for entry in video_entries)
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
        "hi": {"epochs": hi_epochs, "targetSteps": hi_target_steps, "estimatedSteps": hi_est, "estimatedImageExposures": hi_image_exposures, "estimatedVideoExposures": hi_video_exposures},
        "lo": {"epochs": lo_epochs, "targetSteps": lo_target_steps, "estimatedSteps": lo_est, "estimatedImageExposures": lo_image_exposures, "estimatedVideoExposures": lo_video_exposures},
    }
    if single_stage:
        training_stages = {
            single_stage_name: {"epochs": lo_epochs, "targetSteps": lo_target_steps, "estimatedSteps": lo_est, "estimatedImageExposures": lo_image_exposures, "estimatedVideoExposures": lo_video_exposures},
        }
    training_plan = {
        "version": 1,
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
    normalize_path_permissions(metadata_path)
    lines.append(f"[INFO] Wrote metadata cache: {metadata_path}")
    training_plan_path = dataset_root / TRAINING_PLAN_FILE_NAME
    training_plan_path.write_text(json.dumps(artifacts["plan"], indent=2), encoding="utf-8")
    normalize_path_permissions(training_plan_path)
    lines.append(f"[INFO] Wrote training plan: {training_plan_path}")
    single_stage = str(profile_id or "") in {KREA2_PROFILE_ID, WAN21_PROFILE_ID, MINIMAX_H3_PROFILE_ID}
    if single_stage:
        train_path = folder / "dataset.train.toml"
        train_path.write_text(artifacts["loText"], encoding="utf-8")
        normalize_path_permissions(train_path)
        lines.append(f"[INFO] Wrote {train_path}")
    else:
        hi_path = folder / "dataset.hi.toml"
        lo_path = folder / "dataset.lo.toml"
        hi_path.write_text(artifacts["hiText"], encoding="utf-8")
        lo_path.write_text(artifacts["loText"], encoding="utf-8")
        normalize_path_permissions(hi_path)
        normalize_path_permissions(lo_path)
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


def build_video_blocks(dataset_root: Path, videos, lines, mode: str = "normal", profile_id: str = "", require_files=True):
    generate_mode = normalize_training_generate_mode(mode)
    selected_profile_id = str(profile_id or WAN22_PROFILE_ID).strip().lower()
    selected_profile = training_profile(selected_profile_id)
    model_fps = selected_profile.get("videoFps")
    h3_profile = selected_profile_id == MINIMAX_H3_PROFILE_ID
    grouped = {key: [] for key in AR_CLASSES}
    for row in videos:
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "").strip()
        if ar_label not in grouped:
            continue
        width = to_pos_int(row.get("width"))
        height = to_pos_int(row.get("height"))
        frames = coerce_frames(row, model_fps)
        prepared_path = str(row.get("prepared_path") or "").strip()
        if not width or not height or not prepared_path:
            continue
        abs_prepared = dataset_root / prepared_path
        if require_files and not abs_prepared.exists():
            continue
        grouped[ar_label].append({
            "width": width,
            "height": height,
            "frames": frames,
            "path": abs_prepared,
        })

    entries = []
    h3_ceilings, h3_calibration_campaign = h3_video_mode_ceilings(generate_mode) if h3_profile and generate_mode != "poc" else ({}, "")
    for ar_label in AR_CLASSES.keys():
        clips = grouped.get(ar_label, [])
        if not clips:
            continue
        minimum_frames = 34 if h3_profile and generate_mode == "poc" else 17 if h3_profile else MIN_VIDEO_FRAMES_FOR_STATS
        too_short = [c for c in clips if c["frames"] is not None and c["frames"] < minimum_frames]
        if too_short and h3_profile:
            lines.append(f"[WARN] {ar_label}: excluded {len(too_short)} MiniMax H3 clip(s) shorter than {minimum_frames} frames.")
        usable_for_frames = [c for c in clips if c["frames"] is not None and c["frames"] >= minimum_frames]
        if not usable_for_frames:
            lines.append(f"[WARN] {ar_label}: no clips with usable frame metadata.")
            continue

        if h3_profile and generate_mode != "poc":
            dir_path = (dataset_root / ar_label).as_posix()
            ceilings = h3_ceilings[ar_label]
            selected_by_role = {}
            if generate_mode == "quality" and h3_calibration_campaign:
                lines.append(
                    f"[INFO] {ar_label}: MiniMax H3 Quality uses calibration {h3_calibration_campaign}; "
                    "avoid other GPU-heavy applications while training calibrated maximum buckets."
                )
            for role in ("temporal", "hybrid", "spatial"):
                policy = H3_VIDEO_TIER_POLICY[role]
                target_w, target_h = ceilings[role]
                role_frames = policy["frames"]
                if role == "spatial":
                    hybrid_selected = selected_by_role.get("hybrid")
                    hybrid_floor = (
                        (hybrid_selected["width"], hybrid_selected["height"])
                        if hybrid_selected else H3_VIDEO_MODE_CEILINGS["normal"][ar_label]["hybrid"]
                    )
                    selected = choose_h3_spatial_bucket(
                        ar_label,
                        usable_for_frames,
                        target_w,
                        target_h,
                        hybrid_floor,
                        min_support=policy["min_support"],
                    )
                else:
                    selected = choose_video_bucket_resolution_capped(
                        ar_label,
                        usable_for_frames,
                        role_frames,
                        VIDEO_COVERAGE,
                        None,
                        target_w,
                        target_h,
                        max_upscale=policy["max_upscale"],
                    )
                if not selected:
                    if role == "spatial":
                        lines.append(
                            f"[INFO] {ar_label}: MiniMax H3 spatial tier omitted; requires {policy['min_support']} native clips above the hybrid target."
                        )
                        continue
                    lines.append(
                        f"[WARN] {ar_label}: no clips support MiniMax H3 {role} bucket @ {role_frames} frames."
                    )
                    continue
                selected_by_role[role] = selected
                bucket = (selected["width"], selected["height"], role_frames)
                lines.append(
                    f"[INFO] {ar_label}: MiniMax H3 {role} bucket {selected['width']}x{selected['height']} @ {role_frames} "
                    f"(support {selected['support']}/{selected['total']})"
                )
                entries.append({
                    "kind": "video",
                    "role": role,
                    "dir_path": dir_path,
                    "buckets": [bucket],
                    "sample_count": selected["support"],
                    "repeat_weight": policy["repeat_weight"],
                    "resolution_cap": (target_w, target_h),
                })
            continue

        frame_counts = [c["frames"] for c in usable_for_frames]
        if h3_profile:
            frame_candidates = H3_VIDEO_FRAME_CANDIDATES_POC
        else:
            frame_candidates = VIDEO_FRAME_CANDIDATES_POC if generate_mode == "poc" else VIDEO_FRAME_CANDIDATES
        motion_frames = select_frames_with_fallback(frame_counts, frame_candidates, VIDEO_COVERAGE)
        if not motion_frames:
            lines.append(f"[WARN] {ar_label}: unable to choose motion frame count.")
            continue

        resolution_cap = video_resolution_cap(profile_id, generate_mode, ar_label)
        if resolution_cap:
            lines.append(
                f"[INFO] {ar_label}: {'MiniMax H3' if h3_profile else 'WAN'} {generate_mode} video resolution cap "
                f"{resolution_cap[0]}x{resolution_cap[1]}"
            )
        if resolution_cap or generate_mode == "poc":
            target_w, target_h = resolution_cap or TRAINING_MODE_TARGETS["poc"][ar_label]
            motion = choose_video_bucket_resolution_capped(
                ar_label,
                usable_for_frames,
                motion_frames,
                VIDEO_COVERAGE,
                H3_VIDEO_MFP_LIMIT if h3_profile else VIDEO_MFP_LIMIT,
                target_w,
                target_h,
            )
        else:
            motion = choose_video_bucket_resolution(
                ar_label,
                usable_for_frames,
                motion_frames,
                VIDEO_COVERAGE,
                H3_VIDEO_MFP_LIMIT if h3_profile else VIDEO_MFP_LIMIT,
            )
        if not motion:
            lines.append(f"[WARN] {ar_label}: unable to choose motion bucket resolution.")
            continue

        motion_bucket = (motion["width"], motion["height"], motion_frames)
        lines.append(
            f"[INFO] {ar_label}: motion bucket {motion['width']}x{motion['height']} @ {motion_frames} "
            f"(support {motion['support']}/{motion['total']})"
        )
        dir_path = (dataset_root / ar_label).as_posix()
        entries.append({
            "kind": "video",
            "role": "motion",
            "dir_path": dir_path,
            "buckets": [motion_bucket],
            "sample_count": motion["support"],
            "repeat_weight": VIDEO_MOTION_REPEAT_WEIGHT,
            "resolution_cap": resolution_cap,
        })

        if not h3_profile and (generate_mode != "poc" or POC_VIDEO_DETAIL_ENABLED):
            detail = choose_video_detail_bucket(
                ar_label,
                usable_for_frames,
                motion["width"],
                motion["height"],
                max_w=resolution_cap[0] if resolution_cap else None,
                max_h=resolution_cap[1] if resolution_cap else None,
            )
            if detail:
                detail_tuple = (detail["width"], detail["height"], VIDEO_DETAIL_FRAMES)
                lines.append(
                    f"[INFO] {ar_label}: detail bucket {detail['width']}x{detail['height']} @ {VIDEO_DETAIL_FRAMES} "
                    f"(support {detail['support']}/{detail['total']})"
                )
                entries.append({
                    "kind": "video",
                    "role": "detail",
                    "dir_path": dir_path,
                    "buckets": [detail_tuple],
                    "sample_count": detail["support"],
                    "repeat_weight": VIDEO_DETAIL_REPEAT_WEIGHT,
                    "resolution_cap": resolution_cap,
                })
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


def select_frames_with_fallback(frame_counts, candidates, coverage_threshold):
    eligible = [f for f in frame_counts if f >= MIN_VIDEO_FRAMES_FOR_STATS]
    if not eligible:
        return None
    total = len(eligible)
    for cand in candidates:
        support = sum(1 for f in eligible if f >= cand)
        if support <= 0:
            continue
        if (support / float(total)) >= coverage_threshold:
            return cand
    for cand in candidates:
        if any(f >= cand for f in eligible):
            return cand
    return None


def choose_video_bucket_resolution(ar_label: str, clips, frames: int, coverage_threshold: float, mfp_limit: int):
    candidates = generate_candidates(ar_label)
    if not candidates:
        return None
    usable = [clip for clip in clips if clip["frames"] is not None and clip["frames"] >= frames]
    if not usable:
        return None
    total = len(usable)
    best = None
    for (w, h, area) in candidates:
        if mfp(w, h, frames) > mfp_limit:
            continue
        support = 0
        for clip in usable:
            if clip["width"] >= w and clip["height"] >= h:
                support += 1
        if support <= 0:
            continue
        frac = support / float(total)
        entry = {"width": w, "height": h, "area": area, "support": support, "total": total, "coverage": frac}
        if frac >= coverage_threshold:
            return entry
        if best is None:
            best = entry
            continue
        if entry["coverage"] > best["coverage"] or (
            entry["coverage"] == best["coverage"] and entry["area"] > best["area"]
        ):
            best = entry
    return best


def choose_video_bucket_resolution_capped(
    ar_label: str,
    clips,
    frames: int,
    coverage_threshold: float,
    mfp_limit: int | None,
    max_w: int,
    max_h: int,
    max_upscale: float = 1.0,
):
    candidates = [
        (w, h, area)
        for (w, h, area) in generate_candidates(ar_label)
        if w <= max_w and h <= max_h
    ]
    if not candidates:
        return None
    usable = [clip for clip in clips if clip["frames"] is not None and clip["frames"] >= frames]
    if not usable:
        return None
    total = len(usable)
    best = None
    for (w, h, area) in candidates:
        if mfp_limit is not None and mfp(w, h, frames) > mfp_limit:
            continue
        support = 0
        for clip in usable:
            if clip["width"] * max_upscale >= w and clip["height"] * max_upscale >= h:
                support += 1
        if support <= 0:
            continue
        frac = support / float(total)
        entry = {"width": w, "height": h, "area": area, "support": support, "total": total, "coverage": frac}
        if frac >= coverage_threshold:
            return entry
        if best is None:
            best = entry
            continue
        if entry["coverage"] > best["coverage"] or (
            entry["coverage"] == best["coverage"] and entry["area"] > best["area"]
        ):
            best = entry
    return best


def choose_h3_spatial_bucket(ar_label: str, clips, max_w: int, max_h: int, hybrid_target, min_support: int = 3):
    hybrid_area = int(hybrid_target[0]) * int(hybrid_target[1])
    candidates = [
        (w, h, area)
        for (w, h, area) in generate_candidates(ar_label)
        if w <= max_w and h <= max_h and area > hybrid_area
    ]
    usable = [clip for clip in clips if clip["frames"] is not None and clip["frames"] >= H3_VIDEO_TIER_POLICY["spatial"]["frames"]]
    if not usable:
        return None
    for (w, h, area) in candidates:
        support = sum(1 for clip in usable if clip["width"] >= w and clip["height"] >= h)
        if support >= min_support:
            return {
                "width": w,
                "height": h,
                "area": area,
                "support": support,
                "total": len(usable),
                "coverage": support / float(len(usable)),
            }
    return None


def choose_video_detail_bucket(ar_label: str, clips, motion_w: int, motion_h: int, max_w=None, max_h=None):
    candidates = [
        (w, h, area)
        for (w, h, area) in generate_candidates(ar_label)
        if (max_w is None or w <= max_w) and (max_h is None or h <= max_h)
    ]
    if not candidates:
        return None
    motion_area = motion_w * motion_h
    usable = [clip for clip in clips if clip["frames"] is not None and clip["frames"] >= VIDEO_DETAIL_FRAMES]
    if not usable:
        return None
    total = len(usable)
    best = None
    for (w, h, area) in candidates:
        if area <= motion_area:
            continue
        if mfp(w, h, VIDEO_DETAIL_FRAMES) > VIDEO_MFP_LIMIT:
            continue
        support = 0
        for clip in usable:
            if clip["width"] >= w and clip["height"] >= h:
                support += 1
        if support < VIDEO_DETAIL_MIN_SUPPORT:
            continue
        frac = support / float(total)
        if frac < VIDEO_DETAIL_MIN_COVERAGE:
            continue
        entry = {"width": w, "height": h, "area": area, "support": support, "total": total, "coverage": frac}
        if best is None:
            best = entry
            continue
        if entry["area"] > best["area"] or (
            entry["area"] == best["area"] and entry["coverage"] > best["coverage"]
        ):
            best = entry
    return best


def video_alternatives(selected_w: int, selected_h: int, selected_frames: int, max_w=None, max_h=None):
    # 2-3 lower and 2-3 higher valid buckets by area, same frame count
    short_side = min(selected_w, selected_h)
    offsets = [-96, -64, -32, 32, 64, 96]
    alts = []
    for offset in offsets:
        dim = short_side + offset
        # Use AR from selected bucket
        ar = selected_w / selected_h
        if ar >= 1:
            h = dim
            w = int(round(h * ar))
        else:
            w = dim
            h = int(round(w / ar))
        # Snap to nearest 32
        w = (w + 16) // 32 * 32
        h = (h + 16) // 32 * 32
        # Skip invalid or duplicate
        if w < 256 or h < 256:
            continue
        if (max_w is not None and w > max_w) or (max_h is not None and h > max_h):
            continue
        if (w, h, selected_frames) == (selected_w, selected_h, selected_frames):
            continue
        if (w, h, selected_frames) in alts:
            continue
        alts.append((w, h, selected_frames))
    # Only return up to 3 lower and 3 higher, sorted by short_side distance
    lower = [alt for alt in alts if min(alt[:2]) < short_side]
    higher = [alt for alt in alts if min(alt[:2]) > short_side]
    lower = sorted(lower, key=lambda x: abs(min(x[:2]) - short_side))[:3]
    higher = sorted(higher, key=lambda x: abs(min(x[:2]) - short_side))[:3]
    return lower + higher

def render_video_block(dir_path: str, buckets, num_repeats: int = 1, resolution_cap=None):
    repeats = int(num_repeats) if isinstance(num_repeats, int) else 1
    if repeats < 1:
        repeats = 1
    lines = [
        "[[directory]]",
        f'path = "{dir_path}"',
        f"num_repeats = {repeats}",
        'group = "videos"',
        "size_buckets = [",
    ]
    max_w, max_h = resolution_cap or (None, None)
    for (w, h, frames) in buckets:
        alts = video_alternatives(w, h, frames, max_w=max_w, max_h=max_h)
        mfp_val = (w * h * frames) / 1_000_000
        if alts:
            lines.append("# Alternatives: " + ", ".join(f"[{aw}, {ah}, {af}]" for (aw, ah, af) in alts))
        lines.append(f"  [{w}, {h}, {frames}],  # MegaFramePixels: {mfp_val:.2f}M")
    lines.append("]")
    return "\n".join(lines)


def find_image_dirs(dataset_root: Path):
    dirs = []
    for child in sorted(dataset_root.iterdir(), key=lambda p: p.name.lower()):
        if child.is_dir() and (child.name.endswith("_img") or child.name.endswith("_img_highres")):
            dirs.append(child)
    return dirs


def ar_from_image_dir(name: str):
    if name.endswith("_img_highres"):
        base = name[:-len("_img_highres")]
    elif name.endswith("_img"):
        base = name[:-len("_img")]
    else:
        raise ValueError(f"Image directory name does not end with _img: {name}")
    if base not in AR_CLASSES:
        raise ValueError(f"Unknown image AR folder: {name}")
    return base


def read_image_metadata(image_dir: Path):
    images = []
    for path in sorted(image_dir.iterdir(), key=lambda p: p.name.lower()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue
        with Image.open(path) as img:
            width, height = img.size
        images.append((path.name, int(width), int(height)))
    return images


def generate_candidates(ar_label: str):
    return generate_candidates_with_caps(
        ar_label,
        MAX_SQUARE_DIM,
        MAX_NON_SQUARE_LONG,
        MAX_NON_SQUARE_SHORT,
        canonical_only=True,
    )


def generate_image_candidates(ar_label: str, mode: str = "normal"):
    generate_mode = normalize_training_generate_mode(mode)
    caps = IMAGE_MODE_CAPS.get(generate_mode, IMAGE_MODE_CAPS["normal"])
    return generate_candidates_with_caps(
        ar_label,
        caps["square_dim"],
        caps["non_square_long"],
        caps["non_square_short"],
        canonical_only=True,
    )


def generate_candidates_with_caps(ar_label: str, max_square_dim: int, max_long: int, max_short: int, canonical_only: bool):
    target_ar = AR_CLASSES[ar_label]
    candidates = []
    if ar_label == "square":
        for dim in range(256, max_square_dim + 1, 32):
            candidates.append((dim, dim, dim * dim))
        candidates.sort(key=lambda item: item[2], reverse=True)
        return candidates

    if canonical_only:
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

    seen = set()
    if target_ar >= 1:
        for w in range(256, max_long + 1, 32):
            ideal_h = w / target_ar
            for h in snap_32_options(ideal_h):
                add_candidate(candidates, seen, target_ar, w, h, max_long, max_short)
    else:
        for h in range(256, max_long + 1, 32):
            ideal_w = target_ar * h
            for w in snap_32_options(ideal_w):
                add_candidate(candidates, seen, target_ar, w, h, max_long, max_short)
    candidates.sort(key=lambda item: item[2], reverse=True)
    return candidates


def snap_32_options(value):
    low = int(math.floor(value / 32.0) * 32)
    high = int(math.ceil(value / 32.0) * 32)
    if low == high:
        return [low]
    return [low, high]


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
    target_ar = AR_CLASSES[ar_label]
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


def add_candidate(candidates, seen, target_ar, w, h, max_long, max_short):
    if w < 256 or h < 256:
        return
    if max(w, h) > max_long:
        return
    if min(w, h) > max_short:
        return
    if abs((w / float(h)) - target_ar) > AR_TOL:
        return
    key = (w, h)
    if key in seen:
        return
    seen.add(key)
    candidates.append((w, h, w * h))


def pick_image_buckets(ar_label: str, images, mode: str = "normal", noise_profile: str = "lo"):
    classes, unsupported = choose_image_resolution_classes(ar_label, images, mode=mode, noise_profile=noise_profile)
    return [item["bucket"] for item in classes], unsupported


def image_bucket_compatibility(image, bucket, max_upscale: float = IMAGE_CLASS_MAX_UPSCALE_RATIO):
    _, image_w, image_h = image
    bucket_w, bucket_h = bucket
    if image_w >= bucket_w and image_h >= bucket_h:
        return "native"
    if image_w * float(max_upscale) >= bucket_w and image_h * float(max_upscale) >= bucket_h:
        return "slight_upscale"
    return ""


def assign_images_to_resolution_classes(images, buckets, max_upscale: float = IMAGE_CLASS_MAX_UPSCALE_RATIO):
    """Assign every image once, at its largest compatible configured bucket."""
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
        match = ""
        selected_bucket = None
        for bucket in normalized_buckets:
            match = image_bucket_compatibility(image, bucket, max_upscale=max_upscale)
            if match:
                selected_bucket = bucket
                break
        if selected_bucket is None:
            unsupported.append(image[0])
            continue
        selected = classes[selected_bucket]
        selected["images"].append(image)
        if match == "native":
            selected["native_count"] += 1
        else:
            selected["upscaled_count"] += 1
    return [classes[bucket] for bucket in normalized_buckets if classes[bucket]["images"]], unsupported


def choose_image_resolution_classes(ar_label: str, images, mode: str = "normal", noise_profile: str = "lo"):
    generate_mode = normalize_training_generate_mode(mode)
    candidates = generate_image_candidates(ar_label, mode=generate_mode)
    if not candidates:
        raise ValueError(f"No image bucket candidates for AR={ar_label}")
    candidates = [
        (w, h, area)
        for (w, h, area) in candidates
        if mfp(w, h, 1) <= MAX_IMAGE_MFP
    ]
    if not candidates:
        raise ValueError(f"No image bucket candidates under image mfp limit for AR={ar_label}")
    if not images:
        return [], []

    candidate_buckets = [(w, h) for (w, h, _) in candidates]
    supported_images = [
        image for image in images
        if any(image_bucket_compatibility(image, bucket) for bucket in candidate_buckets)
    ]
    unsupported = [image[0] for image in images if image not in supported_images]
    if not supported_images:
        return [], unsupported

    target_w, target_h = resolve_image_target(ar_label, mode=generate_mode, noise_profile=noise_profile)
    minimum_healthy = min(IMAGE_CLASS_MIN_UNIQUE, len(supported_images))
    below_target = [
        bucket for bucket in candidate_buckets
        if bucket[0] <= target_w and bucket[1] <= target_h
    ]

    def compatible_count(bucket, source_images=supported_images, native_only=False):
        if native_only:
            return sum(1 for image in source_images if image_bucket_compatibility(image, bucket) == "native")
        return sum(1 for image in source_images if image_bucket_compatibility(image, bucket))

    healthy_primary = [
        bucket for bucket in below_target
        if compatible_count(bucket) >= minimum_healthy
    ]
    if healthy_primary:
        primary = max(healthy_primary, key=lambda item: (item[0] * item[1], item[0], item[1]))
    else:
        primary = max(
            candidate_buckets,
            key=lambda item: (
                compatible_count(item),
                int(item[0] <= target_w and item[1] <= target_h),
                item[0] * item[1],
                item[0],
                item[1],
            ),
        )

    selected = [primary]
    allow_high_class = generate_mode == "normal" and str(noise_profile or "lo").strip().lower() != "hi"
    if allow_high_class:
        primary_short = min(primary)
        scale_min = NORMAL_SECOND_BUCKET_MIN_SCALE if primary[0] == primary[1] else NORMAL_SECOND_BUCKET_MIN_SCALE_NON_SQUARE
        high_candidates = []
        for bucket in candidate_buckets:
            if bucket[0] <= primary[0] or bucket[1] <= primary[1]:
                continue
            if min(bucket) < int(math.ceil(primary_short * scale_min)):
                continue
            if compatible_count(bucket, native_only=True) < IMAGE_CLASS_MIN_UNIQUE:
                continue
            prospective, _ = assign_images_to_resolution_classes(supported_images, [primary, bucket])
            primary_class = next((item for item in prospective if item["bucket"] == primary), None)
            if primary_class is None or len(primary_class["images"]) < IMAGE_CLASS_MIN_UNIQUE:
                continue
            high_candidates.append(bucket)
        if high_candidates:
            selected.append(max(high_candidates, key=lambda item: (item[0] * item[1], item[0], item[1])))

    assigned, _ = assign_images_to_resolution_classes(supported_images, selected)
    unassigned = []
    assigned_names = {image[0] for item in assigned for image in item["images"]}
    low_orphans = [image for image in supported_images if image[0] not in assigned_names]
    if low_orphans:
        lower_candidates = [
            bucket for bucket in candidate_buckets
            if bucket[0] < primary[0] and bucket[1] < primary[1]
            and all(image_bucket_compatibility(image, bucket) for image in low_orphans)
        ]
        if lower_candidates:
            selected.append(max(lower_candidates, key=lambda item: (item[0] * item[1], item[0], item[1])))
        else:
            unassigned.extend(image[0] for image in low_orphans)

    selected = list(dict.fromkeys(selected))[:IMAGE_CLASS_MAX_PER_AR]
    classes, remaining_unsupported = assign_images_to_resolution_classes(supported_images, selected)
    unsupported.extend(unassigned)
    unsupported.extend(remaining_unsupported)
    unsupported = list(dict.fromkeys(unsupported))
    classes.sort(key=lambda item: (item["bucket"][0] * item["bucket"][1], item["bucket"][0], item["bucket"][1]))
    return classes, unsupported


def mfp(w: int, h: int, frames: int):
    return (w // 32) * (h // 32) * frames


def render_image_block(image_dir: Path, ar_label: str, buckets, num_repeats: int = 1):
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
    for w, h in buckets:
        alts = image_alternatives(ar_label, w, h)
        mfp_val = (w * h * 1) / 1_000_000
        if alts:
            lines.append("# Alternatives: " + ", ".join(f"[{aw}, {ah}, 1]" for (aw, ah) in alts))
        lines.append(f"  [{w}, {h}, 1],  # MegaFramePixels: {mfp_val:.2f}M")
    lines.append("]")
    return "\n".join(lines)


def render_dataset_entry(entry, num_repeats: int):
    kind = entry["kind"]
    if kind == "video":
        return render_video_block(
            entry["dir_path"],
            entry["buckets"],
            num_repeats=num_repeats,
            resolution_cap=entry.get("resolution_cap"),
        )
    if kind == "image":
        return render_image_block(entry["path"], entry["ar_label"], entry["buckets"], num_repeats=num_repeats)
    raise ValueError(f"Unknown dataset entry kind: {kind}")


def image_alternatives(ar_label: str, selected_w: int, selected_h: int):
    short_side = min(selected_w, selected_h)
    offsets = [-128, -96, -64, -32, 32, 64, 96, 128]
    alts = []
    for offset in offsets:
        dim = short_side + offset
        alt = candidate_for_short_side(ar_label, dim)
        if alt and alt != (selected_w, selected_h) and alt not in alts:
            alts.append(alt)
    # Only return up to 3 lower and 3 higher, sorted by short_side distance
    lower = [alt for alt in alts if min(alt) < short_side]
    higher = [alt for alt in alts if min(alt) > short_side]
    lower = sorted(lower, key=lambda x: abs(min(x) - short_side))[:3]
    higher = sorted(higher, key=lambda x: abs(min(x) - short_side))[:3]
    return lower + higher


def candidate_for_short_side(ar_label: str, short_side: int):
    if short_side < ALT_MIN_IMAGE_SIDE:
        return None
    target_ar = AR_CLASSES[ar_label]
    if ar_label == "square":
        if short_side > ALT_MAX_SQUARE_DIM:
            return None
        return (short_side, short_side)
    if target_ar >= 1:
        h = short_side
        w = snap_32_nearest(h * target_ar)
    else:
        w = short_side
        h = snap_32_nearest(w / target_ar)
    if max(w, h) > ALT_MAX_NON_SQUARE_LONG:
        return None
    if min(w, h) > ALT_MAX_NON_SQUARE_SHORT:
        return None
    if abs((w / float(h)) - target_ar) > AR_TOL:
        return None
    return (w, h)


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
