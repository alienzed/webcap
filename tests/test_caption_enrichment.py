"""Caption enrichment is opt-in and never changes baseline Caption Assist."""
import json

import pytest

from tool.server.caption_ops import build_caption_assist_messages, build_caption_enrichment_messages


def test_enrichment_request_is_grounded_in_saved_sight_and_exact_current_caption():
    messages = build_caption_enrichment_messages(
        draft="A woman in a black swimsuit, front view.",
        open_sight={"description": "Several thin straps and a small metal connector."},
        assignments=[{"group": "Clothing", "term": "black swimsuit"}],
        tags=["front view"],
    )
    assert "conservative visual detail editor" in messages[0]["content"]
    assert "exactly one occurrence" in messages[0]["content"]
    body = messages[1]["content"]
    payload = json.loads(body[body.find('{"currentCaption"'):])
    assert payload["currentCaption"] == "A woman in a black swimsuit, front view."
    assert "Several thin straps" in payload["openSight"]["description"]
    assert payload["selectedAnnotations"] == [{"group": "Clothing", "term": "black swimsuit"}]
    assert payload["otherTags"] == ["front view"]


@pytest.mark.parametrize("draft,sight", [
    ("", {"description": "Useful Sight"}),
    ("A caption.", None),
    ("A caption.", {}),
])
def test_enrichment_requires_authored_caption_and_saved_sight(draft, sight):
    with pytest.raises(ValueError):
        build_caption_enrichment_messages(draft=draft, open_sight=sight)


def test_existing_strict_caption_prompt_is_unchanged():
    msgs = build_caption_assist_messages(
        assignments=[{"group": "Position", "term": "posing"}],
        draft="A woman posing.",
    )
    assert "Every tag in groupedAnnotations and otherTags" in msgs[0]["content"]
    assert "CurrentDraft" not in msgs[0]["content"]


def test_caption_assist_route_reuses_existing_director_lane(monkeypatch):
    from tool.server import app as module
    jobs = []

    def enqueue(client, model, contract, context=None, label=""):
        jobs.append({"client": client, "model": model, "contract": contract, "label": label})
        return {"jobId": "enrich-test"}

    monkeypatch.setattr(module, "enqueue_llm", enqueue)
    with module.app.test_client() as client:
        response = client.post("/caption/assist", json={
            "mode": "enrich", "model": "local-director",
            "draft": "A woman in a swimsuit.",
            "openSight": {"description": "Metal ring connectors on the straps."},
        })
        no_sight = client.post("/caption/assist", json={
            "mode": "enrich", "model": "local-director",
            "draft": "A woman in a swimsuit.",
        })
        strict = client.post("/caption/assist", json={
            "model": "local-director", "assignments": [{"group":"Position", "term":"posing"}],
        })
    assert response.status_code == 202
    assert no_sight.status_code == 400
    assert strict.status_code == 202
    assert jobs[0]["client"] == "caption"
    assert jobs[0]["contract"]["operation"] == "caption_assist"
    assert jobs[0]["label"] == "Caption enrichment"
    assert jobs[1]["label"] == "Caption Assist"
    assert "Every tag" in jobs[1]["contract"]["messages"][0]["content"]
