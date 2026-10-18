# Director-aware LoRA planning — product and implementation specification

**Status:** Approved product decisions; specification only, not implemented.
**Scope:** WebCap Generate and Storyboard. Follow `AGENTS.md`, `docs/filesystem_state_contract.md`, and existing queue/GPU invariants.
**Success condition:** Director meaningfully reduces manual LoRA discovery, selection, prompt vocabulary work, and per-scene configuration. A polished approval dialog cannot compensate for poor recommendations.

## 1. Product contract

Director should **find relevant enriched LoRAs, plan where they belong, and write prompts that use their documented vocabulary**. The user reviews the proposed changes before any LoRA assignment is applied.

Decisions:

- Plan LoRAs during Story development **and** reconsider them during later Scene revisions.
- **Always require approval** before changing LoRA assignments. A revision never silently replaces existing selections.
- Story-wide assignments inherit into every Scene; Scenes can explicitly override strength or disable inheritance using the existing Storyboard model.
- **Only enriched LoRAs are eligible for automatic suggestion.** Do not guess from filenames or recommend unenriched models. Manual selection of unenriched models remains available.
- Character/identity/style LoRAs may persist story-wide; progression or state-change LoRAs can change from Scene to Scene; situational LoRAs apply only where relevant. These are planning concepts, **not new runtime layers**.
- **UX is a hard requirement:** one concise review surface, pre-populated decisions, fast bulk approval, easy correction. Not a wizard, not a ten-page form.
- Director may choose **no LoRA** if none adds value. It must never fabricate a model, capability, strength recommendation, or trigger phrase.

### What this is *not*

This is **not** a manual metadata browser as the principal workflow. Existing manual metadata assistance remains useful but secondary. It is not a new scheduler, persistent agent, automatic background scan, progression engine, database, or replacement for Storyboard's current LoRA controls.

## 2. Confirmed codebase baseline (main, 2026-10-18)

- `tool/server/model_epoch_profile.py`: checkpoint-owned `.webcap.json` enrichment, imported safetensors/SD WebUI/Civitai metadata, Director enrichment suggestions, and optional embedded export. The current enrichment fields are `description`, `trainedWords`, `promptOptions`, and `guidance`.
- `tool/server/inference_runtime.py`: ComfyUI LoRA inventory via `LoraLoader` node choices, exact-name resolution, and portable embedded `webcap.profile` reads from ComfyUI. **There is no directory-wide automatic proposal catalogue yet.**
- `tool/server/storyboard_store.py::resolve_scene_loras`: merges inherited Story-wide LoRAs, enabled/strength overrides, and Scene-specific LoRAs; disallows duplicate Story/Scene assignments.
- `tool/server/storyboard_llm_contract.py::build_request`: existing scene/story Director prompt contracts. `tool/server/app.py` routes Director jobs via the shared LLM queue. Scene prompt operations already consume metadata for selected LoRAs, but Director does **not** discover and assign new ones.
- `tool/server/generation_director_contract.py::build_request`: `write_prompt` and `refine_prompt` return **text**, not structured LoRA assignments. `tool/server/generate_generation.py::prepare_request` already accepts explicitly selected `loras: [{name, strength}]`.
- `tool/server/epoch_test_bench.py`: staged candidate metadata available in Test; `tool/server/training_runner.py`: selected checkpoint/profile lifecycle and saved LoRA propagation.
- Existing front end: classic JS in `tool/js/generate.js` and `tool/js/storyboard.js`; modal markup in `tool/tool.html`. Respect ownership and script load order. Reuse central Activity and queue UI.

**Critical interoperability gap:** `webcap.json` lives beside a file in WebCap's configured paths, while ComfyUI reports logical LoRA names. An embedded `webcap.profile` exists only after explicit export. The new feature must identify *actual available ComfyUI assets* and find their adjacent sidecars without inventing paths or assuming all roots coincide. Verify the ComfyUI root mapping/path access before choosing the resolver.

## 3. Discovery and evidence contract

Build one shared, lightweight **eligible LoRA catalogue** from configured, accessible LoRA directories. Discover `*.safetensors` with adjacent `*.webcap.json` and `modelProfile.enrichment`; also accept embedded `webcap.profile` if available. Reuse existing configured filesystem ownership and ComfyUI's inventory. Do not add a new global state root.

Catalogue entries must have:

- Exact ComfyUI-selectable `name` / stable identifier, associated model or workflow family when known, and verified availability.
- Human-meaningful `description`, `trainedWords`, `promptOptions`, `guidance`; source and last observed freshness information.
- Any known recommended strength, intended use, exclusions/limitations, or compatibility **only when explicitly supported by metadata or tests**.
- A clear distinction among `user-authored guidance`, `observed training vocabulary`, `evaluated performance`, and `LLM hypothesis`. Training occurrence is not proof of reliable generation.

### Metadata schema gap to verify before coding

The current enrichment schema has no explicit, structured **recommended strength**, negative-use constraints, workflow/model compatibility, or relationship between progression stages. Research actual data already captured before adding optional fields. Extend `modelProfile` minimally, versioned and backward-compatible, if benchmark results demonstrate these missing fields are required. Import relevant recognized external metadata rather than overwriting it.

If strength is unknown, Director may propose a conspicuously **tentative editable default** based on existing WebCap controls, not falsely cite a measured optimum. Do not promote arbitrary scores to compatibility claims.

Refresh catalogue on a deliberate user action, opening the relevant Director workflow, or when known owned files change; avoid expensive recurring scans or invisible background inference. Missing/inaccessible root or conflicting identity should be visible, not silently attributed to a different model. Unenriched models remain usable manually but excluded from AI recommendation.

Pass a **bounded** list of compact candidate summaries to Director, then richer details for shortlist candidates if needed. Do not truncate the catalogue in a way that systematically hides relevant options without indicating an incomplete search.

## 4. Director planning — optimize for quality

**A reliable recommendation is more important than minimizing calls.** Keep the workflow simple, but do not put discovery, progression planning, and full prompt authoring into one unconstrained text response.

Suggested logical stages, using existing LLM queue:

1. **Catalogue grounding / selection:** resolve the creative request into a shortlist of eligible LoRAs; consider no-LoRA and alternatives. This may use deterministic filtering plus an LLM, but benchmark recall must justify the method.
2. **Structured plan:** map LoRAs to Story-wide or exact Scene IDs; identify persistent, progression, and situational uses; propose strengths and exact model-relevant phrases. Preserve existing manually assigned models unless the user explicitly elects changes.
3. **Deterministic validation:** validate names against current ComfyUI inventory; bounded strengths; no duplicate/conflicting assignments; scene IDs and inheritance semantics; no orphaned trigger phrases; no fabricated metadata references. Reject invalid proposals with actionable diagnostics. One bounded repair attempt through the **same** queue may be evaluated; no hidden retry loops.
4. **Approval:** user edits/accepts proposal **before** assignments or prompt modifications are applied.
5. **Prompt writing/refinement:** author each prompt with the **approved** LoRA set and vocabulary; preserve creative intent and unrelated manual text. Do not retain trigger language from a rejected LoRA.

One story planning request may cover all ordered Scenes; do not launch a separate modal for each. Large stories can present a concise summary and expandable Scene details. During revisions, replan only affected Scenes unless the change genuinely alters Story-wide continuity.

### Structured proposal shape (illustrative, not an API commitment)

```json
{
  "catalogueRevision": "opaque-fingerprint",
  "storyWide": [
    {"name": "character-a.safetensors", "strength": 0.8, "reason": "Recurring identity", "phrases": ["character-a"]}
  ],
  "scenes": [
    {"sceneId": "scene-1", "assign": [{"name": "stage-1.safetensors", "strength": 0.7, "phrases": ["early stage"]}]},
    {"sceneId": "scene-2", "assign": [{"name": "stage-2.safetensors", "strength": 0.7, "phrases": ["later stage"]}]}
  ],
  "unmatchedNeeds": []
}
```

These example identifiers, weights, and phrases are fictional. Production names must be chosen from the verified catalogue and all modifications reconciled against existing Scene inheritance and overrides.

## 5. Scene progression and continuity

Director must recognize **roles**, rather than merely count LoRA appearances:

- **Persistent:** recurring identity or stable visual treatment → recommend Story-wide if relevant to nearly every Scene.
- **Progressive:** changes in outfit, age, transformation, condition, or another intentional state → ordered **Scene-specific** assignments; previous stage should not leak forward unless explicitly intended.
- **Situational:** background, style, prop, or shot-specific effect → relevant Scenes only.
- A progression can use several LoRAs **or one LoRA with different documented modifiers**. Do not invent extra models simply to fill stages.

Storyboard's existing Story-wide inheritance, Scene overrides, disable flags, and explicit Scene LoRA list are authoritative. The proposal is an **editable diff** against them, not replacement state. Locked/user-chosen assignments must be preserved unless the user explicitly approves their modification. No unnecessary new progression persistence schema.

For Scene revisions, display additions, removals, changed strengths and changed phrases; unchanged assignments remain untouched. A changed Story-wide selection should visibly disclose all affected Scenes. Revisions must not leave earlier-stage phrases in later prompts.

## 6. Approval UX — one lightweight surface

**Design goal: most good proposals require one quick review and one Apply.**

- Show a compact headline: “Director suggests 2 Story-wide LoRAs + 3 Scene changes,” with reasons and any uncertainty.
- Group **Story-wide** at top; **Scene assignments** in timeline/order beneath. Progressive assignments should be easy to scan as a sequence.
- Default to reasonable choices already filled in. Expand an entry to edit: inclusion, target scope/Scene(s), strength, exact trigger phrases/modifiers, or replace with another catalogue item. Provide quick “Add LoRA” search and a way to inspect source metadata.
- Clearly distinguish newly suggested, existing/manual, and changed assignments. Show effects of inheritance without making users configure it.
- **Apply** commits the approved assignment changes through existing controls; **Cancel/Discard** leaves everything untouched. No auto-application, including “high confidence.”
- Do **not** require reviewing every phrase or every Scene separately. Do not present full metadata dumps, mandatory multistep forms, or modal chains.
- Do not mutate current prompts while scrolling, exploring, refreshing or editing proposal controls. If prompt authoring follows approval, use the reviewed configuration; show resulting prompt through existing Director preview/edit/restore conventions.
- If the story or catalogue changes while the modal is open, show a concise stale-state warning and require refresh/reconciliation before Apply; do not silently overwrite newer authored state.

Progress belongs in central Activity, with meaningful phases (catalogue, matching, planning, validation, prompt authoring), queue state and actual available metrics. Approval UI is dismissible; long LLM work should not block unrelated screens.

## 7. Failure and fallback behavior

- **No enriched eligible LoRAs:** Director proceeds normally with no proposed LoRA changes and an explicit “No enriched LoRA matches” outcome. Do not infer candidates from filenames.
- **ComfyUI unavailable:** do not claim verified compatibility or apply assignments; surface unavailability. Existing prompt-only Director operations remain usable where independent.
- **LLM malformed output, invalid identity, unrelated model, unsupported Scene, impossible inheritance, invented phrase:** reject or explicitly flag; never quietly remap, silently omit required assignments, or store partial selections. Keep manual state unchanged.
- **User cancellation or model restart:** pending proposal may be discarded; existing Story/Scene assignments and prompts remain unchanged. No custom durable queue or background task.
- **Stale catalogue or Story revision:** fail visibly at Apply and offer one straightforward Refresh/Replan path.
- **Prompt-authoring failure after approval:** retain explicitly approved assignments, disclose prompt failure clearly, preserve prior prompt edits and offer Retry Prompt only; avoid silently reverting decisions.
- **Zero useful recommendations:** this is an acceptable result, not a failure or reason to force a LoRA.

Privacy: queue/diagnostics may show operational metadata and current prompts transiently, but **do not persist complete private prompt/chat contents to disk logs**.

## 8. Quality gate — evaluate before building the full approval UI

First prove Director can actually plan well using **real enriched LoRAs and the user's actual Director models**. Benchmark against manually established expected assignments; include simple one-shot requests, ambiguous phrasing, “none applicable,” incompatible/missing LoRAs, recurring-character continuity, genuine multi-stage progressions, and later Scene revisions.

Proposed initial gate (targets to validate, **not claimed performance**):

| Metric | Initial target |
|---|---|
| Clearly relevant LoRA recall in unambiguous cases | ≥90% |
| Correct no-LoRA decision on negative cases | ≥90% |
| Valid existing ComfyUI LoRA identifiers after validation | 100% |
| Unauthorized change to manually pinned assignments | 0 |
| Correct persistent vs situational vs progressive scope on clear tests | ≥90% |
| Correct stage sequence for explicit progressions | ≥95% |
| Trigger phrases supported by approved model metadata and aligned with resulting prompt | 100% structural consistency |
| User correction burden | In a representative trial, most plans accepted without catalogue browsing or per-Scene repair |

Evaluate **precision as well as recall**: the feature must not swamp users with irrelevant proposals. Track false positives, omitted relevant models, scope errors, weight problems, prompt leakage, manual correction steps, and whether total time saved is positive. Set up a compact review report with cases and why choices were made.

The threshold for implementation is **demonstrated usefulness**, not merely valid JSON or working routing. If the gate fails, improve source metadata, selection contract, or model choice; rerun tests **before** expanding UX. Do not compensate with automatic retries, huge prompts, or a complex selection wizard.

## 9. Safe implementation phases

1. **Audit and resolve catalogue ownership:** verify accessible configured LoRA roots vs ComfyUI's reported logical names; demonstrate correct sidecar association for both H3 and Krea2 (or explicitly report unsupported variants). Do not assume filenames alone are unique.
2. **Build small read-only catalogue and benchmark harness:** no assignment mutation; capture grounded candidate choices, scope/progression outputs and metrics.
3. **Harden metadata as needed:** only fields proven missing for reliable choices; maintain old `modelProfile` sidecars and embedded export compatibility.
4. **Prove plan quality:** run tests with real Director runtimes. Stop and revisit metadata or model capability if scores and user time savings are inadequate.
5. **Generate vertical slice:** one Director proposal with prompt intent + reviewed LoRA choices; validate/apply only on explicit approval; retain existing prompt-only path.
6. **Storyboard Story-level and Scene-level planning:** reuse `resolve_scene_loras`, scene order, inheritance/override semantics, existing Director operations and Activity. Replan on revision through an editable diff.
7. **UX polish and end-to-end audit:** a single fast approval surface, keyboard flow, accessibility, stale-state handling, queue/cancel behavior, no unexpected prompt mutation, test real assets; compare to `AGENTS.md`.

Do not introduce new queue lanes, storage roots, services, automatic inference scans, or a parallel LoRA-assignment state model. Keep backend changes localized and leverage existing frontend patterns.

## 10. Acceptance checklist

- [ ] A sidecar-enriched LoRA physically present and selectable in ComfyUI is discoverable and correctly linked; same-name mismatches never receive the wrong metadata.
- [ ] Director can recommend a meaningful LoRA with precise documented phrases and a clearly labeled strength.
- [ ] Director can correctly choose **none**.
- [ ] Character LoRA is recommended Story-wide when appropriate, while stage-specific LoRAs follow a meaningful progression across ordered Scenes.
- [ ] Story-wide inherited LoRAs, scene overrides, disables, and existing manually selected LoRAs are preserved correctly.
- [ ] The user can accept/edit/add/remove/reassign suggestions, adjust strengths and phrases, and review an entire story **in one concise modal**.
- [ ] Discard, cancellation, navigation, and failed proposals leave user-authored assignments and prompts unchanged.
- [ ] Director prompt writing respects only the **approved** LoRA configuration and does not leak phrases from rejected models.
- [ ] Scene revision proposes differences without applying them until approval.
- [ ] Current Activity and queue controls expose honest operation status and failures without locking unrelated work.
- [ ] Real-model benchmark meets its agreed quality gate and demonstrates net time saved.
- [ ] Relevant unit, integration, frontend, and end-to-end tests pass on a WebCap development checkout.

**Non-goal:** Automatically learn LoRA efficacy from generations without explicit review. That may be a later metadata-enrichment feature, not a prerequisite for this planner.
