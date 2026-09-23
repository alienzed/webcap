# Prompt Assistant / Director Activity Plan

**Status:** implemented and audited on `ux/prompt-assistant-activity` / PR #67.

## Goal

Make local LLM assistance feel responsive and predictable without adding a second queue system or blocking the app. Keep the selected local LLM resident after a response, yield its VRAM only when Training or shared Inference actually needs the GPU, and expose truthful screen-local progress while the LLM is loading or generating.

## Invariants

1. Generate calls the feature **Prompt Assistant**; Storyboard keeps **Director**.
2. Prompt Assistant / Director never globally locks WebCap.
3. Only one local LLM request runs at a time.
4. A successfully loaded local LLM remains loaded after a response.
5. Training and shared Inference reserve the shared GPU first, then evict any retained local LLM before launching GPU work.
6. If retained-model eviction fails, the competing GPU workload must not launch.
7. Remote OpenAI-compatible Director mode never attempts local model eviction.
8. Progress is factual phase information, elapsed time, and existing GPU/RAM telemetry. No fake percentage and no claim to expose model thoughts.
9. The existing synchronous request/response contract remains in place for this pass; no new queue, websocket layer, or token streaming.
10. Operational failures continue to reach the global Console; local activity UI is additive context.

## Phase 1 — retained local model and safe GPU yield

- Stop unloading the selected local model after each successful response.
- Reuse an already-loaded selected model.
- If another Director model is loaded, unload it before loading the newly selected model.
- Add one explicit runtime helper that evicts loaded local Director models for competing GPU work.
- Call that helper only after Training or shared Inference has successfully reserved the shared GPU and before it launches work.
- Preserve shutdown/settings/error cleanup.

## Phase 2 — shared LLM activity status

- Add a tiny in-memory runtime activity snapshot.
- Expose phases such as `preparing`, `freeing_comfy`, `loading_model`, `generating`, `complete`, and `error`.
- Include model ID, operation label, start time, and latest error.
- Add a lightweight status route that reads the snapshot without triggering model discovery/reload.

## Phase 3 — screen-local feedback and naming

- Generate: rename Director UI copy to **Prompt Assistant** and actions to **Expand Prompt** / **Refine Prompt**.
- Storyboard remains **Director**.
- Add one compact non-modal activity card to each screen.
- While an LLM action is active, poll its lightweight status plus the existing system-status endpoint at a short cadence; stop the fast poll when the action ends.
- Show truthful phase, elapsed time, and GPU/VRAM/RAM information when available.
- Keep the prompt/editor and rest of WebCap usable; only conflicting LLM action controls remain disabled.

## Phase 4 — focused validation

Cover at least:

- successful local request keeps the model loaded;
- same-model follow-up does not reload;
- changing model unloads the prior loaded model;
- Training reserves then evicts retained Director model before launch;
- shared Inference does the same;
- eviction failure prevents competing GPU launch;
- remote mode does not perform local eviction;
- lightweight status reads do not cause model discovery/reload;
- Generate wording and activity DOM contract;
- Storyboard activity DOM contract.

## Final audit

Review specifically for:

- GPU arbitration races;
- accidental global UI locking;
- polling that replaces live DOM;
- hidden model reload/unload work;
- duplicate state ownership;
- failures that bypass the global Console;
- unnecessary new abstractions.

Prefer removing complexity over expanding this design.


## Implementation audit

### Confirmed

- Successful local Prompt Assistant / Director calls retain the selected llama.cpp model instead of unloading it after every response.
- A follow-up request reuses the selected loaded model; switching models explicitly unloads the previous loaded model first.
- Retaining a model does not retain WebCap's shared GPU reservation after a successful LLM response.
- Training and shared Inference win the shared GPU reservation before asking the LLM runtime to yield VRAM, preventing a new Director request from racing into the handoff.
- A failed LLM eviction prevents the competing workload from launching and visibly pauses the affected queue.
- Remote OpenAI-compatible Director mode never attempts local model eviction.
- LLM activity is an in-memory read-only snapshot; the fast polling endpoint does not perform llama.cpp model discovery or reload work.
- The activity lifecycle is serialized with the same re-entrant request lock as the LLM request itself, so a waiting second request cannot overwrite the visible phase of the request currently running.
- Generate uses Prompt Assistant terminology while Storyboard retains Director terminology.
- Both screens use a feature-owned, non-modal activity card with truthful lifecycle phase and elapsed time. GPU/VRAM/RAM telemetry is supplemental and best-effort; telemetry failure does not replace the authoritative LLM phase.
- The existing synchronous request/response architecture remains intact. No additional queue, service layer, event bus, websocket protocol, or token-streaming path was introduced.
- Existing global Console error reporting remains unchanged.

### Hostile findings corrected during audit

1. **Activity ownership race.** The first implementation set `preparing` before acquiring the request lock, allowing a second waiting LLM request to overwrite the first request's activity. The lifecycle now uses the same re-entrant request lock from `preparing` through completion/error.
2. **Terminal card vanished immediately.** The first card renderer hid as soon as `active=false`; terminal `complete/error` states now remain visible briefly.
3. **Telemetry was accidentally authoritative.** A failed system-status request originally collapsed the card to generic `Preparing…`; hardware telemetry is now optional and cannot replace the real LLM phase.

### Validation notes

Focused tests were added/updated for retained-model reuse and switching, failed-request cleanup, local/remote GPU-yield behavior, Training and shared-Inference handoff ordering, queue blocking on failed eviction, activity lifecycle state, and both UI contracts.

This environment could not execute the branch test suite: GitHub Actions is not yet present on `main` (the CI work remains in PR #63), and the local execution environment cannot resolve GitHub for a branch clone. Therefore the final audit is source/diff based; it does not claim an executed pytest or Node run.
