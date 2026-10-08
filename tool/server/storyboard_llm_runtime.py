import atexit
import base64
import mimetypes
import contextlib
import copy
import http.client
import json
import logging
import os
import re
import shutil
import socket
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
DEFAULT_CONTEXT_SIZE = None
DEFAULT_MAX_TOKENS = None
LOCAL_MODEL_RESIDENT_LIMIT = 2
LOCAL_MODEL_FIT_TARGET_MIB = 1024
COMFY_BASE_URL = "http://127.0.0.1:8188"


class DirectorRuntimeBusy(RuntimeError):
    pass


_process = None
_log_handle = None
_server_settings_signature = None
_process_lock = threading.RLock()
_request_lock = threading.RLock()
_remote_request_lock = threading.Lock()
_active_remote_connection = None
_remote_provider_cache = {}
_ollama_capabilities_cache = {}
_runtime_context = threading.local()
_activity_lock = threading.Lock()
_log_relay_lock = threading.Lock()
_log_relay_offset = 0
_stop_requested = threading.Event()
_logger = logging.getLogger(__name__)
_activity = {
    "active": False,
    "phase": "idle",
    "model": "",
    "operation": "",
    "modelSizeBytes": 0,
    "contextSize": 0,
    "usage": {},
    "timings": {},
    "startedAt": None,
    "updatedAt": time.time(),
    "error": "",
}


def _set_activity(
    phase,
    model_id=None,
    operation=None,
    active=None,
    error=None,
    model_size_bytes=None,
    context_size=None,
    usage=None,
    timings=None,
):
    now = time.time()
    with _activity_lock:
        if active is True and not _activity["active"]:
            _activity["startedAt"] = now
            _activity["usage"] = {}
            _activity["timings"] = {}
        if active is False:
            _activity["active"] = False
        elif active is True:
            _activity["active"] = True
        _activity["phase"] = str(phase or "idle")
        if model_id is not None:
            _activity["model"] = str(model_id or "")
        if operation is not None:
            _activity["operation"] = str(operation or "")
        if model_size_bytes is not None:
            try:
                _activity["modelSizeBytes"] = max(0, int(model_size_bytes or 0))
            except (TypeError, ValueError):
                _activity["modelSizeBytes"] = 0
        if context_size is not None:
            try:
                _activity["contextSize"] = max(0, int(context_size or 0))
            except (TypeError, ValueError):
                _activity["contextSize"] = 0
        if usage is not None:
            _activity["usage"] = dict(usage) if isinstance(usage, dict) else {}
        if timings is not None:
            _activity["timings"] = dict(timings) if isinstance(timings, dict) else {}
        if error is not None:
            _activity["error"] = str(error or "")
        _activity["updatedAt"] = now


def activity_status():
    with _activity_lock:
        activity = dict(_activity)

    try:
        active_model = str(activity.get("model") or "")
        if active_model:
            runtime_id, _active_model_id = _split_model_ref(active_model)
            settings = _runtime_settings(runtime_id)
        else:
            settings = _director_config()
    except Exception:
        settings = {"mode": "local", "runtime_id": "local", "runtime_name": "Local"}

    mode = settings.get("mode", "local")
    activity["runtimeId"] = settings.get("runtime_id", "local")
    activity["runtimeName"] = settings.get("runtime_name", "Local")
    activity["runtimeMode"] = mode
    if mode == "local":
        activity["runtimeProvider"] = "llama.cpp"
        _relay_log_updates()
        if activity.get("active") and activity.get("phase") == "generating":
            _runtime_id, slot_model_id = _split_model_ref(activity.get("model"))
            slot = _slot_snapshot(slot_model_id)
            if slot:
                activity["slot"] = slot
                context_size = int(slot.get("contextSize") or 0)
                if context_size > 0:
                    activity["contextSize"] = context_size
                    with _activity_lock:
                        if _activity.get("active") and _activity.get("phase") == "generating":
                            _activity["contextSize"] = context_size
        return activity

    try:
        with _use_runtime(settings.get("runtime_id", "")):
            is_ollama = _remote_is_ollama()
            activity["runtimeProvider"] = "ollama" if is_ollama else "openai-compatible"
            if is_ollama and activity.get("model"):
                try:
                    _runtime_id, remote_model_id = _split_model_ref(activity.get("model"))
                    remote_model = _ollama_running_model(remote_model_id)
                except (ConnectionError, RuntimeError, ValueError):
                    remote_model = {}
            else:
                remote_model = {}
    except Exception:
        is_ollama = False
        activity["runtimeProvider"] = "openai-compatible"
        remote_model = {}
    if remote_model:
        activity["remoteModelVramBytes"] = remote_model.get("vramBytes", 0)
        model_size = int(remote_model.get("sizeBytes") or 0)
        context_size = int(remote_model.get("contextSize") or 0)
        if model_size > 0:
            activity["modelSizeBytes"] = model_size
        if context_size > 0:
            activity["contextSize"] = context_size
    return activity



def _director_base_config():
    storyboard = app_config.config.get("storyboard")
    storyboard = storyboard if isinstance(storyboard, dict) else {}
    director = storyboard.get("director")
    director = director if isinstance(director, dict) else {}

    executable = str(director.get("llama_server") or "").strip()
    port = int(director.get("port") or DEFAULT_PORT)
    raw_context_size = director.get("context_size", DEFAULT_CONTEXT_SIZE)
    context_size = None if raw_context_size in (None, "") else int(raw_context_size)
    raw_max_tokens = director.get("max_tokens", DEFAULT_MAX_TOKENS)
    max_tokens = None if raw_max_tokens in (None, "") else int(raw_max_tokens)
    if max_tokens is not None and max_tokens <= 0:
        raise ValueError("Storyboard Director max_tokens must be greater than zero when overridden.")

    models_dir = None
    models_root = str(app_config.config.get("filesystem", {}).get("models") or "").strip()
    if models_root:
        if models_root.startswith("/"):
            models_dir = Path(models_root) / "text_encoders"
        else:
            from .training_runtime import to_wsl_path
            distribution = str(app_config.config.get("training", {}).get("wsl_distribution") or "").strip()
            windows_models_dir = str(PureWindowsPath(models_root) / "text_encoders")
            models_dir = Path(to_wsl_path(windows_models_dir, distribution=distribution))
        models_dir = models_dir.expanduser()

    remote_endpoints = []
    raw_endpoints = director.get("remote_endpoints")
    if isinstance(raw_endpoints, list):
        for item in raw_endpoints:
            if not isinstance(item, dict) or item.get("enabled", True) is False:
                continue
            endpoint_id = str(item.get("id") or "").strip()
            endpoint = str(item.get("endpoint") or "").strip().rstrip("/")
            if endpoint_id and endpoint:
                remote_endpoints.append({
                    "id": endpoint_id,
                    "name": str(item.get("name") or endpoint_id).strip(),
                    "endpoint": endpoint,
                })

    legacy_endpoint = str(director.get("endpoint") or "").strip().rstrip("/")
    if legacy_endpoint and not any(item["endpoint"] == legacy_endpoint for item in remote_endpoints):
        remote_endpoints.insert(0, {"id": "remote", "name": "Remote", "endpoint": legacy_endpoint})

    return {
        "legacy_mode": str(director.get("mode") or "local").strip().lower(),
        "llama_server": executable,
        "models_dir": models_dir,
        "port": port,
        "context_size": context_size,
        "max_tokens": max_tokens,
        "remote_endpoints": remote_endpoints,
    }


def _runtime_settings(runtime_id=""):
    base = _director_base_config()
    runtime_id = str(runtime_id or getattr(_runtime_context, "runtime_id", "") or "").strip()
    if not runtime_id:
        if base["legacy_mode"] == "remote" and base["remote_endpoints"]:
            runtime_id = base["remote_endpoints"][0]["id"]
        else:
            runtime_id = "local"

    if runtime_id == "local":
        context_size_override = getattr(_runtime_context, "context_size_override", None)
        if context_size_override is not None:
            base = {**base, "context_size": int(context_size_override)}
        if base["models_dir"] is None:
            raise ValueError("WebCap Model Root is required for local Storyboard Director model discovery.")
        if base["port"] <= 0 or base["port"] > 65535:
            raise ValueError("Storyboard Director llama.cpp port must be between 1 and 65535.")
        if base["context_size"] is not None and base["context_size"] < 1024:
            raise ValueError("Storyboard Director context_size must be at least 1024 when overridden.")
        return {
            **base,
            "runtime_id": "local",
            "runtime_name": "Local",
            "mode": "local",
            "endpoint": "",
        }

    endpoint = next((item for item in base["remote_endpoints"] if item["id"] == runtime_id), None)
    if endpoint is None:
        raise ValueError("Unknown Director runtime: " + runtime_id)
    if not endpoint["endpoint"].startswith(("http://", "https://")):
        raise ValueError("Storyboard Director remote endpoint must start with http:// or https://.")
    return {
        **base,
        "runtime_id": endpoint["id"],
        "runtime_name": endpoint["name"],
        "mode": "remote",
        "endpoint": endpoint["endpoint"],
        "models_dir": None,
    }


def _director_config():
    return _runtime_settings()


@contextlib.contextmanager
def _use_context_size_override(context_size):
    previous = getattr(_runtime_context, "context_size_override", None)
    if context_size is None:
        yield
        return
    try:
        value = int(context_size)
    except (TypeError, ValueError) as exc:
        raise ValueError("Director context_size override must be an integer.") from exc
    if value < 1024:
        raise ValueError("Director context_size override must be at least 1024.")
    _runtime_context.context_size_override = value
    try:
        yield
    finally:
        if previous is None:
            try:
                delattr(_runtime_context, "context_size_override")
            except AttributeError:
                pass
        else:
            _runtime_context.context_size_override = previous


@contextlib.contextmanager
def _use_runtime(runtime_id):
    previous = getattr(_runtime_context, "runtime_id", "")
    _runtime_context.runtime_id = str(runtime_id or "")
    try:
        yield _director_config()
    finally:
        _runtime_context.runtime_id = previous


def _split_model_ref(model_ref):
    value = str(model_ref or "").strip()
    if not value:
        raise ValueError("Choose a Director model.")
    if "::" in value:
        runtime_id, model_id = value.split("::", 1)
        runtime_id = runtime_id.strip()
        model_id = model_id.strip()
        if not runtime_id or not model_id:
            raise ValueError("Director model reference is invalid.")
        return runtime_id, model_id

    # Unqualified refs are legacy local model IDs. Browser preferences are
    # reconciled against discovered qualified refs before requests are queued.
    return "local", value


def _model_ref(runtime_id, model_id):
    return str(runtime_id or "").strip() + "::" + str(model_id or "").strip()


def uses_local_gpu(model_ref=None):
    if model_ref:
        runtime_id, _model_id = _split_model_ref(model_ref)
        return runtime_id == "local"
    return _director_config().get("mode", "local") == "local"


def _server_url(path):
    settings = _director_config()
    base = settings.get("endpoint", "") if settings.get("mode", "local") == "remote" else "http://" + LLAMA_HOST + ":" + str(settings["port"])
    return base.rstrip("/") + "/" + str(path or "").lstrip("/")


def _runtime_dir():
    path = app_config.app_cache_root() / "storyboard-director"
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
        raise RuntimeError("Director endpoint request failed: " + _decode_error_body(exc)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError("Could not connect to the configured Director endpoint.") from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Director endpoint returned invalid JSON.") from exc


def _remote_native_url(path):
    settings = _director_config()
    if settings.get("mode", "local") != "remote":
        raise ValueError("Remote Director endpoint is not active.")
    parsed = urllib.parse.urlsplit(settings.get("endpoint", ""))
    prefix = parsed.path.rstrip("/")
    if prefix.endswith("/v1"):
        prefix = prefix[:-3]
    native_path = prefix.rstrip("/") + "/" + str(path or "").lstrip("/")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, native_path, "", ""))


def _remote_native_http_json(path, timeout=5, method="GET", payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        _remote_native_url(path),
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError("Director endpoint request failed: " + _decode_error_body(exc)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ConnectionError("Could not connect to the configured Director endpoint.") from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Director endpoint returned invalid JSON.") from exc


def _remote_is_ollama(refresh=False):
    settings = _director_config()
    if settings.get("mode", "local") != "remote":
        return False
    endpoint = str(settings.get("endpoint") or "").rstrip("/")
    cached = _remote_provider_cache.get(endpoint)
    if cached is not None and not refresh:
        return cached == "ollama"

    try:
        payload = _remote_native_http_json("/api/version", timeout=2)
        detected = isinstance(payload, dict) and bool(str(payload.get("version") or "").strip())
    except (ConnectionError, RuntimeError, ValueError):
        detected = False
    _remote_provider_cache[endpoint] = "ollama" if detected else "generic"
    return detected


def _ollama_model_sizes():
    payload = _remote_native_http_json("/api/tags", timeout=5)
    raw_models = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(raw_models, list):
        raise RuntimeError("Ollama did not return a model list from /api/tags.")
    sizes = {}
    for entry in raw_models:
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get("name") or entry.get("model") or "").strip()
        if not model_id:
            continue
        try:
            sizes[model_id] = max(0, int(entry.get("size") or 0))
        except (TypeError, ValueError):
            sizes[model_id] = 0
    return sizes


def _ollama_running_model(model_id):
    model_id = str(model_id or "").strip()
    if not model_id:
        return {}

    payload = _remote_native_http_json("/api/ps", timeout=2)
    raw_models = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(raw_models, list):
        raise RuntimeError("Ollama did not return running models from /api/ps.")

    for entry in raw_models:
        if not isinstance(entry, dict):
            continue
        entry_ids = {
            str(entry.get("name") or "").strip(),
            str(entry.get("model") or "").strip(),
        }
        if model_id not in entry_ids:
            continue

        def _nonnegative_int(value):
            try:
                return max(0, int(value or 0))
            except (TypeError, ValueError):
                return 0

        return {
            "sizeBytes": _nonnegative_int(entry.get("size")),
            "vramBytes": _nonnegative_int(entry.get("size_vram")),
            "contextSize": _nonnegative_int(entry.get("context_length")),
        }
    return {}


def _remote_http_json_cancellable(path, method="GET", payload=None, timeout=30):
    global _active_remote_connection
    url = _server_url(path)
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Storyboard Director remote endpoint is invalid.")

    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    connection = connection_class(parsed.hostname, parsed.port, timeout=timeout)
    target = parsed.path or "/"
    if parsed.query:
        target += "?" + parsed.query
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"} if body is not None else {}

    try:
        connection.connect()
        with _remote_request_lock:
            _active_remote_connection = connection
        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.")
        connection.request(method, target, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        if response.status >= 400:
            detail = raw.decode("utf-8", errors="replace").strip()
            if detail:
                try:
                    decoded = json.loads(detail)
                    error = decoded.get("error") if isinstance(decoded, dict) else None
                    if isinstance(error, dict) and error.get("message"):
                        detail = str(error["message"])
                except (ValueError, TypeError):
                    pass
            raise RuntimeError(
                "Director endpoint request failed: "
                + (detail or (str(response.status) + " " + str(response.reason or "").strip()))
            )
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Director endpoint returned invalid JSON.") from exc
    except RuntimeError:
        raise
    except (http.client.HTTPException, TimeoutError, OSError) as exc:
        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.") from exc
        raise ConnectionError("Could not connect to the configured Director endpoint.") from exc
    finally:
        with _remote_request_lock:
            if _active_remote_connection is connection:
                _active_remote_connection = None
        connection.close()


def _active_runtime_settings(model_ref=""):
    active_model = str(model_ref or "").strip()
    if not active_model:
        with _activity_lock:
            active_model = str(_activity.get("model") or "").strip()
    if not active_model:
        return _director_config()
    runtime_id, _model_id = _split_model_ref(active_model)
    return _runtime_settings(runtime_id)


def assert_stop_supported(model_ref=""):
    settings = _active_runtime_settings(model_ref)
    if settings.get("mode", "local") == "local":
        assert_hard_stop_supported()


def stop_active_request(model_ref=""):
    settings = _active_runtime_settings(model_ref)
    if settings.get("mode", "local") == "remote":
        with _use_runtime(settings.get("runtime_id", "")):
            assert_stop_supported(model_ref)

    # Signal first so work that currently owns a runtime lifecycle lock can
    # unwind itself instead of making Stop wait for that lifecycle step.
    _stop_requested.set()

    # Model load/unload requests use the same cancellable connection slot as
    # remote generation. Closing it makes an in-flight local /models/load
    # return promptly instead of waiting for its long HTTP timeout.
    connection_stopped = False
    with _remote_request_lock:
        connection = _active_remote_connection
    if connection is not None:
        sock = getattr(connection, "sock", None)
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        connection.close()
        connection_stopped = True

    if settings.get("mode", "local") == "local":
        return bool(stop_owned_server() or connection_stopped)
    return connection_stopped


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


def _llama_log_line_is_meaningful(line):
    normalized = str(line or "").casefold()
    return any(token in normalized for token in (
        "error",
        "warn",
        "cuda",
        "cpu",
        "offload",
        "buffer size",
        "kv cache",
        "n_ctx",
        "n_prompt_tokens",
        "prompt done",
        "prompt eval time",
        " eval time",
        "total time",
        "stopped by",
        "load_tensors",
        "loading model",
        "model loaded",
    ))


def _relay_log_updates():
    global _log_relay_offset
    path = _runtime_dir() / "llama-server.log"
    with _log_relay_lock:
        try:
            size = path.stat().st_size
            if _log_relay_offset > size:
                _log_relay_offset = 0
            with path.open("rb") as handle:
                handle.seek(_log_relay_offset)
                data = handle.read(256 * 1024)
                _log_relay_offset = handle.tell()
        except OSError:
            return

    if not data:
        return
    for line in data.decode("utf-8", errors="replace").splitlines():
        if _llama_log_line_is_meaningful(line):
            print("[llama.cpp] " + line, flush=True)


def _slot_snapshot(model_id=""):
    settings = _director_config()
    if settings.get("mode", "local") != "local":
        return {}

    model_id = str(model_id or "").strip()
    paths = []
    if model_id:
        paths.append("/slots?model=" + urllib.parse.quote(model_id, safe=""))
    paths.append("/slots")

    payload = None
    for path in paths:
        try:
            payload = _http_json(path, timeout=1)
            break
        except Exception:
            payload = None
    slots = payload if isinstance(payload, list) else (
        payload.get("slots") if isinstance(payload, dict) and isinstance(payload.get("slots"), list) else []
    )
    slot = next(
        (item for item in slots if isinstance(item, dict) and item.get("is_processing")),
        None,
    )
    if slot is None:
        return {}

    params = slot.get("params") if isinstance(slot.get("params"), dict) else {}
    raw_next_token = slot.get("next_token")
    if isinstance(raw_next_token, list):
        token_state = raw_next_token[0] if raw_next_token and isinstance(raw_next_token[0], dict) else {}
    elif isinstance(raw_next_token, dict):
        token_state = raw_next_token
    else:
        token_state = {}

    def _nonnegative_int(value):
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            return 0

    max_tokens = params.get("max_tokens", params.get("n_predict"))
    try:
        max_tokens = int(max_tokens)
    except (TypeError, ValueError):
        max_tokens = None

    return {
        "slotId": slot.get("id"),
        "contextSize": _nonnegative_int(slot.get("n_ctx")),
        "promptTokens": _nonnegative_int(slot.get("n_prompt_tokens")),
        "promptProcessed": _nonnegative_int(slot.get("n_prompt_tokens_processed")),
        "promptCached": _nonnegative_int(slot.get("n_prompt_tokens_cache")),
        "generatedTokens": _nonnegative_int(token_state.get("n_decoded")),
        "maxTokens": max_tokens,
    }


def _stop_server_locked():
    global _process, _log_handle, _server_settings_signature, _log_relay_offset
    process = _process
    _process = None
    _server_settings_signature = None
    _log_relay_offset = 0
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


def assert_hard_stop_supported():
    settings = _director_config()
    if settings.get("mode", "local") != "local":
        raise ValueError("Hard Stop is only available for the local WebCap-owned llama.cpp runtime.")
    with _process_lock:
        process = _process
        if process is not None and process.poll() is None:
            return
        if process is None and _health_ok():
            raise RuntimeError("The active llama.cpp server is not owned by WebCap and cannot be hard-stopped.")
        return


def clear_stop_request():
    _stop_requested.clear()


def stop_owned_server():
    assert_hard_stop_supported()
    _stop_requested.set()
    with _process_lock:
        if _process is None:
            return False
        _stop_server_locked()
        return True


def _server_signature(settings):
    return (
        str(settings["llama_server"]),
        str(settings["models_dir"]),
        int(settings["port"]),
        settings["context_size"],
        str(Path(app_config.FS_ROOT).resolve()),
        LOCAL_MODEL_RESIDENT_LIMIT,
        LOCAL_MODEL_FIT_TARGET_MIB,
    )


def _ensure_server():
    global _process, _log_handle, _server_settings_signature, _log_relay_offset
    with _process_lock:
        settings = _director_config()
        if settings.get("mode", "local") == "remote":
            # Remote discovery is performed by the caller. Do not double-probe
            # here; a dead endpoint should be skipped quickly rather than
            # serially consuming two network timeouts.
            return

        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.")

        desired_signature = _server_signature(settings)

        if _process is not None and _process.poll() is not None:
            _stop_server_locked()

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
            raise RuntimeError(
                "The Storyboard Director local port is already occupied by a llama.cpp server "
                "that this WebCap process does not own. Stop that server or configure it as a "
                "remote Director runtime."
            )

        models_dir = settings["models_dir"]
        models_dir.mkdir(parents=True, exist_ok=True)
        executable = _resolve_executable()
        log_path = _runtime_dir() / "llama-server.log"
        _log_handle = open(log_path, "w", encoding="utf-8")
        _log_relay_offset = 0
        command = [
            executable,
            "--models-dir", str(models_dir),
            "--models-max", str(LOCAL_MODEL_RESIDENT_LIMIT),
            "--no-models-autoload",
            "--media-path", str(Path(app_config.FS_ROOT).resolve()),
            "--host", LLAMA_HOST,
            "--port", str(settings["port"]),
            "--log-colors", "off",
            "--log-prefix",
            "--log-timestamps",
            "--log-verbosity", "3",
        ]
        if settings["context_size"] is not None:
            command.extend(["--ctx-size", str(settings["context_size"])])
        command.extend([
            "--fit", "on",
            "--fit-target", str(LOCAL_MODEL_FIT_TARGET_MIB),
            "--parallel", "1",
            "--image-min-tokens", "1024",
            "--jinja",
            "--cache-prompt",
        ])
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
            if _stop_requested.is_set():
                _stop_server_locked()
                raise RuntimeError("LLM request stopped.")
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
        raise RuntimeError("Director endpoint did not return a model list.")
    models = []
    for entry in raw_models:
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get("id") or "").strip()
        if not model_id:
            continue
        path = str(entry.get("path") or "").strip()
        status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
        meta = entry.get("meta") if isinstance(entry.get("meta"), dict) else {}
        size_value = entry.get("size")
        if size_value in (None, ""):
            size_value = meta.get("size")
        try:
            size_bytes = max(0, int(size_value or 0))
        except (TypeError, ValueError):
            size_bytes = 0
        architecture = entry.get("architecture") if isinstance(entry.get("architecture"), dict) else {}
        input_modalities = architecture.get("input_modalities")
        if not isinstance(input_modalities, list):
            input_modalities = ["text"]
        input_modalities = [
            str(value).strip().lower()
            for value in input_modalities
            if str(value or "").strip()
        ] or ["text"]
        models.append({
            "id": model_id,
            "label": Path(path or model_id).name,
            "path": path,
            "status": str(status.get("value") or ("remote" if not path else "unloaded")),
            "sizeBytes": size_bytes,
            "architecture": {
                "input_modalities": input_modalities,
            },
            "inputModalities": input_modalities,
        })
    models.sort(key=lambda model: model["label"].casefold())
    return models


def _model_file_size(model):
    model = model if isinstance(model, dict) else {}
    model_id = str(model.get("id") or "").strip()
    raw_path = str(model.get("path") or "").strip()
    filename = PureWindowsPath(raw_path).name if raw_path else model_id
    if not filename:
        raise FileNotFoundError("Director model filename is missing.")
    if not filename.casefold().endswith(".gguf"):
        filename += ".gguf"

    models_dir = _director_config().get("models_dir")
    if models_dir is None:
        raise RuntimeError("Director models directory is unavailable.")

    raw_local_path = Path(raw_path).expanduser() if raw_path else None
    if raw_local_path is not None and raw_local_path.is_absolute() and raw_local_path.is_file():
        path = raw_local_path
    else:
        # Unloaded llama.cpp router presets do not expose a file path in /models.
        # Resolve the router model ID back to WebCap's passive filesystem
        # discovery so subdirectory presets such as text_encoders/vision remain
        # available before their first load.
        passive = next(
            (
                item for item in _list_local_models_passive()
                if str(item.get("id") or "") == model_id
            ),
            None,
        )
        passive_path = str((passive or {}).get("path") or "").strip()
        path = Path(passive_path) if passive_path else Path(models_dir) / filename

    try:
        return int(path.stat().st_size)
    except OSError as exc:
        raise OSError(
            "Could not stat Director model file '" + str(path) + "': " + str(exc)
        ) from exc


def _list_models_for_current_runtime(reload=False):
    _ensure_server()
    settings = _director_config()
    suffix = "?reload=1" if reload and settings.get("mode", "local") == "local" else ""
    discovery_timeout = 10 if settings.get("mode", "local") == "local" else 3
    models = _normalize_models(_http_json("/models" + suffix, timeout=discovery_timeout))
    if settings.get("mode", "local") == "local":
        available_models = []
        for model in models:
            try:
                model["sizeBytes"] = _model_file_size(model)
            except OSError as exc:
                _logger.info(
                    "Skipping unavailable local Director model %s: %s",
                    model.get("id") or model.get("label") or "unknown",
                    exc,
                )
                continue
            available_models.append(model)
        models = available_models
    elif _remote_is_ollama(refresh=reload):
        try:
            sizes = _ollama_model_sizes()
        except (ConnectionError, RuntimeError, ValueError) as exc:
            _logger.warning("Could not read Ollama model sizes from /api/tags: %s", exc)
        else:
            for model in models:
                if model["id"] in sizes:
                    model["sizeBytes"] = sizes[model["id"]]
    return models


def _list_local_models_passive():
    """Discover configured local GGUFs without starting or probing llama.cpp."""
    settings = _runtime_settings("local")
    models_dir = Path(settings["models_dir"])
    if not models_dir.exists():
        return []
    if not models_dir.is_dir():
        raise NotADirectoryError("Director models directory is not a directory: " + str(models_dir))

    def is_sidecar(path):
        name = path.name.casefold()
        return (
            "mmproj" in name
            or name.startswith("mtp-")
            or name.startswith("dspark-")
            or name.startswith("dflash-")
        )

    def record(model_id, model_path, multimodal=False):
        try:
            size_bytes = int(model_path.stat().st_size)
        except OSError as exc:
            _logger.info("Skipping unavailable local Director model %s: %s", model_path.name, exc)
            return None
        input_modalities = ["text", "image"] if multimodal else ["text"]
        return {
            "id": str(model_id),
            "label": model_path.name,
            "path": str(model_path),
            "status": "unloaded",
            "sizeBytes": max(0, size_bytes),
            "architecture": {"input_modalities": input_modalities},
            "inputModalities": input_modalities,
        }

    models = []
    # A broken folder must not hide otherwise usable models.
    try:
        entries = list(models_dir.iterdir())
    except OSError as exc:
        raise RuntimeError("Cannot enumerate local Director models in " + str(models_dir)) from exc
    root_projectors = [entry for entry in entries if entry.is_file() and entry.suffix.casefold() == ".gguf" and "mmproj" in entry.name.casefold()]
    for path in entries:
        if path.is_file() and path.suffix.casefold() == ".gguf" and not is_sidecar(path):
            model = record(path.stem, path, multimodal=bool(root_projectors))
            if model is not None:
                models.append(model)
            continue
        if not path.is_dir():
            continue

        try:
            ggufs = [
                entry for entry in path.iterdir()
                if entry.is_file() and entry.suffix.casefold() == ".gguf"
            ]
        except OSError as exc:
            _logger.warning("Skipping unreadable local model folder %s: %s", path, exc)
            continue
        main_files = [entry for entry in ggufs if not is_sidecar(entry)]
        mmproj_files = [entry for entry in ggufs if "mmproj" in entry.name.casefold()]
        first_shards = [
            entry for entry in main_files
            if "-00001-of-" in entry.name.casefold()
        ]
        if first_shards:
            candidates = [sorted(first_shards, key=lambda entry: entry.name.casefold())[0]]
        else:
            candidates = main_files

        for model_path in candidates:
            # Match each projector to its own model rather than treating all
            # GGUFs in a directory as one model.
            stem = re.sub(r"(?i)[._-](?:q[0-9]+(?:_[a-z0-9]+)*|f16|bf16)$", "", model_path.stem).casefold()
            matching_projectors = [
                projector for projector in mmproj_files
                if projector.stem.casefold().startswith(stem + ".mmproj")
                or projector.stem.casefold().startswith(stem + "-mmproj")
            ]
            # Legacy single-model directories may use a generic mmproj name.
            if len(candidates) == 1 and not matching_projectors:
                matching_projectors = mmproj_files
            model_id = path.name if len(candidates) == 1 else model_path.stem
            model = record(model_id, model_path, multimodal=bool(matching_projectors))
            if model is not None:
                models.append(model)

    models.sort(key=lambda model: model["label"].casefold())
    return models

def list_local_vision_models():
    models = []
    with _use_runtime("local"):
        for model in _list_local_models_passive():
            modalities = model.get("inputModalities") if isinstance(model, dict) else []
            if "image" not in (modalities or []):
                continue
            next_model = dict(model)
            next_model["runtimeId"] = "local"
            next_model["runtimeName"] = "Local"
            next_model["modelId"] = next_model["id"]
            next_model["id"] = _model_ref("local", next_model["id"])
            models.append(next_model)
    models.sort(key=lambda model: (
        int(model.get("sizeBytes") or 0),
        str(model.get("label") or "").casefold(),
    ))
    return models


def _ollama_model_capabilities(model_id, refresh=False):
    model_id = str(model_id or "").strip()
    if not model_id:
        return []
    settings = _director_config()
    endpoint = str(settings.get("endpoint") or "").rstrip("/")
    cache_key = (endpoint, model_id)
    if not refresh and cache_key in _ollama_capabilities_cache:
        return list(_ollama_capabilities_cache[cache_key])

    payload = _remote_native_http_json("/api/show", timeout=5, method="POST", payload={"model": model_id})
    capabilities = payload.get("capabilities") if isinstance(payload, dict) else None
    normalized = (
        [str(value).strip().lower() for value in capabilities if str(value or "").strip()]
        if isinstance(capabilities, list)
        else []
    )
    _ollama_capabilities_cache[cache_key] = list(normalized)
    return normalized


def list_vision_models(reload=False):
    models = []
    warnings = []

    try:
        models.extend(list_local_vision_models())
    except Exception as exc:
        warnings.append({"runtimeId": "local", "runtimeName": "Local", "error": str(exc)})

    base = _director_base_config()
    for endpoint in base["remote_endpoints"]:
        runtime_id = endpoint["id"]
        runtime_name = endpoint["name"]
        try:
            with _use_runtime(runtime_id):
                if not _remote_is_ollama(refresh=reload):
                    continue
                payload = _remote_native_http_json("/api/tags", timeout=5)
                raw_models = payload.get("models") if isinstance(payload, dict) else None
                if not isinstance(raw_models, list):
                    raise RuntimeError("Ollama did not return a model list from /api/tags.")
                seen_model_ids = set()
                for entry in raw_models:
                    if not isinstance(entry, dict):
                        continue
                    model_id = str(entry.get("name") or entry.get("model") or "").strip()
                    if model_id in seen_model_ids or model_id.startswith(("llamacpp:sha256:", "ggml:sha256:")) or re.fullmatch(r"(?:llamacpp|ggml):[0-9a-f]{64}", model_id):
                        continue
                    seen_model_ids.add(model_id)
                    if not model_id:
                        continue
                    try:
                        capabilities = _ollama_model_capabilities(model_id, refresh=reload)
                    except Exception as exc:
                        _logger.info("Could not inspect Ollama model capabilities for %s: %s", model_id, exc)
                        continue
                    if "vision" not in capabilities:
                        continue
                    try:
                        size_bytes = max(0, int(entry.get("size") or 0))
                    except (TypeError, ValueError):
                        size_bytes = 0
                    models.append({
                        "id": _model_ref(runtime_id, model_id),
                        "runtimeId": runtime_id,
                        "runtimeName": runtime_name,
                        "modelId": model_id,
                        "label": model_id,
                        "path": "",
                        "status": "remote",
                        "sizeBytes": size_bytes,
                        "architecture": {"input_modalities": ["text", "image"]},
                        "inputModalities": ["text", "image"],
                    })
        except Exception as exc:
            warnings.append({
                "runtimeId": runtime_id,
                "runtimeName": runtime_name,
                "endpoint": endpoint["endpoint"],
                "error": str(exc),
            })

    models.sort(key=lambda model: (
        0 if model.get("runtimeId") == "local" else 1,
        str(model.get("runtimeName") or "").casefold(),
        int(model.get("sizeBytes") or 0),
        str(model.get("label") or "").casefold(),
    ))
    list_vision_models.last_warnings = warnings
    return models


list_vision_models.last_warnings = []


def encode_media_data_url(relative_media_path):
    relative = str(relative_media_path or "").strip().replace("\\", "/")
    if not relative:
        raise ValueError("Vision media path is required.")
    root = Path(app_config.FS_ROOT).resolve()
    path = (root / relative).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("Vision media must be inside the configured dataset root.") from exc
    if not path.is_file():
        raise FileNotFoundError("Vision media file not found.")
    mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return "data:" + mime_type + ";base64," + encoded


def prepare_caption_vision_messages(model_ref, messages):
    runtime_id, _model_id = _split_model_ref(model_ref)
    if runtime_id != "local":
        with _use_runtime(runtime_id):
            if not _remote_is_ollama():
                raise ValueError("Remote Vision currently requires an Ollama runtime.")

    # Send Vision media as self-contained data URLs for every runtime.
    # llama.cpp router children do not consistently inherit local media-path
    # access, while data URLs are independent of router filesystem policy.
    prepared = copy.deepcopy(messages)
    for message in prepared if isinstance(prepared, list) else []:
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, list):
            continue
        for part in content:
            if not isinstance(part, dict) or str(part.get("type") or "").strip().lower() != "image_url":
                continue
            image_url = part.get("image_url") if isinstance(part.get("image_url"), dict) else {}
            url = str(image_url.get("url") or "").strip()
            if url.startswith("data:image/"):
                continue
            if not url.startswith("file://") or url.startswith("file:///"):
                raise ValueError("Vision image reference is invalid.")
            relative = url[len("file://"):]
            image_url["url"] = encode_media_data_url(relative)
            part["image_url"] = image_url
    return prepared


def list_models(reload=False, probe_local_runtime=False):
    models = []
    warnings = []
    base = _director_base_config()

    try:
        with _use_runtime("local"):
            local_models = (
                _list_models_for_current_runtime(reload=reload)
                if probe_local_runtime
                else _list_local_models_passive()
            )
        for model in local_models:
            model["runtimeId"] = "local"
            model["runtimeName"] = "Local"
            model["modelId"] = model["id"]
            model["id"] = _model_ref("local", model["id"])
        models.extend(local_models)
    except Exception as exc:
        warnings.append({"runtimeId": "local", "runtimeName": "Local", "error": str(exc)})
        _logger.info("Director local model discovery unavailable; skipped: %s", exc)

    for endpoint in base["remote_endpoints"]:
        try:
            with _use_runtime(endpoint["id"]):
                remote_models = _list_models_for_current_runtime(reload=reload)
            for model in remote_models:
                model["runtimeId"] = endpoint["id"]
                model["runtimeName"] = endpoint["name"]
                model["modelId"] = model["id"]
                model["id"] = _model_ref(endpoint["id"], model["id"])
            models.extend(remote_models)
        except Exception as exc:
            warnings.append({
                "runtimeId": endpoint["id"],
                "runtimeName": endpoint["name"],
                "endpoint": endpoint["endpoint"],
                "error": str(exc),
            })
            _logger.info(
                "Director endpoint %s (%s) unavailable; skipped: %s",
                endpoint["name"],
                endpoint["endpoint"],
                exc,
            )

    models.sort(key=lambda model: (
        0 if model.get("runtimeId") == "local" else 1,
        str(model.get("runtimeName") or "").casefold(),
        str(model.get("label") or "").casefold(),
    ))
    list_models.last_warnings = warnings
    return models


list_models.last_warnings = []



def _assessment_signal(model_ref):
    from .director_model_calibration import get_report

    report = get_report(model_ref)
    if not isinstance(report, dict):
        return None
    abilities = report.get("abilities") if isinstance(report.get("abilities"), dict) else {}
    try:
        coherent_output = max(0, int(abilities.get("coherentOutputTokens") or 0))
    except (TypeError, ValueError):
        coherent_output = 0
    health = str(report.get("health") or "").strip()
    pathologies = report.get("pathologies") if isinstance(report.get("pathologies"), list) else []
    serious = bool(pathologies) or health == "likely-unusable"
    limited = (not serious and report.get("status") == "complete"
               and health in {"healthy", "limited"} and 0 < coherent_output < 8192)
    return {
        "status": str(report.get("status") or ""),
        "health": health,
        "pathologies": [str(item) for item in pathologies if str(item or "").strip()],
        "seriousWarning": serious,
        "limited": limited,
        "fullStoryCapable": coherent_output >= 8192 and not serious,
        "individualScenesRecommended": limited,
        "abilities": {
            "contextTokens": max(0, int(abilities.get("contextTokens") or 0)),
            "structuredOutputTokens": max(0, int(abilities.get("structuredOutputTokens") or 0)),
            "coherentOutputTokens": coherent_output,
        },
        "updatedAt": str(report.get("updatedAt") or ""),
    }


def _attach_assessment_signals(models):
    for model in models:
        model_ref = str(model.get("id") or "").strip()
        signal = _assessment_signal(model_ref)
        if signal is not None:
            model["assessment"] = signal
    return models

def status():
    models = _attach_assessment_signals(list_models(reload=True))
    warnings = list(getattr(list_models, "last_warnings", []) or [])
    return {
        "available": bool(models),
        "serverRunning": bool(models),
        "runtime": "Director runtimes",
        "models": models,
        "warnings": warnings,
        "error": "" if models else (
            "No Director models are currently available."
            + ((" " + "; ".join(item.get("runtimeName", "Runtime") + ": " + item.get("error", "") for item in warnings)) if warnings else "")
        ),
    }


def _model_record(model_ref):
    runtime_id, model_id = _split_model_ref(model_ref)
    with _use_runtime(runtime_id):
        models = _list_models_for_current_runtime(reload=True)
    for model in models:
        if model["id"] == model_id:
            model["runtimeId"] = runtime_id
            model["runtimeName"] = _runtime_settings(runtime_id)["runtime_name"]
            model["modelId"] = model_id
            model["id"] = _model_ref(runtime_id, model_id)
            return model
    raise FileNotFoundError("Director model is not available from runtime '" + runtime_id + "': " + model_id)


def _wait_for_model(model_id, wanted, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.")
        for model in _list_models_for_current_runtime(reload=False):
            if model["id"] != model_id:
                continue
            if model["status"] == wanted:
                return
            if model["status"] == "unloaded" and wanted == "loaded":
                break
        time.sleep(0.25)
    raise RuntimeError("Timed out waiting for llama.cpp model to become " + wanted + ": " + model_id)


def _load_model(model_id):
    if _stop_requested.is_set():
        raise RuntimeError("LLM request stopped.")
    response = _remote_http_json_cancellable(
        "/models/load",
        method="POST",
        payload={"model": model_id},
        timeout=180,
    )
    if response.get("success") is not True:
        raise RuntimeError("llama.cpp did not load the selected Director model.")
    _wait_for_model(model_id, "loaded", timeout=180)


def _unload_model(model_id):
    if _stop_requested.is_set():
        raise RuntimeError("LLM request stopped.")
    response = _remote_http_json_cancellable(
        "/models/unload",
        method="POST",
        payload={"model": model_id},
        timeout=30,
    )
    if response.get("success") is not True:
        raise RuntimeError("llama.cpp did not unload the selected Director model.")
    _wait_for_model(model_id, "unloaded", timeout=30)


def _windows_curl_path():
    is_wsl = bool(os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME"))
    if not is_wsl:
        try:
            is_wsl = "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
        except OSError:
            is_wsl = False
    candidate = Path("/mnt/c/Windows/System32/curl.exe")
    return str(candidate) if is_wsl and candidate.is_file() else None


def _model_status(model_id):
    for model in _list_models_for_current_runtime(reload=False):
        if model["id"] == model_id:
            return model["status"]
    return ""


def _ensure_local_model_loaded(model_id):
    models = _list_models_for_current_runtime(reload=False)
    selected = next((model for model in models if model["id"] == model_id), None)
    if selected is None:
        raise FileNotFoundError("Director model is not available from the active runtime: " + model_id)
    if selected["status"] == "loaded":
        return False

    _set_activity(
        "loading_model",
        model_size_bytes=_model_file_size(selected),
    )

    # llama.cpp owns the models_max/LRU policy. Do not maintain a competing
    # eviction heuristic here; loading a third model will evict the router's
    # least-recently-used idle model.
    _load_model(model_id)
    return True


def release_loaded_model_for_gpu_work():
    with _activity_lock:
        active_model = (
            str(_activity.get("model") or "").strip()
            if _activity.get("active")
            else ""
        )
    remote_request_active = bool(active_model) and not uses_local_gpu(active_model)

    request_lock_acquired = False
    if not remote_request_active:
        if not _request_lock.acquire(blocking=False):
            raise DirectorRuntimeBusy("Prompt Assistant / Director runtime is still finishing current work.")
        request_lock_acquired = True
    try:
        process = _process
        if process is not None and process.poll() is not None:
            stop_server()
            return False
        if process is None:
            # No WebCap-owned local llama.cpp runtime exists. In particular,
            # never reach into an unrelated server that merely occupies the
            # configured local port.
            return False

        with _use_runtime("local"):
            if not _health_ok():
                # The owned process exists but cannot service unload requests.
                # Stopping it is a complete and deterministic GPU release.
                stop_server()
                return True

            models = _normalize_models(_http_json("/models", timeout=5))
            released = False
            for model in models:
                if model["status"] == "unloaded":
                    continue
                _unload_model(model["id"])
                released = True
            return released
    finally:
        if request_lock_acquired:
            _request_lock.release()


def _sampling_profile(operation):
    operation = str(operation or "").strip()
    profiles = {
        "expand_concept": {"temperature": 0.35, "top_p": 0.9},
        "develop_story": {"temperature": 0.3, "top_p": 0.9},
        "write_prompt": {"temperature": 0.15, "top_p": 0.85},
        "refine_prompt": {"temperature": 0.1, "top_p": 0.8},
    }
    profile = profiles.get(operation, {"temperature": 0.2, "top_p": 0.85})
    return {
        **profile,
        "presence_penalty": 0.0,
        "frequency_penalty": 0.0,
    }


def _debug_llm_request(settings, model_id, messages, payload, response_schema):
    if not app_config.FS_DEBUG:
        return
    mode = str(settings.get("mode") or "local")
    provider = "remote" if mode == "remote" else "llama.cpp"
    message_chars = sum(
        len(str(message.get("content") or ""))
        for message in messages
        if isinstance(message, dict)
    )
    app_config.debug_print(
        "[Director Debug] request="
        + json.dumps(
            {
                "mode": mode,
                "provider": provider,
                "model": model_id,
                "messages": len(messages),
                "message_chars": message_chars,
                "configured_context": settings.get("context_size"),
                "max_tokens": payload.get("max_tokens", "runtime-default"),
                "response_schema": response_schema is not None,
                "temperature": payload.get("temperature"),
                "top_p": payload.get("top_p"),
                "presence_penalty": payload.get("presence_penalty"),
                "frequency_penalty": payload.get("frequency_penalty"),
                "top_k": payload.get("top_k", "runtime-default"),
                "min_p": payload.get("min_p", "runtime-default"),
                "repeat_penalty": payload.get("repeat_penalty", "runtime-default"),
                "reasoning_effort": payload.get("reasoning_effort", "runtime-default"),
                "enable_thinking": (
                    payload.get("chat_template_kwargs", {}).get("enable_thinking")
                    if isinstance(payload.get("chat_template_kwargs"), dict)
                    else "runtime-default"
                ),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def _debug_llm_response(response, model_id, elapsed_seconds):
    if not app_config.FS_DEBUG:
        return
    choices = response.get("choices") if isinstance(response, dict) else None
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else {}
    message = choice.get("message") if isinstance(choice, dict) else {}
    content = str(message.get("content") or "") if isinstance(message, dict) else ""
    backend_timings = {}
    if isinstance(response, dict):
        for key in (
            "load_duration",
            "prompt_eval_count",
            "prompt_eval_duration",
            "eval_count",
            "eval_duration",
            "total_duration",
        ):
            if key in response:
                backend_timings[key] = response.get(key)
    app_config.debug_print(
        "[Director Debug] response="
        + json.dumps(
            {
                "model": model_id,
                "request_seconds": round(float(elapsed_seconds), 3),
                "finish_reason": str(choice.get("finish_reason") or ""),
                "response_chars": len(content),
                "usage": response.get("usage") if isinstance(response, dict) else None,
                "timings": response.get("timings") if isinstance(response, dict) else None,
                "backend_timings": backend_timings or None,
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def _debug_llm_failure(model_id, elapsed_seconds, exc):
    if not app_config.FS_DEBUG:
        return
    app_config.debug_print(
        "[Director Debug] failure="
        + json.dumps(
            {
                "model": model_id,
                "request_seconds": round(float(elapsed_seconds), 3),
                "error_type": type(exc).__name__,
                "error": str(exc),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


def chat(model_ref, messages, response_schema=None, max_tokens=None, context_size=None, gpu_reserved=False, sampling=None, allow_truncated=False, assessment_evidence=False):
    if not isinstance(messages, list) or not messages:
        raise ValueError("Director messages are required.")

    runtime_id, model_id = _split_model_ref(model_ref)
    if context_size is not None and runtime_id != "local":
        raise ValueError("Director context_size override is supported only by the local llama.cpp runtime.")

    with _use_runtime(runtime_id):
        base_settings = _director_config()
    if base_settings.get("mode", "local") == "local" and not gpu_reserved:
        raise RuntimeError("Local Director runtime requires existing LLM GPU ownership.")
    profile = None
    needs_profile_context = (
        runtime_id == "local"
        and context_size is None
        and base_settings.get("context_size") is None
    )
    needs_profile_output = max_tokens is None and base_settings.get("max_tokens") is None
    if needs_profile_context or needs_profile_output:
        from .director_model_calibration import get_profile
        profile = get_profile(model_ref)

    effective_context_size = context_size
    if (
        effective_context_size is None
        and needs_profile_context
        and isinstance(profile, dict)
        and profile.get("contextMode") == "calibrated"
    ):
        effective_context_size = profile.get("contextSize")

    with _request_lock, _use_runtime(runtime_id), _use_context_size_override(effective_context_size):
        _ensure_server()
        _model_record(model_ref)
        settings = _director_config()
        sampling = dict(sampling or _sampling_profile(""))
        payload = {
            "model": model_id,
            "messages": messages,
            "stream": False,
            "temperature": float(sampling.get("temperature", 0.2)),
            "top_p": float(sampling.get("top_p", 0.85)),
            "presence_penalty": float(sampling.get("presence_penalty", 0.0)),
            "frequency_penalty": float(sampling.get("frequency_penalty", 0.0)),
        }
        requested_max_tokens = max_tokens if max_tokens is not None else settings["max_tokens"]
        if requested_max_tokens is None and needs_profile_output and isinstance(profile, dict):
            requested_max_tokens = profile.get("maxTokens")
        if requested_max_tokens is not None:
            requested_max_tokens = int(requested_max_tokens)
            if requested_max_tokens <= 0:
                raise ValueError("Director max_tokens override must be greater than zero.")
            payload["max_tokens"] = requested_max_tokens
        if assessment_evidence and settings.get("mode", "local") == "remote" and _remote_is_ollama():
            payload["reasoning_effort"] = "none"
        if settings.get("mode", "local") == "local":
            payload["reasoning_effort"] = "none"
            payload["chat_template_kwargs"] = {"enable_thinking": False}
            payload["top_k"] = 40
            payload["min_p"] = 0.05
            payload["repeat_penalty"] = 1.0
            payload["seed"] = -1
        if response_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "storyboard_response",
                    "schema": response_schema,
                },
            }

        _debug_llm_request(settings, model_ref, messages, payload, response_schema)

        if settings.get("mode", "local") == "remote":
            if _stop_requested.is_set():
                raise RuntimeError("LLM request stopped.")
            _set_activity("generating", model_id=model_ref)
            request_json = _remote_http_json_cancellable
            request_started = time.perf_counter()
            try:
                response = request_json(
                    "/chat/completions",
                    method="POST",
                    payload=payload,
                    timeout=10 * 60,
                )
            except Exception as exc:
                _debug_llm_failure(model_ref, time.perf_counter() - request_started, exc)
                raise
            reported_model = str(response.get("model") or "").strip() if isinstance(response, dict) else ""
            if reported_model and reported_model != model_id:
                raise RuntimeError("Director model identity mismatch: requested " + model_id + ", runtime reported " + reported_model)
            _debug_llm_response(response, model_ref, time.perf_counter() - request_started)
            result = _completion_result(response, model_ref, allow_truncated=allow_truncated, assessment_evidence=assessment_evidence)
            result["reportedModel"] = reported_model
            if _remote_is_ollama():
                remote_model = _ollama_running_model(model_id)
                result["contextSize"] = int(remote_model.get("contextSize") or 0)
            return result

        completed = False
        try:
            _ensure_local_model_loaded(model_id)
            _relay_log_updates()
            _set_activity("generating", model_id=model_ref)
            request_started = time.perf_counter()
            try:
                response = _http_json(
                    "/v1/chat/completions",
                    method="POST",
                    payload=payload,
                    timeout=10 * 60,
                )
            except Exception as exc:
                _debug_llm_failure(model_ref, time.perf_counter() - request_started, exc)
                tail = _log_tail()
                if tail:
                    _logger.error(
                        "llama.cpp chat request failed. Recent llama-server output:\n%s",
                        tail,
                    )
                raise
            _debug_llm_response(response, model_ref, time.perf_counter() - request_started)
            _relay_log_updates()
            result = _completion_result(response, model_ref, allow_truncated=allow_truncated, assessment_evidence=assessment_evidence)
            effective_context = int(settings.get("context_size") or 0)
            if context_size is not None:
                slot = _slot_snapshot(model_id)
                effective_context = int(slot.get("contextSize") or effective_context)
            result["contextSize"] = effective_context
            completed = True
            return result
        finally:
            if not completed and not _stop_requested.is_set():
                try:
                    if _model_status(model_id) != "unloaded":
                        _unload_model(model_id)
                except Exception:
                    if _process is not None:
                        stop_server()
                    else:
                        _logger.exception(
                            "Director runtime could not confirm model unload from an external llama.cpp router; "
                            "GPU ownership remains with the LLM runner while this request fails."
                        )


def _completion_result(response, model_id, allow_truncated=False, assessment_evidence=False):
    choices = response.get("choices") if isinstance(response, dict) else None
    choice = choices[0] if isinstance(choices, list) and choices and isinstance(choices[0], dict) else None
    message = choice.get("message") if isinstance(choice, dict) else None
    if not isinstance(message, dict):
        raise RuntimeError("Director runtime returned no completion message.")
    content = str(message.get("content") or "")
    if not assessment_evidence:
        content = content.strip()
    if not content and not assessment_evidence:
        raise RuntimeError("Director runtime returned an empty response.")
    finish_reason = str(choice.get("finish_reason") or "").strip().lower() if isinstance(choice, dict) else ""
    if finish_reason in {"length", "max_tokens"}:
        if not allow_truncated:
            raise RuntimeError(
                "Director output was truncated because the runtime reached its available token/context limit "
                + "(finish_reason=" + finish_reason + ")."
            )
        if not assessment_evidence:
            content += "\n\n[Output truncated by model/runtime token or context limit.]"
    return {
        "text": content,
        "reasoning": str(message.get("reasoning") or message.get("reasoning_content") or "") if assessment_evidence else "",
        "model": model_id,
        "finishReason": finish_reason,
        "usage": response.get("usage") if isinstance(response, dict) else None,
        "timings": response.get("timings") if isinstance(response, dict) else None,
    }


def normalize_freeform_messages(messages, allow_image_data_urls=False):
    if not isinstance(messages, list) or not messages:
        raise ValueError("Director Chat messages are required.")

    normalized = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("Director Chat messages must be objects.")
        role = str(message.get("role") or "").strip().lower()
        if role not in {"system", "user", "assistant"}:
            raise ValueError("Director Chat supports only system, user, and assistant messages.")

        raw_content = message.get("content")
        if isinstance(raw_content, list):
            parts = []
            for part in raw_content:
                if not isinstance(part, dict):
                    raise ValueError("Multimodal message content parts must be objects.")
                part_type = str(part.get("type") or "").strip().lower()
                if part_type == "text":
                    text = str(part.get("text") or "").strip()
                    if not text:
                        raise ValueError("Multimodal text content cannot be empty.")
                    parts.append({"type": "text", "text": text})
                    continue
                if part_type == "image_url":
                    image_url = part.get("image_url")
                    image_url = image_url if isinstance(image_url, dict) else {}
                    url = str(image_url.get("url") or "").strip()
                    if url.startswith("data:image/"):
                        parts.append({"type": "image_url", "image_url": {"url": url}})
                        continue
                    if not url.startswith("file://") or url.startswith("file:///"):
                        raise ValueError(
                            "Multimodal images must use an embedded data:image URL or a relative file:// URL."
                        )
                    relative = url[len("file://"):]
                    if (
                        not relative
                        or relative.startswith(("/", "\\"))
                        or "\\" in relative
                        or ":" in relative
                        or ".." in Path(relative).parts
                    ):
                        raise ValueError("Local multimodal image path is invalid.")
                    parts.append({"type": "image_url", "image_url": {"url": "file://" + relative}})
                    continue
                raise ValueError("Unsupported multimodal content type: " + (part_type or "empty"))
            if not parts:
                raise ValueError("Director Chat messages cannot be empty.")
            normalized.append({"role": role, "content": parts})
            continue

        content = str(raw_content or "").strip()
        if not content:
            raise ValueError("Director Chat messages cannot be empty.")
        normalized.append({"role": role, "content": content})
    return normalized

def run_freeform_chat(model_id, messages, gpu_reserved=False, max_tokens=None, context_size=None, assessment_evidence=False, response_schema=None, allow_image_data_urls=False):
    normalized = normalize_freeform_messages(messages, allow_image_data_urls=allow_image_data_urls)

    operation = "freeform_chat"
    with _request_lock:
        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.")
        _set_activity(
            "preparing",
            model_id=model_id,
            operation=operation,
            active=True,
            error="",
            model_size_bytes=0,
        )
        try:
            runtime_id, _raw_model_id = _split_model_ref(model_id)
            with _use_runtime(runtime_id):
                settings = _director_config()
            _set_activity(
                "preparing",
                model_id=model_id,
                operation=operation,
                context_size=(settings.get("context_size") or 0) if settings.get("mode", "local") == "local" else 0,
            )
            result = chat(
                model_id,
                normalized,
                response_schema=response_schema,
                max_tokens=max_tokens,
                context_size=context_size,
                gpu_reserved=bool(gpu_reserved),
                allow_truncated=True,
                assessment_evidence=assessment_evidence,
            )
            _set_activity(
                "complete",
                model_id=model_id,
                operation=operation,
                active=False,
                usage=result.get("usage"),
                timings=result.get("timings"),
            )
            print(
                "[Director Chat] request completed: model="
                + model_id
                + " messages=" + str(len(normalized))
                + " usage=" + json.dumps(result.get("usage") or {}, ensure_ascii=False)
                + " timings=" + json.dumps(result.get("timings") or {}, ensure_ascii=False),
                flush=True,
            )
            if settings.get("mode", "local") == "local":
                _relay_log_updates()
            return result
        except Exception as exc:
            if _stop_requested.is_set():
                _set_activity("stopped", model_id=model_id, operation=operation, active=False, error="")
            else:
                _set_activity("error", model_id=model_id, operation=operation, active=False, error=str(exc))
            raise


def run_contract(model_id, contract, gpu_reserved=False):
    if not isinstance(contract, dict):
        raise ValueError("Director contract must be an object.")
    prompt = str(contract.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Director contract prompt is empty.")

    operation = str(contract.get("operation") or "").strip()
    with _request_lock:
        if _stop_requested.is_set():
            raise RuntimeError("LLM request stopped.")
        _set_activity(
            "preparing",
            model_id=model_id,
            operation=operation,
            active=True,
            error="",
            model_size_bytes=0,
        )
        try:
            runtime_id, _raw_model_id = _split_model_ref(model_id)
            with _use_runtime(runtime_id):
                settings = _director_config()
            print(
                "[Director] request starting: operation="
                + (operation or "unknown")
                + " model=" + model_id
                + " prompt_chars=" + str(len(prompt))
                + " context=" + str(settings.get("context_size") if settings.get("context_size") is not None else "auto")
                + " max_output=" + str(settings.get("max_tokens") if settings.get("max_tokens") is not None else "auto"),
                flush=True,
            )
            _set_activity(
                "preparing",
                model_id=model_id,
                operation=operation,
                context_size=(settings.get("context_size") or 0) if settings.get("mode", "local") == "local" else 0,
            )
            chat_kwargs = {
                "response_schema": contract.get("response_schema"),
                "sampling": _sampling_profile(operation),
            }
            if gpu_reserved:
                chat_kwargs["gpu_reserved"] = True
            result = chat(
                model_id,
                [{"role": "user", "content": prompt}],
                **chat_kwargs,
            )
            if contract.get("output") == "json":
                try:
                    data = json.loads(result["text"])
                except (TypeError, json.JSONDecodeError) as exc:
                    raise RuntimeError("Director returned invalid structured JSON.") from exc
                if not isinstance(data, dict):
                    raise RuntimeError("Director structured output must be a JSON object.")
                result["data"] = data



            _set_activity(
                "complete",
                model_id=model_id,
                operation=operation,
                active=False,
                usage=result.get("usage"),
                timings=result.get("timings"),
            )
            print(
                "[Director] request completed: operation="
                + (operation or "unknown")
                + " model=" + model_id
                + " usage=" + json.dumps(result.get("usage") or {}, ensure_ascii=False)
                + " timings=" + json.dumps(result.get("timings") or {}, ensure_ascii=False),
                flush=True,
            )
            if settings.get("mode", "local") == "local":
                _relay_log_updates()
            return result
        except Exception as exc:
            if _stop_requested.is_set():
                _set_activity("stopped", model_id=model_id, operation=operation, active=False, error="")
            else:
                _set_activity("error", model_id=model_id, operation=operation, active=False, error=str(exc))
            raise


atexit.register(stop_server)
