# Set-owned Test and Campaign drafts: implementation plan

Scope: WebCap `AGENTS.md` and `docs/filesystem_state_contract.md`. Source Set state is durable; rendered evidence is disposable only within its owning operation. No new router, queue, data root, or inference behavior.

## Phase 1 — Establish durable ownership (implemented)
- Use Set `.webcap_state.json` for model-keyed, user-authored wildcard templates (`test_workspace_prompts`).
- Migrate old `workspace.json:promptByModel` entries without overwriting newer Set values. Migration merges atomically under the existing folder-state lock; the old file remains intact.
- Keep `campaign.json` and Test `test.json` immutable as the submitted prompt/settings snapshots.

## Phase 2 — Respect deletion boundaries (implemented)
- `test_clear_sessions` deletes ordinary Test sessions, not the whole shared workspace.
- Explicitly exclude sessions with `campaignStaging`; the Epoch Finder / Manual Screening owner still deletes its own campaign and sessions.
- Do not delete Set-owned prompts, form defaults or campaign history when clearing Test history.
- Retain the original active-job checks and snapshot-of-assessments behavior.

## Phase 3 — Persist editable form defaults (implemented)
- Test model settings remain under existing `test_generation_by_model`, with new-only fallbacks of 3-second duration, 0.2 MP, 4:3 where supported. Preserve `wildcardIntent` when restoring Set state.
- Manual Screening saves per-model editable fields/group selection in `test_manual_screening_by_model`, separate from frozen round plans.
- Regular Campaigns save per-model wizard defaults and round-plan inputs in `test_campaign_by_model`, separate from historical Campaign details.
- Each Set-owned draft is written through a focused atomic mutation instead of rewriting unrelated Set fields. Whole-folder saves preserve these owned fields under the same lock.
- All three prompt editors use the existing single debounced Test prompt writer and synchronize their draft values by small explicit module APIs.

## Phase 4 — Verification and acceptance
- Unit tests verify legacy migration, non-clobbering whole-folder saves, and Test clearing that preserves both Campaign-owned session and `epoch-finder/` data.
- Browser checks on a real Set: edit the template in each form; switch tabs; reload; clear all Test history; reopen each form and verify the exact text is retained.
- Model-switch check: confirm independent saved defaults and no cross-model leakage; old frozen session/round settings must remain inspectable.
- Delete a single Campaign and a Manual Screening round; neither action must change the Set template.
- Test defaults must apply only in the absence of per-Set saved preferences.
- A full app/browser test run is required before merge; the connector environment does not provide a checked-out repository or the installed WebCap runtime.

## Deferred/non-goals
- Recovering prompts already physically deleted before this fix (no guaranteed surviving source).
- Overhauling Campaign/Manual Screening IA, queue behavior, or schema.
- Centralizing immutable rendered evidence into Set state.

## Risks
No new user decision is required. Existing old workspace prompt data is retained for backward recovery; a rollback of this code leaves that legacy file unchanged. The exact source Set and old generated outputs must not be removed during rollout.
