from pathlib import Path
import base64
import math
import os
import tempfile
from io import BytesIO

from PIL import Image, ImageOps

from .caption_ops import _validate_media_name
from .originals import ensure_original_by_hash, ensure_originals_folder, safe_chmod


CROPPABLE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
IMAGE_TRANSPOSE_OPERATIONS = {
    "rotate_left_90": Image.Transpose.ROTATE_90,
    "rotate_right_90": Image.Transpose.ROTATE_270,
    "flip_vertical": Image.Transpose.FLIP_TOP_BOTTOM,
    "flip_horizontal": Image.Transpose.FLIP_LEFT_RIGHT,
}


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


def _decode_image_data_url(image_data_url):
    if not isinstance(image_data_url, str) or not image_data_url.startswith("data:image/"):
        raise ValueError("Invalid cropped image payload")
    marker = ";base64,"
    idx = image_data_url.find(marker)
    if idx == -1:
        raise ValueError("Invalid cropped image payload")
    encoded = image_data_url[idx + len(marker):]
    if not encoded:
        raise ValueError("Invalid cropped image payload")
    try:
        return base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("Invalid cropped image payload") from exc


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


def crop_image_data_url_in_place(folder_path, file_name, image_data_url):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name

    if image_path.suffix.lower() not in CROPPABLE_IMAGE_EXTS:
        raise ValueError("Crop only supports image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    image_bytes = _decode_image_data_url(image_data_url)

    tmp_path = None
    with Image.open(image_path) as original_image:
        original_format = original_image.format or _target_format_for_suffix(image_path, "PNG")

    with Image.open(BytesIO(image_bytes)) as decoded_image:
        out_image = decoded_image.copy()

    target_format = _target_format_for_suffix(image_path, original_format)
    if target_format == "JPEG" and out_image.mode not in ("RGB", "L"):
        out_image = out_image.convert("RGB")

    save_kwargs = {}
    if target_format == "JPEG":
        save_kwargs["quality"] = 95
    elif target_format == "WEBP":
        save_kwargs["quality"] = 95

    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{image_path.stem}.crop-",
        suffix=image_path.suffix,
        dir=str(folder_path),
    )
    os.close(fd)
    tmp_path = Path(tmp_name)

    try:
        out_image.save(tmp_path, format=target_format, **save_kwargs)
        os.replace(tmp_path, image_path)
        safe_chmod(image_path, 0o644)
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink()

    return {"width": out_image.width, "height": out_image.height}


def transform_image_in_place(folder_path, file_name, operation):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    op = str(operation or "").strip().lower()
    image_path = folder_path / file_name

    if op not in IMAGE_TRANSPOSE_OPERATIONS:
        raise ValueError("Unsupported image transform operation")
    if image_path.suffix.lower() not in CROPPABLE_IMAGE_EXTS:
        raise ValueError("Image transform only supports still image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    tmp_path = None
    with Image.open(image_path) as image:
        image_format = image.format
        work_image = ImageOps.exif_transpose(image)
        transformed = work_image.transpose(IMAGE_TRANSPOSE_OPERATIONS[op])

        if image_format == "JPEG" and transformed.mode not in ("RGB", "L"):
            transformed = transformed.convert("RGB")

        save_kwargs = {}
        if image_format == "JPEG":
            save_kwargs["quality"] = 95

        fd, tmp_name = tempfile.mkstemp(
            prefix=f".{image_path.stem}.transform-",
            suffix=image_path.suffix,
            dir=str(folder_path),
        )
        os.close(fd)
        tmp_path = Path(tmp_name)

        try:
            transformed.save(tmp_path, format=image_format, **save_kwargs)
            os.replace(tmp_path, image_path)
            safe_chmod(image_path, 0o644)
        finally:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink()

    return {"width": transformed.width, "height": transformed.height, "operation": op}
