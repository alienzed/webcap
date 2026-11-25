"""Offline checks for the isolated single-draft refinement experiment."""
import json

from scripts import studio_artist_mixer_eval as mixer
from scripts import studio_guidance_eval as e


def test_fixed_plan_has_one_draft_and_its_own_refinement_per_case():
    plan = mixer.make_plan("test::offline")
    assert len(plan["cases"]) == 5
    assert len(plan["trials"]) == plan["actual_call_cap"] == 20
    for case in plan["cases"]:
        stages = [t["package_id"] for t in plan["trials"] if t["case_id"] == case["id"]]
        assert set(stages) == {"single", "combined", "artist", "mixed"}
        assert stages.index("mixed") == stages.index("artist") + 1
    assert plan["packages"]["single"]["role"] == e.resolve_packages(e.load_design(e.DESIGN_DIR / "profile_cleanup")[0])["current"]["role"]


def test_refinement_receives_exact_artist_material_and_original_task(tmp_path, monkeypatch):
    plan = mixer.make_plan("test::offline")
    seen = []

    def fake_call(model, messages, schema, settings, max_tokens, context_size):
        last = json.loads(messages[-1]["content"]) if '"artistDraft"' in messages[-1]["content"] else None
        if last:
            assert last["artistDraft"] == "Artist material {unusual wording and literal \\n remain}"
            assert len(messages) >= 3
        seen.append((schema, settings, last))
        text = "Artist material {unusual wording and literal \\n remain}" if settings["temperature"] == .7 else "Other usable output"
        return {"text": text, "finishReason": "stop", "usage": {}}, {"messages": messages, **settings}

    monkeypatch.setattr(mixer, "call_real", fake_call)
    assert mixer.execute(plan, tmp_path / "run") == 0
    assert len(seen) == 20
    assert sum(last is not None for _, _, last in seen) == 5
    rows = e.read_jsonl(tmp_path / "run/trials.jsonl")
    for row in rows:
        if row["package_id"] == "mixed":
            source = next(r for r in rows if r["index"] == row["artist_source_index"])
            assert source["package_id"] == "artist" and source["case_id"] == row["case_id"]
            assert row["artist_source_sha256"] == e.digest(source["result"]["text"])


def test_failed_engineer_preserves_artist_and_other_successes(tmp_path, monkeypatch):
    plan = mixer.make_plan("test::offline")
    def fake_call(model, messages, schema, settings, max_tokens, context_size):
        if settings["temperature"] == .15:
            raise RuntimeError("Concrete external runtime failure")
        return {"text": "Useful retained material", "finishReason": "stop"}, {}
    monkeypatch.setattr(mixer, "call_real", fake_call)
    assert mixer.execute(plan, tmp_path / "run") == 1
    rows = e.read_jsonl(tmp_path / "run/trials.jsonl")
    assert sum(row["status"] == "completed" for row in rows) == 15
    assert all(row["result"]["text"] == "Useful retained material" for row in rows if row["package_id"] == "artist")
