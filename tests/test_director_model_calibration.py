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



def _report(**overrides):
    value = {
        "modelRef": "local::director.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "director.gguf",
        "label": "director.gguf",
        "contextMode": "calibrated",
        "contextSize": 4096,
        "maxTokens": 512,
        "status": "complete",
        "attempts": [
            {
                "kind": "context",
                "target": 4096,
                "status": "passed",
                "observedContextSize": 4096,
            },
            {
                "kind": "output",
                "target": 512,
                "status": "passed",
                "completionTokens": 420,
                "finishReason": "stop",
            },
            {
                "kind": "prose",
                "target": 512,
                "status": "passed",
                "completionTokens": 390,
                "finishReason": "stop",
            },
        ],
    }
    value.update(overrides)
    return value


def test_calibration_report_persists_partial_findings_without_profile(calibration_root):
    report = _report(
        maxTokens=0,
        status="incomplete",
        attempts=[
            {
                "kind": "context",
                "target": 4096,
                "status": "passed",
                "observedContextSize": 4096,
            },
            {
                "kind": "output",
                "target": 512,
                "status": "failed",
                "failureKind": "capacity",
                "finishReason": "length",
            },
        ],
    )

    saved = calibration.save_report(report)

    assert saved["health"] == "calibration-failed"
    assert saved["abilities"]["responds"] is True
    assert saved["abilities"]["contextTokens"] == 4096
    assert saved["abilities"]["structuredOutputTokens"] == 0
    assert calibration.get_profile("local::director.gguf") is None
    assert calibration.get_report("local::director.gguf")["attempts"][-1]["failureKind"] == "capacity"


def test_calibration_report_classifies_low_tier_runtime_failure_as_likely_unusable(calibration_root):
    saved = calibration.save_report(_report(
        contextSize=0,
        maxTokens=0,
        status="error",
        attempts=[{
            "kind": "context",
            "target": 4096,
            "status": "failed",
            "failureKind": "runtime",
            "error": "model load failed",
        }],
    ))

    assert saved["health"] == "likely-unusable"
    assert saved["abilities"]["responds"] is False


def test_calibration_report_classifies_early_looping_as_likely_unusable(calibration_root):
    saved = calibration.save_report(_report(
        contextMode="runtime",
        contextSize=0,
        maxTokens=0,
        status="incomplete",
        attempts=[{
            "kind": "output",
            "target": 512,
            "status": "failed",
            "failureKind": "looping",
        }],
    ))

    assert saved["health"] == "likely-unusable"


def test_existing_profile_document_without_reports_remains_readable(calibration_root):
    calibration_root.mkdir(parents=True, exist_ok=True)
    path = calibration_root / calibration.FILENAME
    path.write_text(json.dumps({
        "version": calibration.PROFILE_VERSION,
        "profiles": {},
    }), encoding="utf-8")

    assert calibration.list_profiles() == []
    assert calibration.list_reports() == []


def test_clear_calibration_removes_profiles_and_reports(calibration_root):
    calibration.save_profile(_profile())
    calibration.save_report(_report())

    cleared = calibration.clear_calibration()

    assert cleared == {"profiles": [], "reports": []}
    assert calibration.list_profiles() == []
    assert calibration.list_reports() == []
    assert not (calibration_root / calibration.FILENAME).exists()



def test_begin_calibration_supersedes_stale_profile_and_report(calibration_root):
    calibration.save_profile(_profile())
    calibration.save_report(_report())

    begun = calibration.begin_calibration("local::director.gguf")

    assert begun == {"profiles": [], "reports": []}
    assert calibration.get_profile("local::director.gguf") is None
    assert calibration.get_report("local::director.gguf") is None
