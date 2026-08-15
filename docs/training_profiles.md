# Training Profiles

WebCap has a small, app-owned registry of supported Diffusion Pipe training profiles. Profiles are deliberate product choices, not user-defined command runners: each profile defines its available run options, generated TOML files, dataset requirements, supported prepared media, and the standard DeepSpeed launch behavior.

## Available profiles

| Profile | Prepared media | Generated config and dataset files | Run options |
| --- | --- | --- | --- |
| Wan2.2 T2V | Images and videos | `config.wan22.{mode}.{hi|lo}.toml`, matching dataset files | HI -> LO, HI only, LO only |
| Krea2 Raw | Images only | `config.krea2.{mode}.toml`, matching dataset file | Train |
| Wan2.1 T2V 14B | Images and videos | `config.wan21.{mode}.toml`, matching dataset file | Train |
| MiniMax H3 | Images and videos | `config.h3.{mode}.toml`, matching dataset file | Train |

Krea2 Raw rejects prepared video data. Wan2.1, Wan2.2, and MiniMax H3 accept the normal prepared image/video mix. MiniMax H3 uses its native video frame grid: POC uses 34 frames, while Normal and Quality select from 136, 102, 68, and 34 frames according to clip coverage. Clips shorter than 34 frames are excluded, and H3 does not generate the Wan-specific 13-frame detail stanza.

## Launch output identity

Generated set TOML stays editable and uses the neutral template output path. When a launch is created, WebCap reserves a new, global three-character base-36 launch group under:

```text
<filesystem.root>/output/runs/<prefix>-<set-name>/
```

For example: `001-Estel`. Each model/stage writes beneath that group using a registry-owned slug: `wan22-hi`, `wan22-lo`, `krea2-raw`, or `wan21-t2v`. A Wan2.2 HI → LO action shares one launch group for its two independent jobs; every other new launch gets its own group. Resume continues the selected existing output, and canceled reservations are never recycled.

Managed and manual launches capture a bundle under `<launch-group>/.webcap/datasets/`. The bundle owns its media, captions, exact inspected TOMLs, and cache. Only runtime paths are rewritten in the captured TOMLs. Editable source files are not rewritten, and **Reset** is the explicit per-file replacement action.

## Dataset generation and progress

Selecting a profile and mode creates missing TOMLs. Dataset creation and Reset calculate the selected dataset TOML directly from the currently visible media without copying it. Train captures the visible media and latest captions in the run bundle.

- Prepared videos retain their source frame rate and audio. Bucket eligibility is calculated at the model's native rate (16 fps for Wan and 24 fps for MiniMax H3), then Diffusion Pipe performs the actual resampling during latent caching.
- Wan2.2 writes separate high-noise and low-noise dataset files.
- Krea2, Wan2.1, and MiniMax H3 write mode-specific dataset files; H3 applies its model-specific video frame grid while retaining WebCap's image buckets and target-step planning.
- The POC, Normal, and Quality dataset targets affect generated buckets. Repeat targeting is based on each individual run's configured epochs and the generated dataset shape.
- Managed jobs use the profile's own plan entry for per-run progress, completion ETA, and next-checkpoint ETA when the trainer logs sufficient timing information.

## Launching

The selected profile and mode control setup inspection, manual-command preview, direct start, and queueing. A launch runs the standard DeepSpeed command from its captured bundle. WebCap keeps queue, output console, pause, finish, cancellation, history, resume, GPU status, diagnostics, and TensorBoard behavior shared across profiles.

Manual command preview never starts a process. `Train this set` starts immediately when idle or queues the job behind active work.
