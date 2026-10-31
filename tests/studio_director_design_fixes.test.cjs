const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const base = path.join(__dirname, '..');
const chat = fs.readFileSync(path.join(base,'tool/js/director_chat.js'),'utf8');
const rail = fs.readFileSync(path.join(base,'tool/js/studio_director_workbench.js'),'utf8');
const html = fs.readFileSync(path.join(base,'tool/tool.html'),'utf8');
const css = fs.readFileSync(path.join(base,'tool/css/workspace_shell.css'),'utf8');

function section(text,start,end) {
  const a=text.indexOf(start), b=text.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a, 'Missing source section: '+start);
  return text.slice(a,b);
}

test('changing Write operation reloads saved Scene choices after a reviewed insertion', async () => {
  const handler = section(rail,"    el('studio-dw-write-operation').onchange=function () {",
    "    ['studio-dw-write-fields', 'studio-dw-batch-fields'].forEach");
  const refresh = section(rail,'  function refreshWrite() {','  function toggle(which) {');
  const elements = {
    'studio-dw-write-operation':{value:'scene-edit'},
    'studio-dw-write-project':{value:'project-1'}
  };
  const saved = {id:'project-1',sceneOrder:['new-scene'],scenes:{'new-scene':{title:'New Scene'}}};
  let rendered = {id:'project-1',sceneOrder:[],scenes:{}};
  const scope = vm.createContext({
    el:id=>elements[id], writeOperationChosen:false,writeFieldsManuallyChanged:true,
    refreshProjects:async()=>{},
    loadStory:async id=>{assert.equal(id,saved.id);return saved;},
    renderWriteStory:story=>{rendered=story;},
    setOperation:()=>{assert.deepEqual(rendered.sceneOrder,['new-scene']);},
    applySuggestedWriteFields:()=>{},status:message=>assert.fail(message)
  });
  vm.runInContext(refresh+handler,scope);
  await elements['studio-dw-write-operation'].onchange();
  assert.equal(rendered,saved);
  assert.equal(scope.writeOperationChosen,true);
  assert.equal(scope.writeFieldsManuallyChanged,false);
});

test('Undo is reachable from the visible rail and delegates to existing reviewed operation', () => {
  for(const id of ['studio-dw-undo','studio-dw-undo-label','studio-dw-undo-button'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(chat,/window\.studioDirectorWorkbench\.setUndo\(state\.studioBriefUndo\)/);
  assert.match(chat,/undoBrief: function \(\)/);
  assert.match(rail,/studioDirectorBridge\.undoBrief\(\)/);
  assert.match(rail,/resetConversation: function \(\)/);
});

test('Narrow Studio exposes Read and Write directly instead of burying them behind Actions', () => {
  for(const id of ['studio-dw-quick-read','studio-dw-quick-write','studio-dw-close-actions'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/id="studio-dw-open-actions"/);
  assert.match(css,/@container \(max-width:820px\)/);
  assert.match(css,/\.studio-actions-open \.director-chat-sidebar/);
  assert.match(css,/visibility:hidden;pointer-events:none/);
  assert.match(rail,/function openDirectAction\(which\)/);
  assert.match(rail,/openDirectAction\('read'\)/);
  assert.match(rail,/openDirectAction\('write'\)/);
  assert.match(rail,/el\('studio-dw-' \+ which\)\.click\(\)/);
});

test('Read and Write stay distinct; Read persists field choices on panel changes', () => {
  assert.match(rail,/var readChoices = \{\}/);
  assert.match(rail,/var chosen = readChoices\[story\.id\]/);
  assert.match(rail,/readChoices\[story\.id\] = chosen/);
  assert.match(rail,/writeOperationChosen = true/);
  assert.match(rail,/preferredRead/);
  assert.match(rail,/preferredWrite/);
  assert.match(rail,/lastReadSource && writeId && lastReadSource !== writeId/);
});

test('Read preview and outbound values use the same validated field serializer', () => {
  const body=section(rail,'  function readPayload(story, keys) {','  function updateReadSelection() {');
  const scope={projectFields:['title','concept','style','invariants'],storyName:story=>story.title};
  vm.createContext(scope);
  vm.runInContext(body,scope);
  const story={id:'p1',title:'The Interview',updatedAt:'now',concept:'A specific premise',
    scenes:{s1:{title:'Question',summary:'Tense dialogue',prompt:'Close-up'}},sceneOrder:['s1']};
  const result=scope.readPayload(story,['project.concept','scene:s1:summary']);
  assert.equal(result.fields.length,2);
  assert.equal(result.fields[0].value,'A specific premise');
  assert.equal(result.fields[1].value,'Tense dialogue');
  assert.throws(()=>scope.readPayload(story,['scene:missing:summary']),/not in this Project/);
  assert.match(rail,/readPayload\(story, keys\)/);
  assert.match(rail,/sendRead\(payload, keys\)/);
});

test('Read receipt is derived from the actual next Director reply, not fabricated',()=>{
  assert.match(chat,/Director acknowledged/);
  assert.match(chat,/next\.role !== 'assistant'/);
  assert.match(chat,/next\.content/);
  assert.match(chat,/Director acknowledgment incomplete or mismatched/);
});

test('Readiness opens a single read-only detail and never assigns one Scene ID to multiple checks',()=>{
  assert.match(rail,/Scene \(current discussion\)/);
  assert.doesNotMatch(section(rail,'  function renderReadiness(list) {','  window.studioDirectorWorkbench ='),/recommendations\.sceneId/);
  assert.match(html,/id="studio-dw-assessment-dialog"/);
  assert.match(rail,/studio-dw-assessment-dialog'\)\.showModal/);
  assert.match(rail,/studio-dw-assessment-content'\)\.textContent = item\.content/);
  assert.match(html,/H3 Playbook · global model guidance/);
});

test('New chat and loaded session reset stale design selections without changing saved creative data',()=>{
  assert.match(chat,/window\.studioDirectorWorkbench\.resetConversation\(\)/);
  assert.match(rail,/writeOperationChosen = false/);
  assert.doesNotMatch(rail,/localStorage/);
});
