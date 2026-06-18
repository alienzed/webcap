# WebCap Agent Guide

This file is the root working contract for agents making changes in this repo.
It is intentionally opinionated. Follow the structure that is already here unless
there is a clear, concrete reason not to.

## Project Intent

WebCap is a local-first media curation, captioning, and dataset-prep app.

Core product values:

- explicit, reversible mutations
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

## How To Make Changes

Prefer the smallest change that cleanly solves the real problem.

- Wire existing UI, state, and routes before inventing new infrastructure.
- Prefer localized edits over refactors.
- Prefer one-file or one-function changes when they are enough.
- Resist new abstraction, indirection, or configuration unless the workflow value clearly justifies it.
- Do not "modernize" into modules, classes, or frameworks just because it looks cleaner.
- Do not add async behavior unless it is needed for correctness or safety.
- Do not add complexity to support hypothetical future use.

When in doubt, ask:

- What is already wired?
- What is the smallest explicit change?
- Is this solving a real user workflow cost, or just reorganizing code?

## Error Handling

Fail loudly when required wiring or invariants are broken.

- Do not add silent guards around required functions or required UI.
- Do not use patterns like `if (typeof someFn === 'function')` for app-owned code.
- Do not silently skip intended behavior.
- Critical invariant failures should break execution.
- Errors should be visible in the browser console or server logs.

Silent failure is worse than a visible breakage in this project.

## Mutation Safety

All destructive or lossy actions must be explicit and reversible.

- Preserve originals when the workflow depends on reversibility.
- Require clear user intent for destructive actions.
- Construct mutation arguments explicitly in code.
- Do not introduce arbitrary code execution paths.

## UX Guidance

Keep the UI efficient and calm.

- Avoid adding clutter when existing space or patterns can carry the feature.
- Favor keyboard efficiency where it materially improves throughput.
- Keep controls contextual.
- Prefer visible status over hidden magic.
- Do not force extra steps when a workflow can stay direct.

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
