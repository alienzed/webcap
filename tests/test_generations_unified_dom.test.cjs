// Retired unified builder must not borrow native Evaluation DOM.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const testJS = fs.readFileSync(path.join(root, 'tool/js/test_generations.js'), 'utf8');
const finder = fs.readFileSync(path.join(root, 'tool/js/epoch_finder.js'), 'utf8');

test('native Evaluation methods reachable and obsolete shells absent', () => {
  const nav = html.split('<nav id="test-workspace-main-tabs"', 2)[1].split('</nav>', 1)[0];
  for (const mode of ['tests','screening','finder','analytics','references'])
    assert.ok(nav.includes('data-test-workspace-mode="'+mode+'"'), mode);
  for (const obsolete of ['id="test-unified-workspace"', 'data-test-generations-perspective',
      'src="/static/js/test_generations_unified.js"',
      'src="/static/js/test_generations_perspective.js"'])
    assert.ok(!html.includes(obsolete), obsolete);
  assert.ok(!testJS.includes('testGenerationsUnifiedNativeRoute'));
  assert.match(finder, /window\.epochFinderShowMode = showMode/);
});
test('original controls and generated evidence owners preserved', () => {
  for (const id of ['test-generations-run-btn','test-generations-inline-count',
      'test-generations-files','test-generations-sessions-list','epoch-finder-start',
      'epoch-finder-manual-matrix','test-references-gallery','run-analytics-director'])
    assert.ok(html.includes('id="'+id+'"'), id);
  assert.ok(html.indexOf('id="test-generations-body"') < html.indexOf('id="test-generations-run-btn"'));
});
