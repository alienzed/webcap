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


## Implementation inventory (PR #376, not yet production-verified)

- **Reference discovery:** `tool/server/epoch_reference.py`; strict scoped-tag candidate and vocabulary API, image-only references, stable ordering and freshness identities.
- **Campaign wizard:** full-image reference selection for every scored choice with previews, approved-reference progress, and RVN/DINO opt-out checkboxes enabled by default.
- **Launch validation:** backend demands a complete, exact-tag-approved reference set and saves frozen choices in `campaign.json`. Old campaigns without these fields continue to load.
- **Paired RVN:** ordered A/reference and B/render with numbered wildcard choices plus MATCH/PARTIAL/MISMATCH/UNCLEAR; saved alongside existing VL judgments, not fed into legacy ranking.
- **DINOv2:** optional local Hugging Face CPU inference; source-reference embeddings cached within the existing campaign workspace. Generated frames are not cached. The model is deliberately CPU-only for now to avoid racing GPU reservations.
- **Evidence:** per-epoch coverage, evaluator errors, clickable thumbnails, enlarged inspector with approved reference images, VL/RVN/DINO details and Copy to Test Generations.
- **Tests:** request-image ordering and exact scoped-tag lookup tests added, but Python tests, visual browser tests, and real hardware tests have **not** run here.

### Local DINOv2 setup (required when DINO checkbox is enabled)

WebCap's existing Python interpreter/virtual environment must provide optional `torch`, `transformers` and `safetensors` packages (as well as existing Pillow). Install them in that environment using its Python executable, e.g.:

```sh
python -m pip install torch transformers safetensors
```

A **complete Hugging Face DINOv2 snapshot** with `config.json`, `preprocessor_config.json`, and `model.safetensors` (or `pytorch_model.bin`) must be in a dedicated folder **directly under the configured WebCap models/text_encoders directory**. Standalone downloaded weights are not sufficient.

One supported example:

```sh
hf download facebook/dinov2-base --local-dir /path/to/models/text_encoders/dinov2-base
```

`hf` is the Hugging Face Hub CLI (install via `python -m pip install huggingface_hub` if needed). The configured models root must be accessible from the Python process running WebCap. No model is downloaded or installed automatically by a campaign.

DINOv2 model and dependency presence is checked **before launch**. Reference-embedding cache keys include source file size/timestamp, model weight size/timestamp and processor timestamp. Cache files live within the owning campaign and are removed with its data; no hidden dataset-root cache or unmanaged localStorage. CPU execution is a correct first integration but actual per-image timing must be measured before calling overnight performance adequate.

### Screen-by-screen common-sense UX audit

1. **Run:** Select saved run/epoch subset; no implicit candidate deletion; switching runs discards stale reference selections.
2. **Tests:** Confirm wildcard labels and resolved option lists; scored options require matching training references, vary-only values do not.
3. **Rounds:** Existing plan and ETA remain; new evaluator overhead is not yet included in ETA estimates, so don't claim ETA covers it.
4. **Launch:** Review the campaign, choose one actual reference per scored option, see selected reference preview and a clear approved/required count, choose RVN/DINO checkboxes. Block launch when incomplete; server independently validates against actual dataset.
5. **Running campaign:** Existing render/VL progress remains; separate RVN and DINO completed/error counts. Never automatically start an inference request from mere navigation.
6. **Leaderboard:** Legacy VL score remains labeled as concept fidelity; adds simple RVN/DINO coverage, not unvalidated aggregate scores.
7. **Evidence:** Click a gallery frame or epoch ranking, inspect actual render and approved training images, resolved prompt, choices, RVN reasons and DINO similarity. Copy a selected epoch to Test Generations for user-driven testing.
8. **Recovery/failure:** Persist per-attribute RVN evidence and per-reference DINO evidence incrementally; show failed evaluators independently; retain frames with new evaluator failures. Existing pause/resume and history remain.

### Remaining verification and follow-up polish

- Verify on a **real tagged Set** that the saved `caption_group_tags_by_media` shapes match exact lookup; adjust only to observed persisted format.
- Confirm selected local RVN Q5 receives both images and can reliably choose options and fidelity results; inspect failures/latency.
- Confirm DINO model snapshot, compatible dependency versions, measured CPU throughput and cache reuse.
- Run repository Python tests and live browser/mobile-width smoke, including empty/ambiguous references, changed source files, changing Sets, interrupted/resumed campaigns and zero new assessment on legacy campaigns.
- Recalculate runtime projections once RVN/DINO timings exist. Do not introduce unvalidated rank changes.



## October 17 extensions: on-demand Test comparisons and workflow FIFO

**Implemented on the draft branch; live runtime/visual tests remain required.**

### Test Generations evaluator dropdown

- The existing **Ask VL — Original** action and its `test_vision` scoring record remain unchanged.
- **VL Compare — Training Reference** and **DINOv2 Compare — Training Reference** are selectable methods beside the original action.
- A modal selects one wildcard attribute, its exact-tag Set group, its expected option, and a **user-approved full-image** training reference. It compares the selected feature against every saved preview in the current Test session.
- Videos are represented by their first extracted frame; image media use the full image. No implicit rerender or user-independent automatic scan.
- RVN uses existing asynchronous caption/vision LLM queue, keeps controlled option selection and fidelity verdict, and stores the raw response. DINO uses the local optional CPU encoder and reports cosine similarity, not a fidelity percentage.
- Results are durable per Test session in a **separate `test_reference.json`**, under the existing Test session owner; its `reference-embeddings` subfolder caches reference embeddings. Neither alters legacy `test_vision` scoring or candidate ranks.
- Browser-run on-demand comparison sequences may stop on tab refresh; each **completed comparison** is already saved and available after reopening. The original Ask VL/Batch controller is not replaced.

### Shared, high-level workflow admission (without low-level queue changes)

- `tool/server/workflow_gate.py` grants **FIFO admission** to Epoch Finder, Batch and First Cut; it does not own GPU operations, execute tasks, override ComfyUI, or change any existing inference or LLM queue ordering.
- `tool/js/workflow_gate.js` allows the **existing browser-owned** Batch and First Cut controllers to wait for admission and release when their coordinated work ends. Existing First Cut/Batch internal sequencing remains intact.
- Epoch Finder obtains a gate ticket in the server worker before queuing any generated tests; server-owned Epoch tickets never expire during long campaigns and are released in a `finally` block.
- Browser workflow tickets heartbeat and are removed if abandoned after 180 seconds. Losing a ticket stops further workflow submission rather than silently running out of order. Cancelling a **queued** First Cut does not reset the unrelated LLM queue.
- Epoch Finder's own multiple-campaign FIFO remains in place; its waiting campaigns have explicit pause/stop/remove options, and never auto-resume after process restart. The admission gate is **process-local**, not a new durable execution queue; on server restart all affected workflow owners must reconcile/explicitly resume.
- The FIFO ordering is of **workflow admission**, not every GPU operation or user action. Independently initiated LLM/inference jobs still obey the established lower-level queue rules. Second and subsequent browser-local First Cuts are registered with the shared gate when their own local First Cut turn begins, not when first queued in the Storyboard UI.

### Safety/UX audit of added scope

1. **Choose run/evaluator:** Original Ask VL works unchanged; new menu methods visibly require a reference.
2. **Choose reference:** Display exact eligible scoped tags and their image candidates; show a full-image preview, avoid fabricating missing mappings, require explicit launch.
3. **Queue:** Batch, First Cut, Epoch Finder all enter one admission gate; while waiting they show queued state. Submission begins only when admitted.
4. **Execute:** Existing lower-level queues still serialize inference and LLM requests. The new reference VL enters the existing LLM queue with the original Test session context.
5. **Review:** Reference evidence never overwrites legacy VL percentages; show RVN feature verdict/options/reason or raw DINO cosine separately.
6. **Cancel/interruption:** Queued workflows can be stopped without cancelling another workflow's LLM request. Stop submitting upon lost admission; completed Test comparisons and accepted Test sessions remain saved.
7. **Restart:** Never silently resume. Backend Epoch campaigns become explicitly resumable after restart; browser Batch/First Cut coordination is not durable and must be reinitiated.

### Required machine-side gate before merging

- Run `pytest tests/test_epoch_reference.py tests/test_test_reference.py tests/test_workflow_gate.py tests/test_epoch_finder_queue.py tests/test_epoch_finder.py` in **WebCap's venv**, alongside repo's normal JS tests.
- Verify normal original Ask VL scoring/rerun, then RVN and DINO on one real tagged Test session with both image and video previews.
- Run at least two Epoch campaigns and a Batch + First Cut admission scenario, including cancellation during waiting, browser refresh, server restart and visible progress. Validate there is no surprise model/inference job preemption.
- Verify DINOv2 Base from the real local snapshot and installed torch/transformers dependencies; measure its CPU throughput.
- Check developer console, global Console, and storage audit, and confirm no new hidden Set-root state or localStorage.
- No merge before those runtime checks pass. Repository JavaScript syntax checks were performed using JS parsing; Python tests and live UI runs have **not** been executed in this tool environment.
