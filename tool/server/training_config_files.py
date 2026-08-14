import re
from pathlib import Path

from . import config as app_config
from .originals import MEDIA_ALL_EXTS
from .permissions import normalize_path_permissions
from .training_profiles import profile_config_files

ROOT = Path(__file__).resolve().parents[2]
TRAINING_TEMPLATES_DIR = ROOT / "tool" / "templates"
HI_CONFIG_NAME = "config.hi.toml"
LO_CONFIG_NAME = "config.lo.toml"
KREA2_CONFIG_NAME = "config.krea2.toml"
WAN21_CONFIG_NAME = "config.wan21.toml"
H3_CONFIG_NAME = "config.h3.toml"
TRAINING_CONFIG_TEMPLATE_NAMES = (HI_CONFIG_NAME, LO_CONFIG_NAME, KREA2_CONFIG_NAME, WAN21_CONFIG_NAME, H3_CONFIG_NAME)

_EPOCHS_TEXT_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_OUTPUT_DIR_TEXT_PATTERN = re.compile(r'^\s*output_dir\s*=\s*["\']([^"\']+)["\']\s*(?:#.*)?$', re.MULTILINE)
_OUTPUT_DIR_LINE_PATTERN = re.compile(r'^\s*output_dir\s*=\s*["\'][^"\']+["\']\s*(?:#.*)?$', re.MULTILINE)
_OUTPUT_PREFIX_PATTERN = re.compile(r"^(\d{3})-")

# Last-resort values only if a canonical template is missing or malformed.
_FALLBACK_HI_EPOCHS = 50
_FALLBACK_LO_EPOCHS = 90


def _fallback_epochs_for_template(name: str):
    if name == HI_CONFIG_NAME:
        return _FALLBACK_HI_EPOCHS
    if name in (LO_CONFIG_NAME, KREA2_CONFIG_NAME, WAN21_CONFIG_NAME, H3_CONFIG_NAME):
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


def training_config_path(folder_path: Path, stage: str):
    stage = str(stage or "").strip().lower()
    if stage == "hi":
        return Path(folder_path) / HI_CONFIG_NAME
    if stage == "lo":
        return Path(folder_path) / LO_CONFIG_NAME
    if stage == "krea2":
        return Path(folder_path) / KREA2_CONFIG_NAME
    if stage == "wan21":
        return Path(folder_path) / WAN21_CONFIG_NAME
    if stage == "h3":
        return Path(folder_path) / H3_CONFIG_NAME
    raise ValueError("Unknown training configuration stage: " + stage)


def output_dir_from_config(folder_path: Path, stage: str):
    config_path = training_config_path(folder_path, stage)
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
    replacement = 'output_dir = "' + str(output_dir).replace("\\", "/") + '"'
    updated, count = _OUTPUT_DIR_LINE_PATTERN.subn(replacement, config_text, count=1)
    if count != 1:
        raise ValueError("Training config template is missing output_dir.")
    return updated


def ensure_training_config_files(folder_path: Path, profile_id=None, reset=False):
    """Create missing per-set configs, or explicitly reset one profile's files."""
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return []
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return []

    selected_names = profile_config_files(profile_id) if profile_id else TRAINING_CONFIG_TEMPLATE_NAMES
    written = []
    for name in selected_names:
        dest = folder / name
        if dest.exists() and not reset:
            continue
        rendered = render_training_config_template(name, folder)
        dest.write_text(rendered, encoding="utf-8")
        normalize_path_permissions(dest)
        written.append(dest)
    return written


def reset_training_config_file(folder_path: Path, filename: str):
    """Explicitly restore one config from its resolved template."""
    folder = Path(folder_path)
    name = str(filename or "").strip()
    if name not in TRAINING_CONFIG_TEMPLATE_NAMES:
        raise ValueError("Unknown training config: " + name)
    destination = folder / name
    rendered = render_training_config_template(name, folder)
    destination.write_text(rendered, encoding="utf-8")
    normalize_path_permissions(destination)
    return destination
