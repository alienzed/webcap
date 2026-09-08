# WebCap: LoRA Candidate Analysis

Candidates is a manual, read-only inspection of one recorded run. Select one algorithm in the modal to rerun that analysis. V1 remains the default whenever the modal opens; the choice is not saved to application settings. Analysis version 8 identifies the selected algorithm explicitly.

## Four hypotheses

- **v1 · Epoch Regions:** the unchanged baseline, using detailed-loss epoch medians and a centered three-epoch trend. Its existing 800-step startup eligibility rule is preserved only for v1.
- **v2 · Step Stable Ranges:** a stable step-space range must earn its floor: it follows material descent, recovers a previously accepted floor after instability, or establishes a genuinely lower floor. Its checkpoint comes from the quiet interior.
- **v3 · Ranked Score Regions:** scalar desirability discovers peak or shelf neighborhoods. Meaningful score valleys split nearby neighborhoods; checkpoint selection then independently requires settled evidence and prefers local stability, centrality, and lowness.
- **v4 · Convergence Regimes:** macro trailing-versus-leading windows establish sustained descent followed by a sustained settled shelf. Brief pauses within a continuing descent are rejected.

## Step scales and checkpoint projection

Experimental modules are independent, pure Python calculations. V2–v4 form median/MAD cells spanning one eighth of the typical completed epoch, with a minimum width of three typical logging intervals. Equal **optimizer-step** widths make density changes affect temporal scale less than fixed sample-count windows. Noise is estimated from within-cell MAD and robust curvature.

V2/v4 require four cells of settled evidence. At a 200-step epoch and sufficiently dense logging, these correspond to approximately 100 steps of evidence; larger epochs imply longer scales. Boundaries are actual sampled step positions, not snapped epoch boundaries. Sparse data cannot resolve equally short structures. No experimental algorithm waits a fixed number of startup steps.

Range formation precedes checkpoint projection. Only completed epoch boundaries inside the range are eligible, even if only one fits. With several choices, centrality and local stability dominate a smaller relative-loss preference (v2: 55/35/10; v4: 65/30/5). V3 separates score discovery from projection, favoring a checkpoint entirely within settled evidence. A range with no contained completed checkpoint produces no candidate; artifact availability never moves the representative.

These scales and weights are experimental. Short ranges, imperfect shelves, noisy multi-concept runs, and sparse checkpoint schedules still need comparison on authoritative training-machine data. Synthetic fixtures establish behavior, not which algorithm is best.

## Common display and orchestration

The server reads TensorBoard `train/loss` and `train/epoch_loss`, normalizes finite scalar events with latest-wall-time deduplication, and maps detailed samples to completed epochs using completion wall times. Open-epoch samples are excluded. The last observed detailed step in each completed epoch is the existing checkpoint-step proxy; exact optimizer boundaries cannot be inferred if that stream omits them.

All algorithms share the same display curve: a centered median over roughly a quarter epoch, then a centered mean over roughly an eighth epoch. This suppresses isolated spikes with much less causal lag than the old EMA. `stepLossPoints` and `smoothedStepLossPoints` retain their public names; detectors do not consume the display series. The chart uses a 350-unit plot inside a 400-unit viewBox, versus 250/300 previously. Tooltip and marker lookups resolve by step.

TensorBoard reading, epoch metadata, artifact lookup, display smoothing, explicit dispatch, and response assembly stay in `training_candidates.py`. Mathematical detectors stay in their versioned modules. Unknown algorithm IDs fail visibly.

## Read-only guarantee

Analysis never writes, copies, moves, stages, renames, caches, or deletes run files. The server resolves a run from its recorded folder/job ID and releases the runner lock before reading TensorBoard. Saved artifacts are descriptive only and cannot alter mathematical output.

The separate experiments make real-run comparison possible before choosing a winner, retaining complementary options, or testing a hybrid. No algorithm is currently claimed to be best.
