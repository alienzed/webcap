import json
import math
import re
import tomllib
from pathlib import Path

from . import config as app_config
from .originals import MEDIA_ALL_EXTS
from .permissions import normalize_path_permissions
from .training_profiles import (
    KREA2_PROFILE_ID,
    MINIMAX_H3_PROFILE_ID,
    TRAINING_MODES,
    WAN21_PROFILE_ID,
    WAN22_PROFILE_ID,
    config_for_stage,
    normalize_mode,
    profile,
)

ROOT = Path(__file__).resolve().parents[2]
TRAINING_TEMPLATES_DIR = ROOT / "tool" / "templates"
HI_CONFIG_NAME = "config.hi.toml"
LO_CONFIG_NAME = "config.lo.toml"
KREA2_CONFIG_NAME = "config.krea2.toml"
WAN21_CONFIG_NAME = "config.wan21.toml"
H3_CONFIG_NAME = "config.h3.toml"
LEGACY_TRAINING_CONFIG_TEMPLATE_NAMES = (
    HI_CONFIG_NAME,
    LO_CONFIG_NAME,
    KREA2_CONFIG_NAME,
    WAN21_CONFIG_NAME,
    H3_CONFIG_NAME,
)
MODE_TRAINING_CONFIG_TEMPLATE_NAMES = tuple(
    config_for_stage(profile_id, stage, mode)["file"]
    for profile_id, stage in (
        (WAN22_PROFILE_ID, "hi"),
        (WAN22_PROFILE_ID, "lo"),
        (KREA2_PROFILE_ID, "krea2"),
        (WAN21_PROFILE_ID, "wan21"),
        (MINIMAX_H3_PROFILE_ID, "h3"),
    )
    for mode in TRAINING_MODES
)
TRAINING_CONFIG_TEMPLATE_NAMES = (
    LEGACY_TRAINING_CONFIG_TEMPLATE_NAMES + MODE_TRAINING_CONFIG_TEMPLATE_NAMES
)

_EPOCHS_TEXT_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_OUTPUT_DIR_TEXT_PATTERN = re.compile(r'^\s*output_dir\s*=\s*["\']([^"\']+)["\']\s*(?:#.*)?$', re.MULTILINE)
_OUTPUT_DIR_LINE_PATTERN = re.compile(r'^(\s*output_dir\s*=\s*)["\'][^"\']+["\'](\s*(?:#.*)?)$', re.MULTILINE)
_DATASET_LINE_PATTERN = re.compile(r'^(\s*dataset\s*=\s*)["\'][^"\']+["\'](\s*(?:#.*)?)$', re.MULTILINE)
_OUTPUT_PREFIX_PATTERN = re.compile(r"^(\d{3})-")
_TABLE_PATTERN = re.compile(r"^\s*\[([^\]]+)\]\s*(?:#.*)?$", re.MULTILINE)

# Last-resort values only if a canonical template is missing or malformed.
_FALLBACK_HI_EPOCHS = 50
_FALLBACK_LO_EPOCHS = 90


def _fallback_epochs_for_template(name: str):
    if name == HI_CONFIG_NAME or name.endswith(".hi.toml"):
        return _FALLBACK_HI_EPOCHS
    if name in TRAINING_CONFIG_TEMPLATE_NAMES:
        return _FALLBACK_LO_EPOCHS
    raise ValueError(f"Unknown training config template: {name}")


def training_config_template_path(name: str):
    if name not in TRAINING_CONFIG_TEMPLATE_NAMES:
        raise ValueError(f"Unknown training config template: {name}")
    return TRAINING_TEMPLATES_DIR / name


def read_training_config_template(name: str):
    return training_config_template_path(name).read_text(encoding="utf-8")


def read_template_epochs(name: str):
    fallback = _fallback_epochs_for_template(name)
    try:
        text = read_training_config_template(name)
    except OSError:
        return fallback
    match = _EPOCHS_TEXT_PATTERN.search(text)
    if not match:
        return fallback
    return max(1, int(match.group(1)))


def default_training_config_epochs():
    return (
        read_template_epochs(HI_CONFIG_NAME),
        read_template_epochs(LO_CONFIG_NAME),
    )


def render_training_config_template(name: str, folder_path: Path):
    template_text = read_training_config_template(name).replace("{SET_NAME}", Path(folder_path).name)
    try:
        dataset_rel = folder_path.relative_to(app_config.FS_ROOT).as_posix()
    except Exception:
        dataset_rel = folder_path.name
    try:
        return app_config.fill_template_placeholders(template_text, dataset_rel)
    except Exception:
        return template_text


def _profile_for_stage(stage):
    stage = str(stage or "").strip().lower()
    if stage in ("hi", "lo"):
        return WAN22_PROFILE_ID
    if stage == "krea2":
        return KREA2_PROFILE_ID
    if stage == "wan21":
        return WAN21_PROFILE_ID
    if stage == "h3":
        return MINIMAX_H3_PROFILE_ID
    raise ValueError("Unknown training configuration stage: " + stage)


def training_config_path(folder_path: Path, stage: str, profile_id=None, mode="normal"):
    if profile_id is None:
        legacy_name = {
            "hi": HI_CONFIG_NAME,
            "lo": LO_CONFIG_NAME,
            "krea2": KREA2_CONFIG_NAME,
            "wan21": WAN21_CONFIG_NAME,
            "h3": H3_CONFIG_NAME,
        }.get(str(stage or "").strip().lower())
        legacy_path = Path(folder_path) / str(legacy_name or "")
        if legacy_name and legacy_path.is_file():
            return legacy_path
    selected_profile = profile_id or _profile_for_stage(stage)
    return Path(folder_path) / config_for_stage(selected_profile, stage, mode)["file"]


def output_dir_from_config(folder_path: Path, stage: str, profile_id=None, mode="normal"):
    config_path = training_config_path(folder_path, stage, profile_id=profile_id, mode=mode)
    try:
        config_text = config_path.read_text(encoding="utf-8")
    except OSError:
        return None
    match = _OUTPUT_DIR_TEXT_PATTERN.search(config_text)
    if not match:
        return None
    return Path(match.group(1).strip())


def _decimal_prefix(value):
    if value < 1 or value > 999:
        raise RuntimeError("Training output sequence is exhausted at 999.")
    return f"{value:03d}"


def allocate_training_launch_group(folder_path: Path):
    """Reserve one never-reused three-digit launch identity."""
    root = Path(app_config.FS_ROOT) / "output" / "runs"
    root.mkdir(parents=True, exist_ok=True)
    normalize_path_permissions(root)
    highest = 0
    try:
        entries = list(root.iterdir())
    except OSError as exc:
        raise RuntimeError("Could not inspect training output folders: " + str(exc)) from exc
    for entry in entries:
        if not entry.is_dir():
            continue
        match = _OUTPUT_PREFIX_PATTERN.match(entry.name)
        if match:
            highest = max(highest, int(match.group(1)))
    prefix = _decimal_prefix(highest + 1)
    output_dir = root / (prefix + "-" + Path(folder_path).name)
    output_dir.mkdir(exist_ok=False)
    normalize_path_permissions(output_dir)
    return output_dir


def with_output_dir(config_text: str, output_dir):
    replacement = r'\g<1>"' + str(output_dir).replace("\\", "/") + r'"\g<2>'
    updated, count = _OUTPUT_DIR_LINE_PATTERN.subn(replacement, config_text, count=1)
    if count != 1:
        raise ValueError("Training config template is missing output_dir.")
    return updated


def with_dataset_path(config_text: str, dataset_path):
    replacement = r'\g<1>"' + str(dataset_path).replace("\\", "/") + r'"\g<2>'
    updated, count = _DATASET_LINE_PATTERN.subn(replacement, config_text, count=1)
    if count != 1:
        raise ValueError("Training config template is missing dataset.")
    return updated


def _toml_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " must be a finite number.") from exc
    if not math.isfinite(number) or number <= 0:
        raise ValueError(label + " must be a positive finite number.")
    return format(number, ".12g")


def _toml_positive_int(value, label):
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(label + " must be a positive integer.") from exc
    if number <= 0:
        raise ValueError(label + " must be a positive integer.")
    return str(number)


def rewrite_toml_assignment(text, key, value=None, section=""):
    """Replace one owned assignment while preserving all unrelated TOML text."""
    table = str(section or "").strip()
    key_pattern = re.compile(r"^(\s*" + re.escape(key) + r"\s*=\s*)([^\n]*)(\n?)$", re.MULTILINE)
    matches = list(_TABLE_PATTERN.finditer(text))
    start = 0
    end = len(text)
    if table:
        target = next((item for item in matches if item.group(1).strip() == table), None)
        if target is None:
            suffix = "" if text.endswith("\n") else "\n"
            rendered = suffix + "[" + table + "]\n"
            if value is not None:
                rendered += key + " = " + str(value) + "\n"
            return text + rendered
        start = target.end()
        following = next((item for item in matches if item.start() >= start), None)
        end = following.start() if following is not None else len(text)
    else:
        end = matches[0].start() if matches else len(text)
    chunk = text[start:end]
    match = key_pattern.search(chunk)
    if match is not None:
        if value is None:
            chunk = chunk[:match.start()] + chunk[match.end():]
        else:
            newline = match.group(3) or "\n"
            chunk = chunk[:match.start()] + match.group(1) + str(value) + newline + chunk[match.end():]
        return text[:start] + chunk + text[end:]
    if value is None:
        return text
    insertion = key + " = " + str(value) + "\n"
    return text[:end] + ("" if text[:end].endswith("\n") else "\n") + insertion + text[end:]


def apply_review_config_settings(config_text, settings):
    """Apply the small, user-facing Training Review config surface.

    Values are deliberately limited to known scalar keys. This is not a TOML
    editor and never accepts a raw fragment or a caller-selected table path.
    """
    source = str(config_text or "")
    data = settings if isinstance(settings, dict) else {}
    if "optimizerLr" in data:
        source = rewrite_toml_assignment(source, "lr", _toml_number(data["optimizerLr"], "Optimizer LR"), "optimizer")
    if "adapterRank" in data:
        source = rewrite_toml_assignment(source, "rank", _toml_positive_int(data["adapterRank"], "LoRA rank"), "adapter")
    if "adapterDropout" in data:
        raw_dropout = data["adapterDropout"]
        if raw_dropout in (None, ""):
            source = rewrite_toml_assignment(source, "dropout", None, "adapter")
        else:
            try:
                dropout = float(raw_dropout)
            except (TypeError, ValueError) as exc:
                raise ValueError("LoRA dropout must be a number from 0 to 1.") from exc
            if not math.isfinite(dropout) or dropout < 0 or dropout > 1:
                raise ValueError("LoRA dropout must be a number from 0 to 1.")
            source = rewrite_toml_assignment(source, "dropout", format(dropout, ".12g"), "adapter")
    if "forceConstantLr" in data:
        raw_constant = data["forceConstantLr"]
        source = rewrite_toml_assignment(
            source,
            "force_constant_lr",
            None if raw_constant in (None, "", False) else _toml_number(raw_constant, "Constant LR"),
        )
    try:
        tomllib.loads(source)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError("Training Review produced invalid TOML: " + str(exc)) from exc
    return source


def apply_captured_initializer(config_text, initializer_dir, force_constant_lr=None):
    """Write run-only LoRA lineage into a captured config, never a set TOML."""
    source = rewrite_toml_assignment(str(config_text or ""), "init_from_existing", json.dumps(str(initializer_dir).replace("\\", "/")), "adapter")
    if force_constant_lr not in (None, ""):
        source = rewrite_toml_assignment(source, "force_constant_lr", _toml_number(force_constant_lr, "Constant LR"))
    try:
        tomllib.loads(source)
    except tomllib.TOMLDecodeError as exc:
        raise ValueError("Captured initializer config is invalid: " + str(exc)) from exc
    return source


def _render_mode_config(folder, profile_id, stage, mode, reset=False):
    selected_mode = normalize_mode(mode)
    config = config_for_stage(profile_id, stage, selected_mode)
    destination = folder / config["file"]
    if selected_mode == "normal":
        legacy = folder / config["legacyFile"]
        if legacy.is_file() and not reset:
            text = legacy.read_text(encoding="utf-8")
        else:
            text = render_training_config_template(config["file"], folder)
    else:
        text = render_training_config_template(config["file"], folder)
    dataset_value = None
    match = _DATASET_LINE_PATTERN.search(text)
    if match:
        current = match.group(0)
        quoted = re.search(r'["\']([^"\']+)["\']', current)
        if quoted:
            dataset_value = str(Path(quoted.group(1)).with_name(config["dataset"])).replace("\\", "/")
    if dataset_value is None:
        dataset_value = config["dataset"]
    return with_dataset_path(text, dataset_value)


def ensure_training_config_files(folder_path: Path, profile_id=None, mode=None, reset=False):
    """Create missing per-set configs, or explicitly reset one profile's files."""
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return []
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return []

    if mode is None:
        selected_profiles = [profile(profile_id)] if profile_id else [
            profile(WAN22_PROFILE_ID),
            profile(KREA2_PROFILE_ID),
            profile(WAN21_PROFILE_ID),
            profile(MINIMAX_H3_PROFILE_ID),
        ]
        written = []
        for selected_profile in selected_profiles:
            for base in selected_profile["configs"]:
                destination = folder / base["file"]
                if destination.exists() and not reset:
                    continue
                destination.write_text(render_training_config_template(base["file"], folder), encoding="utf-8")
                normalize_path_permissions(destination)
                written.append(destination)
        return written

    selected_profile = profile(profile_id or WAN22_PROFILE_ID)
    written = []
    for base in selected_profile["configs"]:
        resolved = config_for_stage(selected_profile["id"], base["id"], mode)
        dest = folder / resolved["file"]
        if dest.exists() and not reset:
            continue
        rendered = _render_mode_config(folder, selected_profile["id"], base["id"], mode, reset=reset)
        dest.write_text(rendered, encoding="utf-8")
        normalize_path_permissions(dest)
        written.append(dest)
    return written


def reset_training_config_file(folder_path: Path, filename: str, profile_id=None, mode=None):
    """Explicitly restore one config from its resolved template."""
    folder = Path(folder_path)
    name = str(filename or "").strip()
    if mode is None:
        if name not in TRAINING_CONFIG_TEMPLATE_NAMES:
            raise ValueError("Unknown training config: " + name)
        destination = folder / name
        destination.write_text(render_training_config_template(name, folder), encoding="utf-8")
        normalize_path_permissions(destination)
        return destination
    selected = profile(profile_id or WAN22_PROFILE_ID)
    matches = [config_for_stage(selected["id"], item["id"], mode) for item in selected["configs"]]
    resolved = next((item for item in matches if item["file"] == name), None)
    if resolved is None:
        raise ValueError("Unknown training config: " + name)
    destination = folder / name
    rendered = _render_mode_config(folder, selected["id"], resolved["id"], mode, reset=True)
    destination.write_text(rendered, encoding="utf-8")
    normalize_path_permissions(destination)
    return destination
