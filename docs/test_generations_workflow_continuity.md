# Test Generations workflow continuity — targeted implementation

Date: 2026-10-19. Current base: main. This is **not** a rewrite or relocation project.

## Observed code
- `tool/js/test_generations.js`: original Regular launch, repeated server Batch, Result detail and explicit Activity session routes. `openPane` currently forces `testGenerationsUnifiedNativeRoute` on cold open.
- `tool/js/epoch_finder.js`: native Test/Finder/References/Analytics mode switch, wizard and full live campaign dashboard. The normal Campaign switch calls its mode function directly, even if another workspace is visible.
- `tool/js/test_generations_unified.js`: existing Build/Explore and read-only source gallery; advanced content is mounted from real source DOM without replacing controllers. Its source links deliberately fall back to native views.
- `tool/tool.html`: three overlapping navigations, existing Batch modal launcher beside prompt despite Sessions + Auto VL already present, and separate full-size result/analytics destinations.
- `AGENTS.md`: local changes, controllers retain ownership, no new scheduling/storage, visible failures; do not replace interactive DOM on polling.

## Target (retaining every feature)
1. **One visible Test navigation at a time.** Within the existing unified workspace, use Explore / Build / Analytics. Build has Regular / Campaign and contextual Manage References. Keep native mode switching for explicit compatibility/specialized source review only.
2. **Regular = repeat-capable Test launch.** Original settings, candidate inclusion, Base, sweep and VL remain owned by the original controller. Preserve Batch modal/route as compatibility, but don't advertise an unnecessary second launch action.
3. **Campaign = advanced launch branch.** Enter the real Finder wizard, with all multi-run, checkpoint, reference, rounds, estimates, queue and live dashboard controls intact. Returning to Regular must preserve its draft and selections.
4. **Explore = cross-source index; native review is a destination.** Campaign source should open the real dashboard without changing the root workspace. Test session source keeps its full native review when necessary with an obvious return to Explore. No fake merged assessment store.
5. **Analytics = first-class destination**, using the existing Run Analytics DOM and backend, with source/epoch links intact. References remain one real managed interface, entered contextually, not a second copy.
6. **No deletion cutover without parity:** keep original DOM, selectors, routes and compatibility launch path. No new backend, queue, roots, persistence, automatic scans or migrations.

## Small implementation gates
- Phase 1: route all visible navigation requests through existing unified controller *only when it is active*; native mode stays valid when not active. Correct Campaign, Back to Regular and source-navigation handoffs. Regression test repeated navigation, DOM identity and no simultaneous competing surfaces.
- Phase 2: present a single Explore/Build/Analytics choice and Regular/Campaign inside Build; contextual References; hide only duplicate Test-mode nav and visually retire the Batch *launch button* in the consolidated form. Keep Batch modal callable and Batch summary/results.
- Phase 3: default normal Test entry to the reconciled workspace, preserving direct Activity session/campaign targeting and the full native review fallback. Add explicit way back to Explore after viewing an original source. Preserve Build draft on transition.
- Phase 4: run source-level and real-DOM tests, Test/Batch/Finder/References/Analytics regression, Checkpoint and Activity route tests. Verify runtime behavior not tested by CI with real WebCap later. No feature removal as a substitute for correctness.

Acceptance journeys: Regular single + repetition + Auto VL; Regular→Campaign wizard→live campaign→Explore; Explore→session native review→Explore; Explore→campaign dashboard→Analytics→epoch evidence; contextual reference management→return to Build. Failure must reach global Console.
