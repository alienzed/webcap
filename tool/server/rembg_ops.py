import os
import tempfile
from pathlib import Path

from PIL import Image, ImageOps

from .caption_ops import _validate_media_name
from .originals import ensure_original_by_hash, ensure_originals_folder
from .permissions import normalize_path_permissions


REMBG_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
REMBG_MODEL_NAME = "u2net_human_seg"
REMBG_JPEG_BG = (230, 230, 230)

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


def remove_background_in_place(folder_path, file_name):
    from rembg import remove

    folder_path = Path(folder_path).resolve()
    file_name = _validate_media_name(file_name)
    image_path = folder_path / file_name

    if image_path.suffix.lower() not in REMBG_IMAGE_EXTS:
        raise ValueError("Background removal only supports still image files")
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image file not found")

    originals_dir = ensure_originals_folder(folder_path)
    ensure_original_by_hash(image_path, originals_dir)

    tmp_path = None
    with Image.open(image_path) as image:
        image_format = image.format or _target_format_for_suffix(image_path, "PNG")
        work_image = ImageOps.exif_transpose(image)
        exif = image.getexif()
        processed = remove(work_image, session=_get_rembg_session())
        if not isinstance(processed, Image.Image):
            raise RuntimeError("rembg did not return an image result")
        out_image = processed.copy()

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
            dir=str(folder_path),
        )
        os.close(fd)
        tmp_path = Path(tmp_name)

        try:
            out_image.save(tmp_path, format=target_format, **save_kwargs)
            os.replace(tmp_path, image_path)
            normalize_path_permissions(image_path)
        finally:
            if tmp_path and tmp_path.exists():
                tmp_path.unlink()

    return {
        "width": out_image.width,
        "height": out_image.height,
        "model": REMBG_MODEL_NAME,
    }
