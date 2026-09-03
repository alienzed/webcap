# H3 Calibration Resume and Settings Plan

## Goal

Make the existing H3 calibration practical to stop and continue without turning it into a normal managed training job.

The resumed campaign reuses its immutable seed and skips shapes for which it already has valid, conclusive evidence. Move the user-facing controls from the media context menu into Training Settings, where WebCap can propose a suitable source clip or ask the user to choose one.

This is a recovery and placement pass. It does not change the fixed probe plan, shape order, classification thresholds, mixed-validation policy, calibration publishing, generated bucket behavior, the training queue, or normal training Resume.

## Current State

- Each calibration already receives an immutable campaign directory containing its captured video, caption, config, plan, per-shape results, work files, log, and `runtime.json`.
- Each finished shape already writes a standalone `result.json` with enough evidence to classify it again.
- Stop already sends `SIGINT` to the detached WSL process group. The probe catches interruption, terminates its active child process, writes a canceled campaign result, and retains partial evidence.
- A new start always creates a new campaign. The runner also requires new `results/`, `work/`, and candidate directories, so it cannot reopen a stopped campaign.
- Calibration is launched from a selected video's context menu. App Settings has no calibration source selection, status, stop, or continue controls.

## Intended Workflow

1. Open Training Settings and find the H3 calibration section.
2. WebCap inspects videos in the currently loaded folder and proposes the strongest suitable source clip.
3. The user confirms that clip or selects another one. Calibration never starts merely because a candidate was detected.
4. **Run calibration** creates a fresh immutable campaign and starts it.
5. **Stop** interrupts the process group and preserves all completed evidence.
6. A stopped or interrupted campaign exposes **Continue calibration**.
7. Continue reuses the same seed, reclassifies saved results with the current safety rules, skips conclusive shapes, and executes only unfinished or unusable shapes.
8. Settings are published only after the ordinary ladder work and mixed validation complete successfully.

## Resume Semantics

Resume is deliberately campaign-local. It must never merge results from different source clips, captured configs, plans, or campaign directories.

### Reusable shape evidence

Process every ladder in its existing deterministic order. For each shape:

- If `result.json` is readable and the current classifier accepts it as `completed`, reuse it and reconstruct the ladder baseline/last-safe state from it.
- If the current classifier accepts it as a decisive terminal result (`oom`, `unsafe_slow`, or `unsafe_vram`), reuse it and stop that ladder at the same point.
- If the result is missing, malformed, incomplete, or classified as an unrelated failure, preserve any partial diagnostic logs and run that shape again.
- Do not infer that an untested shape passed because a neighboring shape passed.
- Do not reuse a label alone. Re-evaluate the saved timings and telemetry through the existing classification function.

Print a concise line for every reused shape so the console accurately distinguishes skipped evidence from new cache/training work.

### Existing directories

Resume opens the campaign's existing `results/` and `work/` roots instead of creating replacements. Candidate preparation becomes idempotent for that exact seed:

- retain completed logs, telemetry, and results;
- rewrite deterministic candidate config/dataset/request files when rerunning an incomplete candidate;
- retain that candidate's earlier partial logs under an attempt-specific name;
- clear and rebuild only that incomplete candidate's derived media/cache and output namespace, after validating its exact campaign-local path;
- never delete evidence from other candidates.

`summary.csv` must not accumulate duplicate rows after multiple resumes. Rebuild it atomically from the authoritative per-candidate results, or update rows by the shape identity `(frames, aspect, width, height)`.

### Mixed validation

Individual shape completion is not sufficient to publish calibration settings. After all ladders settle:

- reuse a completed mixed validation if its recorded selected shapes match the reconstructed provisional ceilings;
- reuse conclusive earlier mixed attempts when determining the next backoff;
- rerun only an interrupted/incomplete mixed attempt;
- require the existing successful mixed-validation result before publishing.

If the implementation cannot prove that a saved mixed attempt matches the reconstructed selection, fail visibly or rerun that attempt; never silently publish it.

### Campaign states

Keep the existing small runtime record. No queue entry, checkpoint machinery, scheduler, or job history is needed.

- `running` and `stopping` are not resumable while their process is live.
- `canceled`, `interrupted`, and recoverable `failed` campaigns may be continued.
- `completed` campaigns remain viewable but do not offer Continue.
- A runtime recorded as running whose PID is absent becomes `interrupted` when there is no conclusive terminal campaign result. This replaces the current generic `failed` fallback so a hard interruption is visibly recoverable.

## Backend Changes

### Probe script

Update `scripts/h3_shape_probe.py` so running the same seed is idempotent:

- allow its existing campaign directories;
- load and classify saved candidate results before executing a candidate;
- reconstruct ladder baseline, last-safe, first-unsafe, and terminal reason from reused evidence;
- safely rerun only incomplete/unusable candidates;
- make summary output idempotent;
- resume or repeat mixed validation according to the rules above;
- keep cancellation writing the partial campaign result.

No new checkpoint format is required. The per-shape result files are the resume state.

### Server routes

Keep the current H3 probe routes and extend their payloads minimally:

- `GET /fs/h3_probe/status` returns the latest campaign's source identity, status, and whether it is resumable.
- `POST /fs/h3_probe/start` accepts either a fresh `{folder, fileName}` request or an explicit existing `probeId` to continue.
- Continuing resolves that probe only below `.webcap_training/h3-probes/`, validates its seed and inactive runtime, and launches the same seed with the existing detached-process mechanism.
- `POST /fs/h3_probe/stop` retains its current contract. Verify that it reaches the probe and active trainer process before changing its signal behavior.

A fresh start remains explicit even when an interrupted campaign exists. The UI decides whether it is asking to Run Fresh or Continue; the backend must not silently substitute one for the other.

## Training Settings UI

Add a compact **H3 calibration** block to the existing Training tab in App Settings. Remove the calibration action from the media context menu after the Settings workflow is wired.

The block shows:

- current calibration status and campaign ID;
- proposed or selected source video, dimensions, frame count/duration, and folder;
- a source selector when more than one usable video is available;
- why a source is unsuitable when no candidate passes the checks;
- `Run calibration`, `Stop`, or `Continue calibration` as appropriate;
- a short warning that calibration is long-running, GPU-intensive work;
- a link/action to expose the existing console output rather than adding a second log viewer.

Disabled or hidden controls must reflect actual backend state, but failures remain visible through the normal Settings/status and console surfaces.

### Source detection

Use metadata already loaded for the current folder. Do not scan or decode every video merely because Settings opened.

A proposed source must have:

- readable video metadata;
- enough frames at the probe's capture FPS for the largest temporal shape in the fixed plan;
- a saved, non-empty caption, matching the probe's current preparation invariant.

Derive the temporal requirement from the fixed probe plan rather than duplicating a magic frame count in frontend code. Native resolution is not a correctness gate because the probe deliberately exercises Diffusion Pipe's normal resize/crop path, but higher-resolution clips are better defaults. Rank eligible clips deterministically by native pixel area, then usable frame count/duration, then filename. Display the selected candidate before starting.

If no clip clearly qualifies, Settings asks the user to choose from the current folder and displays each candidate's limiting reason. If no folder is loaded, it asks the user to open a folder containing a suitable video. Arbitrary filesystem paths and command input remain out of scope.

## Stop Validation

The stop path exists, but validation should accompany this pass:

- confirm the server targets the detached calibration process group;
- confirm the active DeepSpeed child exits as well as the wrapper;
- confirm runtime moves from `stopping` to `canceled`/finished once the PID disappears;
- confirm the active candidate either has conclusive `result.json` evidence or is treated as incomplete on Continue;
- confirm completed earlier candidates remain untouched;
- perform one smoke test on the training machine, because the development machine cannot establish real WSL/GPU process behavior.

Only alter the signal/termination implementation if this validation demonstrates a real failure.

## Tests

### Script tests

- A stopped campaign skips valid completed results and runs the first missing shape.
- A saved decisive unsafe result stops only its ladder without rerunning it.
- Malformed, partial, or unrelated-failure results are not treated as tested evidence.
- Reused completed results reconstruct the same baseline and ceiling as an uninterrupted campaign.
- Multiple resumes do not duplicate summary rows.
- Resume does not create a new seed or campaign directory.
- Mixed validation is never bypassed; compatible completed attempts are reused and incomplete attempts are rerun.
- Cancellation during cache, individual training, and mixed validation leaves a resumable campaign.

### Server tests

- Fresh start still creates a new immutable campaign.
- Continue launches the requested inactive campaign's existing seed.
- Invalid, completed, foreign, or live campaign IDs are rejected loudly.
- Status identifies resumable versus completed campaigns.
- Stop retains partial evidence and sends the signal to the recorded process group.

### UI tests

- Training Settings proposes the deterministic best eligible current-folder video.
- The user can choose another eligible clip before starting.
- Missing folder, short clip, unreadable metadata, and missing caption receive clear explanations; a low-resolution clip remains selectable but is identified as a weaker default.
- Run, Stop, and Continue actions correspond to backend state.
- The media context menu no longer owns calibration after the Settings control ships.
- Existing Training Settings, training launch, queue, normal Resume, and bucket-review behavior remain unchanged.

## Implementation Order

1. Make the probe script idempotent for an existing seed and add resume-focused tests.
2. Extend status/start payloads with explicit resumable campaign identity and test path/state validation.
3. Validate the existing stop mechanism against partial-result recovery; adjust only if necessary.
4. Add source eligibility/proposal data and the compact Training Settings controls.
5. Remove the old media context-menu action.
6. Run one stop/continue smoke campaign on the training machine before relying on the published calibration.

## Future Scope Beyond H3

This plan is scoped to the existing H3 calibration because that is the currently implemented probe, but calibration should not become permanently H3-only by design. A later pass should allow the same campaign, evidence, stop/continue, source-selection, and Settings patterns to support additional training architectures or model families where shape calibration provides real workflow value.

That future work should keep each calibration type explicit: its own probe plan, compatibility rules, safety thresholds, published settings, and versioned evidence. It must not treat H3 measurements as valid evidence for another architecture, or silently generalize H3-specific limits to a different model.

## Non-Goals

- Adding calibration to the managed training queue or history.
- Saving trainer checkpoints for individual probe shapes.
- Combining evidence across campaigns.
- Changing the fixed shape plan or calibration thresholds.
- Automatically starting calibration from source detection.
- Automatically deleting old calibration evidence.
- Accepting arbitrary source paths or shell commands.
- Changing how a completed calibration affects generated H3 buckets.

## Acceptance Criteria

- Stopping and continuing the same calibration never reruns a shape with valid conclusive evidence.
- Interrupted/incomplete shapes are retried without replacing other saved evidence.
- Resumed and uninterrupted campaigns produce the same ladder conclusions from the same evidence.
- At most one calibration process is active, and Stop terminates its active trainer process.
- Training Settings proposes a suitable current-folder clip or clearly asks the user to select/provide one.
- Calibration does not start without explicit confirmation.
- A resumed campaign cannot publish until its existing mixed-validation requirement passes.
- Normal training jobs, queue/history, checkpoint Resume, bucket logic, and calibration safety policy are unchanged.
