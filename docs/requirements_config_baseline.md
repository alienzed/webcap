# Requirements Baseline From Config (With Global Pin)

Last updated: 2026-06-02

## Goal

Reduce friction when starting new sets by making requirement groups/terms come from `config.json` defaults (with constants fallback), while preserving per-set local behavior.

This keeps onboarding fast without forcing global auto-expansion.

## Scope Implemented

1. Config-backed requirement defaults:
- Runtime defaults for requirement groups and requirement keyword terms now read from `APP_CONFIG.requirements`.
- If `requirements` is missing or empty, the app should re-prime the built-in defaults.
- Fallback to code constants remains in place when config keys are missing.

2. Copy-on-write set behavior:
- If folder state already has `caption_requirements`, those local group labels are used.
- For requirement-group terms, effective runtime terms are now the additive union of:
  - local `caption_requirement_keywords`
  - current global `config.requirements.keywordsByItem`
- Global terms always appear; local state no longer suppresses newer pinned/global terms.
- Ordering is alphabetical after merge.
- Folder state is still written only by existing save flows (no extra eager write path was added).

3. Global-searchable terms:
- Config requirement keyword terms are now part of the shared catalog term search pool.

4. Global pin/unpin in Group Terms modal:
- In `Edit Requirement Terms`, each term row now has a pin toggle.
- Pin writes term into `config.requirements.keywordsByItem[<group>]`.
- Unpin removes term from that config group.
- Changes are deduped and alphabetically normalized for term lists.
- Config writes are lazy (only when actual config content changes).

5. Reset surface:
- A Settings-level `Reset App` action should restore stock requirement defaults and clear custom global requirement terms.
- The reset is explicit and destructive; it is the escape hatch for “I want the shipped defaults back.”

## Data Shape

`config.json` / `config.example.json` supports:

```json
{
  "requirements": {
    "items": ["Position", "Viewpoint"],
    "keywordsByItem": {
      "Position": "standing, sitting",
      "Viewpoint": "front view, side view"
    }
  }
}
```

Notes:
- `items` drives baseline requirement group labels for new/missing set state.
- `keywordsByItem` stores the editable global baseline for requirement-group terms.
- Missing keys fall back to constants.
- If `requirements` is empty or absent, the app re-primes the built-in defaults.
- `Reset App` restores the stock requirements block, including the built-in terms.

## UX Notes

1. Group-term modal:
- Pin icon (`📌`) indicates global config membership for that group-term.
- Tooltip:
  - pinned: `Unpin from global config terms`
  - unpinned: `Pin to global config terms`

2. Search results:
- Terms found from global config requirement keywords are labeled with `G`.

## File-Level Changes

1. `tool/js/constants.js`
- Added config-first helpers:
  - `getDefaultRequirementItems()`
  - `getDefaultRequirementKeywordsByItem()`
- Added shared normalization helper:
  - `normalizeRequirementDefaultsItemLabel(...)`

2. `tool/js/checklist.js`
- Requirement defaults now use `getDefaultRequirementItems()` and `getDefaultRequirementKeywordsByItem()`.
- Added config requirement catalog extraction:
  - `getConfigRequirementKeywordsByItemMap()`
  - `getConfigRequirementKeywordCatalogTerms()`
- Added pin state + config mutation:
  - `isChecklistGroupTermPinnedGlobally(...)`
  - `saveChecklistGlobalTermPin(...)`
- Group terms modal now renders pin toggle per term row.
- Group terms search now includes config requirement keywords and marks global matches.

3. `tool/js/caption_helpers.js`
- `getConfigVocabularyTerms()` now also includes `config.requirements.keywordsByItem` terms.

4. `tool/js/folder_state.js`
- Sanitization and primer-default mapping fallback now resolve requirement defaults from config-first helpers.

5. `tool/js/item_details.js`
- Requirement progress fallback terms now use config-first helper map.

6. `tool/css/styles.css`
- Added styles for pin button active/inactive state.
- Added style for global (`G`) search-result badge.

7. `tool/config.example.json`
- Added `requirements.items` and `requirements.keywordsByItem` baseline section.

## Non-Goals (Intentionally Not Implemented)

1. Cross-set usage thresholds or auto-promotion logic.
2. Global-term migration wizard for old sets.
3. Forced overwrite/import into existing folder state.

## Validation Checklist

1. New set (no requirement state):
- Requirements/groups should reflect `config.requirements.items`.
- Group terms should reflect `config.requirements.keywordsByItem`.

2. Existing set (has requirement state):
- Existing local groups remain unchanged.
- Existing local terms remain, but current global terms are merged in and always appear.

3. Pin flow:
- Pin a term in group modal.
- Verify term appears in `config.json` under the matching requirement group.
- Restart/reload app and confirm term is still searchable.

4. Unpin flow:
- Unpin a pinned term.
- Verify term is removed from matching config group term list.

5. Search:
- Group-term search should include config requirement terms and show `G` badge for global terms.

6. Reset:
- Reset App should restore the default requirements block and remove custom global term additions.
- After reset, a fresh set should see the stock baseline again without carrying over prior custom terms.
