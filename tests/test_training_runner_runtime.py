import json
import time
from pathlib import Path

import pytest

from tool.server import training_runner
from tool.server import training_history
from tool.server import training_preflight
from tool.server import config as config_module
from tool.server.training_runtime import training_runtime_settings


@pytest.fixture(autouse=True)
def mark_startup_reconciled_for_runtime_tests(monkeypatch):
    monkeypatch.setattr(training_runner, "_startup_reconciled", True)


def test_invalid_existing_queue_state_is_preserved(tmp_path, monkeypatch):
    root = tmp_path / "training"
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())

    with pytest.raises(training_runner.TrainingStateError, match="left unchanged"):
        training_runner._read_state()

    assert state_path.read_text(encoding="utf-8") == "{not json"


def test_recover_state_archives_invalid_queue_and_starts_empty(tmp_path, monkeypatch):
    root = tmp_path / "training"
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())

    payload, status = training_runner.recover_state_response()

    assert status == 200
    assert payload["ok"] is True
    assert json.loads(state_path.read_text(encoding="utf-8")) == training_runner._default_state()
    archived_paths = list(state_path.parent.glob("queue.recovery.*.json"))
    assert len(archived_paths) == 1
    assert archived_paths[0].read_text(encoding="utf-8") == "{not json"


def test_folder_statuses_ignore_an_unreadable_queue(tmp_path, monkeypatch):
    root = tmp_path / "training"
    child = root / "set"
    child.mkdir(parents=True)
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())

    assert training_runner.folder_statuses_for_folders([child]) == {}


def test_invalid_jobs_cannot_be_silently_replaced_with_an_empty_queue(tmp_path, monkeypatch):
    root = tmp_path / "training"
    state_path = root / ".webcap_training" / "queue.json"
    state_path.parent.mkdir(parents=True)
    state_path.write_text('{"version": 3, "activeJobId": "live", "jobs": {}}', encoding="utf-8")
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())

    with pytest.raises(training_runner.TrainingStateError, match="jobs are invalid"):
        training_runner._read_state()

    assert '"activeJobId": "live"' in state_path.read_text(encoding="utf-8")


def test_deleted_queue_state_becomes_an_empty_disposable_queue(tmp_path, monkeypatch):
    root = tmp_path / "training"
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())
    training_runner._write_state({
        "version": 3, "activeJobId": "live", "jobs": [{"id": "live", "status": "running"}],
        "queuePaused": False, "queuePauseReason": "",
    })
    (root / ".webcap_training" / "queue.json").unlink()

    assert training_runner._read_state() == training_runner._default_state()
    assert training_runner._state_file_seen is None
    assert training_runner._persisted_managed_job_ids == set()


@pytest.mark.parametrize("status", ["running", "queued"])
def test_state_writer_refuses_to_drop_a_managed_job(tmp_path, monkeypatch, status):
    root = tmp_path / "training"
    state_path = root / ".webcap_training" / "queue.json"
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())
    live_state = {
        "version": 3, "activeJobId": "live" if status == "running" else "",
        "jobs": [{"id": "live", "status": status}],
        "queuePaused": False, "queuePauseReason": "",
    }
    training_runner._write_state(live_state)

    with pytest.raises(training_runner.TrainingStateError, match="Refusing to remove managed training jobs"):
        training_runner._write_state(training_runner._default_state())

    assert json.loads(state_path.read_text(encoding="utf-8"))["jobs"][0]["status"] == status


def test_state_reader_accepts_an_explicitly_shortened_queue_file(tmp_path, monkeypatch):
    root = tmp_path / "training"
    state_path = root / ".webcap_training" / "queue.json"
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())
    training_runner._write_state({
        "version": 3, "activeJobId": "live", "jobs": [{"id": "live", "status": "running"}],
        "queuePaused": False, "queuePauseReason": "",
    })
    state_path.write_text(json.dumps(training_runner._default_state()), encoding="utf-8")

    assert training_runner._read_state() == training_runner._default_state()
    assert training_runner._persisted_managed_job_ids == set()


def test_state_writer_allows_an_explicit_terminal_retirement(tmp_path, monkeypatch):
    root = tmp_path / "training"
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())
    training_runner._write_state({
        "version": 3, "activeJobId": "live", "jobs": [{"id": "live", "status": "running"}],
        "queuePaused": False, "queuePauseReason": "",
    })
    retired = training_runner._default_state()

    training_runner._write_state(retired, retired_job_ids={"live"})

    assert json.loads((root / ".webcap_training" / "queue.json").read_text(encoding="utf-8")) == retired


def test_runner_script_uses_conda_run_without_sourcing_an_activation_script(tmp_path, monkeypatch):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("hi", encoding="utf-8")
    lo_path.write_text("lo", encoding="utf-8")
    monkeypatch.setattr(
        training_runner,
        "_to_wsl_path",
        lambda path, distribution="": "/mnt/c/" + path.name,
    )
    settings = training_runtime_settings({
        "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
        "wsl_distribution": "Ubuntu_W",
        "conda_executable": "/home/user/miniconda3/bin/conda",
        "conda_environment": "dp-clean",
        "activate_script": "/home/user/project/.venv/bin/activate",
    })

    script, _ = training_runner._build_runner_script(
        {"snapshot": {}},
        settings,
        {"hiConfig": hi_path, "loConfig": lo_path},
        tmp_path / "job",
    )

    assert "source /home/user/project/.venv/bin/activate" not in script
    assert "/home/user/miniconda3/bin/conda run --no-capture-output --name dp-clean deepspeed" in script
    assert "training working directory is unavailable" in script
    assert "ACTION_FILE=" in script
    assert "finish_requested_stop" in script


def test_runner_script_can_run_only_the_lo_stage(tmp_path, monkeypatch):
    hi_path = tmp_path / "config.hi.toml"
    lo_path = tmp_path / "config.lo.toml"
    hi_path.write_text("hi", encoding="utf-8")
    lo_path.write_text("lo", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + path.name)
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, _ = training_runner._build_runner_script(
        {"snapshot": {}, "stages": "lo", "resumeFromCheckpoint": "/mnt/w/output/run-1"},
        settings,
        {"hiConfig": hi_path, "loConfig": lo_path},
        tmp_path / "job",
    )

    assert "[webcap] stage=hi" not in script
    assert "[webcap] stage=lo" in script
    assert "[webcap] resume stage=lo checkpoint=/mnt/w/output/run-1" in script
    assert "[webcap] command lo:" in script
    assert "--resume_from_checkpoint /mnt/w/output/run-1" in script


def test_runner_script_uses_the_set_config_even_when_a_job_snapshot_exists(tmp_path, monkeypatch):
    set_dir = tmp_path / "set"
    job_dir = tmp_path / "output" / ".webcap" / "jobs" / "job"
    set_dir.mkdir()
    job_dir.mkdir(parents=True)
    set_config = set_dir / "config.lo.toml"
    snapshot_config = job_dir / "config.lo.toml"
    set_config.write_text("set config", encoding="utf-8")
    snapshot_config.write_text("snapshot config", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w" + Path(path).as_posix())
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, resolved = training_runner._build_runner_script(
        {"snapshot": {"lo": str(snapshot_config)}, "stages": "lo", "resumeFromCheckpoint": "/mnt/w/output/run-1"},
        settings,
        {"hiConfig": set_dir / "config.hi.toml", "loConfig": set_config},
        job_dir,
    )

    assert "/mnt/w" + set_config.as_posix() in script
    assert "/mnt/w" + snapshot_config.as_posix() not in script
    assert "--resume_from_checkpoint /mnt/w/output/run-1" in script
    assert resolved["usedSnapshot"] is False


def test_krea2_runner_script_uses_only_the_krea2_config(tmp_path, monkeypatch):
    krea2_path = tmp_path / "config.krea2.toml"
    krea2_path.write_text("krea2", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + path.name)
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, resolved = training_runner._build_runner_script(
        {"snapshot": {}, "stages": "krea2"},
        settings,
        {"krea2Config": krea2_path},
        tmp_path / "job",
    )

    assert "[webcap] stage=krea2" in script
    assert "[webcap] command krea2:" in script
    assert "/mnt/w/config.krea2.toml" in script
    assert "[webcap] stage=hi" not in script
    assert "[webcap] stage=lo" not in script
    assert resolved["krea2"] == "/mnt/w/config.krea2.toml"


def test_wan21_runner_script_uses_only_the_wan21_config(tmp_path, monkeypatch):
    wan21_path = tmp_path / "config.wan21.toml"
    wan21_path.write_text("wan21", encoding="utf-8")
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + path.name)
    settings = training_runtime_settings({"diffusion_pipe_wsl": "/home/user/diffusion-pipe"})

    script, resolved = training_runner._build_runner_script(
        {"snapshot": {}, "stages": "wan21"}, settings, {"wan21Config": wan21_path}, tmp_path / "job"
    )

    assert "[webcap] stage=wan21" in script
    assert "[webcap] command wan21:" in script
    assert "/mnt/w/config.wan21.toml" in script
    assert "[webcap] stage=hi" not in script
    assert "[webcap] stage=lo" not in script
    assert resolved["wan21"] == "/mnt/w/config.wan21.toml"


def test_discovered_resume_path_is_the_run_directory_not_its_latest_marker(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    output_root = tmp_path / "output"
    run = output_root / "20260716_08-31-48"
    folder.mkdir()
    config = (
        f'output_dir = "{output_root.as_posix()}"\n[model]\n'
        'type = "wan"\nckpt_path = "/models/wan22"\ntransformer_path = "/models/low_noise_model"\n'
    )
    (folder / "config.lo.toml").write_text(config, encoding="utf-8")
    run.mkdir(parents=True)
    (run / "config.lo.toml").write_text(config, encoding="utf-8")
    (run / "global_step10800").mkdir()
    (run / "latest").write_text("global_step10800", encoding="utf-8")
    monkeypatch.setattr(training_history, "output_root_for_folder", lambda *args: output_root)
    monkeypatch.setattr(training_history, "output_root_path_for_folder", lambda *args: "/mnt/w/output")

    runs = training_history.discover_runs(folder, "lo")

    assert len(runs) == 1
    assert runs[0]["path"] == "/mnt/w/output/20260716_08-31-48"
    assert runs[0]["checkpointAvailable"] is True
    assert runs[0]["checkpointName"] == "latest"


def test_runner_binds_the_timestamp_directory_from_a_checkpoint_log():
    job = {"folder": "set", "stages": "lo", "status": "running"}
    log = (
        "[INFO] Saving model checkpoint: "
        "/mnt/w/training/output/runs/014-tanya/wan22-lo/20260721_22-03-39/"
        "global_step9282/mp_rank_00_model_states.pt\n"
    )

    training_runner._bind_job_run_path_from_log(job, log)

    assert job["outputRunPath"] == "/mnt/w/training/output/runs/014-tanya/wan22-lo/20260721_22-03-39"


def test_open_output_prefers_the_bound_timestamp_run_directory(tmp_path, monkeypatch):
    root = tmp_path / "output"
    run = root / "20260718_14-20-10"
    run.mkdir(parents=True)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {
        "jobs": [{"id": "job", "outputRunPath": str(run), "outputRoot": str(root)}]
    })

    assert training_runner.output_path_for_job("job") == run


def test_paused_queue_does_not_launch_the_next_job(monkeypatch):
    state = {"queuePaused": True, "activeJobId": "", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("queue must remain held")))

    training_runner._launch_next_queued_job(state)

    assert state["activeJobId"] == ""


def test_new_job_keeps_large_snapshots_under_the_output_sidecar(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    dataset = folder / "auto_dataset"
    dataset.mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml"):
        (folder / name).write_text("output_dir = '/output/source'\nmodel_path = 'models/example.safetensors'\n", encoding="utf-8")
    for name in ("dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok\n", encoding="utf-8")
    (dataset / "training_plan.json").write_text('{"mode": "poc", "stages": {}}', encoding="utf-8")
    (dataset / "prep_manifest.json").write_text('{"images": [], "videos": []}', encoding="utf-8")
    monkeypatch.setattr(config_module, "FS_ROOT", root)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)

    job = training_runner._new_job("set", {"checks": [], "summary": {"blockers": 0}}, "hi")
    sibling = training_runner._new_job("set", {"checks": [], "summary": {"blockers": 0}}, "lo")

    artifact = Path(job["artifactPath"])
    assert artifact.is_dir()
    assert ".webcap" in artifact.parts
    assert (artifact / "config.hi.toml").is_file()
    assert (artifact / "dataset.hi.toml").is_file()
    assert job["datasetTarget"] == "poc"
    assert job["launchGroupId"] == "001-set"
    assert sibling["launchGroupId"] == "001-set"
    assert Path(sibling["outputRoot"]).parent == Path(job["outputRoot"]).parent
    assert job["outputSlug"] == "wan22-hi"
    assert "output_dir = \"/mnt/w/wan22-hi\"" in (artifact / "config.hi.toml").read_text(encoding="utf-8")
    assert "output_dir = '/output/source'" in (folder / "config.hi.toml").read_text(encoding="utf-8")
    assert job["model"]["source"] == "models/example.safetensors"


def test_launch_refreshes_snapshot_from_current_config_without_mutating_source(tmp_path):
    folder = tmp_path / "set"
    bundle = tmp_path / "output" / ".webcap" / "jobs" / "job"
    folder.mkdir()
    bundle.mkdir(parents=True)
    source = folder / "config.lo.toml"
    source.write_text("output_dir = '/source'\nlearning_rate = 2e-5\n", encoding="utf-8")
    target = bundle / "config.lo.toml"
    target.write_text("output_dir = '/old'\nlearning_rate = 1e-5\n", encoding="utf-8")
    job = {
        "artifactDir": str(bundle),
        "stages": "lo",
        "effectiveOutputDir": "/mnt/w/output/run",
        "snapshot": {"lo": str(target)},
    }

    artifacts = training_runner._launch_artifacts(job, {"loConfig": source})

    assert artifacts["loConfig"] == target
    assert "output_dir = \"/mnt/w/output/run\"" in target.read_text(encoding="utf-8")
    assert "learning_rate = 2e-5" in target.read_text(encoding="utf-8")
    assert source.read_text(encoding="utf-8") == "output_dir = '/source'\nlearning_rate = 2e-5\n"


def test_model_identity_keeps_the_specific_wan_checkpoint_name(tmp_path):
    config = tmp_path / "config.hi.toml"
    config.write_text('ckpt_path = "/models/Wan2.2-T2V-A14B"\n', encoding="utf-8")

    model = training_runner._model_identity({"hiConfig": config, "loConfig": config})

    assert model == {
        "label": "Wan2.2 T2V",
        "source": "/models/Wan2.2-T2V-A14B",
    }


def test_launch_failure_records_start_before_terminal_time(tmp_path, monkeypatch):
    job = {
        "id": "job",
        "folder": "set",
        "stages": "hi",
    }
    blocker = training_preflight.make_check("config", "blocker", False, "Missing config.")
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda folder, stages: ("set", tmp_path, {}, {}, [blocker]))

    launched = training_runner._launch_job(job, tmp_path)

    assert launched is False
    assert job["status"] == "failed"
    assert job["startedAt"] <= job["finishedAt"]


def test_job_local_preflight_failure_does_not_block_the_next_queue_item(monkeypatch):
    first = {"id": "first", "folder": "missing", "stages": "lo", "status": "queued"}
    second = {"id": "second", "folder": "ready", "stages": "lo", "status": "queued"}
    state = {"activeJobId": "", "queuePaused": False, "queuePauseReason": "", "jobs": [first, second]}
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: Path(folder))

    def launch(job, folder):
        if job["id"] == "first":
            job.update(status="failed", failureScope="job", error="Missing config.")
            return False
        job.update(status="starting", stage="starting")
        return True

    monkeypatch.setattr(training_runner, "_launch_job", launch)

    training_runner._launch_next_queued_job(state)

    assert first["status"] == "failed"
    assert state["activeJobId"] == "second"
    assert state["queuePaused"] is False


def test_direct_history_resume_with_an_invalid_recorded_path_fails_loudly(monkeypatch):
    job = {
        "id": "resume", "folder": "set", "stages": "lo", "status": "queued",
        "parentJobId": "finished-early", "resumeFromCheckpoint": "/missing/run", "resumeStage": "lo",
    }
    monkeypatch.setattr(
        training_runner,
        "validate_resumable_run_for_path",
        lambda *args: (_ for _ in ()).throw(ValueError("Recorded resume directory is unavailable: /missing/run")),
    )

    assert training_runner._launch_job(job, Path("set")) is False
    assert job["status"] == "failed"
    assert job["failureScope"] == "job"
    assert job["error"] == "Resume invariant failed: Recorded resume directory is unavailable: /missing/run"


def test_runtime_failure_does_not_block_the_next_queue_item(monkeypatch):
    failed = {"id": "failed", "folder": "one", "stages": "lo", "status": "running"}
    following = {"id": "following", "folder": "two", "stages": "lo", "status": "queued"}
    state = {"activeJobId": "failed", "queuePaused": False, "queuePauseReason": "", "jobs": [failed, following]}
    monkeypatch.setattr(training_runner, "_refresh_job", lambda job: job.update(status="failed", error="Trainer failed.", finishedAt=2))
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: Path(folder))
    monkeypatch.setattr(training_runner, "_launch_job", lambda job, folder: job.update(status="starting", stage="starting"))

    training_runner._refresh_state(state)

    assert failed["status"] == "failed"
    assert state["activeJobId"] == "following"
    assert state["queuePaused"] is False


def test_distributed_server_socket_address_conflict_holds_the_queue(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_text(
        "torch.distributed.DistNetworkError: The server socket has failed to listen on any local network address. "
        "port: 29500, code: -98, name: EADDRINUSE, message: address already in use\n",
        encoding="utf-8",
    )
    active = {
        "id": "failed", "folder": "one", "stages": "hi", "status": "running", "logPath": str(log_path),
    }
    following = {"id": "following", "folder": "two", "stages": "lo", "status": "queued"}
    state = {
        "activeJobId": "failed", "queuePaused": False, "queuePauseReason": "", "jobs": [active, following],
    }
    monkeypatch.setattr(
        training_runner,
        "_read_result_evidence",
        lambda job: ("result", {"status": "failed", "exitCode": 1, "finishedAt": 2}, ""),
    )
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda job, folder: (_ for _ in ()).throw(AssertionError("queue must remain held")),
    )

    training_runner._refresh_state(state)

    assert active["status"] == "failed"
    assert active["failureScope"] == "system"
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == training_runner._DISTRIBUTED_SOCKET_HOLD_REASON
    assert following["status"] == "queued"


@pytest.mark.parametrize(
    "log_text",
    (
        "application server socket has failed to listen: address already in use",
        "torch.distributed.DistNetworkError: connection reset by peer",
        "torch.distributed.DistNetworkError: server socket has failed to listen",
        "torch.distributed.DistNetworkError: EADDRINUSE",
    ),
)
def test_other_socket_or_distributed_failures_do_not_hold_the_queue(log_text):
    assert training_runner._distributed_socket_hold_reason(log_text) == ""


def test_queue_refresh_reads_resume_progress_from_disk(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    run = root / "output" / "run"
    folder.mkdir(parents=True)
    (folder / "config.lo.toml").write_text("epochs = 90\n", encoding="utf-8")
    (run / "global_step640").mkdir(parents=True)
    (run / "epoch8").mkdir()
    (run / "latest").write_text("global_step640", encoding="utf-8")
    job = {
        "id": "resume",
        "folder": "set",
        "stages": "lo",
        "resumeStage": "lo",
        "resumeFromCheckpoint": str(run),
        "status": "queued",
        "progressPlan": {"lo": {"estimatedSteps": 1000, "epochs": 90}},
    }
    state = {"activeJobId": "", "queuePaused": True, "queuePauseReason": "Paused", "jobs": [job]}
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda value: root / value)

    training_runner._refresh_state(state)

    assert job["resumePoint"]["checkpointTag"] == "global_step640"
    assert job["resumePoint"]["epoch"] == 8
    assert job["resumePoint"]["step"] == 640


def test_restart_reconciles_a_live_run_before_handing_off_to_its_queue(monkeypatch):
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)
    state = {
        "queuePaused": False,
        "queuePauseReason": "",
        "activeJobId": "active",
        "jobs": [
            {"id": "active", "status": "interrupted", "folder": "set", "pid": 42, "runnerScript": "/run/runner.sh"},
            {"id": "next", "status": "queued", "folder": "set"},
        ],
    }
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("running", ""))
    monkeypatch.setattr(training_runner, "_remove_stale_terminal_history", lambda job: None)

    training_runner._refresh_state(state)

    assert state["queuePaused"] is False
    assert state["queuePauseReason"] == ""
    assert state["activeJobId"] == "active"
    assert state["jobs"][0]["status"] == "starting"
    assert state["jobs"][1]["status"] == "queued"
    assert training_runner._startup_reconciled is True


def test_restart_holds_a_dormant_queue_for_manual_start(monkeypatch):
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)
    state = {
        "queuePaused": False,
        "queuePauseReason": "",
        "activeJobId": "",
        "jobs": [{"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_launch_job", lambda *args: (_ for _ in ()).throw(AssertionError("startup must not launch queued work")))

    training_runner._refresh_state(state)

    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Queue waiting for manual start after WebCap restarted."
    assert state["activeJobId"] == ""
    assert state["jobs"][0]["status"] == "queued"


def test_restart_returns_an_absent_active_run_to_the_front(monkeypatch):
    monkeypatch.setattr(training_runner, "_startup_reconciled", False)
    active = {
        "id": "active", "status": "running", "stage": "hi", "stages": "hi",
        "pid": 42, "runnerScript": "/run/runner.sh",
    }
    state = {
        "queuePaused": False,
        "queuePauseReason": "",
        "activeJobId": "active",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("absent", ""))
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda *args: (_ for _ in ()).throw(AssertionError("restart recovery must wait for manual start")),
    )

    training_runner._refresh_state(state)

    assert [job["status"] for job in state["jobs"]] == ["queued", "queued"]
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Previous runner ended without a result. Resume or restart the first item."
    assert "resumeFromCheckpoint" not in active


def test_missing_queued_folder_remains_visible_and_keeps_its_artifacts(tmp_path, monkeypatch):
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    artifact_path = tmp_path / "output" / "run" / ".webcap" / "jobs" / "missing"
    artifact_path.mkdir(parents=True)
    (artifact_path / "runner.sh").write_text("runner", encoding="utf-8")
    state = {
        "queuePaused": False,
        "activeJobId": "",
        "jobs": [{
            "id": "missing", "folder": "moved-set", "status": "queued", "stage": "queued",
            "artifactPath": str(artifact_path),
        }],
    }

    payload = training_runner._public_job(state["jobs"][0])

    job = state["jobs"][0]
    assert job["status"] == "queued"
    assert "error" not in job
    assert payload["sourceUnavailable"] == "Set folder is currently unavailable; this job remains queued."
    assert artifact_path.is_dir()
    assert (artifact_path / "runner.sh").is_file()


def test_history_write_error_is_reported_without_changing_the_job(tmp_path, monkeypatch):
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(training_runner, "record_job", lambda *args: (_ for _ in ()).throw(FileNotFoundError("folder moved")))

    error = training_runner._sync_job_history({
        "id": "missing", "folder": "moved-set", "status": "failed", "updatedAt": 1,
    })

    assert error == "Could not add training outcome to Recent Runs: folder moved"


def test_terminal_job_retires_after_recent_runs_is_updated(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    terminal = {"id": "done", "folder": "set", "status": "completed", "stage": "lo", "updatedAt": 2}
    queued = {"id": "next", "folder": "set", "status": "queued"}
    state = {"activeJobId": "", "queuePaused": True, "jobs": [terminal, queued]}
    recorded = []
    written = []
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda value: tmp_path / value)
    monkeypatch.setattr(training_runner, "record_job", lambda folder_path, job: recorded.append((folder_path, job["id"])))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate, **kwargs: written.append(list(candidate["jobs"])))

    training_runner._persist_reconciled_state(state)

    assert recorded == [(folder, "done")]
    assert state["jobs"] == [queued]
    assert written == [[queued]]


def test_recent_runs_failure_does_not_block_terminal_retirement(tmp_path, monkeypatch, caplog):
    terminal = {"id": "failed", "folder": "missing", "status": "failed", "stage": "launch", "updatedAt": 2}
    state = {"activeJobId": "", "queuePaused": True, "jobs": [terminal]}
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda value: tmp_path / value)
    monkeypatch.setattr(training_runner, "record_job", lambda *args: (_ for _ in ()).throw(OSError("disk unavailable")))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate, **kwargs: None)

    training_runner._persist_reconciled_state(state)

    assert state["jobs"] == []
    assert "Could not add training outcome to Recent Runs: disk unavailable" in caplog.text


def test_cancelled_job_retires_without_creating_history(monkeypatch):
    cancelled = {"id": "cancelled", "folder": "set", "status": "cancelled", "historyHidden": True}
    state = {"activeJobId": "", "queuePaused": True, "jobs": [cancelled]}
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate, **kwargs: None)

    training_runner._persist_reconciled_state(state)

    assert state["jobs"] == []


def test_relocate_folder_jobs_updates_matching_queue_paths(tmp_path, monkeypatch):
    root = tmp_path / "training"
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_state_file_seen", None)
    monkeypatch.setattr(training_runner, "_persisted_managed_job_ids", set())
    training_runner._write_state({
        "version": 3,
        "activeJobId": "",
        "queuePaused": True,
        "queuePauseReason": "Queue held after WebCap restarted.",
        "jobs": [
            {"id": "parent", "folder": "old-set", "status": "queued"},
            {"id": "child", "folder": "old-set/child", "status": "queued"},
            {"id": "other", "folder": "other-set", "status": "queued"},
        ],
    })

    assert training_runner.relocate_folder_jobs("old-set", "new-set") == 2

    folders = [job["folder"] for job in training_runner._read_state()["jobs"]]
    assert folders == ["new-set", "new-set/child", "other-set"]


def test_finish_action_records_a_finished_early_outcome(monkeypatch):
    job = {
        "id": "finished-early",
        "status": "running",
        "actionRequested": "finish",
        "progress": {"epoch": 85, "epochs": 90, "step": 9410},
    }
    monkeypatch.setattr(
        training_runner,
        "_read_result_evidence",
        lambda candidate: ("result", {"status": "stopped", "exitCode": 130, "finishedAt": 123.0}, ""),
    )

    training_runner._refresh_job(job)

    assert job["status"] == "finished_early"
    assert job["completionNote"] == "Finished early at epoch 85 / 90 · step 9,410"


def test_runner_result_overrides_a_finish_request_when_the_job_completed(monkeypatch):
    job = {"id": "completed", "status": "stopping", "actionRequested": "finish"}
    monkeypatch.setattr(
        training_runner,
        "_read_result_evidence",
        lambda candidate: ("result", {"status": "completed", "exitCode": 0, "finishedAt": 123.0}, ""),
    )

    training_runner._refresh_job(job)

    assert job["status"] == "completed"


def test_finish_request_waits_for_the_runner_result(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42, "runnerVerified": True, "progress": {"epoch": 85, "epochs": 90}}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue held after WebCap restarted.",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_job_action_path", lambda job: tmp_path / "action")

    payload, status = training_runner.stop_response("active", finish=True)

    assert status == 200
    assert payload["job"]["status"] == "stopping"
    assert payload["job"]["actionRequested"] == "finish"
    assert "Waiting for the runner result" in payload["job"]["confirmationNote"]
    assert state["activeJobId"] == "active"
    assert state["queuePaused"] is True


def test_finish_can_be_scheduled_for_a_future_configured_save(tmp_path, monkeypatch):
    config_path = tmp_path / "config.krea2.toml"
    config_path.write_text("epochs = 60\nsave_every_n_epochs = 5\n", encoding="utf-8")
    active = {
        "id": "active",
        "status": "running",
        "stage": "krea2",
        "snapshot": {"krea2": str(config_path)},
        "progress": {"stage": "krea2", "epoch": 25, "epochs": 60},
    }
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.finish_schedule_response("active", epoch=35)

    assert status == 200
    assert payload["job"]["finishAfterEpoch"] == 35
    assert active["finishAfterEpoch"] == 35
    assert "actionRequested" not in active


def test_finish_schedule_rejects_an_epoch_that_is_not_a_save_point(tmp_path, monkeypatch):
    config_path = tmp_path / "config.krea2.toml"
    config_path.write_text("epochs = 60\nsave_every_n_epochs = 5\n", encoding="utf-8")
    active = {
        "id": "active",
        "status": "running",
        "stage": "krea2",
        "snapshot": {"krea2": str(config_path)},
        "progress": {"stage": "krea2", "epoch": 25, "epochs": 60},
    }
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)

    payload, status = training_runner.finish_schedule_response("active", epoch=37)

    assert status == 400
    assert "not a configured save point" in payload["error"]
    assert "finishAfterEpoch" not in active


def test_scheduled_finish_waits_for_the_epoch_after_the_target_save(tmp_path, monkeypatch):
    config_path = tmp_path / "config.krea2.toml"
    config_path.write_text("epochs = 60\nsave_every_n_epochs = 1\n", encoding="utf-8")
    log_path = tmp_path / "run.log"
    action_path = tmp_path / "action"
    job = {
        "id": "active",
        "status": "running",
        "stage": "krea2",
        "stages": "krea2",
        "pid": 42,
        "logPath": str(log_path),
        "snapshot": {"krea2": str(config_path)},
        "finishAfterEpoch": 35,
    }
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda candidate: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda candidate: ("running", ""))
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    monkeypatch.setattr(training_runner, "_job_action_path", lambda candidate: action_path)

    log_path.write_text("Saving model to directory epoch35\nStarted new epoch: 35\n", encoding="utf-8")
    training_runner._refresh_job(job)

    assert job["status"] == "running"
    assert job["finishAfterEpoch"] == 35
    assert not action_path.exists()

    log_path.write_text("Saving model to directory epoch35\nStarted new epoch: 36\n", encoding="utf-8")
    training_runner._refresh_job(job)

    assert job["status"] == "stopping"
    assert job["actionRequested"] == "finish"
    assert job["finishTriggeredEpoch"] == 35
    assert "finishAfterEpoch" not in job
    assert action_path.read_text(encoding="utf-8") == "finish"
    assert "Epoch 35 saved" in job["confirmationNote"]


def test_pause_interrupts_the_running_job_and_holds_the_queue(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42, "runnerVerified": True}
    state = {
        "activeJobId": "active",
        "queuePaused": False,
        "queuePauseReason": "",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (0, "", ""))
    action_path = tmp_path / "action"
    monkeypatch.setattr(training_runner, "_job_action_path", lambda candidate: action_path)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.stop_response("active", pause=True)

    assert status == 200
    assert payload["job"]["status"] == "stopping"
    assert payload["job"]["actionRequested"] == "pause"
    assert action_path.read_text(encoding="utf-8") == "pause"
    assert state["activeJobId"] == "active"
    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Queue paused by the user."


def test_stop_request_failure_does_not_change_the_recorded_job_state(tmp_path, monkeypatch):
    active = {"id": "active", "status": "running", "pid": 42, "runnerVerified": True}
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (1, "", "no such process"))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    action_path = tmp_path / "action"
    monkeypatch.setattr(training_runner, "_job_action_path", lambda job: action_path)

    payload, status = training_runner.stop_response("active")

    assert status == 502
    assert active["status"] == "running"
    assert "actionRequested" not in active
    assert payload["error"] == "no such process"
    assert not action_path.exists()


def test_pause_result_becomes_an_ordinary_queued_resume(monkeypatch):
    job = {
        "id": "paused", "status": "stopping", "actionRequested": "pause",
        "folder": "set", "stages": "krea2", "outputRunPath": "/output/run",
    }
    monkeypatch.setattr(
        training_runner,
        "_read_result_evidence",
        lambda candidate: ("result", {"status": "failed", "exitCode": 1, "finishedAt": 123.0}, ""),
    )

    training_runner._refresh_job(job)

    assert job["status"] == "queued"
    assert job["resumeFromCheckpoint"] == "/output/run"
    assert job["resumeStage"] == "krea2"
    assert "error" not in job


def test_pause_result_holds_the_global_queue(monkeypatch):
    active = {
        "id": "paused", "status": "stopping", "actionRequested": "pause",
        "folder": "set", "stages": "krea2", "outputRunPath": "/output/run",
    }
    state = {"activeJobId": "paused", "queuePaused": False, "queuePauseReason": "", "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda candidate: ("result", {"status": "stopped", "exitCode": 130, "finishedAt": 123.0}, ""))
    monkeypatch.setattr(training_runner, "_launch_next_queued_job", lambda candidate: None)

    training_runner._refresh_state(state)

    assert active["status"] == "queued"
    assert active["resumeFromCheckpoint"] == "/output/run"
    assert active["resumeStage"] == "krea2"
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Queue paused by the user."


def test_pause_without_a_runner_pid_fails_without_holding_the_queue(monkeypatch):
    active = {"id": "active", "status": "running"}
    state = {"activeJobId": "active", "queuePaused": False, "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not signal without a PID")))
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.stop_response("active", pause=True)

    assert status == 409
    assert active["status"] == "running"
    assert state["queuePaused"] is False
    assert "no recorded runner PID" in payload["error"]


def test_log_response_restarts_from_zero_when_the_log_was_truncated(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_text("new\n", encoding="utf-8")
    job = {"id": "active", "status": "running", "logPath": str(log_path)}
    state = {"activeJobId": "active", "jobs": [job]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.log_response("active", offset=999)

    assert status == 200
    assert payload["offset"] == log_path.stat().st_size
    assert payload["nextOffset"] == log_path.stat().st_size
    assert payload["text"] == ""


def test_log_response_tail_returns_only_the_latest_chunk(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_bytes(b"a" * 70000)
    job = {"id": "active", "status": "running", "logPath": str(log_path)}
    state = {"activeJobId": "active", "jobs": [job]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.log_response("active", tail=True)

    assert status == 200
    assert payload["offset"] == 70000 - 65536
    assert payload["nextOffset"] == 70000
    assert len(payload["text"]) == 65536
    assert payload["truncated"] is True


def test_log_response_reads_a_retired_job_from_history(tmp_path, monkeypatch):
    artifact_dir = tmp_path / "job"
    artifact_dir.mkdir()
    (artifact_dir / "run.log").write_text("retired output\n", encoding="utf-8")
    history_job = {"id": "retired", "folder": "set", "status": "completed", "artifactDir": str(artifact_dir)}
    state = {"activeJobId": "", "queuePaused": True, "jobs": []}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_persist_reconciled_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_find_history_job", lambda folder, job_id: history_job)

    payload, status = training_runner.log_response("retired", folder="set")

    assert status == 200
    assert payload["text"].splitlines() == ["retired output"]
    assert payload["job"]["status"] == "completed"


def test_cancelling_a_queued_job_removes_it_from_the_queue(monkeypatch):
    active = {"id": "active", "folder": "set", "status": "queued"}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue paused by the user.",
        "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}],
    }
    advanced = []
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    cleared = []
    monkeypatch.setattr(training_runner, "clear_history_job", lambda folder, job_id: cleared.append((folder, job_id)) or True)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_launch_next_queued_job", lambda candidate: advanced.append(candidate["queuePaused"]))

    payload, status = training_runner.stop_response("active", cancel=True)

    assert status == 200
    assert payload["job"]["status"] == "cancelled"
    assert active["historyHidden"] is True
    assert cleared == [("set", "active")]
    assert state["queuePaused"] is True
    assert advanced == []


def test_cancelling_a_running_job_is_rejected_without_signalling_it(monkeypatch):
    active = {"id": "active", "folder": "set", "status": "running", "pid": 42}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("must not signal a cancel request")))

    payload, status = training_runner.stop_response("active", cancel=True)

    assert status == 400
    assert active["status"] == "running"
    assert "Only queued" in payload["error"]


def test_resuming_the_queue_while_a_job_runs_only_enables_handoff(monkeypatch):
    active = {"id": "active", "folder": "penny", "stages": "lo", "status": "running"}
    queued = {"id": "next", "folder": "sue", "stages": "hi", "status": "queued"}
    state = {
        "activeJobId": "active",
        "queuePaused": True,
        "queuePauseReason": "Queue paused by the user.",
        "jobs": [active, queued],
    }
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.resume_queue_response()

    assert status == 200
    assert payload["activeJobId"] == "active"
    assert active["status"] == "running"
    assert queued["status"] == "queued"
    assert state["queuePaused"] is False


def test_resume_queue_reports_a_hold_instead_of_a_false_success(monkeypatch):
    state = {"activeJobId": "", "queuePaused": True, "queuePauseReason": "Queue paused by the user.", "jobs": [{"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda candidate: candidate.update(queuePaused=True, queuePauseReason="Queued inputs changed. Confirm current inputs or cancel this item."))
    monkeypatch.setattr(training_runner, "_sync_histories", lambda candidate: None)
    monkeypatch.setattr(training_runner, "_write_state", lambda candidate: None)

    payload, status = training_runner.resume_queue_response()

    assert status == 409
    assert payload["error"] == "Queued inputs changed. Confirm current inputs or cancel this item."


def test_interrupted_job_is_derived_running_from_its_exact_live_runner(tmp_path, monkeypatch):
    artifact_path = tmp_path / ".webcap" / "jobs" / "46b8ba3d7612"
    artifact_path.mkdir(parents=True)
    log_path = artifact_path / "run.log"
    log_path.write_text("[webcap] stage=lo\nstep=580\n", encoding="utf-8")
    active = {
        "id": "46b8ba3d7612",
        "folder": "two-fingers/wan22",
        "status": "interrupted",
        "stages": "lo",
        "pid": 181579,
        "runnerScript": "/mnt/w/training/output/runs/018-wan22/.webcap/jobs/46b8ba3d7612/runner.sh",
        "artifactPath": str(artifact_path),
        "logPath": str(log_path),
        "finishedAt": 10,
        "error": "Training runner is no longer available and did not write a result record.",
    }
    following = {"id": "next", "folder": "set", "status": "queued"}
    state = {"activeJobId": "", "queuePaused": False, "queuePauseReason": "", "jobs": [active, following]}
    cleared = []
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("running", ""))
    monkeypatch.setattr(training_runner, "_remove_stale_terminal_history", lambda job: cleared.append(job["id"]))
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda *args: (_ for _ in ()).throw(AssertionError("live runner must block the queue")),
    )

    training_runner._refresh_state(state)

    assert active["status"] == "running"
    assert active["runnerVerified"] is True
    assert "finishedAt" not in active
    assert "error" not in active
    assert state["activeJobId"] == active["id"]
    assert following["status"] == "queued"
    assert cleared == [active["id"]]


def test_runner_process_inspection_requires_the_exact_runner_script(monkeypatch):
    job = {"pid": 42, "runnerScriptWsl": "/runs/job/runner.sh", "runtime": {"wslDistribution": "Ubuntu_W"}}
    monkeypatch.setattr(
        training_runner,
        "_run_wsl",
        lambda *args, **kwargs: (0, "/usr/bin/bash\n/runs/other/runner.sh\n", ""),
    )

    assert training_runner._inspect_job_runner(job) == (
        "absent",
        "Recorded runner PID is now used by a different process.",
    )


def test_runner_process_inspection_accepts_the_exact_runner_script(monkeypatch):
    job = {"pid": 42, "runnerScriptWsl": "/runs/job/runner.sh", "runtime": {"wslDistribution": "Ubuntu_W"}}
    monkeypatch.setattr(
        training_runner,
        "_run_wsl",
        lambda *args, **kwargs: (0, "/usr/bin/bash\n/runs/job/runner.sh\n", ""),
    )

    assert training_runner._inspect_job_runner(job) == ("running", "")


def test_runner_process_inspection_failure_is_unknown(monkeypatch):
    job = {"pid": 42, "runnerScriptWsl": "/runs/job/runner.sh", "runtime": {"wslDistribution": "Ubuntu_W"}}
    monkeypatch.setattr(training_runner, "_run_wsl", lambda *args, **kwargs: (124, "", "Timed out"))

    state, detail = training_runner._inspect_job_runner(job)

    assert state == "unknown"
    assert "Timed out" in detail


def test_malformed_result_keeps_the_job_recoverable_when_the_runner_is_absent(tmp_path, monkeypatch):
    artifact_path = tmp_path / ".webcap" / "jobs" / "active"
    artifact_path.mkdir(parents=True)
    (artifact_path / "result.json").write_text("{bad json", encoding="utf-8")
    active = {
        "id": "active", "folder": "set", "status": "running", "pid": 42,
        "runnerScript": "/runs/active/runner.sh", "artifactPath": str(artifact_path),
    }
    following = {"id": "next", "folder": "set", "status": "queued"}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, following]}
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("absent", ""))
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda *args: (_ for _ in ()).throw(AssertionError("uncertain terminal evidence must wait for user action")),
    )

    training_runner._refresh_state(state)

    assert active["status"] == "queued"
    assert "could not be read" in active["error"]
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert following["status"] == "queued"


def test_unknown_runner_returns_the_job_to_the_front_and_holds_for_manual_recovery(monkeypatch):
    active = {
        "id": "active", "folder": "set", "status": "running", "pid": 42,
        "runnerScript": "/runs/active/runner.sh", "outputRunPath": "/output/run",
    }
    following = {"id": "next", "folder": "set", "status": "queued"}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, following]}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("unknown", "Runner inspection timed out."))

    training_runner._refresh_state(state)

    assert [job["id"] for job in state["jobs"]] == ["active", "next"]
    assert active["status"] == "queued"
    assert active["resumeFromCheckpoint"] == "/output/run"
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert state["queuePauseReason"] == "Previous runner could not be confirmed. Resume or cancel the first item."


def test_missing_runner_evidence_uses_the_same_recoverable_front_item(monkeypatch):
    active = {"id": "active", "folder": "set", "status": "running", "stages": "lo"}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))

    training_runner._refresh_state(state)

    assert active["status"] == "queued"
    assert state["activeJobId"] == ""
    assert state["queuePaused"] is True
    assert "PID and script evidence are unavailable" in active["error"]


def test_multiple_derived_live_runners_are_visible_and_block_launch(monkeypatch):
    jobs = [
        {"id": "one", "status": "interrupted", "pid": 41, "runnerScript": "/runs/one/runner.sh"},
        {"id": "two", "status": "interrupted", "pid": 42, "runnerScript": "/runs/two/runner.sh"},
        {"id": "next", "status": "queued", "folder": "set"},
    ]
    state = {"activeJobId": "", "queuePaused": False, "queuePauseReason": "", "jobs": jobs}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("running", ""))
    monkeypatch.setattr(training_runner, "_remove_stale_terminal_history", lambda job: None)
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda *args: (_ for _ in ()).throw(AssertionError("multiple live runners must block the queue")),
    )

    training_runner._refresh_state(state)

    assert [job["status"] for job in jobs] == ["starting", "starting", "queued"]
    assert state["activeJobId"] == "one"
    assert state["runnerNotice"].startswith("2 managed runners")


def test_missing_runner_result_keeps_the_job_first_and_holds_the_queue(monkeypatch):
    active = {"id": "active", "status": "running", "stage": "hi", "stages": "hi", "pid": 42}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, {"id": "next", "status": "queued", "folder": "set"}]}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("absent", ""))
    monkeypatch.setattr(
        training_runner,
        "_launch_job",
        lambda *args: (_ for _ in ()).throw(AssertionError("missing runner recovery must wait for user action")),
    )

    training_runner._refresh_state(state)

    assert [job["status"] for job in state["jobs"]] == ["queued", "queued"]
    assert "no longer active" in active["error"]
    assert state["queuePaused"] is True
    assert state["activeJobId"] == ""
    assert state["queuePauseReason"] == "Previous runner ended without a result. Resume or restart the first item."


def test_log_activity_does_not_prevent_missing_runner_recovery(tmp_path, monkeypatch):
    log_path = tmp_path / "run.log"
    log_path.write_text("step=580\n", encoding="utf-8")
    active = {
        "id": "active", "status": "running", "stage": "hi", "stages": "hi", "pid": 42,
        "logPath": str(log_path), "lastLogAt": 1,
    }
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active]}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda job: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda job: ("absent", ""))

    training_runner._refresh_state(state)

    assert active["status"] == "queued"
    assert state["queuePaused"] is True
    assert state["activeJobId"] == ""
    assert "confirmationNote" not in active


@pytest.mark.parametrize(
    ("action", "expected_status"),
    (("finish", "finished_early"), ("stop", "stopped")),
)
def test_missing_runner_result_honors_a_recorded_user_action(action, expected_status, monkeypatch):
    job = {
        "id": "active", "status": "stopping", "stages": "lo", "pid": 42,
        "actionRequested": action, "outputRunPath": "/output/run",
    }
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda candidate: ("absent", None, ""))
    monkeypatch.setattr(training_runner, "_inspect_job_runner", lambda candidate: ("absent", ""))

    training_runner._refresh_job(job)

    assert job["status"] == expected_status
    assert "finishedAt" in job


def test_runner_stopped_without_an_app_action_is_interrupted(monkeypatch):
    job = {"id": "external-stop", "status": "running"}
    monkeypatch.setattr(training_runner, "_read_result_evidence", lambda candidate: ("result", {"status": "stopped", "exitCode": 130, "finishedAt": 123.0}, ""))

    training_runner._refresh_job(job)

    assert job["status"] == "interrupted"
    assert job["error"] == "Runner stopped without a WebCap stop action."


def test_stop_outcome_advances_to_the_next_queued_job(monkeypatch):
    active = {"id": "active", "status": "stopped", "stage": "stopped", "stages": "hi"}
    next_job = {"id": "next", "status": "queued", "folder": "set"}
    state = {"activeJobId": "active", "queuePaused": False, "queuePauseReason": "", "jobs": [active, next_job]}

    def launch(job, folder):
        job["status"] = "running"

    monkeypatch.setattr(training_runner, "_launch_job", launch)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    training_runner._refresh_state(state)

    assert state["activeJobId"] == "next"
    assert next_job["status"] == "running"


def test_starting_both_creates_adjacent_hi_and_lo_jobs(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("output_dir = '/source'\n", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text("{}", encoding="utf-8")
    artifacts = {
        "hiConfig": folder / "config.hi.toml", "loConfig": folder / "config.lo.toml",
        "hiDataset": folder / "dataset.hi.toml", "loDataset": folder / "dataset.lo.toml",
        "manifest": folder / "auto_dataset" / "prep_manifest.json",
    }
    state = training_runner._default_state()
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda value, stages="both": ("set", folder, artifacts, {}, []))
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_write_state", lambda value, **kwargs: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda value: None)
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "_to_wsl_path", lambda path, distribution="": "/mnt/w/" + Path(path).name)
    monkeypatch.setattr(training_runner, "_launch_job", lambda job, path: job.update(status="running", stage=job["stages"]))

    payload, status = training_runner.start_response("set", stages="both")

    assert status == 200
    assert [job["stages"] for job in payload["jobs"]] == ["hi", "lo"]
    assert payload["jobs"][0]["launchGroupId"] == payload["jobs"][1]["launchGroupId"]
    assert [job["outputSlug"] for job in payload["jobs"]] == ["wan22-hi", "wan22-lo"]
    assert [job["runId"] for job in payload["jobs"]] == ["hi", "lo"]
    assert [job["actionRunId"] for job in payload["jobs"]] == ["both", "both"]
    assert state["jobs"][0]["status"] == "running"
    assert state["jobs"][1]["status"] == "queued"


def test_starting_with_an_empty_queue_clears_a_stale_hold_and_launches(monkeypatch):
    state = {
        "activeJobId": "",
        "queuePaused": True,
        "queuePauseReason": "Queue held after LO failed.",
        "jobs": [{"id": "old", "status": "failed", "folder": "old-set"}],
    }
    job = {"id": "new", "folder": "set", "stages": "lo", "status": "queued"}
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_write_state", lambda value, **kwargs: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda value: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda value: None)
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda value, stages="both": ("set", "folder", {}, {}, []))
    monkeypatch.setattr(training_runner, "_new_job", lambda *args: job)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: folder)
    monkeypatch.setattr(training_runner, "_resolve_folder", lambda folder: ("set", "folder"))
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "training_output_group_for_folder", lambda folder, create=False: Path("launch"))
    monkeypatch.setattr(training_runner, "_launch_job", lambda candidate, folder: candidate.update(status="starting"))

    payload, status = training_runner.start_response("set", queue=True, stages="lo")

    assert status == 200
    assert payload["queued"] is False
    assert state["activeJobId"] == "new"
    assert state["queuePaused"] is False
    assert state["queuePauseReason"] == ""


def test_historical_resume_without_a_checkpoint_is_rejected_before_a_new_job_is_created(monkeypatch):
    monkeypatch.setattr(training_runner, "_new_job", lambda *args: (_ for _ in ()).throw(AssertionError("must not create a fresh job")))

    payload, status = training_runner.start_response("set", stages="lo", parent_job_id="failed-job")

    assert status == 400
    assert payload["error"] == "Historical resume requires a checkpoint path; refusing to start a new run."


def test_starting_krea2_creates_one_krea2_job(tmp_path, monkeypatch):
    state = training_runner._default_state()
    job = {"id": "krea2", "folder": "set", "stages": "krea2", "status": "queued"}
    calls = []
    monkeypatch.setattr(training_runner, "_ensure_monitor_started", lambda: None)
    monkeypatch.setattr(training_runner, "_read_state", lambda: state)
    monkeypatch.setattr(training_runner, "_write_state", lambda value: None)
    monkeypatch.setattr(training_runner, "_sync_histories", lambda value: None)
    monkeypatch.setattr(training_runner, "_refresh_state", lambda value: None)
    monkeypatch.setattr(training_runner.app_config, "safe_join_fs_root", lambda folder: tmp_path)
    monkeypatch.setattr(training_runner, "_training_settings", lambda: {"wslDistribution": ""})
    monkeypatch.setattr(training_runner, "_build_launch_preflight", lambda folder, stages: ("set", tmp_path, {}, {}, []))
    monkeypatch.setattr(training_runner, "training_output_group_for_folder", lambda folder, create=False: tmp_path / "001-set")
    monkeypatch.setattr(
        training_runner,
        "_new_job",
        lambda folder, preflight, stages, *args: calls.append(stages) or job,
    )
    monkeypatch.setattr(training_runner, "_launch_job", lambda candidate, folder: candidate.update(status="starting"))

    payload, status = training_runner.start_response("set", queue=True, stages="krea2")

    assert status == 200
    assert calls == ["krea2"]
    assert [item["stages"] for item in payload["jobs"]] == ["krea2"]
    assert state["activeJobId"] == "krea2"


def test_folder_status_prefers_queue_state_over_output_artifacts(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    queued = {"id": "queued", "folder": "set", "status": "queued", "stages": "lo"}
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": [queued]})
    monkeypatch.setattr(training_runner, "discover_runs", lambda path: [{"path": "run"}])

    status = training_runner.folder_statuses_for_folders([folder])[folder]

    assert status == {"status": "queued", "label": "Queued #1", "queuePosition": 1}


def test_folder_status_does_not_surface_failed_history_as_attention(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {
        "jobs": [{"id": "failed", "folder": "set", "status": "failed", "stages": "lo"}]
    })
    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: ([], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {"status": "never", "label": ""}


def test_folder_status_distinguishes_partial_and_complete_training(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    folder.mkdir(parents=True)
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: (["hi", "lo"], {"hi"}))

    partial = training_runner.folder_statuses_for_folders([folder])[folder]

    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: (["hi", "lo"], {"hi", "lo"}))
    complete = training_runner.folder_statuses_for_folders([folder])[folder]

    assert partial == {"status": "partial", "label": "Partially trained"}
    assert complete == {"status": "trained", "label": "Trained"}


def test_folder_status_requires_prepared_captions_before_ready(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {"status": "never", "label": ""}

    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {"status": "ready", "label": "Ready to train"}


def test_folder_status_requires_caption_review_for_partial_annotations(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")
    for index in range(20):
        media_name = "item_" + str(index) + ".png"
        (folder / media_name).write_bytes(b"")
        if index >= 3:
            (folder / ("item_" + str(index) + ".txt")).write_text("caption", encoding="utf-8")
    (folder / ".webcap_state.json").write_text(
        '{"caption_tags_by_media": {"item_0.png": ["tag"], "item_1.png": ["tag"], "item_2.png": ["tag"]}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {
        "status": "caption-review",
        "label": "Caption review needed (3 of 20)",
    }


def test_folder_status_keeps_ready_for_low_rate_of_partial_annotations(tmp_path, monkeypatch):
    root = tmp_path / "training"
    folder = root / "set"
    (folder / "auto_dataset" / "square_img").mkdir(parents=True)
    for name in ("config.hi.toml", "config.lo.toml", "dataset.hi.toml", "dataset.lo.toml"):
        (folder / name).write_text("ok", encoding="utf-8")
    (folder / "auto_dataset" / "prep_manifest.json").write_text(
        '{"images": [{"prepared_path": "square_img/one.png", "caption": true}], "videos": []}', encoding="utf-8"
    )
    (folder / "auto_dataset" / "square_img" / "one.txt").write_text("caption", encoding="utf-8")
    for index in range(40):
        media_name = "item_" + str(index) + ".png"
        (folder / media_name).write_bytes(b"")
        if index >= 3:
            (folder / ("item_" + str(index) + ".txt")).write_text("caption", encoding="utf-8")
    (folder / ".webcap_state.json").write_text(
        '{"caption_tags_by_media": {"item_0.png": ["tag"], "item_1.png": ["tag"], "item_2.png": ["tag"]}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(training_runner.app_config, "FS_ROOT", root)
    monkeypatch.setattr(training_runner, "_read_state", lambda: {"jobs": []})
    monkeypatch.setattr(training_runner, "completed_stages", lambda path, **kwargs: (["hi", "lo"], set()))

    assert training_runner.folder_statuses_for_folders([folder])[folder] == {
        "status": "ready",
        "label": "Ready to train",
    }
