"""Durable Assistant conversations. No Story/Scene ownership or live context binding."""

import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from . import config as app_config


_LOCK = threading.RLock()
_ID = re.compile(r"^[0-9]{8}T[0-9]{6}\.[0-9]{6}Z-[0-9a-f]{8}$")
_MODES = {"chat", "storyboard"}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _root():
    return app_config.app_state_root() / "director_chats"


def _path(chat_id):
    if not isinstance(chat_id, str) or not _ID.fullmatch(chat_id):
        raise ValueError("Invalid Assistant conversation ID.")
    return _root() / chat_id / "conversation.json"


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".conversation-", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(data, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def _read(path):
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        raise FileNotFoundError("Assistant conversation does not exist.") from None
    if not isinstance(data, dict):
        raise RuntimeError("Assistant conversation is not a JSON object: " + str(path))
    return data


def _active_path():
    return _root() / "active.json"


def _active():
    path = _active_path()
    if not path.exists():
        return {}
    data = _read(path)
    return {mode: chat_id for mode, chat_id in data.items()
            if mode in _MODES and isinstance(chat_id, str) and _ID.fullmatch(chat_id)}


def _set_active(mode, chat_id):
    active = _active()
    if chat_id is None:
        active.pop(mode, None)
    else:
        active[mode] = chat_id
    _write(_active_path(), active)


def _validated_write_action(action):
    """Persist the review destination and user edits, not copied model content."""
    if (not isinstance(action, dict) or action.get("kind") not in
            {"create_project", "write_project", "create_scene", "write_scenes"}
            or not isinstance(action.get("instruction"), str)
            or not action["instruction"].strip()):
        return None
    scene = action.get("scene")
    if not isinstance(scene, dict):
        scene = None
    fields = action.get("fields")
    result = {
        "kind": action["kind"], "instruction": action["instruction"],
        "fields": [field for field in (fields if isinstance(fields, list) else [])
                   if isinstance(field, str)],
        "request": str(action.get("request") or ""),
        "projectId": str(action.get("projectId") or ""),
        "scene": {key: scene[key] for key in ("projectId", "sceneId", "sceneNumber")
                  if key in scene} if scene else None,
        "completed": action.get("completed") is True,
    }
    if isinstance(action.get("actionKey"), str) and action["actionKey"]:
        result["actionKey"] = action["actionKey"]
    if isinstance(action.get("chosenProjectId"), str):
        result["chosenProjectId"] = action["chosenProjectId"]
    review = action.get("reviewDraft")
    if isinstance(review, dict) and isinstance(review.get("values"), dict):
        values = {key: value for key, value in review["values"].items()
                  if key in {"title", "prompt", "durationSeconds"} and isinstance(value, str)}
        if (isinstance(review.get("projectId"), str)
                and isinstance(review.get("sceneId"), str)):
            result["reviewDraft"] = {
                "projectId": review["projectId"], "sceneId": review["sceneId"],
                "values": values,
            }
    return result


def _validate_messages(messages):
    if not isinstance(messages, list):
        raise ValueError("Assistant conversation messages must be an array.")
    result = []
    for item in messages:
        if (not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}
                or not isinstance(item.get("content"), str)):
            raise ValueError("Assistant conversation contains an invalid message.")
        message = {"role": item["role"], "content": item["content"]}
        if "rawResponse" in item:
            if (item["role"] != "assistant" or not isinstance(item["rawResponse"], str)
                    or not item["rawResponse"].strip()):
                raise ValueError("Only assistant messages can store a complete model response.")
            message["rawResponse"] = item["rawResponse"]
        if item["role"] == "assistant":
            if "writeAction" in item:
                action = _validated_write_action(item["writeAction"])
                if action:
                    message["writeAction"] = action
            if "otherWriteActions" in item:
                if not isinstance(item["otherWriteActions"], list):
                    raise ValueError("Assistant alternate Write actions must be an array.")
                message["otherWriteActions"] = [
                    action for value in item["otherWriteActions"]
                    if (action := _validated_write_action(value))
                ]
        result.append(message)
    return result


def _validate_attachments(attachments):
    if not isinstance(attachments, dict):
        raise ValueError("Assistant attachments must be an object.")
    result = {}
    for key, value in attachments.items():
        if (not isinstance(key, str) or not isinstance(value, dict)
                or ("key" in value and value["key"] != key) or not isinstance(value.get("label"), str)
                or not isinstance(value.get("content"), str)):
            raise ValueError("Assistant conversation contains an invalid attachment.")
        result[key] = {"key": key, "label": value["label"], "content": value["content"]}
    return result


def _validate_working_draft(value):
    """Sparse unsaved field replacements; saved Stories remain authoritative."""
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("Studio working draft must be an object.")

    def fields(raw, allowed):
        if not isinstance(raw, dict):
            raise ValueError("Studio working draft fields must be an object.")
        result = {}
        for name, item in raw.items():
            if name not in allowed:
                continue
            if name == "invariants":
                if not isinstance(item, list):
                    continue
            elif name == "durationSeconds":
                if isinstance(item, bool) or not isinstance(item, int):
                    continue
            elif not isinstance(item, str):
                continue
            result[name] = item
        return result

    projects = value.get("projects") or {}
    scenes = value.get("scenes") or {}
    if not isinstance(projects, dict) or not isinstance(scenes, dict):
        raise ValueError("Studio working draft targets must be objects.")
    result = {
        "projects": {key: fields(item, {"title", "concept", "style", "invariants"})
                     for key, item in projects.items() if isinstance(key, str) and isinstance(item, dict)},
        "scenes": {key: fields(item, {"title", "prompt", "durationSeconds"})
                   for key, item in scenes.items() if isinstance(key, str) and isinstance(item, dict)},
        "newProject": fields(value.get("newProject") or {}, {"title", "concept", "style", "invariants"}),
        "newScene": fields(value.get("newScene") or {}, {"title", "prompt", "durationSeconds"}),
        "sourceRequest": str(value.get("sourceRequest") or ""),
    }
    if "draftOrigins" in value:
        # Current frontend provenance was previously dropped at this boundary.
        # Restore actual saved baselines for target-specific reuse after reload.
        origins = value["draftOrigins"]
        if not isinstance(origins, dict):
            raise ValueError("Studio draft origins must be an object.")

        def origin(item):
            if item is None:
                return None
            if not isinstance(item, dict):
                raise ValueError("Studio draft origin must be an object.")
            result = {key: item[key] for key in ("projectId", "request", "baseline")
                      if isinstance(item.get(key), str)}
            if isinstance(item.get("fields"), list):
                result["fields"] = [name for name in item["fields"] if isinstance(name, str)]
            if isinstance(item.get("timingNeedsReview"), bool):
                result["timingNeedsReview"] = item["timingNeedsReview"]
            return result

        def origin_map(name):
            entries = origins.get(name) or {}
            if not isinstance(entries, dict):
                raise ValueError("Studio draft origins map must be an object.")
            return {key: origin(item) for key, item in entries.items()
                    if isinstance(key, str) and isinstance(item, dict)}

        result["draftOrigins"] = {
            "projects": origin_map("projects"),
            "scenes": origin_map("scenes"),
            "newProject": origin(origins.get("newProject")),
            "newScene": origin(origins.get("newScene")),
        }
    return result


def _validate_write_io(records):
    """Retain verbatim Scene Write output for diagnostics, separate from chat context."""
    if not isinstance(records, list):
        raise ValueError("Studio Write I/O history must be an array.")
    for record in records:
        if (not isinstance(record, dict)
                or set(record) != {"operation", "projectId", "at", "rawResponse"}
                or record["operation"] not in {"studio_scenes_draft", "studio_scene_field_draft"}
                or not all(isinstance(record[key], str) for key in record)):
            raise ValueError("Studio Write I/O record is invalid.")
    return [dict(record) for record in records]


def _validate_operations(operations):
    """Small author-visible receipts, never a copy of LLM extraction or Story data."""
    if not isinstance(operations, list) or len(operations) > 25:
        raise ValueError("Studio operation history must contain at most 25 receipts.")
    allowed = {"project.create", "project.scene.progress", "project.initial-scenes",
               "scene.create", "scenes.create", "brief.apply", "brief.undo"}
    result = []
    for item in operations:
        if not isinstance(item, dict) or set(item) != {"kind", "label", "storyId", "sceneIds", "at"}:
            raise ValueError("Studio operation receipt has invalid fields.")
        if (item["kind"] not in allowed or not isinstance(item["label"], str)
                or not item["label"].strip() or len(item["label"]) > 200
                or not isinstance(item["storyId"], str) or len(item["storyId"]) > 160
                or not isinstance(item["at"], str) or len(item["at"]) > 45
                or not isinstance(item["sceneIds"], list) or len(item["sceneIds"]) > 32
                or any(not isinstance(scene_id, str) or len(scene_id) > 160 for scene_id in item["sceneIds"])):
            raise ValueError("Studio operation receipt is invalid.")
        result.append({key: item[key] for key in ("kind", "label", "storyId", "sceneIds", "at")})
    return result


def _validate_readiness(value):
    """Bounded, explicitly model-proposed conversation working state; never Project authority."""
    if value is None:
        return {"checks": [], "readHints": [], "writeHint": "", "sceneId": "", "sceneNumber": 0}
    if (not isinstance(value, dict) or
            not {"checks", "readHints", "writeHint", "sceneId"}.issubset(value) or
            not set(value).issubset({"checks", "readHints", "writeHint", "writeInstruction", "writeFields", "sceneId", "sceneNumber", "stale", "capture"})):
        raise ValueError("Studio readiness must contain checks, Read hints and Write hint.")
    checks = value["checks"]
    if not isinstance(checks, list) or len(checks) > 30:
        raise ValueError("Studio readiness has too many assessments.")
    names = {"Concept", "Characters", "Setting", "Action", "Dialogue",
             "Visual / atmosphere", "Visual focus", "Structure / formula",
             "Variation / repetition", "Production feasibility"}
    for item in checks:
        if (not isinstance(item, dict) or set(item) != {"name", "scope", "ready", "content"}
                or item["name"] not in names or item["scope"] not in {"project", "scene"}
                or not isinstance(item["ready"], bool) or not isinstance(item["content"], str)
                or len(item["content"]) > 8000):
            raise ValueError("Studio readiness contains an invalid assessment.")
    read_hints = value["readHints"]
    if (not isinstance(read_hints, list) or len(read_hints) > 15
            or any(not isinstance(hint, str) or len(hint) > 120 for hint in read_hints)):
        raise ValueError("Studio Read recommendations are invalid.")
    if value["writeHint"] not in {"", "project", "new-project", "scene", "scenes", "scene-edit", "scenes-batch", "scene-move", "scene-duplicate", "scene-split", "scene-invariants", "playbook"}:
        raise ValueError("Studio Write recommendation is invalid.")
    if not isinstance(value["sceneId"], str) or len(value["sceneId"]) > 160:
        raise ValueError("Studio Scene recommendation is invalid.")
    if "writeInstruction" in value and (
        not isinstance(value["writeInstruction"], str) or len(value["writeInstruction"]) > 3000
    ):
        raise ValueError("Studio Scene write instruction is invalid.")
    scene_number = value.get("sceneNumber", 0)
    if (type(scene_number) is not int or not 0 <= scene_number <= 10000):
        raise ValueError("Studio Scene number recommendation is invalid.")
    write_fields = value.get("writeFields", [])
    allowed_fields = (
        {"title", "concept", "style", "invariants"} if value["writeHint"] == "project"
        else {"title", "summary", "prompt", "durationSeconds"} if value["writeHint"] in {"scene", "scenes", "scene-edit", "scenes-batch"}
        else set()
    )
    if (not isinstance(write_fields, list) or len(write_fields) > 4
            or any(not isinstance(field, str) or field not in allowed_fields for field in write_fields)
            or len(set(write_fields)) != len(write_fields)):
        raise ValueError("Studio Write field recommendations are invalid.")
    if "stale" in value and not isinstance(value["stale"], bool):
        raise ValueError("Studio readiness freshness flag must be a boolean.")
    capture = value.get("capture")
    if capture is not None:
        if not isinstance(capture, dict):
            raise ValueError("Studio creative capture is invalid.")
        if capture.get("field") == "scene":
            if (set(capture) not in ({"field", "content", "sceneId", "title"},
                                     {"field", "content", "sceneId", "title", "prompt"},
                                     {"field", "content", "sceneId", "title", "durationSeconds"})
                    or ("durationSeconds" in capture and (type(capture["durationSeconds"]) is not int
                            or not 4 <= capture["durationSeconds"] <= 15))
                    or not isinstance(capture["title"], str) or len(capture["title"]) > 240
                    or ("prompt" in capture and (not isinstance(capture["prompt"], str)
                                                  or len(capture["prompt"]) > 20000))
                    or capture["sceneId"] != ""):
                raise ValueError("Studio creative capture Scene identity is invalid.")
        elif capture.get("field") == "invariant":
            if (set(capture) != {"field", "content", "sceneId", "kind", "title", "beforeKind", "beforeTitle"}
                    or capture["kind"] not in {"character", "location", "visual", "world", "sound", "custom"}
                    or not isinstance(capture["title"], str) or not capture["title"].strip()
                    or len(capture["title"]) > 240
                    or not isinstance(capture["beforeKind"], str)
                    or not isinstance(capture["beforeTitle"], str)
                    or len(capture["beforeTitle"]) > 240
                    or bool(capture["beforeKind"]) != bool(capture["beforeTitle"])
                    or (capture["beforeKind"] and capture["beforeKind"] not in {
                        "character", "location", "visual", "world", "sound", "custom"
                    })
                    or capture["sceneId"] != ""):
                raise ValueError("Studio creative capture Invariant identity is invalid.")
        elif (set(capture) != {"field", "content", "sceneId"}
                or capture["field"] not in {"title", "concept", "style", "summary", "prompt"}
                or not isinstance(capture["sceneId"], str) or len(capture["sceneId"]) > 160
                or (capture["field"] in {"title", "concept", "style"} and capture["sceneId"])):
            raise ValueError("Studio creative capture is invalid.")
        if (not isinstance(capture["content"], str) or not capture["content"].strip()
                or len(capture["content"]) > 20000):
            raise ValueError("Studio creative capture text is invalid.")
    result = {"checks": checks, "readHints": read_hints,
              "writeHint": value["writeHint"], "sceneId": value["sceneId"]}
    if "writeFields" in value:
        result["writeFields"] = write_fields
    if "sceneNumber" in value:
        result["sceneNumber"] = scene_number
    if "writeInstruction" in value:
        result["writeInstruction"] = value["writeInstruction"]
    if "stale" in value:
        result["stale"] = value["stale"]
    if capture is not None:
        result["capture"] = capture
    return result


def _validate_story_access(access):
    """One explicit conversation-owned read grant, never copied Story content."""
    if access is None:
        return None
    if not isinstance(access, dict) or set(access) != {"storyId", "label"}:
        raise ValueError("Studio Story access must identify one Story.")
    story_id, label = access["storyId"], access["label"]
    if (not isinstance(story_id, str) or not story_id or len(story_id) > 160
            or not isinstance(label, str) or not label.strip() or len(label) > 240):
        raise ValueError("Studio Story access contains invalid identifiers.")
    return {"storyId": story_id, "label": label.strip()}


def _validate_workshop(workshop):
    if workshop is None:
        return None
    if (not isinstance(workshop, dict) or not isinstance(workshop.get("storyId"), str)
            or not isinstance(workshop.get("sceneId"), str)
            or not isinstance(workshop.get("expectedPrompt"), str)):
        raise ValueError("Assistant Workshop snapshot is invalid.")
    return workshop


def _summary(chat):
    return {**{key: chat[key] for key in ("id", "mode", "title", "createdAt", "updatedAt", "revision")},
            "projectTitle": (chat.get("storyAccess") or {}).get("label", "")}


def list_chats():
    with _LOCK:
        root = _root()
        chats = []
        if root.exists():
            for folder in root.iterdir():
                if folder.is_dir() and _ID.fullmatch(folder.name):
                    chat = _read(folder / "conversation.json")
                    chats.append(_summary(chat))
        chats.sort(key=lambda chat: chat["updatedAt"], reverse=True)
        return {"chats": chats, "activeByMode": _active()}


def create_chat(mode):
    if mode not in _MODES:
        raise ValueError("Assistant conversation mode must be Chat or Storyboard.")
    with _LOCK:
        chat_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + "-" + uuid.uuid4().hex[:8]
        now = _now()
        chat = {"id": chat_id, "mode": mode, "title": "New chat", "createdAt": now,
                "updatedAt": now, "revision": 0, "messages": [], "draft": "", "attachments": {}, "workshop": None, "operations": [], "writeIo": [], "storyAccess": None, "readiness": _validate_readiness(None), "workingDraft": _validate_working_draft(None)}
        _write(_path(chat_id), chat)
        _set_active(mode, chat_id)
        return chat


def open_chat(chat_id, *, activate=True):
    with _LOCK:
        chat = _read(_path(chat_id))
        if activate:
            _set_active(chat["mode"], chat_id)
        return chat


def save_chat(chat_id, payload):
    if not isinstance(payload, dict):
        raise ValueError("Assistant conversation update must be an object.")
    with _LOCK:
        path = _path(chat_id)
        chat = _read(path)
        expected = payload.get("expectedRevision")
        if isinstance(expected, bool) or not isinstance(expected, int) or expected != chat["revision"]:
            raise RuntimeError("Assistant conversation changed elsewhere. Reload it before editing; current text was not overwritten.")
        title = payload.get("title")
        draft = payload.get("draft")
        if not isinstance(title, str) or not title.strip() or not isinstance(draft, str):
            raise ValueError("Assistant conversation requires a title and draft text.")
        chat.update(title=title.strip(), draft=draft,
                    messages=_validate_messages(payload.get("messages")),
                    attachments=_validate_attachments(payload.get("attachments", {})),
                    workshop=_validate_workshop(payload.get("workshop")),
                    operations=_validate_operations(payload.get("operations", chat.get("operations", []))),
                    writeIo=_validate_write_io(payload.get("writeIo", chat.get("writeIo", []))),
                    storyAccess=_validate_story_access(payload.get("storyAccess", chat.get("storyAccess"))),
                    readiness=_validate_readiness(payload.get("readiness", chat.get("readiness"))),
                    workingDraft=_validate_working_draft(payload.get("workingDraft", chat.get("workingDraft"))),
                    revision=chat["revision"] + 1, updatedAt=_now())
        _write(path, chat)
        return chat


def delete_chat(chat_id):
    with _LOCK:
        path = _path(chat_id)
        chat = _read(path)
        path.unlink()
        path.parent.rmdir()
        if _active().get(chat["mode"]) == chat_id:
            _set_active(chat["mode"], None)
        return chat_id
