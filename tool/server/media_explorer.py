"""Read-only owner-backed Media Explorer discovery; no persistent index."""
import json
import os
from pathlib import Path
from urllib.parse import quote
from . import config as app_config
from .generate_store import list_results


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv", ".avi"}


def _kind(path):
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return ""


def _item(path, role, storage_id, created_at, rating=0, model="", uses=None):
    root = app_config.output_root().resolve()
    candidate = (root / path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    generation_root = (root / 'generations').resolve()
    try:
        candidate.relative_to(generation_root)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    kind = _kind(candidate)
    if not kind:
        return None
    return {
        "id": "generate:" + path,
        "source": "generate",
        "storageId": storage_id,
        "role": role,
        "mediaKind": kind,
        "fileName": candidate.name,
        "mediaPath": path,
        "mediaUrl": "/fs/generate/media?path=" + quote(path, safe=""),
        "createdAt": created_at,
        "rating": rating if role == "generated" else None,
        "model": model,
        "uses": uses or [],
    }


def discover_generate(limit=500):
    """Discover recorded outputs and their saved reference copies."""
    items = {}
    for record in list_results(limit=limit):
        storage_id = str(record.get("storageId") or "")
        created = int(record.get("createdAt") or 0)
        model = str(record.get("modelId") or "")
        media = str(record.get("mediaPath") or "")
        output = _item(media, "generated", storage_id, created,
                       record.get("rating", 0), model)
        if output:
            items[output["id"]] = output
        references = record.get("references") or {}
        if not isinstance(references, dict):
            continue
        for role, path in references.items():
            relative = str(path or "")
            item = _item(relative, "reference", storage_id, created, model=model,
                         uses=[{"storageId": storage_id, "role": str(role)}])
            if item:
                current = items.get(item["id"])
                if current:
                    current["uses"].extend(item["uses"])
                else:
                    items[item["id"]] = item
    return sorted(items.values(), key=lambda x: (x["createdAt"], x["id"]), reverse=True)


def _legacy_test_roots():
    """Find legacy session roots during an explicit full scan only."""
    base = Path(app_config.FS_ROOT)
    if base.is_symlink():
        raise RuntimeError("Media Explorer root cannot be symlinked.")
    for directory, names, _files in os.walk(base, followlinks=False):
        path = Path(directory)
        names[:] = [name for name in names
                    if name not in ("output", ".webcap", ".webcap_training", ".webcap_runtime",
                                    "originals", "auto_dataset")
                    and not (path / name).is_symlink()]
        if path != base and "test-generations" in names:
            candidate = path / "test-generations"
            names.remove("test-generations")
            yield candidate


def discover_tests(full=False):
    """Read supported central Test session manifests without changing session state.

    Legacy-only Sets are enumerated only on explicit full scans. Every
    thumbnail uses the existing owner-validated route.
    """
    central = app_config.output_root() / "test-generations"
    if not central.is_dir() or central.is_symlink():
        return []
    roots = [central]
    workspaces = central / "sets"
    if workspaces.is_dir() and not workspaces.is_symlink():
        for workspace in workspaces.iterdir():
            if workspace.is_dir() and not workspace.is_symlink():
                for child in ("sessions", "test-sessions"):
                    candidate = workspace / child
                    if candidate.is_dir() and not candidate.is_symlink():
                        roots.append(candidate)
    # Owner folders from recorded central manifests also identify their legacy
    # per-Set session roots. Do not recursively crawl arbitrary source Sets.
    known_owners = set()
    for root in roots:
        for session in root.iterdir():
            manifest = session / "test.json"
            if not session.is_dir() or session.is_symlink() or not manifest.is_file() or manifest.is_symlink():
                continue
            try:
                payload = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(payload, dict) and payload.get("ownerFolder"):
                known_owners.add(str(payload["ownerFolder"]).strip("/"))
    from .epoch_test_bench import _session_directory, _session_rating_map
    for folder in known_owners:
        owner = (Path(app_config.FS_ROOT) / folder).resolve()
        try:
            owner.relative_to(Path(app_config.FS_ROOT).resolve())
        except ValueError:
            continue
        legacy = owner / "test-generations"
        if legacy.is_dir() and not legacy.is_symlink():
            roots.append(legacy)
    if full:
        roots.extend(_legacy_test_roots())
    results = []
    seen_sessions = set()
    for root in roots:
        for session in root.iterdir():
            if not session.is_dir() or session.is_symlink():
                continue
            manifest = session / "test.json"
            if not manifest.is_file() or manifest.is_symlink():
                continue
            try:
                status = json.loads(manifest.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(status, dict):
                continue
            folder = str(status.get("ownerFolder") or "").strip("/")
            if not folder and root.name == "test-generations" and root != central:
                try:
                    folder = root.parent.resolve().relative_to(Path(app_config.FS_ROOT).resolve()).as_posix()
                except ValueError:
                    continue
            if not folder:
                continue
            # Only advertise sessions the owner's standard resolver recognizes.
            try:
                owner = Path(app_config.FS_ROOT) / folder
                if _session_directory(owner, session.name).resolve() != session.resolve():
                    continue
            except (ValueError, FileNotFoundError):
                continue
            if session.resolve() in seen_sessions:
                continue
            seen_sessions.add(session.resolve())
            ratings = _session_rating_map(session)
            for record in status.get("results") or []:
                if not isinstance(record, dict):
                    continue
                name = str(record.get("mediaFile") or record.get("outputVideo") or "")
                if not name or Path(name).name != name:
                    continue
                file = session / name
                if file.is_symlink() or not file.is_file() or not _kind(file):
                    continue
                relative = file.relative_to(Path(app_config.FS_ROOT)).as_posix()
                url = ("/fs/test_generations/media?folder=" + quote(folder, safe="")
                       + "&session=" + quote(session.name, safe="")
                       + "&media=" + quote(name, safe=""))
                results.append({
                    "id": "test:" + relative, "source": "test", "storageId": session.name,
                    "ownerFolder": folder, "role": "generated",
                    "mediaKind": _kind(file), "fileName": name,
                    "mediaPath": relative, "mediaUrl": url,
                    "createdAt": int(status.get("startedAt") or 0),
                    "rating": ratings.get(name), "model": str(status.get("modelId") or ""),
                    "uses": [{"storageId": session.name, "role": "test result"}],
                })
    return results



def discover_epoch_frames():
    """Read retained campaign frames only, via Epoch Finder's owner contract."""
    from .epoch_finder import storage_campaigns, frame_path
    frames = []
    for campaign in storage_campaigns():
        folder = str(campaign["folder"])
        campaign_id = str(campaign["id"])
        manifest = Path(campaign["path"]) / "campaign.json"
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        owner = app_config.safe_join_fs_root(folder)
        for unit in payload.get("units") or []:
            if not isinstance(unit, dict):
                continue
            name = str(unit.get("frame") or "")
            if not name:
                continue
            try:
                file = frame_path(owner, campaign_id, name)
            except FileNotFoundError:
                continue  # Retired screening frames are not durable artifacts.
            relative = file.relative_to(Path(app_config.FS_ROOT)).as_posix()
            frames.append({
                "id": "epoch:" + relative,
                "source": "epoch", "storageId": campaign_id,
                "ownerFolder": folder, "role": "generated",
                "mediaKind": "image", "fileName": name, "mediaPath": relative,
                "mediaUrl": "/fs/epoch_finder/frame?folder=" + quote(folder, safe="")
                            + "&campaign=" + quote(campaign_id, safe="")
                            + "&frame=" + quote(name, safe=""),
                "createdAt": int(payload.get("createdAt") or 0),
                "rating": None, "model": str(payload.get("modelId") or ""),
                "uses": [{"storageId": campaign_id, "role": "Epoch Finder campaign"}],
            })
    return frames



def discover_storyboards():
    """Story-owned takes and references, served only by Storyboard's media route."""
    from .storyboard_store import list_stories, load_story, resolve_story_media
    found = {}
    for summary in list_stories():
        story_id = str(summary.get("id") or "")
        story = load_story(story_id)
        for scene_id, scene in (story.get("scenes") or {}).items():
            if not isinstance(scene, dict):
                continue
            entries = [(take, "generated" if take.get("generated") else "source", take_id)
                       for take_id, take in (scene.get("takes") or {}).items() if isinstance(take, dict)]
            entries += [(ref, "reference", str(ref.get("role") or "reference"))
                        for ref in scene.get("references") or [] if isinstance(ref, dict)]
            for entry, role, label in entries:
                path = str(entry.get("mediaPath") or "")
                try:
                    file = resolve_story_media(story_id, path)
                except (ValueError, RuntimeError, FileNotFoundError):
                    continue
                kind = _kind(file)
                if not kind:
                    continue
                identity = "storyboard:" + story_id + ":" + path
                use = {"storageId": str(scene_id), "role": label}
                if identity in found:
                    found[identity]["uses"].append(use)
                    continue
                found[identity] = {
                    "id": identity, "source": "storyboard", "storageId": story_id,
                    "ownerFolder": "", "role": role, "mediaKind": kind,
                    "fileName": file.name, "mediaPath": path,
                    "mediaUrl": "/fs/storyboard/media?story=" + quote(story_id, safe="")
                                + "&path=" + quote(path, safe=""),
                    "createdAt": 0, "rating": None, "model": "",
                    "uses": [use],
                }
    return list(found.values())


def list_media(limit=60, offset=0, role="", kind="", search="", sort="newest", full=False, source=""):
    limit = max(1, min(int(limit), 120))
    offset = max(0, int(offset))
    full = str(full).strip().lower() in ("1", "true", "yes")
    if source not in ('', 'generate', 'test', 'epoch', 'storyboard'):
        raise ValueError('Unknown Media Explorer source.')
    results = (discover_generate(limit=None if full else 500) if source in ('', 'generate') else [])
    if source in ('', 'test'):
        results.extend(discover_tests(full=full))
    if source in ('', 'epoch'):
        results.extend(discover_epoch_frames())
    if source in ('', 'storyboard'):
        results.extend(discover_storyboards())
    results.sort(key=lambda item: (item['createdAt'], item['id']), reverse=True)
    if role:
        results = [item for item in results if item["role"] == role]
    if kind:
        results = [item for item in results if item["mediaKind"] == kind]
    if search:
        query = search.casefold()
        results = [item for item in results if query in item["fileName"].casefold()
                   or query in item["model"].casefold()]
    if sort == "oldest":
        results.sort(key=lambda item: (item["createdAt"], item["id"]))
    elif sort == "name":
        results.sort(key=lambda item: (item["fileName"].casefold(), item["id"]))
    elif sort == "rating":
        results.sort(key=lambda item: (-(item["rating"] or 0), -item["createdAt"], item["id"]))
    elif sort != "newest":
        raise ValueError("Unknown media sort.")
    return {"ok": True, "items": results[offset:offset + limit],
            "total": len(results), "offset": offset, "limit": limit,
            "complete": full, "scope": "Supported sources (full Generate/legacy Test scan)" if full else "Supported sources (recent Generate/known Test)"}
