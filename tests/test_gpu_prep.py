import pytest

from tool.server import gpu_prep
from tool.server import inference_runtime
from tool.server import storyboard_llm_runtime


def test_training_waits_for_any_comfyui_queue_activity(monkeypatch):
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: {"running": [["external"]], "pending": []},
    )
    monkeypatch.setattr(
        inference_runtime,
        "free_cached_models",
        lambda: pytest.fail("Busy ComfyUI must not have its models released."),
    )

    assert gpu_prep.prepare_gpu_for("training") is False


def test_training_releases_comfyui_models_when_idle(monkeypatch):
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: {"running": [], "pending": []},
    )
    monkeypatch.setattr(
        inference_runtime,
        "free_cached_models",
        lambda: calls.append("free"),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    assert gpu_prep.prepare_gpu_for("training") is True
    assert calls == ["free"]


def test_training_treats_unavailable_comfyui_as_not_busy(monkeypatch):
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: (_ for _ in ()).throw(ConnectionError("offline")),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    assert gpu_prep.prepare_gpu_for("training") is True


def test_training_surfaces_invalid_comfyui_queue_check(monkeypatch):
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: (_ for _ in ()).throw(RuntimeError("bad queue response")),
    )
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: False,
    )

    with pytest.raises(RuntimeError, match="bad queue response"):
        gpu_prep.prepare_gpu_for("training")


def test_llm_cleanup_error_is_not_turned_into_scheduler_uncertainty(monkeypatch):
    monkeypatch.setattr(
        storyboard_llm_runtime,
        "release_loaded_model_for_gpu_work",
        lambda: (_ for _ in ()).throw(RuntimeError("cleanup exploded")),
    )

    with pytest.raises(RuntimeError, match="cleanup exploded"):
        gpu_prep.prepare_gpu_for("inference")


def test_llm_waits_for_any_comfyui_queue_activity(monkeypatch):
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: {"running": [], "pending": [["external"]]},
    )
    monkeypatch.setattr(
        inference_runtime,
        "free_cached_models",
        lambda: pytest.fail("Busy ComfyUI must not have its models released."),
    )

    assert gpu_prep.prepare_gpu_for("llm") is False


def test_llm_releases_comfyui_models_when_idle(monkeypatch):
    calls = []
    monkeypatch.setattr(
        inference_runtime,
        "queue_snapshot",
        lambda: {"running": [], "pending": []},
    )
    monkeypatch.setattr(
        inference_runtime,
        "free_cached_models",
        lambda: calls.append("free"),
    )

    assert gpu_prep.prepare_gpu_for("llm") is True
    assert calls == ["free"]
