import copy
import json
from pathlib import Path

import pytest

from tool.server import epoch_test_bench as bench


def patch_default_test_model(monkeypatch, template=None, settings=None):
    model = bench.get_test_model()
    monkeypatch.setattr(bench, "get_test_model", lambda _profile_id=None: model)
    if template is not None:
        monkeypatch.setattr(model, "load_template", lambda: copy.deepcopy(template))
    if settings is not None:
        monkeypatch.setattr(
            model,
            "normalize_settings",
            lambda _template, _new_seed, _values=None: dict(settings),
        )
    return model



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


def test_windows_curl_transport_surfaces_http_response_body(monkeypatch):
    class Result:
        returncode = 22
        stdout = b'{"error":{"type":"prompt_outputs_failed_validation","details":"bad node"}}'
        stderr = b"curl: (22) The requested URL returned error: 400"

    monkeypatch.setattr(bench.subprocess, "run", lambda *_args, **_kwargs: Result())

    with pytest.raises(RuntimeError) as exc:
        bench._windows_curl_request(
            "/mnt/c/Windows/System32/curl.exe",
            "http://127.0.0.1:8188/prompt",
            method="POST",
            payload={"prompt": {}},
        )

    assert "prompt_outputs_failed_validation" in str(exc.value)
    assert "bad node" in str(exc.value)


def test_queue_workflow_supplies_stable_uuid_to_comfy(monkeypatch):
    calls = []

    def fake_request(url, method="GET", payload=None, timeout=10):
        calls.append((url, method, payload))
        return {"prompt_id": payload["prompt_id"]}

    monkeypatch.setattr(bench, "_read_json_response", fake_request)

    prompt_id = bench._queue_workflow({"1": {"inputs": {}}})

    assert calls[0][0] == bench.COMFY_BASE_URL + "/prompt"
    assert calls[0][1] == "POST"
    assert calls[0][2]["prompt"] == {"1": {"inputs": {}}}
    assert calls[0][2]["prompt_id"] == prompt_id
    assert len(prompt_id) == 36


def test_wait_for_video_uses_jobs_api_and_records_live_status(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(session / "test.json", {"status": "running"})
    prompt_id = "11111111-1111-1111-1111-111111111111"
    jobs = [
        {"id": prompt_id, "status": "pending"},
        {"id": prompt_id, "status": "in_progress"},
        {
            "id": prompt_id,
            "status": "completed",
            "outputs": {
                "141": {
                    "gifs": [{
                        "filename": "render.mp4",
                        "subfolder": "webcap-tests",
                        "type": "output",
                    }]
                }
            },
        },
    ]

    monkeypatch.setattr(bench, "_read_comfy_job", lambda _prompt_id: jobs.pop(0))
    monkeypatch.setattr(bench.time, "sleep", lambda _seconds: None)

    result = bench._wait_for_video(prompt_id, timeout=5, session_directory=session)

    assert result["filename"] == "render.mp4"
    status = bench._read_status(session)
    assert status["comfyJobId"] == prompt_id
    assert status["comfyStatus"] == "completed"
    assert status["comfyLastContactAt"]


def test_wait_for_video_surfaces_structured_comfy_error(monkeypatch):
    prompt_id = "11111111-1111-1111-1111-111111111111"
    monkeypatch.setattr(bench, "_read_comfy_job", lambda _prompt_id: {
        "id": prompt_id,
        "status": "failed",
        "execution_error": {
            "node_id": "148",
            "node_type": "LoraLoader",
            "exception_message": "LoRA is missing",
        },
    })

    with pytest.raises(RuntimeError, match=r"LoRA is missing .*148 / LoraLoader"):
        bench._wait_for_video(prompt_id, timeout=5)


def test_lora_files_are_filtered_and_sorted(tmp_path):
    (tmp_path / "epoch10.safetensors").write_bytes(b"")
    (tmp_path / "Epoch02.safetensors").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    files = bench._lora_files(tmp_path)

    assert [path.name for path in files] == ["Epoch02.safetensors", "epoch10.safetensors"]


def test_resolve_wildcard_prompt_uses_impact_endpoint_once(monkeypatch):
    calls = []

    def fake_request(url, method="GET", payload=None, timeout=10):
        calls.append((url, method, payload, timeout))
        return {"text": "a blue garment"}

    monkeypatch.setattr(bench, "_read_json_response", fake_request)

    resolved = bench._resolve_wildcard_prompt("a {red|blue} garment", 4242)

    assert resolved == "a blue garment"
    assert calls == [
        (
            bench.COMFY_BASE_URL + "/impact/wildcards",
            "POST",
            {"text": "a {red|blue} garment", "seed": 4242},
            10,
        )
    ]


def test_workflow_can_disable_test_lora_for_base():
    template = {
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "populate", "seed": 123}},
        "148": {"inputs": {"lora_name": "old.safetensors", "strength_model": 0.9, "strength_clip": 1}},
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 999}},
        "133": {"inputs": {"value": 7}},
    }

    workflow = bench._workflow_for_lora(
        template,
        "resolved prompt",
        "mh3/test/set/epoch10.safetensors",
        strength_model=0,
        strength_clip=0,
    )

    assert workflow["146"]["inputs"]["mode"] == "fixed"
    assert workflow["146"]["inputs"]["populated_text"] == "resolved prompt"
    assert workflow["148"]["inputs"]["strength_model"] == 0
    assert workflow["148"]["inputs"]["strength_clip"] == 0


def test_workflow_substitution_changes_only_test_inputs():
    template = {
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "fixed", "seed": 123}},
        "148": {"inputs": {"lora_name": "old.safetensors", "strength_model": 0.1, "strength_clip": 0.2}},
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 999}},
        "133": {"inputs": {"value": 7}},
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
    assert workflow["115"] == original["115"]
    assert workflow["129"] == original["129"]
    assert workflow["133"] == original["133"]
    assert workflow["138"] == original["138"]


def test_find_video_ref_preserves_saved_output_path():
    outputs = {
        "141": {
            "gifs": [
                {
                    "filename": "h3-test_00001.mp4",
                    "subfolder": "webcap-tests",
                    "type": "output",
                    "fullpath": "C:/ComfyUI/output/webcap-tests/h3-test_00001.mp4",
                }
            ]
        }
    }

    assert bench._find_video_ref(outputs) == {
        "filename": "h3-test_00001.mp4",
        "subfolder": "webcap-tests",
        "type": "output",
        "fullpath": "C:/ComfyUI/output/webcap-tests/h3-test_00001.mp4",
    }


def test_move_saved_video_moves_exact_comfy_output(tmp_path):
    source = tmp_path / "comfy-output.mp4"
    destination = tmp_path / "session" / "epoch10.mp4"
    destination.parent.mkdir()
    source.write_bytes(b"workflow-bearing-video")

    moved = bench._move_saved_video(
        {"filename": source.name, "type": "output", "fullpath": str(source)},
        destination,
    )

    assert moved == destination
    assert destination.read_bytes() == b"workflow-bearing-video"
    assert not source.exists()


def test_move_saved_video_rejects_temp_output(tmp_path):
    source = tmp_path / "temp.mp4"
    source.write_bytes(b"video")

    with pytest.raises(RuntimeError, match="not saved to the output directory"):
        bench._move_saved_video(
            {"filename": source.name, "type": "temp", "fullpath": str(source)},
            tmp_path / "result.mp4",
        )


def test_move_saved_video_falls_back_to_comfy_view_when_fullpath_is_missing(tmp_path, monkeypatch):
    destination = tmp_path / "session" / "epoch10.mp4"
    destination.parent.mkdir()
    monkeypatch.setattr(bench, "_download_video", lambda _ref: b"workflow-bearing-video")

    moved = bench._move_saved_video(
        {"filename": "render_00001.mp4", "subfolder": "webcap-tests/session/candidate", "type": "output"},
        destination,
    )

    assert moved == destination
    assert destination.read_bytes() == b"workflow-bearing-video"


def test_default_template_has_required_test_nodes():
    workflow = bench._load_template()

    assert workflow["129"]["class_type"] == "RandomNoise"
    assert workflow["138"]["class_type"] == "Power Lora Loader (rgthree)"
    assert workflow["141"]["class_type"] == "VHS_VideoCombine"
    assert workflow["146"]["class_type"] == "ImpactWildcardProcessor"
    assert workflow["148"]["class_type"] == "LoraLoader"
    assert workflow["148"]["inputs"]["strength_model"] == 0.9
    assert workflow["141"]["inputs"]["save_metadata"] is True
    assert workflow["141"]["inputs"]["save_output"] is True
    assert workflow["141"]["inputs"]["filename_prefix"] == "webcap-tests/h3-test"
    assert workflow["162"]["class_type"] == "VHS_PruneOutputs"
    assert workflow["162"]["inputs"]["options"] == "Intermediate and Utility"
    assert workflow["162"]["inputs"]["filenames"] == ["141", 0]
    assert bench._default_prompt(workflow)


def test_run_batch_adds_base_and_continues_after_candidate_failure(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {
            "status": "running",
            "model": "h3",
            "prompt": "prompt",
            "total": 3,
            "completed": 0,
            "failed": 0,
            "failures": [],
            "current": "",
            "error": "",
        },
    )
    loras = [
        Path("C:/ComfyUI/models/loras/mh3/set/epoch01.safetensors"),
        Path("C:/ComfyUI/models/loras/mh3/set/epoch02.safetensors"),
    ]
    queued = []
    monkeypatch.setattr(
        bench.get_test_model().adapter,
        "available_lora_names",
        lambda _available_names: ["mh3/set/epoch01.safetensors", "mh3/set/epoch02.safetensors"],
    )

    template = {
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }

    def queue(workflow):
        if "148" not in workflow:
            return "prompt-ok"
        item = (
            workflow["148"]["inputs"]["lora_name"],
            workflow["148"]["inputs"]["strength_model"],
            workflow["148"]["inputs"]["strength_clip"],
        )
        queued.append(item)
        if item[0].endswith("epoch01.safetensors"):
            raise RuntimeError("boom")
        return "prompt-ok"

    monkeypatch.setattr(bench, "_queue_workflow", queue)
    monkeypatch.setattr(
        bench,
        "_wait_for_output",
        lambda _model, _prompt_id, **_kwargs: {"filename": "ok.mp4", "type": "output", "fullpath": "C:/ComfyUI/output/ok.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_output",
        lambda _video_ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    bench._run_batch("folder-key", session, loras, "prompt", template=template)

    status = bench._read_status(session)
    assert queued == [
        ("mh3/set/epoch01.safetensors", 0.9, 1),
        ("mh3/set/epoch02.safetensors", 0.9, 1),
    ]
    assert status["status"] == "complete"
    assert status["completed"] == 2
    assert status["failed"] == 1
    assert status["failures"][0]["sourceLoRA"] == "epoch01.safetensors"
    assert [result["sourceLoRA"] for result in status["results"]] == ["Base", "epoch02.safetensors"]
    assert status["results"][0]["kind"] == "base"
    assert status["results"][0]["mediaFile"] == "base.mp4"


def test_run_batch_persists_elapsed_ms_for_success_and_failure(tmp_path, monkeypatch):
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
            "failures": [],
            "results": [],
            "current": "",
            "error": "",
        },
    )
    lora = Path("C:/ComfyUI/models/loras/mh3/run-03__epoch24.safetensors")
    times = iter([100.0, 107.5, 200.0, 201.75])

    monkeypatch.setattr(bench.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(
        bench.get_test_model().adapter,
        "available_lora_names",
        lambda _available_names: ["mh3/run-03__epoch24.safetensors"],
    )
    template = {
        "115": {"inputs": {"aspect_ratio": "2:3", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }

    def queue(workflow):
        if "148" in workflow:
            raise RuntimeError("candidate boom")
        return "base-prompt"

    monkeypatch.setattr(bench, "_queue_workflow", queue)
    monkeypatch.setattr(
        bench,
        "_wait_for_output",
        lambda _model, _prompt_id, **_kwargs: {
            "filename": "base.mp4",
            "type": "output",
            "fullpath": "C:/ComfyUI/output/base.mp4",
        },
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_output",
        lambda _ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    bench._run_batch("folder-key", session, [lora], "prompt", template=template)

    persisted = json.loads((session / "test.json").read_text(encoding="utf-8"))
    assert persisted["results"][0]["sourceLoRA"] == "Base"
    assert persisted["results"][0]["elapsedMs"] == 7500
    assert persisted["failures"][0]["sourceLoRA"] == lora.name
    assert persisted["failures"][0]["elapsedMs"] == 1750
    assert persisted["results"][0]["elapsedMs"] >= 0
    assert persisted["failures"][0]["elapsedMs"] >= 0


def test_base_generation_does_not_depend_on_candidate_lora_inventory(tmp_path, monkeypatch):
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
            "failures": [],
            "current": "",
            "error": "",
        },
    )
    lora = Path("C:/ComfyUI/models/loras/mh3/set/epoch01.safetensors")
    monkeypatch.setattr(
        bench.get_test_model().adapter,
        "available_lora_names",
        lambda _available_names: (_ for _ in ()).throw(RuntimeError("no candidate LoRAs available")),
    )
    template = {
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "138": {"inputs": {"model": ["148", 0], "clip": ["148", 1]}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }
    monkeypatch.setattr(bench, "_queue_workflow", lambda _workflow: "prompt-ok")
    monkeypatch.setattr(
        bench,
        "_wait_for_output",
        lambda _model, _prompt_id, **_kwargs: {"filename": "ok.mp4", "type": "output", "fullpath": "C:/ComfyUI/output/ok.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_output",
        lambda _video_ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    bench._run_batch("folder-key", session, [lora], "prompt", template=template)

    status = bench._read_status(session)
    assert status["status"] == "complete"
    assert status["completed"] == 1
    assert status["failed"] == 1
    assert [result["sourceLoRA"] for result in status["results"]] == ["Base"]
    assert status["failures"][0]["sourceLoRA"] == lora.name


def test_run_batch_records_missing_candidate_and_continues(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {
            "status": "running",
            "model": "h3",
            "prompt": "prompt",
            "total": 3,
            "completed": 0,
            "failed": 0,
            "failures": [],
            "current": "",
            "error": "",
        },
    )
    first = Path("C:/ComfyUI/models/loras/mh3/set/epoch01.safetensors")
    missing = Path("C:/ComfyUI/models/loras/mh3/set/epoch02.safetensors")
    monkeypatch.setattr(
        bench.get_test_model().adapter,
        "available_lora_names",
        lambda _available_names: ["mh3/set/epoch01.safetensors"],
    )
    template = {
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }
    monkeypatch.setattr(bench, "_queue_workflow", lambda _workflow: "prompt-ok")
    monkeypatch.setattr(
        bench,
        "_wait_for_output",
        lambda _model, _prompt_id, **_kwargs: {"filename": "ok.mp4", "type": "output", "fullpath": "C:/ComfyUI/output/ok.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_output",
        lambda _video_ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    bench._run_batch("folder-key", session, [first, missing], "prompt", template=template)

    status = bench._read_status(session)
    assert status["status"] == "complete"
    assert status["completed"] == 2
    assert status["failed"] == 1
    assert status["failures"][0]["sourceLoRA"] == missing.name
    assert [result["sourceLoRA"] for result in status["results"]] == ["Base", first.name]


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


def test_workflow_applies_session_settings_without_mutating_template():
    template = {
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 111}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "old", "populated_text": "old", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "old.safetensors", "strength_model": 0.9, "strength_clip": 1}},
    }
    original = copy.deepcopy(template)
    settings = {
        "aspectRatio": "16:9 (Widescreen)",
        "megapixels": 0.35,
        "duration": 10,
        "seed": 424242,
    }

    workflow = bench._workflow_for_lora(template, "prompt", "set/epoch10.safetensors", settings=settings)

    assert template == original
    assert workflow["115"]["inputs"]["aspect_ratio"] == "16:9 (Widescreen)"
    assert workflow["115"]["inputs"]["megapixels"] == 0.35
    assert workflow["133"]["inputs"]["value"] == 10
    assert workflow["129"]["inputs"]["noise_seed"] == 424242


def test_base_workflow_bypasses_candidate_lora_loader():
    template = bench._load_template()
    workflow = bench._workflow_for_lora(template, "prompt", None)

    assert "148" not in workflow
    assert workflow["138"]["inputs"]["model"] == ["161", 0]
    assert workflow["138"]["inputs"]["clip"] == ["128", 0]


def test_new_session_seed_is_javascript_safe():
    seed = bench._new_session_seed()
    assert 0 <= seed < 2 ** 53


def test_visible_status_marks_persisted_running_session_interrupted_without_worker(tmp_path, monkeypatch):
    session = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-17_2150-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(
        session / "test.json",
        {"status": "running", "completed": 1, "total": 10, "current": "epoch02.safetensors", "error": ""},
    )
    monkeypatch.setattr(bench, "_active_threads", {})

    status = bench._visible_status(tmp_path)

    assert status["status"] == "interrupted"
    assert status["completed"] == 1
    assert status["total"] == 10
    assert status["current"] == ""
    assert "restarted" in status["error"]


def test_run_batch_marks_failed_when_template_load_fails(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {"status": "running", "completed": 0, "total": 1, "current": "", "error": ""},
    )
    class FailingModel:
        def load_template(self):
            raise RuntimeError("template boom")

    bench._run_batch("folder-key", session, [], "prompt", model=FailingModel())

    status = bench._read_status(session)
    assert status["status"] == "failed"
    assert status["error"] == "template boom"



def test_available_comfy_names_accepts_optional_combo_inputs(monkeypatch):
    monkeypatch.setattr(
        bench,
        "_read_json_response",
        lambda *_args, **_kwargs: {
            "CustomNode": {
                "input": {
                    "required": {},
                    "optional": {
                        "dimensions": [[" 832 x 1216  (portrait)", "1024 x 1024 (square)"]]
                    },
                }
            }
        },
    )

    assert bench._available_comfy_names("CustomNode", "dimensions", "dimensions") == [
        " 832 x 1216  (portrait)",
        "1024 x 1024 (square)",
    ]


def test_template_assets_resolve_to_names_exposed_by_comfy(monkeypatch):
    template = {
        "119": {"inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}},
        "120": {"inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}},
        "127": {"inputs": {"unet_name": "mh3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors"}},
        "128": {"inputs": {"clip_name": "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"}},
        "138": {"inputs": {
            "lora_1": {"on": True, "lora": "mh3\\minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"},
            "lora_2": {"on": False, "lora": "mh3\\disabled.safetensors"},
        }},
    }
    original = copy.deepcopy(template)
    available = {
        ("UNETLoader", "unet_name"): ["mh3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"],
        ("CLIPLoader", "clip_name"): ["qwen3vl_32b_minimax_h3_int8_convrot.safetensors"],
        ("VAELoader", "vae_name"): [
            "minimax_h3_video_vae_fp16.safetensors",
            "minimax_h3_audio_vae_fp32.safetensors",
        ],
        ("LoraLoader", "lora_name"): ["mh3/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"],
    }
    monkeypatch.setattr(
        bench,
        "_available_comfy_names",
        lambda node_type, input_name, _label: available[(node_type, input_name)],
    )

    resolved = bench._resolve_comfy_template_assets(template)

    assert template == original
    assert resolved["127"]["inputs"]["unet_name"] == "mh3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
    assert resolved["128"]["inputs"]["clip_name"] == "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
    assert resolved["119"]["inputs"]["vae_name"] == "minimax_h3_video_vae_fp16.safetensors"
    assert resolved["120"]["inputs"]["vae_name"] == "minimax_h3_audio_vae_fp32.safetensors"
    assert resolved["138"]["inputs"]["lora_1"]["lora"] == "mh3/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"
    assert resolved["138"]["inputs"]["lora_2"]["lora"] == "mh3\\disabled.safetensors"


def test_comfy_name_resolution_fails_loudly_when_asset_is_missing():
    with pytest.raises(RuntimeError, match="cannot see diffusion model"):
        bench._resolve_comfy_name(
            "mh3\\missing.safetensors",
            ["mh3/other.safetensors"],
            "diffusion model",
        )


def test_run_batch_uses_resolved_template_passed_by_start(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {"status": "running", "completed": 0, "total": 1, "current": "", "error": ""},
    )
    lora = Path("epoch01.safetensors")
    resolved_template = {
        "115": {"inputs": {"aspect_ratio": "2:3", "megapixels": 0.2}},
        "127": {"inputs": {"unet_name": "mh3/linux-model.safetensors"}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }
    seen = []
    model = bench.get_test_model()
    monkeypatch.setattr(model, "load_template", lambda: pytest.fail("worker must use the resolved template from start"))
    monkeypatch.setattr(bench, "_queue_workflow", lambda workflow: seen.append(workflow["127"]["inputs"]["unet_name"]) or "prompt-id")
    monkeypatch.setattr(
        bench,
        "_wait_for_output",
        lambda _model, _prompt_id, **_kwargs: {"filename": "x.mp4", "subfolder": "webcap-tests", "type": "output", "fullpath": "C:/ComfyUI/output/webcap-tests/x.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_output",
        lambda _ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    monkeypatch.setattr(
        bench.get_test_model().adapter,
        "available_lora_names",
        lambda _available_names: ["mh3/epoch01.safetensors"],
    )

    bench._run_batch(
        "folder-key",
        session,
        [lora],
        "prompt",
        template=resolved_template,
        model=model,
    )

    assert seen == ["mh3/linux-model.safetensors", "mh3/linux-model.safetensors"]
    assert bench._read_status(session)["status"] == "complete"



def test_prepare_exposes_supported_test_aspect_ratios(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "epoch01.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_visible_status", lambda _folder, model_id=None: {"status": "idle"})

    payload = bench.prepare(tmp_path)

    assert payload["aspectRatioOptions"] == list(bench.TEST_ASPECT_RATIO_OPTIONS)
    assert payload["defaults"]["aspectRatio"] == "4:3 (Standard)"


def test_prepare_survives_optional_setting_choice_failure(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "epoch01.safetensors").write_bytes(b"weights")
    model = bench.get_test_model("krea2_raw")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_visible_status", lambda _folder, model_id=None: {"status": "idle"})
    monkeypatch.setattr(
        model,
        "setting_options",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("ComfyUI did not expose dimensions choices.")
        ),
    )

    payload = bench.prepare(tmp_path, model_id="krea2_raw")

    assert payload["modelId"] == "krea2_raw"
    assert payload["defaults"]["dimensions"] == model.template_settings(model.load_template())["dimensions"]
    assert payload["settingOptions"] == {}
    assert payload["warnings"] == [
        "Could not load optional Test setting choices from ComfyUI: "
        "ComfyUI did not expose dimensions choices."
    ]


def test_normalized_test_settings_rejects_unknown_aspect_ratio():
    with pytest.raises(ValueError, match="Unsupported Test Generations aspect ratio"):
        bench._normalized_test_settings(bench._load_template(), aspect_ratio="5:4 (Unsupported)")


def test_legacy_session_status_uses_default_test_model(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    session = tmp_path / "set" / bench.TEST_RESULTS_DIR / "2026-09-21_2159-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "results": [],
    })

    status = bench.open_session("set", session.name)

    assert status["modelId"] == bench.get_test_model().PROFILE_ID


def test_rating_summary_reads_standard_folder_ratings(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    session = tmp_path / "set" / bench.TEST_RESULTS_DIR / "2026-09-21_2200-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": bench.get_test_model().PROFILE_ID,
        "results": [{
            "kind": "lora",
            "candidateFile": "run-03__epoch24.safetensors",
            "sourceLoRA": "run-03__epoch24.safetensors",
            "mediaFile": "epoch24.mp4",
        }],
    })
    (session / ".webcap_state.json").write_text(
        json.dumps({"ratings_by_media": {"epoch24.mp4": 4}}),
        encoding="utf-8",
    )

    payload = bench.rating_summary("set", model_id=bench.get_test_model().PROFILE_ID)

    assert payload["candidateScores"]["run-03__epoch24.safetensors"] == {"average": 4.0, "count": 1}
    assert payload["sessions"][0]["unrated"] == 0


def test_remove_candidate_deletes_only_staged_copy_and_sidecar(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "run-01__epoch10.safetensors"
    candidate.write_bytes(b"copy")
    candidate.with_suffix(".webcap.json").write_text("{}", encoding="utf-8")
    other = staged / "run-02__epoch20.safetensors"
    other.write_bytes(b"keep")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    payload = bench.remove_candidate(tmp_path, candidate.name)

    assert not candidate.exists()
    assert not candidate.with_suffix(".webcap.json").exists()
    assert other.exists()
    assert payload["count"] == 1
    assert payload["files"] == [other.name]


def test_stop_marks_active_session_stopping_and_cancels_its_comfy_job(tmp_path, monkeypatch):
    class ActiveThread:
        def is_alive(self):
            return True

    session = tmp_path / "session"
    session.mkdir()
    prompt_id = "11111111-1111-1111-1111-111111111111"
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "current": "epoch10.safetensors",
        "comfyJobId": prompt_id,
    })
    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})
    monkeypatch.setattr(bench, "_stop_requests", set())
    cancelled = []
    monkeypatch.setattr(bench, "_cancel_comfy_job", lambda job_id: cancelled.append(job_id) or True)

    status = bench.stop(tmp_path)

    assert status["status"] == "stopping"
    assert folder_key in bench._stop_requests
    assert cancelled == [prompt_id]


def test_stopped_batch_preserves_session_after_worker_exit(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(session / "test.json", {
        "status": "stopping",
        "completed": 1,
        "total": 3,
        "results": [{"kind": "base", "outputVideo": "base.mp4"}],
    })
    folder_key = str(tmp_path.resolve())
    advanced = []

    monkeypatch.setattr(bench, "_active_threads", {folder_key: object()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})
    monkeypatch.setattr(bench, "_stop_requests", {folder_key})
    monkeypatch.setattr(bench, "_advance_test_queue", lambda: advanced.append(True))

    bench._run_batch(folder_key, session, [], "prompt", template={})

    assert session.exists()
    persisted = bench._read_status(session)
    assert persisted["status"] == "stopped"
    assert persisted["completed"] == 1
    assert persisted["results"] == [{"kind": "base", "outputVideo": "base.mp4"}]
    assert folder_key not in bench._active_threads
    assert folder_key not in bench._active_sessions
    assert advanced == [True]


def test_remove_candidate_deletes_only_current_session_result(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "run-01__epoch10.safetensors"
    candidate.write_bytes(b"copy")
    candidate.with_suffix(".webcap.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    current = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    older = tmp_path / bench.TEST_RESULTS_DIR / "session-b"
    current.mkdir(parents=True)
    older.mkdir(parents=True)
    for session in (current, older):
        (session / "epoch10.mp4").write_bytes(b"video")
        (session / "epoch10.txt").write_text("prompt", encoding="utf-8")
        bench._atomic_write_json(
            session / "test.json",
            {
                "status": "complete",
                "total": 1,
                "completed": 1,
                "failed": 0,
                "failures": [],
                "results": [{
                    "kind": "lora",
                    "sourceLoRA": candidate.name,
                    "candidateFile": candidate.name,
                    "outputVideo": "epoch10.mp4",
                }],
            },
        )

    payload = bench.remove_candidate(tmp_path, candidate.name, session_name="session-a")

    assert not candidate.exists()
    assert not candidate.with_suffix(".webcap.json").exists()
    assert not (current / "epoch10.mp4").exists()
    assert not (current / "epoch10.txt").exists()
    assert (older / "epoch10.mp4").is_file()
    assert (older / "epoch10.txt").is_file()
    assert payload["sessionStatus"]["session"] == "session-a"
    assert payload["sessionStatus"]["results"] == []
    assert payload["sessionStatus"]["completed"] == 0
    assert payload["sessionStatus"]["total"] == 0


def test_remove_candidate_refuses_active_session_result_mutation(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    session = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "results": [],
        "failures": [],
        "completed": 0,
        "failed": 0,
        "total": 2,
    })

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})

    with pytest.raises(RuntimeError, match="active Test Generations session"):
        bench.remove_candidate(tmp_path, candidate.name, session_name=session.name)

    assert candidate.is_file()


def test_remove_candidate_cleans_historical_session_when_result_files_are_already_gone(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    session = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "total": 1,
        "completed": 1,
        "failed": 0,
        "failures": [],
        "results": [{
            "kind": "lora",
            "sourceLoRA": candidate.name,
            "candidateFile": candidate.name,
            "outputVideo": "epoch10.mp4",
        }],
    })

    payload = bench.remove_candidate(tmp_path, candidate.name, session_name=session.name)

    assert not candidate.exists()
    assert payload["sessionStatus"]["results"] == []
    assert payload["sessionStatus"]["completed"] == 0
    assert payload["sessionStatus"]["total"] == 0


def test_sessions_list_open_and_delete_are_scoped_to_current_set(tmp_path):
    first = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-18_0900-h3"
    second = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-18_1000-h3"
    first.mkdir(parents=True)
    second.mkdir(parents=True)
    bench._atomic_write_json(first / "test.json", {"status": "complete", "completed": 2, "total": 2})
    bench._atomic_write_json(second / "test.json", {"status": "stopped", "completed": 1, "total": 3})

    sessions = bench.list_sessions(tmp_path)
    assert [item["session"] for item in sessions] == [second.name, first.name]
    assert bench.open_session(tmp_path, first.name)["session"] == first.name

    payload = bench.delete_session(tmp_path, first.name)
    assert not first.exists()
    assert second.exists()
    assert [item["session"] for item in payload["sessions"]] == [second.name]

    with pytest.raises(ValueError):
        bench.open_session(tmp_path, "../outside")



def test_test_bench_resolves_session_folder_back_to_owning_set(tmp_path, monkeypatch):
    set_folder = tmp_path / "sets" / "HH4013"
    session_folder = set_folder / bench.TEST_RESULTS_DIR / "2026-09-18_1037-h3"
    session_folder.mkdir(parents=True)
    test_root = tmp_path / "test-root"

    monkeypatch.setattr(bench.app_config, "load_config_from_disk", lambda: {
        "training": {
            "test_copy_roots": {"h3": str(test_root)},
            "test_copy_subfolder": "WebCap",
        }
    })
    monkeypatch.setattr(bench, "host_path_for_training_path", lambda value: Path(value))

    assert bench._owning_set_directory(session_folder) == set_folder.resolve()
    assert bench._folder_key(session_folder) == str(set_folder.resolve())
    assert bench._h3_test_directory(session_folder) == test_root / "WebCap" / "HH4013"
    assert bench._session_root(session_folder) == set_folder.resolve() / bench.TEST_RESULTS_DIR


def test_prepare_then_start_from_session_folder_reuses_same_staged_loras(tmp_path, monkeypatch):
    set_folder = tmp_path / "sets" / "HH4013"
    session_folder = set_folder / bench.TEST_RESULTS_DIR / "2026-09-18_1037-h3"
    staged = tmp_path / "test-root" / "WebCap" / "HH4013"
    session_folder.mkdir(parents=True)
    staged.mkdir(parents=True)
    candidate = staged / "baseline-01__epoch10.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench.app_config, "load_config_from_disk", lambda: {
        "training": {
            "test_copy_roots": {"h3": str(tmp_path / "test-root")},
            "test_copy_subfolder": "WebCap",
        }
    })
    monkeypatch.setattr(bench, "host_path_for_training_path", lambda value: Path(value))
    monkeypatch.setattr(bench, "_visible_status", lambda _folder, model_id=None: {"status": "idle"})
    monkeypatch.setattr(bench, "_read_json_response", lambda *args, **kwargs: {})
    model = bench.get_test_model()
    monkeypatch.setattr(model, "resolve_assets", lambda template, *_args: template)
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    class FakeThread:
        def __init__(self, *args, **kwargs):
            self.started = False

        def is_alive(self):
            return self.started

        def start(self):
            self.started = True

    monkeypatch.setattr(bench.threading, "Thread", FakeThread)

    prepared = bench.prepare(session_folder)
    assert prepared["files"] == [candidate.name]

    request = bench._build_queued_request(session_folder, "test prompt")
    started = bench.start_queued(session_folder, request)
    assert started["status"] == "running"
    assert started["total"] == 2
    assert (set_folder / bench.TEST_RESULTS_DIR / started["session"] / "test.json").is_file()



def test_start_queued_skips_selected_loras_removed_after_enqueue(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    keep = staged / "epoch20.safetensors"
    removed = staged / "epoch10.safetensors"
    keep.write_bytes(b"keep")
    removed.write_bytes(b"remove")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_read_json_response", lambda *_args, **_kwargs: {})
    template = {
        "115": {"inputs": {"aspect_ratio": "2:3", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }
    model = patch_default_test_model(
        monkeypatch,
        template=template,
        settings={
            "seed": 123,
            "aspectRatio": "2:3",
            "megapixels": 0.2,
            "duration": 7,
        },
    )
    monkeypatch.setattr(model, "resolve_assets", lambda selected, *_args: selected)
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    class FakeThread:
        def __init__(self, target=None, args=(), **_kwargs):
            self.args = args
            self.started = False

        def is_alive(self):
            return self.started

        def start(self):
            self.started = True

    threads = []
    monkeypatch.setattr(bench.threading, "Thread", lambda *args, **kwargs: threads.append(FakeThread(*args, **kwargs)) or threads[-1])

    request = {
        "resolvedPrompt": "prompt",
        "sourcePrompt": "prompt",
        "selectedFiles": [removed.name, keep.name],
        "includeBase": False,
        "seed": 123,
        "aspectRatio": "2:3",
        "megapixels": 0.2,
        "duration": 7,
        "workflow": copy.deepcopy(template),
        "total": 2,
    }
    removed.unlink()

    payload = bench.start_queued(tmp_path, request)

    assert payload["status"] == "running"
    assert payload["total"] == 1
    assert [path.name for path in threads[0].args[2]] == [keep.name]


def test_start_queued_skips_job_when_all_selected_loras_are_gone_and_base_is_off(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    payload = bench.start_queued(tmp_path, {
        "resolvedPrompt": "prompt",
        "sourcePrompt": "prompt",
        "selectedFiles": ["epoch10.safetensors"],
        "includeBase": False,
        "total": 1,
    })

    assert payload == {"status": "skipped"}
    assert not (tmp_path / bench.TEST_RESULTS_DIR).exists()


def test_recent_test_sets_exposes_set_level_summary_only(tmp_path, monkeypatch):
    set_folder = tmp_path / "HH4013"
    session = set_folder / bench.TEST_RESULTS_DIR / "2026-09-18_1300-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "completed": 7,
        "failed": 1,
        "total": 8,
    })

    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_recent_sets_cache", {"items": [], "expires": 0})

    recent = bench.recent_test_sets()

    assert len(recent) == 1
    assert recent[0]["folder"] == "HH4013"
    assert recent[0]["sessionCount"] == 1
    assert "status" not in recent[0]
    assert "completed" not in recent[0]
    assert "failed" not in recent[0]
    assert "total" not in recent[0]


def test_activity_snapshot_exposes_current_set_and_active_run(tmp_path, monkeypatch):
    set_folder = tmp_path / "HH4013"
    staged = tmp_path / "staged"
    session = set_folder / bench.TEST_RESULTS_DIR / "2026-09-18_1400-h3"
    staged.mkdir(parents=True)
    set_folder.mkdir(parents=True, exist_ok=True)
    session.mkdir(parents=True)
    (staged / "run__epoch10.safetensors").write_bytes(b"weights")
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "completed": 3,
        "total": 8,
    })

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(set_folder.resolve())
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})
    monkeypatch.setattr(bench, "_stop_requests", set())

    payload = bench.activity_snapshot(set_folder)

    assert payload["current"]["folder"] == "HH4013"
    assert payload["current"]["stagedCount"] == 1
    assert payload["current"]["sessionCount"] == 1
    assert payload["current"]["hasTestData"] is True
    assert payload["active"] == [{
        "folder": "HH4013",
        "session": session.name,
        "status": "running",
        "completed": 3,
        "total": 8,
    }]



def test_move_saved_video_cleans_only_owned_comfy_directory(tmp_path):
    source_dir = tmp_path / "output" / "webcap-tests" / "2026-09-18_1400-h3" / "001-base"
    source_dir.mkdir(parents=True)
    source = source_dir / "render_00001.mp4"
    extra = source_dir / "render_00001.png"
    source.write_bytes(b"video")
    extra.write_bytes(b"leftover")
    destination = tmp_path / "session" / "base.mp4"
    destination.parent.mkdir()

    bench._move_saved_video(
        {"filename": source.name, "type": "output", "fullpath": str(source)},
        destination,
        filename_prefix="webcap-tests/2026-09-18_1400-h3/001-base/render",
    )

    assert destination.read_bytes() == b"video"
    assert not source_dir.exists()


def test_cleanup_owned_comfy_directory_rejects_unscoped_path(tmp_path):
    unsafe = tmp_path / "output" / "other"
    unsafe.mkdir(parents=True)

    with pytest.raises(ValueError, match="Refusing to clean"):
        bench._cleanup_owned_comfy_directory(unsafe, "other/render")


def test_workflow_can_override_test_output_prefix():
    workflow = bench._workflow_for_lora(
        bench._load_template(),
        "prompt",
        "mh3/example.safetensors",
        filename_prefix="webcap-tests/session/001-epoch10/render",
    )

    assert workflow["141"]["inputs"]["filename_prefix"] == "webcap-tests/session/001-epoch10/render"



def test_delete_session_refuses_active_worker(tmp_path, monkeypatch):
    session = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-18_1500-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {"status": "running"})

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})

    with pytest.raises(RuntimeError, match="Cannot delete the active"):
        bench.delete_session(tmp_path, session.name)

    assert session.exists()



def test_open_session_marks_dead_running_session_interrupted(tmp_path, monkeypatch):
    session = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-18_1600-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "session": session.name,
        "completed": 0,
        "total": 14,
        "current": "Base",
        "error": "",
    })

    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    payload = bench.open_session(tmp_path, session.name)

    assert payload["status"] == "interrupted"
    assert payload["current"] == ""
    assert "worker is no longer active" in payload["error"]
    persisted = bench._read_status(session)
    assert persisted["status"] == "interrupted"


def test_open_session_keeps_live_running_session_running(tmp_path, monkeypatch):
    session = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-18_1601-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "session": session.name,
        "completed": 0,
        "total": 14,
        "current": "Base",
        "error": "",
    })

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})
    monkeypatch.setattr(bench, "_stop_requests", set())

    payload = bench.open_session(tmp_path, session.name)

    assert payload["status"] == "running"
    assert payload["current"] == "Base"



def test_move_saved_video_failure_keeps_source(tmp_path):
    source_dir = tmp_path / "output" / "webcap-tests" / "2026-09-18_1700-h3" / "001-base"
    source_dir.mkdir(parents=True)
    source = source_dir / "render_00001.mp4"
    source.write_bytes(b"video")
    destination = tmp_path / "session" / "base.mp4"
    destination.parent.mkdir()
    destination.write_bytes(b"existing")

    with pytest.raises(FileExistsError):
        bench._move_saved_video(
            {"filename": source.name, "type": "output", "fullpath": str(source)},
            destination,
            filename_prefix="webcap-tests/2026-09-18_1700-h3/001-base/render",
        )

    assert source.read_bytes() == b"video"
    assert source_dir.exists()


def test_remove_candidate_is_idempotent_when_staged_file_is_already_gone(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    other = staged / "epoch20.safetensors"
    other.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    payload = bench.remove_candidate(tmp_path, "epoch10.safetensors")

    assert payload["removed"] == "epoch10.safetensors"
    assert payload["files"] == [other.name]


def test_remove_candidate_allows_active_batch(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    payload = bench.remove_candidate(tmp_path, candidate.name)

    assert payload["removed"] == candidate.name
    assert not candidate.exists()


def test_selected_lora_files_can_focus_next_run(tmp_path):
    for name in ("epoch01.safetensors", "epoch02.safetensors", "epoch03.safetensors"):
        (tmp_path / name).write_bytes(b"weights")

    selected = bench._selected_lora_files(
        tmp_path,
        ["epoch03.safetensors", "epoch01.safetensors"],
    )

    assert [path.name for path in selected] == [
        "epoch01.safetensors",
        "epoch03.safetensors",
    ]
    with pytest.raises(ValueError, match="Select at least one"):
        bench._selected_lora_files(tmp_path, [])
    assert bench._selected_lora_files(tmp_path, ["epoch99.safetensors"]) == [
        tmp_path / "epoch99.safetensors"
    ]


def test_list_sessions_reports_remaining_unrated_results(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)

    session = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-20_1200-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "completed": 3,
        "total": 3,
        "results": [
            {"kind": "base", "outputVideo": "base.mp4"},
            {"kind": "lora", "outputVideo": "epoch10.mp4"},
            {"kind": "lora", "outputVideo": "epoch20.mp4"},
        ],
    })
    (session / ".webcap_state.json").write_text(json.dumps({
        "ratings_by_media": {
            "base.mp4": 4,
            "epoch10.mp4": 5,
        }
    }), encoding="utf-8")

    sessions = bench.list_sessions(tmp_path)

    assert sessions[0]["unrated"] == 1

    (session / ".webcap_state.json").write_text(json.dumps({
        "ratings_by_media": {
            "base.mp4": 4,
            "epoch10.mp4": 5,
            "epoch20.mp4": 3,
        }
    }), encoding="utf-8")

    sessions = bench.list_sessions(tmp_path)

    assert sessions[0]["unrated"] == 0


def test_candidate_scores_reuse_normal_session_folder_ratings(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)

    first = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-19_1000-h3"
    second = tmp_path / bench.TEST_RESULTS_DIR / "2026-09-19_1100-h3"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    bench._atomic_write_json(first / "test.json", {
        "status": "complete",
        "results": [
            {"kind": "base", "sourceLoRA": "Base", "outputVideo": "base.mp4"},
            {
                "kind": "lora",
                "candidateFile": "epoch10.safetensors",
                "sourceLoRA": "epoch10.safetensors",
                "outputVideo": "epoch10.mp4",
            },
            {
                "kind": "lora",
                "candidateFile": "epoch20.safetensors",
                "sourceLoRA": "epoch20.safetensors",
                "outputVideo": "epoch20.mp4",
            },
        ],
    })
    (first / ".webcap_state.json").write_text(json.dumps({
        "ratings_by_media": {
            "base.mp4": 5,
            "epoch10.mp4": 4,
            "epoch20.mp4": 3,
        }
    }), encoding="utf-8")

    bench._atomic_write_json(second / "test.json", {
        "status": "complete",
        "name": "Red colour test",
        "results": [
            {
                "kind": "lora",
                "candidateFile": "epoch10.safetensors",
                "sourceLoRA": "epoch10.safetensors",
                "outputVideo": "epoch10-second.mp4",
            }
        ],
    })
    (second / ".webcap_state.json").write_text(json.dumps({
        "ratings_by_media": {"epoch10-second.mp4": 5}
    }), encoding="utf-8")

    scores = bench._candidate_rating_scores(tmp_path)

    assert scores["epoch10.safetensors"] == {"average": 4.5, "count": 2}
    assert scores["epoch20.safetensors"] == {"average": 3.0, "count": 1}

    opened = bench.open_session(tmp_path, second.name)
    assert opened["name"] == "Red colour test"
    assert opened["results"][0]["rating"] == 5



def test_queued_request_freezes_prompt_seed_and_selected_files(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    first = staged / "epoch01.safetensors"
    second = staged / "epoch02.safetensors"
    first.write_bytes(b"one")
    second.write_bytes(b"two")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [first, second])
    patch_default_test_model(
        monkeypatch,
        template={"template": True},
        settings={
            "seed": 12345,
            "aspectRatio": "2:3 (Portrait Photo)",
            "megapixels": 0.2,
            "duration": 7,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt.replace("{place}", "studio") + " #" + str(seed))

    payload = bench._build_queued_request(
        tmp_path,
        "person in {place}",
        seed=12345,
        name="Prompt B",
        selected_files=[first.name, second.name],
    )

    assert payload["name"] == "Prompt B"
    assert payload["sourcePrompt"] == "person in {place}"
    assert payload["resolvedPrompt"] == "person in studio #12345"
    assert payload["seed"] == 12345
    assert payload["selectedFiles"] == [first.name, second.name]
    assert payload["includeBase"] is True
    assert "selectedFileSnapshots" not in payload
    assert payload["workflow"] == {"template": True}
    assert payload["workflowFile"] == bench.get_test_model().TEMPLATE_PATH.name
    assert len(payload["workflowSha256"]) == 64
    assert payload["total"] == 3

    without_base = bench._build_queued_request(
        tmp_path,
        "person in {place}",
        selected_files=[first.name, second.name],
        include_base=False,
    )
    assert without_base["includeBase"] is False
    assert without_base["total"] == 2




def test_queued_request_freezes_workflow_snapshot_for_later_start(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")
    original_template = {
        "115": {"inputs": {"aspect_ratio": "1:1 (Square)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 77}},
        "133": {"inputs": {"value": 5}},
        "138": {"inputs": {"model": ["148", 0], "clip": ["148", 1]}},
        "146": {"inputs": {"wildcard_text": "original", "populated_text": "original", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    }
    model = patch_default_test_model(
        monkeypatch,
        template=original_template,
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    request = bench._build_queued_request(tmp_path, "prompt", selected_files=[candidate.name])

    changed_template = copy.deepcopy(original_template)
    changed_template["146"]["inputs"]["wildcard_text"] = "changed after enqueue"
    monkeypatch.setattr(model, "load_template", lambda: changed_template)
    monkeypatch.setattr(model, "resolve_assets", lambda template, *_args: template)
    monkeypatch.setattr(bench, "_read_json_response", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    class FakeThread:
        def __init__(self, target=None, args=(), **_kwargs):
            self.args = args
            self.started = False

        def is_alive(self):
            return self.started

        def start(self):
            self.started = True

    threads = []
    monkeypatch.setattr(
        bench.threading,
        "Thread",
        lambda *args, **kwargs: threads.append(FakeThread(*args, **kwargs)) or threads[-1],
    )

    started = bench.start_queued(tmp_path, request)

    frozen_template = threads[0].args[5]
    assert frozen_template["146"]["inputs"]["wildcard_text"] == "original"
    assert started["workflowFile"] == model.TEMPLATE_PATH.name
    assert started["workflowSha256"] == request["workflowSha256"]


def test_concurrent_enqueue_state_after_dispatch_uses_live_worker_not_stale_snapshot(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    patch_default_test_model(
        monkeypatch,
        template={},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_pending_tests", [])

    class Live:
        def is_alive(self):
            return True

    monkeypatch.setattr(bench, "_active_threads", {})

    def dispatch_first_job():
        bench._pending_tests.pop(0)
        bench._active_threads["sets/subject"] = Live()
        return {"status": "running", "session": "session-one"}

    monkeypatch.setattr(bench, "_advance_test_queue", dispatch_first_job)

    payload = bench.enqueue(tmp_path, "prompt", selected_files=[candidate.name])

    assert payload["queued"] is False
    assert payload["latest"]["status"] == "running"


def test_enqueue_test_queues_behind_active_test(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    patch_default_test_model(
        monkeypatch,
        template={},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_advance_test_queue", lambda: None)
    monkeypatch.setattr(bench, "_active_threads", {"sets/subject": type("Live", (), {"is_alive": lambda self: True})()})
    monkeypatch.setattr(bench, "_pending_tests", [])

    payload = bench.enqueue(tmp_path, "prompt", name="Named", selected_files=[candidate.name])

    assert payload["queued"] is True
    assert [job["runName"] for job in bench._pending_tests] == ["Named"]


def test_first_test_does_not_wait_for_training_queue(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    patch_default_test_model(
        monkeypatch,
        template={},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_advance_test_queue", lambda: None)
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_pending_tests", [])

    with pytest.raises(RuntimeError, match="Pause Training"):
        bench.enqueue(tmp_path, "prompt", selected_files=[candidate.name])

    assert bench._pending_tests == []


def test_first_test_start_failure_reports_real_error(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    patch_default_test_model(
        monkeypatch,
        template={},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_pending_tests", [])

    def fail_start():
        bench._pending_tests.clear()
        return {"status": "failed", "error": "ComfyUI offline"}

    monkeypatch.setattr(bench, "_advance_test_queue", fail_start)

    with pytest.raises(RuntimeError, match="ComfyUI offline"):
        bench.enqueue(tmp_path, "prompt", selected_files=[candidate.name])

    assert bench._pending_tests == []


def test_first_test_returns_direct_start_payload_without_latest_status_lookup(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch01.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_selected_lora_files", lambda _folder, selected_files=None: [candidate])
    patch_default_test_model(
        monkeypatch,
        template={},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_active_threads", {})
    monkeypatch.setattr(bench, "_pending_tests", [])
    monkeypatch.setattr(bench, "_advance_test_queue", lambda: {
        "status": "running",
        "session": "2026-09-20_0100-h3",
        "resultFolder": "sets/subject/test-generations/2026-09-20_0100-h3",
    })
    monkeypatch.setattr(bench, "status", lambda _folder, model_id=None: (_ for _ in ()).throw(AssertionError("enqueue should not call status()")))

    payload = bench.enqueue(tmp_path, "prompt", selected_files=[candidate.name])

    assert payload["queued"] is False
    assert payload["latest"]["session"] == "2026-09-20_0100-h3"


def test_clear_queued_tests_keeps_other_sets(tmp_path, monkeypatch):
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    monkeypatch.setattr(bench, "_pending_tests", [
        {"id": "one", "folder": "sets/subject", "request": {}},
        {"id": "other", "folder": "sets/other", "request": {}},
    ])

    payload = bench.clear_queued(tmp_path)

    assert payload["removed"] == 1
    assert [job["id"] for job in bench._pending_tests] == ["other"]


def test_run_batch_advances_local_test_fifo(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(bench._status_path(session), {
        "status": "running",
        "results": [],
        "completed": 0,
        "failed": 0,
        "total": 0,
    })
    calls = []
    monkeypatch.setattr(bench, "_advance_test_queue", lambda: calls.append("advance") or True)

    bench._run_batch("folder-key", session, [], "prompt", template={})

    assert calls == ["advance"]
    assert bench._read_status(session)["status"] == "complete"


def test_remove_candidate_allows_local_test_fifo_reference(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_pending_tests", [{
        "id": "queued-one",
        "folder": "sets/subject",
        "request": {"selectedFiles": [candidate.name]},
    }])

    payload = bench.remove_candidate(tmp_path, candidate.name)

    assert payload["removed"] == candidate.name
    assert not candidate.exists()
