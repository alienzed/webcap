# Studio Director Action Advisor — MVP implementation record

This is a shipped-MVP implementation supplement to [Studio Director's functional contract](studio-director-contract.md) and [AGENTS.md](../AGENTS.md), not a second authoring contract. The phases below record the work introduced in PR #1035 and subsequent Settings/global-toggle integration; their checklists are historical verification targets, not evidence of a live-model pass.

## Outcome

After a completed, successfully saved Director chat reply, an **enabled-by-default** independent sidecar on the selected Director model may suggest zero to three actions. Settings → Director provides a browser-wide on/off preference (disabled only when explicitly switched off). Each suggestion can prepare existing **Read** or **Write** controls; only the author can click Read or Write to execute it. The sidecar is never saved Project data or a chat message.

## Phase 1 — Isolate the advisor request

- Reuse `/fs/director/chat`, the existing queued-job endpoint and polling API under a distinct `studio_action_advisor` operation.
- Supply an independent concise system prompt and a minimal action schema.
- Supply the actual conversation and known selected Project/Scene IDs; do not silently fetch saved creative material.
- Always use the already-selected Director model to avoid cold model loads. No new provider, GPU queue, config root or background worker.

## Phase 2 — Make independent suggestions

- Sidecar is **enabled by default**, controlled by a browser-wide toggle in Settings → Director and starts only after a successfully saved, user-initiated Director reply.
- Run it without changing Director's pending flag, job ID, messages, request/response I/O, or Read/Write history.
- Show up to three applicable actions, validating exact supported operation names, allowed Project field scopes and known destination IDs.
- Keep transient advisor output separate from the conversation. Clear it when a new chat turn or conversation begins; ignore late responses from previous turns/conversations.
- Sidecar failure is visible in its own status and the Console, without breaking conversation or existing manual actions.

## Phase 3 — Prefill the existing controls

- Supported initial actions: Create Project, Revise Project, Create Scene(s), Revise selected Scene(s), and explicit Read.
- A suggestion click only opens and populates existing controls: destination, operation, requested Project fields or known Scene selection, and editable Write instruction.
- Read suggestions use supported complete Overview or selected Scene groups. A prepared Read still requires clicking **Read into conversation**; no snapshot is read into chat by the sidecar.
- Add simple Project Revise field checkboxes to the existing Write form, since the previous manual Project Write had no field selector; its default remains all fields.
- Leave unsupported / unresolvable suggestions out of the UI. Users can continue with normal manual Read, Write and specialized tools.

## Phase 4 — Verification and rollout

- Backend tests cover independent system prompt, separate operation, schema and model selection.
- JS tests cover independent polling, out-of-scope suggestions, no fabricated targets, and prefill-without-save.
- Browser tests cover default-enabled behaviour, disabling the preference without extra advisor calls, re-enabling suggestions, correctly preselected destination/fields, and explicit Read or Write as the only execution.
- Run Studio Director checks, Storyboard regression and Studio browser acceptance; distinguish unrelated failing workflows and unavailable live-model evidence.

## Deliberately deferred

No agent roster, multipersona synthesis, technician authoring, new Overview taxonomy, additional chat response schemas, automatic creative grading, repair calls, Review gates, automatic Reads/Writes, durable action suggestions, or implicit operation selection from Director's ordinary prose. The isolated `runSidecar(operation, model, message)` function is the minimal reusable extension point for another advisor when an actual workflow warrants it.
