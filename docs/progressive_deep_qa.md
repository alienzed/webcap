# Progressive Deep QA → Caption Assist corrections

Status: historical implementation plan, initially executed on `feature/progressive-deep-qa-actions` against `main` at `f01b63e9`.
**Current-behavior reconciliation (2026-10-30):** `tool/js/qa_workbench.js` and `tests/progressive_deep_qa.test.cjs` are authoritative for the shipped per-item progression, retry, persistence and pause behavior. The phase steps below record the original plan; changes to that plan are called out in place. Follow `AGENTS.md`.

## Goal
Deep QA should find useful **missing or contradictory** annotations and caption details from **saved Sight + saved captions + existing tag assignments**, progressively emit concrete proposals, and offer them through the **existing QA Focus Review / Caption Assist** path. No automatic writes to media, tags, captions, Reviewed, or AI Validation.

## Confirmed existing contracts
- The original baseline's one-shot discovery-only pass has been superseded: `qaRunNextDeepScanBatch` advances item-level assessment after bounded set-wide discovery, with one media item per Director request.
- `tool/server/qa_llm_contract.py:build_request / normalize_result` and `POST /fs/qa/deep-scan` already support caption patches (`add/replace/remove`), tag actions (`add/remove`), provenance and per-item cached Sight.
- `qaFocusReviewCandidateFindings` already limits review entry to currently applicable actions; `focused_caption.js` can append queued keys without interrupting the current editor.
- The Set's existing `.webcap_qa_review.json` already stores scope-keyed results and `aiItemSignatures`; use it for bounded scan receipts. No new database or file root.
- Set-wide findings are *hypotheses*, not validated patches. No inference on simply opening QA or Caption Assist.
- Existing `qaFocusReview` legacy Set Tools button is intentionally hidden; the QA workspace owns the visible entry point.

## Phase 1 — Contract and evidence safety
1. Reuse the per-item QA contract and route. The backend route permits bounded groups of at most four media, but the **current UI submits one item at a time**.
2. Only analyze items with complete **saved** Sight; report items lacking Sight as *not checked*, never silently claim validation.
3. Preserve the model's structured patches and tag actions without applying anything. Recommend **adding only terms already in the corresponding group's vocabulary**; permit removing only currently assigned tags. For unscoped new tags, require explicit manual action instead of inventing annotations.
4. Keep low-confidence or non-actionable hypotheses in QA as observations, not in the correction queue.
5. Guard patches by the existing exact-target checks and live signatures.

## Phase 2 — Frozen progressive scan
1. At explicit Run Deep QA, snapshot the training selection, per-item source inputs, signatures, selected model, and set focus; later filter/Focus Set changes must not alter this snapshot.
2. Run the existing bounded set-wide discovery once, then **automatically inspect hypothesis candidates first**, followed by the rest of the frozen scope; the item-level check independently evaluates missing/contradictory facts.
3. Check **one item per request**, merge results, persist compact per-item receipts and findings, then advance. On restart, user-invoked Run Deep QA resumes matching saved scope/model/signatures without repeating already successful items or set discovery.
4. For malformed/incomplete **item output**, report the error, defer that item to the end for one retry, and then mark it failed while continuing other items; failures remain explicitly resumable. For **systemic runtime/inference or persistence errors**, pause visibly with completed receipts preserved and let the user explicitly resume. Stop cancels the active Director job, not another Sight scan.
5. Never launch new Sight implicitly. An item whose inputs change while a check runs is *not* marked current or complete.

## Phase 3 — Reuse review interface and honest progress
1. Make the **Review & Fix saved findings** action available as soon as a real actionable item exists, including *during* the ongoing scan.
2. Reuse the same QA Focus Review UI, editable Caption Assist candidate, tag +/- suggestions and caption patches; an ongoing review receives newly completed items without stealing focus.
3. Decouple the active review queue from temporary media filters and QA Focus Sets; preserve frozen scan scope.
4. Show accurate checked / actionable / without Sight / remaining counts and a clear `Caught up — Deep QA still running` state.
5. Keep the existing ordinary Caption Assist, AI Validation, human Reviewed, tags and manual Concept Check unchanged.

## Phase 4 — Tests, review, integration
1. Test the per-item contract and model input boundaries, stale input validation, no automatic Sight, no automatic caption application, resume and stop, review queue eligibility, navigation, and filter changes.
2. Update stale tests that assert the older one-shot invalidation behavior *only when it deliberately changes*.
3. Run focused CI, inspect the PR diff, and merge only after tests pass.

## Non-goals
No new filter, modal, review state, embedding service, automatic tag vocabulary expansion, mandatory wizard, model-says-validated status, silent content mutation, or redesign of Caption Assist. Deep QA findings remain suggestions requiring human acceptance.

## Decision/rollback boundary
Existing review receipts and Caption Assist behavior must remain readable/usable. This feature changes the explicit Deep QA operation and adds optional progress fields to its existing QA review payload, not folder annotation or training outputs. If model behavior proves noisy, downgrade suggestions to observations; do not auto-apply them.
