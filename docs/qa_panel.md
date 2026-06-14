# QA Panel Concept

Status: Approved direction. Replace the current `Analysis` tab behavior with QA-oriented signals.

## Framing

The current `Analysis` tab is not pulling enough weight as a raw metadata display. Most visual-analysis facts, such as face direction, face size, pose, or expression, are obvious once the preview is open.

A better direction is a compact **QA** / **Quality Assurance** panel that helps decide what to double-check, prune, or diversify.

The useful question is not:

> What metadata did the analyzer detect?

The useful question is:

> What about this item or set might make the training data less useful?

## Stronger Direction

The most promising use is **similarity and redundancy warning**, especially around face-specific patterns.

For character training, duplicate-ish captions are often intentional, missing categories may not be fixable, and balance gaps may reflect the material available. But near-duplicate visual examples are actionable: the user can prune weaker items, crop differently, or choose a more varied sample.

Example:

- Four images are all `front`, `close-up`, `smiling`.
- Each image may be individually fine.
- Together, they may overrepresent one narrow facial/framing mode.
- QA can flag that cluster so the user can prune or diversify.

This makes face-specific analysis more useful as a **set-composition signal** than as a per-item fact display.

## Candidate Label

Use **QA** as the tab label.

Inside the panel, title it **Quality Assurance**.

## First Implementation Scope

The first QA pass should be generic and tag-driven rather than analyzer-driven.

### Implement Now

1. **Tag Similarity Cluster**
   - For the current item, compare its assigned tags against other items in the current set.
   - Surface a warning when multiple items are highly similar by tag composition.
   - Prefer language like:
     - `Starting to look a lot like 3 other items`
     - `Highly similar tag set shared with 2 items`
   - Show the closest matching file names and the shared tags as evidence.
   - This is intended as an early warning while tagging, not a hard duplicate detector.

2. **Likely Missing Tags**
   - For the current item, inspect the most tag-similar neighbors in the current set.
   - If a tag is present on most of those neighbors but missing on the current item, surface it as a suggestion.
   - Prefer language like:
     - `Likely missing tag: lipstick`
     - `Similar items often also include: bangs, earrings`
   - This should be suggestion-only, never authoritative.

### Explicit Non-Goals for V1

- Do not require visual-analysis metadata.
- Do not block editing or saving.
- Do not auto-apply suggested tags.
- Do not treat generic missing categories as QA issues without local similarity evidence.
- Do not make this a full duplicate detector.

## Priority Model

### High Value

1. **Redundant Face/Framing Clusters**
   - Detect clusters like `front + close-up + smiling`.
   - Warn when the current item belongs to an overrepresented cluster.
   - Prefer cautious language: "Similar cluster appears 4 times" rather than "duplicate."
   - This is actionable because pruning is realistic.

2. **Set Diversity Warnings**
   - Surface overrepresented visual buckets.
   - Examples:
     - Too many close face crops.
     - Too many front-facing smiles.
     - Too many similar pose/expression combinations.
   - Focus on "you may want fewer of these," not "you are missing X."

3. **Reviewed After Mutation**
   - If an item was reviewed before crop/deface/transform/reset, it may deserve re-review.
   - This may point to a deeper behavior change: mutating media should possibly clear reviewed state automatically.

### Medium Value

4. **Annotation Gaps**
   - Neighbor/context gaps are useful when they identify likely missed annotations from similar items.
   - This is now part of the first implementation scope in a tag-driven form.

5. **Requirement Gaps**
   - Useful mainly when annotation groups are collapsed.
   - Lower priority because the annotation UI already communicates this well.

### Low / Experimental Value

6. **Annotation Contradictions**
   - Potentially interesting if reliable.
   - Example: detected face direction suggests `side view`, but tags imply `looking at viewer`.
   - False positives are likely, so these should be phrased as "Possible conflict."

7. **Caption/Tag Mismatch**
   - The Tags panel already covers much of this.
   - Only include if QA can add extra context, such as repeated mismatch patterns across a set.

8. **Duplicate Captions**
   - Often intentional in training data.
   - Worth surfacing only if tied to visual redundancy, not as a generic warning.

## Non-Goals

- Do not duplicate preview actions like Crop, Deface, Reset, or context-menu actions.
- Do not make this a raw analysis metadata drawer.
- Do not nag about every missing group or low-count category.
- Do not treat model-derived analysis as authoritative.
- Do not require the user to manufacture material they do not have.

## V1 Panel Shape

Rename the tab label from **Analysis** to **QA**.

Inside the panel, show short rows under two sections:

1. `Similarity`
   - cluster/redundancy warnings for the current item
2. `Suggestions`
   - likely missing tags inferred from similar items

Keep rows short and evidence-based.

Each QA row should be short and explain why it matters.

Suggested fields:

- **Severity**: `Info`, `Check`, `Possible Conflict`
- **Concern**: concise label
- **Why**: one sentence
- **Evidence**: cluster/count/source metadata

Example rows:

- `Check` - Similar cluster - Shared tags `front`, `smile`, `close-up` appear together on 3 nearby items.
- `Info` - Likely missing tag - Similar items often also include `lipstick`.
- `Info` - Reviewed before mutation - This item changed after review and may need another look.
- `Possible Conflict` - Face direction mismatch - Metadata suggests side-facing, but tags imply looking at viewer.

## Open Questions

- What counts as "too many" similar face/framing examples?
- Should thresholds be absolute, percentage-based, or configurable?
- Should QA compare only the current folder, current filter, or current training selection?
- Should similar-cluster warnings rely only on metadata, or also include tags/captions?
- Should mutation automatically clear reviewed state instead of only warning?

## Implementation Notes

- Use current-folder / current-set items as the comparison pool.
- Prefer tag-based comparison first because it is generic, cheap, and already aligned with the annotation workflow.
- Similarity should be conservative and deterministic.
- Suggestions should rely on repeated local association, not one-off coincidence.


