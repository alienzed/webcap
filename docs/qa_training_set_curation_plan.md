# QA · Curate Training Set — phased implementation

## Goal and boundaries
An optional, unattended, visually reviewed subset suggestion owned by **Quality Assurance**.
No new workspace, editable Focus Set, training scheduler, media deletion, automatic
caption/tag mutation, or model-learning guarantee. Existing source Set is unchanged.
A QA-only checklist sends selected media paths to the existing Create Set dialog/route.

## Phase 1 — Authority and data (implemented)
- Capture current QA training selection, its human-approved group tags and saved
  Structured Sight inventories. Do **not** send 200–300 complete captions to the Director.
- Aggregate repeated terms into compact count-backed concept IDs. Include some rare
  concepts, not only the most frequent. Expose unscored/uncached evidence counts.
- Send at most 120 concept summaries through existing Director **QA** queue; model
  identifies CORE and SUPPORTING concepts using only authorized IDs.
- Strictly validate Director IDs. Its role is semantic relevance, not image verdicts.
- Keep inference explicitly user initiated, with queue visibility and Stop. Respect
  existing runtime/GPU queue semantics. Fail visibly if Director is unavailable.

## Phase 2 — Deterministic curation (implemented)
- Rank image contributions incrementally using diminishing weighted concept coverage,
  not equal quotas. CORE has greater weight than viewpoint/setting variation.
- Prefer visually simpler images only as a mild tie-breaker. Do not treat caption
  length or term frequency as an automatic quality verdict.
- Find lean, balanced and broad shortlist sizes at diminishing evidence gains
  (heuristic thresholds, not empirically optimal LoRA sample counts).
- Coverage numbers are proxies derived from saved evidence; never model accuracy.
- Show the number of uncached Sight images and inventory terms excluded by budget.

## Phase 3 — QA-only visual review (implemented)
- Preview the Director-prepared selection in a thumbnail grid with checkboxes.
- Live selected count, represented-concept count, and weighted-evidence coverage.
- Presets reapply a proposed subset. All images allows adding exclusions back.
- UI only changes QA-owned curation session state, not `state.focusSet`.

## Phase 4 — Existing Create Set handoff (implemented)
- On explicit user action, pass the chosen source-relative paths to the existing
  Create Set dialog and `/fs/create_set_from_results` route.
- Existing copying of media, captions, originals, approved group tags,
  ratings, and metadata remains authoritative. The source Set is untouched.
- No silent filesystem write until the destination and name are confirmed.

## Phase 5 — Verification and limitations
- Python contract/normalization tests, including fabricated/duplicate Director IDs.
- Node DOM test for 95 images with 80/15 variation, checkbox selection,
  uncoupled Focus Set, and stale-scope rejection.
- Existing Evaluation and Test/queue CI remains active.
- Deferred, deliberately: calibrated visual semantic distance / DINO similarity
  across a large set, actual LoRA-training outcome measurements, persisting curation
  sessions, and a guaranteed optimal sample count. DINO runtime availability is not
  assumed. The initial recommendation is grounded in tags and cached Sight,
  not a neural proof that any particular image is redundant.
