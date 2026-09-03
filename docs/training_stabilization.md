# Training Stabilization

Last updated: 2026-08-31.

This document is the authoritative record for the stabilized training contract and its clean deployment. It replaces earlier profile-oriented, recovery-oriented, and immutable-bundle planning documents where they conflict.

## Phase 1 Contract

- WebCap is a local command, configuration, set, and queue convenience layer. Diffusion Pipe remains the trainer.
- MiniMax H3, Krea2, WAN2.1, WAN2.2 High, and WAN2.2 Low are separate model/stage choices. There are no user-facing training profiles or combined WAN2.2 action.
- Each set owns one canonical config TOML and dataset TOML for each supported model/stage. They are the source of truth and remain directly editable.
- A missing canonical TOML is materialized from its template. An existing invalid or unreadable TOML fails visibly and is never replaced automatically. Reset is the explicit regeneration action.
- The bucket Review is an optional TOML editor/visualizer. Managed video targets must be exact members of the current model policy; a valid TOML that cannot be represented remains raw/custom, is not rewritten, and does not block Train.
- Review assigns every valid image once to its closest selected target. Default targets use one, two, or at most three clearly supported native-resolution clusters. It shows native distribution, target assignments, and resize pressure without thumbnails or per-file grids.
- Video keeps its existing Temporal/Detail roles and fixed frame counts. Its spatial distribution is visible in Review; media can participate in both roles.

## Capture and Queue

Clicking Train flushes the set TOMLs and synchronously captures the current media, captions, TOMLs, and optional initializer before a queue row is written. A failed capture is loud and creates no queue item. A partial capture directory is intentionally left for manual inspection or deletion.

Every capture copies source media byte-for-byte. WebCap does not transcode, silently skip media, normalize training permissions, run environment preflight, or clean up action folders.

Fresh actions use this layout:

```text
runs/<global-sequence>-<set-slug>--<set-path-hash>/<sequence>-<model>/
  action.json
  captures/<job-id>/
    config.toml
    dataset.toml
    media/
    summary.json
  jobs/<job-id>/
    runner.sh
    run.log
    result.json
  output/
```

The JSON files contain practical paths, model/stage, timestamps, and counts only. They are not a recovery graph or a competing source of truth.

The queue and Recent Runs are disposable convenience state. Missing files mean empty state; malformed existing files fail visibly. On restart, an in-progress item becomes the first queued resumable item and the queue stays paused until Resume is pressed. WebCap does not scan training output to reconstruct state.

Managed Resume reuses its current-set logical run and captures current inputs again. Custom Resume validates its explicit checkpoint before mutation, then creates a new logical run; it reads the external source without writing beside it. Managed discovery is current-set-only and shallow. H3 Resume runs cache-only against the current capture before resumed training.

Pause, Finish, and Finish After Epoch request a fresh checkpoint. Pause returns resumable work to the front and pauses the queue. Finish records Finished Early and advances it.

An Init LoRA is a fresh action. Select a current-set managed epoch export or an explicit `.safetensors` file/initializer directory; WebCap copies it into the capture and lets the actual launch report any incompatibility.

Diagnostics remains available as an explicit installation/troubleshooting action. Train never requires it.

## Development Acceptance

The focused stabilization tests and the complete repository suite must pass before deployment. These tests cover canonical TOML materialization/reset/failure behavior, inclusive bucket assignment and visualization data, direct video/media capture, queue atomicity, restart normalization, resume capture, history behavior, no training-root chmod, and the unchanged captioning suite.

## Training-Machine Deployment Reset

Do this only after the current old-version training job completes.

1. Stop the old WebCap instance.
2. Preserve every set, caption, canonical TOML, run/action folder, checkpoint, and Diffusion Pipe output directory.
3. Move aside the disposable `.webcap_training` queue/history state.
4. Deploy this revision. Do not import, migrate, scan, repair, or reconstruct the old runtime state.
5. Start WebCap. It should treat the missing convenience files as a clean slate.
6. Run one small MiniMax H3 golden path: capture, queue, launch, checkpoint, Pause, Resume using the same output, then Finish.
7. Use Diagnostics only if that launch log points to an environment failure.

Passing development tests means the implementation is internally coherent. Live training stability is established only after this smoke test succeeds on the training machine.

## Deferred Phase 2

- AR tolerance, recropping behavior, and crop-versus-caption mismatch.
- Cancel/rollback drafts in Training Review.
- Richer hover or per-file analysis.
- Cluster-threshold and supported-shape calibration from real training.
- Focused NTFS/WSL permission diagnosis from a reproduced failure.
- Background capture progress and TensorBoard refinements.

Automatic filesystem discovery, recovery graphs, destructive cleanup, and robust reconstruction are explicitly out of scope until a demonstrated workflow requires them.
