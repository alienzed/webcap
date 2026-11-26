# Set Dashboard consolidation — implementation plan

Accepted reference: mockup A (consolidated workspace). The modal and application loading/landing sequence remain intact.

1. Static two-column preparation, footer metrics, existing Sight, annotation and caption handoffs, direct Curate entry, Reports & Utilities. Balance rows use the active selection and actual caption/tag matches. Existing focus-return mechanism restores parent scope.
2. Set-owned definition and training variables: preserve old QA focus receipts, persist explicit focus and variable configuration in existing folder state; grouped-term matching, optional exclusivity and broad coverage warnings. No validation gates. Template editor retains single owner.
3. Integrate QA presentation using its existing renderer/state, explicit handoffs to specialist workflows and return navigation. Curate remains dedicated and independent of QA completion. Do not change Deep QA model guidance or curation ranking in this pass; connect declared variables in a later evidence-driven pass.
4. Verify real browser rendering at normal zoom, scope, field persistence, narrow width, specialist handoffs, running operations, no duplicate IDs, no DOM relocation, no startup requests.

Phase 1 is staged first. Subsequent phases require regression coverage before merge. No production inference or GPU queue changes.

Phase 2: Set-owned fields `set_training_focus` and `set_variables` round-trip via existing folder state. Historical scoped QA receipts are retained; only a single unique prior nonempty focus can seed the new field. Conflicting prior intent is displayed for human resolution. Missing coverage is advisory; the prototype's >25% missing threshold applies only to variables explicitly marked expected on most media. Counts use grouped assignments, not caption substrings. Balance phrases use caption OR tag matching. No automatic correction or inference.

Phase 3: the QA renderer chooses one of two statically declared hosts. Inactive host contents are cleared on handoff so existing per-view IDs remain unique. The embedded tab does not start Deep QA; it retains the existing overview, report, browse, corrections and concept-check behavior. Inspecting evidence closes the Dashboard and returns through the existing Focus Set mechanism. Curate opens its existing dedicated surface and returns to the originating Dashboard section. Report utilities remain the original surfaces.
