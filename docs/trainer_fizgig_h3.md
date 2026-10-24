# Fizgig H3 backend — implementation track

**State:** trainer-specific planning and capture conversion implemented on top of
[external trainer backend foundation](trainer_backend_foundation.md).
**Not activated:** Diffusion Pipe remains the only runnable WebCap backend.
No launcher, UI selector, system install, GPU scheduling, or existing Diffusion Pipe
cache/pause/resume logic has been replaced.

## Boundary

WebCap owns snapshots, selected media, captions, queue/FIFO, managed PID,
Activity/Console, and immutable job identity. Trainer implementations own
dataset/config syntax, command sequence, progress interpretation, checkpoint
save/stop/resume, candidate inventory, and compatibility checks.

The initial Fizgig adapter lives in tool/server/training_fizgig.py. Its pure
dataset_from_capture, plan_h3, and saved_artifacts functions cannot start
training or change source media. plan_h3 returns a three-stage command plan
and explicit .pause_requested path, not a Diffusion Pipe command. The H3
training adapter path can be Ostris FL2VA, Circlestone, or empty (Off), and
never gets put in the trained output by this adapter. Preserve the selected
trainer ID for every job and continuation; never infer from current settings.

## H3 mapping decisions

- Read immutable **captured** WebCap image directories and caption sidecars.
- Preserve each directory's repetitions and one reviewed image resolution;
  give every source directory an isolated Fizgig cache directory.
- Do not silently translate video/voice buckets or multiple explicit buckets
  within one captured directory. Those need an explicit parity design and tests.
- Fizgig's aspect/area bucketing is not identical to Diffusion Pipe's
  hand-reviewed fixed buckets. Compare captured image memberships and effective
  resolutions in a representative run before activation.
- Use a separate, explicit Fizgig recipe (rank, LR, epochs, save cadence,
  optimizer, EMA, adapter, precision). Do **not** claim DP's
  adamw_optimi, dropout, image_shift, warmup or optimizer state are identical.
  The current planned recipe explicitly chooses Fizgig's adamw.
- Use --family minimax with isolated latent/text cache stages and headless
  training via the pinned Fizgig installation. The actual CLI has
  --training_adapter for Ostris/Circlestone.
- The text cache requires a supported MiniMax H3 encoder (NVFP4 or supported
  BF16), not the existing diffusion-pipe INT8-convrot file.
- Save separate state dirs (NAME-NNNNNN-state) and LoRA weights
  (NAME-NNNNNN.safetensors). Neither is DP's latest/global_stepN.
  Never treat a saved LoRA as resumable optimizer state.
- Fizgig's documented pause request is output_dir/.pause_requested, at the
  **next epoch boundary**; DP's save_quit and fresh latest protocol must
  remain untouched.

## Remaining safe phases (before enabling a trainer choice)

1. **Runtime-owned execution:** bind a pinned ~/Fizgig interpreter and cwd,
   stage generated TOML under the immutable WebCap action, and hand
   latent-cache → text-cache → train to the existing managed queue/PID/Console.
   Ensure a failure in either cache stage aborts loudly; no DP fallback.
2. **Lifecycle and recovery:** positive output-dir identity; check completed
   *-state directory before accepting a pause; handle Finish and manual Resume
   with --resume from the exact state, and no automatic restart of paused work.
   Existing DP save_quit and latest checks are not reusable.
3. **Evidence and candidates:** parse actual Fizgig epoch/log samples;
   enumerate LoRA artifacts, check H3 key compatibility, and expose them to
   Test Generations without conflating raw/EMA checkpoints. Missing evidence is
   unknown, not zero progress.
4. **Activation:** introduce the trainer choice only after focused contracts,
   one 29-image cache/train/resume probe with the supported text encoder,
   checkpoint-to-ComfyUI test and output recovery. Preserve the original
   Diffusion Pipe default.

## Reference CLI

- https://github.com/shootthesound/Fizgig/blob/master/docs/CLI.md
- https://github.com/shootthesound/Fizgig/blob/master/docs/MINIMAX_H3.md

No real run is claimed by the offline unit tests.
