# Epoch-collection Focused Review — safe implementation plan

Status: implementation branch `feat/epoch-collection-focused-review-20261112`.

## Goal
Offer the existing **Focused Review** activity from a selected epoch's generated-results collection in Evaluation → Insights. Review only its attributable, available Test renders across sessions, one dimension at a time. Save every rating back to its native Test session; preserve central candidate and Insights scoring. Do not reinterpret Campaign frame assessment as manual Test ratings.

## Phase 1 — source contract
- Reuse `epoch_finder.checkpoint_workspace` (the existing exact job+epoch provenance filter). Expose each visible Test render's `dimensionRatings` alongside its `rating`, `wildcards`, native session, settings and media availability. No new storage or route.
- Explicitly count/explain Campaign-only and unavailable previews. Never invent a Test session for Campaign frames.

## Phase 2 — focused activity
- Add one **Focused Review** action to the epoch gallery header and invoke a small explicit entrypoint from the Test Generations owner, passing its Set, run and epoch.
- On demand only, page the exact epoch's recorded metadata (not media blobs). Adapt the existing Focused Review modal/navigation/1–5 shortcuts to a collection-scoped list with stable session+file identity.
- Reuse the established `test_rate_result` persistence route with the source Test session and correct Set. Advance only after a confirmed save; errors remain visible; Back and Revisit Rated remain available. Keep the dimension catalog and changes Set-scoped.
- Preserve wildcard chips per render. Keep session-only Ask VL controls out of the mixed-session review card, avoiding incorrect session attribution. Campaign frames remain inspectable in the gallery, not falsely rateable in this activity.

## Phase 3 — integration / regression
- Refresh epoch gallery rating labels when closing the focused activity.
- Cover dimension read projection, multi-session identity, correct Set/session save, pagination, campaign-only and unavailable boundaries, no eager media loading, failure/no advancement, and existing Test session Focused Review parity.
- Follow `AGENTS.md`: native plain JS; one feature owns its UI; explicit inter-feature call rather than DOM reach-through; no new infrastructure or background work.
