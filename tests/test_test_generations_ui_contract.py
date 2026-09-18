from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-pane" in script
    assert "test-generations-modal" not in script
    assert "document.querySelector('.editor-surface')" in script
    assert "test-generations-active" in script
    assert "test-generations-aspect" in script
    assert "test-generations-megapixels" in script
    assert "test-generations-duration" in script
    assert "test-generations-seed" in script
    assert "test-generations-results" in script
    assert "card.dataset.resultKey = resultKey" in script
    assert "host.insertBefore(card, pending || null)" in script
    assert "pending.querySelector('.test-generations-result-name').textContent" in script
    assert "host.innerHTML = html" not in script
    assert "Previews appear as each LoRA finishes." in script
    assert "aspectRatio: aspectRatio" in script
    assert "megapixels: megapixels" in script
    assert "duration: duration" in script
    assert "seed: seed" in script

    assert ".test-generations-pane" in css
    assert ".editor-surface.test-generations-active" in css
    assert ".test-generations-results" in css
    assert ".test-generations-result-card video" in css



def test_test_generation_previews_keep_stable_width_and_native_video_aspect():
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "grid-template-columns: repeat(auto-fill, 280px);" in css
    assert "justify-content: start;" in css
    video_rule = css.split(".test-generations-result-card video {", 1)[1].split("}", 1)[0]
    assert "height: auto;" in video_rule
    assert "aspect-ratio:" not in video_rule
