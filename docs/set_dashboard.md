# Set Dashboard

## Product contract

A focused, on-demand modal for the **current Set**. Answer one question: **What should I do next?** It is not a project tracker, a mandatory wizard, a replacement for existing editors, or another QA report.

## Interaction

- Five freely navigable tabs, in preparation order: **Guidance · Understand · Annotate · Caption · Review**. Training remains in its own workspace, outside this dashboard.
- **Auto-select the earliest unfinished, useful stage on every open.** The user's manual tab selection remains stable while the modal is open. Reevaluate on the next open; never bounce a user to another screen or auto-advance after completing work.
- Show **exactly one prominent next action** per tab, and **at most one secondary action** where it genuinely matters. Specialized tools continue to exist in their owning workspaces; do not turn the dashboard into a legacy-tool directory.
- Tabs may each indicate work remaining; this is informational, not a forced sequence. Preparation stages may overlap. Progress should not imply that captions or an entire stage are certified.
- The recommendation uses prominent, action-oriented text with one clear CTA. Avoid redundant small explanations, but do not remove meaningful large-format guidance.
- Show concise, honest progress from existing evidence: caption coverage, saved Sight observations (not verified Set-wide freshness), and reviewed annotation group assignments. Do not present a universal readiness percentage, imply QA certification, or create new persisted status.
- When a recommendation opens a scope-sensitive tool, the count and message must reflect what that tool can act on. Clearly distinguish Set-wide totals from the current filtered view.
- Keep genuine blockers or errors visibly readable; optional low-value explanations may live in contextual help.
- Only explicit button clicks may start a scan, an LLM call, a job, or a workflow. Opening or switching dashboard tabs performs no inference or mutations.

## Guidance ownership

- **Required key phrase** and **balance terms** are strongly recommended but optional; missing either should be the Guidance tab's primary recommendation, in that order. Do not block navigation or other tools because they are absent.
- Show the existing Set-owned controls, preserving the existing save and reporting semantics; no competing persisted fields.
- The **Caption Template** remains a meaningful Guidance step; expose an obvious way to edit the actual existing template, without making it mandatory or inventing a separate copy.
- QA report-only rules remain in QA.

## Tab destinations

| Tab | Primary intention | Optional secondary |
| --- | --- | --- |
| Guidance | Set key phrase, then balance terms, then existing caption template | Template or the other Guidance field |
| Understand | Prepare Set / inspect saved Sight | Discover Vocabulary |
| Annotate | Continue Focused Annotation where group review remains | Guided Tagging |
| Caption | Continue Focused Caption on media with missing captions | Edit Caption Template |
| Review | Open Quality Assurance and existing Deep QA/review findings | Caption Report |

A destination uses the existing feature's own navigation, scope, safeguards and persistence. Do not duplicate its workflow.

## Evidence and runtime

- Read only the current loaded Set's state on demand: caption presence, required phrase, balance phrases, group reviews, and saved Sight metadata. Distinguish partial/unknown from verified complete.
- Reuse Set-owned Sight and QA information. Saved Sight can be model-scoped; do not claim a Set-wide up-to-date scan simply because one item contains observations. Incomplete Sight is a reason to inspect Prepare Set.
- Deep QA is **not** a default recommendation on fresh or barely captioned Sets. Existing saved findings remain accessible through QA; do not invent dashboard-side QA findings or freshness checks.
- Active Training and other runtime work must not be represented as immediately launchable GPU work. Show a visible reason and offer an appropriate read-only/manual action; existing queues remain authoritative.
- The dashboard must not create a global registry, new file persistence, app-wide Set scanner, background poller, or cleanup obligations when Sets are deleted.

## Navigation and acceptance

1. Opening a fresh Set selects Guidance; missing required phrase is the only prominent action. Entering it makes balance terms the next Guidance recommendation without forcing tab changes.
2. Missing balance terms gets its own recommendation; neither missing field gates other tabs.
3. After guidance, recommend Prepare Set if no usable Sight is evident. Support existing partial/retry behavior.
4. With usable Sight and outstanding group reviews, offer focused annotation; an already mature Set can skip ahead to captions or QA.
5. With missing captions, offer captioning. Review is available independently but never presented as a per-item certification.
6. In an active Training session, don't offer an immediate GPU scan; allow manual editing/review. User navigation and current drafts must be preserved.
7. Switching Sets while open must not leak stale recommendations, edits, or async responses. No automatic return from QA/Focus Set or unrelated changes to QA navigation in this feature.
8. Maintain readable type at standard zoom, focus management, Escape and close behavior, and accessible tab/button labels.

## Implementation scope

Implement a small read-only recommendation layer and reuse the live fields, existing entry points, and existing autosave. Keep the former tool actions available in their normal workspaces; minimize UI duplication. QA focus-set return navigation is a separate issue and is explicitly deferred.
