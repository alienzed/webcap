import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from flask import jsonify

from . import config as app_config
from .caption_ops import _caption_name_for_media
from .originals import BLACKLISTED_FOLDERS, MEDIA_ALL_EXTS


def _is_blacklisted_rel_path(rel_path: Path) -> bool:
    parts = [str(p).lower() for p in rel_path.parts if str(p)]
    return any(part in BLACKLISTED_FOLDERS for part in parts)


def _load_folder_state(folder_path: Path) -> dict:
    state_path = folder_path / ".webcap_state.json"
    if not state_path.exists() or not state_path.is_file():
        return {}
    try:
        with state_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _load_folder_media_metadata(folder_path: Path) -> dict:
    metadata_path = folder_path / "media_metadata.json"
    if not metadata_path.exists() or not metadata_path.is_file():
        return {}
    try:
        with metadata_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _read_caption_text(folder_path: Path, media_name: str) -> str:
    caption_name = _caption_name_for_media(media_name)
    caption_path = folder_path / caption_name
    if not caption_path.exists() or not caption_path.is_file():
        return ""
    try:
        return caption_path.read_text(encoding="utf-8")
    except Exception:
        try:
            return caption_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return ""


def _slugify_name(text: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", str(text or "").strip())
    slug = slug.strip("-._").lower()
    return slug or "smart-set"


def _validate_set_name(name: str) -> str:
    value = str(name or "").strip()
    if not value:
        return ""
    if "/" in value or "\\" in value:
        raise ValueError("set_name must be a single folder name, not a path.")
    if value in (".", ".."):
        raise ValueError("Invalid set_name.")
    return value


def _build_suggested_set_name(term: str) -> str:
    stamp = datetime.now().strftime("%Y%m%d")
    return f"smart-{_slugify_name(term)}-{stamp}"


def _parse_filter_query(raw: str) -> dict:
    text = str(raw or "").lower().strip()
    out = {"positive": [], "negative": []}
    if not text:
        return out
    parts = re.split(r"[,;\n]+", text) if re.search(r"[,;\n]", text) else [text]
    seen = set()
    for part in parts:
        term = str(part or "").strip()
        if not term:
            continue
        is_negative = term[0] in ("-", "!")
        if is_negative:
            term = term[1:].strip()
        if not term:
            continue
        key = ("!" if is_negative else "+") + term
        if key in seen:
            continue
        seen.add(key)
        out["negative" if is_negative else "positive"].append(term)
    return out


def _matches_filter_query(match: dict, query: dict, mode: str = "all") -> bool:
    tags = match.get("tags") if isinstance(match.get("tags"), list) else []
    haystack = "\n".join(
        [
            str(match.get("media_name") or ""),
            str(match.get("caption") or ""),
            " ".join([str(tag or "") for tag in tags]),
        ]
    ).lower()

    def term_matches(term: str) -> bool:
        return str(term or "").lower() in haystack

    for term in query.get("negative") or []:
        if term_matches(term):
            return False
    positives = query.get("positive") or []
    if not positives:
        return True
    if mode == "any":
        return any(term_matches(term) for term in positives)
    return all(term_matches(term) for term in positives)


def _normalize_rating(value) -> int:
    try:
        rating = round(float(value))
    except Exception:
        return 0
    return max(0, min(5, rating))


def _parse_csv_values(value: str) -> list[str]:
    out = []
    seen = set()
    for part in str(value or "").split(","):
        text = str(part or "").strip().lower()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def _parse_star_filter(value: str) -> dict:
    raw = _parse_csv_values(value)
    include_no_star = "no_star" in raw
    values = []
    seen = set()
    for entry in raw:
        try:
            n = round(float(entry))
        except Exception:
            continue
        if n < 1 or n > 5 or n in seen:
            continue
        seen.add(n)
        values.append(n)
    return {"include_no_star": include_no_star, "values": values}


def _parse_requirement_terms(raw: str) -> list[str]:
    out = []
    seen = set()
    for part in str(raw or "").split(","):
        term = re.sub(r"\s+", " ", str(part or "").strip())
        key = term.lower()
        if not term or key in seen:
            continue
        seen.add(key)
        out.append(term)
    return out


def _requirement_key(label: str) -> str:
    return str(label or "").strip().lower()


def _match_has_incomplete_requirements(match: dict, folder_state: dict) -> bool:
    requirements = folder_state.get("caption_requirements")
    if not isinstance(requirements, list) or not requirements:
        return False
    keywords_by_item = folder_state.get("caption_requirement_keywords")
    if not isinstance(keywords_by_item, dict):
        keywords_by_item = {}
    na_by_media = folder_state.get("caption_requirements_na_by_media")
    if not isinstance(na_by_media, dict):
        na_by_media = {}
    media_name = str(match.get("media_name") or "")
    media_na = na_by_media.get(media_name)
    if not isinstance(media_na, dict):
        media_na = {}
    tags = [str(tag or "") for tag in (match.get("tags") if isinstance(match.get("tags"), list) else [])]
    total = 0
    completed = 0
    for raw_label in requirements:
        label = str(raw_label or "").strip()
        if not label:
            continue
        terms = _parse_requirement_terms(str(keywords_by_item.get(label) or ""))
        if not terms:
            continue
        total += 1
        if bool(media_na.get(_requirement_key(label))):
            completed += 1
            continue
        found = False
        for term in terms:
            if any(str(tag or "").strip().lower() == term.strip().lower() for tag in tags):
                found = True
                break
        if found:
            completed += 1
    return total > 0 and completed < total


def _map_aspect_ratio_to_bucket(aspect: str) -> str:
    norm = str(aspect or "").strip().lower()
    if not norm:
        return "Unknown"
    val = None
    try:
        val = float(norm)
    except Exception:
        match = re.match(r"^([0-9]*\.?[0-9]+):([0-9]*\.?[0-9]+)$", norm)
        if match:
            left = float(match.group(1))
            right = float(match.group(2))
            if right > 0:
                val = left / right
    if val is None or val <= 0:
        return "Unknown"
    if abs(val - 1.0) < 0.05:
        return "square"
    if abs(val - (4 / 3)) < 0.05:
        return "4:3"
    if abs(val - (3 / 4)) < 0.05:
        return "3:4"
    if abs(val - (16 / 9)) < 0.05:
        return "16:9"
    if abs(val - (9 / 16)) < 0.05:
        return "9:16"
    return "Unknown"


def _has_supported_aspect_bucket(aspect: str) -> bool:
    return _map_aspect_ratio_to_bucket(aspect) != "Unknown"


def _unique_dest_dir(root: Path, preferred_name: str) -> tuple[Path, str]:
    base_name = _validate_set_name(preferred_name) or _build_suggested_set_name(preferred_name)
    candidate = root / base_name
    if not candidate.exists():
        return candidate, base_name
    i = 2
    while True:
        name = f"{base_name}-{i}"
        candidate = root / name
        if not candidate.exists():
            return candidate, name
        i += 1


def _collect_matches(root: Path, term: str) -> list[dict]:
    term_text = str(term or "").strip().lower()
    if not term_text:
        return []

    matches = []
    state_cache = {}

    for dir_path in sorted(root.rglob("*")):
        if not dir_path.is_dir():
            continue
        try:
            rel_dir = dir_path.relative_to(root)
        except Exception:
            continue
        if _is_blacklisted_rel_path(rel_dir):
            continue

        media_files = sorted(
            [p for p in dir_path.iterdir() if p.is_file() and p.suffix.lower() in MEDIA_ALL_EXTS],
            key=lambda p: p.name.lower(),
        )
        if not media_files:
            continue

        rel_key = rel_dir.as_posix() if str(rel_dir) != "." else ""
        state = state_cache.get(rel_key)
        if state is None:
            state = _load_folder_state(dir_path)
            state_cache[rel_key] = state
        tags_map = state.get("caption_tags_by_media") if isinstance(state.get("caption_tags_by_media"), dict) else {}

        for media_path in media_files:
            media_name = media_path.name
            caption_text = _read_caption_text(dir_path, media_name)
            tags_text = " ".join(tags_map.get(media_name) or []) if isinstance(tags_map.get(media_name), list) else ""
            haystack = "\n".join([caption_text, tags_text]).lower()
            if term_text not in haystack:
                continue
            has_original = (dir_path / "originals" / media_name).exists()
            matches.append(
                {
                    "source_folder": rel_key,
                    "media_name": media_name,
                    "has_caption": bool(caption_text.strip()),
                    "has_original": bool(has_original),
                }
            )

    return matches


def _iter_search_dirs(root: Path, source_folder: str):
    source_rel = str(source_folder or "").strip().replace("\\", "/").strip("/")
    source_dir = app_config.safe_join_fs_root(source_rel)
    if not source_dir.exists() or not source_dir.is_dir():
        raise ValueError("Source folder does not exist.")
    dirs = [source_dir]
    dirs.extend([p for p in sorted(source_dir.rglob("*")) if p.is_dir()])
    for dir_path in dirs:
        try:
            rel_dir = dir_path.relative_to(root)
        except Exception:
            continue
        if _is_blacklisted_rel_path(rel_dir):
            continue
        yield dir_path, rel_dir


def _collect_superset_matches(root: Path, criteria: dict) -> list[dict]:
    query = _parse_filter_query(criteria.get("filter_text") or "")
    text_match_mode = str(criteria.get("text_match_mode") or "all").strip().lower()
    if text_match_mode not in ("all", "any"):
        text_match_mode = "all"
    missing_captions_only = bool(criteria.get("missing_captions_only"))
    reviewed_only = bool(criteria.get("reviewed_only"))
    unreviewed_only = bool(criteria.get("unreviewed_only"))
    incomplete_only = bool(criteria.get("incomplete_only"))
    untagged_only = bool(criteria.get("untagged_only"))
    invalid_ar_only = bool(criteria.get("invalid_ar_only"))
    star_filter = _parse_star_filter(criteria.get("star_filter") or "")
    flag_filter = _parse_csv_values(criteria.get("flag_filter") or "")

    matches = []
    for dir_path, rel_dir in _iter_search_dirs(root, criteria.get("source_folder") or ""):
        media_files = sorted(
            [p for p in dir_path.iterdir() if p.is_file() and p.suffix.lower() in MEDIA_ALL_EXTS],
            key=lambda p: p.name.lower(),
        )
        if not media_files:
            continue

        rel_key = rel_dir.as_posix() if str(rel_dir) != "." else ""
        folder_state = _load_folder_state(dir_path)
        folder_metadata = _load_folder_media_metadata(dir_path)
        reviewed_keys = folder_state.get("reviewedKeys")
        if not isinstance(reviewed_keys, list):
            reviewed_keys = []
        reviewed_set = set(str(key or "") for key in reviewed_keys)
        tags_map = folder_state.get("caption_tags_by_media")
        if not isinstance(tags_map, dict):
            tags_map = {}
        ratings_map = folder_state.get("ratings_by_media")
        if not isinstance(ratings_map, dict):
            ratings_map = {}
        flags_map = folder_state.get("flags")
        if not isinstance(flags_map, dict):
            flags_map = {}

        for media_path in media_files:
            media_name = media_path.name
            caption_text = _read_caption_text(dir_path, media_name)
            tags = tags_map.get(media_name)
            if not isinstance(tags, list):
                tags = []
            metadata = folder_metadata.get(media_name)
            if not isinstance(metadata, dict):
                metadata = {}
            reviewed = media_name in reviewed_set
            rating = _normalize_rating(ratings_map.get(media_name))
            flag = str(flags_map.get(media_name) or "").strip().lower()
            has_caption = bool(caption_text.strip())
            match = {
                "source_folder": rel_key,
                "media_name": media_name,
                "source_media_rel": f"{rel_key}/{media_name}" if rel_key else media_name,
                "caption": caption_text,
                "tags": [str(tag).strip() for tag in tags if str(tag).strip()],
                "reviewed": reviewed,
                "rating": rating,
                "flag": flag,
                "metadata": metadata,
                "has_caption": has_caption,
                "has_original": (dir_path / "originals" / media_name).exists(),
            }

            if not _matches_filter_query(match, query, text_match_mode):
                continue
            if missing_captions_only and has_caption:
                continue
            if reviewed_only and not reviewed:
                continue
            if unreviewed_only and reviewed:
                continue
            if incomplete_only and not _match_has_incomplete_requirements(match, folder_state):
                continue
            if untagged_only and match["tags"]:
                continue
            if star_filter["values"] or star_filter["include_no_star"]:
                if rating <= 0:
                    if not star_filter["include_no_star"]:
                        continue
                elif rating not in star_filter["values"]:
                    continue
            if flag_filter:
                wants_no_flag = "no_flag" in flag_filter
                if not flag:
                    if not wants_no_flag:
                        continue
                elif flag not in flag_filter:
                    continue
            if invalid_ar_only:
                aspect = str(metadata.get("aspect") or "").strip()
                if not aspect or _has_supported_aspect_bucket(aspect):
                    continue

            matches.append(match)

    return matches


def _build_dest_name(dest_dir: Path, source_folder_rel: str, media_name: str) -> str:
    direct = dest_dir / media_name
    if not direct.exists():
        return media_name

    stem = Path(media_name).stem
    ext = Path(media_name).suffix
    source_slug = _slugify_name(source_folder_rel or "root")
    candidate_name = f"{stem}__{source_slug}{ext}"
    candidate = dest_dir / candidate_name
    if not candidate.exists():
        return candidate_name

    i = 2
    while True:
        name = f"{stem}__{source_slug}-{i}{ext}"
        if not (dest_dir / name).exists():
            return name
        i += 1


def _build_dest_name_with_suffix(dest_dir: Path, media_name: str) -> str:
    base_name = str(media_name or "").strip()
    if not base_name:
        raise ValueError("Invalid media name.")
    candidate = dest_dir / base_name
    if not candidate.exists():
        return base_name
    stem = Path(base_name).stem
    ext = Path(base_name).suffix
    i = 2
    while True:
        next_name = f"{stem}_{i}{ext}"
        if not (dest_dir / next_name).exists():
            return next_name
        i += 1


def _materialize_set(root: Path, dest_dir: Path, matches: list[dict]) -> dict:
    dest_dir.mkdir(parents=True, exist_ok=False)

    state_by_folder = {}
    reviewed_keys = []
    flags = {}
    tags_by_media = {}
    ratings_by_media = {}
    created_items = []
    originals_copied = 0

    for match in matches:
        source_folder = str(match.get("source_folder") or "")
        media_name = str(match.get("media_name") or "")
        if not media_name:
            continue

        source_dir = root / source_folder if source_folder else root
        source_media = source_dir / media_name
        if not source_media.exists() or not source_media.is_file():
            continue

        dest_name = _build_dest_name(dest_dir, source_folder, media_name)
        dest_media = dest_dir / dest_name
        shutil.copy2(source_media, dest_media)

        caption_name = _caption_name_for_media(media_name)
        source_caption = source_dir / caption_name
        if source_caption.exists() and source_caption.is_file():
            dest_caption = dest_dir / _caption_name_for_media(dest_name)
            shutil.copy2(source_caption, dest_caption)

        source_original = source_dir / "originals" / media_name
        if source_original.exists() and source_original.is_file():
            dest_originals_dir = dest_dir / "originals"
            dest_originals_dir.mkdir(parents=True, exist_ok=True)
            dest_original = dest_originals_dir / dest_name
            shutil.copy2(source_original, dest_original)
            originals_copied += 1

        if source_folder not in state_by_folder:
            state_by_folder[source_folder] = _load_folder_state(source_dir)
        src_state = state_by_folder[source_folder]

        reviewed = src_state.get("reviewedKeys")
        if isinstance(reviewed, list) and media_name in reviewed:
            reviewed_keys.append(dest_name)

        src_flags = src_state.get("flags")
        if isinstance(src_flags, dict) and media_name in src_flags:
            flags[dest_name] = src_flags[media_name]

        src_tags = src_state.get("caption_tags_by_media")
        if isinstance(src_tags, dict):
            tag_list = src_tags.get(media_name)
            if isinstance(tag_list, list) and tag_list:
                tags_by_media[dest_name] = [str(tag).strip() for tag in tag_list if str(tag).strip()]

        src_ratings = src_state.get("ratings_by_media")
        if isinstance(src_ratings, dict) and media_name in src_ratings:
            ratings_by_media[dest_name] = src_ratings[media_name]

        created_items.append(
            {
                "source_folder": source_folder,
                "source_media_name": media_name,
                "dest_media_name": dest_name,
            }
        )

    reviewed_unique = sorted(set([str(v) for v in reviewed_keys if str(v).strip()]))
    dest_state = {
        "version": 1,
        "stats": {"requiredPhrase": "", "phrases": "", "tokenRules": ""},
        "primer": {"template": "", "defaults": "", "mappings": ""},
        "reviewedKeys": reviewed_unique,
        "flags": flags,
        "caption_tags_by_media": tags_by_media,
        "ratings_by_media": ratings_by_media,
    }
    (dest_dir / ".webcap_state.json").write_text(json.dumps(dest_state, indent=2), encoding="utf-8")

    return {
        "copied_count": len(created_items),
        "originals_copied_count": originals_copied,
        "created_items": created_items,
    }


def smart_set_materialize_response(data: dict):
    payload = data or {}
    term = str(payload.get("term") or "").strip()
    if not term:
        return jsonify({"error": "Missing search term."}), 400

    dry_run = bool(payload.get("dry_run"))
    requested_name = payload.get("set_name")

    try:
        root = Path(app_config.FS_ROOT).resolve()
        matches = _collect_matches(root, term)
        suggested = _build_suggested_set_name(term)
        sample = matches[:100]

        if dry_run:
            return jsonify(
                {
                    "ok": True,
                    "term": term,
                    "match_count": len(matches),
                    "matches": sample,
                    "suggested_set_name": suggested,
                }
            )

        if not matches:
            return jsonify({"error": "No matches found for the search term."}), 400

        safe_name = _validate_set_name(requested_name or "") if requested_name is not None else ""
        preferred = safe_name or suggested
        dest_dir, final_name = _unique_dest_dir(root, preferred)
        materialized = _materialize_set(root, dest_dir, matches)

        return jsonify(
            {
                "ok": True,
                "term": term,
                "set_name": final_name,
                "folder": final_name,
                "destination": str(dest_dir),
                "match_count": len(matches),
                "copied_count": materialized["copied_count"],
                "originals_copied_count": materialized["originals_copied_count"],
                "created_items": materialized["created_items"],
            }
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            import traceback

            traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def superset_search_response(data: dict):
    payload = data or {}
    try:
        root = Path(app_config.FS_ROOT).resolve()
        criteria = payload.get("criteria") if isinstance(payload.get("criteria"), dict) else payload
        matches = _collect_superset_matches(root, criteria)
        return jsonify(
            {
                "ok": True,
                "source_folder": str(criteria.get("source_folder") or ""),
                "match_count": len(matches),
                "results": matches,
            }
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            import traceback

            traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def _normalize_destination_parent(value: str) -> str:
    text = str(value or "").strip().replace("\\", "/")
    if text == "/":
        return ""
    text = text.strip("/")
    return text


def _collect_source_media_rels(payload_items) -> list[str]:
    if not isinstance(payload_items, list) or not payload_items:
        raise ValueError("items must be a non-empty array.")
    out = []
    for item in payload_items:
        if not isinstance(item, dict):
            raise ValueError("Each item must be an object.")
        rel = str(item.get("source_media_rel") or "").strip()
        if not rel:
            raise ValueError("Each item requires source_media_rel.")
        out.append(rel.replace("\\", "/"))
    # Deterministic ordering for stable output naming.
    return sorted(out, key=lambda v: v.lower())


def _clone_primer_block(state_obj: dict) -> dict:
    src = state_obj.get("primer") if isinstance(state_obj, dict) else {}
    if isinstance(src, dict):
        return json.loads(json.dumps(src))
    return {"template": "", "defaults": "", "mappings": ""}


def create_set_from_results_response(data: dict):
    payload = data or {}
    try:
        destination_parent = _normalize_destination_parent(payload.get("destination_parent"))
        if payload.get("destination_parent") is None or not str(payload.get("destination_parent")).strip():
            raise ValueError("Missing destination_parent.")
        set_name = _validate_set_name(payload.get("set_name") or "")
        if not set_name:
            raise ValueError("Missing set_name.")
        source_media_rels = _collect_source_media_rels(payload.get("items"))

        root = Path(app_config.FS_ROOT).resolve()
        destination_parent_path = app_config.safe_join_fs_root(destination_parent)
        if not destination_parent_path.exists() or not destination_parent_path.is_dir():
            raise ValueError("Destination parent folder does not exist.")

        dest_dir = destination_parent_path / set_name
        if dest_dir.exists():
            return jsonify({"error": "Destination set folder already exists."}), 409
        dest_dir.mkdir(parents=False, exist_ok=False)

        created_items = []
        originals_copied = 0
        state_by_folder = {}
        metadata_by_folder = {}
        reviewed_keys = []
        flags = {}
        tags_by_media = {}
        ratings_by_media = {}
        caption_requirements = None
        caption_requirement_keywords = None
        caption_requirements_checked = {}
        caption_requirements_na_by_media = {}
        dest_media_metadata = {}
        source_folder_order = []

        for source_media_rel in source_media_rels:
            source_media_path = app_config.safe_join_fs_root(source_media_rel)
            if not source_media_path.exists() or not source_media_path.is_file():
                raise ValueError(f"Source media not found: {source_media_rel}")
            if source_media_path.suffix.lower() not in MEDIA_ALL_EXTS:
                raise ValueError(f"Unsupported media extension: {source_media_rel}")
            try:
                source_media_rel_path = source_media_path.relative_to(root)
            except Exception:
                raise ValueError(f"Invalid source media path: {source_media_rel}")

            source_folder = source_media_rel_path.parent
            media_name = source_media_path.name
            dest_media_name = _build_dest_name_with_suffix(dest_dir, media_name)
            dest_media_path = dest_dir / dest_media_name
            shutil.copy2(source_media_path, dest_media_path)

            source_folder_key = source_folder.as_posix() if str(source_folder) != "." else ""
            source_folder_path = source_media_path.parent
            if source_folder_key not in state_by_folder:
                state_by_folder[source_folder_key] = _load_folder_state(source_folder_path)
                source_folder_order.append(source_folder_key)
            if source_folder_key not in metadata_by_folder:
                metadata_by_folder[source_folder_key] = _load_folder_media_metadata(source_folder_path)
            src_state = state_by_folder[source_folder_key]
            src_media_metadata = metadata_by_folder[source_folder_key]

            if caption_requirements is None:
                src_requirements = src_state.get("caption_requirements")
                if isinstance(src_requirements, list):
                    caption_requirements = json.loads(json.dumps(src_requirements))
            if caption_requirement_keywords is None:
                src_keywords = src_state.get("caption_requirement_keywords")
                if isinstance(src_keywords, dict):
                    caption_requirement_keywords = json.loads(json.dumps(src_keywords))

            source_caption_path = source_media_path.parent / _caption_name_for_media(media_name)
            if source_caption_path.exists() and source_caption_path.is_file():
                dest_caption_path = dest_dir / _caption_name_for_media(dest_media_name)
                shutil.copy2(source_caption_path, dest_caption_path)

            source_original_path = source_media_path.parent / "originals" / media_name
            if source_original_path.exists() and source_original_path.is_file():
                dest_originals_dir = dest_dir / "originals"
                dest_originals_dir.mkdir(parents=True, exist_ok=True)
                dest_original_path = dest_originals_dir / dest_media_name
                shutil.copy2(source_original_path, dest_original_path)
                originals_copied += 1

            reviewed = src_state.get("reviewedKeys")
            if isinstance(reviewed, list) and media_name in reviewed:
                reviewed_keys.append(dest_media_name)

            src_flags = src_state.get("flags")
            if isinstance(src_flags, dict) and media_name in src_flags:
                flags[dest_media_name] = src_flags[media_name]

            src_tags = src_state.get("caption_tags_by_media")
            if isinstance(src_tags, dict):
                tag_list = src_tags.get(media_name)
                if isinstance(tag_list, list) and tag_list:
                    tags_by_media[dest_media_name] = [str(tag).strip() for tag in tag_list if str(tag).strip()]

            src_ratings = src_state.get("ratings_by_media")
            if isinstance(src_ratings, dict) and media_name in src_ratings:
                ratings_by_media[dest_media_name] = src_ratings[media_name]

            src_requirements_checked = src_state.get("caption_requirements_checked")
            if isinstance(src_requirements_checked, dict):
                media_checked_map = src_requirements_checked.get(media_name)
                if isinstance(media_checked_map, dict):
                    caption_requirements_checked[dest_media_name] = json.loads(json.dumps(media_checked_map))

            src_requirements_na = src_state.get("caption_requirements_na_by_media")
            if isinstance(src_requirements_na, dict):
                media_na_map = src_requirements_na.get(media_name)
                if isinstance(media_na_map, dict):
                    caption_requirements_na_by_media[dest_media_name] = json.loads(json.dumps(media_na_map))

            source_meta = src_media_metadata.get(media_name)
            if isinstance(source_meta, dict):
                dest_media_metadata[dest_media_name] = source_meta

            created_items.append(
                {
                    "source_media_rel": source_media_rel_path.as_posix(),
                    "source_folder": source_folder.as_posix() if str(source_folder) != "." else "",
                    "source_media_name": media_name,
                    "dest_media_name": dest_media_name,
                }
            )

        primer_block = {"template": "", "defaults": "", "mappings": ""}
        if source_folder_order:
            first_folder_key = source_folder_order[0]
            primer_block = _clone_primer_block(state_by_folder.get(first_folder_key, {}))

        dest_state = {
            "version": 1,
            "stats": {"requiredPhrase": "", "phrases": "", "tokenRules": ""},
            "primer": primer_block,
            "reviewedKeys": sorted(set([str(v) for v in reviewed_keys if str(v).strip()])),
            "flags": flags,
            "caption_tags_by_media": tags_by_media,
            "ratings_by_media": ratings_by_media,
        }
        if isinstance(caption_requirements, list):
            dest_state["caption_requirements"] = caption_requirements
        if isinstance(caption_requirement_keywords, dict):
            dest_state["caption_requirement_keywords"] = caption_requirement_keywords
        if caption_requirements_checked:
            dest_state["caption_requirements_checked"] = caption_requirements_checked
        if caption_requirements_na_by_media:
            dest_state["caption_requirements_na_by_media"] = caption_requirements_na_by_media
        (dest_dir / ".webcap_state.json").write_text(json.dumps(dest_state, indent=2), encoding="utf-8")
        if dest_media_metadata:
            (dest_dir / "media_metadata.json").write_text(json.dumps(dest_media_metadata, indent=2), encoding="utf-8")

        dest_folder_rel = dest_dir.relative_to(root).as_posix()
        return jsonify(
            {
                "ok": True,
                "folder": dest_folder_rel,
                "copied_count": len(created_items),
                "originals_copied_count": originals_copied,
                "created_items": created_items,
            }
        )
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        if app_config.FS_DEBUG:
            import traceback

            traceback.print_exc()
        return jsonify({"error": str(e)}), 500
