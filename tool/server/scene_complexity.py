from PIL import Image, ImageFilter, ImageOps, ImageStat


SCENE_COMPLEXITY_VERSION = 1
SCENE_COMPLEXITY_METHOD = "heuristic_v1"
SCENE_COMPLEXITY_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


def is_scene_complexity_image(file_path) -> bool:
    return str(getattr(file_path, "suffix", "") or "").lower() in SCENE_COMPLEXITY_IMAGE_EXTS


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


def _safe_mean(stat_obj, attr: str) -> float:
    values = getattr(stat_obj, attr, None) or []
    if not values:
        return 0.0
    try:
        return float(values[0] or 0.0)
    except Exception:
        return 0.0


def _bucket_scene_complexity(score: float) -> str:
    if not isinstance(score, (int, float)):
        return "unknown"
    if score < 0.33:
        return "simple"
    if score < 0.66:
        return "moderate"
    return "busy"


def _grid_edge_energy_ratios(edge_image, columns: int = 4, rows: int = 4) -> list[float]:
    width, height = edge_image.size
    if width <= 0 or height <= 0:
        return []
    cell_values = []
    for row_idx in range(rows):
        top = int(round((row_idx * height) / rows))
        bottom = int(round(((row_idx + 1) * height) / rows))
        if bottom <= top:
            continue
        for col_idx in range(columns):
            left = int(round((col_idx * width) / columns))
            right = int(round(((col_idx + 1) * width) / columns))
            if right <= left:
                continue
            cropped = edge_image.crop((left, top, right, bottom))
            cropped_mean = _safe_mean(ImageStat.Stat(cropped), "mean")
            cell_values.append(cropped_mean)
    return cell_values


def analyze_image_scene_complexity(file_path) -> dict:
    with Image.open(file_path) as source_image:
        image = ImageOps.exif_transpose(source_image).convert("L")
        image.thumbnail((320, 320), Image.Resampling.BICUBIC)
        if image.size[0] < 16 or image.size[1] < 16:
            return {
                "bucket": "unknown",
                "score": 0.0,
                "method": SCENE_COMPLEXITY_METHOD,
                "version": SCENE_COMPLEXITY_VERSION,
                "error": "image too small for scene complexity analysis",
            }

        grayscale_stats = ImageStat.Stat(image)
        contrast_std = _safe_mean(grayscale_stats, "stddev")

        edges = image.filter(ImageFilter.FIND_EDGES)
        edge_stats = ImageStat.Stat(edges)
        edge_mean = _safe_mean(edge_stats, "mean")

        cell_values = _grid_edge_energy_ratios(edges, columns=4, rows=4)
        total_cell_energy = sum(cell_values)
        top_share = (max(cell_values) / total_cell_energy) if total_cell_energy > 0 and cell_values else 1.0
        active_threshold = max(10.0, edge_mean * 0.85)
        active_ratio = (
            float(sum(1 for value in cell_values if value >= active_threshold)) / float(len(cell_values))
            if cell_values else 0.0
        )

        edge_signal = _clamp((edge_mean - 10.0) / 55.0)
        contrast_signal = _clamp((contrast_std - 18.0) / 45.0)
        spread_signal = _clamp((active_ratio - 0.2) / 0.6)
        dominance_signal = _clamp((0.42 - top_share) / 0.27)

        score = _clamp(
            (edge_signal * 0.34)
            + (contrast_signal * 0.23)
            + (spread_signal * 0.23)
            + (dominance_signal * 0.20)
        )
        score = round(score, 3)
        return {
            "bucket": _bucket_scene_complexity(score),
            "score": score,
            "method": SCENE_COMPLEXITY_METHOD,
            "version": SCENE_COMPLEXITY_VERSION,
        }
