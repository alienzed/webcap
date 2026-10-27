'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const primer = fs.readFileSync('tool/js/primer_settings.js', 'utf8');
const start = primer.indexOf('function getCaptionAssistTagMismatchHints(');
const end = primer.indexOf('function repairCaptionAssistCandidate(', start);
assert.ok(start > 0 && end > start, 'Mismatch hints must reuse Caption Assist submission');

function harness({caption = '', draft = '', assignments = [], tags = [], corrections, sightLed = false}) {
  const item = {key: 'sample.png', fileName: 'sample.png', caption};
  const request = {model: 'director', draft, assignments, tags, sightLed};
  if (corrections !== undefined) request.corrections = corrections;
  const calls = [];
  let matchChecks = 0;
  const sandbox = {
    Object, String, Promise, JSON,
    buildAutoPrimer: () => 'Auto primer from selected tags',
    getCaptionAssistMissingGroups: () => [],
    getCaptionAssistOmittedCorrections(_key, text, grouped, unscoped) {
      matchChecks += 1;
      return [
        ...grouped.map(row => ({group: row.group, term: row.term})),
        ...unscoped.map(term => ({group: '', term}))
      ].filter(row => !text.toLowerCase().includes(row.term.toLowerCase()));
    },
    captionAssistRequestJson(_url, options) {
      calls.push(JSON.parse(options.body));
      return Promise.resolve({job: {jobId: 'test-job'}});
    },
    trackTransientLlmJob() {},
    waitForCaptionAssistJob: () => Promise.resolve({result: {text: 'Proposed caption'}}),
    getCaptionAssistOmittedAssignments: () => [],
    captionAssistRequestFingerprint: () => 'stable',
    captionAssistSightFingerprint: () => ''
  };
  vm.createContext(sandbox);
  vm.runInContext(primer.slice(start, end) + '\nthis.submit = requestCaptionAssistCandidate;', sandbox);
  return {item, request, calls, getChecks: () => matchChecks, submit: () => sandbox.submit(item, request)};
}

test('existing caption sends only selected facts that local text checking did not find', async () => {
  const h = harness({
    caption: 'A person wearing a red top.',
    draft: 'A person wearing a red top.',
    assignments: [{group: 'Clothing', term: 'red top'}, {group: 'Hair', term: 'long braid'}],
    tags: ['earrings']
  });
  const candidate = await h.submit();
  assert.deepEqual(h.calls[0].tagMismatches, [
    {group: 'Hair', term: 'long braid'}, {group: '', term: 'earrings'}
  ]);
  assert.equal(candidate.text, 'Proposed caption');
  assert.equal(h.item.caption, 'A person wearing a red top.');
  assert.equal(h.request.tagMismatches, undefined, 'input remains immutable for lookahead fingerprints');
  assert.equal(h.getChecks(), 1, 'local matching is only done at submission');
});

test('correctly matched captions send no unnecessary mismatch hints', async () => {
  const h = harness({
    caption: 'A person with a long braid and earrings.',
    draft: 'A person with a long braid and earrings.',
    assignments: [{group: 'Hair', term: 'long braid'}], tags: ['earrings']
  });
  await h.submit();
  assert.equal('tagMismatches' in h.calls[0], false);
});

test('captionless auto-Primer and Sight-led requests are left alone', async () => {
  const primerOnly = harness({
    draft: 'Auto primer from selected tags',
    assignments: [{group: 'Hair', term: 'long braid'}]
  });
  await primerOnly.submit();
  assert.equal(primerOnly.getChecks(), 0);
  assert.equal('tagMismatches' in primerOnly.calls[0], false);
  const sightLed = harness({draft: 'A draft', sightLed: true, tags: ['earrings']});
  await sightLed.submit();
  assert.equal('tagMismatches' in sightLed.calls[0], false);
});

test('an edited captionless draft is eligible for mismatch guidance', async () => {
  const h = harness({
    draft: 'A person posing near a window.',
    assignments: [{group: 'Hair', term: 'braid'}]
  });
  await h.submit();
  assert.deepEqual(h.calls[0].tagMismatches, [{group: 'Hair', term: 'braid'}]);
});

test('explicit candidate repair corrections are not blended with text-match hints', async () => {
  const corrections = [{group: 'Hair', term: 'braid', note: 'User confirmed the omission.'}];
  const h = harness({
    caption: 'A person posing.', draft: 'A person posing.',
    assignments: [{group: 'Hair', term: 'braid'}], corrections
  });
  await h.submit();
  assert.equal('tagMismatches' in h.calls[0], false);
  assert.deepEqual(h.calls[0].corrections, corrections);
  assert.equal(h.getChecks(), 0);
});

test('untagged media does not invent mismatch corrections', async () => {
  const h = harness({caption: 'A photo with clear details.', draft: 'A photo with clear details.'});
  await h.submit();
  assert.equal('tagMismatches' in h.calls[0], false);
});
