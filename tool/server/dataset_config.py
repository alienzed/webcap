import json
import hashlib
import math
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}

AR_CLASSES = {
    "square": 1.0,
    "43": 4 / 3,
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
ALT_MIN_IMAGE_SIDE = 256
NORMAL_SECOND_BUCKET_MIN_COVERAGE = 0.50
NORMAL_SECOND_BUCKET_MIN_SCALE = 1.25
NORMAL_SECOND_BUCKET_PRIMARY_SHORT_CAP = 512
ALT_MAX_SQUARE_DIM = 1024
ALT_MAX_NON_SQUARE_LONG = 1280
ALT_MAX_NON_SQUARE_SHORT = 1024

TRAINING_MODE_TARGETS = {
    "poc": {
        "square": (384, 384),
        "43": (448, 336),
        "169": (512, 288),
        "916": (288, 512),
    },
    "normal": {
        "square": (512, 512),
        "43": (592, 448),
        "169": (688, 384),
        "916": (384, 688),
    },
    "quality": {
        "square": (768, 768),
        "43": (1024, 768),
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
VIDEO_FRAME_CANDIDATES = [49, 45, 41, 37, 33]
VIDEO_FRAME_CANDIDATES_POC = [33, 29, 25, 21, 17]
MIN_VIDEO_FRAMES_FOR_STATS = 16
VIDEO_COVERAGE = 0.85
VIDEO_MFP_LIMIT = 12000
VIDEO_DETAIL_FRAMES = 13
VIDEO_DETAIL_MIN_COVERAGE = 0.35
VIDEO_DETAIL_MIN_SUPPORT = 2
POC_VIDEO_DETAIL_ENABLED = False
NORMAL_SECOND_BUCKET_MIN_SCALE_NON_SQUARE = 1.08


def normalize_training_generate_mode(mode):
    text = str(mode or "normal").strip().lower()
    if text not in TRAINING_MODE_TARGETS:
        text = "normal"
    return text


def generate_dataset_configs(folder_path: Path, mode: str = "normal"):
    folder = Path(folder_path)
    dataset_root = folder / "auto_dataset"
    manifest_path = dataset_root / PREP_MANIFEST_NAME
    if not manifest_path.exists():
        raise FileNotFoundError(f"Missing prep manifest: {manifest_path}")

    manifest = load_prep_manifest(manifest_path)
    generate_mode = normalize_training_generate_mode(mode)
    lines = []
    lines.append(f"[INFO] Reading prep manifest: {manifest_path}")
    lines.append(f"[INFO] Training generate mode: {generate_mode}")

    video_blocks = build_video_blocks(dataset_root, manifest.get("videos", []), lines, mode=generate_mode)
    lines.append(f"[INFO] Built {len(video_blocks)} video directory block(s).")
    image_only_set = len(video_blocks) == 0

    image_dirs = find_image_dirs(dataset_root)
    lines.append(f"[INFO] Found {len(image_dirs)} prepared image folder(s).")
    if image_only_set and image_dirs:
        lines.append("[INFO] Image-only set detected: defaulting image num_repeats to 2.")

    metadata = {}
    image_blocks = []
    for image_dir in image_dirs:
        ar_label = ar_from_image_dir(image_dir.name)
        images = read_image_metadata(image_dir)
        metadata[image_dir.name] = [
            {"name": name, "width": width, "height": height}
            for (name, width, height) in images
        ]
        lines.append(f"[INFO] {image_dir.name}: {len(images)} image(s)")
        if not images:
            continue

        buckets, unsupported = pick_image_buckets(ar_label, images, mode=generate_mode)
        if unsupported:
            lines.append(f"[WARN] {image_dir.name}: {len(unsupported)} image(s) smaller than every valid bucket:")
            for name in unsupported:
                lines.append(f"  - {name}")
        if not buckets:
            lines.append(f"[WARN] {image_dir.name}: no image buckets selected.")
            continue

        lines.append(
            f"[INFO] {image_dir.name}: selected image bucket(s): "
            + ", ".join(f"{w}x{h}" for (w, h) in buckets)
        )
        image_blocks.append(
            render_image_block(
                image_dir,
                ar_label,
                buckets,
                num_repeats=2 if image_only_set else 1,
            )
        )

    metadata_path = dataset_root / "webcap_dataset_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    lines.append(f"[INFO] Wrote metadata cache: {metadata_path}")

    snapshot_lines = build_selection_snapshot_comment_lines(folder, dataset_root, manifest)
    text = render_dataset_toml(video_blocks, image_blocks, snapshot_lines)
    hi_path = folder / "dataset.hi.toml"
    lo_path = folder / "dataset.lo.toml"
    hi_path.write_text(text, encoding="utf-8")
    lo_path.write_text(text, encoding="utf-8")
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


def build_video_blocks(dataset_root: Path, videos, lines, mode: str = "normal"):
    generate_mode = normalize_training_generate_mode(mode)
    grouped = {key: [] for key in AR_CLASSES}
    for row in videos:
        if not isinstance(row, dict):
            continue
        ar_label = str(row.get("ar") or "").strip()
        if ar_label not in grouped:
            continue
        width = to_pos_int(row.get("width"))
        height = to_pos_int(row.get("height"))
        frames = coerce_frames(row)
        prepared_path = str(row.get("prepared_path") or "").strip()
        if not width or not height or not prepared_path:
            continue
        abs_prepared = dataset_root / prepared_path
        if not abs_prepared.exists():
            continue
        grouped[ar_label].append({
            "width": width,
            "height": height,
            "frames": frames,
            "path": abs_prepared,
        })

    blocks = []
    for ar_label in AR_CLASSES.keys():
        clips = grouped.get(ar_label, [])
        if not clips:
            continue
        usable_for_frames = [c for c in clips if c["frames"] is not None and c["frames"] >= MIN_VIDEO_FRAMES_FOR_STATS]
        if not usable_for_frames:
            lines.append(f"[WARN] {ar_label}: no clips with usable frame metadata.")
            continue

        frame_counts = [c["frames"] for c in usable_for_frames]
        frame_candidates = VIDEO_FRAME_CANDIDATES_POC if generate_mode == "poc" else VIDEO_FRAME_CANDIDATES
        motion_frames = select_frames_with_fallback(frame_counts, frame_candidates, VIDEO_COVERAGE)
        if not motion_frames:
            lines.append(f"[WARN] {ar_label}: unable to choose motion frame count.")
            continue

        if generate_mode == "poc":
            target_w, target_h = TRAINING_MODE_TARGETS["poc"][ar_label]
            motion = choose_video_bucket_resolution_capped(
                ar_label,
                usable_for_frames,
                motion_frames,
                VIDEO_COVERAGE,
                VIDEO_MFP_LIMIT,
                target_w,
                target_h,
            )
        else:
            motion = choose_video_bucket_resolution(
                ar_label,
                usable_for_frames,
                motion_frames,
                VIDEO_COVERAGE,
                VIDEO_MFP_LIMIT,
            )
        if not motion:
            lines.append(f"[WARN] {ar_label}: unable to choose motion bucket resolution.")
            continue

        buckets = [(motion["width"], motion["height"], motion_frames)]
        lines.append(
            f"[INFO] {ar_label}: motion bucket {motion['width']}x{motion['height']} @ {motion_frames} "
            f"(support {motion['support']}/{motion['total']})"
        )

        if generate_mode != "poc" or POC_VIDEO_DETAIL_ENABLED:
            detail = choose_video_detail_bucket(ar_label, usable_for_frames, motion["width"], motion["height"])
            if detail:
                detail_tuple = (detail["width"], detail["height"], VIDEO_DETAIL_FRAMES)
                if detail_tuple not in buckets:
                    buckets.append(detail_tuple)
                    lines.append(
                        f"[INFO] {ar_label}: detail bucket {detail['width']}x{detail['height']} @ {VIDEO_DETAIL_FRAMES} "
                        f"(support {detail['support']}/{detail['total']})"
                    )

        buckets.sort(key=lambda item: item[2], reverse=True)
        dir_path = (dataset_root / ar_label).as_posix()
        blocks.append(render_video_block(dir_path, buckets))
    return blocks


def to_pos_int(value):
    try:
        parsed = int(value)
    except Exception:
        return None
    return parsed if parsed > 0 else None


def coerce_frames(record):
    frames = to_pos_int(record.get("frames"))
    if frames:
        return frames
    fps = record.get("fps")
    duration = record.get("duration")
    if fps is None or duration is None:
        return None
    try:
        estimate = int(round(float(fps) * float(duration)))
    except Exception:
        return None
    return estimate if estimate > 0 else None


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
    mfp_limit: int,
    max_w: int,
    max_h: int,
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


def choose_video_detail_bucket(ar_label: str, clips, motion_w: int, motion_h: int):
    candidates = generate_candidates(ar_label)
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


def video_alternatives(selected_w: int, selected_h: int, selected_frames: int):
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

def render_video_block(dir_path: str, buckets):
    lines = [
        "[[directory]]",
        f'path = "{dir_path}"',
        "num_repeats = 2",
        'group = "videos"',
        "size_buckets = [",
    ]
    for (w, h, frames) in buckets:
        alts = video_alternatives(w, h, frames)
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


def pick_image_buckets(ar_label: str, images, mode: str = "normal"):
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

    supported_images = []
    unsupported = []
    support = {}
    for row in images:
        name, iw, ih = row
        if any(iw >= w and ih >= h for (w, h, _) in candidates):
            supported_images.append(row)
        else:
            unsupported.append(name)

    total = len(supported_images)
    if total == 0:
        return [], unsupported

    for (w, h, _) in candidates:
        support[(w, h)] = sum(1 for (_, iw, ih) in supported_images if iw >= w and ih >= h)

    target_w, target_h = TRAINING_MODE_TARGETS[generate_mode][ar_label]
    primary = pick_primary_image_bucket(candidates, support, total, target_w, target_h, generate_mode)
    if not primary:
        return [], unsupported

    selected = [primary]
    if generate_mode == "normal":
        second = pick_secondary_image_bucket(candidates, support, total, primary)
        if second:
            selected.append(second)
    return selected, unsupported


def pick_primary_image_bucket(candidates, support, total, target_w, target_h, mode):
    full_coverage = [(w, h, area) for (w, h, area) in candidates if support[(w, h)] == total]
    if not full_coverage:
        # Fallback path for constrained datasets: maximize coverage first, then area.
        best = None
        for (w, h, area) in candidates:
            cov = support[(w, h)] / float(total)
            # Soft target tie-breaker to preserve expected mode behavior.
            in_target = 1 if (w <= target_w and h <= target_h) else 0
            entry = (cov, in_target, area, w, h)
            if best is None or entry > best:
                best = entry
        if best is None:
            return None
        return (best[3], best[4])

    # POC prioritizes lower compute: stay near target even with full coverage.
    if mode == "poc":
        at_or_below = [
            (w, h, area)
            for (w, h, area) in full_coverage
            if w <= target_w and h <= target_h
        ]
        if at_or_below:
            best = max(at_or_below, key=lambda item: item[2])
            return (best[0], best[1])

    # Normal/Quality (and POC fallback): for homogeneous/high-support sets,
    # prioritize the largest fully-supported bucket.
    best = max(full_coverage, key=lambda item: item[2])
    return (best[0], best[1])


def pick_secondary_image_bucket(candidates, support, total, primary):
    p_w, p_h = primary
    primary_short = min(p_w, p_h)
    if primary_short >= NORMAL_SECOND_BUCKET_PRIMARY_SHORT_CAP:
        return None

    scale_min = NORMAL_SECOND_BUCKET_MIN_SCALE
    if p_w != p_h:
        scale_min = NORMAL_SECOND_BUCKET_MIN_SCALE_NON_SQUARE

    best_second = None
    for (w, h, area) in candidates:
        if (w, h) == primary:
            continue
        if w <= p_w or h <= p_h:
            continue
        if min(w, h) < int(math.ceil(primary_short * scale_min)):
            continue
        frac = support[(w, h)] / float(total)
        if frac < NORMAL_SECOND_BUCKET_MIN_COVERAGE:
            continue
        if best_second is None or area > best_second[0]:
            best_second = (area, w, h)

    if not best_second:
        return None
    return (best_second[1], best_second[2])


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


def render_dataset_toml(video_blocks, image_blocks, snapshot_lines=None):
    chunks = ["enable_ar_bucket = true"]
    chunks.extend(video_blocks)
    chunks.extend(image_blocks)
    body = "\n\n".join(chunks).rstrip() + "\n"
    if not snapshot_lines:
        return body
    return "\n".join(snapshot_lines).rstrip() + "\n\n" + body
