import logging


_logger = logging.getLogger(__name__)


def _release_retained_llm(owner):
    from .storyboard_llm_runtime import DirectorRuntimeBusy, release_loaded_model_for_gpu_work

    try:
        release_loaded_model_for_gpu_work()
    except DirectorRuntimeBusy:
        return False
    except Exception:
        _logger.exception(
            "Prompt Assistant / Director model cleanup failed before %s.",
            owner.capitalize(),
        )
        raise
    return True


def _prepare_comfyui_for_training():
    """Wait for any ComfyUI queue activity, then release cached models."""
    from . import inference_runtime

    try:
        provider_queue = inference_runtime.queue_snapshot()
    except (ConnectionError, TimeoutError):
        _logger.info("ComfyUI is unavailable during Training handoff; proceeding.")
        return True

    running = provider_queue.get("running") or []
    pending = provider_queue.get("pending") or []
    if running or pending:
        _logger.info(
            "Training is waiting for ComfyUI to become idle (%d running, %d pending).",
            len(running),
            len(pending),
        )
        return False

    try:
        inference_runtime.free_cached_models()
    except (ConnectionError, TimeoutError):
        _logger.warning("ComfyUI became unavailable while releasing cached models before Training; proceeding.")
    except Exception:
        _logger.exception(
            "ComfyUI cache release failed before Training; proceeding so the real launch failure remains visible."
        )
    return True

def _prepare_comfyui_for_llm():
    """Release retained ComfyUI models before local LLM execution."""
    from . import inference_runtime

    try:
        inference_runtime.free_cached_models()
    except (ConnectionError, TimeoutError):
        _logger.info("ComfyUI is unavailable during LLM handoff; proceeding.")
    return True


def prepare_gpu_for(owner):
    """Perform shared runtime handoff preparation for the next local-GPU owner."""
    owner = str(owner or "").strip()
    if owner not in {"training", "llm", "inference"}:
        raise ValueError("GPU preparation owner must be training, llm, or inference.")

    if owner == "llm":
        return _prepare_comfyui_for_llm()

    if not _release_retained_llm(owner):
        return False
    if owner == "training":
        return _prepare_comfyui_for_training()
    return True
