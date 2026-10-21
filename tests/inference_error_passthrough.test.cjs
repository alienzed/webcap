const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');

const source = fs.readFileSync('tool/js/inference_queue.js', 'utf8');
const begin = source.indexOf('  function reportExecutionFailure(queue) {');
const end = source.indexOf('  function renderToggle(jobs) {', begin);
assert.ok(begin > 0 && end > begin, 'Production inference queue error passthrough exists');

function makeReporter() {
  const reported = [];
  const sandbox = {
    state: {reportedExecutionFailure: ''},
    window: {reportConsoleError(source, error) {reported.push({source, message: error.message});}}
  };
  vm.runInNewContext(source.slice(begin, end) + '\nthis.report = reportExecutionFailure;', sandbox);
  return {check: sandbox.report, reported, state: sandbox.state};
}

test('ComfyUI execution error passes through unmodified and exactly once while paused', () => {
  const reporter = makeReporter();
  const detail = 'Inference paused after an execution error: ComfyUI request failed (HTTP 400): ' +
    '{"error":{"type":"prompt_outputs_failed_validation"},"node_errors":{"42":{"errors":[{"message":"Missing model checkpoint.safetensors"}]}}}';
  const queue = {paused: true, pauseReason: detail};
  reporter.check(queue);
  reporter.check(queue);
  assert.equal(reporter.reported.length, 1);
  assert.equal(reporter.reported[0].source, 'Inference Queue · ComfyUI');
  assert.equal(reporter.reported[0].message, detail);
});

test('manual pause and ordinary scheduling waits are not logged as failures', () => {
  const reporter = makeReporter();
  reporter.check({paused: true, pauseReason: 'Queue paused by the user.'});
  reporter.check({paused: false, waitReason: 'Waiting for GPU'});
  reporter.check({paused: true, pauseReason: ''});
  assert.equal(reporter.reported.length, 0);
});

test('new error is logged, and resuming re-arms reporting for subsequent failures', () => {
  const reporter = makeReporter();
  const first = 'Inference paused after an execution error: missing node';
  const second = 'Inference paused after an execution error: missing checkpoint';
  reporter.check({paused: true, pauseReason: first});
  reporter.check({paused: true, pauseReason: second});
  reporter.check({paused: false});
  reporter.check({paused: true, pauseReason: second});
  assert.deepEqual(reporter.reported.map(x => x.message), [first, second, second]);
});

test('queue visibly displays original pause reason and exposes it on the toggle tooltip', () => {
  assert.match(source, /summary\.textContent = state\.queue\.paused/);
  assert.match(source, /summary\.classList\.toggle\('inference-queue-failure'/);
  assert.match(source, /title \+= '\\n' \+ state\.queue\.pauseReason/);
  assert.match(source, /reportExecutionFailure\(state\.queue\)/);
});

test('failure panel formats first line while retaining complete technical traceback', () => {
  const begin = source.indexOf('  function formatExecutionFailure(reason) {');
  const end = source.indexOf('  function renderFailureDetails() {', begin);
  assert.ok(begin > 0 && end > begin);
  const sandbox = {};
  vm.runInNewContext(source.slice(begin, end) + '\nthis.format = formatExecutionFailure;', sandbox);
  const detail = "Inference paused after an execution error: ModuleNotFoundError: No module named 'triton' (128 / PatchSageAttention)\n\nTraceback:\n  import triton";
  const result = sandbox.format(detail);
  assert.equal(result.summary, "ModuleNotFoundError: No module named 'triton' (128 / PatchSageAttention)");
  assert.equal(result.full, detail);
  assert.match(result.detail, /import triton/);
});

test('queue error panel is wired without replacing existing scheduling or refresh', () => {
  assert.match(source, /renderFailureDetails\(\);/);
  assert.match(source, /navigator\.clipboard\.writeText\(failure\.full\)/);
  assert.match(source, /toggle\.classList\.toggle\('inference-has-error'/);
});
