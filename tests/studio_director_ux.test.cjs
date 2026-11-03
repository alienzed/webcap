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

test('review dialogs and request inspection preserve Director; ordinary outside clicks still close it',()=>{
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
  const scope=vm.createContext({state:{studioBriefProposal:{expected:before}},el:id=>elements[id]});
  vm.runInContext(part(chat,'  function updateStudioBriefReviewSummary() {','  function prepareStudioBrief(writeFields) {'),scope);
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
  const code=part(chat,"    el('studio-brief-invariants-selected').checked = reviewed.length",'    if (Array.isArray(writeFields)');
  vm.runInContext(code,scope);
  assert.equal(checkbox.checked,false);
  reviewed[0].item.text='An older keeper.';
  vm.runInContext(code,scope);
  assert.equal(checkbox.checked,true);
});

test('contextual Prompt action uses the current route even when Write was aimed at another Project',async()=>{
  const fields=[{value:'summary',checked:true},{value:'prompt',checked:false},{value:'title',checked:true}];
  const elements={};
  const node=()=>({value:'',classList:{add(){},remove(){}},setAttribute(){}});
  for(const id of ['current-brief','current-prompt','write-project','write-operation','write-scene','read-panel','read','write-panel','write']) elements['studio-dw-'+id]=node();
  elements['studio-dw-write-project'].value='unrelated-project';
  elements['studio-dw-write-fields']={querySelectorAll:()=>fields};
  let prepared=false;
  const saved={id:'current-project'};
  const scope=vm.createContext({
    window:{studioDirectorBridge:{isReady:()=>true}},activeTarget:()=>({storyId:saved.id,sceneId:'current-scene'}),
    el:id=>elements[id],refreshProjects:async()=>{},loadStory:async id=>{assert.equal(id,saved.id);return saved;},
    renderWriteStory:story=>assert.equal(story,saved),setOperation(){},updateScope(){},status:message=>assert.fail(message),
    writePrepare:()=>{prepared=true;},writeOperationChosen:false,writeFieldsManuallyChanged:false
  });
  vm.runInContext(part(workbench,'  function prepareCurrentWrite(operation) {','  function writePrepare(writeFields) {'),scope);
  await scope.prepareCurrentWrite('scene-edit');
  assert.equal(elements['studio-dw-write-project'].value,saved.id);
  assert.equal(elements['studio-dw-write-scene'].value,'current-scene');
  assert.deepEqual(fields.map(field=>field.checked),[false,true,false]);
  assert.equal(prepared,true);
});

test('ordinary discussion asks for concise new decisions while complete creative fields remain complete',()=>{
  assert.match(chat,/one to three short paragraphs/);
  assert.match(chat,/supply its full usable content/);
  assert.match(chat,/Keep assessment metadata in readiness and conversational material in reply/);
});

test('compact Director replies keep the exact full text and leave General Chat alone',()=>{
  const code=part(chat,"      if (state.activeMode === 'storyboard' && message.role === 'assistant' && message.content.length > 1200) {",
    "      if (message.role === 'user' && (message.content.indexOf('[WEBCAP EXPLICIT READ]')");
  const node=()=>({children:[],append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;}});
  const message={role:'assistant',content:'A useful opening recommendation.\n\n'+('Complete creative details with "quotes" and line breaks.\n').repeat(40)};
  const body=node();
  const scope=vm.createContext({state:{activeMode:'storyboard'},message,body,document:{createElement:node}});
  vm.runInContext(code,scope);
  assert.equal(body.children[0].textContent,'A useful opening recommendation.');
  assert.equal(body.children[1].children[1].textContent,message.content);
  const general=node();
  scope.body=general;
  scope.state.activeMode='chat';
  vm.runInContext(code,scope);
  assert.equal(general.children.length,0);
});

test('Apply receipt names the actual scoped Scene fields and retains authoritative values',async()=>{
  const state={modeMessages:{storyboard:[]},sessionDirty:{}};
  const scope=vm.createContext({state,markStudioReadinessOutdated(){},renderMessages(){},persistSession:async()=>{}});
  const bridge=vm.runInContext('({'+part(chat,'    recordApplied: function (kind, story, selected) {','    undoBrief: function () {')+'})',scope);
  await bridge.recordApplied('scene.update',{id:'project-1',title:'Project',updatedAt:'now'},
    {sceneId:'scene-1',savedFields:{prompt:'The reviewed prompt.'}});
  const message=state.modeMessages.storyboard[0].content;
  assert.match(message,/^Saved: H3 Prompt\./);
  const saved=JSON.parse(message.split('[WEBCAP APPLIED FIELD VALUES]')[1].split('[END WEBCAP APPLY]')[0]);
  assert.equal(saved.fields.savedFields.prompt,'The reviewed prompt.');
});
