# Training Action Directories

WebCap creates one visible action directory for every new Train action:

```text
FS_ROOT/output/runs/001-set-name--optional-run-name/
  action.json
  record/       # compact captured configs, plan, and summary
  input/        # captured media, captions, manifest, and rebuildable cache
  jobs/         # managed runner evidence
  output/       # Diffusion Pipe stage output branches
```

HI and LO from one click share `record/` and `input/`; each has its own `jobs/<id>/` and `output/<profile-slug>/` branch. `action.json` is the ownership sentinel and stores only relative paths.

There is no automatic cleanup, retention policy, archive integration, storage scanner, or trainer-output deletion. Large `input/` data is deliberately visible so it can be reviewed or manually removed in Explorer. The compact `record/` directory is separate so removing captured input does not erase the explanation of what was launched.

## Clean-break rollout

Before using this layout, finish or stop managed training and close WebCap. Then manually rename (do not delete):

```text
FS_ROOT/output/runs              -> FS_ROOT/output/runs.pre-action-layout-YYYYMMDD
FS_ROOT/.webcap_training          -> FS_ROOT/.webcap_training.pre-action-layout-YYYYMMDD
```

Restart WebCap to create the new roots. This does not touch sets, captions, source media, editable set TOMLs, or unrelated folder state. Keep the renamed roots until reviewed, archived, or manually deleted. Old checkpoints remain usable through a manually generated command; they are intentionally not imported into the managed action catalog.

Recent Runs is only a disposable index. Clearing it never removes an action directory, and moving or deleting an action directory naturally removes it from managed resume discovery.
