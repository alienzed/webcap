import os
import sys
import subprocess
from flask import jsonify, request
from pathlib import Path

def open_containing_folder(path):
    folder = Path(path).resolve().parent
    if sys.platform.startswith('win'):
        os.startfile(str(folder))
    elif sys.platform.startswith('darwin'):
        subprocess.Popen(['open', str(folder)])
    else:
        subprocess.Popen(['xdg-open', str(folder)])

    return True

def register_open_folder_route(app):
    @app.route('/open_folder', methods=['POST'])
    def open_folder_route():
        data = request.get_json(silent=True) or {}
        path = data.get('path', '')
        if not path:
            return jsonify({'error': 'Missing path'}), 400
        try:
            open_containing_folder(path)
            return jsonify({'ok': True})
        except Exception as exc:
            return jsonify({'error': str(exc)}), 500
