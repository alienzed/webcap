var trainingWorkspaceState = {
  configFiles: [],
  profiles: [],
  selectedProfileId: 'wan22_t2v',
  selectedMode: 'normal',
  runnerJobs: [],
  runnerActiveJobId: '',
  runnerSelectedJobId: '',
  runnerLogOffsets: {},
  runnerConsoleJobId: '',
  runnerConsoleRequestVersion: 0,
  runnerConsoleLogRequestVersion: 0,
  runnerConsoleFollowsActiveJob: false,
  runnerPollTimer: 0,
  tensorboardPollTimer: 0,
  runnerStatusPending: false,
  runnerStatusError: '',
  runnerRecoveryAvailable: false,
  runnerPreflight: null,
  runStages: 'both',
  resumeParentJobId: '',
  runnerQueuePaused: false,
  runnerQueuePauseReason: '',
  runnerNotice: '',
  entryMode: 'global',
  gpu: null,
  gpuStatusPending: false,
  tensorboard: null,
  tensorboardStatusPending: false,
  tensorboardLastFetchedAt: 0,
  gpuForActiveJob: false,
  history: null,
  historyLoaded: false,
  historyLoadPromise: null,
  historySearchScopeFolder: '',
  resumeSelectionTouched: false,
  historyExpanded: false,
  historyCollapsed: true,
  historyDetailOpen: {},
  historyMetrics: {},
  historyMetricRequests: {},
  runnerQueueCollapsed: false,
  itemOverviewHidden: false,
  detailTab: 'items',
  review: null,
  reviewPending: false,
  reviewStartingPoint: 'fresh',
  reviewInitializerStage: '',
  reviewInitializers: [],
  reviewInitializerExportId: '',
  reviewForceConstantLr: '',
  reviewSaveQueue: null,
  reviewSavePending: 0,
  reviewSaveStatus: 'saved'
};
var utilityTrainingTurtleTimer = 0;
var utilityTrainingTurtleAtLeft = true;

function isTrainingWorkspaceActive() {
  return normalizeWorkspaceSurface(workspaceState.surface) === 'training';
}

function setTrainingWorkspaceEntryMode(mode) {
  trainingWorkspaceState.entryMode = mode === 'set' ? 'set' : 'global';
}

function getTrainingWorkspaceEls() {
  return {
    navigator: document.getElementById('training-navigator'),
    navigatorTitle: document.getElementById('training-navigator-title'),
    folder: document.getElementById('training-navigator-folder'),
    globalContext: document.getElementById('training-global-context'),
    setWorkflow: document.getElementById('training-set-workflow'),
    runSetup: document.getElementById('training-run-setup'),
    readiness: document.getElementById('training-readiness'),
    configList: document.getElementById('training-workspace-config-list'),
    modelProfileSelect: document.getElementById('training-model-profile-select'),
    modelTrainedStatus: document.getElementById('training-model-trained-status'),
    profileSelect: document.getElementById('training-workspace-profile-select'),
    configStepNumber: document.getElementById('training-workspace-config-step-number'),
    runStepNumber: document.getElementById('training-run-step-number'),
    queueJobBtn: document.getElementById('training-queue-job-btn'),
    review: document.getElementById('training-review'),
    commandStatus: document.getElementById('training-command-status'),
    commandText: document.getElementById('training-command-text'),
    copyCommandBtn: document.getElementById('training-copy-command-btn'),
    itemOverview: document.getElementById('training-item-overview'),
    itemOverviewSummary: document.getElementById('training-item-overview-summary'),
    itemOverviewToggleBtn: document.getElementById('training-item-overview-toggle-btn'),
    runnerSummary: document.getElementById('training-runner-summary'),
    runnerQueue: document.getElementById('training-runner-queue'),
    runnerActions: document.getElementById('training-runner-actions'),
    runnerFinishBtn: document.getElementById('training-runner-finish-btn'),
    runnerPauseBtn: document.getElementById('training-runner-pause-btn'),
    runnerCancelBtn: document.getElementById('training-runner-cancel-btn'),
    runnerResumeQueueBtn: document.getElementById('training-runner-resume-queue-btn'),
    runnerConsoleBtn: document.getElementById('training-runner-console-btn'),
    runnerConsole: document.getElementById('training-runner-console'),
    runnerConsoleTitle: document.getElementById('training-runner-console-title'),
    runnerConsoleLog: document.getElementById('training-runner-console-log'),
    runnerConsoleRevealBtn: document.getElementById('training-runner-console-reveal-btn'),
    runnerConsoleCloseBtn: document.getElementById('training-runner-console-close-btn'),
    runnerPreflight: document.getElementById('training-runner-preflight'),
    gpuStatus: document.getElementById('training-gpu-status'),
    tensorboardStatus: document.getElementById('training-tensorboard-status'),
    historySummary: document.getElementById('training-history-summary'),
    historyList: document.getElementById('training-history-list'),
    historyContent: document.getElementById('training-history-content'),
    historyCollapseBtn: document.getElementById('training-history-collapse-btn'),
    historyTools: document.getElementById('training-history-tools'),
    historyShowAllBtn: document.getElementById('training-history-show-all-btn'),
    historySearch: document.getElementById('training-history-search'),
    historyClearBtn: document.getElementById('training-history-clear-btn'),
    checkpointSelect: document.getElementById('training-run-checkpoint-select')
  };
}

function getTrainingDetailTab() {
  return ['items', 'config', 'run-log'].indexOf(trainingWorkspaceState.detailTab) !== -1
    ? trainingWorkspaceState.detailTab
    : 'items';
}

function setTrainingDetailTab(tab, options) {
  var value = ['items', 'config', 'run-log'].indexOf(tab) !== -1 ? tab : 'items';
  var previous = getTrainingDetailTab();
  trainingWorkspaceState.detailTab = value;
  if (previous === 'run-log' && value !== 'run-log' && !(options && options.keepLogVisible)) {
    var els = getTrainingWorkspaceEls();
    if (els.runnerConsole) els.runnerConsole.classList.add('hidden');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-training-detail-tab]'), function (button) {
    var active = button.getAttribute('data-training-detail-tab') === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  syncWorkspaceConfigEditorUi();
  syncTrainingConsoleUi();
}

function requestTrainingDetailTab(tab) {
  var target = ['items', 'config', 'run-log'].indexOf(tab) !== -1 ? tab : 'items';
  if (getTrainingDetailTab() === 'config' && target !== 'config' && state.currentConfigFile && state.currentConfigFile.folder === state.folder) {
    Promise.resolve(saveCurrentEditorContent()).then(function () {
      setTrainingDetailTab(target);
      if (target === 'run-log') openTrainingDetailLog();
    }).catch(function (err) {
      setStatus('Could not save config before changing artifacts: ' + String(err && err.message ? err.message : err));
    });
    return;
  }
  setTrainingDetailTab(target);
  if (target === 'run-log') openTrainingDetailLog();
}

function openTrainingDetailLog() {
  var job = trainingWorkspaceState.runnerConsoleJobId
    ? getTrainingRunnerJobById(trainingWorkspaceState.runnerConsoleJobId)
    : null;
  if (!job) job = getTrainingRunnerConsoleTargetJob();
  if (job) showTrainingRunnerConsole(job, { configClosed: true });
}

function trainingRunnerRequest(path, options) {
  var allowNotOk = !!(options && options.allowNotOk);
  return fetch(path, options || {}).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (payload) {
      if ((!response.ok && !allowNotOk) || (!payload.ok && !allowNotOk)) {
        throw new Error(payload.error || 'Training runner request failed.');
      }
      return payload;
    });
  });
}
