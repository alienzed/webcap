# H3 Envelope Probe

The H3 envelope probe measures the largest practical resolution for the fixed 17-, 34-, 68-, and 102-frame shape ladders. It is an external experiment runner: it does not alter generated buckets, saved dataset TOMLs, training jobs, or queue state.

## Prepare and run

Right-click an appropriate video in WebCap and select **Prepare H3 envelope probe…**. WebCap captures that exact video, its saved sidecar caption, the set's `config.h3.normal.toml`, and the fixed probe plan under `.webcap_training/h3-probes/`, then copies a command to the clipboard.

Paste the command into the configured training WSL environment. The script performs the cache and training pass for every candidate, stopping an individual ladder after an OOM or a tenfold post-warm-up timing limit. It keeps running the remaining ladders unless caching or trainer startup fails for another reason.

## Requirements

- Select a high-resolution video that you have chosen to represent the H3 workload. WebCap does not enforce duration or resolution thresholds.
- Save a non-empty `.txt` caption for that video.
- Ensure the set already has the intended `config.h3.normal.toml`.
- Ensure the configured training runtime points at the training machine and the GPU is idle before pasting the command.

The preparation step may make one 24-fps bundle-local copy of the video. Each candidate then has its own media directory and cache. Logs, copied configs, datasets, telemetry, commands, and result records remain under the probe directory for later inspection.
