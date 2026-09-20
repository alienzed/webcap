import colorsys
import math
from pathlib import Path

from PIL import Image, ImageOps


COLOR_SUGGESTIONS_VERSION = 1
COLOR_SUGGESTIONS_METHOD = "pillow_lab_v1"
COLOR_SUGGESTION_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
COLOR_SUGGESTION_MAX_DIMENSION = 180
COLOR_SUGGESTION_BORDER_FRACTION = 0.08
COLOR_SUGGESTION_MIN_SHARE = 0.025
COLOR_SUGGESTION_MAX_RESULTS = 6


# Deliberately small, caption-friendly vocabulary. The analyzer reports colors,
# not object ownership, so labels stay generic (never "blonde", "skin", etc.).
_COLOR_PROTOTYPES = (
    ("black", (24, 24, 26)),
    ("white", (242, 242, 239)),
    ("gray", (132, 133, 136)),
    ("beige", (215, 199, 170)),
    ("tan", (184, 145, 99)),
    ("brown", (111, 75, 53)),
    ("red", (201, 49, 46)),
    ("burgundy", (104, 35, 49)),
    ("orange", (225, 118, 45)),
    ("yellow", (220, 193, 57)),
    ("green", (68, 141, 79)),
    ("olive", (118, 126, 65)),
    ("teal", (46, 128, 126)),
    ("turquoise", (59, 171, 168)),
    ("blue", (63, 105, 178)),
    ("navy", (37, 55, 94)),
    ("purple", (114, 77, 151)),
    ("pink", (216, 115, 153)),
)


def is_color_suggestion_image(file_path) -> bool:
    return Path(file_path).suffix.lower() in COLOR_SUGGESTION_IMAGE_EXTS


def _srgb_channel_to_linear(value):
    channel = float(value) / 255.0
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def _rgb_to_lab(rgb):
    r = _srgb_channel_to_linear(rgb[0])
    g = _srgb_channel_to_linear(rgb[1])
    b = _srgb_channel_to_linear(rgb[2])

    x = (r * 0.4124564) + (g * 0.3575761) + (b * 0.1804375)
    y = (r * 0.2126729) + (g * 0.7151522) + (b * 0.0721750)
    z = (r * 0.0193339) + (g * 0.1191920) + (b * 0.9503041)

    x /= 0.95047
    z /= 1.08883

    def pivot(value):
        if value > 0.008856:
            return value ** (1.0 / 3.0)
        return (7.787 * value) + (16.0 / 116.0)

    fx = pivot(x)
    fy = pivot(y)
    fz = pivot(z)
    return (
        (116.0 * fy) - 16.0,
        500.0 * (fx - fy),
        200.0 * (fy - fz),
    )


_COLOR_PROTOTYPE_LABS = tuple(
    (name, rgb, _rgb_to_lab(rgb))
    for name, rgb in _COLOR_PROTOTYPES
)


def _is_likely_skin(rgb):
    r, g, b = [int(v) for v in rgb]
    if r < 55 or r <= g or g <= b or (r - b) < 14:
        return False
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    hue_degrees = h * 360.0
    return (
        (hue_degrees <= 50.0 or hue_degrees >= 350.0)
        and 0.16 <= s <= 0.62
        and v >= 0.28
    )


def _nearest_color_name(rgb):
    r, g, b = [int(v) for v in rgb]
    _h, saturation, value = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)

    # Neutral colors are more stable when bucketed directly instead of asking
    # Lab distance to distinguish tiny warm/cool casts.
    if saturation <= 0.10:
        if value <= 0.20:
            return "black"
        if value >= 0.88:
            return "white"
        return "gray"

    lab = _rgb_to_lab((r, g, b))
    best_name = None
    best_distance = None
    for name, _prototype_rgb, prototype_lab in _COLOR_PROTOTYPE_LABS:
        if name in {"black", "white", "gray"}:
            continue
        distance = math.sqrt(
            ((lab[0] - prototype_lab[0]) ** 2)
            + ((lab[1] - prototype_lab[1]) ** 2)
            + ((lab[2] - prototype_lab[2]) ** 2)
        )
        if best_distance is None or distance < best_distance:
            best_name = name
            best_distance = distance
    return best_name or "gray"


def _center_crop(image):
    width, height = image.size
    inset_x = int(round(width * COLOR_SUGGESTION_BORDER_FRACTION))
    inset_y = int(round(height * COLOR_SUGGESTION_BORDER_FRACTION))
    left = min(max(0, inset_x), max(0, width - 1))
    top = min(max(0, inset_y), max(0, height - 1))
    right = max(left + 1, width - inset_x)
    bottom = max(top + 1, height - inset_y)
    return image.crop((left, top, right, bottom))


def _hex_from_rgb(rgb):
    r, g, b = [max(0, min(255, int(round(v)))) for v in rgb]
    return f"#{r:02x}{g:02x}{b:02x}"


def analyze_image_color_suggestions(file_path) -> dict:
    if not is_color_suggestion_image(file_path):
        raise RuntimeError("Color suggestions currently support still images only.")

    with Image.open(file_path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("RGBA")
        image.thumbnail(
            (COLOR_SUGGESTION_MAX_DIMENSION, COLOR_SUGGESTION_MAX_DIMENSION),
            Image.Resampling.BILINEAR,
        )
        image = _center_crop(image)

        counts = {}
        rgb_sums = {}
        sampled_pixels = 0
        ignored_skin_pixels = 0
        ignored_transparent_pixels = 0

        for r, g, b, a in image.getdata():
            if a < 64:
                ignored_transparent_pixels += 1
                continue
            sampled_pixels += 1
            rgb = (r, g, b)
            if _is_likely_skin(rgb):
                ignored_skin_pixels += 1
                continue
            name = _nearest_color_name(rgb)
            counts[name] = counts.get(name, 0) + 1
            current = rgb_sums.get(name, [0, 0, 0])
            current[0] += r
            current[1] += g
            current[2] += b
            rgb_sums[name] = current

        retained_pixels = sum(counts.values())
        suggestions = []
        if retained_pixels > 0:
            for name, count in counts.items():
                share = float(count) / float(retained_pixels)
                if share < COLOR_SUGGESTION_MIN_SHARE:
                    continue
                sums = rgb_sums[name]
                average_rgb = (
                    sums[0] / count,
                    sums[1] / count,
                    sums[2] / count,
                )
                suggestions.append({
                    "name": name,
                    "share": round(share, 4),
                    "hex": _hex_from_rgb(average_rgb),
                })

        suggestions.sort(key=lambda entry: (-entry["share"], entry["name"]))
        suggestions = suggestions[:COLOR_SUGGESTION_MAX_RESULTS]

        return {
            "version": COLOR_SUGGESTIONS_VERSION,
            "method": COLOR_SUGGESTIONS_METHOD,
            "suggestions": suggestions,
            "sampled_pixels": sampled_pixels,
            "retained_pixels": retained_pixels,
            "ignored_skin_pixels": ignored_skin_pixels,
            "ignored_transparent_pixels": ignored_transparent_pixels,
        }
