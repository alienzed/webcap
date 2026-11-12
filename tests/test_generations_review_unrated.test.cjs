const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'test_generations.js'), 'utf8');
const navigation = source.slice(
  source.indexOf('  function reviewResults(status) {'),
  source.indexOf('  function renderReview(status) {')
);
assert.ok(navigation.includes('function advanceReviewToUnrated()'), 'Review navigation functions are missing');

function makeNavigation(results, startIndex) {
  const state = {
    currentStatus: {results},
    reviewIndex: startIndex,
    reviewKey: results[startIndex] ? results[startIndex].mediaFile : '',
    rendered: 0,
    resultMediaFile: result => result.mediaFile,
    renderReview() { state.rendered++; }
  };
  vm.createContext(state);
  vm.runInContext(navigation, state);
  return state;
}

test('first review target is the first unrated render, with all-rated fallback', () => {
  const state = makeNavigation([
    {mediaFile: 'a.mp4', rating: 5},
    {mediaFile: 'b.mp4', rating: 3},
    {mediaFile: 'c.mp4', rating: 0},
    {mediaFile: 'd.mp4', rating: null}
  ], 0);
  assert.equal(state.reviewNextUnratedIndex(state.reviewResults(state.currentStatus), -1), 2);
  assert.equal(state.reviewNextUnratedIndex([
    {rating: 2}, {rating: 4}, {rating: 5}
  ], -1), -1);
  assert.match(source, /firstUnrated = reviewNextUnratedIndex\(results, -1\)/);
});

test('rating advances only to unrated items and wraps around', () => {
  const results = [
    {mediaFile: 'a.mp4', rating: 0},
    {mediaFile: 'b.mp4', rating: 5},
    {mediaFile: 'c.mp4', rating: null},
    {mediaFile: 'd.mp4', rating: 4}
  ];
  const state = makeNavigation(results, 0);
  results[0].rating = 3;
  state.advanceReviewToUnrated();
  assert.equal(state.reviewIndex, 2);
  assert.equal(state.reviewKey, 'c.mp4');
  results[2].rating = 2;
  results[0].rating = 0;
  state.advanceReviewToUnrated();
  assert.equal(state.reviewIndex, 0, 'advances through the end back to the first unrated');
  results[0].rating = 3;
  state.advanceReviewToUnrated();
  assert.equal(state.reviewIndex, 0, 'stays on current render when all are rated');
});

test('manual arrow navigation still visits rated renders', () => {
  const results = [
    {mediaFile: 'a.mp4', rating: 0},
    {mediaFile: 'b.mp4', rating: 5},
    {mediaFile: 'c.mp4', rating: 0}
  ];
  const state = makeNavigation(results, 0);
  state.moveReview(1);
  assert.equal(state.reviewIndex, 1);
  assert.equal(state.reviewKey, 'b.mp4');
  state.moveReview(1);
  assert.equal(state.reviewIndex, 2);
  state.moveReview(-1);
  assert.equal(state.reviewIndex, 1);
});

test('re-entering Review resets its cursor and rating is updated before automatic navigation', () => {
  assert.match(source, /if \(resultsView === 'review' && previousView !== 'review'\) \{\s*reviewIndex = 0;\s*reviewKey = '';/);
  assert.match(source, /if \(onSaved\) onSaved\(\);/);
  const rated = source.indexOf('if (resultMediaFile(result) === mediaFile) result.rating = payload.rating;');
  const callback = source.indexOf('if (onSaved) onSaved();');
  assert.ok(rated > -1 && callback > rated, 'saved rating must be reflected before selecting next unrated');
  assert.match(source, /advanceReviewToUnrated\(\);/);
  const warmReturn = source.split('if (warmReturn) {', 2)[1].split('return;\n    }', 1)[0];
  assert.match(warmReturn, /if \(resultsView === 'review'\) \{\s*reviewIndex = 0;\s*reviewKey = '';/);
  assert.match(warmReturn, /if \(resultsView === 'review'\) renderReview\(currentStatus\);/);
});
