from pathlib import Path
import subprocess
import sys
from flask import Flask, jsonify, request, send_from_directory
from page_ops import create_page, load_page, save_page, list_pages
from media_ops import save_media
from caption_ops import list_media_files, load_caption_text, save_caption_text, serve_media_file

ROOT = Path(__file__).resolve().parents[2]
TOOL_DIR = ROOT / 'tool'
JS_DIR = TOOL_DIR / 'js'
CSS_DIR = TOOL_DIR / 'css'
TEMPLATES_DIR = TOOL_DIR / 'templates'


app = Flask(__name__, static_folder=None)


def resolve_python_executable():
    venv_windows = ROOT / '.venv' / 'Scripts' / 'python.exe'
    if venv_windows.exists():
        return str(venv_windows)

    venv_posix = ROOT / '.venv' / 'bin' / 'python'
    if venv_posix.exists():
        return str(venv_posix)

    return sys.executable


@app.route('/')
def index():
    return send_from_directory(TOOL_DIR, 'tool.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    if filename.startswith('js/'):
        return send_from_directory(JS_DIR, filename[3:])
    if filename.startswith('css/'):
        return send_from_directory(CSS_DIR, filename[4:])
    if filename.startswith('templates/'):
        return send_from_directory(TEMPLATES_DIR, filename[10:])
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


@app.route('/caption/list', methods=['GET'])
def caption_list_route():
    folder = request.args.get('folder', '')
    try:
        files = list_media_files(folder)
        return jsonify({'files': files})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/caption/load', methods=['GET'])
def caption_load_route():
    folder = request.args.get('folder', '')
    media = request.args.get('media', '')
    try:
        return jsonify(load_caption_text(folder, media))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/caption/save', methods=['POST'])
def caption_save_route():
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(save_caption_text(
            data.get('folder', ''),
            data.get('media', ''),
            data.get('text', '')
        ))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/caption/media', methods=['GET'])
def caption_media_route():
    folder = request.args.get('folder', '')
    media = request.args.get('media', '')
    try:
        return serve_media_file(folder, media)
    except FileNotFoundError as exc:
        return jsonify({'error': str(exc)}), 404
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/caption/run_autoset', methods=['POST'])
def caption_run_autoset_route():
    data = request.get_json(silent=True) or {}
    master = str(data.get('master') or '.').strip() or '.'

    script_path = ROOT / 'scripts' / 'autoset.py'
    if not script_path.exists():
        return jsonify({'error': f'Autoset script not found: {script_path.as_posix()}'}), 404

    python_executable = resolve_python_executable()
    cmd = [python_executable, str(script_path), '--master', master]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=3600,
            check=False
        )
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Autoset timed out after 3600s'}), 408
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500

    combined = ''
    if proc.stdout:
        combined += proc.stdout
    if proc.stderr:
        if combined:
            combined += '\n'
        combined += proc.stderr

    payload = {
        'ok': proc.returncode == 0,
        'returncode': proc.returncode,
        'python': python_executable,
        'command': ' '.join(cmd),
        'output': combined.strip() or '(no output)'
    }

    if proc.returncode != 0:
        payload['error'] = 'Autoset failed with return code ' + str(proc.returncode)
        return jsonify(payload), 400
    return jsonify(payload)

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False, use_reloader=False)
