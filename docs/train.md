## Train Button

Purpose: preview a two-stage diffusion-pipe handoff command (HI then LO) for external execution.

## Behavior

- The Train button posts to `/fs/train_run` with the current folder.
- Backend converts selected folder config paths to WSL paths (with native-path fallback warning if conversion fails).
- If required training/config dataset files are missing, backend auto-runs config generation steps first.
- Backend returns command preview text only; it does not launch training.
- Output is streamed to the console panel.

## Command Shape

Train now previews a handoff-friendly foreground command block (Ctrl+C during HI moves immediately to LO, without backgrounding HI):

hi_interrupted=0
trap 'hi_interrupted=1' INT
NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG>
hi_status=$?
trap - INT
if [ "$hi_interrupted" -eq 1 ]; then echo "[INFO] HI interrupted; handing off to LO..."; fi
if [ "$hi_status" -ne 0 ] && [ "$hi_interrupted" -eq 0 ]; then echo "[WARN] HI exited with status $hi_status; continuing to LO..."; fi
NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>

## Config Settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: shown in preview as the expected working directory context.
- `training.activate_script`: persisted in config/settings for future execution wiring; currently not used in train preview generation.
- Training config filenames are fixed to `config.hi.toml` and `config.lo.toml` in each set folder.

## Notes

- Train remains explicit/manual: click starts the run sequence.
- LO starts after HI exits, and if HI is interrupted with Ctrl+C, LO still starts automatically.
- Missing config/dataset files are auto-generated where possible before preview output.
