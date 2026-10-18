# Interpret with Director — Storyboard Visual / Atmosphere

## Grounded implementation phases

1. **Contract (implemented):** Add a narrowly scoped `interpret_atmosphere` Storyboard LLM operation. The saved Visual / Atmosphere text and Story concept form the input. Request 1–3 lines of concrete visual direction, preserving intent and medium. Reuse the existing queued Storyboard Director runtime.
2. **Non-mutating result (implemented):** Unlike `expand_concept`, completion returns text and does not apply any Story state or write to disk.
3. **Explicit proposal UI (implemented):** Interpret with Director in Visual / Atmosphere; show the text with Apply suggestion and Dismiss. Apply requires unchanged source input and the same Story, then uses the existing Story save path. Manual editing clears stale proposals.
4. **Validation before merge:** Run Storyboard LLM contract tests, browser test with a configured Director model, empty input, another Story selected during generation, edited input before Apply, cancellation/failure, and short/long context. Confirm no Concept/Scenes changes and no automatic overwrite.

Follow `AGENTS.md`: local-first, existing queue, visible failure, no competing persisted draft state.
