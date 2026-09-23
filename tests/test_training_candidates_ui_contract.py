from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_candidate_modal_is_loaded_and_available_from_running_and_recent_runs():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    runner = (ROOT / "tool" / "js" / "training_runner_ui.js").read_text(encoding="utf-8")
    history = (ROOT / "tool" / "js" / "training_history_ui.js").read_text(encoding="utf-8")
    workspace = (ROOT / "tool" / "js" / "training_workspace.js").read_text(encoding="utf-8")

    assert 'id="training-candidates-modal"' in html
    assert html.index('id="app-overlay-root"') < html.index('id="training-candidates-modal"')
    assert 'id="training-candidates-stage"' not in html
    assert 'id="training-candidates-stage-btn"' not in html
    assert 'id="training-candidates-open-run"' in html
    assert 'id="training-candidates-algorithm"' in html
    assert 'Multiscale Loss Basins' in html
    assert 'Score Scalars · legacy baseline' in html
    for algorithm in ("v5", "v3"):
        assert 'value="' + algorithm + '"' in html
    assert '/static/js/training_candidates.js' in html
    assert 'data-training-candidates=' in runner
    assert 'latestTrainingCandidateStageJob' not in (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")
    assert 'data-training-history-candidates=' in history
    assert workspace.count('openTrainingCandidates(') >= 3


def test_candidate_ui_is_manual_read_only_charting():
    script = (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")
    css = (ROOT / "tool" / "css" / "styles.css").read_text(encoding="utf-8")

    assert "function refreshTrainingCandidates()" in script
    assert "/fs/training_candidates?folder=" in script
    assert "candidateAlgorithm" in script
    assert "&algorithm=" in script
    assert "training-candidates-raw" in script
    assert "training-candidates-step-loss" in script
    assert "training-candidates-step-loss-smoothed" in script
    assert "training-candidates-analysis" in script
    assert "training-candidates-basin" in script
    assert "analysisPoints" in script
    assert "savedArtifacts" in script
    assert "regions" in script
    assert "epochLossPoints" in script
    assert "stepLossPoints" in script
    assert "function trainingCandidatesEma" in script
    assert "TRAINING_CANDIDATES_DISPLAY_SESSION_KEY" in script
    assert "sessionStorage.setItem(TRAINING_CANDIDATES_DISPLAY_SESSION_KEY" in script
    assert "showRawStep" in script
    assert "showSmoothedStep" in script
    assert "showEpochLoss" in script
    assert "training-candidates-smoothing-number" in script
    assert "training-candidates-y-auto" in script
    assert "detailedSmoothedPoints" not in script
    assert "training-candidates-hover-layer" in script
    assert "Step loss:" in script
    assert "Smoothed step loss:" in script
    assert "training-candidates-tooltip" in script
    assert "function chartBoundsInWrap()" in script
    assert "wrap.getBoundingClientRect()" in script
    assert "chart.offsetLeft" not in script
    assert "chart.offsetTop" not in script
    assert "training-candidates-open-epoch" in script
    assert "training-candidates-pinned-popover" in script
    assert "training-candidates-epoch-marker" in script
    assert "trainingCandidatesStepPointForEpoch" in script
    assert "trainingCandidatesYAxisTicks" in script
    assert "toggleTrainingCandidatesFullscreen" in script
    assert "Saved in region:" in script
    assert "Open Epoch Folder" in script
    assert "trainingCandidatesPinnedDetailsHtml" in script
    assert "training-candidates-chart-footer" in script
    assert "training-candidates-open-generations" in script
    assert "Copy to Test" in script
    assert "Remove from Test" in script
    assert "Open Test Folder" not in script
    assert "/fs/training_candidates/open_test" not in script
    assert "inTestFolder" in script
    assert "/fs/training_candidates/" in script
    assert "remove_from_test" in script
    assert "copy_to_test" in script
    assert "artifact.status === 'available'" in script
    assert "No confirmed valleys" not in script
    assert "confidence" not in script.lower()
    assert "detector controls" not in script.lower()
    assert "function scheduleTrainingCandidatesAutoRefresh()" in script
    assert "status !== 'starting' && status !== 'running' && status !== 'stopping'" in script
    assert "}, 60000);" in script
    assert "training-candidates-modal" in css
    assert "width: min(95vw, 1800px)" in css
    assert "height: 94vh" in css
    assert ".training-candidates-dialog:fullscreen" in css
    assert '.training-candidates-chart text { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }' in css
    assert ".training-candidates-step-loss-smoothed" in css
    assert ".training-candidates-gridline" in css
    assert ".training-candidates-epoch-band.is-alternate" in css
    assert ".training-candidates-epoch-boundary" in css
    assert ".training-candidates-pinned-popover" in css
    assert 'html[data-theme="dark"] .training-candidates-dialog .training-candidates-text-btn' in css
    assert 'html[data-theme="dark"] .training-candidates-dialog .training-candidates-line-toggle input' in css
    assert ".training-candidates-list" not in css


def test_chart_geometry_step_lookup_and_algorithm_switching():
    harness = r"""
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const elements = {};
for (const name of ['modal', 'modal-summary', 'modal-content', 'algorithm', 'smoothing', 'smoothing-number', 'y-min', 'y-max', 'y-auto', 'refresh', 'fullscreen', 'open-run', 'modal-close']) {
  elements['training-candidates-' + name] = {
    classList: { add() {}, remove() {} }, setAttribute() {},
    querySelectorAll() { return []; }, blur() {}, value: 'v5'
  };
}
const requests = [];
const data = {
  epochLossPoints: [{step:199,epoch:1,loss:.4},{step:399,epoch:2,loss:.3}],
  stepLossPoints: [{step:10,epoch:1,loss:.8},{step:190,epoch:1,loss:.2},{step:399,epoch:2,loss:.3}],
  smoothedStepLossPoints: [{step:10,epoch:1,loss:.8},{step:190,epoch:1,loss:.2},{step:399,epoch:2,loss:.3}],
  analysisPoints: [{step:10,epoch:1,loss:.8},{step:190,epoch:1,loss:.2},{step:390,epoch:2,loss:.3}],
  regions: [{startStep:180,endStep:199,startEpoch:1,endEpoch:1,representativeEpoch:1,label:'Test region',savedEpochs:[]}],
  candidates: [{step:199,epoch:1}], savedArtifacts: [{epoch:1,status:'available',fileName:'adapter.safetensors',inTestFolder:true}], testFolderStatus: {state:'available'}
};
const context = {
  document: {getElementById(id) {return elements[id];}, querySelector() {return null;}, addEventListener() {}, removeEventListener() {}},
  escapeHtml(s) { return String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'); },
  trainingWorkspaceState: {
    candidateFolder:'set',candidateJobId:'job',candidateAlgorithm:'v5',candidateRequestVersion:0,
    runnerJobs:[{id:'job',folder:'set',stages:'h3',profileId:'minimax_h3'}],history:{jobs:[]},
    profiles:[{id:'minimax_h3',test:{enabled:true,stagingKey:'h3'}}]
  },
  state: {folder:'set'},
  trainingRunnerStatusLabel(s) { return s; }, setStatus() {},
  getTrainingRunnerJobById(id) {
    return context.trainingWorkspaceState.runnerJobs.find(job => job.id === id) || null;
  },
  trainingRunnerRequest(url) { requests.push(url); return Promise.resolve({ok:true,analysis:data,run:{status:'done'}}); }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
assert.deepEqual(context.trainingCandidatesDisplayState(),{smoothing:.99,yMin:null,yMax:null,showRawStep:false,showSmoothedStep:true,showEpochLoss:true});
elements['training-candidates-smoothing'].value='.95';
elements['training-candidates-smoothing'].oninput();
assert.equal(context.trainingCandidatesDisplayState().smoothing,.95);
assert.equal(elements['training-candidates-smoothing-number'].value,'0.950');
elements['training-candidates-smoothing-number'].value='.97';
elements['training-candidates-smoothing-number'].onchange();
assert.equal(context.trainingCandidatesDisplayState().smoothing,.97);
elements['training-candidates-smoothing-number'].value='.50';
elements['training-candidates-smoothing-number'].onchange();
assert.equal(elements['training-candidates-smoothing-number'].value,'0.970');
elements['training-candidates-y-min'].value='.12';
elements['training-candidates-y-min'].onchange();
elements['training-candidates-y-max'].value='.28';
elements['training-candidates-y-max'].onchange();
assert.equal(context.trainingCandidatesDisplayState().yMin,.12);
assert.equal(context.trainingCandidatesDisplayState().yMax,.28);
elements['training-candidates-y-min'].value='.30';
elements['training-candidates-y-min'].onchange();
assert.equal(context.trainingCandidatesDisplayState().yMin,.12);
assert.equal(context.trainingCandidatesDisplayState().yMax,.28);
elements['training-candidates-y-auto'].onclick();
assert.equal(context.trainingCandidatesDisplayState().yMin,null);
assert.equal(context.trainingCandidatesDisplayState().yMax,null);
assert.equal(elements['training-candidates-y-min'].value,'');
assert.equal(elements['training-candidates-y-max'].value,'');
const svg = context.trainingCandidatesSvg(data);
assert(svg.includes('viewBox="0 0 1000 560"'));
const chart = JSON.parse(svg.match(/data-training-candidates-chart="([^"]+)"/)[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
assert.equal(chart.plotHeight,490);
assert.equal(chart.testFolderStatus.state,'available');
assert.equal(chart.plotBottom-chart.plotTop,490);
for (const tag of svg.matchAll(/<rect[^>]+>/g)) {
  if (tag[0].includes('height="490"')) assert(tag[0].includes('y="28"'));
}
assert(svg.includes('class="training-candidates-gridline"'));
assert(svg.includes('class="training-candidates-epoch-band is-alternate"'));
assert(svg.includes('class="training-candidates-epoch-boundary"'));
assert(svg.includes('class="training-candidates-plot-content" clip-path="url(#training-candidates-plot-clip)"'));
assert(svg.includes('class="training-candidates-hover-guide hidden" x1="0" y1="28" x2="0" y2="518"'));
const marker = svg.match(/class="training-candidates-marker training-candidates-epoch-marker(?: in-test-folder)?"[^>]*><line x1="([^"]+)"[^>]*>.*?<circle cx="([^"]+)" cy="([^"]+)" r="7"/);
const epochBoundary = svg.match(/class="training-candidates-epoch-boundary" x1="([^"]+)"/);
const epochLossLine = svg.match(/class="training-candidates-raw" points="([^"]+)"/);
const firstEpochLossPoint = epochLossLine[1].split(' ')[0].split(',');
assert(Math.abs(Number(marker[1]) - (52 + (190-10)/(399-10)*926)) < .01);
assert(Math.abs(Number(marker[1]) - Number(epochBoundary[1])) < .01);
assert(Math.abs(Number(marker[2]) - Number(firstEpochLossPoint[0])) < .01);
assert(Math.abs(Number(marker[3]) - Number(firstEpochLossPoint[1])) < .01);
const savedOnlyData = Object.assign({}, data, {candidates:[], savedArtifacts:[{epoch:1,status:'available',fileName:'adapter.safetensors',inTestFolder:true}]});
const savedOnlySvg = context.trainingCandidatesSvg(savedOnlyData);
const savedOnlyMarker = savedOnlySvg.match(/class="training-candidates-epoch-marker training-candidates-saved-marker[^>]*>.*?<circle cx="([^"]+)" cy="([^"]+)" r="5"/);
const savedOnlyEpochLossLine = savedOnlySvg.match(/class="training-candidates-raw" points="([^"]+)"/);
const savedOnlyFirstEpochLossPoint = savedOnlyEpochLossLine[1].split(' ')[0].split(',');
assert(savedOnlyMarker);
assert(Math.abs(Number(savedOnlyMarker[1]) - Number(savedOnlyFirstEpochLossPoint[0])) < .01);
assert(Math.abs(Number(savedOnlyMarker[2]) - Number(savedOnlyFirstEpochLossPoint[1])) < .01);
assert(svg.includes('data-training-candidate-epoch="1"'));
assert(svg.includes('r="7"'));
assert(svg.includes('r="14"'));
assert(svg.includes('data-training-candidate-line="showRawStep"'));
assert(!svg.includes('data-training-candidate-line="showRawStep" checked'));
assert(svg.includes('training-candidates-marker training-candidates-epoch-marker in-test-folder'));
assert(svg.includes('Test Generations · 1'));
assert(svg.includes('data-training-candidates-open-generations'));
assert(svg.includes('Remove from Test'));
context.trainingCandidatesDisplayState().showRawStep=false;
context.trainingCandidatesDisplayState().showEpochLoss=false;
const filteredSvg=context.trainingCandidatesSvg(data);
assert(!filteredSvg.includes('<polyline class="training-candidates-step-loss"'));
assert(!filteredSvg.includes('<polyline class="training-candidates-raw"'));
assert(filteredSvg.includes('<polyline class="training-candidates-step-loss-smoothed"'));
assert(filteredSvg.includes('class="training-candidates-marker training-candidates-epoch-marker in-test-folder"'));
const mapped = context.trainingCandidatesEpochPlotPoint(1,{stepPoints:data.stepLossPoints,points:data.epochLossPoints});
assert.equal(mapped.step,190);
assert.equal(mapped.loss,.4);
assert.equal(context.trainingCandidatesStepPointForEpoch(1,{stepPoints:data.stepLossPoints,points:data.epochLossPoints}).step,190);
assert.deepEqual(context.trainingCandidatesYAxisTicks(.16,.30),[.16,.18,.2,.22,.24,.26,.28,.3]);
const robustRange = context.trainingCandidatesRobustLossRange(Array.from({length:100},(_,index) => index === 99 ? 1000 : index));
assert.equal(robustRange.min,1);
assert.equal(robustRange.max,98);
const autoRange = context.trainingCandidatesAutoLossRange({
  epochLossPoints:[{epoch:1,loss:.10},{epoch:2,loss:.42}],
  stepLossPoints:Array.from({length:100},(_,index)=>({step:index,epoch:1,loss:index===99?10:.20 + index*.0001})),
  analysisPoints:[]
},{showRawStep:false,showSmoothedStep:true,showEpochLoss:true},Array.from({length:100},(_,index)=>({step:index,epoch:1,loss:.20 + index*.0001})));
assert(autoRange.min <= .10);
assert(autoRange.max >= .42);
const tooltipData = {points:data.epochLossPoints,analysis:data.analysisPoints,smoothedStepPoints:[],savedArtifacts:[],regions:data.regions,candidates:data.candidates};
assert(context.trainingCandidatesTooltipHtml({step:190,epoch:1,loss:.2},tooltipData).includes('Robust loss: 0.2000'));
  assert(!context.trainingCandidatesTooltipHtml({step:150,epoch:1,loss:.2},tooltipData).includes('Candidate region:'));
  const savedData = Object.assign({}, tooltipData, {savedArtifacts:[{epoch:1,status:'available',fileName:'adapter.safetensors',inTestFolder:true}], testFolderStatus:{state:'available'}});
  assert(context.trainingCandidatesPinnedActionsHtml(1,savedData).includes('Remove from Test'));
  assert(context.trainingCandidatesPinnedActionsHtml(1,savedData).includes('data-training-candidate-test-action="remove"'));
  assert(!context.trainingCandidatesPinnedActionsHtml(1,savedData).includes('disabled'));
  const uncopiedData = Object.assign({}, savedData, {savedArtifacts:[{epoch:1,status:'available',fileName:'adapter.safetensors',inTestFolder:false}]});
  assert(context.trainingCandidatesPinnedActionsHtml(1,uncopiedData).includes('Copy to Test'));
  assert(context.trainingCandidatesPinnedActionsHtml(1,uncopiedData).includes('data-training-candidate-test-action="copy"'));
  const unavailableData = Object.assign({}, savedData, {testFolderStatus:{state:'unknown',error:'Test root is unavailable'}});
  assert(context.trainingCandidatesPinnedDetailsHtml({step:190,epoch:1,loss:.2},unavailableData).includes('Test folder unavailable: Test root is unavailable'));
  assert(context.trainingCandidatesPinnedDetailsHtml({step:190,epoch:1,loss:.2},savedData).includes('Epoch 1 · Step 190'));
  assert(context.trainingCandidatesPinnedDetailsHtml({step:190,epoch:1,loss:.2},savedData).includes('Saved'));
  assert(context.trainingCandidatesPinnedActionsHtml(1,savedData).includes('Open Epoch Folder'));
  assert(!context.trainingCandidatesPinnedActionsHtml(1,savedData).includes('Open Test Folder'));
  assert(context.trainingCandidatesPinnedActionsHtml(2,savedData)==='');
  assert(context.trainingCandidatesTestGenerationsButtonHtml(savedData).includes('Test Generations · 1'));
  assert(!context.trainingCandidatesTestGenerationsButtonHtml(savedData).includes(' disabled'));
  assert(context.trainingCandidatesTestGenerationsButtonHtml(uncopiedData).includes(' disabled'));
(async () => {
    for (const algorithm of ['v5','v3']) {
    elements['training-candidates-algorithm'].value=algorithm;
    elements['training-candidates-algorithm'].onchange();
    await new Promise(setImmediate);
    assert(requests[requests.length-1].endsWith('&algorithm='+algorithm));
      assert(requests[requests.length-1].includes('folder=set&jobId=job'));
    }
    assert.equal(context.trainingCandidatesDisplayState().showRawStep,false);
    assert.equal(context.trainingCandidatesDisplayState().showEpochLoss,false);
    assert.equal(context.trainingCandidatesDisplayState().showSmoothedStep,true);
  context.trainingRunnerRequest=() => Promise.reject(new Error('visible failure'));
  await assert.rejects(context.refreshTrainingCandidates(),/visible failure/);
  assert.equal(context.trainingWorkspaceState.candidatePayload,null);
  assert(elements['training-candidates-modal-content'].innerHTML.includes('visible failure'));
})().catch(err => {console.error(err);process.exitCode=1;});
"""
    result = subprocess.run(
        ["node", "-e", harness, str(ROOT / "tool" / "js" / "training_candidates.js")],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_candidate_analysis_remains_a_true_modal_artifact_view():
    html = (ROOT / "tool" / "tool.html").read_text(encoding="utf-8")
    script = (ROOT / "tool" / "js" / "training_candidates.js").read_text(encoding="utf-8")

    assert 'role="dialog" aria-modal="true"' in html
    assert "toggleTrainingCandidatesFullscreen" in script
    assert "els.modal.onclick = function (event) { if (event.target === els.modal) closeTrainingCandidates(); };" in script
    assert "candidateModalOpen = true" in script
    assert "candidateModalOpen = false" in script
