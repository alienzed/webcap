# Remote Ollama completion activity — deferred improvement

**Status:** Backlog / low priority. **Documentation only; not implemented.**  
**Recorded:** 2026-10-22.

## Problem

Remote Ollama Vision completions can run for 30–60 seconds while WebCap's existing Activity card shows little more than a spinner. When a request ultimately fails or returns empty output, the user cannot tell whether the request was sent, whether Ollama started responding, or whether any output was generated during the wait.

## Desired behavior

Complete the **existing Activity card**, rather than building another dashboard:

- Preserve the current job identity, queue status, cancellation, completion, failure, and elapsed-time reporting.
- For **remote Ollama completion requests**, report meaningful observed phases: request dispatched, awaiting first response, receiving output, complete/failed/cancelled.
- Where streaming actually provides incremental content, show last activity, output arriving, and a live output/token activity indicator. Show a rate only when it can be calculated credibly; a received-chunk count or byte/character indicator is preferable to a fabricated token count.
- At completion, retain useful Ollama-supplied usage and duration statistics already available in the response, alongside existing errors. Keep underlying error details visible in WebCap's global Console.
- Keep the presentation compact and readable, using the existing Activity UI and styling; no separate dashboard.

## Implementation direction (when prioritized)

1. Trace the existing request path: `tool/server/llm_runner.py` → `tool/server/storyboard_llm_runtime.py` (remote OpenAI-compatible `/chat/completions` currently uses `stream: false`) → the existing Activity snapshot/card in `tool/js/activity_monitor.js`.
2. Confirm the selected remote Ollama model/server actually emits useful streaming chunks through the configured OpenAI-compatible endpoint. Check whether answer text, reasoning, and terminal usage are distinguishable; avoid assuming streaming provides a progress percentage or reliable live token counts.
3. Add a **small, cancellable streaming response reader** for remote Ollama completions only, feeding observed phase/activity updates into the **existing** Activity state. Preserve the current final response shape and model/finish-reason validation so callers see the same completion/result semantics.
4. Maintain current queue ownership, Stop behavior, non-Ollama/local runtimes, request limits, and the existing error/Console path. Failed transport, partial stream, empty final response, and cancellation must remain explicit terminal outcomes; never silently treat a partial result as success.
5. Verify with a real remote Ollama Vision request and focused tests for streaming chunks, no-chunk waits, empty responses, stream errors, cancellation, and final result parity.

## Out of scope

No GPU/VRAM/temperature monitoring, machine-level agents on the remote computer, extra polling service, new dashboard, new execution lane, invented ETA/percentage, or broader LLM/queue redesign.

**Acceptance test:** During a normal remote Ollama Ask VL, the existing Activity card gives observable progress instead of displaying only a spinner until a result or error. The underlying completion behavior remains unchanged.

Related: `docs/live_activity_panel.md`, `docs/execution_queue.md`, and `AGENTS.md`.
