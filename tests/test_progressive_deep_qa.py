from pathlib import Path

from tool.server import app as app_module


def _item(file_name, with_sight=True):
    return {
        "fileName": file_name,
        "caption": "A red shirt.",
        "groupedTags": [{"group": "Clothing", "term": "shirt"}],
        "tags": ["shirt"],
        "analysis": ({
            "visionSight": {
                "model": "cached-vision",
                "description": "A red shirt with a brass buckle.",
                "inventory": {"details": ["brass buckle"]},
            }
        } if with_sight else {}),
    }


def test_progressive_item_review_reuses_the_existing_qa_director_contract(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    for name in ("a.jpg", "b.jpg"):
        (folder / name).write_bytes(b"test")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    received = {}

    def fake_enqueue(client, model, contract, context=None, label=""):
        received.update(client=client, model=model, contract=contract, context=context, label=label)
        return {"jobId": "qa-item-job", "status": "queued"}

    monkeypatch.setattr(app_module, "enqueue_llm", fake_enqueue)
    response = app_module.app.test_client().post("/fs/qa/deep-scan", json={
        "folder": "set", "model": "local::test", "itemReview": True,
        "items": [_item("a.jpg"), _item("b.jpg")],
    })
    assert response.status_code == 202
    assert received["client"] == "qa"
    assert received["contract"]["operation"] == "qa_deep_scan"
    assert received["contract"]["source_files"] == ["a.jpg", "b.jpg"]
    assert "brass buckle" in received["contract"]["prompt"]
    assert received["context"]["captionsByFile"]["a.jpg"] == "A red shirt."
    assert received["contract"]["response_schema"]["properties"]["findings"]["items"]["properties"]["tagActions"]


def test_progressive_deep_qa_rejects_missing_sight_without_launching_vision(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    (folder / "a.jpg").write_bytes(b"test")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))

    def unexpected_enqueue(*args, **kwargs):
        raise AssertionError("Missing Sight should not queue inference.")

    monkeypatch.setattr(app_module, "enqueue_llm", unexpected_enqueue)
    response = app_module.app.test_client().post("/fs/qa/deep-scan", json={
        "folder": "set", "model": "local::test", "itemReview": True,
        "items": [_item("a.jpg", with_sight=False)],
    })
    assert response.status_code == 400
    assert "requires saved Sight" in response.get_json()["error"]


def test_progressive_deep_qa_batches_are_explicitly_bounded(tmp_path, monkeypatch):
    folder = tmp_path / "set"
    folder.mkdir()
    items = [_item(f"{index}.jpg") for index in range(5)]
    for item in items:
        (folder / item["fileName"]).write_bytes(b"test")
    monkeypatch.setattr(app_module.app_config, "FS_ROOT", Path(tmp_path))
    response = app_module.app.test_client().post("/fs/qa/deep-scan", json={
        "folder": "set", "model": "local::test", "itemReview": True,
        "items": items,
    })
    assert response.status_code == 400
    assert "at most four items" in response.get_json()["error"]


def test_progressive_review_receipts_are_scope_bound_and_do_not_touch_annotation_state():
    source = (Path(__file__).resolve().parents[1] / "tool/js/qa_workbench.js").read_text()
    assert "deepScanScopeFiles: qaWorkbenchState.deepScanScopeFiles.slice()" in source
    assert "deepScanDiscoveryComplete: qaWorkbenchState.deepScanDiscoveryComplete" in source
    assert "deepScanSkipped: Object.assign({}, qaWorkbenchState.deepScanSkipped)" in source
    assert "saved.qaReviewMode === 'progressive-v1'" in source
    assert "qaWorkbenchState.deepScanScope = scan;" in source
    assert "qaWorkbenchState.deepScanScopeFiles = scopeFiles.slice();" in source
    assert "if (!qaWorkbenchState.deepScanSessionActive) qaRestoreReview(inputSignature);" in source
    assert "qaDeepScanScopeItems()" in source
    assert "qaSyncFocusReview();" in source
    assert "qaStartFocusReview();" in source
