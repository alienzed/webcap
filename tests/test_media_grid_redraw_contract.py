"""Source contracts for preserving media DOM across local changes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_sidebar_reconciles_stable_media_and_folder_rows():
    script = (ROOT / "tool" / "js" / "media.js").read_text(encoding="utf-8")
    renderer = script.split("async function renderFileList()", 1)[1].split("function updateFlagDotForItem", 1)[0]
    assert "var previousRows = new Map();" in renderer
    assert "desiredRows.push(mediaListReuseRow(previousRows, 'folder'" in renderer
    assert "desiredRows.push(mediaListReuseRow(previousRows, 'media'" in renderer
    assert "mediaListReconcileRows(desiredRows);" in renderer
    assert "refreshFolderQueueStatusBadges();" in renderer
    assert "ui.mediaListEl.innerHTML = '';" not in renderer
    assert "if (row.dataset.listMarkup !== markup)" in script
    assert "if (host.children[index] !== row) host.insertBefore(row" in script


def test_grid_reconciles_tiles_and_updates_media_and_badges():
    script = (ROOT / "tool" / "js" / "media_grid_tiles.js").read_text(encoding="utf-8")
    renderer = script.split("function renderMediaGridCanvas()", 1)[1].split("function mediaGridOpenItemInMainWorkspace", 1)[0]
    assert "var existing = new Map();" in renderer
    assert "existing.get(item.key)" in renderer
    assert "mediaGridSyncTile(item, tile);" in renderer
    assert "if (grid.children[index] !== tile) grid.insertBefore(tile" in renderer
    assert "canvas.innerHTML = '';" not in renderer
    assert "if (media.getAttribute('src') !== url) media.setAttribute('src', url);" in script
    assert "if (tile.dataset.gridBadgeState !== badgeState)" in script
    assert "mediaGridSyncSelectionDisplay();" in renderer
