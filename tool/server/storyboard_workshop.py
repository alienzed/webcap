"""Explicit timed-shot bounds for reversible, reviewable Storyboard Workshop edits."""

import re


_SHOTS_HEADING = re.compile(r"^[ \t]*integrated_multimodal_description[ \t]*:[ \t]*\r?$", re.I | re.M)
_AUDIO_HEADING = re.compile(r"^[ \t]*(?:overall_soundscape|non_diegetic_music)[ \t]*:[ \t]*\r?$", re.I | re.M)
_SHOT = re.compile(r"^[ \t]*\[Shot[ \t]+\d+\]", re.I | re.M)
_OTHER_HEADING = re.compile(
    r"^[ \t]*(?:Subject|Scene Overview|Environment / Continuity Anchors|"
    r"Style / Visual Treatment|integrated_multimodal_description|"
    r"overall_soundscape|non_diegetic_music)[ \t]*:", re.I | re.M
)


def timed_shot_bounds(prompt):
    """Return the exact editable-content slice; leave headings and spacing intact."""
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("A saved H3 generation prompt is required for Scene Workshop.")
    headings = list(_SHOTS_HEADING.finditer(prompt))
    if len(headings) != 1:
        raise ValueError("Workshop requires one unambiguous integrated_multimodal_description heading.")
    line_end = prompt.find("\n", headings[0].end())
    if line_end < 0:
        raise ValueError("Timed-shot heading must be followed by shot text.")
    section_start = line_end + 1
    audio = _AUDIO_HEADING.search(prompt, section_start)
    if audio is None:
        raise ValueError("Workshop requires a following overall_soundscape or non_diegetic_music heading to bound the shots.")
    raw = prompt[section_start:audio.start()]
    if not _SHOT.search(raw):
        raise ValueError("Workshop requires numbered [Shot N] entries in the timed-shot section.")
    start = section_start + len(raw) - len(raw.lstrip())
    end = audio.start() - (len(raw) - len(raw.rstrip()))
    if start >= end:
        raise ValueError("Timed-shot section is empty.")
    return start, end


def proposed_shot_prompt(prompt, replacement):
    if not isinstance(replacement, str) or not replacement.strip():
        raise ValueError("Workshop revision requires replacement shot text.")
    shots = replacement.strip()
    if not _SHOT.search(shots):
        raise ValueError("Workshop revision requires numbered [Shot N] entries.")
    if _OTHER_HEADING.search(shots):
        raise ValueError("Workshop proposal contains another H3 prompt section. Review and revise the proposal.")
    start, end = timed_shot_bounds(prompt)
    updated = prompt[:start] + shots + prompt[end:]
    if updated == prompt:
        raise ValueError("Workshop proposal contains no changes.")
    return updated
