"""On-demand Test reference evidence never overwrites original Ask VL records."""
from pathlib import Path

from tool.server import test_reference, epoch_test_bench as bench


def _setup(tmp_path, monkeypatch, name="preview.png"):
    folder = tmp_path / "set"
    folder.mkdir()
    media = folder / name
    media.write_bytes(b"fake-media")
    session = folder / "session"
    session.mkdir()
    monkeypatch.setattr(bench, "_session_directory", lambda folder_path, session_name: session)
    monkeypatch.setattr(bench, "resolve_result_media",
                        lambda folder_path, session_name, media_name: media)
    monkeypatch.setattr("tool.server.epoch_finder._folder_key", lambda path: "set")
    monkeypatch.setattr(test_reference, "verified_reference",
                        lambda folder_key, group, term, filename: {
                            "media": "ref.png", "group": group, "term": term})
    return folder, session, media


def test_reference_results_are_separate_from_legacy_vl(tmp_path, monkeypatch):
    folder, session, media = _setup(tmp_path, monkeypatch)
    legacy = session / ".webcap_state.json"
    legacy.write_text('{"test_vision":{"byMedia":{"preview.png":{"text":"original"}}}}')
    saved = test_reference.save(folder, "test", media.name, {
        "method": "rvn", "group": "Shape", "option": "v-front", "reference": "ref.png",
        "verdict": "MATCH", "selected": 1, "response": "some evidence"
    })
    assert saved["verdict"] == "MATCH"
    assert test_reference.read(folder, "test")["byMedia"][media.name][
        "rvn|Shape|v-front"]["selected"] == 1
    assert "original" in legacy.read_text()


def test_reference_prepare_preserves_option_vocabulary(tmp_path, monkeypatch):
    folder, session, media = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(test_reference, "vision_resized_image_data_url",
                        lambda source: "data:image/png;base64,AAA")
    result = test_reference.prepare(folder, {
        "method": "rvn", "session": "test", "media": media.name,
        "group": "Shape", "option": "v-front", "reference": "ref.png",
        "choices": ["v-front", "micro"],
    })
    images = [x for x in result["messages"][0]["content"] if x["type"] == "image_url"]
    assert len(images) == 2
    assert "1=v-front" in result["messages"][0]["content"][0]["text"]


def test_reference_vl_question_uses_selected_group_alias(tmp_path, monkeypatch):
    folder, session, media = _setup(tmp_path, monkeypatch)
    monkeypatch.setattr(test_reference, "vision_resized_image_data_url",
                        lambda source: "data:image/png;base64,AAA")
    result = test_reference.prepare(folder, {
        "method": "rvn", "session": "test", "media": media.name,
        "group": "BT Back", "groupAlias": "Bikini tops",
        "option": "simple string straps", "reference": "ref.png",
        "choices": ["simple string straps", "metal ring"],
    })
    question = result["messages"][0]["content"][0]["text"]
    assert '"Bikini tops" with "simple string straps"' in question
    assert "BT Back" in question


def test_dino_result_is_saved_without_altering_legacy_vl(tmp_path, monkeypatch):
    folder, session, media = _setup(tmp_path, monkeypatch)
    from tool.server import epoch_dino
    monkeypatch.setattr(epoch_dino, "compare_images",
                        lambda reference, generated, cache_dir: 0.751)
    result = test_reference.prepare(folder, {
        "method": "dino", "session": "test", "media": media.name,
        "group": "Shape", "option": "v-front", "reference": "ref.png",
        "choices": ["v-front", "micro"],
    })
    assert result["assessment"]["similarity"] == 0.751
    assert "dino|Shape|v-front" in test_reference.read(folder, "test")["byMedia"][media.name]
