# WebCap: LoRA Candidate Analysis

Candidates is a manual inspection of one recorded run. Multiscale Loss Basins is the default whenever the modal opens, and detector/display choices are not durable training decisions. Analysis version 13 identifies the selected algorithm explicitly.

Candidate Analysis currently suggests regions/epochs, describes saved artifacts, and can stage a saved epoch into Test Generations. It does **not** currently persist a human decision that one epoch is the chosen release/final training result.

## Available detectors

- **Multiscale Loss Basins:** the primary detector. A fixed .98 EMA is averaged at 100, 250, 500, and 1000 physical optimizer-step widths. Persistent, locally prominent basins are ranked by cross-scale support, floor depth, alignment, and historical-floor competitiveness; checkpoint projection uses the smoothed basin floor rather than a region midpoint.
- **Score Scalars · legacy baseline:** the preserved independent `train/epoch_loss` score-scalar calculation. It ranks epoch-loss local minima/plateaus by depth, local standard deviation, early-regime weighting, and a preceding eight-point trend bonus. Epoch number is its x-axis for regime detection, progress, and 15%-of-run grouping; optimizer end steps are retained only for display and checkpoint mapping.

## Checkpoint projection and display

Both detectors return only completed checkpoint epochs. Artifact availability is descriptive and never changes detector mathematics.

The candidate chart is display-only. It retains raw step loss as the faint reference and calculates the dominant smoothed curve locally with an EMA from raw `stepLossPoints`. The modal opens with smoothing 0.99 and Y bounds 0.10–0.30; these controls are modal-local, never change an algorithm or backend request, and Auto restores calculated Y bounds. The backend continues to return `smoothedStepLossPoints` for compatibility, but detectors and the chart EMA do not consume it.

## Common orchestration

The server reads TensorBoard `train/loss` and `train/epoch_loss`, normalizes finite scalar events with latest-wall-time deduplication, and maps detailed samples to completed epochs using completion wall times. Open-epoch samples are excluded. TensorBoard reading, epoch metadata, artifact lookup, explicit dispatch, and response assembly stay in `training_candidates.py`; mathematical detectors stay in their versioned modules. Unknown algorithm IDs fail visibly.

## Current mutation boundary

The analysis itself never rewrites detector data or run artifacts. Saved artifacts are descriptive. The surrounding Candidate Analysis workflow may explicitly copy/remove an already-saved epoch to/from the configured Test folder, but that is staging for evaluation, not a durable selection decision.

Synthetic fixtures establish algorithm behavior, not which algorithm is best for a real training run.

## Planned durable Selected epoch

The next training-lifecycle slice should add one explicit, human-owned decision: **Selected epoch**. "Release" may be used as UI wording later, but the durable concept is selection rather than another analyzer score.

Keep the states distinct:

1. **Suggested candidate** — analyzer output; recomputable and advisory.
2. **Saved epoch** — a checkpoint artifact physically exists.
3. **In Test Folder** — a saved artifact has been staged for evaluation.
4. **Selected epoch** — the user has confirmed this epoch as the chosen result of the run.
5. **Archived experiment** — the completed run has been finalized into long-term compact storage.

Selection must never be inferred from the detector, test staging, lowest loss, latest saved epoch, or filename. It is an explicit user action.

### Persistence ownership

Do not store Selected epoch primarily in Set state, Training History, or another global WebCap registry. Sets move independently, recent-history metadata is intentionally lightweight/fickle, and trainer output may later be compacted.

Persist the decision in a small manifest inside the trainer timestamp folder—the exact experiment folder that is retained when a completed run is archived:

```text
<trainer-timestamp-run>/
  webcap-run.json
```

Initial shape:

```json
{
  "schemaVersion": 1,
  "runId": "...",
  "selected": {
    "epoch": 44,
    "step": 8920,
    "selectedAt": "..."
  }
}
```

The manifest should stay deliberately small and portable. Selected-epoch knowledge must not depend on retaining the checkpoint file: the archive workflow intentionally allows epoch/checkpoint folders to be removed while preserving the TensorBoard logs and the selection fact.

Selection should be replaceable: choosing another saved epoch updates the one selected record rather than accumulating competing "winners". Clearing selection should also be explicit.

### Candidate Analysis behavior

Candidate Analysis is the natural place to make or change the selection because it already owns the curve, saved-epoch markers, and Test staging controls.

A selected epoch should be visually distinct from:

- analyzer suggestions;
- merely saved epochs;
- epochs currently staged for Test.

Selection does not itself copy, move, delete, or archive any files. It records the human conclusion only.

The archive/finalization lifecycle that consumes this selection is documented in [storage_manager_plan.md](storage_manager_plan.md).
