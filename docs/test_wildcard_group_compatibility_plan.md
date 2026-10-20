# Test Generations wildcard generation: concise, editable evidence

The previous mandatory observed-tag combination check was removed. It rejected
otherwise useful natural-language wildcard drafts (for example `standing upright`
when the Set Position tag is `standing`). This check was not a training
integrity guarantee; it was a post-hoc gate on an editable Director suggestion.

## Current behavior

- Scope caption examples to media captured by the **selected training run**.
- Drop duplicate captions into one example with a frequency count.
- Sample evenly across the Set when needed, at most 150 distinct examples and
  approximately 24,000 caption characters, rather than truncating to early filenames.
- Send the Set tag-group glossary **once**, with aliases and terms, not a
  per-item group map or all combinations observed in individual images.
- Ask Director to prioritize the learned subject/component construction, and
  keep incidental hair, pose, setting, lighting, and camera variation secondary.
- Preserve exact annotation-group identity in the Director draft where it is
  genuinely supported, but make it optional for natural-language alternatives.
- Return the Director proposal for user editing and preview. No second
  exact-tag/observed-combination gate after completion.
- Existing generated Test media, saved wildcards and manual prompt editing
  remain unchanged. Epoch Finder still validates user-approved reference media
  against the actual selected Set group/tag.

## Boundaries and testing

The 24,000-character caption limit is a conservative **input-size heuristic**,
not an exact 16K-token guarantee across different local model tokenizers. The
one-time vocabulary, instructions, schema and output also consume context.
Large configurations should be measured against the selected Director model's
actual tokenizer/runtime context before claiming a guaranteed fit.

Unit tests cover representative examples, edge-of-Set retention, source-run
filtering, optional semantic identity and editable natural-language drafts.
Real model/browser QA is still required to verify result quality.
