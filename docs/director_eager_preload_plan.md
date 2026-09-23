# Director / Prompt Assistant eager preload plan

Status: implemented and audited on `ux/director-eager-preload`.

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

Training launches while holding its own queue lock and then evicts retained LLM state after reserving the shared GPU. A local Director request can hold the LLM request lock while checking Training availability. The prior blocking eviction lock therefore had a lock-inversion risk.

Retained-model eviction now attempts the LLM request lock non-blockingly. If Director is still finishing, Training / Inference releases its temporary shared-GPU claim and retries on its normal monitor cycle without pausing the queue. Real unload failures still pause the affected queue.

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


## Implementation audit

### Confirmed

- Eager preload is speculative only: it never calls ComfyUI `/free`.
- Preload uses the existing external GPU reservation contract; launchable Training work blocks it.
- Active or launchable queued shared Inference work is checked before reservation and again after reservation.
- Current GPU free memory must be known and exceed the GGUF file size estimate plus 15% model overhead and 4 GiB safety headroom.
- Unknown model size, unknown GPU memory, insufficient VRAM, remote mode, already-loaded state, or a competing GPU owner all result in a clean skip.
- Successful preload releases the shared GPU reservation while leaving the local LLM resident.
- Generate and Storyboard wait 1.5 seconds after model discovery before attempting preload.
- Leaving either workspace cancels an unstarted preload timer.
- An in-flight preload is not cancelled; the existing llama.cpp router API does not expose a safe load-cancellation primitive.
- Changing the selected LLM during an in-flight preload schedules the newly selected model after the current preload finishes.
- Preload does not set the normal Director busy state; the rest of the screen remains usable.
- The existing activity card and telemetry polling are reused; no new toast framework or global status system was introduced.
- No llama.cpp load-mode flag was added. Current default mmap behavior remains unchanged.

### Hostile finding corrected

The merged retained-model handoff from PR #67 had a latent lock inversion: Training could hold its queue lock while waiting for the LLM request lock, while Director held the LLM request lock and asked Training for GPU availability. Eviction now uses a non-blocking request-lock acquisition; busy Director work causes a normal retry rather than a deadlock or queue pause.

### Validation limitation

Focused pytest/UI contract tests were added for preload eligibility, VRAM gating, no-Comfy eviction, retained-model handoff retry behavior, and both workspace dwell triggers. GitHub Actions is still not present on `main` because the CI work remains in PR #63, so this branch cannot execute its test suite through Actions here. Final validation is therefore source/diff based rather than a claimed executed pytest run.
