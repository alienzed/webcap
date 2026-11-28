# Studio Prompt Assist and Project Deep QA

**Status:** Product/behavior contract for the implemented Prompt Assist and Project Deep QA features. This document defines intended behavior; current code and tests remain authoritative for shipped details. Keep the two aligned as the implementation evolves. Follow `AGENTS.md`.

## Vision

Help authors get better renders sooner by catching preventable prompting problems and offering practical, specific improvements—without adding another review process or making creative work heavier.

The goal is to save time and reduce trial and error, not create new work for the author.

## Purpose

These are complementary, independently usable tools for improving the written instructions that drive Scene generation. They are time-saving assistance within existing workflows, not new mandatory stages or heavyweight workspaces.

- **Project Deep QA** looks across an entire Project. It finds potential weaknesses in individual Scene/cut instructions and problems that emerge from relationships across cuts and Scenes. It should make findings actionable and prepare a practical candidate fix where the evidence supports one.
- **Prompt Assist** works on one selected Scene at a time. It helps the author identify practical weaknesses in that Scene's written prompt/cut instructions and prepare targeted improvements.

Neither feature requires the other. Project Deep QA can be run on its own; Prompt Assist can be opened and used without a prior Deep QA run. When current Project Deep QA findings exist and are relevant to the selected Scene, Prompt Assist may use them as additional text context. Their absence must not disable or degrade the standalone Prompt Assist workflow.

The author remains in control. Findings and proposed changes are assistance, not approval gates or automatic mutations.

## Project Deep QA

### Scope

An explicit Project Deep QA run examines the Project as a whole, including:

- each Scene and its individual cut instructions;
- continuity and progression within a Scene, especially between cuts;
- continuity and relationships between Scenes;
- prompt omissions, ambiguity, or contradictions likely to undermine the intended rendered result;
- whether the written instructions make the intended subject, action, framing, focus, and relevant changes sufficiently explicit.

The scan must consider both local problems (one Scene or cut) and project-wide relationships. It is not merely a cross-Scene consistency checker, nor merely a batch of unrelated per-Scene prompt reviews.

The motivating failure class includes details reverting after a cut, changes being only partially specified (for example, clothing changes that update one garment but unintentionally preserve the prior outfit), and camera/focus instructions emphasizing the wrong subject or part of an action. Treat these as examples of issues to detect, not a closed taxonomy or rigid rules.

### Findings and fixes

Deep QA should identify potential issues and make them actionable at a minimum. Where it can support a concrete correction, it should prepare a practical proposed change associated with the affected Scene/cut. The purpose is to help the author resolve the issue, not to produce academic commentary, abstract scoring, or lengthy prompting theory.

A finding is not permission to change saved Project content. Proposed fixes remain reviewable and editable; applying them is an explicit author action. Preserve unrelated prompt text and other Scenes/cuts when applying a localized correction. Prefer the smallest useful change; do not rewrite an entire Scene when a targeted edit is sufficient.

### Analysis lifecycle

Deep QA can display its persisted `proposedPrompt` directly as an editable candidate and save it using the existing guarded Scene prompt apply route, without another model request. This is an entire Scene prompt candidate, not a localized patch; authors should inspect the complete candidate before applying. Changing a Scene invalidates the current whole-Project analysis signature.


Use the mature Deep QA lifecycle as the reference model: persisted analysis, freshness tied to the inputs that materially affect the result, reuse of current findings, and explicit reruns/reanalysis when inputs are stale or the author requests a fresh run. Avoid rerunning unchanged analysis unnecessarily.

Before implementation, trace the existing Deep QA implementation and its actual signature, persistence, resume/retry, progress, and invalidation behavior. Reuse the established pattern where it fits; do not assume the Prep implementation's data model, UI, or routes can be copied directly into Studio. Project Deep QA must use Project/Scene-owned state and must not create a dependency on Prep Sets, captions, media metadata, or QA state.

## Prompt Assist

### Scope and interaction

Prompt Assist is a standalone, Scene-specific assistant. It focuses on one selected Scene per working session/modal and the text that defines that Scene's intended result, including its cut instructions. It does not inspect generated Takes, images, video, or visual references.

Prompt Assist complements, rather than replaces, the existing standalone **Visual Direction agent**. Visual Direction remains its own independent capability and the primary Scene-level visual-completeness pass. Prompt Assist is the practical text-focused fallback when Visual Direction misses an issue, cannot resolve it, or the author wants to improve the written instructions directly. The two capabilities must not be collapsed into one workflow or made dependent on each other. Prompt Assist should not become a parallel mandatory pass or automatically follow Visual Direction.

Its purpose is practical improvement: detect a meaningful weakness, explain it briefly in terms of the expected result, and prepare a concrete, editable correction that the author can apply. Be generous with useful specificity, following the spirit of Enrich Sight: spell out the relevant details explicitly rather than relying on the generation model to infer them. Keep that specificity grounded in the author's intent and the supplied text. Avoid academic explanations, speculative theory, long lists of alternatives, or broad prompt rewrites.

Use the interaction principles established by Caption Assist rather than inventing a new review paradigm. The earlier UX direction is a focused, roomy modal (roughly 80% of the available screen) that keeps the selected Scene and its relevant findings/proposed change visible together. It is opened only when requested, handles one Scene at a time, and should feel like a quick working aid—not a new workspace, checklist, or process the author must maintain. Reuse existing Scene prompt editing and History for applying/recovering changes.



- present actionable findings in a clear, focused workspace;
- show the proposed correction in an editable form;
- let the author accept/apply an individual correction;
- preserve the original until the author explicitly applies a change;
- keep the correction scoped to the relevant prompt/cut material;
- make the actual resulting text visible and editable.

To keep the modal readable when several substantial findings are returned, display one complete finding at a time with direct Previous/Next navigation, a truthful applied count, and an expandable full Scene prompt. Keep the complete problem, suggested fix, exact source excerpt, and editable replacement available for the current finding. Preserve unsaved replacement edits when navigating. Advance after an actual successful Apply while allowing the author to revisit applied or skipped findings. This changes presentation only; navigation itself must not save or trigger another model request.

The expected unit of assistance is one problem and one practical adjustment. Each suggestion uses an exact, unique excerpt from the saved prompt and a focused replacement, so corrections can be applied independently and successively without overwriting earlier accepted changes. Multiple alternative solutions are generally unnecessary; prefer one best, sufficiently grounded recommendation. A larger rewrite may be appropriate only when the problem cannot be solved locally, not as the default.

### Independence and optional context

Prompt Assist must remain useful when Project Deep QA has never been run, is stale, or has no findings. It performs its own focused Scene analysis.

When available, relevant current Project Deep QA findings can inform Prompt Assist so the author does not have to rediscover known Project-level continuity issues. This is an optional context enhancement, not a prerequisite or hidden refresh. Prompt Assist must not silently launch Project Deep QA.

Prompt Assist is text-only. Do not add Take/image/video/reference inspection to its MVP.

## Boundaries

- Neither tool automatically edits saved Project, Scene, or cut content.
- Neither tool blocks authoring or generation because a finding exists, is unresolved, or cannot be assessed.
- Do not turn findings into quality grades, readiness gates, or mandatory checklists.
- Do not duplicate the existing Scene authoring/Director Write path. Prompt Assist prepares focused, user-controlled prompt improvements; the existing explicit authoring/save operations remain authoritative for persistence.
- Do not make Prompt Assist a wrapper around Project Deep QA. It must have a useful standalone path.
- Do not make Project Deep QA a prerequisite for Prompt Assist or require the author to run both.
- Keep Prep Deep QA/Caption Assist and Studio Project Deep QA/Prompt Assist separate in ownership and data. Reuse proven interaction and lifecycle patterns, not cross-workspace state or accidental file sharing.

## Verification expectations

Verify the real user workflow, not just helper functions or mocked model output.

- Project Deep QA covers both per-Scene/per-cut issues and cross-cut/cross-Scene relationships.
- Findings identify their affected Project, Scene, and cut where applicable.
- Project Deep QA findings and candidate fixes remain available across reloads according to the established analysis lifecycle; freshness includes active Project context, Scene order, durations, and saved Scene prompts; retired Scene state fields are excluded.
- Changing relevant source text invalidates only the affected analysis scope where the implementation can determine that safely; unchanged analysis is reused.
- Explicit rerun refreshes analysis without mutating authored prompts.
- Prompt Assist works on a Scene without any Deep QA history.
- Prompt Assist can use relevant current Deep QA findings when present, without triggering a Deep QA run or hidden refresh.
- Prompt Assist does not inspect Takes, images, videos, or visual references.
- A proposed correction is editable and can be applied independently; accepting one correction does not overwrite unrelated prompt/cut text or earlier accepted corrections. Stale source text is rejected rather than silently overwritten.
- No finding or model failure blocks ordinary Scene editing, explicit Write, or generation.
- Exercise real browser interactions and live model behavior with Playwright coverage. Keep deterministic contract tests as supporting coverage; they do not substitute for live tests.

Record actual requests, model responses, saved results, and failures. Distinguish application defects from model limitations. Preserve useful partial results and follow the repository's visible-failure and best-effort guidance in `AGENTS.md`.

## Implementation note

This contract intentionally does not prescribe a new agent hierarchy, scoring framework, orchestration layer, schema, or storage subsystem. First map the existing Project/Scene/cut text model, the mature Prep Deep QA lifecycle, Caption Assist's review/apply interaction, and the current Studio Director/Scene editing path. Then implement the smallest Studio-owned solution that satisfies the behavior above.

## Related AI research

See the [AI research index](ai-research/README.md) (R02 R03 R06 R07 R09 R14) for candidate publications and future research questions. This reference does not change the feature contract or establish evidence for its current implementation.

See [R02 — Context engineering](ai-research/R02-context-engineering.md) for published evidence, limits, and applicability questions. The research note does not change this feature's contract or runtime behavior.
