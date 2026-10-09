# QA Workbench Rethink

Status: product / IA proposal  
Audit basis: current `main` review, metadata, annotation, focus-set, prune, duplicate, Assistant, and per-item QA code as of 2026-10-06.

## Agreed Deep QA design contract (2026-10-08)

**Status: approved product direction; implementation and end-to-end testing still pending.** This section supersedes older proposals below where they disagree (especially four-item Director batches, optional-only targeted Vision, and independent patch application). Preserve the working QA Workbench, Focus Set, Set Intelligence, and Caption Assist features; repair locally in phases under `AGENTS.md`.

### Purpose and entry points

- QA opens passively: present cheaply recomputed checks, saved evidence, and previously completed findings. Never start expensive inference just by opening QA.
- Explicit **Deep QA** is an unattended-capable, progressive, **one-media-item-at-a-time** review. No multi-item LLM batch or accumulated conversation history.
- Rank credible existing suspicions first; then process **all remaining items**, including those with no initial suspicion. Priority changes order, never eligibility.
- For each item, perform a **fresh VL examination with the user-selected Vision model**, then a **Director LLM evaluation** using that new visual evidence, relevant reusable Open/Context Sight, the current caption, tags, and concise existing observations. This permits an inexpensive initial Sight scan and a stronger Vision model for Deep QA.
- The Director should identify only credible, consequential problems (including contradictions and meaningful omissions), with explicit item-specific evidence; returning **no findings is success**. Do not promote rare background concepts, incidental imbalance, arbitrary caption length, or speculative associations to prominent errors.

### Costs, reuse, and durability

- Reuse existing model execution, FIFO GPU arbitration, VL request patterns, and item Focus Sets; do not add a new model service, workflow engine, or storage root.
- Saved Sight remains reusable evidence (subject to media modification time and size). An explicitly requested Deep QA item intentionally makes a **fresh** visual read, even when older Sight exists. Keep that new observation available to the immediately following Director evaluation and subsequent human review without triggering the *same* VL inference again.
- Caption Assist's normal independent entry point retains its existing fresh Context Sight behavior. **For a QA handoff**, provide a small explicit way to use the already-fresh QA observation instead of immediately rerunning Vision. If data or media has genuinely changed or the user requests refresh, allow a new read.
- Persist only what is expensive to reproduce and necessary to resume: compact actionable findings, per-item completion/provenance as needed, and narrowly useful user decisions already supported. Do **not** save full repeated prompts, copied caption/Sight corpora, or large histories just to track a scan. Derive cheap counts and candidate priority when needed. Reuse existing QA review persistence where appropriate.

### Failure semantics and progress

- Each item is an independent unit of inference and progress. Surface which item and stage (Vision / Director / ingest / save) is active, the number completed, and failures/skips. Findings appear as items finish, not at the end.
- A malformed **optional correction** must not erase an otherwise useful finding. Preserve its text as an inspectable suggestion; exact-caption substring checks are for applying an edit, not for admitting a finding.
- A genuinely unusable item response is an **item-level failure**, logged with its original cause in the global Console; move on without pretending it was reviewed successfully. Keep it discoverable for explicit retry. Infrastructure/queue and broken required wiring failures remain loud and must not be silently reclassified as model mistakes.
- Do not introduce indefinite retry loops or infer the offending item from a multi-item batch. Save completed work before advancing; cancellation and resume must not unnecessarily repeat successful expensive steps.

### Human review and correction

- The default review queue shows **only actionable findings**, ranked/grouped and inspectable one at a time; complete scan progress, zero-findings coverage, and failures remain accessible without displaying 256 routine review cards or walls of prose.
- Every finding retains the evidence and specific affected media needed for judgment; a finding can open a temporary Focus Set and the **existing Caption Assist** workflow.
- QA diagnoses and may suggest concrete changes; it **never mutates captions/tags by itself**. Caption Assist shows the suspected issue, supporting evidence and optional proposed correction in its existing editable/approval flow. The human edits/applies/rejects explicitly.
- Do not build disposition lifecycle, alternate editor, new warning taxonomy, or large reports before testing whether real findings merit attention.

### Implementation and acceptance sequence

1. **Reliability:** audit response ingest, optional suggestion handling, loud errors, per-item progression, stop/resume, and persistence. Remove obsolete four-item-batch logic instead of patching it further.
2. **Per-item inference:** reuse the existing Vision and Director operations in sequence under the current GPU queue, with fresh VL and no cross-item conversation history.
3. **QA-to-Assist bridge:** pass the precise finding, evidence, and reusable fresh VL observation to Caption Assist without disturbing its standalone behavior.
4. **Presentation and validation:** keep cheap QA immediately available; expose focused actionable results and progress; verify against a handful of real items (zero findings, a genuine issue, bad optional patch, failed Vision/Director, stop/resume) before a 256-item unattended run.

**Acceptance criterion:** One explicit Deep QA run can examine the whole Set progressively, using selected Vision and Director models, retain successful work, report real failures, and return only evidenced issues to the existing human correction path, without redundant VL passes.

---

## Current Set intelligence integration

The implemented Set intelligence flow now provides QA with normalized evidence from the shared **Scan Set** operation rather than asking QA to own media analysis.

Current behavior:

- the broader **Set Intelligence** workflow is model-driven; deterministic QA remains available as supporting/reference capability but is not the semantic engine;
- QA primes the existing Prune and Duplicate analyzers for its current scope instead of requiring the user to visit those reports first;
- Face Focus, MediaPipe Selection Pose, Scene Complexity, and cached Vision Sight can be supplied as compact QA evidence;
- one high-confidence deterministic producer may promote a likely missing known tag only when independent MediaPipe and structured Sight evidence agree;
- Deep QA receives normalized evidence alongside captions, grouped tags, flat tags, and deterministic findings when semantic review is requested;
- QA remains an attention funnel and never silently repairs annotations or captions.

This preserves the original rule below: **many signal producers -> normalized QA findings -> prioritized human review**.

## Executive direction

The existing Review workspace is organized around reports and artifacts. The proposed replacement is organized around a human constraint:

> A person cannot reliably scan hundreds of media items, captions, tags, metadata rows, and cross-item relationships. QA should spend computation to decide what is worth human attention, then make the next action obvious.

The new surface should therefore be a **QA Workbench**, not a better report.

The Workbench should:

- keep deterministic evidence available even when model intelligence is unavailable, without presenting that fallback as equivalent to semantic QA;
- centralize high-value existing signals instead of deleting them;
- emphasize exceptions, suspicious relationships, cohort outliers, and prune opportunities;
- avoid promoting facts already exposed better elsewhere;
- turn every meaningful finding into an inspectable media scope, usually via the existing Focus Set machinery;
- treat LLMs as an intelligence layer that interprets, proposes, and discovers semantic issues rather than as the source of basic statistics;
- keep useful reference tools such as Combined Captions and Metadata available without giving them permanent full-pane residency.

The strongest conceptual model is:

**many signal producers -> normalized QA findings -> prioritized human review -> Focus Set / existing editing workflows -> finding resolves**

---

## Human optimization target

The primary question is not "what can WebCap measure?"

It is:

> **What most reduces the amount of material a human must personally scan while preserving confidence that important problems will still be noticed?**

A good QA finding should save attention. It should answer, in roughly this order:

1. **What looks unusual or risky?**
2. **Why is it worth my attention?**
3. **How strong is the evidence?**
4. **How many items are affected?**
5. **What can I do next?**

A bad QA finding merely restates a fact already visible elsewhere, requires the user to mentally interpret a table, or cannot lead to an action.

---

## Capability inventory

### 1. Caption corpus signals already shipped

Current deterministic Review computation in `tool/js/stats.js` can derive:

- captioned vs captionless counts;
- required phrase coverage;
- configured review-rule failures;
- configured Balance Phrase counts across captions;
- Balance Phrase counts across tags;
- top tokens;
- rare tokens;
- shortest / longest captions;
- bottom / top 5% caption-length outliers;
- exact duplicate captions;
- similar captions using edit-distance similarity;
- a Combined Captions representation for the current scope.

Current Review rendering already makes many report rows clickable into a Focus Set.

### 2. Annotation / structured tag signals already shipped

WebCap already has richer structure than the old Review report uses:

- unscoped tags per media item;
- grouped tags per media item, preserving group identity;
- configured annotation groups and terms;
- reviewed-group state;
- requirement-completion state;
- tag-to-caption mismatch detection;
- a strong Focused Annotation workflow;
- a strong Captionless / Reviewed / Unreviewed / Incomplete / Tag Mismatch filter surface.

Most importantly, `tool/js/item_details.js` already contains a small **per-item QA implementation**:

- tag-similarity cluster detection;
- likely-missing-tag suggestions inferred from similar neighboring items;
- evidence file links;
- Focus Set handoff;
- one-click application of suggested tags.

This is not merely an old design document: it is working code and is the clearest seed for a set-wide QA engine.

### 3. Media metadata already available

Base metadata includes:

- resolution;
- exact aspect ratio;
- file size;
- image/video type;
- for video: FPS, codec, pixel format / color space, bitrate, duration, frame count.

Derived image metadata includes:

- **Scene Complexity**: simple / moderate / busy plus score;
- optional **Face Focus**: close / medium / body / unknown, face count, largest-face size, confidence and clipping;
- optional **Selection Pose / MediaPipe**:
  - face direction;
  - yaw / pitch / roll;
  - expression;
  - body orientation;
  - pose class;
  - arm position;
- optional generic **Color Suggestions** with named color shares.

### 4. Existing media-quality / curation logic

**Prune Candidates** already detects:

- unreadable / missing resolution;
- unsupported aspect ratio;
- missing / unreadable video frame counts;
- very short videos by frame count;
- absolute low resolution;
- cohort-relative low resolution.

It already includes useful context such as scene complexity, face focus, pose, FPS, duration, codec, rating, and flag.

**Duplicate Candidates** already detects:

- exact media duplicates using SHA-256;
- visually similar media using dHash plus aspect compatibility.

**Curation Signals / Focus Set presets** already expose:

- suggested candidate subset;
- face-focus buckets;
- media type;
- aspect buckets;
- resolution buckets;
- scene-complexity buckets.

The existing Review report also summarizes:

- face direction;
- expression;
- body orientation;
- pose class;
- arm placement.

### 5. Human-authored workflow signals

WebCap also knows:

- star ratings;
- color flags;
- whether an item was mutated;
- reviewed state;
- current filtered / visible scope;
- active Focus Set.

These can provide supporting evidence and prioritization without becoming primary QA findings by themselves.

### 6. LLM capabilities already available

The current local LLM path provides:

- freeform text analysis through Director / Assistant;
- enforced structured response schemas where a caller provides one;
- set-level caption review today, although it currently sends only captions despite already collecting tags;
- caption generation / rewriting assistance;
- caption-assist validation that checks whether selected annotations were omitted;
- multimodal Caption Vision for images;
- structured Vision findings for visually omitted or incorrect caption details;
- mapping of Vision findings back to known configured group/tag values when possible.

This means QA does **not** need a new LLM runtime. It needs a better contract and better use of context.

---

## Existing exposure: what QA should NOT loudly duplicate

A central QA screen can become noisy very quickly. Several signals are important but already have a better primary interaction.

### Captionless items

**Current exposure is strong.**

The Advanced Filters surface has a direct Captionless filter, and the user can immediately work that subset.

QA treatment:

- show only as a quiet scope-health chip or status if useful;
- do not generate one QA card per missing caption;
- do not make "3 captions missing" a top finding unless it blocks a specific QA operation.

### Reviewed / Unreviewed / Incomplete

**Current exposure is strong.**

These are workflow-state filters, not analytical discoveries.

QA treatment:

- compact scope-health counts only;
- no prominent findings unless a higher-order anomaly uses the state as evidence.

### Tag Mismatch

**Current exposure is already actionable per item and filterable.**

QA treatment:

- do not duplicate every mismatch;
- promote only a meaningful pattern, e.g. the same annotation group repeatedly fails to appear in captions or a suspicious subset behaves differently from the rest.

### Invalid aspect ratio

**Current exposure is good**, and Prune Candidates already treats unsupported AR as blocking.

QA treatment:

- roll it into Media / Prune findings;
- do not create a separate competing invalid-AR workflow.

### Raw metadata

Useful, but raw tables force the user to do the interpretation.

QA treatment:

- keep Metadata as a reference utility;
- promote only meaningful cohort observations such as a tiny aspect bucket, one anomalous FPS, or a resolution outlier.

### Combined Captions

Still useful for proofreading and broad human pattern recognition.

QA treatment:

- retain as a first-class utility button / drawer / modal;
- remove permanent pane residency.

---

## Priority ranking: attention saved per minute

### P0 — Highest value

#### 1. Set-wide structured association anomalies

Generalize the existing per-item "likely missing tag" concept across the whole set.

Examples:

- `ruched -> v-string` on 17/18 items; show the exception;
- every `teardrop` top uses `ring connectors` except two;
- a term in one group almost always co-occurs with one term in another group, except a small minority;
- a tag appears in a group where it is statistically unusual compared with otherwise similar items.

Why this is high value:

- humans are very bad at remembering hundreds of cross-item relationships;
- WebCap already has grouped assignments, so the signal can be deterministic and explainable;
- the finding naturally produces a Focus Set containing the norm plus the exceptions;
- it can expose missed annotations without nagging about generic empty groups.

Important guardrail:

- association is not correctness;
- require meaningful support before surfacing;
- phrase as "unusual relative to this set", never as "wrong".

LLM enhancement:

- explain whether the relationship is semantically plausible;
- collapse several related rules into one human-readable concept;
- distinguish likely annotation omission from a legitimate variant.

LLM-unique contribution:

- recognize semantic equivalence or near-equivalence across different wording that exact tag statistics cannot unify safely.

#### 2. Prune / duplicate opportunities in one triage flow

These are already useful, deterministic, and actionable, but isolated.

Central QA should surface:

- exact duplicates;
- near duplicates;
- low-resolution outliers;
- unusable / unsupported media;
- suspiciously short video;
- later: high-confidence FPS / duration / bitrate cohort anomalies.

Why high value:

- the action is clear;
- errors are expensive if missed;
- users should not need to remember to visit separate tabs.

The existing specialized analysis should remain the source of truth. QA should consume its findings, not reimplement them.

#### 3. Tiny or anomalous cohort detection

The current Metadata view is manually useful because a human can notice tiny aspect-ratio groups. QA should do that scanning.

Candidate cohorts:

- aspect ratio bucket;
- resolution bucket;
- FPS;
- duration;
- face-focus bucket;
- pose class;
- face direction;
- scene complexity;
- expression, where analysis confidence is sufficient.

Examples:

- "Only 3/312 items are 9:16."
- "One video is 12 FPS; the other 41 are 24-30 FPS."
- "2 images are in the busy scene bucket; 184 are simple/moderate."

Not every small group is a defect. The value is "worth checking", with Inspect as the primary action.

LLM enhancement:

- interpret whether the outlier may be meaningful given the dataset's semantic content;
- summarize several related distribution quirks.

#### 4. Vocabulary / caption anomaly triage

The current report has the raw ingredients: rare tokens, length outliers, duplicate captions, similar captions.

The problem is presentation and interpretation.

QA should elevate only suspicious cases such as:

- one-off token that looks like a typo;
- inconsistent spelling / hyphenation;
- suspicious wording variant;
- one caption with dramatically different granularity;
- copy/paste residue;
- semantically duplicate captions that string edit distance misses;
- odd subject naming / pronoun / identity drift.

Deterministic layer:

- rare tokens;
- edit-distance neighbors;
- token normalization;
- length cohort outliers;
- configured rules.

LLM enhancement:

- classify rare tokens as harmless vs likely typo / drift;
- cluster synonyms;
- explain why a wording difference matters or does not.

LLM-unique contribution:

- semantic oddness, natural-language consistency, and meaning-preserving synonym recognition.

### P1 — Very useful

#### 5. Balance and coverage that does not require the human to invent every dimension

Current Balance Phrases are precise but manual.

QA should retain explicitly configured Balance Phrases, but add two discovery paths:

**Deterministic proposals from structured groups**

If a group contains values such as Front / Side / Back, Bikini Top Shape, Background, etc., WebCap already knows the dimension. Show distribution anomalies directly without making the user retype terms as Balance Phrases.

**LLM-proposed dimensions**

The LLM can inspect group definitions, tags, and captions and propose a small set of useful balance questions:

- "Viewpoint appears important enough to track."
- "Top shape has four recurring variants."
- "Background has two dominant semantic families."

Crucial pattern:

> **LLM proposes what to measure; deterministic code measures it.**

Do not ask the LLM to count hundreds of occurrences when WebCap can count exactly.

Actions:

- Inspect small / dominant subgroup;
- Add as tracked balance dimension;
- Ignore suggestion.

#### 6. Set-wide similarity / redundancy clusters

The existing per-item tag similarity signal should be made set-wide.

Potential inputs:

- grouped tags;
- unscoped tags;
- Face Focus;
- pose;
- expression;
- scene complexity;
- optional visual hash evidence.

Finding example:

"11 items share nearly the same annotation / framing footprint: front + close + smiling + standing."

Action:

- Inspect cluster in Grid;
- sort / compare ratings;
- prune manually.

This complements Duplicate Candidates: it detects **training redundancy**, not file duplication.

#### 7. High-confidence likely missing annotations

Generalize the current item-level neighbor inference.

Prefer:

- strong local evidence;
- group identity;
- repeated support;
- explicit evidence files.

Avoid:

- "group is empty" as a generic QA warning;
- guessing desired material that may not exist.

Action:

- Inspect exception;
- apply one exact known tag when confidence is high;
- open Focused Annotation for the affected group.

### P2 — Useful but secondary

#### 8. Caption-length outliers

Current bottom/top 5% is simplistic but useful as an attention hint.

Improve by:

- comparing to a robust cohort rather than mechanically flagging exactly 5%;
- showing the actual difference from median;
- combining with vocabulary / template evidence.

Do not imply that long or short is inherently bad.

#### 9. Duplicate / very similar caption text

Keep available, but lower priority unless tied to:

- visual redundancy;
- accidental copy/paste;
- an outlier where otherwise similar media deserve distinct captioning.

Exact duplicate captions can be perfectly intentional.

#### 10. Reviewed-after-mutation

The old QA proposal correctly identified this as potentially useful.

Better long-term behavior may be to invalidate affected reviewed state automatically when a mutation materially changes the media. Until then, QA can surface only high-confidence stale-review cases.

### P3 — Context, not primary findings

- raw top-token tables;
- generic rare-token lists before classification;
- raw face / pose distributions with no anomaly;
- rating / flag summaries;
- "unknown" analysis values unless they block a workflow;
- raw color suggestions;
- every requirement gap;
- every tag mismatch;
- every missing caption.

These remain useful inputs, filters, or evidence.

---

## Deterministic vs LLM division of labor

### Deterministic code should own truth that can be counted

Use deterministic logic for:

- counts and percentages;
- cohort distributions;
- exact group membership;
- conditional association support/confidence;
- missing exact tags;
- known rule failures;
- aspect/resolution/FPS/duration statistics;
- exact / dHash media duplicates;
- caption length;
- exact token frequency;
- Focus Set membership.

Benefits:

- reproducible;
- fast;
- explainable;
- works offline with no model;
- cheap to rerun after edits.

### LLM should enhance deterministic findings

Give the LLM already-computed evidence, not an undifferentiated wall of 300 captions where possible.

Good enhancement jobs:

- decide which rare tokens look suspicious;
- merge related anomalies into one concept;
- interpret association exceptions;
- distinguish harmless variants from terminology drift;
- label a finding in useful human language;
- propose balance dimensions;
- rank deterministic findings by likely usefulness;
- suggest which existing annotation group / term best describes a semantic issue.

The LLM must not silently erase deterministic evidence. Its output should be additive or interpretive.

### Things an LLM can do uniquely

These are the strongest reasons to run intelligence at all:

1. **Semantic vocabulary drift**
   - synonyms, near-synonyms, wording changes, hyphenation / phrasing families;
   - concepts that are textually different but semantically the same.

2. **Natural-language oddity**
   - awkward copy residue;
   - inconsistent subject naming;
   - odd descriptive granularity;
   - semantically contradictory phrasing.

3. **Discover useful latent dimensions**
   - identify a balance dimension that the user did not explicitly configure;
   - suggest a coherent category family from existing tags / captions.

4. **Interpret cross-group relationships**
   - deterministic code can say `A -> B, 17/18`;
   - an LLM can say whether that is likely a meaningful design relationship, naming convention, or irrelevant coincidence.

5. **Semantic clustering**
   - merge findings that refer to the same conceptual problem under different terms.

6. **Vision-grounded discrepancy**
   - on selected suspicious images, multimodal validation can identify omitted or incorrect visible attributes;
   - can map observations back to known configured tags or report a useful novel detail.

Vision should generally be **targeted**, not a mandatory 300-image preflight.

---

## Proposed IA: QA Workbench

### Primary surface

Rename / replace the old Review destination conceptually with **QA** or **Quality Assurance**.

The primary surface is a prioritized collection of **findings**, not a dashboard of permanent reports.

Top-level structure:

1. **Scope header**
   - folder / set;
   - visible scope count;
   - current Focus Set if applicable.

2. **Quiet health strip**
   - Captionless;
   - Incomplete;
   - Unreviewed;
   - Tag Mismatch;
   - Invalid AR.
   
   These are links to existing filters, not findings.

3. **Attention summary**
   - Needs attention;
   - Prune / duplicate;
   - Consistency;
   - Balance / coverage;
   - Media composition;
   - optional AI discoveries.

4. **Prioritized findings flow**
   - highest-value findings first;
   - grouped or filterable by category;
   - collapsed evidence by default.

5. **Reference utilities**
   - Combined Captions;
   - Metadata Explorer;
   - perhaps configured Review Rules / Balance setup.

6. **Assistant / Intelligence action**
   - optional;
   - augments the same findings flow;
   - never creates a separate prose-report destination.

### Proposed finding categories

Keep categories few and human-oriented:

- **Prune & Redundancy**
- **Consistency**
- **Balance & Coverage**
- **Media Composition**
- **Caption Quality**

Do not make "LLM" a category. AI is a source, not an information architecture.

### Finding anatomy

Every finding should have:

- priority / confidence;
- short title;
- one-sentence observed fact;
- affected count;
- evidence summary;
- source badge(s), e.g. Deterministic, Metadata, AI, Vision;
- one primary action.

Example:

> **Check · Annotation exception**  
> `ruched` co-occurs with `v-string` on 17 of 18 tagged items. `IMG_184.webp` is the exception.  
> **Inspect 18**

Expanded evidence may show:

- support: 18 items;
- confidence: 94%;
- groups involved;
- filenames;
- related associations.

### Primary actions

Prefer actions that move directly into existing workflows:

- **Inspect N** -> Focus Set;
- **Open item**;
- **Open Grid**;
- **Compare duplicates**;
- **Focused Annotation** for a specific group;
- **Add suggested tag** only when an exact known tag is strongly supported;
- **Track balance dimension**;
- **Open Combined Captions**;
- **Open Metadata**.

Avoid vague buttons such as "Fix" when WebCap cannot safely know the fix.

### Resolution behavior

Where possible, findings should be functions of current data.

After an edit:

- rerun / invalidate only the relevant detector;
- if the condition no longer exists, the finding disappears;
- no separate durable "resolved" database is needed.

For subjective findings, allow a lightweight **Not useful / Hide for this review** interaction before considering persistence.

---

## Recommended layout

### Recommended: prioritized feed + optional detail

This best matches the limited-attention goal.

**Header**

`Quality Assurance · 312 items`

Actions:

- Run Assistant
- Combined Captions
- Metadata
- Refresh

**Health strip**

Small, quiet filter links:

`0 captionless · 7 incomplete · 19 unreviewed · 3 tag mismatch · 0 invalid AR`

**Summary chips**

`12 Needs attention`  
`4 Prune`  
`3 Consistency`  
`2 Balance`  
`3 Media`

**Main feed**

Sections can collapse, but ordering is priority-aware rather than forcing the user to visit tabs.

A selected finding may reveal richer evidence in-place or in a right detail panel.

This preserves a single reading direction while avoiding giant report tables.

---

## Alternative layouts worth mocking

### A. Feed-first

Best for "tell me what matters."

- one vertical prioritized stream;
- categories are chips / collapsible section headers;
- details expand inline.

Strength: minimal cognitive switching.

Risk: very large sets need good grouping / suppression.

### B. Section-first accordion

Best for users who think in stable categories.

- Prune & Redundancy;
- Consistency;
- Balance & Coverage;
- Media Composition;
- Caption Quality.

Each section shows only its highest-value findings until expanded.

Strength: predictable IA.

Risk: user may still feel obligated to "visit every report," recreating the old Review psychology.

### C. Inbox / triage split view

Left: compact finding list.  
Right: selected finding evidence and actions.

Strength: excellent for working through many findings without losing position.

Risk: more permanent layout chrome; can become another full-time pane.

A hybrid of A and C is probably strongest: feed by default, detail pane only when a finding is selected.

---

## LLM interaction model

### Do not dump prose into chat

The current Review Assistant returns raw text. Replace this for QA use with a structured response schema.

Conceptual output:

```json
{
  "summary": "3 meaningful semantic consistency issues found.",
  "findings": [
    {
      "category": "consistency",
      "confidence": "high",
      "title": "Top-shape terminology drift",
      "description": "Two terms appear to describe the same shape family.",
      "files": ["..."],
      "evidence": ["..."],
      "suggestedAction": "inspect"
    }
  ],
  "balanceSuggestions": [
    {
      "label": "Top shape",
      "terms": ["triangle", "teardrop", "bandeau"]
    }
  ]
}
```

WebCap must validate all returned filenames and configured tags against the supplied scope.

The chat response can then remain short:

> 5 useful findings added to QA.

### Give the model structured context

Current Review Assistant already gathers tags but discards them when constructing its prompt.

A better QA request can include:

- filename;
- caption;
- grouped tags;
- unscoped tags;
- selected deterministic findings;
- group vocabulary;
- current configured Balance dimensions;
- optionally compact cohort summaries.

Do not blindly include every raw metadata field unless relevant.

### Two useful Assistant modes

**Enhance findings**

Interpret / rank / merge current deterministic anomalies.

**Discover semantic issues**

Search captions + annotation structure for problems deterministic rules cannot see.

These can share one button with presets rather than become separate surfaces.

### Targeted Vision

Vision should be an action on a suspicious subset:

- "Vision-check 6 exceptions";
- "Validate these likely missing-tag cases."

This reuses current Caption Vision capabilities without turning QA into an expensive automatic image-by-image model pass.

---

## What to preserve from current Review

Preserve the underlying capability, not necessarily the current pane.

### Keep

- Combined Captions;
- Metadata table and AR grouping;
- configured Balance Phrases;
- configured Review Rules;
- exact/similar caption analysis;
- caption length analysis;
- Focus Set handoff;
- Curation Signal computations;
- Prune Candidates;
- Duplicate Candidates;
- per-item QA similarity / missing-tag inference.

### Merge into QA finding producers

- Caption Report findings;
- Prune;
- Duplicates;
- useful curation outliers;
- set-wide form of current item QA;
- later high-confidence metadata cohort anomalies.

### Demote to utilities / evidence

- full Combined Captions sheet;
- raw Metadata table;
- raw top/rare token lists;
- raw pose/focus distribution tables.

### Do not make prominent in QA

- missing captions;
- reviewed/unreviewed;
- generic incomplete;
- basic Tag Mismatch;
- Invalid AR as a separate concept.

All remain accessible through existing filters / workflows.

---

## Suggested implementation phases

### Phase 1 — IA shell, no LLM dependency

1. Create a small normalized frontend QA finding shape.
2. Replace Review artifact-first layout with QA Workbench shell.
3. Consume existing sources:
   - Prune Candidates;
   - Duplicate Candidates;
   - current Caption Report rule failures / length / duplicate / similar results;
   - tiny AR groups;
   - existing per-item QA logic generalized to set-level where practical.
4. Add Combined Captions and Metadata as utility overlays / drawers.
5. All finding inspection uses existing Focus Set / Grid / selection behavior.

This phase should already make QA materially better without AI.

### Phase 2 — Structured annotation intelligence

Add deterministic set-wide detectors:

- conditional tag / group associations;
- exception detection;
- grouped-tag balance;
- tag-footprint redundancy clusters;
- likely missing known tags with explicit support thresholds.

This is likely the single biggest non-LLM value increase.

### Phase 3 — LLM enhancement

1. Add structured QA response schema.
2. Send grouped tags plus captions, not captions alone.
3. Add:
   - semantic vocabulary drift;
   - typo / odd phrase classification;
   - terminology consistency;
   - semantic finding clustering;
   - balance-dimension proposals;
   - association interpretation.
4. Results enter the same finding flow.

### Phase 4 — Targeted Vision

Allow Vision review of selected findings / exception sets.

Do not make full-dataset vision mandatory.

---

## Product guardrails

- Silence is better than weak advice.
- Rare does not mean wrong.
- Small groups are "worth checking", not automatically defects.
- Balance is not an instruction to manufacture data the user does not have.
- Association is not causation or correctness.
- AI findings must always expose evidence / affected files.
- Do not make the user read a second AI report to act on the first report.
- Do not confuse deterministic QA/reference reports with the model-driven Set Intelligence workflow.
- Avoid persistent QA-state files until a concrete workflow requires them.
- Prefer current data to explicit "resolved" bookkeeping.
- Preserve Focus Set as the central bridge from finding -> inspection.
- Keep training-run analysis in Training unless a clear pre-training QA action exists.

---

## Recommendation

The best direction is not to improve Caption Report in place.

Build a **QA Workbench that behaves like an attention funnel**:

1. cheap deterministic code scans everything;
2. QA surfaces only meaningful findings;
3. each finding gives context plus an immediate inspection path;
4. optional LLM intelligence interprets and discovers semantic issues;
5. optional Vision validates a small suspicious subset;
6. edits naturally remove resolved findings.

This preserves the useful machinery accumulated over WebCap's history while finally giving it one coherent workflow.

## Mockups

Three static HTML explorations accompany this document:

- `docs/qa_workbench_mock_feed.html` — recommended feed-first concept;
- `docs/qa_workbench_mock_sections.html` — stable accordion / section concept;
- `docs/qa_workbench_mock_triage.html` — inbox-like finding list + detail concept.

They are intentionally product-layout sketches, not implementation code.
