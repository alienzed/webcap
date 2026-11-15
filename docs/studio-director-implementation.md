# Studio Director — implementation and acceptance

[Functional contract](studio-director-contract.md) is authoritative. This file tracks the three-operation implementation and evidence; it does not define a competing architecture. The earlier incremental plans and audits from November 14 were superseded by the three-operation cutover in PR #950. Consult the PR history for original gap analyses.

## Implementation at the #950 handoff (2026-11-14)

Branch: `codex/studio-director-three-operations`. The implementation is code-complete for its scoped flow and has passed the focused GitHub Actions checks; real-browser/selected-model acceptance is **not recorded as passed**. Do not infer production reliability from mocked regression tests.

| Operation or boundary | Code state | Verification still useful |
| --- | --- | --- |
| **Read / conversation** | Fresh selected or explicitly resolved saved Project/Scene fields accompany a bounded conversation. Plain prose works, even without optional action metadata. No acknowledgment-only model call or automatic mutation. | Real model answers a saved Project/Scene question without cross-Project leakage |
| **Write Project** | One Project writer uses saved state, structured working fields, and existing reviewed/conflict-aware save routes. Unmentioned fields persist. | Create and revise; inspect persisted fields and unaffected Scenes |
| **Write Scene(s)** | One per-Scene writer serves creation, revision, and new Project initial Scenes. Targets are WebCap-bound; request carries full relevant Prompt plus requested changes. Title-only updates need no creative call. | New and revised Scenes with specified title/duration, including written-out durations |
| **Multiple Scenes** | Sequential bounded writes retain earlier saves on isolated failure, report saved/failed/not-attempted, and stop for cancellation or shared dependency errors. | Inject an isolated failure, then verify the next target and exact receipts |
| **Working drafts and context economy** | Structured complete fields persist separately from chat and survive ordinary follow-ups/session restoration. Bounded discussion and relevant saved/working fields replace whole-transcript replay and duplicated prompt receipts. | Follow up, reload, then apply already authored material without a redundant model call |
| **Recovery and integrity** | Real IDs, explicit destinations, optimistic save conflicts, existing Undo/Redo, and distinct post-save reporting errors are retained. Invalid optional data cannot erase usable independent results. | Conflict, failed save vs. failed refresh, and recovery in real UI |

### Best effort is not all-or-nothing

LLM output can be useful even when its wrapper, action hint, rationale, title or duration metadata is wrong or absent. Preserve valid fields, prose, editable drafts and previously saved Scenes. Validate only what the specific operation needs to save or execute. If a requested duration cannot run, retain its Prompt for correction rather than silently substituting an unrelated value. Do not add a grading model, repair loop, speculative guard or alternative writer system. Refer to `AGENTS.md` for repository-wide guidance.

### Remaining boundaries, not release claims

- Historical Workshop, advanced Read, readiness/capture, and other legacy helpers still exist in places. Their **active caller status must be checked** before deleting them. Their presence does not mean they remain the authoritative Studio Director path.
- Independent Revise & Generate and Check Coherence utilities remain separate; their distinct functions should not be removed as Director cleanup.
- Model adherence, UI correctness, and complete end-to-end creative preservation require real-browser/selected-model checks. Passing CI is evidence for deterministic logic, not a guarantee about model behavior.
- README describes the intended merged behavior after #950; older releases still expose their older workflow.

## Focused acceptance checklist

1. **Read:** Ask for exact saved Project title and selected Scene constraints. Confirm the current Project/Scene is used, answer is visible, no write occurs and one conversation model call is made.
2. **Write Project:** Create then revise Project fields. Inspect actual persisted values, unrelated fields and existing Scenes.
3. **Write Scenes:** Create a Scene with a nondefault duration, revise a different selected Scene, and verify full Prompt, title, duration and target. Confirm unsupported duration preserves the draft for correction.
4. **Working draft:** Request material, ask a follow-up, restore the conversation, then apply previously completed structured material without regenerating it.
5. **Partial work:** Fail one Scene in a multi-Scene request; verify earlier success, later attempts where safe, cancellation and truthful saved/failed/not-attempted reporting.
6. **Recovery:** Exercise explicit target ambiguity, concurrent edit conflict, Undo/Redo, and a successful save followed by a refresh or receipt failure.
7. **Model variations:** Verify a plain-text Read response, malformed optional action/metadata, and a partial structured draft still leave all usable output available.

Log selected model, source commit, request/response, persisted effects and any concrete failure. Fix demonstrated failures locally; do not invent additional gates to handle hypothetical mistakes.

## Evidence and ownership

- Prior browser acceptance found a correct plain-text Read rejected by a mandatory response wrapper, and non-default duration lost on a Scene. These failures motivated #949 and the #950 cutover.
- #950's focused tests cover plain-text Read, optional malformed action, correct target binding, sparse working-draft fields, persisted draft reuse, worded duration, incremental Scene results and save receipts. The missing optional `reply` case also has a focused regression.
- The #950 head was checked against GitHub Actions before merging; all seven reported workflows passed at `997e263f4c0b08fbe261d4e052e0a530d12a3944`. Documentation-only commits came afterward and require their own check status.
- No real-browser/model acceptance was executed in this session. Record it separately rather than rewriting this file as though it happened.

The stable source of truth is the actual saved Project/Scene state and execution receipts, not chat claims, readiness scoring or the model's creative self-assessment.

## Orphan cleanup and remaining callers (2026-11-14)

The current Studio Director implementation is the three-operation Read, Write Project and Write Scene(s) handoff. The follow-up orphan audit made these bounded changes on `cleanup/studio-director-orphans`:

1. **Confirmed inert UI:** deleted the hidden readiness/creative-assessment panel, its unused dialog and no-op presentation bridge. The existing I/O inspector still shows raw and parsed responses; it no longer offers the retired `readiness.capture` review button that only led to a dead-end notice.
2. **Retired guideline proposal:** deleted the permanently hidden Story-guideline proposal button, its single event caller, local proposal/parse/review functions and its dedicated LLM operation/schema. Saved legacy guidelines and other Storyboard guideline tools remain unchanged.
3. **Conversation compatibility:** stopped feeding historical readiness metadata to an inert UI, but preserved old chat records and `readiness` serialization/validation. No migration, bulk history rewrite or new gate was added.
4. **Focused coverage:** removed the retired operation from route tests and added regression checks that the obsolete UI/actions are gone while I/O and the active Write/Scene review controls remain.

**Retained deliberately:** the explicit legacy Read panel is hidden but still has working bindings, an outbound bridge and compatibility tests; the timed-shot Workshop has a callable frontend event path and possible restored-session context; the old Scene/sequence preparation paths still have call sites in the bridge. Delete these only in a separately verified caller-migration phase, not by removing markup and leaving event handlers broken. The active Project/Scene writers, current Scene review, multi-Scene incremental saves, Check Coherence and Revise & Generate remain in place.

**Acceptance:** focused CI validates code/contracts and avoids claiming real-model acceptance. Inspect a restored legacy Studio conversation and the current Write/Scene flow in a browser before claiming full UI acceptance. This cleanup does not change normal model calls, save semantics, Project identity, Undo/Redo or generation.
