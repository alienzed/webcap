const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'tool/tool.html'), 'utf8');
const storyboard = fs.readFileSync(path.join(root, 'tool/js/storyboard.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'tool/js/director_chat.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'tool/server/app.py'), 'utf8');

test('Studio Director keeps Director Tools in actions overflow, not Scenes header', () => {
  assert.match(markup, /id="storyboard-director-tools-menu"[^>]*>/);
  assert.match(markup, /id="storyboard-director-tools-menu"[\\s\\S]*?id="storyboard-director-tools-btn"/);
  assert.equal((markup.match(/id="storyboard-director-tools-btn"/g) || []).length, 1);
  assert.match(storyboard, /el\\('storyboard-director-tools-menu'\\)\\.open = false/);
});

test('frontend and backend agree on structured Studio chat operation', () => {
  assert.match(chat, /operation: activeChatMode === 'storyboard' \\? 'studio_chat' : 'freeform_chat'/);
  assert.match(server, /if operation == "studio_chat":/);
  assert.match(server, /"freeform_chat", "studio_chat"/);
  assert.match(chat, /Restart or update the backend so it matches the current Studio Director frontend/);
});
