# Workspace Shell Architecture Audit

**Status:** Current-code UX/DOM audit. Discussion and planning only; no implementation is authorized by this document.

**Audit date:** 2026-09-18

## Purpose

WebCap's individual feature surfaces are generally working well. The current UX friction is increasingly architectural rather than local: the app changes layout, hides or reparents shared UI, opens feature-specific overlays, and uses several independent navigation/state systems depending on which surface is active.

This note records the current DOM/layout model and its weaknesses before any redesign is proposed.

The goal is **not** to redesign Captioning, Review, Training, Test Bench, Media Grid, Focused Annotation, or their internal layouts. Most of those screens should remain substantially as they are. The useful question is whether a small number of truly permanent application areas can make those otherwise-good screens feel like parts of the same application.

A related product observation is important: **Test Bench is not inherently a Training-only feature.** Testing an arbitrary folder of LoRAs is a valid workflow regardless of how those LoRAs were created. Its current entry/storage relationship with Training reflects implementation history more than a necessary product boundary.

---

## Current Shell / Surface Inventory

The nominal shell in `tool/tool.html` is a three-column application:

1. `#sidebar-panel`
2. `.preview-panel`
3. `.workbench-panel`

In practice, feature surfaces reuse, hide, replace, or span those regions differently.

| Experience | Current DOM home | Shell behavior |
| --- | --- | --- |
| Caption / Single | sidebar + preview + workbench | Native three-column shell |
| Caption / Grid | `#media-grid-surface` inside `.preview-panel` plus shared workbench | Sidebar hidden |
| Caption / Focus | preview plus `#focused-annotation-workbench` | Sidebar hidden; normal groups swapped out |
| Review | `#review-output-surface` in preview plus `#review-detail-surface` in workbench | Workbench top hidden |
| Training / Set | `#training-navigator` in preview plus reused `.editor-surface` in workbench | Sidebar remains |
| Training / Global | same Training DOM | Sidebar hidden |
| Test Bench | dynamically appended into `.editor-surface` | Special CSS hides sidebar, preview, workbench top, and side stack |
| Candidate Analysis | `#training-candidates-modal` under workspace overlays | Modal over current workspace |
| Bucket Review | `#training-review-modal` under workspace overlays | Modal over current workspace |

The problem is therefore not that WebCap lacks useful layouts. It is that **there is no single DOM region whose meaning is "the current workspace."**

---

## Current Navigation / State Model

Several overlapping state systems currently describe what the user is doing.

### Workspace shell state

`tool/js/workspace_shell.js` maintains:

- `workspaceState.surface`
  - `default`
  - `grid`
  - `focus`
  - `reviewOutput`
  - `training`
  - `configEditor`
- `workspaceState.previousSurface`
- `workspaceState.sidebarHidden`

### View/workflow state

Separately, `workspaceUiState` tracks:

- `viewMode`
  - `single`
  - `grid`
  - `focus`
- `workflowMode`
  - `select`
  - `annotate`
  - `review`

`setWorkspaceSurface()` also mutates `viewMode`, so `surface` and `viewMode` partially duplicate one another.

### Feature-owned state

Additional navigation state exists inside individual features:

- Training:
  - `entryMode` (`set` / `global`)
  - `detailTab` (`items` / `config` / `run-log`)
  - candidate modal state
  - bucket-review modal state
- Review:
  - independent detail-tab state
- Media Grid:
  - captures/restores its own previous workspace state
- Focused Annotation:
  - uses the shell's previous-surface behavior
- Test Bench:
  - is not represented by `workspaceState.surface`
  - uses `test-generations-workspace-open` plus direct DOM insertion/hiding instead

The result is that **"Back", "open", "close", and "restore previous layout" do not have one architectural meaning.**

---

## Findings

### 1. Global UI is structurally owned by a hideable feature rail

The utility bar, status bar, and console toggle live inside `#sidebar-panel`.

That sidebar is hidden in several legitimate workflows:

- Media Grid
- Focused Annotation
- global Training
- Test Bench

Therefore the more immersive a workspace becomes, the more likely it is to remove application-level navigation and status.

This is the clearest explanation for the recent loss of status/console access across multiple surfaces.

**The auto-hiding media rail is not itself the problem.** The problem is that the media rail currently owns things that are conceptually global.

### 2. The console is nomadic instead of global

`syncConsolePanelHost()` reparents `#console-panel` between:

- `.preview-panel`
- `.editor-surface`

depending on the current workspace surface.

This makes a conceptually global execution/status surface dependent on whichever feature currently owns its parent container.

It also means a surface that hides that parent can effectively hide the console even though the underlying operation still matters.

A global console should not need to know which feature container it is currently mounted inside.

### 3. Multiple navigation state machines overlap

The app currently combines:

- workspace surface
- workspace view mode
- workflow mode
- previous surface
- sidebar-hidden state
- Training entry mode
- Training detail tabs
- Review detail tabs
- Media Grid previous-state capture
- Focused Annotation navigation state
- Test Bench takeover state
- modal-open states

Each system makes sense locally, but together they create a brittle global navigation model.

This is a major source of the feeling that the UI "teleports" instead of navigating through stable application space.

### 4. `surface` and `viewMode` partially describe the same thing

Both systems contain Grid and Focus concepts.

`setWorkspaceSurface()` then forces a corresponding view mode:

- Grid -> `grid`
- Focus -> `focus`
- everything else -> `single`

This is evidence of two generations of UI architecture overlapping rather than one clean hierarchy.

Review and Training are treated as "surfaces" but implicitly as `single` views, while Grid and Focus are both surfaces and views.

### 5. Major DOM containers have lost stable semantic meaning

`.preview-panel` currently hosts or can host:

- normal media preview
- Media Grid
- Review output
- Training navigator
- console

`.editor-surface` currently hosts or can host:

- caption editor
- Training Items
- config editing
- Training run log
- Test Bench

Once a container stops having a stable semantic role, every new feature must know which previous occupants to hide.

This is a structural reason for the increasing number of feature-specific visibility rules.

### 6. Major workspaces do not have explicit roots

There is no single DOM root that cleanly represents all of:

- Review
- Training
- Test Bench

Review is split across preview/workbench regions.

Training is split across preview/workbench regions and reuses the caption editor surface.

Test Bench is mounted under `.editor-surface` and then visually expands itself by hiding unrelated ancestors/siblings.

The layouts themselves can be good while still lacking a coherent workspace ownership model.

### 7. Visibility rules have become an informal layout API

The app currently relies on combinations of:

- `.hidden`
- direct `style.display`
- `.sidebar-hidden`
- `.left-rail-collapsed`
- `.workbench-rail-collapsed`
- `workspace-surface-*`
- `workspace-view-*`
- workflow classes
- feature-specific hidden states
- Test Bench `!important` takeover CSS

No individual technique is inherently wrong.

The weakness is that different features use different mechanisms to perform equivalent layout transitions. That increases the chance of regressions where unrelated UI unexpectedly disappears or survives.

### 8. Set/context identity has no permanent application location

Context is currently communicated differently depending on the active surface:

- Captioning: folder/media rail
- Review: its own folder/visible/scope summary
- Training: navigator title/folder
- Test Bench: session and test context

When the media rail disappears, the underlying set context disappears with it and each workspace recreates enough identity to remain understandable.

This contributes to the perception that each feature is a separate application.

### 9. Workspace navigation and set actions are mixed together

Current navigation entry points include:

- `Review` under the sidebar's **Set Workspace**
- set-specific `Train` under **Set Workspace**
- global Training in the utility bar
- Test Bench from the Training lifecycle
- Test Bench conditionally in the utility bar
- Candidate Analysis from Training history/queue
- various Back/Close controls within individual surfaces

These all navigate somewhere, but they do not belong to a consistent navigation tier.

Test Bench especially exposes the mismatch because it is increasingly a valid standalone activity rather than merely the final step of Training.

### 10. Some modals are true modals; others are displaced workspaces/details

Clearly modal interactions include things such as:

- Crop
- fullscreen media viewing
- destructive/confirmatory choices
- arguably App Settings

Candidate Analysis is more questionable.

It includes:

- substantial charting
- algorithm choice
- smoothing controls
- Y-range controls
- fullscreen
- run-folder navigation
- candidate actions

This behaves more like a persistent analysis/detail surface than a blocking dialog.

Bucket Review is more genuinely modal because it has a draft/adjust/Done interaction, although it may still eventually fit better as a Training subview.

The useful audit question for every modal is:

> Does this interaction actually block the user's ability to continue elsewhere?

If not, modal placement should be considered suspicious.

### 11. Overlay management shows retrofit pressure

`rebuildUnifiedWorkspaceShell()` moves a hand-selected collection of modal nodes into `#workspace-overlays`.

Other dialogs remain top-level.

Focused Annotation also contains a hard-coded inventory of nested modal IDs to determine whether keyboard/navigation behavior should be suppressed.

A feature having to know the global list of unrelated dialogs is a sign that overlay ownership is not centralized.

### 12. Background activity and foreground workspace are not cleanly separated

Training and Test Bench can correctly continue in the background.

However, their status/navigation affordances currently live in UI that some foreground workspaces hide.

The process model underneath is already largely correct: background work can outlive the screen that launched it.

The shell does not yet consistently express that distinction.

### 13. Status is fragmented into local and global-looking channels

The app contains several status concepts:

- sidebar `#status`
- general `#console-panel`
- Training command status
- Training run-log console
- Media Grid status
- Test Bench status/error
- various local operation messages

Some of these should remain local. For example, a Training `run.log` is an artifact and should not be confused with the general app console.

The weakness is that there is no explicit architectural distinction between:

- **global application/operation feedback**
- **workspace-local feedback**
- **artifact/log content**

This makes it easy for important status to disappear with navigation.

### 14. Test Bench is now the clearest workspace exception

`workspace_shell.css` explicitly describes the current behavior as:

> Test Generations temporarily owns the full workspace.

That was an appropriate implementation strategy while the feature was being established.

It is now a poor description of the product concept.

Test Bench has:

- its own persistent controls
- background execution
- sessions/history
- results
- Compare
- independent navigation/status
- a valid future use case with arbitrary LoRA folders

Yet it is not represented in `normalizeWorkspaceSurface()`.

Visually Test Bench becomes the application while the underlying workspace state still describes something else.

### 15. The shell knows too much about individual features

`syncWorkspaceSurfaceUi()` currently understands details such as:

- Review surfaces
- Review Back behavior
- Training entry modes
- Training detail tabs
- config editing
- Training runner output
- sidebar visibility
- console placement
- file-list refresh
- workbench-rail behavior

This makes the shell a coordinator for feature internals rather than a stable frame that mounts workspaces.

Every substantial new feature therefore tends to require another special branch.

### 16. Iterative shell architecture has left small fossils

For example, `updateWorkspaceSplitLayout()` remains as an empty function.

This is harmless in isolation, but it reflects the broader history: WebCap has moved through several shell/layout approaches while preserving pieces of earlier abstractions.

The issue is not dead code by itself. The issue is that the app's current conceptual model has not yet been consolidated to match the current feature set.

---

## What Is Working and Should Not Be Lost

This audit does **not** argue for flattening all screens into one uniform layout.

The following behavior is useful and should be treated as intentional unless later evidence says otherwise:

- media list / left rail may auto-hide when screen space is better used elsewhere;
- Caption Grid can remain a distinct high-density surface;
- Focused Annotation can remain immersive;
- Review can keep its current report/artifact-oriented layout;
- Training can keep its lifecycle/status/history-oriented layout;
- Test Bench can keep its dedicated left rail plus large results area;
- helper panels and local rails may collapse independently;
- local workspace headers and tabs remain valuable;
- true modal interactions should remain modal.

The architectural weakness is **not variation inside workspaces**.

It is the lack of stable application structure surrounding those workspaces.

---

## Provisional Architectural Interpretation

Do not treat this section as an implementation plan. It is only the simplest model consistent with the findings.

WebCap appears to need three conceptual layers:

### 1. Application / building structure

Things whose meaning survives workspace changes, potentially including:

- high-level workspace navigation
- background activity indicators
- application status / console access
- minimal context identity
- app settings/help

These should not be structurally owned by a rail that a workspace is free to hide.

### 2. Workspace root

One active major activity, such as:

- Caption
- Review
- Training
- Test

Each workspace may use the available content area completely differently.

A workspace should not need to hide arbitrary unrelated descendants to claim the screen.

### 3. Workspace-owned layout

Examples:

- Caption: Single / Grid / Focus
- Review: Metadata / Caption Report / Prune / Duplicates
- Training: Items / Config / Run Log plus lifecycle/history
- Test: Next Run / Sessions / Grid / Compare

These are not application-level navigation; they belong inside their workspace.

This framing would let WebCap **normalize the hallway without redesigning the rooms**.

---

## Questions for the Next Pass

Before proposing permanent navigation or moving DOM nodes, the next useful exercise is to classify the existing UI into four buckets:

1. **Global**
   - survives every workspace
2. **Workspace**
   - owned by Caption / Review / Training / Test
3. **Contextual**
   - attached to the current set/item/session/run
4. **Overlay**
   - temporarily blocks or floats above a workspace

The main question is then:

> How few existing nodes need to move to create a stable application frame?

The likely candidates for relocation are much smaller in number than the feature surfaces themselves.

Do **not** begin by redesigning the individual workspaces. Their local UX is mostly sound.

---

## Relevant Current Files

Primary shell / state:

- `tool/tool.html`
- `tool/js/workspace_shell.js`
- `tool/css/workspace_shell.css`
- `tool/css/workbench.css`

Global-looking status / console:

- `tool/js/console_panel.js`
- `tool/js/preview_pane.js`

Workspace implementations:

- `tool/js/media_grid_actions.js`
- `tool/js/media_grid_state.js`
- `tool/js/focused_annotation.js`
- `tool/js/review_output.js`
- `tool/js/training_workspace.js`
- `tool/js/training_workspace_state.js`
- `tool/js/training_candidates.js`
- `tool/js/training_review.js`
- `tool/js/test_generations.js`

Existing UI history / prior audit:

- `docs/ui_gold_master.md`

`docs/ui_gold_master.md` remains useful historical context, but it predates the current unified Review, Training, and Test Bench surfaces. This document should be used as the current shell-architecture weakness map until a later implementation pass explicitly supersedes it.
