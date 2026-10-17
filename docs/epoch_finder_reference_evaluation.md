# Epoch Finder — Training-aware evaluation implementation contract

Status: agreed direction, 17 October 2026. This document extends `docs/epoch_finder_vision.md`. No new scoring formula is approved.

## Locked behavior

- Epoch Finder remains a checkpoint discovery and evidence-review workflow; users provide manual ratings and select winners.
- **Preserve the existing Ask VL / prompt-compliance assessment, current cumulative ranking, elimination, historical campaign results and Test Generations behavior.** The new measurements are additive and must not silently enter elimination.
- Add **two campaign-level checkboxes, both checked by default**: RVN reference comparison and DINOv2 visual similarity. At least one may be turned off; existing VL continues independently.
- **SigLIP2 is deferred**, not required for the first integrated implementation.
- Before campaign launch, **each scored wildcard choice must have one approved, valid training reference**. A missing reference means fix/remove the proposed option, not a silent fallback. Vary-only choices do not need references.
- Candidate discovery is deterministic via exact scoped Set tags; the user approves/replaces the representative image. Don't invent matches from caption substrings.
- Use **complete images**, representative of the full subject and relevant feature, not close-up-optimized matches. No cropping, segmentation or garment-specific code as a prerequisite. The same mechanism applies to other dataset concepts.
- RVN examines **the named wildcard attribute** in reference A and generated B; ignore unrelated variation. Keep existing multiple-choice option selection and separately record MATCH/PARTIAL/MISMATCH/UNCLEAR reference fidelity with concise reasons.
- DINOv2 produces **whole-image** similarity and cannot be assumed to evaluate tiny scoped features. Keep its values separate and avoid treating multiple attributes backed by the same image as independent whole-image measurements.
- No implicit scan, rerender, auto-resume, new GPU queue, database, hidden state or localStorage. Use current storage owner and GPU reservation rules.
- All three signals must be **inspectable** at the per-epoch, per-test and per-attribute levels; scores without source images, prompts, counts and verdicts are insufficient.

## Existing ownership and code

- `tool/server/caption_ops.py` owns media listing and sibling .txt captions.
- `.webcap_state.json` contains `caption_group_tags_by_media`, accessed through `tool/server/folder_state_store.py`. Validate actual saved annotation shapes before declaring automatic lookup ready.
- `tool/server/epoch_finder.py` owns `campaign.json`, per-unit resolved wildcard groups, saved frames, existing VL comparisons, ranking, round execution and pruning.
- `tool/server/caption_vision.py` constructs VL messages and image data; the vision runtime supports ordered image parts, but RVN Q5 two-image reasoning needs a real-machine check.
- `tool/server/llm_runner.py` is the existing LLM queue. DINO inference must coordinate through existing GPU ownership, not run concurrently without reservation.
- Keep small metadata in campaign records, large embeddings in separate bounded/versioned cache artifacts under approved app-managed storage; no image bytes/base64 inside JSON.

## Safe implementation phases

### 1. Reference plan and campaign setup
- Discover candidates by exact scoped-tag option, with deterministic ordering and a compact full-image picker.
- Display attributes/options with selected reference and replacement affordance.
- Require approved references for **all scored options** before launch; record media identities and freshness fingerprints with the campaign.
- Add two opt-out checkboxes (RVN and DINOv2), selected by default, frozen into the campaign.
- Verify reference availability/freshness again at evaluation time; missing/changed inputs are explicit errors/unclear, never fabricated mismatches.

### 2. Integrated reference RVN
- Reuse the current VL message and queue path with two ordered images and exact existing wildcard vocabulary.
- Record the option selected for B and a distinct reference-fidelity verdict/reason; keep the current VL assessment untouched.
- Store model/version, source references, timing, failures, uncertainty and raw response in compact durable evidence.
- Existing campaign score/elimination logic remains unchanged.

### 3. Integrated DINOv2
- Load a user-configured **full Hugging Face DINOv2 model folder** from the existing models configuration; weights alone are insufficient.
- Use optional compatible torch/transformers dependencies with a documented environment setup, not a second WebCap service.
- Cache each unique training reference embedding by model revision, preprocessing version and source-media fingerprint. Store generation embeddings/results economically.
- Coordinate GPU use with WebCap's existing reservation rules; don't keep the encoder loaded when conflicting GPU work owns the device.
- Report raw, labeled similarity separately; don't claim it is a calibrated fidelity probability.

### 4. Evidence-centric UI and validation
- Consolidate results in the **existing Epoch Finder** view: generated frame, relevant full-image reference, resolved prompt, existing VL options/verdicts, RVN attribute/fidelity judgments and DINO similarity.
- Browse comparable tests across epochs and view aggregate coverage/counts; make manual rating/selection and continuation into Test Generations easy.
- Preserve a usable inspector as the new evaluators are added; avoid scattering results across unrelated cards.
- Include early and late saved epochs, controlled prompts/seeds and manually preferred historical checkpoints when evaluating predictive value.
- Only consider modifying relative ranking/elimination in a separate, empirically justified change.

## Important implementation invariants

- Existing campaigns load without new keys; never reinterpret their legacy scores.
- Do not discard successful frame evidence before opted-in new assessments are complete, but retain current cleanup policy otherwise.
- Source training images, captions and annotations are read-only during evaluation.
- A Set tag identifies candidate membership, **not guaranteed feature visibility**; the user approves representative examples.
- No cross-dataset reference leakage; invalid paths, symlinks and changed files fail explicitly.
- Generated images and approved reference images are whole images unless a future experiment specifically proves cropping necessary.

## Still to verify on the real machine

- Persisted scoped-tag value shape and exact group-name mapping to wildcard dimensions.
- RVN Q5 accepting and correctly comparing two simultaneous images.
- Local DINOv2/SigLIP2 folder completeness, Python dependency compatibility, memory footprint and GPU arbitration.
- End-to-end preview, persistence and regression tests. Phase 1 foundation alone is not a complete working campaign.
