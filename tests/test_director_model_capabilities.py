import json

import pytest

from tool.server import director_model_capabilities as capabilities
from tool.server import director_model_test_store as model_test


def test_shipped_json_catalogue_matches_runtime_hints():
    path = capabilities._CAPABILITIES_PATH
    assert path.name == "director_model_capabilities.json"
    catalogue = json.loads(path.read_text(encoding="utf-8"))

    assert len(catalogue) == 22
    assert capabilities.list_capability_hints() == catalogue
    assert model_test.list_capability_hints() == catalogue


@pytest.mark.parametrize("model_name,context,output", [
    ("gemma-4-31B-Mystery-Fine-Tune-HERETIC-UNCENSORED-INSTRUCT-Q4_K_S.gguf", 131072, None),
    ("gemma-4-E4B-it-ultra-uncensored-heretic-Q8_0.gguf", 131072, None),
    ("Hemmingway-1-Extreme-Q4_K_M.gguf", 262144, None),
    ("Qwen3.5-4B-NSFW-ARA-Heretic-Literotica.i1.Q4_K_M.gguf", 262144, 32768),
    ("qwen3.8-9b-distill-uncensored-heretic-q4_k_m.gguf", 262144, 16384),
    ("G4-MeroMero-v2-31B-heretic.i1-Q4_K_M.gguf", 262144, None),
    ("gemma-4-26B-A4B-it-heretic.Q6_K.gguf", 262144, None),
    ("Qwen2-VL-2B-Abliterated-Caption-it.Q6_K.gguf", 32768, None),
    ("RVN-Q5_K_M.gguf", 262144, None),
    ("deepseek-r1-0528-qwen3-8b-heretic:Q6_K", 131072, None),
    ("gemma-3-12b-it-heretic:q5_k_m", 131072, None),
    ("Gemma4-12B-IT-QAT_Q4_64K_16GB-GPU:latest", 262144, None),
    ("Qwen3.8-27B-TTURBO-Fable-Cold-Fusion-709-ULTRA-HERETIC-Uncensored-NM-DAU-NEO-MTP.gguf", 262144, 131072),
])
def test_filename_matching_preserved(model_name, context, output):
    capability = capabilities.capability_for_model(model_id=model_name)
    assert capability["contextTokens"] == context
    assert capability.get("recommendedOutputTokens") == output
    assert "match" not in capability


def test_no_match_and_defensive_copies():
    assert capabilities.capability_for_model("unknown::nothing.gguf") is None
    assert capabilities.capability_for_model() is None
    found = capabilities.capability_for_model(label="Hemmingway-1-Extreme")
    found["notes"].append("caller-only change")
    assert "caller-only change" not in capabilities.capability_for_model(label="Hemmingway-1-Extreme")["notes"]

    hints = capabilities.list_capability_hints()
    hints[0]["match"].clear()
    assert capabilities.list_capability_hints()[0]["match"]


@pytest.mark.parametrize("content,issue", [
    ("{}", "non-empty JSON array"),
    ("[]", "non-empty JSON array"),
    ('[{"match": []}]', "non-empty match"),
    ('[{"match": ["example"], "contextTokens": "128k"}]', "contextTokens"),
    ('[{"match": ["example"], "notes": "text"}]', "notes"),
    ('[{"match": ["example"], "verifiedAt": 20261013}]', "verifiedAt"),
])
def test_invalid_catalogue_fails_loudly(tmp_path, content, issue):
    path = tmp_path / "capabilities.json"
    path.write_text(content, encoding="utf-8")
    with pytest.raises(ValueError, match=issue):
        capabilities._load_capabilities(path)


def test_missing_and_malformed_catalogue_fail_loudly(tmp_path):
    path = tmp_path / "capabilities.json"
    with pytest.raises(FileNotFoundError):
        capabilities._load_capabilities(path)
    path.write_text("{invalid json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        capabilities._load_capabilities(path)


def test_runtime_package_context_is_distinct_from_published_model_context():
    cap = capabilities.capability_for_model(model_id="Gemma4-12B-IT-QAT_Q4_64K_16GB-GPU:latest")
    assert cap["contextTokens"] == 262144
    assert cap["runtimeContextTokens"] == 64000


def test_ambiguous_and_partial_aliases_remain_unmatched():
    for name in ("nullguard:latest", "gemma-4b-uncensored:q4_k_m", "xg4-meromero-v2-31b-heretic.gguf", "rvnery.gguf"):
        assert capabilities.capability_for_model(model_id=name) is None
