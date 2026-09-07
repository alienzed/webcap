# WebCap: LoRA Candidate Analysis

## Implemented v2

WebCap can inspect a recorded training run on demand from its Candidates action. The modal reads both TensorBoard streams directly from that run:

- `train/loss` is the detailed analytical signal, smoothed with a centered robust median and light mean whose sub-epoch windows derive from the run's typical detailed samples per completed epoch;
- `train/epoch_loss` provides the epoch-level raw/trend display and epoch boundaries;
- only confirmed broad low-loss basins are shaded and marked;
- one representative epoch for each confirmed basin;
- whether the corresponding `epochN` directory has one unambiguous `.safetensors` export.

The curve is always shown when scalar data exists. Candidate detection has no epoch gate, top-N quota, score UI, background worker, polling, cache, or persisted result. Reopening or refreshing the modal recomputes from the run directory.

## Detection boundary

The detector is deliberately small and deterministic. Scalar x values are not assumed to be optimizer steps: after latest-wall-time deduplication, detailed events are ordered by wall time and assigned to the first `train/epoch_loss` event at or after them. Events after the last completed epoch belong to the next, open epoch.

Basins are low stable detailed-loss regimes. Their membership has both upper and lower bounds around the local floor, so a sustained lower regime does not become part of the old basin. Overlapping intervals, and directly adjacent intervals from the same regime, are merged before choosing one representative. Confirmation uses right-hand robust detailed-loss evidence rather than a future-bleeding centered trend: a basin confirms only after sustained upward departure or entry into a distinctly lower regime. A later lower confirmed regime supersedes an older lower-exit shelf. A steadily descending or unresolved final tail remains visible but is not promoted.

The representative is the epoch with the lowest median detailed smoothed loss within that basin. Curve selection is independent of file availability: missing or ambiguous exports are reported and never substituted.

## Read-only guarantee

Candidate analysis never copies, moves, deletes, stages, renames, caches, or writes run artifacts, manifests, settings, checkpoints, or TensorBoard data. The server resolves the run from WebCap's recorded `folder` and `jobId`; the browser never supplies a filesystem path. It holds the runner lock only long enough to validate and copy recorded job metadata; TensorBoard parsing happens after release.

## Future work

Candidate testing may later gain its own explicit copy action. It must copy, never move, the selected `.safetensors` files into a configured test location. Controlled ComfyUI comparison remains separate future work: a fixed workflow, seed, prompt, and strength with only the candidate LoRA changing.
