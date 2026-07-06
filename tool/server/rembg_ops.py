import os
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

from .caption_ops import _validate_media_name
from .originals import ensure_original_by_hash, ensure_originals_folder
from .permissions import normalize_path_permissions


REMBG_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
REMBG_MODEL_NAME = "u2net_human_seg"
REMBG_JPEG_BG = (230, 230, 230)
REMBG_BLUR_MIN_RADIUS = 12
REMBG_BLUR_MAX_RADIUS = 48
REMBG_BLUR_RADIUS_DIVISOR = 60

_REMBG_SESSION = None


def _get_rembg_session():
    global _REMBG_SESSION
    if _REMBG_SESSION is None:
        from rembg import new_session

        _REMBG_SESSION = new_session(REMBG_MODEL_NAME)
    return _REMBG_SESSION


def _target_format_for_suffix(image_path, fallback_format):
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "JPEG"
    if suffix == ".png":
        return "PNG"
    if suffix == ".webp":
        return "WEBP"
    if suffix == ".bmp":
        return "BMP"
    return fallback_format


def _flatten_onto_background(image, background_rgb):
    work = image.convert("RGBA")
    background = Image.new("RGBA", work.size, tuple(background_rgb) + (255,))
    composited = Image.alpha_composite(background, work)
    return composited.convert("RGB")


def _run_rembg_cutout(work_image):
    from rembg import remove

    processed = remove(work_image, session=_get_rembg_session())
    if not isinstance(processed, Image.Image):
        raise RuntimeError("rembg did not return an image result")
    return processed.copy().convert("RGBA")


def _save_processed_image(image_path, image_format, exif, out_image):
    target_format = _target_format_for_suffix(image_path, image_format)
    save_kwargs = {}
    if target_format == "JPEG":
        out_image = _flatten_onto_background(out_image, REMBG_JPEG_BG)
        save_kwargs["quality"] = 95
        if exif:
            save_kwargs["exif"] = exif.tobytes()
    elif target_format == "BMP":
        out_image = _flatten_onto_background(out_image, REMBG_JPEG_BG)
    else:
        out_image = out_image.convert("RGBA")
        if target_format == "WEBP":
            save_kwargs["quality"] = 95
            if exif:
                save_kwargs["exif"] = exif.tobytes()

    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{image_path.stem}.rembg-",
        suffix=image_path.suffix,
        dir=str(image_path.parent),
    )
    os.close(fd)
    tmp_path = Path(tmp_name)

    try:
        out_image.save(tmp_path, format=target_format, **save_kwargs)
        os.replace(tmp_path, image_path)
        normalize_path_permissions(image_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()

    return out_image


def remove_background_in_place(folder_path, file_name):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name

    if image_path.suffix.lower() not in REMBG_IMAGE_EXTS:
        raise ValueError("Background removal only supports still image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    with Image.open(image_path) as image:
        image_format = image.format or _target_format_for_suffix(image_path, "PNG")
        work_image = ImageOps.exif_transpose(image)
        exif = image.getexif()
        out_image = _run_rembg_cutout(work_image)
        out_image = _save_processed_image(image_path, image_format, exif, out_image)

    return {
        "width": out_image.width,
        "height": out_image.height,
        "model": REMBG_MODEL_NAME,
    }


def blur_background_in_place(folder_path, file_name):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name

    if image_path.suffix.lower() not in REMBG_IMAGE_EXTS:
        raise ValueError("Background blur only supports still image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    with Image.open(image_path) as image:
        image_format = image.format or _target_format_for_suffix(image_path, "PNG")
        work_image = ImageOps.exif_transpose(image)
        exif = image.getexif()
        foreground = _run_rembg_cutout(work_image)
        base_image = work_image.convert("RGBA")
        blur_radius = max(
            REMBG_BLUR_MIN_RADIUS,
            min(REMBG_BLUR_MAX_RADIUS, int(round(min(base_image.size) / REMBG_BLUR_RADIUS_DIVISOR))),
        )
        blurred_background = base_image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
        out_image = Image.alpha_composite(blurred_background, foreground)
        out_image = _save_processed_image(image_path, image_format, exif, out_image)

    return {
        "width": out_image.width,
        "height": out_image.height,
        "model": REMBG_MODEL_NAME,
        "blur_radius": blur_radius,
    }
