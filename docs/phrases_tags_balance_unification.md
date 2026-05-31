# Phrases + Tags + Balance Unification Plan (Minimal-Risk)

Last updated: 2026-05-30
Status: Historical planning doc. Keep for context; current behavior is documented in `README.md`, `docs/phrase_copy.md`, and `docs/primer_mappings_v2.md`. Some interaction details below (for example old tag click-to-filter notes) are intentionally superseded by shipped behavior.

## Purpose
Define a cautious implementation plan to unify Phrases, Tags, and Balance behavior while minimizing regressions and preserving existing contracts.

This plan follows `docs/copilot_rules.md`:
- wire existing UI first
- keep changes explicit and minimal
- avoid broad refactors
- protect reversibility and state integrity

## Locked Product Decisions
- Keep existing UI labels for now (`Phrases`, `Tags`, `Balance` behavior in review/stats).
- Multi-word phrases/tags are first-class values. No splitting on spaces.
- Per-set only. No cross-set sharing yet.
- Starter vocabulary is config-sourced (`config.json`) and optional; empty is valid.
- New terms are created from tagging flow and appended into the set phrase catalog immediately.
- No ad-hoc/vocab distinction in UI.
- No popularity-driven reorder in v1.
- Active shortlist is explicit/manual only (no algorithmic surfacing).

## Frozen V1 UX Contract

Panel ownership:
- Shared input (single search/add surface) is the only place that searches/adds terms.
- `Phrases` shows the active shortlist (manual list used for quick caption insertion).
- `Tags` shows current-item assigned tags only.

Primary interactions:
- Selecting/creating a term from shared input:
  - assign tag to current media item (if missing)
  - append to phrase catalog (`caption_phrases`) if new
  - does not auto-insert into caption
- Caption insertion happens only by clicking terms in the visible active shortlist.
- Term must be manually added to active shortlist to be eligible for quick caption insertion.
- Active shortlist is manually ordered and persisted (same persistence path as today: `stats.phrases`).
- Tag click-to-filter behavior remains unchanged.

Explicit non-behaviors:
- No silent reverse synchronization.
  - removing text from caption does not auto-remove tag
  - removing tag does not auto-remove caption text
- No automatic add-to-shortlist on create/select.
- No popularity auto-sort.
- No automatic migration to a new schema in v1.
- No panel rename in v1.

## Split-Input UX Contract (Next Iteration)

Purpose:
- Keep one shared catalog backend, but restore intent-specific inputs in each panel.
- Remove ambiguity from the single shared search box flow.

Panel inputs:
- `Tags` panel:
  - own `Add/Search tag...` input
  - primary action: assign tag to current media item
  - creation path: if term does not exist, create term and assign tag
- `Phrases` panel:
  - own `Add/Search quick phrase...` input
  - primary action: add term to quicklist (no auto tag assign)
  - quicklist rows keep caption insert/toggle behavior
  - row secondary action can still assign tag to current media
- `Balance` section:
  - own `Add from catalog...` input
  - adds selected term to balance phrases list only
  - no free-typed drift by default; source is catalog terms

Shared catalog model:
- Single catalog source remains:
  - `config.json -> vocabulary` (optional)
  - `caption_phrases` (set-local catalog)
  - `caption_tags_by_media` union
- Each panel input queries this shared catalog.
- Term creation from any panel appends into `caption_phrases`.

Action semantics:
- Tag assignment is explicit to `Tags` flows (or explicit tag button on phrase row).
- Quicklist membership is explicit to `Phrases` flows.
- Balance membership is explicit to `Balance` flows.
- No implicit cross-add between quicklist and balance lists.

Persistence:
- `caption_phrases`: catalog
- `caption_tags_by_media`: item tags
- `stats.phrases`: balance phrases (review/balance domain)
- `quick_phrases` (new): quicklist phrases (caption workflow domain)

Non-goals for this iteration:
- No ranking/popularity logic.
- No hierarchy in stored tags.
- No cross-set sync.

## Current Coupling Points (Must Not Break)

Frontend:
- `caption_helpers.js`
  - owns phrase list UI and insert/remove-at-cursor behavior (`caption_phrases`)
- `item_details.js`
  - owns per-media tags (`caption_tags_by_media`)
- `stats.js`
  - owns balance phrases (`stats.phrases`) and review phrase counts
- `folder_state.js`
  - snapshots/applies all persisted fields
- `advanced_mappings_rules.js`
  - mappings with `scope=tag` depend on item tags

Backend / cross-feature dependencies:
- `tool/server/smart_set.py` reads `caption_tags_by_media` for search/materialization.
- Review report phrase counts depend on `stats.phrases` compute path.
- No database; all state is file-based in `.webcap_state.json`.

## Non-Goals (For This Change Set)
- No broad visual redesign.
- No label rename wave.
- No migration to new backend storage format.
- No cross-set master sharing (only a future nice-to-have suggestion source).
- No cleanup-only/style-only edits.

## Compatibility Contract
Persisted keys remain valid and in use:
- `caption_phrases`
- `caption_tags_by_media`
- `stats.phrases`

No server schema break is allowed in v1 of this unification effort.
Missing data must be treated as normal startup state (persist when present, never assume required keys).

## Minimal Implementation Strategy

### Phase 1: Behavioral Unification Without Layout Rewrite
Goal: remove drift between Phrases and Tags with minimal surface change.

Changes:
- Introduce one shared term input for search/add/select.
- On shared-input select/create:
  - add tag to current media
  - append to `caption_phrases` when new
  - no caption insertion
- Keep `Tags` panel focused on assigned tags for current item.
- Keep `Phrases` panel for catalog + active shortlist management.
- Keep active shortlist insertion behavior (manual click to insert/toggle in caption).
- Balance remains in `stats.phrases` for now, but any balance phrase added as tag is already supported and should remain.

Outcomes:
- Tags and Phrases converge over normal use.
- No breaking changes to review, mappings, or smart set.

### Phase 2: Optional Grouped Display Metadata
Goal: improve scanability only.

Changes:
- Introduce display grouping for catalog items (flat tags remain flat).
- Groups are organizational only (not validation logic).

Outcomes:
- Better browsing without changing tag semantics.

## Risk Controls
- Do not change smart-set or review compute data contracts in Phase 1.
- Do not remove existing fields until a later migration plan is explicitly approved.
- Keep all existing insert phrase behavior intact.
- Preserve keyboard workflows and current autosave timing.
- Keep removal behavior explicit and local only (no hidden cross-removals).

## Regression Checklist (Must Pass)
- Tag add/remove still persists correctly per media.
- Phrase insert/remove at cursor still works.
- Review phrase counts still compute from `stats.phrases`.
- `scope=tag` primer mappings still resolve as before.
- Smart set filtering by tags still works.
- Folder reload restores phrases/tags/balance values correctly.
- Phrase click from `Phrases` toggles caption insertion/removal only.
- Shared-input create/select assigns tag and appends to phrase catalog with de-dup.

## Implementation Order (Strict)
1. Phase 1 only.
2. Verify regression checklist.
3. Ship and observe.
4. Then Phase 2 only if needed.

## Deferred Follow-Ups
- Search ranking order:
  - exact (case-insensitive) first
  - starts-with second
  - contains third
- Catalog backfill behavior:
  - load `caption_phrases`
  - union with `caption_tags_by_media` terms
  - `stats.phrases` contributes to search options via runtime catalog union
- Starter vocabulary source file:
  - `config.json -> vocabulary` (`terms` + grouped `groups[].terms`)
  - empty arrays are valid and mean no seeded starters
