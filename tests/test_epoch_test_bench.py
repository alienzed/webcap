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


def test_lora_files_are_filtered_and_sorted(tmp_path):
    (tmp_path / "epoch10.safetensors").write_bytes(b"")
    (tmp_path / "Epoch02.safetensors").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    files = bench._lora_files(tmp_path)

    assert [path.name for path in files] == ["Epoch02.safetensors", "epoch10.safetensors"]


def test_lora_files_treat_missing_staging_directory_as_empty(tmp_path):
    missing = tmp_path / "not-created-yet"

    assert bench._lora_files(missing) == []


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
        (Path("C:/ComfyUI/models/loras/mh3/set/epoch01.safetensors"), "mh3/set/epoch01.safetensors"),
        (Path("C:/ComfyUI/models/loras/mh3/set/epoch02.safetensors"), "mh3/set/epoch02.safetensors"),
    ]
    queued = []

    monkeypatch.setattr(bench, "_load_template", lambda: {
        "115": {"inputs": {"aspect_ratio": "2:3 (Portrait Photo)", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
        "146": {"inputs": {"wildcard_text": "x", "populated_text": "x", "mode": "fixed"}},
        "148": {"inputs": {"lora_name": "x", "strength_model": 0.9, "strength_clip": 1}},
    })
    monkeypatch.setattr(bench, "_release_gpu_for_test_generations", lambda: None)

    def queue(workflow):
        item = (
            workflow["148"]["inputs"]["lora_name"],
            workflow["148"]["inputs"]["strength_model"],
            workflow["148"]["inputs"]["strength_clip"],
        )
        queued.append(item)
        if item[0].endswith("epoch01.safetensors") and item[1] == 0.9:
            raise RuntimeError("boom")
        return "prompt-ok"

    monkeypatch.setattr(bench, "_queue_workflow", queue)
    monkeypatch.setattr(
        bench,
        "_wait_for_video",
        lambda _prompt_id: {"filename": "ok.mp4", "type": "output", "fullpath": "C:/ComfyUI/output/ok.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_video",
        lambda _video_ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )

    bench._run_batch("folder-key", session, loras, "prompt")

    status = bench._read_status(session)
    assert queued == [
        ("mh3/set/epoch01.safetensors", 0, 0),
        ("mh3/set/epoch01.safetensors", 0.9, 1),
        ("mh3/set/epoch02.safetensors", 0.9, 1),
    ]
    assert status["status"] == "complete"
    assert status["completed"] == 2
    assert status["failed"] == 1
    assert status["failures"][0]["sourceLoRA"] == "epoch01.safetensors"
    assert [result["sourceLoRA"] for result in status["results"]] == ["Base", "epoch02.safetensors"]
    assert status["results"][0]["kind"] == "base"
    assert status["results"][0]["outputVideo"] == "base.mp4"


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


def test_start_refuses_when_training_gpu_is_unavailable(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    lora = staged / "epoch01.safetensors"
    lora.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_h3_test_directory", lambda _folder: staged)
    monkeypatch.setattr(bench, "_read_json_response", lambda *args, **kwargs: {})
    monkeypatch.setattr(bench, "_resolve_comfy_loras", lambda _loras: [(lora, "mh3/set/epoch01.safetensors")])
    monkeypatch.setattr(bench, "_load_template", lambda: {
        "115": {"inputs": {"aspect_ratio": "2:3", "megapixels": 0.2}},
        "129": {"inputs": {"noise_seed": 123}},
        "133": {"inputs": {"value": 7}},
    })
    monkeypatch.setattr(bench, "_resolve_comfy_template_assets", lambda template: template)
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_reserve_gpu_for_test_generations", lambda: False)

    with pytest.raises(RuntimeError, match="GPU is busy"):
        bench.start(tmp_path, "prompt")

    assert not (tmp_path / bench.TEST_RESULTS_DIR).exists()


def test_run_batch_releases_gpu_reservation_when_template_load_fails(tmp_path, monkeypatch):
    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(
        session / "test.json",
        {"status": "running", "completed": 0, "total": 1, "current": "", "error": ""},
    )
    released = []
    monkeypatch.setattr(bench, "_load_template", lambda: (_ for _ in ()).throw(RuntimeError("template boom")))
    monkeypatch.setattr(bench, "_release_gpu_for_test_generations", lambda: released.append(bench.GPU_RESERVATION_OWNER))

    bench._run_batch("folder-key", session, [], "prompt")

    status = bench._read_status(session)
    assert status["status"] == "failed"
    assert status["error"] == "template boom"
    assert released == [bench.GPU_RESERVATION_OWNER]



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
    monkeypatch.setattr(bench, "_load_template", lambda: pytest.fail("worker must use the resolved template from start"))
    monkeypatch.setattr(bench, "_queue_workflow", lambda workflow: seen.append(workflow["127"]["inputs"]["unet_name"]) or "prompt-id")
    monkeypatch.setattr(
        bench,
        "_wait_for_video",
        lambda _prompt_id: {"filename": "x.mp4", "subfolder": "webcap-tests", "type": "output", "fullpath": "C:/ComfyUI/output/webcap-tests/x.mp4"},
    )
    monkeypatch.setattr(
        bench,
        "_move_saved_video",
        lambda _ref, destination, filename_prefix=None: Path(destination).write_bytes(b"video"),
    )
    monkeypatch.setattr(bench, "_release_gpu_for_test_generations", lambda: None)

    bench._run_batch(
        "folder-key",
        session,
        [(lora, "mh3/epoch01.safetensors")],
        "prompt",
        template=resolved_template,
    )

    assert seen == ["mh3/linux-model.safetensors"]
    assert bench._read_status(session)["status"] == "complete"



def test_epoch_test_bench_does_not_import_training_runner_at_module_load():
    source = Path(bench.__file__).read_text(encoding="utf-8")
    top_level = source.split("def _reserve_gpu_for_test_generations", 1)[0]
    assert "from .training_runner import" not in top_level



def test_test_generation_gpu_helpers_call_training_runner(monkeypatch):
    from tool.server import training_runner

    calls = []
    monkeypatch.setattr(training_runner, "reserve_gpu_for_external_work", lambda owner: calls.append(("reserve", owner)) or True)
    monkeypatch.setattr(training_runner, "release_gpu_for_external_work", lambda owner: calls.append(("release", owner)))

    assert bench._reserve_gpu_for_test_generations() is True
    bench._release_gpu_for_test_generations()

    assert calls == [
        ("reserve", bench.GPU_RESERVATION_OWNER),
        ("release", bench.GPU_RESERVATION_OWNER),
    ]



def test_test_generation_gpu_calls_go_through_lazy_wrappers():
    source = Path(bench.__file__).read_text(encoding="utf-8")
    assert source.count("reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)") == 1
    assert source.count("release_gpu_for_external_work(GPU_RESERVATION_OWNER)") == 1
    assert source.count("_reserve_gpu_for_test_generations()") >= 2
    assert source.count("_release_gpu_for_test_generations()") >= 3



def test_prepare_exposes_supported_test_aspect_ratios(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    (staged / "epoch01.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(bench, "_h3_test_directory", lambda _folder: staged)
    monkeypatch.setattr(bench, "_visible_status", lambda _folder: {"status": "idle"})

    payload = bench.prepare(tmp_path)

    assert payload["aspectRatioOptions"] == list(bench.TEST_ASPECT_RATIO_OPTIONS)
    assert payload["defaults"]["aspectRatio"] == "4:3 (Standard)"


def test_normalized_test_settings_rejects_unknown_aspect_ratio():
    with pytest.raises(ValueError, match="Unsupported Test Generations aspect ratio"):
        bench._normalized_test_settings(bench._load_template(), aspect_ratio="5:4 (Unsupported)")


def test_remove_candidate_deletes_only_staged_copy_and_sidecar(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "run-01__epoch10.safetensors"
    candidate.write_bytes(b"copy")
    candidate.with_suffix(".webcap.json").write_text("{}", encoding="utf-8")
    other = staged / "run-02__epoch20.safetensors"
    other.write_bytes(b"keep")
    monkeypatch.setattr(bench, "_h3_test_directory", lambda _folder: staged)

    payload = bench.remove_candidate(tmp_path, candidate.name)

    assert not candidate.exists()
    assert not candidate.with_suffix(".webcap.json").exists()
    assert other.exists()
    assert payload["count"] == 1
    assert payload["files"] == [other.name]


def test_stop_marks_active_session_stopping_and_interrupts_comfy(tmp_path, monkeypatch):
    class ActiveThread:
        def is_alive(self):
            return True

    session = tmp_path / "session"
    session.mkdir()
    bench._atomic_write_json(session / "test.json", {"status": "running", "current": "epoch10.safetensors"})
    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {folder_key: session})
    monkeypatch.setattr(bench, "_stop_requests", set())
    interrupted = []
    monkeypatch.setattr(bench, "_interrupt_comfy", lambda: interrupted.append(True))

    status = bench.stop(tmp_path)

    assert status["status"] == "stopping"
    assert folder_key in bench._stop_requests
    assert interrupted == [True]


def test_remove_candidate_deletes_only_current_session_result(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "run-01__epoch10.safetensors"
    candidate.write_bytes(b"copy")
    candidate.with_suffix(".webcap.json").write_text("{}", encoding="utf-8")
    monkeypatch.setattr(bench, "_h3_test_directory", lambda _folder: staged)

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
    monkeypatch.setattr(bench, "_visible_status", lambda _folder: {"status": "idle"})
    monkeypatch.setattr(bench, "_read_json_response", lambda *args, **kwargs: {})
    monkeypatch.setattr(bench, "_resolve_comfy_loras", lambda loras: [(loras[0], "HH4013/" + loras[0].name)])
    monkeypatch.setattr(bench, "_resolve_comfy_template_assets", lambda template: template)
    monkeypatch.setattr(bench, "_resolve_wildcard_prompt", lambda prompt, seed: prompt)
    monkeypatch.setattr(bench, "_reserve_gpu_for_test_generations", lambda: True)
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

    started = bench.start(session_folder, "test prompt")
    assert started["status"] == "running"
    assert started["total"] == 2
    assert (set_folder / bench.TEST_RESULTS_DIR / started["session"] / "test.json").is_file()



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
    monkeypatch.setattr(bench, "_h3_test_directory", lambda _folder: staged)
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


def test_remove_candidate_refuses_active_batch(tmp_path, monkeypatch):
    candidate = tmp_path / "epoch10.safetensors"
    candidate.write_bytes(b"weights")

    class ActiveThread:
        def is_alive(self):
            return True

    folder_key = str(tmp_path.resolve())
    monkeypatch.setattr(bench, "_active_threads", {folder_key: ActiveThread()})
    monkeypatch.setattr(bench, "_active_sessions", {})
    monkeypatch.setattr(bench, "_stop_requests", set())

    with pytest.raises(RuntimeError, match="active Test Generations batch"):
        bench.remove_candidate(tmp_path, candidate.name)

    assert candidate.exists()
