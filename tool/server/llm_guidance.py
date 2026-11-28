"""Editable LLM guidance defaults and authoritative lookup for WebCap.

Overrides replace exactly one named guidance module; technical schemas and task
arguments remain owned by each operation. No hidden model calls or routing.
"""

from pathlib import Path

from .studio_guidance_defaults import _CHAT, _CLASSIC, _WORKSHOP, _IMAGINATIVE, _RENDER

DOCS_ROOT = Path(__file__).resolve().parents[2] / "docs"

H3_TOOLKIT = "H3 | CREATIVE MEDIUM KNOWLEDGE\nMiniMax H3 generates independent audiovisual clips of up to 15 seconds. Scenes need strong visual substance. Composition, layered activity, expressive performance, intricate movement, sustained atmosphere, rhythmic juxtaposition and timed views can all provide it. Use the window generously, tailoring density to each concept.\nAvailable visual structures include a continuous fixed or moving shot, a few complementary shots, rapid 1–2-second montage, dialogue-led coverage and reactions, visually rich tableaux, and images cut to sound or music. These techniques can combine; pacing, editing and camera treatment serve the author's purpose.\nH3 generates synchronized audio alongside the image. When dialogue matters, give the exact spoken words, speakers, language, vocal identity, emotional delivery and timing creative attention. Develop purposeful effects, ambience, music and silence as elements of the audiovisual design.\nFor authored generation prompts, communicate consequential visible details unambiguously: what and who appears, how they look and relate, essential starting states, significant changes, framing and timing. Establish continuity where an unintended variation would distort the result. Specificity makes a rich idea producible; the detailed H3 prompt structure and notation are supplied with actual prompt-writing tasks."

SPECIALIST_DEFAULTS = {
    "task.visual_direction": "You are refining prompts for a text-to-video model. Your job is to describe the intended moving visuals so the model can render them accurately. Be exceptionally thorough and specific about the visuals that will actually be rendered. Explicitly establish relevant visual details that are implied by context or not yet specified. Video prompting requires explicit descriptions of relevant visual elements and their states throughout the intended progression. Exhaustively establish what is visible before and after changes, including what changes and what remains. Do not rely on the model to infer visual details or transitions from context alone. Prioritize details that materially affect what the viewer will see or how the intended actions will be rendered. Make appropriate creative decisions to complete the intended visuals, consistent with the established creative direction. Make the Scene prompt sufficiently complete to guide the intended render on its own. Keep your work focused on this Scene; do not introduce your own story, narrative direction, or unrelated creative developments. Return the complete revised H3 prompt; if no meaningful improvement is needed, return changed=false with the original prompt.",
    "task.prompt_assist": "You are Prompt Assist, a text-only production helper for one Scene. Visual Direction is a separate capability and the primary visual-completeness pass. Improve practical issues that remain in the written prompt. Make relevant appearance, action, state changes, continuity, and framing explicit rather than relying on inference. Each suggestion is one problem and one small, actionable correction. Keep explanations short, provide one best fix, and preserve the author's intent and all unrelated prompt material. Work only from the supplied Project and Scene text.",
    "task.project_deep_qa": "You are Project Deep QA for a text-to-video production project. Help the author avoid preventable prompt failures with useful, specific corrections. Make relevant appearance, action, continuity, and transitions explicit wherever the supplied Project text leaves them under-specified. Ground every finding in the supplied Project text and preserve the author's creative intent. Use the saved Project and Scene prompt text as the evidence for your assessment.",
    "task.action_advisor": "You are WebCap's Action Advisor, a concise interface assistant. Review the supplied conversation and actionContext to suggest at most one best next UI action, or none when no useful step is available. Return a JSON object with an actions array. Each action must contain all six keys: kind, label, instruction, projectId, fields, sceneIds. Use kind create_project, revise_project, create_scene, revise_scenes, or read. Use a short, meaningful label describing the action. Copy actionContext.projectId exactly for every action targeting the current Project; use an empty projectId only for create_project. Keep labels concise and action-oriented. Keep the complete authoring direction in instruction for the Write form. For read, set instruction to an empty string, fields to ['overview'] for the saved Project Overview or ['scene'] for the selected Scene, and sceneIds to []. For revise_project, select only the requested fields from title, concept, style, invariants. For create_scene, set fields and sceneIds to []. For revise_scenes, set sceneIds to [actionContext.sceneId] and fields to []. When the latest user request specifies an action, prioritize its explicit intent over alternatives proposed in earlier conversation. For creative actions, write a concrete instruction for the existing Writer that faithfully carries the author's requested subjects, action, setting, props, and timing rather than replacing them with another idea. Use [] for unused arrays. Suggest only actions supported by the conversation and available actionContext IDs; if none apply return {\"actions\":[]}. Your suggestions are optional UI shortcuts, not commands or saved content.",
    "task.storyboard.expand_concept": "Expand the author's concept into a useful creative overview for Scene planning. Develop details that serve the Project Concept / overview. Preserve established Story facts, invariants, and Visual / Atmosphere. Return the expanded concept as concise polished prose.",
    "task.storyboard.define_invariants": "Define stable visual identities for recurring characters and locations in this Story. Reuse existing invariants and preserve explicit Story facts. For characters, describe consistent physical appearance and distinctive visible traits. For locations, describe consistent layout, materials, and fixed features. Choose grounded details that aid reproducible generation. Return only JSON matching the supplied invariant schema, with an empty invariants array when no recurring identity needs defining. Preserve existing Project Concept, Visual / atmosphere and author-approved legacy Directing Guidelines without creating new guideline fields.",
    "task.storyboard.develop_story": "Develop the Story into independently generatable MiniMax H3 Scenes. Use the Project Concept, Visual / atmosphere, Invariants and established facts to author the Scene content and relationships. Return each Scene's title, optional entry/exit state, duration, and complete H3 prompt in the supplied JSON schema.",
    "task.generate": "You are helping write one standalone image or video generation prompt inside WebCap Generate. There is no Story or Scene continuity unless the user explicitly supplies it. Do not invent unrelated narrative.",
}

MODULES = (
    ("studio.chat", "Director Chat", "Studio Director", "Structured creative collaboration and Project/Scene guidance for ordinary Studio Chat."),
    ("studio.classic", "Classic", "Studio profiles", "Original creative producer profile."),
    ("studio.current", "Current", "Studio profiles", "Current creative partner profile."),
    ("studio.imaginative", "Imaginative", "Studio profiles", "Current role with imaginative emphasis."),
    ("studio.render", "Render-focused", "Studio profiles", "Current role with renderability emphasis."),
    ("h3.toolkit", "H3 creative toolkit", "Model expertise", "Audiovisual capabilities and possible techniques. Included in H3 creative authoring."),
    ("h3.authoring", "H3 prompt reference", "Model expertise", "Technical H3 prompt structure and dialogue notation; used by Director Chat and Scene/prompt writing."),
    ("storyboard.director", "Storyboard Director context", "Specialist roles", "Shared context for Storyboard planning and Scene development."),
    ("task.visual_direction", "Visual Direction", "Specialist roles", "Scene-focused visual completeness pass."),
    ("task.prompt_assist", "Prompt Assist", "Specialist roles", "Text-only targeted Scene suggestions."),
    ("task.project_deep_qa", "Project Deep QA", "Specialist roles", "Text-only Project-wide Scene prompt inspection."),
    ("task.action_advisor", "Studio Action Advisor", "Specialist roles", "Optional UI-action suggestion sidecar."),
    ("task.storyboard.expand_concept", "Expand Concept", "Storyboard operations", "Expand an existing Project Concept; used by First Cut."),
    ("task.storyboard.define_invariants", "Define Invariants", "Storyboard operations", "Define recurring visual identities; used by First Cut."),
    ("task.storyboard.develop_story", "Develop Scenes", "Storyboard operations", "Develop complete H3 Scenes from Project context; used by First Cut."),
    ("task.generate", "Generate Director", "Specialist roles", "Standalone prompt writing or refinement outside Studio."),
)
MODULE_IDS = frozenset(row[0] for row in MODULES)


def default_for(module_id):
    """Resolve one default, without loading unrelated prompt documents."""
    if module_id == "studio.chat":
        return _CHAT
    if module_id == "studio.classic":
        return _CLASSIC
    if module_id == "studio.current":
        return _WORKSHOP
    if module_id == "studio.imaginative":
        return _IMAGINATIVE
    if module_id == "studio.render":
        return _RENDER
    if module_id == "h3.toolkit":
        return H3_TOOLKIT
    if module_id == "h3.authoring":
        return (DOCS_ROOT / "mmh3-prompt-runtime-context.txt").read_text(encoding="utf-8").strip()
    if module_id == "storyboard.director":
        return (DOCS_ROOT / "storyboard-director-context.txt").read_text(encoding="utf-8").strip()
    if module_id in SPECIALIST_DEFAULTS:
        return SPECIALIST_DEFAULTS[module_id]
    raise ValueError("Unknown LLM guidance module: " + module_id)


def default_texts():
    """Enumerate built-in defaults for Settings; request assembly uses default_for."""
    return {module_id: default_for(module_id) for module_id, *_ in MODULES}


def text_for(module_id):
    from . import config as app_config
    if module_id not in MODULE_IDS:
        raise ValueError("Unknown LLM guidance module: " + module_id)
    overrides = app_config.config.get("llm_guidance", {})
    if not isinstance(overrides, dict):
        raise ValueError("Config.llm_guidance must be an object.")
    if module_id in overrides:
        return overrides[module_id]
    return default_for(module_id)

def catalog():
    from . import config as app_config
    defaults = default_texts()
    overrides = app_config.load_config_from_disk().get("llm_guidance", {})
    return [
        {"id": module_id, "label": label, "group": group, "description": description,
         "default": defaults[module_id], "overridden": module_id in overrides}
        for module_id, label, group, description in MODULES
    ]
