from pathlib import Path
import os

DIR_MODE = 0o775
FILE_MODE = 0o664


def supports_posix_chmod():
    return os.name == "posix"


def normalize_path_permissions(path, dir_mode=DIR_MODE, file_mode=FILE_MODE):
    if not supports_posix_chmod():
        return False
    target = Path(path)
    try:
        if target.is_symlink():
            return False
        if target.is_dir():
            target.chmod(dir_mode)
            return True
        if target.exists():
            target.chmod(file_mode)
            return True
    except Exception:
        return False
    return False


def repair_directory_permissions(root, dir_mode=DIR_MODE, file_mode=FILE_MODE):
    if not supports_posix_chmod():
        return {"attempted": False, "changed": 0, "failed": 0}

    root_path = Path(root)
    if not root_path.exists():
        return {"attempted": False, "changed": 0, "failed": 0}

    changed = 0
    failed = 0
    if normalize_path_permissions(root_path, dir_mode=dir_mode, file_mode=file_mode):
        changed += 1
    else:
        failed += 1

    if not root_path.is_dir():
        return {"attempted": True, "changed": changed, "failed": failed}

    try:
        for entry in root_path.iterdir():
            if normalize_path_permissions(entry, dir_mode=dir_mode, file_mode=file_mode):
                changed += 1
            else:
                failed += 1
    except Exception:
        failed += 1

    return {"attempted": True, "changed": changed, "failed": failed}


def run_with_directory_repair(root, callback, dir_mode=DIR_MODE, file_mode=FILE_MODE):
    try:
        return callback()
    except PermissionError:
        if not supports_posix_chmod():
            raise
        repair_directory_permissions(root, dir_mode=dir_mode, file_mode=file_mode)
        return callback()


def normalize_tree_permissions(root, dir_mode=DIR_MODE, file_mode=FILE_MODE):
    if not supports_posix_chmod():
        return {"attempted": False, "changed": 0, "failed": 0}

    root_path = Path(root)
    if not root_path.exists():
        return {"attempted": False, "changed": 0, "failed": 0}

    changed = 0
    failed = 0
    if normalize_path_permissions(root_path, dir_mode=dir_mode, file_mode=file_mode):
        changed += 1

    if not root_path.is_dir():
        return {"attempted": True, "changed": changed, "failed": failed}

    for current, dirnames, filenames in os.walk(root_path, followlinks=False):
        current_path = Path(current)
        for dirname in dirnames:
            if normalize_path_permissions(current_path / dirname, dir_mode=dir_mode, file_mode=file_mode):
                changed += 1
            else:
                failed += 1
        for filename in filenames:
            if normalize_path_permissions(current_path / filename, dir_mode=dir_mode, file_mode=file_mode):
                changed += 1
            else:
                failed += 1

    return {"attempted": True, "changed": changed, "failed": failed}
