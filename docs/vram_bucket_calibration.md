# VRAM Bucket Calibration

Last reviewed against code: 2026-09-03

Status: **Implemented for MiniMax H3.** Persistent result reuse, Training Settings ownership, and the two-rung calibrated-default margin are active. Training-machine smoke validation remains required.

This file is the single authoritative specification for WebCap VRAM/bucket calibration. It replaces the older overlapping calibration design, H3 envelope-probe notes, and campaign-resume plan.

The implementation must follow the repository contract in `AGENTS.md`: prefer the smallest explicit change, reuse existing wiring, and fail loudly when a required environment, file, process, or invariant is broken. Calibration resumability is not a recovery subsystem.

---

## Purpose

WebCap empirically tests `(width, height, frames)` MiniMax H3 training shapes on the actual training hardware and uses the resulting known-safe ceilings to inform newly generated/reset H3 Normal and Quality video buckets.

Calibration is deliberately best-effort. It measures isolated candidate shapes; it does not attempt to mathematically prove every possible multi-bucket training combination.

The feature must remain:

- explicit and user-started;
- separate from the managed training queue/history;
- allowed to approach OOM;
- non-destructive to source media;
- non-destructive to existing dataset TOMLs and captured runs;
- persistent across calibration launches and WebCap restarts;
- resumable by skipping candidate shapes that already have conclusive compatible results.

H3 is the only calibration implementation in this pass. Do not build a generic calibration framework for hypothetical future models.

---

## Final product contract

The calibration flow has four simple layers:

1. **Fixed H3 probe plan** — the existing reviewed 90-shape manifest.
2. **Per-shape evidence** — each candidate either has a conclusive saved result or it does not.
3. **Known-safe ceilings** — once the ladders settle, derive the highest tested-safe shape for each published frame/aspect ladder.
4. **Generated bucket policy** — keep the exact known-safe ceiling selectable, but automatic H3 defaults use two 32px ladder rungs below that ceiling where possible.

There is no mixed/matrix validation phase in the target design.

There is no application-level concept of resuming an old campaign directory. Every launch may create a fresh runtime probe workspace. Persistent Settings results determine which shapes need to run.

---

## Current code anchors

Preserve the existing structure unless a localized edit is genuinely required:

- `scripts/h3_shape_probe.py`
  - fixed-plan validation;
  - candidate preparation;
  - cache/train execution;
  - telemetry and classification;
  - current mixed-validation code to be removed by this pass;
  - current atomic `config.json` publishing path.
- `scripts/h3_shape_probe_plan.json`
  - authoritative fixed 90-shape H3 plan.
- `tool/server/h3_probe.py`
  - selected-video capture;
  - detached WSL launch;
  - status/log/stop behavior;
  - currently refreshes metadata for the entire selected folder and should be narrowed to the selected source only.
- `tool/server/config.py`
  - application config validation and atomic save;
  - existing `training.h3_calibration` validation must be updated to the new schema.
- `tool/server/dataset_config.py`
  - existing consumption of `training.h3_calibration.safe_shapes`;
  - current calibrated automatic default is one candidate below the calibrated ceiling and must become two.
- existing App Settings markup/JS
  - add the compact H3 calibration controls to the Training tab.
- current media context-menu H3 calibration action
  - remove after the Settings workflow is wired.
- `tests/test_h3_probe.py`
  - retain the existing probe/config/classification coverage;
  - remove mixed-validation expectations and add persistent-result/resume coverage.

Do not rename or relocate these modules merely to match this document.

---

## Fixed H3 probe plan

The existing plan remains unchanged: 90 shapes across 12 ladders.

Every spatial dimension is divisible by 32 and each rung advances the short edge by 32 pixels.

| Frames | 16:9 | Square | 4:3 |
| ---: | --- | --- | --- |
| 34 | 736x416 -> 1344x768 (12) | 576x576 -> 768x768 (7) | 640x480 -> 1024x768 (10) |
| 68 | 512x288 -> 896x512 (8) | 384x384 -> 672x672 (10) | 416x320 -> 768x576 (9) |
| 102 | 384x224 -> 736x416 (7) | 320x320 -> 544x544 (8) | 352x256 -> 640x480 (8) |
| 17 | 1088x608 -> 1344x768 (6) | 736x736 -> 768x768 (2) | 928x704 -> 1024x768 (3) |

Rules to preserve:

- 17f and 34f stop at the useful 768p-class H3 model cap.
- 68f and 102f end with exactly one >30 MFP sentinel.
- A safe 68f/102f sentinel means `ceiling_not_found`; it does **not** mean that sentinel becomes the practical calibrated ceiling.
- When a sentinel succeeds, the highest preceding non-sentinel `completed` candidate is the known-safe ceiling for that ladder.
- Portrait bucket ceilings remain transposes of the measured landscape counterparts.
- 102f remains diagnostic/manual long-motion evidence only. It is persisted as per-shape evidence but is not published to `safe_shapes` and does not affect generated H3 defaults.

Do not change or regenerate the candidate manifest in this pass.

---

## Probe source selection

Calibration uses one real video from the currently loaded set.

### Eligibility

The selected source must have:

- readable video metadata;
- enough trainer-visible duration for the longest temporal candidate in the fixed plan;
- a saved non-empty caption, matching the current H3 probe invariant.

The current fixed plan reaches 102 frames. Derive the required duration/frame count from the shipped plan and the H3 capture FPS rather than duplicating a magic threshold in frontend code.

### Resolution and aspect ratio

Source resolution and source aspect ratio are **not calibration eligibility rules**.

Diffusion Pipe already performs its normal resize/crop path for the single configured candidate bucket. Calibration measures the resulting training allocation, not source-image quality.

Do not add:

- native-resolution thresholds;
- aspect-ratio matching;
- pixel-area ranking;
- crop-headroom calculations;
- multi-source selection;
- source-quality scoring.

### Automatic choice in Training Settings

From the currently loaded folder's already-known metadata:

1. keep eligible videos only;
2. choose the video with the greatest usable duration/frame count;
3. use filename as the deterministic tie-breaker.

Always show the proposed source before starting. Detection never launches calibration automatically.

### Backend validation

`prepare_h3_probe()` currently calls `update_media_metadata(folder_path)` for the entire folder. Replace that with the existing scoped metadata path for the selected filename only.

The selected source must still be validated on start. If metadata generation, caption resolution, capture/transcode, WSL, or another required operation fails, propagate the error loudly. Do not fall back to a whole-folder scan or another source automatically.

---

## Candidate execution

Preserve the existing H3 candidate mechanics.

For a candidate that actually needs to run:

1. Create its one-item, one-bucket probe material under the new launch's runtime workspace.
2. Run a fresh cache-only Diffusion Pipe process.
3. Run a fresh training process that trusts only the cache created for that exact candidate.
4. Run six optimizer steps.
5. Ignore the first two optimizer-step timings as compile/warm-up.
6. Measure steps three through six.
7. Capture the existing training/cache logs and telemetry.
8. Classify the result with the existing H3 classifier.
9. If the result is conclusive, persist the compact result to Settings immediately.
10. Continue or terminate that ladder using the existing single-shape ladder rules.

Each candidate must continue to use a fresh trainer process so a previous OOM or allocator state cannot contaminate the next test.

Do not add managed-training queue integration, checkpoints, schedulers, worker infrastructure, or a second process framework.

### Concurrency

Keep the existing rule that only one H3 calibration may be active at once.

Do **not** add a managed-training/GPU ownership gate as part of this pass. The current UI warning that concurrent GPU work can make results unreliable is sufficient. WebCap does not need new preflight logic to police unrelated GPU use.

---

## Measurement and classification

The existing individual-candidate safety classifier remains authoritative.

### VRAM headroom

A candidate is safe only if it completes normally and telemetry shows at least **680 MiB minimum free VRAM** on the active GPU.

This remains an exact MiB threshold, not a percentage.

### Slowdown

The first `completed` candidate in each ladder establishes that ladder's baseline median.

For later candidates:

```text
slow threshold = max(20 seconds, 2.5 x baseline median)
```

The current individual classifier marks `unsafe_slow` when the candidate's measured median reaches/exceeds that threshold.

Do **not** add the obsolete 3-of-4 slow-step requirement to individual candidate classification. `slowStepCount` may remain diagnostic output, but it is not an additional individual-shape gate.

The existing post-warm-up stall timeout remains:

```text
max(120 seconds, 20 x baseline median)
```

### Spill evidence

Continue recording the existing diagnostic telemetry:

- active GPU and VRAM usage;
- host available RAM;
- swap-free space.

VRAM-to-RAM spill remains confirmed only when slowdown coincides with either:

- at least 2 GiB decline in available host RAM; or
- at least 1 GiB decline in swap-free space.

Spill evidence is diagnostic. It does not become part of hardware compatibility.

### Conclusive candidate statuses

These current statuses are reusable calibration evidence:

- `completed`
- `oom`
- `unsafe_slow`
- `unsafe_vram`

Preserve those names. Do not introduce a new enum vocabulary merely for Settings.

`oom`, `unsafe_slow`, and `unsafe_vram` settle/terminate that ladder at that candidate. The preceding `completed` candidate, if one exists, is the known-safe ceiling.

### Non-conclusive failures

Current failure states such as:

- `cache_failed`
- `trainer_failed`
- `telemetry_failed`

are not calibration evidence.

They should remain in the runtime probe files/logs for diagnosis, but they must **not** be saved as completed candidate results in Settings.

A required environment/config/runtime failure stops the calibration launch loudly. Do not add retry prompts, repair flows, alternate execution paths, or recovery state. The next explicit Run/Continue can retry the still-missing candidate after the user fixes the real problem.

---

## Persistent calibration state

Persistent resumability belongs in the existing application config:

```text
training.h3_calibration
```

Do not create a database, calibration registry, active-calibration index, campaign catalog, or separate persistent result hierarchy.

The existing runtime probe directories remain diagnostic/runtime artifacts only.

### Target Settings shape

Use a compact structure equivalent to:

```json
{
  "training": {
    "h3_calibration": {
      "hardware": {
        "total_ram_mib": 65536,
        "gpu_model": "NVIDIA GeForce RTX 5090",
        "total_vram_mib": 32607
      },
      "results": {
        "34f/169-736x416": {
          "status": "completed",
          "median_step_seconds": 2.31,
          "minimum_gpu_free_mib": 3483,
          "peak_gpu_memory_mib": 29124
        },
        "34f/169-800x448": {
          "status": "oom"
        }
      },
      "safe_shapes": {
        "17": {
          "169": [1248, 704],
          "square": [736, 736],
          "43": [992, 736]
        },
        "34": {
          "169": [1024, 576],
          "square": [672, 672],
          "43": [800, 608]
        },
        "68": {
          "169": [736, 416],
          "square": [544, 544],
          "43": [640, 480]
        }
      }
    }
  }
}
```

The numeric examples are illustrative only. Actual values come from probe evidence.

### Stable candidate key

Reuse the runner's existing deterministic candidate identity:

```text
<frames>f/<aspect>-<width>x<height>
```

Examples:

```text
34f/169-736x416
68f/square-512x512
102f/43-416x320
```

Do not create a second candidate-ID format, UUID, campaign-qualified ID, timestamped ID, or policy-version ID.

The fixed plan already supplies the candidate identity when iterating, so persistent code does not need elaborate reverse parsing.

### What to store per result

Settings stores the classification and only the small measurements useful for resume/inspection.

For every `completed` candidate, `median_step_seconds` is required because a reused first completed rung must reconstruct the same ladder slowdown baseline for later candidates.

Persist the existing useful summary values when available, such as:

- `status`
- `median_step_seconds`
- `minimum_gpu_free_mib`
- `peak_gpu_memory_mib`
- optional spill flag for an `unsafe_slow` result

Do not copy into Settings:

- full measured-step arrays;
- one-second telemetry samples;
- commands;
- logs;
- source paths;
- attempt history;
- previous errors;
- campaign IDs.

Full evidence remains under the runtime probe workspace.

### Invalid persistent state

Missing candidate result means **not tested / run it**.

Malformed or impossible persisted calibration state is not a retryable calibration state. It is a config/invariant failure and must fail loudly through the existing config validation path.

Do not silently discard malformed entries, reinterpret them as missing, migrate them, or repair them.

This pass is allowed to make the calibration schema a clean break from the old `version/campaign/safe_shapes`-only block. Do not add legacy schema migration. Before using the new implementation on a machine that still contains the old calibration block, manually Reset/remove that block.

---

## Hardware compatibility

Calibration compatibility is intentionally coarse.

Persist exactly:

- total RAM visible to the training environment;
- GPU model/name used by the H3 probe;
- total VRAM for that GPU.

Do not include:

- CPU model;
- free RAM;
- free VRAM;
- swap availability;
- GPU UUID;
- driver version;
- CUDA version;
- PyTorch version;
- Diffusion Pipe revision;
- WebCap revision;
- model path/hash;
- optimizer/version;
- compile settings;
- checkpointing mode;
- source video;
- calibration-policy version;
- config hash.

The trainer or calibration implementation may change while old measurements remain practically useful. Reset is the deliberate invalidation mechanism.

### Normalization

Use simple readable values:

- `total_ram_mib`: positive integer MiB;
- `gpu_model`: non-empty trimmed string;
- `total_vram_mib`: positive integer MiB.

Do not hash the compatibility record.

### Compatibility behavior

When Run/Continue begins:

- no existing calibration block: record current hardware and start normally;
- existing results with matching hardware: reuse them;
- existing calibration with different hardware: fail loudly and require explicit Reset before running a calibration on the new hardware.

A mismatch never silently deletes old evidence.

When calibrated `safe_shapes` are used for H3 generation, they are valid only for matching current calibration hardware. Do not silently apply calibrated ceilings on a hardware mismatch. If the required hardware identity cannot be read or does not match, fail visibly rather than pretending the old calibration is valid.

Do not add multiple hardware profiles in this pass.

---

## Resume semantics

Resume is deliberately result-based.

There is no need to reopen or make an old campaign directory writable.

Each launch creates the normal fresh H3 runtime workspace. The runner loads compatible persistent Settings results first and walks the fixed plan in deterministic order.

For each ladder:

1. Start with no baseline and no known-safe candidate.
2. For each candidate in plan order, construct its existing stable candidate key.
3. If a conclusive saved result exists:
   - log it as reused;
   - if `completed`, update the ladder's known-safe shape and establish the baseline from its saved median if this is the first completed rung;
   - if `oom`, `unsafe_slow`, or `unsafe_vram`, settle the ladder immediately and do not run higher candidates;
   - if the final candidate is a safe model cap, settle as `model_cap`;
   - if the final candidate is a safe sentinel, settle as `ceiling_not_found` using the highest preceding non-sentinel completed shape as the known-safe ceiling.
4. If no saved result exists, run the candidate normally.
5. Persist a newly conclusive result immediately.
6. Stop the entire launch on a non-conclusive environment/trainer/telemetry failure.

A concise reuse log line is sufficient, for example:

```text
[h3-probe] 34f 169 736x416 reuse completed
```

Do not rebuild or merge old `summary.csv` files. Each runtime launch keeps its own logs/evidence. Settings is the cross-launch authority.

Do not preserve attempt history for a candidate. If it has no conclusive Settings result, the next launch simply runs it again.

---

## Removing mixed Quality validation

Delete the current mixed/matrix validation phase from the H3 calibration flow.

Specifically remove the calibration dependency on:

- `MIXED_*` constants;
- mixed dataset construction;
- mixed attempt preparation/execution;
- mixed candidate cache reuse;
- mixed slow-step policy;
- mixed retry/backoff selection;
- mixed validation results in campaign summaries;
- the requirement that mixed validation pass before Settings publication.

Do not replace it with another combined-shape test.

Rationale: the calibration is already best-effort, and isolated shape evidence is much easier to persist, resume, inspect, and reason about when creating buckets. The safety margin belongs in the generated-default policy rather than in a second calibration experiment.

The fixed single-shape probe remains the sole calibration evidence.

---

## Deriving known-safe ceilings

After all 12 ladders have settled from the combined reused/new evidence, derive the calibration summary.

### Model-cap ladders: 17f and 34f

- If a decisive unsafe result ends the ladder, use the highest preceding `completed` candidate as the known-safe ceiling.
- If the final model-cap candidate completes, use that final candidate as the known-safe ceiling.

### Sentinel ladders: 68f and 102f

- If a decisive unsafe result ends the ladder before the sentinel, use the highest preceding `completed` candidate.
- If the sentinel itself completes, record `ceiling_not_found` diagnostically but use the highest **non-sentinel** completed candidate as the known-safe ceiling.
- Never publish the >30 MFP sentinel itself as the practical ceiling merely because it completed.

### Required publishable evidence

`safe_shapes` contains only 17f, 34f, and 68f landscape/square evidence.

For each of those nine published ladders, calibration must have at least one known-safe `completed` candidate. If a published ladder terminates before any candidate completes safely, fail calibration publication loudly; do not invent or fall back to an untested calibrated ceiling.

102f may settle without a known-safe rung and still remain diagnostic-only.

### Publishing

Once the fixed ladders are settled and the nine published 17f/34f/68f ladders have valid known-safe ceilings, atomically publish:

- current compatible hardware;
- accumulated conclusive per-shape results;
- derived `safe_shapes` for 17f, 34f, and 68f.

The current runner already has an atomic `config.json` publishing path. Extend that existing path; do not add a server-side import/reconciliation layer.

Per-shape conclusive results must be written to Settings as they finish so Stop/crash loses at most the currently non-conclusive candidate.

The server can reload runtime config when the detached calibration process ends as it does today.

---

## Automatic bucket safety margin

The exact calibrated `safe_shapes` remain the **highest tested-safe ceilings**.

Do not reduce the persisted evidence itself merely to create a conservative default.

For newly generated/reset H3 Normal and Quality video buckets:

- the exact calibrated ceiling remains selectable;
- the automatic/default ceiling should be **two 32px candidate rungs below the calibrated ceiling** where at least two lower candidates exist;
- if fewer than two lower candidates exist in the existing generated candidate ladder, use the lowest available candidate rather than inventing another resolution;
- no compatible calibration continues to use the existing conservative baseline behavior;
- POC remains unchanged.

This replaces the current calibrated behavior in `dataset_config.py` that uses one lower candidate (`candidates[1:]`).

The two-rung margin is deliberate compensation for removing mixed/matrix validation. It is simple, visible, and easy to reason about.

Do not infer untested cross-aspect safety by MFP. Portrait remains a transpose of the measured landscape counterpart, matching the existing H3 policy.

---

## Reset and expert retest

### Reset calibration

Training Settings must expose one explicit **Reset calibration** action.

Reset removes the entire `training.h3_calibration` block using the existing Settings/config save path.

After Reset:

- generated H3 buckets use the existing uncalibrated conservative policy;
- the next calibration records the current hardware and starts with no saved candidate evidence.

Reset does not delete:

- old H3 probe runtime directories;
- logs;
- telemetry;
- existing dataset TOMLs;
- captured runs;
- queue/history data.

Do not create a new H3 reset backend API if deleting the block through the existing config save path is sufficient.

### Individual retest

No per-candidate Retest UI or CRUD API is required in this pass.

The raw Settings JSON remains available for expert use. A user may manually remove a specific candidate result to make the next Run/Continue execute it again.

Because `safe_shapes` is derived output, an expert manually invalidating candidate evidence must also remove `safe_shapes` before relying on new generated defaults. Do not add automatic inference, edit tracking, or repair logic around arbitrary raw-JSON edits.

---

## Training Settings UI

Move the user-facing calibration workflow into the existing Training tab of App Settings.

Once this replacement works, remove the H3 calibration action from the media context/preview menu.

Keep the Settings block compact.

### Minimum UI

Show:

- **H3 calibration** heading;
- saved hardware identity when calibration exists;
- current hardware identity/compatibility status;
- current calibration runtime state;
- current candidate while running if available cheaply from existing status/log state;
- saved result count / useful progress summary;
- proposed/selected source video;
- `Run calibration` when there is no reusable evidence;
- `Continue calibration` when compatible reusable evidence exists but ladders remain unsettled;
- `Stop` while the current H3 process is active;
- `Reset calibration` when idle and calibration state exists;
- a way to expose the existing console panel/log output.

Do not build a second calibration log viewer.

### Progress wording

Do not represent completion as `results / 90`, because a correctly settled ladder may intentionally leave all larger candidates untested after the first decisive unsafe result.

Prefer a small summary such as:

- tested candidate count; and/or
- settled ladders out of 12.

A calibration is finished when every ladder is settled according to the plan rules and publishable 17f/34f/68f ceilings can be derived.

### Completed state

When calibration is complete and compatible `safe_shapes` exist, show it as calibrated with Reset available. Do not add a separate `Run Fresh` concept.

Fresh calibration is:

```text
Reset calibration -> Run calibration
```

---

## Existing H3 server routes

Keep the current route family:

- `POST /fs/h3_probe/prepare`
- `POST /fs/h3_probe/start`
- `GET /fs/h3_probe/status`
- `GET /fs/h3_probe/log`
- `POST /fs/h3_probe/stop`

Do not create a generic `/training_calibration/*` API in this pass.

### Start

`POST /fs/h3_probe/start` continues to accept the explicit selected source:

```json
{
  "folder": "...",
  "fileName": "..."
}
```

Start semantics become simply:

> create a fresh runtime workspace, load compatible Settings results, skip settled evidence, and run what remains.

Do not accept an old `probeId` to resume.

### Status

Extend the existing status payload only as needed for the compact Settings UI. Useful additions include:

- current/saved hardware values;
- compatibility;
- number of saved conclusive candidates;
- settled ladder count;
- whether `safe_shapes` are published/complete.

Do not make status responsible for repairing state or recovering old campaigns.

### Stop

Preserve the current detached-process stop mechanism unless a real training-machine smoke test proves it broken.

A user Stop should terminate the current probe/trainer process group and preserve any conclusive candidate results already written to Settings.

No special campaign-resume state is required afterward. The next Start creates a new runtime workspace and resumes from Settings evidence.

### Vanished/failed process

Keep the current fail-loud behavior. A runtime whose process disappeared may end as failed/canceled according to the existing runtime files. Do not add `interrupted` recovery semantics merely to make it resumable; persistent candidate results already provide the only resume behavior needed.

---

## Runtime probe files

Continue creating the existing runtime layout under:

```text
<filesystem.root>/.webcap_training/h3-probes/
```

A launch may continue to contain:

```text
h3-<runtime-id>/
  source/
  base/
  plan.json
  seed.json
  work/
  results/
    <frames>f/<shape>/
      config.toml
      dataset.toml
      request.json
      cache.log
      cache_telemetry.csv
      train.log
      telemetry.csv
      result.json
    summary.csv
    campaign_result.json
  run.log
  runtime.json
```

These artifacts are useful for diagnosis and sharing evidence.

They are **not** the persistent resume authority.

Do not:

- reopen old runtime workspaces;
- merge summaries across launches;
- scan historical probe directories for reusable results;
- move old probe artifacts;
- add cleanup/retention machinery in this pass.

The separate proposed folder/run layout work is unrelated and must not be implemented here.

---

## Generated H3 bucket integration

Preserve the current H3 bucket architecture.

`training.h3_calibration.safe_shapes` remains the calibrated ceiling input consumed by `dataset_config.py`.

Rules:

- compatible calibrated ceiling -> exact known-safe ceiling is selectable;
- automatic calibrated default -> two candidate rungs below the ceiling where possible;
- no calibration -> existing conservative H3 defaults;
- source coverage/upscale selection continues to operate as it does today below the effective ceiling;
- POC remains unchanged;
- 102f does not participate in generated Normal/Quality roles;
- existing dataset TOMLs are never rewritten automatically;
- existing captured runs are never reevaluated;
- WAN, Krea2, images, repeat weighting, and normal training Resume remain unchanged.

Keep the existing generated log indication that a ceiling came from calibration. The old campaign ID no longer needs to be part of that message because persistent calibration is hardware/result-based rather than campaign-based.

---

## Failure philosophy

This feature must match WebCap's normal fail-loud behavior.

Do not add special recovery for:

- missing WSL;
- broken/missing Diffusion Pipe environment;
- missing required model/config files;
- invalid persisted config;
- unavailable `nvidia-smi`/required hardware telemetry;
- broken capture/transcode;
- unexpected trainer failure;
- unreadable required source metadata;
- missing saved caption;
- malformed probe plan.

Expose the actual error through the existing server/UI/console paths and stop the requested operation.

Resumability means only:

> conclusive candidate results that were already saved do not need to run again.

It does not mean WebCap should repair or recover the environment that caused a later candidate to fail.

---

## Implementation order

Keep the change reviewable and localized.

### 1. Replace the persistent calibration schema

Update `tool/server/config.py` so `training.h3_calibration` validates the new structure:

- `hardware` with exactly the three compatibility fields;
- `results` keyed by the existing deterministic candidate name;
- optional `safe_shapes` using the existing 17/34/68 shape structure.

Validate strictly and loudly.

Remove the obsolete required `campaign` field and old campaign-centric calibration assumptions.

Do not implement schema migration.

### 2. Persist and reuse conclusive candidate results

Update `scripts/h3_shape_probe.py`:

- read the persistent calibration block through the existing `--publish-config` path;
- measure/validate current hardware before using existing results;
- walk the current fixed plan;
- reuse conclusive matching candidate results;
- reconstruct each ladder baseline from the first reused/new `completed` median;
- skip higher candidates after a reused decisive unsafe result;
- persist each newly conclusive result to `config.json` immediately;
- stop loudly on non-conclusive probe/runtime failure.

Do not make candidate directories idempotent. Each launch already has a fresh workspace, so existing `exist_ok=False` behavior can remain.

### 3. Remove mixed validation

Delete the mixed-validation execution/publishing path and its tests.

Derive known-safe ceilings directly from the fixed ladder results.

A safe sentinel settles as `ceiling_not_found` without making the overall calibration fail solely because the true hardware ceiling was not reached.

### 4. Publish simple `safe_shapes`

When the ladders settle and the nine published 17f/34f/68f ladders have a known-safe candidate:

- derive exact known-safe ceilings;
- atomically update `training.h3_calibration.safe_shapes`;
- keep 102f out of `safe_shapes`.

### 5. Change calibrated automatic margin to two rungs

In `tool/server/dataset_config.py`, preserve calibrated selectable candidates up to the exact ceiling but change the automatic calibrated default from one lower candidate to two lower candidates where possible.

Do not change uncalibrated, POC, WAN, Krea2, or image behavior.

### 6. Narrow source metadata work

In `tool/server/h3_probe.py`:

- validate/generate metadata only for the selected calibration source;
- enforce sufficient duration for the fixed plan;
- keep the current saved-caption requirement;
- do not add resolution/aspect scoring.

### 7. Move controls into Training Settings

Add the compact H3 calibration block using existing Settings/config/status/log wiring.

Remove the old media-context calibration action only after the Settings controls work.

### 8. Smoke test on the training machine

The development machine cannot establish real GPU behavior.

On the actual training machine:

1. Reset calibration.
2. Start calibration and allow several candidates to complete.
3. Stop during a later candidate.
4. Confirm completed candidate results are already in `config.json`.
5. Start again.
6. Confirm saved results are logged as reused and the interrupted candidate runs again.
7. Allow one ladder to terminate on a decisive unsafe result and confirm higher shapes are skipped on later launches.
8. Confirm a safe sentinel uses the highest non-sentinel safe rung rather than the sentinel itself.
9. Complete the full plan and confirm 17/34/68 `safe_shapes` publish without mixed validation.
10. Generate/reset an H3 Normal or Quality dataset and confirm the exact calibrated ceiling is selectable while the automatic default is two rungs below it.

---

## Tests

### Fixed probe regression

Keep existing tests proving:

- the plan is exactly the reviewed 90-shape plan;
- candidate cache/media namespaces remain isolated;
- cache-only then trust-cache training behavior remains unchanged;
- probe config rewrites only probe-owned values;
- 680 MiB headroom behavior remains unchanged;
- OOM/cache/trainer/telemetry classification remains unchanged;
- individual slowdown uses the current median threshold behavior.

### Persistent calibration validation

Add tests that prove:

- hardware requires exactly valid total RAM, GPU model, and total VRAM fields;
- result keys correspond to candidates from the fixed plan;
- only the conclusive status names are accepted in persistent results;
- `completed` requires a valid positive saved median;
- malformed persistent result state fails loudly;
- old campaign-only calibration schema is not silently migrated;
- valid `safe_shapes` retain the existing H3 envelope validation.

### Resume

Add tests that prove:

- a saved `completed` candidate is not executed again;
- the first saved completed rung reconstructs the ladder baseline;
- a saved OOM terminates only its ladder;
- a saved `unsafe_slow` terminates only its ladder;
- a saved `unsafe_vram` terminates only its ladder;
- a missing candidate runs normally;
- a runtime-only `trainer_failed`, `cache_failed`, or `telemetry_failed` result is not persisted as reusable Settings evidence;
- after a non-conclusive failure, earlier saved conclusive results remain reusable on the next fresh launch;
- a safe model-cap final candidate settles the ladder;
- a safe sentinel settles as `ceiling_not_found` and chooses the preceding non-sentinel safe candidate.

### Publishing

Add tests that prove:

- 17/34/68 known-safe ceilings publish directly without mixed validation;
- 102 results never enter `safe_shapes`;
- no published ladder can publish without at least one completed safe candidate;
- per-candidate Settings writes preserve unrelated config fields;
- final `safe_shapes` publishing preserves accumulated candidate results and hardware identity.

### Hardware compatibility

Add tests that prove:

- equal total RAM + GPU model + total VRAM reuses results;
- any one of those three changing prevents reuse;
- software/trainer/config/version changes are not compatibility fields;
- hardware mismatch does not delete old calibration state;
- calibrated H3 generation does not silently use incompatible `safe_shapes`.

### Source selection/preparation

Add tests that prove:

- source resolution does not affect eligibility;
- source aspect ratio does not affect eligibility;
- insufficient duration fails visibly;
- missing saved caption fails visibly;
- selected-file metadata uses the scoped metadata path rather than a full-folder refresh;
- the frontend deterministic proposal picks the longest eligible clip.

### Bucket generation

Add tests that prove:

- exact calibrated ceiling remains selectable;
- automatic calibrated default is two candidate rungs below the ceiling where possible;
- small ladders clamp to the lowest available candidate rather than inventing a resolution;
- no calibration retains current conservative defaults;
- POC remains unchanged;
- WAN/Krea2/image behavior is unchanged;
- existing dataset TOMLs and captured runs are untouched.

### UI/server

Add/update tests that prove:

- Training Settings exposes Run/Continue/Stop/Reset according to current H3 state;
- Run/Continue always starts a fresh runtime workspace and never accepts an old campaign ID;
- only one H3 calibration can be active;
- status exposes only the small additional data the Settings block needs;
- Reset removes the calibration block through normal Settings persistence;
- the existing console/log path is reused;
- the old media-context action is removed after replacement.

---

## Non-goals

This pass does **not** include:

- calibration for another model;
- image calibration;
- mixed/matrix validation replacement;
- a generic calibration plugin/framework;
- calibration campaign resume;
- reopening old probe workspaces;
- attempt history;
- trainer checkpoints for probe candidates;
- managed training queue/history integration;
- managed-training GPU gating;
- automatic environment repair/recovery;
- trainer/config/software-version fingerprinting;
- CPU fingerprinting;
- multiple saved hardware profiles;
- automatic calibration reset;
- source-resolution/aspect scoring;
- multi-source probe composition;
- per-candidate Retest UI;
- arbitrary source paths or shell commands;
- historical probe-directory scanning;
- folder/run layout restructuring;
- automatic deletion of old probe artifacts;
- Diffusion Pipe changes;
- rewriting existing dataset TOMLs;
- reevaluating captured or resumed training runs;
- unrelated bucketing/model-policy refactors.

---

## Acceptance criteria

The pass is complete when:

1. A stopped/crashed H3 calibration can be started again and all compatible conclusive candidate results already saved in Settings are skipped.
2. The current candidate is rerun after interruption if it never produced conclusive persistent evidence.
3. Hardware compatibility consists only of total RAM, GPU model, and total VRAM.
4. Environment/config/trainer failures remain loud failures rather than entering a recovery workflow.
5. The single-shape H3 classifier and fixed 90-shape plan remain unchanged.
6. Mixed Quality validation is removed and is not replaced by another matrix experiment.
7. Safe 68f/102f sentinels settle as `ceiling_not_found`, using the preceding non-sentinel safe shape as the practical known-safe ceiling.
8. Exact 17f/34f/68f known-safe ceilings publish to `training.h3_calibration.safe_shapes`.
9. Exact calibrated ceilings remain selectable while automatic calibrated defaults use two lower 32px rungs where possible.
10. Calibration source selection depends on sufficient duration and saved caption, not source resolution/aspect.
11. Training Settings owns Run/Continue/Stop/Reset and reuses the existing console surface.
12. No old-campaign resume, generalized calibration architecture, recovery subsystem, or folder restructure is introduced.
13. Normal training, queue/history, checkpoint Resume, existing TOMLs/runs, WAN, Krea2, image bucketing, and repeat weighting remain unaffected.

---

## Codex execution instruction

Treat this document and `AGENTS.md` as the authoritative implementation contract.

Inspect the current H3 probe, server orchestration, config validator, Settings UI, tests, and H3 bucket-generation code before editing.

Implement the smallest coherent change set that satisfies this document.

Prefer localized edits to the existing files/functions over new abstractions.

Do not redesign the feature for future models.

Do not add guards, fallbacks, recovery paths, migration logic, or environment handling beyond what is explicitly required here.

Do not restore mixed validation in another form.

Do not perform the separate folder/run restructure.

If the current repository contradicts this document in a way that requires a materially broader design, stop and report the exact conflict instead of inventing infrastructure.
