# WebCap: LoRA Candidate Analysis

## Selectable candidate algorithms

Candidates is a manual, read-only inspection of one recorded run. It reads `train/loss` and `train/epoch_loss` directly from TensorBoard. The modal lets the reviewer compare one algorithm at a time, while showing loss data, candidate regions, and saved-artifact status. The selected algorithm is session-local and is never saved as an application setting.

- v1 · Epoch Regions is the preserved baseline. It uses the established epoch-median and centered epoch-trend settled-region calculation.
- v2 · Step Stable Ranges is experimental. It detects low, quiet, non-descending ranges from the detailed `train/loss` curve in step space, then chooses an interior completed checkpoint using centrality, local quietness, and relative low loss.

Artifact availability is descriptive for both algorithms. It never affects range detection or representative checkpoint selection.

## Shared analysis

`train/epoch_loss` wall times mark completed-epoch boundaries. After latest-wall-time scalar deduplication, each `train/loss` event is assigned to the first completion boundary at or after it. The median of the detailed samples in each completed epoch becomes the robust analytical series; events after the final completion belong to the open next epoch and are not analyzed.

The preserved v1 analytical series receives only a three-epoch centered median. WebCap derives a relative movement scale from its adjacent epoch-to-epoch changes. A settled region is a contiguous group of local minima or locally quiet points whose trend values remain close on that scale.

The experimental v2 signal uses centered rolling medians and median absolute deviations, with windows derived from the typical detailed-sample count per completed epoch. It suppresses isolated spikes, merges short internal interruptions, excludes materially descending spans, and requires a sustained range before projecting it to completed checkpoint boundaries. V2 remains experimental until it is compared against authoritative training-run data.

## Read-only guarantee

Analysis never writes, copies, moves, stages, renames, caches, or deletes run files. The server resolves the run only from its recorded `folder` and `jobId`; TensorBoard parsing occurs after the runner lock is released.

## Future work

Candidate testing may later gain an explicit copy action. It must copy, never move, selected `.safetensors` files to a configured test location. Controlled ComfyUI comparison remains separate future work.
