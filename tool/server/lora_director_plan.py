"""Request-local coded LoRA catalogue and proposal validation.

Never applies assignments. No filename inference, model execution, or persistent index.
"""
import json
import re
from .lora_library import catalogue
from .model_epoch_profile import validate_enrichment


def _code(index):
    result = ""
    index += 1
    while index:
        index, digit = divmod(index - 1, 26)
        result = chr(65 + digit) + result
    return result


def _terms(text):
    return set(re.findall(r"[a-z0-9]+", str(text or "").casefold()))


def shortlist(stage, intent, scenes=None, existing=None, max_chars=14000):
    scenes = scenes if isinstance(scenes, list) else []
    existing = existing if isinstance(existing, dict) else {}
    query = _terms(intent + " " + " ".join(str(s.get("summary") or s.get("title") or "")
                                               for s in scenes if isinstance(s, dict)))
    assigned = {
        str(item.get("name") or "")
        for item in (existing.get("storyWide") or [])
        if isinstance(item, dict)
    }
    for group in existing.get("scenes") or []:
        if isinstance(group, dict):
            assigned.update(str(item.get("name") or "") for item in group.get("assign") or []
                            if isinstance(item, dict))
    candidates = []
    for entry in catalogue():
        if entry["stage"] != stage or not entry["enriched"]:
            continue
        profile = validate_enrichment(entry["enrichment"])
        searchable = " ".join([profile.get("description", ""), profile.get("guidance", "")] +
                             profile.get("trainedWords", []) +
                             [term for group in profile.get("promptOptions", {}).values() for term in group])
        score = len(query & _terms(searchable))
        candidates.append((entry, profile, score))
    # When metadata is short enough, preserve the complete catalogue. At scale,
    # rank by grounded word overlap while always keeping assigned entries.
    def size(items):
        return len(json.dumps(items, ensure_ascii=False))
    catalogue_data = [{"name": e["name"], "stage": stage, **p} for e, p, _ in candidates]
    if size(catalogue_data) > max_chars:
        candidates.sort(key=lambda triple: (
            triple[0]["name"] not in assigned, -triple[2], triple[0]["name"].casefold()))
        chosen, used = [], 0
        for entry, profile, score in candidates:
            if score <= 0 and entry["name"] not in assigned:
                continue
            item = {"name": entry["name"], "stage": stage, **profile}
            cost = size(item)
            if entry["name"] in assigned or used + cost <= max_chars:
                chosen.append((entry, profile, score))
                used += cost
        candidates = chosen
    return [{"code": _code(i), "name": entry["name"], "stage": stage,
             "description": p.get("description", ""), "guidance": p.get("guidance", ""),
             "trainedWords": p.get("trainedWords", []), "promptOptions": p.get("promptOptions", {})}
            for i, (entry, p, _) in enumerate(candidates)]


def build_plan_request(intent, stage, scenes=None, existing=None):
    intent = str(intent or "").strip()
    if not intent:
        raise ValueError("LoRA planning requires creative intent.")
    scenes = scenes if isinstance(scenes, list) else []
    options = shortlist(stage, intent, scenes, existing)
    if not options:
        return None
    selection = {"type": "object", "additionalProperties": False, "required": ["code", "strength", "phrases", "reason"],
                 "properties": {"code": {"type": "string"}, "strength": {"type": "number"},
                                "phrases": {"type": "array", "items": {"type": "string"}},
                                "reason": {"type": "string"}}}
    schema = {"type": "object", "additionalProperties": False, "required": ["storyWide", "scenes", "reason"],
              "properties": {
                  "reason": {"type": "string"},
                  "storyWide": {"type": "array", "items": selection},
                  "scenes": {"type": "array", "items": {
                      "type": "object", "additionalProperties": False, "required": ["sceneId", "assign"],
                      "properties": {"sceneId": {"type": "string"}, "assign": {"type": "array", "items": selection}}}}
              }}
    context = {"intent": intent[:12000], "catalogue": options,
               "orderedScenes": scenes, "existingAssignments": existing or {}}
    return {"operation": "lora_plan", "output": "json", "response_schema": schema,
            "catalogue": options, "scenes": scenes,
            "prompt": "Select short LoRA CODES from the catalogue, not filenames. "
            "Use none when no entry is relevant. Use persistent character LoRAs Story-wide "
            "and progression/state LoRAs per scene when justified. Only choose phrases "
            "exactly documented for each code. Propose but never apply changes. "
            "Do not write <lora:...> syntax. Return only JSON matching the schema.\n" +
            json.dumps(context, ensure_ascii=False)}


def validate_plan(raw, catalogue_entries, scenes=None):
    if not isinstance(raw, dict):
        raise ValueError("Director LoRA plan must be an object.")
    codes = {item["code"]: item for item in catalogue_entries}
    valid_scenes = {str(item.get("id") or "") for item in (scenes or []) if isinstance(item, dict)}
    result = {"reason": str(raw.get("reason") or ""), "storyWide": [], "scenes": []}
    seen_story = set()

    def decode(entry):
        if not isinstance(entry, dict):
            raise ValueError("LoRA proposal entry must be an object.")
        code = str(entry.get("code") or "").strip()
        item = codes.get(code)
        if item is None:
            raise ValueError("Unknown LoRA code: " + code)
        strength = float(entry.get("strength", 1))
        if not (-100 < strength < 100):
            raise ValueError("Invalid LoRA strength.")
        phrases = entry.get("phrases", [])
        if not isinstance(phrases, list) or any(not isinstance(x, str) for x in phrases):
            raise ValueError("LoRA phrases must be strings.")
        allowed = set(item["trainedWords"])
        for group in item["promptOptions"].values():
            allowed.update(group)
        if any(phrase not in allowed for phrase in phrases):
            raise ValueError("Director used an undocumented keyphrase for code " + code)
        return {"name": item["name"], "strength": strength,
                "phrases": phrases, "reason": str(entry.get("reason") or "")}

    for entry in raw.get("storyWide") or []:
        item = decode(entry)
        if item["name"] in seen_story:
            raise ValueError("Duplicate Story-wide LoRA.")
        seen_story.add(item["name"])
        result["storyWide"].append(item)
    seen_scenes = set()
    for proposed in raw.get("scenes") or []:
        scene_id = str(proposed.get("sceneId") or "")
        if scene_id not in valid_scenes or scene_id in seen_scenes:
            raise ValueError("Unknown or duplicate Scene.")
        seen_scenes.add(scene_id)
        seen = set()
        assigned = []
        for entry in proposed.get("assign") or []:
            item = decode(entry)
            if item["name"] in seen_story or item["name"] in seen:
                raise ValueError("Duplicate or inherited Scene LoRA.")
            seen.add(item["name"])
            assigned.append(item)
        result["scenes"].append({"sceneId": scene_id, "assign": assigned})
    return result
