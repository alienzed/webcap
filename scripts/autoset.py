#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
WAN / diffusion-pipe dataset auto-preparation tool.

Key behavior:
- Respects AR snapping:
  - square: w == h, both divisible by 32
  - 4:3, 16:9, 9:16: w,h divisible by 32, AR within tolerance
- Chooses bucket resolutions by coverage over *actual clip resolutions* (no intentional upscaling).
- Uses mfp_limit as a ceiling to avoid swapping.
- Ensures each usable clip appears in at least one bucket (via a fallback bucket if needed).
- Detects a "highres plateau" per AR (top normalized resolutions within 5% of max),
  and optionally creates a separate highres bucket ONLY if the normal detail bucket
  would otherwise downscale these clips.

WAN-related caps:
- Square AR: max 1024x1024
- Non-square AR: max_long_edge=1280, max_short_edge=720
"""

import argparse
import json
import shutil
import subprocess
import math
import subprocess
import shlex
import shutil
import os
import statistics
from PIL import Image
from pathlib import Path

# -------------------------
# Configuration parameters
# -------------------------

# Upper bound for search; actual caps are AR-specific below.
MAX_DIM = 768
SQUARE_DETAIL_MAX_DIM = 768      # hard cap for square detail buckets
DETAIL_MAX_DIM = 768            # hard cap for non-square detail buckets
MIN_FRAMES_FOR_STATS = 16      # Ignore clips shorter than this for stats/buckets
MIN_FRAMES_FOR_MOTION = 33     # Treat shorter clips as unreliable for motion bucket (skip rather than poison)
AR_TOL = 0.05                  # ± tolerance for aspect ratio classification

# Motion bucket: long temporal span, high coverage
# LONG_MOTION_FRAME_CANDIDATES = [65, 49, 45, 41, 37, 33]
LONG_MOTION_FRAME_CANDIDATES = [49, 45, 41, 37, 33]

# Detail bucket: few frames, high-res emphasis (top 50% by area)
# Simplified: unify detail to 13 frames (previously [5,1] → now 13f)
DETAIL_FRAME_CANDIDATES = [13]
DETAIL_TOP_FRACTION = 0.5      # top 50% highest-res clips per AR
MIN_DETAIL_FRACTION = 0.3      # don't make a detail bucket if <30% of clips can support it

# Middle bucket: only used when detail bucket can't be formed robustly
MIDDLE_FRAME_CANDIDATES = [21, 17, 13]
MIN_MIDDLE_CLIPS = 8

# VRAM limits → "mfp" ceilings
VRAM_TO_MFP = {
    24: 8800,   # 24GB
    32: 12000,  # 32GB
}

# Supported still image formats
IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"]

# Image tiering defaults (adaptive percentile split per AR)
IMG_HIGHRES_PERCENT = 0.0   # disabled: keep images in one tier
IMG_MIN_HIGHRES_COUNT = 4    # don't create a highres tier with fewer images than this
IMG_MEDIAN_RATIO_MIN = 1.25  # require meaningful resolution separation to create a highres tier
IMG_COVERAGE = 0.80          # bucket support threshold per tier (avoid upscaling)
IMG_REGULAR_MAX_DIM = 512    # keep image buckets small to avoid swapping
IMG_HIGHRES_MAX_DIM = 768   # disabled (kept for compatibility)

# AR buckets: label → (target_ar, lane name)
AR_CLASSES = {
    "square": (1.0, "square"),
    "43": (4/3, "43"),
    "169": (16/9, "169"),
    "916": (9/16, "916"),
}

# WAN-ish caps
MAX_SQUARE_DIM = 768             # square max 768x768
MAX_NON_SQUARE_LONG = 768        # e.g. 768x720, 720x768 etc.
MAX_NON_SQUARE_SHORT = 768

# -------------------------
# Eval bucket caps (NEW)
# -------------------------

EVAL_BUCKET_CAPS = {
    "square": (512, 512),
    "43":     (640, 480),
    "169":    (704, 416),
    "916":    (416, 704),
}


# Highres plateau tolerance (normalized area >= 0.95 * max)
HIGHRES_TOL = 0.05


# -------------------------
# ffprobe utility function
# -------------------------

def ffprobe_info(video: Path):
    """
    Return (width, height, nb_frames) or None.
    Keeps behaviour simple and predictable: if parsing fails, skip clip.
    """
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,nb_frames",
        "-of", "csv=p=0",
        str(video)
    ]
    try:
        out = subprocess.check_output(cmd).decode().strip()
    except Exception:
        return None

    if not out:
        return None

    parts = out.split(",")
    if len(parts) < 3:
        return None

    try:
        w = int(parts[0])
        h = int(parts[1])
        f = int(parts[2])
        return w, h, f
    except Exception:
        return None


# -------------------------
# Aspect ratio classification
# -------------------------



def image_info(img: Path):
    """Return (width, height) for a still image, or None on failure."""
    try:
        with Image.open(img) as im:
            w, h = im.size
        return int(w), int(h)
    except Exception:
        return None
def classify_ar(w: int, h: int):
    ar = w / float(h)
    for label, (target, _) in AR_CLASSES.items():
        if abs(ar - target) <= AR_TOL:
            return label
    return None


# -------------------------
# mfp computation
# -------------------------

def mfp(w: int, h: int, frames: int):
    """
    Megaframe-pixels proxy.
    """
    return (w // 32) * (h // 32) * frames


# -------------------------
# Candidate resolution generation
# -------------------------

def within_wan_caps(ar_label: str, w: int, h: int) -> bool:
    """
    Enforce WAN-ish caps:
    - square: w == h <= 1024
    - non-square: max_edge <= 1280, min_edge <= 720
    """
    if ar_label == "square":
        if w != h:
            return False
        return w <= MAX_SQUARE_DIM and h <= MAX_SQUARE_DIM
    else:
        long_edge = max(w, h)
        short_edge = min(w, h)
        if long_edge > MAX_NON_SQUARE_LONG:
            return False
        if short_edge > MAX_NON_SQUARE_SHORT:
            return False
        return True


def generate_candidate_resolutions_for_ar(target_ar: float, ar_label: str):
    """
    Enumerate possible (w, h) for a given AR class, using:
    - square: w == h, 32-divisible, <= 1024
    - others: w,h 32-divisible, AR within AR_TOL, <= 1280x720-ish
    Returns list of (w, h, area) sorted by area descending.
    """
    candidates = []
    is_square = (ar_label == "square")

    # upper bound for search; caps are checked via within_wan_caps
    max_h = MAX_SQUARE_DIM if is_square else MAX_NON_SQUARE_LONG

    for h in range(256, max_h + 1, 32):
        if is_square:
            w = h
        else:
            ideal_w = target_ar * h
            w = int(round(ideal_w / 32) * 32)

        if w < 256:
            continue
        if w > MAX_DIM:
            continue

        if not is_square:
            ar_val = w / float(h)
            if abs(ar_val - target_ar) > AR_TOL:
                continue

        if not within_wan_caps(ar_label, w, h):
            continue

        area = w * h
        candidates.append((w, h, area))

    candidates.sort(key=lambda x: x[2], reverse=True)
    return candidates


# -------------------------
# Copy video + .txt caption
# -------------------------

def copy_with_caption(src: Path, dst_dir: Path):
    dst_dir.mkdir(parents=True, exist_ok=True)

    # Copy video
    dst = dst_dir / src.name
    copy_or_convert(src, dst, target_fps=16)
    #shutil.copy2(src, dst)

    # Caption
    txt_path = src.with_suffix(".txt")
    if txt_path.exists():
        dst_txt = dst_dir / txt_path.name
        text = txt_path.read_text(encoding="utf-8")

        # Normalize caption for WAN training
        cleaned = text.replace("\r\n", " ").replace("\n", " ")
        cleaned = " ".join(cleaned.split())

        import re
        cleaned = re.sub(r"([.,])([^\s])", r"\1 \2", cleaned)

        if cleaned and cleaned[-1] not in ".!?":
            cleaned += "."

        dst_txt.write_text(cleaned, encoding="utf-8")

# -------------------------
# Move video + .txt caption
# -------------------------

def move_with_caption(src: Path, dst_dir: Path):
    dst_dir.mkdir(parents=True, exist_ok=True)

    dst = dst_dir / src.name
    if dst.exists():
        dst.unlink()
    shutil.move(src, dst)

    txt = src.with_suffix(".txt")
    if txt.exists():
        dst_txt = dst_dir / txt.name
        if dst_txt.exists():
            dst_txt.unlink()
        shutil.move(txt, dst_txt)


# -------------------------
# Bucket selection helpers
# -------------------------



def copy_image_with_caption(src: Path, dst_dir: Path):
    """
    Copy a still image and its matching .txt caption (same basename) into dst_dir.
    Applies the same caption cleaning rules as videos.
    """
    dst_dir.mkdir(parents=True, exist_ok=True)

    dst = dst_dir / src.name
    shutil.copy2(src, dst)

    txt_path = src.with_suffix(".txt")
    if txt_path.exists():
        dst_txt = dst_dir / txt_path.name
        text = txt_path.read_text(encoding="utf-8")

        cleaned = text.replace("\r\n", " ").replace("\n", " ")
        cleaned = " ".join(cleaned.split())

        import re
        cleaned = re.sub(r"([.,])([^\s])", r"\1 \2", cleaned)

        if cleaned and cleaned[-1] not in ".!?":
            cleaned += "."

        dst_txt.write_text(cleaned, encoding="utf-8")
def select_frames_with_fallback(frame_counts, candidates, coverage_threshold):
    """
    Try the desired frame count. If not enough clips can satisfy it,
    step downward through candidates.

    coverage_threshold is relative to *eligible* clips in this set (by frames).
    Returns best_frames or None.
    """
    eligible = [f for f in frame_counts if f >= MIN_FRAMES_FOR_STATS]
    if not eligible:
        return None

    total = len(eligible)

    for cand in candidates:
        num_ok = sum(1 for f in eligible if f >= cand)
        if total == 0:
            continue
        frac = num_ok / total
        if num_ok > 0 and frac >= coverage_threshold:
            return cand

    # fallback: largest usable frames if nothing meets threshold
    for cand in candidates:
        if any(f >= cand for f in eligible):
            return cand

    return None


# ------------------------------------------------------------------
# NEW helper – copy a file or convert its framerate if needed
# ------------------------------------------------------------------
def copy_or_convert(src_path, dst_path, target_fps):
    """
    Copy *src_path* to *dst_path*, converting the frame‑rate only if it differs
    from *target_fps* by more than a tiny margin.
    """
    # Query current fps
    fps_query = (
        f'ffprobe -v error -select_streams v:0 '
        f'-show_entries stream=avg_frame_rate '
        f'-of default=noprint_wrappers=1:nokey=1 "{src_path}"'
    )
    res = subprocess.run(
        shlex.split(fps_query),
        capture_output=True,
        text=True,
        check=True
    )
    fps_raw = res.stdout.strip()
    try:
        cur_fps = eval(fps_raw)          # e.g. "30000/1001" → 29.97
    except Exception:
        cur_fps = None

    # Decide whether to convert
    if cur_fps is None or abs(cur_fps - target_fps) > 0.1:
        # Make sure destination dir exists
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)

        # Perform the conversion
        convert_cmd = (
            f'ffmpeg -y -i "{src_path}" -vf "fps={target_fps}" '
            f'-c:v libx264 -crf 18 -preset slow -an -threads 8 "{dst_path}"'
        )
        subprocess.run(shlex.split(convert_cmd), check=True)
    else:
        # Just copy – no re‑encoding
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        shutil.copy2(src_path, dst_path)



def choose_bucket_resolution(ar_label: str,
                             target_ar: float,
                             frames: int,
                             clips,
                             coverage_threshold: float,
                             mfp_limit: int):
    """
    Choose a (w, h) for a bucket given:
    - AR label + target AR
    - frames
    - list of clips: list of (vid, clip_w, clip_h, clip_f)
    - required coverage threshold
    - mfp limit
    """

    candidates = generate_candidate_resolutions_for_ar(target_ar, ar_label)
    if not candidates:
        return None

    usable_clips = [(vid, cw, ch, cf) for (vid, cw, ch, cf) in clips if cf >= frames]
    if not usable_clips:
        return None

    total = len(usable_clips)
    best_fallback = None  # (coverage_frac, area, w, h, mfp_val)

    for (w, h, area) in candidates:
        if ar_label != "square" and max(w, h) > DETAIL_MAX_DIM:
            continue
        val = mfp(w, h, frames)
        if val > mfp_limit:
            continue

        num_ok = 0
        for _, cw, ch, cf in usable_clips:
            if cw >= w and ch >= h:
                num_ok += 1

        if num_ok == 0:
            continue

        frac = num_ok / total
        entry = (frac, area, w, h, val)

        if frac >= coverage_threshold:
            return w, h, val

        if best_fallback is None or frac > best_fallback[0] or (
            frac == best_fallback[0] and area > best_fallback[1]
        ):
            best_fallback = entry

    if best_fallback is None:
        return None

    _, _, w, h, val = best_fallback
    return w, h, val




def choose_image_bucket_resolution(
    ar_label: str,
    target_ar: float,
    images,
    coverage_threshold: float,
    max_dim: int | None = None,
):
    """
    Choose (w,h) for image-only buckets (frames=1).

    Coverage counts an image as supporting a bucket only if:
      img_w >= w and img_h >= h

    If max_dim is provided, candidate resolutions with max(w,h) > max_dim are discarded.
    This avoids drifting into overly large buckets for WAN and reduces overfit risk.
    """
    candidates = generate_candidate_resolutions_for_ar(target_ar, ar_label)
    if not candidates or not images:
        return None

    if max_dim is not None:
        candidates = [(w, h, area) for (w, h, area) in candidates if max(w, h) <= max_dim]

    best = None  # (frac, area, w, h)
    total = len(images)

    for (w, h, area) in candidates:
        num_ok = 0
        for (_, iw, ih) in images:
            if iw >= w and ih >= h:
                num_ok += 1

        frac = num_ok / total
        area = w * h

        if frac >= coverage_threshold:
            return (w, h)

        if best is None or frac > best[0] or (frac == best[0] and area > best[1]):
            best = (frac, area, w, h)

    if best is None:
        return None
    return (best[2], best[3])


def split_images_by_percentile(
    images,
    highres_percent: float,
    min_highres_count: int,
    median_ratio_min: float,
):
    """
    Split images into (regular, highres) groups based on a percentile of quality,
    where quality is min(width, height).

    Guardrails:
      - If there aren't enough images to form a meaningful highres tier, return (all, []).
      - If the highres tier isn't meaningfully higher-res (median ratio), return (all, []).
    """
    if not images:
        return [], []

    if len(images) < (min_highres_count * 2):
        # Can't form two non-trivial groups
        return images, []

    # Sort high → low by min-side, then by area
    ranked = sorted(images, key=lambda x: (min(x[1], x[2]), x[1] * x[2]), reverse=True)

    # Choose top P%
    n = int(math.ceil(len(ranked) * highres_percent))
    n = max(min_highres_count, min(n, len(ranked) - min_highres_count))

    high = ranked[:n]
    reg = ranked[n:]

    # Median separation check
    mins_all = [min(w, h) for (_, w, h) in ranked]
    mins_high = [min(w, h) for (_, w, h) in high]

    med_all = statistics.median(mins_all)
    med_high = statistics.median(mins_high)

    if med_all <= 0:
        return images, []

    if (med_high / med_all) < median_ratio_min:
        return images, []

    return reg, high


def pick_image_buckets_for_ar(images, ar_label: str, target_ar: float):
    """
    Single-tier image bucketing (fast + swap-safe).
    Returns:
      (regular_images, regular_bucket), (high_images(empty), None)
    """
    reg = images
    reg_bucket = choose_image_bucket_resolution(
        ar_label=ar_label,
        target_ar=target_ar,
        images=reg,
        coverage_threshold=IMG_COVERAGE,
        max_dim=IMG_REGULAR_MAX_DIM,
    )
    return (reg, reg_bucket), ([], None)
def compute_clip_area(w: int, h: int) -> int:
    return w * h

# -------------------------
# Eval selection helper
# -------------------------

def select_eval_clips(ar_clips):
    """
    Select eval clips conservatively.
    Works with autoset's existing (path, w, h, frames) tuple format.
    """

    MIN_EVAL_CLIPS = 3
    MAX_EVAL_FRACTION = 0.25

    eval_selection = {}

    for ar, clips in ar_clips.items():
        total = len(clips)

        # clips are tuples: (path, w, h, frames)
        if total < MIN_EVAL_CLIPS * 2:
            continue

        # sort by resolution, then frames (same intent as before)
        sorted_clips = sorted(
            clips,
            key=lambda c: (
                min(c[1], c[2]),          # w, h
                c[1] * c[2],              # area
                c[3],                     # frames
            ),
            reverse=True,
        )

        max_allowed = max(
            MIN_EVAL_CLIPS,
            int(total * MAX_EVAL_FRACTION),
        )

        quota = min(len(sorted_clips), max_allowed)

        if quota < MIN_EVAL_CLIPS:
            continue

        eval_selection[ar] = sorted_clips[:quota]

    return eval_selection



# -------------------------
# MAIN SCRIPT
# -------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Automatic dataset.auto.toml generator for WAN/diffusion-pipe."
    )
    parser.add_argument("--master", required=True,
                        help="Folder containing raw videos + .txt captions.")
    parser.add_argument("--vram", type=int, choices=[24, 32], default=32,
                        help="GPU VRAM in GB (affects mfp limit).")
    parser.add_argument("--coverage", type=float, default=0.85,
                        help="Required fraction of clips supporting a frame count in motion bucket.")
    parser.add_argument("--toml-name", default="dataset.auto.toml",
                        help="Output TOML filename (written under auto_dataset/).")
    parser.add_argument("--make-eval", action="store_true",
                    help="Create a deterministic eval subset under auto_dataset/eval/")
    parser.add_argument('--target_fps',
        type=int,
        default=16,
        help='Desired framerate for all clips that end up in the buckets (default 16, set to 24 for higher‑quality video).')
    parser.add_argument('--recursive', action='store_true',
                        help='Recursively scan subdirectories for videos and images (default: single folder only).')
    parser.add_argument('--verbose', action='store_true',
                        help='Write detailed JSON outputs (wan_auto_buckets.json, resolution_rankings.json).')
    args = parser.parse_args()

    target_fps = args.target_fps   # 16 by default, 24 if the user supplied it

    master = Path(args.master).resolve()
    dataset_root = master / "auto_dataset"
    dataset_root.mkdir(exist_ok=True)

    if args.vram not in VRAM_TO_MFP:
        raise SystemExit(f"Unsupported VRAM={args.vram}GB; valid keys: {list(VRAM_TO_MFP.keys())}")

    mfp_limit = VRAM_TO_MFP[args.vram]
    print(f"[INFO] Using VRAM={args.vram}GB → mfp_limit={mfp_limit}")


    # Scan videos + images
    if args.recursive:
        print(f"[INFO] Recursively scanning {master} for videos and images...")
        videos = [p for p in master.rglob('*') 
                  if p.is_file() and p.suffix.lower() in [".mp4", ".mov", ".mkv", ".webm"]]
        images = [p for p in master.rglob('*')
                  if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    else:
        videos = [p for p in master.iterdir()
                  if p.suffix.lower() in [".mp4", ".mov", ".mkv", ".webm"]]
        images = [p for p in master.iterdir()
                  if p.suffix.lower() in IMAGE_EXTS]

    if not videos and not images:
        print("[ERROR] No videos or images found in master folder.")
        return

    if not videos:
        print("[WARN] No videos found in master folder; proceeding with images-only dataset.")
    if not images:
        print("[WARN] No images found in master folder; proceeding with videos-only dataset.")

    # AR buckets
    ar_clips = {k: [] for k in AR_CLASSES.keys()}
    ar_images = {k: [] for k in AR_CLASSES.keys()}

    if videos:
        print("[INFO] Classifying video ARs with ffprobe...")
    for vid in sorted(videos):
        info = ffprobe_info(vid)
        if not info:
            print(f"[WARN] Could not read metadata for {vid.name}; skipping.")
            continue
        w, h, f = info
        ar_label = classify_ar(w, h)
        if ar_label:
            ar_clips[ar_label].append((vid, w, h, f))
        else:
            print(f"[WARN] {vid.name} does not match AR classes (w={w}, h={h}); skipping for buckets.")

    if images:
        print("[INFO] Classifying image ARs...")
    for img in sorted(images):
        info = image_info(img)
        if not info:
            print(f"[WARN] Could not read image metadata for {img.name}; skipping.")
            continue
        w, h = info
        ar_label = classify_ar(w, h)
        if ar_label:
            ar_images[ar_label].append((img, w, h))
        else:
            print(f"[WARN] {img.name} does not match AR classes (w={w}, h={h}); skipping for buckets.")

    print("\n[INFO] Resolution ranking by AR (images, low → high):\n")

    for ar_label, items in sorted(ar_images.items()):
        rows = [(img.name, w, h, w*h) for (img, w, h) in items]
        rows.sort(key=lambda x: x[3])

        print(f"  AR={ar_label}: {len(rows)} images")
        for name, w, h, _ in rows:
            print(f"    {name:28s} {w:4d}x{h:4d}")
        print("")

    # Split into main vs highres plateau per AR
    ar_clips_main = {k: [] for k in AR_CLASSES.keys()}
    ar_clips_highres = {k: [] for k in AR_CLASSES.keys()}

    for ar_label, items in ar_clips.items():
        if not items:
            continue

        norm_info = []
        for (vid, w, h, f) in items:
            norm_w = w - (w % 32)
            norm_h = h - (h % 32)
            if norm_w <= 0 or norm_h <= 0:
                norm_w, norm_h = w, h
            norm_area = norm_w * norm_h
            norm_info.append((vid, w, h, f, norm_area))

        # Treat all clips as a single pool (no highres plateau split).
        # This avoids creating tiny *_highres directories and oversized buckets.
        main = [(vid, w, h, f) for (vid, w, h, f, _) in norm_info]
        highres = []
        ar_clips_main[ar_label] = main
        ar_clips_highres[ar_label] = highres

        print(
            f"[INFO] AR={ar_label}: {len(items)} clips "
        )

    toml_lines = ["enable_ar_bucket = true\n"]
    bucket_json = {}
    image_plan = {}


    # -------------------------
    # Bucket selection per AR
    # -------------------------
    for ar_label, (target_ar, _) in AR_CLASSES.items():
        main_clips = ar_clips_main.get(ar_label, [])
        hi_clips = ar_clips_highres.get(ar_label, [])
        images_ar = ar_images.get(ar_label, [])

        if not main_clips and not hi_clips and not images_ar:
            continue

        print(f"\n[INFO] Selecting buckets for AR={ar_label}")
        ar_dir = dataset_root / ar_label
        ar_img_dir = dataset_root / f"{ar_label}_img"
        ar_img_hi_dir = dataset_root / f"{ar_label}_img_highres"

        total_clips_ar = len(main_clips) + len(hi_clips)

        motion_bucket = None
        middle_bucket = None
        detail_bucket = None
        fallback_bucket = None
        highres_bucket = None

        # ------------- MAIN GROUP BUCKETS -------------
        if main_clips:
            usable_clips = [(vid, w, h, f) for (vid, w, h, f) in main_clips if f >= MIN_FRAMES_FOR_STATS]
            if not usable_clips:
                print(f"[WARN] No usable clips (>= {MIN_FRAMES_FOR_STATS} frames) for AR={ar_label} main group")
            else:
                # Motion bucket
                # Use all statistically viable clips (>= MIN_FRAMES_FOR_STATS) to drive
                # motion frame selection. Do NOT filter by MIN_FRAMES_FOR_MOTION
                # early — coverage logic must decide.
                frame_counts_all = [f for (_, _, _, f) in usable_clips]

                # Aim for ~90% coverage for motion buckets but respect user-supplied
                # coverage (don't reduce below it).
                motion_coverage = max(args.coverage, 0.9)

                motion_frames = select_frames_with_fallback(
                    frame_counts_all,
                    LONG_MOTION_FRAME_CANDIDATES,
                    motion_coverage,
                )

                # soften to user coverage if strict 90% didn't yield a candidate
                if not motion_frames:
                    motion_frames = select_frames_with_fallback(
                        frame_counts_all,
                        LONG_MOTION_FRAME_CANDIDATES,
                        args.coverage,
                    )

                if motion_frames:
                    # choose resolution using the same pool (usable_clips)
                    res = choose_bucket_resolution(
                        ar_label=ar_label,
                        target_ar=target_ar,
                        frames=motion_frames,
                        clips=usable_clips,
                        coverage_threshold=motion_coverage,
                        mfp_limit=mfp_limit,
                    )

                    # If resolution selection failed for some reason, fall back to
                    # the largest WAN-safe candidate (guarantee existence of motion bucket).
                    if not res:
                        cands = generate_candidate_resolutions_for_ar(target_ar, ar_label)
                        fallback_res = None
                        for (cw, ch, area) in cands:
                            if within_wan_caps(ar_label, cw, ch):
                                fallback_res = (cw, ch, mfp(cw, ch, motion_frames))
                                break
                        if fallback_res:
                            w_m, h_m, mfp_val_m = fallback_res
                            motion_bucket = (w_m, h_m, motion_frames)
                            print(f"  Motion bucket (main) [fallback]: {w_m}x{h_m} @ {motion_frames} frames (mfp={mfp_val_m})")
                        else:
                            print(f"  [WARN] Could not find any WAN-safe candidate for motion bucket in AR={ar_label} (main).")
                    else:
                        w_m, h_m, mfp_val_m = res
                        motion_bucket = (w_m, h_m, motion_frames)
                        print(f"  Motion bucket (main): {w_m}x{h_m} @ {motion_frames} frames (mfp={mfp_val_m})")

                    # Report any clips that cannot support the final motion bucket.
                    skipped = []
                    for (vid, cw, ch, cf) in main_clips:
                        if cf < motion_frames or cw < w_m or ch < h_m:
                            skipped.append((vid.name, cw, ch, cf))

                    if skipped:
                        print(f"\n[WARN] The following clips do NOT meet the chosen motion bucket {w_m}x{h_m} @ {motion_frames} frames and will be skipped for motion:")
                        for (n, cw, ch, cf) in skipped:
                            print(f"  - {n}: {cw}x{ch}, {cf} frames")
                        print("")
                else:
                    # As a last resort, create a conservative low-res motion bucket
                    # so the AR always has a motion bucket (per policy).
                    cands = generate_candidate_resolutions_for_ar(target_ar, ar_label)
                    if cands:
                        cw, ch, _ = cands[-1]
                        motion_frames = LONG_MOTION_FRAME_CANDIDATES[-1]
                        motion_bucket = (cw, ch, motion_frames)
                        print(f"  Motion bucket (main) [conservative fallback]: {cw}x{ch} @ {motion_frames} frames")
                    else:
                        print(f"  [WARN] No candidates available to create a conservative motion bucket for AR={ar_label}.")

                # Detail bucket policy: skip entirely if motion short edge >= 512
                detail_bucket = None
                if motion_bucket and min(motion_bucket[0], motion_bucket[1]) >= 512:
                    print(f"  [INFO] Detail bucket skipped: motion bucket short edge {min(motion_bucket[0], motion_bucket[1])} >= 512 (sufficient spatial resolution).")
                else:
                    # Detail bucket selection: higher-res than motion, optional spatial enrichment
                    sorted_by_area = sorted(
                        usable_clips,
                        key=lambda x: compute_clip_area(x[1], x[2]),
                        reverse=True
                    )
                    total_usable = len(sorted_by_area)
                    
                    # Generate candidates that are strictly higher-res than motion
                    cands = generate_candidate_resolutions_for_ar(target_ar, ar_label)
                    motion_area = (motion_bucket[0] * motion_bucket[1]) if motion_bucket else 0
                    
                    allowed = []
                    for (cw, ch, area) in cands:
                        if area <= motion_area:
                            continue
                        if not within_wan_caps(ar_label, cw, ch):
                            continue
                        # Apply detail caps
                        if ar_label == "square":
                            if cw > SQUARE_DETAIL_MAX_DIM or ch > SQUARE_DETAIL_MAX_DIM:
                                continue
                        else:
                            if min(cw, ch) > DETAIL_MAX_DIM:
                                continue
                        allowed.append((cw, ch, area))

                    if not allowed:
                        print(f"  [INFO] Detail bucket skipped: no WAN-safe candidates exist that are higher-res than motion for AR={ar_label}.")
                    else:
                        # Pick largest allowed resolution (honest detail enrichment)
                        allowed.sort(key=lambda x: x[2], reverse=True)
                        w_d, h_d, _ = allowed[0]
                        
                        # Compute how many clips can support this detail resolution
                        # (must meet minimum frame requirement: at least 5 frames)
                        min_detail_frames = 5
                        num_support = sum(1 for (_, cw, ch, cf) in usable_clips 
                                        if cw >= w_d and ch >= h_d and cf >= min_detail_frames)
                        
                        if num_support == 0:
                            print(f"  [INFO] Detail bucket skipped: no clips can support {w_d}x{h_d} at {min_detail_frames}+ frames.")
                        else:
                            support_frac = num_support / float(total_usable) if total_usable > 0 else 0.0
                            
                            # Conditional frame selection based on support fraction
                            if support_frac >= 0.5:
                                detail_frames = 5  # good coverage, fewer frames
                            else:
                                detail_frames = 13  # lower coverage, more frames

                            # Verify at least some clips meet the final frame requirement
                            final_support = sum(1 for (_, cw, ch, cf) in usable_clips 
                                              if cw >= w_d and ch >= h_d and cf >= detail_frames)
                            
                            if final_support == 0:
                                print(f"  [INFO] Detail bucket skipped: no clips can support {w_d}x{h_d} at {detail_frames} frames.")
                            else:
                                detail_bucket = (w_d, h_d, detail_frames)
                                final_support_frac = final_support / float(total_usable) if total_usable > 0 else 0.0
                                print(
                                    f"  Detail bucket (main): {w_d}x{h_d} @ {detail_frames} frames "
                                    f"using {final_support}/{total_usable} clips (support={final_support_frac:.2f})"
                                )

                # Middle bucket (main) disabled: keeps compute reasonable and avoids near-duplicate buckets.

                # Coverage tracking for fallback
                ar_dir = dataset_root / ar_label
                covered_clip_ids = set()

                def mark_coverage(bucket, clips_for_ar):
                    if not bucket:
                        return
                    bw, bh, bf = bucket
                    for (vid, cw, ch, cf) in clips_for_ar:
                        if cf >= bf and cw >= bw and ch >= bh:
                            covered_clip_ids.add(id(vid))

                mark_coverage(motion_bucket, usable_clips)

                mark_coverage(detail_bucket, usable_clips)

                # Write main buckets into TOML (single directory stanza per AR)
                video_buckets = []
                if motion_bucket:
                    video_buckets.append(motion_bucket)
                if detail_bucket:
                    video_buckets.append(detail_bucket)

                # De-dup near-identical resolutions (keep the one with higher frames)
                dedup = {}
                for (w, h, f) in video_buckets:
                    key = (w, h)
                    if key not in dedup or f > dedup[key]:
                        dedup[key] = f
                video_buckets = [(w, h, f) for (w, h), f in dedup.items()]

                # Prefer motion first (higher frames), then detail
                video_buckets.sort(key=lambda x: x[2], reverse=True)

                if video_buckets:
                    # compute support counts for motion and detail (for dominance decisions)
                    motion_support = 0
                    detail_support = 0
                    if motion_bucket:
                        mw, mh, mf = motion_bucket
                        motion_support = sum(1 for (_, cw, ch, cf) in usable_clips if cf >= mf and cw >= mw and ch >= mh)
                    if detail_bucket:
                        dw, dh, df = detail_bucket
                        detail_support = sum(1 for (_, cw, ch, cf) in usable_clips if cf >= df and cw >= dw and ch >= dh)

                    # Helper: emit commented alternative suggestions for a chosen bucket
                    def _emit_alternatives(chosen_w, chosen_h, chosen_f):
                        """Show adjacent resolutions (±32px steps) without frame counts. Can exceed caps."""
                        # Generate all candidates without cap filtering for alternatives
                        is_square = (ar_label == "square")
                        all_cands = []
                        
                        # Extend range beyond caps for alternatives
                        max_h = 1024 if is_square else 1024
                        for h in range(256, max_h + 1, 32):
                            if is_square:
                                w = h
                            else:
                                ideal_w = target_ar * h
                                w = int(round(ideal_w / 32) * 32)
                            
                            if w < 256:
                                continue
                            
                            if not is_square:
                                ar_val = w / float(h)
                                if abs(ar_val - target_ar) > AR_TOL:
                                    continue
                            
                            area = w * h
                            all_cands.append((w, h, area))
                        
                        all_cands.sort(key=lambda x: x[2], reverse=True)
                        
                        if not all_cands:
                            return []
                        
                        # Find the index of the chosen resolution
                        chosen_idx = None
                        for i, (w, h, area) in enumerate(all_cands):
                            if w == chosen_w and h == chosen_h:
                                chosen_idx = i
                                break
                        
                        if chosen_idx is None:
                            return []
                        
                        # Get adjacent resolutions (one step down and one step up), excluding current
                        alts = []
                        if chosen_idx + 1 < len(all_cands):  # one step smaller (higher index = smaller area)
                            w, h, _ = all_cands[chosen_idx + 1]
                            alts.append(f"[{w}, {h}]")
                        
                        if chosen_idx - 1 >= 0:  # one step larger (lower index = larger area)
                            w, h, _ = all_cands[chosen_idx - 1]
                            alts.append(f"[{w}, {h}]")
                        
                        # Skip if we have no alternatives
                        if len(alts) == 0:
                            return []
                        
                        return alts

                    # If detail is substantial relative to motion, split into two stanzas
                    split_detail = False
                    if detail_bucket and motion_support > 0:
                        if (detail_support / float(motion_support)) >= 0.65:
                            split_detail = True
                            print(f"  [INFO] Detail bucket supports {detail_support}/{motion_support} clips (>=65%): splitting into separate stanza.")

                    if split_detail:
                        # Emit two stanzas but point both at the same AR directory.
                        # This preserves controlled exposure (detail with num_repeats=1)
                        # while avoiding creation of a separate *_detail directory.
                        # motion stanza (num_repeats=2)
                        mw, mh, mf = motion_bucket
                        toml_lines += [
                            "\n[[directory]]",
                            f'path = "{ar_dir.as_posix()}"',
                            "num_repeats = 2",
                            'group = "videos"',
                            "size_buckets = [",
                        ]
                        alts = _emit_alternatives(mw, mh, mf)
                        if alts:
                            toml_lines.append(f"# Alternatives: {', '.join(alts)}")
                        toml_lines.append(f"  [{mw}, {mh}, {mf}],")
                        toml_lines += ["]"]

                        # detail stanza (num_repeats=1) — use same ar_dir instead of separate detail_dir
                        dw, dh, df = detail_bucket
                        toml_lines += [
                            "\n[[directory]]",
                            f'path = "{ar_dir.as_posix()}"',
                            "num_repeats = 1",
                            'group = "videos"',
                            "size_buckets = [",
                        ]
                        alts = _emit_alternatives(dw, dh, df)
                        if alts:
                            toml_lines.append(f"# Alternatives: {', '.join(alts)}")
                        toml_lines.append(f"  [{dw}, {dh}, {df}],")
                        toml_lines += ["]"]
                    else:
                        # single stanza: motion first then detail (if present)
                        toml_lines += [
                            "\n[[directory]]",
                            f'path = "{ar_dir.as_posix()}"',
                            "num_repeats = 2",
                            'group = "videos"',
                            "size_buckets = [",
                        ]
                        for (w, h, f) in video_buckets:
                            # emit alternatives comment per-bucket
                            alts = _emit_alternatives(w, h, f)
                            if alts:
                                toml_lines.append(f"# Alternatives: {', '.join(alts)}")
                            toml_lines.append(f"  [{w}, {h}, {f}],")
                        toml_lines += ["]"]

        # ------------- HIGHRES BUCKET (disabled) -------------
        # Intentionally disabled: prefer skipping outliers over creating *_highres directories.

        # -------------------------
        # Image buckets (optional 2-tier split)
        # -------------------------
        image_bucket_regular = None
        image_bucket_highres = None
        reg_images = []
        hi_images = []
        if images_ar:
            (reg_images, image_bucket_regular), (hi_images, image_bucket_highres) = pick_image_buckets_for_ar(
                images=images_ar,
                ar_label=ar_label,
                target_ar=target_ar,
            )

            if image_bucket_regular:
                iw, ih = image_bucket_regular
                # Emit commented alternatives for image bucket
                cands = generate_candidate_resolutions_for_ar(target_ar, ar_label)
                filtered = [ (w,h,a) for (w,h,a) in cands if within_wan_caps(ar_label,w,h) and max(w,h) <= IMG_REGULAR_MAX_DIM ]
                alt_line = None
                if filtered:
                    min_w, min_h, _ = filtered[-1]
                    max_w, max_h, _ = filtered[0]
                    alt_line = f"# Alternatives MIN/MID/MAX for images: [{min_w}, {min_h}, 1], [{iw}, {ih}, 1], [{max_w}, {max_h}, 1]"

                toml_lines += [
                    "\n[[directory]]",
                    f'path = "{ar_img_dir.as_posix()}"',
                    "num_repeats = 1",
                    'group = "images"',
                    "size_buckets = [",
                ]
                if alt_line:
                    toml_lines.append(alt_line)
                toml_lines += [
                    f"  [{iw}, {ih}, 1],",
                    "]",
                ]

            if hi_images and image_bucket_highres:
                iw, ih = image_bucket_highres
                # Highres image bucket with alternatives
                cands = generate_candidate_resolutions_for_ar(target_ar, ar_label)
                filtered = [ (w,h,a) for (w,h,a) in cands if within_wan_caps(ar_label,w,h) and min(w,h) >= 256 ]
                alt_line = None
                if filtered:
                    min_w, min_h, _ = filtered[-1]
                    max_w, max_h, _ = filtered[0]
                    alt_line = f"# Alternatives MIN/MID/MAX for images (highres): [{min_w}, {min_h}, 1], [{iw}, {ih}, 1], [{max_w}, {max_h}, 1]"

                toml_lines += [
                    "\n[[directory]]",
                    f'path = "{ar_img_hi_dir.as_posix()}"',
                    "num_repeats = 1",
                    'group = "images"',
                    "size_buckets = [",
                ]
                if alt_line:
                    toml_lines.append(alt_line)
                toml_lines += [
                    f"  [{iw}, {ih}, 1],",
                    "]",
                ]

        # Stash image selections for the copy step
        image_plan[ar_label] = {
            "regular": [p.as_posix() for (p, _, _) in reg_images] if reg_images else [],
            "highres": [p.as_posix() for (p, _, _) in hi_images] if hi_images else [],
            "bucket_regular": image_bucket_regular,
            "bucket_highres": image_bucket_highres,
        }

        # Store split_detail decision for file copy phase
        split_detail_flag = False
        if detail_bucket and motion_bucket:
            mw, mh, mf = motion_bucket
            motion_support = sum(1 for (_, cw, ch, cf) in main_clips if cf >= mf and cw >= mw and ch >= mh)
            dw, dh, df = detail_bucket
            detail_support = sum(1 for (_, cw, ch, cf) in main_clips if cf >= df and cw >= dw and ch >= dh)
            if motion_support > 0 and (detail_support / float(motion_support)) >= 0.65:
                split_detail_flag = True

        bucket_json[ar_label] = {
            "motion": motion_bucket,
            "middle": middle_bucket,
            "detail": detail_bucket,
            "fallback": fallback_bucket,
            "highres": highres_bucket,
            "split_detail": split_detail_flag,
            "num_clips": total_clips_ar,
            "num_main_clips": len(main_clips),
            "num_highres_clips": len(hi_clips),
            "num_images": len(ar_images.get(ar_label, [])),
            "image_bucket_regular": image_bucket_regular,
            "image_bucket_highres": image_bucket_highres,
        }

    # -------------------------
    # Copy files according to final bucket decisions
    # -------------------------
    print("\n[INFO] Copying files into auto_dataset/... (videos + cleaned captions)")

    for ar_label in AR_CLASSES.keys():
        main_clips = ar_clips_main[ar_label]
        hi_clips = ar_clips_highres[ar_label]
        img_plan = image_plan.get(ar_label, {})
        reg_imgs = [Path(p) for p in img_plan.get("regular", [])]
        hi_imgs = [Path(p) for p in img_plan.get("highres", [])]
        if not main_clips and not hi_clips and not reg_imgs and not hi_imgs:
            continue

        # Handle split_detail case: copy to motion dir and/or detail dir
        all_clips = main_clips + hi_clips
        if all_clips:
            ar_bucket_info = bucket_json.get(ar_label, {})
            motion_bucket = ar_bucket_info.get("motion")
            detail_bucket = ar_bucket_info.get("detail")
            split_detail = ar_bucket_info.get("split_detail", False)

            ar_dir = dataset_root / ar_label
            
            if split_detail and detail_bucket:
                # Split mode: keep controlled exposure but write everything into the
                # main AR directory (avoid separate *_detail dirs). Motion clips get
                # their motion stanza exposure (num_repeats=2), detail-supporting clips
                # also receive the detail exposure via the separate TOML stanza
                # that points at the same `ar_dir`.
                mw, mh, mf = motion_bucket
                dw, dh, df = detail_bucket

                for (vid, w, h, f) in all_clips:
                    # Copy to main AR directory if clip supports either stanza
                    if (w >= mw and h >= mh and f >= mf) or (w >= dw and h >= dh and f >= df):
                        copy_with_caption(vid, ar_dir)
            else:
                # Normal mode: copy all to main AR directory
                for (vid, w, h, f) in all_clips:
                    copy_with_caption(vid, ar_dir)

        # Copy images (if any) according to the image_plan for this AR
        if reg_imgs:
            img_dir = dataset_root / f"{ar_label}_img"
            for p in reg_imgs:
                if p.exists():
                    copy_image_with_caption(p, img_dir)


    # -------------------------
    # RESOLUTION RANKING REPORT (with 20% prune suggestion)
    # -------------------------




    print("\n[INFO] Resolution ranking by AR (low → high):")

    resolution_json = {}
    PRUNE_FRACTION = 0.20  # lowest 20% suggested for pruning

    for ar_label, items in ar_clips.items():
        if not items:
            continue

        ranked = sorted(
            items,
            key=lambda x: (min(x[1], x[2]), x[1] * x[2])
        )

        print(f"\n  AR={ar_label}: {len(ranked)} clips (sorted low → high)")
        for (vid, w, h, f) in ranked:
            print(f"    {vid.name:30s}  {w}x{h:4d}  {f} frames")

        prune_count = max(1, int(len(ranked) * PRUNE_FRACTION))
        prune_candidates = ranked[:prune_count]

        print(f"  Suggested prune candidates (lowest {PRUNE_FRACTION*100:.0f}% = {prune_count} clips):")
        for (vid, w, h, f) in prune_candidates:
            print(f"    - {vid.name} ({w}x{h}, {f} frames)")

        resolution_json[ar_label] = {
            "ranked": [
                {"name": v.name, "path": v.as_posix(), "w": w, "h": h, "frames": f}
                for (v, w, h, f) in ranked
            ],
            "prune_candidates": [
                {"name": v.name, "path": v.as_posix(), "w": w, "h": h, "frames": f}
                for (v, w, h, f) in prune_candidates
            ]
        }

    if args.verbose:
        res_json_path = dataset_root / "resolution_rankings.json"
        with res_json_path.open("w", encoding="utf-8") as jf:
            json.dump(resolution_json, jf, indent=2)
        print(f"[INFO] Resolution rankings written to {res_json_path}\n")

    # Write TOML
    toml_path = dataset_root / args.toml_name
    with toml_path.open("w", encoding="utf-8") as f:
        f.write("\n".join(toml_lines) + "\n")

    if args.verbose:
        json_path = dataset_root / "wan_auto_buckets.json"
        with json_path.open("w", encoding="utf-8") as f:
            json.dump(bucket_json, f, indent=2)
        print(f"[INFO] Bucket summary written to {json_path}\n")

    print(f"[INFO] Dataset TOML written to {toml_path}")
    # -------------------------
    # EVAL SET GENERATION (optional)
    # -------------------------

    if args.make_eval:
        print("\n[INFO] Creating eval set...")

        eval_root = dataset_root / "eval"
        eval_root.mkdir(exist_ok=True)

        eval_selection = select_eval_clips(ar_clips)

        if not eval_selection:
            print("[WARN] Eval skipped: insufficient clips per AR.")
            print("[WARN] No eval dataset will be written.")
        else:
            eval_manifest = {}
            eval_toml_lines = ["enable_ar_bucket = true\n"]


            for ar_label, clips in eval_selection.items():
                if not clips:
                    continue

                ar_dir = eval_root / ar_label
                ar_dir.mkdir(parents=True, exist_ok=True)

                for (vid, w, h, f) in clips:
                    train_ar_dir = dataset_root / ar_label
                    eval_ar_dir = eval_root / ar_label
                    eval_ar_dir.mkdir(parents=True, exist_ok=True)

                    train_vid = train_ar_dir / vid.name
                    if train_vid.exists():
                        move_with_caption(train_vid, eval_ar_dir)


                # Eval bucket: use motion resolution + fixed frames
                motion_bucket = bucket_json.get(ar_label, {}).get("motion")
                if not motion_bucket:
                    continue

                bw, bh, _ = motion_bucket
                EVAL_FRAMES = 17

                eval_toml_lines += [
                    "\n[[directory]]",
                    f'path = "{ar_dir.as_posix()}"',
                    "num_repeats = 1",
                    'group = "videos"',
                    "size_buckets = [",
                    f"  [{bw}, {bh}, {EVAL_FRAMES}],",
                    "]",
                ]


                eval_manifest[ar_label] = [vid.name for (vid, _, _, _) in clips]

            # Write eval TOML
            eval_toml_path = eval_root / "dataset.auto.toml"
            with eval_toml_path.open("w", encoding="utf-8") as f:
                f.write("\n".join(eval_toml_lines) + "\n")

            # Write eval manifest
            eval_manifest_path = eval_root / "eval_manifest.json"
            with eval_manifest_path.open("w", encoding="utf-8") as f:
                json.dump(eval_manifest, f, indent=2)

            print(f"[INFO] Eval dataset written to {eval_toml_path}")
        # end eval_generation_guard


    print("[INFO] Training example:")
    print(f'  dataset = "{toml_path.as_posix()}"')
    print("  python train.py --config your_config.toml")


if __name__ == "__main__":
    main()
