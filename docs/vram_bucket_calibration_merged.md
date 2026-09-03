# VRAM Bucket Calibration

## Status and authority

**Status:** Implemented for MiniMax H3; this document defines the next implementation pass for persistent, resumable calibration and the Training Settings workflow.

This file is the single authoritative specification for WebCap VRAM/bucket calibration. It replaces the overlapping design and implementation guidance previously split across:

- `docs/vram_bucket_calibration.md`
- `docs/h3_envelope_probe.md`
- `docs/h3_calibration_resume_settings_plan.md`

For the current pass, preserve the existing H3 probe plan, training mechanics, safety thresholds, mixed-validation behavior, and generated-bucket behavior unless this document explicitly changes them.

The implementation should remain deliberately small. Do not add lifecycle machinery, generalized calibration infrastructure, storage systems, compatibility rules, or source-selection logic that are not required by the behavior below.

---

## 1. Purpose

WebCap empirically measures which `(width, height, frames)` training shapes are practical on the user's actual training hardware and can use the resulting safe shapes as the effective H3 video ceilings for newly generated/reset datasets.

Calibration is:

- explicit advanced training functionality;
- deliberately GPU-intensive and allowed to approach OOM;
- separate from the normal training queue/history;
- non-destructive to source media;
- non-destructive to existing dataset TOMLs and captured runs;
- persistent across WebCap restarts and calibration restarts;
- resumable by skipping candidate shapes that already have conclusive saved results.

The current implementation target is MiniMax H3. The persistence and resume representation should not unnecessarily assume H3, but this pass must **not** build a generic all-model calibration framework.

---

## 2. Core design decisions

These decisions are intentional and should not be expanded during implementation.

### 2.1 Persistent calibration state lives in Settings

Calibration summary results belong in the normal WebCap Settings JSON.

Longer JSON is acceptable. Do not introduce a database, calibration index, result registry, or separate persistent state hierarchy merely to keep Settings short.

Existing per-probe files and directories remain useful for logs, telemetry, captured media, and diagnostics, but Settings is the persistent application-level record used to decide whether a candidate is already done.

### 2.2 Resumability is result-based, not campaign-based

A calibration launch is not an immutable evidence campaign that must be resumed by ID.

Instead:

1. Build the current H3 candidate plan.
2. Load compatible saved candidate results from Settings.
3. Reconstruct each ladder in deterministic order.
4. Skip candidates that already have conclusive results.
5. Run only candidates whose conclusive result is absent.
6. Save each newly conclusive result as soon as practical.
7. Re-run the currently active candidate after interruption if it never produced a conclusive saved result.

There is no need for checkpoint files, attempt history, resumable job records, or a complex campaign state machine.

A runtime probe directory may still be created for each launch because the existing probe needs captured source/config, work files, logs, telemetry, and trainer outputs. That runtime directory is diagnostic/runtime material, not the identity of the persistent calibration.

### 2.3 Hardware compatibility is intentionally coarse

Persist this compatibility record:

- total system RAM;
- GPU model/name;
- total GPU VRAM.

That is the complete compatibility fingerprint for this pass.

Do **not** invalidate calibration because of:

- driver version;
- CUDA version;
- PyTorch version;
- Diffusion Pipe revision;
- WebCap version;
- calibration-policy version;
- probe-script version;
- compiler mode/version;
- config hash;
- source clip;
- free RAM;
- free VRAM;
- swap availability;
- learning rate;
- epochs;
- CPU model.

These values may still be recorded in runtime diagnostics where already useful, but they are not part of calibration compatibility.

The reason is deliberate: calibration should not become stale merely because software or incidental machine state changed while the underlying hardware capacity remained materially the same.

### 2.4 Reset is the escape hatch

If the user wants fresh evidence, they explicitly reset it.

A hardware mismatch must never silently delete existing results.

The Settings UI must provide:

- **Reset calibration** — clear persistent calibration evidence for the current profile and return generated buckets to the normal conservative defaults until a new calibration is successfully published.
- **Retest** for an individual candidate, if it can be added without substantial UI complexity — clear that candidate's saved conclusive result so the next Run/Continue executes it again.

Reset/retest replaces elaborate automatic invalidation/versioning rules.

### 2.5 Source resolution is not a calibration requirement

Diffusion Pipe already performs its normal resize/crop path for the configured candidate bucket.

Therefore calibration source selection must not add aspect-ratio matching, native-resolution thresholds, pixel-area ranking, crop-headroom calculations, or multi-video optimization.

The source needs only to satisfy the current probe's real preparation requirements, principally:

- readable video metadata;
- enough usable duration for the longest temporal candidate in the current plan;
- the caption/input invariant already required by the current H3 probe.

Choose a suitable source using metadata WebCap already has. Do not scan or decode an entire folder merely to choose a calibration source.

---

## 3. Current H3 calibration contract

The H3 calibration is a fixed practical-ceiling experiment.

It measures the existing 17-, 34-, 68-, and 102-frame ladders. It does not alter the candidate manifest, generated bucket roles, training queue, normal Resume behavior, or existing dataset TOMLs.

### 3.1 Candidate plan

The existing H3 plan contains 90 shapes.

Every spatial dimension is divisible by 32 and each rung advances the short edge by 32 pixels.

| Frames | 16:9 | Square | 4:3 |
| ---: | --- | --- | --- |
| 34 | 736x416 -> 1344x768 (12) | 576x576 -> 768x768 (7) | 640x480 -> 1024x768 (10) |
| 68 | 512x288 -> 896x512 (8) | 384x384 -> 672x672 (10) | 416x320 -> 768x576 (9) |
| 102 | 384x224 -> 736x416 (7) | 320x320 -> 544x544 (8) | 352x256 -> 640x480 (8) |
| 17 | 1088x608 -> 1344x768 (6) | 736x736 -> 768x768 (2) | 928x704 -> 1024x768 (3) |

Rules already implemented and to be preserved:

- 17f and 34f stop at the useful 768p-class H3 spatial cap.
- 68f and 102f end with exactly one >30 MFP sentinel.
- A safe 68f/102f sentinel means `ceiling_not_found`; it is not treated as a discovered ceiling.
- Portrait bucket ceilings remain transposes of the measured landscape counterparts.
- 102f is measured for manual long-motion analysis but is not published to `safe_shapes` and is not part of mixed validation.

Do not redesign or regenerate this manifest in this pass.

### 3.2 Stable candidate identity

Each candidate needs a stable identifier derived only from its intrinsic profile/shape identity, not from campaign IDs, source files, software versions, or timestamps.

Within the H3 profile namespace, use a canonical form equivalent to:

```text
34f|16:9|736x416
68f|square|512x512
102f|4:3|416x320
```

Exact delimiter/serialization may follow existing code conventions, but it must be deterministic and reversible from:

- frames;
- aspect;
- width;
- height.

Do not include a policy version in the candidate ID.

---

## 4. Probe execution mechanics

Preserve the existing H3 probe mechanics.

For each candidate:

1. Verify calibration may own the GPU and no conflicting managed training process is active.
2. Prepare the one-item, one-bucket probe bundle.
3. Use a candidate-specific media/cache namespace.
4. Run a fresh cache-only Diffusion Pipe process.
5. Run a fresh training process that reuses only that candidate's newly created cache.
6. Run six optimizer steps.
7. Ignore the first two optimizer steps as compile/warm-up.
8. Measure the following four optimizer steps.
9. Capture the existing logs and telemetry.
10. Classify the candidate using the existing H3 classifier.
11. Persist a conclusive result.
12. Continue or terminate that ladder according to the existing classification policy.
13. Wait for process/GPU recovery before starting the next candidate.

A fresh trainer process per candidate remains important so allocator fragmentation or a previous OOM does not contaminate the next result.

Do not fold calibration into normal training jobs or queue history.

---

## 5. H3 measurement and classification

The current safety behavior is part of the feature contract and must remain unchanged in this pass.

### 5.1 VRAM headroom

A candidate is safe only if it completes normally and every active-GPU telemetry sample leaves at least **680 MiB free VRAM**.

This is an exact MiB safety buffer, not a percentage.

If the current implementation represents failure of this rule with `unsafe_vram`, preserve that classification name. Do not rename result enums merely to make the persisted schema prettier.

### 5.2 Baseline and slowdown

The first completed rung in each ladder establishes the ladder baseline.

For later candidates:

```text
slow threshold = max(20 seconds, 2.5 x baseline)
```

`unsafe_slow` requires:

- measured median at or above the threshold; and
- at least three of the four measured steps at or above the threshold.

The post-warm-up stall timeout remains:

```text
max(120 seconds, 20 x baseline)
```

### 5.3 Spill evidence

Existing runtime telemetry may continue to record:

- every GPU reported by `nvidia-smi`;
- active GPU selection;
- host available RAM;
- swap-free space.

VRAM-to-RAM spill is confirmed only when the slowdown coincides with either:

- at least 2 GiB decline in available host RAM; or
- at least 1 GiB decline in swap-free space.

This telemetry is diagnostic/classification evidence only. Available RAM and swap are **not** compatibility fingerprint fields.

### 5.4 Terminal ladder behavior

Preserve current H3 ladder behavior:

- first OOM terminates that ladder;
- first unsafe slowdown terminates that ladder;
- current unsafe-VRAM/headroom behavior remains as implemented;
- unrelated trainer/config/media failure must not be converted into an unsafe-shape result;
- a failed/inconclusive/interrupted candidate has no reusable conclusive result and is eligible to run again later;
- safe 17f/34f final model-cap candidates terminate their ladders normally;
- safe 68f/102f sentinel candidates produce `ceiling_not_found`.

Do not persist inferred results for candidates that were merely pruned because a lower rung terminated the ladder.

---

## 6. Conclusive versus retryable results

Resumability depends on whether a candidate has reusable conclusive evidence.

### 6.1 Conclusive

Reuse existing classifications that definitively answer the candidate question, including the current equivalents of:

- safe/completed;
- OOM/unsafe OOM;
- unsafe slowdown;
- unsafe VRAM/headroom.

Use the classifier's existing names. Do not perform an enum migration as part of this pass.

### 6.2 Retryable

Do not treat the following as completed calibration evidence:

- canceled;
- interrupted;
- malformed/incomplete result;
- inconclusive;
- unrelated trainer/config/media failure;
- process disappearance before conclusive classification.

These states may remain visible in runtime logs, but they do not need durable lifecycle records in Settings.

If there is no conclusive Settings result for the candidate, it is eligible to run on the next calibration launch.

---

## 7. Persistent Settings schema

Use the existing Settings JSON and existing H3 calibration location where practical.

A target representation equivalent to the following is expected:

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
        "34f|16:9|736x416": {
          "frames": 34,
          "aspect": "16:9",
          "width": 736,
          "height": 416,
          "status": "safe",
          "peak_vram_mib": 29124,
          "minimum_free_vram_mib": 3483,
          "measured_step_seconds": [7.8, 7.9, 7.8, 8.0],
          "median_step_seconds": 7.85
        },
        "34f|16:9|768x448": {
          "frames": 34,
          "aspect": "16:9",
          "width": 768,
          "height": 448,
          "status": "unsafe_oom"
        }
      },
      "mixed_validation": {
        "selected_shapes": [],
        "status": "passed"
      },
      "safe_shapes": []
    }
  }
}
```

The exact existing property names should be preserved where they already exist. Do not create a parallel second calibration settings subtree merely to match this example.

### 7.1 Store summaries, not full telemetry

Settings should contain enough per-candidate information to:

- determine that the candidate is conclusive;
- reconstruct ladder state;
- show useful result information in Settings;
- republish the derived calibration if needed.

Do not copy full logs or one-second telemetry streams into Settings.

Those remain in the probe runtime directories.

### 7.2 No attempt history

Keep only the current saved conclusive result for each candidate ID.

Do not retain:

- attempt arrays;
- previous errors;
- previous source clips;
- campaign IDs;
- result-version history.

Retesting a candidate deletes/replaces its current conclusive result.

### 7.3 Atomic writes

Use WebCap's existing atomic Settings write path.

Do not add a second generic persistence system.

If the detached H3 runner cannot safely call the existing Settings writer directly, retain the existing per-candidate `result.json` as write-ahead evidence and have the smallest existing server-side reconciliation point import a newly conclusive result into Settings.

In that case:

- import only from the active/current probe runtime directory;
- do not scan arbitrary historical probe directories;
- do not add a filesystem watcher, message bus, database, or generic event system;
- reconcile before scheduling work on a later Run/Continue so a conclusive result already written by the runner is not unnecessarily repeated.

Codex should inspect the current process boundary and choose the smallest of these two mechanisms.

---

## 8. Hardware compatibility behavior

Before Run/Continue:

1. Read the current hardware values.
2. Compare them with the saved calibration hardware record.
3. If no calibration hardware record exists, initialize it when calibration begins.
4. If all three values match, existing candidate results are reusable.
5. If any value differs, do not reuse results automatically.

A mismatch must:

- preserve existing saved evidence;
- show the saved and current hardware values;
- block Continue using those results;
- offer **Reset calibration**.

Do not automatically create multiple hardware profiles in this pass.

The user can Reset to establish calibration for the current hardware.

### 8.1 Normalization

Normalize only enough to avoid meaningless formatting differences:

- RAM: integer total MiB;
- VRAM: integer total MiB from the same existing GPU-discovery mechanism used by the probe;
- GPU model: stable trimmed model/name string.

Do not hash the fields merely to hide them. Keep the readable values in Settings. A derived key is unnecessary unless existing code benefits from one.

---

## 9. Resume algorithm

The resume algorithm should remain straightforward.

Pseudocode:

```python
plan = load_existing_h3_probe_plan()
saved = load_compatible_calibration_results()

for ladder in plan.in_deterministic_order():
    state = reconstruct_ladder_from(saved, ladder)

    if state.already_terminal:
        continue

    for candidate in state.remaining_candidates:
        prior = saved.get(candidate.id)

        if prior is conclusive:
            apply_to_ladder_state(prior)
            if prior terminates ladder:
                break
            continue

        result = run_candidate(candidate)

        if result is conclusive:
            persist_result_immediately(candidate.id, result)

        apply_to_ladder_state(result)

        if result terminates ladder:
            break

        if result is nonconclusive failure:
            stop/pause according to existing H3 behavior
```

Important consequences:

- completed work survives Stop, app restart, or process interruption;
- the currently running candidate may repeat after interruption;
- no tested candidate repeats merely because a new runtime probe directory was created;
- an unsafe result still prevents needless higher rungs in its ladder;
- larger pruned candidates are not marked tested;
- baseline/last-safe/terminal conclusions are reconstructed from saved results in deterministic order.

Console output should make reused results visibly distinct from newly executed work, for example:

```text
[h3-probe] 34f 16:9 736x416 reuse safe
[h3-probe] 34f 16:9 768x448 train
```

Keep the exact log style consistent with the existing probe.

---

## 10. Mixed Quality validation

Individual candidate results are not sufficient to publish H3 `safe_shapes`.

Preserve the existing mixed Quality validation contract:

- provisional 17f, 34f, and 68f ceilings participate;
- 102f does not;
- use the existing nine canonical landscape/square buckets;
- preserve the existing 4:2:1 temporal/hybrid/spatial weighting;
- preserve 21 warm/compile steps and 21 validation steps;
- reject the same OOM, timeout, trainer failure, VRAM-headroom, and qualifying-slow-step conditions;
- preserve the existing backoff rule;
- lower only the individually least-headroom rung when current logic does so;
- preserve the existing maximum retry count of three.

### 10.1 Mixed-validation persistence

Keep this simple.

A passed mixed-validation result may be reused only when its recorded `selected_shapes` exactly match the provisional ceilings reconstructed from the current candidate results.

If they do not match, run mixed validation again.

If mixed validation was interrupted or failed before a reusable pass, run it again.

Do not add policy hashes or version keys.

### 10.2 Publishing

Only a successful mixed validation atomically publishes the current compatible H3 `safe_shapes`.

Portrait ceilings continue to be derived as transposes according to the existing H3 generation behavior.

A stopped, interrupted, or failed Run/Continue must not publish a partially reconstructed shape set.

---

## 11. Reset and Retest behavior

### 11.1 Reset calibration

**Reset calibration** is explicit and destructive to persistent calibration evidence, not to runtime files.

For the current H3 profile it clears:

- saved hardware compatibility record;
- per-candidate conclusive results;
- stored mixed-validation result;
- published calibrated `safe_shapes`.

After Reset, generated/reset H3 datasets use the normal conservative defaults until calibration successfully publishes again.

Reset does **not**:

- delete old probe logs/directories;
- alter existing dataset TOMLs;
- alter captured training bundles;
- alter queued/history jobs.

Require a normal confirmation because this discards reusable calibration work.

### 11.2 Retest one candidate

If individual Retest is implemented:

1. Delete only that candidate's conclusive result.
2. Clear the saved mixed-validation result because its selected ceilings may no longer be trustworthy.
3. Clear the currently published calibrated `safe_shapes` so generation falls back to conservative defaults until validation succeeds again.
4. Leave all other conclusive candidate results intact.
5. On the next Run/Continue, reconstruct the ladder and execute that candidate if it is still reachable under the saved lower-rung evidence.

Do not force execution of a candidate that is now unreachable because an earlier saved unsafe result terminates the ladder. If the user wants to retest beyond that point, they must also clear the earlier terminating result.

This behavior keeps Retest mechanically simple and avoids preserving a published calibration after the user has explicitly invalidated one of its inputs.

---

## 12. Source selection

Move the user-facing calibration workflow into Training Settings.

Use metadata already available for the currently loaded folder.

### 12.1 Eligibility

A source is eligible when it satisfies the existing probe preparation invariant, including:

- readable video metadata;
- sufficient duration/frame count for the longest temporal candidate in the current H3 plan;
- a valid saved caption/input according to the current H3 probe's existing requirement.

Derive the duration requirement from the candidate plan and configured probe capture FPS. Do not duplicate a magic maximum frame count in frontend code.

### 12.2 Automatic choice

Among eligible current-folder videos:

1. prefer the one with the greatest usable duration/frame count;
2. use filename as a deterministic tie-breaker.

That is enough.

Do not rank by:

- source resolution;
- aspect-ratio similarity;
- crop coverage;
- pixel area;
- codec quality;
- content quality.

### 12.3 Metadata scope

Do not call a full-folder metadata refresh solely because Training Settings opened or because calibration source selection was requested.

Use existing cached/loaded metadata.

If no eligible source can be selected from known metadata, ask the user to choose from the current folder and validate that selected file using the smallest existing single-file metadata path.

Do not add arbitrary filesystem-path input.

### 12.4 Explicit confirmation

Always show the proposed/selected source before starting calibration.

Source detection must never automatically launch calibration.

---

## 13. Training Settings UI

The Training Settings page becomes the sole user-facing owner of calibration controls after this pass.

Remove the old media-context calibration action once the Settings workflow is functional.

Keep the UI compact.

### 13.1 Minimum information

Show:

- H3 calibration status;
- saved hardware identity and whether it matches current hardware;
- progress such as conclusive candidates / total candidate plan;
- current candidate while running;
- proposed/selected source video;
- Run/Continue control;
- Stop control while running;
- Reset calibration;
- access to existing console/log output.

Do not build a second log viewer.

### 13.2 Run versus Continue

The backend semantics do not need separate "fresh campaign" and "continue campaign" operations.

Use one start operation.

The UI may label it:

- **Run calibration** when no reusable results exist;
- **Continue calibration** when compatible conclusive results already exist and additional work remains.

Both invoke the same backend behavior: generate the current plan, skip conclusive compatible results, run the remainder.

A deliberately fresh run is:

```text
Reset calibration -> Run calibration
```

Do not add a second Run Fresh pathway.

### 13.3 Candidate results / Retest

If feasible with the existing Settings UI components, show a compact expandable result table containing at least:

- frames;
- aspect;
- resolution;
- status;
- peak/minimum-free VRAM when available;
- measured/median step time when available;
- **Retest** action.

A 90-row expanded view does not need to be visible by default.

If implementing the per-row control would require a disproportionate new UI component, Reset is mandatory and per-candidate Retest may be deferred. The persistence/backend representation must nevertheless allow deletion of one result cleanly.

### 13.4 Hardware mismatch

On mismatch:

- show the saved hardware and current hardware;
- do not offer Continue using the old evidence;
- offer Reset calibration;
- do not silently erase or rewrite the saved results.

---

## 14. Backend interfaces

Keep the current H3 probe route family. Do not create a second generic calibration API in this pass.

Expected behavior:

### `GET /fs/h3_probe/status`

Return enough information for Training Settings to render:

- runtime state: idle/running/stopping/finished/error as currently represented;
- current candidate when running;
- saved hardware record;
- current hardware record;
- compatibility boolean;
- total candidate count;
- conclusive reusable result count;
- whether more candidate work remains;
- whether mixed validation is required/passed for the reconstructed ceilings;
- whether calibrated `safe_shapes` are currently published;
- selected/current source identity when applicable.

Keep payload additions minimal and derived from the authoritative Settings state plus current runtime state.

### `POST /fs/h3_probe/start`

Accept the existing explicit source selection:

```json
{
  "folder": "...",
  "fileName": "..."
}
```

Behavior:

1. reject if another H3 calibration process is live;
2. reject/handle managed-training GPU conflict according to existing probe rules;
3. validate source;
4. compare hardware compatibility;
5. if saved hardware mismatches, fail clearly and require Reset;
6. create the normal runtime probe workspace for this launch;
7. invoke the H3 runner with access to the persistent calibration results or the minimal reconciliation mechanism described earlier;
8. skip reusable conclusive results;
9. run remaining work.

Do not accept a `probeId` for resume. Persistent result state, not campaign identity, is the resume mechanism.

### `POST /fs/h3_probe/stop`

Preserve current Stop behavior:

- signal the detached probe process group;
- ensure the active trainer child exits;
- retain completed conclusive evidence;
- leave the active incomplete candidate without a conclusive persistent result;
- do not modify already published `safe_shapes` merely because the user stopped an in-progress continuation.

Only change signal/termination code if validation shows the current mechanism is actually broken.

### Reset/retest mutations

Prefer the existing Settings mutation/save path rather than adding dedicated H3 routes.

If server-side validation makes a dedicated mutation route clearly smaller/safer in the existing architecture, keep it H3-specific and narrow. Do not invent a generic calibration CRUD API.

---

## 15. Runtime probe files

Continue to retain runtime artifacts under the existing H3 probe location, currently equivalent to:

```text
.webcap_training/h3-probes/
  h3-<runtime-id>/
    source/
    base/
    work/
    results/
      <frames>f/<shape>/
        cache.log
        cache_telemetry.csv
        train.log
        telemetry.csv
        result.json
      summary.csv
      campaign_result.json
    runtime.json
```

These files remain useful for:

- debugging;
- telemetry inspection;
- sharing evidence;
- recovering a conclusive just-written result if the process boundary prevents immediate Settings persistence.

Do not restructure these folders in this pass.

Do not move old artifacts.

Do not implement the separate proposed stable-set/training folder restructure as part of calibration work.

The persistent "which candidates are already done?" decision comes from Settings, not from choosing or reopening one of these runtime directories.

---

## 16. Generated bucket integration

Preserve the current H3 generated-bucket behavior.

Only successfully published compatible `safe_shapes` may replace conservative H3 video ceilings for newly generated/reset Normal and Quality dataset TOMLs.

Rules:

- no compatible published calibration -> current conservative defaults;
- compatible published calibration -> exact calibrated safe shapes;
- do not interpolate untested shapes by MFP;
- source-coverage logic may still select a smaller supported candidate where existing generation behavior requires it;
- POC behavior remains unchanged;
- WAN, Krea2, images, repeat weighting, captured bundles, normal training Resume, and manual TOMLs remain unchanged;
- existing dataset TOMLs are never rewritten automatically;
- existing captured runs are never reevaluated against newer calibration.

Calibration may raise or lower generated defaults.

The generated log should continue to identify when a selected H3 shape came from calibration.

---

## 17. Stop/interruption behavior

The expected recovery contract is intentionally simple.

### User Stop

When Stop occurs:

- terminate the probe and active trainer process group;
- retain any candidate that already reached a conclusive persisted result;
- do not persist the currently active candidate as conclusive unless classification actually completed;
- next Continue reruns only candidates without conclusive results.

### WebCap/app restart

On restart:

- if runtime says a process is live but the PID/process no longer exists, show the runtime as interrupted/ended rather than permanently failed;
- do not automatically relaunch it;
- preserve any conclusive saved candidate results;
- the next Continue starts a new runtime launch and resumes from Settings.

### Hard process failure

A failure unrelated to candidate capacity remains diagnostic failure, not unsafe calibration evidence.

If it did not produce a conclusive result, the candidate remains eligible to run later after the underlying problem is fixed.

Do not create durable "recoverable failed campaign" state.

---

## 18. Model-agnostic boundary

The current implementation remains H3-only.

However, avoid coupling the **simple persistent result representation** to H3 where no H3 assumption is required.

The reusable conceptual shape is:

```text
profile/model namespace
  hardware
  candidate results keyed by stable candidate ID
  optional model-specific final validation
  published model-specific safe/default outputs
```

For this pass:

- H3 owns the candidate plan;
- H3 owns candidate execution;
- H3 owns classification thresholds;
- H3 owns mixed validation;
- H3 owns how results publish into H3 bucket generation.

Do **not**:

- create a calibration plugin system;
- create a model policy registry solely for calibration;
- refactor all model bucketing code;
- migrate WAN/Krea2/image policies;
- make H3 candidate generation abstract merely because another model might calibrate later.

When another model actually needs calibration, its existing bucketing logic can provide its own candidate plan and classification/publishing rules while reusing the small Settings/result pattern.

---

## 19. Implementation targets

Codex should first inspect the current implementation and preserve existing names/structure where practical.

Known current areas include:

- `scripts/h3_shape_probe.py` — H3 candidate execution, ladder reconstruction/classification, mixed validation, summaries;
- `tool/server/h3_probe.py` — preparation, process launch/stop/status, runtime reconciliation;
- the existing Settings persistence helper(s);
- the existing Training Settings UI;
- the current media-context H3 probe action;
- existing H3 bucket-generation code consuming `training.h3_calibration.safe_shapes`.

Do not rename/move these modules simply to fit this document.

If the actual repository paths differ, modify the current implementation in place rather than creating parallel replacements.

---

## 20. Implementation order

Implement in this order to keep the change reviewable.

### Phase 1 — persistent result model

1. Locate the existing `training.h3_calibration` Settings structure and atomic write helper.
2. Add/read the coarse hardware record:
   - total RAM;
   - GPU model;
   - total VRAM.
3. Add persistent per-candidate conclusive result storage keyed by stable candidate ID.
4. Preserve existing `safe_shapes` representation.
5. Add minimal helpers:
   - build candidate ID;
   - determine whether a saved result is conclusive;
   - compare saved/current hardware;
   - delete/reset candidate results.
6. Add unit tests for these helpers.

Do not change probe execution yet.

### Phase 2 — make H3 execution skip saved evidence

1. Pass/load persistent compatible results into the H3 probe execution path using the smallest mechanism allowed by the current process boundary.
2. Reconstruct each ladder from saved conclusive results.
3. Skip reusable candidates.
4. Persist each newly conclusive candidate result promptly.
5. Ensure interrupted/nonconclusive candidates remain absent/retryable.
6. Ensure a saved unsafe result prunes the same higher ladder work as if it had just run.
7. Keep runtime result files/logs unchanged.
8. Make summary generation reflect both reused and newly executed evidence without duplicate logical rows.

### Phase 3 — mixed validation resume

1. Derive provisional ceilings from the combined saved/new candidate results.
2. Reuse a passed mixed validation only when `selected_shapes` exactly match.
3. Otherwise rerun the existing mixed validation.
4. Publish `safe_shapes` only after success.
5. Preserve all current H3 mixed-validation/backoff logic.

### Phase 4 — server/status behavior

1. Remove campaign-ID resume semantics from the intended API.
2. Start always means "run remaining compatible work."
3. Add status fields needed by Training Settings.
4. Validate current Stop behavior.
5. Reconcile disappeared runtime PIDs as interrupted/ended, not as a reason to discard persistent calibration evidence.
6. Add server tests.

### Phase 5 — Training Settings UI

1. Add compact H3 calibration block.
2. Select source from already-known current-folder metadata by sufficient duration.
3. Show hardware compatibility.
4. Add Run/Continue and Stop.
5. Add Reset.
6. Add Retest only if it is a small extension of existing UI patterns.
7. Link/reuse existing console output.
8. Remove the old media-context calibration action after the Settings workflow works.

### Phase 6 — smoke validation

On the real training machine:

1. start calibration;
2. allow several candidates to complete;
3. Stop during a later candidate;
4. verify completed candidate results exist in Settings;
5. Continue;
6. verify completed candidates are logged as reused/skipped;
7. verify the interrupted candidate reruns;
8. interrupt/restart WebCap and repeat;
9. verify mixed validation is required before publication;
10. verify published bucket generation remains unchanged except for the calibrated ceilings;
11. Reset and verify conservative defaults return.

---

## 21. Tests

### 21.1 Persistent state

- Stable candidate IDs are deterministic.
- Hardware compatibility uses exactly total RAM, GPU model, total VRAM.
- Driver/CUDA/trainer/config changes do not affect compatibility.
- Hardware mismatch does not delete results.
- Reset clears hardware/results/mixed validation/published calibrated `safe_shapes`.
- Retest clears one result and invalidates mixed/published state if Retest is implemented.
- Full telemetry is not written into Settings.

### 21.2 Resume / ladder reconstruction

- A saved safe candidate is skipped.
- A saved OOM candidate terminates only its ladder at the same point.
- A saved unsafe-slow candidate terminates only its ladder at the same point.
- Current unsafe-VRAM/headroom result behaves identically when reused.
- Missing result runs.
- Malformed/nonconclusive result is not treated as done.
- Interrupted current candidate reruns.
- Untested higher candidates remain unpersisted.
- Reused baseline results reconstruct the same slowdown thresholds as an uninterrupted run.
- Multiple Run/Continue cycles do not duplicate logical summary rows.

### 21.3 Mixed validation

- Individual ladder completion alone never publishes `safe_shapes`.
- Passed mixed validation is reused only for the exact same selected-shape set.
- Any changed candidate result invalidates previous mixed validation.
- Interrupted/incomplete mixed validation reruns.
- Existing backoff behavior remains unchanged.
- 102f remains excluded from publishing/mixed validation.

### 21.4 Source selection

- Selection uses already-known metadata.
- The longest eligible video is chosen deterministically.
- Native resolution does not disqualify an otherwise valid source.
- Aspect ratio does not affect eligibility.
- Insufficient duration is rejected clearly.
- Missing required caption/input is rejected according to the current probe invariant.
- No full-folder metadata refresh occurs merely from opening Settings.

### 21.5 Server/runtime

- Only one calibration runtime is active at once.
- Start uses compatible persistent results rather than an old campaign ID.
- Hardware mismatch blocks reuse until Reset.
- Stop terminates active probe/trainer process group.
- Conclusive prior results survive Stop.
- Disappeared process is shown as interrupted/ended and can be continued through a new launch.
- Invalid source paths remain rejected.
- No arbitrary command/path input is introduced.

### 21.6 UI

- Training Settings displays calibration status and compatibility.
- Run becomes Continue when reusable unfinished evidence exists.
- Stop reflects actual backend state.
- Reset is explicit and confirmed.
- Candidate Retest works if implemented.
- Existing console/log surface is reused.
- Old media-context action is removed only after Settings replacement works.
- Existing Training Settings functionality remains unchanged.

### 21.7 Regression

Confirm no behavior change to:

- normal managed training queue/history;
- normal training Resume;
- H3 candidate manifest;
- H3 classification thresholds;
- H3 mixed-validation rules;
- current conservative bucket defaults when no published calibration exists;
- existing dataset TOMLs;
- captured run bundles;
- POC;
- WAN;
- Krea2;
- image bucket logic;
- repeat weighting;
- folder/run layout.

---

## 22. Non-goals

This pass does **not** include:

- calibration for another model;
- image calibration;
- generic calibration architecture/plugin framework;
- trainer/config/software-version fingerprinting;
- policy-version invalidation;
- source-resolution scoring;
- aspect-ratio-aware source selection;
- multi-source probe composition;
- automatic background calibration;
- automatic calibration reset;
- calibration in normal queue/history;
- trainer checkpoints for probe candidates;
- attempt history;
- persistent campaign history as application state;
- automatic deletion of old probe artifacts;
- folder/run restructure;
- changes to Diffusion Pipe;
- rewriting existing dataset TOMLs;
- re-evaluating captured/resumed training runs against new calibration;
- refactoring unrelated bucketing/model-policy code.

---

## 23. Acceptance criteria

The pass is complete when:

1. H3 calibration can be stopped, WebCap can be restarted, and calibration can later continue without rerunning candidates that already have compatible conclusive saved results.
2. The only hardware compatibility inputs are total RAM, GPU model, and total VRAM.
3. Conclusive candidate results are persistently visible in Settings and individually addressable by stable shape ID.
4. Reset provides a reliable explicit way to discard calibration and return to conservative defaults.
5. Source selection requires only the real probe input invariants and sufficient duration; native resolution/aspect do not add calibration logic.
6. Existing H3 probe mechanics, safety rules, mixed validation, and generation behavior are preserved.
7. Training Settings owns the calibration workflow.
8. No folder restructure or generalized calibration framework is introduced.
9. A successful mixed validation remains required before calibrated `safe_shapes` are published.
10. Normal training, Resume, queue/history, existing TOMLs/runs, and other model families remain unaffected.

---

## 24. Codex execution instruction

Treat this document as the authoritative implementation specification.

Before editing, inspect the current H3 probe, server orchestration, Settings persistence, Training Settings UI, and H3 bucket-generation integration.

Implement the behavior above with the **smallest coherent change set**.

Prefer modifying existing functions/modules over introducing abstractions.

Do not redesign the feature for future models.

Do not perform the proposed folder restructure.

Do not add compatibility inputs beyond total RAM, GPU model, and total VRAM.

Do not add source-resolution/aspect-ratio logic.

If an actual repository constraint makes a requirement impossible without materially broader architecture, stop and report that exact conflict rather than substituting a more elaborate design.
