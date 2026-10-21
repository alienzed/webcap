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
- Global app-private filesystem state follows `docs/filesystem_state_contract.md`: classify by lifecycle first, use centralized path ownership, do not add new `FS_ROOT/.webcap*` roots, and clean proven temporary work at its lifecycle boundary rather than waiting for startup.
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

- Before fixing an implementation, establish the simplest normal solution first and compare the existing code against it; simplify toward that path instead of layering on compensating logic.
- Reuse existing behavior, state, and routes when ownership still makes sense; do not couple one feature to another feature's DOM merely because a usable control already exists.
- Prefer localized edits over refactors.
- Prefer one-file or one-function changes when they are enough.
- Resist new abstraction, indirection, or configuration unless the workflow value clearly justifies it.
- Do not "modernize" into modules, classes, or frameworks just because it looks cleaner.
- Do not add async behavior unless it is needed for correctness or safety.
- Do not add complexity to support hypothetical future use.
- Treat WebCap's actual supported workflows and invariants as the correctness boundary. Do not add permission gates, hidden exclusions, purity checks, quarantine behavior, repair logic, or compensating architecture solely for states WebCap itself does not create.
- Manual filesystem edits are outside WebCap's responsibility unless the current task explicitly concerns them. Do not invent guards for hypothetical moved, renamed, linked, malformed, or otherwise user-altered files. If WebCap can still perform the requested operation, let it; if the operation genuinely cannot proceed, fail loudly at that operation.
- Prefer warnings for concrete observed risks. Do not turn speculative risks into behavior changes, and do not assume the user wants a more restrictive workflow than the one requested.
- In audits, distinguish actual defects in supported WebCap workflows from stale tests, intentional legacy limitations, and hypothetical out-of-band misuse. Do not label the latter as product "mines."

When in doubt, ask:

- What is already wired?
- What do the included libraries already support?
- What is the smallest explicit change?
- Is this solving a real user workflow cost, or just reorganizing code?

## Capability Before Design

A concrete example can make the desired outcome obvious without proving the system can deliver it.

- Identify the hard capability a proposed workflow depends on: what must actually be observed, inferred, calculated, or controlled, and which component would do it.
- Distinguish what a human can recognize from what the available code, models, libraries, APIs, hardware, and input data can reliably support. A prompt or algorithmic sketch is not proof of capability.
- Verify the critical capability against actual interfaces, constraints, or representative behavior before designing around it. When feasibility is materially uncertain, test the smallest meaningful case first rather than building orchestration on an assumption.
- Be explicit about what is demonstrated, plausible but unverified, or unsupported. Do not promise reliability from a compelling example or bury a capability gap behind extra heuristics and workflow complexity.
- Design toward achievable outcomes; simplify or adjust the approach when a core capability is missing. Equally, do not artificially restrict capabilities that are already demonstrated.

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

## Managed Runtime Ownership

For local work started by WebCap, durable uncertainty is a bug, not a safety state.

- GPU coordination must obey `docs/gpu_coordination_invariants.md`. Queue/GPU semantics are frozen: GPU requests are FIFO and lane-sticky; there is no built-in lane priority. Backlog is not a competing request system; it is only a secondary stay-busy-when-idle mechanism. Training gets stronger recovery/protection because it is long-lived, not because it outranks other lanes. Do not change these semantics as cleanup, simplification, or refactoring without explicit user direction.
- GPU availability for WebCap-managed runtimes is deterministic: **yes, no, or operation error**. `unknown`, `maybe`, `uncertain`, and conservative-busy are not valid scheduling states. If code cannot answer a required runtime question, surface the failure; do not turn uncertainty into queue logic.
- ComfyUI's own queue is authoritative for whether ComfyUI is busy: any running or pending ComfyUI work counts regardless of who submitted it. Unrelated GPU use outside WebCap-managed runtimes (for example a game or Ollama) is outside WebCap's scheduling responsibility.
- Cross-runtime handoff cleanup belongs to the shared GPU prep path, not to a client lane.

- Record a stable runtime identity before, or atomically with, the external side effect that starts the work.
- After restart or crash, reconcile managed work from that exact identity plus authoritative runtime evidence. Managed work must resolve to active, terminal, absent, or failed; "possibly still running" must not become a durable state.
- Positive evidence that managed GPU work is active may delay conflicting execution. Missing, unreachable, or ambiguous evidence must never create an indefinite GPU reservation or queue blocker.
- Shared GPU ownership is process-local scheduling state, not durable truth. Persist identities needed to reconstruct reality rather than speculative ownership.
- On WebCap startup or restart, never automatically unpause a previously paused queue, campaign, or managed operation. Reconcile saved work and preserve its paused state; only an explicit user action may resume scheduling. Reconciliation of work already active is not permission to restart paused work.
- When reconciliation fails, expose the failure and preserve enough identity/evidence to diagnose it. Prefer a traceable execution failure over refusing unrelated work because WebCap is unsure.

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
- Viewing, selecting, refreshing, or navigating historical, derived, or reference state must not overwrite current user-authored working state unless that overwrite is the explicit purpose of the user action. Treat editable working state and historical/reference state as separate by default; copying historical state into an editor requires an explicit user action.
- Polling and live refreshes must preserve DOM identity for stateful or interactive elements (especially video/audio playback, inputs, selection, scroll, and expanded controls). Reconcile by stable key and add/update/remove only what actually changed; do not replace whole live containers on a timer unless an intentional context reset requires it.
- For a local list mutation, prefer updating/removing only the affected keyed element when the mutation's effect is local. If the operation legitimately changes other rows, ordering, grouping, filtering, or collection-wide state, use an authoritative refresh; do not use a scoped response to reconstruct unrelated items.

### Readable Type and Honest Visual Hierarchy

- **16px is the default body/control size in new or meaningfully revised workflows**, with **18px or more for important labels and actions**, and roughly 24–30px for the current task's primary heading when space permits. **12px is a hard floor for truly incidental metadata only**, not a normal target; aim for 14px+ even for supporting details. Do not trade readability for density: wrap/truncate filenames, allow scrolling, or show fewer cards instead of shrinking text.
- **The user's active subject or decision owns the dominant heading** of its workspace. In a tag-reference gallery, for example, `BB Shape · ring connectors` is the main heading; generic labels like `Matching images`, counts, and instructions are subordinate. Don't give a container label more visual weight than the actual thing being inspected.
- Respect hierarchy through font size, weight, spacing, and placement; distinguish a primary heading, supporting labels, actionable controls, and tertiary metadata. Verify real rendered hierarchy at normal browser zoom and representative viewport sizes, rather than assuming the DOM heading tag or existing styling makes it prominent.
- Make work feel rewarding through **truthful, immediately visible advancement**: show a current goal, clear next action, actual completion/coverage, and distinct selected/done states where that workflow has them. Gamify useful progress, not decoration, fake scores, badges everywhere, confetti, or competing dashboard chrome. Prefer one strong focal point to a wall of uniformly weighted facts.
- If a screenshot looks too small, inspect the app's actual CSS and layout before attributing it to browser zoom or display scaling. Browser zoom is a hypothesis, not a substitute for correcting undersized in-app typography.
- These are default requirements for **new and meaningfully revised UI**, and when correcting a reported readability problem; do not redesign unrelated screens just to apply the rules.

## Visible, Rewarding Progress

Make ongoing work feel alive. A user waiting for model loading, inference, training, scanning, assessment, queue execution, or a Storyboard operation should never have to wonder whether WebCap is broken.

- **Show meaningful activity prominently**, not as timid 11px text, hidden status, or a spinner with no explanation. Use the available screen space, especially on large monitors, while respecting existing WebCap styling and visual hierarchy.
- Prefer lively, useful feedback: explicit phase/state, current item and total when known, queue position, completed work, throughput/tokens per second where genuinely available, elapsed activity, real metrics, charts, recent results, and obvious completion or failure states. Choose widgets that illuminate that workflow; do not require every screen to have the same dashboard.
- Make the waiting experience engaging and satisfying, including when little changes. Show honest current state and last meaningful activity; allow approximate or heuristic progress (such as model loading) when anchored to real phases, typical behavior, or measurable signals, clearly distinguishable from exact telemetry. Never present arbitrary animation as a factual percentage or claim precision that is not supported. Indeterminate work should look intentional and alive without pretending to advance.
- Give progress room to breathe. Favor legible, expressive cards, graphs, and states over cramped rows and tiny type; provide a focused summary with optional expansion for detailed diagnostics.
- Keep feedback contextual and nonintrusive. Avoid incessant toasts, flashing, gratuitous animations, needless polling, or overlays that block unrelated work. Allow dismissal/collapse where appropriate without hiding essential running, completion, cancellation, or failure signals.
- Surface stalls, loss of connection, errors, cancellation, and terminal states explicitly. Distinguish queued, loading, actively working, waiting on a dependency, complete, cancelled, and failed when authoritative state supports those distinctions. Silence is not a status.
- Reuse existing Activity, queue controls, shared status, and styling rather than creating competing reporting layers, fake telemetry, or new backend machinery solely for decoration. The interface should reflect authoritative operation state and preserve interactive DOM state during live updates.
- Treat this as a default design requirement for **new and substantially revised workflows**, not a demand to redesign unrelated screens. Review every lengthy operation for clear, enjoyable, trustworthy feedback.

Aim for **playful clarity, not noise**: confidence and delight from seeing real work happen.

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