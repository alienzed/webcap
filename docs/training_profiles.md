# Training Profiles

WebCap has a small, app-owned registry of supported Diffusion Pipe training profiles. Profiles are deliberate product choices, not user-defined command runners: each profile defines its available run options, persistent TOML files, dataset requirements, supported captured media, and standard DeepSpeed launch behavior.

App Settings can hide profiles that are not used. This affects only new-run selection; it never deletes setup files or captured runs. With one enabled profile, Training shows only that model.

## Available profiles

| Profile | Captured media | Persistent config and dataset files | Run options |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images and videos | `config.wan22.{mode}.{hi|lo}.toml`, matching dataset files | HI -> LO, HI only, LO only |
| Krea2 Raw | Images only | `config.krea2.{mode}.toml`, matching dataset file | Train |
| Wan2.1 T2V 14B | Images and videos | `config.wan21.{mode}.toml`, matching dataset file | Train |
| MiniMax H3 | Images and videos | `config.h3.{mode}.toml`, matching dataset file | Train |

Krea2 Raw rejects video data. Wan2.1, Wan2.2, and MiniMax H3 accept images and videos. MiniMax H3 POC uses a fixed 34-frame training bucket. Normal and Quality use overlapping 68-frame temporal, 34-frame hybrid, and 17-frame spatial training classes (weighted `2 : 1 : 0.5`): compatible long high-resolution clips may contribute to all three, while a qualifying 17–33-frame high-resolution clip can contribute to spatial detail alone. Temporal permits 10% per-axis upscale; hybrid and spatial are native-resolution-only. These training tiers are not inference-length rules, and H3 does not generate the Wan-specific 13-frame detail stanza.

## Launch output identity

Persistent set TOML stays editable and uses the neutral template output path. When a launch is created, WebCap reserves a new, global three-character base-36 launch group under:

```text
<filesystem.root>/output/runs/<prefix>-<set-name>/
```

For example: `001-Estel`. Each model/stage writes beneath that group using a registry-owned slug: `wan22-hi`, `wan22-lo`, `krea2-raw`, `wan21-t2v`, or `minimax-h3`. A Wan2.2 HI → LO action shares one launch group for its two independent jobs; every other new launch gets its own group. Resume continues the selected existing output, and canceled reservations are never recycled.

Managed and manual launches capture a bundle under `<launch-group>/.webcap/datasets/`. The bundle owns its media, captions, exact inspected TOMLs, and cache. Runtime paths are rewritten in the captured TOMLs, and off-target videos may be normalized inside the bundle. Editable source files are not rewritten, and **Reset** is the explicit per-file replacement action.

## Dataset calculation and progress

Selecting a profile and mode creates missing TOMLs. Dataset creation and Reset calculate the selected dataset TOML directly from the currently visible media without copying it. Train captures the visible media and latest captions in the run bundle.

- For video-capable profiles, captured videos already within 0.1 FPS of the model rate are copied unchanged. Other videos are converted inside the fresh bundle to constant 16 FPS for Wan or 24 FPS for MiniMax H3, using high-quality H.264 settings while retaining audio and metadata where the container supports them. If conversion is unavailable or fails, WebCap logs a warning and copies the original unchanged rather than blocking the run.
- Wan2.2 writes separate high-noise and low-noise dataset files.
- Krea2, Wan2.1, and MiniMax H3 write mode-specific dataset files; H3 applies its capability-aware video classes while retaining WebCap's image buckets and target-step planning. Normal and Quality keep separately stored, initially identical conservative shape ceilings so later reviewed calibration can update policy data without changing class or bundle behavior.
- POC, Normal, and Quality modes affect calculated buckets and template learning rates. Repeat targeting is based on configured epochs and the dataset shape.
- Managed jobs use the profile's own plan entry for per-run progress, completion ETA, and next-checkpoint ETA when the trainer logs sufficient timing information.

## Launching

The selected profile and mode control setup inspection, manual-command preview, direct start, and queueing. A launch runs the standard DeepSpeed command from its captured bundle. MiniMax H3 runs its cache-only pass in one process, then relaunches a fresh process with `--trust_cache` for training; this avoids retaining the large text-encoder allocation across the cache/training boundary. Resume reuses the original bundle cache and starts directly in the training phase. WebCap keeps queue, output console, pause, finish, cancellation, history, resume, GPU status, diagnostics, and TensorBoard behavior shared across profiles.

Manual command preview never starts a process. `Train this set` starts immediately when idle or queues the job behind active work.
