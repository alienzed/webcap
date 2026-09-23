# WebCap Agent Guide

This file is the root working contract for agents making changes in this repo.
It is intentionally opinionated. Follow the structure that is already here, confirm with the user before deviating.

## Project Intent

WebCap is a local-first media curation, captioning, and dataset-prep app.

Core product values:

- explicit, reversible mutations for source Set media and user-authored Set state
- fast iteration on real working sets
- minimal UI clutter
- visible state and visible failures
- practical workflow value over architectural purity

## Architecture Is Intentional

Do not treat the current structure as accidental.

- Frontend is plain HTML/CSS/JS under `tool/`.
- Frontend scripts are loaded as classic scripts, with plain globals and shared state.
- Load order matters.
- Backend is Python under `tool/server/`.
- State is file-based. There is no database.
- Per-folder and per-item artifacts live beside the user's data.

Important examples:

- `tool/tool.html`: app shell and modal markup
- `tool/js/`: frontend behavior, globals, event wiring, workflows
- `tool/css/`: styling
- `tool/server/`: Flask routes and backend operations
- `.webcap_state.json`: folder state
- `media_metadata.json`: cached analysis/metadata
- `<media>.txt`: caption storage
- `originals/`: reversible mutation backing store

## Feature Ownership and Boundaries

Keep ownership obvious as the app grows. These are practical defaults, not purity rules.

- A feature should own its own feature-specific state and DOM.
- The shell owns application navigation, shared working context, global status, and global chrome.
- A feature should not reach into another feature's DOM to reuse a control just because it already exists.
- When features need to interact, prefer a small explicit function or shared state contract over DOM coupling.
- Shared state should have one clear owner. Other features may consume it without maintaining competing copies.
- Reuse behavior and concepts when useful; do not reuse UI ownership merely to avoid adding a small amount of code.
- A little duplication is preferable to a premature abstraction with unclear ownership.
- Do not introduce event buses, dependency injection, registries, service layers, framework-like infrastructure, or other indirection unless a concrete workflow actually needs it.
- Do not reorganize working code merely to make it conform to an architectural ideal. Improve boundaries as related code is touched.
- If the straightforward solution is obvious and local, use it.

## How To Make Changes

Prefer the smallest change that cleanly solves the real problem.

- Reuse existing behavior, state, and routes when ownership still makes sense; do not couple one feature to another feature's DOM merely because a usable control already exists.
- Prefer localized edits over refactors.
- Prefer one-file or one-function changes when they are enough.
- Resist new abstraction, indirection, or configuration unless the workflow value clearly justifies it.
- Do not "modernize" into modules, classes, or frameworks just because it looks cleaner.
- Do not add async behavior unless it is needed for correctness or safety.
- Do not add complexity to support hypothetical future use.

When in doubt, ask:

- What is already wired?
- What do the included libraries already support?
- What is the smallest explicit change?
- Is this solving a real user workflow cost, or just reorganizing code?

## Error Handling

Fail loudly when required wiring or invariants are broken. Functionality is all that matters; a guard that prevents something from working is an additional failure mode, not a solution.

- Do not add silent guards around required functions or required UI.
- Do not use patterns like `if (typeof someFn === 'function')` for app-owned code.
- Do not silently skip intended behavior.
- Do not add fallbacks that are not completely valid alternatives; anything that does not produce intended outcomes should be a big loud error.
- Critical invariant failures should break execution.
- Errors should be visible in the browser console or server logs.
- Operational failures from backend requests, external tools, workers, queues, or long-running operations must also reach WebCap's global Console when that surface is available. Local error cards, inline status, or toasts may add context but do not replace the shared diagnostic log.
- Preserve useful underlying error detail in the global Console. Do not reduce a detailed backend or external-tool failure to a generic UI message.
- Routine validation caused directly by incomplete user input does not need to pollute the global Console.
- Visible failure is always the correct signal. Never add guards that intercept, reinterpret, or conceal failures from the requested operation.

Silent failure is worse than a visible breakage in this project. “Fail loudly” means expose failures from required wiring or the requested operation; it does not authorize adding new checks that prevent that operation.

## Mutation Safety

Destructive or lossy mutations of source Set media and user-authored Set state must be explicit and reversible.

- Preserve originals when the Set workflow depends on reversibility.
- Generated inference artifacts (including Generate results, Storyboard Takes, and Test results) are derived material and may support explicit permanent deletion; do not force a trash/restore layer onto them unless the workflow needs one.
- Require clear user intent for every destructive action, and make permanently destructive inference-artifact actions visibly distinct from reversible Remove/Restore actions.
- Construct mutation arguments explicitly in code.
- Do not introduce arbitrary code execution paths.

## UX Guidance

Keep the UI efficient and calm.

- Avoid adding clutter when existing space or patterns can carry the feature.
- Favor keyboard efficiency where it materially improves throughput.
- Keep controls contextual.
- Prefer visible status over hidden magic.
- Do not force extra steps when a workflow can stay direct.
- Polling and live refreshes must preserve DOM identity for stateful or interactive elements (especially video/audio playback, inputs, selection, scroll, and expanded controls). Reconcile by stable key and add/update/remove only what actually changed; do not replace whole live containers on a timer unless an intentional context reset requires it.

## Analysis / Metadata Rules

For new analysis features:

- Keep analyzer logic in its own backend helper file.
- Write normalized app-shaped data into `media_metadata.json`.
- Do not expose raw library/model output shapes directly to UI code.
- Include a version field per analyzer block for cache invalidation.
- Prefer existing vendored or already-packaged dependencies before adding new ones.
- Any new dependency must justify its offline footprint, CPU/VRAM cost, and workflow value.
- Keep experimental analysis features independent from caption editing, training config generation, and destructive actions.

## Portability And Scope

- Keep the app portable: Python + browser.
- Avoid solutions that assume extra services, databases, or hosted infrastructure.
- Maintainability and clarity matter more than theoretical flexibility.

## Practical Review Standard

A good change in this repo usually looks like this:

- minimal
- explicit
- reversible when needed
- easy to reason about
- consistent with existing globals/file-based state
- valuable to the actual annotation/curation workflow
- measured twice, cut once

If the structure feels unusual, assume it is that way on purpose and work with it rather than against it.


## Machine Role

This repository is running on the development machine, not the training machine.

- This machine has no authoritative live training queue, training logs, GPU state, or overnight run state.
- Never interpret local WebCap configuration, test data, or processes as evidence about actual training runs.
- When the user discusses real training activity, assume it occurred on the separate training machine.
- Diagnose real runs only from information explicitly retrieved from or supplied from the training machine.
- If that machine is inaccessible, say so immediately and request the relevant logs or connection details.