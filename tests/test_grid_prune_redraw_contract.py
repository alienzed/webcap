from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_prune_uses_existing_authoritative_list_refresh_once():
    source = (ROOT / "tool" / "js" / "media_grid_actions.js").read_text(encoding="utf-8")
    prune = source.split("async function mediaGridPruneSelected()", 1)[1].split("function mediaGridCanDefaceItem(", 1)[0]
    assert "renderFileList(ui.filterEl.value);" in prune
    assert "mediaGridRefreshAfterMutation();" not in prune
    assert "if (prunedCount)" in prune


def test_folder_status_badges_only_update_when_changed():
    source = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")
    refresh = source.split("function refreshFolderQueueStatusBadges()", 1)[1].split("function mediaListReuseRow(", 1)[0]
    assert "host.dataset.trainingStatusKey !== statusKey" in refresh
    assert "host.dataset.trainingStatusKey = statusKey" in refresh
