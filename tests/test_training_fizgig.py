"""Offline Fizgig adapter contracts: no model downloads or GPU required."""

import json
import shlex

import pytest

from tool.server.training_fizgig import (
    dataset_from_capture, inspect_h3, observe_h3, plan_h3, read_loss_points, saved_artifacts,
)
from tool.server.training_backend import DiffusionPipeBackend, FizgigBackend, backend_for_job


DATASET = '''
enable_ar_bucket = true

[[directory]]
path = "/capture/media/images/portrait"
num_repeats = 2
group = "images"
size_buckets = [[640, 832, 1]]

[[directory]]
path = "/capture/media/images/square"
num_repeats = 1
group = "images"
size_buckets = [[768, 768, 1]]
'''

ARGS = dict(
    dataset_path="/capture/fizgig/dataset.toml",
    cache_root="/capture/fizgig/cache",
    output_dir="/output/runs/fizgig-test",
    output_name="fizgig-test",
    python_path="/home/user/Fizgig/.venv/bin/python",
    dit_path="/models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    vae_path="/models/minimax_h3_video_vae_fp16.safetensors",
    text_encoder_path="/models/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    rank=32,
    learning_rate=8e-5,
    epochs=70,
    save_every_n_epochs=5,
    seed=123,
)


def test_capture_preserves_reviewed_memberships_and_per_folder_repeats():
    import tomllib

    mapped = dataset_from_capture(DATASET, ARGS["cache_root"])
    config = tomllib.loads(mapped["toml"])
    assert config["general"]["enable_bucket"] is True
    assert [d["image_directory"] for d in config["datasets"]] == [
        "/capture/media/images/portrait", "/capture/media/images/square",
    ]
    assert [d["resolution"] for d in config["datasets"]] == [[640, 832], [768, 768]]
    assert [d["num_repeats"] for d in config["datasets"]] == [2, 1]
    assert len({d["cache_directory"] for d in config["datasets"]}) == 2
    assert all(d["photos_only"] for d in config["datasets"])


def test_h3_plan_uses_headless_three_stage_cli_and_explicit_adapter():
    plan = plan_h3(DATASET, **ARGS, adapter_path="/models/ostris v1.safetensors", ema_decay=0.98)
    latents = shlex.split(plan["commands"]["latents"])
    text = shlex.split(plan["commands"]["text"])
    train = shlex.split(plan["commands"]["train"])
    assert latents[:3] == [ARGS["python_path"], "src/fizgig/families/cache.py", "--family"]
    assert latents[latents.index("--stage") + 1] == "latents"
    assert text[text.index("--stage") + 1] == "text"
    assert latents[latents.index("--model") + 1] == ARGS["vae_path"]
    assert text[text.index("--model") + 1] == ARGS["text_encoder_path"]
    assert "--skip_existing" in latents and "--skip_existing" in text
    assert train[train.index("--training_adapter") + 1] == "/models/ostris v1.safetensors"
    assert train[train.index("--ema_decay") + 1] == "0.98"
    assert train[train.index("--max_train_epochs") + 1] == "70"
    assert train[train.index("--network_dim") + 1] == "32"
    assert "--save_state" in train
    assert "--save_state_on_train_end" in train
    assert "--resume" not in train
    assert "deepspeed" not in plan["commands"]["train"]
    assert plan["pauseSentinel"] == "/output/runs/fizgig-test/.pause_requested"
    assert [step["name"] for step in plan["phases"]] == ["latents", "text", "train"]
    assert [step["command"] for step in plan["phases"]] == [plan["commands"][name] for name in ("latents", "text", "train")]


def test_explicit_h3_photo_blocks_are_passed_as_family_option():
    train = shlex.split(plan_h3(DATASET, **ARGS, photo_blocks="20-49")["commands"]["train"])
    assert train[train.index("--family_option") + 1] == "photo_blocks=20-49"
    with pytest.raises(ValueError, match="block targeting"):
        plan_h3(DATASET, **ARGS, photo_blocks="; rm -rf /")


def test_no_adapter_means_no_frozen_adapter_in_training():
    train = shlex.split(plan_h3(DATASET, **ARGS)["commands"]["train"])
    assert "--training_adapter" not in train


def test_resume_requires_actual_fizgig_state_directory():
    good = "/output/runs/fizgig-test/fizgig-test-000030-state"
    train = shlex.split(plan_h3(DATASET, **ARGS, resume_state=good)["commands"]["train"])
    assert train[train.index("--resume") + 1] == good
    with pytest.raises(ValueError, match="explicit"):
        plan_h3(DATASET, **ARGS, resume_state="/output/runs/fizgig-test/latest")
    with pytest.raises(ValueError, match="absolute"):
        plan_h3(DATASET, **ARGS, resume_state="../other-state")
    with pytest.raises(ValueError, match="exact output run"):
        plan_h3(DATASET, **ARGS, resume_state="/output/other/fizgig-test-000030-state")


@pytest.mark.parametrize("broken", [
    DATASET.replace('group = "images"', 'group = "videos"', 1),
    DATASET.replace("size_buckets = [[640, 832, 1]]", "size_buckets = [[640, 832, 22]]"),
    DATASET.replace("size_buckets = [[640, 832, 1]]", "size_buckets = [[640, 832, 1], [704, 768, 1]]"),
    DATASET.replace("path = \"/capture/media/images/square\"", "path = \"/capture/media/images/portrait\""),
])
def test_unsupported_or_duplicate_captured_memberships_fail_loudly(broken):
    with pytest.raises(ValueError):
        dataset_from_capture(broken, ARGS["cache_root"])


def test_training_paths_are_quoted_and_must_be_absolute():
    changed = dict(ARGS, output_dir="/output/my runs/test")
    train = shlex.split(plan_h3(DATASET, **changed)["commands"]["train"])
    assert train[train.index("--output_dir") + 1] == changed["output_dir"]
    with pytest.raises(ValueError, match="absolute"):
        plan_h3(DATASET, **dict(ARGS, python_path="python")])


def test_fizgig_checkpoint_request_does_not_touch_diffusion_pipe_sentinel(tmp_path):
    FizgigBackend.request_checkpoint_save(tmp_path)
    assert (tmp_path / ".pause_requested").is_file()
    assert not (tmp_path / "save_quit").exists()
    other = tmp_path / "dp"
    other.mkdir()
    DiffusionPipeBackend().request_checkpoint_save(other)
    assert (other / "save_quit").is_file()
    assert not (other / ".pause_requested").exists()
    with pytest.raises(ValueError, match="Unsupported training backend: fizgig"):
        backend_for_job({"trainerId": "fizgig"})


def test_checkpoint_discovery_keeps_epoch_weights_and_state_separate():
    found = saved_artifacts("/output/runs/fizgig-test", "fizgig-test", [
        "fizgig-test-000005.safetensors", "fizgig-test-000030.safetensors",
        "fizgig-test-000030-state", "fizgig-test.safetensors",
        "other-000020.safetensors", "fizgig-test-000006.safetensors.bak",
    ])
    assert list(found["epochs"]) == [5, 30]
    assert list(found["states"]) == [30]
    assert found["states"][30].endswith("fizgig-test-000030-state")


def test_h3_image_block_default_matches_fizgig_default_not_all_blocks():
    planned = plan_h3(DATASET, **ARGS)
    train = shlex.split(planned["commands"]["train"])
    assert train[train.index("--family_option") + 1] == "photo_blocks=20-49"
    assert planned["photoBlocks"] == "20-49"
    all_blocks = shlex.split(plan_h3(DATASET, **ARGS, photo_blocks="")["commands"]["train"])
    assert "--family_option" not in all_blocks


def test_fizgig_epoch_log_maps_to_normalized_progress():
    log = "[train] starting\n2026-10-24 INFO epoch 1/70  avr_loss=0.4  step=30  1.23s/step\n"
    log += "2026-10-24 INFO epoch 2/70  avr_loss=0.35  step=60  1.18s/step\n"
    assert observe_h3(log) == {
        "phase": "train", "epoch": 2, "epochs": 70,
        "step": 60, "loss": 0.35, "secondsPerStep": 1.18,
    }
    assert observe_h3("Caching latents...") == {}


def test_fizgig_loss_reads_native_jsonl_only_when_requested(tmp_path):
    path = tmp_path / ".fizgig_loss_run.jsonl"
    path.write_text(
        '{"s":10,"e":1,"l":0.15}\n'
        '{"s":20,"e":1,"l":0.12,"lr":0.00008}\n'
        '{"s":30,"e":2,"l":0.09}\n',
        encoding="utf-8",
    )
    assert read_loss_points(tmp_path, "run") == [
        {"step": 10, "epoch": 1, "loss": 0.15},
        {"step": 20, "epoch": 1, "loss": 0.12, "lr": 0.00008},
        {"step": 30, "epoch": 2, "loss": 0.09},
    ]
    (tmp_path / "run-000002.safetensors").write_bytes(b"weights")
    inspected = inspect_h3(tmp_path, "run")
    assert inspected["lossPoints"] is None
    assert inspected["candidates"] == [{"epoch": 2, "path": str(tmp_path / "run-000002.safetensors")}]
    assert inspected["resumePoints"] == []
    assert inspected["lossPoints"] is None
    assert inspect_h3(tmp_path, "run", include_loss=True)["lossPoints"][-1]["epoch"] == 2
    path.write_text('{"s":2,"e":1}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="loss record"):
        read_loss_points(tmp_path, "run")


def test_fizgig_state_requires_commit_marker_and_actual_state_files(tmp_path):
    (tmp_path / "run-000004.safetensors").write_bytes(b"checkpoint")
    state = tmp_path / "run-000004-state"
    state.mkdir()
    for name in ("lora.safetensors", "optimizer.pt", "rng.pt"):
        (state / name).write_bytes(b"saved")
    # A half-written state never counts as a verified resume checkpoint.
    assert inspect_h3(tmp_path, "run")["checkpointVerified"] is False
    marker = state / "training_state.json"
    marker.write_text(json.dumps({"epoch": 4, "global_step": 120}), encoding="utf-8")
    found = inspect_h3(tmp_path, "run")
    assert found["checkpointVerified"] is True
    assert found["resumePoints"] == [{"id": str(state), "epoch": 4, "step": 120}]
    assert found["candidates"] == [{"epoch": 4, "path": str(tmp_path / "run-000004.safetensors")}]
    (state / "optimizer.pt").unlink()
    with pytest.raises(ValueError, match="incomplete"):
        inspect_h3(tmp_path, "run")


def test_fizgig_invalid_or_inconsistent_state_marker_fails_loudly(tmp_path):
    state = tmp_path / "run-000004-state"
    state.mkdir()
    (state / "training_state.json").write_text(json.dumps({"epoch": 5}), encoding="utf-8")
    with pytest.raises(ValueError, match="does not match"):
        inspect_h3(tmp_path, "run")
