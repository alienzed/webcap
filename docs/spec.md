# WebCap Specification (Current Behavior)

Last updated: 2026-07-18

## Scope and architecture

WebCap is a local-first media curation, captioning, dataset-preparation, and managed Diffusion Pipe training app. It uses Flask on the backend, classic global JavaScript in the browser, and file-based state beside the user's sets.

Key on-disk artifacts are:

- `*.txt`: caption sidecars
- `.webcap_state.json`: per-set state
- `media_metadata.json`: metadata cache
- `originals/`: reversible-mutation backing store
- `auto_dataset/`: prepared media, manifest, and generated training plan

## Set workflow

1. Browse, filter, annotate, review, and curate media in a normal set folder.
2. Prepare the currently visible subset into `auto_dataset/`; the manifest records the selected subset.
3. In Training, choose a supported profile, generate the profile's dataset/config artifacts, then preview, run, or queue its valid run option.
4. Monitor jobs in the shared managed queue or use a copied manual WSL command for an external handoff.

`originals`, `auto_dataset`, and `src_videos` have protected/system semantics. Set-folder mutations preserve originals where the workflow requires reversibility.

## Training profiles

Supported profiles are Wan2.2 T2V, Krea2 Raw, and Wan2.1 T2V 14B. The profile registry owns each profile's supported media, TOML files, run options, and standard DeepSpeed launch behavior.

- Wan2.2 supports image/video preparation and separate HI and LO configs/datasets. HI -> LO queues two independent jobs.
- Krea2 Raw is image-only and uses `config.krea2.toml` with `dataset.train.toml`.
- Wan2.1 supports normal image/video preparation and uses `config.wan21.toml` with `dataset.train.toml`.
- All newly written configs in one set share a three-character base-36 output directory under `output/runs/`.

See [training_profiles.md](training_profiles.md) and [train.md](train.md).

## Configuration behavior

Training templates are not created on ordinary folder load. Generate, manual preview, and managed launch create missing files for the selected profile. Existing TOML is preserved; Reset is the explicit per-file template replacement action. Config TOML is edited in the central editor with dedicated config read/save routes.

## Managed training

Managed training starts the selected profile/run immediately when idle or places it in the queue. Each new launch reserves a global three-character base36 group and a profile/stage output directory; HI → LO shares its group across two independent jobs, while resume retains its existing output. It provides effective-output visibility and folder actions, output logs, per-job progress, artifact-derived queued-resume progress, completion and checkpoint ETA where trainer timing supports them, queue ordering, explicit failure holds, pause, finish, queued-item cancellation, history, resume, GPU status, diagnostics, and TensorBoard controls.

Manual command generation reserves the launch output, materializes output-resolved config snapshots, and copies commands but never launches a process.

## Guardrails

- Destructive media actions are explicit and use backups when reversible behavior is expected.
- Prepare operates on the visible subset and records that scope.
- Krea2 generation and launch reject prepared video data.
- Required failures are surfaced in the UI/console rather than silently ignored.
