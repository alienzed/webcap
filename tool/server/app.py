import ctypes
import os
import json
from flask import Response, stream_with_context
import traceback
import re
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
import shutil

from . import config as app_config
from .caption_ops import _resolve_folder, list_media_files, load_caption_text, save_caption_text, serve_media_file
from .originals import copy_media_to_originals, media_mutation_status_by_hash, is_transient_media_name
from .file_ops import duplicate_folder_response, duplicate_media_response, open_in_explorer_response, open_path_in_explorer_response, open_in_vscode_response, rename_response
from .media import color_suggestions_response, media_blur_background_response, media_convert_fps_response, media_convert_webp_png_response, media_crop_response, media_flip_horizontal_response, media_image_transform_response, media_metadata_response, media_prune_response, media_remove_background_response, media_reset_response, media_restore_response
from .video_clip_ops import clip_video_response, get_clip_job_status
from .video_frame_ops import extract_video_frame_response, inspect_video_frame_response
from .run_ops import train_run_response
from .training_profiles import profiles as training_profiles
from .training_runner import TrainingStateError, log_response as training_runner_log_response, log_path_for_job as training_runner_log_path_for_job, output_path_for_job as training_runner_output_path_for_job, action_path_for_job as training_runner_action_path_for_job, candidate_run_folder_path as training_runner_candidate_run_folder_path, candidate_epoch_folder_path as training_runner_candidate_epoch_folder_path, candidate_test_folder_path as training_runner_candidate_test_folder_path, copy_candidate_epoch_to_test_response as training_runner_copy_candidate_epoch_to_test_response, remove_candidate_epoch_from_test_response as training_runner_remove_candidate_epoch_from_test_response, start_response as training_runner_start_response, status_response as training_runner_status_response, gpu_status_response as training_runner_gpu_status_response, stop_response as training_runner_stop_response, finish_schedule_response as training_runner_finish_schedule_response, validate_response as training_runner_validate_response, reorder_response as training_runner_reorder_response, resume_queue_response as training_runner_resume_queue_response, history_metrics_response as training_runner_history_metrics_response, clear_history_response as training_runner_clear_history_response, candidate_analysis_response as training_runner_candidate_analysis_response, recover_state_response as training_runner_recover_state_response, start_observer as start_training_runner_observer
from .training_history import history_payload as training_history_payload, all_history_payload as training_all_history_payload, clear_history as clear_training_history, discovered_run_output_path, history_job_output_path
from .smart_set import create_set_from_results_response, smart_set_materialize_response, superset_search_response
from .prune_candidates import prune_candidates_response
from .duplicate_candidates import duplicate_candidates_response
from .training_setup import ensure_training_setup
from .epoch_test_bench import (
    activity_snapshot as test_generations_activity_snapshot,
    handle_request as handle_epoch_test_bench_request,
    reconcile_startup as reconcile_test_generations_startup,
    supported_models as test_generations_supported_models,
)
from .training_review import discover_saved_initializers, prepare_training_review, update_training_review
from .h3_probe import h3_probe_log, h3_probe_status, prepare_h3_probe, start_h3_probe, stop_h3_probe
from .permissions import normalize_path_permissions, run_with_directory_repair
from .folder_state_store import FolderStateReadError, FolderStateUnsafeWriteError, read_folder_state, reject_wholesale_state_map_clear, set_media_rating, write_folder_state_atomic
from .storyboard_store import add_scene as storyboard_add_scene, add_take_upload as storyboard_add_take_upload, apply_concept_expansion as storyboard_apply_concept_expansion, apply_developed_plan as storyboard_apply_developed_plan, clear_scene_reference as storyboard_clear_scene_reference, create_story as storyboard_create_story, delete_scene as storyboard_delete_scene, delete_story as storyboard_delete_story, delete_take as storyboard_delete_take, duplicate_scene as storyboard_duplicate_scene, list_stories as storyboard_list_stories, load_story as storyboard_load_story, label_take as storyboard_label_take, rate_take as storyboard_rate_take, remove_take as storyboard_remove_take, reorder_scenes as storyboard_reorder_scenes, restore_previous_concept as storyboard_restore_previous_concept, restore_scene as storyboard_restore_scene, restore_take as storyboard_restore_take, select_take as storyboard_select_take, set_scene_reference_from_take as storyboard_set_scene_reference_from_take, set_scene_reference_upload as storyboard_set_scene_reference_upload, update_scene as storyboard_update_scene, update_story as storyboard_update_story
from .storyboard_generation import generation_action as storyboard_generation_action, generation_capabilities as storyboard_generation_capabilities, generation_queue as storyboard_generation_queue, generation_status as storyboard_generation_status, reconcile_startup as reconcile_storyboard_generation_startup, start_generation as storyboard_start_generation
from .storyboard_assembly import current_export as storyboard_current_export, export_selected_sequence as storyboard_export_selected_sequence
from .storyboard_llm_contract import build_request as storyboard_build_llm_request
from .storyboard_llm_runtime import run_contract as storyboard_run_llm_contract, status as storyboard_director_status
from .generate_generation import capabilities as generate_capabilities, prepare_request as prepare_generate_request
from .generate_store import cleanup_references as generate_cleanup_references, list_results as generate_list_results, resolve_result_media as generate_resolve_result_media, save_reference as generate_save_reference
from .generation_director_contract import build_request as generate_build_director_request
from .inference_runner import action as inference_action, enqueue_generate, job_status as inference_job_status, reconcile_startup as reconcile_inference_startup, snapshot as inference_snapshot, start_observer as start_inference_observer, stop_storyboard_jobs

os.umask(0o022)  # Ensure files/dirs are created with safe permissions


class OriginalsBackupError(RuntimeError):
    pass

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / "tool"
JS_DIR = TOOL_DIR / "js"
CSS_DIR = TOOL_DIR / "css"
TEMPLATES_DIR = TOOL_DIR / "templates"

app = Flask(__name__, static_folder=None)


@app.errorhandler(TrainingStateError)
def training_state_error(error):
    app.logger.error("Training queue state error: %s", error)
    return jsonify({"ok": False, "error": str(error)}), 500


# Reject any incoming HTTP requests that do not originate from the loopback interface.
@app.before_request
def enforce_local_access():
    remote_addr = request.remote_addr or ""
    if remote_addr not in ("127.0.0.1", "::1"):
        return jsonify({"error": "Local access only"}), 403

# Alias kept for readability in route handlers.
safe_join_fs_root = app_config.safe_join_fs_root


def _request_bool_arg(name):
    value = request.args.get(name)
    if value is None:
        return False
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

@app.route("/fs/folder_state/rating", methods=["POST"])
def folder_state_rating():
    data = request.get_json(silent=True) or {}
    rel_path = str(data.get("folder") or "").strip()
    media_key = str(data.get("mediaKey") or "").strip()
    try:
        folder_path = _resolve_folder(rel_path)
        rating = set_media_rating(folder_path / ".webcap_state.json", media_key, data.get("rating"))
        return jsonify({"ok": True, "mediaKey": media_key, "rating": rating})
    except Exception as e:
        app.logger.exception("MEDIA RATING SAVE FAILED for %r/%r: %s", rel_path, media_key, e)
        return jsonify({"error": str(e)}), 400


@app.route("/fs/folder_state/save", methods=["POST"])
def folder_state_save():
    data = request.get_json(silent=True) or {}

    rel_path = data.get("folder", "").strip()
    try:
        # print("[folder_state_save] Incoming data:", data)
        # Use the same folder resolution as captions
        folder_path = _resolve_folder(rel_path)
        state_path = folder_path / ".webcap_state.json"
        # Existing state must be readable before it can be replaced. A permission,
        # encoding, or JSON failure is never equivalent to an empty state.
        existing_state = read_folder_state(state_path)
        # print(f"[folder_state_save] Writing to: {state_path}")
        # Minimal patch: always include 'stats' and 'primer' fields
        state = dict(data.get("state", {}))
        # print("[folder_state_save] State before patch:", state)
        if "stats" not in state:
            state["stats"] = {"requiredPhrase": "", "phrases": "", "tokenRules": ""}
        if "primer" not in state:
            state["primer"] = {"template": "", "defaults": "", "mappings": ""}
        reject_wholesale_state_map_clear(existing_state, state)
        # print("[folder_state_save] State to be written:", state)
        write_folder_state_atomic(state_path, state)
        # print("[folder_state_save] State written to file.")
        # Optionally, read back and print for verification
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                written = json.load(f)
            # print("[folder_state_save] State read back from file:", written)
        except Exception as e:
            app_config.debug_print("[folder_state_save] Could not read back file:", e)
        return jsonify({"ok": True})
    except FolderStateUnsafeWriteError as e:
        app.logger.error("FOLDER STATE SAVE REFUSED for %r: %s", rel_path, e)
        return jsonify({"error": str(e)}), 409
    except Exception as e:
        app.logger.exception("FOLDER STATE SAVE BLOCKED for %r: %s", rel_path, e)
        return jsonify({"error": str(e)}), 400

# Read file contents (for captions, config, etc.)
@app.route("/fs/read", methods=["GET"])
def fs_read():
    rel_path = request.args.get("path", "").strip()
    try:
        abs_path = safe_join_fs_root(rel_path)
        def read():
            if not abs_path.exists() or not abs_path.is_file():
                return ("", 404)
            with open(abs_path, "r", encoding="utf-8") as f:
                return f.read()
        return run_with_directory_repair(abs_path.parent, read)
    except Exception as e:
        if app_config.FS_DEBUG:
            # print("[fs_read] ERROR:", e)
            app_config.debug_traceback()
        return ("", 400)

@app.route("/fs/root", methods=["GET"])
def fs_root():
    return jsonify({"root": str(app_config.FS_ROOT)})


def _system_ram_status():
    if os.name == "nt":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_uint32),
                ("dwMemoryLoad", ctypes.c_uint32),
                ("ullTotalPhys", ctypes.c_uint64),
                ("ullAvailPhys", ctypes.c_uint64),
                ("ullTotalPageFile", ctypes.c_uint64),
                ("ullAvailPageFile", ctypes.c_uint64),
                ("ullTotalVirtual", ctypes.c_uint64),
                ("ullAvailVirtual", ctypes.c_uint64),
                ("ullAvailExtendedVirtual", ctypes.c_uint64),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        get_memory_status = kernel32.GlobalMemoryStatusEx
        get_memory_status.argtypes = [ctypes.POINTER(MEMORYSTATUSEX)]
        get_memory_status.restype = ctypes.c_int
        if not get_memory_status(ctypes.byref(status)):
            raise OSError(ctypes.get_last_error(), "GlobalMemoryStatusEx failed.")
        total = int(status.ullTotalPhys)
        available = int(status.ullAvailPhys)
    else:
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        total = page_size * int(os.sysconf("SC_PHYS_PAGES"))
        available = page_size * int(os.sysconf("SC_AVPHYS_PAGES"))

    if total <= 0 or available < 0 or available > total:
        raise OSError("System returned invalid physical RAM values.")
    return {
        "available": True,
        "total": total,
        "used": total - available,
        "free": available,
    }


@app.route("/fs/system_status", methods=["GET"])
def fs_system_status():
    gpu_payload, _gpu_status = training_runner_gpu_status_response()
    try:
        ram = _system_ram_status()
    except (OSError, ValueError, AttributeError) as exc:
        ram = {"available": False, "error": str(exc)}
    try:
        usage = shutil.disk_usage(app_config.FS_ROOT)
        disk = {
            "available": True,
            "path": str(app_config.FS_ROOT),
            "total": int(usage.total),
            "used": int(usage.used),
            "free": int(usage.free),
        }
    except OSError as exc:
        disk = {
            "available": False,
            "path": str(app_config.FS_ROOT),
            "error": str(exc),
        }
    return jsonify({
        "ok": True,
        "gpu": gpu_payload.get("gpu"),
        "ram": ram,
        "disk": disk,
    })


@app.route("/fs/path_exists", methods=["GET"])
def fs_path_exists():
    rel_path = request.args.get("path", "")
    try:
        abs_path = safe_join_fs_root(rel_path)
        return jsonify(
            {
                "ok": True,
                "exists": bool(abs_path.exists()),
                "is_dir": bool(abs_path.exists() and abs_path.is_dir()),
                "is_file": bool(abs_path.exists() and abs_path.is_file()),
            }
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

@app.route("/")
def index():
    tool_html_path = TOOL_DIR / "tool.html"
    video_clip_modal_path = TEMPLATES_DIR / "video_clip_modal.html"
    html = tool_html_path.read_text(encoding="utf-8")
    video_clip_modal = video_clip_modal_path.read_text(encoding="utf-8")
    return Response(html.replace("<!-- VIDEO_CLIP_MODAL -->", video_clip_modal), mimetype="text/html")

@app.route("/favicon.ico")
def favicon():
    return send_from_directory(TOOL_DIR, "favicon.ico")

@app.route("/static/<path:filename>")
def static_files(filename):
    if filename.startswith("js/"):
        return send_from_directory(JS_DIR, filename[3:])
    if filename.startswith("css/"):
        return send_from_directory(CSS_DIR, filename[4:])
    if filename.startswith("templates/"):
        return send_from_directory(TEMPLATES_DIR, filename[10:])
    return send_from_directory(TOOL_DIR, filename)


@app.route("/app/config", methods=["GET"])
def app_config_get():
    try:
        # Return the on-disk config so the settings modal always reflects the
        # latest saved values, even before runtime reboot/reload.
        return jsonify(app_config.load_config_from_disk())
    except Exception:
        # Fallback to runtime snapshot if disk read fails for any reason.
        return jsonify(app_config.get_config_snapshot())


@app.route("/app/config", methods=["POST"])
def app_config_save():
    data = request.get_json(silent=True)
    try:
        saved = app_config.save_config_to_disk(data)
        return jsonify({"ok": True, "config": saved})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/reset_app", methods=["POST"])
def app_reset_app():
    try:
        current = app_config.load_config_from_disk()
        current["requirements"] = app_config.load_default_requirements_block()
        saved = app_config.save_config_to_disk(current)
        loaded = app_config.reload_runtime_config()
        return jsonify({
            "ok": True,
            "message": "App requirements reset to defaults.",
            "config": loaded or saved,
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/reboot", methods=["POST"])
def app_reboot():
    try:
        loaded = app_config.reload_runtime_config()
        return jsonify({
            "ok": True,
            "message": "Runtime configuration reloaded.",
            "config": loaded,
        })
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


@app.route("/app/help_readme", methods=["GET"])
def app_help_readme():
    readme_path = ROOT / "README.md"
    if not readme_path.exists() or not readme_path.is_file():
        return Response("README.md not found.\n", status=404, mimetype="text/plain")
    text = readme_path.read_text(encoding="utf-8")
    return Response(text, mimetype="text/plain")

@app.route("/caption/load", methods=["GET"])
def caption_load_route():
    folder = request.args.get("folder", "")
    media = request.args.get("media", "")
    try:
        return jsonify(load_caption_text(folder, media))
    except Exception as exc:
        app.logger.exception("CAPTION LOAD FAILED for folder=%r media=%r: %s", folder, media, exc)
        return jsonify({"error": str(exc)}), 400

@app.route("/caption/save", methods=["POST"])
def caption_save_route():
    data = request.get_json(silent=True) or {}
    # print("[BACKEND][SAVE] Incoming payload to /caption/save:", json.dumps(data, ensure_ascii=False))
    try:
        return jsonify(save_caption_text(
            data.get("folder", ""),
            data.get("media", ""),
            data.get("text", "")
        ))
    except Exception as exc:
        # print("[BACKEND][SAVE] ERROR in /caption/save:", exc)
        return jsonify({"error": str(exc)}), 400

@app.route("/caption/media", methods=["GET"])
def caption_media_route():
    folder = request.args.get("folder", "")
    media = request.args.get("media", "")
    try:
        return serve_media_file(folder, media)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

# Additional endpoints for renaming and restoring files
@app.route("/fs/rename", methods=["POST"])
def fs_rename():
    data = request.get_json(silent=True) or {}
    return rename_response(data)

@app.route("/media/restore", methods=["POST"])
def caption_restore():
    data = request.get_json(silent=True) or {}
    return media_restore_response(data)
    
# Reset media file to original from 'originals' folder
@app.route("/media/reset", methods=["POST"])
def caption_reset():
    data = request.get_json(silent=True) or {}
    return media_reset_response(data)

@app.route("/media/crop", methods=["POST"])
def media_crop():
    data = request.get_json(silent=True) or {}
    return media_crop_response(data)

@app.route("/media/flip_horizontal", methods=["POST"])
def media_flip_horizontal():
    data = request.get_json(silent=True) or {}
    return media_flip_horizontal_response(data)


@app.route("/media/convert_fps", methods=["POST"])
def media_convert_fps():
    data = request.get_json(silent=True) or {}
    return media_convert_fps_response(data)


@app.route("/media/image_transform", methods=["POST"])
def media_image_transform():
    data = request.get_json(silent=True) or {}
    return media_image_transform_response(data)


@app.route("/media/convert_webp_png", methods=["POST"])
def media_convert_webp_png():
    data = request.get_json(silent=True) or {}
    return media_convert_webp_png_response(data)

@app.route("/media/remove_background", methods=["POST"])
def media_remove_background():
    data = request.get_json(silent=True) or {}
    return media_remove_background_response(data)

@app.route("/media/blur_background", methods=["POST"])
def media_blur_background():
    data = request.get_json(silent=True) or {}
    return media_blur_background_response(data)

@app.route("/media/prune", methods=["POST"])
def caption_prune():
    data = request.get_json(silent=True) or {}
    return media_prune_response(data)


@app.route("/media/video_clip", methods=["POST"])
def media_video_clip():
    data = request.get_json(silent=True) or {}
    return clip_video_response(data)


@app.route("/media/video_clip_frame", methods=["POST"])
def media_video_clip_frame():
    data = request.get_json(silent=True) or {}
    return inspect_video_frame_response(data)


@app.route("/media/video_clip_extract_frame", methods=["POST"])
def media_video_clip_extract_frame():
    data = request.get_json(silent=True) or {}
    return extract_video_frame_response(data)


@app.route("/media/video_clip_status", methods=["GET"])
def media_video_clip_status():
    job_id = request.args.get("jobId", "").strip()
    try:
        job = get_clip_job_status(job_id)
        if not job:
            return jsonify({"error": "Clip job not found"}), 404
        return jsonify({"ok": True, "job": job})
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[media_video_clip_status] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400

@app.route("/fs/storyboard", methods=["GET", "POST"])
def storyboard_route():
    try:
        if request.method == "GET":
            story_id = str(request.args.get("story") or "").strip()
            if story_id:
                return jsonify({"ok": True, "story": storyboard_load_story(story_id)})
            return jsonify({"ok": True, "stories": storyboard_list_stories()})

        data = request.get_json(silent=True) or {}
        operation = str(data.get("operation") or "").strip()
        story_id = str(data.get("storyId") or "").strip()
        if operation == "create_story":
            return jsonify({"ok": True, "story": storyboard_create_story(data.get("story") or {})})
        if operation == "delete_story":
            storyboard_load_story(story_id)
            stop_storyboard_jobs(story_id)
            deleted_story_id = storyboard_delete_story(story_id)
            return jsonify({"ok": True, "storyId": deleted_story_id})
        if operation == "update_story":
            return jsonify({"ok": True, "story": storyboard_update_story(story_id, data.get("story") or {})})
        if operation == "add_scene":
            story, scene = storyboard_add_scene(story_id, data.get("scene") or {})
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "update_scene":
            story, scene = storyboard_update_scene(story_id, str(data.get("sceneId") or "").strip(), data.get("scene") or {})
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "duplicate_scene":
            story, scene = storyboard_duplicate_scene(story_id, str(data.get("sceneId") or "").strip())
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "reorder_scenes":
            story = storyboard_reorder_scenes(story_id, data.get("sceneOrder"))
            return jsonify({"ok": True, "story": story})
        if operation == "delete_scene":
            story = storyboard_delete_scene(story_id, str(data.get("sceneId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "restore_scene":
            story = storyboard_restore_scene(story_id, str(data.get("sceneId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "restore_previous_concept":
            story = storyboard_restore_previous_concept(story_id)
            return jsonify({"ok": True, "story": story})
        if operation == "label_take":
            story, take = storyboard_label_take(
                story_id,
                str(data.get("sceneId") or "").strip(),
                str(data.get("takeId") or "").strip(),
                data.get("label"),
            )
            return jsonify({"ok": True, "story": story, "take": take})
        if operation == "rate_take":
            story, take = storyboard_rate_take(story_id, str(data.get("sceneId") or "").strip(), str(data.get("takeId") or "").strip(), data.get("rating"))
            return jsonify({"ok": True, "story": story, "take": take})
        if operation == "select_take":
            story = storyboard_select_take(story_id, str(data.get("sceneId") or "").strip(), str(data.get("takeId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "remove_take":
            story = storyboard_remove_take(story_id, str(data.get("sceneId") or "").strip(), str(data.get("takeId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "delete_take":
            story = storyboard_delete_take(story_id, str(data.get("sceneId") or "").strip(), str(data.get("takeId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "restore_take":
            story = storyboard_restore_take(story_id, str(data.get("sceneId") or "").strip(), str(data.get("takeId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "set_scene_reference_from_take":
            story, reference = storyboard_set_scene_reference_from_take(
                story_id,
                str(data.get("sceneId") or "").strip(),
                str(data.get("role") or "").strip(),
                str(data.get("sourceSceneId") or "").strip(),
                str(data.get("sourceTakeId") or "").strip(),
                str(data.get("frame") or "").strip(),
            )
            return jsonify({"ok": True, "story": story, "reference": reference})
        if operation == "clear_scene_reference":
            story = storyboard_clear_scene_reference(story_id, str(data.get("sceneId") or "").strip(), str(data.get("role") or "").strip())
            return jsonify({"ok": True, "story": story})
        raise ValueError("Unknown Storyboard operation.")
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD REQUEST FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/assembly", methods=["GET", "POST"])
def storyboard_assembly_route():
    try:
        if request.method == "GET":
            story_id = str(request.args.get("story") or "").strip()
            return jsonify({"ok": True, "export": storyboard_current_export(story_id)})
        data = request.get_json(silent=True) or {}
        return jsonify({
            "ok": True,
            "export": storyboard_export_selected_sequence(str(data.get("storyId") or "").strip()),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD ASSEMBLY FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/generation/capabilities", methods=["GET"])
def storyboard_generation_capabilities_route():
    try:
        return jsonify({"ok": True, **storyboard_generation_capabilities()})
    except Exception as exc:
        app.logger.exception("STORYBOARD GENERATION CAPABILITIES FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/generation", methods=["GET", "POST"])
def storyboard_generation_route():
    try:
        if request.method == "GET":
            job_id = str(request.args.get("job") or "").strip()
            if job_id:
                return jsonify({"ok": True, "job": storyboard_generation_status(job_id)})
            return jsonify({
                "ok": True,
                "queue": storyboard_generation_queue(str(request.args.get("story") or "").strip()),
            })

        data = request.get_json(silent=True) or {}
        operation = str(data.get("operation") or "").strip()
        if operation:
            return jsonify({
                "ok": True,
                **storyboard_generation_action(
                    operation,
                    job_id=str(data.get("jobId") or "").strip(),
                    direction=str(data.get("direction") or "").strip(),
                ),
            })
        return jsonify({
            "ok": True,
            "job": storyboard_start_generation(
                str(data.get("storyId") or "").strip(),
                str(data.get("sceneId") or "").strip(),
            ),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD GENERATION FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/director", methods=["GET", "POST"])
def storyboard_director_route():
    try:
        if request.method == "GET":
            return jsonify({"ok": True, **storyboard_director_status()})

        data = request.get_json(silent=True) or {}
        story_id = str(data.get("storyId") or "").strip()
        scene_id = str(data.get("sceneId") or "").strip()
        operation = str(data.get("operation") or "").strip()
        model_id = str(data.get("model") or "").strip()
        instruction = str(data.get("instruction") or "").strip()

        story = storyboard_load_story(story_id)
        replace_existing = bool(data.get("replaceExisting"))
        if operation == "develop_story" and story.get("sceneOrder") and not replace_existing:
            raise ValueError("Story already has Scenes. Confirm replacement before developing it again.")

        contract = storyboard_build_llm_request(
            story,
            scene_id,
            operation,
            instruction=instruction,
        )
        result = storyboard_run_llm_contract(model_id, contract)
        if operation == "expand_concept":
            expanded_story = storyboard_apply_concept_expansion(story_id, result.get("text"))
            return jsonify({
                "ok": True,
                "story": expanded_story,
                "result": expanded_story["concept"],
                "model": result["model"],
                "usage": result.get("usage"),
                "timings": result.get("timings"),
            })
        if operation == "develop_story":
            developed_story = storyboard_apply_developed_plan(
                story_id,
                result.get("data"),
                model_id=result["model"],
            )
            return jsonify({
                "ok": True,
                "story": developed_story,
                "sceneCount": len(developed_story.get("sceneOrder") or []),
                "model": result["model"],
                "usage": result.get("usage"),
                "timings": result.get("timings"),
            })

        return jsonify({
            "ok": True,
            "result": result["text"],
            "model": result["model"],
            "usage": result.get("usage"),
            "timings": result.get("timings"),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD DIRECTOR FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/reference_upload", methods=["POST"])
def storyboard_reference_upload_route():
    try:
        story_id = str(request.form.get("storyId") or "").strip()
        scene_id = str(request.form.get("sceneId") or "").strip()
        role = str(request.form.get("role") or "").strip()
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            raise ValueError("Missing reference image file.")
        story, reference = storyboard_set_scene_reference_upload(
            story_id,
            scene_id,
            role,
            upload.filename,
            upload.stream,
        )
        return jsonify({"ok": True, "story": story, "reference": reference})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD REFERENCE UPLOAD FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/take_upload", methods=["POST"])
def storyboard_take_upload_route():
    try:
        story_id = str(request.form.get("storyId") or "").strip()
        scene_id = str(request.form.get("sceneId") or "").strip()
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            raise ValueError("Missing Take media file.")
        story, take = storyboard_add_take_upload(story_id, scene_id, upload.filename, upload.stream)
        return jsonify({"ok": True, "story": story, "take": take})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD TAKE UPLOAD FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/capabilities", methods=["GET"])
def generate_capabilities_route():
    try:
        return jsonify({"ok": True, **generate_capabilities()})
    except Exception as exc:
        app.logger.exception("GENERATE CAPABILITIES FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/results", methods=["GET"])
def generate_results_route():
    try:
        return jsonify({"ok": True, "results": generate_list_results(request.args.get("limit", 100))})
    except Exception as exc:
        app.logger.exception("GENERATE RESULTS FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/media", methods=["GET"])
def generate_media_route():
    try:
        media_path = generate_resolve_result_media(request.args.get("path", ""))
        return send_from_directory(str(media_path.parent), media_path.name)
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/reference", methods=["POST"])
def generate_reference_route():
    try:
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            raise ValueError("Generate reference file is required.")
        return jsonify({"ok": True, "reference": generate_save_reference(upload)})
    except Exception as exc:
        app.logger.exception("GENERATE REFERENCE UPLOAD FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/reference/cleanup", methods=["POST"])
def generate_reference_cleanup_route():
    try:
        data = request.get_json(silent=True) or {}
        paths = data.get("paths") if isinstance(data.get("paths"), list) else []
        return jsonify({"ok": True, "removed": generate_cleanup_references(paths)})
    except Exception as exc:
        app.logger.exception("GENERATE REFERENCE CLEANUP FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate", methods=["POST"])
def generate_route():
    data = request.get_json(silent=True) or {}
    try:
        prepared = prepare_generate_request(data)
        label = str(data.get("label") or "").strip()
        if not label:
            label = str(prepared.get("sourcePrompt") or "Generate").replace("\n", " ")[:80]
        return jsonify({"ok": True, "job": enqueue_generate(prepared, label=label)})
    except Exception as exc:
        try:
            generate_cleanup_references(data.get("references") or {})
        except Exception:
            app.logger.exception("GENERATE REFERENCE CLEANUP FAILED after enqueue error.")
        app.logger.exception("GENERATE ENQUEUE FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/inference", methods=["GET", "POST"])
def inference_route():
    try:
        if request.method == "GET":
            job_id = str(request.args.get("job") or "").strip()
            if job_id:
                return jsonify({"ok": True, "job": inference_job_status(job_id)})
            return jsonify({"ok": True, "queue": inference_snapshot(include_terminal=False)})
        data = request.get_json(silent=True) or {}
        return jsonify({
            "ok": True,
            **inference_action(
                str(data.get("operation") or "").strip(),
                job_id=str(data.get("jobId") or "").strip(),
                direction=str(data.get("direction") or "").strip(),
                position=data.get("position"),
            ),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("INFERENCE QUEUE ACTION FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/director", methods=["GET", "POST"])
def generate_director_route():
    try:
        if request.method == "GET":
            return jsonify({"ok": True, **storyboard_director_status()})

        data = request.get_json(silent=True) or {}
        contract = generate_build_director_request(
            str(data.get("modelId") or "").strip(),
            str(data.get("operation") or "").strip(),
            prompt=data.get("prompt") or "",
            instruction=data.get("instruction") or "",
            settings=data.get("settings"),
        )
        result = storyboard_run_llm_contract(str(data.get("directorModel") or "").strip(), contract)
        return jsonify({
            "ok": True,
            "result": result["text"],
            "model": result["model"],
            "usage": result.get("usage"),
            "timings": result.get("timings"),
        })
    except Exception as exc:
        app.logger.exception("GENERATE DIRECTOR FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_profiles", methods=["GET"])
def training_profiles_route():
    enabled = set((app_config.config.get("training") or {}).get("enabled_profiles") or [])
    return jsonify({"profiles": [item for item in training_profiles() if item["id"] in enabled]})


@app.route("/fs/test_generations/models", methods=["GET"])
def test_generations_models_route():
    try:
        return jsonify({"ok": True, **test_generations_supported_models()})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/test_generations/activity", methods=["GET"])
def test_generations_activity_route():
    rel_path = str(request.args.get("folder") or "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path) if rel_path else None
        return jsonify({"ok": True, **test_generations_activity_snapshot(folder_path)})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/test_generations", methods=["POST"])
def test_generations_route():
    data = request.get_json(silent=True) or {}
    try:
        folder_path = safe_join_fs_root((data.get("folder") or "").strip())
        payload = handle_epoch_test_bench_request(
            folder_path,
            str(data.get("operation") or "").strip(),
            selection_criteria=data.get("criteria"),
        )
        return jsonify({"ok": True, **payload})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_setup", methods=["POST"])
def training_setup_route():
    data = request.get_json(silent=True) or {}
    try:
        folder_path = safe_join_fs_root((data.get("folder") or "").strip())
        payload = ensure_training_setup(
            folder_path,
            data.get("profileId") or "wan22_t2v",
            data.get("mode") or "normal",
            selected_media=data.get("selected_media"),
            selection_criteria=data.get("selection_criteria"),
            total_media_count=data.get("total_media_count"),
            reset_file=data.get("resetFile") or "",
        )
        return jsonify({"ok": True, **payload})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_review", methods=["POST"])
def training_review_route():
    data = request.get_json(silent=True) or {}
    try:
        folder_path = safe_join_fs_root((data.get("folder") or "").strip())