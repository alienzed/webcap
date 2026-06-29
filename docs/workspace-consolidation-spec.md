# Workspace Consolidation Spec

North Star:

`[ Scope Sidebar ] [ Visual Surface ] [ Shared Workbench ]`

## Phase 1

Create the shared Group Workbench seam and wire Item mode to render groups through it.

- Keep existing checklist state and mutation helpers as the source of truth.
- Render Item-mode groups through one compact shared renderer.
- Keep legacy checklist targets available while the shared renderer takes over the visible Item-mode group list.
- Leave Grid, Focus, Review / Output, Config, backend routes, and broad shell behavior unchanged.

## Phase 1.1

Harden the shared Group Workbench seam before Grid integration.

- Keep Item term toggles scoped to the current item.
- Keep Grid and multi-media term application for Phase 2.
- Refresh visible reviewed and N/A state through the shared renderer.

## Phase 2

Wire Grid selected thumbnails to use the shared Group Workbench.

- Pass multiple selected media keys into the same renderer shape.
- Keep group/term semantics consistent between Item and Grid.
- Avoid changing Grid into a different navigation model during this phase.
- Grid term toggles use explicit media keys instead of current-item annotation helpers.
- Keep Grid as its current modal/separate visual surface until Phase 3.

## Phase 3

Fold Grid into the Visual Surface as a zoom level.

- Treat Item, Grid, and Focus as surface levels rather than separate feature silos.
- Keep the Scope Sidebar and Shared Workbench stable while surface behavior consolidates.

## Phase 4

Stabilization only.

- Remove duplicated rendering paths once shared behavior has proven stable.
- Tighten regressions, naming, keyboard flow, and visual density.
- Avoid new workflow scope unless it fixes a concrete consolidation defect.
