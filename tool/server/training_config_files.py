import re
from pathlib import Path

from . import config as app_config
from .originals import MEDIA_ALL_EXTS
from .permissions import normalize_path_permissions

ROOT = Path(__file__).resolve().parents[2]
TRAINING_TEMPLATES_DIR = ROOT / "tool" / "templates"
HI_CONFIG_NAME = "config.hi.toml"
LO_CONFIG_NAME = "config.lo.toml"
TRAINING_CONFIG_TEMPLATE_NAMES = (HI_CONFIG_NAME, LO_CONFIG_NAME)

_EPOCHS_TEXT_PATTERN = re.compile(r"^\s*epochs\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_OUTPUT_DIR_TEXT_PATTERN = re.compile(r'^\s*output_dir\s*=\s*["\']([^"\']+)["\']\s*(?:#.*)?$', re.MULTILINE)
_OUTPUT_DIR_LINE_PATTERN = re.compile(r'^\s*output_dir\s*=\s*["\'][^"\']+["\']\s*(?:#.*)?$', re.MULTILINE)
_OUTPUT_PREFIX_PATTERN = re.compile(r"^([0-9A-Z]{2})-")
_BASE36_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Last-resort values only if a canonical template is missing or malformed.
_FALLBACK_HI_EPOCHS = 50
_FALLBACK_LO_EPOCHS = 90


def _fallback_epochs_for_template(name: str):
    if name == HI_CONFIG_NAME:
        return _FALLBACK_HI_EPOCHS
    if name == LO_CONFIG_NAME:
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
    raise ValueError("Training stage must be hi or lo.")


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


def _base36_prefix(value):
    if value < 1 or value >= len(_BASE36_DIGITS) ** 2:
        raise RuntimeError("Training output sequence is exhausted at ZZ.")
    return _BASE36_DIGITS[value // len(_BASE36_DIGITS)] + _BASE36_DIGITS[value % len(_BASE36_DIGITS)]


def _next_output_dir(folder_path: Path):
    root = Path(app_config.FS_ROOT) / "output" / "sets"
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
            highest = max(highest, int(match.group(1), 36))
    prefix = _base36_prefix(highest + 1)
    output_dir = root / (prefix + "-" + Path(folder_path).name)
    output_dir.mkdir(exist_ok=False)
    normalize_path_permissions(output_dir)
    return output_dir


def _with_output_dir(config_text: str, output_dir: Path):
    replacement = 'output_dir = "' + output_dir.as_posix() + '"'
    updated, count = _OUTPUT_DIR_LINE_PATTERN.subn(replacement, config_text, count=1)
    if count != 1:
        raise ValueError("Training config template is missing output_dir.")
    return updated


def ensure_training_config_files(folder_path: Path):
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return []
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return []

    existing_roots = {
        name: output_dir_from_config(folder, "hi" if name == HI_CONFIG_NAME else "lo")
        for name in TRAINING_CONFIG_TEMPLATE_NAMES
    }
    assigned_root = next((root for root in existing_roots.values() if root), None)
    if not assigned_root:
        assigned_root = _next_output_dir(folder)
    written = []
    for name in TRAINING_CONFIG_TEMPLATE_NAMES:
        dest = folder / name
        rendered = render_training_config_template(name, folder)
        rendered = _with_output_dir(rendered, existing_roots[name] or assigned_root)
        dest.write_text(rendered, encoding="utf-8")
        normalize_path_permissions(dest)
        written.append(dest)
    return written
