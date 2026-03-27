from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
PAGES_DIR = ROOT / 'pages'
TEMPLATES_DIR = ROOT / 'templates'


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_text(path: Path) -> str:
    return path.read_text(encoding='utf-8')


def write_text(path: Path, content: str) -> None:
    ensure_dir(path.parent)
    path.write_text(content, encoding='utf-8')


def list_page_names():
    ensure_dir(PAGES_DIR)
    return sorted([p.name for p in PAGES_DIR.iterdir() if p.is_dir() and (p / 'index.html').exists()])


def copy_tree(src: Path, dst: Path) -> None:
    shutil.copytree(src, dst)
