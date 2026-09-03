# Stable Set Training Layout — Tentative Plan

**Status:** Proposal — value and implementation are still under consideration.

This records a possible future training-artifact layout. It is not a current-behavior contract, approved implementation work, or authorization to move existing artifacts.

## Proposed layout

Use one deterministic, alphabetically sortable root for each dataset set, with one self-contained logical-run root beneath it:

```text
<output-root>/runs/
  <normalized-set-name>--<set-path-hash>/
    <per-set-run-number>-<model>--<optional-run-name>/
      action.json
      captures/
      jobs/
      output/
        <model-stage>/
          <trainer-run>/
```

The set-root name would begin with the normalized, lowercase set basename so sets sort predictably in TensorBoard. A stable suffix derived from the set's filesystem-relative path would distinguish equally named sets. Renaming or moving a set would deliberately produce a new set root; WebCap would not silently merge unrelated paths.

Each fresh training request would allocate the next per-set logical-run number. Its capture, job, action identity, and trainer output would remain below that one root, rather than creating new action folders beside or outside the set's history.

## Action identity and existing data

New actions would use an identity derived from both set root and logical-run root, not from a bare action-folder basename. The full identity would be used anywhere the queue, history, or UI needs to distinguish actions.

The recently introduced direct action folders and older checkpoint/output layouts would remain readable and resumable. This proposal does not require a migration, rename, or relocation of existing artifacts. New layout-aware code would recognize legacy paths explicitly while new runs use the stable structure.

## Resume behavior

Managed resume would reuse the selected logical run's existing root and output tree. It would retain that run's action identity, captures, jobs, and evidence.

Custom resume would remain available as an explicit path choice. A custom checkpoint may live outside WebCap's managed tree; WebCap would create a new logical run under the current set root for the new work, while referring to the external checkpoint in place. It would not copy, move, or claim the external run as managed history.

The resume UI would make the managed-checkpoint picker and custom path mutually exclusive and visibly show which source is selected.

## Checkpoint discovery, loading, and evidence

Discovery would scan compatible managed and legacy checkpoint locations without requiring a particular action-folder convention. While it is loading, the picker would show an explicit loading state such as “Searching compatible checkpoints…”, rather than appearing complete with an empty list.

Candidates would be filtered to real checkpoint directories with a usable `latest` target, a readable saved configuration, and a compatible model/stage. Discovery would exclude generated captures, jobs, input copies, epoch/global-step implementation details, and `.webcap` state from its broad search where they cannot be run roots.

Each resume option would provide enough evidence to assess it before training, including:

- its full checkpoint path and resolved `latest` target;
- epoch or global-step evidence when available;
- whether the match is exact or merely configuration-compatible;
- its managed action/logical-run identity when one is known; and
- set provenance such as “Current set — managed action”, “Saved dataset matches”, or “Set origin unverified”.

Before queueing a selected resume, validation would require the checkpoint directory and saved configuration to be readable and compatible. Invalid custom paths or incompatible checkpoints would fail visibly before capture creation, queue mutation, or output allocation.

## Interfaces and validation rules

No new HTTP route is expected solely for this layout. Existing training start, history, and resume payloads would carry the complete action identity where they currently carry an action reference. The raw custom resume path would remain explicit as `resumeFromCheckpoint` rather than being inferred from a picker entry.

New managed runs would need to satisfy these invariants:

- every run belongs to exactly one deterministic set root;
- each run's action file, captures, jobs, and generated output are contained by that logical-run root;
- per-set run numbering is deterministic and collision-safe;
- a managed resume retains the same logical-run identity; and
- an external custom resume creates no mutation outside the newly allocated current-set logical run.

Legacy artifacts must remain available as legacy candidates. A legacy candidate may have weaker provenance evidence, but that limitation must be shown in the UI rather than guessed away.

## Proposed validation and tests

- Set roots sort alphabetically by normalized set name and disambiguate equal basenames with a stable path hash.
- Fresh runs place every new artifact under the correct set/logical-run root.
- Per-set run allocation remains collision-safe and does not affect another set's numbering.
- Managed resume reuses its logical-run root and action identity.
- Custom resume preserves the external checkpoint and allocates a new current-set logical run.
- Legacy direct action folders and older trainer outputs remain discoverable and selectable.
- Full action identities flow correctly through queue, history, result, pause, finish, and stop paths.
- Invalid or incompatible custom checkpoints fail before any capture, queue, or output mutation.
- Resume loading states, candidate evidence, exact/compatible labels, and unverified-origin labels render accurately.
- TensorBoard-visible set roots remain predictable when multiple sets and runs exist.

## Assumptions

- The output root remains the shared place TensorBoard observes.
- Alphabetical grouping is achieved by making the normalized set name the first component of each set root.
- A set move or rename intentionally creates a new identity; no automatic matching across paths is attempted.
- Existing artifacts stay where they are and are handled as explicit legacy compatibility, not silently rewritten.
- This design concerns layout and resume clarity only; it does not change queue restart semantics or imply automatic recovery.

## Decision still open

The expected workflow benefit—one predictable set root, self-contained runs, and clearer resume evidence—must still be weighed against the refactor cost and disruption to the recently introduced action layout. This proposal is deliberately tentative. No layout implementation should begin unless that tradeoff is accepted separately.

The authoritative current-behavior documents, including `training_stabilization.md` and `training_artifact_cleanup.md`, remain unchanged by this proposal.
