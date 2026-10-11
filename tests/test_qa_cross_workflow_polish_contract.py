from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def test_qa_evidence_explanation_is_inside_collapsed_details():
    qa = read("tool/js/qa_workbench.js")
    browse = qa.split("function qaRenderBrowse(container, items)", 1)[1].split("function qaRenderReportFinding(", 1)[0]
    assert "details.appendChild(why);" in browse
    assert "qaRenderFacts(details, finding);" in browse
    assert "article.appendChild(why);" not in browse
    assert "qaRenderFacts(article, finding);" not in browse
    assert "article.appendChild(details);" in browse


def test_qa_overview_displays_only_unresolved_category_counts_and_coverage():
    qa = read("tool/js/qa_workbench.js")
    overview = qa.split("function qaRenderOverview(container, items, health)", 1)[1].split("function qaCreateEvidenceMedia(", 1)[0]
    assert "qaCategoryCounts(undisposed)" in overview
    assert "qaDeepCoverageCounts(items)" in overview
    assert "No actionable findings in available checks" in overview


def test_qa_group_inspection_enters_existing_grid_and_preserves_return():
    qa = read("tool/js/qa_workbench.js")
    inspect = qa.split("function qaInspectFinding(findingId)", 1)[1].split("function qaInspectHealth(", 1)[0]
    assert "qaCloneFocusSet(state.focusSet)" in inspect
    assert "qaWorkbenchState.returnFindingId = finding.id;" in inspect
    assert "activateFocusSet(finding.files" in inspect
    assert "openMediaGridSurface();" in inspect
    assert "qaReviewCaptionFiles(" in inspect
    assert "function returnToQaWorkbenchFromFocusSet()" in qa


def test_set_intelligence_allows_partial_cached_evidence_without_automatic_scan():
    scan = read("tool/js/set_scan.js")
    assert "function coverageIsUsable()" in scan
    assert "setScanState.coverage.openCurrent > 0" in scan
    assert "setScanState.running || !coverageIsUsable()" in scan
    assert "rescanBtn.onclick = function () { runSetIntelligence(); };" in scan


def test_vocabulary_uses_whole_set_scope_with_visible_representatives():
    schema = read("tool/js/vision_schema_assist.js")
    render = schema.split("function renderProposals()", 1)[1].split("function renderProgress()", 1)[0]
    assert "representativeFiles.length < 4" in render
    assert "vision-schema-evidence-thumbs" in render
    assert "encodeURIComponent(schemaState.folder)" in render
    assert "Discover vocabulary across the Set" in schema
    assert "Apply existing vocabulary in Grid" in schema
