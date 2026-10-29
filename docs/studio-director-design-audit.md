# Studio Director — Design Audit and Implementation Brief

**Baseline:** `main` after IA audit PR #786 (2026-10-28)  
**Status:** Design audit and non-production mockup; no WebCap UI code modified  
**Related:** [IA audit](studio-director-ia-audit.md), [AGENTS.md](../AGENTS.md), [implementation baseline](studio-director-side-panel-implementation.md)

## Judgment

**Keep the side-by-side workbench. Refocus the action rail around one task at a time.** The current implementation already has the right three concepts—conversation, explicit Read, reviewed Write—but its side panel presents a permanent heading, two commands, a general status box, a potentially long action form and expandable readiness items in a single scrollable stack. This weakens both the hierarchy and the continuity of the conversation.

The immediate redesign is **not** another component system. It is a small number of targeted view-state, labeling, and placement changes. Keep the filesystem-backed Project/Scene owners, editor coordination, reviewed mutations, LLM-authored Read acknowledgment and separate general Chat unchanged.

## Evidence and limits

This is a **code-grounded design audit**, not a screenshot-based claim about actual rendering. Inspected `tool/tool.html`, `tool/css/workspace_shell.css`, `tool/js/director_chat.js`, `tool/js/studio_director_workbench.js`, `tool/js/storyboard.js`, and the prior IA audit on `main`. A self-contained **illustrative** HTML interaction mockup lives at [studio-director-design-mock.html](studio-director-design-mock.html); it is not the running application or an actual LLM. Browser screenshot, focus/zoom, accessibility and real-model validation are explicit acceptance requirements.

### Surface-by-surface critique and design disposition

| Priority | Surface | Source-grounded observation | Design correction |
| --- | --- | --- | --- |
| **P0** | Narrow/pinned Director | At container ≤820px the existing CSS stacks the sidebar **above** conversation, capped at 27vh/170px; a later ≤730px rule increases it to **45%**. An expanded wizard can consume substantial vertical space or become awkwardly scrollable. See [CSS layout and breakpoints](../tool/css/workspace_shell.css). | Keep **conversation + composer** primary on narrow view. Actions open a **single on-demand sheet/drawer**, with a close/back control and bounded independent scroll; do not permanently stack the whole rail on top of chat. |
| **P0** | Reviewed result | `#director-studio-undo-brief` is inside the CSS-hidden `#director-studio-flow`. Undo still exists in code but is inaccessible from the new workflow. See [markup](../tool/tool.html), [Director handlers](../tool/js/director_chat.js). | Surface supported Undo **beside the specific success receipt**. No generic Undo promise for irreversible operations. |
| **P1** | Context/status | Header “Working with: [Project]” reflects conversation Write access, while Read and Write use independent Project selectors. The rail has no durable distinction for Read source vs Write target. See [Director mode UI](../tool/js/director_chat.js), [workbench selectors](../tool/js/studio_director_workbench.js). | Show a small **task-specific context line**: “Read from …” or “Write to …”. Surface a cross-Project difference only when real. Never pretend Studio navigation attached content. |
| **P1** | Read | The selected fields are assembled at Send; the exact payload is easy to inspect only *after* a chat message exists. There is no compact selected-field count or persistent send action while scrolling dozens of Scenes. See [Read selection/send](../tool/js/studio_director_workbench.js). | **Project → field selection → selected count / Inspect payload → Send**. Keep CTA visible at bottom of active rail. Display actual field labels; optional raw payload inspector on demand. |
| **P1** | Read acknowledgment | The LLM does acknowledge `RECEIVED:` IDs, and missing IDs are checked, but receipt/result/status is spread between chat and generic sidebar status. See [message handling](../tool/js/director_chat.js). | Keep LLM's own acknowledgment **in the chat**; show success/mismatch **on the same Read event** and a concise rail status. Do not replace it with a WebCap-generated “received” claim. |
| **P1** | Write review | Operation list includes Create a Scene / Create several Scenes as separate tasks and global Playbook between Project/Scene actions. Several existing review dialogs differ in heading and action wording. See [markup](../tool/tool.html). | One goal-first list: **Create Project**, **Update Project**, **Add Scenes**, **Revise Scene**. Keep existing operations under the hood. Present **H3 Playbook** as secondary model guidance, with explicit global scope. |
| **P1** | Form persistence | Each `refreshRead()` rebuilds checkboxes, and `refreshProjects()` touches both Read and Write selects. `refreshWrite()` reapplies model hints. See [workbench](../tool/js/studio_director_workbench.js). | Defaults initialize **once per intentional target/task selection**. After a person edits the form, preserve their selections through rail toggling, model responses and navigation back from review. |
| **P1** | Creative assessment | Readiness checkboxes expand full text **inside the same narrow rail**; checks use one shared Scene ID and are rendered as disabled inputs. See [readiness view](../tool/js/studio_director_workbench.js). | Collapsed compact **Project / Scene** groups; a single-item read-only **popover/detail view** containing the **complete proposal**. Show “not assessed” distinct from “needs development”; never label different Scenes with one unrelated ID. |
| **P2** | General feedback | `#studio-dw-status` is always displayed beneath Read/Write buttons; long-running tasks, errors, applied changes and readiness validation can overwrite the same text. See [workbench status](../tool/js/studio_director_workbench.js). | Put action feedback near the **active action or receipt**. Reserve a compact rail message for the latest actionable state, with detailed diagnostics in the global Console. |
| **P2** | History/review | The transcript contains expandable Read payloads and synthetic saved Apply events. Independent history, model, legacy context and multiple modal review dialogs remain. See [chat render / HTML](../tool/js/director_chat.js). | Render **compact event rows** with proper origin labels (“You sent fields”, “Saved to Project”) and accessible inspection. Use one visual grammar for all existing reviewed dialogs, **without** inventing a generic backend transaction system. |

### Current hierarchy problem in one line

`Director desk heading → Read/Write → persistent status → all active form controls → creative readiness → hidden/other dialogs`

### Recommended hierarchy

`Conversation (dominant) | Context (small) → Read / Write (one active) → action-local result → Creative assessment (collapsed) → Model guidance (tertiary)`

An **active review** temporarily takes focus, but should not replace or reset the conversation.

## UI layout contract

### Desktop / spacious view

- Keep **conversation ~65–70%** and right action rail **~30–35%**, with a practical 320–380px rail width where available; do not squeeze main conversation text below a legible width.
- Preserve independent conversation scrolling and anchored composer. No fixed wizard stacked above the conversation.
- Rail heading should name the **user's current task**, not compete with the main “Studio Director” heading. “Read saved material” or “Write reviewed changes” can replace generic “Director desk” once active.
- Default collapsed rail: a discreet context line, Read / Write, and a **short creative-assessment summary**. Full check text is opened per item, not persistently rendered.
- In an active wizard, use **one** scrolling panel with a persistent action row (“3 fields selected · Inspect · Send to Director”). Do not stack Read and Write.
- Keep history/model controls in existing header/conversation ownership; do not duplicate them in the action rail.

### Narrow, pinned, or keyboard-oriented view

- The conversation and composer stay available and full-width; Read/Write opens a **task sheet** with a clear back/close control rather than a permanently top-stacked rail.
- A single “Actions” affordance is enough when the rail is closed; no phantom readiness status occupying 45% viewport height.
- The sheet must not clear unsent chat text, currently checked fields or a pending reviewed proposal.
- Dialogs must fit viewport height, scroll their body independently, maintain readable 16px control text and avoid losing Apply/Cancel below the fold.

### Read / Write source contract

**Read** means “supply these explicitly selected saved field values to the LLM.” The Project selector is **source**, not active chat binding. Present selected counts and inspectable exact field names before Send. The actual LLM response acknowledges them; distinguish missing or mismatched acknowledgment visibly.

**Write** means “propose changes to this explicit destination, review original and edited values, then Apply.” Opening Write never applies. Director may recommend target/operation/fields; these are defaults, not commitments. If source and destination differ, mark that difference prominently enough to prevent accidental writing to the wrong Project.

**Review** means “compare, edit, apply/cancel.” Put the destination and exactly affected fields above the content. If supported, Undo is attached to the saved operation afterward.

## Proposed interaction maps

**Current (separate operation vocabulary):**

```text
Chat → Read button → Project → checkboxes → Send → chat acknowledgment / generic status
Chat → Write button → Project → Operation [six choices] → different dialog → Apply
Creative readiness → expands long text within same rail
```

**Target (goal-first, same existing persistence):**

```text
Discuss → [Read] → choose source + fields → Inspect if desired → Send → LLM receipt
        → [Write] → choose outcome + target → Director draft → editable review
        → Apply → saved receipt + contextual Undo if supported
        → assess Project / Scene (advisory, one item detail at a time)
```

No extra conversational agent, background reads, persistent Project-memory layer or required checklist.

## Interaction states the Design Audit must verify

| State | Main canvas | Right rail / narrow task sheet |
| --- | --- | --- |
| New/unbound conversation | Friendly empty state and editable composer | Read/Write available, no imaginary bound Project |
| Selected Project in Studio | Normal chat unaffected | Suggested source/destination, identified as a suggestion until chosen |
| Read editing | Chat remains visible and draft preserved | Current source, selected count, fields, Inspect, Send |
| Read sent | Authored user Read event | Awaiting LLM acknowledgment; no success badge yet |
| Read acknowledged | Model's own `RECEIVED` visible in response | Exact-field match confirmed; mismatch explicitly marked |
| Write draft running | Existing progress/Stop, no fabricated assistant response | Target and operation visible, cannot accidentally Apply |
| Reviewed Write | Conversation remains preserved behind dialog | Edited fields, saved originals, destination, Apply/Cancel |
| Saved change | Compact authoritative Apply event | Success, current target, **Undo only when genuinely available** |
| Readiness not assessed | Conversation unaffected | “Not assessed,” not an unchecked “incomplete” assertion |
| Conversation reopened | History and reviewed events restored | No silent content reattachment, defaults do not override persisted user choices |
| Narrow viewport | Full-width chat/composer | User-invoked sheet only; no permanent half-height stack |

## Visual language recommendations (not yet validated via screenshot)

- Reuse existing WebCap `--panel`, `--border`, `--text`, `--muted`, `--accent` tokens.
- One dominant workspace heading, medium task heading, then field labels; body/control default 16px and no miniature wizard controls.
- Buttons: one primary CTA in an active Read/Write step, subtle secondary Inspect/Back, destructive distinction only for actual destructive actions.
- Distinguish **recommended** selection from **user-selected** choice through text/initial state; do not use bright badges everywhere.
- Readiness should look **advisory**, not like an authoritative Project or Take progress tracker.
- Avoid raw JSON as default prose; keep exact data inspectable for trust.
- Keep status clear but avoid persistent warning-colored cards for successful/idle states.
- Support native tab/Enter/Escape, clear focus return to originating action after dialog/sheet close, and keyboard access to all proposed-content details.

## Small, safe implementation sequence after Design Audit

1. **Surface safety (P0):** Bring existing brief Undo into current visible outcome UI; ensure narrow Director no longer reserves up to 45% height for the action rail. No API/schema changes.
2. **Context + forms (P1):** Scope labels, independent source/destination defaults, preservation of user-selected Read fields and Write operation across rail switches; add selected-field count. Test Project A vs B.
3. **Receipt + reviews (P1):** Design-specific compact Read/Apply event presentation; separate request preflight from merely reconstructed preview; consistent dialog headers/field comparison and close focus.
4. **Readiness + taxonomy (P1/P2):** Genuine per-subject identity or explicit unknown scope, one-item full-text detail, distinction from production readiness; separate global Playbook from Project Write operations. Keep underlying operations.
5. **Visual QA:** Real browser screenshots at wide desktop, pinned ~49vw, ~820px, ~730px and mobile; keyboard/scroll/focus audit; actual selected local LLM Read receipt and advisory readiness; regression for Studio, General Chat, editor, Takes and GPU lanes. Stop if a real capability is unverified rather than masking it with status UI.

## Acceptance gates

- **IA-01:** Project brief Undo is reachable from a saved result, works, and doesn't imply Undo for unsupported mutations.
- **IA-02/03:** Project A open / B Read / A Write can be understood from labels without unintended navigation; exact sent field IDs and actual LLM acknowledgment inspectable.
- **IA-04/08:** Two Scenes assessed in one conversation cannot inherit the same misleading Scene ID; no conflation with Take readiness.
- **IA-05/07/09:** No duplicated primary controls, Playbook looks global, and no Writer's Workshop/Story terminology in primary Studio UI.
- **IA-06:** Toggling Read → Write → Read preserves deliberate field selections and draft text.
- **Responsive:** At ≤820px and ≤730px the action interface does not permanently displace the conversation by a fixed strip.
- **Safety:** No automatic reads, hidden LLM receipt substitution, unsaved modifications, new creative fields or queue changes.

## Handoff

The related [illustrative HTML mock](studio-director-design-mock.html) is a **design reference only**, not a production patch, and uses sample Project/Scene names and canned example interactions. Use it to discuss hierarchy and action sequencing; test actual UI separately.

**Recommendation:** Start implementation with **visible Undo + narrow-layout correction**, then clarify context/default preservation. These are the highest-value changes and do not require another architecture layer.
