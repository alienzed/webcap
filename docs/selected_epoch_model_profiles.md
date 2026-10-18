# Selected epoch model profiles — phased implementation contract

Status: End-to-end feature implementation on draft PR #457: checkpoint metadata reader/editor, captured training vocabulary, optional queued Director enrichment, Test/Generate prompt phrase and wildcard insertion, explicit atomic embedding in the manifest-recorded saved LoRA, and Storyboard Director profile context read from ComfyUI's exact LoRA asset. Static review ongoing; project tests and end-to-end runtime verification have NOT been executed. Branch is not merged and currently trails newer main changes.
Follow root `AGENTS.md` and `docs/filesystem_state_contract.md`. No new global storage roots, queue lanes, or speculative services.

## Product behavior

An epoch remains selectable with no LLM available. Profile enrichment is user-editable,
optional, checkpoint-owned, and survives deletion of evaluation campaigns or Test sessions.
Model knowledge must be useful to Generate, Test, and Storyboard without silently overwriting
user prompts. Where existing ComfyUI/Civitai/SD WebUI metadata can express information, import
it rather than maintaining a competing claim of authority. Metadata imports are evidence,
not necessarily reliable advice.

## Phase 1: data foundation (initial implementation)

- `tool/server/model_epoch_profile.py`: read bounded safetensors headers, adjacent generic
  `.json`, `.civitai.info`, and existing `.webcap.json` as separate sources.
- Save *only* user-owned enrichment under `modelProfile` inside adjacent `.webcap.json`;
  retain unrelated provenance, assessments, and future keys.
- Never modify the safetensors bytes in this phase.
- Tests cover reading, preservation, validation, and immutability.
- Required follow-up before exposing API: verify exact conventions for multiple SD WebUI
  sidecar variants and trainer metadata; map normalized field labels without discarding raw
  values or misrepresenting inferred settings.
- Validation: targeted pytest and full relevant tests on a checkout with project dependencies.
  GitHub connector supports source edits here but cannot run the repository tests.

## Phase 2: authoritative checkpoint owner and selection integration (backend implemented; UI pending)

- Keep selected epoch identity in `training_run_manifest.py`'s `webcap-run.json`.
- Resolve the selected checkpoint through existing `training_runner.py` paths; do not infer
  owner from the staged Test filename or a campaign.
- Add a GET profile operation and explicit save/update operation to the existing candidate
  route family, with server-side path/identity resolution rather than arbitrary client paths.
- Avoid partial overwrite of existing staged `.webcap.json` provenance or assessments.
- Save selection immediately; profile creation/refresh must never gate selection.
- Tests: run identity, missing profile, select/clear, save/read, staged-copy continuity,
  legacy sidecar untouched, and existing candidate ratings preserved.

## Phase 3: training-derived vocabulary and manual editor

- Reuse `epoch_reference.py`'s captured dataset membership/vocabulary and its existing
  wildcard utilities. For video captions and freeform text, add only the smallest necessary
  extraction after confirming available captured caption inputs.
- Distinguish 'present in training', 'evaluated', and 'user recommended'. Frequency is not
  proof of generation capability.
- Add contextual profile editor beside selected epoch: description, trigger phrases, named
  options, guidance, and source provenance. Persist explicit user edits, not live polling.
- Respect current UI shell/layout; don't introduce another metadata tab for its own sake.
- Tests: deterministic vocabulary across captured data, missing capture warnings, manual
  changes persisting across refresh, no edits on passive navigation.

## Phase 4: optional Director enrichment

- Reuse current LLM queue/activity pattern. A distinct `Enrich with Director` action
  produces reviewable suggestions and never silently writes the profile.
- Supply bounded grounded context: imported metadata, training vocabulary, selected epoch,
  compact evidence, user input. No raw private chat transcript persistence.
- Display phases/status in Activity; cancellation/failure leaves selection and saved profile.
- Tests: unavailable LLM, malformed suggestion, cancellation, concurrent requests,
  explicit Apply versus discard, no extra queue semantics.

## Phase 5: consumers

- Generate/Test: selected LoRA offers profile description, trained words, named options,
  and explicit prompt insertion/expansion; default existing prompts remain unchanged.
- Storyboard: add relevant profile context to Director prompt construction at the place
  the selected LoRA is resolved, rather than copying a full document into every prompt.
- Existing wildcard parser remains authoritative. Preserve exactly which option a generation
  actually used in its existing generation provenance, where supported.
- Tests: unrelated model isolation, missing metadata, prompt preservation, explicit insertion,
  Storyboard model-switch context, length-bounded Director prompt.

## Phase 6: interoperability and review

- Define minimal export mapping for supported SD WebUI/Civitai-like metadata, making clear
  which fields have no true external equivalent; preserve unfamiliar imported keys.
- Optional *explicit* safetensors metadata export/rewrite only after separate decision:
  editing the header changes file identity and may invalidate external hashes.
- End-to-end tests with real staged checkpoints for Krea2, Wan/H3 supported paths; audit
  behavior against AGENTS and make regressions visible.
- Audit/merge only after all requested integration paths and tests are verified.

## Risks requiring decisions

None currently block Phases 1–5. The only deferred decision is whether to expose
safetensors rewriting, since it changes file bytes and identity; keep it opt-in and
separate from routine selection and editing.


## Implementation observations / audit boundary

- `POST /fs/training_candidates/profile` reads or saves the original checkpoint profile by server-resolved training identity; selection remains independent.
- `POST /fs/training_candidates/profile/director` uses the existing ephemeral Test LLM client/queue and fills reviewable draft fields only.
- `POST /fs/training_candidates/profile/embed` explicitly rewrites only the manifest-recorded saved/exported copy atomically, preserving tensor byte content; the training checkpoint remains untouched.
- `GET /fs/generate/lora/profile?name=...` resolves through ComfyUI's actual LoRA selection and reads `webcap.profile` from its safetensors metadata. No local filename guesses are used.
- Test and Generate explicitly insert key phrases or `{a|b}` wildcard fragments at cursor; no auto-overwrite of prompts.
- Storyboard Director `write_prompt` / `refine_prompt` includes relevant embedded LoRA guidance where available. ComfyUI metadata failure does not prevent Director work.
- Current freeform/manual profile changes are not automatically re-embedded into an already saved LoRA. The explicit Embed action is required after editing.
- The configured Copy-to-Test destination and ComfyUI LoRA directory are not assumed to be the same path. Only metadata actually embedded in the ComfyUI-selected asset is used as authoritative cross-workspace guidance.
- Tests committed in `tests/test_model_epoch_profile.py`, but cannot be executed here because the running container cannot resolve GitHub and does not have a WebCap checkout. Treat this as unverified, not passed.
- Before merging: reconcile newer `main` updates, execute targeted tests, inspect frontend/runtime behaviors, and re-audit after integration.
