# Director chat authoring boundary

Hypothesis: conversational exploration should remain useful and concrete, while a direct request to write a complete draft should produce one. Neither a refusal policy nor keyword parsing is intended.

## Frozen comparison
Classic v3 control is copied from the prior unified-final experiment. Cue and Contrast replace only its collaboration paragraph; both keep the role, profile and H3 toolkit otherwise unchanged. These candidates are for Chat only. Write uses the unchanged Classic control, operation schema and H3 reference.

Run the existing harness from the repository root with the exact configured model and WebCap URL:

```sh
python scripts/studio_guidance_eval.py run --design-dir experiments/studio_guidance/chat_authoring_boundary --model "$MODEL" --base-url "$WEBCAP_URL" --split development --repeats 2 --output experiments/studio_guidance/runs/chat-boundary-dev
```

36 calls (6 cases × 3 packages × 2 repeats). Review blind with the existing review command. Compare premature complete drafts, explicit drafting success, creative usefulness and intent fidelity separately. Never reward a refusal or bland reply as successful restraint.

Freeze the strongest candidate before holdout: run the four holdout Chat cases with baseline and selected candidate, two repeats, using repeated --case and --package options (16 calls). Run the two Write controls separately with --package classic-v3 --case write-project-control --case write-scene-control --split holdout --repeats 2 (4 calls). Use new output directories and the development manifest via --baseline-from. The Write controls are baseline checks, not evidence of candidate impact on Write; production wiring must keep candidate guidance out of Write.

## Actual multi-turn behavior
chains.json supplies two conversation sequences. Run with the companion runner. Each real response is passed verbatim into the next turn, including prematurely drafted material. Review whether discussion remains constructive, whether the user's changed direction supersedes earlier suggestions, and whether explicit drafting actually produces complete material. Do not rewrite or remove model responses to improve results.

## Browser acceptance after selecting a candidate
Playwright should inspect actual outbound Model I/O, not infer context from the visible chat.
- Chat without Read: saved Project and Scene fields absent, including deliberately unique fixture strings.
- Write Project and Write Scene(s): selected current saved baselines and required operation schemas present in the request; generated fields persist only to the selected destination. Successful receipt contains metadata rather than generated prompt/concept/style/invariant bodies.
- Subsequent Chat: no implicit injection of generated field values; explicitly Read selected fields and confirm they become visible persisted conversation snapshots and enter the next request.
- Explicit draft in Chat remains visible conversation text, and can influence later turns by design. No automatic save.
- Historical full-value Apply receipts: investigate migration/filtering separately from the guidance experiment. Preserve original transcript and avoid silently discarding user-authored messages.
- Exercise both Project and Scene Writes and revisions, including title-only revision; no new validation gates or automatic repair.

Review actual raw responses and distinguish model errors from runtime failures. A candidate is not promoted automatically; reject wording that trades premature drafting for refusal or weak discussion. No production defaults, settings, saved Projects or Scenes change in this experiment. No rendering is necessary to evaluate conversational restraint; this experiment does not establish H3 rendering quality.
