# Visual Director prompt experiment

This is a disposable, test-only experiment. It does not change WebCap production behavior.

## Goal
Compare four role-instruction strategies for improving standalone MiniMax H3 Scene prompt renderability, especially implied-but-unspecified visual details.

## Run contract
Use the existing configured Storyboard Director model/runtime and its normal H3 context, schema, and sampling settings. Change only the candidate role instruction. Do not load a new model, add a new model dependency, or change production code to run an experiment.

Codex: inspect the existing runtime and implement the smallest local runner needed to:
- load candidate prompts from `prompts/*.txt`
- load fixtures from `fixtures/*.json`
- build equivalent requests for every candidate/fixture pair
- submit through the already configured Director runtime
- save raw request/response and timing/model metadata under an ignored local results directory
- never apply results to a Storyboard Project

If the configured runtime cannot be called without changing production code, report the precise blocker and use the smallest test-only adapter. Do not build a UI.

Run 4 candidates x 5 fixtures = 20 calls. Keep model, settings, schema and all non-candidate context identical. Do not add self-critique or extra repair calls.

## Evaluation
Score each output against the fixture's expected findings and this rubric: consequential omission detection, completeness of visual consequences, concrete H3-ready wording, restraint against invented details, preservation of creative intent, and unnecessary changes to already-complete prompts.

Evaluate the revised prompt, not the agent's explanation. Hide candidate identity during qualitative comparison where practical. Report per-fixture results, candidate totals, raw outputs, and a recommendation. Do not merge experimental prompts into production.

## Timebox
Aim for one short setup pass and one 20-call run. No UI, no broad refactor, no multi-round optimization. If all candidates fail similarly, diagnose the shared failure rather than expanding the prompts.
