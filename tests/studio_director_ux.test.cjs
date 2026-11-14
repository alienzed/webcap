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

test('Overview Review leads with changed parts and retains the same editable nodes for other parts',()=>{
  const node=()=>({children:[],classList:{toggle(){}},
    appendChild(child){if(child.parent) child.parent.children.splice(child.parent.children.indexOf(child),1);this.children.push(child);child.parent=this;},
    insertBefore(child,before){if(child.parent) child.parent.children.splice(child.parent.children.indexOf(child),1);this.children.splice(this.children.indexOf(before),0,child);child.parent=this;},
    querySelector:()=>true});
  const parts=node(),other=node(),sections={};
  parts.appendChild(other);
  for(const name of ['title','concept','style','invariants']){
    const section={dataset:{changed:String(['concept','style'].includes(name))},value:name};
    sections[name]=section;parts.insertBefore(section,other);
  }
  const scope=vm.createContext({el:id=>id==='studio-brief-parts'?parts:id==='studio-brief-unchanged'?other:
    {closest:()=>sections[id.replace('studio-brief-','').replace('-state','')]}});
  vm.runInContext(part(chat,'  function groupStudioBriefReviewParts() {','  function prepareStudioBrief() {'),scope);
  scope.groupStudioBriefReviewParts();
  assert.deepEqual(parts.children,[sections.concept,sections.style,other]);
  assert.deepEqual(other.children,[sections.title,sections.invariants]);
  assert.equal(sections.title.value,'title');
  sections.invariants.dataset.changed='true';
  scope.groupStudioBriefReviewParts();
  assert.deepEqual(parts.children,[sections.concept,sections.style,sections.invariants,other]);
  assert.deepEqual(other.children,[sections.title]);
  assert.doesNotMatch(part(chat,'  function updateStudioBriefReviewSummary() {','  function groupStudioBriefReviewParts() {'),/groupStudioBriefReviewParts\(/,
    'typing and selection updates must not reparent focused editors');
});

test('editing retained Overview text includes the edit without requiring a second checkbox action',()=>{
  const elements={};
  for(const key of ['title','concept','style']){
    elements['studio-brief-'+key]={addEventListener(event,fn){this[event]=fn;}};
    elements['studio-brief-'+key+'-selected']={checked:false};
  }
  const code=part(chat,"    ['title','concept','style'].forEach(function (key) {","    ['input','change','click'].forEach");
  vm.runInContext(code,vm.createContext({el:id=>elements[id]}));
  elements['studio-brief-title'].input();
  assert.equal(elements['studio-brief-title-selected'].checked,true);
  assert.equal(elements['studio-brief-style-selected'].checked,false);
  elements['studio-brief-title-selected'].checked=false;
  assert.equal(elements['studio-brief-title-selected'].checked,false,'author can exclude the change explicitly');
});

test('Director is stable on outside clicks and Escape; general Assistant retains dismissal',()=>{
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
  assert.equal(closes,2,'a Projects work surface stays open until explicit navigation');
});

test('Project review summary follows edits and selection without changing either',()=>{
  const elements={};
  const before={title:'Last Light',concept:'A lamp glows.',style:'Blue dusk.',invariants:[{kind:'character',text:'Keeper',title:'Mara'}]};
  for (const key of ['title','concept','style','invariants']) {
    elements['studio-brief-'+key]={value:before[key]};
    elements['studio-brief-'+key+'-selected']={checked:key!=='title'};
    const section={dataset:{}};
    elements['studio-brief-'+key+'-state']={closest:()=>section};
  }
  elements['studio-brief-concept'].value='The keeper receives a reply.';
  elements['studio-brief-invariants'].querySelectorAll=()=>[
    {querySelectorAll:()=>[{value:'character'},{value:'Mara'},{value:'Keeper'}]}
  ];
  elements['studio-brief-summary']={};
  const scope=vm.createContext({state:{studioBriefProposal:{expected:before}},el:id=>elements[id],
    studioDirectorRenderDiff:()=>{}});
  vm.runInContext(part(chat,'  function updateStudioBriefReviewSummary() {','  function prepareStudioBrief() {'),scope);
  scope.updateStudioBriefReviewSummary();
  assert.match(elements['studio-brief-concept-state'].textContent,/Changed · selected/);
  assert.match(elements['studio-brief-title-state'].textContent,/Unchanged · not selected/);
  assert.match(elements['studio-brief-invariants-state'].textContent,/Unchanged/,'JSON key order is not a creative change');
  assert.equal(elements['studio-brief-summary'].textContent,'Selected: Concept · Visual / atmosphere · Invariants (1)');
  elements['studio-brief-style-selected'].checked=false;
  scope.updateStudioBriefReviewSummary();
  assert.equal(elements['studio-brief-summary'].textContent,'Selected: Concept · Invariants (1)');
  assert.equal(elements['studio-brief-concept'].value,'The keeper receives a reply.');
});

test('identical Invariants are not preselected because JSON properties arrived in another order',()=>{
  const checkbox={checked:true};
  const existing=[{kind:'character',text:'Keeper',title:'Mara'}];
  const reviewed=[{item:{kind:'character',title:'Mara',text:'Keeper'}}];
  const scope=vm.createContext({el:()=>checkbox,existing,reviewed});
  const code=part(chat,"    el('studio-brief-invariants-selected').checked = reviewed.length","    el('studio-brief-invariants').replaceChildren();");
  vm.runInContext(code,scope);
  assert.equal(checkbox.checked,false);
  reviewed[0].item.text='An older keeper.';
  vm.runInContext(code,scope);
  assert.equal(checkbox.checked,true);
});

test('contextual Prompt action uses the current route even when Write was aimed at another Project',async()=>{
  const elements={};
  const node=()=>({value:'',classList:{add(){},remove(){}},setAttribute(){}});
  for(const id of ['current-brief','current-prompt','write-project','write-operation','write-scene','read-panel','read','write-panel','write']) elements['studio-dw-'+id]=node();
  elements['studio-dw-write-project'].value='unrelated-project';
  elements['studio-dw-scene-mode']=node();
  const scenes=[{value:'current-scene',checked:false},{value:'other-scene',checked:true}];
  elements['studio-dw-batch-scenes']={querySelectorAll:()=>scenes};
  let prepared=false;
  const saved={id:'current-project'};
  const scope=vm.createContext({
    window:{studioDirectorBridge:{isReady:()=>true}},activeTarget:()=>({storyId:saved.id,sceneId:'current-scene'}),
    el:id=>elements[id],refreshProjects:async()=>{},loadStory:async id=>{assert.equal(id,saved.id);return saved;},
    renderWriteStory:story=>assert.equal(story,saved),setOperation(){},updateScope(){},status:message=>assert.fail(message),
    writePrepare:()=>{prepared=true;},writeOperationChosen:false,writeFieldsManuallyChanged:false
  });
  vm.runInContext(part(workbench,'  function prepareCurrentWrite(operation) {','  function writePrepare() {'),scope);
  await scope.prepareCurrentWrite('scene-write');
  assert.equal(elements['studio-dw-write-project'].value,saved.id);
  assert.equal(elements['studio-dw-scene-mode'].value,'revise');
  assert.equal(elements['studio-dw-batch-scenes'].querySelectorAll()[0].checked,true);
  assert.equal(elements['studio-dw-batch-scenes'].querySelectorAll()[1].checked,false);
  assert.equal(prepared,true);
});

test('ordinary discussion asks for concise new decisions while complete creative fields remain complete',()=>{
  assert.match(chat,/Keep readiness light: normally checks=\[\]/);
  assert.match(chat,/Keep assessment metadata in readiness and conversation in reply/);
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

test('Apply receipt names the actual scoped Scene fields and retains authoritative values',async()=>{
  const state={modeMessages:{storyboard:[]},sessionDirty:{}};
  const scope=vm.createContext({state,markStudioReadinessOutdated(){},renderMessages(){},persistSession:async()=>{},
    window:{studioDirectorWorkbench:{markSavedFields(){}}}});
  const bridge=vm.runInContext('({'+part(chat,'    recordApplied: function (kind, story, selected) {','    undoBrief: function () {')+'})',scope);
  await bridge.recordApplied('scene.update',{id:'project-1',title:'Project',updatedAt:'now'},
    {sceneId:'scene-1',savedFields:{prompt:'The reviewed prompt.'}});
  const message=state.modeMessages.storyboard[0].content;
  assert.match(message,/^Saved: H3 Prompt\./);
  const saved=JSON.parse(message.split('[WEBCAP APPLIED FIELD VALUES]')[1].split('[END WEBCAP APPLY]')[0]);
  assert.equal(saved.fields.savedFields.prompt,'The reviewed prompt.');
});

test('editable revision comparison identifies retained, removed and added words without mutating sources',()=>{
  const before='A woman walks toward the sink, then brushes her teeth.';
  const after='A woman brushes her teeth.';
  const elements=[];
  const host={children:[],replaceChildren(){this.children=[];},appendChild(n){this.children.push(n);}};
  const scope=vm.createContext({document:{createElement:tag=>{
    const element={tag,textContent:''};elements.push(element);return element;
  }}});
  vm.runInContext(part(chat,'  function studioDirectorRenderDiff(host, before, after) {',
    '  window.studioDirectorRenderDiff = studioDirectorRenderDiff;'),scope);
  scope.studioDirectorRenderDiff(host,before,after);
  assert.ok(host.children.some(n=>n.tag==='del'),'comparison visibly marks removed text');
  assert.ok(!host.children.some(n=>n.tag==='ins'),'pure deletion does not invent inserted words');
  assert.ok(host.children.some(n=>n.tag==='del' && n.textContent.includes('walks')),'extra movement is visibly removed');
  assert.ok(host.children.some(n=>n.tag==='span' && n.textContent.includes('woman')),'unchanged text stays identifiable');
  assert.equal(before,'A woman walks toward the sink, then brushes her teeth.');
  assert.equal(after,'A woman brushes her teeth.');
  scope.studioDirectorRenderDiff(host,'Same text','Same text');
  assert.equal(host.textContent,'No text changes.');
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
