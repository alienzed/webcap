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
    reviewKey: key, reviewIndex: 0, reviewHistory: [], reviewRevisiting: false,
    rendered: 0,
    resultMediaFile: result => result.mediaFile,
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
  assert.ok(source.includes('review.showModal();'));
  assert.ok(source.includes("el('test-generations-review').addEventListener('close'"));
  const update = source.indexOf('result.dimensionRatings[dimensionId] = payload.rating;');
  const callback = source.indexOf('if (onSaved) onSaved();');
  assert.ok(update >= 0 && callback > update, 'persisted dimension must update before navigation');
  assert.ok(source.includes('advanceReviewToUnrated();'));
  assert.ok(source.includes("savedDimension = reviewDimensionId;"));
});
