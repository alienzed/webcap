const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const chat = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const workbench = fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
function part(source,start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,start);
  return source.slice(a,b);
}

test('Overview Write directly applies selected fields, with no Review editors',()=>{
  assert.match(chat,/function prepareStudioBrief\(options\)/);
  assert.match(chat,/function commitFocusedStudioBrief\(/);
  assert.doesNotMatch(chat,/showStudioBriefReview|groupStudioBriefReviewParts/);
  assert.doesNotMatch(html,/id="studio-brief-review"/);
});

test('Overview Write no longer requires a selection checkbox or second Apply',()=>{
  assert.doesNotMatch(html,/id="studio-brief-title-selected"|id="studio-brief-apply"/);
  assert.match(chat,/commitFocusedStudioBrief\(storyId,expected,parseStudioBriefDraft\(raw\),fields\)/);
});

test('Unpinned Studio Director auto-dismisses; pinned Director remains open',()=>{
  const handlers={};
  let modal={},closes=0;
  const scope=vm.createContext({state:{open:true,pinned:false},
    drawer:{contains:()=>false},toggle:{contains:()=>false},
    document:{querySelector:()=>modal,addEventListener:(name,fn)=>handlers[name]=fn},
    window:{addEventListener:(name,fn)=>handlers[name]=fn},setOpen:()=>closes++});
  vm.runInContext(part(chat,"    document.addEventListener('pointerdown'", "    window.addEventListener('beforeunload'"),scope);
  handlers.pointerdown({target:{}});
  handlers.keydown({key:'Escape'});
  assert.equal(closes,0,'modal click or Escape must leave Director open');
  modal=null;
  handlers.pointerdown({target:{}});
  handlers.keydown({key:'Escape'});
  assert.equal(closes,2,'ordinary dismissal remains available');
  scope.state.activeMode='storyboard';
  handlers.pointerdown({target:{}});
  handlers.keydown({key:'Escape'});
  assert.equal(closes,4,'unpinned Studio behaves like the floating Assistant');
  scope.state.pinned=true;
  handlers.pointerdown({target:{}});
  handlers.keydown({key:'Escape'});
  assert.equal(closes,4,'pinning keeps Studio Director open');
});

test('Project field changes do not create a separate Review state',()=>{
  assert.doesNotMatch(chat,/state\.studioBriefProposal|updateStudioBriefReviewSummary/);
  assert.doesNotMatch(html,/id="studio-brief-summary"/);
});

test('Invariants are returned as authored structured values, without a preselection judge',()=>{
  assert.match(chat,/Object\.prototype\.hasOwnProperty\.call\(authored,key\)/);
  assert.doesNotMatch(chat,/studio-brief-invariants-selected/);
});

test('ordinary discussion uses the natural-language Chat guidance, not structured Write',()=>{
  assert.match(chat,/studioDirectorChatRequestMessages\(messages\)/);
  assert.doesNotMatch(chat,/STUDIO CONVERSATION DELIVERY|These are drafts; WebCap decides/);
});

test('compact Director replies keep the exact full text and leave General Chat alone',()=>{
  const code=part(chat,"      if (studioReply && visibleText.length > 1200) {",
    "      if (message.role === 'user' && (message.content.indexOf('[WEBCAP EXPLICIT READ]')");
  const node=()=>({children:[],append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
  const message={role:'assistant',content:'A useful opening recommendation.\n\n'+('Complete creative details with "quotes" and line breaks.\n').repeat(40)};
  const body=node();
  const scope=vm.createContext({studioReply:true,visibleText:message.content,message,body,document:{createElement:node}});
  vm.runInContext(code,scope);
  assert.equal(body.children[0].textContent,'A useful opening recommendation.');
  assert.equal(body.children[1].children[1].textContent,message.content);
  const general=node();
  scope.body=general;
  scope.studioReply=false;
  vm.runInContext(code,scope);
  assert.equal(general.children.length,0);
});

test('direct Write receipts describe actual saved fields without embedding creative payload',async()=>{
  const state={modeMessages:{storyboard:[]},sessionDirty:{storyboard:false}};
  const scope=vm.createContext({state,JSON,String,Object,Promise,renderMessages(){},
    persistSession:async()=>{},
    window:{studioDirectorWorkbench:{markSavedFields(){}}}});
  const record=part(chat,'    recordApplied: function (kind, story, selected) {',
    '    checkProjectCoherence: function');
  const bridge=vm.runInContext('({'+record.trim().replace(/,$/,'')+'})',scope);
  await bridge.recordApplied('scene.director.revision',
    {id:'project-1',title:'Project',updatedAt:'now'},
    {sceneId:'scene-1',savedFields:{prompt:'The new prompt.'}});
  const message=state.modeMessages.storyboard[0].content;
  assert.match(message,/\[WEBCAP APPLIED FIELD VALUES\]/);
  assert.match(message,/scene.director.revision/);
  assert.doesNotMatch(message,/The new prompt\./);
});

test('History replaces the previous Review-only text diff',()=>{
  assert.doesNotMatch(chat,/studioDirectorRenderDiff/);
  const history=fs.readFileSync('tool/js/textarea_revisions.js','utf8');
  assert.match(history,/function step\(direction\)/);
  assert.match(history,/recordFieldChange/);
  assert.match(history,/dispatchEvent\(new Event\('input'/);
});

test('field update indicators identify the saved Project, and clear after author edits',()=>{
  const controls={};
  for(const id of ['studio-dw-write','storyboard-story-title',
    'storyboard-story-concept','storyboard-story-style']){
    controls[id]={dataset:{},title:'',addEventListener(event,fn){this[event]=fn;}};
  }
  const logs=[];
  const scope=vm.createContext({
    el:id=>controls[id],activeTarget:()=>({storyId:'current-project'}),
    storyName:story=>story.title,window:{reportConsoleInfo:(source,message)=>logs.push(message)}
  });
  const code=part(workbench,'    markSavedFields:function(selected,story){',
    '    setReadStatus:function(state,detail){');
  const receiver=vm.runInContext('({'+code+'})',scope);
  receiver.markSavedFields({concept:'New concept'},{id:'different-project',title:'Other Project'});
  assert.equal(controls['storyboard-story-concept'].dataset.directorUpdated,undefined,
    'an update to another Project must not mark the open Concept as saved');
  assert.match(controls['studio-dw-write'].title,/Other Project/);
  receiver.markSavedFields({concept:'Current concept'},{id:'current-project',title:'Current Project'});
  assert.equal(controls['storyboard-story-concept'].dataset.directorUpdated,'true');
  assert.match(controls['storyboard-story-concept'].title,/Updated by Studio Director/);
  controls['storyboard-story-concept'].input();
  assert.equal(controls['storyboard-story-concept'].dataset.directorUpdated,undefined,
    'manual editing clears the recent Studio Director update indication');
  assert.ok(logs.some(line=>line.includes('Current Project')));
});

test('routine operation feedback does not leave a separate status card in the chat workbench',()=>{
  const status={classList:{hidden:false,toggle(name,flag){if(name==='hidden')this.hidden=flag;}},dataset:{},textContent:''};
  const messages=[];
  const scope=vm.createContext({state:{activeMode:'storyboard'},
    el:()=>status,window:{studioDirectorWorkbench:{setStatus:(text,error)=>messages.push([text,error])}}});
  vm.runInContext(part(chat,'  function studioActionStatus(message, error) {',
    '  function parseStudioProjectDraft(raw) {'),scope);
  scope.studioActionStatus('Director acknowledged selected fields.',false);
  assert.equal(status.classList.hidden,true);
  assert.equal(status.textContent,'');
  assert.equal(messages.length,1);
  scope.studioActionStatus('Director read failed.',true);
  assert.equal(status.classList.hidden,false);
  assert.equal(status.textContent,'Director read failed.');
});

test('field update indication clears when the Storyboard opens another Project',()=>{
  const elements={};
  const node=()=>({dataset:{},title:'',value:'',disabled:false,textContent:'',
    classList:{contains:()=>true}});
  for(const id of ['storyboard-story-title','storyboard-story-concept','storyboard-story-style',
    'studio-dw-current-brief','studio-dw-current-prompt','studio-dw-read-project',
    'studio-dw-write-project','studio-dw-write-operation','studio-dw-write-scope',
    'studio-dw-read-panel','studio-dw-write-panel','studio-dw-heading']) elements[id]=node();
  elements['storyboard-story-concept'].dataset.directorUpdated='true';
  elements['storyboard-story-concept'].dataset.directorUpdatedProject='project-a';
  elements['storyboard-story-concept'].title='Updated by Studio Director — Concept';
  const scope=vm.createContext({el:id=>elements[id],projects:[],lastReadSource:null,
    activeTarget:()=>({storyId:'project-b'}),window:{studioDirectorBridge:{isReady:()=>true}}});
  vm.runInContext(part(workbench,'  function updateScope() {','  function setOperation() {'),scope);
  scope.updateScope();
  assert.equal(elements['storyboard-story-concept'].dataset.directorUpdated,undefined);
  assert.equal(elements['storyboard-story-concept'].dataset.directorUpdatedProject,undefined);
  assert.equal(elements['storyboard-story-concept'].title,'');
  assert.match(fs.readFileSync(path.join(__dirname,'../tool/js/storyboard.js'),'utf8'),
    /window\.studioDirectorWorkbench\.updateContext\(\)/,
    'Storyboard refresh must invoke the existing Studio context sync');
});

test('Scene Intent stays in Project storage, not the active editor or save payload',()=>{
  const storyboard=require('node:fs').readFileSync(require('node:path').join(__dirname,'../tool/js/storyboard.js'),'utf8');
  assert.doesNotMatch(storyboard,/data-scene-field="summary"/);
  assert.doesNotMatch(storyboard,/summary: field\('summary'\)\.value/);
  assert.match(workbench,/var contextFields = \['title', 'prompt', 'durationSeconds'\]/);
});
test('Director reads Prompt even when a legacy Scene has no authored Prompt',()=>{
  const slice=part(workbench,'    sceneRead: function (story, sceneId) {','    applyScenePrompt: function (story, sceneId, prompt, extraChanges) {');
  const scope=vm.createContext({projectFields:['title','concept','style','invariants'],
    readPayload:(_story,keys)=>({fields:keys})});
  vm.runInContext('var bridge={'+slice+'};',scope);
  const story={sceneOrder:['ready','draft'],scenes:{
    ready:{title:'Full',summary:'Older idea',prompt:'Complete H3 Prompt'},
    draft:{title:'Outline',summary:'Initial plan',prompt:''}
  }};
  const ready=scope.bridge.sceneRead(story,'ready').keys;
  const draft=scope.bridge.sceneRead(story,'draft').keys;
  assert.ok(ready.includes('scene:ready:prompt'));
  assert.ok(!ready.includes('scene:ready:summary'));
  assert.ok(draft.includes('scene:draft:prompt'));
  assert.ok(!draft.includes('scene:draft:summary'));
});


test('archived structured conversations remain readable but cannot launch Write actions',()=>{
  const scope=vm.createContext({JSON,String,Error});
  vm.runInContext(part(chat,'  function parseStudioChatResponse(raw) {',
    '  function storyboardRequestMessages('),scope);
  const reply=scope.parseStudioChatResponse(JSON.stringify({
    reply:'An earlier proposal.',action:{kind:'create_scene'},
    scenes:[{title:'Old',prompt:'Old Prompt',durationSeconds:8}]
  }));
  assert.equal(reply.reply,'An earlier proposal.');
  assert.deepEqual(Object.keys(reply),['reply']);
});

test('new-Scene Write passes actual Scene records to the save endpoint',()=>{
  const method=part(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function (launch) {');
  assert.match(method,/authored\.scenes\.map/);
  assert.match(method,/\/fs\/studio\/director\/scenes-draft/);
  assert.doesNotMatch(method,/showStudioScenesReview|sourceMessageIndex|launch\.directSave/);
});

test('Create Scene invokes one focused model operation without Review',()=>{
  const method=part(chat,'    writeNewScene: function (launch) {',
    '    writeSelectedScene: function (launch) {');
  assert.match(method,/makeProposal\(task,'studio_scenes_draft',true/);
  assert.match(method,/recordApplied\('scene.create'/);
  assert.doesNotMatch(method,/reviewAuthoredScenes|sourceMessageIndex|showStudioScenesReview/);
});
