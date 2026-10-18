# Media Explorer exact provenance and owner handoff

Guided by root `AGENTS.md` and the existing owner-backed Media Explorer contract.

## Phase 1 — Preserve owner identity (implemented)
- Generate: saved result storage ID; references retain their using generation identity.
- Test Generations: exact owner Set folder and session.
- Epoch Finder: exact owner Set folder and campaign.
- Storyboard: exact story, scene, and (where applicable) take ID; reused media retains distinct scene uses.
- Do not infer relationships from filenames or use a parallel global index.

## Phase 2 — Navigation (implemented for Storyboard takes)
- Pass recorded story/scene/take provenance through Explorer's usage links.
- Storyboard opens the exact scene and focuses the targeted take if present.
- Scene-only references navigate to the scene without fabricating a take.
- Missing or hidden targets report errors; do not silently substitute another take.

## Phase 3 — Deletion contract (existing and retained)
- Generate result, Test session, Epoch campaign: confirm then invoke owner deletion action.
- Storyboard and shared references: hand off to their precise owning workflow. Storyboard's reference-protection and delete-take logic remain authoritative.
- Training Set media remains excluded; no filesystem-level Explorer delete.

## Verification / pending checks
- Static code review and focused contract assertion added.
- Run focused JS/Python tests and real browser story→scene→take navigation on completed Storyboard media; specifically verify removed takes, shared references, and scene focus timing.
- Test missing scene/take error paths and existing owner-delete confirmation in browser.
- No filesystem migration or new persistent metadata needed.
