"""Regression tests for Primary reference tags shared across annotation groups."""
from types import SimpleNamespace

import pytest

from tool.server import epoch_finder


@pytest.mark.parametrize("choice_group", ["Position", "Action"])
@pytest.mark.parametrize("selected_options", [("standing", "sitting"), ("standing",), ()])
def test_campaign_accepts_same_tag_in_multiple_groups(monkeypatch, tmp_path, choice_group, selected_options):
    run = {"jobId": "job-1", "stage": "h3", "modelId": "h3", "runName": "Run",
           "epochs": [5]}
    monkeypatch.setattr(epoch_finder, "_runs", lambda folder: [run])
    monkeypatch.setattr(epoch_finder, "_folder_key", lambda folder: "set")
    model = SimpleNamespace(settings={}, load_template=lambda: {},
                            normalize_settings=lambda *args: None,
                            PROFILE_ID="h3", STAGING_KEY="h3")
    monkeypatch.setattr(epoch_finder, "get_test_model_for_staging_key", lambda stage: model)
    monkeypatch.setattr("tool.server.storyboard_llm_runtime.list_vision_models",
                        lambda: [{"id": "vision"}])
    monkeypatch.setattr("tool.server.epoch_reference.reference_vocabulary",
                        lambda folder, job_id: [
                            {"group": "Position", "terms": [{"term": "standing"}, {"term": "sitting"}]},
                            {"group": "Action", "terms": [{"term": "standing"}, {"term": "sitting"}]},
                        ])
    seen = []
    def verify(folder, group, tag, media, job_id):
        seen.append((group, tag, media))
        return {"media": media, "group": group, "term": tag, "size": 10, "mtimeNs": 1}
    monkeypatch.setattr("tool.server.epoch_reference.verified_reference", verify)
    monkeypatch.setattr(epoch_finder, "_directory", lambda folder, cid: tmp_path / cid)
    monkeypatch.setattr(epoch_finder, "_save", lambda folder, campaign: None)
    monkeypatch.setattr(epoch_finder, "_launch", lambda folder, campaign_id: None)
    criteria = {
        "jobId": "job-1", "epochs": [5],
        "prompt": "person {standing|sitting}",
        "dimensions": [{"label": "Pose", "role": "primary", "options": ["standing", "sitting"]}],
        "visionModel": "vision", "rounds": 1, "cases": 1, "keepPercent": 50,
        "referenceEvaluation": {"rvn": True, "dino": False},
        "referencePlan": [
            {"attribute": "Pose", "option": tag, "group": choice_group,
             "tag": tag, "media": tag + ".png"}
            for tag in selected_options
        ],
    }
    campaign = epoch_finder.create_campaign("set", criteria)
    assert len(campaign["referencePlan"]) == len(selected_options)
    assert seen == [(choice_group, tag, tag + ".png") for tag in sorted(selected_options)]


def test_reference_group_must_contain_selected_exact_tag(monkeypatch, tmp_path):
    # Real exact-tag verifier must continue rejecting unsupported group/tag/media claims.
    from tool.server import epoch_reference
    folder = tmp_path
    for name in ("a.png", "b.png"):
        (folder / name).write_bytes(b"image")
    (folder / ".webcap_state.json").write_text(
        '{"caption_group_tags_by_media": {"a.png": {"Position": ["standing"]},'
        ' "b.png": {"Action": ["standing"]}}}', encoding="utf-8")
    monkeypatch.setattr(epoch_reference, "_resolve_folder", lambda _: folder)
    monkeypatch.setattr(epoch_reference, "training_image_members", lambda *args: {"a.png", "b.png"})
    monkeypatch.setattr(epoch_reference, "list_media_files", lambda _: ["a.png", "b.png"])
    assert epoch_reference.verified_reference("set", "Position", "standing", "a.png", "job")["group"] == "Position"
    assert epoch_reference.verified_reference("set", "Action", "standing", "b.png", "job")["group"] == "Action"
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "Action", "standing", "a.png", "job")
    # Saved references are Set-scoped; an image can be used for a different run
    # when its exact group/tag is still annotated in this Set.
    assert epoch_reference.verified_reference("set", "Action", "standing", "b.png", None)["media"] == "b.png"
    with pytest.raises(ValueError):
        epoch_reference.verified_reference("set", "Action", "standing", "a.png", None)
