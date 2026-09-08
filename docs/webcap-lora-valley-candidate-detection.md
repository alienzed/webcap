# WebCap: LoRA Candidate Analysis

Candidates is a manual, read-only inspection of one recorded run. V1 remains the default whenever the modal opens, and selection is not saved to application settings. Analysis version 10 identifies the selected algorithm explicitly.

## Five hypotheses

- **v1 · Epoch Regions:** unchanged baseline using detailed-loss epoch medians and a centered three-epoch trend. Its 800-step startup eligibility rule applies only to v1.
- **v2 · Step Stable Ranges:** the restored baseline: robust equal-step cells are locally low, quiet, and flat; one compatible interruption may bridge; anchored level/spread changes split ranges; whole-range drift rejects continuing movement.
- **v3 · Score Scalars:** the original `train/epoch_loss` score scalar calculation. It ranks epoch-loss local minima/plateaus by depth, local standard deviation, early-regime weighting, and a preceding eight-point trend bonus. Epoch number is its x-axis for regime detection, progress, and 15%-of-run grouping; optimizer end steps are retained only for display and checkpoint mapping.
- **v4 · Convergence Regimes:** macro trailing-versus-leading windows establish sustained descent followed by a sustained settled shelf. Brief pauses within continuing descent are rejected.
- **v5 · Multiscale Loss Basins:** a fixed .98 EMA is averaged at 100, 250, 500, and 1000 physical optimizer-step widths. Persistent, locally prominent basins are ranked by cross-scale support, floor depth, alignment, and historical-floor competitiveness; checkpoint projection uses the smoothed basin floor rather than a region midpoint.

## Checkpoint projection and display

All detectors consume completed detailed-loss points and return only completed checkpoint epochs. Artifact availability is descriptive and never changes detector mathematics.

The candidate chart is display-only. It retains raw step loss as the faint reference and calculates the dominant smoothed curve locally with an EMA from raw `stepLossPoints`. The modal opens with smoothing 0.99 and Y bounds 0.10–0.30; these controls are modal-local, never change an algorithm or backend request, and Auto restores calculated Y bounds. The backend continues to return `smoothedStepLossPoints` for compatibility, but detectors and the chart EMA do not consume it.

## Common orchestration

The server reads TensorBoard `train/loss` and `train/epoch_loss`, normalizes finite scalar events with latest-wall-time deduplication, and maps detailed samples to completed epochs using completion wall times. Open-epoch samples are excluded. TensorBoard reading, epoch metadata, artifact lookup, explicit dispatch, and response assembly stay in `training_candidates.py`; mathematical detectors stay in their versioned modules. Unknown algorithm IDs fail visibly.

## Read-only guarantee

Analysis never writes, copies, moves, stages, renames, caches, or deletes run files. Saved artifacts are descriptive only. Synthetic fixtures establish algorithm behavior, not which algorithm is best for a real training run.
