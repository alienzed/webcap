var trainingWorkspaceState = {
  manifest: null,
  trainingPlan: null,
  trainingPlanFolder: '',
  configFiles: [],
  profiles: [],
  selectedProfileId: 'wan22_t2v',
  runnerJobs: [],
  runnerActiveJobId: '',
  runnerSelectedJobId: '',
  runnerLogOffsets: {},
  runnerConsoleJobId: '',
  runnerConsoleRequestVersion: 0,
  runnerConsoleLogRequestVersion: 0,
  runnerConsoleFollowsActiveJob: false,
  runnerPollTimer: 0,
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
  gpuForActiveJob: false,
  history: null,
  historyLoaded: false,
  historyLoadPromise: null,
  historySearchScopeFolder: '',
  resumeSelectionTouched: false,
  historyExpanded: false,
  historyCollapsed: true,
  runnerQueueCollapsed: false,
  itemOverviewHidden: false
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
    generateBtn: document.getElementById('training-workspace-generate-btn'),
    queueJobBtn: document.getElementById('training-queue-job-btn'),
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
