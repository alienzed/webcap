# Prompt Assist MVP

## Purpose

Prompt Assist is a review and improvement workspace for existing Studio Project and Scene prompts. It is not another authoring Director and does not automatically rewrite saved material.

It supports two review scopes:

- **One Scene at a time:** navigate between Scenes in the Project; each review remains scoped to the selected Scene.

## Context preparation

Prompt Assist uses deterministic, source-addressable extraction for its immediate review. Project Deep QA is an optional preparation layer that enriches those reviews with reusable, persisted intelligence.

- Read the saved Project overview, visual atmosphere and typed invariants.
- Extract established H3 sections and numbered **[Shot N]** entries when present.
- Preserve each Scene ID, order, title, duration, exact prompt and cut number.
- For older/custom prompts without standard H3 shot sections, pass the complete prompt as one source-addressable unit rather than silently dropping it.
- Keep exact source prompts server-side for revision preparation and compare/apply.
- Fingerprint the review source and bind each model pass to the Project revision observed when Prompt Assist opened.

### Project Deep QA

- Explicitly prepare each Scene in Project order, one Director job at a time, using the selected Director model and the existing chat queue.
- Each Scene receipt records cut-level visual intent, focal element, action and verbatim source excerpts, which the server verifies against the saved prompt. Explicit state changes are kept separate from possible inferences; carry-forward expectations, physical interactions and potential concerns are also recorded.
- After all current Scenes are prepared, a compact cross-Scene pass builds a Project index of recurring elements, supported Scene relationships and Project continuity principles.
- Scene receipts and the Project index are stored in the Project's Storyboard data directory in `.prompt_assist_deep_qa.json`; they do not modify prompts, Takes, generation settings or other Project fields.
- Each Scene receipt and the Project index carry their own schema version and source fingerprint. Editing one Scene invalidates only that Scene's receipt; the Project index becomes stale when any Scene or Project-level source changes.
- Re-running preparation skips fresh Scene receipts and rebuilds only stale work. If a job fails, completed receipts remain saved and a later run resumes from the remaining Scenes.
- Prompt Assist displays fresh cut-level Deep QA evidence beside its source cut and the cross-Scene summary in Project context. Specialist calls receive only fresh relevant evidence; stale receipts are never supplied as current.
- Deep QA does not launch image/video Sight or infer visual facts from generated media. It prepares intelligence from saved Project prompts and Project context only.
- Project Deep QA is separate from the existing Set/media Deep QA workflow in the QA workspace; it reuses the Director queue pattern, not the media QA data or review files.

## Analytical responsibilities

The three reviewers are independent analytical passes using the selected Director model and existing LLM queue. They are not separate autonomous agent runtimes.

1. **Visual Director:** checks whether each cut communicates the intended subject, action and focal element through its framing, angle and visual emphasis.
2. **Continuity & State Analyst:** checks chronological state progression between cuts within a Scene, including regressions, props, clothing changes, positions and physical interactions. Independently rendered Scenes are not assumed to preserve exact appearance.
3. **Sequence Director:** checks cut selection, pacing, repetition, coverage and whether each shot contributes meaningfully to the sequence.

Each pass returns structured findings with a Scene ID, cut number, priority, source evidence and a concrete recommendation. A Scene-level finding uses cut number **0**.

## Synthesis and collaboration

The Creative Editor receives the independent reviews and source context. It consolidates overlapping findings, preserves meaningful disagreements, and cites the exact specialist finding IDs behind each recommendation.

The user works in a Scene-focused dashboard, with the selected Scene's source cuts in the main column and specialist status, Editor decisions and discussion visible together in the inspector. The user can:

- Inspect all three specialists' findings together, anchored to their relevant cut or Scene-level context.
- Ask a follow-up question of the Editor or any specialist.
- Accept or reject individual Editor recommendations inline, or accept/reject all; decisions remain reversible during the session.
- Ask the Editor to prepare revised complete prompts from accepted recommendations.
- Inspect and edit each proposed prompt with a live original-versus-proposed diff.
- Apply selected Scene prompts explicitly.

Discussion is scoped to the current Prompt Assist session. It does not silently modify Studio Director's ordinary conversation or saved Project state.

## Persistence and recovery

- Reviews, synthesis and proposed revisions are drafts in the modal.
- Applying a revision is a separate explicit operation.
- Apply verifies the source fingerprint and exact original prompt before writing.
- The existing field-scoped batch mutation changes only selected Scene prompts.
- Existing Takes, titles, duration, generation settings, references and other Scene fields are preserved.
- Previous prompt and revision state are recorded so the existing Restore Previous Prompt workflow remains available.
- A stale Project/Scene revision rejects Apply and requires a fresh review.

## Live acceptance

`tests/live/prompt-assist.spec.cjs` uses the actual configured Director model. It covers independent specialist calls, Editor synthesis, a specialist follow-up, proposed prompt review, no mutation before Apply, and preservation of the prior prompt, Takes and unrelated Scenes.

Run with the configured live model:

```bash
WEBCAP_TEST_DIRECTOR_MODEL='remote-1::your-real-model-id' \\
npx playwright test --config=playwright.live.config.cjs tests/live/prompt-assist.spec.cjs
```

This suite is opt-in and must not be represented as passing based on mocked model output.
