from pathlib import Path

import pytest

from tool.server import media_explorer


def _media(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"sample")


def test_discovery_includes_saved_references_and_deduplicates_usage(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    _media(tmp_path / "generations/day/job/result.png")
    _media(tmp_path / "generations/day/job/references/style.png")
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: [{
        "storageId": "day/job", "createdAt": 100, "mediaPath": "generations/day/job/result.png",
        "modelId": "krea2", "rating": 4,
        "references": {"style": "generations/day/job/references/style.png",
                       "mood": "generations/day/job/references/style.png"},
    }])
    result = media_explorer.list_media()
    assert result["total"] == 2
    assert {item["role"] for item in result["items"]} == {"generated", "reference"}
    reference = next(item for item in result["items"] if item["role"] == "reference")
    assert len(reference["uses"]) == 2
    assert reference["rating"] is None


def test_sort_occurs_before_paging(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    records = []
    for name, rating, created in (("z", 1, 100), ("a", 5, 200), ("m", 3, 300)):
        path = f"generations/day/{name}/result.png"
        _media(tmp_path / path)
        records.append({"storageId": "day/" + name, "createdAt": created,
                        "mediaPath": path, "rating": rating})
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: records)
    page = media_explorer.list_media(limit=1, offset=1, sort="rating")
    assert page["total"] == 3
    assert page["items"][0]["storageId"] == "day/m"
    named = media_explorer.list_media(limit=2, sort="name")
    assert len(named["items"]) == 2
    with pytest.raises(ValueError, match="sort"):
        media_explorer.list_media(sort="unsupported")


def test_missing_media_not_listed_and_outside_root_not_served(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    outside = tmp_path.parent / "outside-media-test.png"
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: [
        {"storageId": "one", "createdAt": 1, "mediaPath": "../outside-media-test.png"},
        {"storageId": "two", "createdAt": 2, "mediaPath": "generations/missing.png"},
    ])
    assert media_explorer.list_media()["total"] == 0


def test_explicit_full_scan_has_complete_scope(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    seen = []
    def records(limit):
        seen.append(limit)
        return []
    monkeypatch.setattr(media_explorer, "list_results", records)
    recent = media_explorer.list_media()
    complete = media_explorer.list_media(full="1")
    assert seen == [500, None]
    assert recent["complete"] is False
    assert complete["complete"] is True
    assert "full Generate/legacy Test scan" in complete["scope"]


def test_test_session_discovery_uses_owner_media_route(monkeypatch, tmp_path):
    import json
    root = tmp_path / "output"
    session = root / "test-generations" / "sets" / "demo" / "sessions" / "one"
    session.mkdir(parents=True)
    (session / "frame.png").write_bytes(b"img")
    (session / "test.json").write_text(json.dumps({
        "ownerFolder": "sets/demo", "modelId": "krea2",
        "startedAt": 100, "results": [{"mediaFile": "frame.png"}]
    }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: root)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: session if name == "one" else None)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {"frame.png": 5})
    result = media_explorer.list_media(source="test")
    assert result["total"] == 1
    item = result["items"][0]
    assert item["source"] == "test"
    assert item["rating"] == 5
    assert "/fs/test_generations/media?" in item["mediaUrl"]
    assert "folder=sets%2Fdemo" in item["mediaUrl"]


def test_legacy_session_discovered_for_known_owner(monkeypatch, tmp_path):
    import json
    output = tmp_path / "output"
    central = output / "test-generations" / "central"
    legacy = tmp_path / "sets" / "demo" / "test-generations" / "legacy"
    for session in (central, legacy):
        session.mkdir(parents=True)
        (session / "result.png").write_bytes(b"x")
        (session / "test.json").write_text(json.dumps({
            "ownerFolder": "sets/demo", "startedAt": 100,
            "results": [{"mediaFile": "result.png"}],
        }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: output)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: central if name == "central" else legacy)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {})
    found = media_explorer.list_media(source="test")
    assert found["total"] == 2
    assert any("sets/demo/test-generations/legacy/result.png" in item["id"]
               for item in found["items"])


def test_full_scan_finds_legacy_only_set_without_owner_field(monkeypatch, tmp_path):
    import json
    output = tmp_path / "output"
    output.mkdir()
    legacy = tmp_path / "sets" / "only-legacy" / "test-generations" / "session-1"
    legacy.mkdir(parents=True)
    (legacy / "render.png").write_bytes(b"img")
    (legacy / "test.json").write_text(json.dumps({
        "startedAt": 42, "results": [{"mediaFile": "render.png"}]
    }))
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: output)
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    from tool.server import epoch_test_bench
    monkeypatch.setattr(epoch_test_bench, "_session_directory",
                        lambda owner, name: legacy if str(owner).endswith("only-legacy") else None)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda path: {})
    assert media_explorer.list_media(source="test")["total"] == 0
    full = media_explorer.list_media(source="test", full="1")
    assert full["total"] == 1
    assert full["items"][0]["ownerFolder"] == "sets/only-legacy"


def test_epoch_frame_uses_existing_owner_route(monkeypatch, tmp_path):
    import json
    output = tmp_path / "output"
    campaign = output / "test-generations" / "sets" / "demo" / "epoch-finder" / "abcdef123456"
    frames = campaign / "frames"
    frames.mkdir(parents=True)
    frame = frames / "r1-e1-c1.png"
    frame.write_bytes(b"png")
    (campaign / "campaign.json").write_text(json.dumps({
        "createdAt": 123, "units": [{"frame": frame.name}]
    }))
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: output)
    from tool.server import epoch_finder
    monkeypatch.setattr(epoch_finder, "storage_campaigns", lambda: [{
        "id": "abcdef123456", "folder": "sets/demo", "path": campaign
    }])
    monkeypatch.setattr(epoch_finder, "frame_path", lambda folder, campaign_id, name: frame)
    monkeypatch.setattr(media_explorer.app_config, "safe_join_fs_root", lambda folder: tmp_path / folder)
    found = media_explorer.list_media(source="epoch")
    assert found["total"] == 1
    assert found["items"][0]["mediaUrl"].startswith("/fs/epoch_finder/frame?")


def test_storyboard_references_and_takes_use_owner_media_route(monkeypatch, tmp_path):
    from tool.server import storyboard_store
    base = tmp_path / "story"
    (base / "takes").mkdir(parents=True)
    (base / "references").mkdir()
    take = base / "takes" / "one.png"
    ref = base / "references" / "style.png"
    take.write_bytes(b"image")
    ref.write_bytes(b"image")
    monkeypatch.setattr(storyboard_store, "list_stories", lambda: [{"id": "story1"}])
    monkeypatch.setattr(storyboard_store, "load_story", lambda id: {
        "scenes": {"scene1": {
            "takes": {"take1": {"mediaPath": "takes/one.png", "generated": True}},
            "references": [{"mediaPath": "references/style.png", "role": "style"}]
        }}
    })
    monkeypatch.setattr(storyboard_store, "resolve_story_media",
                        lambda id, path: base / path)
    items = media_explorer.list_media(source="storyboard")["items"]
    assert {item["role"] for item in items} == {"generated", "reference"}
    assert all(item["mediaUrl"].startswith("/fs/storyboard/media?story=story1")
               for item in items)


def test_generate_references_have_no_rating_action(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, 'output_root', lambda: tmp_path)
    _media(tmp_path / 'generations/day/job/result.png')
    _media(tmp_path / 'generations/day/job/references/style.png')
    monkeypatch.setattr(media_explorer, 'list_results', lambda limit: [{
        'storageId': 'day/job', 'createdAt': 1, 'mediaPath': 'generations/day/job/result.png',
        'references': {'style': 'generations/day/job/references/style.png'},
    }])
    media = media_explorer.list_media()['items']
    assert next(item for item in media if item['role'] == 'reference')['rating'] is None
    assert next(item for item in media if item['role'] == 'generated')['storageId'] == 'day/job'


def test_source_set_media_is_never_exposed(monkeypatch, tmp_path):
    folder = tmp_path / "sets" / "one"
    folder.mkdir(parents=True)
    (folder / ".webcap_state.json").write_text("{}")
    (folder / "photo.png").write_bytes(b"image")
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path / "output")
    assert media_explorer.list_media(full="1")["total"] == 0
    with pytest.raises(ValueError, match="source"):
        media_explorer.list_media(source="set", full="1")


def test_explorer_normalizes_recorded_facts_and_filters_before_paging(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, 'output_root', lambda: tmp_path)
    _media(tmp_path/'generations/day/one/result.jpg')
    _media(tmp_path/'generations/day/two/result.jpg')
    monkeypatch.setattr(media_explorer, 'list_results', lambda limit: [
        {'storageId':'day/one','mediaPath':'generations/day/one/result.jpg','modelId':'one','rating':5,
         'resolvedPrompt':'A quiet CEDAR forest','seed':0,'settings':{'dimensions':'800x1200'},
         'loras':[{'name':'style.safetensors','strength':0.7}]},
        {'storageId':'day/two','mediaPath':'generations/day/two/result.jpg','modelId':'two','rating':0},
    ])
    result = media_explorer.list_media(search='cedar', model='one', rating='4', limit=1)
    assert result['total'] == 1
    assert result['facets']['models'] == ['one','two']
    item = result['items'][0]
    assert item['prompt'] == 'A quiet CEDAR forest'
    assert item['seed'] == 0
    assert item['resolution'] == '800x1200'
    assert item['fileSize'] == 6
    assert item['loras'] == [{'name':'style.safetensors','strength':0.7}]
    assert media_explorer.list_media(rating='unrated')['total'] == 1
    with pytest.raises(ValueError, match='rating'):
        media_explorer.list_media(rating='imaginary')


def test_storyboard_same_file_can_be_generated_and_a_reference(monkeypatch, tmp_path):
    from tool.server import storyboard_store
    file = tmp_path/'take.jpg'
    file.write_bytes(b'image')
    monkeypatch.setattr(storyboard_store,'list_stories',lambda:[{'id':'story'}])
    monkeypatch.setattr(storyboard_store,'load_story',lambda id:{'title':'Continuity','scenes':{
        'one':{'title':'First shot','takes':{'take':{'mediaPath':'takes/a.jpg','generated':True,'rating':5,'prompt':'Recorded prompt'}}},
        'two':{'title':'Next shot','references':[{'mediaPath':'takes/a.jpg','role':'first_frame'}]},
    }})
    monkeypatch.setattr(storyboard_store,'resolve_story_media',lambda id,path:file)
    result=media_explorer.list_media(source='storyboard',role='reference')
    assert result['total']==1
    assert result['items'][0]['roles']==['generated','reference']
    assert len(result['items'][0]['uses'])==2
    assert result['items'][0]['rating']==5
    assert result['items'][0]['prompt']=='Recorded prompt'


def test_generate_source_reads_exact_record_with_owner_path_validation(monkeypatch, tmp_path):
    import json
    from tool.server import generate_store
    monkeypatch.setattr(generate_store.app_config,'output_root',lambda:tmp_path)
    directory=tmp_path/'generations/day/old-record'
    directory.mkdir(parents=True)
    (directory/'image.jpg').write_bytes(b'image')
    (directory/'generation.json').write_text(json.dumps({'mediaPath':'generations/day/old-record/image.jpg','sourcePrompt':'Historical settings stay read only'}))
    result=generate_store.load_result('day/old-record')
    assert result['storageId']=='day/old-record'
    assert result['sourcePrompt']=='Historical settings stay read only'
    with pytest.raises(ValueError):
        generate_store.load_result('../../outside')

def test_test_discovery_supports_output_root_outside_the_source_tree(monkeypatch, tmp_path):
    import json
    from tool.server import epoch_test_bench
    source=tmp_path/'source'
    source.mkdir()
    output=tmp_path/'separate-output'
    session=output/'test-generations/sets/demo/sessions/session'
    session.mkdir(parents=True)
    (session/'image.jpg').write_bytes(b'image')
    (session/'test.json').write_text(json.dumps({'ownerFolder':'sets/demo','results':[{'mediaFile':'image.jpg'}]}))
    monkeypatch.setattr(media_explorer.app_config,'FS_ROOT',source)
    monkeypatch.setattr(media_explorer.app_config,'output_root',lambda:output)
    monkeypatch.setattr(epoch_test_bench,'_session_directory',lambda owner,name:session)
    found=media_explorer.list_media(source='test')
    assert found['total']==1
    assert found['items'][0]['id']=='test:sets/demo/test-generations/session/image.jpg'
    assert found['items'][0]['mediaUrl'].startswith('/fs/test_generations/media?folder=sets%2Fdemo')

def test_focused_artifact_uses_full_owner_discovery_and_exact_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config,'output_root',lambda:tmp_path)
    _media(tmp_path/'generations/old/one/result.jpg')
    _media(tmp_path/'generations/new/two/result.jpg')
    records=[{'storageId':'old/one','mediaPath':'generations/old/one/result.jpg'},
             {'storageId':'new/two','mediaPath':'generations/new/two/result.jpg'}]
    limits=[]
    def listed(limit):
        limits.append(limit)
        return records if limit is None else records[1:]
    monkeypatch.setattr(media_explorer,'list_results',listed)
    result=media_explorer.list_media(source='generate',full=True,artifact='generate:generations/old/one/result.jpg')
    assert limits==[None]
    assert result['total']==1
    assert result['items'][0]['storageId']=='old/one'

def test_explorer_route_passes_supported_filters_without_touching_context(monkeypatch):
    from tool.server import app as app_module
    seen={}
    def listing(**kwargs):
        seen.update(kwargs)
        return {'ok':True,'items':[],'total':0,'complete':True}
    monkeypatch.setattr(app_module,'media_explorer_list_media',listing)
    response=app_module.app.test_client().get('/fs/media_explorer?source=generate&model=krea2_raw&folder=sets/other&rating=4&artifact=generate:record&full=1')
    assert response.status_code==200
    assert seen['folder']=='sets/other'
    assert seen['artifact']=='generate:record'
    assert seen['model']=='krea2_raw'
    assert seen['rating']=='4'


def test_owner_filter_limits_media_to_existing_producer_identity(monkeypatch, tmp_path):
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path)
    for name in ("one", "two"):
        _media(tmp_path / "generations" / name / "result.png")
    monkeypatch.setattr(media_explorer, "list_results", lambda limit: [
        {"storageId": name, "createdAt": i,
         "mediaPath": "generations/" + name + "/result.png"}
        for i, name in enumerate(("one", "two"), 1)
    ])
    result = media_explorer.list_media(source="generate", owner="two")
    assert result["total"] == 1
    assert result["items"][0]["storageId"] == "two"
    assert media_explorer.list_media(source="generate", owner="missing")["total"] == 0


def test_existing_test_owner_ratings_are_discovered(monkeypatch, tmp_path):
    import json
    from tool.server import epoch_test_bench
    monkeypatch.setattr(media_explorer.app_config, "FS_ROOT", tmp_path)
    monkeypatch.setattr(media_explorer.app_config, "output_root", lambda: tmp_path / "output")
    session = tmp_path / "output" / "test-generations" / "sets" / "one" / "sessions" / "sess"
    session.mkdir(parents=True)
    (session / "result.png").write_bytes(b"image")
    (session / "test.json").write_text(json.dumps({
        "ownerFolder": "sets/one", "results": [{"mediaFile": "result.png"}]}))
    monkeypatch.setattr(epoch_test_bench, "_session_directory", lambda owner, name: session)
    monkeypatch.setattr(epoch_test_bench, "_session_rating_map", lambda directory: {"result.png": 3})
    monkeypatch.setattr(epoch_test_bench, "_session_vision_state", lambda directory: {})
    test_items = media_explorer.list_media(source="test")["items"]
    assert len(test_items) == 1
    assert test_items[0]["rating"] == 3
