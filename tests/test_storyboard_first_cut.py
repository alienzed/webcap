from tool.server import storyboard_first_cut as first_cut


def test_first_cut_submits_one_llm_job_before_queuing_first_takes(monkeypatch):
    story = {"id": "story-1", "sceneOrder": ["scene-a", "scene-b"]}
    batch = {"id": "batch-1", "storyId": "story-1", "modelId": "local",
             "cancelled": False, "phase": "", "detail": "",
             "llmJobId": "", "llmJobIds": [], "takeJobIds": []}
    queued_llm = []
    takes = []

    monkeypatch.setattr(first_cut, "load_story", lambda _story_id: story)
    monkeypatch.setattr(first_cut, "storyboard_story_busy", lambda _story_id: False)
    monkeypatch.setattr(first_cut, "generation_queue", lambda _story_id: {"jobs": []})
    monkeypatch.setattr(first_cut, "enqueue", lambda *args, **kwargs:
                        (queued_llm.append((args, kwargs)) or {"jobId": "llm-1"}))
    monkeypatch.setattr(first_cut, "job_status", lambda _id: {"status": "completed"})
    monkeypatch.setattr(first_cut, "start_generation", lambda _story, scene:
                        (takes.append(scene) or {"jobId": "take-" + scene}))

    first_cut._execute(batch)

    assert len(queued_llm) == 1
    assert queued_llm[0][0][2]["operation"] == "first_cut_sequence"
    assert queued_llm[0][1]["context"]["firstCutBatchId"] == "batch-1"
    assert batch["llmJobIds"] == ["llm-1"]
    assert batch["llmJobId"] == ""
    assert takes == ["scene-a", "scene-b"]
    assert batch["takeJobIds"] == ["take-scene-a", "take-scene-b"]


def test_first_cut_checks_cancellation_between_director_steps(monkeypatch):
    story = {"id": "story-1", "concept": "Initial", "sceneOrder": []}
    batch = {"id": "batch-1", "storyId": "story-1", "modelId": "local",
             "cancelled": False, "phase": "", "detail": "", "sceneCount": 0}
    monkeypatch.setattr(first_cut, "_BATCHES", [batch])
    monkeypatch.setattr(first_cut, "load_story", lambda _story_id: story)
    monkeypatch.setattr(first_cut, "build_request", lambda *args, **kwargs: {})
    calls = []

    def apply_step(_contract, operation, _scene_id, _instruction):
        calls.append(operation)
        batch["cancelled"] = True

    try:
        first_cut.run_director_steps(batch["id"], apply_step)
        assert False, "Cancelled First Cut should not continue."
    except first_cut._Stopped:
        pass
    assert calls == ["expand_concept"]
