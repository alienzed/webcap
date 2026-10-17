# Epoch Finder — implementation phases and contracts

Epoch Finder is a separate tab *inside Test Generations*, not a new GPU execution path. The new campaign coordinator owns its own disposable campaign JSON and extracted-frame evidence. It submits work to the existing Test Generations inference implementation and to the existing LLM queue. Those lanes and GPU ownership remain unchanged.

## Phase 1 — campaign records and saved-run inputs

- Discover usable saved epochs from an existing Training run identity, not browser-supplied filesystem paths.
- Write one `campaign.json` for each campaign under the existing central Test Generations Set workspace, in `epoch-finder/<id>/`.
- Freeze selected run, prompt, round seeds, model settings, VL model, and retention plan at creation.
- Respect server-owned state; browser tab refresh and navigation are observers, not work owners.
- Never auto-resume an interrupted campaign after WebCap restart. Explicit Resume promotes only that campaign's own backlogged Test jobs, using the existing queue API.

## Phase 2 — rendering and temporary evidence

- Stage only a campaign-owned epoch checkpoint into `<configured Test staging>/<Set>/epoch-finder-<id>/`.
- Normal Test candidate scanning ignores that child folder; only the campaign path resolver accepts it.
- Use existing Test model template, Test session records, inference enqueue/transport, and frozen workflow inputs.
- For each epoch, submit its case renders and ingest them in order. CPU extraction of an already-complete result can overlap the next queued ComfyUI render.
- Save first frames as PNG within campaign evidence, then delete campaign-owned temporary Test sessions including videos.
- Unsuccessful frame extraction leaves the source clip and session available to diagnose or retry.
- Remove the checkpoint copy and the entire owned subfolder when the epoch no longer has pending work. Never touch manually staged LoRAs or training output.

## Phase 3 — VL analysis and progressive rounds

- At the end of the round, use saved first-frame PNGs to submit ordinary `vision_question` LLM requests, sequentially, via existing LLM queue.
- Persist each completed judgment before moving forward. No persisted images in the LLM execution queue.
- Compare numbered choices against the resolved wildcard-group expectation; count visible matches and mismatches, exclude genuinely unclear observations.
- Rank candidates per round, retain the requested percentage plus score ties, and automatically advance at the next resolution. Maximum 0.4 MP for model policies exposing megapixels.
- Keep round metadata, individual evaluation evidence, failures and finalist frames for review; no Archive integration yet.

## Phase 4 — Test Generations Epoch Finder tab

- Use existing Test Generations design patterns and global Vision model selection.
- Live phase label, round timeline, frames-captured and VL-evaluated progress, current epoch count, sorted leaderboard and evidence gallery.
- Pause/Stop finish the currently underway operation. Resume is explicit; no global inference or LLM lane pause/unpause.
- Completed campaigns remain reviewable until the user deletes them. Delete removes owned campaign data and staging when there are no active Test references.
- Regular Test Generations interface, sessions and candidate listings remain unchanged.

## Verification checklist

- Ordinary Test Generations regression tests and stage-specific Test model tests remain green.
- New tests cover staged folder isolation, checkpoint cleanup, scoring semantics, and frozen round plans.
- Actual H3 and Krea2 renders, ComfyUI LoRA resolution, and local/remote VL still need confirmation on the training machine; repository-only inspection does not simulate them.
- Restart during queued inference: campaign becomes interrupted, no work automatically resumes; explicit campaign Resume promotes only its own work.
- Restart during VL: completed persisted judgments are retained; incomplete requests are reissued only on explicit Resume.
- Aborted campaigns preserve failed media evidence rather than silently losing it.
- Completed campaigns leave no staged checkpoint directory, and ordinary Test media is never deleted by Epoch Finder.


## Follow-up implementation (PR #364)

**Phase A — cumulative scoring and automatic re-entry (implemented)**

- Rank the original epoch universe from all completed judgments through the current round.
- Cut the *active* field by relative retention; advance all candidates at or above the cutoff, including ties.
- Previously sidelined epochs re-enter when their saved cumulative score clears the new cutoff. They are never forced to catch up on missed rounds.
- Persist per-round ranking, cutoff, and re-entry evidence; the current-round leaderboard recalculates cumulatively.

**Phase B — isolated errors and staged checkpoint lifecycle (implemented)**

- Capture individual generation/VL errors per unit with stage, actionable message, and Console logging; failed units never contribute positive or negative score.
- Continue other cases/epochs when an isolated operation fails. No changes to the shared inference/LLM lanes.
- Do not remove campaign staging while *any* campaign-owned Test request is active. Expose failed observations in the dashboard.
- An entire campaign can still fail if the current field has no scoreable evidence or an invariant fails. This remains a visible failure, not a fabricated ranking.

**Phase C — per-round controls and workload visibility (implemented)**

- Per-round configurable tests per epoch, relative retention, and MP where supported.
- Freeze these options in the campaign record before any render.
- Show approximate per-round field sizes and total render count, excluding VL and queue waiting. Seed observed MiniMax H3 3-second video timings at 0.3 MP (10s/render) and 0.4 MP (15s/render). Use 30s/render for all unmeasured combinations; do not extrapolate across duration or resolution.
- Actual timing profiles (second-render warm-up exclusion, environment-specific calibration), optional LLM wizard and differentiated concept/leakage/vary-only scoring remain unimplemented.

**Phase D — verification / separately scoped coordination (pending)**

- Run tests and representative H3/Krea2 and VL campaigns on the training machine; verify the actual checkpoint loader, checkpoint cleanup, restart, and manual testing interoperability.
- Test failure and restart scenarios, especially around already-enqueued Test work and stale runtime evidence.
- Migrate browser-owned Batch Test coordination separately only after its existing semantics can be preserved with tests. Epoch Finder itself is already backend-coordinated; this migration is not required for Epoch Finder's first real run.
- No archive changes, LLM test-plan wizard, multi-run pooling, or Run Analytics in this PR.


## Wizard implementation — staged behind explicit Launch

1. **Run**: choose an available saved training run. Epoch Finder does not pre-stage checkpoints here.
2. **Tests**: optional "Suggest tests from Set" submits the existing Test/Director job client using the existing caption wildcard corpus and shared Set vocabulary/aliases. The dedicated `epoch_finder_plan.py` contract adds a concept description and primary/leakage/vary-only roles. The response is validated before becoming an editable proposal; the user may also author the prompt without an LLM.
3. **Rounds**: reuse the per-round tests, retention and resolution table and measured H3 timing seeds (30s fallback) to present a visible cost projection.
4. **Review and Launch**: freeze the exact prompt, validated ordered wildcard groups, roles, options, model, and round settings. Only clicking Launch starts generation.

**Scoring:** Primary=2, Leakage=1, Vary-only=0. The existing VL question requests the visible choice for every attribute, but score aggregation weights primary/leakage only. Uncertain judgments remain unscored. The mapping is by wildcard group ID and approved *ordered option vocabulary*, never loose word matching. Changing the wildcard text after proposal invalidates/synchronizes the editor and is checked again server-side.

**Safety boundaries:** No new queue, new GPU arbitration, automatic LLM calls, background scans, or changes to the original Wildcard Builder's analysis contract. Draft PR remains unmerged pending tests and real-machine campaigns.

## Locked cleanup and Storage Manager policy

- Original training checkpoints are never modified. Campaigns use temporary copies in the configured Test staging location.
- Video and source Test sessions remain until their corresponding VL judgment has been durably written. After that, the campaign deletes only its own completed Test session and original media.
- If capture or VL fails, preserve available Test media, PNG and error evidence. Interrupted/paused campaigns also keep unfinished media. Deleting a campaign explicitly removes its remaining owned sessions when no active work references them.
- On campaign completion, keep PNGs of all final-round epochs across tested rounds, along with any unscored/failed frames. Prune scored PNGs belonging to nonfinal epochs after preserving scores, prompts, and provenance in campaign JSON.
- Store campaign JSON and retained frames in the central Test Set workspace. Storage Manager exposes Epoch Finder campaigns as measurable, user-purgeable records (unless active). Staged checkpoint subdirectories have a distinct measurable, non-purgeable inventory entry.
- Storage Manager campaign deletion delegates to the campaign owner rather than deleting arbitrary files. Retained campaign Test sessions remain measurable in the Tests category but cannot be purged independently while their campaign exists. Ordinary Test sessions and manually staged candidates are never removed by campaign cleanup.
- Cleanup is lifecycle-driven, not startup- or timeout-driven. Startup interruption does not trigger automatic resume.

Real-machine confirmation of media accounting, VL completion, restart and purge remains required before merging.
