# Visual Director prompt experiment

This is a disposable, test-only experiment. It does not change WebCap production behavior.

## Simplest execution path: existing Director Chat API

Do **not** build a UI, modify production code, add an endpoint, or create a new runtime.

WebCap already exposes `POST /fs/director/chat`. Its `freeform_chat` operation passes the supplied message array to the existing queued Director runtime. The runtime accepts ordinary `system` and `user` messages, uses the requested configured model, and runs through the existing LLM queue/GPU ownership path.

Use that exact mechanism. Each candidate/fixture pair must be a fresh request with:
- `operation: "freeform_chat"`
- the same currently configured Director model ID
- `messages: [{role:"system", content:<candidate prompt>}, {role:"user", content:<fixture task>}]`

The user message should contain the fixture's Project overview, visual direction, invariants, Scene description and existing H3 prompt. Ask for only the complete revised H3 prompt (or an explicit unchanged result), not an explanation. Do not include other candidates or prior outputs in the conversation.

Post to the local WebCap server, then poll the existing Director job status endpoint until completion. Codex must inspect the existing route/status contract rather than inventing a polling URL or response shape. Save raw request, response, job metadata and timings locally under `experiments/visual_director/results/` (keep results untracked/ignored). Never apply output to a real Project.

If the API cannot be reached because WebCap is not running, stop and ask the user to open WebCap; do not substitute another model or runtime.

## Goal

Compare four role-instruction strategies for improving standalone MiniMax H3 Scene prompt renderability, especially implied-but-unspecified visual details.

## Candidates and fixtures

- Four candidate role prompts are in `prompts/*.txt`.
- Five fixed fixtures are in `fixtures/*.json`.

Run 4 candidates x 5 fixtures = 20 calls. Use identical fixture content and model/runtime settings for every candidate. Do not add self-critique, retries, or extra repair calls.

## Evaluation

Score each output against the fixture's expected findings and this rubric: consequential omission detection, completeness of visual consequences, concrete H3-ready wording, restraint against invented details, preservation of creative intent, and unnecessary changes to already-complete prompts.

Evaluate the revised prompt, not the agent's explanation. Hide candidate identity during qualitative comparison where practical. Report per-fixture results, candidate totals, raw outputs, and a recommendation. Do not merge experimental prompts into production.

## Timebox

Aim for one short setup pass and one 20-call run. No UI, no broad refactor, no production code changes, no multi-round optimization. If all candidates fail similarly, diagnose the shared failure rather than expanding the prompts.
