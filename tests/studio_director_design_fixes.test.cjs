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
    "    el('studio-dw-scene-mode').onchange=function () {");
  const refresh = section(rail,'  function refreshWrite() {','  function toggle(which) {');
  const elements = {
    'studio-dw-write-operation':{value:'scene-write'},
    'studio-dw-write-project':{value:'project-1'}
  };
  const saved = {id:'project-1',sceneOrder:['new-scene'],scenes:{'new-scene':{title:'New Scene'}}};
  let rendered = {id:'project-1',sceneOrder:[],scenes:{}};
  const scope = vm.createContext({
    el:id=>elements[id], writeOperationChosen:false,
    refreshProjects:async()=>{},
    loadStory:async id=>{assert.equal(id,saved.id);return saved;},
    renderWriteStory:story=>{rendered=story;},
    setOperation:()=>{assert.deepEqual(rendered.sceneOrder,['new-scene']);},
    status:message=>assert.fail(message)
  });
  vm.runInContext(refresh+handler,scope);
  await elements['studio-dw-write-operation'].onchange();
  assert.equal(rendered,saved);
  assert.equal(scope.writeOperationChosen,true);
});

test('Undo is reachable from the visible rail and delegates to existing reviewed operation', () => {
  for(const id of ['studio-dw-undo','studio-dw-undo-label','studio-dw-undo-button'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(chat,/window\.studioDirectorWorkbench\.setUndo\(state\.studioBriefUndo\)/);
  assert.match(chat,/undoBrief: function \(\)/);
  assert.match(rail,/studioDirectorBridge\.undoBrief\(\)/);
  assert.match(rail,/resetConversation: function \(\)/);
});

test('manual Read and Write remain available through the on-demand Advanced panel', () => {
  for(const id of ['studio-dw-open-tools','studio-dw-read','studio-dw-write','studio-dw-close-actions'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(html,/id="studio-dw-open-actions"/);
  assert.match(css,/@container \(max-width:1000px\)/);
  assert.match(css,/\.studio-actions-open \.director-chat-sidebar \{display:flex;/);
  assert.match(css,/\.director-chat-sidebar \{display:none;/);
  assert.match(rail,/function openDirectAction\(which\)/);
  assert.match(rail,/openDirectAction\(lastQuickAction\)/);
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

test('operational errors reveal Advanced and preserve the shared Console detail',()=>{
  const nodes={},classes=new Set(),logs=[];
  const el=id=>nodes[id] ||= {dataset:{},attrs:{},classList:{toggle(){},add:x=>classes.add(x)},setAttribute(k,v){this.attrs[k]=v;}};
  const scope=vm.createContext({el,window:{reportConsoleError:(label,error)=>logs.push(error.message)}});
  vm.runInContext(section(rail,'  function status(message, error) {','  function option('),scope);
  scope.status('Draft failed: exact backend error',true);
  assert.equal(classes.has('studio-actions-open'),true);
  assert.equal(el('studio-dw-open-tools').attrs['aria-expanded'],'true');
  assert.equal(el('studio-dw-status').textContent,'Draft failed: exact backend error');
  assert.deepEqual(logs,['Draft failed: exact backend error']);
});

test('Advanced opens and closes the last manual panel without submitting Read or Write',()=>{
  const nodes={};
  function node(id) {
    const classes=new Set();
    return nodes[id] ||= {attrs:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}},
      setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;},click(){this.onclick();}};
  }
  let selected=0;
  node('studio-dw-write-panel').classList.add('hidden');
  const a=rail.indexOf('    function openDirectAction(which) {');
  const b=rail.indexOf("    rail.addEventListener('keydown'",a);
  const scope=vm.createContext({el:node,lastQuickAction:'write',updateScope(){},refreshWrite:async()=>{selected++;}});
  vm.runInContext(section(rail,'  function toggle(which) {','  function parseProposal(raw) {')+rail.slice(a,b),scope);
  node('studio-dw-write').onclick=()=>scope.toggle('write');
  node('studio-dw-open-tools').click();
  assert.equal(selected,1);
  assert.equal(node('studio-dw-open-tools').attrs['aria-expanded'],'true');
  assert.equal(node('director-chat-drawer').classList.contains('studio-actions-open'),true);
  node('studio-dw-open-tools').click();
  assert.equal(node('studio-dw-open-tools').attrs['aria-expanded'],'false');
  assert.equal(node('director-chat-drawer').classList.contains('studio-actions-open'),false);
  assert.equal(node('studio-dw-open-tools').focused,true);
  node('studio-dw-open-tools').click();
  assert.equal(selected,1,'opening again preserves the panel and its current choices');
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

test('Read receipt uses delivery and response status, not model text parsing',()=>{
  assert.match(chat,/var fieldCount = state\.pendingReadAck\.length/);
  assert.match(chat,/setReadStatus\('success', feedback\)/);
  assert.doesNotMatch(chat,/Director acknowledgement mismatch/);
  assert.match(rail,/setReadStatus:function\(state,detail\)/);
  assert.doesNotMatch(chat,/director-chat-read-receipt/);
});

test('Select entire Project reuses the existing Read selection and size validation',()=>{
  assert.match(html,/id="studio-dw-read-all"/);
  assert.match(rail,/function selectEntireReadProject\(\)/);
  assert.match(rail,/toggle\.groupPaths\.forEach/);
  assert.match(rail,/updateReadSelection\(\)/);
  assert.match(rail,/length > 48000/);
  assert.match(rail,/readPayload\(story, keys\)/);
});

test('Transient model discovery error preserves selected model',()=>{
  const load=section(chat,'  function loadModels() {','  function studioAttachedStoryId() {');
  assert.match(load,/if \(state\.modelId\)/);
  assert.match(load,/retained\.value = state\.modelId/);
  assert.doesNotMatch(load,/\.catch\(function \(err\) \{\s*state\.modelsLoaded = true;\s*state\.modelId = ''/);
});

test('Readiness opens a single read-only detail and never assigns one Scene ID to multiple checks',()=>{
  assert.match(rail,/Scene \(current discussion\)/);
  const readiness=section(rail,'  function renderReadiness(list) {','  window.studioDirectorWorkbench =');
  assert.doesNotMatch(readiness.slice(readiness.indexOf('    list.forEach(function (item) {')),/recommendations\.sceneId/);
  assert.match(html,/id="studio-dw-assessment-dialog"/);
  assert.match(rail,/studio-dw-assessment-dialog'\)\.showModal/);
  assert.match(rail,/studio-dw-assessment-content'\)\.textContent = item\.content/);
  assert.doesNotMatch(html,/H3 Playbook · global model guidance/);
});

test('New chat and loaded session reset stale design selections without changing saved creative data',()=>{
  assert.match(chat,/window\.studioDirectorWorkbench\.resetConversation\(\)/);
  assert.match(rail,/writeOperationChosen = false/);
  assert.doesNotMatch(rail,/localStorage/);
});
