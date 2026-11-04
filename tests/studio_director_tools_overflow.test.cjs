const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const storyboard = fs.readFileSync(path.join(root, 'tool/js/storyboard.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'tool/server/app.py'), 'utf8');

test('Revise & Generate is a direct Director production action, not an overflow tool', () => {
  const actions = markup.split('<div class="studio-dw-actions">')[1].split('</div>')[0];
  assert.match(actions, /id="studio-dw-read"/);
  assert.match(actions, /id="studio-dw-write"/);
  assert.match(actions, /id="storyboard-director-tools-btn"/);
  assert.equal((markup.match(/id="storyboard-director-tools-btn"/g) || []).length, 1);
  assert.doesNotMatch(markup, /id="storyboard-director-tools-menu"/);
  assert.match(storyboard, /el\\('storyboard-director-tools-btn'\\)\\.onclick = openDirectorTools/);
});

test('Revise & Generate retains the existing production operation with explicit destination', () => {
  assert.match(markup, /id="storyboard-director-tools-target"/);
  assert.match(markup, /id="storyboard-director-tools-generate-takes"/);
  assert.match(markup, /revisions can save while the job runs/);
  assert.match(storyboard, /storyState\\.story\\.sceneOrder\\.length \\+ ' Scenes'/);
  assert.match(storyboard, /operation: 'revise_scenes_sequence'/);
  assert.match(storyboard, /generateFreshTakes: generateFreshTakes === true/);
  assert.match(storyboard, /operation: 'check_coherence_sequence'/);
  assert.match(storyboard, /sceneRevisionHistory\\.remember/);
});

test('frontend and backend agree on structured Studio chat operation', () => {
  assert.ok(chat.includes("operation: activeChatMode === 'storyboard' ? 'studio_chat' : 'freeform_chat'"));
  assert.match(server, /if operation == "studio_chat":/);
  assert.match(server, /"freeform_chat", "studio_chat"/);
  assert.match(chat, /Restart or update the backend so it matches the current Studio Director frontend/);
});
