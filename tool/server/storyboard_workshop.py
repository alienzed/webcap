"""Exact H3 section boundaries for focused Storyboard conversation and reviewed edits."""

import re


_SECTION_LABELS = {
    "subject": "Subject",
    "scene overview": "Scene Overview",
    "environment / continuity anchors": "Environment / Continuity Anchors",
    "style / visual treatment": "Style / Visual Treatment",
    "integrated_multimodal_description": "Timed Shots",
    "overall_soundscape": "Soundscape",
    "non_diegetic_music": "Music",
}
_SECTION_HEADING = re.compile(
    r"^[ \t]*(Subject|Scene Overview|Environment / Continuity Anchors|"
    r"Style / Visual Treatment|integrated_multimodal_description|"
    r"overall_soundscape|non_diegetic_music)[ \t]*:[ \t]*\r?$",
    re.I | re.M,
)
_SHOT = re.compile(r"^[ \t]*\[Shot[ \t]+\d+\]", re.I | re.M)


def _sections(prompt):
    if not isinstance(prompt, str):
        raise ValueError("A saved Scene prompt is required.")
    headings = list(_SECTION_HEADING.finditer(prompt))
    sections = []
    for index, heading in enumerate(headings):
        label = _SECTION_LABELS[heading.group(1).lower()]
        line_end = prompt.find("\n", heading.end())
        start = line_end + 1 if line_end >= 0 else heading.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(prompt)
        sections.append((label, start, end))
    return sections


def workshop_context_sections(prompt):
    """Offer established H3 sections for explicit opt-in, never the full prompt by default."""
    result = {}
    for label, start, end in _sections(prompt):
        if label == "Timed Shots":
            continue
        value = prompt[start:end].strip()
        if value:
            result.setdefault(label, []).append(value)
    return {label: "\n\n".join(parts) for label, parts in result.items()}


def timed_shot_bounds(prompt):
    """Exact editable content slice; technical section ordering and optional audio are supported."""
    sections = [(start, end) for label, start, end in _sections(prompt) if label == "Timed Shots"]
    if len(sections) != 1:
        raise ValueError("Workshop requires one unambiguous integrated_multimodal_description heading.")
    start, section_end = sections[0]
    raw = prompt[start:section_end]
    if not _SHOT.search(raw):
        raise ValueError("Workshop requires numbered [Shot N] entries in the timed-shot section.")
    start += len(raw) - len(raw.lstrip())
    end = section_end - (len(raw) - len(raw.rstrip()))
    if start >= end:
        raise ValueError("Timed-shot section is empty.")
    return start, end


def proposed_shot_prompt(prompt, replacement):
    if not isinstance(replacement, str) or not replacement.strip():
        raise ValueError("Workshop revision requires replacement shot text.")
    shots = replacement.strip()
    if not _SHOT.search(shots):
        raise ValueError("Workshop revision requires numbered [Shot N] entries.")
    if _SECTION_HEADING.search(shots):
        raise ValueError("Workshop proposal contains another H3 prompt section. Review and revise the proposal.")
    start, end = timed_shot_bounds(prompt)
    updated = prompt[:start] + shots + prompt[end:]
    if updated == prompt:
        raise ValueError("Workshop proposal contains no changes.")
    return updated
