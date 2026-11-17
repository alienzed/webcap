'use strict';
// Chat, Project Write and Scene Write are independent responsibilities.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=x=>fs.readFileSync(path.join(__dirname,'..',x),'utf8');
const chat=read('tool/js/director_chat.js');
const backend=read('tool/server/app.py');
const guidance=read('tool/server/studio_director.py');
const workbench=read('tool/js/studio_director_workbench.js');

test('one plain Chat route and separate Project and Scene model operations',()=>{
  assert.ok(backend.includes('"studio_chat"'));
  assert.ok(backend.includes('if operation == "studio_project_draft"'));
  assert.ok(backend.includes('if operation == "studio_brief_draft"'));
  assert.ok(backend.includes('if operation == "studio_scene_field_draft"'));
  assert.ok(backend.includes('if operation == "studio_scenes_draft"'));
  assert.ok(!backend.includes('studio_chat_response_schema'));
  assert.ok(guidance.includes('def chat_guidance():'));
  assert.ok(guidance.includes('def scene_records_schema():'));
});

test('normal Chat cannot initiate a Write or infer a destination from prose',()=>{
  const a=chat.indexOf('  function sendMessage() {'),
    b=chat.indexOf('  function syncPinnedUi()',a);
  assert.ok(a>=0&&b>a);
  const send=chat.slice(a,b);
  assert.ok(send.includes('studioDirectorChatRequestMessages(messages)'));
  for(const forbidden of ['writeNewScene','writeSelectedScene',
    'commitFocusedStudioBrief','studioAuthoredWriteActions'])
    assert.ok(!send.includes(forbidden),forbidden);
});

test('Project and Scene authoring use direct authoritative save APIs',()=>{
  for(const url of ['/fs/studio/director/project-create',
    '/fs/studio/director/brief','/fs/studio/director/scenes-draft'])
    assert.ok(chat.includes(url),url);
  assert.ok(workbench.includes('/fs/studio/director/scene-fields'));
  for(const dead of ['showStudioBriefReview','showStudioProjectReview',
    'showStudioScenesReview','studioMergeWorkingChanges'])
    assert.ok(!chat.includes(dead),dead);
});

test('conversation is passed once in roles and full length, no arbitrary tail',()=>{
  assert.ok(chat.includes('studioConversationMessages(state.modeMessages.storyboard)'));
  assert.ok(!chat.includes('.slice(-8)'));
  assert.ok(!chat.includes('discussion:studioConversationMessages'));
  assert.ok(!chat.includes('Earlier long message abbreviated'));
});

test('every Write can expose exact sent context and raw response in I/O',()=>{
  assert.ok(chat.includes('state.requestDiagnostic'));
  assert.ok(chat.includes('state.lastStudioIoRaw'));
  assert.ok(chat.includes("studio-director-io-raw"));
  assert.ok(chat.includes("showSentWriteContext"));
  assert.ok(chat.includes("window.reportConsoleError('Studio Scene revision'"));
});

test('History, not Review, owns recovery after direct Write',()=>{
  assert.ok(workbench.includes('webcapTextareaRevisions.recordFieldChange'));
  assert.ok(chat.includes('webcapTextareaRevisions.recordFieldChange'));
  assert.ok(!workbench.includes('renderBatchReview'));
  assert.ok(!workbench.includes('showSceneReview'));
});
