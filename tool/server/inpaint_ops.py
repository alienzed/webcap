"""Small masked still-image inpainting operation, using WebCap's originals model."""
import base64
from io import BytesIO
import os
from pathlib import Path
import tempfile

import cv2
import numpy as np
from PIL import Image, ImageOps

from .caption_ops import _validate_media_name
from .crop_ops import CROPPABLE_IMAGE_EXTS, _target_format_for_suffix
from .originals import ensure_original_by_hash, ensure_originals_folder
from .permissions import normalize_path_permissions


def inpaint_image_in_place(folder_path, file_name, mask_data_url):
    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name
    if image_path.suffix.lower() not in CROPPABLE_IMAGE_EXTS:
        raise ValueError("Remove Object only supports still images")
    if not image_path.is_file():
        raise FileNotFoundError("Image file not found")
    if not isinstance(mask_data_url, str) or not mask_data_url.startswith("data:image/png;base64,"):
        raise ValueError("Invalid object mask")

    try:
        mask_bytes = base64.b64decode(mask_data_url.partition(",")[2], validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise ValueError("Invalid object mask") from exc

    with Image.open(image_path) as original:
        if getattr(original, "is_animated", False) and getattr(original, "n_frames", 1) > 1:
            raise ValueError("Remove Object does not support animated images")
        original_format = _target_format_for_suffix(image_path, original.format or "PNG")
        icc_profile = original.info.get("icc_profile")
        work_image = ImageOps.exif_transpose(original)
        work_image.load()

    with Image.open(BytesIO(mask_bytes)) as mask_image:
        if mask_image.size != work_image.size:
            raise ValueError("Object mask dimensions must match the image")
        mask = np.asarray(mask_image.convert("L"), dtype=np.uint8)

    if not np.any(mask):
        raise ValueError("Paint over an object before applying")

    pixels = np.asarray(work_image.convert("RGB"), dtype=np.uint8)
    repaired = Image.fromarray(cv2.inpaint(pixels, mask, 3, cv2.INPAINT_TELEA), "RGB")
    if "A" in work_image.getbands():
        repaired = repaired.convert("RGBA")
        repaired.putalpha(work_image.getchannel("A"))
    elif work_image.mode == "L":
        repaired = repaired.convert("L")

    if original_format == "JPEG" and repaired.mode not in ("RGB", "L"):
        repaired = repaired.convert("RGB")
    save_kwargs = {}
    if original_format in ("JPEG", "WEBP"):
        save_kwargs["quality"] = 95
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    exif = work_image.getexif()
    if exif and original_format in ("JPEG", "WEBP"):
        save_kwargs["exif"] = exif.tobytes()

    originals_dir = ensure_originals_folder(folder_path)
    if originals_dir is None:
        raise RuntimeError("Cannot overwrite source in this folder")
    ensure_original_by_hash(image_path, originals_dir)

    fd, temp_name = tempfile.mkstemp(
        prefix=f".{image_path.stem}.inpaint-", suffix=image_path.suffix, dir=str(folder_path)
    )
    os.close(fd)
    temp_path = Path(temp_name)
    try:
        repaired.save(temp_path, format=original_format, **save_kwargs)
        os.replace(temp_path, image_path)
        normalize_path_permissions(image_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return {"width": repaired.width, "height": repaired.height}
