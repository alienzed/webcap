import copy
import json
from pathlib import Path

import pytest

from tool.server import epoch_test_bench as bench
from tool.server import execution_queue
from tool.server import inference_runner
from tool.server import inference_runtime


def configure_execution_queue(monkeypatch, tmp_path):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    execution_queue._resource_owner = ""
    bench._startup_reconciled = False
    inference_runner._startup_reconciled = True


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



def test_lora_files_are_filtered_and_sorted(tmp_path):
    (tmp_path / "epoch10.safetensors").write_bytes(b"")
    (tmp_path / "Epoch02.safetensors").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("ignore", encoding="utf-8")

    files = bench._lora_files(tmp_path)

    assert [path.name for path in files] == ["Epoch02.safetensors", "epoch10.safetensors"]


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


def test_new_session_seed_uses_portable_32_bit_range():
    seed = bench._new_session_seed()
    assert 0 <= seed <= 4294967295


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


def test_cleanup_owned_comfy_directory_rejects_unscoped_path(tmp_path):
    unsafe = tmp_path / "output" / "other"
    unsafe.mkdir(parents=True)

    with pytest.raises(ValueError, match="Refusing to clean"):
        bench._cleanup_owned_comfy_directory(unsafe, "other/render")


def test_remove_candidate_is_idempotent_when_staged_file_is_already_gone(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    other = staged / "epoch20.safetensors"
    other.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    payload = bench.remove_candidate(tmp_path, "epoch10.safetensors")

    assert payload["removed"] == "epoch10.safetensors"
    assert payload["files"] == [other.name]


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



def test_output_materialization_moves_accessible_saved_file(tmp_path):
    source_dir = tmp_path / "output" / "webcap-tests" / "session" / "001-base"
    source_dir.mkdir(parents=True)
    source = source_dir / "render.mp4"
    source.write_bytes(b"video")
    destination = tmp_path / "session-result.mp4"

    moved = bench._move_saved_output(
        {"filename": source.name, "type": "output", "fullpath": str(source)},
        destination,
    )

    assert moved == destination
    assert destination.read_bytes() == b"video"
    assert not source.exists()


def test_output_materialization_uses_shared_downloader_when_saved_path_is_unavailable(tmp_path):
    destination = tmp_path / "session-result.mp4"
    calls = []

    moved = bench._move_saved_output(
        {"filename": "render.mp4", "subfolder": "webcap-tests/session/001", "type": "output"},
        destination,
        download_bytes=lambda ref: calls.append(ref["filename"]) or b"video",
    )

    assert moved == destination
    assert destination.read_bytes() == b"video"
    assert calls == ["render.mp4"]


def test_historical_running_session_is_marked_interrupted_on_open(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    session = tmp_path / "set" / bench.TEST_RESULTS_DIR / "historical-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "modelId": bench.get_test_model().PROFILE_ID,
        "completed": 1,
        "total": 3,
        "current": "epoch02.safetensors",
        "error": "",
    })

    payload = bench.open_session("set", session.name)

    assert payload["status"] == "interrupted"
    assert payload["completed"] == 1
    assert payload["current"] == ""


def test_remove_candidate_refuses_shared_active_session_result_mutation(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    session = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    session.mkdir(parents=True)
    child = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={"client": "test", "folder": ".", "sessionId": session.name, "candidateKind": "lora", "candidateFile": candidate.name},
    )
    bench._atomic_write_json(session / "test.json", {
        "status": "queued",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [child["id"]],
        "results": [],
        "failures": [],
        "completed": 0,
        "failed": 0,
        "total": 1,
    })

    with pytest.raises(RuntimeError, match="active Test Generations session"):
        bench.remove_candidate(tmp_path, candidate.name, session_name=session.name)

    assert candidate.is_file()


def test_activity_snapshot_projects_shared_test_session(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    set_folder = tmp_path / "HH4013"
    staged = tmp_path / "staged"
    session = set_folder / bench.TEST_RESULTS_DIR / "session-a"
    staged.mkdir(parents=True)
    session.mkdir(parents=True)
    (staged / "epoch10.safetensors").write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    child = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={
            "client": "test",
            "folder": "HH4013",
            "sessionId": session.name,
            "candidateKind": "base",
            "label": "Comparison · Base",
        },
    )
    bench._atomic_write_json(session / "test.json", {
        "status": "queued",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [child["id"]],
        "results": [],
        "failures": [],
        "completed": 0,
        "failed": 0,
        "total": 1,
    })
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(child["id"])

    payload = bench.activity_snapshot(set_folder)

    assert payload["current"]["folder"] == "HH4013"
    assert payload["current"]["stagedCount"] == 1
    assert payload["current"]["hasTestData"] is True
    assert payload["active"] == [{
        "folder": "HH4013",
        "session": session.name,
        "status": "running",
        "completed": 0,
        "total": 1,
    }]


def test_remove_staged_candidate_is_independent_of_other_active_inference(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)

    other = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "label": "Other generation"},
    )
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(other["id"])

    payload = bench.remove_candidate(tmp_path, candidate.name)

    assert payload["removed"] == candidate.name
    assert not candidate.exists()


def test_delete_session_refuses_shared_active_inference(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    session = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    session.mkdir(parents=True)
    child = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={"client": "test", "folder": ".", "sessionId": session.name, "candidateKind": "base"},
    )
    bench._atomic_write_json(session / "test.json", {
        "status": "queued",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [child["id"]],
        "results": [],
        "failures": [],
        "total": 1,
    })

    with pytest.raises(RuntimeError, match="active Test Generations session"):
        bench.delete_session(tmp_path, session.name)

    assert session.exists()


def _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=2):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidates = []
    for index in range(candidate_count):
        candidate = staged / ("epoch" + str(index + 1).zfill(2) + ".safetensors")
        candidate.write_bytes(("weights-" + str(index)).encode("utf-8"))
        candidates.append(candidate)

    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(
        bench,
        "_selected_lora_files",
        lambda _folder, selected_files=None: [
            path for path in candidates
            if selected_files is None or path.name in selected_files
        ],
    )
    patch_default_test_model(
        monkeypatch,
        template={"template": True},
        settings={
            "seed": 77,
            "aspectRatio": "1:1 (Square)",
            "megapixels": 0.2,
            "duration": 5,
        },
    )
    monkeypatch.setattr(
        inference_runtime,
        "resolve_wildcard_prompt",
        lambda prompt, seed: prompt.replace("{place}", "studio") + " #" + str(seed),
    )
    monkeypatch.setattr(bench, "_relative_set_folder", lambda _folder: "sets/subject")
    return staged, candidates


def test_enqueue_creates_one_common_inference_job_per_rendition(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=2)

    payload = bench.enqueue(
        tmp_path,
        "person in {place}",
        name="Comparison",
        selected_files=[path.name for path in candidates],
        include_base=True,
    )

    assert payload["queued"] is True
    assert payload["latest"]["status"] == "queued"
    assert payload["latest"]["total"] == 3

    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    manifest = bench._read_status(session)
    assert len(manifest["inferenceJobs"]) == 3

    snapshot = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    jobs = [
        job for job in snapshot["jobs"]
        if (job.get("metadata") or {}).get("client") == "test"
    ]
    assert len(jobs) == 3
    assert [job["metadata"]["candidateKind"] for job in jobs] == ["base", "lora", "lora"]
    assert [job["queuePosition"] for job in jobs] == [1, 2, 3]


def test_test_session_children_share_frozen_prompt_seed_and_workflow(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=2)

    payload = bench.enqueue(
        tmp_path,
        "person in {place}",
        selected_files=[path.name for path in candidates],
        include_base=True,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    manifest = bench._read_status(session)
    child_payloads = [
        execution_queue.get_job(job_id, include_payload=True)["payload"]["request"]
        for job_id in manifest["inferenceJobs"]
    ]

    assert {item["prompt"] for item in child_payloads} == {"person in studio #77"}
    assert {item["settings"]["seed"] for item in child_payloads} == {77}
    assert all(item["workflow"] == {"template": True} for item in child_payloads)
    assert len({item["workflowSha256"] for item in child_payloads}) == 1


def test_test_renditions_use_global_inference_positions(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    generate = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "label": "Generate", "modelId": "krea2_raw", "mediaKind": "image"},
    )

    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=True,
    )

    assert execution_queue.get_job(generate["id"])["queuePosition"] == 1
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_jobs = [
        execution_queue.get_job(job_id)
        for job_id in bench._read_status(session)["inferenceJobs"]
    ]
    assert [job["queuePosition"] for job in child_jobs] == [2, 3]
    queued = bench.queued_jobs(tmp_path)["jobs"]
    assert queued[0]["queuePosition"] == 2


def test_clear_queued_test_sessions_keeps_other_global_inference(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    other = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": "krea2_raw"}},
        metadata={"client": "generate", "label": "Generate", "modelId": "krea2_raw", "mediaKind": "image"},
        job_id="other",
    )
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=True,
    )

    cleared = bench.clear_queued(tmp_path)

    assert cleared["removed"] == 1
    assert not (bench._session_root(tmp_path) / payload["latest"]["session"]).exists()
    assert execution_queue.get_job(other["id"])["status"] == "queued"


def test_stop_shared_test_session_cancels_pending_children_and_requests_active_stop(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=2)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[path.name for path in candidates],
        include_base=True,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_ids = bench._read_status(session)["inferenceJobs"]
    claimed = execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    assert claimed["id"] == child_ids[0]
    execution_queue.mark_running(child_ids[0])

    stopped = bench.stop(tmp_path)

    assert stopped["status"] == "stopping"
    assert execution_queue.get_job(child_ids[0])["status"] == "stopping"
    assert [execution_queue.get_job(job_id)["status"] for job_id in child_ids[1:]] == ["cancelled", "cancelled"]


def test_missing_candidate_rendition_skips_without_failure_card(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    candidates[0].unlink()
    monkeypatch.setattr(bench.app_config, "safe_join_fs_root", lambda _folder: tmp_path)

    stored = execution_queue.get_job(child_id, include_payload=True)
    context = stored["payload"]["clientContext"]
    result = bench.execute_inference(child_id, stored["payload"]["request"], context)

    assert result["status"] == "skipped"
    manifest = bench._read_status(session)
    assert manifest["total"] == 0
    assert manifest["failed"] == 0
    assert manifest["failures"] == []



def test_shared_test_rendition_executes_with_existing_test_model_semantics(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    stored = execution_queue.get_job(child_id, include_payload=True)

    model = bench.get_test_model()
    monkeypatch.setattr(model, "resolve_assets", lambda template, *_args: template)
    monkeypatch.setattr(model, "available_lora_names", lambda _available_names: [candidates[0].name])
    monkeypatch.setattr(
        model,
        "build_workflow",
        lambda _template, prompt, lora_name, settings=None, filename_prefix=None, **_kwargs: {
            "prompt": prompt,
            "lora": lora_name,
            "seed": settings["seed"],
            "prefix": filename_prefix,
        },
    )
    monkeypatch.setattr(model, "find_output_ref", lambda outputs: outputs)
    monkeypatch.setattr(model, "workflow_seed", lambda workflow: workflow["seed"])
    monkeypatch.setattr(bench.app_config, "safe_join_fs_root", lambda _folder: tmp_path)
    monkeypatch.setattr(inference_runtime, "system_stats", lambda: {})
    monkeypatch.setattr(inference_runtime, "available_names", lambda *_args: [candidates[0].name])
    monkeypatch.setattr(
        inference_runtime,
        "resolve_name",
        lambda configured, _available, _label: Path(str(configured)).name,
    )
    monkeypatch.setattr(inference_runtime, "queue_workflow", lambda _workflow: "provider-1")
    monkeypatch.setattr(
        inference_runtime,
        "wait_for_output",
        lambda _provider, _job, _finder: {"filename": "render.mp4", "subfolder": "", "type": "output"},
    )
    monkeypatch.setattr(inference_runtime, "download_output", lambda _ref: b"video-bytes")
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(child_id)

    result = bench.execute_inference(child_id, stored["payload"]["request"], stored["payload"]["clientContext"])

    assert result["status"] == "completed"
    manifest = bench._read_status(session)
    assert manifest["completed"] == 1
    assert manifest["failed"] == 0
    assert manifest["results"][0]["candidateFile"] == candidates[0].name
    assert manifest["results"][0]["seed"] == 77
    assert (session / manifest["results"][0]["mediaFile"]).read_bytes() == b"video-bytes"
    assert (session / Path(manifest["results"][0]["mediaFile"]).with_suffix(".txt")).read_text(encoding="utf-8") == "prompt #77"



def test_remove_candidate_allows_queued_test_reference(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )

    removed = bench.remove_candidate(tmp_path, candidates[0].name)

    assert removed["removed"] == candidates[0].name
    assert not candidates[0].exists()
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    assert bench._read_status(session)["inferenceJobs"]


def test_running_test_session_owns_stop_control():
    root = Path(__file__).resolve().parents[1]
    html = (root / "tool" / "tool.html").read_text(encoding="utf-8")
    js = (root / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (root / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert 'id="test-generations-active"' not in html
    assert 'id="test-generations-stop-btn"' not in html
    assert "syncActiveTestCard" not in js
    assert "stop.dataset.sessionStop = name;" in js
    assert "session.status === 'stopping' ? 'Stopping…' : 'Stop'" in js
    assert "event.target.closest('[data-session-stop]')" in js
    assert ".test-generations-active" not in css
    assert ".test-generations-stop-btn" in css
