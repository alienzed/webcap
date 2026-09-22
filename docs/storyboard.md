# Storyboard

Storyboard is a first-class WebCap workspace for building longer-form visual sequences from ordered scene generations and selected takes.

It intentionally lives inside WebCap because it benefits from WebCap's local-first media handling, model awareness, ComfyUI connectivity, LoRA discovery, ratings, previews, and generation infrastructure. It is not part of the dataset/set workflow and must not depend on the current set, captions, training state, Test candidates, or Test sessions.

## Product intent

Storyboard should make this workflow direct:

1. Create or reopen a Story.
2. Describe the Story at a high level.
3. Add, remove, duplicate, and reorder Scenes.
4. Give each Scene a generation intent: prompt, duration, seed behavior, LoRAs, and optional references.
5. Generate one or more Takes for a Scene.
6. Review/rate Takes and select one as the current Take.
7. Play or assemble the selected Takes in Scene order.
8. Optionally use an LLM to propose, expand, or revise Story/Scene content without creating a separate "AI storyboard" model.

The authoring model is:

```text
Story -> Scenes -> Takes
```

A Scene is one generatable unit, not necessarily a screenplay scene. A Take is one concrete generation attempt for that Scene.

## Non-negotiable architecture

### Local-first, file-based storage

Storyboard must remain consistent with WebCap's existing storage philosophy.

- No database.
- No opaque application index required to recover a Story.
- Stories are folders.
- Durable Story/Scene metadata is human-readable JSON.
- Generated media lives in predictable folders beneath the Story.
- A Story folder can be copied, backed up, inspected, or repaired independently of WebCap.
- Derived indexes/caches may be added later only if they can be regenerated from the Story folders.

Initial root:

```text
<filesystem.root>/output/storyboards/
```

Initial Story shape:

```text
output/
  storyboards/
    <story-id>/
      story.json
      takes/
        <scene-id>/
          ...
```

`story.json` is the canonical metadata file. Scene IDs are stable; scene order is stored explicitly and does not depend on folder naming.

### Isolation from existing WebCap workflows

Storyboard is additive, not invasive.

- Storyboard owns its own DOM, frontend state, backend operations, and files.
- It does not use the current media set as implicit Story context.
- It does not mutate Test Generations state, Training state, captions, dataset state, or candidate state.
- Existing WebCap capabilities may be called through small explicit boundaries.
- Shared code should only be changed when the shared change is independently simpler/better for all consumers.
- A little localized duplication is preferable to destabilizing mature workflows for premature reuse.
- If Storyboard is broken, disabled, or removed, Prep, Review, Training, and Test should continue to behave as before.

### WebCap owns meaning; providers own execution

Storyboard owns the canonical Story, Scene, Take, revision, rating, selection, and reference metadata.

External/local providers perform work:

```text
Storyboard -> LLM adapter (native ComfyUI TextGenerate first; Ollama remains an optional fallback)
Storyboard -> ComfyUI (image/video generation)
```

Provider state must not become the canonical Story state.

In particular:

- Ollama/chat history may assist authoring, but WebCap stores the relevant revision/context history.
- ComfyUI workflows execute generation jobs, but WebCap stores the Scene intent and Take provenance.
- The data model must remain useful when either provider is offline.

## Story model

The Story is the durable project container.

Initial fields:

```json
{
  "version": 1,
  "id": "stable-story-id",
  "title": "Storm Hotel",
  "concept": "High-level reminder and grounded overview.",
  "style": "Persistent atmosphere, cinematic language, era, texture, and visual tone.",
  "tags": ["horror", "hotel"],
  "status": "active",
  "pinned": true,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "sceneOrder": ["scene-id-1", "scene-id-2"],
  "scenes": {
    "scene-id-1": {}
  }
}
```

Status is one of:

- `active`
- `complete`
- `archived`

Pinned is separate from status because an archived/completed Story may still be worth pinning.

## Scene model

A Scene is one ordered generation intent.

The schema should support future providers without forcing Phase 1 to implement them:

```json
{
  "id": "stable-scene-id",
  "title": "Entering the lobby",
  "summary": "Alice enters and notices wet footprints.",
  "prompt": "Full model-facing prompt, manually authored or pasted.",
  "durationSeconds": 6,
  "seed": null,
  "seedMode": "random",
  "wildcardsEnabled": false,
  "loras": [],
  "references": [],
  "notes": "",
  "takes": {},
  "removedTakes": {},
  "takeOrder": [],
  "selectedTakeId": null,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Future LoRA entries:

```json
{
  "name": "character/alice.safetensors",
  "strengthModel": 0.9,
  "strengthClip": 1.0
}
```

Future references use semantic roles rather than ComfyUI node IDs:

```json
{
  "role": "first_frame",
  "source": "take",
  "sourceTakeId": "take-id",
  "frame": "last"
}
```

Other likely roles include `last_frame`, `character`, `style`, and `guide_frame`.

The adapter/workflow layer is responsible for translating semantic Scene data into model/workflow-specific bindings.

## Take model

A Take is an immutable record of one generation attempt as far as provenance is concerned.

A future Take record should capture:

- stable Take ID
- Scene ID
- creation time
- output media path
- frozen prompt actually submitted
- frozen duration/seed/settings
- frozen LoRA list/strengths
- frozen references
- workflow/profile identifier
- provider job ID where useful
- rating
- selected state is represented by the Scene's `selectedTakeId`

Changing a Scene after generating a Take must not rewrite that Take's provenance.

## LLM prompting materials

Storyboard keeps its LLM instructions in versioned repo documents rather than relying on hidden session state:

- `docs/storyboard_llm_guidance.md` — stable "why we are here", task modes, continuity rules, stateless-memory contract, and runtime context assembly.
- `docs/mmh3-prompt-guidelines.md` — MiniMax H3-specific prompt-writing rules grounded in the current official H3 guides.
- `docs/mmh3-prompt-template.txt` — concise H3 prompt skeleton.
- `docs/storyboard-director-context.txt` — compact copy/paste director context for immediate manual testing with ComfyUI `Generate Text`.

WebCap should eventually assemble provider requests from these stable instructions plus current Story/Scene context. The provider is not the authoritative session store.

## Provider direction

### LLM authoring

Native ComfyUI TextGenerate is the preferred first runtime so Storyboard does not require a second local service. The initial model direction is Qwen3.5 with a low-refusal/Heretic variant. WebCap should keep a thin LLM request boundary so an Ollama adapter can replace or complement ComfyUI later without changing Story or Scene data.

LLM context stays deliberately small:

- Story `style` is the durable atmosphere/cinematic block and should normally be included.
- Story concept and current Scene context are included only when useful to the requested operation.
- Full chat transcripts and ChatGPT-like long-term memory are not part of the design.
- ComfyUI inference calls are treated as stateless; WebCap owns any continuity worth preserving.

Early authoring operations should be explicit functions rather than a general agent framework:

- develop Story into candidate Scenes
- expand a Scene summary into a model-facing prompt
- revise a Scene from a correction
- inspect Story continuity
- optionally return structured JSON

Manual prompt fields remain fully usable without an LLM. Storyboard generation always consumes those stored manual fields; future LLM assistance may propose edits to them but must never become a prerequisite for generation.

### ComfyUI

ComfyUI remains the generation engine.

Storyboard should eventually query ComfyUI for capabilities it actually exposes rather than assuming them:

- available LoRAs
- model/workflow availability
- supported reference inputs
- generation job status/outputs

Do not allow Storyboard to invent a LoRA path that ComfyUI cannot see once discovery is wired.

The Storyboard schema must not store ComfyUI node IDs as domain meaning. Node/workflow bindings belong in a narrow workflow adapter.

## Phased implementation

### Phase 1 - Manual-first functional Storyboard

Goal: prove the Story/Scene authoring workflow with no required provider connection.

Deliver:

- first-class Storyboard activity in the permanent activity rail
- Storyboard route/location restoration
- independent Storyboard workspace, not tied to a current set
- Story library:
  - create Story
  - reopen Story
  - title
  - concept
  - tags
  - active/complete/archived
  - pinned
  - recent/pinned ordering
- persistent JSON/folder storage beneath `output/storyboards`
- Story workspace:
  - add Scene
  - edit Scene
  - duplicate Scene
  - remove Scene explicitly, retaining it in `removedScenes` for restore
  - reorder Scenes
  - manual prompt entry/paste
  - title/summary/notes
  - duration
  - seed + random/fixed intent
  - wildcard intent flag
- schema placeholders for LoRAs, references, and Takes without requiring provider connectivity
- visible save/failure state
- focused backend/frontend tests for the new module and shell contract

Not required in Phase 1:

- Ollama API calls
- ComfyUI generation
- ComfyUI LoRA discovery
- reference image upload/staging
- media take playback
- sequence assembly
- provider-specific workflow bindings

The MVP is successful if a real Story can be created, authored over time, closed, reopened, reordered, and safely recovered from its folder/JSON alone.

### Phase 2 - Takes and manual media continuity

Goal: make Storyboard useful for supervised production before automated intelligence.

Current implementation on the Storyboard branch now includes:

- Take records stored with each Scene while media stays under predictable `takes/<scene-id>/` folders
- manual image/video upload as a Take, copied into the Story folder
- frozen Scene prompt/settings provenance on import
- Take preview, 1-5 rating, and selected Take per Scene
- reversible Take removal that retains media and metadata for restore
- selected-Take sequence preview in Scene order
- semantic `first_frame`, `last_frame`, and `guide_frame` reference assignment from existing Takes
- first/last frame extraction for video Takes using WebCap's existing ffmpeg frame path
- a direct previous-selected-Take last-frame -> next-Scene first-frame continuity action

Still to add:

- arbitrary external/manual reference image staging beyond existing Story Takes
- scene-level generation presets/default inheritance only where the workflow proves it useful

### Phase 3 - ComfyUI generation adapter

Goal: generate Takes without coupling Storyboard to Test Generations.

The first usable slice is now implemented with a Storyboard-owned MiniMax H3 path:

- a dedicated Storyboard API-format H3 workflow template, separate from Test Generations
- a dedicated Storyboard ComfyUI transport/worker with no Test Generations state or queue dependency
- manual Scene prompt, duration, aspect ratio, megapixels, wildcard intent, and seed behavior feed the workflow directly
- ComfyUI model/VAE/turbo-LoRA names are resolved against what the running ComfyUI instance actually exposes
- generation runs asynchronously and reports visible running/completed/failed state in the Scene
- completed MP4 output is copied into the Scene's Take folder
- the generated Take freezes the actual prompt, source prompt, duration, aspect ratio, megapixels, seed, workflow profile, and provider job ID
- manual Story/Scene text editing remains the canonical authoring path; an LLM is not required

Still to add after real usage validates this slice:

- Storyboard LoRA discovery/selection beyond the H3 turbo LoRA already in the base workflow
- guide/reference-to-video roles beyond H3's first/last-frame image-to-video sockets
- stop/cancel and restart recovery for Storyboard generation jobs
- bounded batch generation if the one-Take workflow proves useful
- cleanup of Storyboard-owned temporary ComfyUI output after the Take copy is confirmed

Do not extract a shared ComfyUI service from Test Generations merely to reduce duplicated transport code. Revisit sharing only if both consumers have a stable identical lower-level need.

### Phase 4 - Reference continuity

Goal: make scene-to-scene visual continuity practical.

The continuity path is now usable end to end for H3 first/last-frame generation: semantic reference roles are stored on Scenes, video Take boundary frames can be materialized into the Story's `references/` folder, the previous Scene's selected Take can feed the next Scene's `first_frame` reference, and the Storyboard H3 adapter uploads those images to ComfyUI and binds them to the native `first_frame` / `last_frame` sockets.

Remaining provider-facing work:

- arbitrary guide/reference-to-video inputs where the H3 reference workflow supports them
- reference image selection from WebCap media, Krea outputs, or filesystem
- cleanup of uploaded temporary ComfyUI input references after a generation is safely captured
- keep semantic reference roles independent of ComfyUI node IDs

### Phase 5 - LLM-assisted authoring

Goal: make authoring faster without changing the canonical Story model.

Candidates:

- Story concept -> proposed Scene list
- Scene summary -> full H3-ready prompt
- correction/revision loop
- continuity review
- lightweight conversational panel if it proves useful
- structured output validation before applying changes

Manual editing remains available at all times. AI output proposes or edits the same Scene objects the user can edit directly.

### Phase 6 - Assembly and production polish

Candidates:

- selected-Take sequence playback
- concatenate/export final sequence
- transition/gap handling if genuinely needed
- Story search/filter/tag views
- richer completion/progress summaries
- reusable Story/Scene templates

Do not turn WebCap into a general nonlinear video editor.

## Phase 1 guardrails

While implementing Phase 1:

- do not refactor Test Generations to make Storyboard fit
- do not change Training queue semantics
- do not add a database
- do not add Ollama or ComfyUI as a startup dependency
- do not add a provider/service framework
- do not store transient browser-only state as canonical Story data
- do not make a current set/folder selection a prerequisite to opening Storyboard
- do not hide provider or persistence failures
- keep destructive Scene/Story actions explicit and reversible; Phase 1 Scene removal is retained in `story.json` and can be restored

The architecture should leave obvious seams for later provider integration, but Phase 1 should solve only the real manual authoring workflow.
