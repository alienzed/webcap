"""
config.py

Centralized config and root path logic for the backend.
"""

from pathlib import Path
import json
import copy
import os
import re
import traceback

from .permissions import normalize_path_permissions
from .training_profiles import PROFILE_IDS

CONFIG_PATH = Path(__file__).resolve().parents[1] / 'config.json'
CONFIG_EXAMPLE_PATH = Path(__file__).resolve().parents[1] / 'config.example.json'

config = {}
FS_ROOT = Path(".")
FS_DEBUG = False

H3_CALIBRATION_FRAMES = {"17", "34", "68"}
H3_CALIBRATION_ASPECTS = {"169", "square", "43"}


def debug_print(*args, **kwargs):
    if FS_DEBUG:
        print(*args, **kwargs)


def debug_traceback():
    if FS_DEBUG:
        traceback.print_exc()


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
            existing = normalized.get('requirements') if isinstance(normalized.get('requirements'), dict) else {}
            merged = copy.deepcopy(defaults)
            merged.update(existing)
            normalized['requirements'] = merged
    return normalized


def _normalize_requirement_term_key(value):
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def _normalize_wrapper_affix_value(value):
    return re.sub(r"\s+", " ", str(value or "").replace("\r", " ").replace("\n", " ").strip())


def _validate_h3_calibration(value):
    if not isinstance(value, dict):
        raise ValueError("Config.training.h3_calibration must be an object.")
    if int(value.get("version") or 0) != 1:
        raise ValueError("Config.training.h3_calibration.version must be 1.")
    campaign = str(value.get("campaign") or "").strip()
    if not campaign:
        raise ValueError("Config.training.h3_calibration.campaign is required.")
    source_shapes = value.get("safe_shapes")
    if not isinstance(source_shapes, dict):
        raise ValueError("Config.training.h3_calibration.safe_shapes must be an object.")
    safe_shapes = {}
    for raw_frames, by_aspect in source_shapes.items():
        frames = str(raw_frames)
        if frames not in H3_CALIBRATION_FRAMES:
            raise ValueError("Config.training.h3_calibration.safe_shapes has an unsupported frame count: " + frames)
        if not isinstance(by_aspect, dict):
            raise ValueError("Each Config.training.h3_calibration.safe_shapes entry must be an object.")
        normalized_aspects = {}
        for aspect, raw_shape in by_aspect.items():
            aspect = str(aspect)
            if aspect not in H3_CALIBRATION_ASPECTS:
                raise ValueError("Config.training.h3_calibration.safe_shapes has an unsupported aspect: " + aspect)
            if not isinstance(raw_shape, list) or len(raw_shape) != 2:
                raise ValueError("Each calibrated H3 shape must be a two-value array.")
            try:
                width, height = (int(raw_shape[0]), int(raw_shape[1]))
            except (TypeError, ValueError):
                raise ValueError("Each calibrated H3 shape must contain integer dimensions.")
            if width <= 0 or height <= 0 or width % 32 or height % 32:
                raise ValueError("Each calibrated H3 shape must use positive dimensions divisible by 32.")
            if aspect == "square" and width != height:
                raise ValueError("A calibrated square H3 shape must have equal dimensions.")
            if aspect in ("169", "43") and width <= height:
                raise ValueError("A calibrated landscape H3 shape must be wider than tall.")
            normalized_aspects[aspect] = [width, height]
        safe_shapes[frames] = normalized_aspects
    return {"version": 1, "campaign": campaign, "safe_shapes": safe_shapes}


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
    for key in ("diffusion_pipe_wsl", "activate_script", "wsl_distribution", "conda_executable", "conda_environment"):
        if key in training:
            normalized_training[key] = str(training.get(key) or "").strip()
    tensorboard_port = training.get("tensorboard_port", 6006)
    if isinstance(tensorboard_port, bool) or isinstance(tensorboard_port, float):
        raise ValueError("Config.training.tensorboard_port must be an integer from 1 to 65535.")
    if isinstance(tensorboard_port, str) and not re.fullmatch(r"\d+", tensorboard_port.strip()):
        raise ValueError("Config.training.tensorboard_port must be an integer from 1 to 65535.")
    try:
        tensorboard_port = int(tensorboard_port)
    except (TypeError, ValueError):
        raise ValueError("Config.training.tensorboard_port must be an integer from 1 to 65535.")
    if tensorboard_port < 1 or tensorboard_port > 65535:
        raise ValueError("Config.training.tensorboard_port must be an integer from 1 to 65535.")
    normalized_training["tensorboard_port"] = tensorboard_port
    tensorboard_control = training.get("tensorboard_bruteforce_control", False)
    if not isinstance(tensorboard_control, bool):
        raise ValueError("Config.training.tensorboard_bruteforce_control must be true or false.")
    normalized_training["tensorboard_bruteforce_control"] = tensorboard_control
    enabled_profiles = training.get("enabled_profiles", list(PROFILE_IDS))
    if not isinstance(enabled_profiles, list):
        raise ValueError("Config.training.enabled_profiles must be an array.")
    normalized_enabled_profiles = []
    for raw_profile_id in enabled_profiles:
        profile_id = str(raw_profile_id or "").strip().lower()
        if profile_id not in PROFILE_IDS:
            raise ValueError("Unknown training profile in Config.training.enabled_profiles: " + profile_id)
        if profile_id not in normalized_enabled_profiles:
            normalized_enabled_profiles.append(profile_id)
    if not normalized_enabled_profiles:
        raise ValueError("At least one training profile must be enabled.")
    normalized_training["enabled_profiles"] = normalized_enabled_profiles
    if "h3_calibration" in training:
        normalized_training["h3_calibration"] = _validate_h3_calibration(training["h3_calibration"])
    if normalized_training:
        out["training"] = normalized_training
    elif "training" in out:
        out["training"] = {}

    analysis = out.get("analysis")
    if analysis is None:
        analysis = {}
    if not isinstance(analysis, dict):
        raise ValueError("Config.analysis must be an object when provided.")
    out["analysis"] = {
        "enableFaceAnalysis": bool(analysis.get("enableFaceAnalysis", False)),
        "enableMediaPipeAnalysis": bool(analysis.get("enableMediaPipeAnalysis", False)),
    }

    primer = out.get("primer")
    if primer is None:
        primer = {}
    if not isinstance(primer, dict):
        raise ValueError("Config.primer must be an object when provided.")
    out["primer"] = {
        "template": str(primer.get("template") or "").replace("\r\n", "\n"),
    }

    requirements = out.get("requirements")
    if requirements is not None and not isinstance(requirements, dict):
        raise ValueError("Config.requirements must be an object when provided.")
    if isinstance(requirements, dict):
        wrappers = requirements.get("termWrappersByTerm")
        prefixes = requirements.get("termWrapperPrefixesByTerm")
        if wrappers is not None and not isinstance(wrappers, dict):
            raise ValueError("Config.requirements.termWrappersByTerm must be an object when provided.")
        if prefixes is not None and not isinstance(prefixes, dict):
            raise ValueError("Config.requirements.termWrapperPrefixesByTerm must be an object when provided.")
        clean_wrappers = {}
        if isinstance(prefixes, dict):
            for raw_term, raw_prefix in prefixes.items():
                term_key = _normalize_requirement_term_key(raw_term)
                prefix_value = _normalize_wrapper_affix_value(raw_prefix)
                if not term_key or not prefix_value:
                    continue
                clean_wrappers[term_key] = {
                    "prefix": prefix_value,
                    "suffix": "",
                }
        if isinstance(wrappers, dict):
            for raw_term, raw_wrapper in wrappers.items():
                term_key = _normalize_requirement_term_key(raw_term)
                if not term_key:
                    continue
                if not isinstance(raw_wrapper, dict):
                    raise ValueError("Each Config.requirements.termWrappersByTerm entry must be an object.")
                prefix_value = _normalize_wrapper_affix_value(raw_wrapper.get("prefix"))
                suffix_value = _normalize_wrapper_affix_value(raw_wrapper.get("suffix"))
                if not prefix_value and not suffix_value:
                    clean_wrappers.pop(term_key, None)
                    continue
                clean_wrappers[term_key] = {
                    "prefix": prefix_value,
                    "suffix": suffix_value,
                }
        out["requirements"]["termWrappersByTerm"] = clean_wrappers
        out["requirements"].pop("termWrapperPrefixesByTerm", None)

    return out

def load_config_from_disk():
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        raw = json.load(f)
    return apply_requirement_defaults(validate_config_payload(raw))


def save_config_to_disk(payload):
    normalized = apply_requirement_defaults(validate_config_payload(payload))
    temporary = CONFIG_PATH.with_suffix(CONFIG_PATH.suffix + ".tmp")
    with open(temporary, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, indent=2)
        f.write("\n")
    os.replace(temporary, CONFIG_PATH)
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
    normalize_path_permissions(file_path)
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
