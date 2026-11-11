# Set Dashboard — three working surfaces

## Purpose

The Dashboard is an on-demand, wide, stable Set control center, not a mandatory wizard, an all-purpose workspace, or a set of redundant launch buttons. From the user's perspective:

| Tab | Question | In-place work and destinations |
| --- | --- | --- |
| **Analyze & Tag** | What is here, and what should I identify? | Existing Set Intelligence Sight model/scope/scan/progress/inspection in place; current-scope group review coverage alongside Manage Groups, Focused Annotation, Guided Tagging, and Vocabulary Discovery |
| **Caption** | How do I describe it? | Required phrase and balance phrases edited in place; existing Caption Template editor opened explicitly; current-scope caption coverage and Focused Caption; Caption Sheet available for review |
| **Review** | What should I improve? | Existing QA/Deep QA review workspace, Caption Sheet, and Caption Report through the established destinations |

Training stays in its existing workspace. Neither the Dashboard nor switching tabs starts a model, scan, QA job, or mutation. The Set Intelligence component owns Sight; the QA workspace owns QA evidence; caption/group fields retain their existing save and persistence semantics. A Dashboard action that enters a specialist editor closes the Dashboard.

## Delivery phases and regression boundaries

1. **Grounding & ownership:** Read `AGENTS.md`, the prior Dashboard implementation, Set Intelligence ownership, template/group control locations, focused workflows, review destinations and existing tests. Preserve original field ids and the single embedded Sight host. No new backend state or job schedulers.
2. **Structure & sizing:** Replace the five thin tabs with Analyze & Tag, Caption, Review. Use a top-anchored, consistently wide and tall dialog with stationary header/tabs/progress and a scrolling body. Use a two-column desktop layout and stacked narrow layout. Do not reparent stateful media controls during polling.
3. **Functional placement:** Embed the existing Sight control once on Analyze & Tag and place annotation actions beside it. Keep existing phrase/balance inputs and autosave under Caption, without inventing duplicate editors. Keep template authoring in its existing editor and launch it explicitly. Review links to existing QA, captions and report surfaces. Use prominent contextual actions and quieter supporting operations.
4. **Evidence and checks:** The shared strip reports (a) saved Sight presence across the whole Set, which does **not** certify freshness/model parity, (b) configured group assignments reviewed in the **current filtered view**, and (c) captions present in the **whole Set**. Caption's own bar uses the current filtered view. Missing groups show no denominator. The latest model-specific Sight scope stays visible inside Set Intelligence. Update deterministic Dashboard tests, inspect the changed files and run practical browser acceptance on representative Sets before shipping to production.

## Interaction invariants

- Default to Caption when key phrase/balance terms need configuration; otherwise default to Analyze & Tag for unprepared Sight or pending annotation; default to Caption for unfinished captions, otherwise Review. Users can navigate freely; no forced progress or automatic tab jump while open.
- Sight scan controls, stop, resume/retry, cached inspection, and vocabulary handoff stay with `set_scan.js`. The Dashboard does not implement competing scan logic, and switching tabs must never cancel a running job.
- The only authoritative phrase and balance controls remain `stats-required-phrase`, `stats-phrases`, and their existing list/editor handlers. The single actual caption primer remains `primer-template`. The dashboard offers an explicit Edit Template link instead of cloning its field.
- Group definitions and assignments continue to be owned by checklist and focused annotation. The Dashboard's review metric measures checked assignments, **not annotation correctness or QA certification**.
- Caption Assist, Focused Caption, Focused Annotation, Guided Tagging, QA, reports and Set Intelligence retain their own operation semantics. This Dashboard does not rewrite their models, persistence, cancellation, error reporting, or queue behavior.
- Respect active GPU work by withholding optional Guided Tagging and Vocabulary launch controls while GPU lanes are busy. Manual group management and annotation remain possible.
- Present honest empty selections, missing captions and disabled report options; preserve focused keyboard navigation, Escape, overlay dismissal and Set-switch isolation.

## Focused acceptance

- Fresh Set with missing guidance opens Caption. Both phrase and balance fields are visible/editable, and no inferencing starts.
- Set with guidance but no Sight opens Analyze & Tag, with Sight embedded rather than overlaid; any scan still requires explicit action.
- Analyze & Tag offers Manage Groups on an unconfigured Set, Focused Annotation on configured groups, and optional vocabulary/tagging only with saved Sight and an available GPU.
- Mature Set opens Review; QA, caption inspection and report destinations work independently without a new Dashboard-side QA process.
- A filtered selection distinguishes current-view assignment/caption coverage from whole-Set coverage. The saved Sight metric is clearly labeled as any-model evidence and is not a completion certificate.
- Changing tabs doesn't shift the header, resize the dashboard, replace live Sight progress, or start a second scan. Returning to Analyze & Tag reconnects the existing UI.
- Focus and closing restore the preceding UI without stranded modal overlays.
- Existing specialized workflows and Set-owned saved state remain usable; run `node --test tests/set_dashboard.test.cjs` plus adjacent Sight/QA/Caption tests and representative desktop/narrow browser checks.

## Scope not included

- Embedding Caption Assist, full QA, or all focused editors into the dashboard.
- New QA finding summaries, inferred readiness scores, freshness certification or new server endpoints.
- Training workflow redesign or GPU/queue scheduling changes.
- Deleting legacy feature entry points or changing unrelated navigation.
