# Structured Director guidance — adoption candidate

## Phase 1: freeze and audit (this draft)
The control is the verbatim Classic v3 role/toolkit from unified_final. The candidate preserves the agreed XML guidance, defines Duration in seconds, and consumes the shared structured H3 authoring reference directly through h3.authoring. The reference establishes the 15-second default, shot timing alignment, and preservation of saved durations on revision. No duplicated H3 guidebook, template or dialogue notation. All treatment cases are Chat, including explicit requests to draft Project fields and Scene prompts. The previous Write cases are adapted as equivalent explicit Chat requests with any required Project snapshot in visible history. Production Project Write and Scene Write request assembly and schemas remain unchanged. The Scene Write task now uses the same 15-second default as the Rulebook and honors explicitly requested timing; revision relies on the requested fields and the Rulebook rather than repeating a model duration range. This changes task wording only, not request assembly or persistence. All consumers of the shared built-in H3 authoring reference receive its structured text and simplified duration guidance; the default-duration case evaluates the candidate in Chat. User overrides and the frozen Classic v3 control remain unchanged. No storage, context, schema, profile settings, queue or UI changes. No new validation gates. Preserve AGENTS.md principles.

## Guidance authoring review gate (agreed)

Every subsequent guidance revision must respect these exclusive section purposes:

| Section | Exclusive purpose |
| --- | --- |
| Role | Define the fundamental function of the Director. |
| Criteria | Define the production variables to develop through conversation and the method for developing their values. |
| Response guidance | Define when to provide particular responses and their appropriate scope, form and level of detail. |
| Project Parameters | Define the purpose, required information and quality criteria of each Project field. |
| Scene definition | Define the required information and quality criteria of a Scene specification. |
| H3 authoring reference | Consume the existing authoritative model-specific prompt construction knowledge. |

- Criteria vs. Response guidance: how the Director develops the relevant production variables versus what it actually returns to the user.
- Criteria vs. field definitions: the creative decisions to develop versus the information each specification field must express. Criteria replace the former Responsibilities and Collaboration sections to avoid redundant generic instructions.
- Scene definition vs. H3 authoring reference: what must be audiovisually specified versus how to express that specification effectively for a particular generation model.

Review each instruction against these boundaries before approval. Correct misplaced or overlapping instructions by assigning their useful substance to the appropriate section; retain the separation of concerns. This is an authoring and review criterion, not a runtime validation gate. Preserve approved wording where it passes the criterion, and review any necessary changes explicitly with the user.

## Phase 2: bounded actual model comparison
Use exact configured Gemma model ID and WebCap URL. Run from repo root:

```sh
python scripts/studio_guidance_eval.py plan --design-dir experiments/studio_guidance/structured_director --model "$MODEL" --split all --repeats 2 --seed 327 --output experiments/studio_guidance/runs/structured-plan
python scripts/studio_guidance_eval.py run --design-dir experiments/studio_guidance/structured_director --model "$MODEL" --base-url "$WEBCAP_URL" --split all --repeats 2 --seed 327 --output experiments/studio_guidance/runs/structured-live
python scripts/studio_guidance_eval.py review --run-dir experiments/studio_guidance/runs/structured-live
python experiments/studio_guidance/structured_director/run_chains.py --model "$MODEL" --base-url "$WEBCAP_URL" --repeats 1 --seed 327 --output experiments/studio_guidance/runs/structured-chains
```

44 single-response calls (11 cases × 2 treatments × 2 repetitions), plus 16 real sequential Chat turns (2 four-turn chains × 2 treatments × 1 repetition), maximum 60. All eleven cases exercise Chat; the existing Write scenarios are adapted into explicit Chat drafting requests. The default-duration case explicitly evaluates new Scenes without a requested duration. Single-response histories are fixed, not actual chained inference. The chain runner uses the same resolved packages as the single-turn runner; it feeds each real response into the next turn. Both designs use the existing job API and leave saved data untouched. No automated retries or extra variants. Repeat only a specific ambiguous material result if needed, documenting the added calls. Keep actual receipts, prompt hashes, model IDs, raw output and blinded review notes in ignored runs. For chains mask treatment names before qualitative review; keep transcript order and exact text. Compare complete request content including active primer/settings; report unavailable timing/token fields honestly. Frozen baseline controls the built-in defaults, not a user's custom override.

## Phase 3: practical acceptance and promotion
Review each case against its explicit fidelity checks, then compare paired usefulness (prefer candidate / comparable / prefer control), task adherence, consequential gaps, Overview-to-Scene coverage, invariant scope, situational coherence, explicit Chat drafting, conversational restraint, Scene fidelity and H3 timing/notation. Do not equate word count with quality or penalize deliberate simplicity. Keep missing fields, partial usable output and runtime failure separate. A material reproducible candidate-specific regression blocks default promotion, even if average preference is positive. Candidate may be promoted for Chat only when comparable or better in Chat and no material regression remains; this small screen is practical evidence, not statistical proof. No actual H3 rendering quality claim.

After acceptance, integrate only into the existing Chat guidance composition. Keep the Project Write and Scene Write chains unchanged relative to the updated shared H3 reference baseline. Keep Classic v3 as rollback; preserve custom overrides and other profiles, keep H3 shared specialist consumers unchanged. Avoid duplicating candidate text at runtime (move from frozen experiment to an editable production module and test parity; frozen evidence remains). Use the current default-selection path, inspecting frontend defaults and configuration before changing it. Confirm exact outbound Chat requests match the accepted candidate and include the authoritative H3 reference once. Confirm Project Write and Scene Write requests are unchanged from their pre-change baselines. Reuse tests/test_studio_director.py, tests/test_llm_guidance.py, tests/test_studio_guidance_eval.py, tests/browser/director-read.spec.cjs, tests/browser/studio-director-settings.spec.cjs, and tests/live/studio-director-quiet-tools.spec.cjs. Verify explicit Read snapshots, no implicit saves, scoped writes, title-only revisions, user overrides, and actual model I/O. Inspect existing CI path filters for coverage. If production assembly diverges materially from tested messages, rerun affected cases before switching defaults. Only promote after recording results; no production default changes in this experimental commit.

## Current evidence
Candidate reconciled after PR #1132 was merged before the later agreed wording was incorporated; all approved revisions are preserved here. Candidate and Chat scenarios prepared; live inference and browser acceptance not yet run. The current chat environment has repository API access but no checkout or configured WebCap inference endpoint. Do not claim behavioral validation or promote until actual results exist.


## Adoption decision — 2026-11-27

The author reported that the structured candidate improved conversational focus, creative development and placement of Project field content. Earlier Gemma dialogue omissions did not reproduce in the author's Nullguard transfer check: original structured-v1 and Classic each preserved the exact lines and speakers in 4/4 successful responses (two cases, two repeats per treatment; one separate CUDA load failure recovered by rerunning the identical request). This is limited transfer evidence, not statistical proof, and other formatting and staging defects remain. No rendered output was evaluated.

The author approved promoting the structured architecture for Chat with exactly two dialogue refinements: creative attention to exact words, speakers, language, voice, emotional delivery and timing in the Audio element, and verbatim preservation of explicitly supplied dialogue in the Prompt quality criteria. The production role is editable as `studio.chat` and uses the existing shared H3 Rulebook. The original frozen packages and scenarios remain unchanged for evidence and rollback. Existing Write profiles and all other operation compositions remain unchanged. The offline parity test compares the production XML against the frozen candidate plus those two exact replacements. Live regression of the refined wording on the café and wooden-sea cases and browser/CI execution remain to be verified; the API-only editing environment cannot reach the configured local model runtime. See [research topics R01, R02, R08 and R18](../../../docs/ai-research/README.md) for applicable prompting, context, collaboration and model-transfer evidence and limits.
