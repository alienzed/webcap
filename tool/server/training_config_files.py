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
    template_text = read_training_config_template(name)
    try:
        dataset_rel = folder_path.relative_to(app_config.FS_ROOT).as_posix()
    except Exception:
        dataset_rel = folder_path.name
    try:
        return app_config.fill_template_placeholders(template_text, dataset_rel)
    except Exception:
        return template_text


def ensure_training_config_files(folder_path: Path):
    folder = Path(folder_path)
    if folder.name in ("originals", "auto_dataset"):
        return []
    media_files = [f for f in folder.iterdir() if f.is_file() and f.suffix.lower() in MEDIA_ALL_EXTS]
    if not media_files:
        return []

    written = []
    for name in TRAINING_CONFIG_TEMPLATE_NAMES:
        dest = folder / name
        rendered = render_training_config_template(name, folder)
        dest.write_text(rendered, encoding="utf-8")
        normalize_path_permissions(dest)
        written.append(dest)
    return written
