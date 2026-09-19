# WebCap Specification (Current Behavior)

Last updated: 2026-09-19

## Scope and architecture

WebCap is a local-first media curation, captioning, dataset-configuration, and managed Diffusion Pipe training app. It uses Flask, classic global JavaScript, and file-based state beside the user's sets.

Key set-owned artifacts are:

- `*.txt`: caption sidecars
- `.webcap_state.json`: per-set state
- `media_metadata.json`: metadata cache
- `originals/`: reversible-mutation backing store
- model/stage-specific training config and dataset TOMLs

## Application shell and navigation

WebCap has a permanent outer shell around the feature workspaces.

- **Activity rail:** Prep, Training, and Test are major activities. Console, Settings, Help, and immersive mode also live in the permanent rail. Review, Grid, Focus, Config, Run Log, Candidate Analysis, Test sessions, and Compare remain workspace-owned views rather than top-level activities.
- **Header:** current folder/set context and the single editable working-model selector are shell-owned. Workspace identity is reflected in the header without moving workspace-local controls there. Historical Training/Test artifacts retain their own recorded model identity even when the current working model differs.
- **Status and background work:** transient application feedback is shown in a floating bottom-left shell status. The general multiline console has one stable shell host. Active Training/Test remain reachable from the rail; active Training GPU telemetry may be mirrored into the header without moving GPU polling/state ownership out of Training.
- **Overlay root:** true modals use the single static `#app-overlay-root`; feature code does not reparent modal nodes at runtime.
- **Workspace roots:** Prep, Review, Training, and Test have explicit stable roots. Grid and Focus are surface modes within the Prep-owned workspace model.
- **Reload location:** URL hash routing owns durable folder + major-workspace location. Supported durable routes are Prep, Training, Test, Review, and Grid, with Training global/set scope. Transient UI state is not persisted in the route.

The shell owns navigation/context presentation. Feature-local tabs, selections, queues, sessions, artifact details, and modal state remain feature-owned.

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
- Krea2 Raw is image-only and owns `config.krea2.toml` and `dataset.krea2.toml`.
- Wan2.1 accepts images and videos and owns `config.wan21.toml` and `dataset.train.toml`.
- MiniMax H3 accepts images and videos and owns `config.h3.toml` and `dataset.train.toml`.
- App Settings can hide profiles from new-run selection. All are enabled by default; disabling one never deletes files or run data.

See [training_profiles.md](training_profiles.md) and [train.md](train.md).

## Configuration behavior

Selecting a profile creates only its missing TOMLs and shows only the applicable files in Training. Existing TOMLs are preserved. Training config Reset restores the appropriate template source; dataset Reset recalculates that one file from currently visible media metadata without copying media.

Train saves the open TOML before capture. Captured copies preserve inspected values except for app-owned runtime paths: output directory, training-config dataset path, and dataset media directories.

## Run ownership and output

Each Train action reserves a logical run under its stable numbered set root. Its slug/hash identity is deterministic; its numeric prefix is allocated once when the set first receives managed training output:

```text
output/runs/<global-sequence>-<set-slug>--<set-path-hash>/<numbered-logical-run>/captures/
```

The logical run also owns `jobs/` and `output/`. The bundle contains grouped media, captions, copied TOMLs, `dataset_manifest.json`, and `training_plan.json`; caches live with captured media.

Managed Resume is shallow current-set discovery; Custom Resume validates an explicit checkpoint directly and creates a new logical run. The manual command path uses the same capture materializer but never launches a process.

## Guardrails

- Destructive media actions are explicit and use backups where reversibility is expected.
- The visible media grid controls training membership.
- Krea2 rejects video capture.
- Missing captions, required TOML paths, or captured bundles fail visibly.
- WebCap does not track dataset staleness, revisions, or hashes and does not gate training on inferred preparation state.
