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
            "Could not confirm Prompt Assistant / Director model cleanup before %s; "
            "proceeding rather than blocking on runtime uncertainty.",
            owner.capitalize(),
        )
    return True


def _prepare_comfyui_for_training():
    """Use positive ComfyUI queue state for handoff; provider uncertainty never blocks Training."""
    from . import inference_runtime

    try:
        provider_queue = inference_runtime.queue_snapshot()
    except (ConnectionError, TimeoutError):
        _logger.info("ComfyUI is unavailable during Training handoff; proceeding without a provider hold.")
        return True
    except Exception:
        _logger.exception(
            "Could not inspect ComfyUI queue during Training handoff; proceeding rather than blocking on uncertainty."
        )
        return True

    running = provider_queue.get("running") or []
    pending = provider_queue.get("pending") or []
    try:
        managed_job_ids = inference_runtime.webcap_queue_job_ids(provider_queue)
    except Exception:
        _logger.exception(
            "Could not classify ComfyUI queue ownership during Training handoff; proceeding rather than blocking on uncertainty."
        )
        return True
    if managed_job_ids:
        _logger.info(
            "Training is waiting for %d positively identified WebCap ComfyUI job(s).",
            len(managed_job_ids),
        )
        return False
    if running or pending:
        _logger.warning(
            "ComfyUI has non-WebCap queue activity during Training handoff; leaving it untouched and proceeding."
        )
        return True

    try:
        inference_runtime.free_cached_models()
    except (ConnectionError, TimeoutError):
        _logger.warning("ComfyUI became unavailable while releasing cached models before Training; proceeding.")
    except Exception:
        _logger.exception(
            "ComfyUI cache release failed before Training; proceeding so the real launch failure remains visible."
        )
    return True


def prepare_gpu_for(owner):
    """Perform shared runtime handoff preparation for the next local-GPU owner."""
    owner = str(owner or "").strip()
    if owner not in {"training", "inference"}:
        raise ValueError("GPU preparation owner must be training or inference.")

    if not _release_retained_llm(owner):
        return False
    if owner == "training":
        return _prepare_comfyui_for_training()
    return True
