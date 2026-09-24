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

A Story also owns planning and generation defaults. `targetSceneCount` guides Director scene planning without acting as a hard scene limit. Story-wide `aspectRatio` and `megapixels` defaults are inherited by Scenes unless a Scene stores an explicit override. Effective generation settings are resolved and frozen when a Take is queued, so later Story-default changes do not mutate queued jobs or existing Take provenance.

## Non-negotiable architecture

### Local-first, file-based storage

Storyboard must remain consistent with WebCap's existing storage philosophy.

- No database.
- No opaque application index required to recover a Story.
- Stories are folders.
- Durable Story/Scene metadata is human-readable JSON.
- Generated media lives in predictable folders beneath the Story.
- Every durable Story-owned artifact lives beneath the Story folder; provider/runtime scratch does not.
- A Story folder can be copied, backed up, inspected, or repaired independently of WebCap.
- Deleting a Story is an explicit permanent operation that stops Story-bound inference first, then removes the complete Story folder.
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
Storyboard -> llama.cpp Director runtime (text planning / prompt authoring)
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
  "style": "Persistent visual atmosphere, cinematic language, era, texture, and visual tone.",
  "invariants": [
    {"kind": "character", "title": "Alice", "text": "Alice keeps the same facial identity, dark bob, and red coat."},
    {"kind": "sound", "title": "Score", "text": "Sparse analog synth, no vocals."}
  ],
  "loras": [
    {"name": "character/alice.safetensors", "strength": 0.9}
  ],
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

`style` is the Story's persistent visual/atmosphere block. `invariants` are additional typed facts that should remain stable across independently generated Scenes, such as recurring characters, world rules, or soundtrack language. The Director receives these blocks as compact Story context rather than a long conversation history.

The Story authoring panel is a dedicated, wide middle column between the Story library and Scene workspace, and is explicitly collapsible. The desktop target is a large production workspace: Story uses a comfortable authoring width rather than sidebar proportions, with readable helper text and Concept actions attached directly to the Concept field. Story and Scene are independent full-height panes rather than one long document.

Scene authoring has two centered workspace modes, **Overview** and **Focus**, plus a persistent horizontal Scene progression strip for normal movement through the Story. Focus edits one Scene at a time. The Scene itself uses a large prompt surface beside a fully visible Generation panel; normal settings such as duration, aspect ratio, megapixels, and seed are not hidden. Conditioning remains visible as Scene context, while deeper reference editing can still use disclosure. Entry/Exit state are first-class Scene fields; Notes remain optional.

The selected Scene's Takes occupy a substantial bottom evaluation dock. Take cards expand to consume available width up to a sensible maximum and only become horizontally scrollable once there are enough results to require it.

## Scene model

A Scene is one ordered generation intent.

The schema should support future providers without forcing Phase 1 to implement them:

```json
{
  "id": "stable-scene-id",
  "title": "Entering the lobby",
  "summary": "Alice enters and notices wet footprints.",
  "entryState": "Alice is outside the closed lobby door in the rain.",
  "exitState": "Alice is inside beside the closed door, focused on wet footprints.",
  "prompt": "Full model-facing prompt, manually authored or pasted.",
  "durationSeconds": 6,
  "seed": null,
  "seedMode": "random",
  "loras": [],
  "storyLoraOverrides": [],
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

Story and Scene LoRA entries are provider-visible names plus the strength consumed by the current H3 Power LoRA Loader. Story LoRAs are inherited by every Scene. A Scene stores only sparse `storyLoraOverrides` when it disables an inherited LoRA or changes its strength, plus its own independent `loras`:

```json
{
  "name": "character/alice.safetensors",
  "strength": 0.9
}
```

An inherited override is keyed by LoRA name, for example `{"name":"character/alice.safetensors","enabled":false}` or `{"name":"character/alice.safetensors","strength":0.7}`. Effective generation settings are resolved when a Take is queued, so later Story changes do not rewrite queued jobs or Take provenance.

The H3 turbo LoRA that belongs to the base workflow stays implicit and is not duplicated into Story or Scene data.

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
- `docs/mmh3-prompt-template.txt` — concise base-mode skeleton copied from the current official MiniMax H3 output contract; it is not a competing WebCap-specific format.
- `docs/storyboard-director-context.txt` — compact copy/paste director context for immediate manual testing with ComfyUI `Generate Text`.
- `docs/storyboard-scene-plan.schema.json` — strict JSON contract for whole-Story -> ordered Scene planning; WebCap validates before creating canonical Scenes.
- `docs/storyboard-plan-audit.schema.json` — advisory semantic-audit contract used after deterministic plan validation and before an optional single repair pass.

WebCap should eventually assemble provider requests from these stable instructions plus current Story/Scene context. The provider is not the authoritative session store.

## Provider direction

### LLM authoring

Storyboard Director supports two execution modes while keeping one provider-neutral authoring layer:

- **Local llama.cpp** — WebCap starts and manages `llama-server` on loopback, discovers GGUFs from the shared Model Root `text_encoders` folder, explicitly loads the selected model for a request, and unloads it afterward.
- **Remote OpenAI-compatible** — WebCap connects directly to a configured API base such as `http://host:11434/v1`, discovers models from `/models`, and sends the same Director contracts to `/chat/completions`. This path is suitable for Ollama or another compatible server on a different machine.

The selected Director model is a runtime preference stored by the browser, not Story data. Remote inference never reserves WebCap's local GPU or asks local ComfyUI to free models. Local llama.cpp keeps the conservative GPU handoff: WebCap reserves the GPU, asks idle ComfyUI to unload cached models/free memory, loads one Director model, then unloads it and releases the reservation after the request.

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


Storyboard exposes a **Director model** selector populated from the active runtime's model list. The selection is runtime preference, not Story meaning. Initially one selected model handles planning, audit, prompt writing, and revision; cross-model audit can remain an explicit later option.

### ComfyUI

ComfyUI remains the generation engine.

The current Storyboard H3 generation path is intentionally narrow:

- it loads the FL2VA task-family checkpoint;
- it uses ComfyUI's `MiniMaxH3ImageToVideo` conditioning node;
- no exact keyframe -> T2VA-style base prompting;
- first frame only -> I2VA-style base prompting;
- first + last frames -> FL2VA base prompting;
- last frame only -> L2VA-style base prompting;
- all of those use the official three-field base prompt contract;
- Ref2VA is a separate future task family and should not leak its six-section prompt vocabulary into the current Director-model runtime.

Storyboard queries ComfyUI for available LoRAs and only offers Scene selections that ComfyUI can actually see. Other capabilities may still be discovered later where that improves correctness:

- model/workflow availability
- supported reference inputs
- generation job status/outputs

Do not allow Storyboard to invent provider paths that ComfyUI cannot see.

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

Current Focus IA keeps the Scene form as a naturally scrolling authoring page: Scene intent/prompt remain primary, Entry/Exit live under a **Continuity** disclosure, Generation/Conditioning remain alongside the form, and Takes can be temporarily collapsed. When the Scene workspace itself is sufficiently wide, CSS docks the same expanded Takes section as a vertical media rail; there is no JavaScript DOM relocation or dock state.


Goal: make Storyboard useful for supervised production before automated intelligence.

Current implementation on the Storyboard branch now includes:

- Take records stored with each Scene while media stays under predictable `takes/<scene-id>/` folders
- manual image/video upload as a Take, copied into the Story folder
- frozen Scene prompt/settings provenance on import
- Take preview, 1-5 rating, and selected Take per Scene
- Take labels, explicit permanent deletion, native collapse/expand, and responsive wide-layout docking without moving the underlying DOM
- reversible Take removal that retains media and metadata for restore
- selected-Take sequence preview in Scene order
- semantic `first_frame` and `last_frame` reference assignment from existing Takes; `guide_frame` remains a reserved domain role for future reference-to-video support rather than a current UI option
- first/last frame extraction for video Takes using WebCap's existing ffmpeg frame path
- a direct previous-selected-Take last-frame -> next-Scene first-frame continuity action

The current slice also supports direct image upload into a Scene's `first_frame` or `last_frame` slot. Uploaded references are copied into the Story's own `references/manual/` area, replace cleanly, and are removed when no longer referenced.

The current slice also includes Story-level generation defaults for target Scene count, aspect ratio, and megapixels. New Scenes inherit Story generation defaults unless a Scene stores an explicit override.

### Phase 3 - ComfyUI generation adapter

Goal: generate Takes without coupling Storyboard to Test Generations.

The current usable slice keeps Storyboard ownership of Story/Scene/Take meaning while using WebCap's shared inference runtime:

- Storyboard freezes the Scene prompt, generation settings, effective Story/Scene LoRAs, and semantic references before enqueue;
- wildcard syntax is not interpreted by Storyboard; the frozen raw prompt and generation seed are passed to the H3 ComfyUI workflow, whose ImpactWildcardProcessor owns wildcard expansion during execution;
- Storyboard Takes enter the common `inference` lane alongside standalone Generate work, so queue positions are global;
- the shared inference runner owns scheduling, GPU acquisition/release, ComfyUI transport, provider polling/cancellation, and lifecycle transitions;
- the shared MiniMax H3 adapter resolves model/VAE/turbo-LoRA assets and binds prompt/settings/first-last frame references;
- completed MP4 output is copied into the Scene's Take folder;
- the generated Take freezes the actual prompt, source prompt, duration, aspect ratio, megapixels, seed, workflow profile, LoRAs, references, and provider job ID;
- pending Take cards remain Storyboard-owned and project the common queue's real global position;
- manual Story/Scene text editing remains the canonical authoring path; an LLM is not required.

The current slice now also includes Scene LoRA discovery/selection:

- Storyboard discovers LoRAs from ComfyUI's `LoraLoader` object info;
- the base H3 turbo LoRA remains implicit and is excluded from the selectable list;
- each Scene stores an ordered `name + strength` list;
- the workflow adapter resolves every selected name against the running ComfyUI instance before submission and appends it to the Power LoRA Loader;
- generated Take provenance freezes the selected Scene LoRAs.

Still to add after real usage validates this slice:

- guide/reference-to-video roles beyond H3's first/last-frame image-to-video sockets.

Successful Take capture now removes the owned ComfyUI output when the provider exposes a local saved-output path; the durable Story Take remains canonical.

Stop/cancel, restart reconciliation, multiple queued Takes, and shared GPU arbitration are already provided through the common inference path.

### Phase 4 - Reference continuity

Goal: make scene-to-scene visual continuity practical.

The continuity path is now usable end to end for H3 first/last-frame generation: semantic reference roles are stored on Scenes, video Take boundary frames can be materialized into the Story's `references/` folder, the previous Scene's selected Take can feed the next Scene's `first_frame` reference, and the Storyboard H3 adapter uploads those images to ComfyUI and binds them to the native `first_frame` / `last_frame` sockets.

Remaining provider-facing work:

- arbitrary guide/reference-to-video inputs where the current base-family workflow supports them
- a separate future Ref2VA adapter only if richer full-reference generation proves worthwhile; do not overload the current FL2VA-family path with Ref2VA semantics
- reference image selection from existing WebCap/Krea media surfaces beyond the implemented direct filesystem upload
- keep semantic reference roles independent of ComfyUI node IDs

Temporary ComfyUI input-reference copies are now removed after a Take is safely captured when WebCap can verify ComfyUI's local input/output filesystem layout. If that layout is not safely addressable, cleanup is skipped rather than guessing.

### Phase 5 - LLM-assisted authoring

Goal: make authoring faster without changing the canonical Story model.

Current runtime slice:

- WebCap-managed llama.cpp router process on loopback;
- local GGUF discovery through the existing configured WebCap Model Root (`text_encoders`);
- Storyboard-level Director model selector;
- `expand_concept` turns a terse Story seed into a richer persistent overview without creating Scenes; the previous concept is kept as one-step recoverable text;
- `develop_story` turns the saved concept/style into a complete structured Scene sequence and writes the initial H3-ready prompt for every Scene in the same whole-Story pass;
- whole-Story development now returns explicit shared continuity definitions for recurring subjects, wardrobe states, locations, and other persistent visible/audible facts, plus per-Scene references to the definitions that apply;
- WebCap validates those references and injects the exact shared descriptions into each applicable H3 prompt mechanically, including later Director prompt rewrites and final generation compilation; wardrobe/location continuity is therefore not inferred from prose after the fact;
- deterministic validation against `docs/storyboard-scene-plan.schema.json` plus app-level validation before any Scene replacement is written;
- replanning requires explicit confirmation and moves old active Scenes into recoverable `removedScenes` without deleting their Take media;
- the accepted development plan/model are persisted in Story metadata for provenance, with per-Scene plan/prompt Director provenance retained for quiet hover inspection;
- existing `write_prompt` and `refine_prompt` Scene-local contracts remain available, with one-step **Restore Previous** persisted in `story.json` so it survives Story switches and WebCap sessions;
- every queued Storyboard Director job freezes its Story/Scene destination; the backend applies completed output directly to that durable target, so browser navigation is never responsible for persistence;
- the durable LLM queue is the authority for target occupancy: only the Story/Scene fields a Director job will replace are protected, unrelated Stories/Scenes remain usable, and conflicting requests fail visibly rather than silently doing nothing;
- Director activity overlays the field being authored rather than blocking unrelated Story/Scene controls;
- thinking disabled for these bounded authoring calls;
- sampling is app-owned rather than left to changing runtime defaults: concept expansion is mildly creative, Develop Scenes is conservative, and Scene write/refine calls are tighter; local llama.cpp also receives explicit top-k/min-p settings with repetition/presence/frequency penalties disabled so necessary continuity wording is not discouraged;
- Storyboard and Generate Director requests share the app-owned `llm` execution lane and may queue without inventing a separate Storyboard scheduler;
- local Director work shares WebCap GPU arbitration; a successfully loaded local model may remain resident for the next LLM task, while Training/Inference explicitly release the loaded Director model before claiming GPU work;
- idle ComfyUI model release before local Director loading;
- no conversational memory; WebCap's stored Story/Scene state remains the complete durable context.

Next candidates after real usage:

- Story-aware Scene enhancement/rewrite with compact whole-Story context;
- AI-assisted split/insert/merge operations for evolving creative structure;
- one semantic audit using `docs/storyboard-plan-audit.schema.json` and at most one bounded repair pass if quality warrants the extra inference;
- continuity review;
- branching/version UX only if actual production use proves simple recoverable replacement is insufficient;
- lightweight conversational UI only if explicit bounded actions stop being enough.

Manual editing remains available at all times. AI output proposes or edits the same Scene objects the user can edit directly.

### Phase 6 - Assembly and production polish

The first intentionally small assembly slice is now implemented. Storyboard uses three peer workspace modes — **Overview**, **Focus**, and **Sequence** — so assembled playback/export no longer consumes authoring height above the active Scene.

- the existing per-Scene `selectedTakeId` values are the edit decision;
- selected video Takes are frozen in Scene order when export starts;
- Storyboard validates that their media streams match closely enough for a safe lossless splice;
- ffmpeg's concat demuxer joins them with stream copy rather than silently resizing/re-encoding;
- the result is written predictably to `exports/selected-sequence.mp4`;
- `exports/selected-sequence.json` records exactly which Scene/Take selections produced that export and is the durable export state after WebCap restarts;
- the finished sequence is playable directly in the dedicated Sequence view;
- if the user changes Take selection afterward, the previous export is visibly treated as stale rather than presented as current.

Deliberately not implemented yet:

- automatic normalization/re-encode for incompatible Takes;
- transitions, gaps, trims, overlays, or a timeline editor;
- alternate export profiles;
- Story search/filter/tag views;
- richer completion/progress summaries beyond the implemented compact Story readiness line;
- reusable Story/Scene templates.

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


## Current LLM contract slice

Storyboard keeps request meaning separate from execution. `tool/server/storyboard_llm_contract.py` remains the pure request-assembly boundary, while `tool/server/storyboard_llm_runtime.py` owns the llama.cpp process/model lifecycle and HTTP transport.

The current operations are deliberately explicit rather than chat-like:

- `expand_concept`: Story title + current concept + style; returns richer concept prose and does not create Scenes.
- `develop_story`: Story concept + style + concise H3 rules; returns schema-constrained JSON containing the complete ordered Scene structure and initial H3 prompt for every Scene.
- `write_prompt`: Story style + current Scene + only a useful previous exit-state handoff + the concise H3 output contract.
- `refine_prompt`: the same local Scene context plus the existing prompt and one explicit correction. The contract asks for the smallest coherent revision rather than a creative rewrite.

The contract module does not call a provider. The llama.cpp runtime consumes its returned prompt, so context assembly and leakage boundaries stay testable independently from model quality/runtime behavior.

Entry and exit state remain manual first-class Scene fields. Whole-Story development now proposes them initially, while the user can still edit them directly at any time.


## Director runtime setup

Storyboard expects a recent CUDA-enabled llama.cpp build because the model-router API is relatively new and current Qwen GGUF support continues to evolve.

Minimal configuration lives under `storyboard.director` in `tool/config.json`:

```json
{
  "storyboard": {
    "director": {
      "llama_server": "/absolute/path/to/llama-server",
      "port": 8189,
      "context_size": 8192,
      "max_tokens": 4096
    }
  }
}
```

`llama_server` may be left empty when `llama-server` is already on WebCap's PATH. Director model discovery reuses WebCap's existing `filesystem.models` / **Models Root** setting and scans its `text_encoders` subfolder, so there is no second model-root configuration.

Put local `.gguf` Director models in that existing `text_encoders` folder. On the WSL training machine, a Windows-style Models Root is converted through WebCap's existing WSL path helper before llama.cpp starts. WebCap does not automatically download multi-gigabyte models; downloads remain visible and user-controlled.

On the WSL training machine, prefer running a Linux CUDA build of llama.cpp inside the same WSL environment as WebCap. A Windows `llama-server.exe` can introduce path-translation problems for model files even though WSL can launch Windows executables.

Current runtime assumptions:

- NVIDIA/CUDA inference with all model layers requested on GPU;
- 8K default context, configurable;
- one model loaded at a time;
- no model autoload;
- Jinja chat templates enabled;
- prompt caching enabled inside a loaded model process;
- thinking/reasoning disabled for current Storyboard authoring calls;
- a successfully loaded Director model may remain resident between LLM calls; Training/Inference explicitly release it when they need the shared GPU, and transient KV/cache state is never treated as durable Story memory.

The important operational dependency beyond model disk space is therefore a **recent CUDA-capable llama.cpp binary**. No Python llama.cpp binding, Ollama daemon, database, or ComfyUI text workflow is required.
