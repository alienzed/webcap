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
  assert.match(chat,/Keep readiness metadata in its separate final block/);
});
