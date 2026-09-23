# Director / Prompt Assistant eager preload plan

Status: implementation branch `ux/director-eager-preload`.

## Goal

Hide most local LLM cold-load latency by opportunistically preloading the selected Director / Prompt Assistant model shortly after entering Storyboard or Generate, while ensuring speculative work never evicts ComfyUI models or intentionally outranks Training / shared Inference.

## Existing invariants to preserve

- Successful local LLM calls retain the selected model.
- Training and shared Inference reserve the shared GPU before evicting a retained local LLM.
- Director / Prompt Assistant uses the existing shared GPU reservation contract.
- Remote OpenAI-compatible mode does not manage local llama.cpp models.
- Screen-local activity is non-modal and must not globally lock WebCap.
- No new queue, background service, event bus, websocket, or persistent state.

## Phase 0 - lock-order safety

Training launches while holding its own queue lock and then evicts retained LLM state after reserving the shared GPU. A local Director request can hold the LLM request lock while checking Training availability. To avoid a lock inversion, retained-model eviction must not acquire the LLM request lock after Training / Inference already owns the shared GPU.

This is safe because once Training or Inference owns the shared GPU, a local Director request cannot enter model execution. An LLM request that has not yet acquired the GPU may fail cleanly and yield to the real workload.

## Upstream llama.cpp decision

Current llama.cpp uses `--load-mode auto` by default, which chooses mmap where supported. `mmap+mlock` pins mapped pages while the model mapping exists, but does not provide a durable host-RAM model cache after the router unloads that model, and it can introduce OS memlock constraints.

Therefore this change does not alter llama.cpp load mode. WebCap keeps the current default mmap behavior and benefits from the OS page cache where available.

## Phase 1 - conservative backend preload

Add one explicit `preload_model(model_id)` operation in the existing LLM runtime.

It must:

1. No-op for remote mode.
2. Serialize with the existing LLM request lock.
3. Return immediately if the selected model is already loaded.
4. Refuse speculative load when shared Inference has active work or an unpaused queued job.
5. Reserve the existing external GPU owner, which already refuses active or launchable queued Training work.
6. Recheck shared Inference after reservation before loading.
7. Inspect current GPU memory without freeing any ComfyUI models.
8. Estimate required VRAM from the GGUF file size with explicit headroom; if free VRAM is unknown or insufficient, skip preload.
9. Load the selected model through the existing router path.
10. Release the shared GPU reservation after success, leaving the model resident.
11. On load failure, clean up a partially loaded model before releasing the reservation; if cleanup cannot be confirmed on an external router, preserve the GPU reservation rather than risk a collision.

Expose this as `POST /fs/director/preload`.

Expected skips return `ok: true` with `loaded: false` and a machine-readable reason.

## Phase 2 - workspace dwell trigger

Generate and Storyboard each own a tiny local preload timer.

- Start only after Director model discovery resolves the selected model.
- Wait 1.5 seconds after entering the workspace.
- Cancel the timer when leaving the workspace.
- Do nothing when the selected model is already reported loaded.
- Do nothing when another preload is already in flight.
- Trigger the shared preload route without disabling normal screen controls.
- Reuse the existing Director / Prompt Assistant activity card while preload is actually in flight.
- If the selected LLM changes, schedule the newly selected model after the same dwell.

## Phase 3 - validation

Add focused tests for:

- already-loaded model is not reloaded;
- remote mode is a no-op;
- active / launchable queued Inference prevents preload;
- Training reservation refusal prevents preload;
- insufficient or unavailable VRAM skips preload without touching ComfyUI;
- sufficient idle VRAM loads and releases the reservation;
- cleanup failure preserves GPU safety;
- Generate and Storyboard schedule preload after model discovery and cancel timers on close;
- preload activity is non-modal and shares the existing activity card.

## Known bounded worst case

If a real Training / Inference job is submitted after preload has passed its final idle check and begun llama.cpp model loading, that real workload must wait for the in-flight load to finish and release the shared GPU reservation. The current llama.cpp router API does not expose a safe cancellation primitive for an in-progress `/models/load` call. The 1.5-second dwell plus double idle check keeps this window narrow without adding cancellation machinery.
