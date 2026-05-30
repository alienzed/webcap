# In-App Training Execution: Preflight + Config Schema

Last updated: 2026-05-30

## Goal

Enable optional in-app training runs without pretending every machine has the same environment.

Design principles:
- External-first remains valid.
- In-app run mode is explicit opt-in.
- Preflight must fail fast on hard blockers.
- Runtime assumptions live in config profiles, not hardcoded logic.

## Execution Model

1. User clicks `Train` and chooses `Preview` or `Run`.
2. For `Run`, backend resolves an execution profile.
3. Backend runs preflight checks against that profile target runtime.
4. If blockers exist, run is not started.
5. If checks pass, backend starts HI then LO with log streaming and stop support.

## Preflight Checklist

Each check has:
- `id`
- `severity`: `blocker` or `warning`
- `pass/fail`
- `message`
- `details` (optional)

### A. Workspace/Input Checks (always local backend)

1. `set_folder_exists` (blocker)
- Selected set folder exists and is readable.

2. `train_configs_exist` (blocker)
- `config.hi.toml` and `config.lo.toml` exist after generate/auto-generate path.

3. `dataset_configs_exist` (blocker)
- `dataset.hi.toml` and `dataset.lo.toml` exist.

4. `training_root_configured` (blocker)
- Effective execution cwd is known (`training.diffusion_pipe_wsl` for WSL profile, or local cwd for local profile).

### B. Executor Availability Checks

5. `executor_shell_available` (blocker)
- Profile shell command is available:
  - WSL: `wsl`
  - Local bash: `bash`
  - Local powershell: `powershell` or `pwsh`

6. `activate_script_present` (warning by default, blocker if profile requires activation)
- Activation script exists when configured and `require_activate_script=true`.

### C. Training Toolchain Checks (run inside target runtime)

7. `python_available` (blocker)
- `python --version` succeeds in target runtime.

8. `deepspeed_available` (blocker)
- `deepspeed --version` succeeds.

9. `train_py_present` (blocker)
- `train.py` exists in execution cwd.

10. `torch_cuda_visible` (blocker)
- Python probe confirms CUDA availability:
  - `torch.cuda.is_available() == True`
  - at least one visible GPU

11. `nvidia_smi_accessible` (warning)
- `nvidia-smi` callable in target runtime.
- If unavailable but torch CUDA passes, warning only.

### D. Hardware/Capacity Checks

12. `gpu_count_matches_request` (blocker)
- Visible GPU count >= requested `num_gpus` for run.

13. `vram_minimum` (warning by default, profile-upgradable to blocker)
- Minimum VRAM threshold per GPU is met (`min_vram_gb`).

14. `disk_free_space` (warning)
- Destination/output volume has enough free space (`min_disk_free_gb`).

### E. Safety/Concurrency Checks

15. `single_active_run` (blocker)
- No existing active run owned by WebCap.

16. `orphan_process_guard` (warning)
- If prior run metadata exists but process not found, record cleanup warning and continue.

## Preflight Result Contract

Recommended API response shape:

```json
{
  "ok": false,
  "profile": "wsl-default",
  "summary": {
    "blockers": 2,
    "warnings": 1
  },
  "checks": [
    {
      "id": "deepspeed_available",
      "severity": "blocker",
      "ok": false,
      "message": "deepspeed not found in target runtime",
      "details": "command exited 127"
    }
  ]
}
```

Rule:
- Any failed `blocker` means run cannot start.
- Warnings never block by themselves.

## Config Schema (Proposed)

Add a new object under `training`:

```json
{
  "training": {
    "mode": "normal",
    "diffusion_pipe_wsl": "/home/user/diffusion-pipe",
    "activate_script": "dp-clean/bin/activate",
    "execution": {
      "enabled": false,
      "default_profile": "wsl-default",
      "stop_signal": "INT",
      "allow_force_kill": true,
      "preflight": {
        "enforce": true,
        "warn_only": false,
        "min_vram_gb": 12,
        "min_disk_free_gb": 20,
        "require_activate_script": false,
        "vram_severity": "warning"
      },
      "profiles": [
        {
          "id": "wsl-default",
          "label": "WSL Bash",
          "type": "wsl_bash",
          "enabled": true,
          "cwd": "/home/user/diffusion-pipe",
          "activate_script": "dp-clean/bin/activate",
          "python_cmd": "python",
          "deepspeed_cmd": "deepspeed",
          "env": {
            "NCCL_P2P_DISABLE": "1",
            "NCCL_IB_DISABLE": "1"
          }
        },
        {
          "id": "local-venv",
          "label": "Local Venv",
          "type": "local_powershell",
          "enabled": false,
          "cwd": "C:/repos/diffusion-pipe",
          "activate_script": "venv/Scripts/Activate.ps1",
          "python_cmd": "python",
          "deepspeed_cmd": "deepspeed",
          "env": {}
        }
      ]
    }
  }
}
```

### Field Notes

1. `training.execution.enabled`
- Feature gate for in-app run mode.
- `false`: only preview is available.

2. `default_profile`
- Chosen execution profile id.

3. `profiles[].type`
- Allowed initial values:
  - `wsl_bash`
  - `local_powershell`
  - `local_bash`

4. `profiles[].cwd`
- Working directory for training commands in that profile.
- For `wsl_bash`, must be WSL path.

5. `profiles[].activate_script`
- Optional.
- If present and `require_activate_script=true`, missing file is blocker.

6. `preflight.warn_only`
- Emergency escape hatch.
- When true, preflight failures are surfaced but do not block run.
- Recommended default: `false`.

7. `preflight.vram_severity`
- `warning` or `blocker`.
- Lets users tune strictness by hardware reality.

## Backward Compatibility

- Existing `training.diffusion_pipe_wsl`, `training.activate_script`, and `training.mode` remain valid.
- If `training.execution` is absent:
  - behavior remains current preview-only flow.
- Existing users are not forced into in-app execution.

## Minimal Backend Surface (Recommended)

1. `POST /fs/train_preflight`
- Input: `folder`, optional `profile_id`, optional overrides (`num_gpus`).
- Output: structured check list.

2. `POST /fs/train_start`
- Requires successful preflight unless `warn_only=true`.
- Starts managed HI->LO run and streams logs.

3. `POST /fs/train_stop`
- Graceful stop (`INT`), optional force kill fallback.

4. `GET /fs/train_status`
- Returns active run metadata and phase (`hi` / `lo` / `idle`).

## Rollout Plan

1. Implement preflight route and UI output first.
2. Keep `Train` default action as preview.
3. Add `Run In App (Experimental)` secondary action when `training.execution.enabled=true`.
4. Add stop button only after managed start is stable.

## Success Criteria

1. Users with correct environments can run in-app with clear visibility.
2. Users with mismatched environments get precise blockers, not opaque failures.
3. No silent orphaned training process on stop/cancel.
4. Existing preview-only users see no behavior change.
