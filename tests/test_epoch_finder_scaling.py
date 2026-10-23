"""Scalability contracts for Manual Screening and Campaigns."""
from tool.server import epoch_finder


def test_round_local_unit_index_keeps_existing_objects_and_creates_once():
    original = {"round": 1, "epoch": 1, "case": 0, "frame": "done.png", "error": ""}
    campaign = {"units": [original]}
    index = {(1, 1, 0): original}
    assert epoch_finder._unit(campaign, 1, 1, 0, index=index) is original
    for epoch in range(1, 101):
        for case in range(3):
            entry = epoch_finder._unit(campaign, 1, epoch, case, index=index)
            assert epoch_finder._unit(campaign, 1, epoch, case, index=index) is entry
    assert len(campaign["units"]) == 300
    assert campaign["units"][0] is original
    assert epoch_finder._unit(campaign, 1, 100, 2) is index[(1, 100, 2)]


def test_100_epoch_campaign_ranking_preserves_round_scope_and_weights():
    epochs = list(range(1, 101))
    campaign = {
        "rounds": [
            {"epochs": epochs},
            {"epochs": epochs[::2]},
        ],
        "units": [],
    }
    for epoch in epochs:
        for round_number in (1, 2):
            for case in range(3):
                # Later-round data is ignored in the earlier snapshot.
                campaign["units"].append({
                    "round": round_number, "epoch": epoch, "case": case,
                    "assessment": {"comparison": [
                        {"result": "match" if (epoch + case + round_number) % 3 else "mismatch",
                         "weight": 2 if case == 0 else 1},
                        {"result": "unclear", "weight": 3},
                    ]},
                })
    for round_number in (1, 2):
        ranked = epoch_finder._rank(campaign, round_number)
        assert len(ranked) == 100
        for row in ranked:
            relevant = [
                unit for unit in campaign["units"]
                if unit["epoch"] == row["epoch"] and unit["round"] <= round_number
                and unit["assessment"] is not None
            ]
            comparisons = [
                entry for unit in relevant for entry in unit["assessment"]["comparison"]
            ]
            matches = sum(e["weight"] for e in comparisons if e["result"] == "match")
            mismatches = sum(e["weight"] for e in comparisons if e["result"] == "mismatch")
            assert row["matches"] == matches
            assert row["mismatches"] == mismatches
            assert row["unclear"] == len(relevant)
            assert row["count"] == matches + mismatches
            assert row["score"] == matches / (matches + mismatches)
            assert row["roundsTested"] == list(range(1, round_number + 1))
            assert row["active"] is (row["epoch"] in campaign["rounds"][round_number - 1]["epochs"])


def test_completed_frames_are_not_rechecked_as_live_test_sessions(monkeypatch):
    checked = []
    def active(_folder, session):
        checked.append(session)
        return session == "unfinished"
    monkeypatch.setattr(epoch_finder, "_session_still_active", active)
    campaign = {"units": [
        {"session": "captured-1", "frame": "r1-e1-c0.png"},
        {"session": "captured-2", "frame": "r1-e2-c0.png"},
        {"session": "unfinished", "frame": ""},
        {"session": "new", "frame": ""},
    ]}
    assert epoch_finder._campaign_has_active_sessions(None, campaign) is True
    assert checked == ["unfinished"]

    checked.clear()
    campaign["units"][2]["session"] = ""
    assert epoch_finder._campaign_has_active_sessions(None, campaign) is False
    assert checked == ["new"]
