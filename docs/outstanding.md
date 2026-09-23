This file tracks implemented work vs outstanding items.
Last reviewed: 2026-09-23.

> Training note: [Training Stabilization](training_stabilization.md) is the current authority for training behavior and deployment. Older profile, immutable-bundle, transcoding, preflight, recovery, and automatic-permission notes below are historical only where they conflict.

## Enhancements / Ideas

- **Storage Manager — explicit scan + lightweight usage registration.** Keep ordinary Storage loads cheap, but add a clear **Start scan** action for users who want a current workspace-wide disk picture. The scan may be expensive because it is explicit: recurse only declared WebCap-owned scopes/Set boundaries, do not follow symlinks, expose progress/cancellation, count bytes/files, and use the pass to discover historical distributed Test Sessions. Producer workflows may also opportunistically register only basic usage provenance when they already know it cheaply (producer/item identity, bytes, file count, measurement time/source). These records are reporting hints only; Delete/Purge must continue to re-resolve live ownership and references.
- **Selected epoch / concept-maturity record.** Allow the user to mark one saved epoch per run/stage as **Selected** after candidate testing. Reuse the existing Candidate Analysis/TensorBoard substrate rather than inventing a second metrics pipeline. Show/store a small derived snapshot that can answer “when did this concept become good enough?”: selected epoch, optimizer step, progress through the planned run, epoch loss, robust/smoothed step-loss context, stable-region/basin context, training time to that point when it can be grounded, and Test rating average/count when available. Surface the selection in Candidate Analysis and Training History so selected runs can later be compared by time/steps/epochs-to-maturity. Keep the user’s selection as the judgment; analytics explain it rather than choosing the winner.


## Parked Design Notes (Not Current Backlog)

- [Wildcard template builder](../wildcard_template.md): deterministic caption-template generation. This remains an unimplemented concept, but is not queued for implementation.
- [QA panel](qa_panel.md): tag-similarity and likely-missing-tag signals. The current Curation Signals surfaces remain in place; this replacement proposal is not queued.
- [Model modules north star](model-modules.md): a larger training-architecture redesign. Do not start it piecemeal; current training profiles remain the supported structure.

## Completed (2026-08-29)

- Bucketing uses one explicit bucket per generated stanza; only the marked video-detail cohort uses a subset.

## Completed (2026-09-03)

- H3 calibration now persists conclusive per-shape evidence in Settings, reuses it on fresh probe launches for matching total RAM/GPU model/VRAM hardware, derives direct known-safe 17f/34f/68f ceilings without mixed validation, and is owned by Training Settings rather than the media context menu. Generated H3 defaults retain a two-rung margin below the exact selectable calibrated ceiling.

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

## Public Usability / Distribution

Longer-term direction for making WebCap practical outside the current development/training-machine setup. These are product/distribution goals, not an implementation plan yet.

- **Manage external tool checkouts instead of assuming hand-built environments.** Investigate a supported way for WebCap to obtain, configure, update, and start external projects it depends on or integrates with, including Diffusion Pipe, TensorBoard, and ComfyUI. Requiring every external environment to be manually perfected should not be the long-term installation model.
- **Keep WSL on Windows as a supported deployment pattern, not the only architecture.** Paths, runtime settings, launchers, and filesystem boundaries should be explicit enough for Windows + WSL, native Linux, and other viable local layouts to bridge correctly without baking one machine topology into training behavior.
- **Expand environment diagnostics toward assisted setup.** The existing environment test should eventually be able to identify missing Python/runtime dependencies and, where safe and explicit, install supported versions into the configured training environment/venv. Dependency repair must remain visible and deliberate rather than silently mutating environments.
- **Document and link the remaining external prerequisites.** Where WebCap cannot or should not automate a requirement, provide direct links and concise setup guidance that bridge the gap between what WebCap provides and what the user must obtain/configure. The existing Hugging Face model links are the pattern to extend.

## Completed (2026-09-23)

- The approved training-layout/Resume change is implemented as documented in `stable_set_training_layout_plan.md`.
- Storage Manager MVP plus the post-MVP hostile-audit hardening are implemented: producer-owned inventory, item-scoped measurement, protected Set accounting, identity-scoped deletion, active/reference checks, H3/staged-LoRA/runtime coverage, and bounded exact-prefix ComfyUI residual detection. The remaining Storage work is the explicit scan/reporting enhancement above, not a safety blocker.
- Storyboard Takes support explicit permanent **Delete Take** alongside the existing reversible Remove/Restore flow. Deletion removes Take media and metadata, requires destructive confirmation, warns when the selected Take will leave the Scene unselected, and refuses deletion while the same media is still a live Scene reference.

## Backlog (Do Not Implement Yet)
- Optional model-native video FPS normalization during training capture/materialization: an advanced, default-off per-run option that converts only isolated capture media to Wan 16 fps or MiniMax H3 24 fps while preserving duration and audio. Keep reusable set-folder media model-neutral; see `training_profiles.md`.
- Sometimes I want to bump the running training, test/start another, right now I have to Pause, reorder the queue and Resume, which is fine, but in this case what would be cool would be to like, with one button, swap the running process with the one below it. Is this a diminishing returns kind of feature where I just accept Pause, wait, reorder, resume? maybe just the reorder button for the first queued item gets enabled and triggers that swap?
- Background captured-run preparation before training. A Train request should persist an immutable preparation intent immediately, then show a distinct `preparing` queue state while a single, low-priority background worker builds the captured bundle (metadata scan, copy/transcode, captions, configs, manifests). Preparation must not claim the active GPU-training slot or block normal UI/API operations, but it should be serialized by default to avoid competing disk/CPU/WSL I/O with interactive work. Snapshot the selected files, fallback captions, config/model/stage, and source fingerprints at submission; fail visibly if source inputs change before or during capture rather than creating an ambiguous bundle. Support cancel/reorder/restart reconciliation and clean up incomplete bundle directories; only a fully materialized immutable bundle becomes `queued` and eligible to launch in FIFO order. Expose explicit phase/progress (`scanning`, `copying`, `transcoding`, `writing configs`, `ready`) and preserve a completed bundle exactly as today.
- Profile and instrument slow app operations before optimizing them: collect elapsed time and item counts for Caption Report assembly, dataset-manifest metadata refresh, media copying, per-video transcoding, config generation, and H3 probe preparation. Report phase timings in visible status/log output so WSL versus native-Linux behavior can be compared using real folders.
- Optimize Caption Report responsiveness for large visible sets. Yield after the initial status update so progress paints; avoid repeated visible-row-to-item linear lookups; replace or bound the current all-pairs Levenshtein similarity scan; and avoid duplicating full focus-file lists into many iframe DOM attributes/listeners. Preserve current report findings and focus-set behavior.
- Benchmark H3 calibration only on the training machine with supplied logs/telemetry; this development machine cannot establish real Diffusion Pipe/GPU behavior.
- Verify on the training machine whether direct H3 training safely performs required caching and how cache freshness should be determined before removing the separate WebCap `--cache_only` phase.
- Add an assisted dataset-config editor for changing directories, frames, and compatible higher/lower resolutions, informed by model profiles and calibrated VRAM shapes, while retaining the raw text editor as a fallback.
- Consider run-owned overrides for queued settings such as learning rate, epochs, dropout, checkpoint frequency, and state-save frequency. Define how changing them interacts with the queued job’s immutable captured bundle before implementation.
- Expose the last saved checkpoint on a running job if real usage demonstrates enough value; checkpoint discovery already exists.
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.
