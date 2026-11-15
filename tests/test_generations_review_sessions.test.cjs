const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/test_generations.js'), 'utf8');
const start = source.indexOf('  function resetReviewSessionQueue() {');
const end = source.indexOf('  function reviewDimensionLabel() {', start);
assert.ok(start > 0 && end > start);

function harness(selected, names) {
  const rows = names.map(([session, label]) => ({
    dataset: {sessionName:session},
    querySelector: () => ({textContent:label})
  }));
  const nodes = {
    'test-generations-sessions-list': {querySelectorAll: () => rows},
    'test-generations-review-position': {textContent:''},
    'test-generations-review-status': {textContent:''},
    'test-generations-review-card': {replaceChildren() {}}
  };
  let resolveRequest, rejectRequest;
  let selectedStatus, error;
  const ctx = {
    currentStatus: {session:selected}, reviewScope:null, reviewSessionQueue:[],
    reviewSessionCursor:-1, reviewSessionLoading:false, reviewSessionLoadFailed:false,
    reviewCatalogRequest:4, launchFolder:'set-a',
    el: key => nodes[key], sessionLabel: name => name,
    request: (_op, args) => new Promise((resolve, reject) => {
      ctx.requested = args.session;
      resolveRequest = resolve;
      rejectRequest = reject;
    }),
    reviewDialogOpen: () => true,
    selectSessionStatus: status => {selectedStatus = status; ctx.currentStatus = status;},
    showError: err => {error = err;}
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end),ctx);
  return {
    ctx, nodes, resolve: status => resolveRequest(status), reject: err => rejectRequest(err),
    selected: () => selectedStatus, error: () => error
  };
}

test('starts with selected session, continues once in visible order, preserving names', async () => {
  const h = harness('second', [
    ['first','First run'], ['second','Second run'], ['third','Third run']
  ]);
  h.ctx.resetReviewSessionQueue();
  assert.deepEqual(Array.from(h.ctx.reviewSessionQueue, x => x.session), ['second','third','first']);
  assert.equal(h.ctx.reviewSessionQueue[0].label, 'Second run');
  assert.equal(h.ctx.advanceReviewSession(), true);
  assert.equal(h.ctx.requested, 'third');
  assert.equal(h.ctx.reviewSessionLoading, true);
  h.resolve({session:'third',results:[]});
  await Promise.resolve();
  assert.equal(h.selected().session,'third');
  assert.equal(h.ctx.reviewSessionCursor,1);
  assert.equal(h.ctx.advanceReviewSession(),true);
  assert.equal(h.ctx.requested,'first');
  h.resolve({session:'first',results:[]});
  await Promise.resolve();
  assert.equal(h.ctx.advanceReviewSession(),false,'end of single pass');
});

test('a failed session load stays visible and does not silently skip a session', async () => {
  const h = harness('first', [['first','First'],['second','Second']]);
  h.ctx.resetReviewSessionQueue();
  h.ctx.advanceReviewSession();
  h.reject(new Error('unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ctx.reviewSessionLoadFailed,true);
  assert.match(h.nodes['test-generations-review-status'].textContent,/Could not open Second: unavailable/);
  assert.equal(h.ctx.advanceReviewSession(),false);
  assert.match(h.error().message,/unavailable/);
});

test('closing before session load returns ignores the stale response', async () => {
  const h = harness('first', [['first','First'],['second','Second']]);
  h.ctx.resetReviewSessionQueue();
  h.ctx.advanceReviewSession();
  h.ctx.reviewCatalogRequest++;
  h.resolve({session:'second',results:[]});
  await Promise.resolve();
  assert.equal(h.selected(),undefined);
});

test('existing epoch collection still uses its own collection-scoped review', () => {
  assert.ok(source.includes("window.testGenerationsOpenEpochFocusedReview = openEpochReview"));
  assert.ok(source.includes("if (reviewScope || reviewSessionLoading || reviewSessionLoadFailed) return false;"));
  assert.ok(source.includes("if (!reviewScope && !reviewBrowseCompleted && !reviewRevisiting &&"));
  assert.ok(source.includes("selectSessionStatus(status);"));
  assert.ok(source.includes("reviewSessionQueue = [];"));
});
