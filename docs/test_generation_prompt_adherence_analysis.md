# Test Generation Prompt-Adherence Analysis

## Status

**Parked / future exploration.**

This is not part of the current Test Generations implementation plan. It records a potentially useful extension for later evaluation without committing WebCap to another always-on analyzer.

The feature should only move forward if a small prototype demonstrates that it saves meaningful manual review time. This is especially important because WebCap already contains face/body-orientation style analyzers that are technically valid but only modestly useful in day-to-day curation.

## Problem

Test Generations currently gives the user generated evidence and reuses normal WebCap review/rating tools. It does not attempt to determine whether an individual render followed its prompt.

A narrow automated check could be useful for objective prompt attributes such as:

- a **red jacket**
- **black pants**
- **white shoes**
- one person
- a requested large object being present
- obvious framing/composition requirements

The goal is not to create an AI-generated quality score. The goal is to identify a small set of prompt assertions that can be checked with high enough confidence to reduce manual inspection.

## Core principle

Do not ask a vision-language model:

> How well did this image follow the prompt?

Instead:

1. extract specific, testable assertions from the prompt;
2. evaluate only assertions for which WebCap has a reliable analyzer;
3. report the evidence independently;
4. prefer **uncertain** over a confident but unreliable pass/fail result.

Example:

```text
Prompt:
woman wearing a red leather jacket, black pants, and white sneakers

Assertions:
jacket.color = red
pants.color = black
sneakers.color = white
```

The analyzers may support the three color assertions while intentionally ignoring `leather` until material recognition is proven reliable.

## Minimum viable architecture

### 1. Prompt assertion extraction

Parse prompt text into structured visual assertions.

Initial scope should be deliberately narrow:

```json
[
  { "target": "jacket", "attribute": "color", "expected": ["red"] },
  { "target": "pants", "attribute": "color", "expected": ["black"] },
  { "target": "sneakers", "attribute": "color", "expected": ["white"] }
]
```

For the first prototype, this does not require an LLM. Test prompts are controlled enough that a finite color vocabulary plus noun-phrase association may be sufficient.

Required cases eventually include:

- `red jacket`
- `black and red jacket`
- `red jacket with black sleeves`
- `blonde hair`
- `white room`

Lighting/style phrases such as `golden hour`, `blue-tinted shadows`, or `warm lighting` must not automatically become object-color assertions.

### 2. Target localization

Candidate model: **Florence-2-base-ft**.

Why it is interesting:

- approximately 0.23B parameters;
- roughly 0.5 GB of FP16 model weights;
- small enough that it does not impose the cost of keeping a 7B+ VLM resident;
- supports text-guided localization/grounding and other vision tasks that may be useful later.

The first implementation should try bounding-box localization before adding a second segmentation model.

For a target such as `jacket`:

1. localize the target;
2. optionally shrink the returned box to reduce background/skin contamination;
3. pass the resulting pixels to deterministic color analysis.

If bounding boxes prove too noisy, segmentation can be evaluated later. Do not add SAM or another model pre-emptively.

### 3. Deterministic color analysis

Use ordinary image processing rather than a language model to decide color.

Potential implementation:

- convert target pixels into LAB and/or HSV;
- ignore very dark, very bright, or low-confidence edge/background pixels where appropriate;
- determine dominant/perceptual color families;
- compare against a finite semantic palette.

Example output:

```text
Requested: red
Detected: dark red / burgundy
Confidence: high
Result: likely match
```

Color families should be tolerant enough that `red` can match reasonable dark-red/burgundy variation rather than requiring a literal RGB target.

### 4. Conservative result states

Avoid a universal numeric adherence score.

Prefer:

- `match`
- `uncertain`
- `mismatch`

A result should include the assertion and evidence, for example:

```text
Jacket colour: red -> dark red    match
Pants colour: black -> black      match
Shoes colour: white -> pale blue  uncertain
```

These should be screening signals, not replacements for human ratings.

## Video handling

Test Generations primarily produces videos, so analysis should not depend on one arbitrary frame.

A future prototype should sample a small number of frames across the clip and aggregate results.

Example:

- sample 3-5 frames;
- run localization and color analysis independently;
- treat repeated agreement across frames as stronger evidence;
- return `uncertain` when localization or color varies substantially.

The goal is to gain confidence cheaply, not analyze every frame.

## What may be reliably useful

These are candidates worth testing because they are comparatively objective.

### Strongest candidate

**Broad object color**

Examples:

- red vs blue jacket
- black vs white pants
- blonde vs dark hair
- white vs black shoes

Large, visually dominant targets are the best initial case.

### Possible extensions

Only add these after the color experiment proves that automated analysis is genuinely useful:

- prominent object presence;
- coarse person/object count;
- obvious missing prompted elements;
- coarse subject position: left / center / right;
- gross framing: head or feet visibly cropped when full-body framing was requested;
- visible text / OCR when text itself is intentionally prompted.

Each analyzer should earn its place independently. The existence of a technically possible detector is not enough.

## What should not be trusted initially

Do not treat the lightweight pipeline as authoritative for:

- leather vs latex vs similar materials;
- exact garment cuts;
- neckline geometry;
- zipper or buckle details;
- small straps/accessories;
- subtle fit differences;
- fabric texture;
- anatomy quality;
- identity/likeness;
- photorealism;
- aesthetic quality;
- vague style adherence;
- overall prompt adherence.

Those require much stronger semantic reasoning, specialized models, or human judgment.

A larger VLM may eventually help with some of these, but that is a separate cost/benefit decision.

## Validation gate before implementation

Do not build UI or persistence first.

Create a disposable prototype against existing Test Generation results.

Suggested evaluation set:

- roughly 50-100 existing renders;
- prompts containing clear color-target pairs;
- a mix of obvious matches, obvious failures, and ambiguous cases;
- representative garments/subjects from actual WebCap usage.

Measure at least:

1. prompt assertion extraction accuracy;
2. target-localization success;
3. color classification accuracy;
4. confident false-positive/false-negative rate;
5. percentage of cases that end up `uncertain`;
6. whether the result would actually have saved manual inspection.

The most important metric is not raw benchmark accuracy. It is **usefulness on WebCap's own generated material**.

A high uncertain rate can be acceptable. A confidently wrong mismatch is much more damaging.

If the prototype needs extensive exceptions, extra models, or repeated manual correction to become useful, stop there and leave the feature parked.

## Product integration if validated

If the experiment succeeds, keep integration lightweight.

Possible Test Generation presentation:

```text
Automated checks
Jacket colour     match
Pants colour      match
Shoes colour      uncertain
```

Potential behavior:

- analyze only on explicit request or after a completed Test session;
- batch analysis rather than keeping the model resident;
- load the localization model, analyze the selected session, then release it;
- cache results with the generated media/session metadata;
- surface only supported assertions;
- allow low-confidence results to disappear into `uncertain` rather than forcing a conclusion.

Do not:

- alter the existing 1-5 human rating;
- create an overall AI quality score;
- automatically reject/prune renders;
- rank LoRA candidates from these checks alone;
- turn every detectable property into another permanent analysis panel.

## Relationship to the current assessment model

This proposal should preserve the principles in `docs/test_generations_assessment.md`:

- human ratings remain canonical;
- Test Generations remains lightweight;
- automated checks are evidence, not a second rating system;
- no hidden weighting or automatic winner selection;
- existing WebCap review surfaces remain the primary place for judgment.

If implemented, prompt-adherence checks should complement the assessment layer rather than expand it into an evaluation dashboard.

## Decision point

The idea is promising primarily because **color adherence can be split into a small semantic-localization problem plus deterministic pixel analysis**, avoiding a large VLM.

That does not automatically make it worth adding.

The next step, when there is appetite for it, should be a small offline Florence-2 + color-analysis benchmark on existing Test Generation outputs. Build nothing permanent until that experiment demonstrates clear practical value.
