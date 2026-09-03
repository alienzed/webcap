import json
from pathlib import Path

import pytest
from PIL import Image

from tool.server import config as app_config
from tool.server import app as app_module
from tool.server import run_ops, training_bundle, training_history, training_runner, training_review
from tool.server.training_action import allocate_action, read_action
from tool.server.training_config_files import reset_training_config_file
from tool.server.training_profiles import MINIMAX_H3_PROFILE_ID, config_for_stage, profile_for_mode
from tool.server.training_setup import ensure_training_setup


def _set(root):
    folder = root / "sets" / "subject"
    folder.mkdir(parents=True)
    Image.new("RGB", (512, 512), color=(20, 30, 40)).save(folder / "one.png")
    Image.new("RGB", (768, 768), color=(40, 30, 20)).save(folder / "two.png")
    (folder / "one.txt").write_text("one subject", encoding="utf-8")
    (folder / "two.txt").write_text("two subject", encoding="utf-8")
    return folder


def _configure_root(monkeypatch, root):
    monkeypatch.setattr(app_config, "FS_ROOT", root)
    training_runner._state_file_seen = None
    training_runner._persisted_managed_job_ids = set()
    training_runner._startup_reconciled = False


def _fake_runtime(monkeypatch):
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {
        "wslDistribution": "", "cwd": "/tmp", "activate": "",
    })
    as_wsl = lambda path, distribution="": Path(path).as_posix()
    monkeypatch.setattr(training_runner, "_to_wsl_path", as_wsl)
    monkeypatch.setattr(training_bundle, "to_wsl_path", as_wsl)


def test_canonical_set_tomls_are_materialized_resettable_and_never_mode_duplicated(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)

    result = ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "quality", selected_media=["one.png", "two.png"])

    assert result["mode"] == "normal"
    assert (folder / "config.h3.toml").is_file()
    assert (folder / "dataset.train.toml").is_file()
    assert not list(folder.glob("config.h3.*.toml"))
    (folder / "config.h3.toml").write_text("not = [valid", encoding="utf-8")
    with pytest.raises(Exception):
        ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    reset_training_config_file(folder, "config.h3.toml", profile_id=MINIMAX_H3_PROFILE_ID, mode="normal")
    assert "output_dir" in (folder / "config.h3.toml").read_text(encoding="utf-8")


def test_review_is_toml_backed_inclusive_and_returns_distribution(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)

    payload = training_review.prepare_training_review(
        folder, MINIMAX_H3_PROFILE_ID, "train", ["one.png", "two.png"], total_media_count=2,
    )

    assert payload["ok"] is True
    assert payload["customDataset"] is False
    assert payload["distribution"]["images"]["square"]["native"]
    entries = payload["review"]["stages"]["h3"]["datasetEntries"]
    assert sum(entry["eligibleCount"] for entry in entries if entry["kind"] == "image") == 2
    assert not (folder / ".webcap_state.json").exists()


def test_custom_valid_dataset_disables_wizard_but_does_not_block_training_review(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    (folder / "dataset.train.toml").write_text(
        '[[directory]]\npath = "custom"\nnum_repeats = 1\ngroup = "images"\nsize_buckets = [[512, 512, 1]]\nextra = true\n',
        encoding="utf-8",
    )

    payload = training_review.prepare_training_review(folder, MINIMAX_H3_PROFILE_ID, "train", ["one.png"])

    assert payload["ok"] is True
    assert payload["customDataset"]


def test_bundle_copies_source_bytes_into_a_distinct_capture(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    action, _ = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",))

    bundle = training_bundle.materialize_training_bundle(
        folder, action, MINIMAX_H3_PROFILE_ID, "normal", "h3", ["one.png"], output_dirs={"h3": str(action / "output" / "minimax-h3")},
    )

    copied = Path(bundle["inputPath"]) / "media" / "square_img" / "one.png"
    assert copied.read_bytes() == (folder / "one.png").read_bytes()
    assert Path(bundle["path"]).parent.name == "captures"
    assert (Path(bundle["path"]) / "summary.json").is_file()
    assert (Path(bundle["path"]) / "config.h3.toml").is_file()


def test_captured_review_dataset_keeps_image_frame_count_and_bucket_annotations(tmp_path, monkeypatch):
    monkeypatch.setattr(training_bundle, "to_wsl_path", lambda path, distribution="": Path(path).as_posix())
    media_root = tmp_path / "capture" / "media"
    source = media_root / "square_img" / "one.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"image")
    source.with_suffix(".txt").write_text("caption", encoding="utf-8")
    stage_plan = {"datasetEntries": [{
        "kind": "image", "role": "image", "ar": "square", "bucket": [512, 512], "sourceDir": "square_img",
        "files": ["one.png"], "eligibleCount": 1, "nativeCount": 1, "upscaledCount": 0, "numRepeats": 10,
    }]}
    ladders = {"images": {"square": [[768, 768], [512, 512], [384, 384]]}, "videos": {}}

    text = training_bundle._materialize_review_stage_dataset("h3", stage_plan, media_root, "", ladders)

    assert "enable_ar_bucket = true" in text
    assert "[512, 512, 1]" in text
    assert "# bucket: 512 × 512 × 1 frame" in text
    assert "# assigned: 1 item · 1 near/native · 0 resized" in text
    assert "# adjacent supported targets: lower 384 × 384 · higher 768 × 768" in text


def test_capture_rejects_an_invalid_managed_video_bucket(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    action, _ = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",))
    invalid_review = {"review": {"stages": {"h3": {"datasetEntries": [{
        "kind": "video", "role": "temporal", "bucket": [400, 400, 68], "sourceDir": "square_video",
    }]}}}}

    with pytest.raises(ValueError, match="outside the current managed policy"):
        training_bundle.materialize_training_bundle(
            folder, action, MINIMAX_H3_PROFILE_ID, "normal", "h3", ["one.png"],
            output_dirs={"h3": str(action / "output" / "minimax-h3")}, review=invalid_review,
        )


def test_video_capture_is_always_a_direct_copy(tmp_path):
    source = tmp_path / "source.mp4"
    destination = tmp_path / "capture" / "source.mp4"
    source.write_bytes(b"original-video-bytes")

    result = training_bundle._copy_or_convert_bundle_video(source, destination, 24, 16)

    assert result == {"action": "copied"}
    assert destination.read_bytes() == source.read_bytes()


def test_custom_initializer_file_is_copied_into_the_capture(tmp_path):
    source = tmp_path / "epoch7.safetensors"
    source.write_bytes(b"initializer-bytes")

    captured = training_bundle._capture_initializer({"sourcePath": source, "exportId": "custom"}, tmp_path / "capture")

    assert (captured["path"] / source.name).read_bytes() == source.read_bytes()


def test_train_captures_before_it_writes_the_queue_and_skips_preflight(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda *args, **kwargs: pytest.fail("Train must not preflight"))
    folder = _set(tmp_path)
    training_runner._write_state({"version": 3, "activeJobId": "", "jobs": [], "queuePaused": True, "queuePauseReason": "test"})

    payload, status = training_runner.start_response(
        "sets/subject", queue=True, stages="h3", profile_id=MINIMAX_H3_PROFILE_ID, run_id="train",
        selected_media=["one.png"], total_media_count=2,
    )

    assert status == 200 and payload["ok"] is True
    state = training_runner._read_state()
    assert len(state["jobs"]) == 1
    assert Path(state["jobs"][0]["inputPath"]).is_dir()


def test_pre_layout_queue_state_uses_recorded_paths_without_action_resolution(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    legacy_root = tmp_path / "output" / "runs" / "001-subject--h3"
    capture = legacy_root / "captures" / "old-capture"
    job_dir = legacy_root / "jobs" / "old-job"
    capture.mkdir(parents=True)
    job_dir.mkdir(parents=True)
    config = capture / "config.h3.toml"
    config.write_text((folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8")
    legacy_job = {
        "id": "old-job", "folder": "sets/subject", "status": "queued", "stages": "h3",
        "actionId": "001-subject--h3", "actionPath": str(legacy_root), "artifactDir": str(job_dir),
        "bundleArtifacts": {"h3Config": str(config)}, "outputRoot": str(legacy_root / "output" / "minimax-h3"),
    }
    state_path = training_runner._state_path()
    state_path.parent.mkdir(parents=True)
    state_path.write_text(json.dumps({"version": 3, "activeJobId": "", "jobs": [], "queuePaused": False, "queuePauseReason": ""}), encoding="utf-8")
    assert training_runner._read_state()["jobs"] == []

    state_path.write_text(json.dumps({"version": 3, "activeJobId": "", "jobs": [legacy_job], "queuePaused": False, "queuePauseReason": ""}), encoding="utf-8")
    monkeypatch.setattr(training_runner, "read_action", lambda *_args: pytest.fail("legacy queue launch must not resolve actionId"))
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (0, "4242\n", ""))
    state = training_runner._read_state()
    training_runner._launch_next_queued_job(state)
    assert state["activeJobId"] == "old-job"
    assert state["jobs"][0]["status"] == "starting"
    assert (job_dir / "runner.sh").is_file()

    state["jobs"][0].update({"status": "running", "runnerScriptWsl": "/runs/runner.sh", "pid": 4242})
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (0, "/bin/bash\n/runs/runner.sh\n", ""))
    monkeypatch.setattr(training_runner, "_log_has_progress", lambda _text: True)
    training_runner._refresh_state(state)
    assert state["jobs"][0]["status"] == "running"


def test_recent_runs_v1_remains_readable_without_layout_migration(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)
    recent = tmp_path / ".webcap_training" / "recent_runs.json"
    recent.parent.mkdir()
    recent.write_text(json.dumps({"version": 1, "jobs": [{"id": "old", "folder": "sets/subject"}]}), encoding="utf-8")
    assert training_history.read_history(folder)["jobs"][0]["id"] == "old"


def test_additive_queue_v4_state_remains_readable(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    state_path = training_runner._state_path()
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({"version": 4, "activeJobId": "", "jobs": [], "queuePaused": False, "queuePauseReason": ""}), encoding="utf-8")
    assert training_runner._read_state()["version"] == 3


def test_recent_run_resume_reuses_its_recorded_capture(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    action, action_data = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",))
    bundle = training_bundle.materialize_training_bundle(
        folder, action, MINIMAX_H3_PROFILE_ID, "normal", "h3", ["one.png"], output_dirs={"h3": str(action / "output" / "minimax-h3")},
    )
    resume_output = action / "output" / "minimax-h3" / "checkpoint-run"
    (resume_output / "global_step1").mkdir(parents=True)
    (resume_output / "latest").write_text("global_step1\n", encoding="utf-8")
    (resume_output / "config.h3.toml").write_text((folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8")
    captures_before = list((action / "captures").iterdir())
    training_runner._write_state({"version": 3, "activeJobId": "", "jobs": [], "queuePaused": True, "queuePauseReason": "test"})

    payload, status = training_runner.start_response(
        "sets/subject", queue=True, stages="h3", resume_from_checkpoint=str(resume_output), resume_stage="h3",
        profile_id=MINIMAX_H3_PROFILE_ID, run_id="train", reuse_capture_action_id=action_data["actionId"], reuse_capture_path=bundle["path"],
    )

    assert status == 200 and payload["ok"] is True
    assert list((action / "captures").iterdir()) == captures_before
    assert payload["job"]["inputPath"] == str(bundle["path"])


def test_capture_failure_never_appends_a_queue_item(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    folder = _set(tmp_path)
    monkeypatch.setattr(training_runner, "materialize_training_bundle", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("copy failed")))

    payload, status = training_runner.start_response(
        "sets/subject", queue=True, stages="h3", profile_id=MINIMAX_H3_PROFILE_ID, run_id="train", selected_media=["one.png"],
    )

    assert status == 400 and payload["ok"] is False
    assert training_runner._read_state()["jobs"] == []


def test_custom_resume_creates_a_new_logical_run_without_writing_beside_source(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    _fake_runtime(monkeypatch)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    folder = _set(tmp_path)
    resumed_run = tmp_path / "external-output" / "20260831-120000"
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    (resumed_run / "global_step1").mkdir(parents=True)
    (resumed_run / "latest").write_text("global_step1\n", encoding="utf-8")
    (resumed_run / "config.h3.toml").write_text((folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8")
    training_runner._write_state({"version": 3, "activeJobId": "", "jobs": [], "queuePaused": True, "queuePauseReason": "test"})

    payload, status = training_runner.start_response(
        "sets/subject", queue=True, stages="h3", profile_id=MINIMAX_H3_PROFILE_ID, run_id="train",
        selected_media=["one.png"], resume_from_checkpoint=str(resumed_run),
    )

    assert status == 200 and payload["ok"] is True
    job = training_runner._read_state()["jobs"][0]
    action_root = Path(job["actionPath"])
    capture = Path(job["inputPath"])
    assert capture.parent == action_root / "captures"
    assert Path(job["outputRoot"]) == action_root / "output"
    assert job["resumeFromCheckpoint"] == str(resumed_run) and job["outputRunPath"] == ""
    assert not (resumed_run.parent / ".webcap-captures").exists()


def test_manual_command_resolves_managed_resume_and_preserves_custom_resume(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    managed_action, managed_data = allocate_action(
        folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",)
    )
    managed_run = managed_action / "output" / "managed-run"
    (managed_run / "global_step1").mkdir(parents=True)
    (managed_run / "latest").write_text("global_step1\n", encoding="utf-8")
    (managed_run / "config.h3.toml").write_text((folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8")
    logical_runs_before = {path.name for path in managed_action.parent.iterdir() if path.is_dir()}
    captured = tmp_path / "manual-capture"
    captured.mkdir()

    def fake_bundle(_folder, _action, *_args, **_kwargs):
        return {
            "path": captured,
            "inputPath": captured,
            "capturedItemCount": 1,
            "summary": {},
            "artifacts": {"h3Config": folder / "config.h3.toml"},
        }

    monkeypatch.setattr(run_ops, "materialize_training_bundle", fake_bundle)
    monkeypatch.setattr(run_ops, "training_runtime_settings", lambda _settings: {
        "cwd": "/pipe", "activate": "", "wslDistribution": "", "condaExecutable": "", "condaEnvironment": "",
    })
    monkeypatch.setattr(run_ops, "_to_wsl_path", lambda path, _distribution="": "/wsl" + Path(path).as_posix())
    monkeypatch.setattr(run_ops, "stream_with_context", lambda generator: generator)

    client = app_module.app.test_client()
    request = {
        "folder": "sets/subject", "stages": "h3", "resumeStage": "h3",
        "profileId": MINIMAX_H3_PROFILE_ID, "runId": "train", "selected_media": ["one.png"],
    }
    managed_response = client.post("/fs/train_run", json={
        **request, "resumeActionId": managed_data["actionId"], "resumeOutputId": "output/managed-run",
    })
    assert managed_response.status_code == 200
    managed_text = managed_response.data.decode("utf-8")
    assert "--resume_from_checkpoint /wsl" + managed_run.as_posix() in managed_text
    assert {path.name for path in managed_action.parent.iterdir() if path.is_dir()} == logical_runs_before
    assert "externalOutput" not in read_action(managed_data["actionId"])[1]

    custom = tmp_path / "external" / "custom-run"
    (custom / "global_step1").mkdir(parents=True)
    (custom / "latest").write_text("global_step1\n", encoding="utf-8")
    (custom / "config.h3.toml").write_text(
        (folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8"
    )
    custom_response = client.post("/fs/train_run", json={**request, "resumeFromCheckpoint": str(custom)})
    assert custom_response.status_code == 200
    assert len({path.name for path in managed_action.parent.iterdir() if path.is_dir()}) == len(logical_runs_before) + 1
    fresh_response = client.post("/fs/train_run", json=request)
    assert fresh_response.status_code == 200
    custom_text = custom_response.data.decode("utf-8")
    fresh_text = fresh_response.data.decode("utf-8")
    assert "--resume_from_checkpoint /wsl" + custom.as_posix() in custom_text
    assert "--resume_from_checkpoint" not in fresh_text


def test_initializer_picker_lists_only_current_set_managed_epoch_exports(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)
    ensure_training_setup(folder, MINIMAX_H3_PROFILE_ID, "normal", selected_media=["one.png"])
    action, _ = allocate_action(folder, profile_for_mode(MINIMAX_H3_PROFILE_ID), "normal", ("h3",))
    run = action / "output" / "20260831-120000"
    (run / "global_step1").mkdir(parents=True)
    (run / "latest").write_text("global_step1\n", encoding="utf-8")
    (run / "config.h3.toml").write_text((folder / "config.h3.toml").read_text(encoding="utf-8"), encoding="utf-8")
    epoch = run / "epoch1"
    epoch.mkdir()
    (epoch / "adapter.safetensors").write_bytes(b"weights")

    exports = training_review.discover_saved_initializers(folder, MINIMAX_H3_PROFILE_ID, "h3")

    assert len(exports) == 1
    assert exports[0]["sourcePath"] == str(epoch)


def test_restart_keeps_verified_live_runner_active(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    monitor_starts = []
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: monitor_starts.append(True))
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (0, "/bin/bash\n/runs/runner.sh\n", ""))
    monkeypatch.setattr(training_runner, "_log_has_progress", lambda _text: True)
    state = {
        "version": 3, "activeJobId": "active", "queuePaused": False, "queuePauseReason": "",
        "jobs": [
            {"id": "later", "status": "queued", "stages": "h3"},
            {
                "id": "active", "status": "running", "stages": "h3", "pid": 4242,
                "runnerScriptWsl": "/runs/runner.sh", "outputRunPath": "/runs/original",
            },
        ],
    }
    training_runner._write_state(state)

    training_runner.start_observer()
    assert monitor_starts == [True]
    assert training_runner._read_state() == state

    training_runner._refresh_state(state)
    training_runner._write_state(state)
    restored = training_runner._read_state()

    active = next(job for job in restored["jobs"] if job["id"] == "active")
    assert restored["queuePaused"] is False
    assert restored["activeJobId"] == "active"
    assert [job["id"] for job in restored["jobs"]] == ["later", "active"]
    assert active["status"] == "running"
    assert active["pid"] == 4242
    assert active["runnerVerified"] is True


def test_restart_preserves_missing_runner_state_and_blocks_queue(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (3, "", ""))
    state = {
        "version": 3, "activeJobId": "active", "queuePaused": False, "queuePauseReason": "",
        "jobs": [
            {"id": "later", "status": "queued", "stages": "h3"},
            {
                "id": "active", "status": "running", "stages": "h3", "pid": 4242,
                "runnerScriptWsl": "/runs/runner.sh", "outputRunPath": "/runs/original",
            },
        ],
    }
    training_runner._write_state(state)

    training_runner._refresh_state(state)
    training_runner._write_state(state)
    restored = training_runner._read_state()

    assert restored["queuePaused"] is False
    assert [job["id"] for job in restored["jobs"]] == ["later", "active"]
    active = restored["jobs"][1]
    assert restored["activeJobId"] == "active"
    assert active["status"] == "running"
    assert active["pid"] == 4242
    assert "runnerVerified" not in active
    assert "resumeFromCheckpoint" not in active
    assert "no longer active" in active["error"]


def test_restart_preserves_unverifiable_runner_until_exact_process_verifies(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    state = {
        "version": 3, "activeJobId": "active", "queuePaused": False, "queuePauseReason": "",
        "jobs": [
            {
                "id": "active", "status": "running", "stages": "h3", "pid": 4242,
                "runnerScriptWsl": "/runs/runner.sh", "outputRunPath": "/runs/original", "runnerVerified": True,
            },
            {"id": "later", "status": "queued", "stages": "h3"},
        ],
    }
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (1, "", "WSL is unavailable"))

    training_runner._refresh_state(state)
    active = state["jobs"][0]

    assert state["queuePaused"] is False
    assert state["activeJobId"] == "active"
    assert [job["id"] for job in state["jobs"]] == ["active", "later"]
    assert active["status"] == "running"
    assert active["pid"] == 4242
    assert "runnerVerified" not in active
    assert "WSL is unavailable" in active["error"]

    monkeypatch.setattr(training_runner, "_run_wsl", lambda *_args, **_kwargs: (0, "/bin/bash\n/runs/runner.sh\n", ""))
    monkeypatch.setattr(training_runner, "_log_has_progress", lambda _text: True)
    training_runner._refresh_state(state)

    assert active["runnerVerified"] is True
    assert "error" not in active


def test_first_monitor_pass_pauses_pending_queue_without_active_job(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    state = {
        "version": 3, "activeJobId": "", "queuePaused": False, "queuePauseReason": "",
        "jobs": [{"id": "later", "status": "queued", "stages": "h3"}],
    }
    monkeypatch.setattr(training_runner, "_launch_job", lambda *_args, **_kwargs: pytest.fail("must not launch on restart"))

    training_runner._refresh_state(state)

    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Queue waiting for manual start after WebCap restarted."
    assert state["jobs"][0]["status"] == "queued"


def test_result_evidence_still_applies_terminal_status(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    state = {
        "version": 3, "activeJobId": "active", "queuePaused": False, "queuePauseReason": "",
        "jobs": [{"id": "active", "status": "running", "stages": "h3", "pid": 4242}],
    }
    job_dir = training_runner._job_dir(state["jobs"][0])
    job_dir.mkdir(parents=True)
    (job_dir / "result.json").write_text(json.dumps({"status": "completed", "exitCode": 0}), encoding="utf-8")

    training_runner._refresh_state(state)

    assert state["jobs"][0]["status"] == "completed"
    assert state["activeJobId"] == ""


def test_invalid_queue_state_is_loud_and_not_offered_recovery(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    path = training_runner._state_path()
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")
    before = path.read_bytes()

    payload, status = training_runner.status_response()

    assert status == 409
    assert payload["stateError"] is True
    assert "recoveryAvailable" not in payload
    assert path.read_bytes() == before


def test_finish_after_epoch_does_not_require_a_configured_savepoint(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda state: None)
    training_runner._write_state({
        "version": 3,
        "activeJobId": "active",
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [{
            "id": "active",
            "status": "running",
            "stages": "h3",
            "progress": {"stage": "h3", "epoch": 2, "epochs": 10},
        }],
    })

    payload, status = training_runner.finish_schedule_response("active", epoch=3)

    assert status == 200
    assert payload["ok"] is True
    assert training_runner._read_state()["jobs"][0]["finishAfterEpoch"] == 3


def test_missing_history_is_empty_and_invalid_history_is_loud(tmp_path, monkeypatch):
    _configure_root(monkeypatch, tmp_path)
    folder = _set(tmp_path)
    assert training_history.read_history(folder)["jobs"] == []
    recent = tmp_path / ".webcap_training" / "recent_runs.json"
    recent.parent.mkdir()
    recent.write_text("{bad", encoding="utf-8")
    with pytest.raises(ValueError):
        training_history.read_history(folder)


def test_training_modules_do_not_apply_permissions_repairs():
    root = Path(__file__).parents[1] / "tool" / "server"
    for name in ("training_runner.py", "training_bundle.py", "training_action.py", "run_ops.py", "dataset_config.py"):
        assert "normalize_path_permissions" not in (root / name).read_text(encoding="utf-8")
