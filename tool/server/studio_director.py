"""Concise, built-in WebCap Studio expertise for the H3 Writer's Workshop.

The production-prompt shape is returned separately for prompt-authoring tasks,
rather than spent on every open-ended brainstorm request.
"""

from pathlib import Path

from . import config as app_config


_H3_RUNTIME = Path(__file__).resolve().parents[2] / "docs" / "mmh3-prompt-runtime-context.txt"

# User-visible capability catalog. These entries describe WebCap controls;
# they are not direct LLM tools or promises of automatic mutation.
ACTIONS = (
    {"name": "context.read", "status": "available",
     "description": "Send only explicitly selected saved Project and Scene fields to Director; do not assume unread context."},
    {"name": "project.create", "status": "available",
     "description": "Create a reviewed Project with Concept, Visual / atmosphere, Invariants, and optional initial Scenes."},
    {"name": "project.revise", "status": "available",
     "description": "Revise an existing Project's Concept, Visual / atmosphere, or Invariants in one editable review."},
    {"name": "scenes.write", "status": "available",
     "description": "Create or revise one or more Scenes in a chosen Project, including H3 Prompt and relevant Invariants; review before applying."},
)

_WORKSHOP = (
    "STUDIO DIRECTOR | EXPERT CREATIVE PRODUCER\n"
    "You are the author's practical video director, MiniMax H3 production expert, and WebCap Studio workflow guide. "
    "The author owns the creative vision and final decisions; strengthen the idea, do not replace it. "
    "Evaluate the premise, characters, staging, action, atmosphere, visual appeal and generation feasibility. "
    "CONVERSATION STYLE: Keep replies natural, normally 1-3 sentences in one short paragraph. Address the immediate decision through brief exchanges; provide full drafts when asked, without filler or elaborate praise. "
    "When a consequential creative decision needs the author, ask one focused question; otherwise offer a specific idea. "
    "Choose routine lighting and visual clarity independently. "
    "Enthusiastically elevate the author's vision by proactively contributing imaginative details, "
    "compelling visual ideas, and expert prompting techniques that make what they want to show "
    "as effective and memorable as possible. "
    "Propose stronger alternatives when a choice is weak or underspecified; develop dialogue when useful. "
    "Give the author's intended subject, action, interaction or atmosphere a compelling on-screen treatment; "
    "make meaningful events visible without defaulting to empty setup. "
    "Give practical H3 advice without promising deterministic rendering. "
    "Choose the smallest relevant Read, reviewed Write, or author-operated Studio step when it advances the current goal. "
    "Readiness is advisory, never a gate to creative work. "
    "Read and Write are explicit author-driven operations. Conversation never edits Project records. "
    "Acknowledge only the exact saved fields actually supplied with an explicit Read; "
    "a Project ID or permission alone conveys no creative field content. "
    "Treat selected Write fields as context; suggest the intended Scene when different. "
    "After a reviewed Apply, the author's edited saved content is authoritative. "
    "Avoid verbose JSON in normal conversation except for the explicitly requested structured status.\n"
)


_H3_STUDIO_CORE = (
    "WEB CAP STUDIO / H3 PRACTICAL CONTEXT\n"
    "CREATIVE UNIT CONTRACT (two levels with distinct stored parts): "
    "Project Concept / overview (story.concept) says what the work is, its core appeal, "
    "overall structure and how Scenes relate. Project Visual / atmosphere (story.style) "
    "sets the shared look, mood and camera language. Project Invariants (story.invariants) "
    "record only fixed identities or facts that must survive across relevant Scenes. "
    "Scene summary (scene.summary) is a planning outline until an H3 Prompt exists. "
    "Once an H3 Prompt (scene.prompt) is authored, that complete saved prompt is the "
    "authoritative Scene description, including its Scene Overview when present. "
    "Treat older saved summaries as historical outlines, not competing instructions. "
    "MH3 Take generation uses the saved H3 Prompt directly. "
    "Revise each Project Overview (Concept, Visual / atmosphere, Invariants) and "
    "Scene (Title, H3 Prompt) coherently, preserving unaffected authored material. "
    "For planning-only Scenes, develop the outline before authoring the prompt. "
    "Pacing, variation and Scene relationships go in Concept or the H3 Prompt. "
    "FIELD DEVELOPMENT: Based on discussed or explicitly Read material, fill consequential gaps: "
    "distinctive stable character traits, recognizable location layouts, and purposeful Scene "
    "staging, movement, framing, timing and dialogue. "
    "Ask one focused question only when the answer materially changes the result; otherwise suggest "
    "a concrete editable draft. Capture complete agreed material for immediate review; "
    "offer reviewed Write when further drafting is needed. "
    "Assess only supplied material and meaningful gaps. "
     "Include relevant Invariants while writing or revising Scenes; WebCap handles links and identifiers, "
    "not a separate LLM action. Existing H3 Prompts are never silently rewritten. "
    "A Scene remains independently movable: put necessary starting conditions in its H3 Prompt "
    "and relevant shared constraints in Concept or Invariants. "
    "Entry and exit state fields are retired from active creative planning. "
    "Give practical H3 feedback on whether the action fits 4-15 seconds, using achievable actions and "
    "clear physical transitions. "

    "Legacy Directing Guidelines remain preserved by the older Storyboard pipeline, "
    "but are not new Studio Director destinations or fields to develop. "
    "Scenes are independently generatable clips, not necessarily narrative beats. "
    "Generate a Take, inspect it, then refine, compare or select; WebCap owns generation, Take provenance, "
    "queueing, LoRAs, seeds, sampling, dimensions and reference-frame settings. "
    "These controls and media inspection are outside Studio Director's current Read and Write scope. "
    "A Scene can be tentative without a production prompt or Takes. "
    "The H3 Storyboard generation path validates 4–15 seconds per clip. "
    "Treat uncertain model behavior as practical risks, not impossibilities.\n"
    "AVAILABLE AUTHOR-REVIEWED CREATIVE WORKFLOWS: Create Project with Concept, Visual / atmosphere, "
    "Invariants and optional initial Scenes; Revise Project with those same fields; Write Scenes to create "
    "or revise one or multiple Scenes, with reviewed insertion or revision of the H3 Prompt. "
    "These are the only creative Write goals to suggest. Read remains explicit and author-selected. "
    "Do not suggest Director operations for renaming, moving, duplicating, splitting Scenes, linking "
    "Invariants separately, undoing a Project brief or updating the H3 Playbook; WebCap or the author "
    "handles noncreative mechanics outside the Director conversation. "
    "After the author approves the review, WebCap saves the authoritative Project/Scenes; "
    "conversation alone never edits them. "
    "Other Storyboard editor/development controls remain separate. "
    "Conversation alone does not create, apply, generate, or view a Take. "
    "Read supplies only the author-selected saved fields and requires explicit acknowledgement by Director. "
    "Studio navigation does not auto-read saved fields.\n"
)


def chat_response_schema():
    """One schema-constrained conversational reply and its advisory Studio metadata."""
    capture_base = {
        "content": {"type": "string", "minLength": 1, "maxLength": 20000},
        "sceneId": {"type": "string", "enum": [""]},
    }
    captures = []
    for fields in (
        {"field": {"type": "string", "enum": ["title", "concept", "style"]}},
        {"field": {"type": "string", "enum": ["summary", "prompt"]},
         "sceneId": {"type": "string", "minLength": 1, "maxLength": 160}},
        {"field": {"type": "string", "enum": ["scene"]},
         "title": {"type": "string", "maxLength": 240}},
        {"field": {"type": "string", "enum": ["scene"]},
         "title": {"type": "string", "maxLength": 240},
         "prompt": {"type": "string", "maxLength": 20000}},
        {"field": {"type": "string", "enum": ["invariant"]},
         "kind": {"type": "string", "enum": ["character", "location", "visual", "world", "sound", "custom"]},
         "title": {"type": "string", "minLength": 1, "maxLength": 240},
         "beforeKind": {"type": "string", "enum": ["", "character", "location", "visual", "world", "sound", "custom"]},
         "beforeTitle": {"type": "string", "maxLength": 240}},
    ):
        properties = {**capture_base, **fields}
        captures.append({"type": "object", "additionalProperties": False,
                         "properties": properties, "required": list(properties)})
    readiness = []
    for operations, fields in (
        (["project"], ["title", "concept", "style", "invariants"]),
        (["scenes"], ["title", "summary", "prompt"]),
        (["", "new-project"], []),
    ):
        properties = {
            "checks": {"type": "array", "maxItems": 10, "items": {
                "type": "object", "additionalProperties": False,
                "required": ["name", "scope", "ready", "content"],
                "properties": {
                    "name": {"type": "string", "enum": [
                        "Concept", "Characters", "Setting", "Action", "Dialogue", "Visual / atmosphere",
                        "Visual focus", "Structure / formula", "Variation / repetition", "Production feasibility"]},
                    "scope": {"type": "string", "enum": ["project", "scene"]},
                    "ready": {"type": "boolean"},
                    "content": {"type": "string", "maxLength": 8000},
                },
            }},
            "readHints": {"type": "array", "maxItems": 5,
                          "items": {"type": "string", "maxLength": 120}},
            "writeHint": {"type": "string", "enum": operations},
            "writeFields": {"type": "array", "maxItems": 4 if fields else 0,
                            "uniqueItems": True,
                            "items": {"type": "string", **({"enum": fields} if fields else {})}},
            "sceneId": {"type": "string", "maxLength": 160},
            "sceneNumber": {"type": "integer", "minimum": 0, "maximum": 10000},
            # Always choose between ordinary discussion and a reusable draft.
            # An optional property was repeatedly omitted after complete prompts.
            "capture": {"anyOf": [{"type": "null"}, *captures]},
        }
        readiness.append({
            "type": "object", "additionalProperties": False,
            "required": ["checks", "readHints", "writeHint", "writeFields", "sceneId", "sceneNumber", "capture"],
            "properties": properties,
        })
    return {
        "type": "object", "additionalProperties": False,
        "required": ["reply", "readiness"],
        "properties": {"reply": {"type": "string", "minLength": 1},
                       "readiness": {"anyOf": readiness}},
    }


def guidance(target_model="minimax_h3"):
    """Return concise Studio expertise plus the distinct prompt-authoring contract."""
    if target_model != "minimax_h3":
        raise ValueError("Studio Writer's Workshop currently supports MiniMax H3.")
    try:
        prompt_contract = _H3_RUNTIME.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("Studio production prompt guidance is unavailable.") from exc
    configured = app_config.config.get("generation_model_guidance", {})
    if not isinstance(configured, dict):
        raise RuntimeError("Generation model guidance must be an object.")
    lessons = str(configured.get(target_model) or "").strip()
    system = _WORKSHOP + _H3_STUDIO_CORE
    if lessons:
        system += "USER'S H3 PRODUCTION PLAYBOOK (editable in Settings; empirical methods):\n" + lessons
    return {
        "targetModel": target_model,
        "system": system,
        "promptContract": prompt_contract,
        "actions": list(ACTIONS),
    }


def read_story_scope(story, field, scene_id=""):
    """Read one authoritative, bounded field group for an explicitly granted Story.

    No prompt assembly here: the caller decides if the retrieved data should be
    supplied privately to a specific model request. This never changes the Story.
    """
    if not isinstance(story, dict) or not story.get("id"):
        raise ValueError("Studio Story data is unavailable.")
    if field == "brief":
        data = {key: story.get(key) for key in ("title", "concept", "style", "invariants")}
    elif field == "index":
        data = [
            {"id": sid, "position": position, "title": story["scenes"][sid].get("title", ""),
             "summary": story["scenes"][sid].get("summary", "")}
            for position, sid in enumerate(story.get("sceneOrder", []), 1)
        ]
    elif field in {"scene", "prompt", "takes"}:
        if not scene_id or scene_id not in story.get("sceneOrder", []) or scene_id not in story.get("scenes", {}):
            raise ValueError("Select an existing Scene in the granted Story.")
        scene = story["scenes"][scene_id]
        if field == "scene":
            data = {key: scene.get(key) for key in ("id", "title", "summary", "entryState", "exitState", "notes")}
        elif field == "prompt":
            data = {"id": scene_id, "prompt": scene.get("prompt", ""), "durationSeconds": scene.get("durationSeconds")}
        else:
            data = {"id": scene_id, "takeIds": list(scene.get("takeOrder") or [])}
    else:
        raise ValueError("Unsupported Studio Story read scope.")
    import json
    if len(json.dumps(data, ensure_ascii=False)) > 32000:
        raise ValueError("Story field selection is too large. Select a narrower field or Scene.")
    return data
