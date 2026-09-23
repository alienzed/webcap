import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from . import config as app_config
from .execution_queue import get_job as execution_get_job, update_job as execution_update_job


COMFY_BASE_URL = "http://127.0.0.1:8188"
GENERATION_TIMEOUT_SECONDS = 45 * 60
COMFY_JOB_MISSING_GRACE_SECONDS = 10


class InferenceStopped(RuntimeError):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def _windows_curl_path():
    is_wsl = bool(os.environ.get("WSL_INTEROP") or os.environ.get("WSL_DISTRO_NAME"))
    if not is_wsl:
        try:
            is_wsl = "microsoft" in Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8").lower()
        except OSError:
            is_wsl = False
    candidate = Path("/mnt/c/Windows/System32/curl.exe")
    return str(candidate) if is_wsl and candidate.is_file() else None


def _windows_curl_request(curl_path, url, method="GET", payload=None, timeout=10):
    command = [
        curl_path,
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--max-time",
        str(timeout),
        "--request",
        method,
    ]
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        command.extend(["--header", "Content-Type: application/json", "--data-binary", "@-"])
    command.append(url)
    try:
        result = subprocess.run(
            command,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout + 3,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("Timed out contacting ComfyUI.") from exc
    if result.returncode != 0:
        detail = (
            result.stdout.decode("utf-8", errors="replace").strip()
            or result.stderr.decode("utf-8", errors="replace").strip()
        )
        raise RuntimeError("ComfyUI request failed: " + detail)
    return result.stdout


def _read_json_response(url, method="GET", payload=None, timeout=10):
    curl_path = _windows_curl_path()
    if curl_path:
        body = _windows_curl_request(curl_path, url, method=method, payload=payload, timeout=timeout)
    else:
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {"Content-Type": "application/json"} if payload is not None else {}
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace").strip()
            raise RuntimeError("ComfyUI request failed: " + (detail or str(exc))) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ConnectionError("Could not connect to ComfyUI.") from exc
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ComfyUI returned invalid JSON.") from exc


def _read_bytes(url, timeout=60):
    curl_path = _windows_curl_path()
    if curl_path:
        return _windows_curl_request(curl_path, url, timeout=timeout)
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("Could not retrieve the generated ComfyUI output.") from exc


def system_stats():
    return _read_json_response(COMFY_BASE_URL + "/system_stats", timeout=3)


def _normalize_name(value):
    return "/".join(
        segment
        for segment in str(value or "").replace("\\", "/").split("/")
        if segment
    ).casefold()


def available_names(node_type, input_name, label):
    payload = _read_json_response(
        COMFY_BASE_URL + "/object_info/" + urllib.parse.quote(str(node_type), safe=""),
        timeout=5,
    )
    node = payload.get(node_type) if isinstance(payload, dict) else None
    inputs = node.get("input") if isinstance(node, dict) and isinstance(node.get("input"), dict) else {}
    required = inputs.get("required") if isinstance(inputs.get("required"), dict) else {}
    optional = inputs.get("optional") if isinstance(inputs.get("optional"), dict) else {}
    spec = required.get(input_name)
    if spec is None:
        spec = optional.get(input_name)
    choices = spec[0] if isinstance(spec, (list, tuple)) and spec else None
    if not isinstance(choices, (list, tuple)):
        raise RuntimeError("ComfyUI did not expose available " + label + " names for " + str(node_type) + ".")
    names = [str(name) for name in choices if str(name).strip()]
    if not names:
        raise RuntimeError("ComfyUI reports no " + label + " files available to " + str(node_type) + ".")
    return names


def resolve_name(configured_name, available, label):
    configured = str(configured_name or "").strip()
    normalized = _normalize_name(configured)
    records = [
        (name, _normalize_name(name), Path(str(name).replace("\\", "/")).name.casefold())
        for name in available
    ]
    suffix_matches = [
        name for name, available_normalized, _ in records
        if normalized == available_normalized or normalized.endswith("/" + available_normalized)
    ]
    if len(suffix_matches) == 1:
        return suffix_matches[0]
    basename = Path(configured.replace("\\", "/")).name.casefold()
    basename_matches = [name for name, _, record_basename in records if record_basename == basename]
    if len(basename_matches) == 1:
        return basename_matches[0]
    display_name = Path(configured.replace("\\", "/")).name or configured
    if not basename_matches:
        raise RuntimeError("ComfyUI cannot see " + label + ": " + display_name)
    raise RuntimeError("ComfyUI " + label + " name is ambiguous: " + display_name)


def resolve_wildcard_prompt(prompt, seed):
    response = _read_json_response(
        COMFY_BASE_URL + "/impact/wildcards",
        method="POST",
        payload={"text": str(prompt or ""), "seed": int(seed)},
        timeout=10,
    )
    resolved = str(response.get("text") or "").strip() if isinstance(response, dict) else ""
    if not resolved:
        raise RuntimeError("Impact Pack did not return a resolved prompt.")
    return resolved


def queue_workflow(workflow):
    prompt_id = str(uuid.uuid4())
    response = _read_json_response(
        COMFY_BASE_URL + "/prompt",
        method="POST",
        payload={"prompt": workflow, "prompt_id": prompt_id},
    )
    returned_id = str(response.get("prompt_id") or "").strip() if isinstance(response, dict) else ""
    if returned_id != prompt_id:
        raise RuntimeError("ComfyUI did not accept the requested inference job ID.")
    return prompt_id


def read_job(prompt_id):
    url = COMFY_BASE_URL + "/api/jobs/" + urllib.parse.quote(str(prompt_id or ""), safe="")
    try:
        payload = _read_json_response(url)
    except RuntimeError as exc:
        if "404" in str(exc):
            return None
        raise
    if not isinstance(payload, dict):
        raise RuntimeError("ComfyUI returned invalid inference job status.")
    return payload


def cancel_job(prompt_id):
    job_id = str(prompt_id or "").strip()
    if not job_id:
        return False
    response = _read_json_response(
        COMFY_BASE_URL + "/api/jobs/" + urllib.parse.quote(job_id, safe="") + "/cancel",
        method="POST",
        timeout=5,
    )
    return bool(response.get("cancelled")) if isinstance(response, dict) else False


def _format_error(job):
    error = job.get("execution_error") if isinstance(job, dict) and isinstance(job.get("execution_error"), dict) else {}
    message = str(error.get("exception_message") or "").strip()
    node_id = str(error.get("node_id") or "").strip()
    node_type = str(error.get("node_type") or "").strip()
    detail = message or "ComfyUI reported an execution error."
    node = " / ".join(value for value in (node_id, node_type) if value)
    return detail + ((" (" + node + ")") if node else "")


def wait_for_output(prompt_id, execution_job_id, find_output_ref):
    deadline = time.monotonic() + GENERATION_TIMEOUT_SECONDS
    missing_since = None
    while True:
        if time.monotonic() >= deadline:
            raise RuntimeError("Timed out waiting for ComfyUI inference to finish.")

        queue_job = execution_get_job(execution_job_id)
        requested_action = str(queue_job.get("requestedAction") or "")
        if requested_action in ("stop", "cancel"):
            cancel_job(prompt_id)
            status = "cancelled" if requested_action == "cancel" else "stopped"
            raise InferenceStopped(status, "Inference " + status + ".")

        job = read_job(prompt_id)
        if job is None:
            if missing_since is None:
                missing_since = time.monotonic()
            if time.monotonic() - missing_since >= COMFY_JOB_MISSING_GRACE_SECONDS:
                raise RuntimeError("ComfyUI lost inference job " + prompt_id + "; ComfyUI may have restarted.")
            time.sleep(2)
            continue

        missing_since = None
        status = str(job.get("status") or "").strip().lower()
        execution_update_job(execution_job_id, details={"providerStatus": status})
        if status in ("pending", "in_progress"):
            time.sleep(2)
            continue
        if status == "failed":
            raise RuntimeError(_format_error(job))
        if status == "cancelled":
            raise InferenceStopped("cancelled", "ComfyUI cancelled this inference.")
        if status == "completed":
            output = find_output_ref(job.get("outputs") or {})
            if not output:
                raise RuntimeError("ComfyUI completed inference without a supported output.")
            return output
        raise RuntimeError("ComfyUI returned unknown inference status: " + (status or "empty") + ".")


def download_output(output_ref):
    query = urllib.parse.urlencode({
        "filename": output_ref["filename"],
        "subfolder": output_ref.get("subfolder") or "",
        "type": output_ref.get("type") or "output",
    })
    return _read_bytes(COMFY_BASE_URL + "/view?" + query)


def upload_image(image_path, subfolder, filename=None):
    path = Path(image_path)
    if not path.is_file():
        raise FileNotFoundError("Inference reference image does not exist: " + str(path))

    upload_name = str(filename or path.name)
    boundary = "----WebCapInference" + uuid.uuid4().hex
    crlf = "\r\n"
    parts = []

    def field(name, value):
        parts.append(("--" + boundary + crlf).encode("utf-8"))
        parts.append(('Content-Disposition: form-data; name="' + name + '"' + crlf + crlf).encode("utf-8"))
        parts.append(str(value).encode("utf-8"))
        parts.append(crlf.encode("utf-8"))

    parts.append(("--" + boundary + crlf).encode("utf-8"))
    parts.append((
        'Content-Disposition: form-data; name="image"; filename="' + upload_name.replace('"', "") + '"' + crlf
        + "Content-Type: application/octet-stream" + crlf + crlf
    ).encode("utf-8"))
    parts.append(path.read_bytes())
    parts.append(crlf.encode("utf-8"))
    field("overwrite", "true")
    field("type", "input")
    field("subfolder", subfolder)
    parts.append(("--" + boundary + "--" + crlf).encode("utf-8"))
    body = b"".join(parts)
    content_type = "multipart/form-data; boundary=" + boundary

    curl_path = _windows_curl_path()
    if curl_path:
        command = [
            curl_path,
            "--silent",
            "--show-error",
            "--fail-with-body",
            "--max-time",
            "60",
            "--request",
            "POST",
            "--header",
            "Content-Type: " + content_type,
            "--data-binary",
            "@-",
            COMFY_BASE_URL + "/upload/image",
        ]
        try:
            result = subprocess.run(
                command,
                input=body,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=65,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError("Could not upload inference reference image to ComfyUI.") from exc
        if result.returncode != 0:
            detail = (
                result.stdout.decode("utf-8", errors="replace").strip()
                or result.stderr.decode("utf-8", errors="replace").strip()
            )
            raise RuntimeError("ComfyUI reference upload failed: " + (detail or "curl.exe failed."))
        response_body = result.stdout
    else:
        request = urllib.request.Request(
            COMFY_BASE_URL + "/upload/image",
            data=body,
            headers={"Content-Type": content_type},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                response_body = response.read()
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError("Could not upload inference reference image to ComfyUI.") from exc

    try:
        payload = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("ComfyUI returned invalid reference-upload JSON.") from exc
    name = str(payload.get("name") or "").strip() if isinstance(payload, dict) else ""
    returned_subfolder = str(payload.get("subfolder") or "").strip() if isinstance(payload, dict) else ""
    if not name:
        raise RuntimeError("ComfyUI did not return the uploaded reference image name.")
    return (returned_subfolder.rstrip("/\\") + "/" + name) if returned_subfolder else name
