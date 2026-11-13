# Focused Evaluation ratings — implementation plan

Status: implementation branch `feat/evaluation-focused-dimensions-20261112`.

## Purpose
Use one dimension at a time to finish a queue of Test previews. A saved rating removes that preview from the **pending** queue for that dimension. Overall remains the default. Users may return to a previously rated preview with Back or revisit via Grid.

## Safe phases

1. **Review activity, not a results view.** Replace the Review tab with a button that opens a large native modal. Reuse Test preview cards, 1–5 shortcuts, the existing save route and video controls. Navigate only pending media in the selected Test session. Keep Back for revisions. Save before advancing and show completion; no automatic navigation after a failed save. Keep Grid/Compare/Matrix as true views.
2. **Dimension catalog and per-preview persistence.** Global defaults live with app configuration; additional Set dimensions live with the owning Set's `.webcap_state.json`. Provide simple Add (Set or global) from the Review modal. Use stable dimension IDs. Overall retains the existing `ratings_by_media` storage. Additional dimensions use `ratings_by_dimension` in each Test session's `.webcap_state.json` with atomic patch operations. Never erase historical ratings or rewrite source media. The active dimension is local UI choice.
3. **Central scores.** Compute the unweighted arithmetic mean of the *available ratings for each preview* (Overall and each dimension), then aggregate these per-preview scores into the established candidate/epoch score and Insights. Preserve original Overall ratings and the existing Blind Rate scope; never fold independent VL, Campaign or loss evidence into human ratings. Existing data without dimensions produces exactly its former score.
4. **Tests and integration.** Verify legacy rating preservation, equal-weight scoring, combined score consumers, per-dimension persistence, advancing only after save, completed-state/Back, modal visibility and keyboard focus, and no interference with Grid/Compare/Matrix/Insights Blind Rate. Run relevant CI; browser smoke check separately when a browser runtime is available.

## Design constraints / current code owners
- `AGENTS.md`: minimal native HTML/CSS/JS, file-based persistence, explicit mutation, visible errors and no UI clutter.
- `tool/js/test_generations.js` owns session Review and the existing Test card/rating flow.
- `tool/js/run_analytics.js` owns a different, Set-wide **blind** session and retains that separate workflow.
- `tool/server/epoch_test_bench.py` owns Test preview ratings and candidate aggregation.
- `tool/server/run_analytics.py` owns Insights evidence; use the same combined-score projection there.
- `tool/server/folder_state_store.py` owns atomic folder-state mutations.
- `tool/server/config.py` owns global defaults.

No new database, framework, infrastructure, generated media, or automatic ML assessment is required.
