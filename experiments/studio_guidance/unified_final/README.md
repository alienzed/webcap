# Final unified guidance comparison — fixed protocol

This concludes the creative-guidance investigation in draft PR #1102. Compare
three single-pass treatments, four fresh briefs and two repetitions per cell:
**24 inference calls maximum**, one model, no prompt-search iterations, retries,
additional agents, refinement passes or extra probes. Keep all production
guidance, profiles, settings, data and queue behavior unchanged.

## Frozen treatments and normalization

- `classic-v3`: the actual production Classic v3 role and H3 toolkit, verbatim.
- `cleaned-current`: the exact previously tested cleaned Current role.
- `unified`: the author's exact proposed creative paragraph, followed by the
  cleaned WebCap material definitions and collaboration guidance. It replaces
  both Current's opening creative paragraph and its editorial profile paragraph.

All three receive the same **production H3 toolkit**, unchanged H3 authoring
reference for Scenes, author messages, operation task, schema and per-operation
sampling. This keeps production Classic's knowledge intact while controlling
the technical-knowledge variable. Cleaned Current's role is unchanged from the
18-call screen, but its earlier 547-character toolkit is replaced by the common
1,375-character production toolkit. This comparison therefore evaluates the
roles with common knowledge, not the earlier full cleaned Current package.

The existing harness normalizes whitespace at module boundaries; production
preserves a trailing role newline. Classic control wording and content are
identical to production, with that documented boundary-spacing difference.
No transport or output-budget changes are introduced: use the app's real Chat
job API, configured runtime settings and existing operation sampling. The
shuffle seed controls request order, not the model's generation seed.

## Fresh cases and review

- Chat: choose a direction for understated optimism at an outdoor pool, in a
  few conversational sentences.
- Project: independent films about balance, a recurring glass sphere and room
  for documentary precision, dry comedy and spectacular invention.
- Precise Scene: a clinical fixed-camera gauge-block demonstration, neutral
  light, observable contact/needle behavior and quiet physical sounds.
- Imaginative Scene: an ambitious workshop-scale wooden sea and ceramic whale,
  with coherent materials, three shots and exact dialogue.

Two repeats per treatment cover consistency as well as isolated quality.
All four cases were frozen before inference; no adaptive case/prompt changes.
The schema's `development` split label is a harness convention here: all four
are fresh final-comparison cases, with no subsequent tuning or holdout stage.

Review anonymously before opening treatment keys. Judge the whole contribution:
fidelity to deliberate choices, completeness/useful partial material, appropriate
creative contribution, audiovisual execution and conversational judgment.
Precision, realism, restraint and clinical clarity count equally with expressive
invention when serving the brief. More text or ornament is not a benefit.
Record observed format/field/duration diagnostics separately from qualitative
Codex judgments. No human scores are invented or required.

Recommend unified consolidation only if it is broadly useful across the four
tasks and both repeats, with no material candidate-specific loss of deliberate
choices or required material relative to the established controls. A major
observed regression must remain visible rather than disappear in an average.
If evidence is mixed, recommend the strongest established approach and explain
the tradeoffs. This is a practical bounded decision, not statistical proof of
universal superiority. Stop after the fixed comparison regardless of outcome.

## Evidence and boundaries

Use `scripts/studio_guidance_eval.py plan/run/review` with this design, one exact
model ID, `--split all --repeats 2 --seed 323`. Retain complete requests, actual
job receipts, anonymous cards/keys and notes under ignored local runs. Record
model-reported prompt/completion/total tokens, elapsed job/poll time, available
runtime timing, finish reasons and actual context. Missing metrics are unavailable,
not inferred. Preserve useful partial outputs and expose failures locally.

Keep historical experiments unchanged. Specialized Visual Direction and the
Artist/Engineer design audit are outside this experiment. CI uses tests/plans
only; no live-model calls. Final findings, exact wording and proposed production
changes go to PR #1102, which stays draft and unmerged pending review. No H3
render quality is claimed without actual renders.
