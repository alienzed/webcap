# Wildcard Template Planning

## Status
`IN PROGRESS` (as of May 18, 2026)

This plan is intentionally not final. We are iterating on UX and behavior before implementation.

## Goal
Design a deterministic wildcard-template builder for short captions where:
1. Key phrase is taken from line 1.
2. Lighting + viewpoint are taken from the last line.
3. Middle lines provide traits/position/action/scene modifiers.
4. User can add manual options to expand output beyond what captions currently contain.

This is a planning document only (no implementation yet).

## What We Are Building
A "Template Builder" that outputs a reusable prompt wildcard pattern like:

```text
hulkhero is {standing|sitting|kneeling|lying back} in a {park|living room|stadium|other location},
he is {jumping|flexing|stretching|crawling} wearing {shorts|hoodie|jacket}

{soft|dramatic|neon|natural} lighting, {front|side|back|high-angle} view
```

The builder combines:
- Automatic extraction from existing captions.
- Manual user-specified option banks.
- Optional scaffold text that controls sentence style.

## Scope
In scope:
- Folder-level extraction from `state.items[].caption`.
- Deterministic parsing and option aggregation.
- One-click generation of wildcard template text.
- Folder-state persistence for manual option banks and preferences.

Out of scope (v1):
- LLM-based parsing/classification.
- Cross-folder learning.
- Complex grammar generation (pluralization, tense conversion).
- Auto-writing training configs.

## Core Assumptions
- Captions are short and mostly follow known structure.
- First non-empty line usually contains key phrase.
- Last non-empty line usually contains lighting/view.
- Middle lines are sparse but useful for category extraction.
- Deterministic behavior is preferred over "smart but unstable" behavior.
- Existing caption-requirement sections can define which slots matter most for the set.

## Proposed Data Model (Folder State)
Add a new folder-state block:

```json
{
  "wildcard_template": {
    "enabled": true,
    "keyphrase": "",
    "slot_sources": {
      "use_caption_requirements": true
    },
    "manual": {
      "positions": "",
      "actions": "",
      "traits": "",
      "clothing": "",
      "scene": "",
      "lighting": "",
      "viewpoint": "",
      "other": ""
    },
    "scaffold": {
      "line1": "{keyphrase} is {positions} in a {scene},",
      "line2": "he is {actions} wearing {clothing}",
      "line3": "{lighting} lighting, {viewpoint} view"
    },
    "limits": {
      "max_options_per_slot": 8,
      "min_frequency": 2
    },
    "last_generated_template": "",
    "manual_template": "",
    "generated_history": []
  }
}
```

Notes:
- Keep all `manual.*` values as multiline text in UI (one option per line).
- Final option list per slot = `manual options + extracted options`, then dedupe.
- `limits` keeps wildcard blocks compact.
- `generated_history` can store a small rolling list (for example last 5 generations with timestamps).

## Caption Requirements Integration
Use checklist requirements (`caption_requirements`) as slot priorities and optional aliases:

- If checklist contains `Lighting`, `Viewpoint`, `Clothing`, `Traits`, etc., treat those slots as high-priority output slots.
- If checklist contains custom labels (for example `Pose`), map aliases to canonical slots:
  - `Pose` -> `positions`
  - `Background` -> `scene`
  - `Camera Angle` -> `viewpoint`
- If `caption_requirement_keywords` exists for an item, use those keywords as additional classifier hints for that slot.
- Comma-separated values in requirement keywords are valid and encouraged (for example `soft, dramatic, neon`).
- These values remain useful for in-editor highlighting and are also reused as wildcard slot candidates.

Priority order for option filling per slot:
1. Manual slot options (user-authored)
2. Caption requirement keywords (slot-specific hints)
3. Extracted fragments from captions
4. Fallback placeholder text

Implementation note:
- Reusing requirement keywords for both highlighting and wildcard generation is non-destructive and keeps one shared source of truth for modifier vocabulary.

## Extraction Strategy (Deterministic)

### 1) Caption Preprocessing
- Split caption into lines.
- Trim whitespace and drop empty lines.
- If no non-empty lines, skip caption.

### 2) Keyphrase Detection
- Candidate per caption = first non-empty line.
- Normalize (trim, lowercase, collapse spaces).
- Frequency count across captions.
- Choose most frequent candidate as `keyphrase`.
- Tie-breakers:
1. Higher frequency.
2. Shorter token length (usually cleaner trigger).
3. Alphabetical (stable deterministic fallback).

Confidence metric:
- `keyphrase_confidence = hits_of_selected / captions_with_content`.

### 3) Last-Line Lighting/Viewpoint Detection
- Candidate per caption = last non-empty line.
- Split by commas first, then by `and` for sub-phrases.
- Classify fragments using keyword dictionaries:
  - lighting keywords: `lighting`, `light`, `backlit`, `neon`, `shadow`, `soft`, `dramatic`, `natural`, etc.
  - viewpoint keywords: `front`, `side`, `back`, `profile`, `high angle`, `low angle`, `close-up`, `wide`, etc.
- Store unique extracted fragments with frequency.

### 4) Middle-Line Modifier Extraction
- Middle lines = all lines except first and last.
- Tokenize by comma and conjunctions.
- Classify fragments into slots with keyword dictionaries:
  - `positions`, `actions`, `traits`, `clothing`, `scene`, `other`.
- Keep fragment as phrase (not single token) for better prompt quality.

### 5) Slot Selection Rules
- For each slot, keep fragments with frequency >= `min_frequency`.
- Sort by frequency desc, then alpha.
- Cap at `max_options_per_slot`.
- Merge with manual options:
1. manual options first
2. extracted options second
3. dedupe case-insensitively

## Template Assembly
1. Resolve each slot into wildcard block form:
- empty -> fallback placeholder text (e.g., `other action`)
- one option -> plain text (no braces)
- many options -> `{a|b|c}`

2. Fill scaffold lines with slot expansions:
- `{keyphrase}`
- `{positions}`
- `{actions}`
- `{traits}`
- `{clothing}`
- `{scene}`
- `{lighting}`
- `{viewpoint}`
- `{other}`

3. Join non-empty lines with `\n`.

## UX Plan
Recommended initial placement: Config tab (`primer-details`) near existing `Caption Template` fields.

Add section: `Wildcard Template Builder`
- `Analyze Captions` button
- Keyphrase preview + confidence
- Slot editors (manual options, one textarea each)
- Read-only extracted options preview (or compact counts)
- `Generate Template` button
- Generated template textarea (auto output, editable but treated as generated draft)
- Manual template textarea (primary user-owned template)
- Optional `Use as Caption Template` button to copy into existing `primer-template`
- `Restore Previous Generated` dropdown/button (from `generated_history`)
- `Promote Generated -> Manual` button
- `Re-generate (Keep Manual)` button

Why Config tab:
- Closest conceptual match to template authoring.
- Avoids overloading Phrases tab (which is currently insertion-focused).

## Current Direction (Not Final)
- Prefer a modal launched from `Review Captions` (or a dedicated review panel) so this workflow does not affect always-visible UI.
- This feature is intended for occasional training/test prep, not always-on editing.
- Final UX choice (modal vs review panel) will be locked before implementation.

### Generated vs Manual Behavior
- Generate writes only to `last_generated_template` and the generated textarea.
- Manual textarea is never overwritten by regeneration.
- User can promote generated output into manual template explicitly.
- History allows comparing and restoring older generated variants without data loss.

### Set Notes Usage
Set notes can still be useful as working notes, but should not be the only store for the manual template.
- Recommended: keep `caption_set_notes` for notes and store manual template in `wildcard_template.manual_template`.
- Optional helper button: `Insert Manual Template into Set Notes` (one-way convenience copy).

## Integration With Existing Systems
- `snapshotFolderStateFromDom()` / `applyFolderStateToDom()` must include `wildcard_template`.
- Reuse existing `state.items` captions already loaded by `/fs/describe`.
- Keep builder logic in a dedicated file (suggested: `tool/js/wildcard_template.js`).
- Keep UI wiring in `wireAllUi()` with additive hooks only.

## Phased Rollout

### Phase 1: Pure Engine + Tests
- Implement pure functions for:
  - line extraction
  - keyphrase detection
  - slot classification
  - wildcard assembly
- Add JS unit-style tests (or deterministic fixture checks) with representative caption sets.

### Phase 2: Persistence + UI Skeleton
- Add folder-state support for `wildcard_template`.
- Add UI section in Config tab with fields + buttons.
- Support manual entry and save/restore.

### Phase 3: Analyze + Generate Flow
- Connect `Analyze Captions` to extraction engine.
- Show confidence and extracted candidates.
- Generate final template into output field.

### Phase 4: Quality Pass
- Improve dictionaries.
- Improve fallback text.
- Add "copy output" and "apply to primer" convenience actions.

## Validation Criteria
- Same input captions always produce the same output template.
- Manual options persist per folder.
- Generated template is concise and readable.
- Empty/low-quality caption sets still produce valid fallback template.
- No regressions in existing caption editor/checklist/phrases behavior.

## Risks and Mitigations
- Risk: misclassification of fragments.
  - Mitigation: preserve unknowns in `other`; manual overrides always win.
- Risk: too many noisy options.
  - Mitigation: frequency threshold + max options cap.
- Risk: keyphrase instability in mixed sets.
  - Mitigation: confidence score shown to user + manual keyphrase override.

## Open Decisions To Confirm Before Implementation
1. Pronoun style in scaffold (`he/she/they`) vs neutral wording (`the character`).
2. Should `Generate Template` overwrite `primer-template` automatically or only on explicit click.
3. Default `min_frequency` and `max_options_per_slot` values.
4. Whether `traits` should be a dedicated line or merged into action/clothing sentence.
5. Max generated history length (recommended: 5).

## Suggested Default Scaffold (v1)
```text
{keyphrase} is {positions} in a {scene},
{keyphrase} is {actions} wearing {clothing}

{lighting} lighting, {viewpoint} view
```

This stays neutral, avoids pronoun mismatch, and aligns with your example structure.
