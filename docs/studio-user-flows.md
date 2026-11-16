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

## Targeted variations (not a full matrix)

Run only where they add coverage not already demonstrated by the main flows:

- **Combined request:** Ask for a Project and initial Scenes in one request; confirm Project creation survives a subsequent Scene failure (Flows 1–2).
- **Partial model result:** Request multiple Scenes but receive fewer, extra, or incomplete records, or a complete Prompt with invalid duration (Flow 2).
- **Mixed batch outcome:** Some Scene revisions save while others need review, fail, or remain unattempted after cancellation (Flow 3).
- **Scope and history:** Revise only a title or duration; verify other fields and session-only field history are unaffected (Flows 3 and 7).
- **Ownership:** Director remains attached to A while the editor displays B; two replies offer different Scene drafts for one Project (Flows 5–6).
- **Context/lifecycle:** Existing Project selected while creating a different Project; stale saves and post-save receipt failures (Flows 1 and 7).

## Execution approach

Run the eight core flows in a sensible cumulative order to reduce setup and model calls; use the optional specialist flow only when in scope, recording each checkpoint separately. Reuse generated material rather than asking the model to recreate it just for verification. When a flow fails, record the precise failed operation and observed browser/saved state, then continue with independent checkpoints where possible.

For every model-backed checkpoint, note model, source commit, request, actual response, model-call count, destination, and verified saved result; avoid using model claims as proof. Expand coverage only for an observed regression, an untested high-risk state boundary, or a newly shipped capability. Avoid exhaustive launch-point permutations and broad UI checks that do not establish a real user outcome.

*Planning document: acceptance intentions, not a claim that these flows already pass or that every described operation is currently implemented.*
