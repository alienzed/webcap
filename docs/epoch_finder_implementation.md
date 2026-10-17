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
