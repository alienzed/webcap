from pathlib import Path


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
FACE_FOCUS_VERSION = 3
FACE_DETECTOR_INPUT_SIZE = (640, 640)
FACE_DETECTION_THRESHOLD = 0.4
FACE_CLOSE_HEIGHT_PCT = 30.0
FACE_MEDIUM_HEIGHT_PCT = 12.0
FACE_MIN_HEIGHT_PCT = 4.0
FACE_MIN_SCORE = 0.5


def is_face_focus_image(file_path):
    return Path(file_path).suffix.lower() in IMAGE_EXTS


def _round_pct(value):
    return round(float(value), 1)


def _bucket_for_detection(detection, image_width, image_height):
    if detection["edge_clipped"]:
        return "unknown"
    if detection["height_pct"] >= FACE_CLOSE_HEIGHT_PCT:
        return "close"
    if detection["height_pct"] >= FACE_MEDIUM_HEIGHT_PCT:
        return "medium"
    return "body"


def _is_plausible_face_detection(detection):
    return detection["score"] >= FACE_MIN_SCORE and detection["height_pct"] >= FACE_MIN_HEIGHT_PCT


def _detection_from_box(det, image_width, image_height):
    x1, y1, x2, y2, score = [float(v) for v in det[:5]]
    width = max(0.0, x2 - x1)
    height = max(0.0, y2 - y1)
    image_area = max(1.0, float(image_width * image_height))
    edge_slop = 1.0
    return {
        "x1": round(x1, 1),
        "y1": round(y1, 1),
        "x2": round(x2, 1),
        "y2": round(y2, 1),
        "width_pct": _round_pct((width / max(1.0, float(image_width))) * 100.0),
        "height_pct": _round_pct((height / max(1.0, float(image_height))) * 100.0),
        "area_pct": _round_pct(((width * height) / image_area) * 100.0),
        "score": round(score, 3),
        "edge_clipped": x1 <= edge_slop or y1 <= edge_slop or x2 >= image_width - edge_slop or y2 >= image_height - edge_slop,
    }


def get_face_focus_detector():
    from deface.centerface import CenterFace

    return CenterFace(in_shape=FACE_DETECTOR_INPUT_SIZE, backend="auto")


def analyze_image_face_focus(file_path, detector):
    import imageio.v2 as iio

    frame = iio.imread(file_path)
    image_height, image_width = frame.shape[:2]
    dets, _ = detector(frame, threshold=FACE_DETECTION_THRESHOLD)
    if len(dets) <= 0:
        return {
            "bucket": "unknown",
            "face_count": 0,
            "threshold": FACE_DETECTION_THRESHOLD,
            "detector_input_size": list(FACE_DETECTOR_INPUT_SIZE),
            "version": FACE_FOCUS_VERSION,
        }

    raw_detections = [
        _detection_from_box(det, image_width, image_height)
        for det in dets
    ]
    detections = [row for row in raw_detections if _is_plausible_face_detection(row)]
    if not detections:
        return {
            "bucket": "unknown",
            "face_count": 0,
            "raw_face_count": len(raw_detections),
            "threshold": FACE_DETECTION_THRESHOLD,
            "detector_input_size": list(FACE_DETECTOR_INPUT_SIZE),
            "min_height_pct": FACE_MIN_HEIGHT_PCT,
            "min_score": FACE_MIN_SCORE,
            "version": FACE_FOCUS_VERSION,
        }
    largest = max(detections, key=lambda row: (row["height_pct"], row["area_pct"], row["score"]))
    return {
        "bucket": _bucket_for_detection(largest, image_width, image_height),
        "face_count": len(detections),
        "raw_face_count": len(raw_detections),
        "largest_height_pct": largest["height_pct"],
        "largest_area_pct": largest["area_pct"],
        "largest_score": largest["score"],
        "largest_edge_clipped": largest["edge_clipped"],
        "threshold": FACE_DETECTION_THRESHOLD,
        "detector_input_size": list(FACE_DETECTOR_INPUT_SIZE),
        "min_height_pct": FACE_MIN_HEIGHT_PCT,
        "min_score": FACE_MIN_SCORE,
        "version": FACE_FOCUS_VERSION,
    }
