# UI Revamp

Status: Planning only. Do not implement as one big jump.

Last updated: 2026-06-22

## Intent

This revamp is not a feature redesign.

It is a container/layout redesign for the feature set we already like.

Rules:

- keep existing capability
- reduce duplicated UI across views
- stop mixing set-level tools with item-level work
- give `Groups` a real home instead of treating it like an overlay

## The Main Correction

The old planning leaned too hard on abstract mode ideas.

The current sharper conclusion is:

- `Groups` are the hard layout problem
- `Groups` need tall vertical space
- `Caption` does not need to dominate the center pane
- `Focused Annotation` is not a side feature anymore
- the future UI should borrow its shell from `Focused Annotation`

## Target Workspace

The app should still feel like a three-area workspace, but with a more deliberate shape:

```text
+-----------------------------------------------------------------------------------+
| Top bar: app/global controls                                                      |
+----------------------+-----------------------------------+------------------------+
| Left rail            | Preview / Grid surface            | Right workspace        |
|                      |                                   |                        |
| path / filters       | large single-item preview         | Groups                 |
| media list           | or media grid                     |                        |
| set scope            |                                   | Caption                |
| set tools            |                                   | Tags                   |
+----------------------+-----------------------------------+------------------------+
```

### Top Bar

Global only:

- home / current path entry
- settings
- help
- theme

Do not keep moving item/set tools into this area.

### Left Rail

This area answers:

- where am I?
- what subset am I looking at?
- which item is selected?

Contents:

- filter
- advanced filters
- result count
- media list
- set/focus scope summary
- set-level tools entry point

This rail should become collapsible.

In working-heavy views, especially `Focused`, it can auto-collapse, but the user's last choice should remain respected whenever practical.

### Preview / Grid Surface

This is the main visual area.

It shows:

- large single-item preview
- or media grid

These are not separate screens. They are two states of the same main surface.

Expected flow:

- double-clicking a grid item returns to single-item view
- switching between grid and single-item view does not replace the whole workspace
- the surrounding annotation UI remains in place

### Right Workspace

This is the heart of the revamp.

It contains three stacked concerns:

1. `Groups`
2. `Caption`
3. `Tags`

#### Caption

The caption editor is important, but it does not need to be the biggest surface in the app.

Placement:

- below `Groups`
- above `Tags`
- modest height

Reason:

- typical caption use is only a few lines
- forcing caption to be the dominant full-height surface caused the overlay problem

#### Tags

Placement:

- bottom of the right workspace
- grows upward

Reason:

- tags are item-level and directly related to captioning
- tags are smaller than groups and should not compete with them for prime height

## Groups Are The Primary Layout Driver

The UI should be designed around the fact that `Groups` can be large, vertically scanned, and numerous.

This means:

- no more treating groups as a small helper overlay
- no more assuming chip-wrapped clouds are an acceptable default
- no more forcing all group interaction into a cramped bottom strip

## Groups Workspace Model

The right workspace keeps one persistent `Groups` area with two modes:

1. `All Groups`
2. `Focused`

This is a local area mode, not a separate app screen.

Changing between `All Groups` and `Focused` should not replace the rest of the workspace.

The mode should persist when moving between:

- list view
- grid view
- single-item preview

unless an explicit action intentionally opens a focused flow.

### Focused Mode

Focused mode stays because it solves a real density problem.

It remains the best surface for:

- working one group deeply
- traversing item/group axes
- using quick picks without noise

The current focused-annotation shell is the closest thing to the new base layout:

- big preview on the left
- tall group workspace on the right
- compact support areas below/right

### All Groups Mode

`All Groups` is still necessary for final review.

The goal is not to eliminate the bird's-eye view. The goal is to make it viable.

#### All Groups Rules

- all groups can be visible at once
- group cards stay vertical
- cards auto-fill based on available width
- cards wrap into additional rows
- no horizontal scrolling
- the overall groups area scrolls vertically
- cards may be squeezed somewhat to preserve bird's-eye visibility

This is intentionally a dense vertical card grid, not a chip cloud and not a horizontal lane system.

#### Group Card Behavior

Each card keeps the current group-level capability, just in a better container.

Each card should support:

- group title
- reviewed / incomplete / n/a state
- current group controls in the header
- expandable/collapsible body
- vertical term list

Terms should remain readable and vertically scannable.

Do not turn the all-groups view into a reduced-capability lite panel.

### Collapse Behavior

Default behavior should help reduce chaos without hiding unfinished work.

Initial direction:

- unfinished groups stay expanded
- reviewed groups may shrink or collapse
- user can manually collapse/expand any group

Required global controls:

- `Collapse All`
- `Expand All`

These are core controls for the all-groups surface, not a stretch goal.

## Metadata And QA

`QA` no longer deserves a prime dedicated area in the main editing workspace.

Current direction:

- remove QA from the primary annotation workspace
- do not design the revamp around keeping it visible

`Metadata` should be reduced, not removed.

Primary metadata surface:

- preview header
- only compact facts such as resolution, rating, maybe one or two other high-value signals

Possible secondary homes later:

- tooltip
- drawer
- expanded inspector

But metadata should stop occupying the same rank as groups/tags/caption.

## Set-Level Tools

The app currently mixes set-level workflows into the left rail because space existed there.

That should become more deliberate.

Set-level tools include:

- Review Captions
- Selection Analysis
- Config
- Train

These should share one clearer home under the left rail, likely as a dedicated `Set Tools` block.

This is still in the left rail, but visually separated from the media navigation/listing job.

## Non-Goals

This revamp does not aim to:

- reinvent annotation behavior
- remove focused annotation
- cut working features the user already relies on
- force a totally different navigation model
- introduce horizontal scrolling for group review

## Likely Implementation Slices

Do not ship this as one giant rewrite.

### Slice 1: Left Rail Clarification

Low-risk structural cleanup:

- make the left rail collapsible
- clean up `Set Tools` below the media list
- give grid/focus entry points a clearer home
- separate navigation/scope from set operations

This slice can ship without finishing the groups redesign.

### Slice 2: Right Workspace Skeleton

Introduce the new right-side hierarchy:

- groups area
- caption area
- tags area

without yet perfecting every group rendering detail.

Main win:

- stop relying on the center overlay stack

### Slice 3: All Groups Layout Rebuild

Rebuild the all-groups presentation as:

- auto-fill vertical card grid
- wrap rows
- vertical scrolling
- collapse/expand behavior

This is the most important interaction redesign in the revamp.

### Slice 4: Focused / All Shared Shell

Unify focused annotation and normal item work so they feel like area modes inside one workspace, not separate screens.

### Slice 5: Metadata Reduction

Move compact metadata into preview header and remove it from prime editing space.

## Short Version

If this document needs one sentence:

> WebCap should move from "caption editor with floating helpers" to "preview-first workspace with a real right-side annotation column."

And inside that annotation column:

- `Groups` are primary
- `Caption` is secondary
- `Tags` are tertiary

That is the current working UI direction.
