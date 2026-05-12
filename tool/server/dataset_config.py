import json
import math
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
MAX_IMAGE_MFP = 720
MIN_IMAGE_SIDE = 320
ALT_MIN_IMAGE_SIDE = 320
MAX_SELECTED_IMAGE_BUCKETS = 2
SECOND_BUCKET_MIN_COVERAGE = 0.40
MIN_BUCKET_SCALE_GAP = 0.16
ALT_MAX_SQUARE_DIM = 1024
ALT_MAX_NON_SQUARE_LONG = 1536
ALT_MAX_NON_SQUARE_SHORT = 1024


def generate_dataset_configs(folder_path: Path):
    folder = Path(folder_path)
    dataset_root = folder / "auto_dataset"
    auto_toml = dataset_root / "dataset.auto.toml"
    if not auto_toml.exists():
        raise FileNotFoundError(f"Missing autoset TOML: {auto_toml}")

    lines = []
    lines.append(f"[INFO] Reading autoset TOML: {auto_toml}")
    video_blocks = extract_video_blocks(auto_toml.read_text(encoding="utf-8"))
    lines.append(f"[INFO] Copied {len(video_blocks)} video directory block(s) from autoset.")

    image_dirs = find_image_dirs(dataset_root)
    lines.append(f"[INFO] Found {len(image_dirs)} prepared image folder(s).")

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

        buckets, unsupported = pick_image_buckets(ar_label, images)
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
        image_blocks.append(render_image_block(image_dir, ar_label, buckets))

    metadata_path = dataset_root / "webcap_dataset_metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    lines.append(f"[INFO] Wrote metadata cache: {metadata_path}")

    text = render_dataset_toml(video_blocks, image_blocks)
    hi_path = folder / "dataset.hi.toml"
    lo_path = folder / "dataset.lo.toml"
    hi_path.write_text(text, encoding="utf-8")
    lo_path.write_text(text, encoding="utf-8")
    lines.append(f"[INFO] Wrote {hi_path}")
    lines.append(f"[INFO] Wrote {lo_path}")

    return "\n".join(lines) + "\n"


def extract_video_blocks(toml_text: str):
    blocks = []
    current = []
    for line in toml_text.splitlines():
        if line.strip() == "[[directory]]":
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        blocks.append(current)

    video_blocks = []
    for block in blocks:
        if block_has_group(block, "videos"):
            video_blocks.append("\n".join(block).rstrip())
    return video_blocks


def block_has_group(block, group_name):
    needle1 = f'group = "{group_name}"'
    needle2 = f"group = '{group_name}'"
    for line in block:
        text = line.strip()
        if text == needle1 or text == needle2:
            return True
    return False


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


def generate_alternative_candidates(ar_label: str):
    return generate_candidates_with_caps(
        ar_label,
        ALT_MAX_SQUARE_DIM,
        ALT_MAX_NON_SQUARE_LONG,
        ALT_MAX_NON_SQUARE_SHORT,
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

    # Fallback path if we ever opt back into tolerant generation.
    else:
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


def pick_image_buckets(ar_label: str, images):
    candidates = generate_candidates(ar_label)
    if not candidates:
        raise ValueError(f"No image bucket candidates for AR={ar_label}")
    candidates = [
        (w, h, area)
        for (w, h, area) in candidates
        if min(w, h) >= MIN_IMAGE_SIDE
        if mfp(w, h, 1) <= MAX_IMAGE_MFP
    ]
    if not candidates:
        raise ValueError(f"No image bucket candidates under image mfp limit for AR={ar_label}")
    total = len(images)
    support = {}
    for (w, h, _) in candidates:
        support[(w, h)] = sum(1 for (_, iw, ih) in images if iw >= w and ih >= h)

    unsupported = []
    for i, (_, width, height) in enumerate(images):
        if not any(width >= w and height >= h for (w, h, _) in candidates):
            unsupported.append(images[i][0])

    best_primary = None  # (coverage, area, w, h)
    for (w, h, area) in candidates:
        entry = (support[(w, h)], area, w, h)
        if best_primary is None or entry[0] > best_primary[0] or (entry[0] == best_primary[0] and entry[1] > best_primary[1]):
            best_primary = entry
    if not best_primary:
        return [], unsupported
    primary = (best_primary[2], best_primary[3])

    selected = [primary]
    if MAX_SELECTED_IMAGE_BUCKETS <= 1 or total == 0:
        return selected, unsupported

    p_w, p_h = primary
    best_second = None  # (area, coverage, w, h)
    for (w, h, area) in candidates:
        if (w, h) == primary:
            continue
        if w <= p_w or h <= p_h:
            continue
        short_gap = (min(w, h) - min(p_w, p_h)) / float(min(p_w, p_h))
        if short_gap < MIN_BUCKET_SCALE_GAP:
            continue
        frac = support[(w, h)] / float(total)
        if frac < SECOND_BUCKET_MIN_COVERAGE:
            continue
        entry = (area, frac, w, h)
        if best_second is None or entry[0] > best_second[0] or (entry[0] == best_second[0] and entry[1] > best_second[1]):
            best_second = entry

    if best_second:
        selected.append((best_second[2], best_second[3]))
    return selected, unsupported


def mfp(w: int, h: int, frames: int):
    return (w // 32) * (h // 32) * frames


def render_image_block(image_dir: Path, ar_label: str, buckets):
    lines = [
        "[[directory]]",
        f'path = "{image_dir.as_posix()}"',
        "num_repeats = 1",
        'group = "images"',
        "size_buckets = [",
    ]
    for w, h in buckets:
        alts = image_alternatives(ar_label, w, h)
        if alts:
            lines.append("# Alternatives: " + ", ".join(f"[{aw}, {ah}, 1]" for (aw, ah) in alts))
        lines.append(f"  [{w}, {h}, 1],")
    lines.append("]")
    return "\n".join(lines)


def image_alternatives(ar_label: str, selected_w: int, selected_h: int):
    short_side = min(selected_w, selected_h)
    alts = []
    for dim in (short_side - 64, short_side - 32, short_side + 32, short_side + 64):
        alt = candidate_for_short_side(ar_label, dim)
        if alt and alt != (selected_w, selected_h):
            alts.append(alt)
    return alts


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


def render_dataset_toml(video_blocks, image_blocks):
    chunks = ["enable_ar_bucket = true"]
    chunks.extend(video_blocks)
    chunks.extend(image_blocks)
    return "\n\n".join(chunks).rstrip() + "\n"
