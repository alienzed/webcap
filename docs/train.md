## Training

WebCap supports managed training alongside a retained manual WSL handoff.

## Behavior

- The manual command action posts to `/fs/train_run` with the current folder. It prints the command to the console, shows it inline, and copies it to the clipboard.
- For manual HI → LO, the handoff remains one chained command. HI-only and LO-only produce one command each.
- Manual command preview never launches training. Run its displayed command in WSL yourself.
- Managed Start/Queue use lightweight launch prerequisites; `Run Diagnostics` remains an explicit full environment check.
- Managed HI → LO creates two independent queue jobs, HI followed by LO. `Stop` advances the queue; `Pause` holds it for resume.
- Generated configs default to `<filesystem.root>/output/runs/<set-name>/<timestamp>/`. The current stage config's `output_dir` remains authoritative for discovery and manual resume.
- After a restart, WebCap holds its own queued work and does not launch it automatically.
- Managed job output remains available from the Training console. TensorBoard work is deferred from the v0.9 Training dashboard.

## Manual Command Shape

Manual HI → LO preview produces one copy/paste command:

```
NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <HI_CONFIG> ; NCCL_P2P_DISABLE="1" NCCL_IB_DISABLE="1" deepspeed --num_gpus=1 train.py --deepspeed --config <LO_CONFIG>
```

## Config Settings

Add these fields in `tool/config.json` (example in `tool/config.example.json`):

- `training.diffusion_pipe_wsl`: shown in manual preview as the expected working directory context.
- `training.wsl_distribution`: optional explicit WSL distribution; leave blank to use the Windows default.
- `training.conda_executable` and `training.conda_environment`: optional pair for managed Conda runtime commands. WebCap uses `conda run` in its child processes and does not alter the user's WSL shell or environment.
- `training.activate_script`: optional WSL virtual-environment activation script used only when no Conda runtime is configured, for example `/home/user/diffusion-pipe/.venv/bin/activate`.
- `training.tensorboard_port`: retained for the deferred TensorBoard integration.
- Training config filenames are fixed to `config.hi.toml` and `config.lo.toml` in each set folder.

## Notes

- Manual handoff is explicit: copy the displayed command and run it in WSL yourself.
- Managed training is the preferred way to sequence HI and LO through the queue.
- Missing config/dataset files are auto-generated where possible before preview output.
