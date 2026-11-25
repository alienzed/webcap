'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const start = source.indexOf('function getCaptionAssistDraftForMediaItem(mediaItem) {');
const end = source.indexOf('function captionAssistRequestJson(', start);
assert.ok(start >= 0 && end > start, 'Caption Assist request builder must exist');

function buildRequest({caption = '', draft = '', primer = 'A person standing, indoors.',
  selected = ['standing'], tags = [], sight = null} = {}) {
  const mediaItem = {
    key: 'sample.png', fileName: 'sample.png', caption,
    metadata: sight ? {vision_sight: sight} : {}
  };
  const sandbox = {
    String,
    state: {currentItem: mediaItem},
    ui: {editorEl: {value: draft}},
    document: {
      getElementById(id) {
        return id === 'stats-required-phrase' ? {value: 'A person'} : null;
      }
    },
    getChecklistAssignmentEntriesForMediaKey: () =>
      selected.map(term => ({requirement: 'Position', term})),
    getRequirementGroupAlias: () => 'Position',
    normalizeRequirementPrimerKey: () => 'position',
    getDirectorModelPreference: () => 'director',
    getUnscopedTagsForMediaKey: () => tags,
    statsGetPrimerOptionsFromDom: () => ({template: '{position, }{background}'}),
    buildPrimerFromConfig: () => primer,
    buildAutoPrimer: () => primer
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end) + '\nthis.buildRequest = buildCaptionAssistRequest;', sandbox);
  return sandbox.buildRequest(mediaItem);
}

test('untouched unsaved tagged Primer is structural guidance, not currentDraft', () => {
  const request = buildRequest({
    draft: 'A person standing, indoors.',
    primer: 'A person standing, indoors.',
    selected: ['standing', 'seated']
  });
  assert.equal(request.draft, '');
  assert.equal(request.renderedPrimer, 'A person standing, indoors.');
  assert.equal(request.template, '{position, }{background}');
  assert.equal(request.assignments.length, 2);
  assert.equal(request.sightLed, undefined);
});

test('saved caption remains an authored draft even when equal to the Primer', () => {
  const request = buildRequest({
    caption: 'A person standing, indoors.',
    draft: 'A person standing, indoors.'
  });
  assert.equal(request.draft, 'A person standing, indoors.');
});

test('captionless live editor changes remain empty before autosave', () => {
  const request = buildRequest({draft: 'A person standing by a window.'});
  assert.equal(request.draft, '');
});

test('saved caption with a pending live edit submits the saved text', () => {
  const request = buildRequest({
    caption: 'A person standing, indoors.',
    draft: 'A person standing, outdoors.'
  });
  assert.equal(request.draft, 'A person standing, indoors.');
});

test('first-time untagged Sight-led behavior stays available', () => {
  const request = buildRequest({
    draft: 'A person standing, indoors.', selected: [],
    sight: {description: 'A subject standing against a wall.'}
  });
  assert.equal(request.draft, '');
  assert.equal(request.sightLed, true);
});

test('captionless Sight item remains Sight-led despite pending editor text', () => {
  const request = buildRequest({
    draft: 'A person in a yellow jacket.', selected: [],
    sight: {description: 'A person in a jacket.'}
  });
  assert.equal(request.draft, '');
  assert.equal(request.sightLed, true);
});

test('captionless items without a Primer remain empty', () => {
  const request = buildRequest({draft: 'An authored description.', primer: ''});
  assert.equal(request.draft, '');
});
