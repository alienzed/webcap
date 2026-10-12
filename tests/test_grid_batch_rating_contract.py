"""Keep multi-item Grid ratings from repeatedly rebuilding shared UI."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_grid_rating_batch_defers_shared_refresh_until_final_item():
    details = (ROOT / "tool" / "js" / "item_details.js").read_text(encoding="utf-8")
    grid = (ROOT / "tool" / "js" / "media_grid_actions.js").read_text(encoding="utf-8")
    rating = details.split("function setRatingForMediaKey(", 1)[1].split("function renderItemMetadataPanel(", 1)[0]
    batch = grid.split("function mediaGridApplyRating(", 1)[1].split("function mediaGridRefreshAfterMutation(", 1)[0]
    assert "var opts = options || {};" in rating
    assert "setMediaRating(state.folder, mediaKey, next)" in rating
    assert "recordUndoOperation({" in rating
    assert "if (!opts.deferUiRefresh) {" in rating
    assert "renderItemMetadataPanel();" in rating
    assert "renderFileList();" in rating
    assert "syncFocusedAnnotationQueue({ anchorMediaKey: mediaKey });" in rating
    assert "setRatingForMediaKey(item.key, rating, { deferUiRefresh: index < items.length - 1 });" in batch
    assert "mediaGridRefreshAfterMutation();" not in batch
