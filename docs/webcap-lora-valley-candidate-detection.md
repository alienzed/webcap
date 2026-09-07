# WebCap: LoRA Candidate Analysis

## Implemented v3

Candidates is a manual, read-only inspection of one recorded run. It reads `train/loss` and `train/epoch_loss` directly from TensorBoard. The modal shows raw epoch loss, a robust detailed-loss trend, candidate regions, and saved-artifact status.

## Analysis

`train/epoch_loss` wall times mark completed-epoch boundaries. After latest-wall-time scalar deduplication, each `train/loss` event is assigned to the first completion boundary at or after it. The median of the detailed samples in each completed epoch becomes the robust analytical series; events after the final completion belong to the open next epoch and are not analyzed.

The analytical series receives only a three-epoch centered median. WebCap derives a relative movement scale from its adjacent epoch-to-epoch changes. A settled region is a contiguous group of local minima or locally quiet points whose trend values remain close on that scale. This groups wobble within one shelf, separates a meaningful departure into another regime, and does not require an exit before recommending a region. A current tail is a candidate only when its recent movement is quiet; a continuing descent is not.

One candidate is selected per region: the epoch with the lowest robust detailed-loss median, with epoch number breaking an exact tie. Artifact availability never changes that mathematical choice.

## Read-only guarantee

Analysis never writes, copies, moves, stages, renames, caches, or deletes run files. The server resolves the run only from its recorded `folder` and `jobId`; TensorBoard parsing occurs after the runner lock is released.

## Future work

Candidate testing may later gain an explicit copy action. It must copy, never move, selected `.safetensors` files to a configured test location. Controlled ComfyUI comparison remains separate future work.
