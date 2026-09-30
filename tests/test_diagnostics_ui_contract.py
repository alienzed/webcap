from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_diagnostics_is_a_secondary_utility_not_a_workspace():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "diagnostics.js").read_text(encoding="utf-8")
    settings = (ROOT / "tool" / "js" / "app_settings.js").read_text(encoding="utf-8")

    assert 'id="shell-diagnostics-btn"' in html
    assert 'id="diagnostics-modal"' in html
    assert 'data-diagnostics-tab="health"' in html
    assert 'data-diagnostics-tab="h3"' in html
    assert 'data-diagnostics-tab="director"' in html
    assert html.index('id="shell-diagnostics-btn"') > html.index('class="activity-rail-spacer"')
    assert 'aria-controls="diagnostics-modal"' in html

    assert "function openDiagnosticsModal" in script
    assert "function runEnvironmentCheck" in script
    assert "function refreshH3CalibrationSettings" in script
    assert "function runH3Calibration" in script
    assert "function stopH3Calibration" in script
    assert "'/fs/h3_probe/start'" in script
    assert "'/fs/h3_probe/stop'" in script
    assert "'/app/environment'" in script
    assert "directorModelTestRefresh()" in script

    assert "h3-calibration" not in settings
    assert "runEnvironmentCheck" not in settings
    assert "installPythonRequirements" not in settings


def test_settings_keeps_persistent_advanced_controls_only():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")

    settings_start = html.index('id="app-settings-modal"')
    diagnostics_start = html.index('id="diagnostics-modal"')
    settings_markup = html[settings_start:diagnostics_start]

    assert '>Advanced</button>' in settings_markup
    assert '<summary>Optional Features</summary>' in settings_markup
    assert '<summary>Debug Logging</summary>' in settings_markup
    assert '<summary>Raw Configuration</summary>' in settings_markup
    assert '<summary>Danger Zone</summary>' in settings_markup
    assert 'id="h3-calibration-settings"' not in settings_markup
    assert 'id="director-model-test-settings"' not in settings_markup
    assert 'id="app-settings-environment-run-btn"' not in settings_markup
