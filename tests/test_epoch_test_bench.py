import copy
import json
import os
from pathlib import Path

import pytest

from tool.server import epoch_test_bench as bench
from tool.server import execution_queue
from tool.server import inference_runner
from tool.server import inference_runtime


def configure_execution_queue(monkeypatch, tmp_path):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: tmp_path / "output")
    execution_queue._resource_owner = ""
    execution_queue.clear_transient_receipts()
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


def test_resolved_wildcard_values_extracts_only_selected_variants():
    assert bench._resolved_wildcard_values(
        "person wearing {black dress|red dress} in a {studio|rooftop}, {front|side} view",
        "person wearing red dress in a rooftop, side view",
    ) == ["red dress", "rooftop", "side"]


def test_resolved_wildcard_values_ignores_plain_or_unmatched_prompts():
    assert bench._resolved_wildcard_values("plain prompt", "plain prompt") == []
    assert bench._resolved_wildcard_values(
        "person wearing {black|red}",
        "a completely different resolved prompt",
    ) == []



def test_staged_candidates_follow_test_folder_not_source_provenance(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    model = bench.get_test_model()
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)

    def write_candidate(name, source_folder):
        lora = staged / name
        lora.write_bytes(b"weights")
        lora.with_suffix(".webcap.json").write_text(json.dumps({
            "version": 1,
            "sourceJobId": name,
            "sourceEpoch": 1,
            "sourceFileName": name,
            "sourceFolder": source_folder,
            "stage": model.STAGING_KEY,
        }), encoding="utf-8")
        return lora

    set_folder = tmp_path / "datasets" / "set-a"
    set_folder.mkdir(parents=True)
    write_candidate("owned.safetensors", "datasets/set-a")
    write_candidate("moved.safetensors", "datasets/set-b")

    assert [path.name for path in bench._staged_loras_for_set(set_folder, model)] == [
        "moved.safetensors",
        "owned.safetensors",
    ]


def test_staged_candidates_include_manual_loras_without_provenance(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    model = bench.get_test_model()
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)
    legacy = staged / "legacy.safetensors"
    legacy.write_bytes(b"weights")

    set_folder = tmp_path / "datasets" / "set-a"
    set_folder.mkdir(parents=True)

    assert bench._staged_loras_for_set(set_folder, model) == [legacy]


def test_recent_test_set_reports_owner_availability_from_set_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_recent_sets_cache", {"items": [], "expires": 0})
    session = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR / "session"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "ownerFolder": "sets/moved",
        "results": [],
    })

    recent = bench.recent_test_sets()
    assert recent[0]["folder"] == "sets/moved"
    assert recent[0]["ownerAvailable"] is False

    (tmp_path / "sets" / "moved").mkdir(parents=True)
    assert bench.recent_test_sets()[0]["ownerAvailable"] is True

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

    status = bench.open_session(tmp_path / "set", session.name)

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




def test_remove_candidate_deletes_only_staged_copy_and_sidecar(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "run-01__epoch10.safetensors"
    candidate.write_bytes(b"copy")
    candidate.with_suffix(".webcap.json").write_text("{}", encoding="utf-8")
    other = staged / "run-02__epoch20.safetensors"
    other.write_bytes(b"keep")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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


def test_remove_candidate_removes_session_result_when_staged_file_is_already_gone(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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
            "sourceLoRA": "epoch10.safetensors",
            "candidateFile": "epoch10.safetensors",
            "outputVideo": "epoch10.mp4",
        }],
    })
    (session / "epoch10.mp4").write_bytes(b"video")

    payload = bench.remove_candidate(tmp_path, "epoch10.safetensors", session_name=session.name)

    assert payload["sessionStatus"]["results"] == []
    assert payload["sessionStatus"]["completed"] == 0
    assert payload["sessionStatus"]["total"] == 0
    assert not (session / "epoch10.mp4").exists()


def test_remove_candidate_cleans_historical_session_when_result_files_are_already_gone(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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



def test_session_cleanup_status_is_passive_and_clear_sessions_removes_completed_history(tmp_path):
    first = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    second = tmp_path / bench.TEST_RESULTS_DIR / "session-b"
    first.mkdir(parents=True)
    second.mkdir(parents=True)
    bench._atomic_write_json(first / "test.json", {"status": "complete", "results": []})
    bench._atomic_write_json(second / "test.json", {"status": "stopped", "results": []})

    status = bench.session_cleanup_status(tmp_path)

    assert status == {"count": 2, "active": []}
    assert first.exists()
    assert second.exists()
    assert bench.clear_sessions(tmp_path) == 2
    assert not first.exists()
    assert not second.exists()


def test_clear_sessions_refuses_nonterminal_test_work_before_deleting_history(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    complete = tmp_path / bench.TEST_RESULTS_DIR / "complete-session"
    active = tmp_path / bench.TEST_RESULTS_DIR / "active-session"
    complete.mkdir(parents=True)
    active.mkdir(parents=True)
    child = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={"client": "test", "folder": ".", "sessionId": active.name, "candidateKind": "base"},
    )
    bench._atomic_write_json(complete / "test.json", {"status": "complete", "results": []})
    bench._atomic_write_json(active / "test.json", {
        "status": "queued",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [child["id"]],
        "results": [],
        "failures": [],
        "total": 1,
    })

    status = bench.session_cleanup_status(tmp_path)
    assert status["count"] == 2
    assert status["active"] == [active.name]

    with pytest.raises(RuntimeError, match="active work remains"):
        bench.clear_sessions(tmp_path)

    assert complete.exists()
    assert active.exists()


def test_legacy_set_sessions_remain_readable_without_global_recent_scan(tmp_path, monkeypatch):
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

    assert bench.list_sessions(set_folder)[0]["session"] == session.name
    assert bench.recent_test_sets() == []


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
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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

    payload = bench.open_session(tmp_path / "set", session.name)

    assert payload["status"] == "interrupted"
    assert payload["completed"] == 1
    assert payload["current"] == ""


def test_remove_candidate_allows_completed_result_while_another_candidate_is_active(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

    session = tmp_path / bench.TEST_RESULTS_DIR / "session-a"
    session.mkdir(parents=True)
    active_job = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={
            "client": "test",
            "folder": ".",
            "sessionId": session.name,
            "candidateKind": "lora",
            "candidateFile": "epoch20.safetensors",
        },
        job_id="active-other-candidate",
    )
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [active_job["id"]],
        "results": [{
            "jobId": "completed-epoch10",
            "kind": "lora",
            "sourceLoRA": candidate.name,
            "candidateFile": candidate.name,
            "outputVideo": "epoch10.mp4",
        }],
        "failures": [],
        "completed": 1,
        "failed": 0,
        "total": 2,
    })
    (session / "epoch10.mp4").write_bytes(b"video")

    payload = bench.remove_candidate(tmp_path, candidate.name, session_name=session.name)

    assert payload["sessionStatus"]["results"] == []
    assert payload["sessionStatus"]["completed"] == 0
    assert payload["sessionStatus"]["total"] == 1
    assert execution_queue.get_job(active_job["id"])["status"] == "queued"
    assert not candidate.exists()
    assert not (session / "epoch10.mp4").exists()


def test_remove_candidate_refuses_shared_active_session_result_mutation(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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
        "source": "HH4013",
        "ownerFolder": "HH4013",
        "inferenceJobs": [child["id"]],
        "results": [],
        "failures": [],
        "completed": 0,
        "failed": 0,
        "total": 1,
    })

    with pytest.raises(RuntimeError, match="active Test Generations candidate"):
        bench.remove_candidate(tmp_path, candidate.name, session_name=session.name)

    assert candidate.is_file()


def test_activity_snapshot_projects_shared_test_session(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    set_folder = tmp_path / "HH4013"
    staged = tmp_path / "staged"
    session = tmp_path / "output" / bench.TEST_RESULTS_DIR / "session-a"
    set_folder.mkdir(parents=True)
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
        "source": "HH4013",
        "modelId": bench.get_test_model().PROFILE_ID,
        "session": session.name,
        "status": "running",
        "completed": 0,
        "total": 1,
        "ownerAvailable": True,
    }]

    set_folder.rename(tmp_path / "moved-HH4013")
    assert bench.activity_snapshot()["active"][0]["ownerAvailable"] is False


def test_remove_staged_candidate_is_independent_of_other_active_inference(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    staged = tmp_path / "staged"
    staged.mkdir()
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model: staged)
    monkeypatch.setattr(bench, "_staged_loras_for_set", lambda _folder, _model: sorted(staged.glob("*.safetensors")))

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


def test_test_enqueue_survives_comfyui_unavailable_and_defers_wildcard_resolution(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    monkeypatch.setattr(
        inference_runtime,
        "resolve_wildcard_prompt",
        lambda *_args: (_ for _ in ()).throw(ConnectionError("offline")),
    )

    payload = bench.enqueue(
        tmp_path,
        "person in {studio|rooftop}",
        selected_files=[candidates[0].name],
        include_base=True,
    )

    assert payload["queued"] is True
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    manifest = bench._read_status(session)
    child_payloads = [
        execution_queue.get_job(job_id, include_payload=True)["payload"]["request"]
        for job_id in manifest["inferenceJobs"]
    ]
    assert len(child_payloads) == 2
    assert {item["prompt"] for item in child_payloads} == {"person in {studio|rooftop}"}
    assert {item["promptNeedsResolve"] for item in child_payloads} == {True}
    assert {item["settings"]["seed"] for item in child_payloads} == {77}


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
    assert not (bench._central_session_root() / payload["latest"]["session"]).exists()
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
    assert [execution_queue.transient_receipt(job_id)["status"] for job_id in child_ids[1:]] == ["cancelled", "cancelled"]
    for job_id in child_ids[1:]:
        with pytest.raises(FileNotFoundError):
            execution_queue.get_job(job_id)


def test_committed_test_result_is_recognized_after_queue_job_is_still_active(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    child = execution_queue.get_job(child_id)

    with bench._status_lock:
        status = bench._read_status(session) or {}
        status["results"] = [{
            "jobId": child_id,
            "kind": "lora",
            "sourceLoRA": candidates[0].name,
            "candidateFile": candidates[0].name,
            "mediaFile": "epoch.png",
        }]
        status["completed"] = 1
        bench._atomic_write_json(session / "test.json", status)
    (session / "epoch.png").write_bytes(b"image")

    outcome = bench.committed_inference_outcome(child)

    assert outcome["status"] == "completed"
    assert outcome["result"]["session"] == session.name
    assert outcome["result"]["mediaFile"] == "epoch.png"


def test_test_cancel_marker_prevents_replay_if_process_dies_before_queue_removal(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    child = execution_queue.get_job(child_id)

    bench._set_session_cancel_marker(session, child_id, True, reduce_total=True)

    outcome = bench.committed_inference_outcome(child)

    assert execution_queue.get_job(child_id)["status"] in {"queued", "backlog"}
    assert outcome["status"] == "cancelled"
    assert bench._read_status(session)["total"] == 0


def test_test_result_without_media_is_not_treated_as_committed(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    child = execution_queue.get_job(child_id)

    with bench._status_lock:
        status = bench._read_status(session) or {}
        status["results"] = [{
            "jobId": child_id,
            "kind": "lora",
            "sourceLoRA": candidates[0].name,
            "candidateFile": candidates[0].name,
            "mediaFile": "missing.png",
        }]
        status["completed"] = 1
        bench._atomic_write_json(session / "test.json", status)

    assert bench.committed_inference_outcome(child) is None


def test_transient_test_cancel_remains_recoverable_after_receipt_is_lost(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]

    bench._cancel_shared_pending_job(
        child_id,
        session_directory=session,
        reduce_total=True,
    )
    execution_queue.clear_transient_receipts(inference_runner.EXECUTION_LANE)

    visible = bench._sync_inference_session(session)

    assert visible["status"] == "complete"
    assert visible["total"] == 0
    assert child_id in (bench._read_status(session).get("cancelledJobIds") or [])


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
    monkeypatch.setattr(inference_runtime, "queue_managed_workflow", lambda _job_id, _workflow: "provider-1")
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

def test_completed_test_session_tolerates_pruned_execution_records(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    session = tmp_path / bench.TEST_RESULTS_DIR / "complete-session"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": ["pruned-job"],
        "results": [{
            "jobId": "pruned-job",
            "kind": "base",
            "sourceLoRA": "Base",
            "mediaFile": "base.mp4",
            "mediaKind": "video",
            "prompt": "Prompt",
            "seed": 1,
            "elapsedMs": 10,
        }],
        "failures": [],
        "completed": 1,
        "failed": 0,
        "total": 1,
    })
    (session / "base.mp4").write_bytes(b"video")

    payload = bench.open_session(tmp_path, session.name)

    assert payload["status"] == "complete"
    assert payload["completed"] == 1
    assert payload["results"][0]["jobId"] == "pruned-job"


def test_nonterminal_test_session_drops_missing_execution_record(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    session = tmp_path / bench.TEST_RESULTS_DIR / "queued-session"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "queued",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": ["missing-active-job"],
        "results": [],
        "failures": [],
        "completed": 0,
        "failed": 0,
        "total": 1,
    })

    visible = bench.open_session(tmp_path, session.name)

    assert visible["status"] == "complete"
    assert visible["queued"] == 0
    manifest = bench._read_status(session)
    assert manifest["inferenceJobs"] == []
    assert manifest["total"] == 0

def test_enqueue_registers_all_children_before_any_test_work_can_start(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=2)
    observed = {}

    def inspect_before_worker_start():
        session_root = bench._central_session_root()
        session = next(path for path in session_root.iterdir() if path.is_dir())
        manifest = bench._read_status(session)
        observed["jobIds"] = list(manifest["inferenceJobs"])
        observed["migrationComplete"] = manifest["migrationComplete"]
        observed["statuses"] = [
            execution_queue.get_job(job_id)["status"]
            for job_id in observed["jobIds"]
        ]

    monkeypatch.setattr(inference_runner, "start_observer", inspect_before_worker_start)

    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[path.name for path in candidates],
        include_base=True,
    )

    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    manifest = bench._read_status(session)
    assert len(observed["jobIds"]) == 3
    assert observed["migrationComplete"] is True
    assert observed["statuses"] == ["queued", "queued", "queued"]
    assert manifest["inferenceJobs"] == observed["jobIds"]
    assert manifest["migrationComplete"] is True



def test_stop_session_state_cannot_be_reverted_by_provider_start_publication(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    payload = bench.enqueue(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=False,
    )
    session = bench._session_directory(tmp_path, payload["latest"]["session"])
    child_id = bench._read_status(session)["inferenceJobs"][0]
    execution_queue.claim_next(inference_runner.EXECUTION_LANE)
    execution_queue.mark_running(child_id)

    stopped = bench.stop(tmp_path, session_name=session.name)
    assert stopped["status"] == "stopping"

    with bench._status_lock:
        status = bench._read_status(session) or {}
        if str(status.get("status") or "") not in {"stopping", "stopped"}:
            status["status"] = "running"
        status["comfyJobId"] = "provider-123"
        status["comfyStatus"] = "pending"
        bench._atomic_write_json(session / "test.json", status)

    manifest = bench._read_status(session)
    assert manifest["status"] == "stopping"

def test_test_enqueue_failure_cleans_inert_children_and_incomplete_session(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    original_enqueue = inference_runner.enqueue_test
    calls = {"count": 0}

    def flaky_enqueue(request, context, label="", deferred=False):
        calls["count"] += 1
        if calls["count"] == 1:
            return original_enqueue(request, context, label=label, deferred=deferred)
        raise RuntimeError("second rendition enqueue failed")

    monkeypatch.setattr(inference_runner, "enqueue_test", flaky_enqueue)

    with pytest.raises(RuntimeError, match="second rendition enqueue failed"):
        bench.enqueue(
            tmp_path,
            "prompt",
            selected_files=[candidates[0].name],
            include_base=True,
        )

    sessions = [path for path in bench._central_session_root().iterdir() if path.is_dir()]
    assert sessions == []
    queue = execution_queue.lane_snapshot(inference_runner.EXECUTION_LANE, include_terminal=False)
    assert queue["jobs"] == []





def test_test_directory_preserves_full_current_set_path(tmp_path, monkeypatch):
    model = bench.get_test_model()
    seen = {}
    expected = tmp_path / "test-root" / "sets" / "demo"

    def fake_test_copy_path(stage, set_folder):
        seen["stage"] = stage
        seen["setFolder"] = set_folder
        return expected

    monkeypatch.setattr(bench, "test_copy_path", fake_test_copy_path)
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)
    resolved = bench._test_directory(set_folder, model, source="ignored/manual")

    assert resolved == expected
    assert seen == {"stage": model.STAGING_KEY, "setFolder": "sets/demo"}


def test_prepare_returns_candidates_from_current_test_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    model = patch_default_test_model(monkeypatch, template={}, settings={"seed": 1})
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)
    monkeypatch.setattr(bench, "list_sessions", lambda _folder, model_id=None: [])
    monkeypatch.setattr(bench, "status", lambda _folder, model_id=None: {"status": "idle"})

    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)
    for name, owner in (("owned.safetensors", "sets/demo"), ("moved.safetensors", "sets/other")):
        lora = staged / name
        lora.write_bytes(b"weights")
        lora.with_suffix(".webcap.json").write_text(json.dumps({
            "version": 1,
            "sourceJobId": name,
            "sourceEpoch": 1,
            "sourceFileName": name,
            "sourceFolder": owner,
            "stage": model.STAGING_KEY,
        }), encoding="utf-8")

    payload = bench.prepare(set_folder, model.PROFILE_ID)
    assert payload["files"] == ["moved.safetensors", "owned.safetensors"]
    assert payload["count"] == 2


def test_selected_test_candidates_follow_current_test_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    model = bench.get_test_model()
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)
    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)

    moved = staged / "moved.safetensors"
    moved.write_bytes(b"weights")
    moved.with_suffix(".webcap.json").write_text(json.dumps({
        "version": 1,
        "sourceJobId": "foreign-job",
        "sourceEpoch": 2,
        "sourceFileName": moved.name,
        "sourceFolder": "sets/other",
        "stage": model.STAGING_KEY,
    }), encoding="utf-8")

    assert bench._selected_lora_files_for_set(set_folder, model, [moved.name]) == [moved]


def test_new_test_sessions_use_output_storage_and_freeze_candidate_provenance(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    model = patch_default_test_model(
        monkeypatch,
        template={},
        settings={"seed": 1},
    )
    staged = tmp_path / "staged"
    staged.mkdir(parents=True)
    candidate = staged / "epoch10.safetensors"
    candidate.write_bytes(b"weights")
    candidate.with_suffix(".webcap.json").write_text(json.dumps({
        "version": 1,
        "sourceJobId": "job-10",
        "sourceRunName": "Character",
        "sourceRunSequence": "01",
        "sourceEpoch": 10,
        "sourceFileName": candidate.name,
        "sourceFolder": "sets/demo",
        "stage": model.STAGING_KEY,
    }), encoding="utf-8")
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)
    monkeypatch.setattr(inference_runner, "enqueue_test", lambda request, context, label="", deferred=False: {"jobId": "job-" + context["candidateKind"]})
    monkeypatch.setattr(bench, "execution_promote_backlog", lambda job_id: {"id": job_id, "status": "queued"})
    monkeypatch.setattr(inference_runner, "start_observer", lambda: None)
    monkeypatch.setattr(bench, "_sync_inference_session", lambda directory: bench._session_status(directory))

    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)
    request = {
        "modelId": model.PROFILE_ID,
        "mediaKind": model.MEDIA_KIND,
        "name": "",
        "sourcePrompt": "prompt",
        "prompt": "prompt",
        "settings": {"seed": 1},
        "workflow": {},
        "workflowFile": "test.json",
        "workflowSha256": "abc",
    }

    session = bench._enqueue_frozen_test_request(set_folder, request, [candidate], include_base=False)
    path = tmp_path / "output" / bench.TEST_RESULTS_DIR / session["session"] / "test.json"
    payload = json.loads(path.read_text(encoding="utf-8"))

    assert "source" not in payload
    assert payload["ownerFolder"] == "sets/demo"
    assert payload["candidates"][0]["provenance"]["sourceJobId"] == "job-10"
    assert payload["candidates"][0]["provenance"]["sourceEpoch"] == 10
    assert not (set_folder / bench.TEST_RESULTS_DIR).exists()

def test_new_output_test_root_wins_same_name_collision_with_legacy_central(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: tmp_path / "creative")
    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)

    current = tmp_path / "creative" / bench.TEST_RESULTS_DIR / "same-session"
    legacy = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR / "same-session"
    current.mkdir(parents=True)
    legacy.mkdir(parents=True)
    bench._atomic_write_json(current / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared",
        "ownerFolder": "sets/demo",
        "results": [],
        "name": "Current",
    })
    bench._atomic_write_json(legacy / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared",
        "ownerFolder": "sets/demo",
        "results": [],
        "name": "Legacy",
    })

    opened = bench.open_session(set_folder, "same-session")

    assert opened["name"] == "Current"
    assert [item["session"] for item in bench.list_sessions(set_folder)] == ["same-session"]


def test_legacy_central_test_sessions_remain_readable_after_output_alignment(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: tmp_path / "creative")
    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)
    legacy = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR / "legacy-session"
    legacy.mkdir(parents=True)
    bench._atomic_write_json(legacy / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared",
        "ownerFolder": "sets/demo",
        "results": [],
    })

    assert bench.open_session(set_folder, "legacy-session")["session"] == "legacy-session"


def test_output_root_session_media_and_rating_work_outside_fs_root(tmp_path, monkeypatch):
    fs_root = tmp_path / "sets-root"
    output_root = tmp_path / "creative-output"
    set_folder = fs_root / "sets" / "demo"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(bench.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: output_root)

    session = output_root / bench.TEST_RESULTS_DIR / "outside-session"
    session.mkdir(parents=True)
    media = session / "result.png"
    media.write_bytes(b"image")
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared",
        "ownerFolder": "sets/demo",
        "results": [{"mediaFile": media.name}],
    })

    assert bench.resolve_result_media(set_folder, session.name, media.name) == media
    rated = bench.rate_result(set_folder, session.name, media.name, 4)
    assert rated["rating"] == 4
    assert bench.open_session(set_folder, session.name)["results"][0]["rating"] == 4
    assert bench.open_session(set_folder, session.name)["resultFolder"] == ""


def test_output_root_session_remains_usable_when_owner_set_is_missing(tmp_path, monkeypatch):
    fs_root = tmp_path / "sets-root"
    output_root = tmp_path / "creative-output"
    moved_set = fs_root / "sets" / "moved-away"
    monkeypatch.setattr(bench.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: output_root)

    session = output_root / bench.TEST_RESULTS_DIR / "surviving-session"
    session.mkdir(parents=True)
    media = session / "result.png"
    media.write_bytes(b"image")
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "staged/demo",
        "ownerFolder": "sets/moved-away",
        "results": [{"mediaFile": media.name}],
    })

    assert not moved_set.exists()
    assert [item["session"] for item in bench.list_sessions(moved_set)] == ["surviving-session"]
    assert bench.open_session(moved_set, session.name)["session"] == session.name
    assert bench.resolve_result_media(moved_set, session.name, media.name) == media
    assert bench.rate_result(moved_set, session.name, media.name, 5)["rating"] == 5


def test_output_root_result_media_rejects_path_escape(tmp_path, monkeypatch):
    fs_root = tmp_path / "sets-root"
    output_root = tmp_path / "creative-output"
    set_folder = fs_root / "sets" / "demo"
    set_folder.mkdir(parents=True)
    monkeypatch.setattr(bench.app_config, "FS_ROOT", fs_root)
    monkeypatch.setattr(bench.app_config, "output_root", lambda: output_root)

    session = output_root / bench.TEST_RESULTS_DIR / "session"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared",
        "ownerFolder": "sets/demo",
        "results": [],
    })

    with pytest.raises(ValueError, match="valid Test result media filename"):
        bench.resolve_result_media(set_folder, session.name, "../outside.png")


def test_central_test_sessions_are_scoped_to_their_owning_set(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    first_set = tmp_path / "sets" / "first"
    second_set = tmp_path / "sets" / "second"
    first_set.mkdir(parents=True)
    second_set.mkdir(parents=True)

    root = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR
    first_session = root / "first-session"
    second_session = root / "second-session"
    first_session.mkdir(parents=True)
    second_session.mkdir(parents=True)
    bench._atomic_write_json(first_session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared-source",
        "ownerFolder": "sets/first",
        "results": [],
    })
    bench._atomic_write_json(second_session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "shared-source",
        "ownerFolder": "sets/second",
        "results": [],
    })

    assert [item["session"] for item in bench.list_sessions(first_set)] == ["first-session"]
    assert [item["session"] for item in bench.list_sessions(second_set)] == ["second-session"]
    assert bench.open_session(first_set, "first-session")["session"] == "first-session"
    with pytest.raises(FileNotFoundError, match="this Set"):
        bench.open_session(first_set, "second-session")



def test_recent_test_sets_keep_same_historical_source_separate_by_owner(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_recent_sets_cache", {"items": [], "expires": 0})
    root = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR
    for name, owner in (("first-session", "sets/first"), ("second-session", "sets/second")):
        session = root / name
        session.mkdir(parents=True)
        bench._atomic_write_json(session / "test.json", {
            "status": "complete",
            "modelId": "minimax_h3",
            "source": "shared-source",
            "ownerFolder": owner,
            "results": [],
        })

    recent = bench.recent_test_sets()
    assert {(item["folder"], item["sessionCount"]) for item in recent} == {
        ("sets/first", 1),
        ("sets/second", 1),
    }
    assert all("source" not in item for item in recent)


def test_recent_test_sets_are_derived_from_central_session_owner_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_recent_sets_cache", {"items": [], "expires": 0})
    session = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR / "2026-09-23_1900-h3"
    session.mkdir(parents=True)
    bench._atomic_write_json(session / "test.json", {
        "status": "complete",
        "modelId": "minimax_h3",
        "source": "archive/selected-run",
        "ownerFolder": "sets/swimwear",
        "results": [],
    })

    recent = bench.recent_test_sets()
    assert recent[0]["folder"] == "sets/swimwear"
    assert recent[0]["modelId"] == "minimax_h3"
    assert recent[0]["sessionCount"] == 1
    assert "source" not in recent[0]
    assert recent[0]["ownerAvailable"] is False

    owner = tmp_path / "sets" / "swimwear"
    owner.mkdir(parents=True)
    assert bench.recent_test_sets()[0]["ownerAvailable"] is True


def test_historical_session_source_does_not_filter_set_history(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    folder = tmp_path / "sets" / "demo"
    folder.mkdir(parents=True)
    root = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR
    for name, source in (("old-a", "demo"), ("old-b", "archive/demo")):
        session = root / name
        session.mkdir(parents=True)
        bench._atomic_write_json(session / "test.json", {
            "status": "complete",
            "modelId": "minimax_h3",
            "source": source,
            "ownerFolder": "sets/demo",
            "results": [],
        })

    assert [item["session"] for item in bench.list_sessions(folder, model_id="minimax_h3")] == ["old-b", "old-a"]

def test_recent_test_prompts_are_distinct_and_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(bench, "_recent_prompts_cache", {"expires": 0.0, "items": [], "root": None})
    root = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR
    rows = (
        ("older-session", "sets/first", "portrait prompt", 100),
        ("newer-session", "sets/second", "portrait prompt", 300),
        ("middle-session", "sets/third", "fashion prompt", 200),
    )
    for name, owner, prompt, modified in rows:
        session = root / name
        session.mkdir(parents=True)
        manifest = session / "test.json"
        bench._atomic_write_json(manifest, {
            "status": "complete",
            "modelId": "minimax_h3",
            "source": owner.split("/")[-1],
            "ownerFolder": owner,
            "sourcePrompt": prompt,
            "results": [],
        })
        os.utime(manifest, (modified, modified))

    recent = bench.recent_test_prompts()

    assert [item["prompt"] for item in recent] == ["portrait prompt", "fashion prompt"]
    assert recent[0]["folder"] == "sets/second"
    assert recent[0]["session"] == "newer-session"


def test_manual_lora_without_webcap_provenance_is_a_test_candidate(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    staged = tmp_path / "test-root" / "manual"
    staged.mkdir(parents=True)
    candidate = staged / "manual.safetensors"
    candidate.write_bytes(b"weights")
    model = bench.get_test_model()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)
    set_folder = tmp_path / "sets" / "demo"
    set_folder.mkdir(parents=True)

    assert bench._staged_loras_for_set(set_folder, model) == [candidate]
    payload = bench.remove_candidate(set_folder, candidate.name, model_id=model.PROFILE_ID)
    assert payload["removed"] == candidate.name
    assert not candidate.exists()


def test_session_history_is_scoped_by_set_and_model_not_historical_source(tmp_path, monkeypatch):
    monkeypatch.setattr(bench.app_config, "FS_ROOT", tmp_path)
    folder = tmp_path / "sets" / "demo"
    folder.mkdir(parents=True)
    root = tmp_path / ".webcap" / bench.TEST_RESULTS_DIR
    for name, model_id, source in (
        ("h3-session", "minimax_h3", "old/source-a"),
        ("krea-session", "krea2_raw", "old/source-b"),
    ):
        session = root / name
        session.mkdir(parents=True)
        bench._atomic_write_json(session / "test.json", {
            "status": "complete",
            "modelId": model_id,
            "source": source,
            "ownerFolder": "sets/demo",
            "results": [],
        })

    h3 = bench.list_sessions(folder, model_id="minimax_h3")
    krea = bench.list_sessions(folder, model_id="krea2_raw")

    assert [item["session"] for item in h3] == ["h3-session"]
    assert [item["session"] for item in krea] == ["krea-session"]

def test_backlogged_partial_test_session_is_pending_not_running(tmp_path, monkeypatch):
    configure_execution_queue(monkeypatch, tmp_path)
    session = tmp_path / bench.TEST_RESULTS_DIR / "session-backlog"
    session.mkdir(parents=True)
    child = execution_queue.enqueue(
        inference_runner.EXECUTION_LANE,
        {"request": {"modelId": bench.get_test_model().PROFILE_ID}},
        metadata={
            "client": "test",
            "folder": ".",
            "sessionId": session.name,
            "candidateKind": "base",
            "label": "Comparison · Base",
        },
        initial_status="backlog",
    )
    bench._atomic_write_json(session / "test.json", {
        "status": "running",
        "modelId": bench.get_test_model().PROFILE_ID,
        "inferenceJobs": [child["id"]],
        "results": [{"jobId": "completed-before-restart", "kind": "base", "mediaFile": "base.png"}],
        "failures": [],
        "completed": 1,
        "failed": 0,
        "total": 2,
    })

    visible = bench._sync_inference_session(session)

    assert visible["status"] == "queued"
    assert visible["running"] == 0
    assert visible["queued"] == 1


def test_legacy_test_migration_creates_inert_backlog(tmp_path, monkeypatch):
    _staged, candidates = _prepare_shared_test_enqueue(tmp_path, monkeypatch, candidate_count=1)
    request, loras, include_base = bench._new_inference_request(
        tmp_path,
        "prompt",
        selected_files=[candidates[0].name],
        include_base=True,
    )

    visible = bench._enqueue_frozen_test_request(
        tmp_path,
        request,
        loras,
        include_base,
        legacy_job_id="legacy-test-job",
    )

    session = bench._session_directory(tmp_path, visible["session"])
    jobs = [
        execution_queue.get_job(job_id)
        for job_id in bench._read_status(session)["inferenceJobs"]
    ]
    assert jobs
    assert {job["status"] for job in jobs} == {"backlog"}
    assert inference_runner._monitor_has_work() is False


def test_prepare_exposes_unique_training_run_provenance_for_staged_loras(tmp_path, monkeypatch):
    staged = tmp_path / "staged"
    staged.mkdir()
    monkeypatch.setattr(bench, "_test_directory", lambda _folder, _model, source=None: staged)

    first = staged / "run-03__epoch20.safetensors"
    first.write_bytes(b"weights")
    first.with_suffix(".webcap.json").write_text(json.dumps({
        "version": 1,
        "stage": bench.get_test_model().STAGING_KEY,
        "sourceJobId": "job-03",
        "sourceFolder": "sets/demo",
        "sourceFileName": first.name,
        "sourceEpoch": 20,
        "sourceRunName": "Character pass",
        "sourceRunSequence": "03",
        "runSummary": {"lr": 0.0001},
    }), encoding="utf-8")

    second = staged / "run-03__epoch25.safetensors"
    second.write_bytes(b"weights")
    second.with_suffix(".webcap.json").write_text(json.dumps({
        "version": 1,
        "stage": bench.get_test_model().STAGING_KEY,
        "sourceJobId": "job-03",
        "sourceFolder": "sets/demo",
        "sourceFileName": second.name,
        "sourceEpoch": 25,
        "sourceRunName": "Character pass",
        "sourceRunSequence": "03",
        "runSummary": {"lr": 0.0001},
    }), encoding="utf-8")

    payload = bench.prepare(tmp_path)
    assert payload["candidateRuns"] == [{
        "jobId": "job-03",
        "folder": "sets/demo",
        "runName": "Character pass",
        "runSequence": "03",
        "runSummary": {"lr": 0.0001},
    }]
