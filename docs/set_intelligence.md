# Set Intelligence

## Focused Deep QA set review (2026-10-12)

Deep QA is now an explicit, bounded **set-wide investigation** rather than an unattended caption challenger/quality judge for each media item.

- Input: current filtered training selection, approved grouped/unscoped tags, vocabulary with group aliases, caption primer and training focus, **plus compact evidence mined from fresh saved Open Sight** (including singleton objects/properties omitted by vocabulary-frequency filtering). Full captions and per-item Sight are not repeated. The 160-evidence budget is explicit; unavailable Sight is not interpreted as visual absence.
- Output: up to five ranked, consequential hypotheses about omitted or inconsistent training-relevant concepts, including concepts absent from both captions and tags. Zero is valid.
- Each hypothesis includes a specific question, a falsification criterion, and up to five justified candidate media (or none when unsupported). **Investigate** invokes existing cached-Sight Concept Check on only that shortlist, preserving missing-Sight counts and human review. The dismissal criterion is guidance, not an automatic verdict. Only concrete Concept Check actions flow into QA Focus Review.
- Deep QA itself performs no VL scans, tag assignments, caption generation, or edits. It retains the existing model queue, cancel control, set scoping, and QA review persistence.
- A token-budget preflight estimates prompt plus bounded output and warns about known context overruns, with explicit **Proceed Anyway**. Unknown context is not a gate.
- Saved legacy per-item Deep QA results remain available as explicitly labeled, action-backed legacy findings until replaced by a new set review; they are never reinterpreted as new investigations. Changes to the Set, its annotations, vocabulary, primer, Sight or training focus invalidate the current review; rerun explicitly when ready.
- Balance and technical hygiene remain separate supporting analyses. The old per-item contract remains for existing Concept Check/recheck callers.

This section supersedes the older per-item Deep QA implementation notes below. Semantic reliability of novel discovery still requires acceptance testing against real Sets.


Status: focused LLM/VL-driven annotation workflow.

## Approved primary workflow: from media folder to reviewed training Set (2026-10-11)

**Status: agreed target; integration not yet implemented.** This supersedes the previous caption-first, Caption Assist/Deep QA-centered strategy. There are **two preparation steps and one continuous per-item validation flow**, not separate tagging, caption generation, QA review, and human sign-off ceremonies:

1. **VL scan first.** Explicitly scan the selected media with the chosen Vision model. Persist rich Sight evidence for reuse. Observations are fallible; users can explicitly refresh them. Opening a view must not launch inference.
2. **Vocabulary discovery second.** The Director uses saved Sight to suggest concept-specific groups and terms; the user approves/refines the vocabulary. The **existing primer template and preferred structure are largely established**: extend it only for additional concept groups that genuinely apply, rather than asking the Director to continually reinvent caption phrasing.
3. **One guided validation pass over the media.** For each item, the Director maps Sight to the established groups and terms, suggesting applicable tags, corrections, and missing vocabulary where justified. The user **accepts, edits, or rejects tags** in the existing annotation interface. **The primer produces a strong, consistent caption baseline** from approved annotations. **Existing Caption Assist may still propose a complete caption or targeted improvements**, using Sight, the annotations, and primer guidance; this remains part of the same item-level interaction, not a separate workflow. The user can accept or edit the result, then **finish/review/advance**.

**Authority and ownership:** Sight supplies visual evidence; the Director recommends semantic assignments; the **human-approved annotations are authoritative**; the primer guides default caption structure and consistency. Caption Assist remains free to suggest a well-grounded, editable caption without replacing the primer or the user's approval. Do not automatically apply tags, overwrite authored captions, or mark individual groups reviewed without the user's explicit review action. Preserve existing manual caption editing and item-level assist options.

**Afterwards, optional Deep QA** serves as a **high-bar, high-precision exception search** for consequential, evidenced omissions or contradictions, ideally with a concrete fix. No finding is a successful outcome. Keep inexpensive deterministic clues (Missing Captions, Tag Mismatch, Reviewed/Unreviewed, technical checks) accessible; demote low-value or confusing workflow clutter rather than layering additional overlapping QA machinery. Incomplete currently measures unchecked requirement groups and must not be represented as an independent overall quality verdict.

Reuse Set Intelligence, Vocabulary Discovery, Guided Tagging, Focus Annotation, the Primer, Caption Assist's existing editing/actions, and existing review/navigation/filter infrastructure. Do not introduce a new editor, queue, evidence cache, automatically selected rescan scheme, or separate wizard-state system. If preparation was already done, users can enter the guided validation flow directly. **The intended user experience is: scan → establish vocabulary → validate tags and caption together, item by item → optionally run final Deep QA.**

## Guided Validation implementation slice (2026-10-11)

**Feature branch implementation; browser acceptance remains pending.** Single Item now has an explicit per-item **Suggest Tags** action using the existing `suggest_tags` Director operation and cached Sight, with canonical vocabulary candidates rendered as temporary draft chips in each Group Workbench group. Selecting suggestions only edits the session draft; **Apply Tags** explicitly assigns selected terms and **Discard Proposals** rejects the batch. The established Guided Tagging Grid pass, Focus Caption, and Caption Assist editor remain independently usable.

**Validate & Next** explicitly saves the current caption, writes a separate human-approved `ai_validation_receipts` entry to existing Set folder state, and advances through the current filtered Media List. The **Needs AI Validation** filter includes missing/stale receipts; staleness compares final caption, assigned tags, and saved Sight, not whole-Set group configuration. New vocabulary approved through Discover Vocabulary invalidates receipts only for media linked by the Director's cited Sight evidence IDs. Other edits do not automatically start inference. No parallel cache, full-Set scan, or new model runtime is introduced.

Remaining polish is limited to browser QA of autosave/selection/filtered navigation, integrated Caption Assist presentation, and refinements arising from actual use; no replacement of Focus Caption or Grid Guided Tagging is implied.

## Master of One

- **Set Intelligence / Sight** captures reusable visual observations.
- **Discover Vocabulary** defines the concept's annotation language.
- **Guided Validation** integrates group-tag selection, primer composition, existing Caption Assist caption proposals, and human review in a single per-item interaction.
- **Deep QA** optionally detects rare, substantial residual errors after validation; it is not the main route to create or improve captions.

Supporting analyzers remain cheap evidence or filtering utilities, not competing workflows.

## Set Intelligence

**Set Tools → Set Intelligence** is the primary entry point below the media list.

By default, Set Intelligence uses the **current visible training selection**, respecting text filters, advanced filters, and Focus Sets. **Scan entire Set (ignore filters)** is an explicit override. The selected scope is snapshotted for the Vision scan, so changing filters does not expand an in-progress scan. Discover Vocabulary and Set-level Guided Tagging remain Set-wide and can reuse any cached Sight evidence, including from prior broader scans.

The intelligence path is fundamentally model-driven:

- the selected **Vision** model performs one broad **Sight** discovery pass per image, optionally guided by group names and aliases without assuming assigned terms or narrowing discovery;
- each valid observation is saved in `vision_sight`, reused until the media changes, and replaced only by an explicit refresh;
- the selected **Director** model interprets compact, workflow-specific evidence for Vocabulary Discovery, Guided Tagging, Caption Assist, and QA;
- WebCap's deterministic metadata, Face Focus, MediaPipe pose, Scene Complexity, Prune, Duplicate, and other signals remain supporting evidence and constraints.

Legacy `vision_vocabulary_sight` records remain readable by the compatibility code but are not generated or automatically forwarded. Sight is fallible visual observation, not a final training caption or an authority over user annotations.

Set Intelligence itself requires the selected **Vision** model because that explicit run performs the pixel reads. Director availability is checked only when a downstream semantic interpretation workflow actually needs it. The workflow must not present a successful deterministic-only scan as equivalent to semantic Set understanding.

Current versioned evidence is reused. No separate scan manifest or durable workflow-state file is created.

### Visibility

The Set Intelligence surface shows one Sight coverage count for the selected scope, progress, failures, and an optional cached Vision report. Opening it never starts a scan. **Run/Resume** reads only missing Sight; **Force Refresh Sight** explicitly replaces successful observations. Failed responses preserve older evidence, and partial coverage can still inform downstream work.

Closing the modal does not stop an active scan. The explicit Stop action cancels the current job, and completed per-item writes remain usable. No second cache or scan manifest is created.

## Data ownership

Reusable per-media evidence stays in the Set's existing `media_metadata.json`.

Current blocks may include:

- base media metadata;
- `scene_complexity`;
- `face_focus`;
- `selection_pose`;
- `vision_sight`;
- `vision_vocabulary_sight` (legacy, temporarily readable only);
- other analyzer-owned blocks.

Each analyzer owns its own versioning/invalidation rules. Set Intelligence does not create a second cache.

Unfinished Caption Assist caption candidates may be retained in existing Set folder state for inexpensive re-entry; applying a candidate removes that saved proposal. Guided Tag steps and modal progress remain ephemeral. Completed Deep QA findings and QA review dispositions are saved as Set-owned review state in `.webcap_qa_review.json`; reusable per-image Sight remains in `media_metadata.json`. The review stores compact input fingerprints, not a duplicate of the underlying captions or image metadata.

## Item-level checks and refresh

Caption Assist reuses saved Sight if valid, fetches missing Sight when explicitly invoked, and lets the Director propose editable caption text using the current annotation inputs. Unfinished candidates remain in existing Set state. **Refresh Sight** explicitly reruns one image observation; **Recheck Caption (Vision)** is a distinct image-to-caption inspection. Neither triggers a Set scan or writes user annotations automatically. New models can be selected for an explicit fresh observation; changing the selected model alone does not invalidate saved visual evidence.

## Discover Vocabulary

Purpose: decide **what the Set vocabulary should contain**.

Vocabulary discovery deliberately reuses normalized Sight inventory. The Director proposes terms, extensions to existing groups and novel dimensions, followed by a separate challenge pass. This is not an additional pixel scan. Evidence is bounded to keep Director inputs focused; the underlying item observations remain cached.

Discovery does not assign tags to media and does not perform its own Vision scan.

Support counts are visible. Representative thumbnails plus rationale/evidence are available behind an optional reveal. Review only surfaces groups with an actionable vocabulary change; groups whose proposals are already fully present are skipped. Closing and reopening Discover Vocabulary preserves the current browser-session review. A failed challenge can be retried from the saved synthesis draft; **Restart Discovery** is the explicit full Director rerun. Slightly overcomplete vocabulary is acceptable: proposed terms are available language, not requirements to use every term. Missing a meaningful recurring distinction is more costly than retaining an extra plausible term.

## Guided Tagging

Purpose: apply **existing vocabulary** efficiently.

After vocabulary review, the Director prepares per-item candidate assignments from cached Sight, the **final vocabulary**, and current assignments. Large Sets are prepared in bounded batches so the per-response item limit cannot silently truncate the Guided pass. This preparation does not inspect pixels again and does not invent vocabulary in the Guided flow.

The interaction remains in Grid: one tag proposition, likely media preselected, explicit human correction/application, then the next proposition. Guided Tagging consumes the prepared candidates; it does not reinterpret the image itself. Completing Vocabulary review presents **Continue to Guided Tagging** as the primary next action and launches this Grid flow directly.

## Quality Assurance

### Deep QA's reduced role (agreed target, 2026-10-11)

Deep QA is **optional final validation**, after the Sight → vocabulary → guided tagging/primer/human review path. It must be conservative: raise only substantial, evidence-backed training-caption or annotation problems with a clear actionable suggestion; do not turn stylistic differences, uncertain visual guesses, or incidental dataset statistics into work. A successful run can produce zero findings. Reuse saved Sight and existing review/correction tools; do not automatically infer on opening QA. An independent extra Director challenge pass requires demonstrated value and is not part of the default guided validation path.

**Current implementation differs:** Deep QA still generates a Caption Assist candidate and runs a separate QA Director evaluation. The existing Caption Assist caption-generation capability remains valuable and should be reused, not removed. Its relationship to the primer can be refined based on demonstrated gaps. Migrating the old Deep QA-first orchestration requires separate, tested code changes. This document locks product direction only.

**Primary navigation:** Set Tools → **Prepare Set** collects Sight and guides vocabulary/tagging. **Quality Assurance** is the single Set-level QA entry point. Opening QA only shows saved checks; it never starts inference. **Start QA & Review** explicitly starts or resumes Deep QA and opens the existing QA Focus Review queue, where confirmed actionable results arrive progressively. **Run scan only** preserves the standalone Deep QA action, and **Review & Fix saved findings** opens the existing correction flow without starting a scan. Targeted concept checks and full reports remain available as secondary QA tools; per-item Vision rechecks remain explicit.

Purpose: reduce the amount of material the user must personally inspect.

The new intelligence value comes from semantic interpretation and cross-signal synthesis. Deterministic systems remain useful evidence producers, but should not be promoted into strong semantic recommendations by themselves.

High-confidence findings should prefer corroborated evidence and exact known actions. Lower-confidence observations should remain available but buried rather than competing with the attention queue.

Deep QA is user-initiated and progressive. It interprets current inputs in bounded Director batches, publishes completed batch findings immediately, and keeps exact per-item input fingerprints so later caption, assignment, or Sight changes make only affected items eligible for reevaluation. If Set Intelligence is still running, an active Deep QA session may wait for newly saved evidence and continue as it arrives.

Captioning findings may carry exact `add`, `replace`, or `remove` patches derived from cached evidence. Replace/remove source text and optional add anchors must match the submitted caption exactly. These patches are proposals only; they are handed to the shared Focus Review / Caption Assist correction UI for explicit preview and acceptance.

Optional raw reports remain reference utilities, not the main QA experience.

## Future model passes

A future Set Intelligence scan may add targeted follow-up Vision questions or a larger Set-level reasoning pass when a proven information gap justifies the extra GPU/context cost.

Do **not** add stochastic reruns merely to obtain different wording.

A follow-up pass belongs only when it asks a materially different question that improves Vocabulary, Guided Tagging, or QA.

## Mutation boundary

Set Intelligence is analysis only.

Discover Vocabulary changes vocabulary only after explicit selection.

Guided Tagging changes assignments only after explicit application in Grid.

QA does not silently repair captions, tags, media, or reviewed state.

The operating rule remains:

> **Models direct attention and propose meaning; WebCap performs explicit, deterministic user-authorized mutations.**
