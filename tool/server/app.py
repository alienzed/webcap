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
from .training_runner import TrainingStateError, log_response as training_runner_log_response, log_path_for_job as training_runner_log_path_for_job, output_path_for_job as training_runner_output_path_for_job, action_path_for_job as training_runner_action_path_for_job, candidate_run_folder_path as training_runner_candidate_run_folder_path, candidate_epoch_folder_path as training_runner_candidate_epoch_folder_path, candidate_test_folder_path as training_runner_candidate_test_folder_path, copy_candidate_epoch_to_test_response as training_runner_copy_candidate_epoch_to_test_response, remove_candidate_epoch_from_test_response as training_runner_remove_candidate_epoch_from_test_response, select_candidate_epoch_response as training_runner_select_candidate_epoch_response, clear_candidate_epoch_selection_response as training_runner_clear_candidate_epoch_selection_response, start_response as training_runner_start_response, status_response as training_runner_status_response, gpu_status_response as training_runner_gpu_status_response, stop_response as training_runner_stop_response, finish_schedule_response as training_runner_finish_schedule_response, validate_response as training_runner_validate_response, reorder_response as training_runner_reorder_response, resume_queue_response as training_runner_resume_queue_response, history_metrics_response as training_runner_history_metrics_response, clear_history_response as training_runner_clear_history_response, candidate_analysis_response as training_runner_candidate_analysis_response, recover_state_response as training_runner_recover_state_response, start_observer as start_training_runner_observer
from .training_history import history_payload as training_history_payload, all_history_payload as training_all_history_payload, clear_history as clear_training_history, discovered_run_output_path, history_job_output_path
from .smart_set import create_set_from_results_response, smart_set_materialize_response, superset_search_response
from .prune_candidates import prune_candidates_response
from .duplicate_candidates import duplicate_candidates_response
from .training_setup import ensure_training_setup
from .epoch_test_bench import (
    activity_snapshot as test_generations_activity_snapshot,
    browse_source as test_generations_browse_source,
    handle_request as handle_epoch_test_bench_request,
    supported_models as test_generations_supported_models,
)
from .training_review import discover_saved_initializers, prepare_training_review, update_training_review
from .h3_probe import h3_probe_log, h3_probe_status, prepare_h3_probe, start_h3_probe, stop_h3_probe
from .permissions import normalize_path_permissions, run_with_directory_repair
from .folder_state_store import FolderStateReadError, FolderStateUnsafeWriteError, read_folder_state, reject_wholesale_state_map_clear, set_media_rating, write_folder_state_atomic
from .storage_manager import cancel_scan as storage_cancel_scan, measure as storage_measure, open_path as storage_open_path, overview as storage_overview, purge as storage_purge, scan_status as storage_scan_status, start_scan as storage_start_scan
from .storyboard_store import add_scene as storyboard_add_scene, add_take_upload as storyboard_add_take_upload, clear_scene_reference as storyboard_clear_scene_reference, create_story as storyboard_create_story, delete_scene as storyboard_delete_scene, delete_story as storyboard_delete_story, delete_take as storyboard_delete_take, duplicate_scene as storyboard_duplicate_scene, duplicate_story as storyboard_duplicate_story, list_stories as storyboard_list_stories, load_story as storyboard_load_story, label_take as storyboard_label_take, rate_take as storyboard_rate_take, remove_take as storyboard_remove_take, reorder_scenes as storyboard_reorder_scenes, resolve_story_media as storyboard_resolve_media, restore_previous_concept as storyboard_restore_previous_concept, restore_previous_prompt as storyboard_restore_previous_prompt, restore_scene as storyboard_restore_scene, restore_scene_repairs as storyboard_restore_scene_repairs, restore_take as storyboard_restore_take, select_take as storyboard_select_take, set_scene_reference_from_take as storyboard_set_scene_reference_from_take, set_scene_reference_upload as storyboard_set_scene_reference_upload, update_scene as storyboard_update_scene, update_story as storyboard_update_story
from .storyboard_generation import generation_action as storyboard_generation_action, generation_capabilities as storyboard_generation_capabilities, generation_queue as storyboard_generation_queue, generation_status as storyboard_generation_status, start_generation as storyboard_start_generation
from .storyboard_assembly import current_export as storyboard_current_export, export_selected_sequence as storyboard_export_selected_sequence
from .storyboard_llm_contract import build_request as storyboard_build_llm_request
from .storyboard_llm_runtime import activity_status as storyboard_director_activity_status, status as storyboard_director_status
from .generate_generation import capabilities as generate_capabilities, prepare_request as prepare_generate_request
from .generate_store import cleanup_references as generate_cleanup_references, delete_prompt as generate_delete_prompt, list_prompts as generate_list_prompts, list_results as generate_list_results, rate_result as generate_rate_result, resolve_result_media as generate_resolve_result_media, save_prompt as generate_save_prompt, save_reference as generate_save_reference
from .generation_director_contract import build_request as generate_build_director_request
from .inference_runner import action as inference_action, enqueue_generate, job_status as inference_job_status, prepare_startup_backlog as prepare_inference_startup_backlog, snapshot as inference_snapshot, stop_storyboard_jobs
from .llm_runner import action as llm_action, enqueue as enqueue_llm, job_status as llm_job_status, reconcile_startup as reconcile_llm_startup, snapshot as llm_snapshot, storyboard_story_busy as llm_storyboard_story_busy, storyboard_target_busy as llm_storyboard_target_busy
from .activity_monitor import activity_snapshot

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


@app.route("/fs/activity", methods=["GET"])
def fs_activity():
    try:
        return jsonify(activity_snapshot(request.args.get("limit", 20)))
    except Exception as exc:
        app.logger.exception("ACTIVITY SNAPSHOT FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storage", methods=["GET"])
def fs_storage():
    try:
        return jsonify(storage_overview(request.args.get("folder", "")))
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/scan/start", methods=["POST"])
def fs_storage_scan_start():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(storage_start_scan(str(data.get("folder") or "").strip()))
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_scan_start] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/scan/status", methods=["GET"])
def fs_storage_scan_status():
    try:
        return jsonify(storage_scan_status())
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_scan_status] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/scan/cancel", methods=["POST"])
def fs_storage_scan_cancel():
    try:
        return jsonify(storage_cancel_scan())
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_scan_cancel] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/measure", methods=["POST"])
def fs_storage_measure():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(storage_measure(
            str(data.get("area") or "").strip(),
            str(data.get("id") or "").strip(),
            str(data.get("folder") or "").strip(),
        ))
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_measure] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/open", methods=["POST"])
def fs_storage_open():
    data = request.get_json(silent=True) or {}
    try:
        path = storage_open_path(
            str(data.get("area") or "").strip(),
            str(data.get("id") or "").strip(),
            str(data.get("folder") or "").strip(),
        )
        return open_path_in_explorer_response(path)
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_open] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/storage/purge", methods=["POST"])
def fs_storage_purge():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(storage_purge(
            str(data.get("area") or "").strip(),
            str(data.get("id") or "").strip(),
            str(data.get("folder") or "").strip(),
        ))
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[storage_purge] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"ok": False, "error": str(e)}), 400


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
        if operation == "duplicate_story":
            return jsonify({"ok": True, "story": storyboard_duplicate_story(story_id)})
        if operation == "delete_story":
            storyboard_load_story(story_id)
            if llm_storyboard_story_busy(story_id):
                raise ValueError("Story has pending Director work. Cancel it or let it finish before deleting the Story.")
            stop_storyboard_jobs(story_id)
            deleted_story_id = storyboard_delete_story(story_id)
            return jsonify({"ok": True, "storyId": deleted_story_id})
        if operation == "update_story":
            story_payload = data.get("story") or {}
            if "concept" in story_payload and llm_storyboard_target_busy(story_id, "concept"):
                raise ValueError("Story concept has pending Director work.")
            return jsonify({"ok": True, "story": storyboard_update_story(story_id, story_payload)})
        if operation == "add_scene":
            if llm_storyboard_target_busy(story_id, "scenes"):
                raise ValueError("Story Scenes have pending Director work.")
            story, scene = storyboard_add_scene(story_id, data.get("scene") or {})
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "update_scene":
            scene_id = str(data.get("sceneId") or "").strip()
            scene_payload = data.get("scene") or {}
            if llm_storyboard_target_busy(story_id, "scenes"):
                raise ValueError("Story Scenes have pending Director work.")
            repair_keys = {"summary", "entryState", "exitState", "prompt", "previousPrompt", "promptDirectorModel", "promptDirectorJobId"}
            if repair_keys.intersection(scene_payload) and llm_storyboard_target_busy(story_id, "repair"):
                raise ValueError("Scene fields targeted by Check & Repair have pending Director work.")
            protected_prompt_keys = {"prompt", "previousPrompt", "promptDirectorModel", "promptDirectorJobId"}
            if protected_prompt_keys.intersection(scene_payload) and llm_storyboard_target_busy(story_id, "scene-prompt", scene_id):
                raise ValueError("Scene prompt has pending Director work.")
            story, scene = storyboard_update_scene(story_id, scene_id, scene_payload)
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "duplicate_scene":
            scene_id = str(data.get("sceneId") or "").strip()
            if llm_storyboard_target_busy(story_id, "scenes") or llm_storyboard_target_busy(story_id, "scene-prompt", scene_id):
                raise ValueError("Scene has pending Director work.")
            story, scene = storyboard_duplicate_scene(story_id, scene_id)
            return jsonify({"ok": True, "story": story, "scene": scene})
        if operation == "reorder_scenes":
            if llm_storyboard_target_busy(story_id, "scenes"):
                raise ValueError("Story Scenes have pending Director work.")
            story = storyboard_reorder_scenes(story_id, data.get("sceneOrder"))
            return jsonify({"ok": True, "story": story})
        if operation == "delete_scene":
            scene_id = str(data.get("sceneId") or "").strip()
            if llm_storyboard_target_busy(story_id, "scenes") or llm_storyboard_target_busy(story_id, "scene-prompt", scene_id):
                raise ValueError("Scene has pending Director work.")
            story = storyboard_delete_scene(story_id, scene_id)
            return jsonify({"ok": True, "story": story})
        if operation == "restore_scene":
            if llm_storyboard_target_busy(story_id, "scenes"):
                raise ValueError("Story Scenes have pending Director work.")
            story = storyboard_restore_scene(story_id, str(data.get("sceneId") or "").strip())
            return jsonify({"ok": True, "story": story})
        if operation == "restore_previous_concept":
            if llm_storyboard_target_busy(story_id, "concept"):
                raise ValueError("Story concept has pending Director work.")
            story = storyboard_restore_previous_concept(story_id)
            return jsonify({"ok": True, "story": story})
        if operation == "restore_last_scene_repair":
            if llm_storyboard_story_busy(story_id):
                raise ValueError("Story has pending Director work.")
            story = storyboard_restore_scene_repairs(story_id)
            return jsonify({"ok": True, "story": story})
        if operation == "restore_previous_prompt":
            scene_id = str(data.get("sceneId") or "").strip()
            if llm_storyboard_target_busy(story_id, "scenes") or llm_storyboard_target_busy(story_id, "scene-prompt", scene_id):
                raise ValueError("Scene prompt has pending Director work.")
            story, scene = storyboard_restore_previous_prompt(
                story_id,
                scene_id,
            )
            return jsonify({"ok": True, "story": story, "scene": scene})
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


@app.route("/fs/storyboard/media", methods=["GET"])
def storyboard_media_route():
    try:
        media_path = storyboard_resolve_media(
            str(request.args.get("story") or "").strip(),
            str(request.args.get("path") or "").strip(),
        )
        return send_from_directory(str(media_path.parent), media_path.name, conditional=True)
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD MEDIA FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/storyboard/assembly", methods=["GET", "POST"])
def storyboard_assembly_route():
    try:
        if request.method == "GET":
            story_id = str(request.args.get("story") or "").strip()
            return jsonify({"ok": True, "export": storyboard_current_export(story_id)})
        data = request.get_json(silent=True) or {}
        export = storyboard_export_selected_sequence(
            str(data.get("storyId") or "").strip(),
            encode=bool(data.get("encode")),
        )
        if isinstance(export, dict) and export.get("requiresEncoding"):
            return jsonify({
                "ok": True,
                "requiresEncoding": True,
                "warnings": export.get("warnings") or [],
            })
        return jsonify({"ok": True, "export": export})
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
                consume = str(request.args.get("consume") or "").strip().lower() in {"1", "true", "yes"}
                return jsonify({"ok": True, "job": storyboard_generation_status(job_id, consume=consume)})
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
        story_id = str(data.get("storyId") or "").strip()
        if llm_storyboard_target_busy(story_id, "scenes"):
            raise ValueError("Story Scenes have pending Director work.")
        return jsonify({
            "ok": True,
            "job": storyboard_start_generation(
                story_id,
                str(data.get("sceneId") or "").strip(),
            ),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("STORYBOARD GENERATION FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/director/activity", methods=["GET"])
def director_activity_route():
    activity = storyboard_director_activity_status()
    queue = llm_snapshot(include_terminal=False)
    if not activity.get("active"):
        active_id = str(queue.get("activeJobId") or "")
        queued = [job for job in queue.get("jobs", []) if str(job.get("status") or "") == "queued"]
        if active_id:
            active = next((job for job in queue.get("jobs", []) if job.get("jobId") == active_id), None)
            if active:
                activity = {
                    **activity,
                    "active": True,
                    "phase": "preparing",
                    "model": active.get("modelId") or "",
                    "operation": active.get("operation") or "",
                    "startedAt": active.get("startedAt"),
                }
        elif queued:
            activity = {
                **activity,
                "active": True,
                "phase": "queued",
                "model": queued[0].get("modelId") or "",
                "operation": queued[0].get("operation") or "",
                "startedAt": queued[0].get("createdAt"),
                "queuePosition": queued[0].get("queuePosition") or 0,
            }
    return jsonify({"ok": True, **activity, "queue": queue})


@app.route("/fs/director/queue", methods=["GET"])
def director_queue_route():
    try:
        return jsonify({
            "ok": True,
            "queue": llm_snapshot(include_terminal=_request_bool_arg("includeTerminal")),
        })
    except Exception as exc:
        app.logger.exception("DIRECTOR QUEUE SNAPSHOT FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/director/job", methods=["GET", "POST"])
def director_job_route():
    try:
        if request.method == "GET":
            return jsonify({
                "ok": True,
                "job": llm_job_status(
                    str(request.args.get("job") or "").strip(),
                    consume=str(request.args.get("consume") or "").strip().lower() in {"1", "true", "yes"},
                ),
            })
        data = request.get_json(silent=True) or {}
        return jsonify({
            "ok": True,
            **llm_action(
                str(data.get("operation") or "").strip(),
                job_id=str(data.get("jobId") or "").strip(),
                direction=str(data.get("direction") or "").strip(),
                position=data.get("position"),
            ),
        })
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("DIRECTOR QUEUE ACTION FAILED: %s", exc)
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
        if operation == "develop_story":
            if story.get("sceneOrder") and not replace_existing:
                raise ValueError("Story already has Scenes. Confirm replacement before developing it again.")
            active_generation = storyboard_generation_queue(story_id)
            if active_generation.get("jobs"):
                raise ValueError("Story has pending Take generation. Stop or finish it before developing Scenes.")

        contract = storyboard_build_llm_request(
            story,
            scene_id,
            operation,
            instruction=instruction,
        )
        repair_base = None
        if operation == "repair_scenes":
            scene_order = list(story.get("sceneOrder") or [])
            scenes = story.get("scenes") if isinstance(story.get("scenes"), dict) else {}
            repair_base = {
                "storyContext": {
                    "title": str(story.get("title") or ""),
                    "concept": str(story.get("concept") or ""),
                    "style": str(story.get("style") or ""),
                    "invariants": story.get("invariants") if isinstance(story.get("invariants"), list) else [],
                },
                "sceneOrder": scene_order,
                "scenes": {
                    scene_id: {
                        "title": str((scenes.get(scene_id) or {}).get("title") or ""),
                        "summary": str((scenes.get(scene_id) or {}).get("summary") or ""),
                        "entryState": str((scenes.get(scene_id) or {}).get("entryState") or ""),
                        "exitState": str((scenes.get(scene_id) or {}).get("exitState") or ""),
                        "prompt": str((scenes.get(scene_id) or {}).get("prompt") or ""),
                        "durationSeconds": (scenes.get(scene_id) or {}).get("durationSeconds"),
                        "referenceRoles": [
                            str(reference.get("role") or "").strip()
                            for reference in (scenes.get(scene_id) or {}).get("references") or []
                            if isinstance(reference, dict)
                        ],
                        "invariantRefs": (scenes.get(scene_id) or {}).get("invariantRefs")
                            if isinstance((scenes.get(scene_id) or {}).get("invariantRefs"), list)
                            else [],
                    }
                    for scene_id in scene_order
                    if isinstance(scenes.get(scene_id), dict)
                },
            }
        if bool(data.get("previewOnly")):
            return jsonify({
                "ok": True,
                "contract": contract,
                "model": model_id,
            })

        job = enqueue_llm(
            "storyboard",
            model_id,
            contract,
            context={
                "storyId": story_id,
                "sceneId": scene_id,
                "operation": operation,
                "replaceExisting": replace_existing,
                **({"repairBase": repair_base} if repair_base is not None else {}),
            },
            label=("Story: " + operation.replace("_", " ")).strip(),
        )
        return jsonify({"ok": True, "job": job}), 202
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


@app.route("/fs/generate/prompts", methods=["GET"])
def generate_prompts_route():
    try:
        return jsonify({"ok": True, "prompts": generate_list_prompts()})
    except Exception as exc:
        app.logger.exception("GENERATE PROMPT LIBRARY FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/prompt", methods=["POST"])
def generate_prompt_save_route():
    try:
        data = request.get_json(silent=True) or {}
        prompt = generate_save_prompt(data.get("name"), data.get("prompt"), prompt_id=data.get("id"))
        return jsonify({"ok": True, "prompt": prompt})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("GENERATE PROMPT SAVE FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/prompt/delete", methods=["POST"])
def generate_prompt_delete_route():
    try:
        data = request.get_json(silent=True) or {}
        prompt = generate_delete_prompt(data.get("id"))
        return jsonify({"ok": True, "prompt": prompt})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("GENERATE PROMPT DELETE FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/results", methods=["GET"])
def generate_results_route():
    try:
        return jsonify({"ok": True, "results": generate_list_results(request.args.get("limit", 100))})
    except Exception as exc:
        app.logger.exception("GENERATE RESULTS FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/result/delete", methods=["POST"])
def generate_result_delete_route():
    try:
        data = request.get_json(silent=True) or {}
        storage_id = str(data.get("storageId") or "").strip()
        if not storage_id:
            raise ValueError("Generation storage ID is required.")
        storage_purge("generate", storage_id)
        return jsonify({"ok": True, "storageId": storage_id})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("GENERATE RESULT DELETE FAILED: %s", exc)
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/generate/result/rating", methods=["POST"])
def generate_result_rating_route():
    try:
        data = request.get_json(silent=True) or {}
        result = generate_rate_result(data.get("storageId"), data.get("rating"))
        return jsonify({"ok": True, **result})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except Exception as exc:
        app.logger.exception("GENERATE RESULT RATING FAILED: %s", exc)
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
                consume = str(request.args.get("consume") or "").strip().lower() in {"1", "true", "yes"}
                return jsonify({"ok": True, "job": inference_job_status(job_id, consume=consume)})
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
            reference_roles=data.get("referenceRoles"),
        )
        job = enqueue_llm(
            "generate",
            str(data.get("directorModel") or "").strip(),
            contract,
            context={"operation": str(data.get("operation") or "").strip()},
            label=("Prompt Assistant: " + str(data.get("operation") or "").replace("_", " ")).strip(),
        )
        return jsonify({"ok": True, "job": job}), 202
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


@app.route("/fs/test_generations/source", methods=["GET"])
def test_generations_source_route():
    try:
        raw_source = request.args.get("source")
        payload = test_generations_browse_source(
            str(request.args.get("modelId") or "").strip(),
            None if raw_source is None else str(raw_source).strip(),
            str(request.args.get("setName") or "").strip(),
        )
        return jsonify({"ok": True, **payload})
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
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
        payload = prepare_training_review(
            folder_path,
            data.get("profileId") or "wan22_t2v",
            data.get("runId") or "",
            data.get("selected_media"),
            data.get("selection_criteria"),
            data.get("total_media_count"),
            data.get("fallback_captions"),
        )
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_review/update", methods=["POST"])
def training_review_update_route():
    data = request.get_json(silent=True) or {}
    try:
        folder_path = safe_join_fs_root((data.get("folder") or "").strip())
        payload = update_training_review(folder_path, data.get("profileId") or "wan22_t2v", data)
        return jsonify(payload)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_initializers", methods=["GET"])
def training_initializers_route():
    try:
        folder_path = safe_join_fs_root((request.args.get("folder") or "").strip())
        return jsonify({"ok": True, "exports": discover_saved_initializers(
            folder_path, request.args.get("profileId") or "", request.args.get("stage") or "",
        )})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/h3_probe/prepare", methods=["POST"])
def h3_probe_prepare_route():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(prepare_h3_probe(data.get("folder"), data.get("fileName")))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/h3_probe/start", methods=["POST"])
def h3_probe_start_route():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(start_h3_probe(data.get("folder"), data.get("fileName")))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/h3_probe/status", methods=["GET"])
def h3_probe_status_route():
    try:
        return jsonify(h3_probe_status())
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/h3_probe/log", methods=["GET"])
def h3_probe_log_route():
    try:
        return jsonify(h3_probe_log(request.args.get("offset", 0)))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/h3_probe/stop", methods=["POST"])
def h3_probe_stop_route():
    try:
        return jsonify(stop_h3_probe())
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/train_run", methods=["POST"])
def train_run_route():
    data = request.get_json(silent=True) or {}
    folder = (data.get("folder") or "").strip()
    stages = str(data.get("stages") or "").strip().lower()
    resume_from_checkpoint = str(data.get("resumeFromCheckpoint") or "").strip()
    resume_action_id = str(data.get("resumeActionId") or "").strip()
    resume_output_id = str(data.get("resumeOutputId") or "").strip()
    resume_stage = str(data.get("resumeStage") or (stages if stages in ("hi", "lo") else "lo")).strip().lower()
    if resume_from_checkpoint and resume_stage not in ("hi", "lo", "krea2", "wan21", "h3"):
        return Response("[ERROR] Resume stage must be hi, lo, krea2, wan21, or h3.\n", status=400, mimetype="text/plain")
    return train_run_response(
        folder, stages=stages, resume_from_checkpoint=resume_from_checkpoint,
        resume_stage=resume_stage, resume_action_id=resume_action_id, resume_output_id=resume_output_id, run_name=data.get("runName") or "",
        profile_id=data.get("profileId") or "", run_id=data.get("runId") or "",
        mode=data.get("mode") or "normal", selected_media=data.get("selected_media"),
        fallback_captions=data.get("fallback_captions"), selection_criteria=data.get("selection_criteria"),
        total_media_count=data.get("total_media_count"),
        initializer_action_id=data.get("initializerActionId") or "", initializer_export_id=data.get("initializerExportId") or "",
        initializer_stage=data.get("initializerStage") or "", initializer_custom_path=data.get("initializerCustomPath") or "", force_constant_lr=data.get("forceConstantLr"),
        config_settings=data.get("trainingSettings"),
    )


@app.route("/fs/training_runner/validate", methods=["POST"])
def training_runner_validate_route():
    data = request.get_json(silent=True) or {}
    payload, status = training_runner_validate_response(
        (data.get("folder") or "").strip(),
        data.get("stages") or "",
        data.get("resumeFromCheckpoint") or "",
        data.get("resumeStage") or "",
        data.get("resumeActionId") or "",
        data.get("resumeOutputId") or "",
        data.get("profileId") or "",
        data.get("runId") or "",
        data.get("mode") or "normal",
        data.get("selected_media"),
        data.get("fallback_captions"),
        data.get("selection_criteria"),
        data.get("total_media_count"),
    )
    return jsonify(payload), status


@app.route("/fs/training_runner/start", methods=["POST"])
def training_runner_start_route():
    data = request.get_json(silent=True) or {}
    payload, status = training_runner_start_response(
        (data.get("folder") or "").strip(),
        queue=bool(data.get("queue")),
        stages=data.get("stages") or "",
        resume_from_checkpoint=data.get("resumeFromCheckpoint") or "",
        resume_stage=data.get("resumeStage") or "",
        parent_job_id=data.get("parentJobId") or "",
        run_name=data.get("runName") or "",
        resume_action_id=data.get("resumeActionId") or "",
        resume_output_id=data.get("resumeOutputId") or "",
        profile_id=data.get("profileId") or "",
        run_id=data.get("runId") or "",
        mode=data.get("mode") or "normal",
        selected_media=data.get("selected_media"),
        fallback_captions=data.get("fallback_captions"),
        selection_criteria=data.get("selection_criteria"),
        total_media_count=data.get("total_media_count"),
        initializer_action_id=data.get("initializerActionId") or "",
        initializer_export_id=data.get("initializerExportId") or "",
        initializer_stage=data.get("initializerStage") or "",
        initializer_custom_path=data.get("initializerCustomPath") or "",
        force_constant_lr=data.get("forceConstantLr"),
        config_settings=data.get("trainingSettings"),
        reuse_capture_action_id=data.get("reuseCaptureActionId") or "",
        reuse_capture_path=data.get("reuseCapturePath") or "",
    )
    return jsonify(payload), status


@app.route("/fs/training_runner/status", methods=["GET"])
def training_runner_status_route():
    payload, status = training_runner_status_response()
    return jsonify(payload), status


@app.route("/fs/training_runner/recover", methods=["POST"])
def training_runner_recover_route():
    payload, status = training_runner_recover_state_response()
    return jsonify(payload), status


@app.route("/fs/training_runner/gpu", methods=["GET"])
def training_runner_gpu_route():
    payload, status = training_runner_gpu_status_response()
    return jsonify(payload), status


@app.route("/fs/training_runner/log", methods=["GET"])
def training_runner_log_route():
    payload, status = training_runner_log_response(
        request.args.get("jobId", ""),
        request.args.get("offset", "0"),
        request.args.get("tail") == "1",
        request.args.get("folder", ""),
    )
    return jsonify(payload), status


@app.route("/fs/training_runner/open_log", methods=["POST"])
def training_runner_open_log_route():
    data = request.get_json(silent=True) or {}
    try:
        return open_path_in_explorer_response(training_runner_log_path_for_job(data.get("jobId", ""), data.get("folder", "")))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_runner/open_output", methods=["POST"])
def training_runner_open_output_route():
    data = request.get_json(silent=True) or {}
    try:
        return open_path_in_explorer_response(training_runner_output_path_for_job(data.get("jobId", "")))
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_runner/open_action", methods=["POST"])
def training_runner_open_action_route():
    data = request.get_json(silent=True) or {}
    try:
        return open_path_in_explorer_response(
            training_runner_action_path_for_job(data.get("jobId", ""), data.get("folder", ""))
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_runner/stop", methods=["POST"])
def training_runner_stop_route():
    data = request.get_json(silent=True) or {}
    payload, status = training_runner_stop_response(
        data.get("jobId", ""), cancel=bool(data.get("cancel")), pause=bool(data.get("pause")), finish=bool(data.get("finish"))
    )
    return jsonify(payload), status


@app.route("/fs/training_runner/finish_schedule", methods=["POST"])
def training_runner_finish_schedule_route():
    data = request.get_json(silent=True) or {}
    payload, status = training_runner_finish_schedule_response(
        data.get("jobId", ""), epoch=data.get("epoch"), cancel=bool(data.get("cancel"))
    )
    return jsonify(payload), status


@app.route("/fs/training_runner/reorder", methods=["POST"])
def training_runner_reorder_route():
    data = request.get_json(silent=True) or {}
    payload, status = training_runner_reorder_response(data.get("jobId", ""), str(data.get("direction") or ""))
    return jsonify(payload), status


@app.route("/fs/training_runner/resume_queue", methods=["POST"])
def training_runner_resume_queue_route():
    payload, status = training_runner_resume_queue_response()
    return jsonify(payload), status


@app.route("/fs/training_history", methods=["GET"])
def training_history_route():
    folder = request.args.get("folder", "").strip()
    try:
        return jsonify({"ok": True, "history": training_history_payload(safe_join_fs_root(folder))})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/training_history/all", methods=["GET"])
def training_history_all_route():
    try:
        return jsonify({"ok": True, "history": training_all_history_payload(request.args.get("q", ""), request.args.get("folder", ""))})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/training_history/clear", methods=["POST"])
def training_history_clear_route():
    data = request.get_json(silent=True) or {}
    folder = str(data.get("folder") or "").strip()
    try:
        cleared = clear_training_history(safe_join_fs_root(folder) if folder else None)
        return jsonify({"ok": True, "cleared": cleared})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/training_history/job/clear", methods=["POST"])
def training_history_job_clear_route():
    data = request.get_json(silent=True) or {}
    folder = str(data.get("folder") or "").strip()
    job_id = str(data.get("jobId") or "").strip()
    if not folder or not job_id:
        return jsonify({"ok": False, "error": "Folder and job ID are required."}), 400
    payload, status = training_runner_clear_history_response(folder, job_id)
    return jsonify(payload), status


@app.route("/fs/training_history/job/metrics", methods=["GET"])
def training_history_job_metrics_route():
    folder = request.args.get("folder", "").strip()
    job_id = request.args.get("jobId", "").strip()
    if not folder or not job_id:
        return jsonify({"ok": False, "error": "Folder and job ID are required."}), 400
    payload, status = training_runner_history_metrics_response(folder, job_id)
    return jsonify(payload), status


@app.route("/fs/training_candidates", methods=["GET"])
def training_candidates_route():
    folder = request.args.get("folder", "").strip()
    job_id = request.args.get("jobId", "").strip()
    algorithm = request.args.get("algorithm", "v5").strip()
    payload, status = training_runner_candidate_analysis_response(folder, job_id, algorithm)
    return jsonify(payload), status


@app.route("/fs/training_candidates/open_run", methods=["POST"])
def training_candidates_open_run_route():
    data = request.get_json(silent=True) or {}
    try:
        return open_path_in_explorer_response(
            training_runner_candidate_run_folder_path(data.get("folder", ""), data.get("jobId", ""))
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 422
    except (TrainingStateError, ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_candidates/open_epoch", methods=["POST"])
def training_candidates_open_epoch_route():
    data = request.get_json(silent=True) or {}
    try:
        return open_path_in_explorer_response(
            training_runner_candidate_epoch_folder_path(data.get("folder", ""), data.get("jobId", ""), data.get("epoch", ""))
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 422
    except (TrainingStateError, ValueError, RuntimeError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_candidates/copy_to_test", methods=["POST"])
def training_candidates_copy_to_test_route():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or set(data) - {"folder", "jobId", "epoch"}:
        return jsonify({"ok": False, "error": "Copy to Test accepts only folder, jobId, and epoch."}), 400
    payload, status = training_runner_copy_candidate_epoch_to_test_response(
        data.get("folder", ""), data.get("jobId", ""), data.get("epoch", "")
    )
    return jsonify(payload), status


@app.route("/fs/training_candidates/remove_from_test", methods=["POST"])
def training_candidates_remove_from_test_route():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or set(data) - {"folder", "jobId", "epoch"}:
        return jsonify({"ok": False, "error": "Remove from Test Folder accepts only folder, jobId, and epoch."}), 400
    payload, status = training_runner_remove_candidate_epoch_from_test_response(
        data.get("folder", ""), data.get("jobId", ""), data.get("epoch", "")
    )
    return jsonify(payload), status


@app.route("/fs/training_candidates/select", methods=["POST"])
def training_candidates_select_route():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or set(data) - {"folder", "jobId", "epoch"}:
        return jsonify({"ok": False, "error": "Select epoch accepts only folder, jobId, and epoch."}), 400
    payload, status = training_runner_select_candidate_epoch_response(
        data.get("folder", ""), data.get("jobId", ""), data.get("epoch", "")
    )
    return jsonify(payload), status


@app.route("/fs/training_candidates/clear_selection", methods=["POST"])
def training_candidates_clear_selection_route():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or set(data) - {"folder", "jobId"}:
        return jsonify({"ok": False, "error": "Clear selection accepts only folder and jobId."}), 400
    payload, status = training_runner_clear_candidate_epoch_selection_response(
        data.get("folder", ""), data.get("jobId", "")
    )
    return jsonify(payload), status


@app.route("/fs/training_candidates/open_test", methods=["POST"])
def training_candidates_open_test_route():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict) or set(data) - {"folder", "jobId"}:
        return jsonify({"ok": False, "error": "Open Test Folder accepts only folder and jobId."}), 400
    try:
        return open_path_in_explorer_response(
            training_runner_candidate_test_folder_path(data.get("folder", ""), data.get("jobId", ""))
        )
    except LookupError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 404
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 422
    except (TrainingStateError, ValueError, RuntimeError, OSError) as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400


@app.route("/fs/training_history/open_output", methods=["POST"])
def training_history_open_output_route():
    data = request.get_json(silent=True) or {}
    folder = str(data.get("folder") or "").strip()
    job_id = str(data.get("jobId") or "").strip()
    if not folder:
        return jsonify({"ok": False, "error": "Training folder is required."}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        return open_path_in_explorer_response(history_job_output_path(folder_path, job_id))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/fs/training_history/open_run", methods=["POST"])
def training_history_open_run_route():
    data = request.get_json(silent=True) or {}
    folder = str(data.get("folder") or "").strip()
    if not folder:
        return jsonify({"ok": False, "error": "Training folder is required."}), 400
    try:
        folder_path = safe_join_fs_root(folder)
        path = discovered_run_output_path(folder_path, data.get("modelId", ""), data.get("path", ""))
        return open_path_in_explorer_response(path)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route('/fs/duplicate_folder', methods=['POST'])
def duplicate_folder(): 
    data = request.get_json()
    src_rel = data.get('src')
    return duplicate_folder_response(src_rel)


@app.route('/fs/duplicate_media', methods=['POST'])
def duplicate_media():
    data = request.get_json(silent=True) or {}
    src_rel = (data.get('src') or '').strip()
    return duplicate_media_response(src_rel)


@app.route("/fs/smart_set_materialize", methods=["POST"])
def smart_set_materialize_route():
    data = request.get_json(silent=True) or {}
    return smart_set_materialize_response(data)


@app.route("/fs/create_set_from_results", methods=["POST"])
def create_set_from_results_route():
    data = request.get_json(silent=True) or {}
    return create_set_from_results_response(data)


@app.route("/fs/superset_search", methods=["POST"])
def superset_search_route():
    data = request.get_json(silent=True) or {}
    return superset_search_response(data)

# Unified deface endpoint
@app.route('/fs/deface', methods=['POST'])
def deface():
    """
    Unified deface endpoint: accepts a file or folder, ensures originals backup by hash, runs deface with --output to overwrite input.
    POST JSON: {"file": <file_rel> } or {"folder": <folder_rel>}
    Optional: "thresh" (default 0.4)
    """
    import subprocess
    from pathlib import Path
    from tool.server.originals import ensure_original_by_hash, ensure_originals_folder

    data = request.get_json()
    file_rel = data.get('file')
    folder_rel = data.get('folder')
    thresh = str(data.get('thresh', '0.4')).strip()
    if not (file_rel or folder_rel):
        return jsonify({'error': 'Missing file or folder'}), 400

    deface_path = shutil.which('deface')
    if not deface_path:
        return Response('[ERROR] deface executable not found in PATH or venv.\n', mimetype='text/plain'), 500

    # Helper to deface a single file
    def deface_one(file_path, thresh):
        file_path = Path(file_path)
        folder_path = file_path.parent
        originals_dir = ensure_originals_folder(folder_path)
        # Ensure backup by hash
        ensure_original_by_hash(file_path, originals_dir)
        anonymized_path = file_path.with_name(file_path.stem + '_anonymized' + file_path.suffix)
        deface_cmd = [deface_path, '-t', thresh, '--mask-scale', '1']
        if file_path.suffix.lower() in {'.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v'}:
            deface_cmd.append('--keep-audio')
        deface_cmd.append(str(file_path))
        yield f'[DEFACE] Command: {deface_cmd}\n'
        yield f'[DEFACE] CWD: {os.getcwd()}\n'
        yield f'[DEFACE] PATH: {os.environ.get("PATH", "")}\n'
        # Optionally log more env vars if needed
        proc = subprocess.Popen(deface_cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            yield line
        proc.wait()
        if proc.returncode == 0 and anonymized_path.exists():
            os.replace(anonymized_path, file_path)
            normalize_path_permissions(file_path)
            yield f'[SUCCESS] Defaced {file_path.name}\n'
        elif proc.returncode == 0:
            yield f'[FAIL] Deface completed but no anonymized output was found for {file_path.name}\n'
        else:
            yield f'[FAIL] Deface failed for {file_path.name}\n'

    deface_exts = {
        '.mp4', '.webm', '.ogg', '.mov', '.mkv', '.avi', '.m4v',
        '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'
    }

    def generate():
        if file_rel:
            file_path = safe_join_fs_root(file_rel)
            yield from deface_one(file_path, thresh)
        elif folder_rel:
            folder_path = safe_join_fs_root(folder_rel)
            for fname in sorted(os.listdir(folder_path)):
                ext = Path(fname).suffix.lower()
                if ext not in deface_exts:
                    continue
                file_path = os.path.join(folder_path, fname)
                yield from deface_one(file_path, thresh)

    return Response(stream_with_context(generate()), mimetype='text/plain')

@app.route("/fs/describe", methods=["GET"])
def fs_describe():
    """
    Unified endpoint: returns all folders, files (with metadata), and folder state for a directory.
    No filtering; frontend decides what to display.
    """
    rel_path = request.args.get("path", "").strip()

    try:
        dir_path = safe_join_fs_root(rel_path)
        if not dir_path.exists() or not dir_path.is_dir():
            return jsonify({"error": f"Directory does not exist: {rel_path}"}), 404
        payload = run_with_directory_repair(dir_path, lambda: _build_fs_describe_payload(dir_path))
        return jsonify(payload)
    except FolderStateReadError as e:
        app.logger.exception("FOLDER STATE LOAD FAILED for %r: %s", rel_path, e)
        return jsonify({"error": str(e), "folderStateReadFailed": True}), 500
    except OriginalsBackupError as e:
        return jsonify({"error": str(e)}), 500
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[fs_describe] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


@app.route("/fs/originals/sync", methods=["POST"])
def fs_originals_sync():
    data = request.get_json(silent=True) or {}
    rel_path = str(data.get("folder", "")).strip()
    try:
        dir_path = safe_join_fs_root(rel_path)
        if not dir_path.exists() or not dir_path.is_dir():
            return jsonify({"error": f"Directory does not exist: {rel_path}"}), 404
        copy_media_to_originals(dir_path)
        return jsonify({"ok": True})
    except Exception as e:
        app.logger.exception("ORIGINALS SYNC FAILED for %r: %s", rel_path, e)
        return jsonify({"error": str(e)}), 500


def _build_fs_describe_payload(dir_path):
    # State is user-authored set data. Validate it before any directory-load
    # side effects so a failed read cannot be bypassed or normalized away.
    state_path = dir_path / ".webcap_state.json"
    folder_state = read_folder_state(state_path)
    try:
        copy_media_to_originals(dir_path)
    except Exception as exc:
        app.logger.exception("ORIGINALS BACKUP FAILED while loading folder %s", dir_path)
        raise OriginalsBackupError(
            "Could not back up media to originals. WebCap refused to load this folder because working in it would be unsafe. "
            f"{exc}"
        ) from exc

    entries = []
    for entry in sorted(dir_path.iterdir(), key=lambda e: e.name.lower()):
        if entry.is_dir() and entry.name == ".webcap_training":
            continue
        if entry.is_file() and is_transient_media_name(entry.name):
            continue
        meta = {
            "name": entry.name,
            "type": "dir" if entry.is_dir() else "file",
            "extension": entry.suffix.lower() if entry.is_file() else "",
            "size": entry.stat().st_size if entry.is_file() else None,
        }
        entries.append(meta)

    from .originals import MEDIA_ALL_EXTS
    from .caption_ops import _caption_name_for_media
    listed_file_names = {entry["name"] for entry in entries if entry["type"] == "file"}
    captions = {}
    caption_errors = []
    for meta in entries:
        if meta["type"] == "file" and meta["extension"] in MEDIA_ALL_EXTS:
            caption_name = _caption_name_for_media(meta["name"])
            caption_path = dir_path / caption_name
            caption_exists = caption_name in listed_file_names
            if caption_exists:
                try:
                    text = caption_path.read_text(encoding="utf-8")
                except Exception as e:
                    text = None
                    error = f"Could not read caption {caption_path}: {e}"
                    app.logger.exception("CAPTION READ FAILED for media=%r caption=%r: %s", meta["name"], caption_name, e)
                    caption_errors.append({"media": meta["name"], "caption": caption_name, "error": error})
            else:
                text = None
            caption_payload = {"exists": caption_exists, "text": text}
            if caption_errors and caption_errors[-1]["media"] == meta["name"]:
                caption_payload["error"] = caption_errors[-1]["error"]
            captions[meta["name"]] = caption_payload

    folders = [
        dict(entry)
        for entry in entries
        if entry["type"] == "dir" and entry["name"].lower() not in ("originals", "auto_dataset")
    ]

    return {
        "folders": folders,
        "files": [e for e in entries if e["type"] == "file"],
        "captions": captions,
        "caption_errors": caption_errors,
        "folder_state": folder_state
    }

 # Media metadata endpoint
@app.route("/fs/color_suggestions", methods=["GET"])
def fs_color_suggestions():
    return color_suggestions_response(
        request.args.get("folder", ""),
        request.args.get("file", ""),
    )


@app.route("/fs/media_metadata", methods=["GET"])
def fs_media_metadata():
    rel_path = request.args.get("folder", "").strip()
    try:
        disk_config = app_config.load_config_from_disk()
    except Exception:
        disk_config = app_config.get_config_snapshot()
    analysis = disk_config.get("analysis") if isinstance(disk_config.get("analysis"), dict) else {}
    include_face_focus = bool(analysis.get("enableFaceAnalysis", False)) or _request_bool_arg("face_focus")
    include_selection_pose = bool(analysis.get("enableMediaPipeAnalysis", False)) or _request_bool_arg("selection_pose")
    scoped_filenames = [
        name.strip()
        for name in str(request.args.get("files", "") or "").splitlines()
        if name.strip()
    ]
    return media_metadata_response(
        rel_path,
        include_face_focus=include_face_focus,
        include_selection_pose=include_selection_pose,
        scoped_filenames=scoped_filenames,
    )


@app.route("/fs/prune_candidates", methods=["GET", "POST"])
def fs_prune_candidates():
    data = (request.get_json(silent=True) or {}) if request.method == "POST" else {}
    rel_path = (data.get("folder") if request.method == "POST" else request.args.get("folder", "")) or ""
    rel_path = str(rel_path).strip()
    try:
        disk_config = app_config.load_config_from_disk()
    except Exception:
        disk_config = app_config.get_config_snapshot()
    analysis = disk_config.get("analysis") if isinstance(disk_config.get("analysis"), dict) else {}
    return prune_candidates_response(
        rel_path,
        include_face_focus=bool(analysis.get("enableFaceAnalysis", False)),
        include_selection_pose=bool(analysis.get("enableMediaPipeAnalysis", False)),
        selected_media=data.get("selected_media") if request.method == "POST" else None,
    )


@app.route("/fs/duplicate_candidates", methods=["POST"])
def fs_duplicate_candidates():
    data = request.get_json(silent=True) or {}
    return duplicate_candidates_response(
        data.get("folder", ""),
        selected_media=data.get("selected_media"),
    )


@app.route("/fs/mutation_status", methods=["GET"])
def fs_mutation_status():
    rel_path = request.args.get("folder", "").strip()
    try:
        folder_path = safe_join_fs_root(rel_path)
        if not folder_path.exists() or not folder_path.is_dir():
            return jsonify({"error": f"Folder does not exist: {rel_path}"}), 404
        status_by_media = media_mutation_status_by_hash(folder_path)
        return jsonify({
            "ok": True,
            "folder": rel_path,
            "status_by_media": status_by_media
        })
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[fs_mutation_status] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
    
from .config import list_toml_files, read_toml_file, save_toml_file
# --- Config file API ---
@app.route("/fs/list_config", methods=["GET"])
def list_config():
    folder = request.args.get("folder", "").strip()
    try:
        files = list_toml_files(folder)
        return jsonify({"files": files})
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[list_config] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400

@app.route("/fs/read_config", methods=["GET"])
def read_config():
    folder = request.args.get("folder", "").strip()
    filename = request.args.get("file", "").strip()
    try:
        text = read_toml_file(folder, filename)
        return Response(text, mimetype="text/plain")
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[read_config] ERROR:", e)
            app_config.debug_traceback()
        return Response("", status=400)

@app.route("/fs/save_config", methods=["POST"])
def save_config():
    data = request.get_json(silent=True) or {}
    folder = data.get("folder", "").strip()
    filename = data.get("file", "").strip()
    text = data.get("text", "")
    try:
        save_toml_file(folder, filename, text)
        return jsonify({"ok": True})
    except Exception as e:
        if app_config.FS_DEBUG:
            app_config.debug_print("[save_config] ERROR:", e)
            app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400
    
@app.route("/fs/open_in_explorer", methods=["POST"])
def open_in_explorer():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    return open_in_explorer_response(rel_path)

@app.route("/fs/open_in_vscode", methods=["POST"])
def open_in_vscode():
    data = request.get_json(silent=True) or {}
    rel_path = data.get("path", "").strip()
    return open_in_vscode_response(rel_path)
    
if __name__ == "__main__":
    prepare_inference_startup_backlog()
    start_training_runner_observer()
    reconcile_llm_startup()
    # Only bind to localhost for desktop/offline use.
    # Disable Flask debug mode for a production-like local runtime.
    app.run(host="127.0.0.1", port=4200, debug=False)
