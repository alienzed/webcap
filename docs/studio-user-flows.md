# Studio Director — User Flows for Browser Acceptance

## Purpose

Cover the most Studio Director capabilities with the fewest practical browser journeys and model calls. These are **high-level user flows**, not implementation-level tests or a requirement to test every feature from every launch point.

Each flow has independently observable checkpoints: a later failure must not obscure whether earlier work succeeded. Reuse the Projects, Scenes, and conversations created by earlier flows where practical, but allow a flow to run independently with equivalent starting data.

**Universal pass criteria:** The browser displays the material actually returned; useful partial results remain available; save receipts reflect confirmed persistence; unsaved work is not presented as saved; and subsequent navigation, replies, or operations do not silently overwrite unrelated material. Verify saved state by revisiting/reloading it, not by trusting model claims or button labels.

## Core flows

### 1. Create a Project and Overview
**Do:** From a fresh Studio Director conversation, request a new Project with a title, concept, style, and invariants; review/edit the proposal and save it.  
**Check:** The reviewed Overview is actually saved under a new Project, remains editable, and survives returning to it.

### 2. Create multiple Scenes
**Do:** In that Project, request several Scenes in a single conversation response; inspect and save the useful drafts.  
**Check:** Every usable authored Scene can be reviewed; the saved count and order match actual records, with no invented, missing, or duplicate Scenes. An incomplete Scene does not invalidate complete ones.

### 3. Revise an Overview and Scenes
**Do:** Ask Director to revise selected Project details, then revise one Scene and several Scenes; review the changes and save.  
**Check:** Only intended fields and Scenes change, unaffected details survive, every result is classified as saved, unchanged, unsaved, or failed, and each unsaved draft remains accessible.

### 4. Continue a creative conversation
**Do:** Discuss changes, ask Director to read the current saved material, then refine a previously authored idea and apply a useful revision.  
**Check:** Read answers use the correct saved context; conversation alone makes no changes; revisions use the relevant material without silently replacing earlier accepted work.

### 5. Switch Project context mid-conversation
**Do:** With Director attached to Project A, navigate Studio to Project B; continue discussing A, explicitly switch Director's working target when appropriate, and make a reviewed change.  
**Check:** Navigation and conversation attachment remain distinguishable, the save goes to the deliberately selected Project, and neither Project receives unintended changes.

### 6. Revisit and compare unsaved proposals
**Do:** Generate two distinct Scene proposals for the same Project in separate Director responses; edit one without saving, open the other, then return to the first.  
**Check:** Each response opens its own actual material; edits and unsaved status survive switching; reviewing or saving one does not falsely complete or overwrite the other.

### 7. Leave, return, and recover
**Do:** Save some changes, leave other drafts uncommitted, navigate away or reopen the conversation, and resume; include one interrupted or failed operation.  
**Check:** Saved state survives, recoverable drafts remain available where supported, failures are visible, and retrying does not create duplicates or falsely mark unfinished work as saved.

## Targeted variations (not a full matrix)

Run only where they add coverage not already demonstrated by the main flows:

- **Starting context:** Create a new Project while another Project is already open (Flow 1).
- **Partial model result:** Request multiple Scenes but receive fewer, extra, or incomplete records (Flow 2).
- **Mixed batch outcome:** Some Scene revisions save successfully while others need review or fail (Flow 3).
- **Ownership:** Director is attached to A while the Studio editor displays B (Flow 5).
- **Draft identity:** Two different replies offer Scene drafts for the same Project (Flow 6).

## Execution approach

Run the seven flows in a sensible cumulative order to reduce setup and model calls, recording each checkpoint separately. Reuse generated material rather than asking the model to recreate it just for verification. When a flow fails, record the precise failed operation and observed browser/saved state, then continue with independent checkpoints where possible.

Expand coverage only for an observed regression, an untested high-risk state boundary, or a newly shipped capability. Avoid exhaustive launch-point permutations and broad UI checks that do not establish a real user outcome.

*Planning document: acceptance intentions, not a claim that these flows already pass or that every described operation is currently implemented.*
