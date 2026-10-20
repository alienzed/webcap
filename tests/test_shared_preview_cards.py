"""Canonical preview cards keep screen ownership and native media state."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_shared_card_loads_before_every_consumer():
    html = read("tool/tool.html")
    card = html.index('src="/static/js/test_preview_card.js"')
    assert card < html.index('src="/static/js/test_generations.js"')
    assert card < html.index('src="/static/js/epoch_finder.js"')
    assert card < html.index('src="/static/js/epoch_info.js"')


def test_all_preview_surfaces_share_same_render_primitive():
    common = read("tool/js/test_preview_card.js")
    tests = read("tool/js/test_generations.js")
    campaigns = read("tool/js/epoch_finder.js")
    epochs = read("tool/js/epoch_info.js")
    assert "window.createTestPreviewCard = createTestPreviewCard;" in common
    assert "function sharedTestCard(result, status, className, muted, failed)" in tests
    assert "sharedTestCard(result, status, 'test-generations-compare-item', true)" in tests
    assert "sharedTestCard(result, status, 'test-generations-result-card', false)" in tests
    assert "sharedTestCard(failure, status, 'test-generations-result-card is-failed', false, true)" in tests
    assert "createTestPreviewCard({" in campaigns
    assert "createTestPreviewCard({" in epochs
    assert "function buildResultFooter" not in tests
    assert "function appendTestPreview(" not in tests


def test_shared_card_keeps_existing_media_controls_and_ratings():
    shared = read("tool/js/test_preview_card.js")
    tests = read("tool/js/test_generations.js")
    assert "o.videoTransport(card, preview)" in shared
    assert "videoTransport: appendTestPreviewVideo" in tests
    assert "dataset.testRating" in shared
    assert "dataset.testSession" in shared
    assert "dataset.testManualEpochScore" in shared
    assert "dataset.testVlEpochScore" in shared
    assert "dataset.testVlResult" in shared
    assert "test_rate_result" in tests
    assert "test_rate_result" in read("tool/js/epoch_info.js")


def test_no_new_storage_and_pruned_frames_remain_without_cards():
    backend = read("tool/server/epoch_finder.py")
    finder = read("tool/js/epoch_finder.js")
    epoch_info = read("tool/js/epoch_info.js")
    assert "from . import test_reference" in backend
    assert "test_reference.read(folder_path, session)" in backend
    assert "not u.framePruned" in finder
    assert "return null;" in epoch_info
    assert "if(!card){card=renderCard(item,view)" in epoch_info
    assert "card.dataset.cardVersion===version" in finder
