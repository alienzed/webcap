from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_test_generations_uses_training_pane_and_core_controls():
    script = (ROOT / "tool" / "js" / "test_generations.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "test-generations-pane" in script
    assert "test-generations-modal" not in script
    assert "document.querySelector('.editor-surface')" in script
    assert "training-tests-actions" in script
    assert ".training-run-setup-actions" not in script
    assert "test-generations-active" in script
    assert "test-generations-workspace-open" in script
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
    assert ".test-generations-setup-overview" in css
    assert ".test-generations-setup-options" in css
    assert 'id="test-generations-files-toggle"' in script
    assert "filesToggle.textContent = 'View ' + payload.count + ' staged LoRA'" in script
    controls_rule = css.split(".test-generations-controls {", 1)[1].split("}", 1)[0]
    assert "grid-template-columns: repeat(2, minmax(360px, 1fr));" in controls_rule
    shell_css = (ROOT / "tool" / "css" / "workspace_shell.css").read_text(encoding="utf-8")
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    assert ".test-generations-workspace-open .preview-panel" in shell_css
    assert 'src="/static/js/test_generations.js"' in html



def test_test_generation_previews_keep_stable_width_and_natural_height():
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    results_rule = css.split(".test-generations-results {", 1)[1].split("}", 1)[0]
    assert "display: grid;" in results_rule
    assert "grid-template-columns: repeat(auto-fill, 280px);" in results_rule
    assert "justify-content: start;" in results_rule

    video_rule = css.split(".test-generations-result-card video {", 1)[1].split("}", 1)[0]
    assert "width: 100%;" in video_rule
    assert "height: auto;" in video_rule
    assert "aspect-ratio:" not in video_rule
    assert "object-fit:" not in video_rule
