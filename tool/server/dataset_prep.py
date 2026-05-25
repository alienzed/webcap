import json
import shutil
import subprocess
from pathlib import Path

from .media import update_media_metadata

VIDEO_EXTS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".ogg", ".wmv", ".mpg", ".mpeg"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
AR_CLASSES = {
    "square": 1.0,
    "43": 4 / 3,
    "34": 3 / 4,
    "169": 16 / 9,
    "916": 9 / 16,
}
AR_TOL = 0.05
PREP_MANIFEST_NAME = "prep_manifest.json"


def classify_ar(width: int, height: int):
    if not width or not height:
        return None
    ar = float(width) / float(height)
    for label, target in AR_CLASSES.items():
        if abs(ar - target) <= AR_TOL:
            return label
    return None


def parse_resolution(value):
    text = str(value or "").strip().lower()
    if "x" not in text:
        return None
    parts = text.split("x", 1)
    try:
        width = int(parts[0].strip())
        height = int(parts[1].strip())
    except Exception:
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def clean_caption_text(text):
    cleaned = str(text or "").replace("\r\n", " ").replace("\n", " ")
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return ""
    for punct in [",", "."]:
        cleaned = cleaned.replace(punct, punct + " ")
    cleaned = " ".join(cleaned.split())
    if cleaned[-1] not in ".!?":
        cleaned += "."
    return cleaned


def copy_clean_caption(source_media_path: Path, dest_dir: Path):
    source_caption = source_media_path.with_suffix(".txt")
    if not source_caption.exists() or not source_caption.is_file():
        raise RuntimeError(f"Missing caption file for media: {source_media_path.name}")
    cleaned = clean_caption_text(source_caption.read_text(encoding="utf-8"))
    if not cleaned:
        raise RuntimeError(f"Empty caption text for media: {source_media_path.name}")
    dest_caption = dest_dir / source_caption.name
    dest_caption.write_text(cleaned, encoding="utf-8")
    return cleaned


def normalize_selected_media(selected_media):
    if selected_media is None:
        return None
    if not isinstance(selected_media, list):
        raise RuntimeError("selected_media must be a list of filenames.")
    out = []
    seen = set()
    for raw in selected_media:
        name = str(raw or "").strip()
        if not name:
            continue
        if "/" in name or "\\" in name or ".." in name:
            raise RuntimeError(f"Invalid selected media filename: {name}")
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def convert_video_to_fps(src_path: Path, dst_path: Path, target_fps: int):
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(src_path),
        "-vf",
        f"fps={target_fps}:round=near,format=yuv420p",
        "-vsync",
        "cfr",
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        "14",
        "-preset",
        "slow",
        "-movflags",
        "+faststart",
        "-g",
        str(target_fps * 2),
        "-an",
        str(dst_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        stderr = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"ffmpeg failed for {src_path.name}: {stderr}")


def prepare_dataset(folder_path: Path, target_fps: int = 16, selected_media=None, selection_criteria=None, total_media_count=None):
    folder = Path(folder_path)
    dataset_root = folder / "auto_dataset"
    lines = []
    lines.append(f"[INFO] Preparing dataset from: {folder}")
    lines.append(f"[INFO] Target FPS: {target_fps}")

    if dataset_root.exists():
        shutil.rmtree(dataset_root)
    dataset_root.mkdir(parents=True, exist_ok=True)
    lines.append(f"[INFO] Rebuilt directory: {dataset_root}")

    metadata = update_media_metadata(folder)

    manifest = {
        "version": 1,
        "target_fps": int(target_fps),
        "videos": [],
        "images": [],
        "skipped": [],
        "selection": {},
    }

    file_names = sorted([p.name for p in folder.iterdir() if p.is_file()], key=lambda name: name.lower())
    media_file_names = [name for name in file_names if (folder / name).suffix.lower() in VIDEO_EXTS or (folder / name).suffix.lower() in IMAGE_EXTS]
    computed_total_media_count = len(media_file_names)
    normalized_selected_media = normalize_selected_media(selected_media)
    if normalized_selected_media is None:
        selected_file_names = list(media_file_names)
    else:
        media_lookup = {name.lower(): name for name in media_file_names}
        missing = [name for name in normalized_selected_media if name.lower() not in media_lookup]
        if missing:
            raise RuntimeError("Selected media not found in folder: " + ", ".join(missing))
        selected_file_names = sorted(
            [media_lookup[name.lower()] for name in normalized_selected_media],
            key=lambda name: name.lower(),
        )
    if not selected_file_names:
        raise RuntimeError("No selected media items to prepare.")
    selected_set = set(selected_file_names)

    final_total_media_count = computed_total_media_count
    if total_media_count is not None:
        try:
            reported_total = int(total_media_count)
            if reported_total > 0:
                final_total_media_count = reported_total
        except Exception:
            pass
    selection_mode = "all" if len(selected_file_names) >= computed_total_media_count else "visible_subset"
    criteria = selection_criteria if isinstance(selection_criteria, dict) else {}
    manifest["selection"] = {
        "mode": selection_mode,
        "selected_files": selected_file_names,
        "selected_count": len(selected_file_names),
        "total_count": int(final_total_media_count),
        "criteria": criteria,
    }
    lines.append(
        f"[INFO] Selection mode: {selection_mode} ({len(selected_file_names)} of {final_total_media_count} media files)"
    )

    for file_name in file_names:
        src = folder / file_name
        ext = src.suffix.lower()
        if ext not in VIDEO_EXTS and ext not in IMAGE_EXTS:
            continue
        if file_name not in selected_set:
            continue

        info = metadata.get(file_name) or {}
        dims = parse_resolution(info.get("resolution"))
        if not dims:
            manifest["skipped"].append({
                "file": file_name,
                "reason": "missing_resolution",
            })
            lines.append(f"[WARN] Skipped {file_name}: missing resolution metadata.")
            continue
        width, height = dims
        ar_label = classify_ar(width, height)
        if not ar_label:
            manifest["skipped"].append({
                "file": file_name,
                "reason": "unsupported_aspect_ratio",
                "resolution": f"{width}x{height}",
            })
            lines.append(f"[WARN] Skipped {file_name}: unsupported AR ({width}x{height}).")
            continue

        is_video = ext in VIDEO_EXTS
        dest_dir_name = ar_label if is_video else f"{ar_label}_img"
        dest_dir = dataset_root / dest_dir_name
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / src.name

        if is_video:
            fps = info.get("fps")
            should_convert = fps is None
            if fps is not None:
                try:
                    should_convert = abs(float(fps) - float(target_fps)) > 0.1
                except Exception:
                    should_convert = True
            if should_convert:
                convert_video_to_fps(src, dest_path, target_fps)
                action = "converted"
            else:
                shutil.copy2(src, dest_path)
                action = "copied"
            copy_clean_caption(src, dest_dir)
            manifest["videos"].append({
                "file": file_name,
                "ar": ar_label,
                "width": int(width),
                "height": int(height),
                "fps": float(fps) if fps is not None else None,
                "frames": info.get("frame_count"),
                "duration": info.get("duration"),
                "prepared_path": f"{dest_dir_name}/{src.name}",
                "caption": True,
                "action": action,
            })
        else:
            shutil.copy2(src, dest_path)
            copy_clean_caption(src, dest_dir)
            manifest["images"].append({
                "file": file_name,
                "ar": ar_label,
                "width": int(width),
                "height": int(height),
                "prepared_path": f"{dest_dir_name}/{src.name}",
                "caption": True,
            })

    manifest_path = dataset_root / PREP_MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    lines.append(f"[INFO] Videos prepared: {len(manifest['videos'])}")
    lines.append(f"[INFO] Images prepared: {len(manifest['images'])}")
    lines.append(f"[INFO] Skipped: {len(manifest['skipped'])}")
    lines.append(f"[INFO] Wrote prep manifest: {manifest_path}")
    return "\n".join(lines) + "\n"
