from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_settings_uses_five_top_level_configuration_tabs():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")

    for tab in ("general", "models", "training", "director", "system"):
        assert 'data-app-settings-tab="' + tab + '"' in html
        assert 'data-app-settings-panel="' + tab + '"' in html

    assert "['general', 'models', 'training', 'director', 'system']" in settings


def test_test_staging_is_training_configuration_not_a_top_level_settings_area():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    training_start = html.index('id="app-settings-panel-training"')
    director_start = html.index('id="app-settings-panel-director"')
    training_markup = html[training_start:director_start]

    assert "<summary>Test Staging</summary>" in training_markup
    assert 'id="app-settings-training-test-copy-h3-root"' in training_markup
    assert 'id="app-settings-training-test-copy-krea2-root"' in training_markup
    assert 'id="app-settings-training-test-copy-wan21-root"' in training_markup
    assert 'id="app-settings-training-test-copy-hi-root"' in training_markup
    assert 'id="app-settings-training-test-copy-lo-root"' in training_markup
    assert 'id="app-settings-training-test-copy-subfolder"' in training_markup


def test_director_remotes_render_as_runtime_cards():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")
    styles = (ROOT / "tool" / "css" / "modals.css").read_text(encoding="utf-8")

    assert "Remote Runtimes" in html
    assert "+ Add Remote Runtime" in html
    assert "<summary>Limits</summary>" in html
    assert 'class="app-settings-runtime-card"' in html

    assert "card.className = 'app-settings-runtime-card app-settings-runtime-card-remote';" in settings
    assert "data-director-endpoint-name" in settings
    assert "data-director-endpoint-url" in settings
    assert "data-director-endpoint-enabled" in settings
    assert "data-director-endpoint-remove" in settings

    assert ".app-settings-runtime-card {" in styles
    assert ".app-settings-runtime-card-header {" in styles
    assert ".app-settings-runtime-card-actions {" in styles


def test_theme_is_config_backed_not_browser_persistent():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    common = (ROOT / "tool" / "js" / "common.js").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")
    app = (ROOT / "tool" / "server" / "app.py").read_text(encoding="utf-8")

    assert "webcap.theme" not in html
    assert "webcap.theme" not in common
    assert "APP_THEME_STORAGE_KEY" not in common
    assert "__WEBCAP_THEME__" in html
    assert 'html.replace("__WEBCAP_THEME__", theme)' in app
    assert "base.theme = typeof getCurrentAppTheme" in settings
    assert "Stored in WebCap settings." in html
