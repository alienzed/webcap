from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_folder_state_reads_legacy_caption_affixes_but_persists_only_canonical_wrappers():
    source = _read("tool/js/folder_state.js")

    assert "sanitizeAffixMap(src.caption_term_wrappers || src.caption_term_affixes, false)" in source

    sanitizer_start = source.index("function sanitizeFolderState")
    sanitizer_end = source.index("/**\n * Save the folder state", sanitizer_start)
    sanitizer = source[sanitizer_start:sanitizer_end]
    assert "caption_term_wrappers: captionTermWrappers" in sanitizer
    assert "caption_term_affixes:" not in sanitizer

    capture_start = source.index("function captureCurrentFolderStateSave")
    capture_end = source.index("/**\n * Apply the given folder state", capture_start)
    capture = source[capture_start:capture_end]
    assert "caption_term_wrappers:" in capture
    assert "caption_term_affixes:" not in capture
