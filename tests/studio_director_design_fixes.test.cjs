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

test('Chat and Director mode initialization use controls present in the app shell', () => {
  const nodes = new Map(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => [match[1], {
    classList:{toggle(){},add(){},remove(){}},
    setAttribute(){},querySelector(){return {textContent:''};},textContent:''
  }]));
  const scope = vm.createContext({
    el:id=>nodes.get(id) || null,
    state:{activeMode:'chat',open:false,storyboardAttachments:{},workshop:null},
    document:{querySelector:()=>nodes.get('storyboard-workspace')},
    studioDirectorSelectedScene:()=>null,
    availableModes:()=>[],activeContextMode:()=>null,modeAvailable:()=>true,
    persistentMode:()=>true,studioWorkingStoryLabel:()=>'Test Project',
    storyboardContextPresets:()=>[],renderStoryboardAttachmentViewer(){},
    renderStudioStoryAccess(){},renderStudioOperations(){},renderMessages(){},syncControls(){}
  });
  vm.runInContext(section(chat,'  function syncModeUi() {',
    '  function studioWorkspaceVisible() {'),scope);
  for (const [mode, title] of [['chat','Assistant'],['storyboard','Test Project']]) {
    scope.state.activeMode = mode;
    scope.syncModeUi();
    assert.equal(nodes.get('director-chat-title').textContent,title);
  }
});

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

test('Studio-specific Undo controls have been replaced by the shared textarea navigator', () => {
  assert.doesNotMatch(html,/id="studio-dw-undo"|id="studio-dw-undo-button"/);
  assert.doesNotMatch(rail,/studioDirectorBridge\.undoBrief\(\)|setUndo: function/);
  assert.doesNotMatch(chat,/undoBrief: function|studioBriefUndo/);
  assert.match(html,/\/static\/js\/textarea_revisions\.js/);
  assert.match(rail,/resetConversation: function/);
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

test('operational errors reveal Advanced and preserve the shared Console detail',()=>{
  const nodes={},classes=new Set(),logs=[];
  const el=id=>nodes[id] ||= {dataset:{},attrs:{},classList:{toggle(){},add:x=>classes.add(x)},setAttribute(k,v){this.attrs[k]=v;}};
  const scope=vm.createContext({el,window:{reportConsoleError:(label,error)=>logs.push(error.message),reportConsoleInfo:()=>{}}});
  vm.runInContext(section(rail,'  function status(message, error, showSuccess) {','  function option('),scope);
  scope.status('Draft failed: exact backend error',true);
  assert.equal(classes.has('studio-actions-open'),true);
  assert.equal(el('studio-dw-open-tools').attrs['aria-expanded'],'true');
  assert.equal(el('studio-dw-status').textContent,'Draft failed: exact backend error');
  assert.deepEqual(logs,['Draft failed: exact backend error']);
  scope.status('Saved Scene 1',false,true);
  assert.equal(el('studio-dw-status').textContent,'Saved Scene 1');
});

test('Write opens without preparing a manual operation or starting a request',()=>{
  const nodes={};
  function node(id) {
    const classes=new Set();
    return nodes[id] ||= {attrs:{},classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}},
      setAttribute(k,v){this.attrs[k]=v;},focus(){this.focused=true;},click(){this.onclick();}};
  }
  let selected=0, availability=0;
  node('studio-dw-write-panel').classList.add('hidden');
  const a=rail.indexOf('    function openDirectAction(which) {');
  const b=rail.indexOf("    rail.addEventListener('keydown'",a);
  const scope=vm.createContext({el:node,lastQuickAction:'write',updateScope(){},showConversationWrite(){availability++;},refreshWrite:async()=>{selected++;}});
  vm.runInContext(section(rail,'  function toggle(which) {','  function parseProposal(raw) {')+rail.slice(a,b),scope);
  node('studio-dw-write').onclick=()=>scope.toggle('write');
  node('studio-dw-open-tools').click();
  assert.equal(selected,0,'opening Write must not prepare a manual operation');
  assert.equal(availability,1);
  assert.equal(node('studio-dw-open-tools').attrs['aria-expanded'],'true');
  assert.equal(node('director-chat-drawer').classList.contains('studio-actions-open'),true);
  node('studio-dw-open-tools').click();
  assert.equal(node('studio-dw-open-tools').attrs['aria-expanded'],'false');
  assert.equal(node('director-chat-drawer').classList.contains('studio-actions-open'),false);
  assert.equal(node('studio-dw-open-tools').focused,true);
  node('studio-dw-open-tools').click();
  assert.equal(selected,0,'reopening Write remains passive');
});

test('Read preview and outbound values use the same validated field serializer', () => {
  const body=section(rail,'  function readPayload(story, keys) {','  function updateReadSelection() {');
  const scope={projectFields:['title','concept','style','invariants'],storyName:story=>story.title};
  vm.createContext(scope);
  vm.runInContext(body,scope);
  const story={id:'p1',title:'The Interview',updatedAt:'now',concept:'A specific premise',
    scenes:{s1:{title:'Question',summary:'Tense dialogue',prompt:'Close-up'}},sceneOrder:['s1']};
  const result=scope.readPayload(story,['project.concept','scene:s1:prompt']);
  assert.equal(result.fields.length,2);
  assert.equal(result.fields[0].value,'A specific premise');
  assert.equal(result.fields[1].value,'Close-up');
  assert.throws(()=>scope.readPayload(story,['scene:missing:prompt']),/not in this Project/);
  assert.match(rail,/readPayload\(story, keys\)/);
  assert.match(rail,/sendRead\(payload, keys, typeof instruction === 'string' \? instruction : undefined\)/);
});

test('Read receipt uses delivery and response status, not model text parsing',()=>{
  assert.match(chat,/var fieldCount = state\.pendingReadAck\.length/);
  assert.match(chat,/setReadStatus\('success', feedback\)/);
  assert.doesNotMatch(chat,/Director acknowledgement mismatch/);
  assert.match(rail,/setReadStatus:function\(state,detail\)/);
  assert.doesNotMatch(chat,/director-chat-read-receipt/);
});

test('Select entire Project reuses Read selection and shows size without rejecting it',()=>{
  assert.match(html,/id="studio-dw-read-all"/);
  assert.match(rail,/function selectEntireReadProject\(\)/);
  assert.match(rail,/toggle\.groupPaths\.forEach/);
  assert.match(rail,/updateReadSelection\(\)/);
  assert.match(rail,/bytes\.toLocaleString\(\)/);
  assert.doesNotMatch(rail,/length > 48000/);
  assert.match(rail,/readPayload\(story, keys\)/);
});

test('Transient model discovery error preserves selected model',()=>{
  const load=section(chat,'  function loadModels() {','  function studioAttachedStoryId() {');
  assert.match(load,/if \(state\.modelId\)/);
  assert.match(load,/retained\.value = state\.modelId/);
  assert.doesNotMatch(load,/\.catch\(function \(err\) \{\s*state\.modelsLoaded = true;\s*state\.modelId = ''/);
});

test('New chat and loaded session reset stale design selections without changing saved creative data',()=>{
  assert.match(chat,/window\.studioDirectorWorkbench\.resetConversation\(\)/);
  assert.match(rail,/writeOperationChosen = false/);
  assert.doesNotMatch(rail,/localStorage/);
});


test('Write availability follows a conversational proposal without inventing a manual task', () => {
  const nodes = new Map();
  function el(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      nodes.set(id, {textContent:'',classList:{
        contains:name=>classes.has(name),
        toggle(name,on){ if (on) classes.add(name); else classes.delete(name); }
      }});
    }
    return nodes.get(id);
  }
  const scope = vm.createContext({el});
  vm.runInContext(section(rail,'  var pendingCreativeAction = null;',
    '  function sceneIdsFromRequest('),scope);
  scope.showConversationWrite();
  assert.equal(el('studio-dw-write-empty').classList.contains('hidden'),false);
  assert.equal(el('studio-dw-write-panel').classList.contains('hidden'),true);
  assert.equal(el('studio-dw-write-ready').classList.contains('hidden'),true);
  scope.pendingCreativeAction = {kind:'write_scenes',instruction:'Make the ending quieter.'};
  scope.showConversationWrite();
  assert.equal(el('studio-dw-write-empty').classList.contains('hidden'),true);
  assert.equal(el('studio-dw-write-ready').classList.contains('hidden'),false);
  assert.equal(el('studio-dw-write-ready-title').textContent,'Revise Scenes');
  assert.equal(el('studio-dw-write-ready-direction').textContent,'Make the ending quieter.');
  assert.equal(el('studio-dw-write-panel').classList.contains('hidden'),true);
  scope.pendingCreativeAction.awaitingScenes = true;
  scope.showConversationWrite();
  assert.equal(el('studio-dw-write-panel').classList.contains('hidden'),false);
  assert.equal(el('studio-dw-write-panel').classList.contains('studio-dw-awaiting-scenes'),true);
  scope.pendingCreativeAction = null;
  scope.showConversationWrite();
  assert.equal(el('studio-dw-write-ready').classList.contains('hidden'),true);
});

test('Studio header uses accessible compact history and new-conversation icons', () => {
  assert.match(html,/id="director-chat-history-toggle"[^>]*aria-label="Conversation history"/);
  assert.match(html,/id="director-chat-clear"[^>]*aria-label="New conversation"/);
  assert.match(css,/studio-director \.studio-director-breadcrumb \{display:none;/);
  assert.match(rail,/function showConversationWrite\(\)/);
  assert.doesNotMatch(section(rail,'  function toggle(which) {','  function parseProposal(raw) {'),
    /seedManualSceneInstruction\(\)/);
});


test('conversation Scene targets support Select all and Deselect all without guessing', () => {
  assert.match(html,/id="studio-dw-scenes-select-all"/);
  assert.match(html,/id="studio-dw-scenes-select-none"/);
  assert.match(rail,/if \(Array\.isArray\(frozen\.chosenSceneIds\)\)/);
  const nodes = {
    'studio-dw-batch-scenes': {
      querySelectorAll:()=>[a,b,c]
    }
  };
  const a={value:'scene-a',checked:false};
  const b={value:'scene-b',checked:false};
  const c={value:'scene-c',checked:false};
  const scope=vm.createContext({el:id=>nodes[id],sceneSelectionManual:false,
    pendingCreativeAction:{awaitingScenes:true},showWriteContext(){}});
  vm.runInContext(section(rail,'  function selectWriteScenes(checked) {',
    '  function refreshRead() {'),scope);
  scope.selectWriteScenes(true);
  assert.deepEqual(Array.from(scope.pendingCreativeAction.chosenSceneIds),
    ['scene-a','scene-b','scene-c']);
  assert.equal([a,b,c].every(x=>x.checked),true);
  scope.selectWriteScenes(false);
  assert.deepEqual(Array.from(scope.pendingCreativeAction.chosenSceneIds),[]);
  assert.equal([a,b,c].some(x=>x.checked),false);
  assert.equal(scope.sceneSelectionManual,true);
});

test('restoring a conversation recovers its last unsaved Write proposal with frozen target', () => {
  const restored = [], nodes = new Map();
  const el = id => {
    if (!nodes.has(id)) nodes.set(id,{dataset:{},value:''});
    return nodes.get(id);
  };
  const scope=vm.createContext({
    state:{
      activeMode:'storyboard',sessionByMode:{},sessionActiveByMode:{},
      modeMessages:{},modeElapsedByAssistantIndex:{},modeMetricsByAssistantIndex:{},
      storyboardAttachments:{},draftByMode:{},sessionDirty:{},sessionError:false
    },
    el, persistentMode:()=>true,upsertSessionSummary(){},showSessionStatus(){},
    syncModeUi(){},window:{studioDirectorWorkbench:{
      resetConversation(){restored.push(['reset']);},
      presentAction:(...args)=>restored.push(args)
    }}
  });
  vm.runInContext(section(chat,'  function restoreSession(chat) {',
    '  function loadSessionHistory() {'),scope);
  const action={kind:'write_scenes',instruction:'Make the ending quieter.',
    request:'Revise Scene 2',fields:['prompt'],projectId:'project-1',
    scene:{projectId:'project-1',sceneId:'scene-2',sceneNumber:2}};
  const messages=[
    {role:'user',content:'Revise Scene 2'},
    {role:'assistant',content:'I can revise that.',writeAction:action},
    {role:'user',content:'Why does that work?'},
    {role:'assistant',content:'It reduces movement.'}
  ];
  scope.restoreSession({id:'chat-1',mode:'storyboard',messages,draft:'',
    workingDraft:{scenes:{'scene-2':{prompt:'Already prepared'}}}});
  assert.equal(restored.length,2);
  assert.equal(restored[1][0].instruction,'Make the ending quieter.');
  assert.equal(restored[1][1].sceneId,'scene-2');
  assert.equal(restored[1][4],1,'original answer index is preserved');
  assert.equal(scope.state.studioWorkingDraft.scenes['scene-2'].prompt,'Already prepared');
  restored.length=0;
  scope.restoreSession({id:'chat-2',mode:'storyboard',messages:messages.concat([
    {role:'user',content:'Saved unrelated Project: Visual atmosphere [WEBCAP APPLIED FIELD VALUES]'}
  ]),draft:''});
  assert.equal(restored.length,2,'unrelated saved receipt must preserve pending Write');
  restored.length=0;
  scope.restoreSession({id:'chat-3',mode:'storyboard',messages:messages.map(message=>
    message.writeAction ? {...message,writeAction:{...message.writeAction,completed:true}} : message
  ),draft:''});
  assert.equal(restored.length,1,'completed action is not offered again');
});

test('conversation persistence includes frozen Write targets without extra authoring calls', () => {
  assert.match(chat,/stored\.writeAction = message\.writeAction/);
  assert.match(chat,/messages\[messages\.length - 1\]\.writeAction = window\.studioDirectorWorkbench\.presentAction/);
  assert.ok(chat.includes('completeWriteAction(kind, story, selected)'));
});
