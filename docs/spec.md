# WebCap Specification (Current Behavior)

Last updated: 2026-08-15

## Scope and architecture

WebCap is a local-first media curation, captioning, dataset-configuration, and managed Diffusion Pipe training app. It uses Flask, classic global JavaScript, and file-based state beside the user's sets.

Key set-owned artifacts are:

- `*.txt`: caption sidecars
- `.webcap_state.json`: per-set state
- `media_metadata.json`: metadata cache
- `originals/`: reversible-mutation backing store
- model/stage-specific training config and dataset TOMLs

## Set and training workflow

1. Browse, filter, annotate, review, and curate media in a set folder.
2. Open Training and select a supported model.
3. Inspect or edit that setup's persistent config and dataset TOMLs. Selecting a setup creates only missing files; **Reset** intentionally replaces one file.
4. Filter or focus the media grid to the exact items to train.
5. Train, queue, or generate a manual command. The action captures the visible media, latest captions, exact saved TOMLs, and run plan in an immutable bundle under the numbered output folder.

Queued and running jobs use their captured bundle and are independent of later changes to the source set. There is no separate user-facing dataset preparation state.

## Training profiles

Supported profiles are Wan2.2 T2V, Krea2 Raw, Wan2.1 T2V 14B, and MiniMax H3. The app-owned profile registry defines media support, persistent filenames, run options, and standard DeepSpeed launch behavior.

- Wan2.2 accepts images and videos and owns separate HI and LO setup files. High and Low are independent runs with separate captures.
- Krea2 Raw is image-only and owns `config.krea2.toml` and `dataset.train.toml`.
- Wan2.1 accepts images and videos and owns `config.wan21.toml` and `dataset.train.toml`.
- MiniMax H3 accepts images and videos and owns `config.h3.toml` and `dataset.train.toml`.
- App Settings can hide profiles from new-run selection. All are enabled by default; disabling one never deletes files or run data.

See [training_profiles.md](training_profiles.md) and [train.md](train.md).

## Configuration behavior

Selecting a profile creates only its missing TOMLs and shows only the applicable files in Training. Existing TOMLs are preserved. Training config Reset restores the appropriate template source; dataset Reset recalculates that one file from currently visible media metadata without copying media.

Train saves the open TOML before capture. Captured copies preserve inspected values except for app-owned runtime paths: output directory, training-config dataset path, and dataset media directories.

## Run ownership and output

Each Train action reserves a logical run under its deterministic set root:

```text
output/runs/<set-slug>--<set-path-hash>/<numbered-logical-run>/captures/
```

The logical run also owns `jobs/` and `output/`. The bundle contains grouped media, captions, copied TOMLs, `dataset_manifest.json`, and `training_plan.json`; caches live with captured media.

Managed Resume is shallow current-set discovery; Custom Resume validates an explicit checkpoint directly and creates a new logical run. The manual command path uses the same capture materializer but never launches a process.

## Guardrails

- Destructive media actions are explicit and use backups where reversibility is expected.
- The visible media grid controls training membership.
- Krea2 rejects video capture.
- Missing captions, required TOML paths, or captured bundles fail visibly.
- WebCap does not track dataset staleness, revisions, or hashes and does not gate training on inferred preparation state.
