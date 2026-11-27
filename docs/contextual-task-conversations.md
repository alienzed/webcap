# Contextual task conversations

Audit basis: main at c7f7d9919c55a789f12424862cd4ed505ab89ae4. Follow AGENTS.md: explicit writes, feature-owned state, local failure reporting, minimal shared infrastructure, no added startup work. Revise Scenes, Studio Director and Caption Assist UI are outside the UI migration. Keep Review Dataset and other existing assistant modes working.

## Phase 1 — authoritative Set context (this changeset)

Read saved set_variables and set_training_focus with the existing wildcard annotation snapshot. Preserve optional training-run filter and existing fallback. Report selected terms, exclusivity and observed scope coverage separately from inferred inventory. Missing annotations do not establish missing visual content. User focus takes precedence over saved focus. Keep existing wildcard schema, preview, prompt application and Epoch Finder callers. Add contract and route tests.

## Phase 2 — shared temporary conversation surface (implemented for Ask QA; browser verification pending)

Use Ask QA as reference: review_assistant.js owns evidence and execute/cancel; director_chat.js owns message rendering, model selection, status, context inspection, stop and temporary session behavior. Extract only UI and lifecycle pieces necessary for a contextual modal; keep persistent drawer and other modes untouched. Avoid new registry or session store. Feature supplies title, captured context, conversation callback and optionally working result panel. Open directly from feature, close back to originating surface; preserve in-flight state and errors, keyboard focus, scroll and drafts. Ask QA remains full-width, read-only, with same captured evidence and explicit updated-context restart. Regression: qa_finding_chat.test.cjs, director_chat_persistence.test.cjs, browser checks for focus, close/reopen, stop, Set changes and Studio isolation.

## Phase 3 — Wildcard Builder

Move existing run selector, editable wildcard, stable terms, dimensions, shuffle/reroll and combination preview into feature-owned result region. First generation and follow-ups use same captured Set/run evidence from Phase 1, prior dialogue and current editable working prompt. Supply exact wildcard result schema only when authoring a new working result; discussion can return prose. Keep current draft on failed/empty output; preserve independently useful material. Keep Use as Prompt as explicit mutation (useGeneratedWildcard), reusing existing persistence and dimension synchronization. No extra validation calls. Verify run scope, edits, follow-up refinement, no accidental save and switching Sets.

## Phase 4 — Caption Template

Use Set Definition's explicit Save Template boundary (setPrimerTemplateFromDashboard), replacing unattended generation in primer_settings.js with same contextual modal. Capture group schema, mappings, saved template, training focus, variables, user-approved caption examples. Preserve placeholder grammar and use existing deterministic Primer renderer to show examples across different populated groups; allow manual edits. Discuss freely and author candidates explicitly. Write Template persists agreed draft to existing owner; no chat message changes Set state. Reuse existing save/history behavior. No new structure entity unless evaluation shows existing template cannot express desired structure. Check legacy manual editing.

## Phase 5 — Caption Assist guidance and evaluation

Inspect buildCaptionAssistRequest and caption_ops.py competing guidance (template as optional vs complete natural sentences and preserving draft order). Keep selected facts, required phrase, Sight and valid draft content, but make saved template order, density and expression the desired style for new caption authoring and explicit structural changes. Preserve targeted factual repairs. Each item uses independent request with same approved saved standard, never previous generated captions. Compare baseline vs candidate across representative full/sparse/mature captions, including repeated sequential independent calls, and confirm no factual regressions. Do not change global model/runtime contract.

## Release gates

Each phase gets focused tests and diff review. Verify representative browser layouts at normal zoom, actual local LLM behavior, cancellation, state ownership, no automatic writes and no regressions of excluded features. Do not merge an unverified cross-workspace UI migration.
