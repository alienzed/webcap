## Train Button

Purpose: run two diffusion-pipe training passes back-to-back (HI then LO) from the selected set folder.

## Behavior

- The Train button posts to `/fs/train_run` with the current folder.
- Backend converts selected folder config paths to WSL paths.
- Backend starts WSL shell, changes to diffusion-pipe folder, activates virtual env, then runs both commands chained with `;`.
- Output is streamed to the console panel.

## Command Shape

Train now previews a handoff-friendly single command (Ctrl+C during HI moves immediately to LO):

hi_pid=''; handoff(){ if [ -n "$hi_pid" ] && kill -0 "$hi_pid" 2>/dev/null; then echo "[INFO] HI interrupted; handing off to LO..."; kill -INT "$hi_pid" 2>/dev/null || true; wait "$hi_pid" 2>/dev/null || true; fi; }; trap handoff INT; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG> & hi_pid=$!; wait "$hi_pid" || true; trap - INT; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>

Before that, it runs:

- `cd <diffusion_pipe_wsl>`
- `source <activate_script>`

## Config Settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: absolute WSL path to diffusion-pipe folder.
- `training.activate_script`: activation script relative to diffusion-pipe folder (default: `dp-clean/bin/activate`).
- Training config filenames are fixed to `config.hi.toml` and `config.lo.toml` in each set folder.

## Notes

- Train remains explicit/manual: click starts the run sequence.
- LO starts after HI exits, and if HI is interrupted with Ctrl+C, LO still starts automatically.
- If either config file is missing, backend returns an error before starting.
