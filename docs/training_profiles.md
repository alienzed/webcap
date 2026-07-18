# Training Profiles

WebCap has a small, app-owned registry of supported Diffusion Pipe training profiles. Profiles are deliberate product choices, not user-defined command runners: each profile defines its available run options, generated TOML files, dataset requirements, supported prepared media, and the standard DeepSpeed launch behavior.

## Available profiles

| Profile | Prepared media | Generated config and dataset files | Run options |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images and videos | `config.hi.toml`, `config.lo.toml`, `dataset.hi.toml`, `dataset.lo.toml` | HI -> LO, HI only, LO only |
| Krea2 Raw | Images only | `config.krea2.toml`, `dataset.train.toml` | Train |
| Wan2.1 T2V 14B | Images and videos | `config.wan21.toml`, `dataset.train.toml` | Train |

Krea2 Raw rejects prepared video data. Wan2.1 and Wan2.2 accept the normal prepared image/video mix.

## Set output root

All profiles in one set intentionally share one output root. When WebCap writes a new config for a set, it allocates a three-character base-36 directory under:

```text
<filesystem.root>/output/runs/<prefix>-<set-name>/
```

For example: `001-Estel`. The resolved `output_dir` in the generated TOML is authoritative for that run. Generating missing files does not overwrite an existing edited TOML; **Reset** is the explicit per-config replacement action.

## Dataset generation and progress

`Prepare Dataset` builds `auto_dataset/` from the currently visible media. `Generate Configs` writes the selected profile's dataset TOML and `auto_dataset/training_plan.json`.

- Wan2.2 writes separate high-noise and low-noise dataset files.
- Krea2 and Wan2.1 write the neutral `dataset.train.toml`, using the generic image-bucket policy.
- The POC, Normal, and Quality dataset targets affect generated buckets. Repeat targeting is based on each individual run's configured epochs and the generated dataset shape.
- Managed jobs use the profile's own plan entry for per-run progress, completion ETA, and next-checkpoint ETA when the trainer logs sufficient timing information.

## Launching

The selected profile controls Generate Configs, manual-command preview, direct start, and queueing. A normal launch runs the standard DeepSpeed command with that profile's generated TOML. WebCap keeps queue, output console, pause, finish, cancellation, history, resume, GPU status, diagnostics, and TensorBoard behavior shared across profiles.

Manual command preview never starts a process. `Train this set` starts immediately when idle or queues the job behind active work.
