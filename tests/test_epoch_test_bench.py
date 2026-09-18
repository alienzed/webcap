import copy
import json
from pathlib import Path

import pytest

from tool.server import epoch_test_bench as bench



def test_windows_curl_transport_posts_json_via_stdin(monkeypatch):
    calls = {}

    class Result:
        returncode = 0
        stdout = b'{"prompt_id":"abc"}'
        stderr = b""

    def fake_run(command, **kwargs):
        calls["command"] = command
        calls["input"] = kwargs.get("input")
        return Result()

    monkeypatch.setattr(bench, "_windows_curl_path", lambda: "/mnt/c/Windows/System32/curl.exe")
    monkeypatch.setattr(bench.subprocess, "run", fake_run)
    payload = {"prompt": {"1": {"inputs": {}}}}

    response = bench._read_json_response(
        "http://127.0.0.1:8188/prompt",
        method="POST",
        payload=payload,
        timeout=3,
    )

    assert response == {"prompt_id": "abc"}
    assert calls["command"][0] == "/mnt/c/Windows/System32/curl.exe"
    assert calls["command"][-1] == "http://127.0.0.1:8188/prompt"
    assert "--data-binary" in calls["command"]
    assert calls["command"][calls["command"].index("--data-binary") + 1] == "@-"
    assert json.loads(calls["input"].decode("utf-8")) == payload


def test_windows_curl_transport_reads_binary(monkeypatch):
    class Result:
        returncode = 0
        stdout = b"video-bytes"
        stderr = b""

    monkeypatch.setattr(bench, "_windows_curl_path", lambda: "/mnt/c/Windows/System32/curl.exe")
    monkeypatch.setattr(bench.subprocess, "run", lambda *args, **kwargs: Result())

    assert bench._read_bytes("http://127.0.0.1:8188/view?filename=test.mp4") == b"video-bytes"

def test_lora_files_are_filtered_and_sorted(tmp_path):
    (tmp_path / "epoch10.safetensors").write_bytes(b"")
    (tmp_path / "Epoch02.safetensors").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    files = bench._lora_files(tmp_path)

    assert [path.name for path in files] == ["Epoch02.safetensors", "epoch10.safetensors"]


def test_workflow_substitution_changes_only_test_inputs():
    template = {
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "fixed", "seed": 123}},
        "148": {"inputs": {"lora_name": "old.safetensors", "strength_model": 0.1, "strength_clip": 0.2}},
        "129": {"inputs": {"noise_seed": 999}},
        "138": {"inputs": {"lora_1": {"lora": "turbo.safetensors", "strength": 1}}},
    }
    original = copy.deepcopy(template)
    comfy_name = "mh3/test/set/epoch10.safetensors"

    workflow = bench._workflow_for_lora(template, "the prompt", comfy_name)

    assert template == original
    assert workflow["146"]["inputs"]["wildcard_text"] == "the prompt"
    assert workflow["146"]["inputs"]["populated_text"] == "the prompt"
    assert workflow["146"]["inputs"]["mode"] == "fixed"
    assert workflow["148"]["inputs"]["lora_name"] == "mh3/test/set/epoch10.safetensors"
    assert workflow["148"]["inputs"]["strength_model"] == 0.9
    assert workflow["148"]["inputs"]["strength_clip"] == 1
    assert workflow["129"] == original["129"]
    assert workflow["138"] == original["138"]


def test_find_video_ref_preserves_temp_type():
    outputs = {
        "141": {
            "gifs": [
                {
                    "filename": "mh3/test_00001.mp4",
                    "subfolder": "",
                    "type": "temp",
                }
            ]
        }
    }

    assert bench._find_video_ref(outputs) == {
        "filename": "mh3/test_00001.mp4",
        "subfolder": "",
        "type": "temp",
    }


def test_default_template_has_required_test_nodes():
    workflow = bench._load_template()

    assert workflow["129"]["class_type"] == "RandomNoise"
    assert workflow["138"]["class_type"] == "Power Lora Loader (rgthree)"
    assert workflow["141"]["class_type"] == "VHS_VideoCombine"
    assert workflow["146"]["class_type"] == "ImpactWildcardProcessor"
    assert workflow["148"]["class_type"] == "LoraLoader"
    assert workflow["148"]["inputs"]["strength_model"] == 0.9
    assert workflow["141"]["inputs"]["save_output"] is False
    assert bench._default_prompt(workflow)


def test_run_batch_stops_on_first_failure(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {
            "status": "running",
            "model": "h3",
            "prompt": "prompt",
            "total": 2,
            "completed": 0,
            "failed": 0,
            "current": "",
            "error": "",
        },
    )
    loras = [
        (Path("C:/ComfyUI/models/loras/mh3/set/epoch01.safetensors"), "mh3/set/epoch01.safetensors"),
        (Path("C:/ComfyUI/models/loras/mh3/set/epoch02.safetensors"), "mh3/set/epoch02.safetensors"),
    ]
    queued = []

    monkeypatch.setattr(bench, "_load_template", lambda: {
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    })

    def fail_queue(workflow):
        queued.append(workflow["148"]["inputs"]["lora_name"])
        raise RuntimeError("boom")

    monkeypatch.setattr(bench, "_queue_workflow", fail_queue)

    bench._run_batch("folder-key", session, loras, "prompt")

    status = bench._read_status(session)
    assert queued == ["mh3/set/epoch01.safetensors"]
    assert status["status"] == "failed"
    assert status["completed"] == 0
    assert status["failed"] == 1
    assert status["error"] == "boom"


def test_staged_lora_provenance_reads_copy_to_test_sidecar(tmp_path):
    lora = tmp_path / "run-03__epoch24.safetensors"
    lora.write_bytes(b"weights")
    lora.with_suffix(".webcap.json").write_text(
        '{"sourceJobId":"abc","sourceEpoch":24,"sourceRunSequence":"03"}',
        encoding="utf-8",
    )

    assert bench._staged_lora_provenance(lora) == {
        "sourceJobId": "abc",
        "sourceEpoch": 24,
        "sourceRunSequence": "03",
    }


def test_workflow_seed_uses_fixed_random_noise_seed():
    assert bench._workflow_seed({"129": {"inputs": {"noise_seed": 12345}}}) == 12345
