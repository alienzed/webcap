'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../tool/js/media_context_actions.js'), 'utf8');

test('Prep folder context menu offers Find & Replace only for a Set folder', () => {
  const context = {
    state: {folder:'sets'},
    createFlagAction: () => ({label:'Flag'}),
    isSetFolderPath: folder => folder === 'sets/Set One',
  };
  vm.runInNewContext(source, context);
  const setActions = context.buildFolderContextMenuActions('Set One');
  assert.equal(setActions.filter(a => a.label === 'Find & Replace Captions').length, 1);
  const regularActions = context.buildFolderContextMenuActions('Not A Set');
  assert.equal(regularActions.filter(a => a.label === 'Find & Replace Captions').length, 0);
});

test('folder action uses the clicked Set path rather than the current parent folder', () => {
  const context = {
    state: {folder:'sets'},
    createFlagAction: () => ({label:'Flag'}),
    isSetFolderPath: folder => folder === 'sets/Set One',
  };
  vm.runInNewContext(source, context);
  const action = context.buildFolderContextMenuActions('Set One')
    .find(a => a.label === 'Find & Replace Captions');
  assert.match(action.run.toString(), /openSetCaptionFindReplace\(setFolderPath\)/);
});

test('Set caption replacement searches on debounce without a Preview click', () => {
  const dialogSource = source.slice(
    source.indexOf('function openSetCaptionFindReplace('),
    source.indexOf('function buildFolderContextMenuActions(')
  );
  assert.ok(!dialogSource.includes('data-action="preview"'));
  assert.ok(!dialogSource.includes('previewButton'));
  assert.ok(dialogSource.includes('}, 350);'));
  assert.ok(dialogSource.includes('send(false);'));
  assert.ok(dialogSource.includes("schedulePreview(false);"));
  assert.ok(dialogSource.includes("schedulePreview(true);"));
  assert.ok(dialogSource.includes('applyButton.disabled = data.occurrences === 0'));
  assert.ok(dialogSource.includes('payload.signature = current.signature'));
});
