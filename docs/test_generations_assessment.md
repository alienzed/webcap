# Test Generations Assessment Layer

## Purpose

Test Generations should help narrow retained LoRA candidates through repeated, lightweight evidence gathering without becoming a separate evaluation application.

The core idea is deliberately simple:

- **Test Generations orchestrates experiments.**
- **Normal WebCap set views review and annotate the generated media.**
- Existing **ratings, flags, tags, Grid, Single Item, and Focus** remain the canonical review tools.
- Candidate scores are summaries of those existing judgments, not a second rating system.

This keeps the workflow close to satisficing: quickly mark what looks strong, repeat when uncertainty remains, and let evidence accumulate across tests.

## Current scope

### Candidate selection

Each staged LoRA has an include checkbox.

- Checked: include it in the next Test run.
- Unchecked: keep it staged, but skip it for this run.
- Removing a staged LoRA remains a separate destructive action.

The checkbox is intentionally just a working selection set. It does not mean rejected, weak, shortlisted, or approved.

### Optional session names

A Test session can have an optional human-readable name such as:

- Neutral baseline
- Red colour test
- Outdoor background
- Loose fit
- Sleeve variation

The timestamped session folder remains the stable technical identifier. The friendly name is metadata used to answer the practical question: **what was I testing here?**

No formal test taxonomy is required.

### Existing review surfaces

Preview and Compare stay available in Test Generations for quick inspection.

An **Open Folder** action opens the generated session folder as a normal WebCap folder so the existing review workflow can be reused directly:

- Single Item
- Grid
- Focus
- 1–5 ratings
- flags
- tags
- pruning/deletion where appropriate

Generated Test folders are excluded from WebCap's automatic `originals/` backup behavior so opening them for review does not duplicate every generated video.

### Rating summaries

Ratings remain ordinary folder ratings stored in the generated Test session's existing `.webcap_state.json`.

Test Generations reads those ratings and rolls them up by source staged LoRA.

A candidate can therefore show a lightweight summary such as:

`★ 4.3 (6)`

where:

- `4.3` is the average of rated Test generations associated with that LoRA.
- `6` is the number of rated observations.

The observation count matters. A `5.0 (1)` and a `4.4 (8)` represent different amounts of evidence.

No hidden weighting, model-generated quality score, or ranking algorithm is introduced.

## What is intentionally *not* implemented

The first assessment layer does **not** add:

- per-aspect questionnaires
- mandatory criteria such as garment fidelity, leakage, colour, or body proportions
- group-to-test mappings
- weighted scoring
- automatic winners
- a separate Test Grid / Test Single / Test Focus implementation
- semantic states such as shortlisted, excluded, rejected, or finalist
- automatic prompt generation

Those ideas may become useful, but the existing workflow should demonstrate the need first.

## Working model

A typical narrowing pass can be:

1. Start with all retained staged LoRAs checked.
2. Run a named Test such as **Neutral baseline**.
3. Open the generated folder in Grid/Single/Focus and rate what is worth rating.
4. Return to Test Generations and inspect the accumulated candidate scores.
5. Uncheck candidates that are not interesting for the next question without deleting them.
6. Run a more targeted Test such as **Red colour test** or **Outdoor background**.
7. Reintroduce unchecked candidates at any time if later evidence makes them interesting again.

A spectacular early result is not automatically the best LoRA. A less dramatic candidate may prove more stable across prompts, subjects, backgrounds, colours, or shapes. Repeated observations are meant to expose that difference.

## North star

### Assessment as a thin layer over normal WebCap concepts

The assessment layer should continue to reuse WebCap primitives rather than fork them.

If a future idea can be expressed through ordinary:

- folders
- items
- ratings
- tags
- groups
- Focus passes
- prompts

that should be preferred over inventing Test-specific equivalents.

### Named test suites

Repeated session names may naturally become reusable test recipes later.

A recipe might eventually contain:

- a friendly test name
- prompt or prompt template
- generation settings
- optional review question

This should only be formalized after real usage shows repeated patterns worth saving.

### Annotation groups as evaluation dimensions

Training sets already use annotation groups to describe meaningful variation, especially for garments.

For example, a **Wetsuit** set might contain groups around:

- colour
- fit
- sleeve configuration
- zipper/configuration
- body characteristics
- environment

Those groups could eventually become natural test dimensions without introducing a separate ontology.

The important constraint is that group alignment should remain optional. A freeform session named **Background leakage** should remain perfectly valid even if there is no matching annotation group.

### Group-driven prompt helpers and local wildcards

A particularly interesting extension is to reuse a set's own group/tag vocabulary to help build test prompts.

Rather than requiring every assessment prompt to be hand-curated from scratch, WebCap could eventually derive small **set-local wildcards** or prompt fragments from existing annotation groups.

For example, if the set already knows:

- Colour: black, red, blue, yellow
- Sleeves: sleeveless, short sleeve, long sleeve
- Fit: tight, regular, loose

WebCap could expose lightweight prompt helpers such as:

`{black|red|blue|yellow}`

or generate controlled combinations from selected groups.

This would not be automatic evaluation. It would simply make it cheaper to ask systematic questions of retained LoRAs using vocabulary the user has already curated.

Useful future directions could include:

- choose one value deliberately to test prompt obedience
- randomize within one group while freezing the rest
- select values absent or rare in the training set as a stress test
- combine two groups to probe compositional behavior
- save a generated wildcard/prompt fragment as part of a reusable Test recipe

The source vocabulary should remain visible and editable. WebCap should not silently invent semantic categories or turn group structure into a rigid assessment rubric.

### Focus-style judgment passes

If normal rating in Grid/Single eventually feels too loose for a specific experiment, a directed review could reuse the existing Focus traversal pattern:

- show one generated item
- keep the session/test question visible
- record an ordinary 1–5 rating
- advance to the next item

The rating would still be the same normal rating. The extra layer would only provide review context and faster traversal.

### More informative score expansion

The compact candidate score should remain simple.

An optional expanded view could later show the evidence underneath, for example:

- overall average and count
- ratings by named session
- most recent observations
- potentially group/test breakdowns if those concepts are ever formalized

The collapsed score should not become a dashboard.

## Design guardrails

1. **Do not duplicate existing review interfaces.**
2. **Do not require formal assessment metadata to run a Test.**
3. **Do not confuse temporary checkbox selection with candidate quality.**
4. **Do not hide the number of observations behind an average.**
5. **Do not create opaque quality scores.**
6. **Do not force groups into the workflow before real usage proves the relationship.**
7. **Keep Test folders lightweight and disposable; annotations are valuable, duplicated generated media is not.**
8. **Prefer small workflow conveniences over new state models.**

## Current implementation notes

The lightweight implementation adds:

- staged candidate checkboxes
- optional session name metadata
- selected-candidate execution
- Open Folder navigation back into normal WebCap review
- rating enrichment for saved Test sessions
- aggregate candidate rating summaries across sessions
- protection against automatic `originals/` duplication inside `test-generations/`
- regression coverage for selection, rating aggregation, review-folder wiring, and backup exclusion

Preview and Compare are otherwise intentionally unchanged.
