import json

import pytest

from tool.server import director_model_assessment_store as assessment


@pytest.fixture
def assessment_root(monkeypatch, tmp_path):
    assessment._active_assessment_ids.clear()
    root = tmp_path / "app-data" / "cache"
    monkeypatch.setattr(assessment.app_config, "app_cache_root", lambda: root)
    yield root / assessment.ROOT_NAME
    assessment._active_assessment_ids.clear()


def _model():
    return {
        "modelRef": "local::director.gguf",
        "runtimeId": "local",
        "runtimeName": "Local",
        "modelId": "director.gguf",
        "label": "Director",
        "sizeBytes": 1234,
    }


def test_assessment_keeps_full_probe_evidence_in_cache(assessment_root):
    started = assessment.start_assessment(_model(), advertised={"contextTokens": 8192})
    saved = assessment.update_assessment(
        started["id"],
        [{
            "kind": "prose",
            "target": 512,
            "status": "failed",
            "prompt": "FULL PROMPT",
            "text": "FULL MODEL OUTPUT",
            "finishReason": "stop",
            "failureKind": "looping",
            "promptTokens": 50,
            "completionTokens": 400,
        }],
        summary={"health": "warning"},
        final=True,
        status="complete",
    )

    assert saved["attempts"][0]["prompt"] == "FULL PROMPT"
    assert saved["attempts"][0]["text"] == "FULL MODEL OUTPUT"
    path = assessment_root / (started["id"] + ".json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["attempts"][0]["text"] == "FULL MODEL OUTPUT"

    rows = assessment.list_assessments()
    assert rows[0]["id"] == started["id"]
    assert rows[0]["attemptCount"] == 1
    assert "attempts" not in rows[0]
    assert rows[0]["bytes"] > 0


def test_deleting_raw_assessment_removes_only_evidence_file(assessment_root):
    started = assessment.start_assessment(_model())
    path = assessment_root / (started["id"] + ".json")
    assert path.is_file()

    assessment.update_assessment(started["id"], [], final=True, status="complete")
    assert assessment.delete_assessment(started["id"]) is True
    assert not path.exists()
    assert assessment.list_assessments() == []


def test_assessment_rejects_invalid_evidence_shape(assessment_root):
    started = assessment.start_assessment(_model())

    with pytest.raises(ValueError, match="attempt kind"):
        assessment.update_assessment(
            started["id"],
            [{"kind": "mystery", "target": 512, "status": "failed"}],
        )



def test_active_assessment_evidence_cannot_be_deleted_until_finalized(assessment_root):
    started = assessment.start_assessment(_model())

    with pytest.raises(RuntimeError, match="Active Director assessment"):
        assessment.delete_assessment(started["id"])

    assessment.update_assessment(
        started["id"],
        [],
        summary={},
        final=True,
        status="stopped",
    )
    assert assessment.delete_assessment(started["id"]) is True


def test_restart_keeps_evidence_but_does_not_claim_assessment_is_running(assessment_root):
    started = assessment.start_assessment(_model())
    assessment.update_assessment(started["id"], [{
        "kind": "output", "target": 512, "status": "passed", "prompt": "Full prompt", "text": "Full answer",
    }])
    assessment._active_assessment_ids.clear()
    reloaded = assessment.get_assessment(started["id"])
    assert reloaded["status"] == "incomplete"
    assert "interrupted" in reloaded["error"]
    assert reloaded["attempts"][0]["text"] == "Full answer"
    assert assessment.list_assessments()[0]["active"] is False
    assert assessment.list_assessments()[0]["status"] == "incomplete"


def test_corrupt_raw_evidence_fails_loudly_in_listing(assessment_root):
    started = assessment.start_assessment(_model())
    (assessment_root / (started["id"] + ".json")).write_text("not json", encoding="utf-8")
    with pytest.raises(RuntimeError, match="Could not read Director assessment"):
        assessment.list_assessments()


def test_raw_deletion_preserves_learned_findings(assessment_root, monkeypatch):
    from tool.server import director_model_calibration as calibration
    monkeypatch.setattr(calibration.app_config, "app_diagnostics_root", lambda: assessment_root.parent.parent / "state" / "diagnostics")
    report = calibration.save_report(dict(_model(), contextMode="runtime", contextSize=0, maxTokens=512,
        status="complete", attempts=[{"kind": "prose", "target": 512, "status": "passed"}]))
    started = assessment.start_assessment(_model())
    assessment.update_assessment(started["id"], [], final=True, status="complete")
    assessment.delete_assessment(started["id"])
    assert calibration.get_report(_model()["modelRef"]) == report
