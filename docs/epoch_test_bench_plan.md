# Epoch Test Bench — Implementation Plan

**Status:** Planned; not implemented. Phase 1 is manual post-training or paused-run testing. Automated interleaved evaluation is the north star, not the first implementation.

## Purpose and boundary

Saved LoRA epochs are visual evidence, not a monotonic quality ranking. Epoch Test Bench will run one controlled inference prompt and seed against selected epoch exports, then compare the resulting image or video by epoch inside WebCap. The human decides which epoch is useful. WebCap must not infer a "best" epoch from loss, CLIP, VLM, or any hidden score.

Diffusion Pipe remains solely the trainer. ComfyUI is an external inference runtime behind one small WebCap adapter. The MVP must not fork Diffusion Pipe, sample inside the trainer, run training and inference together on the same GPU, add a database, add a generic ComfyUI editor, or add a distributed inference queue.

The first supported model is MiniMax H3 only. Records and the comparison UI remain model-neutral where inexpensive, but WAN and Krea support waits for a separately proven ComfyUI workflow contract.

## Current code facts

### Durable managed-run ownership

- `tool/server/training_action.py` is the managed action-tree authority. `ACTION_VERSION` is 2. `allocate_action()` creates `FS_ROOT/output/runs/<set-root>/<logical-run>/` with `action.json`, `captures/`, `jobs/`, and `output/`. The `actionId` is that two-component relative path. `read_action()` rejects unsafe, foreign, old-layout, and symlinked action identities.
- `managed_actions_for_folder()` enumerates only direct actions under the current set's managed root. This is the appropriate Test Bench discovery scope: do not recursively scan global training output or unrelated sets.
- A Diffusion Pipe run is a direct child of the managed action's `output/` branch. The current stabilized layout records direct `latest`, `global_step...`, `epoch...`, and saved config children. The trainer creates its timestamped directory; WebCap owns only the logical-run parent.
- `training_history._run_artifact_state()` identifies direct `epoch<N>` directories. `training_review.discover_saved_initializers()` treats an epoch export as usable only if its direct, non-symlink `epoch<N>/` directory has exactly one direct, non-symlink `.safetensors` file. The H3 initializer contract in `docs/lora_initializer.md` requires that directory, not a bare weights filename.
- The initializer picker is not Test Bench discovery. It begins with `training_history.discover_runs()`, which requires `latest` to name a valid `global_step<N>` checkpoint. Test Bench must discover saved inference exports directly from the selected managed trainer run; it must never call a resumable DeepSpeed checkpoint an inference LoRA.
- `training_runner.candidate_epoch_folder_path()` and `_candidate_safetensors_path()` already implement the narrow safety rule for a Recent Runs job: positive epoch integer, direct `epochN` directory, no symlink, and exactly one direct `.safetensors`. They currently support Copy to Test and should inform, rather than be repurposed into, durable sessions.

### Runner, progress, and existing UI

- `tool/server/training_runner.py` owns the disposable single-active-job queue. A job records action/output paths, and `_bind_job_run_path_from_log()` binds `outputRunPath` from trainer evidence. Produced `outputRunPath` remains distinct from `resumeFromCheckpoint`.
- `tool/server/training_progress.py` obtains epoch evidence from `Started new epoch:` log lines and captured config save/checkpoint intervals. It does not discover saved LoRA artifacts.
- `stop_response(..., pause=True)` uses `_request_checkpointed_stop()`, writes `save_quit`, and waits for a verified checkpoint-safe stop. `_queue_paused_job()` converts its produced output to resume source and keeps it first in a paused queue. `finish_schedule_response()` is the existing Finish After Epoch control, not an evaluation scheduler.
- Recent Runs in `tool/js/training_history_ui.js` already owns a run-local **Analyze LoRA candidates** action. `tool/js/training_workspace.js` routes that click. Add **Test Epochs** as a neighboring history-row action for an available managed H3 output run; do not create another root app surface.
- `tool/js/training_candidates.js` is a read-only TensorBoard loss dialog. Its Copy to Test flow copies LoRA weights to configured external roots. It is not an inference or comparison UI and should remain separate.
- `tool/server/app.py` delegates small Flask routes to backend helpers. Its existing candidate routes accept `folder`, `jobId`, and `epoch`, not browser filesystem paths. Test Bench must retain that ownership rule.
- `training_history.host_path_for_training_path()` and `training_runner._to_wsl_path()` are the existing host/WSL conversion boundary. They may validate source LoRAs and supply a proven ComfyUI path, but Phase 0 must establish actual ComfyUI visibility.

### State ownership

`action.json` and managed action files are durable evidence. The queue and `.webcap_training/recent_runs.json` are disposable presentation/dispatch state. A Test Bench session belongs beside its selected logical run, not in queue state, a set TOML, or an external ComfyUI output folder. This preserves the ownership principles in `docs/north_star_workflow.md` and `docs/training_stabilization.md`.

## Approved design decisions

1. Phase 1 runs only when WebCap has no active managed training job. Start returns a visible conflict if one exists; the user must Pause safely or finish it. WebCap cannot detect unrelated external GPU work, so it states that limitation rather than claiming safety.
2. The backend receives an opaque managed source identity, never a browser LoRA path: current set, `actionId`, direct `output/<trainer-run>` identity, stage, and selected integer epochs.
3. Every invocation creates a new session. It may update status as work proceeds, but it never overwrites an earlier session definition or output. Retrying creates another session; success remains visible.
4. All ComfyUI HTTP and workflow behavior lives in one adapter. The runner, history, profile registry, and frontend see normalized session/result data, never node IDs or raw Comfy responses.
5. The H3 MVP workflow is one reviewed API-format JSON template with exactly four required scalar placeholders: `__WEBCAP_LORA_DIRECTORY__`, `__WEBCAP_PROMPT__`, `__WEBCAP_SEED__`, and `__WEBCAP_OUTPUT_PREFIX__`. Each must occur exactly once. This is controlled substitution, not arbitrary workflow editing.
6. Once ComfyUI reports a terminal result, WebCap copies declared media into a session-owned folder. Copying is additive; it neither alters training output nor relies on a ComfyUI output folder surviving cleanup.

## Proposed filesystem layout

For action `068-nelly--4a8d91b72c3f/002-minimax-h3--baseline` and trainer run `output/20260916_22-10-00`:

```text
FS_ROOT/output/runs/
  068-nelly--4a8d91b72c3f/
    002-minimax-h3--baseline/
      action.json
      output/20260916_22-10-00/
        epoch21/
        epoch22/
      epoch_test_bench/
        20260916-231501-8fe2c4/
          session.json
          outputs/
            epoch21/result.png
            epoch22/result.png
```

`epoch_test_bench/` is a new action-owned sibling of `captures/`, `jobs/`, and `output/`. A session ID is timestamp plus a random suffix, allocated with `mkdir`; it is not a queue job or a replacement action identity.

`session.json` is atomically replaced using the established JSON-write pattern. It records version, ID, timestamps, action/output/stage/profile source, prompt, seed, selected epochs, workflow filename/fingerprint, per-epoch status, normalized outputs, and concise failures. Epoch states are `pending`, `running`, `completed`, `partial`, `failed`, or `skipped`; terminal session states are `completed`, `completed_with_failures`, and `failed`.

```json
{
  "version": 1,
  "id": "20260916-231501-8fe2c4",
  "status": "running",
  "source": {"actionId": "...", "outputId": "output/...", "stage": "h3", "profileId": "minimax_h3"},
  "definition": {"prompt": "...", "seed": 123456, "workflow": {"name": "h3-api.json", "sha256": "sha256:..."}},
  "epochs": [21, 22],
  "results": {"21": {"status": "completed", "outputs": ["outputs/epoch21/result.png"]}}
}
```

The manifest keeps source paths as evidence only. The action/output identity is authoritative. It is not a checkpoint catalog or recovery graph.

## Proposed implementation surface

New files:

- `tool/server/epoch_test_bench.py`: managed source/epoch validation, atomic session manifests, serial worker/session manager, result copying, and normalized payload helpers. It owns Test Bench durable state, not ComfyUI.
- `tool/server/comfyui_client.py`: health check, workflow load/fingerprint, exact placeholder replacement, submit/poll/history handling, output extraction, and concise error translation.
- `tool/js/epoch_test_bench.js`: modal state, epoch selection, prompt/seed, polling, and image/video result presentation, using existing classic globals.
- `tool/templates/epoch_test_bench_h3.api.json`: one reviewed application-owned API workflow, not a user workflow editor.
- Focused backend and frontend tests.

Small local changes belong in `tool/server/app.py`, `tool/server/config.py`, `tool/config.example.json`, `tool/js/app_settings.js`, `tool/tool.html`, `tool/js/training_history_ui.js`, `tool/js/training_workspace.js`, and scoped `tool/css/styles.css` rules. Phase 1 should not modify `training_runner.py`, `training_history.py`, `training_action.py`, model profiles, or Diffusion Pipe command construction except for a truly local shared validation extraction.

## Backend contract and execution

| Route | Contract |
| --- | --- |
| `GET /fs/epoch_test_bench/source?folder=&jobId=` | Resolve a Recent Runs convenience entry server-side to a validated managed source, then list usable direct epoch exports. |
| `POST /fs/epoch_test_bench/sessions` | Start one session from `folder`, `actionId`, `outputId`, `epochs`, `prompt`, and `seed`. No client paths, workflow JSON, or generation settings. |
| `GET /fs/epoch_test_bench/sessions?folder=&actionId=&id=` | Return one manifest-derived session view. |
| `GET /fs/epoch_test_bench/media?folder=&actionId=&id=&epoch=&file=` | Stream only a regular file beneath the selected session's `outputs/epochN/` directory. |

Source validation must: resolve the folder through `safe_join_fs_root()`; resolve action through `read_action()`; require the action folder to match the current set; require an `output/<trainer-run>` two-component, non-symlink direct child; require H3 in Phase 1; and validate every selected `epochN` directory/weight file. `jobId` is only a server-side bridge to present a history-row source; later calls use durable action/output IDs and do not trust a client path.

POST validates the full definition and no-active-managed-trainer rule before creating a session directory. Validation failure creates nothing. After allocation, per-epoch failures become durable results rather than failed creation requests.

The POST returns after starting one daemon worker thread in `epoch_test_bench.py`. A module lock permits exactly one Test Bench session at a time, justified by the single GPU, without creating a generic queue. The worker runs epochs serially and atomically updates the manifest after each transition. The browser polls the session route.

On app restart, no worker is reconstructed. A manifest marked `running` with no live in-memory worker is rendered as **Interrupted by WebCap restart**; completed sibling outputs remain visible and the user starts a new session to retry. This is visible state, not hidden recovery.

## ComfyUI adapter and configuration

Phase 0 must prove the exact installed ComfyUI API. The intended narrow flow is:

1. health check `GET <endpoint>/system_stats` or its proven equivalent;
2. load and parse the reviewed API template, requiring each placeholder exactly once in a JSON string value;
3. substitute validated LoRA directory, prompt, integer seed, and output prefix, then parse again;
4. `POST <endpoint>/prompt` and require a `prompt_id`;
5. poll `GET <endpoint>/history/<prompt_id>` until terminal success, terminal failure, or configured timeout; and
6. accept only regular image/video outputs proven inside the configured Comfy output root, then copy them into the session epoch folder without overwriting a name.

`comfyui_client.py` returns normalized result data. It exposes unreachable endpoint, invalid template, missing or duplicated placeholder, submit failure, terminal Comfy error, malformed history, timeout, output path escape/missing, and copy failure; it does not fabricate success.

Add an optional, strictly validated `training.epoch_test_bench` settings object with endpoint, application-owned H3 workflow location, timeout seconds, and poll seconds. It must not contain node IDs, arbitrary workflow JSON, sampler forms, or per-profile copies of Comfy implementation detail. The precise Windows/WSL endpoint and output-root mapping remains a Phase 0 decision.

## Frontend flow

1. Recent Runs shows **Test Epochs** for an available managed H3 run.
2. A scoped modal loads the backend source and shows numerically sorted direct epoch exports, **All saved epochs**, individual selection, one prompt, and one fixed integer seed.
3. Starting explicitly creates the session. The same prompt, seed, and workflow apply unchanged to every selected epoch; only the LoRA directory varies.
4. Epoch rows show pending, running, completed, partial, or failed states with concise error text while the browser polls.
5. Completed results display in epoch order: a labeled image grid with a simple click-to-enlarge previous/next viewer, and labeled native video controls.

Defer multi-prompt matrices, seed sweeps, prompt libraries, a workflow editor, synchronized video playback, frame locking, overlays/blink, automatic scoring, and automatic epoch pruning.

## Failure and safety behavior

- An active WebCap-managed trainer blocks session start visibly. Unrelated GPU use cannot be detected and remains a stated user responsibility.
- Endpoint/workflow preflight failure creates no session. A selected LoRA that disappears later, one submit failure, timeout, or one generation failure marks only that epoch failed and continues serial siblings.
- Recoverable but incomplete copied media is `partial`, with both retained output and error evidence. No output is overwritten or silently discarded.
- Externally deleted session media remains missing; refresh reports that state instead of regenerating it. Restarted work is not automatically resubmitted.
- In future automated evaluation, if testing fails after safe Pause, the queue remains paused. WebCap must not silently resume or destructively Finish the trainer; the user explicitly chooses recovery.

## Testing strategy

Backend tests must not require a live ComfyUI server:

- `test_comfyui_client.py`: fixture API workflow; exact replacement; missing/duplicate placeholders; health, submit, polling success, terminal error, malformed history, timeout, and output extraction with mocked HTTP.
- `test_epoch_test_bench.py`: current-set/action/output/session containment; unsafe IDs; symlinks; missing/non-direct/ambiguous exports; global-step misuse; partial failure; atomic manifests; restart presentation; and no-overwrite output copy.
- Route tests: reject browser paths and unknown JSON fields; stream only session-owned regular files; make an active managed job conflict explicit.
- Frontend contract tests: Test Epochs appears only for supported available history rows; one controlled prompt/seed applies to all selected epochs; progress/error tiles and image/video routes render; opening the modal does not start a test.
- Existing initializer discovery, Copy to Test, candidate analysis, Pause, Finish After Epoch, Resume, and queue tests are regression coverage. Preserve their behavior unless a local shared helper is explicitly extracted.

One training-machine smoke test must use real H3 plus ComfyUI and two saved epochs. Confirm the same prompt/seed is used, each request loads its selected LoRA directory, media is copied below the action session, comparison renders, and a failed sibling does not remove a successful output.

## Phased implementation

### Phase 0 — technical proof

Do not build broad UI first. On the training machine, prove one H3 epoch directory, one prompt, and one seed through the known ComfyUI API workflow. Record endpoint reachability, workflow input/output contract, `prompt_id` history shape, output root, Windows/WSL path mapping, persistent Comfy process behavior, and a usable timeout. If controlled output paths and reliable terminal state cannot be established, do not begin Phase 1.

### Phase 1 — manual MVP

Implement the isolated modules, action-owned sessions, narrow routes, Recent Runs entry, serial execution, and comparison modal documented above for H3 only. It never modifies Diffusion Pipe or a training run.

### Phase 2 — richer manual evaluation

Only after Phase 1 is stable, add multiple prompts and a prompt-by-epoch matrix. Saved prompt sets, simple visual comparison conveniences, and model-specific presets require demonstrated workflow value.

### Phase 3 — automated evaluation

Reuse existing checkpoint-safe Pause and explicit Resume; do not create a second training controller. Keep save cadence, expensive evaluation/pause cadence, and coverage policy distinct. For example, H3 may save every epoch, pause every five, then test every epoch saved since the last pause before the user-approved resume. The runner invokes the Test Bench subsystem but never learns ComfyUI HTTP or nodes. Visual evidence complements Finish After Epoch; it never auto-selects or auto-terminates a run.

## Phase 1 acceptance criteria

- From an existing managed H3 trainer run with multiple direct usable `epochN/` exports, the user selects all or several epochs, one prompt, and one fixed seed.
- Each epoch runs the same controlled workflow inputs except its validated LoRA directory, serially, after training is stopped.
- WebCap records terminal status/output per epoch and compares copied image/video results by epoch without manual ComfyUI LoRA loading.
- Failed epochs stay visible and never destroy successful sibling output.
- Existing candidate analysis, Copy to Test, initializer discovery, queue, Pause/Resume, Finish After Epoch, and Diffusion Pipe behavior are unchanged.

## Concrete uncertainties before Phase 1

This development machine has no authoritative training-machine GPU, ComfyUI, or live run evidence. Phase 0 must resolve the real H3 workflow placeholders, Comfy endpoint/history schema, durable output root, host/WSL paths, timeout, and whether ComfyUI can remain resident. Also, `action.json` currently records captures/jobs but is not a per-trainer-run output catalog; Phase 1 should validate the direct selected action output path rather than expand action metadata without evidence of need.
