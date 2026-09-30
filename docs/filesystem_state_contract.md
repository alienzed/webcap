# Filesystem and State Lifecycle North Star

**Status:** Approved architecture direction. Migrate incrementally; do not destabilize working queues or durable artifacts to reach this layout quickly.

WebCap should place files according to **ownership and lifecycle**, not according to which feature happened to create them.

This document is the authoritative direction for new WebCap filesystem state and for incremental cleanup of the existing `.webcap*` roots.

## 1. Core classification

Every new persisted or temporary item must fit one of these classes before a path is chosen.

| Class | Lifetime | If deleted | Home |
| --- | --- | --- | --- |
| Durable artifact/state | Until user explicitly removes it | Real user work/evidence is lost | Owning Set, Story, generated output, or Training action |
| Backend persistent state | Across WebCap/server restart | Pending user intent or convenience history may be lost | App-data `state/` |
| Disposable cache | Optional | Nothing durable is lost; it is rebuilt | App-data `cache/` |
| Backend session state | Browser refresh/navigation, but not server restart | Only the current server session is lost | Memory only |
| Media-bearing work/scratch | Only while the operation needs it | Active work may be interrupted; completed work must already exist elsewhere | Output-root `work/` |
| Frontend temporary state | Browser session only | Unsaved UI/input state disappears | Browser memory / `sessionStorage` |

The deciding question is:

> If this is deleted now, did WebCap lose user work, pending user intent, merely a rebuildable cache, or nothing durable at all?

Do not choose a location before answering that question.

## 2. One host-local WebCap app-data root

Small application-private state must not derive its location from the user's Set/Training root.

WebCap should resolve one host-local app-data root automatically:

- Windows: `%LOCALAPPDATA%\\WebCap`
- macOS: `~/Library/Application Support/WebCap`
- Linux: `$XDG_DATA_HOME/WebCap` when set, otherwise `~/.local/share/WebCap`

A future/configured `filesystem.app_data_root` may override this. Blank means use the platform default.

This root is **host-local application state**, not portable workspace content and not synchronization storage. Do not encourage sharing it between machines.

Keep its structure small:

```text
WebCap/
  state/
  cache/
```

Add another top-level subdirectory only when it represents a genuinely different lifecycle.

### Hard rule

Do not create new global app-private state directly under `FS_ROOT`, and do not invent new sibling roots such as `.webcap_feature`.

All app-private paths must come from one centralized path helper.

## 3. App-data contents

### `state/`

Use for small state that must survive a WebCap restart.

Examples:

- durable Training queue intent;
- durable Inference queue/backlog intent;
- lightweight Training History / Recent Runs convenience metadata;
- provider bookkeeping that is meaningful across restarts.

Persistent JSON should be consolidated by **shared lifecycle**, not merely because several files are JSON.

North-star scheduling layout:

```text
state/
  queues.json
  training-history.json
  providers.json
```

Exact filenames may change during implementation, but the ownership boundaries should not.

`queues.json` may contain durable Training and Inference scheduling intent while preserving their separate domain semantics. A shared state file does **not** require one generic scheduler implementation.

Training History remains separate because clearing history must never affect scheduling.

### Memory only

Do not persist state that is valid only for the current backend process.

Examples:

- local GPU/resource ownership;
- in-process locks;
- transient terminal receipts after the durable result has been consumed;
- LLM/Director queue work, which is server-session-bound by the queue semantics contract;
- runtime detection caches.

Persisting these creates stale-state recovery problems without preserving user value.

### `cache/`

Anything here must be safe to delete at any time while WebCap is not actively writing it.

Examples:

- Storage Manager measurements/discovery cache;
- other advisory/rebuildable indexes.

Deleting `cache/` must never remove user-authored state, pending queue intent, durable generated results, checkpoints, or required provider identity.

## 4. Media-bearing temporary/intermediate work

Large or user-inspectable temporary material does not belong in host-local app-data.

Use an explicit work area beneath the configured output root:

```text
<output-root>/
  work/
    h3-probes/
    generate-references/
    ...
```

Examples include:

- H3 probe bundles;
- Generate reference media;
- other temporary media-bearing inputs/intermediates.

Storage Manager may account for this area because it can consume meaningful disk space.

### Cleanup is lifecycle-driven

Temporary does **not** mean "leave it until next startup."

When WebCap can prove an intermediate is no longer needed, delete it at that lifecycle boundary:

- after durable provider output is ingested;
- after an operation is explicitly abandoned/cancelled and no active job references it;
- after an H3 probe successfully publishes its durable calibration ceilings, delete the completed probe bundle immediately; failed, interrupted, or cancelled probes may remain temporarily for diagnosis.

Startup reconciliation is only a fallback for crash leftovers, not the normal cleanup mechanism.

Unknown or ownership-ambiguous files are never deleted automatically.

## 5. Durable owner-local files stay with their owners

Do not centralize files merely to make the tree look tidy.

These stay with their durable owner:

- Set `.webcap_state.json`;
- Set `media_metadata.json`;
- captions and reversible `originals/`;
- artifact provenance sidecars such as `*.webcap.json`;
- Story and generated-result manifests;
- Training `action.json`, captures, job scripts/logs/results, checkpoints, and trainer output.

The stable Training action layout remains the owner of Training evidence.

## 6. Frontend versus backend temporary state

Browser-only interaction state should remain in browser memory or `sessionStorage` when it should survive navigation/reload within the browser session.

Do not write chat drafts, transient Assistant input, calibration form scratch, or similar UI-only state into the filesystem unless a product requirement explicitly makes it durable.

Backend session state that must survive browser refresh but not server restart remains in backend memory. Director Model Test results are one such diagnostic session: the current test remains available while WebCap is running, and Export JSON is the explicit persistence path.

## 7. Queue/state consolidation direction

The queue contracts remain domain-specific:

- Training is long-running and restart-resumable.
- Inference queue/backlog intent is durable.
- LLM/Director work is server-session-bound and should not become restart-recovery state.
- GPU ownership is runtime truth and is never persisted.

The current split between `.webcap/execution_queue.json` and `.webcap_training/queue.json` is transitional. The north star is one durable queue-state document for the queue intent that genuinely survives restart, while Training keeps its specialized lifecycle implementation.

Do not merge unrelated lifecycle data into that file:

- Training History stays separate.
- Provider bookkeeping stays separate.
- cache data stays separate.
- transient receipts stay memory-only.

## 8. Migration rules

Migration is incremental and must preserve working behavior.

1. **Do not move live queue state merely for cleanliness.** A long/running Training queue is a hard no-touch condition for `.webcap_training/queue.json`.
2. Start with data whose deletion is already harmless, especially advisory caches.
3. Next move small persistent bookkeeping that has one clear owner and no active-process identity.
4. Move media-bearing temporary work only when its producer and cleanup lifecycle are explicit.
5. Consolidate durable queue state only with focused restart/recovery tests and preferably when Training queue state can be cleanly reset or is empty.
6. Prefer a deliberate filesystem-contract transition over permanent legacy path fallbacks.
7. Do not copy stale runtime ownership into the new location.
8. Storage Manager must consume centralized path helpers rather than reconstruct feature-private paths.

## 9. Current legacy roots

Current code still uses several transitional locations beneath `FS_ROOT`, including:

- `.webcap/`;
- `.webcap_training/`;
- `.webcap_runtime/`.

Do not add new uses of these roots. Existing uses should be classified and migrated only when their lifecycle permits it.

## 10. Review rule for future work

For any new filesystem write, review these questions:

1. Who owns this data?
2. What exact event makes it obsolete?
3. Must it survive browser refresh?
4. Must it survive WebCap restart?
5. Is deleting it harmless, intent-losing, or artifact-losing?
6. Can WebCap delete it immediately when its lifecycle ends?
7. Is it media-bearing or potentially large?
8. Does an existing centralized path helper already own this lifecycle?

If those answers are unclear, do not create a new filesystem location.
