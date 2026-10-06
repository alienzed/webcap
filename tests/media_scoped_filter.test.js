// Regression coverage for scoped media tag filters.
// Run with: node tests/media_scoped_filter.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'media.js'), 'utf8');

const assignments = {
  topRing: [
    { requirement: 'bt_shape', term: 'ring' }
  ],
  jewelryRing: [
    { requirement: 'jewelry', term: 'ring' }
  ],
  literalColon: []
};

const tags = {
  topRing: ['ring'],
  jewelryRing: ['ring'],
  literalColon: []
};

const sandbox = {
  console,
  getTagsForMediaKey(mediaKey) {
    return tags[mediaKey] || [];
  },
  getChecklistAssignmentEntriesForMediaKey(mediaKey) {
    return assignments[mediaKey] || [];
  }
};

vm.runInNewContext(source, sandbox, { filename: 'media.js' });

assert.strictEqual(typeof sandbox.parseMediaFilterQuery, 'function');
assert.strictEqual(typeof sandbox.mediaItemMatchesFilterQuery, 'function');

function item(key, caption) {
  return {
    key,
    label: key,
    fileName: key + '.png',
    caption: caption || ''
  };
}

function matches(key, raw, mode, caption) {
  return sandbox.mediaItemMatchesFilterQuery(
    item(key, caption),
    sandbox.parseMediaFilterQuery(raw),
    mode || 'any'
  );
}

// Existing unscoped search remains broad across flattened tags.
assert.strictEqual(matches('topRing', 'ring'), true);
assert.strictEqual(matches('jewelryRing', 'ring'), true);

// Scoped syntax matches only the stored group identity.
assert.strictEqual(matches('topRing', '@bt_shape:ring'), true);
assert.strictEqual(matches('jewelryRing', '@bt_shape:ring'), false);
assert.strictEqual(matches('jewelryRing', '@jewelry:ring'), true);

// Scoped matching is forgiving about case but exact about group and value.
assert.strictEqual(matches('topRing', '@BT_SHAPE:RING'), true);
assert.strictEqual(matches('topRing', '@bt_shape:rin'), false);

// Existing negative semantics apply to scoped terms.
assert.strictEqual(matches('topRing', '-@bt_shape:ring'), false);
assert.strictEqual(matches('jewelryRing', '-@bt_shape:ring'), true);

// Existing all/any behavior continues to compose with scoped terms.
assert.strictEqual(matches('topRing', '@bt_shape:ring;topring', 'all'), true);
assert.strictEqual(matches('topRing', '@jewelry:ring;topring', 'all'), false);
assert.strictEqual(matches('topRing', '@jewelry:ring;topring', 'any'), true);

// A colon is not reserved unless the term begins with @ and has group:value.
assert.strictEqual(matches('literalColon', 'ratio:1', 'any', 'ratio:1'), true);
assert.strictEqual(matches('literalColon', 'note:@bt_shape:ring', 'any', 'note:@bt_shape:ring'), true);

console.log('media_scoped_filter: all assertions passed');
