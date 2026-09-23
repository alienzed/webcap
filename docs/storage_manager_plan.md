# Storage Manager Plan

**Status:** MVP implemented on `feature/storage-manager-mvp` / PR #66; this document is the governing design and audit record.

**Purpose:** give WebCap one calm, high-level view of the disk space it creates directly or causes external runtimes to create, with safe drill-down, **Open**, and deliberately scoped **Purge / Delete** actions.

This plan follows `AGENTS.md`: file-based ownership stays explicit, destructive actions stay deliberate, generated inference artifacts may be permanently deleted, source Set media/state remains protected, and the smallest useful implementation is preferred over a generic storage framework.

The historical precursor is the removed `docs/training_artifact_cleanup.md` around commits `d99517d7` / `40dbd16`. That work established the important idea that WebCap should know the ownership boundary of artifacts it creates before it attempts cleanup.

---

## 0. Hostile audit and revised invariants

The first draft had several unacceptable failure modes:

- category-level recursive measurement could still become a disguised whole-area `du`;
- "generated" was too broad a deletion criterion;
- Test results are distributed beneath Sets, so a complete global count would require an index or an explicit discovery pass;
- category totals could hide stale or unknown item measurements;
- authored/safety Set data was too close to reclaimable artifacts conceptually;
- ComfyUI scratch cleanup was framed too much as Storage work instead of inference lifecycle work.

The revised invariants are:

1. **No automatic recursive walk of `FS_ROOT`.** Opening Storage uses known producer roots, direct-child enumeration, disk capacity, and cached item measurements.
2. **Measurement is item-scoped.** One request measures one positively owned unit. **Measure all** sequences those bounded requests rather than issuing one monolithic server scan.
3. **Deletion is identity-scoped, never path-scoped.** The browser sends a producer area and domain ID; the backend re-resolves ownership immediately before mutation.
4. **Set source/authored files are undeletable from Storage.** Media, captions, Set state, `originals/`, and user-authored Set configuration are not purge targets.
5. **Derived artifacts require manual deletion.** Training/Diffusion-Pipe outputs, Test Sessions, Generate results, Storyboard material, completed probes, staged Test copies, and other positively owned derived output may be deleted only through an explicit user action and confirmation.
6. **ComfyUI scratch is lifecycle-managed.** Exact WebCap-prefixed provider inputs/outputs should be removed automatically once safely ingested or conclusively abandoned; Storage surfaces leftovers when automatic cleanup cannot be proven.
7. **Unknown is not zero and not ours.** Missing measurement remains **Not measured**; unknown/external files never become reclaimable merely because of proximity.
8. **Active/reference safety wins.** Active or referenced units remain protected.
9. **Storage owns no other activity UI.** Implementation stays in Storage files plus minimal shell/route wiring; domain operations are reused without changing their screens.

### MVP producer inventory

- **Training:** current managed logical-run directories beneath `output/runs`.
- **Generate:** manifest-owned results beneath `output/generations`.
- **Storyboard:** Story folders beneath `output/storyboards`.
- **Tests:** current-Set Test Sessions only in the first MVP. The category is explicitly marked partial; historical global Test discovery is not performed automatically.
- **Runtime:** known WebCap runtime roots and H3 probes.
- **ComfyUI:** exact `webcap-*` provider subtrees only; never arbitrary ComfyUI content.
- **Set data:** protected context only; no source/authored Set deletion.

### Safe implementation phases

**Phase 1 — producer inventory + read-only backend.** Isolated `storage_manager.py`; direct producer enumeration; disk capacity; disposable item-size cache; one-item measurement. No global crawl.

**Phase 2 — Storage activity UI.** Global Storage activity; largest-first rows; stale/not-measured states; item-level Measure; sequential Measure all; Open. No changes inside action screens.

**Phase 3 — manual derived-artifact deletion.** Identity dispatch re-resolves ownership and calls existing domain deletion semantics or sentinel-validates a managed artifact. No arbitrary delete endpoint.

**Phase 4 — ComfyUI lifecycle hygiene.** Successful ingestion/abandonment removes exact WebCap-owned provider files/directories. Storage remains the audit/recovery surface, not the primary cleanup mechanism.

**Phase 5 — hostile implementation audit / North Star pass.** Re-test ownership, active/reference protection, symlink/path escape, shell isolation, and operational clarity; remove accidental complexity.

---

## 1. Product goal

WebCap increasingly creates substantial disk usage in several independent workflows:

- Training captures, logs, checkpoints, exported epochs, and trainer output.
- Test Generation sessions and copied candidate LoRAs.
- Standalone Generate results.
- Storyboard Stories, Takes, and references.
- Prepared Set data and reversible originals.
- Calibration/runtime state.
- Temporary reference files and ComfyUI input/output material created on WebCap's behalf.

The Storage Manager should answer, quickly:

1. **How much free space is left?**
2. **Which WebCap-owned areas are consuming the most space?**
3. **What are the largest individual runs/sessions/stories/results?**
4. **Can I open the owning folder?**
5. **Can I safely reclaim it from WebCap?**
6. **Is something that should have been transient still hanging around?**

The first release should emphasize visibility over aggressive cleanup.

---

## 2. UX model

Use the familiar pattern from iPhone/iPad Storage and Windows Storage:

- capacity / free-space summary at the top;
- a small categorized usage bar;
- categories ordered by size;
- tap/click a category to see its largest consumers;
- show the amount reclaimable before destructive action;
- keep persistent data and temporary/rebuildable data visually distinct.

Useful reference patterns:

- Apple device storage: https://support.apple.com/guide/iphone/manage-storage-iph47c931112/ios
- Windows Storage and Cleanup recommendations: https://support.microsoft.com/en-us/windows/experience/storage-filemanagement/storage-settings-in-windows
- Docker's useful separation of **disk usage** (`docker system df`) from explicit **prune** (`docker system prune`):
  - https://docs.docker.com/reference/cli/docker/system/df/
  - https://docs.docker.com/reference/cli/docker/system/prune/

WebCap should borrow the concepts, not imitate those UIs literally.

### Proposed activity

Add **Storage** as a first-class global activity in the left activity rail, near the other global operational activities.

Storage is global rather than Set-owned. It may show a small **Current Set** subsection when a Set is open, but its primary view is the whole WebCap workspace.

### Overview layout

At the top:

```text
Storage

W:  438 GB free of 1.81 TB

[ Training ][ Tests ][ Generate ][ Storyboard ][ Set data ][ Runtime ]
```

Below, a simple list sorted largest first:

```text
Training                         612 GB     72%
Tests                             81 GB     10%
Storyboard                        44 GB      5%
Generate                          23 GB      3%
Set-generated data                8 GB      1%
Runtime / temporary             1.2 GB     <1%
```

Each row should show:

- category;
- measured size;
- item count where meaningful;
- last-measured age if the value came from a cached scan;
- reclaimable amount when WebCap can identify it safely;
- **Open**;
- **Details**.

Do not make the first screen a file browser.

### Details panels

The first useful panels are:

1. **Training**
2. **Tests**
3. **Generations**
4. **Storyboard**
5. **Set Data**
6. **Runtime / Temporary**

Within each panel, sort by size descending by default. This makes "most egregious" the normal view instead of a special report.

A row should generally represent the domain object the user already understands:

- Training -> logical run / action;
- Tests -> Test Session;
- Generate -> Generation result;
- Storyboard -> Story, then optionally Scene/Take;
- Set Data -> Set and known generated subareas;
- Runtime -> named scratch owner such as Generate references, H3 probes, or ComfyUI WebCap scratch.

---

## 3. Hard scanning rule

**Opening Storage Manager must never recursively walk the entire filesystem root.**

In particular, do not reuse the broad `os.walk(FS_ROOT)` pattern currently used by Test Generations recent-set discovery.

Directory size is not cheaply available from normal filesystem metadata on all supported platforms, so the UI must be honest about when a size is measured versus cached.

Use three levels of accounting.

### Level A - instant facts

Always cheap:

- filesystem capacity / free bytes using `shutil.disk_usage()`;
- size of known individual files;
- existence of known roots;
- direct-child counts for app-owned roots;
- sizes already recorded in WebCap manifests / cached summaries.

This is enough to render Storage immediately.

### Level B - bounded producer-aware measurement

For storage layouts WebCap controls, calculate size without a generic arbitrary-depth crawler where practical.

Examples:

- Generate result: known result file + `generation.json` + `references/`.
- Test Session: known Session folder contents.
- Storyboard: known Story folder with `takes/`, `references/`, and `story.json`.
- H3 probe: one known probe directory.
- copied Test LoRA: exact file plus its `.webcap.json` sidecar.

These routines should understand only their domain's owned layout.

### Level C - explicit recursive measurement

Training output can contain trainer-created nested checkpoint state whose exact size cannot be inferred safely without walking it.

For that case:

- do **not** scan on app startup;
- do **not** scan on every Storage open;
- expose **Measure Training** / **Refresh sizes**;
- scan one known logical-run root at a time;
- show progress and allow cancellation;
- cache the result and measurement timestamp.

The same explicit scan may be used once to discover legacy / distributed Set-local Test data when no index exists.

A user-requested measurement is allowed to be expensive. An ordinary page load is not.

---

## 4. Size cache strategy

Start simple.

A small app-owned cache can live at:

```text
FS_ROOT/.webcap/storage_usage.json
```

It is disposable presentation data, never ownership truth.

Suggested information:

```json
{
  "version": 1,
  "measuredAt": "...",
  "areas": {
    "training": {"bytes": 0, "measuredAt": "..."},
    "tests": {"bytes": 0, "measuredAt": "..."}
  },
  "items": {
    "training:<actionId>": {"bytes": 0, "measuredAt": "..."}
  }
}
```

Do not put path authority, retention rules, or deletion permission in this file.

### Keep the cache fresh at natural lifecycle moments

Over time, prefer updating measurements when work naturally reaches a terminal boundary rather than rescanning later:

- after a Generate result is persisted;
- after a Test rendition/session finishes or is deleted;
- after a Storyboard Take is persisted/deleted;
- after a Training job reaches a terminal state, measure **that logical run only**;
- after an H3 probe ends or is removed;
- after Storage itself performs a purge.

Diffusion Pipe writes files independently of WebCap, so Training still needs a localized terminal measurement rather than trying to count bytes as they are written.

Existing pre-plan data may show **Not measured** until explicitly measured. That is preferable to a hidden global scan.

---

## 5. Current storage ownership map

This is the codebase-grounded starting inventory.

### 5.1 Training - large, global, app-owned

Current managed root:

```text
FS_ROOT/output/runs/
  <set-root>/
    <logical-run>/
      action.json
      captures/
      jobs/
      output/
```

Authority:

- `tool/server/training_action.py`
- `tool/server/training_bundle.py`
- `tool/server/training_runner.py`
- `tool/server/training_history.py`

This should be the highest-priority Storage panel.

Useful breakdown per logical run:

- total bytes;
- captured inputs / cache;
- job logs/evidence;
- trainer output;
- largest direct output run;
- created / last modified;
- model/stage/run name from `action.json`;
- whether anything is active, queued, resumable, or referenced.

**Open:** yes.

**Purge:** not in the first visibility-only slice. When added, deletion must be expressed in Training domain terms, not "delete arbitrary folder."

Potential later actions:

- **Delete logical run** — only after reference and active-job checks.
- **Remove captured input/cache** — only if its effect on Resume/reproducibility is explicitly defined.
- **Delete selected epoch/checkpoint** — only if Training already has a safe domain operation and references are checked.

Do not infer safety from age alone.

The existing `recent_jobs()` helper in `training_history.py` was originally introduced for "internal storage-reference checks" and is a useful historical clue, but it must not become a second ownership database.

### 5.2 Test Generations - Set-local durable output

Current durable layout:

```text
<set>/test-generations/<session>/
  test.json
  generated media
  captions
  .webcap_state.json
```

Authority:

- `tool/server/epoch_test_bench.py`

Existing safe behavior already includes:

- individual result removal;
- session deletion;
- refusal to delete an active Session.

**Open:** yes.

**Purge:** yes, reuse the domain's existing Session delete semantics.

Storage should group Tests by Set, then Session, while the top-level category shows aggregate measured size.

Important: current global recent-Test discovery uses `os.walk(FS_ROOT)`. Storage Manager must not silently do the same. Until Test Sessions have a cheap global index, use cached measurement plus explicit **Discover / Measure Tests** for historical Sessions.

### 5.3 Copied Test LoRAs - external configured roots

Training can copy candidate epoch `.safetensors` files into configured `training.test_copy_roots`, with `.webcap.json` provenance sidecars.

Authority:

- `tool/server/training_test_paths.py`
- `tool/server/training_runner.py`

These paths may be outside `FS_ROOT`, so they belong under a distinct **Staged Test LoRAs** subsection.

Do **not** measure or purge arbitrary contents of the configured root.

WebCap may identify files it owns by its exact naming/provenance contract and sidecar.

**Open:** yes.

**Purge:** only exact WebCap-owned copied candidate + sidecar pairs, preferably through the existing remove-from-Test operation.

### 5.4 Generate - global durable output

Current durable root:

```text
FS_ROOT/output/generations/
  YYYY-MM-DD/
    <job-id>/
      result.<ext>
      generation.json
      references/
```

Transient uploaded references:

```text
FS_ROOT/.webcap_runtime/generate-references/
```

Authority:

- `tool/server/generate_store.py`
- `tool/server/generate_generation.py`

Generate currently persists each result and its provenance cleanly. It has no equivalent permanent result-deletion operation yet.

**Open:** yes.

**Purge:** add a narrow Generate-domain delete operation that resolves a result by manifest/job identity and removes exactly its result directory. Generated inference material is derived data, so no trash layer is required, but confirmation must be explicit.

The transient reference root should normally be near zero when no Generate job owns references.

### 5.5 Storyboard - global durable authored + generated data

Current root:

```text
FS_ROOT/output/storyboards/<story-id>/
  story.json
  takes/
  references/
```

Authority:

- `tool/server/storyboard_store.py`
- `tool/server/storyboard_generation.py`

Storyboard already has domain-safe operations for:

- Delete Story;
- reversible Remove / Restore Take;
- permanent Delete Take;
- uploaded-reference replacement cleanup;
- reference safety checks that prevent deleting Take media still in use.

**Open:** yes.

**Purge:** Storage must call Storyboard semantics rather than deleting folders itself.

Recommended detail view:

- Story total;
- Takes total;
- References total;
- removed-but-not-permanently-deleted Takes as **reclaimable**;
- largest Takes.

A whole Story contains user-authored intent as well as generated media, so label that destructive action **Delete Story**, not generic Purge.

### 5.6 Set-generated data

Known Set-local WebCap files include:

```text
<set>/
  originals/
  auto_dataset/
  test-generations/
  media_metadata.json
  .webcap_state.json
  <media>.txt
  training TOMLs
```

Not all of this is reclaimable.

#### `originals/`

Safety backup for reversible source-media mutation.

- Surface size.
- **Open**.
- No general Purge in Storage v1.

Deleting originals changes the source-media recovery contract and should not be presented as routine cleanup.

#### `auto_dataset/`

Prepared/rebuildable dataset material. Current training architecture captures its own run material, and project docs already describe legacy `auto_dataset/` as ignored by new training.

- Surface size.
- **Open**.
- Protected from Storage deletion because it is Set-owned. Rebuildability does not override the Set-file invariant.

#### metadata/state/captions/TOMLs

Usually small and semantically important.

- show collectively only when useful;
- do not clutter the main "largest consumers" screen;
- do not offer bulk purge for captions, `.webcap_state.json`, or training configuration;
- `media_metadata.json` is rebuildable, but clearing it is low-value unless it becomes materially large.

Global discovery of arbitrary Sets must not force a deep filesystem walk. In v1, show these for the current Set and include any Set-local data discovered during an explicit Test/Set measurement.

### 5.7 Runtime state and calibration

Known roots include:

```text
FS_ROOT/.webcap/
  execution_queue.json

FS_ROOT/.webcap_training/
  queue.json
  recent_runs.json
  h3-probes/

FS_ROOT/.webcap_runtime/
  generate-references/
```

The queue/history JSON files are small and should normally be informational only.

H3 probes may contain copied source video and result material and can be meaningful storage consumers.

**Open:** yes for probe roots.

**Purge:** completed/inactive probe directories are good candidates; active probes must be protected.

Runtime queue/history metadata should not receive a generic purge button in Storage Manager.

---

## 6. ComfyUI scratch ownership and cleanup

This is a separate but important part of Storage Manager because WebCap causes files to be created outside `FS_ROOT`.

Current WebCap-owned provider prefixes include:

```text
webcap-generate/<job-id>/...
webcap-storyboard/<story-id>/<scene-id>/<job-id>/...
webcap-tests/<session>/<candidate>/...
```

These can appear beneath ComfyUI `input/` and `output/`.

### Existing behavior

- **Tests** move the completed saved output into the Test Session and then remove the exact owned ComfyUI output directory, pruning empty parents.
- **Generate** persists its own copy, then `cleanup_saved_output()` currently unlinks the captured provider output file.
- **Storyboard** persists the Take, removes temporary uploaded input references where the provider layout can be proven, and unlinks the captured provider output file.
- shared provider cancellation/restart logic already holds the inference queue when provider cleanup is uncertain.

### Desired invariant

After a successful or terminal inference job:

> No WebCap-owned ComfyUI job directory should remain unless the job is still active or cleanup could not be safely proven.

Cleanup should happen at job completion/failure/stop time. Startup cleanup is a fallback, not the normal lifecycle.

### Planned improvement

Move the useful Test cleanup pattern into shared inference-runtime ownership:

1. derive the exact WebCap-owned provider subtree from the frozen filename/input prefix;
2. require an expected `webcap-*` root and exact job/session components;
3. reject symlinks and path escape;
4. after the durable WebCap artifact is safely captured, delete the exact owned provider subtree;
5. prune only now-empty WebCap-owned parents;
6. surface cleanup failure in the WebCap Console and Storage Manager.

Do not recursively clean arbitrary ComfyUI `input/` or `output/`.

### Startup residual reconciliation

A later safety-net pass may inspect only the direct WebCap-owned provider roots:

```text
ComfyUI/input/webcap-generate/
ComfyUI/input/webcap-storyboard/
ComfyUI/output/webcap-generate/
ComfyUI/output/webcap-storyboard/
ComfyUI/output/webcap-tests/
```

It may compare child job IDs against nonterminal WebCap inference jobs and identify leftovers.

Rules:

- bounded to known WebCap prefixes;
- never scan the whole ComfyUI tree;
- never delete an active/unresolved provider job;
- initially surface leftovers as reclaimable rather than auto-delete;
- automatic residual deletion, if later justified, should use a conservative age grace period and exact ownership proof.

A WebCap restart should not be required for ordinary cleanup.

---

## 7. Storage state vocabulary

Each item should have a small explicit state.

### Ownership

- **WebCap-owned** — exact directory/file is created and owned by WebCap.
- **WebCap-derived external** — WebCap caused an external runtime to create it and has an exact owned prefix.
- **User/safety data** — WebCap created it, but deletion changes recovery or authored state.
- **Unknown/external** — visible path may be opened, never purged by Storage Manager.

### Measurement

- **Measured now**
- **Cached · <age>**
- **Not measured**
- **Unavailable**

Never display a guessed exact byte count.

### Cleanup

- **Reclaimable**
- **Protected**
- **Active**
- **Needs review**
- **Cleanup failed**

This is enough. Avoid a scoring/risk engine.

---

## 8. Backend shape

Do not build a plugin system or generic filesystem registry.

A straightforward backend module such as:

```text
tool/server/storage_manager.py
```

can own a handful of explicit functions:

```text
storage_overview()
training_storage(...)
test_storage(...)
generate_storage(...)
storyboard_storage(...)
set_storage(...)
runtime_storage(...)
measure_area(...)
open_item(...)
purge_item(...)
```

Each function should call the owning domain module for identity and mutation rules.

Storage Manager may calculate byte counts, but it should not become a second authority for:

- Training action identity;
- Test Session identity;
- Generate result identity;
- Story/Take references;
- queue activity;
- ComfyUI job lifecycle.

### Routes

Keep routes small and semantic, for example:

```text
GET  /fs/storage
GET  /fs/storage/training
POST /fs/storage/measure
POST /fs/storage/open
POST /fs/storage/purge
```

The browser sends an area + opaque domain ID, not an arbitrary filesystem path for purge.

Example:

```json
{"area":"tests","id":"<set>/<session>"}
```

not:

```json
{"path":"W:/whatever/delete-this"}
```

The backend resolves the real path from domain ownership.

---

## 9. UI implementation shape

Keep Storage isolated like Generate/Storyboard rather than forcing it into Prep surfaces.

Likely files:

```text
tool/tool.html
tool/js/storage_manager.js
tool/css/storage_manager.css
tool/server/storage_manager.py
```

Plus minimal shell routing/activity wiring and tests.

The page should be useful at wide desktop sizes but not depend on the current Set.

### Overview

- free / total disk;
- categorized WebCap usage;
- categories sorted by measured bytes;
- stale/unknown measurements clearly marked;
- **Refresh** only refreshes cheap facts and cached values;
- **Measure** performs the expensive requested scope.

### Category detail

Table/list columns:

- Name
- Type / context
- Size
- Reclaimable
- Modified
- Status
- Open
- Purge/Delete where valid

Default sort: **Size descending**.

Filters can wait until real usage proves they are needed.

---

## 10. Purge rules

The Storage Manager must never expose a generic recursive-delete endpoint.

Every destructive action is domain-scoped.

### Training

Initial phase: **Open only**.

Later purge must block when the logical run is:

- active;
- queued;
- a live Resume source;
- a live initializer source;
- otherwise referenced by app-owned nonterminal work.

Historical metadata may survive a deleted artifact and display **files removed**; do not mutate history merely to make it look clean.

### Tests

Reuse `delete_session()`.

Block active/nonterminal Sessions exactly as today.

### Generate

Delete one manifest-owned result directory after confirmation.

No Restore requirement.

### Storyboard

- permanent Take cleanup -> existing `delete_take()`;
- whole Story -> existing `delete_story()`;
- removed Takes can be surfaced as reclaimable;
- do not bypass Storyboard reference checks.

### H3 probes

Delete only completed/inactive exact probe directories.

### Set data

- originals -> protected/open only;
- auto_dataset -> protected/open only because it is Set-owned;
- captions/state/TOMLs -> protected.

### ComfyUI scratch

Only exact WebCap-owned prefixes. No arbitrary paths.

---

## 11. "Reclaimable" should mean something precise

Do not equate "generated" with "safe right now."

A byte is reclaimable only when WebCap has a defined domain action that can remove it without violating active ownership.

Examples:

- stopped Test Session -> reclaimable;
- completed standalone Generation -> reclaimable;
- removed Storyboard Take with no reference -> reclaimable through permanent Delete Take;
- active Test Session -> not reclaimable;
- Storyboard reference still in use -> protected;
- Training run with unresolved Resume/initializer use -> protected;
- originals -> protected;
- unknown ComfyUI files -> not ours.

The overview can therefore show both:

```text
Training      612 GB    reclaimable: not yet classified
Tests          81 GB    74 GB reclaimable
Storyboard     44 GB    11 GB reclaimable
```

Do not overclaim.

---

## 12. Phased implementation

### Phase 0 - inventory and tests

Before UI work:

- codify the ownership map above in tests;
- identify every WebCap-owned root and external prefix;
- verify no additional large producer is missing;
- verify exact active-job/reference checks needed by each purge candidate;
- preserve the historical storage-cleanup design constraints.

No mutations.

### Phase 1 - Storage activity, read-only

Build the Storage activity with:

- filesystem free/total;
- known areas;
- cached/cheap sizes;
- Open;
- Details;
- explicit Measure for expensive scopes;
- size-descending detail rows.

No purge yet except perhaps linking to already-existing domain delete actions if doing so requires no new backend mutation.

Success criterion: the screen tells the user where WebCap's space is going without causing a global recursive walk.

### Phase 2 - cheap lifecycle accounting

Update size cache at natural terminal/delete events:

- Generate;
- Test Sessions;
- Storyboard Takes/Stories;
- H3 probes;
- Training terminal run-local measurement.

This makes normal Storage loads increasingly accurate without recurring scans.

### Phase 3 - safe derived-artifact purge

Add domain-backed cleanup for:

- Test Sessions;
- Generate results;
- Storyboard Takes / Stories using existing semantics;
- completed H3 probes;
- WebCap-owned copied Test LoRAs.

Show space-to-reclaim before confirmation.

### Phase 4 - Training cleanup

Only after a focused Training retention/reference design.

Use logical-run ownership from `training_action.py`; do not revive the old cleanup design literally.

Decide separately whether v1 Training cleanup supports:

- whole logical-run deletion only;
- captured-input/cache deletion;
- selected epochs/checkpoints.

Prefer one coarse, understandable operation over many partially safe ones.

### Phase 5 - provider scratch hygiene

Unify exact-prefix ComfyUI cleanup for Generate, Storyboard, and Tests.

Completion cleanup is primary.

Then add bounded residual detection for WebCap-prefixed provider directories so Storage can expose:

```text
Runtime / Temporary
  Generate references                0 B
  ComfyUI WebCap leftovers         3.2 GB    reclaimable
  H3 probes                        6.7 GB
```

Only after exact ownership is proven should residual cleanup become automatic.

---

## 13. Tests required

### Measurement

- opening Storage performs no recursive FS_ROOT walk;
- overview uses cached values when present;
- missing cache produces **Not measured**, not zero;
- explicit measurement stays inside the selected known root;
- symlinked directories are not followed;
- measurement cancellation leaves prior cached value intact;
- partial/unreadable directories report visible errors.

### Purge safety

- client cannot submit arbitrary filesystem paths;
- active Training/Test/Storyboard/Generate work is protected as appropriate;
- Test Session purge reuses domain rules;
- Storyboard Take purge preserves reference safety;
- Story deletion uses Storyboard ownership;
- Generate deletion cannot escape `output/generations`;
- Test-copy deletion only removes provenance-owned pair(s);
- originals are never presented as routine reclaimable data;
- symlinks are refused.

### ComfyUI

- cleanup accepts only exact WebCap prefixes;
- path escape and symlinks are refused;
- successful capture removes the exact provider job subtree;
- one client's cleanup cannot remove another client's files;
- active/unresolved provider jobs survive residual reconciliation;
- cleanup failure reaches the global Console and Storage surface.

### UI

- categories sort by measured bytes;
- stale cached size is visibly stale;
- unknown sizes sort below measured values rather than pretending to be zero;
- purge confirmation states what will be deleted and how much measured space is affected;
- active/protected items have no enabled purge action.

---

## 14. Initial definition of done

The first useful Storage Manager does **not** need automatic retention policies.

It is successful when:

1. Storage is a permanent global activity.
2. Opening it is fast and performs no whole-workspace recursive scan.
3. It shows free disk space and every known WebCap storage area.
4. Previously measured areas show cached size and measurement age.
5. The user can explicitly measure expensive areas.
6. Training, Tests, Generate, and Storyboard have separate drill-down views sorted largest first.
7. Every row with a filesystem location has **Open** where safe.
8. Destructive actions are either absent or domain-backed; there is no arbitrary delete API.
9. Temporary Generate/Storyboard/Test ComfyUI artifacts have a documented completion-time cleanup contract.
10. Any residual WebCap-owned provider scratch can be identified without scanning arbitrary ComfyUI content.

That gives WebCap the equivalent of an "iPhone Storage" overview without turning every app launch into `du -a`, and it creates a safe foundation for later reclaim operations based on ownership rather than guesses.


---

## MVP implementation audit

The implemented MVP was reviewed against the hostile-audit invariants and `docs/north_star_workflow.md`.

### Confirmed

- Opening Storage is read-oriented and performs no recursive walk of `FS_ROOT`.
- Expensive size calculation is explicit and item-scoped.
- **Measure all** is a sequence of bounded item measurements rather than one monolithic scan.
- Storage deletion accepts producer identity only; there is no arbitrary filesystem delete route.
- Set-owned `originals/`, `auto_dataset/`, `media_metadata.json`, and `.webcap_state.json` are visible but never purgeable from Storage.
- Training deletion is limited to sentinel-owned managed actions and is blocked when queued/running work references the action.
- Test deletion reuses the existing Test Session deletion contract.
- Generate deletion requires a matching `generation.json` manifest before removing the result directory.
- Story deletion reuses Storyboard's existing stop/delete semantics and the confirmation explicitly states that Story metadata, Takes, and references are removed.
- Storage does not modify the Training, Test, Generate, or Storyboard activity implementations or DOM ownership.
- Shared inference cleanup removes exact WebCap-owned Generate/Storyboard ComfyUI input job trees after a durable output has been ingested, while preserving sibling/unknown provider content.
- Symlink/path-escape cases are refused for managed Storage roots.
- Measurement timestamps are shown so cached byte counts are not presented as live truth.

### Validation

Focused CI passed:

- `tests/test_storage_manager.py`
- `tests/test_inference_runtime_cleanup.py`
- `node --check tool/js/storage_manager.js`
- `node --check tool/js/workspace_shell.js`

A full-suite run against the current `main` baseline reported the already-known contract drift that PR #63 is repairing; the focused Storage tests did not appear among those failures.

### Deliberate MVP boundaries

- Global Test history remains incomplete because Test Sessions are distributed beneath Sets and WebCap has no cheap global Test index. Storage clearly labels Tests as **current Set / partial inventory** rather than performing a hidden `os.walk(FS_ROOT)`.
- H3 probe directories are surfaced and measurable. A matching app-owned `seed.json` is required for ownership; running/stopping probes remain protected, while prepared or terminal probes may be explicitly deleted from Storage.
- Configured external staged-Test roots are intentionally not scanned globally. Storage inspects only configured per-stage destinations for the current Set and exposes only copies with a matching WebCap provenance sidecar.
- ComfyUI scratch cleanup remains completion-time lifecycle cleanup first. Storage learns the provider root only from a real local ComfyUI output path, then performs bounded direct enumeration under exact `webcap-generate`, `webcap-storyboard`, and `webcap-tests` prefixes. A first-ever job that fails before WebCap sees any local provider output cannot safely teach that root and remains the one residual-discovery limitation.
- Malformed producer manifests are not automatically purged. Ownership must remain provable before deletion.

These boundaries are intentional safety limits, not reasons to add a generic filesystem scanner.


---

## Post-MVP hostile-audit follow-up

A second pass after PR #66 tightened the implementation without changing any Action screen or workflow ownership:

- Test Session deletion now re-reads the session manifest at mutation time and refuses active statuses even if the Storage screen was rendered from older state.
- H3 probe directories now use their app-written `seed.json` plus optional `runtime.json` as ownership/state sentinels. Prepared and terminal probes are manually purgeable; running/stopping probes are protected.
- Runtime purge remains identity-scoped. Generate reference uploads are surfaced as individual WebCap token directories: queued/active references are protected, while inactive draft/residual bundles can be manually deleted with an explicit warning that an unsubmitted draft may lose the reference.
- WebCap-owned staged Test LoRA copies are surfaced from current-Set configured destinations only when their provenance sidecar proves ownership; shared inference references protect them at mutation time.
- A proven ComfyUI provider root is persisted only after WebCap resolves a real saved provider output. Storage then surfaces exact WebCap-prefixed input/output job trees without scanning arbitrary provider content; active shared-inference identities remain protected.
- Storage frontend dependencies on app-owned Console and shell functions now fail loudly rather than silently skipping required behavior.
- Generate/Test/Runtime/Comfy resolvers reject symlink/path-escape cases before destructive mutation; malformed or ownership-ambiguous artifacts are not made deletable merely because of proximity.

Remaining North Star gap: if the very first ComfyUI job fails before WebCap ever receives a local provider output path, there is still no safe provider-root identity to inspect. Storage deliberately does not guess or scan for it. Once any valid local provider output has established the root, subsequent exact WebCap-prefixed residuals—including input-only leftovers—are visible and manually reclaimable.
