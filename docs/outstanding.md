This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-24.

## Enhancements / Ideas
- Validate the H3 Quality optimization preset after the shared safe video-bucket policy has seen real runs.
- Decide whether queue and history should expose more lifecycle times. Recent Runs already shows the most relevant queued, started, or finished timestamp; the remaining question is whether showing both start and completion, plus resume attempts as distinct child jobs, would add useful information without clutter.
- Provide the ability to resume from existing LoRA weights, rather than from a saved checkpoint, which is already supported.

## Backlog (Do Not Implement Yet)
- Verify on the training machine whether direct H3 training safely performs required caching and how cache freshness should be determined before removing the separate WebCap `--cache_only` phase.
- Add an assisted dataset-config editor for changing directories, frames, and compatible higher/lower resolutions, informed by model profiles and calibrated VRAM shapes, while retaining the raw text editor as a fallback.
- Consider run-owned overrides for queued settings such as learning rate, epochs, dropout, checkpoint frequency, and state-save frequency. Define how changing them interacts with the queued job’s immutable captured bundle before implementation.
- Expose the last saved checkpoint on a running job if real usage demonstrates enough value; checkpoint discovery already exists.
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.
