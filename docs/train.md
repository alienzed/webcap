## Train Button

Purpose: run two diffusion-pipe training passes back-to-back (HI then LO) from the selected set folder.

## Behavior

- The Train button posts to `/fs/train_run` with the current folder.
- Backend converts selected folder config paths to WSL paths.
- Backend starts WSL shell, changes to diffusion-pipe folder, activates virtual env, then runs both commands chained with `;`.
- Output is streamed to the console panel.

## Command Shape

The backend executes this form in WSL:

NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG> ; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>

Before that, it runs:

- `cd <diffusion_pipe_wsl>`
- `source <activate_script>`

## Config Settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: absolute WSL path to diffusion-pipe folder.
- `training.activate_script`: activation script relative to diffusion-pipe folder (default: `dp-clean/bin/activate`).
- `training.config_hi`: HI config filename in the selected set folder (default: `config.hi.toml`).
- `training.config_lo`: LO config filename in the selected set folder (default: `config.lo.toml`).

## Notes

- Train remains explicit/manual: click starts the run sequence.
- Both runs are chained so LO starts after HI exits.
- If either config file is missing, backend returns an error before starting.
