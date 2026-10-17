# Epoch Finder: nested wildcards and epoch evidence drilldown

## Scope and codebase evidence
- `tool/server/epoch_test_bench.py` owns nested wildcard parsing (`_parse_wildcard_nodes`), exhaustive option expansion (`_expand_wildcard_option`) and generation-time `wildcardEvaluationGroups`. Do not create another inference expansion path.
- `tool/server/epoch_finder_plan.py` previously rejected nested syntax in `prompt_options`.
- `tool/js/epoch_finder.js` previously rejected the same syntax and rewrote editor values into flat alternatives.
- Campaign `units` already save round, epoch, case, prompt, groups, frame, assessment and error. The leaderboard and frame gallery are UI-only consumers of this persisted evidence.
- `tool/server/epoch_finder.py` already compares selected VL option IDs to per-session expected IDs; no new scoring system or queue is justified.

## Phase 1 — nested wildcard contract (applied)
- Use the Test Generations parser/expansion to derive the option vocabulary for each top-level group.
- Preserve the user's authored nested prompt. Nested group's expanded choices are read-only in the attribute editor; edit nested structure in the prompt field.
- Continue allowing independent primary/leakage/vary role selection and flat-group value editing.
- Verify that the options and order in `normalize_dimensions` match `wildcardEvaluationGroups` for representative nested prompts before launch. No word-level fallback.

## Phase 2 — evidence drilldown (applied)
- Make leaderboard epochs inspectable; selecting one shows every recorded unit for that epoch instead of the 40-frame recent gallery limit.
- Show round/case, stored resolved prompt, individual expected/selected VL alternatives, verdict, and errors.
- Handle pruned frames honestly: evidence and scores persist, but a deleted image cannot be recovered.
- Keep campaign scoring, inference/LLM queues and backend media retention unchanged.

## Phase 3 — verification before merge
- Exercise flat, nested, optional-empty, repeated-option, mismatched-brace and nontrivial whitespace cases; compare client editor normalization and server resolved vocabulary.
- Confirm existing Test Generations wildcard expansion remains untouched.
- Browser smoke: campaign switch, selected epoch, completed/ongoing progress, missing/pruned frames and gallery reset.
- Run Python and JS syntax/test checks, and representative training-machine H3 and Krea2 campaigns; ensure settings, queue, restart, scoring and cleanup remain correct.
- If the training machine is not connected, do not claim runtime verification. Keep PR draft.

## Boundaries
No database, extra scheduling lane, new inference API, background scans, automatic resumption, or changes to source checkpoint retention. Do not expand into Run Analytics or cross-run comparison in this change.
