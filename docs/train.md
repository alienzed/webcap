## Train Button

Purpose: preview copy/paste-ready two-stage diffusion-pipe commands (HI then LO) for external execution.

## Behavior

- The Train button posts to `/fs/train_run` with the current folder.
- Backend converts selected folder config paths to WSL paths (with native-path fallback warning if conversion fails).
- If required training/config dataset files are missing, backend auto-runs config generation steps first.
- `Preview Command` retains the external handoff: backend returns command preview text and the app copies the chained command.
- `Validate Runner` checks the configured WSL runtime, generated paths, toolchain, CUDA visibility, and generated Bash syntax without launching training.
- `Run In App` requires a passing validation and explicit confirmation, then launches a managed HI-to-LO job.
- `Queue Training` persists a global managed queue under `<filesystem.root>/.webcap_training/`.
- Managed job output is retained in per-job logs and is available from the Training console after a failure or restart.

## Command Shape

Train now previews two copy/paste lines:

NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG> ; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>
pkill -f 'config\.hi\.toml'

## Config Settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: shown in preview as the expected working directory context.
- `training.activate_script`: optional WSL virtual-environment activation script used by managed runs and their validation checks. Set it when Python and DeepSpeed are installed in a virtual environment, for example `/home/user/diffusion-pipe/.venv/bin/activate`.
- Training config filenames are fixed to `config.hi.toml` and `config.lo.toml` in each set folder.

## Notes

- Train remains explicit/manual: click starts the run sequence.
- LO starts after HI exits in normal completion flow.
- To short-circuit HI and move to LO without Ctrl+C on the queued terminal, run the printed `pkill` command from another terminal.
- Missing config/dataset files are auto-generated where possible before preview output.
