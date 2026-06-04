import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

from flask import jsonify

from . import config as app_config


def duplicate_folder_response(src_rel):
    try:
        src_path = safe_join_fs_root(src_rel)
    except Exception as e:
        return jsonify({"error": f"Invalid source path: {e}"}), 400
    if not src_rel or not src_path.exists() or not src_path.is_dir():
        return jsonify({"error": "Source folder does not exist"}), 400

    base = src_path.name
    parent = src_path.parent
    i = 1
    while True:
        if i == 1:
            dst_path = parent / f"{base} copy"
        else:
            dst_path = parent / f"{base} copy {i}"
        if not dst_path.exists():
            break
        i += 1

    shutil.copytree(str(src_path), str(dst_path))
    return jsonify({"success": True, "dst": str(dst_path)})


def duplicate_image_response(src_rel):
    src_rel = (src_rel or "").strip()
    if not src_rel:
        return jsonify({"error": "Missing source path"}), 400
    try:
        src_path = safe_join_fs_root(src_rel)
    except Exception as e:
        return jsonify({"error": f"Invalid source path: {e}"}), 400

    if not src_path.exists() or not src_path.is_file():
        return jsonify({"error": "Source image does not exist"}), 404
    if src_path.parent.name.lower() == "originals":
        return jsonify({"error": "Duplicate Image is not allowed in originals folder"}), 400

    image_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
    ext = src_path.suffix.lower()
    if ext not in image_exts:
        return jsonify({"error": "Duplicate Image only supports still image files"}), 400

    stem = src_path.stem
    parent = src_path.parent
    i = 1
    while True:
        if i == 1:
            dst_name = f"{stem} copy{ext}"
        else:
            dst_name = f"{stem} copy {i}{ext}"
        dst_path = parent / dst_name
        if not dst_path.exists():
            break
        i += 1

    shutil.copy2(str(src_path), str(dst_path))
    try:
        os.chmod(dst_path, 0o644)
    except Exception:
        pass

    src_caption = src_path.with_suffix(".txt")
    dst_caption = dst_path.with_suffix(".txt")
    if src_caption.exists() and src_caption.is_file() and not dst_caption.exists():
        shutil.copy2(str(src_caption), str(dst_caption))
        try:
            os.chmod(dst_caption, 0o644)
        except Exception:
            pass

    return jsonify({"success": True, "dst": str(dst_path), "dstName": dst_name})


def rename_response(data):
    data = data or {}
    app_config.debug_print("[fs_rename] Incoming data:", data)
    folder = data.get("folder", "").strip()
    old_name = data.get("oldFile") or data.get("old_name") or ""
    new_name = data.get("newFile") or data.get("new_name") or ""
    old_name = old_name.strip()
    new_name = new_name.strip()
    if not old_name or not new_name:
        app_config.debug_print("[fs_rename] Missing required parameters:", folder, old_name, new_name)
        return jsonify({"error": "Missing required parameters"}), 400
    try:
        folder_path = app_config.safe_join_fs_root(folder)
        old_path = folder_path / old_name
        new_path = folder_path / new_name
        if not old_path.exists():
            app_config.debug_print("[fs_rename] Source does not exist:", old_path)
            return jsonify({"error": "Source does not exist"}), 404
        if new_path.exists():
            app_config.debug_print("[fs_rename] Target already exists:", new_path)
            return jsonify({"error": "Target already exists"}), 409
        if old_path.is_dir():
            if old_name in ("originals", ".", "..") or new_name in ("originals", ".", ".."):
                return jsonify({"error": "Invalid folder name"}), 400
            old_path.rename(new_path)
            return jsonify({"ok": True})
        if old_path.is_file():
            originals_path = folder_path / "originals"
            old_orig_media = originals_path / old_name if originals_path.exists() else None
            new_orig_media = originals_path / new_name if originals_path.exists() else None
            if new_orig_media and new_orig_media.exists():
                return jsonify({"error": "Target name already exists in originals folder"}), 409

            old_caption = folder_path / (Path(old_name).stem + ".txt")
            new_caption = folder_path / (Path(new_name).stem + ".txt")
            if old_caption.exists() and new_caption.exists():
                return jsonify({"error": f"Rename blocked: unexpected existing caption target: {new_caption}"}), 409

            old_orig_caption = originals_path / (Path(old_name).stem + ".txt") if originals_path.exists() else None
            new_orig_caption = originals_path / (Path(new_name).stem + ".txt") if originals_path.exists() else None
            if old_orig_caption and old_orig_caption.exists() and new_orig_caption and new_orig_caption.exists():
                return jsonify({"error": f"Rename blocked: unexpected existing originals caption target: {new_orig_caption}"}), 409

            old_path.rename(new_path)
            if old_caption.exists():
                old_caption.rename(new_caption)
            if old_orig_media and old_orig_media.exists():
                old_orig_media.rename(new_orig_media)
            if old_orig_caption and old_orig_caption.exists():
                old_orig_caption.rename(new_orig_caption)

            state_path = folder_path / ".webcap_state.json"
            if state_path.exists() and state_path.is_file():
                try:
                    import json

                    with open(state_path, "r", encoding="utf-8") as f:
                        folder_state = json.load(f)
                    if (
                        isinstance(folder_state, dict)
                        and "reviewedKeys" in folder_state
                        and isinstance(folder_state["reviewedKeys"], list)
                    ):
                        changed = False
                        new_keys = []
                        for k in folder_state["reviewedKeys"]:
                            if k == old_name:
                                new_keys.append(new_name)
                                changed = True
                            else:
                                new_keys.append(k)
                        if changed:
                            folder_state["reviewedKeys"] = new_keys
                            app_config.debug_print(f"[fs_rename] Updated reviewedKeys in {state_path}")
                    if (
                        isinstance(folder_state, dict)
                        and "mutated_media_keys" in folder_state
                        and isinstance(folder_state["mutated_media_keys"], list)
                    ):
                        changed_mutation = False
                        next_mutation_keys = []
                        for key in folder_state["mutated_media_keys"]:
                            if key == old_name:
                                next_mutation_keys.append(new_name)
                                changed_mutation = True
                            else:
                                next_mutation_keys.append(key)
                        if changed_mutation:
                            folder_state["mutated_media_keys"] = next_mutation_keys
                            app_config.debug_print(f"[fs_rename] Updated mutated_media_keys in {state_path}")
                    with open(state_path, "w", encoding="utf-8") as f:
                        json.dump(folder_state, f, indent=2)
                except Exception as e:
                    app_config.debug_print(f"[fs_rename] Could not update folder state keys: {e}")
            return jsonify({"ok": True})
        app_config.debug_print("[fs_rename] Source is neither file nor folder:", old_path)
        return jsonify({"error": "Source is neither file nor folder"}), 400
    except Exception as e:
        app_config.debug_print("[fs_rename] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 400


def _is_wsl_runtime():
    if sys.platform.startswith("win"):
        return False
    try:
        with open("/proc/version", "r", encoding="utf-8") as handle:
            if "microsoft" in handle.read().lower():
                return True
    except Exception:
        pass
    return bool(os.environ.get("WSL_DISTRO_NAME") or os.environ.get("WSLENV"))


def _to_windows_path(path: Path) -> str:
    resolved = path.resolve()
    if sys.platform.startswith("win"):
        return os.path.normpath(str(resolved))
    try:
        completed = subprocess.run(
            ["wslpath", "-w", str(resolved)],
            capture_output=True,
            text=True,
            check=True,
        )
        win_path = (completed.stdout or "").strip()
        if win_path:
            return win_path
    except Exception:
        pass
    text = str(resolved)
    if text.startswith("/mnt/") and len(text) > 6:
        drive = text[5].upper()
        rest = text[7:].replace("/", "\\")
        return f"{drive}:\\{rest}"
    return text.replace("/", "\\")


def _windows_explorer_exe():
    candidates = []
    if _is_wsl_runtime():
        candidates.append(Path("/mnt/c/Windows/explorer.exe"))
    windir = os.environ.get("WINDIR")
    if windir:
        candidates.append(Path(windir) / "explorer.exe")
    candidates.append(Path("explorer.exe"))
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return "explorer.exe"


def _launch_windows_explorer(abs_path: Path):
    win_path = os.path.normpath(_to_windows_path(abs_path))
    if not win_path:
        raise ValueError("Empty Windows path")

    explorer = _windows_explorer_exe()
    app_config.debug_print(
        "[open_in_explorer] Windows reveal:",
        win_path,
        "file=" + str(abs_path.is_file()),
        "wsl=" + str(_is_wsl_runtime()),
    )

    if abs_path.is_file():
        if _is_wsl_runtime():
            subprocess.Popen([explorer, f"/select,{win_path}"])
            return
        subprocess.Popen([explorer, "/select,", win_path])
        return

    if not abs_path.is_dir():
        raise FileNotFoundError(f"Folder does not exist: {abs_path}")
    if _is_wsl_runtime():
        subprocess.Popen([explorer, win_path])
        return
    os.startfile(win_path)


def open_in_explorer_response(rel_path):
    rel_path = (rel_path or "").strip()
    app_config.debug_print("[open_in_explorer] Received rel_path:", rel_path)
    if not rel_path:
        app_config.debug_print("[open_in_explorer] ERROR: Missing path")
        return jsonify({"error": "Missing path"}), 400
    try:
        abs_path = app_config.safe_join_fs_root(rel_path)
        app_config.debug_print("[open_in_explorer] Resolved abs_path:", abs_path)
        if not abs_path.exists():
            app_config.debug_print("[open_in_explorer] ERROR: Path does not exist:", abs_path)
            return jsonify({"error": "Path does not exist"}), 404

        if sys.platform.startswith("win") or _is_wsl_runtime():
            _launch_windows_explorer(abs_path)
        elif sys.platform.startswith("darwin"):
            if abs_path.is_file():
                subprocess.Popen(["open", "-R", str(abs_path)])
            else:
                subprocess.Popen(["open", str(abs_path)])
        else:
            subprocess.Popen(["xdg-open", str(abs_path if abs_path.is_dir() else abs_path.parent)])
        return jsonify({"ok": True})
    except Exception as e:
        app_config.debug_print("[open_in_explorer] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500


def open_in_vscode_response(rel_path):
    rel_path = (rel_path or "").strip()
    app_config.debug_print("[open_in_vscode] Received rel_path:", rel_path)
    try:
        abs_path = app_config.safe_join_fs_root(rel_path)
        app_config.debug_print("[open_in_vscode] Resolved abs_path:", abs_path)
        if not abs_path.exists() or not abs_path.is_dir():
            return jsonify({"error": "Folder does not exist"}), 404

        code_cmd = shutil.which("code") or shutil.which("code.cmd")
        if not code_cmd:
            return jsonify({"error": "VS Code command not found. In VS Code, run 'Shell Command: Install code command in PATH'."}), 404

        subprocess.Popen([code_cmd, str(abs_path)])
        return jsonify({"ok": True})
    except Exception as e:
        app_config.debug_print("[open_in_vscode] ERROR:", e)
        app_config.debug_traceback()
        return jsonify({"error": str(e)}), 500
