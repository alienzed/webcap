# Fine-Tune From A Saved LoRA Run

Status: planning note. No behavior described here is implemented yet.

## Purpose

Add a second, clearly distinct way to continue experimentation from a previous managed run:

- **Resume checkpoint** restores DeepSpeed training state from `latest` / `global_stepN` and continues the same run.
- **Fine-tune from saved LoRA** loads weights from a prior `epochN` export into a new run with fresh optimizer, dataloader, and progress state.

The intended workflow is to choose a known WebCap run, inspect its saved `.safetensors` exports, select one, optionally set a lower constant learning rate, and queue an otherwise ordinary new Train action.

## Important Diffusion Pipe Detail

Diffusion Pipe's example config uses `[adapter].init_from_existing` with the path to a saved-LoRA **directory**, not a bare `.safetensors` filename. Its training entry point passes that path to the model's adapter loader. The saved `epochN/` directory also carries adapter/config metadata needed to understand the artifact.

Therefore WebCap should display `.safetensors` filenames as useful evidence but write the selected `epochN/` directory to `adapter.init_from_existing`. Bare-file support should not be assumed unless the exact training-machine Diffusion Pipe version is verified to support it.

References:

- [Diffusion Pipe example training config](https://github.com/tdrussell/diffusion-pipe/blob/main/examples/main_example.toml)
- [Diffusion Pipe training entry point](https://github.com/tdrussell/diffusion-pipe/blob/main/train.py)
- [Diffusion Pipe saved-model and checkpoint layout](https://github.com/tdrussell/diffusion-pipe#saving)

## Proposed Minimal UI

Use the existing resume/source area in the final training setup step. Present one **Starting point** choice:

1. Fresh
2. Resume checkpoint
3. Fine-tune from saved LoRA

The first two preserve current behavior. Selecting Fine-tune shows only:

- a saved-export dropdown;
- **Apply to stage** when the action has more than one stage;
- an optional **Constant LR** numeric input.

The export dropdown is grouped or labeled by existing Recent Runs identity:

```text
lower lr after face drift · LO · epoch12
  adapter_model.safetensors · 184 MB · Aug 28
```

The row identifies the `epochN/` directory while its detail shows all direct-child `.safetensors` files. If a run has no compatible saved export, it is not selectable and the reason is visible.

Add **Fine-tune from this…** to the existing Recent Run overflow menu as a shortcut. It opens training setup with that source preselected; it does not immediately queue anything.

For a two-stage HI/LO action, require exactly one target stage. One saved adapter must never silently initialize both stage configs because stage model and adapter shapes may differ.

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

Current `discover_runs()` is checkpoint-oriented: it discovers a run through a valid `latest` marker that names a real `global_stepN` directory. That is correct for Resume but wrong for saved-LoRA discovery. A user may intentionally remove checkpoint state while retaining `epochN/` exports.

Add a narrow saved-export discovery function that starts from recorded `outputRunPath` values and inspects direct children matching `epoch<integer>`. For each candidate, return normalized app-shaped data such as:

- source job/run ID and display label;
- stage, profile, and model identity;
- export directory path and epoch;
- direct-child `.safetensors` filenames, sizes, and modified time;
- compatible/incompatible state and a short reason.

Do not recursively treat arbitrary `.safetensors` files elsewhere in the output tree as initializers. A manual filesystem browser or global initializer registry is unnecessary for the first version.

## Validation

Before queueing, WebCap should establish what it can from existing recorded artifacts:

- the source comes from a recorded timestamped output run under the configured output root;
- the selected export is a direct `epochN/` child of that run;
- the export contains at least one direct-child `.safetensors` file;
- the selected target stage belongs to the requested action;
- checkpoint Resume and Fine-tune initialization are mutually exclusive;
- source and target profile/model identity match where the copied configs expose that identity;
- obvious adapter incompatibilities such as different adapter type, rank, or target modules are rejected when both configs provide those values.

Unknown compatibility should be stated as unknown rather than guessed. The trainer remains the final authority and its error must stay visible.

The backend must revalidate the path and artifact immediately before launch. The client sends a stable source job/export identity, not arbitrary TOML or shell text.

## Managed Job And Bundle Behavior

Suggested explicit fields:

- `initFromExisting`: selected `epochN/` directory path;
- `initSourceJobId`: originating managed job when known;
- `initArtifactName`: display `.safetensors` filename or filenames;
- `initStage`: the one target stage;
- `forceConstantLr`: optional numeric override.

Persist these in queue state, Recent Runs history, and immutable bundle evidence.

When materializing the normal immutable bundle for the new Train action:

- modify only the captured TOML for `initStage`;
- set `[adapter].init_from_existing` to the validated export directory;
- set top-level `force_constant_lr` only when explicitly supplied;
- do not modify the set's editable TOML;
- do not pass `--resume_from_checkpoint`;
- let Diffusion Pipe create a new timestamped output run.

This is a new experiment initialized from old weights, not continuation of the source job. The UI should say `Fine-tuned from <run label> · epochN`, while checkpoint Resume continues to say `Continues <run label>`.

## Lifecycle And Cleanup Interaction

There is no new long-lived process ownership. The existing queue launches and observes the new job exactly like any fresh run.

A queued, starting, or active initializer job protects its selected source `epochN/` directory from WebCap's proposed artifact cleanup. Once the trainer has successfully loaded the adapter, the process owns the in-memory weights and no longer needs the source for that execution. Historical lineage remains useful even if the source is explicitly deleted later, and the UI can mark it as missing.

## Likely Change Surface

- `tool/tool.html`: extend the current source/resume controls; add one optional LR field.
- `tool/js/training_workspace.js`: source mode, export selection, target stage, validation.
- `tool/js/training_history_ui.js`: **Fine-tune from this…** and lineage display.
- `tool/server/training_history.py`: separate saved-export discovery and normalized metadata.
- `tool/server/training_runner.py`: validate/persist initializer fields and keep Resume mutually exclusive.
- `tool/server/training_bundle.py`: targeted captured-TOML edits and immutable evidence.

No process manager, external artifact registry, filesystem browser, model merge, or trainer fork is required.

## Recommended First Slice

1. Discover saved `epochN/` exports only from recorded managed output runs.
2. Add Fine-tune as the third Starting point mode with one selected stage.
3. Show `.safetensors` evidence but configure the export directory.
4. Support the optional explicit Constant LR override.
5. Record and render source lineage.

A configurable external initializer folder and manual path escape hatch can remain a later extension if managed-run discovery proves too narrow.

## Open Questions

- When an export contains multiple `.safetensors` files, does the training-machine adapter loader treat the directory unambiguously? This should be verified with the installed Diffusion Pipe revision.
- Should compatibility be strict for rank/target modules, or should advanced users be allowed to queue an explicitly acknowledged unknown match?
- Is the Recent Run shortcut sufficient, or is grouping exports inside the training setup dropdown easier when comparing many experiments?
- Should Constant LR default blank, or remember the last explicit fine-tune value per profile? The minimal recommendation is blank and visible.

## Acceptance Criteria

- Checkpoint Resume behavior and command construction are unchanged.
- Fine-tune selects a recorded `epochN/` export and starts a new output run.
- WebCap shows the saved `.safetensors` evidence but writes the validated directory path to `adapter.init_from_existing`.
- Exactly one captured stage config is changed; the editable set config is untouched.
- A supplied Constant LR becomes top-level `force_constant_lr`; blank means no override.
- Mixed checkpoint/initializer requests and invalid paths fail visibly before launch.
- Queue and history clearly distinguish `Continues` from `Fine-tuned from`.
