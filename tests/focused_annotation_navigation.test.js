// Characterization coverage for the DOM-free Focus Annotation traversal rules.
// Run with: node tests/focused_annotation_navigation.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '..', 'tool', 'js', 'focused_annotation_navigation.js'), 'utf8'),
  sandbox,
  { filename: 'focused_annotation_navigation.js' }
);
const nav = sandbox.FocusedAnnotationNavigation;

function scope(itemKeys, groupKeys, reviewedByItem) {
  return { itemKeys, groupKeys, reviewedByItem: reviewedByItem || {} };
}

function cursor(itemIndex, groupIndex, itemKey, groupKey) {
  return { itemIndex, groupIndex, itemKey, groupKey };
}

function position(result) {
  return [result.outcome, result.itemKey, result.groupKey];
}

assert.deepStrictEqual(position(nav.start(scope([], ['a']))), ['unavailable', '', '']);
assert.deepStrictEqual(position(nav.start(scope(['one'], []))), ['unavailable', '', '']);
assert.deepStrictEqual(
  position(nav.start(scope(['one'], ['a'], { one: { a: true } }))),
  ['scope-complete', '', '']
);

assert.deepStrictEqual(
  position(nav.start(scope(['one', 'two'], ['a', 'b'], { one: { a: true } }), 'one')),
  ['active', 'one', 'b']
);
assert.deepStrictEqual(
  position(nav.start(scope(['one', 'two'], ['a', 'b'], { two: { a: true, b: true } }), 'two')),
  ['active', 'one', 'a']
);

const groupFirst = scope(['one', 'two', 'three'], ['a', 'b'], {
  two: { a: true }
});
assert.deepStrictEqual(
  position(nav.advance(groupFirst, cursor(1, 0, 'two', 'a'))),
  ['active', 'three', 'a']
);

const laterGroupRestartsAtFirstItem = scope(['one', 'two', 'three'], ['a', 'b'], {
  two: { a: true },
  three: { a: true }
});
assert.deepStrictEqual(
  position(nav.advance(laterGroupRestartsAtFirstItem, cursor(1, 0, 'two', 'a'))),
  ['active', 'one', 'b']
);

const laterSameGroup = scope(['one', 'two', 'three'], ['a', 'b'], {
  two: { a: true },
  one: { b: true },
  two: { a: true, b: true },
  three: { b: true }
});
assert.deepStrictEqual(
  position(nav.advance(laterSameGroup, cursor(1, 0, 'two', 'a'))),
  ['active', 'three', 'a']
);

const noEntryWrap = scope(['one', 'two', 'three'], ['a', 'b'], {
  two: { a: true, b: true },
  three: { a: true, b: true },
  one: { b: true }
});
assert.deepStrictEqual(
  position(nav.advance(noEntryWrap, cursor(1, 0, 'two', 'a'))),
  ['pass-complete', '', '']
);

const skipScope = scope(['one', 'two'], ['a'], {});
const skipped = nav.advance(skipScope, cursor(0, 0, 'one', 'a'));
assert.deepStrictEqual(position(skipped), ['active', 'two', 'a']);
assert.deepStrictEqual(position(nav.start(skipScope, 'one')), ['active', 'one', 'a']);

const completeScope = scope(['one', 'two'], ['a'], { one: { a: true }, two: { a: true } });
assert.deepStrictEqual(
  position(nav.advance(completeScope, cursor(0, 0, 'one', 'a'))),
  ['scope-complete', '', '']
);

const manual = scope(['one', 'two', 'three'], ['a', 'b']);
assert.deepStrictEqual(
  position(nav.moveItem(manual, cursor(0, 1, 'one', 'b'), -1)),
  ['active', 'three', 'a']
);
assert.deepStrictEqual(
  position(nav.moveItem(manual, cursor(2, 0, 'three', 'a'), 1)),
  ['active', 'one', 'b']
);
assert.deepStrictEqual(
  position(nav.moveGroup(manual, cursor(1, 0, 'two', 'a'), 1)),
  ['active', 'two', 'b']
);

const afterItemDeletion = scope(['one', 'three'], ['a', 'b']);
assert.deepStrictEqual(
  position(nav.reconcile(afterItemDeletion, cursor(1, 0, 'two', 'a'))),
  ['active', 'three', 'a']
);
const afterGroupDeletion = scope(['one', 'two'], ['b']);
assert.deepStrictEqual(
  position(nav.reconcile(afterGroupDeletion, cursor(1, 0, 'two', 'a'))),
  ['active', 'two', 'b']
);
const afterReorder = scope(['three', 'one', 'two'], ['b', 'a']);
const reordered = nav.reconcile(afterReorder, cursor(1, 0, 'two', 'a'));
assert.deepStrictEqual(position(reordered), ['active', 'two', 'a']);
assert.strictEqual(reordered.itemIndex, 2);
assert.strictEqual(reordered.groupIndex, 1);

console.log('focused_annotation_navigation: all assertions passed');
