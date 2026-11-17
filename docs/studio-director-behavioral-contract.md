# Studio Director — guidance and behavioral audit

**Current guidance standard:** [Normative Studio Director contract](studio-director-contract.md).
Prior proposals advocating conversational structured authoring, readiness
scoring or Review are superseded; their historical rationale remains in Git.

## Preferred behavior

Chat is an imaginative creative partner: natural dialogue, opinions,
alternatives, coherent continuity across the entire conversation. The
model does not pretend to change fields or issue machine-action metadata.

Write is a focused creative producer. Follow the author's instructions,
the real prior conversation, specifically authorized saved content and
the requested field schema. Return complete material in the named
fields, drawing on the same concise, capable guidance patterns as
First Cut, Develop Scenes and Enhance Prompt.

WebCap is not a semantic evaluator. Request design should solve unreliable
outputs through focused tasks, consistent schemas and clear guidance,
not runtime refusals, content quarantines, fallback creative text, intent
parsers, grading calls, extraction retries, or silent truncation.

## Hostile audit questions

For each LLM entry point, examine the **actual** request sent and the
matching response consumer, not only the documentation.

- Does the selected UI action unambiguously determine the operation, target,
  required fields, schema, payload and save route?
- Does Chat omit production templates, backend workflow or other distracting
  instructions, and contain the entire conversation as separate turns?
- Does Write send its entire conversation only once, alongside the selected
  operation-local baseline and exactly relevant production guidance?
- Are instructions positive, concise, creative, and non-contradictory?
  Is there a redundant prohibition, optional field, required `rationale`,
  or duplicate schema that makes the model's real job harder?
- Is the response applied as authored fields without prose heuristics,
  semantic judgment, unsupported defaulting, speculative guardrails or
  automatic repair/confirmation calls?
- Is History actually wired to all editor changes? Does I/O retain the
  exact raw request and response even on failure?
- Have all obsolete Review, readiness, suggestion, combined-schema and
  dual-route execution paths really been removed, with no dangling callers?
- Do Playwright and live tests exercise a realistic creative sequence,
  focus changes, field History and saved values, not just CSS/selectors?

## Lessons from repeated regressions

A schema with optional intended fields can yield empty intended fields.
A general creative Chat request overloaded with authoring requirements
weakens its core discussion task. Silent eight-message cropping destroys
continuity. A Review layer duplicates recoverability provided by History
and adds authoring/UI state. Parsing the author's prose for commands or
post-hoc semantic content throws away useful creativity. Hidden legacy
paths make debugging and testing ambiguous. Fix these mistakes at the
**request/response/ownership boundary**, not by adding layers.

An application-level error remains a real error: missing destination,
broken transport, save conflict, invalid field type, or backend failure.
Show the original provider response in I/O and the operational diagnostic
in Console. These are infrastructure facts, not model quality scores.
