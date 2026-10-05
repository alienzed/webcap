const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function assessmentUI() {
  const errors = [];
  const ui = {
    Date,
    reportConsoleInfo() {},
    reportConsoleError(...args) { errors.push(args); },
    resetLlmExecution() { return Promise.resolve({ ok: true }); },
  };
  const source = fs.readFileSync(path.join(__dirname, '../tool/js/director_model_test.js'), 'utf8');
  vm.runInNewContext(source.replace(/initializeDirectorModelTest\(\);\s*$/, ''), ui);
  ui.directorModelTestRenderStatus = () => {};
  ui.directorModelTestConsumeJob = () => Promise.resolve();
  ui.directorModelTestPost = () => Promise.resolve({ prompt: 'Full probe prompt', job: { jobId: 'probe' } });
  ui.directorModelTestState.calibrationProtocol = {
    proseSectionCounts: { 512: 2 }, outputItemCounts: { 512: 12 },
    marker: 'WEB_CAP_CALIBRATION_COMPLETE', proseMarker: 'WEB_CAP_LONGFORM_COMPLETE',
  };
  return { ui, errors };
}

test('a finding never substitutes older evidence after its own raw run is deleted', () => {
  const { ui } = assessmentUI();
  const report = { updatedAt: 'latest' };
  const older = { id: 'older', model: { modelRef: 'ollama::qwen' }, summary: { updatedAt: 'older' } };
  const latest = { id: 'latest', model: { modelRef: 'ollama::qwen' }, summary: report };
  ui.directorModelTestState.assessmentRuns = [latest, older];
  assert.equal(ui.directorModelAssessmentLatestRun('ollama::qwen', report), latest);
  ui.directorModelTestState.assessmentRuns = [older];
  assert.equal(ui.directorModelAssessmentLatestRun('ollama::qwen', report), null);
});

test('a failed assessment request stays visibly failed when its promise finishes', async () => {
  const { ui, errors } = assessmentUI();
  const summary = { textContent: '', dataset: {} };
  ui.shellWorkloadState = { trainingActive: false };
  ui.directorModelAssessmentSelectedModels = () => [{ modelRef: 'ollama::qwen' }];
  ui.directorModelTestSyncControls = () => {};
  ui.directorModelTestEl = () => summary;
  ui.directorModelTestRefresh = () => Promise.resolve();
  ui.directorModelTestCalibrateOne = () => Promise.reject(new Error('Evidence write failed'));
  ui.directorModelTestStartCalibration();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(summary.textContent, 'Failed');
  assert.equal(summary.dataset.state, 'error');
  assert.equal(ui.directorModelTestState.running, false);
  assert.equal(errors[0][1].message, 'Evidence write failed');
});

for (const failingWrite of ['report', 'evidence']) test(`${failingWrite} persistence failure propagates without inventing a duplicate runtime probe`, async () => {
  const { ui } = assessmentUI();
  const attempts = [];
  ui.directorModelTestAdvertisedCapability = () => null;
  ui.directorModelTestStartAssessment = () => Promise.resolve({ id: 'assessment' });
  ui.directorModelTestPost = () => Promise.resolve({ calibrationProfiles: [], calibrationReports: [] });
  ui.directorModelTestRenderCalibrationProfiles = () => {};
  ui.directorModelTestState.calibrationProtocol.outputSteps = [512];
  ui.directorModelTestState.calibrationProtocol.contextSteps = [];
  ui.directorModelTestCalibrationAttempt = () => Promise.resolve({ kind: 'output', target: 512, status: 'passed' });
  ui.directorModelTestSaveCalibrationReport = (model, mode, context, max, probes) => {
    attempts.push(probes.slice());
    return failingWrite === 'report' ? Promise.reject(new Error('Evidence write failed')) : Promise.resolve({ updatedAt: 'latest' });
  };
  ui.directorModelTestUpdateAssessment = () => Promise.reject(new Error('Evidence write failed'));
  await assert.rejects(ui.directorModelTestCalibrateOne({ modelRef: 'ollama::qwen', runtimeId: 'remote' }, 1), /Evidence write failed/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].length, 1);
  assert.equal(attempts[0][0].status, 'passed');
});

async function probe(text, kind = 'output', status = 'completed', finishReason = 'stop', error = '') {
  const { ui, errors } = assessmentUI();
  ui.directorModelTestWaitForJob = () => Promise.resolve({ status, error,
    result: { text, finishReason, usage: { prompt_tokens: 92, completion_tokens: 512 } },
  });
  return { attempt: await ui.directorModelTestCalibrationAttempt({ modelRef: 'ollama::qwen' }, kind, 512), errors };
}


test('output ladder continues after non-capacity failures and stops at truncation', async () => {
  const { ui } = assessmentUI();
  ui.directorModelTestAdvertisedCapability = () => null;
  ui.directorModelTestStartAssessment = () => Promise.resolve({ id: 'assessment' });
  ui.directorModelTestRenderCalibrationProfiles = () => {};
  ui.directorModelTestUpdateAssessment = () => Promise.resolve({});
  ui.directorModelTestSaveCalibrationReport = () => Promise.resolve({ updatedAt: 'latest' });
  ui.directorModelTestState.calibrationProtocol.outputSteps = [512, 1024, 2048];
  ui.directorModelTestState.calibrationProtocol.contextSteps = [];

  const calls = [];
  ui.directorModelTestCalibrationAttempt = (_model, kind, target) => {
    calls.push([kind, target]);
    if (kind === 'output' && target === 512) {
      return Promise.resolve({ kind, target, status: 'failed', failureKind: 'contract', error: 'format miss' });
    }
    if (kind === 'output' && target === 1024) {
      return Promise.resolve({ kind, target, status: 'passed', failureKind: '' });
    }
    if (kind === 'prose' && target === 1024) {
      return Promise.resolve({ kind, target, status: 'passed', failureKind: '' });
    }
    if (kind === 'output' && target === 2048) {
      return Promise.resolve({ kind, target, status: 'failed', failureKind: 'capacity', finishReason: 'length' });
    }
    return Promise.resolve({ kind, target, status: 'failed', failureKind: 'contract' });
  };
  ui.directorModelTestPost = payload => {
    if (payload.action === 'begin_calibration') return Promise.resolve({ calibrationProfiles: [], calibrationReports: [] });
    if (payload.action === 'save_calibration_profile') return Promise.resolve({ profile: {}, calibrationProfiles: [], calibrationReports: [] });
    return Promise.resolve({});
  };

  await ui.directorModelTestCalibrateOne({
    modelRef: 'ollama::qwen',
    runtimeId: 'remote',
    runtimeName: 'Ollama',
    modelId: 'qwen',
    label: 'Qwen',
  }, 1);

  assert.deepEqual(calls, [
    ['output', 512],
    ['prose', 512],
    ['output', 1024],
    ['prose', 1024],
    ['output', 2048],
  ]);
});

test('operational failure stays operational even with pathological partial output and logs its detail', async () => {
  const { attempt, errors } = await probe('<think>partial', 'output', 'failed', '', 'Connection reset: provider detail');
  assert.equal(attempt.failureKind, 'runtime');
  assert.equal(attempt.error, 'Connection reset: provider detail');
  assert.equal(errors[0][1], attempt.error);
});

test('an exhausted budget with no answer is capacity, a clean empty completion is pathology', async () => {
  assert.equal((await probe('', 'output', 'completed', 'length')).attempt.failureKind, 'capacity');
  assert.equal((await probe('')).attempt.failureKind, 'empty');
});

test('actual leakage, garbling and looping remain output pathologies', async () => {
  for (const [text, failureKind] of [
    ['<think>exposed reasoning</think>', 'leakage'], ['\uFFFD\uFFFD\uFFFD', 'garbled'],
    [Array(3).fill('This identical long paragraph repeats all of its details without advancing the story or changing anything.').join('\n'), 'looping'],
  ]) assert.equal((await probe(text)).attempt.failureKind, failureKind);
});

test('a terminal item and marker cannot prove skipped structured output', async () => {
  const { attempt } = await probe('1. First item.\n12. Last item.\nWEB_CAP_CALIBRATION_COMPLETE');
  assert.equal(attempt.failureKind, 'contract');
});

test('completion marker omission is noted but does not invalidate otherwise complete prose', async () => {
  assert.equal((await probe('Section 1: short\nSection 2: short\nWEB_CAP_LONGFORM_COMPLETE', 'prose')).attempt.failureKind, 'contract');
  const prose = `Section 1: ${Array(80).fill('first').join(' ')}\nSection 2: ${Array(80).fill('second').join(' ')}\nWEB_CAP_LONGFORM_COMPLETE`;
  const complete = await probe(prose, 'prose');
  assert.equal(complete.attempt.status, 'passed');
  assert.equal(complete.attempt.note, '');

  const missingMarker = await probe(prose.replace('WEB_CAP_LONGFORM_COMPLETE', ''), 'prose');
  assert.equal(missingMarker.attempt.status, 'passed');
  assert.equal(missingMarker.attempt.failureKind, '');
  assert.match(missingMarker.attempt.note, /Completion marker omitted/);
});

test('completion marker omission is also only a note for structurally complete numbered output', async () => {
  const numbered = Array.from({ length: 12 }, (_, index) => `${index + 1}. item ${index + 1}`).join('\n');
  const attempt = (await probe(numbered)).attempt;
  assert.equal(attempt.status, 'passed');
  assert.match(attempt.note, /Completion marker omitted/);
});

test('stopped calibration probe is recorded as stopped rather than runtime failure', async () => {
  const { attempt, errors } = await probe('', 'output', 'stopped', '', '');
  assert.equal(attempt.status, 'stopped');
  assert.equal(attempt.failureKind, 'stopped');
  assert.equal(attempt.error, '');
  assert.equal(errors.length, 0);
});

test('assessment health labels are written for a human rather than the probe implementation', () => {
  const { ui } = assessmentUI();
  assert.equal(ui.directorModelTestHealthLabel('assessment-incomplete', 'complete'),
    'Usable range found · some checks inconclusive');
  assert.equal(ui.directorModelTestHealthLabel('limited', 'complete'), 'Usable · output limit found');
  assert.match(ui.directorModelTestHealthLabel('assessment-incomplete', 'incomplete'), /Assessment incomplete/);
});

test('probe budget and contract outcomes are readable without error styling; runtime failures remain errors', () => {
  const { ui } = assessmentUI();
  ui.escapeHtml = text => String(text);
  for (const [failureKind, label] of [['capacity', 'Hit output limit'], ['contract', 'Did not follow test format'], ['runtime', 'Runtime failed']]) {
    const html = ui.directorModelAssessmentRenderEvidence({status: 'complete', attempts: [{
      kind: 'prose', target: 1024, status: 'failed', failureKind, error: 'probe detail',
    }]});
    assert.ok(html.includes(label));
    assert.ok(html.includes('probe detail'));
    assert.equal(html.includes('director-model-finding-error'), failureKind === 'runtime');
    assert.equal(html.includes('Error: probe detail'), failureKind === 'runtime');
  }
});


test('successful probe notes are shown as notes, not failures', () => {
  const { ui } = assessmentUI();
  ui.escapeHtml = text => String(text);
  const html = ui.directorModelAssessmentRenderEvidence({status: 'complete', attempts: [{
    kind: 'prose',
    target: 512,
    status: 'passed',
    note: 'Completion marker omitted; the response otherwise completed the test.',
  }]});
  assert.ok(html.includes('Passed'));
  assert.ok(html.includes('Note: Completion marker omitted'));
  assert.equal(html.includes('director-model-finding-error'), false);
});
