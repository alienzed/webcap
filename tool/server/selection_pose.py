import math
from pathlib import Path

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision


SELECTION_POSE_VERSION = 1
SELECTION_POSE_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
SELECTION_FACE_MODEL_PATH = Path(__file__).resolve().parents[1] / "vendor" / "mediapipe" / "models" / "face_landmarker.task"
SELECTION_POSE_MODEL_PATH = Path(__file__).resolve().parents[1] / "vendor" / "mediapipe" / "models" / "pose_landmarker_lite.task"
VISIBILITY_THRESHOLD = 0.45
POSE_LANDMARK_COUNT = 33

_FACE_LANDMARKER = None
_POSE_LANDMARKER = None


def is_selection_pose_image(file_path):
    return Path(file_path).suffix.lower() in SELECTION_POSE_IMAGE_EXTS


def _round_float(value, digits=3):
    try:
        return round(float(value), digits)
    except Exception:
        return None


def _ensure_models_exist():
    missing = []
    if not SELECTION_FACE_MODEL_PATH.exists():
        missing.append(str(SELECTION_FACE_MODEL_PATH))
    if not SELECTION_POSE_MODEL_PATH.exists():
        missing.append(str(SELECTION_POSE_MODEL_PATH))
    if missing:
        raise FileNotFoundError("Missing MediaPipe model file(s): " + ", ".join(missing))


def get_selection_pose_analyzers():
    global _FACE_LANDMARKER
    global _POSE_LANDMARKER
    _ensure_models_exist()
    if _FACE_LANDMARKER is None:
        face_options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(SELECTION_FACE_MODEL_PATH)),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.45,
            min_face_presence_confidence=0.45,
            min_tracking_confidence=0.45,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        _FACE_LANDMARKER = vision.FaceLandmarker.create_from_options(face_options)
    if _POSE_LANDMARKER is None:
        pose_options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(SELECTION_POSE_MODEL_PATH)),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.45,
            min_pose_presence_confidence=0.45,
            min_tracking_confidence=0.45,
            output_segmentation_masks=False,
        )
        _POSE_LANDMARKER = vision.PoseLandmarker.create_from_options(pose_options)
    return {
        "face_landmarker": _FACE_LANDMARKER,
        "pose_landmarker": _POSE_LANDMARKER,
    }


def _category_scores(categories):
    scores = {}
    for category in categories or []:
        name = str(getattr(category, "category_name", "") or "").strip()
        if not name:
            continue
        score = float(getattr(category, "score", 0.0) or 0.0)
        scores[name] = score
    return scores


def _score_avg(scores, names):
    values = [float(scores.get(name, 0.0) or 0.0) for name in names]
    return sum(values) / len(values) if values else 0.0


def _normalize_expression_scores(blendshape_scores):
    smile = _score_avg(blendshape_scores, ["mouthSmileLeft", "mouthSmileRight"])
    open_mouth = max(
        float(blendshape_scores.get("jawOpen", 0.0) or 0.0),
        _score_avg(blendshape_scores, ["mouthStretchLeft", "mouthStretchRight"]),
    )
    frown = max(
        _score_avg(blendshape_scores, ["mouthFrownLeft", "mouthFrownRight"]),
        _score_avg(blendshape_scores, ["browDownLeft", "browDownRight"]),
    )
    surprised = min(
        max(
            float(blendshape_scores.get("jawOpen", 0.0) or 0.0),
            float(blendshape_scores.get("mouthFunnel", 0.0) or 0.0),
        ),
        max(
            float(blendshape_scores.get("browInnerUp", 0.0) or 0.0),
            _score_avg(blendshape_scores, ["browOuterUpLeft", "browOuterUpRight"]),
        ),
        _score_avg(blendshape_scores, ["eyeWideLeft", "eyeWideRight"]),
    )
    eyes_closed = _score_avg(blendshape_scores, ["eyeBlinkLeft", "eyeBlinkRight"])
    pout = max(
        float(blendshape_scores.get("mouthPucker", 0.0) or 0.0),
        float(blendshape_scores.get("mouthFunnel", 0.0) or 0.0),
    )
    cheeks_puffed = float(blendshape_scores.get("cheekPuff", 0.0) or 0.0)
    scores = {
        "smile": smile,
        "open_mouth": open_mouth,
        "frown": frown,
        "surprised": surprised,
        "eyes_closed": eyes_closed,
        "pout": pout,
        "cheeks_puffed": cheeks_puffed,
    }
    return {key: round(value, 3) for key, value in scores.items() if value >= 0.2}


def _select_expressions(expression_scores):
    thresholds = {
        "smile": 0.45,
        "open_mouth": 0.42,
        "frown": 0.40,
        "surprised": 0.28,
        "eyes_closed": 0.55,
        "pout": 0.45,
        "cheeks_puffed": 0.45,
    }
    labels = [key for key, score in expression_scores.items() if score >= thresholds.get(key, 0.5)]
    labels.sort(key=lambda key: expression_scores.get(key, 0.0), reverse=True)
    if not labels:
        return "neutral", []
    return labels[0], labels


def _extract_face_angles(matrix):
    if matrix is None:
        return None, None, None
    try:
        r00 = float(matrix[0][0])
        r10 = float(matrix[1][0])
        r20 = float(matrix[2][0])
        r21 = float(matrix[2][1])
        r22 = float(matrix[2][2])
        r01 = float(matrix[0][1])
        r11 = float(matrix[1][1])
        sy = math.sqrt((r00 * r00) + (r10 * r10))
        singular = sy < 1e-6
        if not singular:
            pitch = math.degrees(math.atan2(r21, r22))
            yaw = math.degrees(math.atan2(-r20, sy))
            roll = math.degrees(math.atan2(r10, r00))
        else:
            pitch = math.degrees(math.atan2(-float(matrix[1][2]), r11))
            yaw = math.degrees(math.atan2(-r20, sy))
            roll = 0.0
        return _round_float(yaw, 1), _round_float(pitch, 1), _round_float(roll, 1)
    except Exception:
        return None, None, None


def _bucket_face_direction(yaw, pitch):
    if yaw is None or pitch is None:
        return "unknown"
    abs_yaw = abs(float(yaw))
    abs_pitch = abs(float(pitch))
    if abs_pitch >= 20.0 and abs_pitch > abs_yaw + 5.0:
        return "up" if pitch <= 0 else "down"
    if abs_yaw >= 45.0:
        return "left" if yaw < 0 else "right"
    if abs_yaw >= 18.0:
        return "three_quarter_left" if yaw < 0 else "three_quarter_right"
    return "front"


def _landmark_visible(landmarks, index, threshold=VISIBILITY_THRESHOLD):
    if not landmarks or index >= len(landmarks):
        return False
    visibility = getattr(landmarks[index], "visibility", None)
    if visibility is None:
        return True
    return float(visibility) >= float(threshold)


def _get_landmark(landmarks, index):
    if not landmarks or index >= len(landmarks):
        return None
    return landmarks[index]


def _avg_visibility(landmarks, indices):
    values = []
    for index in indices:
        landmark = _get_landmark(landmarks, index)
        if landmark is None:
            continue
        visibility = getattr(landmark, "visibility", None)
        if visibility is None:
            continue
        values.append(float(visibility))
    return sum(values) / len(values) if values else 0.0


def _distance_2d(a, b):
    if a is None or b is None:
        return None
    dx = float(a.x) - float(b.x)
    dy = float(a.y) - float(b.y)
    return math.sqrt((dx * dx) + (dy * dy))


def _angle_2d(a, b, c):
    if a is None or b is None or c is None:
        return None
    abx = float(a.x) - float(b.x)
    aby = float(a.y) - float(b.y)
    cbx = float(c.x) - float(b.x)
    cby = float(c.y) - float(b.y)
    ab_len = math.sqrt((abx * abx) + (aby * aby))
    cb_len = math.sqrt((cbx * cbx) + (cby * cby))
    if ab_len <= 1e-6 or cb_len <= 1e-6:
        return None
    dot = (abx * cbx) + (aby * cby)
    cos_value = max(-1.0, min(1.0, dot / (ab_len * cb_len)))
    return math.degrees(math.acos(cos_value))


def _body_orientation_from_pose(face_direction, pose_landmarks, pose_world_landmarks):
    if not pose_landmarks or len(pose_landmarks) < POSE_LANDMARK_COUNT:
        return "unknown"
    left_shoulder = _get_landmark(pose_landmarks, 11)
    right_shoulder = _get_landmark(pose_landmarks, 12)
    left_hip = _get_landmark(pose_landmarks, 23)
    right_hip = _get_landmark(pose_landmarks, 24)
    if not left_shoulder or not right_shoulder or not left_hip or not right_hip:
        return "unknown"
    shoulder_width = abs(float(left_shoulder.x) - float(right_shoulder.x))
    mid_shoulder_y = (float(left_shoulder.y) + float(right_shoulder.y)) / 2.0
    mid_hip_y = (float(left_hip.y) + float(right_hip.y)) / 2.0
    torso_height = abs(mid_hip_y - mid_shoulder_y)
    width_ratio = shoulder_width / max(torso_height, 0.05)
    front_head_score = _avg_visibility(pose_landmarks, [0, 2, 5, 9, 10])
    ear_score = _avg_visibility(pose_landmarks, [7, 8])
    shoulder_depth_delta = 0.0
    if pose_world_landmarks and len(pose_world_landmarks) >= POSE_LANDMARK_COUNT:
        left_shoulder_world = _get_landmark(pose_world_landmarks, 11)
        right_shoulder_world = _get_landmark(pose_world_landmarks, 12)
        if left_shoulder_world and right_shoulder_world:
            shoulder_depth_delta = abs(float(left_shoulder_world.z) - float(right_shoulder_world.z))

    if face_direction == "front":
        if width_ratio < 0.38:
            return "side"
        return "front"
    if face_direction in {"three_quarter_left", "three_quarter_right"}:
        return "three_quarter"
    if face_direction in {"left", "right"}:
        return "side"

    if front_head_score < 0.18 and ear_score < 0.35:
        if width_ratio >= 0.58 and shoulder_depth_delta < 0.08:
            return "rear"
        return "three_quarter_rear"
    if front_head_score < 0.35:
        return "three_quarter_rear"
    if width_ratio < 0.35:
        return "side"
    return "unknown"


def _pose_class_from_pose(pose_landmarks):
    if not pose_landmarks or len(pose_landmarks) < POSE_LANDMARK_COUNT:
        return "unknown"
    left_shoulder = _get_landmark(pose_landmarks, 11)
    right_shoulder = _get_landmark(pose_landmarks, 12)
    left_hip = _get_landmark(pose_landmarks, 23)
    right_hip = _get_landmark(pose_landmarks, 24)
    if not left_shoulder or not right_shoulder or not left_hip or not right_hip:
        return "unknown"
    mid_shoulder_x = (float(left_shoulder.x) + float(right_shoulder.x)) / 2.0
    mid_shoulder_y = (float(left_shoulder.y) + float(right_shoulder.y)) / 2.0
    mid_hip_x = (float(left_hip.x) + float(right_hip.x)) / 2.0
    mid_hip_y = (float(left_hip.y) + float(right_hip.y)) / 2.0
    torso_angle = math.degrees(math.atan2(abs(mid_hip_x - mid_shoulder_x), abs(mid_hip_y - mid_shoulder_y) + 1e-6))
    if torso_angle >= 55.0:
        return "reclining"

    left_knee = _get_landmark(pose_landmarks, 25)
    right_knee = _get_landmark(pose_landmarks, 26)
    left_ankle = _get_landmark(pose_landmarks, 27)
    right_ankle = _get_landmark(pose_landmarks, 28)
    left_knee_angle = _angle_2d(left_hip, left_knee, left_ankle)
    right_knee_angle = _angle_2d(right_hip, right_knee, right_ankle)
    knee_angles = [angle for angle in [left_knee_angle, right_knee_angle] if angle is not None]
    if not knee_angles:
        return "standing" if torso_angle < 25.0 else "unknown"

    bent_knees = sum(1 for angle in knee_angles if angle < 125.0)
    straight_knees = sum(1 for angle in knee_angles if angle > 150.0)
    mid_knee_y_values = [float(knee.y) for knee in [left_knee, right_knee] if knee is not None]
    mid_ankle_y_values = [float(ankle.y) for ankle in [left_ankle, right_ankle] if ankle is not None]
    if not mid_knee_y_values or not mid_ankle_y_values:
        return "standing" if straight_knees else "unknown"
    mid_knee_y = sum(mid_knee_y_values) / len(mid_knee_y_values)
    mid_ankle_y = sum(mid_ankle_y_values) / len(mid_ankle_y_values)
    hip_knee_gap = abs(mid_hip_y - mid_knee_y)
    knee_ankle_gap = abs(mid_knee_y - mid_ankle_y)

    if hip_knee_gap < (knee_ankle_gap * 0.6) and bent_knees >= 1:
        return "seated"
    if bent_knees >= 1:
        return "kneeling_crouched"
    if straight_knees >= 1 and torso_angle < 25.0:
        return "standing"
    return "unknown"


def _arm_position_from_pose(pose_landmarks):
    if not pose_landmarks or len(pose_landmarks) < POSE_LANDMARK_COUNT:
        return "unknown"
    left_shoulder = _get_landmark(pose_landmarks, 11)
    right_shoulder = _get_landmark(pose_landmarks, 12)
    left_elbow = _get_landmark(pose_landmarks, 13)
    right_elbow = _get_landmark(pose_landmarks, 14)
    left_wrist = _get_landmark(pose_landmarks, 15)
    right_wrist = _get_landmark(pose_landmarks, 16)
    nose = _get_landmark(pose_landmarks, 0)
    if not left_shoulder or not right_shoulder or not left_wrist or not right_wrist:
        return "unknown"
    left_up = float(left_wrist.y) < float(left_shoulder.y) - 0.04
    right_up = float(right_wrist.y) < float(right_shoulder.y) - 0.04
    if left_up and right_up:
        return "both_up"
    if left_up or right_up:
        return "one_up"
    if nose is not None:
        left_face_dist = _distance_2d(left_wrist, nose)
        right_face_dist = _distance_2d(right_wrist, nose)
        if (left_face_dist is not None and left_face_dist < 0.18) or (right_face_dist is not None and right_face_dist < 0.18):
            return "hands_near_face"
    left_out = abs(float(left_wrist.x) - float(left_shoulder.x)) > 0.12 and abs(float(left_wrist.y) - float(left_shoulder.y)) < 0.18
    right_out = abs(float(right_wrist.x) - float(right_shoulder.x)) > 0.12 and abs(float(right_wrist.y) - float(right_shoulder.y)) < 0.18
    if left_out and right_out:
        return "arms_out"
    if left_elbow is not None and right_elbow is not None:
        left_down = float(left_wrist.y) > float(left_elbow.y) and float(left_elbow.y) > float(left_shoulder.y)
        right_down = float(right_wrist.y) > float(right_elbow.y) and float(right_elbow.y) > float(right_shoulder.y)
        if left_down and right_down:
            return "arms_down"
    return "mixed"


def analyze_image_selection_pose(file_path, analyzers):
    mp_image = mp.Image.create_from_file(str(file_path))
    face_landmarker = analyzers["face_landmarker"]
    pose_landmarker = analyzers["pose_landmarker"]
    face_result = face_landmarker.detect(mp_image)
    pose_result = pose_landmarker.detect(mp_image)

    metadata = {
        "version": SELECTION_POSE_VERSION,
        "face_direction": "unknown",
        "face_yaw_deg": None,
        "face_pitch_deg": None,
        "face_roll_deg": None,
        "expression_primary": "unknown",
        "expressions": [],
        "expression_scores": {},
        "body_orientation": "unknown",
        "pose_class": "unknown",
        "arm_position": "unknown",
        "face_detected": False,
        "pose_detected": False,
    }

    if face_result and face_result.face_landmarks:
        metadata["face_detected"] = True
        matrix = face_result.facial_transformation_matrixes[0] if face_result.facial_transformation_matrixes else None
        yaw, pitch, roll = _extract_face_angles(matrix)
        metadata["face_yaw_deg"] = yaw
        metadata["face_pitch_deg"] = pitch
        metadata["face_roll_deg"] = roll
        metadata["face_direction"] = _bucket_face_direction(yaw, pitch)
        blendshape_scores = _category_scores(face_result.face_blendshapes[0] if face_result.face_blendshapes else [])
        expression_scores = _normalize_expression_scores(blendshape_scores)
        primary_expression, expressions = _select_expressions(expression_scores)
        metadata["expression_primary"] = primary_expression
        metadata["expressions"] = expressions
        metadata["expression_scores"] = expression_scores

    pose_landmarks = pose_result.pose_landmarks[0] if pose_result and pose_result.pose_landmarks else None
    pose_world_landmarks = pose_result.pose_world_landmarks[0] if pose_result and pose_result.pose_world_landmarks else None
    if pose_landmarks:
        metadata["pose_detected"] = True
        metadata["body_orientation"] = _body_orientation_from_pose(metadata["face_direction"], pose_landmarks, pose_world_landmarks)
        metadata["pose_class"] = _pose_class_from_pose(pose_landmarks)
        metadata["arm_position"] = _arm_position_from_pose(pose_landmarks)

    return metadata
