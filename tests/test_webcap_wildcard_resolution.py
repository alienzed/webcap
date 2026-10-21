"""WebCap owns Test wildcard resolution and the exact option/group evidence."""
from tool.server import epoch_test_bench as bench


def test_webcap_resolves_nested_and_optional_wildcards_reproducibly():
    prompt = "person {standing|sitting} wearing {small {red|blue}|large} bikini {ruched|}"
    for seed in (1, 22, 55555):
        resolved, selected = bench.resolve_test_wildcards(prompt, seed)
        again, repeated = bench.resolve_test_wildcards(prompt, seed)
        assert (resolved, selected) == (again, repeated)
        groups = bench._wildcard_evaluation_groups(prompt, resolved)
        assert len(groups) == len(selected) == 3
        for group, choice in zip(groups, selected):
            assert choice["option"] in group["options"]
            assert group["expected"] == group["options"].index(choice["option"]) + 1
    resolved, selected = bench.resolve_test_wildcards("simple caption", 8)
    assert resolved == "simple caption"
    assert selected == []


def test_group_identities_are_not_matched_by_option_text(monkeypatch):
    from tool.server import epoch_reference
    monkeypatch.setattr(bench, "_relative_set_folder", lambda path: "set")
    monkeypatch.setattr(epoch_reference, "reference_vocabulary", lambda folder, job: [
        {"group": "BT Back", "terms": [{"term": "simple"}, {"term": "dual ring"}]},
        {"group": "BB Back", "terms": [{"term": "simple"}, {"term": "micro"}]},
    ])
    prompt = "top with {simple|dual ring} and bottom with {simple|micro}"
    dimensions = [
        {"label": "Top", "annotationGroup": "BT Back", "options": ["simple", "dual ring"]},
        {"label": "Bottom", "annotationGroup": "BB Back", "options": ["simple", "micro"]},
    ]
    bound = bench._test_wildcard_dimensions("set", prompt, dimensions)
    assert [entry["annotationGroup"] for entry in bound] == ["BT Back", "BB Back"]
    resolved, selected = bench.resolve_test_wildcards(prompt, 4)
    visible = {"sourcePrompt": prompt, "resolvedPrompt": resolved,
               "wildcardSelections": selected, "wildcardDimensions": bound}
    bench._project_wildcard_fields(visible)
    groups = visible["wildcardEvaluationGroups"]
    assert [entry["annotationGroup"] for entry in groups] == ["BT Back", "BB Back"]
    assert [entry["expected"] for entry in groups] == [
        group["options"].index(choice["option"]) + 1
        for group, choice in zip(groups, selected)
    ]
    # An edited option is legitimate text, but it no longer proves Set membership.
    dimensions[1]["options"] = ["simple", "custom"]
    assert bench._test_wildcard_dimensions("set", prompt, dimensions) == []
    dimensions[1]["options"] = ["simple", "micro"]
    dimensions[1]["annotationGroup"] = "BT Back"
    changed = bench._test_wildcard_dimensions("set", prompt, dimensions)
    assert changed[0]["annotationGroup"] == "BT Back"
    assert changed[1]["annotationGroup"] == ""


def test_enqueue_forwards_scoped_dimensions_without_extra_resolution(monkeypatch):
    monkeypatch.setattr(bench, "reconcile_startup", lambda: None)
    seen = {}
    def prepared(folder, prompt, **kwargs):
        return {"sourcePrompt": prompt, "prompt": "finished prompt", "wildcardSelections": [
            {"id": "G1", "option": "micro", "selected": 1}
        ]}, [], True
    monkeypatch.setattr(bench, "_new_inference_request", prepared)
    monkeypatch.setattr(bench, "_test_wildcard_dimensions",
                        lambda folder, prompt, dimensions: (seen.update(dimensions=dimensions) or dimensions))
    monkeypatch.setattr(bench, "_enqueue_frozen_test_request",
                        lambda folder, request, loras, include_base, **kwargs:
                        (seen.update(request=request) or {"session": "session-1", "name": "",
                         "modelId": "h3", "status": "queued", "total": 1, "startedAt": 0}))
    source = [{"label": "Bottom", "annotationGroup": "BB Back", "options": ["micro", "simple"]}]
    bench.enqueue("set", "{micro|simple}", wildcard_dimensions=source)
    assert seen["dimensions"] == source
    assert seen["request"]["wildcardDimensions"] == source
    assert seen["request"]["wildcardSelections"][0]["option"] == "micro"
