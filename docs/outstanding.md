This file tracks implemented work vs outstanding items.
Last reviewed: 2026-08-23.

## Active UX Work
- Explore a small Review / Train navigation pass: make Training Items open the corresponding media back in captioning mode, replace the full-width Hide Items control with the app’s compact chevron pattern, and surface existing media metadata on entering Review without requiring a caption-assessment run.

## Enhancements / Ideas
- Validate the H3 Quality optimization preset after the shared safe video-bucket policy has seen real runs.
- The Review / Train screens are getting a bit busy. These screens were initially tacked on, maybe not given the respsect they deserve, I wouldn't go crazy with a revamp, the train stuff in the center pane is solid, it's more the right pane and how the center and right pane kind of swap responsibilities that seems off.
- Decide whether queue and history should expose more lifecycle times. Recent Runs already shows the most relevant queued, started, or finished timestamp; the remaining question is whether showing both start and completion, plus resume attempts as distinct child jobs, would add useful information without clutter.
- Provide the ability to resume from existing weights (resume from LORA, not from saved checkpoint, which we already support).

## Backlog (Do Not Implement Yet)
- Verify on the training machine whether direct H3 training safely performs required caching and how cache freshness should be determined before removing the separate WebCap `--cache_only` phase.
- Add an assisted dataset-config editor for changing directories, frames, and compatible higher/lower resolutions, informed by model profiles and calibrated VRAM shapes, while retaining the raw text editor as a fallback.
- Consider run-owned overrides for queued settings such as learning rate, epochs, dropout, checkpoint frequency, and state-save frequency. Define how changing them interacts with the queued job’s immutable captured bundle before implementation.
- Expose the last saved checkpoint on a running job if real usage demonstrates enough value; checkpoint discovery already exists.
- Add future compatible models through the app-owned training-profile registry, with one reviewed TOML template and explicit media/run requirements. Do not add arbitrary user-supplied commands.

## Cleanup Candidates
- Seek out overengineered solutions and code portions that are too large and fragile compared to the value they offer.
