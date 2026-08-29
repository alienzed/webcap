This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-28.

## Enhancements / Ideas
- [LoRA initializer runs](lora_initializer.md): start a new run from an existing LoRA directory without resuming checkpoint state.

## MAJOR
Bucketing and folder materialization has gotten too fancy - it's become very obscure in terms of confidence that I am training on what I think I am, we need to simplifiy or possibly roll some things back... the worries about upscaling are one thing, worries about the wrong bucket being selected (based on closest AR match) are valid, but these may be symptoms of overly complex selection anyway, let's find a simpler middle ground, or at least properly distinguish the complexity by profile, and make sure this app handles these efficiently, not 20 logic branches per model/profile.

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
- Background captured-run preparation before training. A Train request should persist an immutable preparation intent immediately, then show a distinct `preparing` queue state while a single, low-priority background worker builds the captured bundle (metadata scan, copy/transcode, captions, configs, manifests). Preparation must not claim the active GPU-training slot or block normal UI/API operations, but it should be serialized by default to avoid competing disk/CPU/WSL I/O with interactive work. Snapshot the selected files, fallback captions, config/mode, and source fingerprints at submission; fail visibly if source inputs change before or during capture rather than creating an ambiguous bundle. Support cancel/reorder/restart reconciliation and clean up incomplete bundle directories; only a fully materialized immutable bundle becomes `queued` and eligible to launch in FIFO order. Expose explicit phase/progress (`scanning`, `copying`, `transcoding`, `writing configs`, `ready`) and preserve a completed bundle exactly as today.
- Profile and instrument slow app operations before optimizing them: collect elapsed time and item counts for Caption Report assembly, dataset-manifest metadata refresh, media copying, per-video transcoding, config generation, and H3 probe preparation. Report phase timings in visible status/log output so WSL versus native-Linux behavior can be compared using real folders.
- Optimize Caption Report responsiveness for large visible sets. Yield after the initial status update so progress paints; avoid repeated visible-row-to-item linear lookups; replace or bound the current all-pairs Levenshtein similarity scan; and avoid duplicating full focus-file lists into many iframe DOM attributes/listeners. Preserve current report findings and focus-set behavior.
- Optimize H3 envelope-probe preparation without weakening its immutable seed. It currently refreshes metadata for the entire set before copying/transcoding one selected video; inspect only the selected file's cached/stale metadata and expose separate metadata/copy/transcode progress. The full H3 calibration runner remains design-only in `vram_bucket_calibration.md`; benchmark or diagnose actual calibration only on the training machine with supplied logs/telemetry.
- Verify on the training machine whether direct H3 training safely performs required caching and how cache freshness should be determined before removing the separate WebCap `--cache_only` phase.
- Add exact Clip frame navigation using asynchronous `ffprobe` frame timestamps with immutable-file caching, previous/next-frame controls, and exact `Mark Start`. Keep it separate from automatic clarity analysis and expose indexing failures visibly.
- Add an assisted dataset-config editor for changing directories, frames, and compatible higher/lower resolutions, informed by model profiles and calibrated VRAM shapes, while retaining the raw text editor as a fallback.
- Consider run-owned overrides for queued settings such as learning rate, epochs, dropout, checkpoint frequency, and state-save frequency. Define how changing them interacts with the queued job’s immutable captured bundle before implementation.
- Expose the last saved checkpoint on a running job if real usage demonstrates enough value; checkpoint discovery already exists.
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.
