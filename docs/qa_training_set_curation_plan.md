# QA · Curate Training Set — phased implementation

## Goal and boundaries
An optional, unattended, visually reviewed subset suggestion owned by **Quality Assurance**.
No new workspace, editable Focus Set, training scheduler, media deletion, automatic
caption/tag mutation, or model-learning guarantee. Existing source Set is unchanged.
A QA-only checklist sends selected media filenames into the existing Focus Set mechanism for training, without duplicating source media.

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
- **Curate Review:** show each item's exact filename beside its evidence, with **Open in Single Item** using the existing media selection path. Leaving the fullscreen review preserves the curated choices and does not create or modify a Focus Set.
- Live selected count, represented-concept count, and weighted-evidence coverage.
- Presets reapply a proposed subset. All images allows adding exclusions back.
- UI only changes QA-owned curation session state, not `state.focusSet`.
- **Balance priorities (added):** display all groups represented in the bounded concept inventory, preselect groups containing Director CORE concepts while preserving their per-concept priorities until explicitly changed. Checkbox overrides determine which groups' terms get CORE coverage weight. Unchecked groups retain Director-selected terms at SUPPORTING weight; newly checked groups include even terms the Director omitted. Rank and shortlist presets recompute locally without more inference. If the user has manually changed media checkboxes, preserve their selections until a preset is explicitly chosen again. No new persistent state.

## Phase 4 — Focus Set training handoff (implemented)
- On explicit user action, activate a Focus Set containing the chosen original media filenames.
- Open the existing Set Training workspace for the user to review and start a run.
- Do not copy the working Set, captions, ratings, tags, or metadata into a second editable Set.
- QA preserves the parent training scope so returning from the curated Focus Set does not turn the shortlist into the analysis source.
- Training captures its normal immutable run-specific bundle only when the user initiates the run.

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
