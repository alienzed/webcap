from pathlib import Path
import math
import os
import tempfile

from PIL import Image, ImageOps

from .caption_ops import _validate_media_name
from .originals import ensure_original_by_hash, ensure_originals_folder, safe_chmod


CROPPABLE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _crop_value(crop, key):
    value = crop.get(key)
    if not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"Invalid crop {key}")
    return int(round(value))


def _read_crop_box(crop, image_width, image_height):
    if not isinstance(crop, dict):
        raise ValueError("Invalid crop data")

    left = _crop_value(crop, "x")
    top = _crop_value(crop, "y")
    width = _crop_value(crop, "width")
    height = _crop_value(crop, "height")
    right = left + width
    bottom = top + height

    if left < 0 or top < 0 or width <= 0 or height <= 0:
        raise ValueError("Crop is outside the image")
    if right > image_width or bottom > image_height:
        raise ValueError("Crop is outside the image")

    return left, top, right, bottom


def crop_image_in_place(folder_path, file_name, crop):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name

    if image_path.suffix.lower() not in CROPPABLE_IMAGE_EXTS:
        raise ValueError("Crop only supports image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    tmp_path = None
    with Image.open(image_path) as image:
        image_format = image.format
        work_image = ImageOps.exif_transpose(image)
        box = _read_crop_box(crop, work_image.width, work_image.height)
        cropped = work_image.crop(box)

        if image_format == "JPEG" and cropped.mode not in ("RGB", "L"):
            cropped = cropped.convert("RGB")

        save_kwargs = {}
        if image_format == "JPEG":
            save_kwargs["quality"] = 95
        exif = cropped.getexif()
        if exif and image_format in ("JPEG", "WEBP"):
            save_kwargs["exif"] = exif.tobytes()

        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{image_path.stem}.crop-",
            suffix=image_path.suffix,
            dir=str(folder_path),
        )
        os.close(fd)
        tmp_path = Path(tmp_name)

        try:
            cropped.save(tmp_path, format=image_format, **save_kwargs)
            os.replace(tmp_path, image_path)
            safe_chmod(image_path, 0o644)
        finally:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink()

    return {"width": box[2] - box[0], "height": box[3] - box[1]}
