# Studio Director — opt-in real-model acceptance

**Current contract: 2026-11-17.** See [Studio Director functional contract](studio-director-contract.md) and [user flows](studio-user-flows.md). This test suite uses the actual configured remote/local language model and a disposable WebCap data root; no mock model substitutes for a live result.

## Run against a configured model

Start WebCap with an accessible model and isolated data root, then run:

```bash
WEBCAP_TEST_DIRECTOR_MODEL='remote-1::your-real-model-id' \
npx playwright test --config=playwright.live.config.cjs --max-failures=1
```

For the separate backend/API smoke check:

```bash
WEBCAP_LIVE_URL=http://127.0.0.1:4200 \
WEBCAP_LIVE_MODEL='remote-1::your-real-model-id' \
WEBCAP_LIVE_REPORT=director-live-results.json \
node --test tests/studio_director_live_model.test.cjs
```

The API smoke test is opt-in and skips without `WEBCAP_LIVE_MODEL`. The Playwright suite uses `WEBCAP_TEST_DIRECTOR_MODEL`; use the exact ID displayed by WebCap. On a hosted GitHub runner without access to that model, only test syntax and deterministic browser mocks can be verified. The live tests must not be declared passing based on mocked CI.

## What real-model tests verify

- Ordinary `studio_chat` produces a useful conversational answer without a response schema, H3 writing reference or implicit authoring action.
- Project creation/revision are **explicit** Write functions with Project schemas, full history and correct destination; no Studio Review/Apply.
- New Scene batches and selected-Scene revision are explicit H3-guided operations. Inspect actual returned JSON and saved fields; allow independently useful results rather than requiring an invented result count.
- Explicit saved Read snapshots from unrelated Projects persist as visible conversation turns and reach later chat and Write requests unchanged without redirecting the destination; source edits require a second explicit Read.
- Conversation, navigation, attachment, immutable Read messages and Write destination stay independent. No Read-triggered model call or automatic source reread.
- Saved Project and Scene state after reload matches confirmed persistence, without modifying siblings or unrelated Projects.
- Specialist Revise Scenes, Develop Scenes and coherence flows remain available independently of ordinary Director chat.
- Live provider failures and incomplete responses remain inspectable, without speculative repair. A passed unit test or provider job alone is not a saved-value pass.

`tests/live/studio-actual-schema.spec.cjs` specifically inspects real operations, outgoing requests, job receipts and saved values. `tests/live/studio-authoring.spec.cjs`, `studio-continuity.spec.cjs` and the other live files cover cross-operation flows and specialist functions. Attach raw evidence for failed runs to diagnose model format, request composition and persistence separately.

## Results policy

This document does not claim current real-model passage. A current run must record the model ID, commit SHA, command, real test results, and actual failure logs. Historical results recorded before the conversation-only/direct-Write redesign are not evidence that the new contract passes.
