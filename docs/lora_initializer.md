# Fine-Tune From A Saved LoRA Run

Status: implemented in Training Review. This document retains the validation
rationale and the training-machine evidence behind the workflow.

## First-Version Decisions

The first implementation uses these boundaries:

- A LoRA initializer always creates a fresh action, fresh captured dataset, new
  queue jobs, and new trainer output. It never reuses checkpoint state.
- Discovery starts from durable `action.json` output records under
  `FS_ROOT/output/runs`, not from disposable Recent Runs history.
- Candidates come only from managed WebCap actions for the current set and
  must match the selected model, adapter shape, and target stage.
- Wan2.2 HI can initialize HI and LO can initialize LO. Cross-stage
  initialization is not offered.
- The selected `epochN/` directory is copied into the new action's
  `input/initializer/` directory during bundle materialization. The captured
  copy, not the source export, is written to the captured training config.
- A candidate directory must contain exactly one direct `.safetensors` file.
  The installed H3 loader scans a directory and rejects both zero and multiple
  direct matches.
- The client sends opaque action/export identities. It never sends an
  initializer filesystem path or TOML fragment.
- Fine-tune defaults to a run-only constant LR equal to the visible target
  optimizer LR. It remains editable and warns when it is not lower than the
  source run.
- Every new Review starts Fresh; Resume and Fine-tune remain mutually
  exclusive starting points.

## Purpose

Add a second, clearly distinct way to continue experimentation from a previous managed run:

- **Resume checkpoint** restores DeepSpeed training state from `latest` / `global_stepN` and continues the same run.
- **Fine-tune from saved LoRA** loads weights from a prior `epochN` export into a new run with fresh optimizer, dataloader, and progress state.

The intended workflow is to choose a known WebCap run, inspect its saved `.safetensors` exports, select one, optionally set a lower constant learning rate, and queue an otherwise ordinary new Train action.

## Important Diffusion Pipe Detail

Diffusion Pipe's example config uses `[adapter].init_from_existing` with the path to a saved-LoRA **directory**, not a bare `.safetensors` filename. Its training entry point passes that path to the model's adapter loader. The loader only requires exactly one direct `.safetensors` child; adapter JSON is not required for this workflow.

Therefore WebCap should display the `.safetensors` filename as useful evidence
but write the selected `epochN/` directory to `adapter.init_from_existing`.
The confirmed MiniMax H3 loader scans that directory for one direct
`.safetensors` file; passing the file path itself yields zero directory matches.
It also rejects a directory with multiple direct weight files.

References:

- [Diffusion Pipe example training config](https://github.com/tdrussell/diffusion-pipe/blob/main/examples/main_example.toml)
- [Diffusion Pipe training entry point](https://github.com/tdrussell/diffusion-pipe/blob/main/train.py)
- [Diffusion Pipe saved-model and checkpoint layout](https://github.com/tdrussell/diffusion-pipe#saving)

## Proposed Minimal UI

Replace the overloaded resume label in the final training setup step with one
**Starting point** choice:

1. Fresh
2. Resume checkpoint
3. Fine-tune from saved LoRA

When Fine-tune is selected, show:

- **Apply initializer to** for a HI -> LO action;
- a saved-export dropdown filtered to that target stage;
- an optional **Constant LR** numeric input;
- the current target optimizer LR beside the optional override.

The export dropdown is grouped or labeled by durable action identity:

```text
lower lr after face drift · LO · epoch12
  adapter_model.safetensors · 184 MB · Aug 28
```

The row identifies the source set, named action, stage, and `epochN/` directory
while its detail shows all direct-child `.safetensors` files. Incompatible
exports remain visible only when showing their short incompatibility reason is
useful; otherwise the stage-filtered dropdown contains compatible exports.

**Fine-tune from this...** in Recent Runs may be added after the core path is
proven. It would only preselect setup state and must never queue immediately.

For Wan2.2, initialization always targets the explicitly selected High or Low run. One saved adapter must never silently initialize another stage config because stage model and adapter shapes may differ.

## Constant Learning Rate

Diffusion Pipe supports top-level `force_constant_lr`, which replaces the configured scheduler with a constant schedule and applies that learning rate to optimizer parameter groups. It is useful for this workflow but should not be silently invented by WebCap.

When Fine-tune is selected:

- show the target config's current optimizer learning rate;
- allow an explicit Constant LR override;
- if supplied, write top-level `force_constant_lr = <value>` into only the captured target config;
- if blank, preserve the captured config's existing scheduler/learning-rate behavior;
- warn, but do not prohibit, when the override is not lower than the target optimizer learning rate.

This keeps the UI to one optional number and keeps policy with the user. A later preset could suggest a ratio only after real usage demonstrates a stable convention.

## Discovery Must Be Separate From Checkpoint Resume

Current `discover_runs()` is checkpoint-oriented: it discovers a run through a
valid `latest` marker that names a real `global_stepN` directory. That remains
unchanged for Resume. Saved-LoRA discovery is separate because a user may
remove checkpoint state while retaining `epochN/` exports.

Add a narrow saved-export discovery function that walks the `outputs` recorded
in managed `action.json` manifests and inspects each recorded trainer run's
direct children matching `epoch<integer>`. Do not depend on Recent Runs or scan
unowned output directories. For each candidate, return normalized app-shaped
data such as:

- source job/run ID and display label;
- stage, profile, and model identity;
- export directory path and epoch;
- direct-child `.safetensors` filenames, sizes, and modified time;
- an opaque export ID derived from action, stage, recorded run, and epoch;
- compatible/incompatible state and a short reason.

Do not recursively treat arbitrary `.safetensors` files elsewhere in the output tree as initializers. A manual filesystem browser or global initializer registry is unnecessary for the first version.

## Validation

Before capture, WebCap should establish what it can from existing recorded artifacts:

- the source comes from a recorded timestamped output run under the configured output root;
- the selected export is a direct `epochN/` child of that run;
- the export contains exactly one direct-child `.safetensors` file;
- the selected target stage belongs to the requested action;
- checkpoint Resume and Fine-tune initialization are mutually exclusive;
- source and target profile and stage match;
- source and target model identity keys from the profile registry match;
- adapter type and rank match;
- optional adapter-shape fields such as target modules are rejected when both
  configs provide different values.

Unknown compatibility should be stated as unknown rather than guessed. The trainer remains the final authority and its error must stay visible.

The backend resolves and revalidates the opaque source immediately before
capture. It then copies every direct regular file from the selected `epochN/`
directory into the new action, refusing symlinks and nested path tricks. The
captured initializer directory and its fingerprint are validated again before
launch. The client sends stable source identities, not arbitrary TOML or shell
text.

## Managed Job And Bundle Behavior

Suggested request fields:

- `initializerActionId`: owning managed action;
- `initializerExportId`: opaque resolved export identity;
- `initializerStage`: the one target stage;
- `forceConstantLr`: optional numeric override.

Persist normalized lineage rather than request fields in action, queue, Recent
Runs, and bundle evidence: source action, source set/run label, source stage and
epoch, displayed weight files, captured relative directory, fingerprint, and
optional Constant LR.

When materializing the normal immutable bundle for the new Train action:

- copy the resolved source export to `input/initializer/<export-id>/`;
- modify only the captured TOML for `initializerStage`;
- set `[adapter].init_from_existing` to the captured directory's WSL path;
- set top-level `force_constant_lr` only when explicitly supplied;
- do not modify the set's editable TOML;
- do not pass `--resume_from_checkpoint`;
- let Diffusion Pipe create a new timestamped output run.

Use a small comment-preserving text rewrite helper beside the existing dataset
and output-dir rewrites. It must require exactly one `[adapter]` table, replace
an existing `init_from_existing` inside that table when the UI selection is
explicit, insert it otherwise, and parse the final text with `tomllib`. The LR
override is a positive finite TOML number at the top level. If it is equal to or
higher than the target optimizer LR, show a warning but allow the explicit
choice.

This is a new experiment initialized from old weights, not continuation of the source job. The UI should say `Fine-tuned from <run label> · epochN`, while checkpoint Resume continues to say `Continues <run label>`.

## Lifecycle And Cleanup Interaction

There is no new long-lived process ownership. The existing queue launches and observes the new job exactly like any fresh run.

The queued action owns a captured copy, so it does not need to protect the
source `epochN/` directory. Future cleanup may remove the source without
invalidating the queued action. Historical lineage can still mark the original
source as missing while retaining the captured evidence used by this run.

## Likely Change Surface

- `tool/tool.html`: extend the current source/resume controls; add one optional LR field.
- `tool/js/training_workspace.js` and `tool/js/training_runner_ui.js`: source mode, export selection, target stage, validation, and request fields.
- `tool/js/training_history_ui.js`: lineage display; the shortcut is optional follow-up.
- `tool/server/training_history.py`: separate action-owned saved-export discovery, compatibility, and opaque resolution.
- `tool/server/training_config_files.py`: captured-config initializer and Constant LR rewrites.
- `tool/server/training_runner.py`: validate/persist initializer fields and keep Resume mutually exclusive.
- `tool/server/training_bundle.py`: initializer capture, targeted captured-TOML edits, and immutable evidence.
- `tool/server/app.py`: one read-only initializer-discovery route plus the existing validate/start request wiring.

No process manager, external artifact registry, filesystem browser, model merge, or trainer fork is required.

## Implementation Slices

### Slice 1: Backend contract and discovery

1. Discover direct `epochN/` exports only beneath action-manifest output records.
2. Resolve only opaque action/export IDs and reject stale or changed candidates.
3. Compare profile, stage, model identity, adapter type, rank, and known optional shape fields.
4. Add focused discovery/resolution tests, including no-`latest` exports,
   zero/multiple/nested weights, symlinks, cleared Recent Runs, incompatible
   stages/ranks, and tampered IDs.

### Slice 2: Immutable capture and config rewrite

1. Copy the selected export's direct regular files into the fresh action bundle.
2. Fingerprint and record the captured initializer evidence.
3. Write `adapter.init_from_existing` and optional top-level `force_constant_lr` into only the target captured config.
4. Parse the result and test duplicate keys/tables, replacement, blank LR, scientific notation, path quoting, and untouched non-target configs.

### Slice 3: Runner and persisted lineage

1. Extend validate/start with mutually exclusive Resume and initializer identities.
2. Recheck captured initializer evidence immediately before queued launch.
3. Persist compact lineage in `action.json`, queue jobs, public job payloads, and Recent Runs.
4. Render `Fine-tuned from <action> · <stage> · epochN` separately from `Continues ...`.

### Slice 4: Setup UI

1. Add Fresh / Resume checkpoint / Fine-tune from saved LoRA.
2. Filter export choices by the selected target stage and show source set, action, epoch, files, and incompatibility details.
3. Keep Run name enabled for Fine-tune and disabled for Resume.
4. Show the target optimizer LR and optional Constant LR warning.

### Slice 5: Training-machine proof

1. Use one small known-good export for each supported profile/stage family.
2. Confirm the installed Diffusion Pipe revision loads the captured directory and creates a new timestamped run without `--resume_from_checkpoint`.
3. Confirm the first optimizer LR equals the explicit override when supplied.
4. Only then describe the workflow as supported in `README.md` and `docs/train.md`.

A configurable external initializer folder and manual path escape hatch can remain a later extension if managed-run discovery proves too narrow.

## Training-Machine Evidence

On 2026-08-30, the installed MiniMax H3 loader rejected a bare
`ngp-mh3-e21.safetensors` path with `No safetensors file found`. Its loader
uses `Path(adapter_path).glob('*.safetensors')` and explicitly rejects zero or
multiple matches. This confirms that a manual H3 initializer must use a
dedicated directory containing exactly one direct weights file. Keep a
model-family smoke test in the release checklist because other supported
pipelines may override this loader.

## Acceptance Criteria

- Checkpoint Resume behavior and command construction are unchanged.
- Fine-tune selects a recorded `epochN/` export and starts a new output run.
- WebCap shows the source `.safetensors` evidence but writes the captured initializer directory path to `adapter.init_from_existing`.
- Exactly one captured stage config is changed; the editable set config is untouched.
- A supplied Constant LR becomes top-level `force_constant_lr`; blank means no override.
- Mixed checkpoint/initializer requests and invalid paths fail visibly before launch.
- Queue and history clearly distinguish `Continues` from `Fine-tuned from`.
