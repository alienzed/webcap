import atexit
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PureWindowsPath

from . import config as app_config


LLAMA_HOST = "127.0.0.1"
DEFAULT_PORT = 8189
DEFAULT_CONTEXT_SIZE = 8192
DEFAULT_MAX_TOKENS = 4096
GPU_RESERVATION_OWNER = "storyboard-director"
COMFY_BASE_URL = "http://127.0.0.1:8188"

_process = None
_log_handle = None
_server_settings_signature = None
_process_lock = threading.RLock()
_request_lock = threading.Lock()


def _director_config():
    storyboard = app_config.config.get("storyboard")
    storyboard = storyboard if isinstance(storyboard, dict) else {}
    director = storyboard.get("director")
    director = director if isinstance(director, dict) else {}

    mode = str(director.get("mode") or "local").strip().lower()
    endpoint = str(director.get("endpoint") or "").strip().rstrip("/")
    executable = str(director.get("llama_server") or "").strip()
    port = int(director.get("port") or DEFAULT_PORT)
    context_size = int(director.get("context_size") or DEFAULT_CONTEXT_SIZE)
    max_tokens = int(director.get("max_tokens") or DEFAULT_MAX_TOKENS)

    if mode not in {"local", "remote"}:
        raise ValueError("Storyboard Director mode must be local or remote.")
    if max_tokens <= 0:
        raise ValueError("Storyboard Director max_tokens must be greater than zero.")

    models_dir = None
    if mode == "remote":
        if not endpoint:
            raise ValueError("Storyboard Director remote endpoint is required.")
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError("Storyboard Director remote endpoint must start with http:// or https://.")
    else:
        models_root = str(app_config.config.get("filesystem", {}).get("models") or "").strip()
        if not models_root:
            raise ValueError("WebCap Model Root is required for local Storyboard Director model discovery.")
        if models_root.startswith("/"):
            models_dir = Path(models_root) / "text_encoders"
        else:
            from .training_runtime import to_wsl_path
            distribution = str(app_config.config.get("training", {}).get("wsl_distribution") or "").strip()
            windows_models_dir = str(PureWindowsPath(models_root) / "text_encoders")
            models_dir = Path(to_wsl_path(windows_models_dir, distribution=distribution))
        if port <= 0 or port > 65535:
            raise ValueError("Storyboard Director llama.cpp port must be between 1 and 65535.")
        if context_size < 1024:
            raise ValueError("Storyboard Director context_size must be at least 1024.")

    return {
        "mode": mode,
        "endpoint": endpoint,
        "llama_server": executable,
        "models_dir": models_dir.expanduser() if models_dir is not None else None,
        "port": port,
        "context_size": context_size,
        "max_tokens": max_tokens,
    }


def _server_url(path):
    settings = _director_config()
    base = settings["endpoint"] if settings["mode"] == "remote" else "http://" + LLAMA_HOST + ":" + str(settings["port"])
    return base.rstrip("/") + "/" + str(path or "").lstrip("/")


def _runtime_dir():
    path = Path(app_config.FS_ROOT) / ".webcap_runtime" / "storyboard-director"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_executable():
    configured = _director_config()["llama_server"]
    if configured:
        path = Path(configured).expanduser()
        if not path.is_file():
            raise FileNotFoundError("Configured llama-server does not exist: " + str(path))
        return str(path)
    discovered = shutil.which("llama-server")
    if not discovered:
        raise FileNotFoundError(
            "llama-server was not found. Install a recent CUDA-enabled llama.cpp build "
            "or configure App Settings > Storyboard > llama-server executable."
        )
    return discovered


def _decode_error_body(exc):
    try:
        body = exc.read().decode("utf-8", errors="replace").strip()
    except Exception:
        body = ""
    if body:
        try:
            payload = json.loads(body)
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, dict) and error.get("message"):
                return str(error["message"])
        except (ValueError, TypeError):
            pass
        return body
    return str(exc)


def _http_json(path, method="GET", payload=None, timeout=30):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(_server_url(path), data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Storyboard Director endpoint request failed: " + _decode_error_body(exc)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError("Could not connect to the configured Storyboard Director endpoint.") from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Storyboard Director endpoint returned invalid JSON.") from exc


def _health_ok():
    try:
        payload = _http_json("/health", timeout=1)
    except Exception:
        return False
    return isinstance(payload, dict) and payload.get("status") == "ok"


def _log_tail():
    path = _runtime_dir() / "llama-server.log"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    return "\n".join(lines[-20:])


def _stop_server_locked():
    global _process, _log_handle, _server_settings_signature
    process = _process
    _process = None
    _server_settings_signature = None
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    if _log_handle is not None:
        try:
            _log_handle.close()
        finally:
            _log_handle = None


def stop_server():
    with _process_lock:
        _stop_server_locked()


def _server_signature(settings):
    return (
        str(settings["llama_server"]),
        str(settings["models_dir"]),
        int(settings["port"]),
        int(settings["context_size"]),
    )


def _ensure_server():
    global _process, _log_handle, _server_settings_signature
    with _process_lock:
        settings = _director_config()
        if settings["mode"] == "remote":
            if _process is not None:
                _stop_server_locked()
            try:
                _normalize_models(_http_json("/models", timeout=10))
            except Exception as exc:
                raise ConnectionError("Could not connect to the configured remote Storyboard Director endpoint.") from exc
            return

        desired_signature = _server_signature(settings)

        if _process is not None and _process.poll() is None:
            if _server_settings_signature == desired_signature and _health_ok():
                return
            _stop_server_locked()

        if _health_ok():
            try:
                _normalize_models(_http_json("/models", timeout=5))
            except Exception as exc:
                raise RuntimeError(
                    "The Storyboard Director port is already occupied by an incompatible service."
                ) from exc
            return

        models_dir = settings["models_dir"]
        models_dir.mkdir(parents=True, exist_ok=True)
        executable = _resolve_executable()
        log_path = _runtime_dir() / "llama-server.log"
        _log_handle = open(log_path, "a", encoding="utf-8")
        command = [
            executable,
            "--models-dir", str(models_dir),
            "--models-max", "1",
            "--no-models-autoload",
            "--host", LLAMA_HOST,
            "--port", str(settings["port"]),
            "--ctx-size", str(settings["context_size"]),
            "--n-gpu-layers", "all",
            "--parallel", "1",
            "--jinja",
            "--cache-prompt",
        ]
        try:
            _process = subprocess.Popen(
                command,
                stdout=_log_handle,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                close_fds=True,
            )
            _server_settings_signature = desired_signature
        except OSError:
            _stop_server_locked()
            raise

        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if _process.poll() is not None:
                tail = _log_tail()
                _stop_server_locked()
                raise RuntimeError(
                    "llama-server exited while starting."
                    + ("\n" + tail if tail else "")
                )
            if _health_ok():
                return
            time.sleep(0.2)

        _stop_server_locked()
        raise RuntimeError("llama-server did not become ready within 30 seconds.")


def _normalize_models(payload):
    raw_models = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(raw_models, list):
        raise RuntimeError("llama.cpp did not return a model list.")
    models = []
    for entry in raw_models:
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get("id") or "").strip()
        if not model_id:
            continue
        path = str(entry.get("path") or "").strip()
        status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
        models.append({
            "id": model_id,
            "label": Path(path or model_id).name,
            "path": path,
            "status": str(status.get("value") or ("remote" if not path else "unloaded")),
        })
    models.sort(key=lambda model: model["label"].casefold())
    return models


def list_models(reload=False):
    _ensure_server()
    settings = _director_config()
    suffix = "?reload=1" if reload and settings["mode"] == "local" else ""
    return _normalize_models(_http_json("/models" + suffix, timeout=10))


def status():
    settings = _director_config()
    try:
        models = list_models(reload=True)
        if settings["mode"] == "remote":
            return {
                "available": True,
                "serverRunning": True,
                "runtime": "Remote OpenAI-compatible",
                "endpoint": settings["endpoint"],
                "models": models,
            }

        executable = ""
        try:
            executable = _resolve_executable()
        except FileNotFoundError:
            if _process is not None:
                raise
        return {
            "available": True,
            "serverRunning": True,
            "runtime": "llama.cpp",
            "executable": executable,
            "modelsDir": str(settings["models_dir"]),
            "models": models,
        }
    except Exception as exc:
        return {
            "available": False,
            "serverRunning": False,
            "runtime": "Remote OpenAI-compatible" if settings["mode"] == "remote" else "llama.cpp",
            "endpoint": settings["endpoint"] if settings["mode"] == "remote" else "",
            "modelsDir": str(settings["models_dir"]) if settings["models_dir"] is not None else "",
            "models": [],
            "error": str(exc),
        }


def _model_record(model_id):
    model_id = str(model_id or "").strip()
    if not model_id:
        raise ValueError("Choose a Storyboard Director model.")
    models = list_models(reload=True)
    for model in models:
        if model["id"] == model_id:
            return model
    raise FileNotFoundError("Storyboard Director model is not available to llama.cpp: " + model_id)


def _wait_for_model(model_id, wanted, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for model in list_models(reload=False):
            if model["id"] != model_id:
                continue
            if model["status"] == wanted:
                return
            if model["status"] == "unloaded" and wanted == "loaded":
                break
        time.sleep(0.25)
    raise RuntimeError("Timed out waiting for llama.cpp model to become " + wanted + ": " + model_id)


def _load_model(model_id):
    response = _http_json("/models/load", method="POST", payload={"model": model_id}, timeout=180)
    if response.get("success") is not True:
        raise RuntimeError("llama.cpp did not load the selected Director model.")
    _wait_for_model(model_id, "loaded", timeout=180)


def _unload_model(model_id):
    response = _http_json("/models/unload", method="POST", payload={"model": model_id}, timeout=30)
    if response.get("success") is not True:
        raise RuntimeError("llama.cpp did not unload the selected Director model.")
    _wait_for_model(model_id, "unloaded", timeout=30)


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    if not reserve_gpu_for_external_work(GPU_RESERVATION_OWNER):
        raise RuntimeError("GPU is busy with Training, Test Generations, Storyboard generation, or another Director request.")


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _windows_curl_path():
    is_wsl = bool(os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME"))
    if not is_wsl:
        try:
            is_wsl = "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
        except OSError:
            is_wsl = False
    candidate = Path("/mnt/c/Windows/System32/curl.exe")
    return str(candidate) if is_wsl and candidate.is_file() else None


def _free_comfy_models():
    payload = json.dumps({"unload_models": True, "free_memory": True}).encode("utf-8")
    curl_path = _windows_curl_path()
    if curl_path:
        command = [
            curl_path,
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time", "5",
            "--request", "POST",
            "--header", "Content-Type: application/json",
            "--data-binary", "@-",
            COMFY_BASE_URL + "/free",
        ]
        result = subprocess.run(
            command,
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=8,
            check=False,
        )
        if result.returncode in (5, 6, 7, 28):
            return False
        if result.returncode != 0:
            detail = (
                result.stdout.decode("utf-8", errors="replace").strip()
                or result.stderr.decode("utf-8", errors="replace").strip()
            )
            raise RuntimeError("ComfyUI could not release cached models before Director inference: " + detail)
        return True

    request = urllib.request.Request(
        COMFY_BASE_URL + "/free",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5):
            return True
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            "ComfyUI could not release cached models before Director inference: " + _decode_error_body(exc)
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def _model_status(model_id):
    for model in list_models(reload=False):
        if model["id"] == model_id:
            return model["status"]
    return ""


def chat(model_id, messages, response_schema=None, max_tokens=None):
    if not isinstance(messages, list) or not messages:
        raise ValueError("Storyboard Director messages are required.")

    with _request_lock:
        _ensure_server()
        _model_record(model_id)
        settings = _director_config()
        payload = {
            "model": model_id,
            "messages": messages,
            "stream": False,
            "max_tokens": int(max_tokens or settings["max_tokens"]),
            "temperature": 0.2,
        }
        if settings["mode"] == "local":
            payload["reasoning_effort"] = "none"
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if response_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "storyboard_response",
                    "schema": response_schema,
                },
            }

        if settings["mode"] == "remote":
            response = _http_json(
                "/chat/completions",
                method="POST",
                payload=payload,
                timeout=10 * 60,
            )
            return _completion_result(response, model_id)

        _reserve_gpu()
        load_attempted = False
        cleanup_safe = True
        try:
            _free_comfy_models()
            load_attempted = True
            _load_model(model_id)
            response = _http_json(
                "/v1/chat/completions",
                method="POST",
                payload=payload,
                timeout=10 * 60,
            )
            return _completion_result(response, model_id)
        finally:
            cleanup_error = None
            if load_attempted:
                try:
                    if _model_status(model_id) != "unloaded":
                        _unload_model(model_id)
                except Exception as exc:
                    if _process is not None:
                        stop_server()
                    else:
                        cleanup_safe = False
                        cleanup_error = RuntimeError(
                            "Storyboard Director could not confirm that the selected model was unloaded "
                            "from an external llama.cpp router. The GPU reservation is being kept to avoid "
                            "colliding with Training or generation work. Stop/unload that router model, then "
                            "restart WebCap before using GPU work again."
                        )
                        cleanup_error.__cause__ = exc
            if cleanup_safe:
                _release_gpu()
            if cleanup_error is not None:
                raise cleanup_error


def _completion_result(response, model_id):
    choices = response.get("choices") if isinstance(response, dict) else None
    message = choices[0].get("message") if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None
    content = str(message.get("content") or "").strip() if isinstance(message, dict) else ""
    if not content:
        raise RuntimeError("Storyboard Director returned an empty response.")
    return {
        "text": content,
        "model": model_id,
        "usage": response.get("usage") if isinstance(response, dict) else None,
        "timings": response.get("timings") if isinstance(response, dict) else None,
    }


def run_contract(model_id, contract):
    if not isinstance(contract, dict):
        raise ValueError("Storyboard Director contract must be an object.")
    prompt = str(contract.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Storyboard Director contract prompt is empty.")
    result = chat(
        model_id,
        [{"role": "user", "content": prompt}],
        response_schema=contract.get("response_schema"),
    )
    if contract.get("output") == "json":
        try:
            data = json.loads(result["text"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Storyboard Director returned invalid structured JSON.") from exc
        if not isinstance(data, dict):
            raise RuntimeError("Storyboard Director structured output must be a JSON object.")
        result["data"] = data
    return result


atexit.register(stop_server)
