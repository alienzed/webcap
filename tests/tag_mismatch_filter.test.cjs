'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function extract(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, 'Expected source functions: ' + start);
  return source.slice(first, last);
}

const detail = fs.readFileSync('tool/js/item_details.js', 'utf8');
const checklist = fs.readFileSync('tool/js/checklist_state.js', 'utf8');
const media = fs.readFileSync('tool/js/media.js', 'utf8');
const gridState = fs.readFileSync('tool/js/media_grid_state.js', 'utf8');
const gridActions = fs.readFileSync('tool/js/media_grid_actions.js', 'utf8');

function matcherFixture() {
  const grouped = Object.create(null);
  const unscoped = Object.create(null);
  const groupRendered = Object.create(null);
  const unscopedRendered = Object.create(null);
  const ctx = {
    getChecklistAssignmentEntriesForMediaKey: key => grouped[key] || [],
    getUnscopedTagsForMediaKey: key => unscoped[key] || [],
    getTagsForMediaKey: key => (grouped[key] || []).map(entry => entry.term).concat(unscoped[key] || []),
    resolveChecklistTermMediaKey: key => key,
    normalizeItemTag: text => String(text || '').trim().replace(/\s+/g, ' '),
    normalizeChecklistTerm: text => String(text || '').trim().replace(/\s+/g, ' '),
    renderChecklistGroupTermWithAffixes: (req, term, key) =>
      groupRendered[key + '|' + req + '|' + term] || term,
    renderChecklistTermWithAffixes: (tag, key) => unscopedRendered[key + '|' + tag] || tag,
    captionContainsPhrase: (text, phrase) =>
      String(text || '').toLowerCase().includes(String(phrase || '').toLowerCase()),
    state: {}, ui: {}
  };
  vm.createContext(ctx);
  vm.runInContext(
    extract(detail, 'function canonicalizeMatchText(', 'function tagAppearsInCurrentCaption(') +
    extract(checklist, 'function checklistGroupTermAppearsInCaptionText(',
      'function checklistGroupTermAppearsInCurrentCaption(') +
    extract(detail, 'function getUniqueNormalizedTagsForMediaKey(',
      'function formatProgressTooltip(') +
    extract(media, 'function mediaItemHasTagMismatch(', 'function getFilteredMediaItems('),
    ctx
  );
  return {ctx, grouped, unscoped, groupRendered, unscopedRendered};
}

test('Tag Mismatch preserves full metadata progress results, including plural/linking-verb and affix cases', () => {
  const f = matcherFixture();
  const cases = [
    {key: 'none', caption: 'a portrait'},
    {key: 'plain', caption: 'green bikini tops', group: [{requirement: 'Clothing', term: 'bikini top'}]},
    {key: 'verb', caption: 'the body is athletic', group: [{requirement: 'Body', term: 'body athletic'}]},
    {key: 'missing', caption: 'green swimsuit', group: [{requirement: 'Clothing', term: 'bikini top'}]},
    {key: 'mixed-missing', caption: 'blue top', group: [{requirement: 'Clothing', term: 'blue top'}], tags: ['thong']},
    {key: 'group-affix-missing', caption: 'a bikini', group: [{requirement: 'Clothing', term: 'bikini'}], groupAffix: 'wearing bikini'},
    {key: 'group-affix-ok', caption: 'wearing bikini', group: [{requirement: 'Clothing', term: 'bikini'}], groupAffix: 'wearing bikini'},
    {key: 'unscoped-affix', caption: 'thongs', tags: ['thong'], unscopedAffix: 'a thong'},
    {key: 'mixed-ok', caption: 'blue top and thongs', group: [{requirement: 'Clothing', term: 'blue top'}], tags: ['thong']}
  ];
  cases.forEach(row => {
    f.grouped[row.key] = row.group || [];
    f.unscoped[row.key] = row.tags || [];
    if (row.groupAffix) {
      f.groupRendered[row.key + '|' + row.group[0].requirement + '|' + row.group[0].term] = row.groupAffix;
    }
    if (row.unscopedAffix) {
      f.unscopedRendered[row.key + '|' + row.tags[0]] = row.unscopedAffix;
    }
    const progress = f.ctx.computeTagMatchProgressForText(row.key, row.caption);
    const expected = progress.total === 0 || progress.completed < progress.total;
    assert.equal(f.ctx.mediaItemHasTagMismatch({key: row.key, caption: row.caption}), expected, row.key);
  });

  // Live changes must be reflected on the next filter pass: deliberately no persistent mismatch cache.
  f.unscoped.plain = ['thong'];
  assert.equal(f.ctx.mediaItemHasTagMismatch({key: 'plain', caption: 'green bikini tops'}), true);
  assert.equal(f.ctx.mediaItemHasTagMismatch({key: 'plain', caption: 'green bikini tops and thongs'}), false);
  f.groupRendered['plain|Clothing|bikini top'] = 'wearing bikini top';
  assert.equal(f.ctx.mediaItemHasTagMismatch({key: 'plain', caption: 'green bikini tops and thongs'}), true);
});

test('Tag Mismatch computes caption tokens only once per item and stops on the first missing annotation', () => {
  const f = matcherFixture();
  const tags = Array.from({length: 24}, (_, i) => 'tag' + i);
  const caption = tags.join(', ');
  f.unscoped.long = tags;
  const original = f.ctx.canonicalizeMatchText;
  let captionNormalizations = 0;
  f.ctx.canonicalizeMatchText = value => {
    if (value === caption) captionNormalizations += 1;
    return original(value);
  };
  assert.equal(f.ctx.mediaItemHasTagMismatch({key: 'long', caption}), false);
  assert.equal(captionNormalizations, 1, 'the caption is normalized once instead of once per tag');

  f.unscoped.long = ['absent', ...tags];
  let checked = 0;
  f.ctx.captionContainsPhrase = () => { checked += 1; return false; };
  assert.equal(f.ctx.mediaItemHasTagMismatch({key: 'long', caption}), true);
  assert.equal(checked, 1, 'no tags after the first mismatch are inspected');
});

test('grid reuses the current sidebar filter snapshot, and standalone refresh still filters normally', () => {
  const seen = [];
  const grid = {
    mediaGridState: {open: true, selectedKeys: new Set()},
    mediaGridGetVisibleItems: () => { seen.push('filter'); return [{key: 'from-filter', fileName: 'a.png'}]; },
    mediaGridPruneSelectionToItems: () => {},
    mediaGridEnsureMainWorkbenchVisible: () => {},
    renderMediaGridSurfaceHeader: () => {},
    renderMediaGridCanvas: () => {},
    mediaGridRenderSharedWorkbench: () => {}
  };
  vm.createContext(grid);
  vm.runInContext(
    extract(gridState, 'function mediaGridSyncItemsToCurrentView(', 'function mediaGridSeedSelectionFromCurrentItem(') +
    extract(gridActions, 'function renderMediaGridSurface(', 'function renderMediaGridSurfaceHeader(') +
    extract(gridActions, 'function mediaGridRefreshFromCurrentFilters(', 'function mediaGridHandleKeydown('),
    grid
  );

  const supplied = [{key: 'already-filtered', fileName: 'b.png'}];
  grid.mediaGridRefreshFromCurrentFilters(supplied);
  assert.equal(seen.length, 0);
  assert.equal(grid.mediaGridState.items[0].key, 'already-filtered');
  grid.mediaGridRefreshFromCurrentFilters();
  assert.equal(seen.length, 1);
  assert.equal(grid.mediaGridState.items[0].key, 'from-filter');
  grid.mediaGridState.open = false;
  grid.mediaGridRefreshFromCurrentFilters();
  assert.equal(seen.length, 1);

  assert.match(media, /mediaGridRefreshFromCurrentFilters\(mediaItems\)/,
    'sidebar passes its freshly computed matches instead of launching a second full scan');
});
