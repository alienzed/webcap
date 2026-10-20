# Test Generations wildcard generation: concise, editable evidence

The previous mandatory observed-tag combination check was removed. It rejected
otherwise useful natural-language wildcard drafts (for example `standing upright`
when the Set Position tag is `standing`). This check was not a training
integrity guarantee; it was a post-hoc gate on an editable Director suggestion.

## Current behavior

- Scope caption examples to media captured by the **selected training run**.
- Drop duplicate captions into one example with a frequency count.
- Compile run-scoped group/tag counts in memory; keep identical tag strings
  separate across groups. By default omit the generic Viewpoint, Position,
  Hair, Body, Clothing, Lighting, and Background groups from concept evidence.
  Explicitly focusing one of those groups can restore it.
- Use at most 24 captions / approximately 7,200 characters, preferring captions
  covering distinct and rare concept tags. No filenames, item-by-item group
  maps, or observed-combination matrices are sent.
- Each observed group appears once, with its alias and tag counts.
- Give Director editable role defaults: Viewpoint / Background / Lighting are
  Vary only; Position / Hair / Body / Clothing are Leakage; learned concept
  groups are Primary. Explicit focus overrides these suggestions.
- Ask Director to prioritize construction while keeping incidental detail secondary.
- Preserve exact annotation-group identity in the Director draft and Campaign
  dimension metadata when supported. Campaign References use that group as a
  preference but still allow manual selection from another tagged group.
  Free-language alternatives keep optional empty annotationGroup.
- Return the Director proposal for user editing and preview. No second
  exact-tag/observed-combination gate after completion.
- Existing generated Test media, saved wildcards and manual prompt editing
  remain unchanged. Epoch Finder still validates user-approved reference media
  against the actual selected Set group/tag.

## Boundaries and testing

The 7,200-character caption limit is a conservative **input-size heuristic**,
not an exact 16K-token guarantee across different local model tokenizers. The
compiled group inventory, instructions, schema and output also consume context.
Large configurations should be measured against the selected Director model's
actual tokenizer/runtime context before claiming a guaranteed fit.

Unit tests cover source-run filtering, scoped tag frequencies, rare-tag
representation, core-group defaults, optional identity, and Campaign provenance.
Real model/browser QA is still required to verify result quality.
