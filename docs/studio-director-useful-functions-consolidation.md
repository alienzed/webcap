# Studio Director useful-function consolidation (2026-11-03)

Status: phased implementation against PR #859, following AGENTS.md and the authoritative Studio materialization contract.

## Goal
One explicit Read path; three creative Write goals: Create Project, Revise Project, Write Scenes. Keep reviewed changes, scoped field comparisons, stable identifiers, atomic saved writes, history and H3 expertise. Preserve author-operated Studio mechanics. Converge guidance, readiness and visible UI without creating an LLM tools executor.

### Unit alignment — 2026-11-06
Project Overview (Concept, Visual / atmosphere, Invariants) and Scene (Title, Intent, H3 Prompt) are the creative units. Suggestions, shortcuts and drafting consider each unit together, while respecting explicit author limits. Advisory `writeFields` metadata describes likely changes; it does not constrain the unit proposal or deselect related changes in Review. A suggestion click prepares the existing editable Review directly; Apply remains explicit.

Scene Review presents changed parts selected and keeps unchanged parts available in one collapsed section. Completed Scene captures use that same Review without another model request. The saved fields, schemas, atomic Apply and per-changed-field conflict checks remain unchanged. A proposal may change one part or several; unity does not require rewriting every part.

## Phase 1: Align the public contract and guidance
- Advertise only Read, Create Project, Revise Project and Write Scenes.
- Give short, iterative conversational replies; 1-3 sentences by default.
- Map readiness to these goals, not low-value structural operations; keep compatibility for older stored chat metadata without re-advertising it.
- Keep exact Read provenance and explicit review. Read presents Project Overview as one checkbox and each Scene as one complete checkbox (Title, Intent, H3 Prompt and duration); the existing field-ID payload and acknowledgment flow remain unchanged. Avoid a second model request when a complete approved capture is already available.

## Phase 2: Consolidate Write
- Surface three choices in the primary Write panel.
- Write Scenes accepts one or more existing Scenes for selected-field revision, or one or more new Scenes for insertion; reuse existing single Project authoring and batch review endpoints.
- Keep deterministic placement and linking with WebCap; never ask the model to perform those mechanics.
- Preserve the original user-selected target and save all selected changes through current review validation and optimistic conflict checks.
- Keep coherence as explicit optional specialist utility, separate from the creative Write catalog.
- Do not suggest obsolete Scene move/duplicate/split/invariant-link, brief Undo or Playbook editing as creative capabilities.

## Phase 3: Retire competing orchestration
- Remove retired controls and suggestion routing only once their replacements are covered by tests; retain shared Studio backend primitives still used by manual controls.
- Remove Director Tools as a separate creative authoring surface only after a real-model/browser pass confirms its unique function has an equivalent reviewed path.
- Preserve existing file formats, IDs and historical conversation compatibility.

## Phase 4: Acceptance
- Normal one-sentence chat, explicit Read and receipt, reload saved conversation.
- New Project with optional Scenes; review and Apply.
- Revise Concept, Style or Invariants; check changed-fields-only Apply.
- New one/many Scenes; revise one/many saved Scenes with Intent/Prompt and continuity.
- Canceled/stale writes, concurrent edits and save/receipt mismatch.
- Coherence as explicitly requested utility, reviewed prompt diffs, no automatic mutation.
- Node/Python contract tests and real Director-model/browser tests; no acceptance claim without evidence.

## Boundaries
A single Write session targets one Project. New Scenes and updates to existing Scenes currently use two underlying review transactions; do not claim mixed create-and-revise is atomic until an actual mixed review transaction exists. Production controls, Scene order, Take generation, LoRAs, seeds, sampling and references remain outside Studio Director. Run no speculative rewrite or backend migration.
