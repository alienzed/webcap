import copy
import json
import logging
import threading
import time

from .execution_queue import (
    discard_persisted_lane as execution_discard_persisted_lane,
    ephemeral_lane as execution_ephemeral_lane,
    resource_owner as execution_resource_owner,
    transient_receipt as execution_transient_receipt,
)


EXECUTION_LANE = "llm"
GPU_RESERVATION_OWNER = EXECUTION_LANE
_execution_queue = execution_ephemeral_lane(EXECUTION_LANE)

def _require_llm_lane(lane_name):
    if str(lane_name or "").strip() != EXECUTION_LANE:
        raise ValueError("LLM execution lane is required.")


execution_clear_lane = _execution_queue.clear
execution_consume_terminal_job = _execution_queue.consume_terminal_job
execution_cancel_or_stop = _execution_queue.cancel_or_stop


def execution_claim_next(lane_name, runnable_backlog_ids=None, expected_job_id=""):
    _require_llm_lane(lane_name)
    if runnable_backlog_ids:
        raise ValueError("LLM execution does not support a backlog.")
    return _execution_queue.claim_next(expected_job_id=expected_job_id)


def execution_enqueue(lane_name, payload, metadata=None, job_id=None, initial_status="queued"):
    _require_llm_lane(lane_name)
    return _execution_queue.enqueue(
        payload,
        metadata=metadata,
        job_id=job_id,
        initial_status=initial_status,
    )


execution_finish_job_transient = _execution_queue.finish_job_transient
execution_get_job = _execution_queue.get_job


def execution_lane_snapshot(lane_name, include_terminal=True):
    _require_llm_lane(lane_name)
    return _execution_queue.lane_snapshot(include_terminal=include_terminal)


execution_mark_running = _execution_queue.mark_running
execution_reset_unfinished = _execution_queue.reset_unfinished



_dispatch_lock = threading.Lock()
_enqueue_lock = threading.Lock()
_reconcile_lock = threading.Lock()
_startup_reconciled = False
_monitor_lock = threading.Lock()
_monitor_thread = None
_logger = logging.getLogger(__name__)


def _redact_diagnostic_value(value):
    if isinstance(value, dict):
        return {key: _redact_diagnostic_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_diagnostic_value(item) for item in value]
    if isinstance(value, str) and value.startswith("data:image/"):
        header = value.split(",", 1)[0]
        return header + ",<embedded image omitted; {} chars>".format(len(value))
    return value


def _diagnostic_contract_json(contract):
    return json.dumps(_redact_diagnostic_value(contract), indent=2, ensure_ascii=False)


def _reserve_gpu():
    from .training_runner import reserve_gpu_for_external_work
    return reserve_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _release_gpu():
    from .training_runner import release_gpu_for_external_work
    release_gpu_for_external_work(GPU_RESERVATION_OWNER)


def _job_model_id(job):
    if not isinstance(job, dict):
        return ""
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    return str(metadata.get("modelId") or job.get("modelId") or "").strip()


def local_gpu_work_runnable():
    """Return whether the current FIFO head needs the local GPU."""
    _ensure_execution_reconciled()
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if current.get("activeJobId"):
        return False
    queued = [job for job in current.get("jobs", []) if str(job.get("status") or "") == "queued"]
    if not queued:
        return False
    from .storyboard_llm_runtime import uses_local_gpu
    return uses_local_gpu(_job_model_id(queued[0]))


def _job_view(job):
    if not isinstance(job, dict):
        return None
    metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    return {
        "jobId": str(job.get("id") or ""),
        "client": str(metadata.get("client") or ""),
        "label": str(metadata.get("label") or ""),
        "operation": str(metadata.get("operation") or ""),
        "modelId": str(metadata.get("modelId") or ""),
        "storyId": str(metadata.get("storyId") or ""),
        "sceneId": str(metadata.get("sceneId") or ""),
        "status": str(job.get("status") or ""),
        "queuePosition": int(job.get("queuePosition") or 0),
        "createdAt": job.get("createdAt"),
        "startedAt": job.get("startedAt"),
        "finishedAt": job.get("finishedAt"),
        "result": copy.deepcopy(result),
        "error": str(job.get("error") or ""),
    }


def _ensure_execution_reconciled():
    global _startup_reconciled
    if _startup_reconciled:
        return
    with _reconcile_lock:
        if _startup_reconciled:
            return
        # LLM requests are session work, not durable history or restartable
        # backlog. Successfully applied Story/prompt state already lives in its
        # real store; everything else is intentionally forgotten on restart.
        execution_discard_persisted_lane(EXECUTION_LANE)
        execution_clear_lane()
        _startup_reconciled = True


def reconcile_startup():
    _ensure_execution_reconciled()
    _ensure_monitor_started()


def _assert_storyboard_contract_current(context, frozen_contract):
    if context.get("deferredApply") is True:
        return
    if "sourceInstruction" not in context:
        return

    from .storyboard_llm_contract import build_request
    from .storyboard_store import load_story

    story_id = str(context.get("storyId") or "").strip()
    scene_id = str(context.get("sceneId") or "").strip()
    operation = str(context.get("operation") or "").strip()
    current_story = load_story(story_id)
    current_contract = build_request(
        current_story,
        scene_id,
        operation,
        instruction=str(context.get("sourceInstruction") or ""),
    )
    if current_contract != frozen_contract:
        raise RuntimeError(
            "Storyboard Director inputs changed while the request was running. "
            "The stale result was not applied; run the Director action again against the current Story state."
        )


def _client_result(client, context, llm_result, job_id="", frozen_contract=None):
    if client in {"chat", "caption"}:
        result = {
            "text": llm_result["text"],
            "reasoning": llm_result.get("reasoning", ""),
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
            "contextSize": llm_result.get("contextSize"),
        }
        operation = str((frozen_contract or {}).get("operation") or "").strip()
        if client == "caption" and operation == "caption_vision_validate":
            from .caption_vision import normalize_caption_vision_result
            result["vision"] = normalize_caption_vision_result(
                llm_result["text"],
                context.get("visionGroups"),
            )
        if client == "caption" and operation == "vision_schema_sight":
            from .vision_schema_assist import normalize_vision_schema_sight_result
            try:
                result["sight"] = normalize_vision_schema_sight_result(llm_result["text"])
            except ValueError as exc:
                result["sight"] = None
                result["structureWarning"] = str(exc)
        if client == "caption" and operation == "vision_vocabulary_sight":
            from .vision_schema_assist import normalize_vision_vocabulary_sight_result
            try:
                result["vocabularySight"] = normalize_vision_vocabulary_sight_result(
                    llm_result["text"],
                    context.get("existingGroups"),
                )
            except ValueError as exc:
                result["vocabularySight"] = None
                result["structureWarning"] = str(exc)
        return result

    if client == "generate":
        return {
            "result": llm_result["text"],
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client == "qa":
        operation = str((frozen_contract or {}).get("operation") or "").strip()
        if operation != "qa_deep_scan":
            raise RuntimeError("Unsupported QA LLM operation: " + (operation or "empty"))
        from .qa_llm_contract import normalize_result
        return {
            "analysis": normalize_result(
                llm_result.get("data"),
                allowed_files=(frozen_contract or {}).get("source_files") or [],
            ),
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client == "schema":
        operation = str((frozen_contract or {}).get("operation") or "").strip()
        if operation == "vision_schema_suggest":
            from .vision_schema_contract import normalize_result
            return {
                "schema": normalize_result(
                    llm_result.get("data"),
                    sight_evidence=(frozen_contract or {}).get("sight_evidence") or [],
                    existing_groups=(frozen_contract or {}).get("existing_groups") or [],
                ),
                "model": llm_result["model"],
                "finishReason": llm_result.get("finishReason"),
                "usage": llm_result.get("usage"),
                "timings": llm_result.get("timings"),
            }
        if operation == "vision_schema_challenge":
            from .vision_schema_contract import normalize_result
            return {
                "schema": normalize_result(
                    llm_result.get("data"),
                    sight_evidence=(frozen_contract or {}).get("sight_evidence") or [],
                    existing_groups=(frozen_contract or {}).get("existing_groups") or [],
                ),
                "model": llm_result["model"],
                "finishReason": llm_result.get("finishReason"),
                "usage": llm_result.get("usage"),
                "timings": llm_result.get("timings"),
            }
        if operation == "vision_tag_suggest":
            from .vision_schema_contract import normalize_assignment_result
            return {
                "tagCandidates": normalize_assignment_result(
                    llm_result.get("data"),
                    existing_groups=(frozen_contract or {}).get("existing_groups") or [],
                    allowed_files=(frozen_contract or {}).get("source_files") or [],
                    current_assignments=(frozen_contract or {}).get("current_assignments") or {},
                    existing_only=bool((frozen_contract or {}).get("existing_only")),
                ),
                "model": llm_result["model"],
                "finishReason": llm_result.get("finishReason"),
                "usage": llm_result.get("usage"),
                "timings": llm_result.get("timings"),
            }
        raise RuntimeError("Unsupported Schema Assist LLM operation: " + (operation or "empty"))

    if client == "test":
        operation = str((frozen_contract or {}).get("operation") or "").strip()
        if operation != "analyze_caption_wildcard":
            raise RuntimeError("Unsupported Test Generations LLM operation: " + (operation or "empty"))
        from .test_wildcard_contract import normalize_result
        return {
            "analysis": normalize_result(llm_result.get("data")),
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if client != "storyboard":
        raise RuntimeError("Unsupported LLM client: " + (client or "empty"))

    story_id = str(context.get("storyId") or "").strip()
    operation = str(context.get("operation") or "").strip()
    if not story_id:
        raise RuntimeError("Storyboard LLM job is missing its Story ID.")
    if frozen_contract is None:
        raise RuntimeError("Storyboard LLM job is missing its frozen contract.")
    _assert_storyboard_contract_current(context, frozen_contract)

    if operation == "expand_concept":
        from .storyboard_store import apply_concept_expansion
        story = apply_concept_expansion(story_id, llm_result.get("text"))
        return {
            "storyId": story["id"],
            "result": story["concept"],
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "define_invariants":
        from .storyboard_store import apply_defined_invariants
        story, added_count = apply_defined_invariants(story_id, llm_result.get("data"))
        return {
            "storyId": story["id"],
            "addedCount": added_count,
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "repair_scenes":
        from .storyboard_store import apply_scene_repairs

        repair_payload = copy.deepcopy(llm_result.get("data"))
        if not isinstance(repair_payload, dict) or not isinstance(repair_payload.get("changes"), list):
            raise ValueError("Storyboard Scene repair response must contain a changes array.")

        story, changed_scene_count, changed_field_count = apply_scene_repairs(
            story_id,
            repair_payload,
            context.get("repairBase"),
            model_id=llm_result["model"],
            job_id=job_id,
        )
        return {
            "storyId": story["id"],
            "changedSceneCount": changed_scene_count,
            "changedFieldCount": changed_field_count,
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "develop_story_outline":
        data = copy.deepcopy(llm_result.get("data"))
        if not isinstance(data, dict) or not isinstance(data.get("scenes"), list) or not data["scenes"]:
            raise ValueError("Storyboard Director returned an invalid Scene outline.")
        return {
            "storyId": story_id,
            "outline": data,
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "develop_story_scene":
        data = copy.deepcopy(llm_result.get("data"))
        if not isinstance(data, dict) or not isinstance(data.get("scene"), dict):
            raise ValueError("Storyboard Director returned an invalid individual Scene.")
        return {
            "storyId": story_id,
            "scene": data["scene"],
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "develop_story":
        from .storyboard_generation import generation_queue
        from .storyboard_store import apply_developed_plan
        active_generation = generation_queue(story_id)
        if active_generation.get("jobs"):
            raise RuntimeError(
                "Story has pending Take generation. Stop or finish it before applying developed Scenes."
            )
        plan = copy.deepcopy(llm_result.get("data"))
        if not isinstance(plan, dict):
            raise ValueError("Storyboard Director returned an invalid Scene plan.")
        story = apply_developed_plan(
            story_id,
            plan,
            model_id=llm_result["model"],
        )
        return {
            "storyId": story["id"],
            "sceneCount": len(story.get("sceneOrder") or []),
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation == "insert_scene":
        scene_id = str(context.get("sceneId") or "").strip()
        if not scene_id:
            raise RuntimeError("Storyboard Insert Scene job is missing its anchor Scene ID.")
        data = copy.deepcopy(llm_result.get("data"))
        if not isinstance(data, dict) or not isinstance(data.get("scene"), dict):
            raise ValueError("Storyboard Director Insert Scene response must contain a scene object.")
        from .storyboard_store import insert_director_scene_after
        story, scene = insert_director_scene_after(
            story_id,
            scene_id,
            data["scene"],
            model_id=llm_result["model"],
        )
        return {
            "storyId": story["id"],
            "sceneId": scene["id"],
            "insertedAfterSceneId": scene_id,
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    if operation in {"write_prompt", "refine_prompt"}:
        scene_id = str(context.get("sceneId") or "").strip()
        if not scene_id:
            raise RuntimeError("Storyboard Scene Director job is missing its Scene ID.")

        data = llm_result.get("data")
        if not isinstance(data, dict):
            raise ValueError("Storyboard Director returned invalid structured Scene prompt data.")

        if operation == "refine_prompt" and data.get("changed") is False:
            from .storyboard_store import load_story
            story = load_story(story_id)
            scene = (story.get("scenes") or {}).get(scene_id)
            if not isinstance(scene, dict):
                raise FileNotFoundError("Scene does not exist.")
        else:
            prompt = str(data.get("prompt") or "").strip()
            if not prompt:
                raise ValueError("Storyboard Director returned an empty Scene prompt.")
            from .storyboard_store import apply_director_prompt
            scene_fields = {}
            if operation == "refine_prompt":
                for key in ("summary", "entryState", "exitState"):
                    if key in data:
                        scene_fields[key] = data[key]
            duration_override = data.get("durationSeconds") if operation == "refine_prompt" else None
            story, scene = apply_director_prompt(
                story_id,
                scene_id,
                prompt,
                model_id=llm_result["model"],
                job_id=job_id,
                operation=operation,
                duration_override=duration_override,
                scene_fields=scene_fields,
            )
        return {
            "storyId": story["id"],
            "sceneId": scene["id"],
            "result": scene["prompt"],
            "model": llm_result["model"],
            "finishReason": llm_result.get("finishReason"),
            "usage": llm_result.get("usage"),
            "timings": llm_result.get("timings"),
        }

    raise RuntimeError("Unsupported Storyboard LLM operation: " + (operation or "empty"))


def _execute_claimed(job_id, gpu_reserved):
    stored = execution_get_job(job_id, include_payload=True)
    metadata = stored.get("metadata") if isinstance(stored.get("metadata"), dict) else {}
    payload = stored.get("payload") if isinstance(stored.get("payload"), dict) else {}
    contract = payload.get("contract") if isinstance(payload.get("contract"), dict) else None
    context = payload.get("clientContext") if isinstance(payload.get("clientContext"), dict) else {}
    model_id = str(metadata.get("modelId") or "").strip()
    client = str(metadata.get("client") or "").strip()
    if not model_id or contract is None:
        raise RuntimeError("LLM job is missing its frozen model or contract.")

    if client == "storyboard":
        metadata_story_id = str(metadata.get("storyId") or "").strip()
        context_story_id = str(context.get("storyId") or "").strip()
        metadata_scene_id = str(metadata.get("sceneId") or "").strip()
        context_scene_id = str(context.get("sceneId") or "").strip()
        metadata_operation = str(metadata.get("operation") or "").strip()
        context_operation = str(context.get("operation") or "").strip()
        contract_operation = str(contract.get("operation") or "").strip()
        if not context_story_id or metadata_story_id != context_story_id:
            raise RuntimeError("Storyboard LLM job Story identity is inconsistent.")
        if metadata_scene_id != context_scene_id:
            raise RuntimeError("Storyboard LLM job Scene identity is inconsistent.")
        if metadata_operation != context_operation or contract_operation != context_operation:
            raise RuntimeError("Storyboard LLM job operation identity is inconsistent.")

    running = execution_mark_running(job_id, details={"phase": "preparing"})
    if str(running.get("status") or "") == "stopping":
        return execution_finish_job_transient(
            job_id,
            status="stopped",
            error="LLM request stopped before execution.",
        )

    from .storyboard_llm_runtime import run_contract, run_freeform_chat
    try:
        if client in {"chat", "caption"}:
            overrides = context.get("runtimeOverrides") if isinstance(context.get("runtimeOverrides"), dict) else {}
            chat_kwargs = {"gpu_reserved": bool(gpu_reserved)}
            if context.get("assessmentEvidence"):
                chat_kwargs["assessment_evidence"] = True
            if "maxTokens" in overrides:
                chat_kwargs["max_tokens"] = overrides["maxTokens"]
            if "contextSize" in overrides:
                chat_kwargs["context_size"] = overrides["contextSize"]
            messages = contract.get("messages")
            caption_operation = str(contract.get("operation") or "").strip()
            if client == "caption" and caption_operation in {"caption_vision_validate", "vision_image_caption", "vision_schema_sight", "vision_vocabulary_sight"}:
                from .storyboard_llm_runtime import prepare_caption_vision_messages
                chat_kwargs["allow_image_data_urls"] = True
                messages = prepare_caption_vision_messages(model_id, messages)
                if caption_operation == "caption_vision_validate":
                    from .caption_vision import CAPTION_VISION_RESPONSE_SCHEMA
                    chat_kwargs["response_schema"] = CAPTION_VISION_RESPONSE_SCHEMA
                elif caption_operation == "vision_schema_sight":
                    from .vision_schema_assist import VISION_SCHEMA_SIGHT_RESPONSE_SCHEMA
                    chat_kwargs["response_schema"] = VISION_SCHEMA_SIGHT_RESPONSE_SCHEMA
                elif caption_operation == "vision_vocabulary_sight":
                    from .vision_schema_assist import VISION_VOCABULARY_SIGHT_RESPONSE_SCHEMA
                    chat_kwargs["response_schema"] = VISION_VOCABULARY_SIGHT_RESPONSE_SCHEMA
            llm_result = run_freeform_chat(
                model_id,
                messages,
                **chat_kwargs,
            )
        else:
            llm_result = run_contract(model_id, contract, gpu_reserved=bool(gpu_reserved))
    except Exception as exc:
        _logger.exception(
            "Director/model stage failed before WebCap ingest.\n"
            "--- FROZEN LLM CONTRACT ---\n%s",
            _diagnostic_contract_json(contract),
        )
        raise RuntimeError(
            "Director/model stage failed before WebCap ingest: " + str(exc)
        ) from exc

    # Enqueue, reset, and final result application share one ordering boundary.
    # If reset wins this lock, the result is discarded. If apply wins it, the
    # completed mutation is authoritative before reset begins.
    with _enqueue_lock:
        current = execution_get_job(job_id)
        if str(current.get("status") or "") == "stopping":
            return execution_finish_job_transient(
                job_id,
                status="stopped",
                error="LLM request stopped.",
            )

        try:
            result = _client_result(client, context, llm_result, job_id=job_id, frozen_contract=contract)
        except Exception as exc:
            _logger.exception(
                "WebCap ingest rejected a successful LLM response.\n"
                "--- FROZEN LLM CONTRACT ---\n%s\n"
                "--- CLIENT CONTEXT ---\n%s\n"
                "--- RAW MODEL RESPONSE ---\n%s",
                _diagnostic_contract_json(contract),
                json.dumps(context, indent=2, ensure_ascii=False),
                str(llm_result.get("text") or ""),
            )
            raise RuntimeError(
                "WebCap ingest failed after a successful model response: " + str(exc)
            ) from exc

        return execution_finish_job_transient(job_id, status="completed", result=result)


def _advance_queue():
    _ensure_execution_reconciled()
    with _dispatch_lock:
        snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
        if snapshot.get("activeJobId"):
            return None
        if snapshot.get("paused"):
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        queued = [job for job in snapshot.get("jobs", []) if job.get("status") == "queued"]
        if not queued:
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        from .storyboard_llm_runtime import uses_local_gpu
        next_job = queued[0]
        next_model_id = _job_model_id(next_job)
        local_gpu = uses_local_gpu(next_model_id)
        owner = execution_resource_owner()
        if local_gpu:
            if owner and owner != GPU_RESERVATION_OWNER:
                return None
            if not owner:
                if not _reserve_gpu():
                    return None
        elif owner == GPU_RESERVATION_OWNER:
            # Runtime mode may have changed while this lane retained ownership
            # for another queued local job. Remote work does not need the GPU.
            _release_gpu()

        try:
            if local_gpu:
                from .gpu_prep import prepare_gpu_for
                if not prepare_gpu_for(GPU_RESERVATION_OWNER):
                    _release_gpu()
                    return None
            from .storyboard_llm_runtime import clear_stop_request
            clear_stop_request()
            claimed = execution_claim_next(
                EXECUTION_LANE,
                expected_job_id=str(next_job.get("id") or ""),
            )
        except Exception:
            if local_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            raise
        if claimed is None:
            if local_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
            return None

        job_id = str(claimed.get("id") or "")
        release_gpu = local_gpu
        terminal = None
        try:
            terminal = _execute_claimed(job_id, gpu_reserved=local_gpu)
        except Exception as exc:
            current = execution_get_job(job_id)
            current_status = str(current.get("status") or "")
            if current_status == "stopping":
                terminal = execution_finish_job_transient(
                    job_id,
                    status="stopped",
                    error="LLM request stopped.",
                )
            elif current_status in {"starting", "running"}:
                terminal = execution_finish_job_transient(
                    job_id,
                    status="failed",
                    error=str(exc),
                )
            _logger.exception("Queued LLM job failed.")
        finally:
            if local_gpu and release_gpu:
                current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
                keep_gpu = (
                    not current.get("paused")
                    and any(
                        str(job.get("status") or "") == "queued"
                        and uses_local_gpu(_job_model_id(job))
                        for job in current.get("jobs", [])
                    )
                )
                if keep_gpu and execution_resource_owner() == GPU_RESERVATION_OWNER:
                    release_gpu = False
            if release_gpu:
                _release_gpu()

        if terminal is None:
            raise RuntimeError("LLM job ended without a terminal execution receipt.")
        return _job_view(terminal)


def _monitor_has_work():
    snapshot = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    if snapshot.get("activeJobId"):
        return True
    if snapshot.get("paused"):
        return False
    if any(str(job.get("status") or "") == "queued" for job in snapshot.get("jobs", [])):
        return True
    return False


def _monitor_loop():
    global _monitor_thread
    while True:
        try:
            _advance_queue()
        except Exception:
            _logger.exception("LLM queue monitor failed.")

        with _monitor_lock:
            if not _monitor_has_work():
                _monitor_thread = None
                return
        time.sleep(1)


def _ensure_monitor_started():
    global _monitor_thread
    with _monitor_lock:
        if _monitor_thread and _monitor_thread.is_alive():
            return
        _monitor_thread = threading.Thread(
            target=_monitor_loop,
            name="webcap-llm-queue",
            daemon=True,
        )
        _monitor_thread.start()


def _storyboard_target(context, operation):
    story_id = str((context or {}).get("storyId") or "").strip()
    scene_id = str((context or {}).get("sceneId") or "").strip()
    operation = str(operation or "").strip()
    if not story_id:
        return None
    if operation in {"expand_concept", "define_invariants"}:
        return {"kind": "concept", "storyId": story_id, "sceneId": ""}
    if operation in {"develop_story", "develop_story_outline", "develop_story_scene", "insert_scene"}:
        return {"kind": "scenes", "storyId": story_id, "sceneId": ""}
    if operation == "repair_scenes":
        return {"kind": "repair", "storyId": story_id, "sceneId": ""}
    if operation in {"write_prompt", "refine_prompt"} and scene_id:
        return {"kind": "scene-prompt", "storyId": story_id, "sceneId": scene_id}
    return None



def storyboard_target_busy(story_id, kind, scene_id=""):
    wanted = {
        "kind": str(kind or "").strip(),
        "storyId": str(story_id or "").strip(),
        "sceneId": str(scene_id or "").strip(),
    }
    if not wanted["storyId"] or wanted["kind"] not in {"concept", "scenes", "repair", "scene-prompt"}:
        raise ValueError("Storyboard Director target is invalid.")
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    for job in current.get("jobs", []):
        metadata = job.get("metadata") if isinstance(job.get("metadata"), dict) else {}
        if str(metadata.get("client") or "") != "storyboard":
            continue
        existing = _storyboard_target(
            {
                "storyId": metadata.get("storyId"),
                "sceneId": metadata.get("sceneId"),
            },
            metadata.get("operation"),
        )
        if not existing or existing["storyId"] != wanted["storyId"] or existing["kind"] != wanted["kind"]:
            continue
        if wanted["kind"] != "scene-prompt" or existing["sceneId"] == wanted["sceneId"]:
            return True
    return False


def storyboard_story_busy(story_id):
    story_id = str(story_id or "").strip()
    if not story_id:
        raise ValueError("Story ID is required.")
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=False)
    return any(
        str((job.get("metadata") or {}).get("client") or "") == "storyboard"
        and str((job.get("metadata") or {}).get("storyId") or "") == story_id
        for job in current.get("jobs", [])
    )


def _request_diagnostic(client, contract):
    if client in {"chat", "caption"}:
        from .storyboard_llm_runtime import normalize_freeform_messages
        messages = normalize_freeform_messages(contract.get("messages"))
    else:
        prompt = str(contract.get("prompt") or "").strip()
        messages = [{"role": "user", "content": prompt}] if prompt else []

    return {
        "messages": copy.deepcopy(messages),
        "messageCount": len(messages),
        "contentChars": sum(len(str(message.get("content") or "")) for message in messages),
    }


def enqueue(client, model_id, contract, context=None, label=""):
    _ensure_execution_reconciled()
    client = str(client or "").strip()
    model_id = str(model_id or "").strip()
    if client not in {"storyboard", "generate", "test", "qa", "schema", "chat", "caption"}:
        raise ValueError("Unsupported LLM client: " + (client or "empty"))
    if not model_id:
        raise ValueError("LLM model is required.")
    if not isinstance(contract, dict):
        raise ValueError("LLM contract must be an object.")

    context = copy.deepcopy(context) if isinstance(context, dict) else {}
    runtime_overrides = context.get("runtimeOverrides")
    if runtime_overrides is not None:
        if client not in {"chat", "caption"} or not isinstance(runtime_overrides, dict):
            raise ValueError("LLM runtimeOverrides are supported only for chat and caption jobs.")
        unknown_overrides = set(runtime_overrides) - {"maxTokens", "contextSize"}
        if unknown_overrides:
            raise ValueError("Unsupported LLM runtime override: " + sorted(unknown_overrides)[0])
        for field in ("maxTokens", "contextSize"):
            if field not in runtime_overrides:
                continue
            value = runtime_overrides[field]
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError("LLM runtime override " + field + " must be a positive integer.")
        if "contextSize" in runtime_overrides and runtime_overrides["contextSize"] < 1024:
            raise ValueError("LLM runtime override contextSize must be at least 1024.")
    request_diagnostic = _request_diagnostic(client, contract)
    with _enqueue_lock:
        job = execution_enqueue(
            EXECUTION_LANE,
            {
                "contract": copy.deepcopy(contract),
                "clientContext": context,
            },
            metadata={
                "client": client,
                "label": str(label or "LLM"),
                "operation": str(contract.get("operation") or ""),
                "modelId": model_id,
                "storyId": str(context.get("storyId") or ""),
                "sceneId": str(context.get("sceneId") or ""),
            },
        )
    _ensure_monitor_started()
    view = _job_view(execution_get_job(job["id"]))
    view["request"] = request_diagnostic
    return view


def job_status(job_id, consume=False):
    job_id = str(job_id or "").strip()
    try:
        job = execution_get_job(job_id)
        if (
            consume
            and str(job.get("status") or "") in {"completed", "failed", "cancelled", "stopped", "interrupted"}
        ):
            job = execution_consume_terminal_job(job_id)
    except FileNotFoundError:
        job = execution_transient_receipt(job_id, consume=consume)
    return _job_view(job)


def _queue_wait_state(current):
    queued = [job for job in current.get("jobs", []) if str(job.get("status") or "") == "queued"]
    if not queued:
        return {"queueDepth": 0, "waitOwner": "", "waitReason": ""}

    if current.get("paused"):
        return {
            "queueDepth": len(queued),
            "waitOwner": "paused",
            "waitReason": str(current.get("pauseReason") or "Director queue is paused."),
        }

    active_id = str(current.get("activeJobId") or "")
    if active_id:
        return {
            "queueDepth": len(queued),
            "waitOwner": "llm",
            "waitReason": "Another Director / Prompt Assistant request is running.",
        }

    from .storyboard_llm_runtime import uses_local_gpu
    next_model_id = _job_model_id(queued[0])
    if not uses_local_gpu(next_model_id):
        return {"queueDepth": len(queued), "waitOwner": "", "waitReason": ""}

    owner = str(execution_resource_owner() or "")
    if owner:
        labels = {"inference": "Inference", "training": "Training", "llm": "Director"}
        label = labels.get(owner, owner)
        return {
            "queueDepth": len(queued),
            "waitOwner": owner,
            "waitReason": label + " currently holds the shared GPU.",
        }

    from .training_runner import gpu_reservation_block_reason
    reason = str(gpu_reservation_block_reason(GPU_RESERVATION_OWNER) or "")

    if reason.startswith("Training "):
        return {
            "queueDepth": len(queued),
            "waitOwner": "training",
            "waitReason": reason,
        }
    return {"queueDepth": len(queued), "waitOwner": "", "waitReason": ""}


def recent_snapshot(limit=30):
    _ensure_execution_reconciled()
    return _execution_queue.recent_snapshot(limit=limit)


def snapshot(include_terminal=False):
    _ensure_execution_reconciled()
    current = execution_lane_snapshot(EXECUTION_LANE, include_terminal=include_terminal)
    return {
        "paused": bool(current.get("paused")),
        "pauseReason": str(current.get("pauseReason") or ""),
        "activeJobId": str(current.get("activeJobId") or ""),
        **_queue_wait_state(current),
        "jobs": [_job_view(job) for job in current.get("jobs", [])],
    }


def cancel_job(job_id):
    _ensure_execution_reconciled()
    job_id = str(job_id or "").strip()
    if not job_id:
        raise ValueError("LLM job ID is required.")
    with _enqueue_lock:
        try:
            result = execution_cancel_or_stop(job_id)
        except FileNotFoundError:
            result = execution_transient_receipt(job_id, consume=False)
        if str(result.get("status") or "") == "stopping":
            from .storyboard_llm_runtime import stop_active_request
            try:
                stop_active_request(_job_model_id(result))
            except (ValueError, RuntimeError) as exc:
                _logger.warning("LLM runtime could not be interrupted; abandoning its result: %s", exc)
        return {"job": _job_view(result), "queue": snapshot(include_terminal=False)}


def reset():
    _ensure_execution_reconciled()
    with _enqueue_lock:
        current = execution_reset_unfinished()
        active_id = str(current.get("activeJobId") or "")
        if active_id:
            from .storyboard_llm_runtime import stop_active_request
            active_job = next(
                (job for job in current.get("jobs", []) if str(job.get("id") or "") == active_id),
                None,
            )
            try:
                stop_active_request(_job_model_id(active_job))
            except (ValueError, RuntimeError) as exc:
                # Some externally-owned or generic remote runtimes cannot be
                # interrupted. The job remains stopping and its eventual result
                # is still discarded before client application.
                _logger.warning("LLM runtime could not be interrupted; abandoning its result: %s", exc)
        else:
            if execution_resource_owner() == GPU_RESERVATION_OWNER:
                _release_gpu()
        return snapshot(include_terminal=False)


def action(operation, job_id=""):
    _ensure_execution_reconciled()
    operation = str(operation or "").strip()
    if operation == "reset":
        return {"queue": reset()}
    if operation == "cancel_job":
        return cancel_job(job_id)
    raise ValueError("Unsupported LLM queue action: " + operation)
