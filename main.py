
import os
import json
import base64
import sys
import platform
from flask import Flask, render_template, request, send_from_directory, jsonify, send_file

app = Flask(__name__, static_folder='static', template_folder='templates')

# --- Generic File I/O API (for feature parity with Tauri) ---
@app.route('/api/file_io', methods=['POST'])
def api_file_io():
    data = request.get_json(force=True)
    op = data.get('op')
    data_path = data.get('dataPath')
    rel_path = data.get('relPath')
    payload = data.get('payload')
    if not (op and data_path and rel_path is not None):
        return ("Missing required parameters", 400)

    # Security: prevent path traversal
    if '..' in rel_path or rel_path.startswith(('/', '\\')):
        return ("Invalid relPath", 400)

    abs_base = os.path.abspath(data_path)
    abs_path = os.path.abspath(os.path.join(abs_base, rel_path))

    import os
    import json
    import shutil
    import pywebview

    DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
    MEDIA_DIR = os.path.join(DATA_DIR, 'media')
    PAGES_DIR = os.path.join(DATA_DIR, 'pages')
    TAGS_FILE = os.path.join(DATA_DIR, 'tags.json')
    CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

    def atomic_write(path, data):
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(data)
        os.replace(tmp, path)

    class PythonBridge:
        def _error(self, msg, exc=None):
            return {'ok': False, 'error': msg, 'exception': str(exc) if exc else None}

        def _ok(self, data=None):
            return {'ok': True, 'data': data}

        # --- Config ---
        def get_config(self):
            try:
                if not os.path.exists(CONFIG_FILE):
                    return self._ok({})
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    return self._ok(json.load(f))
            except Exception as e:
                return self._error('Failed to load config', e)

        def save_config(self, config):
            try:
                atomic_write(CONFIG_FILE, json.dumps(config, indent=2, ensure_ascii=False))
                return self._ok()
            except Exception as e:
                return self._error('Failed to save config', e)

        # --- Tags ---
        def get_tags(self):
            try:
                if not os.path.exists(TAGS_FILE):
                    return self._ok([])
                with open(TAGS_FILE, 'r', encoding='utf-8') as f:
                    return self._ok(json.load(f))
            except Exception as e:
                return self._error('Failed to load tags', e)

        def save_tags(self, tags):
            try:
                atomic_write(TAGS_FILE, json.dumps(tags, indent=2, ensure_ascii=False))
                return self._ok()
            except Exception as e:
                return self._error('Failed to save tags', e)

        # --- Pages ---
        def list_pages(self):
            try:
                if not os.path.exists(PAGES_DIR):
                    os.makedirs(PAGES_DIR)
                pages = []
                for fname in os.listdir(PAGES_DIR):
                    if fname.endswith('.json'):
                        with open(os.path.join(PAGES_DIR, fname), 'r', encoding='utf-8') as f:
                            pages.append(json.load(f))
                return self._ok(pages)
            except Exception as e:
                return self._error('Failed to list pages', e)

        def save_page(self, page):
            try:
                if 'id' not in page:
                    return self._error('Page missing id')
                path = os.path.join(PAGES_DIR, f"{page['id']}.json")
                atomic_write(path, json.dumps(page, indent=2, ensure_ascii=False))
                return self._ok()
            except Exception as e:
                return self._error('Failed to save page', e)

        def delete_page(self, page_id):
            try:
                path = os.path.join(PAGES_DIR, f"{page_id}.json")
                if os.path.exists(path):
                    os.remove(path)
                return self._ok()
            except Exception as e:
                return self._error('Failed to delete page', e)

        # --- Media ---
        def list_media(self):
            try:
                if not os.path.exists(MEDIA_DIR):
                    os.makedirs(MEDIA_DIR)
                media = []
                for fname in os.listdir(MEDIA_DIR):
                    fpath = os.path.join(MEDIA_DIR, fname)
                    if os.path.isfile(fpath):
                        media.append({'filename': fname, 'size': os.path.getsize(fpath)})
                return self._ok(media)
            except Exception as e:
                return self._error('Failed to list media', e)

        def delete_media(self, filename):
            try:
                fpath = os.path.join(MEDIA_DIR, filename)
                if os.path.exists(fpath):
                    os.remove(fpath)
                return self._ok()
            except Exception as e:
                return self._error('Failed to delete media', e)

        # --- Utility ---
        def ping(self):
            return self._ok('pong')

    def start():
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR)
        if not os.path.exists(MEDIA_DIR):
            os.makedirs(MEDIA_DIR)
        if not os.path.exists(PAGES_DIR):
            os.makedirs(PAGES_DIR)
        window = pywebview.create_window(
            'MediaWeb',
            url=os.path.abspath(os.path.join(os.path.dirname(__file__), '../frontend/index.html')),
            js_api=PythonBridge(),
            width=1200,
            height=800,
            min_size=(800, 600),
            confirm_close=True
        )
        pywebview.start(debug=True)

    if __name__ == '__main__':
        start()
    # Optionally move meta sidecar
