# QA Curate — training-quality curation contract and phased delivery

Status: **design contract committed first (2026-10-30); workflow-clarity implementation completed in PR #840; Evaluation parity and QA Focus Review CI passed; live UX and trained-LoRA outcome validation remain pending**. This supersedes the original copy-to-Set handoff. Keep the existing bold, readable fullscreen UX. Work inside the current QA/Media List/Focus Set/Training architecture, as directed by `AGENTS.md`.

## 1. Outcome and ownership

The goal is **better trained LoRAs**, not a cosmetically balanced histogram, a perfect proxy score, or a fixed image count. A useful curated subset should teach the desired identity/constructions, retain meaningful poses/viewpoints and difficult examples, minimize repeated/low-value observations, and avoid avoidable low-fidelity or misleading supervision. No numeric heuristic guarantees better training: candidate quality is ultimately assessed by controlled LoRA tests against common prompts and checkpoints.

- Source Set is authoritative for media, captions, grouped tags, ratings and metadata. **Never create another editable Set** as Curate's normal outcome.
- Existing Focus Set is the working selection. `Curate -> review -> Use for Training` activates it on original filenames; the user explicitly starts training, whose normal immutable run capture is separate from source editing.
- Existing QA Curate Director classifies bounded human-approved grouped-tag concepts as CORE/SUPPORTING for balance; a separate bounded interpretation of authored captions supplies distinctive visual evidence. WebCap deterministically ranks media. Preserve opt-in, visible queued work.
- Keep analyst judgment: allow re-inclusion/exclusion and explain evidence and uncertainty. Do not silently rewrite tags, captions, ratings, or media.

## 2. What improves training: prioritize evidence, not attractive proxy numbers

Rank signal families in this order; availability and reliability are part of the decision. No fabricated quality score.

1. **Relevance and correct supervision** (highest): image clearly depicts the requested concept/construction and caption/tag accurately represents visible, learnable features. Saved authored captions are the richest item-specific description; grouped tags supply consistent balance categories. Sight is not selection evidence. Human validation/explicit quality problems should dominate uncertain automated cues. Source signals: approved grouped tags, saved caption, QA validation/review evidence; note that existing AI Validated is not proof of perfect training fitness.
2. **Unique useful learning coverage**: distinctive construction, viewpoint/pose, subject scale, visual context, and hard examples. Diminishing returns for repeated concept evidence; preserve rare essential cases. Use explicit caption-derived visual distinctions alongside grouped tags; model interpretation is still fallible. This is a *coverage heuristic*, not proof that two images are visually redundant.
3. **Source resolution as a tie-breaker**: when images contribute essentially equivalent useful concept evidence, prefer the source with more native pixels (e.g., 768x768 over 384x384). This is a straightforward choice between competing images, **not** a global image-quality score, resolution cutoff, model-target/bucket calculation, or reason to sacrifice unique poses and constructions. A higher-resolution image can still be blurred, poorly framed, or mislabeled.
4. **Near-duplicate substitution**: where images are genuinely exact/near duplicates, prefer the one with better effective resolution, subject visibility, usable caption and other grounded quality evidence, unless the pair captures an important difference. WebCap already has exact SHA and dHash/compatible-aspect near-duplicate infrastructure in `tool/server/duplicate_candidates.py`; don't claim dHash proves semantic near-duplicates. Reuse *existing ready evidence* where practical, not an expensive new runtime at QA startup.
5. **Secondary, fallible signals**: face framing/visibility, crop/occlusion, scene complexity and Pose metadata may help explain tie breaks if they apply to the subject. `selection_pose` has face/body orientation, pose class, arm position and expression but is **not yet directly used as Curate concept evidence**. Treat unknown/unreliable pose as unknown, not an invented bucket. Existing scene-complexity penalty is mild and should remain secondary.
6. **Not trusted training-quality metrics**: file size, longest edge alone, beauty/aesthetic appeal, number of caption words, term frequency, presence of generated metadata, high resolution by itself, and raw blur/compression heuristics are not sufficient alone. A general sharpness/blur/artifact score is **not implemented**; if added, first validate it across downsampling/scene content, make it visible and explainable, and don't hard reject without evidence.

### Resolution policy (simple, deterministic tie-break)

- Read original width and height from cached `state.items[*].metadata.resolution`, computing source pixel area (width × height). Do not look up training-model buckets, invent a reference size, or rescale scores by an arbitrary target.
- Score weighted concept coverage and the existing mild scene-complexity preference **without any resolution multiplier**. Only when candidates' marginal scores are effectively equivalent (a narrow, documented relative tolerance) choose the one with larger known pixel area. Missing dimensions mean **unknown**: do not infer low quality or invent measurements; otherwise keep stable source order.
- A low-resolution image that provides materially different/rare learning evidence still wins on coverage. The comparison is a pragmatic preference between competing examples, **not** a measure of sharpness, artifacts, or suitability for a particular model.
- Show actual dimensions (`768×768`, `384×384`) or `Resolution unknown` without 'meets target' or 'below reference' claims. When relevant, explain 'Higher source resolution broke a near-tie.'

### Balancing and cross-category coverage

- **Coverage optimization** and **distribution balancing** are different. Keep the diminishing-return coverage selector. Never quietly impose equal quotas for standing/kneeling/front/rear, which may harm concept identity.
- User-selected groups (e.g., Position and Viewpoint) drive explicit **marginal** concept coverage. Show counts for *every relevant term in those selected groups*, selected/available, not an arbitrary "top nine most frequent CORE" chart. Report that counts are representation, **not target quotas or validation of LoRA quality**.
- When two user-prioritized groups have human-approved tags, add a **modest, bounded diminishing-return bonus for observed pair combinations** during deterministic ranking. This can preserve rare but well-evidenced cases such as rear + kneeling without equalizing all combinations, inventing unsupported cells, or displacing a materially stronger core construction. No extra Director call; bonus is secondary to individual CORE concept coverage.
- Show an optional **Position x Viewpoint** or two-user-selected-group coverage matrix when both have reliable grouped tags and meaningful combinations. Cells are observed co-occurrences (multi-label permitted), not inferred or forced gaps. No auto-fill and no equalization of an unsupported pair. Distinguish absent data from genuine zero.
- Default gallery ordering should be labeled **Selection rank (marginal contribution)**. Offer group/term filtering or grouping as *presentation only* (an image may appear in multiple groups). Don't sort selection choices as though there is only one correct categorical group.
- Existing Lean/Balanced/Broad are **small/middle/large retained subsets at heuristic diminishing-gain thresholds**, *not* an optimization of balanced demographics or joint frequencies. Disclose this under the controls; consider naming the middle option "Standard" in a later deliberate UI change if confusion persists.

## 3. Explainability and review workflow

Keep the spacious card/fullscreen treatment and stable navigation footer. Make questions answerable in-place, not in a distant tooltip.

- **Summary**: selected count, represented *important* concepts, and evidence coverage; all weighted metrics clearly identified as proxies. Priorities for selected groups shown first.
- **Distribution view**: grouped term counts for selected priority groups (selected/available), optionally co-occurrence matrix; remaining/unknown/unscored indicators. Avoid ranking visual importance by raw frequency.
- **Item gallery**: filename, resolution, selected status and one **specific reason** grounded in measured marginal gains or a real tradeoff, not just a random tag chip. Keep an inspect action for any included or excluded item.
- **Fullscreen Include/Exclude Review**: exact filename, visible *current* grouped tags, current caption (optional expand), resolution/source context, material concept contributions, selected vs available term evidence, and an **Inspect in Single Item** action. Returning must retain list, position, included/excluded decision, review and manual overrides. Read current tags/caption from authoritative `state.items`, not a frozen curation snapshot. If source item was removed, show missing explicitly.
- **Why selected / why not**: explain what a candidate uniquely contributed *at selection time*, or why an excluded one added little after earlier picks; state explicitly when such explanations come from proxies rather than measured visual similarity. A manual override is a manual choice and must not be mislabeled as automatically recommended.
- **Compare** Lean/Balanced/Broad and custom using counts and coverage. A preset action may replace current choices only when explicitly clicked. No hidden reranking of manual choices.

## 4. Durable work, staleness, and cost

Curation is expensive; **analysis and user choices are durable work**, not a view that dies on any text edit.

- Persist one Set-owned snapshot via the existing `.webcap_curate.json` storage route; migrate/read v1 safely. Snapshot includes original analyzed file membership, bounded concept IDs and their definitions, Director role decisions, weights and evidence, ranking / preset membership, user choices, selected priority groups and manual overrides, and original evidence fingerprints. No media copies, no new global state, no extra LLM call to restore.
- Distinguish **structural invalidation** (Set changed or analyzed item missing), **evidence drift** (caption/tag, pose, resolution changed) and **presentation changes** (filter/focus set navigation, ratings or unrelated QA settings). Presentation changes alone **never** stale a curated result.
- Evidence drift is **nonblocking**: display exactly what changed and how many items are affected; preserve all old analysis, selections, and user edits; allow review and use of the saved recommendation with a visible "based on earlier evidence" indicator. Changes that can be deterministically recalculated use existing saved concept definitions and current metadata, without a Director rerun. Do not invent new Director priority judgments.
- Only explicit **Reanalyze** spends GPU and replaces the Director result. Preserve the existing draft until a successful replacement, including on queue failure/cancel. If the training objective changes significantly, recommend (do not require) reanalysis.
- Once a Focus Set is applied for training, QA Curate's **analysis scope remains the original source selection**, not the now-smaller working Focus Set. The return path restores the previous focus context; no inadvertent "Stale! Reassess!" trap.
- If needed for safe implementation, introduce a bounded v2 state with a clear migration; avoid multi-session management and extra service layers. Persist writes atomically through existing route and keep visible error reporting.

## 5. Phased implementation with acceptance gates

**Document first (this commit), then code.** Keep each phase reviewable.

1. **Durability / scope first.** Stable original-scope restore on return, retain full saved analysis and user changes when live input changes, explain drift. Regression: leave/reopen, change caption/tag/rating, navigate a Focus Set, mid-run Director failure, source removal. Avoid irreversible stale state.
2. **Quality and resolution ranking.** Supply real metadata dimensions; a deterministic source-pixel-area tie-break among near-equal marginal concept contributions, preserving rare CORE coverage. Verify 384 vs 768 with comparable evidence, a unique low-resolution counterexample, differing aspect ratios, and unknown dimensions. No training-resolution assumptions or unverified 'trained quality' promises.
3. **Evidence and balanced-category experience.** Replace opaque top-nine chart with priority-group coverage, add optional pair matrix if backed by observed grouped tags, label selection rank, show explainable per-item contributions and what the presets really mean. Test term counting, multi-label and zero/unknown reporting.
4. **Inspect and return.** Show filename/tags/caption/resolution and actionable inspection from both gallery and fullscreen; restoring navigation doesn't mutate choices or QA scope. Test with included, excluded, and edits.
5. **Real LoRA evaluation.** Use the existing training/evaluation Test/Matrix workflow to compare curated subset vs baseline on consistent prompts/seeds/model and training budget. Record factual results; do not infer outcome from a high proxy score.

## Evidence and current constraints

- `tool/js/qa_curation.js`: compact concept inventory, deterministic marginal-gain ranking, session draft, high-frequency top-nine "Core" chart and optional large-review UI.
- `tool/js/qa_workbench.js`: full Deep QA signature includes captions/tags/primer/filters/metadata; not a good Curate invalidation contract; Pose/face/complexity are currently compacted but only tags and Sight feed Curate concepts.
- `tool/js/review_output.js`, `tool/js/media.js`, `docs/filtered_selection_set.md`, `docs/dataset_workflow.md`: Focus Set narrows visible selection and each Train action captures its own immutable run bundle.
- `tool/server/duplicate_candidates.py`: SHA/dHash near-duplicate detection at compatible aspect ratios, not semantic sameness.
- Sources explaining target-resolution/bucket semantics: https://github.com/kohya-ss/sd-scripts/blob/main/docs/config_README-en.md and https://github.com/bmaltais/kohya_ss/blob/master/docs/LoRA/options.md . Diffusers DreamBooth cautions that results also depend on train settings, not just images: https://huggingface.co/docs/diffusers/training/dreambooth .

### Deferred on purpose

Unvalidated neural perceptual embeddings, universal aesthetic/sharpness ranking, GPU-hungry video/frame analysis, forced category quotas, multiple per-Set curation sessions, speculative model-quality scores, and automatic reanalysis. Add such measures only after demonstrating that the measurement predicts better LoRA results on representative WebCap datasets.


## Implementation notes (2026-10-30)

- **Implemented on the review branch:** Focus Set training handoff (dependent on PR #831); v2 Set-owned Curate draft snapshot with backwards-compatible v1 reading; preserve selections through nonblocking input drift and interrupted reanalysis; simple source-pixel-area tie-breaking among near-equal concept contributions; prioritized term coverage and optional tagged group-pair matrix; inspect actions with current filename/tags/caption/resolution, plus resume position; tests for ranking, draft versions, drift and source inspection.
- **Still to verify:** complete QA + Training integration and responsive UI on a running WebCap instance, full CI contracts, model-specific treatment of visual quality and controlled LoRA results. Curate deliberately does **not** use a model-specific resolution target. Existing SHA/dHash duplicate evidence is available elsewhere in WebCap but has not been plugged into this scorer; no claim of semantic-near-duplicate detection or calibrated blur scores.
- **Review gate:** Do not claim these heuristics have proven improved LoRA outcomes until comparable Test/Matrix runs establish that result. Keep scoring transparent and user-overridable.

## 6. Workflow clarity and simplification — implementation phases (2026-10-30)

**Contract:** Maintain the existing large, readable Curate UI, source Set and Focus Set ownership, no copied datasets, no new GPU or Director calls, and no extra database/state services. This implementation addresses known behavior in `tool/js/qa_curation.js` and `tool/js/qa_workbench.js`. All operations remain reversible and explicit.

1. **Director result durability (correctness).** Capture the submitted folder and concept inventory when analysis starts; when its token and source folder are still valid, accept a completed validated Director result even if a caption, tag, QA setting, or current view changed during execution. Preserve the exact analyzed evidence in the saved draft and show evidence drift (with affected filenames) on return instead of throwing away paid computation. Do not apply a result to a different folder or a canceled/replaced job. Regression tests: mid-job caption/tag edits and signature/view changes, canceled request and folder mismatch.
2. **Explicit two-group balancing (correctness and UX).** Keep user-selected priority groups independent of an optional *pairwise* bonus. When at least two prioritized groups contain approved tags, show **Pairwise coverage: [Group A] × [Group B]** selectors inside the existing category section. Default to Position × Viewpoint when both names exist; otherwise choose two eligible priority groups in user order, never alphabetical sorting as an invisible choice. Preserve the user-selected pair with the existing v2 draft and reconcile it if priorities change. The same pair must drive both scoring and the displayed matrix. Multi-label cells remain observed data only; no forced quotas or inferred poses.
3. **Honest preset comparison.** Keep persisted keys `lean`, `balanced`, `broad`, but label the middle button **Standard** (not a balancing promise). Each large preset control shows its image count and *weighted annotated-evidence coverage* computed by existing `coverage(...)` on that exact preset shortlist. Current manual selections remain unchanged until the user explicitly selects a preset; do not rerank on display alone. No extra comparison dashboard.
4. **Useful human explanations instead of scoring noise.** Present a short evidence-grounded reason for the included/excluded candidate based on approved tagged concepts, selected coverage and rare/unique supported variation. Keep filename, source resolution, tags, inspection and full-screen return. Numeric marginal scores may remain in optional details/tooltip, not dominate every image. Do not claim visual similarity or actual LoRA performance from tags alone. Read cheap cached duplicate groups only when they are already complete, unmodified, and match the original Curate file scope; label exact vs *possible* duplicates accurately, never trigger duplicate scanning or GPU work and never hard-remove media from a hint.
5. **Quality gate.** Add deterministic unit/DOM tests for signatures changing mid-Director run, folder changes, pair scoring and saved axis round-trip, preset sizes vs displayed evidence coverage, clear reasons and cached-duplicate hint safety. Run WebCap's existing Evaluation parity validation and QA focus regressions. Correct existing contract assertions only when behavior has deliberately changed. Merge only after checks are green; controlled LoRA tests remain future empirical validation.

**Out of scope:** new model-specific resolution formulas, new embeddings/blur scores, image-copy exports, more top-level tabs, a new draft store, automatic expensive reanalysis, guaranteed distribution quotas, and unrelated refactoring.

## 7. Corrected selection objective: prioritized coverage only (2026-10-30)

This corrects the remaining overreach after PR #840: unselected supporting concepts such as `Background: painting` must not create standalone selection value or increase Lean / Standard / Broad sizes.

- **Primary evidence:** The groups checked in Balance priorities (e.g. Position and Viewpoint), with explicitly ignored concepts excluded. Eligible terms inside a prioritized group receive primary scoring weight; unselected groups are supporting regardless of Director's earlier CORE classification. The two explicitly chosen tagged axes supply a *bounded* co-occurrence coverage bonus, included in the primary objective and progress/size metric.
- **Ranking:** First maximize marginal primary-group and pair coverage. When primary gains are nearly tied (2% tolerance), use existing secondary concept variation to distinguish otherwise comparable images; source pixel area and existing mild scene complexity are additional quality tie-breaks. A rare background term can change the ordering of comparably useful candidates but cannot outrank materially better Position/Viewpoint evidence.
- **Shortlist size:** Lean / Standard / Broad thresholds depend exclusively on primary-group and pair coverage. Supporting concept frequency, rare backgrounds and secondary-only tail images contribute **zero** to the cutoff. If the user selects no priority groups, suggested preset sizes are zero with a visible instruction to select a group; a manually selected custom shortlist remains usable.
- **Explainability:** Cards and fullscreen review lead with `Position · kneeling`, `Viewpoint · rear`, or an observed rare Position × Viewpoint combination. If an image has no marginal primary value, say so (and optionally clarify that supporting terms only broke a tie). Never claim `Background: painting` justifies retention when background was not prioritized.
- **Preservation:** Keep existing saved v2 draft schema and legacy Director result. On restoring old rankings/preset sizes, recompute the deterministic recommendation from saved evidence and current priority groups, while preserving manually selected files and not spending GPU time. Never duplicate media.
- **Validation:** Test background-only candidate cannot extend a preset or inflate its coverage score, primary rare view wins over novel background, pair combination contributes to primary coverage, same primary evidence can be tie-broken by support and resolution, zero priority groups remain explicit, and user manual selections survive re-ranking.


## 8. Caption-grounded evidence correction (2026-10-31)

**Reason for correction:** Validated captions are the richest Set-level description of individual media; grouped tags deliberately describe recurring, filterable attributes and may omit an accurately captioned pose or one-off construction. Sight is useful upstream as a fallible suggestion but is not independently validated. Feeding Sight-derived concepts to Curate while excluding the captions from selection is the wrong evidence tradeoff.

**Keep:** Current Curate gallery/review, Focus Set handoff, user-selected group balancing, measured pair co-occurrence, diminishing-return deterministic ranking, resolution and existing complexity/duplicate evidence, Lean/Standard/Broad, saved choices and nonblocking drift. No new controls, GPU scans or editable media state.

**Revised evidence contract:**
1. Grouped tags supply explicit balance groups and their observed distribution. A missing tag never disproves an explicitly captioned concept.
2. Original authored captions supply optional *distinctive training-relevant visual observations*, such as an uncommon construction or body/garment relationship not covered by recurring tags. They are not treated as standalone extra balance groups. Director may interpret captions, but its extracted phrases are fallible interpretations and must be grounded to exact source excerpts.
3. Sight-derived objects/details/viewpoints have **zero** contribution to Curate inventory, Director requests, selection, tie-breaking, drafts and drift. Other QA/Prepare Set features still own Sight.
4. Existing resolution and scene-complexity tie-breaks remain secondary. No word-count/lexical rarity proxy; incidental unique words are not proof of useful uniqueness.
5. A strictly bounded, queued Director caption analysis can propose canonical per-image distinctions; no inference is started on opening existing drafts. Reuse existing QA LLM lane, cancellation, status and one Set-owned draft. Do not make captions user-editable inside Curate.

**Selection:** Preserve the current tag priority/pair objective, add a distinct, lower-weight diminishing-return caption-distinction coverage objective. A genuine caption-only distinction can still contribute after tag coverage saturates; it must not be hidden behind the 2% supporting tie-break or excluded from preset stopping criteria. Existing user-specified balance priorities and pair display remain tag-only. Display caption contributions as caption-derived, not verified image facts. Never claim a learned LoRA improvement without training tests.

**Safe delivery and gates:**
1. **Contract and evidence isolation.** Document this hierarchy; remove Sight-generated concepts from Curate and remove the Sight-missing notice/drift field. Regression: changing Sight alone never changes Curate; no cached Sight required.
2. **Bounded caption interpretation.** Reuse the existing explicit Director queue and job polling with sequential caption batches, each small enough for local model context. Normalize output using exact quotes tied to source captions, allow zero observations, reuse normalized canonical labels across batches, show progress, support stop, and preserve the previous draft on failure. Never silently drop a caption or fabricate source evidence. Tests: no captions, unique construction, paraphrases, false quote, bounded requests, cancellation.
3. **Deterministic integration.** Store compact caption concept IDs and per-file membership in the existing additive v2 draft snapshot. Score distinctiveness independently of tags, include in useful stopping conditions, preserve priority-group coverage and pair matrix as tag-only. Compare known one-off construction vs repeated tag matches and higher-resolution near-ties; keep manual choices. Old v1/v2 drafts remain readable without inference; classify their prior choices as Custom rather than silently reinterpreting old recommendations.
4. **Quality/review gate.** Run JavaScript and Python contracts and inspect diff; real-browser and controlled trained-LoRA comparisons remain empirical gates, not assumed facts. Surface any model-dependent semantic extraction limitations accurately.

**Implementation:** PR #847 adds caption evidence through the existing Director queue and keeps saved v2 choices; semantic extraction accuracy and trained-LoRA outcomes still require real-model evaluation.
