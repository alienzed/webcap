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
    window:{studioDirectorWorkbench:{updateWorkingWrite(){}}},
    studioDirectorSelectedScene:()=>null,studioRevisionActive:()=>false,
    availableModes:()=>[],activeContextMode:()=>null,modeAvailable:()=>true,
    persistentMode:()=>true,studioWorkingStoryLabel:()=>'Test Project',
    storyboardContextPresets:()=>[],syncStudioRevisionUi(){},renderStoryboardAttachmentViewer(){},
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

test('Write panel remains passive until the explicit prepare click',()=>{
  assert.match(rail,/function toggle\(which\)/);
  assert.match(rail,/function writePrepare\(options\)/);
  const open=section(rail,'  function toggle(which) {','  function parseProposal(raw) {');
  assert.doesNotMatch(open,/makeProposal\(|writeNewScene\(|writeSelectedScene\(/);
  assert.match(rail,/studio-dw-write-prepare/);
});

test('Share Details opens the original Read sidebar and indicates approved context',()=>{
  assert.match(html,/id="director-chat-context-approve"/);
  assert.match(rail,/el\('director-chat-context-approve'\)\.onclick=function \(\) \{openDirectAction\('read'\);\}/);
  assert.match(chat,/state\.studioApprovedRead \? 'Context ✓' : 'Share Details…'/);
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
  assert.match(rail,/studioDirectorBridge\.approveRead\(story\.id, keys\)/);
  assert.match(html,/id="studio-dw-read" type="button"/);
  assert.match(html,/Approve context<\/button>/);
  assert.match(html,/id="studio-dw-read-clear"/);
  assert.match(rail,/studioDirectorBridge\.clearApprovedRead\(\)/);
  assert.match(chat,/clearApprovedRead: function \(\)/);
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


test('Write is an explicit operation picker, not a model-suggested action surface',()=>{
  assert.doesNotMatch(rail,/showConversationWrite|pendingCreativeAction/);
  assert.doesNotMatch(html,/id="studio-dw-write-ready"|id="studio-dw-suggestions"/);
  assert.match(html,/id="studio-dw-write-operation"/);
});

test('Studio header retains conversation controls independent of Write',()=>{
  assert.match(html,/id="director-chat-history-toggle"[^>]*aria-label="Conversation history"/);
  assert.match(html,/id="director-chat-clear"[^>]*aria-label="New conversation"/);
  assert.doesNotMatch(rail,/showConversationWrite/);
  assert.match(rail,/function setOperation\(\)/);
});

test('Scene target checkboxes support Select all and Deselect all without LLM targeting',()=>{
  assert.match(html,/id="studio-dw-scenes-select-all"/);
  assert.match(html,/id="studio-dw-scenes-select-none"/);
  const selections=[{value:'a',checked:false},{value:'b',checked:false}];
  const scope=vm.createContext({el:id=>id==='studio-dw-batch-scenes'
    ? {querySelectorAll:()=>selections}:null,
    showWriteContext(){},sceneSelectionManual:false,Array});
  vm.runInContext(section(rail,'  function selectWriteScenes(checked) {',
    '  function renderApprovedSources() {'),scope);
  scope.selectWriteScenes(true);
  assert.ok(selections.every(x=>x.checked));
  scope.selectWriteScenes(false);
  assert.ok(selections.every(x=>!x.checked));
  assert.equal(scope.sceneSelectionManual,true);
});

test('restored old messages are inert archive data, not Write suggestions',()=>{
  assert.doesNotMatch(chat,/studioRestoreAuthoredAction|studioStoredActions|studioAuthoredWriteActions/);
  assert.doesNotMatch(rail,/presentAction|pendingCreativeAction/);
  assert.match(chat,/function parseStudioChatResponse\(raw\)/);
});

test('conversation persistence never stores executable LLM-generated Write actions',()=>{
  assert.doesNotMatch(chat,/stored\.writeAction\s*=|stored\.otherWriteActions\s*=/);
  assert.doesNotMatch(chat,/completeWriteAction\(/);
  assert.match(chat,/state\.modeMessages\.storyboard/);
});

test('new Write binds explicit destination rather than a retained draft',()=>{
  assert.doesNotMatch(chat,/preparedWrite: function|reviewPreparedWrite: function/);
  assert.doesNotMatch(chat,/state\.studioWorkingDraft/);
  assert.match(rail,/function writePrepare\(options\)/);
  assert.match(rail,/var id = el\('studio-dw-write-project'\)\.value/);
});

test('Studio Revision mode dispatches the existing Storyboard revision operation with explicit scope', async () => {
  const nodes=new Map();
  const el=id=>{
    if (!nodes.has(id)) nodes.set(id,{
      value:'',checked:false,focus(){},classList:{toggle(){}},textContent:'',
      dispatchEvent(){},readOnly:false
    });
    return nodes.get(id);
  };
  const calls=[];
  const scope=vm.createContext({
    el,state:{activeMode:'storyboard',modelId:'director-model'},
    window:{
      getStudioDirectorNavigation:()=>({projectId:'project-1',projectTitle:'Test',sceneOrder:['scene-a','scene-b']}),
      startStudioRevision:async options=>{calls.push(options);},
      storyboardRevisionPreset:key=>key==='continuity'?'Keep continuity':'',
      reportConsoleError:error=>{throw error;}
    },syncControls(){},setOpen(){}
  });
  vm.runInContext(section(chat,'  var studioComposerMode = \'conversation\';',
    '  function syncModeUi() {'),scope);
  scope.studioComposerMode='revision';
  el('director-studio-revision-preset').value='continuity';
  el('director-studio-revision-input').value='Correct continuity in both Scenes';
  el('director-studio-revision-fresh').checked=true;
  scope.runStudioRevision();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);
  assert.equal(calls[0].projectId,'project-1');
  assert.equal(calls[0].modelId,'director-model');
  assert.equal(calls[0].preset,'continuity');
  assert.equal(calls[0].generateFreshTakes,true);
  assert.equal(calls[0].instruction,'Correct continuity in both Scenes');
  assert.equal(el('director-studio-revision-status').textContent,'Scene revision completed.');
  scope.studioComposerMode='revision'; // Reopen the ephemeral operation after the first run completes.
  el('director-studio-revision-preset').value='coherence';
  el('director-studio-revision-input').value='';
  scope.runStudioRevision();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2,'coherence does not require a text instruction');
  assert.equal(calls[1].preset,'coherence');
  assert.equal(el('director-chat-input').value,'','revision has not changed the chat composer draft');
});

test('Studio Revise Scenes launcher uses the common Director composer', () => {
  const storyboard=fs.readFileSync(path.join(base,'tool/js/storyboard.js'),'utf8');
  assert.match(storyboard,/storyboard-director-tools-btn'\)\.onclick = function \(\) \{\s*window\.openStudioDirectorRevision\(\)/);
  assert.match(storyboard,/window\.startStudioRevision = function \(options\)/);
  assert.match(storyboard,/return reviseScenes\(options\.instruction, options\.modelId/);
  assert.match(html,/id="director-studio-composer-mode-select"/);
  assert.match(html,/id="director-studio-revision-fresh"/);
});

test('Studio operation mode hides conversation without deleting history, and pin remains available',()=>{
  const header=html.split('<div class="director-chat-header-actions">')[1].split('</header>',1)[0];
  assert.match(header,/id="director-studio-composer-mode-select"/);
  assert.match(header,/id="director-chat-pin"/);
  assert.match(css,/\.director-chat-drawer\.studio-director\.studio-revision-mode \.director-chat-messages/);
  assert.match(css,/\.app-frame\.director-chat-pinned\.studio-director-active > \.director-chat-drawer\.studio-director/);
  assert.match(chat,/drawer\.classList\.toggle\('studio-revision-mode', revision\)/);
  assert.match(html,/id="storyboard-open-director"[^>]*class="review-captions-btn hidden"/);
  assert.match(chat,/if \(studio\) toggle\.focus\(\)/);
});

test('Scene plus menu anchors to its button and flips above the viewport edge', () => {
  const storyboard = fs.readFileSync(path.join(base, 'tool/js/storyboard.js'), 'utf8');
  const css = fs.readFileSync(path.join(base, 'tool/css/storyboard.css'), 'utf8');
  const position = section(storyboard,
    '  function positionSceneActionMenu(menu, pointer) {', '  var STORY_RAIL_ICONS =');
  const menu = {open:true, classList:{contains:name=>name === 'storyboard-add-scene'}};
  const popover = {offsetWidth:190, offsetHeight:100, style:{}};
  const anchor = {getBoundingClientRect:()=>({left:850,right:892,top:650,bottom:692})};
  menu.querySelector = selector => selector === 'summary' ? anchor :
    selector === '.storyboard-add-scene-menu' ? popover : null;
  const scope = vm.createContext({window:{innerWidth:1000,innerHeight:700}});
  vm.runInContext(position, scope);
  scope.positionSceneActionMenu(menu);
  assert.equal(popover.style.left, '702px');
  assert.equal(popover.style.top, '546px', 'menu flips above the plus button');
  assert.ok(css.includes('.storyboard-add-scene-menu {') && css.includes('position:fixed;'));
  assert.ok(storyboard.includes('positionSceneActionMenu(addDetails);'));
});
