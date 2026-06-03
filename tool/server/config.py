"""
config.py

Centralized config and root path logic for the backend.
"""

from pathlib import Path
import json
import copy
import re

CONFIG_PATH = Path(__file__).resolve().parents[1] / 'config.json'
CONFIG_EXAMPLE_PATH = Path(__file__).resolve().parents[1] / 'config.example.json'

config = {}
FS_ROOT = Path(".")
FS_DEBUG = False


def _as_clean_str(value, field_name):
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"Missing or empty {field_name}")
    return text


def load_default_requirements_block():
    try:
        with open(CONFIG_EXAMPLE_PATH, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        requirements = raw.get('requirements')
        if isinstance(requirements, dict):
            return copy.deepcopy(requirements)
    except Exception:
        pass
    return {}


def requirement_defaults_are_empty(payload):
    requirements = payload.get('requirements') if isinstance(payload, dict) else None
    if not isinstance(requirements, dict):
        return True
    items = requirements.get('items')
    keywords = requirements.get('keywordsByItem')
    has_items = isinstance(items, list) and len(items) > 0
    has_keywords = isinstance(keywords, dict) and len(keywords) > 0
    return not (has_items or has_keywords)


def apply_requirement_defaults(payload):
    normalized = copy.deepcopy(payload) if isinstance(payload, dict) else {}
    if requirement_defaults_are_empty(normalized):
        defaults = load_default_requirements_block()
        if defaults:
            normalized['requirements'] = defaults
    return normalized


def validate_config_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("Config must be a JSON object.")

    out = copy.deepcopy(payload)
    filesystem = out.get("filesystem")
    if not isinstance(filesystem, dict):
        raise ValueError("Config.filesystem must be an object.")

    root = _as_clean_str(filesystem.get("root"), "filesystem.root")
    models = str(filesystem.get("models") or "").strip()
    out["filesystem"] = {
        "root": root,
        "models": models,
    }

    out["debug"] = bool(out.get("debug", False))

    training = out.get("training")
    if training is None:
        training = {}
    if not isinstance(training, dict):
        raise ValueError("Config.training must be an object when provided.")
    normalized_training = {}
    for key in ("diffusion_pipe_wsl", "activate_script"):
        if key in training:
            normalized_training[key] = str(training.get(key) or "").strip()
    if "mode" in training:
        mode = str(training.get("mode") or "").strip().lower()
        if mode not in ("poc", "normal", "quality"):
            mode = "normal"
        normalized_training["mode"] = mode
    if "write_selection_snapshot_comments" in training:
        normalized_training["write_selection_snapshot_comments"] = bool(training.get("write_selection_snapshot_comments"))
    if normalized_training:
        out["training"] = normalized_training
    elif "training" in out:
        out["training"] = {}

    return out


def load_config_from_disk():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    return apply_requirement_defaults(validate_config_payload(raw))


def save_config_to_disk(payload):
    normalized = apply_requirement_defaults(validate_config_payload(payload))
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, indent=2)
        f.write("\n")
    return normalized


def reload_runtime_config():
    global config, FS_ROOT, FS_DEBUG
    loaded = load_config_from_disk()
    config = loaded
    FS_ROOT = Path(config['filesystem']['root'])
    FS_DEBUG = bool(config.get('debug', False))
    return config


def get_config_snapshot():
    return copy.deepcopy(config)


reload_runtime_config()

def safe_join_fs_root(rel_path):
    rel_path = rel_path.strip().replace('..', '').replace('\\', '/').replace('//', '/')
    if rel_path.startswith('/'):
        rel_path = rel_path[1:]
    abs_path = (FS_ROOT / rel_path).resolve()
    return abs_path

def list_toml_files(folder_path):
    """
    Returns a list of .toml files (names only) in the given folder.
    """
    folder = safe_join_fs_root(folder_path)
    if not folder.exists() or not folder.is_dir():
        return []
    return [f.name for f in folder.iterdir() if f.is_file() and f.name.endswith('.toml')]

def read_toml_file(folder_path, filename):
    """
    Reads and returns the contents of a .toml file in the given folder.
    """
    if '/' in filename or '\\' in filename or '..' in filename or not filename.endswith('.toml'):
        raise ValueError('Invalid config filename')
    folder = safe_join_fs_root(folder_path)
    file_path = folder / filename
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(filename)
    return file_path.read_text(encoding='utf-8')

def save_toml_file(folder_path, filename, text):
    """
    Writes the given text to a .toml file in the given folder.
    """
    if '/' in filename or '\\' in filename or '..' in filename or not filename.endswith('.toml'):
        raise ValueError('Invalid config filename')
    folder = safe_join_fs_root(folder_path)
    file_path = folder / filename
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(text)
    try:
        import os
        os.chmod(file_path, 0o644)
    except Exception:
        pass

        return True

def fill_template_placeholders(toml_text, dataset_name):
    """
    Replace placeholders in TOML templates with config values and dataset name.
    """
    def normalize_template_path(value, trim_edges):
        text = str(value or "").strip().replace("\\", "/")
        text = re.sub(r"/{2,}", "/", text)
        if trim_edges:
            text = text.strip("/")
        else:
            if text not in ("", "/") and not re.match(r"^[A-Za-z]:/$", text):
                text = text.rstrip("/")
        return text

    training_root = normalize_template_path(config['filesystem']['root'], trim_edges=False)
    models_root = normalize_template_path(config['filesystem'].get('models', ''), trim_edges=False)
    dataset_rel = normalize_template_path(dataset_name, trim_edges=True)
    replacements = {
        '{TRAINING_ROOT}': training_root,
        '{MODELS_ROOT}': models_root,
        '{DATASET}': dataset_rel
    }
    for key, value in replacements.items():
        toml_text = toml_text.replace(key, value)
    return toml_text
