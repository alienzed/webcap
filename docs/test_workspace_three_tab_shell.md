# Test workspace: persistent three-tab shell (2026-10-19)

**Scope**: Restore the original familiar Test, Campaign and Analytics working areas under one permanently mounted three-tab control in the left sidebar. No other redesign.

## Verified starting point
- `tool/tool.html`: original full Test left form/results split, original Finder wizard/sidebar and dashboard split, original Analytics sidebar/dashboard split, separate References screen. Experimental `test-unified-workspace` adds unrelated Explore/Build navigation.
- `tool/js/epoch_finder.js::showMode`: already owns switching among native tests/finder/references/analytics and initiating the necessary feature refresh. Reuse it rather than another navigation owner.
- `tool/js/test_generations.js`: original launch uses 1–20 inline Sessions and Auto VL via server Batch; old detailed Batch dialog still exists for compatibility.
- `tool/js/run_analytics.js`: Analytics already exposes run selection and full results/epoch-media dialog.

## Implementation phases (all in this PR)
1. **Permanent navigation**: place exactly one Tests / Campaigns / Analytics tab control directly under the Test pane (not inside individual screens). Route clicks through existing `epochFinderShowMode`; keep active selection synchronized when controllers navigate programmatically. Hide redundant old pane switchers and experimental Explore/Build entry by default.
2. **Original native surfaces**: keep original left forms, sessions/candidates and right Test previews intact; keep original left Finder wizard and right campaign dashboard intact; keep Analytics run selection left and existing reports right. CSS only adapts the three native 2-column layouts to shared WQHD sidebar width and leaves right untouched. No DOM moving or re-creation of tabs.
3. **References and deep links**: retain real References picker via a contextual link from Campaigns, with an explicit back link; preserve direct session/campaign/epoch navigation and the legacy gallery API for compatibility.
4. **Regression gates**: static parity, real DOM (jsdom) verifies tab identity and three destinations without re-creating controls, tests for native controllers, Test/Batch/Finder/Analytics CI; only merge after green.

## Out of scope
Consolidated epoch evidence inspector; analytics UX redesign; new launch APIs, batch executor or state, storage, queue/GPU behavior, migrating or deleting historical evidence, change to native preview/ratings/evaluation logic.

## Acceptance
On opening Test Generations, three compact tabs at top of **left** rail; Tests is the natural default and shows original full form directly below and native results right. Campaigns shows wizard and campaigns left, live dashboard/media right; Analytics shows its original controls left and reports right. Tabs stay the **same DOM elements** through switching. No redundant Explore/Build / giant header / row of independent workflow buttons. References remains reachable with back navigation. Returning preserves running work and draft where controllers already preserve it. No automated test or scan on navigation.
