# Epoch Finder reference evaluation plan

## Decisions
- Retain manual ratings and selection.
- Preserve existing prompt-compliance scores and elimination unchanged.
- Add separate, experimental dataset-reference assessments.
- Match wildcard attributes to training references by exact scoped tags, with manual choice where ambiguous.
- Compare the named feature only, using full images first. No cropping prerequisite.
- Reuse the existing vision queue and selected RVN model. Do not add a queue, database, or hidden state.
- DINOv2 Base is a planned optional, locally run embedding evaluator; SigLIP2 is deferred.

## Existing code
- Dataset items: `tool/server/caption_ops.py` lists media and reads sibling .txt captions.
- Annotation mapping: `caption_group_tags_by_media` in the folder's `.webcap_state.json`, read by `tool/server/folder_state_store.py`.
- Campaign evidence: `tool/server/epoch_finder.py` stores per-unit resolved groups, generated frames, VL judgments and campaign rankings in campaign.json.
- Vision transport: `tool/server/caption_vision.py` builds messages and resized image data. `tool/server/storyboard_llm_runtime.py` converts each image part for llama.cpp or Ollama.
- Scheduling: existing `tool/server/llm_runner.py` LLM lane.

## Phase 1: reference discovery and paired-message foundation
- Read actual per-item scoped tags, require exact group/option equality, and return deterministic candidates with stable filenames.
- Produce ordered A/reference and B/generated two-image questions with MATCH, PARTIAL, MISMATCH, UNCLEAR outcomes.
- No effects on campaign scoring or existing sessions.

## Phase 2: user-initiated proof in the evidence inspector
- Select an existing frame, wildcard group, and one reference from exact-tag candidates.
- Send an asynchronous paired-image vision request using the existing LLM queue; do not block the HTTP handler or start work on navigation.
- Save result, model, reference identity, file freshness and short reason beside original unit assessment, separately.
- Handle missing or pruned generated frames explicitly; no implicit rerender.
- Test RVN Q5's actual two-image behavior and timings before calling this successful.

## Phase 3: reference reproduction
- Select small number of tagged reference images, use their actual captions as controlled generation prompts with consistent settings/seeds across epochs.
- Keep reproduction distinct from wildcard generalization, and include manually preferred late checkpoints.

## Phase 4: DINOv2 prototype
- Test DINOv2 Base in an optional isolated environment on 16GB VRAM; cache dataset embeddings using reference fingerprints and model/preprocessing versions.
- Evaluate whole-image similarity initially, without suggesting it reliably detects small garment construction details.
- Share reference discovery with Test Generations only through backend helpers.

## Phase 5: ranking validation
- Compare reference-grounded RVN, DINOv2 and current VL scores against manually rated strong/weak checkpoints.
- Include base-model controls and late epochs. Only consider changes to automated elimination if these signals prove predictive.

## Grounded risks
- Multi-image message support does not prove the selected RVN model compares both images accurately.
- Scoped tags establish annotated membership, not camera visibility: require explicit selection/approval.
- Current Epoch Finder prunes some screening frames, so reference assessment must run before pruning or explicitly require retained evidence.
