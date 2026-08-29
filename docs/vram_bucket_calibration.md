# VRAM Bucket Calibration

Last reviewed against code: 2026-08-28

Status: **Implemented for MiniMax H3.** The historical design notes below are retained for context; the current runtime contract is this document's source of truth.

## Purpose

WebCap can empirically determine which `(width, height, frames)` training shapes are safe for a specific model and training runtime. This remains separate diagnostic tooling; the simplified dataset generator uses its saved safe shapes only as upper bounds.

The first implementation targets MiniMax H3 video training. H3 is the useful first case because model, optimizer, and runtime allocations consume a large fixed portion of VRAM, making the remaining spatial/temporal ceiling difficult to infer from total card capacity alone.

Calibration is an explicit, advanced Training action. It runs on the training machine, uses the real Diffusion Pipe environment, and deliberately approaches OOM. It must never run automatically, mutate source media, rewrite an existing dataset TOML, or silently change a queued job.

## Product Contract

The feature has three distinct layers:

1. **Probe candidates** — an app-owned, reviewed catalog of shapes to measure.
2. **Calibration result** — hardware/runtime-specific evidence describing which candidates completed safely.
3. **Dataset generation** — compatible safe shapes clamp the fixed H3 ceilings without changing the normal selection flow.

Calibration writes a separate result for inspection and ceiling clamping. Newly generated or explicitly reset H3 datasets use the lower of the fixed app-owned ceiling and the compatible calibrated safe shape. Calibration never raises a built-in ceiling, changes role membership, or rewrites persistent user-owned dataset TOML.

## Current H3 Runtime Contract

- Every individual 17f, 34f, 68f, and 102f candidate keeps the real H3 config and is measured in a fresh process.
- A candidate is safe only when it completes normally **and every active-GPU sample leaves at least 680 MiB free**. This is an app-owned transient-allocation buffer, calculated from exact `nvidia-smi` MiB values, not a percentage or rounded GiB display.
- 17f, 34f, and 68f provisional ceilings then enter a two-epoch mixed Quality validation. It uses the nine canonical landscape/square buckets with 4:2:1 temporal/hybrid/spatial weighting; the first 21 steps warm/compile and the next 21 validate steady operation.
- The mixed phase rejects OOM, timeout, trainer failure, insufficient VRAM headroom, or two qualifying slow validation steps. It may lower only the individually least-headroom rung and retry up to three times.
- Only a passed mixed validation atomically updates `training.h3_calibration.safe_shapes`. Failed, stopped, or canceled calibration leaves Settings unchanged. Portrait bucket ceilings remain transposes of their measured landscape counterparts.
- 102f continues to be measured for manual long-motion analysis, but is not saved in `safe_shapes` or included in mixed validation.

## Historical Design Notes (Superseded)

- Profile: MiniMax H3 only.
- Media: one user-selected video with valid metadata and enough duration for the 68-frame probe family.
- Probe families:
  - motion: 68 frames;
  - detail: 34 frames.
- Aspect families: square, 4:3, 3:4, 16:9, and 9:16.
- Batch settings: those in the selected H3 Normal config, including micro-batch size, activation checkpointing, dtype, optimizer, and `compile`.
- Result: explicit tested-safe and recommended-safe shape lists, plus complete measurements for every attempted candidate.
- Integration: newly created/reset H3 Normal and Quality dataset defaults. POC retains its fixed conservative 34-frame policy in v1.

Image calibration is a follow-up using the same machinery with `frames = 1`. It should not complicate the first H3 video implementation.

## Model Bucket Policy

Move the curated H3 video ladder out of ad hoc selection constants into one app-owned JSON file:

```text
tool/bucket_profiles.json
```

This is product policy, not user configuration. It is reviewed and shipped with WebCap.

Suggested schema:

```json
{
  "version": 1,
  "profiles": {
    "minimax_h3": {
      "video": {
        "poc": {
          "frames": 34,
          "fixedByAspect": {
            "square": [384, 384, 34]
          }
        },
        "families": {
          "motion": {
            "frames": 68,
            "repeatWeight": 2.0,
            "candidatesByAspect": {
              "square": [
                {"shape": [320, 320, 68], "rank": 0},
                {"shape": [352, 352, 68], "rank": 1, "conservativeDefault": true},
                {"shape": [384, 384, 68], "rank": 2}
              ]
            }
          },
          "detail": {
            "frames": 34,
            "repeatWeight": 1.0,
            "candidatesByAspect": {
              "square": [
                {"shape": [448, 448, 34], "rank": 0},
                {"shape": [512, 512, 34], "rank": 1, "conservativeDefault": true},
                {"shape": [544, 544, 34], "rank": 2}
              ]
            }
          }
        }
      }
    }
  }
}
```

The example shows shape and ordering, not the final complete ladder. Before implementation, populate all five aspect families with reviewed 32-pixel-aligned candidates. Every current H3 target must appear and be marked `conservativeDefault`. Candidates must be strictly ordered from cheapest to most expensive within a family and aspect.

The loader must fail loudly on malformed policy:

- unknown profile, role, or aspect;
- duplicate shapes;
- dimensions not aligned to 32;
- frames other than the role's frame count;
- non-increasing ranks;
- missing or multiple conservative defaults;
- a candidate above a reviewed absolute emergency ceiling.

The policy file replaces the current H3 target table as the single definition of H3 video candidates. WAN and image policies remain unchanged in v1.

## Calibration Storage

Calibration is machine/runtime state and belongs under the existing training runtime root:

```text
<filesystem.root>/.webcap_training/calibrations/
  active.json
  <calibration-id>/
    request.json
    result.json
    calibration.log
    probes/
      <shape-id>/
        configs/
        media/
        runner.sh
        stdout.log
        telemetry.jsonl
```

`active.json` maps a profile and runtime fingerprint to a completed calibration ID. Activation is explicit after a successful run; merely completing calibration does not change generated defaults.

Each calibration directory is immutable after completion, matching the run-bundle philosophy. A new calibration creates a new ID. Deactivation only changes `active.json`.

### Result schema

```json
{
  "version": 1,
  "id": "h3-20260823-...",
  "status": "completed",
  "profileId": "minimax_h3",
  "createdAt": "2026-08-23T20:15:00Z",
  "completedAt": "2026-08-23T20:42:00Z",
  "runtimeFingerprint": "sha256:...",
  "runtime": {
    "gpuName": "NVIDIA GeForce RTX 5090",
    "gpuUuid": "GPU-...",
    "totalVramMiB": 32607,
    "diffusionPipeRevision": "...",
    "torchVersion": "...",
    "cudaVersion": "...",
    "driverVersion": "...",
    "compile": true,
    "microBatchSize": 1,
    "activationCheckpointing": true,
    "modelIdentity": "..."
  },
  "source": {
    "file": "probe.mp4",
    "width": 1920,
    "height": 1080,
    "frames": 240,
    "fps": 24
  },
  "probes": [
    {
      "shape": [352, 352, 68],
      "role": "motion",
      "aspect": "square",
      "status": "safe",
      "warmupSteps": 2,
      "measuredStepSeconds": [7.8, 7.9],
      "medianStepSeconds": 7.85,
      "peakGpuMemoryMiB": 28740,
      "minimumSwapFreeMiB": 8192,
      "exitCode": 0
    }
  ],
  "testedSafeShapes": [[352, 352, 68]],
  "recommendedSafeShapes": [[352, 352, 68]],
  "unsafeShapes": [[384, 384, 68]]
}
```

## Runtime Fingerprint

A safe-shape result is valid only for materially equivalent training conditions. Build the fingerprint from normalized values, not raw TOML text.

Include:

- profile ID and base-model identity/path metadata;
- GPU UUID/name and total VRAM;
- Diffusion Pipe revision when discoverable;
- PyTorch, CUDA, and driver versions;
- model/transformer dtype;
- optimizer type and state precision;
- video micro-batch size;
- activation-checkpointing mode;
- compile setting and relevant compile mode;
- other model-specific switches known to affect activation memory.

Exclude settings that do not materially affect peak VRAM, such as learning rate, epochs, captions, output path, and save interval.

If a fingerprint cannot be reproduced, the result remains viewable but cannot be active. WebCap falls back to conservative defaults and explains which fingerprint field changed.

## Probe Preparation

The user selects a real source clip from the current set. WebCap validates that it has:

- readable dimensions and frame metadata;
- a caption or valid primer fallback;
- enough trainer-visible duration for 68 H3 frames;
- no unsupported media/container issue already caught by training preflight.

The source does not need to match every candidate aspect ratio. Each probe has exactly one configured bucket, so Diffusion Pipe produces the target tensor shape through its normal resize/crop path. Content quality is irrelevant; the objective is allocation behavior.

For every candidate, create a fresh one-item immutable probe bundle. Capture the source clip and caption using the normal profile-FPS bundle policy, so the probe uses the same normalized video input as a training run. The H3 practical-ceiling probe creates, caches, and trains one candidate at a time. Each candidate has its own media directory and Diffusion Pipe cache namespace; its fresh training process reuses only the cache created for that same candidate.

Each probe dataset contains one video stanza and one bucket:

```toml
[[directory]]
path = "<probe-media-directory>"
num_repeats = 1
group = "videos"
size_buckets = [[352, 352, 68]]
```

Clone the selected H3 Normal config, then rewrite only calibration-owned values:

- dataset path to the probe dataset;
- output path to the probe directory;
- epochs to four one-sample epochs, producing four optimizer steps;
- save/checkpoint intervals beyond the probe length so no useful checkpoint is written.

Do not alter compile, dtype, micro-batch, activation checkpointing, optimizer, or model paths. H3 currently uses `compile = true`; calibration therefore retains compilation and ignores warm-up timing rather than disabling it.

## Probe Execution

Run candidates cheapest-to-most-expensive within each role/aspect ladder. Use a completely fresh trainer process for every candidate so OOM or allocator fragmentation cannot contaminate the next result. The H3 campaign is a fixed 90-shape plan: 17f and 34f stop at their useful 768p-class model caps, while 68f and 102f stop at one >30 MFP sentinel. A safe sentinel is `ceiling_not_found`, never a discovered ceiling.

For each candidate:

1. Verify the managed training runner is idle and no conflicting GPU process is present.
2. Create the one-shape probe bundle.
3. Run a fresh cache-only process for that candidate and wait for it to exit.
4. Start a fresh training process with the candidate config and its prepared cache.
5. Ignore the first two optimizer-step timings as compile/warm-up.
6. Measure steps three through six.
7. Capture exit status, stdout/stderr, peak GPU memory, GPU utilization, host available memory, and WSL swap-free samples.
8. Terminate the process group and wait for GPU memory to return near its pre-probe baseline.
9. Classify the result and either continue or stop that ladder.

The calibration runner must use the same WSL distribution, DeepSpeed launcher, environment variables, process-group control, and visible logging conventions as managed training. Put orchestration in a dedicated backend helper such as `training_calibration.py`; reuse runner primitives rather than adding a second generic process framework.

Calibration is exclusive GPU work. It must not run concurrently with managed training or enter the normal training queue. If jobs are queued, calibration may start only when there is no active job and after an explicit confirmation that normal queue advancement will remain paused until calibration finishes or is canceled.

## Telemetry and Classification

Sample telemetry at approximately one-second intervals while the child process exists:

- `nvidia-smi`: used/total GPU memory, utilization, GPU UUID/name;
- WSL `/proc/meminfo`: MemAvailable, SwapTotal, and SwapFree;
- process exit code and stderr;
- optimizer-step timestamps from the existing training-log parser.

Do not label a run as “swapping” from step time alone. Step slowdown is a safety heuristic; swap pressure is corroborating telemetry.

### Result states

- `safe`: four steps completed, both measured steps are stable, no OOM signature, and no severe memory-pressure signal occurred.
- `unsafe_oom`: CUDA/allocator OOM signature or an OOM-associated non-zero exit.
- `unsafe_slow`: both measured steps exceed the slowdown policy and system telemetry indicates material memory pressure.
- `failed`: unrelated trainer/configuration/media error; calibration stops without treating larger shapes as unsafe.
- `canceled`: user cancellation; partial evidence is retained but cannot be activated.
- `inconclusive`: missing timings or contradictory telemetry.

### Slowdown policy

The first completed safe candidate in each role establishes the role baseline. It is not rejected merely for exceeding an absolute duration.

For later candidates, classify as `unsafe_slow` only when the median of the four measured steps is at least `max(20 seconds, 2.5 × role baseline)` and at least three measured steps cross that threshold. A post-warm-up stall timeout is `max(120 seconds, 20 × role baseline)`.

Query every GPU and identify the active device from its movement over idle. Record host available memory and swap-free space. A slowdown is still practical without memory corroboration; only call VRAM-to-RAM spill confirmed when it coincides with a ≥2 GiB available-memory decline or ≥1 GiB swap-free decline.

Stop a role/aspect ladder after the first `unsafe_oom` or `unsafe_slow`. Stop the entire calibration on `failed`, because subsequent results would not be trustworthy. An `inconclusive` candidate pauses and asks the user whether to retry or end calibration.

## Safe Versus Recommended Shapes

`testedSafeShapes` contains every exact shape that completed according to the safe criteria.

`recommendedSafeShapes` in the original design was percentage-based. The implemented H3 runtime instead uses the exact 680 MiB minimum-free-VRAM rule above, followed by mixed Quality validation. The percentage rule is obsolete.

Do not infer untested cross-aspect shapes from MFP alone. MFP remains a display/ordering metric, not the persisted safety decision.

## Feeding Results Into Bucket Generation

Add an optional calibrated-safe-shape input to the existing dataset-config builder rather than teaching it to read runtime state directly. The caller resolves the active calibration and passes the shape set, avoiding a dependency from `dataset_config.py` back into training-runner/config state.

For newly created or Reset H3 Normal/Quality dataset TOMLs:

1. Load the role/aspect candidate ladder from `bucket_profiles.json`.
2. If no compatible active calibration exists, select the marked conservative default.
3. If calibration is active, filter candidates to `recommendedSafeShapes`.
4. From the filtered candidates, choose the highest-ranked shape supported by the selected source cohort under the existing coverage/upscale rules.
5. If no calibrated candidate is supported, fall back to the conservative default only if it is part of the active recommended set; otherwise fail generation clearly and offer calibration deactivation.
6. Keep motion/detail frame counts and 2:1 repeat weighting unchanged.

Calibration may select a shape above or below today's conservative default. The generated log must identify the source of the decision:

```text
[INFO] H3 motion 16:9: selected 512x288x68 from active calibration h3-...
```

Ordinary setup never overwrites an existing dataset TOML. A manually edited bucket is not clamped or rewritten. Training inspection should show a non-blocking warning when a manual H3 shape is absent from the active recommended list; manual TOML remains the explicit override.

Existing captured bundles and Resume remain immutable and are never re-evaluated against a newer calibration.

## UI

Add one compact advanced action in Training:

```text
Calibrate H3 buckets…
```

The calibration dialog contains:

- selected profile and Normal config identity;
- compatible source-clip selector, defaulting to the largest/longest visible clip;
- GPU/runtime fingerprint preview;
- number and ordering of candidate probes;
- warning that calibration intentionally approaches OOM and temporarily owns the GPU;
- Start, Stop, and Close controls.

During execution, show a small table:

| Shape | Role / AR | Peak VRAM | Steps 3–4 | Status |
| --- | --- | ---: | ---: | --- |
| 352×352×68 | Motion / Square | 28.1 GiB | 7.8s / 7.9s | Safe |

After completion, show tested-safe and recommended-safe lists with an explicit **Activate for generated H3 buckets** action. Also support deactivation and viewing older results.

Do not add calibration controls to the normal queue/history list. A concise status indicator beside the advanced action is enough:

```text
H3 calibration active · RTX 5090 · 10 recommended shapes
```

## Backend Interfaces

Suggested routes:

- `GET /fs/training_calibration/status` — current execution state and active-compatible result.
- `POST /fs/training_calibration/start` — profile, source file, selected config/mode, and explicit risk confirmation.
- `POST /fs/training_calibration/stop` — terminate the active calibration process group and preserve partial results.
- `GET /fs/training_calibration/results` — list result summaries and compatibility state.
- `POST /fs/training_calibration/activate` — activate a completed compatible calibration ID.
- `POST /fs/training_calibration/deactivate` — return generation to conservative defaults.

All paths are resolved under the configured filesystem root. Source input is a selected filename from the current set, not an arbitrary command or path. The backend constructs every trainer argument explicitly.

Only one calibration may exist in `running` state. State writes use the same atomic temp-file-and-replace pattern as the managed queue.

## Failure and Recovery

- OOM is an expected probe result, not an app crash.
- Every probe runs in its own process group and directory.
- After OOM/cancellation, wait for process exit and GPU-memory recovery before continuing.
- If memory does not recover, stop calibration and tell the user to inspect/terminate the remaining trainer process.
- Preserve logs for completed, failed, OOM, and canceled probes.
- Never automatically delete calibration evidence. A later explicit cleanup action may remove inactive calibration directories.
- App restart reconciles a recorded running calibration by verifying its PID/process identity. An absent process becomes `interrupted`; WebCap never silently relaunches it.

## Testing

### Policy and fingerprint tests

- Reject malformed/duplicate/unaligned candidate shapes.
- Require one conservative default per role/aspect.
- Verify all current H3 defaults are present.
- Verify material runtime changes invalidate a result while LR/epoch changes do not.

### Probe preparation tests

- Build a one-item, one-bucket dataset per candidate.
- Preserve compile, dtype, micro-batch, checkpointing, optimizer, and model identity.
- Suppress useful checkpoint/save output through intervals beyond the four-step run.
- Give every candidate a unique cache and output directory.

### Runner tests

- Attempt candidates in deterministic increasing order.
- Ignore two warm-up steps and measure exactly two steady steps.
- Start every candidate in a fresh process.
- Stop a ladder on OOM/slow classification.
- Stop the calibration on unrelated trainer failure.
- Cancel the process group safely and retain partial results.
- Reconcile interrupted state after restart.

### Classification tests

- Detect known CUDA OOM signatures and non-zero exits.
- Do not call the first slow baseline candidate unsafe solely because it exceeds 20 seconds.
- Require absolute, relative, and telemetry conditions for `unsafe_slow`.
- Mark missing/contradictory evidence inconclusive.
- Enforce exact 680 MiB minimum free VRAM and require a passed mixed Quality validation before publishing Settings.

### Generation integration tests

- No calibration preserves current conservative H3 buckets.
- An active compatible result can raise or lower generated defaults.
- Only exact recommended shapes are selectable; no MFP interpolation creates untested shapes.
- Source coverage may still select a smaller safe candidate.
- Manual existing TOMLs remain untouched and receive warnings only.
- POC, WAN, Krea2, image classes, repeat weighting, bundles, and Resume remain unchanged.

## Rollout

1. Add and validate the app-owned H3 candidate catalog while preserving current generated defaults exactly.
2. Add the backend calibration runner and result files without feeding results into generation.
3. Validate one complete run on the actual training machine and compare telemetry with observed trainer behavior.
4. Add explicit activation and dataset-generation integration.
5. Add the compact advanced Training UI.
6. Consider image and other-model calibration only after H3 evidence is stable.

## Non-Goals

- Predicting VRAM from GPU capacity alone.
- Automatically discovering arbitrary resolutions.
- Editing Diffusion Pipe.
- Automatically running calibration during setup or training.
- Guaranteeing safety under unrelated concurrent GPU workloads.
- Rewriting manual dataset TOMLs.
- Applying new calibration results to immutable bundles or resumed runs.
- Treating MFP as a perfect cross-shape memory model.

## Acceptance Criteria

The feature is complete when a user can select a representative H3 clip, run isolated increasing-shape probes on the training machine, inspect trustworthy measurements, explicitly activate a compatible recommended-safe shape list, and regenerate H3 Normal/Quality defaults that select only model-valid and calibrated-safe shapes without altering existing TOMLs or runs.
