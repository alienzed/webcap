# Studio Director — User Flows for Browser Acceptance

## Purpose

Cover the most Studio Director capabilities with the fewest practical browser journeys and model calls. These are **high-level user flows**, not implementation-level tests or a requirement to test every feature from every launch point.

Each flow has independently observable checkpoints: a later failure must not obscure whether earlier work succeeded. Reuse the Projects, Scenes, and conversations created by earlier flows where practical, but allow a flow to run independently with equivalent starting data.

**Universal pass criteria:** The browser displays the material actually returned; useful partial results remain available; save receipts reflect confirmed persistence; unsaved work is not presented as saved; and subsequent navigation, replies, or operations do not silently overwrite unrelated material. Verify saved state by revisiting/reloading it, not by trusting model claims or button labels.

## Core flows

### 1. Create a Project and Overview
**Do:** From a fresh Studio Director conversation, request a new Project with a title, concept, style, and invariants; review/edit the proposal and save it. Repeat the creation shortcut with another Project already open if needed for coverage.  
**Check:** The reviewed Overview is actually saved under a new Project, not accidentally into the open Project; requested fields and invariants persist, and unrelated saved state is unchanged.

### 2. Create multiple Scenes
**Do:** In that Project, request several Scenes, including specific nondefault durations; also author material before choosing the destination and then select its Project without regenerating it; review already-authored material where available, or launch authoring from a brief, and save the useful results.  
**Check:** Selecting the destination after authoring never causes a second authoring call. Every usable returned Scene is available and saved/reviewed through the advertised path, without an unnecessary second model call; titles, complete prompts, durations, count, order and Project ownership match actual records. An incomplete Scene does not invalidate complete ones.

### 3. Revise an Overview and Scenes
**Do:** Ask Director to revise selected Project details, then revise one Scene and a batch of Scenes; use the contextual Scene revision shortcut for one edit and the Director action for another. Also revise a Project and its Scenes together: save the Project change first, then author the Scenes using the newly saved direction.  
**Check:** The Project-first sequence uses freshly saved Project direction for subsequent Scene calls, without silently rewriting Scene prompts from a Project-only edit. Only intended fields and Scenes change; old titles/durations, unrelated prompts and continuity details survive. Direct-save and reviewed-save behavior are clear before execution; each actual save, unchanged result, draft requiring review, failure and unattempted target is reported truthfully.

### 4. Continue a creative conversation
**Do:** Discuss changes, explicitly Read selected Project/Scene values and inspect what was shared, update the saved source and Read again to confirm fresh values, then refine a previously authored idea and apply a useful revision after a follow-up.  
**Check:** Read answers use the correct fresh saved context (including when the model replies in plain prose), without a separate acknowledgment-only call; conversation alone never saves. Existing complete authored material remains actionable after follow-ups, without re-authoring or silently replacing accepted work.

### 5. Switch Project context mid-conversation
**Do:** With Director attached to Project A, navigate Studio to Project B; continue discussing A, explicitly switch Director's working target when appropriate, and make a reviewed change.  
**Check:** Navigation and conversation attachment remain distinguishable; source context is correct, the destination is explicit, and the save goes to the deliberately selected Project—even if navigation changes after launch. Neither Project receives unintended changes.

### 6. Revisit and compare unsaved proposals
**Do:** Generate two distinct Scene proposals for the same Project in separate Director responses; edit one without saving, open the other, then return to the first.  
**Check:** Each response opens its own actual material; edits and unsaved status survive switching; reviewing or saving one does not falsely complete or overwrite the other.

### 7. Leave, return, and recover
**Do:** Save some changes, leave other drafts uncommitted, navigate away or reopen the conversation, and resume; include one interrupted/failed operation and one edit conflicting with newer saved material. Exercise actual Undo/Redo after manual and Director edits, including independent fields, and reload the page.  
**Check:** Field-scoped Undo/Redo restores the expected values without changing unrelated fields, and session-only field history clears after reload. Saved state survives, recoverable drafts remain available where supported, conflicts and failures are visible, and retrying does not duplicate work. A save followed by a failed refresh/receipt is still reported as saved; an unconfirmed save never is.

### 8. Compose with reusable Studio Blocks
**Do:** Create or edit an Idea/Guidance Block, reopen/edit it, copy and delete a Block, and insert another into a partly written Director prompt using `/`. Exercise arrow-key selection, Escape dismissal, and Enter insertion; edit the resulting text and send when ready.  
**Check:** Reopen/edit persists; copy yields plain text; deletion removes the selected Block; keyboard navigation, Escape and Enter work without sending. Insertion occurs at the cursor without prematurely sending, preserving the rest of the prompt; the actual edited text is sent, with no hidden Block attachment or automatic Project mutation.

## Optional specialist flow

### 9. Use adjacent Studio utilities without confusing ownership
**Do:** From an existing Project/Scene, run Check Coherence, inspect its suggested Scene changes, and separately use Revise & Generate where relevant.  
**Check:** Each utility performs its own advertised operation; proposals do not silently save or generate Takes, and saves/generation happen only through their explicit actions. Do not confuse utility output with ordinary Director chat or its Scene drafts.

Run this only when testing the broader Studio Director-adjacent experience; it is not a prerequisite for the three core Read/Write capabilities.

## Flexible conversation and cross-Project transitions

These are **journeys through existing features**, not six new model operations or
a complete cross-product of launch points. Record source provenance, approved
Read items, each received response's actual fields, the suggested destination,
the destination confirmed at Apply and the saved record IDs independently.

1. **Mid-conversation new Project pivot.** Start in saved Project A, discuss
   an unrelated concept, receive new Overview material, and choose **Create
   Project** in Review. The existing A stays unchanged; its selection alone
   neither grants Read access nor binds the draft to A. Continue discussing
   both projects without creating a new chat.
2. **Switch sources and targets independently.** Read selected details from
   A, navigate to B, revise material, return to A, and optionally apply material
   originating in A to B. The approved source list, conversation and potential
   destination remain distinguishable; each write uses the author-confirmed
   destination, even when Studio navigation changes.
3. **Author without any destination.** Receive two actual new Scenes in a
   conversation with no attached Project, edit one, then choose Project B
   in the existing Review/Apply surface. Retain fields and edits through the
   choice without a second model call or an invented Project.
4. **Change creative direction after Scene creation.** Author and save Scenes,
   then develop a new Overview direction in the same conversation, save that
   Overview first and revise selected Scenes from the new saved direction. A
   Project-only change never rewrites Scenes, and a new direction may be
   applied to a different Project than its source.
5. **Multiple entry points, same material ownership.** Author or revise a
   Scene from the inline Scene button, the Director composer, and the existing
   Write panel. Verify real returned fields, the same relevant review/save
   semantics, and that entering through a Scene does not permanently bind
   later unrelated conversation drafts to it.
6. **Ambiguous target, visible correction.** Read a Scene from A as a pacing
   reference, an Invariant from C as a character reference, while B is open;
   create/revise a draft and inspect the suggested destination. Change the
   target to B or create a new Project in the existing form. Confirm only
   the chosen saved record changes. A mention in prose, an open editor, a
   Read source or a model-suggested action is not conclusive destination
   evidence.

**Required schema checkpoints before these journeys:** inspect the actual
studio_chat schema received by the model and its request guidance.
The relevant authored response fields must be explicitly required for a
selected authoring operation; absence of action hints must not remove valid
creative fields. Conversation may remain open-ended, but ordinary chat and
requested authoring must not share a schema that permits a bare completion
claim as a successful authored response. Partial returned fields remain
recoverable even when a model violates its requested schema.

**Read approval checkpoints:** suggest current Overview/Scene but send no
saved creative content before authorization; approve multiple independent
Project/Scene source items; refresh only the approved items on later requests;
revoke one source without deleting other selections or unsaved proposals.
Do not require detailed JSON inspection or an acknowledgment-only model call.

## Targeted variations (not a full matrix)

Run only where they add coverage not already demonstrated by the main flows:

- **Combined request:** Ask for a Project and initial Scenes in one request; confirm Project creation survives a subsequent Scene failure (Flows 1–2).
- **Partial model result:** Request multiple Scenes but receive fewer, extra, or incomplete records, or a complete Prompt with invalid duration (Flow 2).
- **Cancellation after actual saves (Flow 3):** Launch a multi-Scene write/revision, wait until at least one Scene's save is confirmed, then cancel while the next target is pending or running. Revisit and reload the Project. Verify earlier confirmed Scene saves persist exactly once, the in-flight target is counted according to its *actual* saved state, and untouched targets remain unchanged; the UI distinguishes saved, failed/cancelled and not-attempted targets. Cancellation never rolls back saved work or implies that an already-running model call was interrupted.
- **Truncated model output (Flow 2):** Exercise a provider-reported output/context token limit during multi-Scene authoring, including a response with usable complete Scene records and a response whose structured result is unusable. Verify that complete records actually received remain reviewable/savable, invalid or incomplete material does not overwrite good fields, and the truncation and any unmet requested count are visible in the job receipt/Console. Never infer completed Scenes from requested counts or model claims; do not manufacture records from incomplete JSON or silently retry to conceal the limit.
- **Navigation during an active write (Flow 5):** Begin a Scene revision or multi-Scene write explicitly bound to Project A, navigate to Project B while the model call is pending, then allow completion. Verify the returned material and confirmed saves stay bound to A's original Scene IDs even if B is the visible editor; B remains unchanged, and returning to A reveals the saved changes without needing to re-author them.
- **Scope and history:** Revise only a title or duration; verify other fields and session-only field history are unaffected (Flows 3 and 7).
- **Ownership:** Director remains attached to A while the editor displays B; two replies offer different Scene drafts for one Project (Flows 5–6).
- **Context/lifecycle:** Existing Project selected while creating a different Project; stale saves and post-save receipt failures (Flows 1 and 7).

## Execution approach

**Real-model Playwright acceptance is the functional standard.** The controlled-model suite verifies plumbing and persistence but cannot establish whether the configured LLM obeys WebCap's actual guidance, schema or evolving conversation. Run `npx playwright test tests/live/studio-actual-schema.spec.cjs --config=playwright.live.config.cjs --headed` locally first for required prompts, Project pivots, Scene destination changes and independent Read sources. A complete, requested Prompt is a hard live checkpoint: capture the actual queued schema and actual model response, and fail if the requested Prompt is omitted or unusable. See `tests/live/README.md`. Real-model tests are not run in CI; a passing controlled-browser suite is not equivalent evidence.

Run the eight core flows in a sensible cumulative order to reduce setup and model calls; use the optional specialist flow only when in scope, recording each checkpoint separately. Reuse generated material rather than asking the model to recreate it just for verification. When a flow fails, record the precise failed operation and observed browser/saved state, then continue with independent checkpoints where possible.

For every model-backed checkpoint, note model, source commit, request, actual response, model-call count, destination, and verified saved result; avoid using model claims as proof. For cancellation, truncation and in-flight navigation variations, record the exact stop/truncation signal, save receipts, target IDs and reloaded saved values; distinguish provider-reported limits from WebCap configuration. Expand coverage only for an observed regression, an untested high-risk state boundary, or a newly shipped capability. Avoid exhaustive launch-point permutations and broad UI checks that do not establish a real user outcome.

**Real-model boundary tests:** `tests/live/studio-boundaries.spec.cjs` exercises in-flight revision cancellation, Project navigation during an active revision, and provider-reported token truncation via the configured model and WebCap's real routes. Run with `npx playwright test --config=playwright.live.config.cjs tests/live/studio-boundaries.spec.cjs`. Cancellation is marked skipped if the model finishes before the stop window; truncation is marked skipped if the provider does not actually reach/reveal a token limit. A skip is not acceptance evidence. These tests do not replace the full browser flows or assert that usable Scenes can be parsed from arbitrary incomplete JSON.

*Planning document: acceptance intentions, not a claim that these flows already pass or that every described operation is currently implemented.*
