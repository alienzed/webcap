"""Read-only Director LoRA planning contract and deterministic validation.

This planner is proposal-only. It never writes Storyboard or Generate state.
"""
import json

from .lora_library import catalogue
from .model_epoch_profile import validate_enrichment


def candidates_for_stage(stage):
    return [
        {"name": item["name"], "stage": item["stage"],
         "description": profile.get("description", ""),
         "trainedWords": profile.get("trainedWords", []),
         "promptOptions": profile.get("promptOptions", {}),
         "guidance": profile.get("guidance", "")}
        for item in catalogue()
        if item["stage"] == stage and item["enriched"]
        for profile in [validate_enrichment(item["enrichment"])]
    ]


def build_plan_request(intent, stage, scenes=None, existing=None):
    intent = str(intent or "").strip()
    if not intent:
        raise ValueError("LoRA planning requires a creative intent.")
    candidates = candidates_for_stage(stage)
    if not candidates:
        return None
    scenes = scenes if isinstance(scenes, list) else []
    payload = {
        "creativeIntent": intent[:12000],
        "eligibleLoras": candidates,
        "orderedScenes": scenes,
        "existingAssignments": existing if isinstance(existing, dict) else {},
    }
    schema = {
        "type": "object", "additionalProperties": False,
        "required": ["storyWide", "scenes", "reason"],
        "properties": {
            "reason": {"type": "string"},
            "storyWide": {"type": "array", "items": {"$ref": "#/$defs/selection"}},
            "scenes": {"type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["sceneId", "assign"],
                "properties": {
                    "sceneId": {"type": "string"},
                    "assign": {"type": "array", "items": {"$ref": "#/$defs/selection"}}
                }
            }}
        },
        "$defs": {"selection": {
            "type": "object", "additionalProperties": False,
            "required": ["name", "strength", "phrases", "reason"],
            "properties": {
                "name": {"type": "string"}, "strength": {"type": "number"},
                "phrases": {"type": "array", "items": {"type": "string"}},
                "reason": {"type": "string"}
            }
        }}
    }
    return {"operation": "lora_plan", "output": "json", "response_schema": schema,
            "prompt": "Propose a useful LoRA strategy; do not author prompts yet. "
            "Only use catalogue entries below. Select none when not genuinely relevant. "
            "Persistent identity can be story-wide; intentional progressive stages must be "
            "assigned in order to specific scenes. Never invent names or trigger phrases. "
            "Reuse existing user assignments rather than replacing them. "
            "Return JSON matching the schema. These are suggestions requiring approval.\n" +
            json.dumps(payload, ensure_ascii=False)}


def validate_plan(raw, stage, scenes=None):
    if not isinstance(raw, dict):
        raise ValueError("Director LoRA plan must be an object.")
    available = {item["name"]: item for item in candidates_for_stage(stage)}
    scene_ids = {str(item.get("id") or "") for item in (scenes or []) if isinstance(item, dict)}
    result = {"reason": str(raw.get("reason") or ""), "storyWide": [], "scenes": []}
    used_story = set()

    def check(selection):
        if not isinstance(selection, dict):
            raise ValueError("LoRA selection must be an object.")
        name = str(selection.get("name") or "")
        candidate = available.get(name)
        if candidate is None:
            raise ValueError("Director proposed a LoRA outside the enriched catalogue: " + name)
        strength = float(selection.get("strength", 1))
        if not (-100 < strength < 100):
            raise ValueError("Director proposed an invalid LoRA strength.")
        phrases = selection.get("phrases")
        if not isinstance(phrases, list) or any(not isinstance(v, str) for v in phrases):
            raise ValueError("LoRA phrases must be a list of strings.")
        known = set(candidate["trainedWords"])
        for options in candidate["promptOptions"].values():
            known.update(options)
        for phrase in phrases:
            if phrase not in known:
                raise ValueError("Director invented unsupported LoRA phrase: " + phrase)
        return {"name": name, "strength": strength, "phrases": phrases, "reason": str(selection.get("reason") or "")}

    for entry in raw.get("storyWide") or []:
        selected = check(entry)
        if selected["name"] in used_story:
            raise ValueError("Duplicate Story-wide LoRA.")
        used_story.add(selected["name"])
        result["storyWide"].append(selected)
    used_scenes = set()
    for item in raw.get("scenes") or []:
        scene_id = str(item.get("sceneId") or "")
        if scene_id not in scene_ids or scene_id in used_scenes:
            raise ValueError("Director proposed an unknown or repeated Scene.")
        used_scenes.add(scene_id)
        assigned = []
        names = set()
        for entry in item.get("assign") or []:
            selected = check(entry)
            if selected["name"] in used_story or selected["name"] in names:
                raise ValueError("Duplicate Scene or inherited Story LoRA.")
            names.add(selected["name"])
            assigned.append(selected)
        result["scenes"].append({"sceneId": scene_id, "assign": assigned})
    return result
