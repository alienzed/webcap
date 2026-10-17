from tool.server.checkpoint_ratings import by_checkpoint


def test_group_ratings_by_source_identity_and_skip_unmatched():
    metadata = {
        "a.safetensors": {"folder": "set", "sourceJobId": "run-a", "stage": "h3", "epoch": 1},
        "b.safetensors": {"folder": "set", "sourceJobId": "run-a", "stage": "h3", "epoch": 1},
        "c.safetensors": {"folder": "set", "sourceJobId": "run-b", "stage": "h3", "epoch": 1},
        "legacy.safetensors": {"epoch": 1},
    }
    scores = {
        "a.safetensors": {"average": 4, "count": 2},
        "b.safetensors": {"average": 2, "count": 1},
        "c.safetensors": {"average": 5, "count": 1},
        "legacy.safetensors": {"average": 5, "count": 8},
    }
    result = by_checkpoint(metadata, scores)
    assert len(result) == 2
    assert result[0]["sourceJobId"] == "run-a"
    assert result[0]["average"] == 3.33
    assert result[0]["ratingCount"] == 3
    assert result[1]["sourceJobId"] == "run-b"
    assert result[1]["ratingCount"] == 1


def test_missing_ratings_are_not_failures():
    metadata = {"x.safetensors": {"folder": "set", "sourceJobId": "run",
                                  "stage": "h3", "epoch": 2}}
    assert by_checkpoint(metadata, {}) == []
