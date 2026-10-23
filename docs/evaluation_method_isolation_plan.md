# Evaluation method isolation — audit and phased implementation

Scope: the existing Prompt Tests / Manual Screening / Campaigns Evaluation workspace; follow `AGENTS.md`. Preserve all existing routes, active queue work, historic sessions, campaign manifests, references, ratings, and Test functionality. Keep the shared `epoch_finder.py` worker, `epoch_finder.js` rendering/card primitives, and Set-owned form defaults. Do not migrate or rewrite saved campaigns.

## Audit findings
1. **Shared ephemeral selection:** `activeCampaign`, `runEpochSelections`, `sourceMode`, and Test LoRA selections were reused across Manual Screening and Campaigns; entering another method cleared the previous selection, and screening selection could overwrite Campaign draft choices.
2. **Two competing mode owners:** the visible Evaluation method tab and an invisible `#epoch-finder-campaign-type` dropdown both determined which form and operation was active.
3. **Async response ownership:** campaign status fetches checked campaign ID and Set but not the selected method or model; stale responses could draw another method's evidence. History list polling had stronger existing guards.
4. **Correct shared ownership:** `campaign.json` stores an explicit `mode`, frozen plans and units. `list_campaigns()` now returns it; action routing and deletion are mode-aware. Do not fork storage, inference jobs, queue scheduling, render components or scoring.

## Phase 1 — Method-owned navigation and in-memory selection
- Store independent active history IDs, run/epoch selection, staged LoRA choices, and Manual Screening round position for each method.
- Snapshot on method exit, restore on return; reset both on Set/model changes.
- Preserve Campaign reference selections while screening changes its own epoch scope.
- Keep explicit campaign drill-down working without assigning that campaign ID to the other method.

## Phase 2 — One mode owner and safe refreshing
- Derive form and action guards from visible Evaluation method tabs; remove obsolete hidden type selector.
- Ignore status responses after mode, model, Set or active history change.
- Refresh only history entries matching the active model and method; preserve existing historical manifests without conversions.
- Preserve direct Insights/Training/Tests navigation, queued screening rounds and selected evidence.

## Phase 3 — Regression coverage, audit, merge
- Exercise method switching and return, independent epoch/reference choices, and stale status responses in Node tests.
- Retain existing Manual Screening round/history tests and Evaluation UI parity tests.
- Audit diff against `AGENTS.md`, run GitHub CI, address regressions, then merge.
- Test manually after deployment: switch methods while running a screening round, return to its rounds, and confirm Campaign draft/reference selections survive.

**No behavior changes intended** for LoRA inference, worker scheduling, historical ratings, saved plans, delete actions, or generated output ownership.
