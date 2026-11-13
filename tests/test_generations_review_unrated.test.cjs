const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tool/js/test_generations.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const navigation = source.slice(
  source.indexOf('  function reviewResults(status) {'),
  source.indexOf('  function renderReview(status) {')
);
assert.ok(navigation.includes('function advanceReviewToUnrated()'), 'Focused Review navigation exists');

function harness(results, dimension = 'overall', key = '') {
  const scope = {
    currentStatus: {session: 'session-1', results},
    reviewDimensionId: dimension,
    reviewDimensions: [{id:'color',label:'Toothbrush Color'}, {id:'motion',label:'Brushing Motion'}],
    reviewKey: key, reviewIndex: 0, reviewHistory: [], reviewRevisiting: false, reviewBrowseCompleted: false,
    rendered: 0,
    resultMediaFile: result => result.mediaFile,
    el: () => ({focus() {}}),
    renderReview() { this.rendered++; }
  };
  vm.createContext(scope);
  vm.runInContext(navigation, scope);
  return scope;
}

test('Review queues only pending previews for the active dimension', () => {
  const results = [
    {mediaFile:'a.mp4',rating:5,dimensionRatings:{color:2}},
    {mediaFile:'b.mp4',rating:3,dimensionRatings:{}},
    {mediaFile:'c.mp4',rating:0,dimensionRatings:{color:5}}
  ];
  const h = harness(results);
  assert.deepEqual(Array.from(h.reviewPendingResults(h.currentStatus), x=>x.mediaFile), ['c.mp4']);
  h.reviewDimensionId = 'color';
  assert.deepEqual(Array.from(h.reviewPendingResults(h.currentStatus), x=>x.mediaFile), ['b.mp4']);
  h.reviewDimensionId = 'motion';
  assert.deepEqual(Array.from(h.reviewPendingResults(h.currentStatus), x=>x.mediaFile), ['a.mp4','b.mp4','c.mp4']);
});

test('Save advancement removes completed items rather than falling back to already rated results', () => {
  const results = [
    {mediaFile:'a.mp4',rating:0},
    {mediaFile:'b.mp4',rating:5},
    {mediaFile:'c.mp4',rating:0}
  ];
  const h = harness(results, 'overall', 'a.mp4');
  results[0].rating = 4;
  h.advanceReviewToUnrated();
  assert.equal(h.reviewKey, 'c.mp4');
  assert.deepEqual(Array.from(h.reviewHistory), ['a.mp4']);
  results[2].rating = 2;
  h.advanceReviewToUnrated();
  assert.equal(h.reviewKey, '', 'completed queue has no current rated result');
  assert.equal(h.reviewNextUnratedIndex(results, -1), -1);
});

test('Back revisits the last rated item; forward goes to pending work', () => {
  const results = [
    {mediaFile:'a.mp4',rating:5},
    {mediaFile:'b.mp4',rating:4},
    {mediaFile:'c.mp4',rating:0}
  ];
  const h = harness(results, 'overall', 'c.mp4');
  h.reviewHistory.push('a.mp4');
  h.moveReview(-1);
  assert.equal(h.reviewKey, 'a.mp4');
  assert.equal(h.reviewRevisiting, true);
  h.moveReview(1);
  assert.equal(h.reviewKey, 'c.mp4');
  assert.equal(h.reviewRevisiting, false);
});

test('Review is a modal activity, and the saved rating is applied before auto-advance', () => {
  const review = html.split('id="test-generations-review"')[1].split('</dialog>')[0];
  assert.ok(html.includes('id="test-generations-view-review-btn" type="button" class="test-generations-review-open"'));
  assert.ok(html.includes('<dialog id="test-generations-review"'));
  assert.ok(review.includes('id="test-generations-review-dimension"'));
  assert.ok(review.includes('id="test-generations-review-new-scope"'));
  assert.ok(review.includes('id="test-generations-review-completed"'));
  assert.ok(source.includes("reviewBrowseCompleted = !reviewBrowseCompleted;"));
  assert.ok(source.includes('dialog.showModal();'));
  assert.ok(source.includes("var reviewCatalogPending = false;"));
  assert.ok(source.includes("reviewCatalogPending = true;"));
  assert.ok(!source.includes("resultsView === 'review'"), 'review must remain separate from result tabs');
  assert.ok(source.includes("removeNode: inReview ? null : buildResultRemoveButton(result)"));
  assert.ok(html.includes('id="test-generations-review-title"'));
  assert.ok(source.includes("el('test-generations-review-title').textContent = reviewDimensionLabel();"));
  assert.ok(source.includes("el('test-generations-review').addEventListener('close'"));
  assert.ok(source.includes("el('test-generations-view-review-btn').onclick = openFocusedReview;"));
  const update = source.indexOf('result.dimensionRatings[dimensionId] = payload.rating;');
  const callback = source.indexOf('if (onSaved) onSaved();');
  assert.ok(update >= 0 && callback > update, 'persisted dimension must update before navigation');
  assert.ok(source.includes('advanceReviewToUnrated();'));
  assert.ok(source.includes("savedDimension = reviewDimensionId;"));
});

test('Completed ratings are revisitable only after explicitly entering that mode', () => {
  const h = harness([
    {mediaFile:'a.mp4',rating:3},
    {mediaFile:'b.mp4',rating:5},
    {mediaFile:'c.mp4',rating:0}
  ], 'overall', 'a.mp4');
  h.reviewBrowseCompleted = true;
  h.moveReview(1);
  assert.equal(h.reviewKey, 'b.mp4');
  h.moveReview(1);
  assert.equal(h.reviewKey, 'b.mp4', 'completed browsing does not wrap unexpectedly');
  h.reviewBrowseCompleted = false;
  h.moveReview(1);
  assert.equal(h.reviewKey, 'c.mp4', 'returning to pending ignores already rated results');
});

test('Rapid rating unlocks on save without waiting for earlier summary refresh', async () => {
  const pending = [], callbacks = [];
  const star = {dataset: {testRating: '4'}};
  const card = {querySelector: () => star};
  const ctx = {
    reviewRatingPending: false, reviewSaveSerial: 0,
    reviewKey: 'a.mp4', reviewDimensionId: 'motion',
    currentStatus: {session: 'session-1'}, advanced: 0, rendered: 0,
    el: () => ({querySelector: () => card}),
    rateTestResult: (_star, saved) => {
      callbacks.push(saved);
      return new Promise(resolve => pending.push(resolve));
    },
    reviewDialogOpen: () => true,
    advanceReviewToUnrated: () => { ctx.advanced++; ctx.reviewKey = 'next-' + ctx.advanced; },
    renderReview: () => { ctx.rendered++; }
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(
    source.indexOf('  function rateCurrentReview(value) {'),
    source.indexOf('  function openFocusedReview()')
  ), ctx);
  ctx.rateCurrentReview(4);
  assert.equal(ctx.reviewRatingPending, true);
  callbacks[0]();
  assert.equal(ctx.reviewRatingPending, false, 'persisted rating releases keyboard immediately');
  assert.equal(ctx.advanced, 1);
  ctx.rateCurrentReview(3);
  assert.equal(ctx.reviewRatingPending, true);
  pending[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ctx.reviewRatingPending, true, 'earlier summary cannot unlock a new save');
  callbacks[1]();
  assert.equal(ctx.reviewRatingPending, false);
  assert.equal(ctx.advanced, 2);
  pending[1]();
  await new Promise(resolve => setImmediate(resolve));
});
