"""On-demand training-reference comparison for saved Test Generations previews.

Keeps reference evidence separate from the existing test_vision scores.
Only validated exact-tag Set references and saved session result media may be used.
"""
import threading
import time
from pathlib import Path

from . import epoch_test_bench as bench
from .caption_vision import build_reference_comparison_messages, vision_resized_image_data_url
from .epoch_reference import verified_reference

_write_lock = threading.RLock()


def _location(folder_path, session):
    directory = bench._session_directory(folder_path, session)
    path = directory / "test_reference.json"
    if path.is_symlink():
        raise ValueError("Refusing symlink reference-evaluation state.")
    return path


def read(folder_path, session):
    path = _location(folder_path, session)
    if not path.exists():
        return {"version": 1, "byMedia": {}}
    import json
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("byMedia"), dict):
        raise ValueError("Unsupported Test reference-evaluation state.")
    return data


def prepare(folder_path, criteria):
    from .epoch_finder import _folder_key
    mode = str(criteria.get("method") or "")
    if mode not in {"rvn", "dino"}:
        raise ValueError("Unknown reference evaluator.")
    session = str(criteria.get("session") or "")
    media = bench.resolve_result_media(folder_path, session, criteria.get("media"))
    group = str(criteria.get("group") or "").strip()
    term = str(criteria.get("option") or "").strip()
    ref_name = str(criteria.get("reference") or "")
    job_id = str(criteria.get("jobId") or "").strip()
    approved = verified_reference(_folder_key(folder_path), group, term, ref_name, job_id)
    reference = folder_path / approved["media"]
    choices = criteria.get("choices")
    if not isinstance(choices, list) or not 1 <= len(choices) <= 30 or any(not isinstance(c, str) or not c.strip() or len(c) > 120 for c in choices):
        raise ValueError("Provide the available wildcard options.")
    if term not in choices:
        raise ValueError("Approved option must belong to the wildcard choices.")
    import tempfile
    from .video_frame_ops import VIDEO_EXTS, extract_boundary_frame_png
    with tempfile.TemporaryDirectory(prefix="webcap-test-reference-") as temporary:
        if media.suffix.lower() in VIDEO_EXTS:
            frame = Path(temporary) / "first.png"
            frame.write_bytes(extract_boundary_frame_png(media, "first"))
            generated = frame
        else:
            generated = media
        if mode == "dino":
            from .epoch_dino import compare_images
            cache = _location(folder_path, session).parent / "reference-embeddings"
            score = compare_images(reference, generated, cache)
            assessment = {"method": mode, "group": group, "option": term, "jobId": job_id,
                          "reference": ref_name, "similarity": score, "at": time.time()}
            save(folder_path, session, media.name, assessment)
            return {"assessment": assessment}
        question = (group + " — reference demonstrates " + term +
                    ". Select the visible option in generated image B: " +
                    "; ".join(str(i + 1) + "=" + c for i, c in enumerate(choices)))
        messages = build_reference_comparison_messages(
            question, vision_resized_image_data_url(reference),
            vision_resized_image_data_url(generated))
    return {"messages": messages, "reference": ref_name, "jobId": job_id, "group": group,
            "option": term, "choices": choices}


def save(folder_path, session, media_name, assessment):
    media = bench.resolve_result_media(folder_path, session, media_name)
    if not isinstance(assessment, dict) or assessment.get("method") not in {"rvn", "dino"}:
        raise ValueError("Invalid reference assessment.")
    from .epoch_finder import _folder_key
    verified_reference(_folder_key(folder_path), assessment.get("group"),
                       assessment.get("option"), assessment.get("reference"), assessment.get("jobId"))
    # Bound persisted result sizes; raw output is evidence, not an unbounded transcript.
    if len(str(assessment)) > 12000:
        raise ValueError("Reference assessment is too large.")
    with _write_lock:
        state = read(folder_path, session)
        records = state["byMedia"].setdefault(media.name, {})
        key = str(assessment["method"]) + "|" + str(assessment["group"]) + "|" + str(assessment["option"])
        records[key] = assessment
        bench._atomic_write_json(_location(folder_path, session), state)
    return assessment
