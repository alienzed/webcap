from pathlib import Path
import re
from file_ops import PAGES_DIR, TEMPLATES_DIR, ensure_dir, read_text, write_text, list_page_names, copy_tree


def normalize_page_name(name: str) -> str:
    name = (name or '').strip().lower()
    name = re.sub(r'[^a-z0-9]+', '-', name)
    name = re.sub(r'^-+|-+$', '', name)
    return name


def page_dir(page: str) -> Path:
    return PAGES_DIR / page


def page_html_path(page: str) -> Path:
    return page_dir(page) / 'index.html'


def create_page(page: str) -> str:
    page = normalize_page_name(page)
    if not page:
        raise ValueError('Invalid page name')
    target = page_dir(page)
    if target.exists():
        raise ValueError('Page already exists')
    template = TEMPLATES_DIR / 'default'
    if not template.exists():
        raise ValueError('Missing template')
    copy_tree(template, target)
    ensure_dir(target / 'media')
    html_path = page_html_path(page)
    html = read_text(html_path)
    html = html.replace('{{PAGE_NAME}}', page)
    write_text(html_path, html)
    return page


def load_page(page: str) -> str:
    path = page_html_path(page)
    return read_text(path)


def save_page(page: str, html: str) -> None:
    path = page_html_path(page)
    if not path.exists():
        raise FileNotFoundError('Page does not exist')
    write_text(path, html)


def list_pages():
    return list_page_names()
