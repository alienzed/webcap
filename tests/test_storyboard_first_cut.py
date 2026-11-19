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



def test_first_cut_uses_visual_direction_contract_for_every_authored_scene(monkeypatch):
    """First Cut's automatic pass reuses the real Visual Direction contract."""
    story = {
        "id": "story-1",
        "title": "Station at dusk",
        "concept": "A courier arrives at an empty station.",
        "style": "Cinematic dusk.",
        "invariants": [
            {"kind": "location", "title": "Station",
             "text": "A brick station with one arched entrance."}
        ],
        "sceneOrder": [],
        "scenes": {},
    }
    batch = {"id": "batch-1", "storyId": "story-1", "modelId": "local",
             "cancelled": False, "phase": "", "detail": "", "sceneCount": 0}
    monkeypatch.setattr(first_cut, "_BATCHES", [batch])
    monkeypatch.setattr(first_cut, "load_story", lambda _id: story)

    called = []

    def apply_step(contract, operation, scene_id, instruction):
        called.append((operation, scene_id, instruction, contract, batch["phase"]))
        if operation == "develop_story":
            story["sceneOrder"] = ["scene-a", "scene-b"]
            story["scenes"] = {
                "scene-a": {
                    "title": "Arrival", "prompt": "A courier steps onto the platform.",
                    "durationSeconds": 8,
                },
                "scene-b": {
                    "title": "Departure", "prompt": "The courier lifts a lantern.",
                    "durationSeconds": 8,
                },
            }

    assert first_cut.run_director_steps("batch-1", apply_step) == 2
    assert [item[0] for item in called] == [
        "expand_concept", "define_invariants", "develop_story",
        "visual_direction", "visual_direction",
    ]
    assert [item[1] for item in called[3:]] == ["scene-a", "scene-b"]
    assert batch["sceneCount"] == 2

    for operation, scene_id, instruction, contract, phase in called[3:]:
        assert operation == "visual_direction"
        assert instruction == ""
        assert phase == "Visual Direction"
        assert contract["operation"] == "visual_direction"
        assert contract["output"] == "json"
        assert contract["response_schema"]["required"] == ["changed", "prompt"]
        assert "[EXISTING H3 PROMPT]" in contract["prompt"]
        assert "Review this Scene prompt for concrete audiovisual contradictions" not in contract["prompt"]
        assert "refine_prompt" not in contract["prompt"]
        assert "You are refining prompts for a text-to-video model" in contract["system_prompt"]
        assert story["scenes"][scene_id]["prompt"] in contract["prompt"]
