This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-30.

> Training note: [Training Stabilization](training_stabilization.md) is the current authority for training behavior and deployment. Older profile, immutable-bundle, transcoding, preflight, recovery, and automatic-permission notes below are historical only where they conflict.

## Enhancements / Ideas


## Parked Design Notes (Not Current Backlog)

- [Wildcard template builder](../wildcard_template.md): deterministic caption-template generation. This remains an unimplemented concept, but is not queued for implementation.
- [QA panel](qa_panel.md): tag-similarity and likely-missing-tag signals. The current Curation Signals surfaces remain in place; this replacement proposal is not queued.
- [Model modules north star](model-modules.md): a larger training-architecture redesign. Do not start it piecemeal; current training profiles remain the supported structure.

## Completed (2026-08-29)

- Bucketing uses one explicit bucket per generated stanza. H3 Quality may split one image aspect-ratio cohort into as many as three resolution tiers and materializes those captured views as direct bucket-named folders; other image modes and temporal video remain direct, while only the marked video-detail cohort uses a subset.
- TensorBoard now has a global Training Queue status/open link, with optional explicit Start/Restart controls guarded by the `training.tensorboard_bruteforce_control` setting. It remains externally usable and is never started automatically; per-action TensorBoard filtering is deferred until TensorBoard has a stable, verified URL contract.

## Folder-State Safety

Completed (2026-08-28):

- A failed `.webcap_state.json` inspection or read is a loud error and blocks all state writes; it is never treated as an empty state.
- State-file replacement is atomic.
- Media rename carries every known per-media state association.
- Caption-read failures are visible in the server log, browser console, and UI status.
- A stale directory response cannot apply to a newly selected folder.
- A state snapshot retains associations that are outside the current visible list, including an empty SuperSet result view.
- Ratings and tags save immediately. Deferred state saves capture both their snapshot and folder before navigation, and per-folder writes remain ordered.
- An ordinary save that would wholesale-clear a populated ratings, tags, or flags map is refused loudly without changing the existing file.

Next — verification, in order:

1. Reproduce normal caption text filtering with readable captions. If it is still wrong, fix it independently from folder persistence.
2. Verify SuperSet navigation, filtered training selection, prune/restore, and Smart Set creation against real sets. These checks must not change stored set state.

No further persistence implementation is planned unless verification exposes a remaining real loss path. Deferred:

- Targeted read-modify-write endpoints or a larger persistence redesign.
- Folder-state backup/retention machinery.
- Moving or splitting `.webcap_state.json`.
- Broader permission-repair changes. The current automatic full-training-root `chmod -R` is too broad to expand, but it is not a direct deletion/truncation path for set state.

## Backlog (Do Not Implement Yet)
- Sometimes I want to bump the running training, test/start another, right now I have to Pause, reorder the queue and Resume, which is fine, but in this case what would be cool would be to like, with one button, swap the running process with the one below it. Is this a diminishing returns kind of feature where I just accept Pause, wait, reorder, resume? maybe just the reorder button for the first queued item gets enabled and triggers that swap?
- Background captured-run preparation before training. A Train request should persist an immutable preparation intent immediately, then show a distinct `preparing` queue state while a single, low-priority background worker builds the captured bundle (metadata scan, copy/transcode, captions, configs, manifests). Preparation must not claim the active GPU-training slot or block normal UI/API operations, but it should be serialized by default to avoid competing disk/CPU/WSL I/O with interactive work. Snapshot the selected files, fallback captions, config/mode, and source fingerprints at submission; fail visibly if source inputs change before or during capture rather than creating an ambiguous bundle. Support cancel/reorder/restart reconciliation and clean up incomplete bundle directories; only a fully materialized immutable bundle becomes `queued` and eligible to launch in FIFO order. Expose explicit phase/progress (`scanning`, `copying`, `transcoding`, `writing configs`, `ready`) and preserve a completed bundle exactly as today.
- Profile and instrument slow app operations before optimizing them: collect elapsed time and item counts for Caption Report assembly, dataset-manifest metadata refresh, media copying, per-video transcoding, config generation, and H3 probe preparation. Report phase timings in visible status/log output so WSL versus native-Linux behavior can be compared using real folders.
- Optimize Caption Report responsiveness for large visible sets. Yield after the initial status update so progress paints; avoid repeated visible-row-to-item linear lookups; replace or bound the current all-pairs Levenshtein similarity scan; and avoid duplicating full focus-file lists into many iframe DOM attributes/listeners. Preserve current report findings and focus-set behavior.
- Optimize H3 envelope-probe preparation without weakening its immutable seed. It currently refreshes metadata for the entire set before copying/transcoding one selected video; inspect only the selected file's cached/stale metadata and expose separate metadata/copy/transcode progress. The full H3 calibration runner remains design-only in `vram_bucket_calibration.md`; benchmark or diagnose actual calibration only on the training machine with supplied logs/telemetry.
- Verify on the training machine whether direct H3 training safely performs required caching and how cache freshness should be determined before removing the separate WebCap `--cache_only` phase.
- Add an assisted dataset-config editor for changing directories, frames, and compatible higher/lower resolutions, informed by model profiles and calibrated VRAM shapes, while retaining the raw text editor as a fallback.
- Consider run-owned overrides for queued settings such as learning rate, epochs, dropout, checkpoint frequency, and state-save frequency. Define how changing them interacts with the queued job’s immutable captured bundle before implementation.
- Expose the last saved checkpoint on a running job if real usage demonstrates enough value; checkpoint discovery already exists.
- Add indirect TensorBoard integration for individual jobs once a stable, verified TensorBoard URL contract can scope the view to a selected action or curves. Keep the current global TensorBoard ownership behavior unchanged.
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.
