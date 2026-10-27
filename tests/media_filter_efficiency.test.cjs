'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/media.js', 'utf8');
const start = source.indexOf('function parseMediaFilterQuery(');
const end = source.indexOf('function isMediaItemInCurrentFilteredList(', start);
assert.ok(start >= 0 && end > start, 'Media filters remain in media.js');

function fixture() {
  const items = [
    {key: 'a', label: 'Red scarf', fileName: 'a.jpg', caption: 'red scarf is hanging', hasCaption: true, metadata: {aspect: '1:1'}},
    {key: 'b', label: 'Profile', fileName: 'b_fox.png', caption: '', hasCaption: false, metadata: {aspect: '2:3'}},
    {key: 'c', label: 'Closeup', fileName: 'redfox.jpg', caption: 'green hat', hasCaption: true, metadata: {aspect: '2:1'}},
    {key: 'd', label: 'Flower portrait', fileName: 'd.png', caption: 'a blue top', hasCaption: true, metadata: {}}
  ];
  const tags = {a: ['red scarf'], b: [], c: ['portrait'], d: ['flower']};
  const assignments = {c: [{requirement: 'Clothing', term: 'halter top'}]};
  const ratings = {a: 5, b: 0, c: 3, d: 2};
  const stats = {tags: 0, ai: 0, incomplete: 0, mismatch: 0};
  let stars = {values: [], includeNoStar: false};
  let flags = [];
  const ui = {
    filterEl: {value: ''},
    advancedFilterMissingCaptionsEl: {checked: false},
    advancedFilterReviewedEl: {checked: false},
    advancedFilterUnreviewedEl: {checked: false},
    advancedFilterNeedsAiValidationEl: {checked: false},
    advancedFilterIncompleteEl: {checked: false},
    advancedFilterUntaggedEl: {checked: false},
    advancedFilterInvalidArEl: {checked: false}
  };
  const state = {
    items, reviewedSet: new Set(['a', 'd']), flags: {a: 'red', c: 'blue', d: 'orange'},
    focusSet: {keys: [], source: ''}
  };
  const ctx = {
    ui, state,
    getTagsForMediaKey: key => { stats.tags++; return tags[key] || []; },
    getChecklistAssignmentEntriesForMediaKey: key => assignments[key] || [],
    getAdvancedStarFilterState: () => stars,
    getAdvancedFlagFilterValues: () => flags,
    getRatingForMediaKey: key => ratings[key] || 0,
    computeRequirementProgressForMediaKey: key => {
      stats.incomplete++;
      return {total: 1, completed: key === 'b' || key === 'd' ? 0 : 1};
    },
    isAiValidatedForItem: item => { stats.ai++; return item.key === 'a' || item.key === 'c'; },
    hasTagMismatchForText: key => { stats.mismatch++; return key === 'b' || key === 'c'; },
    hasSupportedAspectBucket: ar => ar !== '2:1'
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return {
    ctx, ui, state, items, tags, stats,
    setStars: value => { stars = value; },
    setFlags: value => { flags = value; },
    keys: (ignoreFocusSet = false) => Array.from(ctx.getFilteredMediaItems(ignoreFocusSet), x => x.key)
  };
}

test('captionless, review state, stars, flags, incomplete, AI, mismatch, and invalid aspect filters retain results', () => {
  const cases = [
    ['advancedFilterMissingCaptionsEl', ['b']],
    ['advancedFilterReviewedEl', ['a', 'd']],
    ['advancedFilterUnreviewedEl', ['b', 'c']],
    ['advancedFilterIncompleteEl', ['b', 'd']],
    ['advancedFilterNeedsAiValidationEl', ['b', 'd']],
    ['advancedFilterUntaggedEl', ['b', 'c']],
    ['advancedFilterInvalidArEl', ['c']]
  ];
  for (const [field, expected] of cases) {
    const f = fixture();
    f.ui[field].checked = true;
    assert.deepEqual(f.keys(), expected, field);
  }
  let f = fixture();
  f.setStars({values: [3], includeNoStar: false});
  assert.deepEqual(f.keys(), ['c'], '3-star filter');
  f.setStars({values: [], includeNoStar: true});
  assert.deepEqual(f.keys(), ['b'], 'unrated filter');
  f = fixture();
  f.setFlags(['blue']);
  assert.deepEqual(f.keys(), ['c'], 'blue flag');
  f.setFlags(['no_flag']);
  assert.deepEqual(f.keys(), ['b'], 'no flag');
});

test('search preserves caption, filename, tag, scoped-term, negative, boundary and AND semantics', () => {
  const f = fixture();
  const cases = [
    ['green hat', ['c']],
    ['fox', ['b']],                          // Not inside "redfox"
    ['portrait', ['c', 'd']],                // Tag on c, label on d
    ['green hat,portrait', ['c']],          // Caption + tag
    ['@clothing:halter top', ['c']],        // Scoped assignment, not tag text
    ['-@clothing:halter top,portrait', ['d']],
    ['-green hat,portrait', ['d']],
    ['blue top,portrait', ['d']],
    ['red scarf,-flower', ['a']],
    ['red scarf,red scarf', ['a']],
    ['NOTHING', []]
  ];
  for (const [query, expected] of cases) {
    f.ui.filterEl.value = query;
    assert.deepEqual(f.keys(), expected, query);
  }
  const any = f.ctx.mediaItemMatchesFilterQuery(
    f.items[2], f.ctx.parseMediaFilterQuery('flower, green hat'), 'any'
  );
  assert.equal(any, true, 'direct matcher retains OR mode');
  f.ui.filterEl.value = '';
  f.state.focusSet.keys = ['a', 'c'];
  assert.deepEqual(f.keys(), ['a', 'c'], 'focus set');
  assert.deepEqual(f.keys(true), ['a', 'b', 'c', 'd'], 'ignore focus set');
});

test('matching filename/caption or excluded negative term never requests tag expansion', () => {
  const f = fixture();
  const c = f.items[2];
  f.stats.tags = 0;
  assert.equal(f.ctx.mediaItemMatchesFilterQuery(c, f.ctx.parseMediaFilterQuery('green hat'), 'all'), true);
  assert.equal(f.stats.tags, 0);
  assert.equal(f.ctx.mediaItemMatchesFilterQuery(c, f.ctx.parseMediaFilterQuery('-green hat'), 'all'), false);
  assert.equal(f.stats.tags, 0);
  assert.equal(f.ctx.mediaItemMatchesFilterQuery(c, f.ctx.parseMediaFilterQuery('@clothing:halter top'), 'all'), true);
  assert.equal(f.stats.tags, 0, 'scoped tags do not require expanded flat list');
  assert.equal(f.ctx.mediaItemMatchesFilterQuery(c, f.ctx.parseMediaFilterQuery('portrait,green hat,-absent'), 'all'), true);
  assert.equal(f.stats.tags, 1, 'multiple tag-dependent terms reuse one expansion');
});

test('combined cheap filters prune candidates before text, AI and Tag Mismatch work', () => {
  const f = fixture();
  f.ui.filterEl.value = 'never present';
  f.ui.advancedFilterMissingCaptionsEl.checked = true;
  f.setFlags(['blue']);
  f.ui.advancedFilterNeedsAiValidationEl.checked = true;
  f.ui.advancedFilterUntaggedEl.checked = true;
  assert.deepEqual(f.keys(), [], 'AND of incompatible filters');
  assert.equal(f.stats.tags, 0, 'text tag expansion never runs for already-excluded items');
  assert.equal(f.stats.ai, 0, 'AI fingerprint checks never run for already-excluded items');
  assert.equal(f.stats.mismatch, 0, 'Tag Mismatch never runs for already-excluded items');

  f.setFlags([]);
  f.ui.advancedFilterMissingCaptionsEl.checked = false;
  f.ui.filterEl.value = 'green hat';
  assert.deepEqual(f.keys(), [], 'AI-validated item is correctly excluded by Needs AI Validation');
  assert.equal(f.stats.ai, 1, 'AI check only for text match');
  assert.equal(f.stats.mismatch, 0, 'Tag Mismatch is skipped when AI filter rejects item');
  f.ui.advancedFilterNeedsAiValidationEl.checked = false;
  assert.deepEqual(f.keys(), ['c'], 'removing AI filter preserves the text and mismatch match');
  assert.equal(f.stats.mismatch, 1, 'Tag Mismatch checks only the final candidate');
});
