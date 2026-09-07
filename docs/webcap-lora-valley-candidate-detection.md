# WebCap: LoRA Candidate Analysis

## Implemented v1

WebCap can inspect a recorded training run on demand from its Candidates action. The modal reads `train/epoch_loss` directly from that run's TensorBoard event files and shows:

- raw epoch loss and a five-epoch rolling median;
- broad low-loss basins, with unresolved trailing basins kept tentative;
- one representative epoch for each confirmed basin;
- whether the corresponding `epochN` directory has one unambiguous `.safetensors` export.

The curve is always shown when scalar data exists. Candidate detection has no epoch gate, top-N quota, score UI, background worker, polling, cache, or persisted result. Reopening or refreshing the modal recomputes from the run directory.

## Detection boundary

The detector is deliberately small and deterministic. It smooths isolated noise, groups neighbouring minima into a stable basin, requires a basin to be broad, and confirms it only after the curve has clearly exited. A steadily descending final tail is therefore visible but not promoted as a candidate.

The curve selects the epoch independently of file availability. Missing or ambiguous exports are reported; WebCap does not substitute a different epoch.

## Read-only guarantee

Candidate analysis never copies, moves, deletes, stages, renames, caches, or writes run artifacts, manifests, settings, checkpoints, or TensorBoard data. The server resolves the run from WebCap's recorded `folder` and `jobId`; the browser never supplies a filesystem path.

## Future work

Candidate testing may later gain its own explicit copy action. It must copy, never move, the selected `.safetensors` files into a configured test location. Controlled ComfyUI comparison remains separate future work: a fixed workflow, seed, prompt, and strength with only the candidate LoRA changing.
