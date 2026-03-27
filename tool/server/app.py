from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from page_ops import create_page, load_page, save_page, list_pages
from media_ops import save_media

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / 'tool'
JS_DIR = TOOL_DIR / 'js'
CSS_DIR = TOOL_DIR / 'css'

app = Flask(__name__, static_folder=None)


@app.route('/')
def index():
    return send_from_directory(TOOL_DIR, 'tool.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    if filename.startswith('js/'):
        return send_from_directory(JS_DIR, filename[3:])
    if filename.startswith('css/'):
        return send_from_directory(CSS_DIR, filename[4:])
    return send_from_directory(TOOL_DIR, filename)


@app.route('/pages', methods=['GET'])
def pages_route():
    return jsonify(list_pages())

@app.route('/create', methods=['POST'])
def create_route():
    data = request.get_json(silent=True) or {}
    try:
        page = create_page(data.get('page', ''))
        return jsonify({'page': page})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/load', methods=['GET'])
def load_route():
    page = request.args.get('page', '')
    try:
        return load_page(page)
    except Exception as exc:
        return str(exc), 404


@app.route('/save', methods=['POST'])
def save_route():
    data = request.get_json(silent=True) or {}
    try:
        save_page(data.get('page', ''), data.get('html', ''))
        return jsonify({'ok': True})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/upload', methods=['POST'])
def upload_route():
    page = request.form.get('page', '')
    file = request.files.get('file')
    if file is None:
        return jsonify({'error': 'Missing file'}), 400
    try:
        filename = save_media(page, file)
        return jsonify({'filename': filename})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400
    

@app.route('/pages/<page>/media/<path:filename>')
def page_media(page, filename):
    return send_from_directory(ROOT / 'pages' / page / 'media', filename)

@app.route('/pages/<path:filename>')
def page_files(filename):
    return send_from_directory(ROOT / 'pages', filename)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
