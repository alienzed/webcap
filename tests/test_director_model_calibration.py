import json

import pytest

from tool.server import director_model_calibration as calibration


@pytest.fixture
def calibration_root(monkeypatch, tmp_path):
    root = tmp_path / "app-data" / "state" / "diagnostics"
    monkeypatch.setattr(calibration.app_config, "app_diagnostics_root", lambda: root)
    return root


def _profile(**overrides):
    value = {
        "modelRef": "local::director.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "director.gguf",
        "label": "director.gguf",
        "contextMode": "calibrated",
        "contextSize": 16384,
        "maxTokens": 4096,
        "attempts": [
            {
                "kind": "context",
                "target": 16384,
                "status": "passed",
                "observedContextSize": 16384,
            },
            {
                "kind": "output",
                "target": 4096,
                "status": "passed",
                "completionTokens": 3600,
                "finishReason": "stop",
            },
            {
                "kind": "prose",
                "target": 4096,
                "status": "passed",
                "completionTokens": 3500,
                "finishReason": "stop",
            },
        ],
    }
    value.update(overrides)
    return value


def test_calibration_profiles_persist_under_app_diagnostics(calibration_root):
    saved = calibration.save_profile(_profile())

    assert saved["contextSize"] == 16384
    assert saved["maxTokens"] == 4096
    assert saved["calibratedAt"]
    assert calibration.get_profile("local::director.gguf")["maxTokens"] == 4096
    assert calibration.list_profiles()[0]["modelRef"] == "local::director.gguf"

    path = calibration_root / calibration.FILENAME
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["version"] == calibration.PROFILE_VERSION
    assert payload["profiles"]["local::director.gguf"]["contextMode"] == "calibrated"


def test_runtime_managed_remote_profile_allows_unknown_context(calibration_root):
    saved = calibration.save_profile(_profile(
        modelRef="remote-box::qwen",
        runtimeId="remote-box",
        runtimeName="Remote Box",
        modelId="qwen",
        label="qwen",
        contextMode="runtime",
        contextSize=0,
    ))

    assert saved["contextMode"] == "runtime"
    assert saved["contextSize"] == 0


def test_clear_profiles_removes_persistent_calibration(calibration_root):
    calibration.save_profile(_profile())
    assert calibration.list_profiles()

    calibration.clear_profiles()

    assert calibration.list_profiles() == []
    assert not (calibration_root / calibration.FILENAME).exists()


def test_calibration_profile_rejects_unproven_limits(calibration_root):
    with pytest.raises(ValueError, match="attempts"):
        calibration.save_profile(_profile(attempts=[]))

    with pytest.raises(ValueError, match="contextSize"):
        calibration.save_profile(_profile(contextSize=0))

    with pytest.raises(ValueError, match="passed output attempt"):
        calibration.save_profile(_profile(maxTokens=8192))

    missing_prose = _profile()
    missing_prose["attempts"] = [
        attempt for attempt in missing_prose["attempts"] if attempt["kind"] != "prose"
    ]
    with pytest.raises(ValueError, match="long-form prose"):
        calibration.save_profile(missing_prose)

    with pytest.raises(ValueError, match="passed context attempt"):
        calibration.save_profile(_profile(contextSize=32768))
