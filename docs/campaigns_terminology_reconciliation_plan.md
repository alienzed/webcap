# Epoch Finder terminology reconciliation — Campaigns

Status: implementation plan; changes are limited to presentation copy, with compatibility invariants below. Follow the root [AGENTS.md](../AGENTS.md).

## Problem and codebase findings
The Evaluations tabs in `tool/tool.html` and `surfaceLabels` in `tool/js/epoch_finder.js` already call the feature **Campaigns**. Remaining **Epoch Finder** text leaks through Media Explorer source labels/actions/usage metadata, Storage Manager category/ownership/deletion messages, Campaign jobs and Console/errors, and current README/Insights instructions. The old name also appears in historical design documents and internal contracts.

## Frozen compatibility boundary
Preserve module names (`epoch_finder.py`, `epoch_finder.js`), global functions (`epochFinder*`), DOM/CSS IDs, mode key `finder`, API routes (`/fs/epoch_finder*`), command names, persisted `epoch-finder` paths and `campaignStaging` values, Storage Manager area keys (`epoch_finder`, `epoch_finder_staging`), Media Explorer source key `epoch`, and Director proposal operation/schema/marker. These are identifiers, not visible branding. Preserve deletion ownership, confirmation effects, queued work, historical data and score logic. Historical `docs/epoch_finder_*` files remain historical rather than being rewritten.

## Safe implementation phases
1. **Live UI / navigation / destructive confirmations.** Rename only display text in `tool/js/media_explorer.js`, `tool/server/media_explorer.py`, `tool/js/storage_manager.js`, `tool/server/storage_manager.py`; retain their keys, media routes, ownership restrictions and delete payloads. User-facing name is **Campaigns** for the mode/source/category, **Campaign** for an item.
2. **Queued operations, diagnostics and errors.** Rename visible labels and human-readable error text in `tool/server/epoch_finder.py`, `tool/server/app.py`, `tool/server/epoch_finder_plan.py`, `tool/js/epoch_finder.js`. Use **Evaluations** for the shared frontend request/Console reporting owner, **Campaign** for campaign-specific operations. Keep thread identity, storage names, operation strings, and diagnostic details.
3. **Active docs.** Update `README.md` and `docs/run_analytics.md` to describe **Evaluations → Campaigns / Insights**; keep links and accurate implementation details.
4. **Verification.** Extend the existing Epoch Finder and Media Explorer/Storage Manager tests with checks of visible labels and frozen technical strings; inspect branch diff for accidental changes. Run the focused CI, including the existing Evaluation and storage tests, and report unrelated existing failures separately.

## Risk / decision gate
No product decision required for the textual changes above. Stop only if an encountered string is proven to be an external integration contract or if a test demonstrates a behavior change. Do not rename structural identifiers to achieve a zero-match grep.

## Acceptance
Visible new UI, action labels, errors, Activity/LLM job names and current docs no longer say **Epoch Finder**; historical data and technical API/storage contracts continue to work unchanged.
