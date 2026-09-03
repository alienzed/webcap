# Stable Set Training Layout and Resume - Implementation Plan

**Status:** Shipped design and acceptance record. This is the single authoritative stable-set layout and Resume document; current operational behavior is documented in the linked current-behavior references.

This plan intentionally made a clean break from the removed tentative layout proposals and their action identity, checkpoint discovery, and Resume assumptions.

`AGENTS.md` remains the repository working contract. In particular: make the smallest coherent change, keep state file-based and visible, do not add recovery machinery, and fail loudly when app-owned invariants are broken.

---

## 1. Purpose

The current training layout works, but three workflow costs have become real:

1. training actions are flat under `output/runs`, so sets do not have a stable, readable filesystem home;
2. managed checkpoint discovery recursively scans broad output trees and becomes slower and noisier as training history grows; and
3. explicit custom checkpoint Resume still exists in backend/UI plumbing, but it is buried under Manual command/diagnostics instead of being a first-class Resume choice.

The target is deliberately simple:

- one deterministic filesystem root per set;
- one readable logical-run root per Train action;
- every new WebCap-owned capture, job, log, and output beneath that logical-run root;
- managed Resume discovered only from the current set's managed filesystem tree;
- custom Resume as an explicit path that can point anywhere readable;
- no legacy-layout compatibility code, migration layer, historical importer, recovery graph, or persistent checkpoint index.

The filesystem remains the durable source of truth. `.webcap_training` queue/history data remains disposable convenience state.

---

## 2. Current code facts this plan is replacing

The implementation should be written against the code, not old prose. At the time this plan was approved, the relevant behavior is:

### `tool/server/training_action.py`

- `actions_root()` is `FS_ROOT/output/runs`.
- `allocate_action()` assigns one global sequence across every set and creates a flat action directory such as:

```text
FS_ROOT/output/runs/057-set-name--minimax-h3--optional-name/
```

- `read_action()` accepts a single action-folder basename.
- `managed_action_children()` inspects direct children of the global runs root.
- `ACTION_VERSION` is currently `1`.

### `tool/server/training_history.py`

- `discover_runs()` recursively searches the configured output root with `rglob("latest")`.
- It separately recursively searches every managed action output branch.
- Managed metadata is overlaid on discovered filesystem runs afterward.
- `resumeOutputId` is currently a generated 24-character hash.
- Legacy/configured-root and managed runs are intentionally mixed in the same picker.
- `discover_runs()` also feeds the saved-LoRA initializer picker.

This broad recursive discovery is the main reason Resume loading cost grows with the overall output tree.

### `tool/tool.html` and training frontend

- Starting point already offers `Fresh`, `Resume checkpoint`, and `Fine-tune from saved LoRA`.
- The managed checkpoint picker lives inside the Resume fields.
- The explicit path field `training-run-resume-input` is currently under the collapsed `Manual command & diagnostics` section and is labelled `Custom resume output path`.
- `getManagedTrainingOptions()` already sends either a managed `resumeActionId` / `resumeOutputId` pair or a raw `resumeFromCheckpoint` path.
- If a picker value remains selected, its discovered path/managed identity takes precedence over text typed into the custom path field. The UI therefore does not currently present a clean mutually-exclusive choice.

### `tool/server/training_runner.py`

- Fresh training allocates a WebCap action and normally captures beneath that action.
- Managed Resume can reuse the selected action root and captures current set inputs again.
- Custom Resume currently allocates a new action but deliberately places the new capture outside it under a `.webcap-captures/<uuid>` directory near the selected external output tree.
- Resume jobs currently initialize `outputRunPath` from the checkpoint source path, conflating the run being read with the new run being produced.
- H3 skips the explicit cache-only phase whenever `resumeStage` is set.

### Diffusion Pipe behavior relevant to this design

Upstream Diffusion Pipe documents two facts that make the clean custom-Resume design possible:

- `--resume_from_checkpoint` restores training state from the chosen checkpoint, while the config passed on the new command remains the active config; and
- each training invocation creates a new trainer run directory beneath that config's `output_dir`.

Diffusion Pipe also stores dataset caches inside the dataset directories. `--trust_cache` only accelerates loading when a cache already exists; it does not make a newly captured dataset magically share another run's cache.

Therefore a custom Resume can read an external checkpoint while writing all new output beneath a new WebCap logical run, and a newly captured H3 Resume must perform the normal cache phase before resumed training.

---

## 3. Hard design rules

These are decisions, not implementation suggestions.

### 3.1 No backward-compatibility layer

Do not add any of the following:

- legacy flat-action discovery;
- one-component action-ID fallback;
- old/new action manifest dual readers;
- old hashed `resumeOutputId` compatibility;
- migration of action directories;
- migration of `queue.json` or `recent_runs.json`;
- aliases from old paths to new paths;
- automatic import of old outputs into the new managed catalog;
- a `legacy` branch in normal Resume resolution.

Old trainer outputs remain ordinary files on disk. If the user wants to continue one, Custom Resume is the deliberate bridge.

### 3.2 Existing queued jobs may survive only naturally

Do not intentionally break an already-captured queued/running job, but do not write compatibility code for it either.

Current queue jobs already record practical paths such as captured artifacts, job directories, output roots, and checkpoint paths. If those recorded paths continue to work after the layout code changes, the queued job may continue unchanged.

Before deployment, test this narrowly.

If supporting an old queued job requires any special old-layout condition, parser, alias, migration, or extra compatibility line, do not add it. Reset `.webcap_training` and continue from a clean runtime state instead.

This is not a supported legacy contract. It is only permission to keep a queue that happens to remain valid because its recorded paths are already self-contained.

### 3.3 Filesystem is the durable source of truth

- Managed actions are discovered from their current filesystem location and `action.json` sentinel.
- Trainer runs are real directories containing real checkpoint evidence.
- Queue/history files do not decide whether an output exists.
- Do not introduce a database, cache database, checkpoint catalog, scan index, watcher, or background reconciliation process.

### 3.4 Fail loudly

For new-layout app-owned paths:

- malformed `action.json` in a directory that claims to be a managed action is an error;
- an unsafe action ID is an error;
- an unsafe managed output ID is an error;
- a selected checkpoint that no longer exists is an error;
- a custom checkpoint with no valid `latest`, checkpoint target, readable compatible config, or supported stage/model is an error.

Do not silently downgrade these to an empty picker or a different path.

### 3.5 No recovery subsystem

This change does not add automatic queue recovery, historical reconstruction, checkpoint repair, process reconciliation, path repair, or fallback behavior.

---

## 4. Target filesystem layout

All new managed training lives beneath:

```text
FS_ROOT/output/runs/
```

Each set gets one stable numbered set root. Its slug/hash identity is deterministic, while its global numeric prefix is allocated once when the set first receives managed training output. Each fresh logical run gets one numbered child:

```text
FS_ROOT/output/runs/
  <global-sequence>-<set-slug>--<set-path-hash>/
    001-<model-slug>--<optional-run-name>/
      action.json
      captures/
        <capture-id>/
          ...captured configs, datasets, media, captions, plan, summary, cache...
      jobs/
        <job-id>/
          runner.sh
          run.log
          result.json
          pid
          action
      output/
        <output-slug>/
          <diffusion-pipe-run>/
            latest
            global_step...
            epoch...
            config*.toml
            ...
```

Example:

```text
output/runs/
  068-nelly--4a8d91b72c3f/
    001-minimax-h3--baseline/
    002-minimax-h3--more-detail/
  069-wetsuit--7ce22f4d18a1/
    001-minimax-h3/
```

The set root exists to make the filesystem and TensorBoard tree predictable. The logical-run root remains the ownership boundary for WebCap's action, captures, jobs, and new trainer output.

No existing action or trainer output is moved into this structure.

---

## 5. Set-root identity

### 5.1 Set slug

Derive the visible set slug from the set folder basename:

- lowercase it;
- replace runs of characters outside `[a-z0-9._-]` with `-`;
- trim `.`, `-`, and `_` at the ends;
- cap the visible slug at 48 characters;
- if nothing usable remains, fail loudly.

Do not scan the filesystem to decide whether the hash suffix is needed. Always include it.

### 5.2 Set path hash

Hash the set's `FS_ROOT`-relative POSIX path with SHA-256 and use the first **12 hexadecimal characters**.

The hash is based on the path, not file content. A set rename or move intentionally produces a new set root. No attempt is made to follow, merge, or infer renamed sets.

Example source identity:

```text
training/characters/Nelly
```

identifies the set as:

```text
nelly--4a8d91b72c3f
```

### 5.3 No set manifest

Do not add a new `set.json` or registry. The slug/hash identity, its allocated filesystem prefix, and each logical run's existing `action.json` are enough.


### 5.4 Deferred alternative: pointer-first set-root identity

A pointer-based alternative to the visible path hash was considered but not implemented.

The proposed layout was:

    <set>/
      .webcap_training_root

    output/runs/
      068-dlu/
        .webcap-set
        001-minimax-h3/
        ...

The set-side `.webcap_training_root` would contain the assigned managed root name:

    068-dlu

The training-root `.webcap-set` marker would contain the set's `FS_ROOT`-relative path.

Lookup would be pointer-first:

1. If `.webcap_training_root` exists, read it and resolve that root directly.
2. If the pointer exists but is unreadable or invalid, fail loudly. Do not fall back or allocate another root.
3. If the pointer is genuinely absent, optionally inspect only the immediate children of `output/runs` for a `.webcap-set` marker matching the current set path.
4. If exactly one reverse marker matches, that root may be reused and the set-side pointer restored.
5. If no match exists, allocate a new set root.
6. If multiple roots claim the same set path, fail loudly.

This has several useful properties:

- the visible root can remain human-readable (`068-dlu`) with no opaque hash;
- the normal lookup path is direct and does not require scanning;
- because the pointer lives inside the set, a normal filesystem rename or move carries the managed-root association with it;
- temporary permission problems on the pointer fail visibly instead of silently creating a second root;
- accidental loss of the set-side pointer can potentially be repaired from the reverse marker while the set path remains unchanged;
- no central registry, database, background reconciliation, or broad recursive discovery is required.

The reverse marker is secondary metadata, not the primary identity mechanism. Its purpose is limited recovery from a missing pointer; it should never override a valid set-side pointer.

This design was deferred because it introduces two small pieces of persistent association state and corresponding consistency rules. The current path-derived hash requires less code and no stored association state. Since training run trees are generally short-lived and Custom Resume remains available when managed association is lost, that additional complexity is not currently justified.

If managed set-root loss becomes a real workflow problem, this pointer-first design is the preferred alternative to adding broader filesystem rediscovery or a central registry.

---

## 6. Logical-run allocation and action identity

### 6.1 Per-set sequence

Fresh actions are numbered independently inside their set root:

```text
001-minimax-h3
002-minimax-h3--detail-pass
003-wan22-lo
```

Allocation should:

1. derive the deterministic slug/hash identity and find its existing prefixed set root, or allocate the next global prefix;
2. inspect only its immediate child directories;
3. find the highest numeric action prefix;
4. attempt the next sequence with `mkdir` as the collision lock;
5. continue only on `FileExistsError` exactly as the current allocator does.

Do not preserve the current global action sequence.

### 6.2 Logical-run name

Use:

```text
<sequence>-<model-slug>--<optional-run-name-slug>
```

Keep the current run-name normalization limits unless a direct conflict is found. The user-facing `runName` remains stored separately from the filesystem-safe suffix.

### 6.3 Action ID

The new `actionId` is the POSIX path relative to `FS_ROOT/output/runs`:

```text
068-nelly--4a8d91b72c3f/002-minimax-h3--more-detail
```

It is not only the final directory basename.

This makes the action identity globally unique even though sequences are now per-set.

### 6.4 Action manifest version

Bump `ACTION_VERSION` from `1` to `2` for newly created action manifests.

There is no version-1 reader in the new action-resolution path. Old flat actions are outside new managed discovery anyway. If stale convenience state attempts to resolve an old action through the new reader, it should fail rather than trigger a compatibility path.

### 6.5 `read_action()` validation

For version-2 action IDs:

- reject absolute paths;
- reject `..`;
- require exactly two path components: set root and logical-run root;
- require the logical-run component to match the numbered action naming rule;
- join only beneath `actions_root()`;
- require a real non-symlink directory;
- require readable JSON;
- require `version == ACTION_VERSION` and exact `actionId` equality;
- retain existing manifest structure checks needed by current callers.

Do not accept a one-component old action ID.

---

## 7. Fresh training behavior

Fresh training is straightforward:

1. derive the current set root;
2. allocate a new logical-run root;
3. set the captured config's effective output directory to:

```text
<logical-run>/output
```

4. materialize the capture beneath:

```text
<logical-run>/captures/<capture-id>
```

5. create the job beneath:

```text
<logical-run>/jobs/<job-id>
```

6. let Diffusion Pipe create its trainer run beneath the output branch.

No WebCap-owned artifact from a fresh action should be created outside that logical-run root, aside from disposable global queue/history runtime files under `.webcap_training`.

---

## 8. Managed Resume behavior

A managed Resume means the checkpoint is already inside a version-2 logical run for the current set.

### 8.1 Identity

The UI sends the existing pair:

```json
{
  "resumeActionId": "068-nelly--4a8d91b72c3f/002-minimax-h3--more-detail",
  "resumeOutputId": "output/20260903_14-22-10"
}
```

The field names remain unchanged. Their internal meaning changes cleanly for version-2 actions:

- `resumeActionId` is the actions-root-relative logical-run path;
- `resumeOutputId` is the selected trainer-run path relative to that logical-run root.

The UI must continue treating both values as opaque implementation data. Do not display the output ID as the human label.

### 8.2 Managed Resume stays in the same logical run

Managed Resume reuses the selected logical-run root:

- same `action.json`;
- same logical-run name and `actionId`;
- a new capture beneath that action;
- a new job beneath that action;
- new Diffusion Pipe output directly beneath the same action's `output/` directory.

The selected checkpoint is read in place. It is not copied or moved.

### 8.3 Capture current set state

The Starting Point > Resume workflow keeps the current behavior of capturing the current visible set/TOMLs again before queueing.

That is important because Diffusion Pipe Resume uses the config supplied on the resumed command. The newly captured command/config is therefore the explicit state the user chose for the continuation.

Do not silently substitute an older captured config merely because the checkpoint originated in the same logical run.

### 8.4 Managed Resume resolution is direct

`resolve_managed_resume()` must not call broad `discover_runs()` and then search the result list.

Instead:

1. `read_action(resumeActionId)`;
2. verify `action.folder` is the current set's `FS_ROOT`-relative path;
3. verify the selected stage belongs to the action;
4. validate `resumeOutputId` as a safe relative path;
5. require it to be directly beneath the action's `output/` directory;
6. resolve the real trainer-run directory directly;
7. run the normal direct checkpoint validation described below.

A moved/deleted/invalid selected run fails loudly.

### 8.5 Old capture presence does not gate managed Resume

Do not require an earlier capture directory merely to prove that the selected trainer checkpoint is resumable. Starting Point > Resume creates a new capture.

The required durable evidence is:

- valid version-2 action identity and ownership;
- valid trainer-run directory;
- valid `latest` checkpoint target;
- readable compatible saved config.

---

## 9. Custom Resume behavior

Custom Resume is a first-class explicit workflow, not a diagnostic escape hatch.

### 9.1 Source

The user supplies a Diffusion Pipe trainer-run directory containing `latest`, for example an old WebCap run or an entirely external run.

It may live anywhere readable by the configured training environment.

### 9.2 Validation happens before mutation

Before allocating an action, capture directory, job, or output directory, backend `start_response()` must directly validate the custom path.

An invalid path must leave no new WebCap action or queue row.

Do not rely on a previous UI diagnostics call for this invariant.

### 9.3 Custom Resume creates a new logical run

A custom checkpoint is external input. New work belongs to a newly allocated logical run under the current set root.

Example:

```text
External source read only:
/mnt/w/old-training/nelly/20260822_10-14-08

New WebCap work:
FS_ROOT/output/runs/068-nelly--4a8d91b72c3f/004-minimax-h3--resume-old-good/
  action.json
  captures/...
  jobs/...
  output/<new-diffusion-pipe-run>/...
```

The custom checkpoint is never copied, moved, renamed, adopted, or written into.

### 9.4 New output stays inside the new logical run

For custom Resume, the captured config's `output_dir` must be the new action's normal output branch:

```text
<new-logical-run>/output
```

Do **not** set output to the parent of the external checkpoint.

Do **not** create `.webcap-captures` beside the external checkpoint/output root.

The external checkpoint is only the `--resume_from_checkpoint` source.

### 9.5 Remove external capture placement

Delete the current special custom-Resume behavior that chooses an `external_capture_root` near the selected checkpoint tree.

Every new capture must use the action's ordinary `captures/` subtree.

If the optional `capture_root` plumbing in `materialize_training_bundle()` becomes unused after this change, remove it only if doing so is local and clearly safe. Do not turn this task into a bundle-materializer refactor.

---

## 10. Direct checkpoint validation

Custom Resume must not depend on managed discovery.

Refactor `validate_resumable_run_for_path(folder_path, stage, run_path)` into true direct validation of the supplied path.

### 10.1 Required evidence

Given the raw selected training path:

1. resolve it to the host filesystem only for local inspection using the existing WSL/host path helper;
2. require a real trainer-run directory;
3. require a readable `latest` marker;
4. require `latest` to name a real `global_step<N>` directory using the existing checkpoint naming rule;
5. require a readable saved `config*.toml` that matches the selected stage's model identity keys;
6. compare the saved config hash with the current set config hash to classify `exact` vs `compatible` when useful;
7. derive the resume point with the existing `resume_point_from_directory()` logic;
8. return the raw training path for the actual command, not an invented replacement path.

### 10.2 Compatibility policy

Same model/stage identity is required.

Byte-exact current config equality is not required. `exact` vs `compatible` remains evidence, not a gate.

Do not attempt to validate every DeepSpeed optimizer/dataloader/config invariant. Diffusion Pipe owns trainer-level compatibility and will fail visibly if the user chooses an incompatible but same-model state.

### 10.3 No search fallback

If direct validation fails, report why.

Do not search neighboring directories, configured roots, action trees, Recent Runs, or old layouts trying to guess what the user meant.

---

## 11. Managed checkpoint discovery

The managed picker should become fast because it no longer searches the training universe.

### 11.1 Search scope

For the current set:

1. derive its deterministic slug/hash identity and find its existing prefixed set root;
2. if the set root does not exist, return no managed runs;
3. inspect only immediate logical-run children of that set root;
4. read their version-2 `action.json` manifests;
5. for actions that include the selected stage, inspect its `output/` directory;
6. inspect only immediate trainer-run children of that branch;
7. validate candidate checkpoint evidence.

There is no `rglob("latest")` over the configured global output root.

There is no recursive scan through captures, jobs, caches, epoch exports, `.webcap` directories, or unrelated sets.

### 11.2 Filesystem evidence remains authoritative

A valid managed candidate exists because the expected trainer-run directory and checkpoint evidence exist now.

`recent_runs.json` does not make a checkpoint discoverable.

Deleting or moving a managed trainer run naturally removes it from managed Resume discovery.

### 11.3 Broken managed actions

Inside the current set's prefixed root:

- ordinary unrelated/non-action directories may be ignored if they do not claim the managed action naming shape;
- a directory that matches the app-owned logical-run naming shape but has malformed/missing version-2 action metadata is a broken invariant and should fail visibly rather than disappear silently.

### 11.4 Candidate fields

Keep the existing useful candidate shape where possible, but managed entries should include at least:

```text
path / runPath
name                      trainer-run basename
stage / candidateFor
modelLabel
matchType                 exact | compatible
modifiedAt
checkpointAvailable
checkpointName            latest
checkpointTag
epoch / steps / expectedEpochs when available
resumeActionId
resumeOutputId
runName                    user run name when set
logicalRun                 readable logical-run directory basename
```

Do not add a second persistent catalog just to store these fields; derive them while the user explicitly loads Resume/history.

### 11.5 Managed output ID

Stop generating the 24-character hash for new managed candidates.

Use the trainer-run path relative to the action root, for example:

```text
output/20260903_14-22-10
```

The backend validates it as an action-contained relative path before use.

This value is still implementation data. The UI label is human-readable and does not expose it as the primary identity.

### 11.6 Sorting

Sort current-set managed candidates by trainer-run activity/mtime descending, as today.

---

## 12. Resume UI

Custom Resume moves out of Manual command/diagnostics and into the Resume starting-point controls.

### 12.1 Target layout

When `Starting point = Resume checkpoint`, show:

```text
Checkpoint
[ Choose a managed checkpoint... ]
<selected managed path/evidence>

or custom checkpoint directory
[ /mnt/w/.../trainer-run ]
```

Keep the existing stage selector where the selected model actually needs it.

### 12.2 Managed/custom mutual exclusion

The two inputs are alternatives.

- Selecting a managed checkpoint clears the custom path immediately.
- Entering a non-empty custom path clears the managed checkpoint immediately.
- `getManagedTrainingOptions()` sends exactly one source.
- Do not rely on backend rejection to resolve an ambiguous UI state.

### 12.3 Loading state

While the current-set managed candidates are being loaded, the select should visibly say something like:

```text
Loading current-set checkpoints...
```

When none exist:

```text
No managed checkpoints for this set
```

The custom path field remains usable in either case.

Because discovery is now shallow/current-set only, this loading state should normally be brief; it still exists so the UI never looks falsely complete while a request is pending.

### 12.4 Human labels

Do not lead with generated hashes, action IDs, or repeated set names.

Prefer a label shaped like:

```text
more-detail - H3 - epoch 42 / 90 - exact
```

or, when there is no run name:

```text
002-minimax-h3 - H3 - epoch 42 / 90 - exact
```

Use checkpoint tag/step when epoch evidence is unavailable.

The full selected run path can remain in the existing checkpoint-path detail below the select.

### 12.5 Run name behavior

- Fresh: run name names the new logical run.
- Custom Resume: run name names the new logical run being created.
- Managed Resume: the existing logical run is being continued, so do not pretend the field renames it. Disable/ignore the new run-name input while a managed checkpoint is selected, or visibly retain the existing run name through current UI behavior.

Choose the smallest implementation consistent with the existing UI wiring.

### 12.6 Manual command section

Remove the custom Resume field from `Manual command & diagnostics`.

Manual command generation should read the same Resume starting-point state as managed launch. There should be one custom checkpoint input, not two.

---

## 13. Separate checkpoint source from produced output

A Resume has two different paths:

- `resumeFromCheckpoint`: the source run whose DeepSpeed state is being read;
- `outputRunPath`: the new trainer run produced by the current invocation.

Do not initialize `outputRunPath` to `resumeFromCheckpoint` for a new Resume job.

### 13.1 New job

For fresh, managed Resume, and custom Resume:

```text
outputRunPath = empty until the current trainer invocation creates/binds its run
```

For Resume:

```text
resumeFromCheckpoint = selected source trainer run
```

### 13.2 Bind produced output from trainer evidence

Keep the existing log-based `_bind_job_run_path_from_log()` behavior as the primary binding mechanism.

Its existing shallow output-root/config fallback can remain if still needed.

The newly bound run must be beneath the job's effective output root for new-layout jobs.

### 13.3 Pause requeue

When Pause turns an active job back into queued resumable intent:

1. copy the current produced `outputRunPath` into `resumeFromCheckpoint`;
2. set the resume stage;
3. clear `outputRunPath` so the next invocation can bind the new trainer-run directory it produces.

Do not leave source and produced output conflated across repeated pauses.

---

## 14. H3 cache behavior on Resume

H3 captured dataset directories own their caches. A new capture means new dataset directories.

The H3 runner therefore must execute its existing cache-only phase before the training phase even when `resumeStage == "h3"`.

Target flow:

```text
h3 cache-only against the current captured config/dataset
h3 train against the same captured config/dataset + --resume_from_checkpoint <source>
```

For a paused job that reuses an already cached capture, `--trust_cache --cache_only` should simply reuse that cache quickly.

Do not add cache-copying, cache discovery across actions, cache migration, or a special external-cache path.

Do not add `--regenerate_cache` automatically.

---

## 15. Recent Runs and initializer discovery

### 15.1 Recent Runs remains disposable

`recent_runs.json` remains a presentation index only.

Do not make it the managed checkpoint catalog.

Clearing history must not remove actions or checkpoints.

### 15.2 Existing Recent Runs Resume workflow

Do not redesign the Recent Runs one-click Resume workflow unless the nested action identity directly requires a small adjustment.

Its recorded `actionId`, `inputPath`, checkpoint path, and other practical paths should naturally point to the new logical-run tree for new jobs.

If a broader unification of Recent Runs Resume with the Starting Point picker is desirable later, treat that as separate work.

### 15.3 Init LoRA

The current saved-initializer picker calls `discover_runs()` for the current set/stage and then inspects epoch exports.

After this change it should automatically benefit from the same current-set-only managed discovery.

Do not auto-discover old/external LoRA outputs. The existing explicit initializer path remains the bridge for those.

---

## 16. HTTP/API contract

No new HTTP route is required.

Keep the existing route families and payload fields.

### Managed Resume

```json
{
  "resumeActionId": "<set-root>/<logical-run>",
  "resumeOutputId": "output/<trainer-run>",
  "resumeFromCheckpoint": ""
}
```

### Custom Resume

```json
{
  "resumeActionId": "",
  "resumeOutputId": "",
  "resumeFromCheckpoint": "/explicit/trainer/run/path"
}
```

Backend validation still rejects requests that provide both managed identity and a raw custom path.

`/fs/training_history?folder=...` can continue returning current-set managed resume candidates. No generic search/index endpoint should be introduced.

---

## 17. Queue and history clean-break policy

### 17.1 Do not migrate runtime state

There is no queue/history migration for the new action identity.

### 17.2 Natural queue survival probe

Before deciding whether a live `.webcap_training` directory can be kept across deployment, verify the current runner with a focused test/inspection:

- an already queued old-layout job launches using its recorded `artifactDir`, `bundleArtifacts`, `outputRoot`, and checkpoint paths;
- normal active-job control does not require resolving its old `actionId` through the new version-2 action reader.

If this works without any compatibility code, the existing queue may finish naturally.

If it does not, stop trying to preserve it.

### 17.3 Reset procedure when needed

When a clean runtime reset is required:

1. ensure no active trainer still depends on WebCap queue/control state;
2. stop WebCap;
3. delete:

```text
FS_ROOT/.webcap_training
```

4. leave `FS_ROOT/output/runs` untouched;
5. deploy/start the new version;
6. use Custom Resume for any old checkpoint that still matters.

Deleting `.webcap_training` intentionally forgets queue/history/runtime convenience state. It does not delete trainer output, set TOMLs, source media, captions, or the persisted H3 calibration settings in `tool/config.json`.

No code should be added to make the reset unnecessary.

---

## 18. Old output behavior after the clean break

Existing flat action/output directories may remain physically beneath `FS_ROOT/output/runs`.

New managed discovery ignores them because it derives only the deterministic current-set root and reads only version-2 actions there.

They may still appear in the global TensorBoard tree because TensorBoard observes the whole runs root. That is acceptable.

If an old run matters:

- select Starting Point = Resume checkpoint;
- paste its trainer-run directory into Custom checkpoint directory;
- validate/launch it explicitly;
- all new work lands in a new version-2 logical run.

No importer is needed.

---

## 19. Implementation changes by file

This is the expected smallest coherent change set. Inspect actual call sites before deleting anything, but do not broaden the architecture.

### 19.1 `tool/server/training_action.py`

Implement the new filesystem identity:

- deterministic set-root helper;
- path hash from `FS_ROOT`-relative POSIX set path;
- per-set action allocation;
- version-2 action IDs as `<set-root>/<logical-run>`;
- version-2 `read_action()` path validation;
- nested current-set managed action enumeration.

Prefer a direct helper such as `managed_actions_for_folder(folder_path)` over repeatedly scanning every set when only one set is needed.

Do not implement an old flat-action reader.

### 19.2 `tool/server/training_history.py`

Replace broad discovery:

- remove the configured-global-root recursive checkpoint scan from managed `discover_runs()`;
- remove `_managed_run_metadata()` overlay behavior if it no longer serves another real caller;
- discover version-2 actions only beneath the current set root;
- inspect only expected output branches and immediate trainer-run children;
- emit action-relative `resumeOutputId` values;
- rewrite `resolve_managed_resume()` as direct action/output resolution;
- rewrite `validate_resumable_run_for_path()` as direct custom path validation independent of `discover_runs()`;
- keep `resume_point_from_directory()` and useful saved-config/model-identity helpers rather than reimplementing them.

Do not retain legacy/configured-root discovery under a second function.

### 19.3 `tool/server/training_runner.py`

Adjust launch semantics:

- validate custom Resume directly before action/capture/output allocation;
- managed Resume reuses its action root;
- custom Resume allocates a fresh current-set logical run;
- all new output roots are `action_root/output`;
- remove custom `.webcap-captures` placement;
- all ordinary captures stay under `action_root/captures`;
- keep `resumeFromCheckpoint` as source evidence;
- start new jobs with empty `outputRunPath`;
- clear produced `outputRunPath` when Pause converts it into the next resume source;
- allow log evidence to bind the new produced trainer run;
- run the H3 cache phase before resumed H3 training too.

`validate_response()` should validate the selected checkpoint but should validate the **current** set/config that will actually be captured for Starting Point > Resume. It should not require an old action capture merely to validate a managed checkpoint.

If `_bundle_from_action()` exists only to make managed validation use an old capture, remove that use and delete the helper only if it becomes genuinely unused.

Keep `_bundle_from_recorded_capture()` if the existing Recent Runs one-click Resume still uses it.

### 19.4 `tool/server/training_bundle.py`

The default capture placement already belongs beneath `action/captures/<uuid>`.

The required behavioral change is primarily to stop overriding that placement for Custom Resume.

Avoid unrelated capture-layout refactoring.

### 19.5 `tool/js/training_history_ui.js`

- render friendly managed checkpoint labels using run name/logical run + stage + checkpoint evidence + exact/compatible;
- do not surface `resumeOutputId` hashes/paths as the option label;
- preserve selected full path detail;
- show explicit loading/empty states;
- continue filtering candidates to the selected stage.

### 19.6 `tool/js/training_runner_ui.js`

- keep one options object for both managed launch and manual command;
- make managed/custom resume mutually exclusive;
- emit exactly one of managed IDs or raw custom path;
- keep current backend mutual-exclusion validation too.

### 19.7 `tool/js/training_review.js`

- Resume button state is satisfied by either a managed candidate or non-empty custom path;
- changing Starting point away from Resume clears both Resume choices as appropriate;
- do not create parallel Resume state beyond existing workspace state/DOM controls.

### 19.8 `tool/tool.html`

- move the existing `training-run-resume-input` into `training-run-resume-fields`;
- relabel it clearly as an explicit custom checkpoint directory;
- remove it from Manual command & diagnostics;
- keep one field with the existing ID so current JS wiring can be changed minimally.

### 19.9 CSS

Use existing training option/dependent-field styles if possible.

Do not redesign the Training panel for this feature.

---

## 20. Tests

The current resume-discovery tests explicitly require legacy/global discovery. Replace those expectations; do not preserve them.

### 20.1 Action layout tests

Add focused tests proving:

- a set gets the next global `<sequence>-<slug>--<hash>` root;
- the same set allocates `001`, then `002` beneath that root;
- a different set starts its own `001` sequence;
- two sets with the same basename but different relative paths get different set roots;
- run-name normalization remains bounded and filesystem-safe;
- action IDs are `<set-root>/<logical-run>`;
- version-2 `read_action()` resolves them safely;
- one-component/unsafe IDs are rejected;
- action allocation remains collision-safe through `mkdir`.

### 20.2 Managed discovery tests

Rewrite `tests/test_training_resume_discovery.py` around the new contract:

- current-set version-2 managed checkpoint is discovered;
- another set's checkpoint is not discovered;
- an old flat action/checkpoint under the global runs root is not discovered;
- a valid checkpoint under the canonical configured output root but outside the current set root is not auto-discovered;
- a `latest` nested under captures/jobs/cache is not discovered;
- wrong-model and invalid-`latest` trainer runs are excluded;
- changed same-model config is `compatible`;
- byte-identical current config is `exact`;
- results sort by trainer-run activity;
- `resumeActionId` is the nested action identity;
- `resumeOutputId` is the action-relative trainer-run path, not a generated hash.

Delete tests whose only purpose is to guarantee legacy mixed discovery.

### 20.3 Custom path validation tests

Prove direct custom validation:

- accepts a valid external trainer run outside WebCap's managed tree;
- accepts same-model compatible config;
- rejects nonexistent directory;
- rejects invalid/missing `latest`;
- rejects missing checkpoint directory;
- rejects wrong model identity;
- rejects unreadable/malformed saved config;
- does not require the path to appear in `discover_runs()`;
- does not mutate the external trainer run.

### 20.4 Managed resolver tests

Prove:

- valid action/output pair resolves directly;
- wrong-set action is rejected;
- wrong stage is rejected;
- absolute/`..` output IDs are rejected;
- output IDs outside the expected action output branch are rejected;
- deleted selected run fails loudly.

### 20.5 Runner layout tests

Prove:

- fresh launch allocates all WebCap-owned artifacts inside the new logical run;
- managed Resume reuses the selected logical-run root but creates a new capture/job;
- custom Resume allocates a new logical run;
- custom source remains external/read-only;
- custom new capture and output remain inside the new logical run;
- invalid custom Resume creates no new action/capture/queue row;
- new Resume job stores source in `resumeFromCheckpoint` and does not prefill `outputRunPath`;
- trainer log binding records the produced run;
- Pause promotes produced run to the next `resumeFromCheckpoint` and clears `outputRunPath` for rebinding.

### 20.6 H3 runner tests

Update command/runner tests to prove resumed H3 runs execute:

1. cache-only phase for the current capture;
2. train phase with `--resume_from_checkpoint`;
3. no automatic cache regeneration/copying.

### 20.7 UI contract tests

Where the current test style permits, assert:

- custom Resume input is inside Resume fields;
- it is no longer inside Manual command/diagnostics;
- managed selection clears custom path;
- custom path entry clears managed selection;
- friendly labels do not lead with opaque output IDs.

Do not introduce a frontend test framework solely for this feature.

### 20.8 Natural old-queue probe

Add or perform one focused diagnostic proving whether an already-recorded old-layout queued job still launches using only its saved practical paths under the new code.

If it passes without compatibility code, good.

If it fails, do not make it pass by adding legacy support. Document that deployment requires deleting `.webcap_training`.

### 20.9 Full suite

After focused tests:

```text
python -m pytest
```

must pass.

---

## 21. Documentation transition

The superseded tentative layout documents were removed when this work landed. `docs/README.md` identifies this file as the design/acceptance record; the current-behavior documents below describe the shipped workflow.

### In the implementation commit

Once code is changed, update only the directly affected current-behavior sections in:

```text
README.md
docs/spec.md
docs/train.md
docs/training_stabilization.md
docs/training_runner_contract.md
docs/README.md
docs/outstanding.md
```

Those updates must describe the code that actually landed:

- set-root/logical-run layout;
- current-set managed discovery;
- first-class Custom Resume;
- external checkpoint read/new logical-run write behavior;
- queue/history disposable-state clean break;
- H3 Resume cache phase if implemented as specified.

Do not use this feature as an excuse to rewrite unrelated stale documentation.

After implementation, this plan may remain as the design/acceptance record, but current operational docs should be the place a user looks for shipped behavior.

---

## 22. Deployment / training-machine smoke test

Development tests cannot establish real Diffusion Pipe behavior on the training machine.

After deployment:

1. decide whether the existing `.webcap_training` queue naturally survives from recorded paths; if there is any doubt or special-case requirement, reset it instead;
2. start WebCap and open a known set;
3. create one small fresh H3 run and confirm its set/logical-run layout;
4. confirm the managed Resume picker loads only current-set runs quickly;
5. Pause after a real checkpoint, Resume, and confirm H3 cache then resumed training works;
6. confirm the new produced trainer run is recorded separately from the checkpoint source;
7. take one old/external known-good H3 trainer run and Resume it through Custom checkpoint directory;
8. confirm the external run is unchanged;
9. confirm the new capture/job/output all appear beneath a new current-set logical run;
10. confirm TensorBoard still sees the global `output/runs` tree and the new set roots group predictably.

Any trainer-level failure should be diagnosed from that run's log. Do not add environment guards or recovery machinery in response to the layout change.

---

## 23. Explicit non-goals

Do not add any of the following as part of this work:

- legacy action compatibility;
- legacy checkpoint auto-discovery;
- output migration/import;
- automatic action rename/move;
- set-rename reconciliation;
- persistent checkpoint index/database;
- background output scanner;
- filesystem watcher;
- recovery graph;
- automatic queue reconstruction;
- path aliases/symlinks for old actions;
- old `resumeOutputId` hash support;
- automatic cleanup/retention;
- trainer-output deletion;
- checkpoint copying;
- cache copying between runs;
- automatic `--regenerate_cache`;
- arbitrary DeepSpeed-state compatibility prediction;
- new training models;
- generic training-layout framework;
- TensorBoard per-action routing;
- queue redesign;
- Recent Runs redesign beyond what nested action IDs directly require;
- initializer redesign beyond inheriting the faster current-set discovery;
- unrelated training-profile/config/bucket changes.

---

## 24. Acceptance criteria

The implementation is complete only when all of the following are true:

- New actions are grouped under deterministic alphabetically useful set roots.
- Action numbering is per-set.
- Every new fresh/custom action capture, job, log, and output is beneath one logical-run root.
- Managed Resume reuses the selected logical-run root.
- Custom Resume is visible directly in the Resume UI without opening diagnostics.
- Managed and custom Resume choices are mutually exclusive in the UI and payload.
- Managed Resume discovery does not recursively scan the global configured output tree.
- Managed Resume discovery reads only the current set's version-2 action tree.
- Old flat actions are not auto-discovered and have no compatibility parser.
- A valid old/external checkpoint can still be used explicitly through Custom Resume.
- Custom checkpoint validation is direct and happens before new filesystem/queue mutation.
- Custom Resume never writes new captures/output beside the external checkpoint.
- `resumeFromCheckpoint` and the current job's produced `outputRunPath` are distinct concepts in runner state.
- A new Resume invocation can bind its actual produced trainer run.
- H3 Resume prepares/loads the current capture's cache before resumed training.
- Queue/history remain disposable convenience state.
- No compatibility/migration/recovery layer was added.
- Focused tests and the full repository test suite pass.
- The training-machine fresh, managed-Resume, Pause/Resume, and external Custom-Resume smoke paths work.

---

## 25. Codex execution instruction

Read `AGENTS.md` first, then read this entire document before editing.

Inspect the current implementations of:

```text
tool/server/training_action.py
tool/server/training_history.py
tool/server/training_runner.py
tool/server/training_bundle.py
tool/js/training_history_ui.js
tool/js/training_runner_ui.js
tool/js/training_review.js
tool/tool.html
tests/test_training_resume_discovery.py
```

and any directly referenced tests/helpers before changing them.

Implement the smallest coherent change set that satisfies this plan.

Important constraints:

- Do not preserve the old flat action layout through compatibility code.
- Do not preserve legacy/global checkpoint discovery.
- Do not add migration, indexing, recovery, watchers, databases, aliases, or fallback resolution.
- If an existing queued old-layout job continues naturally because it already records usable paths, leave that natural behavior alone.
- If supporting an old queued job requires even a special legacy condition, do not add it; report that `.webcap_training` must be reset.
- Keep raw Custom Resume explicit and direct.
- Keep all new custom-resume output inside its newly allocated logical run.
- Preserve current training behavior outside the explicitly specified layout, discovery, Resume source/output separation, and H3 Resume cache corrections.
- Fail loudly on broken app-owned invariants.
- Do not broaden the work into a general training refactor.

After focused tests pass, run the full suite. Then update the directly affected current-behavior documentation listed in this plan so documentation and code land together.

If the actual code materially contradicts a requirement in this document in a way that cannot be resolved with the scoped changes above, stop and report the exact conflict rather than inventing a larger architecture.
