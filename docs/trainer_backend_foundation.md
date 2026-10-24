# External trainer backend foundation

Status: **foundation only**. Diffusion Pipe remains the only runnable backend. No Fizgig executable, virtual environment, configuration, UI selector, or external integration is connected.

## Ownership

WebCap owns the selected Set, captured media and captions, immutable run inputs, queue ordering, process/PID tracking, logs, GPU coordination, run history, and test staging. A trainer owns its Python environment, command invocation, trainer-specific configuration, log vocabulary, checkpoints, resume semantics, and checkpoint-save/stop protocol. No new services, worker lanes, registry, or state store are needed.

The current explicit boundary is `tool/server/training_backend.py`. A legacy job without `trainerId` means `diffusion_pipe`. New jobs persist that ID in queue and History. Unimplemented IDs fail with an explicit error rather than launching the wrong engine. The shared runner delegates command planning and checkpoint-save requests to the selected backend, keeping existing Diffusion Pipe behavior.

## Real coupling still to extract when Fizgig is implemented

| Seam | Current Diffusion Pipe assumption | Responsibility of an eventual Fizgig backend |
| --- | --- | --- |
| Runtime | `diffusion_pipe_wsl`, activation/Conda, DeepSpeed | Its own configured working directory and isolated interpreter |
| Config and capture | Diffusion Pipe model and dataset TOMLs; H3 adapter/blocks overrides | Translate captured files into real Fizgig config; preserve original captures |
| Progress | `Started new epoch`, `step=`, `iter time (s)`, TensorBoard scalar names | Parse genuine Fizgig events into WebCap's existing progress shape |
| Run identity | Timestamped output directory and copied config hash | Bind a precise output directory from positive evidence |
| Resume | `latest` plus `global_stepN` DeepSpeed checkpoint folders | Implement and validate Fizgig's real resume identity |
| Pause/Finish | `save_quit` file; verify a fresh `latest` | Real checkpoint-safe stop mechanism and verification; fail visibly if absent |
| Candidates | `epochN/*.safetensors`, TensorBoard train/loss and train/epoch_loss | Enumerate usable LoRAs; provide analysis only where measured data supports it |
| Test compatibility | ComfyUI-compatible LoRA `.safetensors` | Validate H3 key naming, tensor compatibility and placement before enabling Copy to Test |

The future backend should be selected by an explicit trainer ID stored with each captured run, not inferred from machine-global settings at resume time. Resume and historical continuations must retain the original trainer even when the default changes. EMA exports must be distinguished from raw LoRA checkpoints so comparing them cannot overwrite names or conflate evaluations.

## Activation acceptance criteria

Before offering Fizgig as a selectable trainer, prove its CLI and supported options against a pinned version, then test: prepare 29-image Set -> captured config -> headless training -> live progress -> saved LoRA -> Test Generations -> pause/checkpoint/Resume -> Finish -> history recovery. Trainer-side failure must show in WebCap's existing Console; no silent fallback. Keep the training queue, GPU semantics, and existing Diffusion Pipe user experience unchanged.

A generic config editor or UI toggle is **not** evidence that the backend is operational. Unsupported operations must be absent or fail explicitly.

## What this branch does not do

No alternate trainer launch, no network installation, no alterations to the user's Linux training environment, no ETA parsing changes, no candidate migration, no queue changes, and no UI change. This branch is a safe starting point for the next implementation phase.
