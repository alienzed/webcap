# UI Shell Refactor Plan

**Status:** Approved migration plan; implementation should proceed one independently validatable phase at a time.

**Created:** 2026-09-18

**Companion audit:** `docs/workspace_shell_architecture_audit.md`

## Purpose

WebCap's individual surfaces have matured faster than its application shell.

That is not a feature-design failure. It is the natural result of solving real workflow problems quickly: a useful control was placed where there was room, a screen borrowed a container that already existed, a Back button was added because a surface temporarily took over the app, and a global-looking control lived inside a sidebar because that sidebar was always visible at the time.

The accumulated result is now expensive:

- major workspaces invent their own app-level headers and escape controls;
- global-looking UI disappears when the contextual sidebar is hidden;
- some surfaces reuse DOM containers whose original meaning no longer applies;
- shared concepts such as model selection are becoming useful outside the workspace that first owned them;
- Test Bench claims the whole app through CSS while workspace state still says something else;
- the console physically moves between local containers;
- overlapping state systems describe related navigation concepts;
- feature code increasingly has to know which unrelated UI should be hidden.

The goal of this refactor is therefore:

> **Give WebCap a stable application shell, migrate each workspace into it slowly, preserve every working feature, and then remove the evolutionary scaffolding that the old shell required.**

This is not a visual rewrite and not a framework rewrite.

---

# 1. Non-Negotiable Contract

## 1.1 Feature preservation

No existing feature may disappear or silently stop working.

Every currently functional button, input, menu, action, route, keyboard path, background process, status view, persistence path, and workspace capability must remain functional unless all of the following are true:

1. the control is purely shell/navigation chrome, such as a Back, Close, or collapse button;
2. the new shell provides an obvious equivalent way to perform the same action;
3. removal is explicit in the phase notes;
4. the replacement is validated before the old control is deleted.

This contract includes, but is not limited to:

- folder navigation and current-folder context;
- media list/filtering;
- caption editing and saving;
- media preview actions;
- Media Grid;
- Focused Annotation;
- Focus Sets;
- Review Set;
- Media Metadata;
- Caption Report;
- Prune Candidates;
- Duplicates;
- Training set entry;
- Training global entry;
- model/profile selection;
- training stage selection;
- starting-point/resume/initializer controls;
- config editing;
- Training Items;
- queue and active job controls;
- Recent Runs;
- run logs;
- bucket review;
- Candidate Analysis;
- staging candidates for Test;
- Test Bench Next Run controls;
- Test sessions;
- Grid and Compare;
- Test run/stop;
- Settings;
- Help;
- application status;
- application console;
- background Training activity;
- background Test activity;
- current persistence/restore behavior.

## 1.2 No big-bang state rewrite

A shell-layout change must not simultaneously change the source of truth for feature state.

Examples:

- adding a header does **not** also globalize model ownership;
- adding an activity rail does **not** also replace `workspaceState`;
- moving Test into a real workspace root does **not** also add Krea2 inference;
- moving console access does **not** merge Training `run.log` with the general app console;
- replacing Back buttons does **not** also rewrite all previous-surface restoration logic.

State ownership moves only in dedicated phases.

## 1.3 Temporary coexistence is allowed; permanent compatibility sludge is not

During migration it is acceptable to have:

- a new shell plus the old utility bar;
- a permanent header plus a still-present Training/Test/Review local header;
- a new navigation route while the old Back button remains available;
- read-only shell context that mirrors existing state.

Those bridges are temporary.

The final architecture may not retain:

- duplicate editable controls for the same state;
- old and new navigation systems both remaining authoritative;
- permanent fallback DOM lookups;
- duplicate hidden elements kept merely because old code expects them;
- global elements reparented into local containers;
- feature-specific `!important` takeover rules that exist only to defeat the shell;
- empty/dead shell functions;
- CSS classes whose only purpose is to emulate superseded ownership.

Every bridge added during migration must have a named retirement phase.

## 1.4 Fail visibly

Do not add silent guards or fallback behavior to make a migration phase appear safe.

Required app-owned shell elements should be required.

If a required slot, control, workspace root, or state hook is missing, the break should be visible in the browser console or server logs.

## 1.5 Each phase must be independently validatable

Every phase must be small enough that we can answer:

- What changed?
- What should look different?
- What must behave exactly the same?
- What can be manually tested in a few minutes?
- What automated/static contract can reasonably cover it?
- Can this phase be reverted without undoing unrelated work?

If those answers are not obvious, split the phase.

---

# 2. Product / Shell Model

WebCap should be treated as an integrated workbench rather than a single linear workflow.

The shell gives complexity stable addresses. It does not force all workspaces to look alike.

## 2.1 Activity rail

The permanent left activity rail answers:

> **What major activity am I doing?**

It is narrow and icon-only.

The final inventory should remain intentionally small. The working direction is:

- Prep / media work;
- Training;
- Testing;
- app-level destinations such as Settings/Help where appropriate.

Review, Grid, Focus, Config, Run Log, Candidate Analysis, Sessions, and Compare are not automatically top-level activities. Most are workspace-owned modes, artifacts, or detail views.

The activity rail must never depend on the contextual media sidebar.

## 2.2 Application header

The permanent top row answers:

> **What am I working with, and what shared context matters here?**

It must not become a second full toolbar stacked above workspace headers.

Instead, the permanent row should eventually be the authoritative host for shell-level identity/context plus optional workspace-owned controls.

Conceptually:

```text
[ app/context ]    [ workspace-owned header slot ]    [ global activity/status/chrome ]
```

Likely shell-level content:

- current set/folder context;
- current working model **after** model ownership is explicitly migrated;
- background Training/Test activity;
- immersive/fullscreen shell control;
- application-level status/chrome.

## 2.3 Workspace content

Each workspace remains free to use the rest of the screen differently.

Examples:

- Prep: media/context rail + preview + caption/helper surfaces;
- Grid: dense media canvas;
- Focus: immersive annotation;
- Review: report/artifact layout;
- Training: setup, queue, history, artifacts;
- Test: Next Run/session rail + result/compare area.

## 2.4 Content headings remain local

The shell does not eliminate useful content labels.

Examples that remain local:

- `Caption Report`;
- `Prune Candidates`;
- `Training Queue`;
- `Recent Runs`;
- `Next run`;
- `Staged LoRAs`;
- group names in Focused Annotation;
- chart-specific controls in Candidate Analysis.

What should disappear are redundant shell-level headings such as:

```text
Training
current/folder/path
Back
```

when the activity rail and shell header already make those facts obvious.

---

# 3. Target Structural Direction

The first implementation wraps the current app instead of rewriting the current inner grid.

Conceptually:

```text
#app-frame
├── #app-header
├── #activity-rail
└── existing .app.shell-revamp
    ├── #sidebar-panel
    ├── .preview-panel
    ├── .workbench-panel
    └── #workspace-overlays
```

This is deliberately conservative.

The existing `.app.shell-revamp` remains the current machine while the new shell is established around it.

Later phases may simplify the inner structure after each workspace no longer depends on the historical three-column ownership model.

---

# 4. Migration Rules

1. **Add before removing.** A replacement path is proven before old chrome is deleted.
2. **Prefer moving real nodes to cloning them.** Existing IDs and event wiring are valuable during migration.
3. **Never create two editable sources of truth.** A temporary shell representation may be read-only.
4. **Migrate one responsibility at a time.** DOM location, state ownership, navigation ownership, and visual cleanup should not all move together.
5. **A workspace may temporarily keep its own header.** The shell is proven first; local headers are retired later.
6. **Existing room layouts are preserved until their dedicated phase.**
7. **Background work is independent from foreground navigation.** Leaving Training/Test must not imply stopping Training/Test.
8. **True modals stay modal until explicitly reclassified.**
9. **A control moves because its ownership changed, not because there is empty space somewhere else.**
10. **Every temporary bridge gets removed.** The refactor is incomplete until obsolete DOM/state/CSS is deleted.

---

# 5. Validation Strategy

This migration needs both **behavior preservation** and **structural cleanup** validation.

## 5.1 Automated/static contracts

Existing tests already provide useful anchors, including:

- `tests/test_media_grid_contract.py`;
- `tests/test_focused_annotation_navigation_contract.py`;
- `tests/focused_annotation_integration.test.js`;
- `tests/test_training_workspace_scope_ui_contract.py`;
- `tests/test_training_review_ui_contract.py`;
- `tests/test_training_history_ui_contract.py`;
- `tests/test_training_candidates_ui_contract.py`;
- `tests/test_test_generations_ui_contract.py`;
- backend Training/Test behavior suites.

A new shell contract test should be introduced early and expanded as ownership moves.

It should eventually assert, at minimum:

- one permanent activity rail exists;
- one permanent application header exists;
- the contextual sidebar is not the parent of global shell controls;
- shell navigation remains present while Grid/Focus/Training/Test are active;
- global console host is stable;
- only one editable model selector exists after model migration;
- Test no longer requires Training DOM in its finished state;
- deprecated takeover/reparent mechanisms are absent after their retirement phases.

Static contract tests are useful here because many regressions are structural.

They do **not** replace manual browser validation.

## 5.2 Manual smoke matrix

Every shell-affecting phase should exercise the relevant subset of this matrix:

| Area | Minimum smoke |
| --- | --- |
| Prep / Single | select media, edit/save caption, preview actions |
| Sidebar | folder navigation, filters, collapse/restore |
| Grid | enter, select/clear, filters, open/return |
| Focus | enter, item/group navigation, edit terms/tags, exit |
| Review | enter, all four artifact tabs, focus-set handoff, return |
| Training / Set | model/stage, setup controls, items/config/log tabs, Tests handoff |
| Training / Global | enter globally, queue/history/log access, leave |
| Candidate Analysis | open, chart controls, candidate action, close/leave |
| Bucket Review | open, adjust, Done/close semantics |
| Test | open, Next Run fields, sessions, Grid/Compare, run/stop |
| Background activity | leave active Training/Test and confirm status remains reachable |
| Settings / Help | open/close |
| Console | open/close from multiple activities |
| Persistence | reload relevant state where the phase touched persistence |

Not every phase needs the whole matrix. Each phase notes its required subset.

## 5.3 Visual validation

Because the shell is spatial, each major migration should also verify:

- no accidental extra header row;
- no clipped controls;
- no hidden shell under Test/Grid/Focus;
- no unexpected vertical growth;
- contextual rails still collapse independently;
- dark/light theme remain coherent;
- current desktop target remains comfortable.

Responsive behavior should be validated specifically in its own phase rather than opportunistically rewritten throughout.

---

# 6. Phase Plan

The phases are intentionally small. Several may result in very small commits.

## Phase 0 — Freeze the migration contract

**Change**

- Add this plan and link it from the docs map.
- Add no runtime behavior.

**Validation**

- Documentation only.
- Confirm current HEAD and baseline files before Phase 1.

**Retires:** nothing.

---

## Phase 1 — Add shell contract tests for the current baseline

**Change**

Create a small shell-focused UI contract test that records the current critical structure before moving it.

The baseline should assert current IDs/wiring that must survive initial wrapper work, including:

- `#utility-bar`;
- `#status`;
- `#console-panel`;
- `#sidebar-panel`;
- preview/workbench roots;
- Training/Test entry controls.

Do not assert evolutionary garbage as a desired final state. Mark baseline-only assertions clearly so they can be retired.

**Why first**

We need a tripwire before moving DOM.

**Manual validation**

None beyond loading the app.

**Retires:** nothing.

---

## Phase 2 — Introduce inert outer app frame

**Change**

Add the outer frame DOM/CSS around the existing app:

- permanent shell frame;
- placeholder header region;
- placeholder activity-rail region;
- existing `.app.shell-revamp` untouched inside it.

The new regions may initially be visually minimal/empty.

**Must not change**

- current workspace grid;
- utility bar ownership;
- navigation;
- workspace state;
- console host;
- Test takeover behavior.

**Manual validation**

Run the basic Prep/Single smoke and enter each major surface once.

**Success condition**

The app behaves exactly as before.

**Retires:** nothing.

---

## Phase 3 — Establish shell geometry only

**Change**

Give the outer frame its real desktop geometry:

- narrow left rail column;
- thin top header row;
- current app fills the remaining work area.

Keep rail/header content intentionally sparse.

Do not migrate old controls yet.

**Manual validation**

- inspect every major surface for clipping;
- verify Test takeover only takes over the inner workspace, not the new shell;
- verify Grid/Focus still size correctly.

**Success condition**

We pay the shell's real spatial cost before relying on it.

**Retires:** nothing.

---

## Phase 4 — Add temporary shell identity/context as read-only

**Change**

Populate a minimal read-only header identity using existing authoritative state.

Candidate first content:

- current folder/set label;
- active high-level workspace label if determinable without creating new state.

Do **not** add editable Model yet.

**Why**

This proves header synchronization without introducing ownership conflicts.

**Manual validation**

Navigate folders and enter/leave Review/Training/Test/Grid/Focus. Header text must not become stale.

**Retires:** nothing.

---

## Phase 5 — Add permanent activity rail navigation in parallel

**Change**

Add icon-only rail destinations for the major activities using existing entry functions.

Initially keep all old entry points.

The rail should call existing navigation behavior rather than introduce a new navigation state machine.

**Must not change**

- Review/Training/Test Back buttons;
- current utility buttons;
- sidebar actions.

**Manual validation**

Enter each destination through both old and new paths.

**Success condition**

Rail navigation is merely another caller of proven behavior.

**Retires:** nothing.

---

## Phase 6 — Extract Settings and Help from contextual sidebar ownership

**Change**

Move the existing Settings and Help controls into permanent shell chrome while preserving their IDs/handlers where practical.

During validation, old visual placement may temporarily coexist only if necessary; do not keep duplicate editable controls.

**Manual validation**

Open/close Settings and Help from Prep, Grid, Training, and Test.

**Retires**

Old sidebar ownership for these controls.

---

## Phase 7 — Extract background Training activity indicator

**Change**

Move the existing Training-running indicator/entry affordance into permanent shell ownership.

Do not change Training job state.

**Manual validation**

- with idle Training;
- with representative running/queued UI state if safely reproducible;
- while foreground workspace is not Training.

**Retires**

Dependency on media sidebar visibility for Training activity access.

---

## Phase 8 — Extract Test activity indicator/entry

**Change**

Move the current Test Bench activity affordance into permanent shell ownership.

Do not change Test's current H3-only behavior or its workspace takeover implementation yet.

**Manual validation**

- staged Test data visible;
- active Test batch represented;
- enter Test from shell while in another workspace;
- return without losing session state.

**Retires**

Dependency on sidebar visibility for Test activity access.

---

## Phase 9 — Give application status a permanent home

**Change**

Move the general `#status` / status text out of `#sidebar-panel` into shell ownership.

Do not reinterpret workspace-local status messages.

**Manual validation**

Trigger representative general status messages from Prep operations and confirm they remain visible regardless of active workspace.

**Retires**

Sidebar ownership of global status.

---

## Phase 10 — Stabilize console host

**Change**

Give `#console-panel` one permanent shell-owned host.

Remove the need for `syncConsolePanelHost()` to physically reparent the console between preview/editor containers.

Do not merge Training run logs into the console.

**Manual validation**

Open/close console from multiple activities and confirm it does not disappear when the contextual sidebar/preview/editor changes.

**Retires**

Nomadic console parenting.

---

## Phase 11 — Utility bar decomposition complete

**Change**

Audit the old `#utility-bar`.

Anything genuinely global should now have a permanent shell home.

Anything contextual should move to the relevant workspace/contextual rail.

If nothing remains, remove the old utility-bar container.

**Manual validation**

Inventory every former utility control against its new location.

**Retires**

The old utility bar as a mixed global/contextual container.

---

## Phase 12 — Formalize header slots

**Change**

Define explicit shell header zones/slots, for example:

- context;
- workspace controls;
- global activity/chrome.

Provide a small API/convention for a workspace to populate/clear only its own slot.

Avoid clever dynamic DOM reparenting. Prefer stable shell nodes whose content is rendered from state.

**Manual validation**

Switch repeatedly among existing surfaces. No workspace controls may leak into the next surface.

**Retires:** ad hoc future header insertion.

---

## Phase 13 — Migrate Training shell identity into permanent header

**Change**

Move only Training's app-level identity from its local header:

- `Training`;
- current folder / global status identity;
- Back/escape role where the rail now supersedes it.

Keep Training's local setup/queue/history content untouched.

Initially the old Training Back button can remain until rail navigation is proven.

**Manual validation**

Training set entry and global entry, including switching out and back.

**Retires**

Redundant Training title/folder shell identity.

---

## Phase 14 — Retire Training Back as app navigation

**Change**

Once rail navigation is proven, remove the Training Back control if it has no remaining unique meaning.

If it still performs a context-specific operation not covered by the rail, keep it and document that meaning.

**Manual validation**

All routes previously requiring Back must remain reachable.

**Retires**

One compensating escape control.

---

## Phase 15 — Migrate Test shell identity into permanent header

**Change**

Move Test's app-level identity:

- `Test Generations` title;
- Back role;
- possibly Help/info if it is shell-level rather than Next-Run-specific.

Keep:

- Next Run;
- Staged LoRAs;
- Sessions;
- result view controls;
- session metadata.

**Manual validation**

Open existing sessions, run/stop controls, Grid/Compare, return to other activities.

**Retires**

Redundant Test title/header identity.

---

## Phase 16 — Make Test a real shell workspace without changing Test features

**Change**

Stop treating Test as an inner `.editor-surface` occupant that hides unrelated ancestors.

Give Test an explicit workspace root in the inner application work area.

Do not add Krea2 yet.

**Manual validation**

Full Test contract plus switching to/from Prep and Training.

**Automated contract**

Assert Test no longer depends on `.test-generations-workspace-open` hiding unrelated shell descendants once the old mechanism is removed.

**Retires**

The `Test Generations temporarily owns the full workspace` takeover architecture.

---

## Phase 17 — Retire Test Back and takeover CSS

**Change**

Remove obsolete Test Back/close-as-navigation controls and the old takeover selectors only after Phase 16 is proven.

**Manual validation**

Test entry/exit exclusively through stable shell navigation.

**Retires**

Feature-specific full-app hiding rules.

---

## Phase 18 — Migrate Review shell identity into permanent header

**Change**

Absorb:

- `Review Set` app-level title;
- current folder/visible/scope shell context where appropriate;
- Back role.

Keep Review artifact tabs and local artifact headings.

**Manual validation**

All Review tabs, focus-set handoffs, return to Prep.

**Retires**

Review's redundant application header.

---

## Phase 19 — Retire Review Back navigation

**Change**

Remove Review Back if the activity rail/context navigation fully replaces it.

**Manual validation**

Review → Prep and focus-set/report round trips.

**Retires**

Review escape control.

---

## Phase 20 — Migrate Media Grid shell identity/escape

**Change**

Use permanent shell navigation/context for:

- current folder/source identity where appropriate;
- leaving Grid.

Keep local Grid controls:

- Grid-specific filters;
- Focus Set controls;
- Select All;
- Clear;
- Grid status.

The Grid Back arrow can remain temporarily.

**Manual validation**

Current folder Grid, Focus Set Grid, selection state, return behavior.

**Retires:** nothing yet.

---

## Phase 21 — Retire Grid Back if redundant

**Change**

Remove the Grid Back arrow only if the permanent navigation makes its meaning unnecessary and no unique local-history behavior is lost.

**Manual validation**

All known Grid entry paths return sensibly.

**Retires**

Grid-specific escape chrome if redundant.

---

## Phase 22 — Rationalize Single-item preview header against app header

**Change**

Audit the current preview header field by field.

Likely local controls to keep local:

- item position;
- media metadata;
- rating;
- Reset;
- media actions;
- Focus Annotate.

Likely shell/context duplication should move or disappear.

Do not stack another row above it unnecessarily: use the permanent header's workspace slot where that reduces vertical chrome, or keep a genuine local toolbar if the controls are strongly media-specific.

**Manual validation**

All preview actions and caption workflow.

**Retires**

Only confirmed duplicate shell identity.

---

## Phase 23 — Rationalize Focused Annotation chrome

**Change**

Separate true local Focus controls from escape/shell controls.

Keep:

- group navigation;
- item navigation;
- group identity;
- Edit Terms;
- Delete;
- Copy/Paste Tags;
- Mark Reviewed;
- group status.

Remove Focus exit/close chrome only if stable navigation fully replaces it.

**Manual validation**

Dedicated Focus navigation test matrix and existing integration tests.

**Retires**

Only redundant shell/escape controls.

---

## Phase 24 — Define authoritative working context model

**Change**

Before moving Model, explicitly define the shell context data model.

At minimum distinguish:

- current set/folder context;
- current working model/profile;
- immutable model identity of historical artifacts;
- global/no-set contexts.

Document the rule:

> The shell's working model is the model selected for the next model-sensitive operation. Historical runs/sessions keep their own immutable model identity.

Do not move the selector in this phase if ownership is not yet fully specified.

**Validation**

Reason through:
- Prep with no model;
- set Training;
- global Training;
- old H3 run while working model is Krea2;
- old H3 Test session;
- future ad-hoc Test folder.

**Retires:** ambiguity only.

---

## Phase 25 — Move model selection state out of Training ownership

**Change**

Introduce one authoritative working-model state.

Training consumes it rather than owning it.

Preserve existing per-set persistence semantics unless deliberately changed and separately documented.

During this phase the visible selector may remain in Training while its state ownership changes underneath.

**Manual validation**

Switch models, leave Training, return, reload set, verify exact existing persistence behavior.

**Automated contract**

No second editable model state.

**Retires**

Training as the conceptual owner of model selection.

---

## Phase 26 — Move Model selector into permanent header

**Change**

Move the real editable Model selector to the header.

Training's old selector is removed, not mirrored.

Training setup reads the shared working model.

Test may read it only after its own model-support phase is ready; until then unsupported choices must be explicit rather than silently coerced.

**Manual validation**

- Prep → select model;
- Training reflects it;
- switch set and verify persistence rule;
- global Training;
- existing Test H3 behavior must not silently break.

**Retires**

Workspace-specific duplicate model selection.

---

## Phase 27 — Make Test consume working model explicitly

**Change**

Refactor Test's model gating so it consumes the shared model/context contract instead of reaching into `#training-model-profile-select`.

At this phase Test can still support only H3 if Krea2 inference is not yet implemented.

Unsupported model behavior must be clear and explicit.

**Manual validation**

H3 Test remains unchanged; selecting another model does not corrupt Test state.

**Retires**

Test's dependency on Training DOM.

---

## Phase 28 — Candidate Analysis placement decision

**Change**

Re-evaluate Candidate Analysis now that the shell exists.

Question:

> Is it still genuinely modal, or is it a Training artifact/detail workspace?

If it remains modal, centralize its overlay ownership.

If it becomes a Training detail surface, migrate it without changing candidate algorithms/actions.

Do not combine this with algorithm changes.

**Manual validation**

Chart controls, fullscreen, folder action, staging actions, return to Training.

**Retires**

Whichever modal/workspace ambiguity is no longer justified.

---

## Phase 29 — Centralize overlay ownership

**Change**

Define one overlay root and one policy for true modal UI.

Remove hand-picked modal reparenting performed by shell rebuild code.

Focused Annotation should no longer need to know a hard-coded global inventory of unrelated modal IDs merely to suppress navigation.

**Manual validation**

Crop, Settings if still modal, Bucket Review, viewer, Candidate Analysis depending on Phase 28.

**Retires**

Overlay retrofit logic and cross-feature modal inventories.

---

## Phase 30 — Separate shell navigation state from workspace-local state

**Change**

With visual migration complete, simplify navigation ownership.

Do **not** prematurely choose a giant enum.

Identify the minimum shell-level state needed to answer:

- which major activity is active;
- which workspace root is mounted;
- what global context is active.

Leave workspace-local state local:

- Grid selection;
- Focus group/item;
- Review detail tab;
- Training artifact tab;
- Test session/view.

**Manual validation**

Round-trip transitions among all major activities.

**Retires**

Shell branches that manipulate unrelated feature internals.

---

## Phase 31 — Reconcile `workspaceState.surface` and `workspaceUiState.viewMode`

**Change**

Now that major activity/workspace ownership is explicit, remove duplicated concepts between:

- shell surface;
- view mode;
- previous surface.

Grid and Focus should not need to be simultaneously represented as two unrelated generations of navigation state unless there is a clear reason.

Preserve user-visible behavior exactly.

**Manual validation**

Single/Grid/Focus transitions and restoration paths.

**Retires**

Obsolete duplicated navigation state.

---

## Phase 32 — Give major workspaces explicit roots

**Change**

Where still missing, ensure Prep/Review/Training/Test each have explicit DOM roots with stable ownership.

Stop making `.preview-panel` or `.editor-surface` mean unrelated things depending on mode.

This may be several tiny commits, one workspace at a time.

**Manual validation**

Full smoke of each migrated workspace.

**Retires**

Container semantic erosion.

---

## Phase 33 — Remove feature-specific hiding choreography

**Change**

Audit CSS/JS for rules that hide unrelated workspace descendants because a feature needed to claim space.

Replace with explicit active-workspace mounting/visibility.

Particular targets include:

- stale Test takeover rules;
- surface-specific `!important` chains;
- shell code that hides feature internals it should not know about;
- direct `style.display` uses that duplicate shell classes.

Do not mechanically eliminate every `.hidden`; local visibility remains legitimate.

**Manual validation**

Every major surface plus overlay behavior.

**Retires**

Visibility rules used as an informal global layout API.

---

## Phase 34 — Remove DOM reparenting and reuse fossils

**Change**

Search for UI that is physically moved between unrelated parents or reused merely because it already exists.

For each case choose one stable owner.

Examples to inspect:

- console host;
- workspace overlays;
- Test insertion into editor surface;
- any toolbar/control moved among feature containers;
- shell rebuild functions.

**Manual validation**

Targeted per removed reparent path.

**Retires**

The tired pattern of reusing arbitrary DOM simply because it is already there.

---

## Phase 35 — Fullscreen / immersive shell mode

**Change**

Only after the normal shell is stable, add optional immersive mode.

Desired behavior:

- hide header and activity rail;
- workspace expands;
- predictable edge-hover or explicit reveal;
- obvious keyboard/exit path;
- background operations continue;
- no workspace invents a separate fullscreen shell.

This is shell fullscreen, distinct from media/chart fullscreen where those remain useful.

**Manual validation**

Prep, Grid, Focus, Training, Test; enter/leave immersive repeatedly.

**Retires:** nothing required.

---

## Phase 36 — Responsive shell pass

**Change**

Revisit <=1180 and <=880 layouts after shell/workspace ownership is stable.

Do not preserve old responsive behavior merely because it exists; preserve useful behavior.

Priority:

- desktop remains primary;
- rail stays compact;
- header does not wrap into an accidental second toolbar row unless deliberately designed;
- contextual sidebars may collapse before the permanent shell disappears;
- narrow viewport behavior remains operable.

**Manual validation**

Representative desktop/narrow widths.

**Retires**

Old responsive selectors tied to superseded shell ownership.

---

## Phase 37 — Accessibility and keyboard pass

**Change**

Audit:

- activity-rail labels/tooltips/ARIA;
- active activity state;
- header control labels;
- tab/focus order;
- keyboard paths formerly tied to Close/Back buttons;
- Escape semantics for real modals vs workspace navigation;
- immersive shell reveal/exit.

**Manual validation**

Keyboard-only pass through major shell operations.

**Retires**

Any obsolete key handling that assumed old modal/surface ownership.

---

## Phase 38 — Persistence / reload audit

**Change**

Verify which shell/context state should persist across reload and which should not.

Do not persist transient UI merely because it can be persisted.

Explicitly review:

- current set/folder;
- working model;
- Training selected profile behavior;
- Test per-set settings;
- active workspace/activity;
- local view/tab state;
- immersive mode.

**Manual validation**

Reload from representative states.

**Retires**

Accidental persistence inherited from previous ownership.

---

## Phase 39 — Fossil deletion pass

**Change**

Perform a deliberate deletion-only audit.

Targets include:

- empty `updateWorkspaceSplitLayout()`-style fossils;
- old shell classes no longer emitted;
- obsolete IDs used only by removed chrome;
- retired Back/Close handlers;
- stale CSS comments describing superseded behavior;
- duplicate shell state;
- baseline-only compatibility tests;
- temporary bridge code introduced by this migration.

No feature work in this phase.

**Manual validation**

Full smoke matrix.

**Success condition**

Deleting old architecture does not require fallback compatibility code.

---

## Phase 40 — Shell responsibility audit

**Change**

Inspect `workspace_shell.js` and equivalent shell code.

The shell should know:

- active major workspace/activity;
- permanent shell regions;
- global context;
- global background/status presentation;
- overlay root.

The shell should **not** directly manage:

- Review tab internals;
- Training run-log internals;
- Candidate algorithms;
- Test session details;
- Focus term controls;
- media selection internals.

Move feature-specific logic back to feature owners where necessary.

**Retires**

The shell as coordinator of unrelated feature internals.

---

## Phase 41 — End-state regression sweep

**Change**

No architecture work.

Run the broadest available automated suite and the full manual smoke matrix.

Specifically verify:

- every functional control from the pre-refactor inventory has a surviving functional equivalent;
- every removed control is accounted for as obsolete shell/navigation chrome;
- no background operation is lost when switching workspaces;
- no persisted artifact changed format accidentally;
- no feature now depends on another workspace's DOM.

**Retires:** nothing.

---

## Phase 42 — Update canonical docs to the new architecture

**Change**

Update:

- `README.md`;
- `docs/spec.md`;
- `docs/dataset_workflow.md` if navigation language changed;
- Training/Test feature notes where entry points changed;
- this plan status;
- architecture audit status.

Archive/supersede old shell descriptions only after code is proven.

**Retires**

Planning-only status of the new shell.

---

# 7. Workspace Migration Checklist

Use this checklist every time a workspace starts using the shell.

## Identity

- What title is app-level vs content-level?
- Is current set/folder already visible globally?
- Does the workspace repeat model identity?
- Is historical artifact identity immutable and visibly distinct from working context?

## Navigation

- Which Back/Close/X buttons are only escape hatches?
- Does any local Back button encode meaningful local history?
- Can the activity rail replace it without ambiguity?
- Are there alternate entry points that must still work?

## Controls

- Which controls are genuinely global/shared?
- Which belong to the current workspace?
- Which belong to the selected item/run/session/chart?
- Are we moving a control because of ownership or merely because there is room?

## State

- What is the current source of truth?
- Is the shell only reflecting it or taking ownership?
- If taking ownership, is this a dedicated state-migration phase?
- Does reload/persistence behavior remain identical?

## Background behavior

- Can work continue after leaving?
- How is that work represented in permanent shell chrome?
- Can the user return directly to it?

## Cleanup

- What old DOM is now redundant?
- What old CSS exists only for the previous layout?
- What old handlers/classes can be removed immediately after validation?
- Did we introduce a bridge that needs a future retirement phase?

---

# 8. Hostile Audit of This Plan

This section deliberately tries to break the plan before implementation.

## Attack 1 — The new shell becomes another layer instead of replacing old chrome

**Failure mode**

We add a header and rail but are too cautious to remove local headers. The app ends up with more chrome forever.

**Correction applied**

The plan has explicit retirement phases for Training, Test, Review, Grid, and Focus escape/header chrome. The migration is not complete while redundant shell-level headers remain.

## Attack 2 — We globalize Model too early and break Training persistence

**Failure mode**

The header gets a Model selector immediately. Training currently owns selected-profile behavior and per-set persistence. Test also reaches into Training's selector. Moving the visual control first could create two sources of truth or subtle set-switch bugs.

**Correction applied**

Model migration is split into three distinct phases:

1. define context semantics;
2. move state ownership;
3. move the visible selector;
4. separately make Test consume it.

## Attack 3 — The activity rail accidentally becomes a second state machine

**Failure mode**

New rail clicks mutate a new `activeActivity` variable while old `workspaceState.surface` continues to drive layout. They drift.

**Correction applied**

The first rail phase calls existing navigation functions only. New shell-level state is introduced later, after visual migration proves what state is actually necessary.

## Attack 4 — Test is broken while shell work and Krea2 work collide

**Failure mode**

We generalize Test model support at the same time we move it into a workspace root. A failure becomes impossible to attribute.

**Correction applied**

The plan explicitly migrates H3 Test unchanged first. Krea2 inference is outside this shell plan and should be added only after Test no longer depends on Training DOM.

## Attack 5 — We preserve garbage because tests assert it

**Failure mode**

Baseline contract tests accidentally canonize old takeover classes/reparent behavior.

**Correction applied**

Baseline-only assertions must be marked temporary. Later structural contracts assert their *absence*. Phase 39 explicitly deletes compatibility tests tied to retired architecture.

## Attack 6 — We remove Back buttons that actually encode history

**Failure mode**

A local Back button may not simply mean "go to Prep"; it might restore a focus set, previous surface, or artifact.

**Correction applied**

Every removal phase requires checking whether the button carries unique local-history semantics. If it does, the control or an equivalent local navigation affordance stays.

## Attack 7 — The header becomes a dumping ground

**Failure mode**

Every useful control migrates upward because horizontal space exists.

**Correction applied**

The ownership test is explicit:

- app/context/global state -> shell;
- current workspace operation -> workspace;
- selected artifact/item control -> local content.

The workspace header slot is allowed, but it is not permission to globalize local controls.

## Attack 8 — The icon-only rail becomes incomprehensible

**Failure mode**

Limited width plus no labels produces mystery-meat navigation.

**Correction applied**

Rail entries require stable iconography, tooltip/title, ARIA label, and active state. The inventory stays small. Subviews do not automatically become rail entries.

## Attack 9 — A permanent header costs too much vertical space

**Failure mode**

The new shell consumes scarce vertical space and existing workspace headers remain, making the UI worse.

**Correction applied**

Geometry is introduced before relying on it, so the cost is evaluated early. Later phases explicitly absorb redundant local headers. Immersive shell mode is added only after the normal shell works.

## Attack 10 — Fullscreen/autohide becomes a new source of shell bugs

**Failure mode**

We use immersive mode as an excuse to accept a bad normal shell, or implement it early and double the state complexity.

**Correction applied**

Immersive mode is Phase 35, after ownership/state cleanup. It is optional polish, not a prerequisite for accepting the permanent header.

## Attack 11 — We conflate app console, workspace status, and artifact logs

**Failure mode**

Moving status into the shell tempts us to centralize everything.

**Correction applied**

The plan keeps three explicit concepts separate:

- global app/operation feedback;
- workspace-local status;
- artifact/log content such as Training `run.log`.

Only the first is shell-owned.

## Attack 12 — Explicit workspace roots trigger a giant DOM rewrite

**Failure mode**

"Give every workspace a root" becomes a rewrite of all markup before the shell is proven.

**Correction applied**

Explicit roots are late, Phase 32. Early work wraps the existing app and migrates responsibilities incrementally.

## Attack 13 — The final shell still knows every feature's internals

**Failure mode**

We create nicer DOM but `syncWorkspaceSurfaceUi()` still branches over Review tabs, Training logs, Test details, etc.

**Correction applied**

Phase 40 audits shell responsibility after visual migration and pushes feature internals back to feature owners.

## Attack 14 — We delete too aggressively and lose obscure buttons

**Failure mode**

The cleanup phase treats unfamiliar controls as garbage.

**Correction applied**

The feature-preservation contract requires a pre/post control inventory. Only shell/navigation chrome with validated replacements can disappear. Phase 41 accounts for every removed functional control.

## Attack 15 — We never finish cleanup because the app "works"

**Failure mode**

Temporary bridges become permanent because feature work resumes once the shell looks good.

**Correction applied**

Cleanup is not optional polish. Phases 29-40 are part of the refactor definition of done. The plan is incomplete until old ownership/reparent/takeover/state fossils are removed.

## Attack 16 — Responsive behavior breaks invisibly

**Failure mode**

Desktop looks good while old media queries still assume the inner app begins at viewport edge or that the sidebar is the first column.

**Correction applied**

Early phases only ensure no immediate regression; Phase 36 performs a dedicated responsive rewrite after structure stabilizes.

## Attack 17 — Keyboard users lose navigation when X/Back buttons disappear

**Failure mode**

Mouse navigation works through the rail, but keyboard/Escape semantics become inconsistent.

**Correction applied**

No escape control disappears before its replacement is proven. Phase 37 explicitly audits keyboard and focus behavior after structural migration.

## Attack 18 — Historical artifacts become misleading after Model becomes global

**Failure mode**

Header says Krea2 while an H3 run/session is open, implying the artifact is Krea2.

**Correction applied**

Phase 24 distinguishes working model from immutable artifact model identity before any selector moves. Historical artifact identity remains local and explicit.

## Attack 19 — Background work is visually lost

**Failure mode**

Training/Test continue correctly but users forget they exist after switching activities.

**Correction applied**

Background indicators move into permanent shell ownership before old utility-bar ownership is removed.

## Attack 20 — "No features break" becomes "never improve architecture"

**Failure mode**

Fear of regression prevents deleting old state/DOM forever.

**Correction applied**

The contract protects **behavior**, not implementation. The final phases deliberately remove obsolete DOM, duplicated state, reparenting, takeover CSS, and shell-feature entanglement once behavior is covered.

---

# 9. Improvements Applied After the Hostile Audit

The original migration idea was simply:

1. wrap the app;
2. add rail/header;
3. migrate workspaces;
4. clean up.

The hostile audit shows that is not specific enough.

This final plan improves it in the following ways:

- shell geometry is validated before it becomes authoritative;
- navigation is added before old escape controls are removed;
- global controls migrate before workspace headers;
- background indicators migrate before the contextual sidebar loses ownership;
- console stabilization is isolated from workspace migration;
- Test becomes a real workspace **before** model expansion;
- model semantics, state ownership, visible control, and Test consumption are four separate steps;
- local Back/X removal is always conditional on preserved semantics;
- overlay cleanup is explicit;
- navigation-state cleanup occurs only after the visible shell proves the desired model;
- explicit workspace roots happen late rather than triggering an early rewrite;
- cleanup has several dedicated phases instead of one vague "refactor later";
- responsive/accessibility/persistence each receive their own validation pass;
- the plan includes a final feature inventory/accounting step so obscure functionality cannot disappear unnoticed.

---

# 10. Definition of Done

The shell refactor is complete only when all of the following are true.

## Stable shell

- A permanent icon-only activity rail exists.
- A permanent compact header exists.
- Global navigation/status is not owned by a hideable contextual sidebar.
- Background Training/Test activity remains reachable regardless of foreground workspace.
- The general console has one stable shell-owned host.

## Clear ownership

- Major workspaces have explicit ownership/root semantics.
- Shared working context such as Model has one authoritative owner.
- Historical runs/sessions display their own immutable model identity.
- Workspace-local controls stay local.
- True modal UI uses centralized overlay ownership.

## No feature loss

- Every pre-refactor functional control has a surviving functional equivalent.
- Any removed control is documented as obsolete shell/navigation chrome.
- Existing backend routes/artifact formats remain unchanged unless separately intended.
- Background work survives navigation exactly as before.

## Garbage removed

- Test no longer claims the app by hiding unrelated descendants.
- Global UI is not physically reparented among workspace containers.
- Test does not depend on Training DOM.
- Shell code does not manipulate unrelated feature internals.
- Duplicate navigation state has been reconciled.
- Obsolete Back/Close handlers are gone.
- Superseded shell CSS/classes/comments/functions are gone.
- Temporary migration bridges are gone.
- Old DOM is not retained merely to satisfy stale code.

## Understandable mental model

A new user should be able to understand the shell with a short explanation:

> The left rail changes major activities. The top row shows the context you're working with and shared app state. The large area is owned by the current activity. Local controls stay with the thing they operate on.

That is the standard the finished architecture should meet.

---

# 11. Explicit Non-Goals

This plan does not itself implement:

- Krea2 Test inference;
- arbitrary-folder Test sources;
- new Training algorithms;
- new candidate-selection algorithms;
- a frontend framework/module rewrite;
- a database;
- a generic plugin system;
- wholesale visual redesign of mature workspace interiors.

Those features can benefit from the completed shell, but they should not be used to justify widening shell migration phases.

---

# 12. First Implementation Slice

When implementation begins, stop after the first small slice and validate it before continuing.

Recommended first slice:

1. Phase 1 — baseline shell contract;
2. Phase 2 — inert outer frame;
3. Phase 3 — real shell geometry.

Then reassess the actual app in-browser before committing to the visual details of rail/header contents.

That keeps the first irreversible decision extremely small:

> **The app has a permanent outer shell. The rooms still work exactly as they did before.**
