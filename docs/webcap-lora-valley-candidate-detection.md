# WebCap: LoRA Valley Candidate Detection

## Purpose

Automatically identify promising LoRA checkpoints from the training-loss curve and stage the corresponding `.safetensors` files into a deterministic test location.

The feature should reproduce the useful part of manually reviewing TensorBoard: finding **local minima that sit inside stable, meaningful valleys**, rather than simply choosing the globally lowest loss or isolated downward spikes.

The goal is not to replace visual evaluation. The goal is to ensure that, by the time a run appears complete, the small set of LoRAs most worth testing is already prepared in the correct folder.

---

## Scope

This feature is responsible for:

1. Reading the run's loss history.
2. Detecting meaningful loss valleys retrospectively.
3. Waiting until enough later training data exists to confirm a valley.
4. Selecting one representative epoch from each confirmed valley.
5. Resolving the LoRA `.safetensors` artifact associated with that epoch.
6. Copying confirmed candidates into a deterministic test folder.
7. Showing the detected valleys/candidates in WebCap.

### Explicitly out of scope

- Resume/checkpoint save scheduling.
- Autosave or "save on interesting progress" logic.
- Stopping training automatically.
- Declaring any candidate to be the objectively "best" LoRA.
- Visual or prompt-based quality evaluation.
- Generating a missing LoRA artifact from a resume checkpoint.

If a selected epoch does not currently have an inference-ready `.safetensors` artifact, WebCap should report the candidate as unresolved rather than introducing checkpoint/export behaviour into this subsystem.

---

## Core principle

A useful checkpoint is not normally identifiable at the exact moment it is produced.

For example, epoch 34 may look promising when it appears, but it may take epochs 35-40 to establish that epoch 34 was actually near the floor of a stable valley rather than a temporary downward fluctuation.

Therefore candidate detection is intentionally **retrospective and lagging**.

WebCap should observe first and copy later.

No provisional LoRA files should be staged while a valley is still forming.

---

## Desired behaviour

A typical run might look conceptually like this:

```text
loss
 |
 |\
 | \
 |  \_______
 |          \__          valley 1
 |             \____
 |                  \
 |                   \________
 |                            \__      valley 2
 |                               \____
 +------------------------------------------> epoch
```

WebCap should identify meaningful basins in the curve, wait until each basin is sufficiently established, and then select a representative epoch from it.

Example result:

```text
Valley 1: epochs 21-29
Representative: epoch 25
Status: confirmed

Valley 2: epochs 38-47
Representative: epoch 43
Status: confirmed
```

The resulting test folder might contain:

```text
<test-root>/<run-id>/
    valley-01__epoch-025.safetensors
    valley-02__epoch-043.safetensors
```

The exact root should be configurable, but naming within a run should be deterministic.

---

## Detection model

The important abstraction is the **valley**, not the individual low-loss point.

The previous checkpoint-scoring script approached this by scoring individual minima and then grouping distant candidates into regions. For WebCap, the region itself should become the primary object being detected and scored.

Each detected valley should have at least:

- start epoch
- end epoch
- floor epoch
- representative epoch
- local prominence/depth
- width
- local stability
- confirmation state
- confidence/quality score

---

## Input data

Minimum required input:

- training step or epoch
- training loss value
- mapping from training progress to epoch
- mapping from epoch to available LoRA `.safetensors` artifact, when present

The detector should work from the same scalar history already used for TensorBoard-style review.

If loss is logged multiple times per epoch, WebCap should preserve the detailed curve for analysis while still being able to map a detected candidate back to a concrete epoch/artifact.

---

## Loss preprocessing

Raw training loss is noisy. Candidate detection should operate primarily on a smoothed representation while retaining raw loss for spike rejection and display.

A simple deterministic smoothing method is preferred.

Good starting options:

- EMA, or
- centered rolling mean/median during retrospective analysis.

The algorithm should avoid excessive smoothing that merges distinct valleys.

Smoothing parameters should scale reasonably with run length rather than assuming every run is approximately 100 epochs.

---

## Valley detection

A valley is a sustained low-loss region bounded by meaningfully higher surrounding loss, or by a clear transition into and out of a lower regime.

A valley should be evaluated using several properties.

### 1. Local prominence

How far below the surrounding loss regime is the valley floor?

This is more important than simply comparing the valley against the global minimum of the entire run.

A valley at `0.178` surrounded by `0.205` may be more meaningful than a single `0.169` point inside a noisy `0.170-0.220` region.

### 2. Width

How long does the curve remain near the valley floor?

A broad low-loss basin should normally score better than a one-epoch dip.

### 3. Stability

How noisy is the loss inside the valley?

Useful measures include:

- local standard deviation
- average absolute first derivative
- frequency/magnitude of spikes

Stability should be normalized against typical variability elsewhere in the run so that the score has meaningful range.

### 4. Shape / maturity

A desirable valley generally has:

- a meaningful descent into it
- a comparatively stable low region
- subsequent evidence that the run either rose, changed regime, or moved on

A point that is still on a steep downward trajectory should not immediately be treated as a completed valley.

### 5. Raw-spike rejection

An isolated raw-loss minimum should not become a candidate merely because it is numerically low.

The selected epoch should agree reasonably well with the local smoothed structure.

---

## Valley confirmation

A valley begins as tentative and becomes confirmed only after enough future data exists.

The confirmation horizon should be bounded and adaptive rather than a single hard-coded value.

A reasonable initial target is approximately **3-9 later epochs**, depending on run shape and epoch density.

A valley can be considered confirmed when one or more of the following becomes clear:

- loss rises meaningfully away from the basin
- a new regime begins
- loss remains outside the basin for several epochs
- no new meaningful low appears within the basin for the confirmation horizon

The detector must not copy any file while the valley is still tentative.

### End-of-run handling

The final valley may never receive a clean right-hand boundary because training stops while still inside it.

When a run is explicitly complete, WebCap should perform a final retrospective pass and may accept a trailing valley with reduced confidence if it is otherwise sufficiently broad and stable.

---

## Representative epoch selection

Once a valley is confirmed, WebCap should select the epoch most representative of the basin.

The representative should normally be:

- near the local minimum of the smoothed curve
- inside the stable portion of the basin
- not an isolated raw-loss spike
- associated with an available LoRA artifact, if possible

The exact raw minimum does not have to win if a neighbouring epoch is more representative of the stable valley.

Default behaviour should be **one staged LoRA per confirmed valley**.

A future enhancement could allow two representatives from an unusually broad valley, but v1 should keep the candidate set small.

---

## Valley scoring

Valleys should be ranked primarily by their local structure rather than absolute global loss.

A conceptual score can combine:

```text
valley quality =
    local prominence
  + width
  + stability
  + mature valley shape
  - spike/noise penalty
```

Absolute loss level may be included as a weak factor or tie-breaker, but it should not cause late-training minima to automatically dominate earlier stable valleys.

The score should remain deterministic and inspectable. There is no need for an ML model.

---

## Candidate count and separation

The system should aim to produce a small shortlist rather than every mathematically valid minimum.

Initial defaults:

- one representative per confirmed valley
- maximum of roughly 3-6 staged candidates per run
- require meaningful separation between valleys so one broad basin does not produce several nominally different regions

These should be tunable after observing real runs.

---

## Artifact staging

Files are copied only after a valley is confirmed and its representative epoch is selected.

There should be no provisional file churn.

Recommended naming:

```text
valley-01__epoch-025.safetensors
valley-02__epoch-043.safetensors
valley-03__epoch-067.safetensors
```

Requirements:

- deterministic destination path
- deterministic ordering
- original source artifact remains untouched
- copy through a temporary filename and rename atomically when practical
- do not silently overwrite an unrelated file
- record enough metadata for WebCap to show which source epoch/run produced the staged candidate

A minimal manifest may be useful:

```json
{
  "run_id": "...",
  "candidates": [
    {
      "valley": 1,
      "start_epoch": 21,
      "end_epoch": 29,
      "representative_epoch": 25,
      "source": "...",
      "staged": "valley-01__epoch-025.safetensors"
    }
  ]
}
```

The manifest is secondary to the deterministic files themselves and should not become a source of unnecessary complexity.

---

## Re-analysis behaviour

During an active run, tentative valleys may change freely in memory/UI because nothing has been copied yet.

Once a valley is confirmed and staged, it should normally remain stable.

WebCap may later provide an explicit **Re-analyze candidates** action for a completed run. That operation can rebuild the deterministic candidate folder from scratch.

Automatic background churn of already-confirmed files should be avoided.

---

## UI

The feature should make its reasoning visible without requiring the user to trust a black box.

Useful UI elements:

- loss graph with detected valley spans
- marker on each representative epoch
- tentative vs confirmed state
- valley score/confidence
- representative epoch
- source artifact status
- staged destination path

Example:

```text
LoRA candidates

✓ Valley 1   epoch 25   broad stable minimum    staged
✓ Valley 2   epoch 43   deeper mature basin     staged
… Valley 3   forming around epoch 61            tentative
```

The UI should remain secondary to the automation: the main value is that the right files are already waiting for testing.

---

## Failure / edge cases

### No meaningful valleys

Do not manufacture candidates merely to satisfy a quota.

A monotonic or highly noisy run may legitimately produce none.

### Missing artifact

If the selected epoch has no `.safetensors` artifact:

- keep the detected valley/candidate in the analysis
- mark staging as unresolved
- do not silently substitute a distant epoch unless a clearly defined nearest-eligible rule is added later

### Very short runs

Scale windows and confirmation requirements down conservatively. If there is insufficient future context, prefer no candidate over a false claim of confidence.

### Flat runs

A long flat region should not automatically become a high-quality valley unless it is meaningfully lower than the preceding regime.

### Multiple nearby minima

Treat them as one valley when they belong to the same stable basin.

---

## Suggested v1 implementation sequence

1. Reuse existing loss-history ingestion.
2. Add smoothed loss series.
3. Detect tentative valleys from the smoothed curve.
4. Compute valley boundaries, prominence, width, and stability.
5. Add retrospective confirmation with bounded look-ahead.
6. Select one representative epoch per confirmed valley.
7. Resolve the associated `.safetensors` path.
8. Copy confirmed candidates atomically into the deterministic test folder.
9. Overlay valleys and representative markers in the WebCap graph.
10. Tune thresholds against several completed H3 runs that have already been manually reviewed in TensorBoard.

---

## Acceptance criteria

The feature is successful when:

- WebCap identifies the same general low/stable regions a human would inspect in TensorBoard.
- It does not promote isolated downward spikes as strong candidates.
- It waits for later epochs before confirming a valley.
- It produces only a small, useful shortlist.
- Confirmed candidates are copied automatically into the configured deterministic test folder.
- A completed run can be opened and its staged LoRA candidates are already ready for visual comparison.
- The detector remains advisory: final LoRA quality is still determined by actual generation tests, not loss alone.

---

## Design summary

The intended workflow is:

```text
training loss accumulates
        ↓
WebCap smooths and observes the curve
        ↓
tentative valley forms
        ↓
3-9+ later epochs provide enough context
        ↓
valley becomes confirmed
        ↓
WebCap chooses representative epoch
        ↓
corresponding LoRA .safetensors is staged
        ↓
run finishes with a small test-ready candidate set
```

The core rule is simple:

> **Detect valleys retrospectively, stage only confirmed candidates, and let visual testing decide the winner.**
