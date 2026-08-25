# H3 Practical-Ceiling Probe

The H3 probe is an external, fixed 90-shape experiment that measures the largest practical shape for the 17-, 34-, 68-, and 102-frame ladders. It does not alter generated buckets, saved dataset TOMLs, training jobs, or queue state.

## Prepare and run

Right-click a representative video in WebCap and select **Prepare H3 envelope probe…**. WebCap captures that exact video, its saved sidecar caption, base config, and the immutable campaign plan under `.webcap_training/h3-probes/`, then copies a command to the clipboard. It uses the set's `config.h3.normal.toml` when present; otherwise it creates a probe-local config from WebCap's canonical H3 Normal template.

Run the command in the configured training WSL environment with the GPU idle. The runner first materializes 90 isolated candidate media directories, hardlinking the captured video when the filesystem permits. It then performs exactly one `--cache_only --trust_cache` process over a master dataset containing all 90 buckets. The master config, dataset, cache log, telemetry, and result are retained in `results/precache/`.

After a successful cache pass, every candidate starts in a fresh training process with `--trust_cache`; candidates never launch cache-only themselves. A cache failure is fatal preparation failure. An OOM or unsafe slowdown stops only that ladder; all other ladders continue.

## Fixed campaign

Every dimension is divisible by 32 and each rung moves the short edge up by 32 pixels. The plan is validated against the shipped 90-shape manifest before any process starts.

| Frames | 16:9 | Square | 4:3 |
| ---: | --- | --- | --- |
| 34 | 736×416 → 1344×768 (12) | 576×576 → 768×768 (7) | 640×480 → 1024×768 (10) |
| 68 | 512×288 → 896×512 (8) | 384×384 → 672×672 (10) | 416×320 → 768×576 (9) |
| 102 | 384×224 → 736×416 (7) | 320×320 → 544×544 (8) | 352×256 → 640×480 (8) |
| 17 | 1088×608 → 1344×768 (6) | 736×736 → 768×768 (2) | 928×704 → 1024×768 (3) |

The 17f and 34f ladders end at the useful 768p-class H3 spatial cap. Each 68f and 102f ladder ends with exactly one >30 MFP sentinel and has no higher candidates. A safe sentinel is not a ceiling: it records `ceiling_not_found` and leaves that ladder explicitly inconclusive.

## Measurement and evidence

Each training candidate runs six optimizer steps: two warm-up steps followed by four measured steps. The first completed rung in a ladder establishes its baseline. The post-warm-up stall timeout is `max(120 seconds, 20 × baseline)`.

`unsafe_slow` requires a measured median of at least `max(20 seconds, 2.5 × baseline)` and at least three of the four measured steps at or above that threshold. The runner records every GPU from `nvidia-smi`, selects the active GPU from its movement over idle, and records host available RAM and swap-free space. It marks VRAM-to-RAM spill as confirmed only when a slowdown coincides with a ≥2 GiB available-RAM decline or ≥1 GiB swap-free decline; otherwise the slowdown remains practical but spill is unproven.

Each candidate retains its config, dataset, media directory, training log, telemetry, and result. `summary.csv` and `campaign_result.json` record each ladder's baseline, last-safe rung, first unsafe/sentinel rung, terminal reason, and spill evidence.

Terminal reasons are:

- `oom`: the first allocation failure; the preceding rung is the ceiling.
- `unsafe_slow`: the first severe practical slowdown; the preceding rung is the ceiling.
- `model_cap`: the final useful 17f/34f shape completed safely.
- `ceiling_not_found`: a 68f/102f >30 MFP sentinel completed safely.
