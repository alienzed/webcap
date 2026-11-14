'use strict';
// Execute the real Generations editor capture, switching and Take-loading code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/generate.js', 'utf8');
const from = source.indexOf('  // The existing form is the sole editor.');
const to = source.indexOf('  function uploadReference(file) {', from);
assert.ok(from !== -1 && to > from, 'Generations editor snapshot code is present');
const code = source.slice(from, to) + '\nthis.api = {captureGenerateEditorSnapshot, applyGenerateEditorSnapshot, switchGenerateEditorMode, loadGenerateTakeIntoEditor, useLoadedAsWorking, noteGenerateEditorEdit, markSubmittedWorkingDraft};';

function fixture() {
  const nodes = new Map();
  function element(id) {
    if (nodes.has(id)) return nodes.get(id);
    let val = '';
    let files = [];
    const node = {
      id, dataset:{}, disabled:false, attributes:{}, textContent:'',
      get value() { return val; },
      set value(v) { val = String(v); if (id.startsWith('generate-reference-') && v === '') files = []; },
      get files() { return files; },
      set files(value) { files = Array.from(value); },
      classList:{
        classes:new Set(),
        toggle(name,on) { if (on) this.classes.add(name); else this.classes.delete(name); },
        contains(name) { return this.classes.has(name); },
      },
      setAttribute(name,v) { this.attributes[name] = v; },
      removeAttribute(name) { delete this.attributes[name]; if (name === 'data-model-id') delete this.dataset.modelId; }
    };
    nodes.set(id,node);
    return node;
  }
  const settings = ['generate-aspect','generate-dimensions','generate-megapixels',
    'generate-duration','generate-sampling-mode','generate-seed'];
  const state = {
    models:[{id:'h3',settings:['duration','seed','samplingMode','megapixels'],defaultPrompt:'default'},
      {id:'image',settings:['seed','dimensions'],defaultPrompt:'default image'}],
    modelId:'h3', lorasByModel:{h3:[{name:'work.safetensors',strength:.35}]}, lorasEnabledByModel:{h3:true},
    loraMode:'sweep', sweepSelections:{h3:{'strap.safetensors':true}}, editorMode:'working',
    workingSnapshot:null, workingDraftDirty:false, workingEditSerial:0,
    loadedSnapshot:null, loadedLabel:'',
    director:{busy:false,previousPrompt:'old prompt'},
    promptLibrary:{activeId:'saved-prompt'},
  };
  const warnings=[];
  const confirmations=[];
  let allowOverwrite=true;
  const context = {
    generateState:state, el:element, pendingRestoreSelection:0,
    DataTransfer: class {
      constructor() { this.files=[]; this.items={add:f=>this.files.push(f)}; }
    },
    closeGenerateLoraPicker() {},
    syncGenerateHeaderModel() { element('app-header-generate-model').value=state.modelId; },
    renderLoras() {},
    setLoraMode(mode) { state.loraMode=mode; },
    fieldVisible() { return true; },
    syncReferenceDropzone() {},
    setPromptLibraryOpen() {},
    renderDirector() {},
    setDirectorStatus() {},
    normalizeGenerateSamplingMode(value) { return value; },
    setStatus(message) { warnings.push(message); },
    currentModel() { return state.models.find(m=>m.id===state.modelId); },
    getGenerateModelPreference() { return 'h3'; },
    renderStageEmpty() {},
    syncActiveTakeState() {},
    setGenerateViewMode() {},
    window:{
      reportConsoleWarning:(_,message)=>warnings.push(message),
      confirm:message=>{confirmations.push(message); return allowOverwrite;}
    },
    renderModelForm() {
      settings.forEach(name=>element(name).value='default');
      element('generate-prompt').value=state.modelId==='h3'?'default':'default image';
    }
  };
  vm.createContext(context);
  vm.runInContext(code,context);
  element('generate-prompt').value='Working draft';
  element('generate-prompt').dataset.modelId='h3';
  element('generate-duration').value='7';
  element('generate-seed').value='-1';
  element('generate-sampling-mode').value='quality';
  element('generate-megapixels').value='0.4';
  const workingFile={name:'work.png'};
  element('generate-reference-first_frame').files=[workingFile];
  context.api.renderGenerateEditorTabs = context.renderGenerateEditorTabs;
  context.renderGenerateEditorTabs();
  return {api:context.api,state,element,warnings,workingFile,context,
    confirmations,setConfirmChoice:allow=>{allowOverwrite=allow;}};
}
const take=(name='a')=>({
  jobId:name, modelId:'h3',sourcePrompt:'Loaded prompt '+name,
  settings:{duration:3,seed:101,samplingMode:'turbo',megapixels:.5},
  loras:[{name:'take.safetensors',strength:.75}],references:{first_frame:'some/saved/reference.png'}
});

test('Loaded preserves its recorded seed; editing forks randomized Working except for explicit seed edits',()=>{
  const f=fixture(),{api,state,element}=f;
  const saved=take();
  api.loadGenerateTakeIntoEditor(saved);
  assert.equal(saved.settings.seed,101);
  assert.equal(element('generate-seed').value,'101','Loaded shows the reproducible original seed');
  element('generate-prompt').value='Loaded prompt a, plus one word';
  assert.equal(api.noteGenerateEditorEdit(false),true);
  assert.equal(state.editorMode,'working');
  assert.equal(element('generate-prompt').value,'Loaded prompt a, plus one word','first edit survives fork');
  assert.equal(element('generate-seed').value,'-1','new Working is randomized');
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Loaded prompt a','Loaded remains frozen');
  assert.equal(element('generate-seed').value,'101');
  api.loadGenerateTakeIntoEditor(take('another'));
  assert.equal(element('generate-seed').value,'101','each Loaded Take retains its own recorded seed');

  // An intentional edit to the seed is an explicit request to keep that value.
  const separate=fixture();
  separate.api.loadGenerateTakeIntoEditor(take());
  separate.element('generate-seed').value='4567';
  separate.api.noteGenerateEditorEdit(true);
  assert.equal(separate.element('generate-seed').value,'4567');
  separate.api.switchGenerateEditorMode('loaded');
  assert.equal(separate.element('generate-seed').value,'101');
});

test('loading a completed Take isolates all Working fields, LoRAs and File references',()=>{
  const f=fixture(), {api,state,element}=f;
  api.loadGenerateTakeIntoEditor(take());
  assert.equal(state.editorMode,'loaded');
  assert.equal(element('generate-prompt').value,'Loaded prompt a');
  assert.equal(element('generate-duration').value,'3');
  assert.equal(element('generate-sampling-mode').value,'turbo');
  assert.equal(state.lorasByModel.h3[0].name,'take.safetensors');
  assert.equal(element('generate-reference-first_frame').files.length,0,'a saved Take must not inherit Working references');
  assert.match(element('generate-editor-loaded-caption').textContent,/Reselect saved reference/);
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'Working draft');
  assert.equal(element('generate-duration').value,'7');
  assert.equal(element('generate-sampling-mode').value,'quality');
  assert.equal(state.loraMode,'sweep');
  assert.equal(state.lorasByModel.h3[0].strength,.35);
  assert.equal(state.sweepSelections.h3['strap.safetensors'],true);
  assert.equal(element('generate-reference-first_frame').files[0],f.workingFile);
  assert.equal(element('generate-editor-loaded').disabled,false);
});

test('Loaded never inherits other-model LoRAs or Sweep selections from Working',()=>{
  const f=fixture(), {api,state,element}=f;
  api.loadGenerateTakeIntoEditor({
    modelId:'image',sourcePrompt:'A different model',settings:{seed:27,dimensions:'512x512'},
    loras:[{name:'image-only.safetensors',strength:.55}],references:{}
  });
  assert.equal(state.editorMode,'loaded');
  assert.equal(state.modelId,'image');
  assert.equal(element('generate-prompt').value,'A different model');
  assert.equal(state.lorasByModel.h3,undefined,'Working H3 LoRA must not appear in Loaded');
  assert.deepEqual(JSON.parse(JSON.stringify(state.sweepSelections)),{});
  assert.equal(state.lorasByModel.image[0].name,'image-only.safetensors');
  api.switchGenerateEditorMode('working');
  assert.equal(state.modelId,'h3');
  assert.equal(state.lorasByModel.h3[0].name,'work.safetensors');
  assert.equal(state.sweepSelections.h3['strap.safetensors'],true);
});

test('a loaded edit moves all recipe settings, LoRAs and Files to Working without modifying Loaded',()=>{
  const f=fixture(),{api,state,element}=f;
  api.loadGenerateTakeIntoEditor(take());
  element('generate-prompt').value='Edited loaded prompt';
  element('generate-duration').value='9';
  state.lorasByModel.h3[0].strength=.9;
  const loadedFile={name:'loaded.png'};
  element('generate-reference-first_frame').files=[loadedFile];
  api.noteGenerateEditorEdit(false);
  assert.equal(state.editorMode,'working');
  assert.equal(element('generate-prompt').value,'Edited loaded prompt');
  assert.equal(element('generate-duration').value,'9');
  assert.equal(state.lorasByModel.h3[0].strength,.9);
  assert.equal(element('generate-reference-first_frame').files[0],loadedFile);
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Loaded prompt a');
  assert.equal(element('generate-duration').value,'3');
  assert.equal(state.lorasByModel.h3[0].strength,.75);
  assert.equal(element('generate-reference-first_frame').files.length,0);
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'Edited loaded prompt');
  assert.equal(element('generate-duration').value,'9');
  assert.equal(state.lorasByModel.h3[0].strength,.9);
  assert.equal(element('generate-reference-first_frame').files[0],loadedFile);
});

test('Use as Working copies Loaded with a fresh seed and preserves its original recipe',()=>{
  const f=fixture(),{api,state,element}=f;
  api.loadGenerateTakeIntoEditor(take());
  api.useLoadedAsWorking();
  assert.equal(state.editorMode,'working');
  assert.equal(element('generate-prompt').value,'Loaded prompt a');
  assert.equal(element('generate-seed').value,'-1');
  assert.equal(state.workingDraftDirty,true);
  element('generate-prompt').value='Promoted and adjusted';
  api.noteGenerateEditorEdit(false);
  state.lorasByModel.h3[0].strength=.65;
  const newFile={name:'fresh.png'};
  element('generate-reference-first_frame').files=[newFile];
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Loaded prompt a');
  assert.equal(element('generate-seed').value,'101');
  assert.equal(state.lorasByModel.h3[0].strength,.75);
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'Promoted and adjusted');
  assert.equal(state.lorasByModel.h3[0].strength,.65);
  assert.equal(element('generate-reference-first_frame').files[0],newFile);
});

test('loading another Take replaces Loaded, not Working',()=>{
  const f=fixture(),{api,element}=f;
  api.loadGenerateTakeIntoEditor(take('first'));
  api.switchGenerateEditorMode('working');
  element('generate-prompt').value='Still Working';
  api.loadGenerateTakeIntoEditor(take('second'));
  assert.equal(element('generate-prompt').value,'Loaded prompt second');
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'Still Working');
});

test('Loaded is unavailable until a Take is selected and mode changes are explicit',()=>{
  const f=fixture(),{api,element}=f;
  assert.equal(element('generate-editor-loaded').disabled,true);
  assert.throws(()=>api.switchGenerateEditorMode('loaded'),/Select a Take/);
  assert.equal(element('generate-prompt').value,'Working draft');
});


test('New Generation intentionally resets Working and leaves editable Loaded intact',()=>{
  const f=fixture(), {api,state,element,context}=f;
  const resetFrom=source.indexOf('  function resetGeneratePromptScratch() {');
  const resetTo=source.indexOf('  function openGenerateActivity(',resetFrom);
  const newFrom=source.indexOf('  function startNewGeneration() {');
  const newTo=source.indexOf('  function deleteGenerationResult(',newFrom);
  assert.ok(resetTo>resetFrom && newTo>newFrom);
  vm.runInContext(source.slice(resetFrom,resetTo)+source.slice(newFrom,newTo)+
    '\nthis.startNewGeneration = startNewGeneration;',context);
  api.loadGenerateTakeIntoEditor(take());
  element('generate-prompt').value='Edited Loaded';
  context.startNewGeneration();
  assert.equal(state.editorMode,'working');
  assert.equal(element('generate-prompt').value,'default');
  assert.equal(element('generate-reference-first_frame').files.length,0);
  assert.deepEqual(JSON.parse(JSON.stringify(state.lorasByModel)),{});
  assert.equal(state.freshDraft,true);
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Loaded prompt a','New Working does not alter the Take reference');
  assert.equal(state.lorasByModel.h3[0].name,'take.safetensors');
});

test('generating from Loaded freezes its recipe even if reference upload overlaps tab switching',async()=>{
  const f=fixture(), {api,state,element,context}=f;
  const start=source.indexOf('  function runGenerate() {');
  const end=source.indexOf('  function frozenSweepSettings()',start);
  assert.ok(start!==-1 && end>start);
  let completeUpload;
  const sent=[];
  context.uploadReferenceFiles=()=>new Promise(resolve=>{completeUpload=resolve;});
  context.postJson=(_url,payload)=>{sent.push(payload);return Promise.resolve({job:{jobId:'generated',status:'queued'}});};
  context.captureReferenceFiles=()=>({first_frame:element('generate-reference-first_frame').files[0]});
  context.selectedLoras=id=>state.lorasByModel[id] || [];
  context.enabledFixedLoras=id=>state.lorasEnabledByModel[id]===false ? [] : (state.lorasByModel[id] || []).filter(item=>item.enabled!==false);
  context.collectSettings=()=>({
    duration:element('generate-duration').value,
    seed:element('generate-seed').value,
    samplingMode:element('generate-sampling-mode').value
  });
  context.syncPromptAssistantDependencies=()=>{};
  context.trackGenerateJob=()=>{};
  context.syncGenerationPreviewCard=()=>{};
  context.reportConsoleInfo=()=>{};
  context.reportError=err=>{throw err;};
  vm.runInContext(source.slice(start,end)+'\nthis.runGenerate = runGenerate;',context);
  api.loadGenerateTakeIntoEditor(take());
  const submitted=context.runGenerate();
  assert.equal(typeof completeUpload,'function','references must upload asynchronously');
  api.switchGenerateEditorMode('working');
  element('generate-prompt').value='Changed Working prompt';
  state.lorasByModel.h3[0].strength=1.5;
  completeUpload({first_frame:'submitted-ref.png'});
  await submitted;
  assert.equal(sent.length,1);
  assert.equal(sent[0].prompt,'Loaded prompt a');
  assert.equal(sent[0].settings.duration,'3');
  assert.equal(sent[0].settings.seed,'101','generating directly from Loaded can reproduce the saved seed');
  assert.equal(sent[0].loras[0].name,'take.safetensors');
  assert.equal(sent[0].loras[0].strength,.75);
  assert.equal(sent[0].references.first_frame,'submitted-ref.png');
  assert.equal(element('generate-prompt').value,'Changed Working prompt');
});


test('real pending Take click populates Loaded after frozen job fetch, leaving Working intact',async()=>{
  const f=fixture(),{api,state,element,context}=f;
  const begin=source.indexOf('  var pendingRestoreSelection = 0;');
  const end=source.indexOf('  function startNewGeneration()',begin);
  assert.ok(begin>0 && end>begin);
  let resolveRequest;
  context.requestJson=url=>{
    assert.equal(url,'/fs/inference?job=pending&configuration=1');
    return new Promise(resolve=>{resolveRequest=resolve;});
  };
  context.renderPendingStage=job=>{
    state.activePendingJobId=job.jobId;
    state.activeResultKey='';
  };
  context.renderActiveResult=result=>{
    state.activePendingJobId='';
    state.activeResultKey=result.jobId;
  };
  state.pendingJobsById={pending:{jobId:'pending',modelId:'h3',status:'running'}};
  state.open=true;
  vm.runInContext(source.slice(begin,end)+
    '\nthis.selectPendingReal=selectPendingGeneration;',context);
  const pending=context.selectPendingReal('pending');
  assert.equal(state.editorMode,'working','request must not blank the active editor');
  resolveRequest({job:{jobId:'pending',client:'generate',modelId:'h3',
    generationConfiguration:{
      sourcePrompt:'Pending captured prompt',
      settings:{duration:4,seed:888,samplingMode:'quality',megapixels:.5},
      loras:[{name:'pending.safetensors',strength:.7}],references:{}
    }}});
  await pending;
  assert.equal(state.editorMode,'loaded');
  assert.equal(element('generate-prompt').value,'Pending captured prompt');
  assert.equal(element('generate-duration').value,'4');
  assert.equal(state.lorasByModel.h3[0].name,'pending.safetensors');
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'Working draft');
  assert.equal(state.lorasByModel.h3[0].name,'work.safetensors');
});

test('LoRA bypass and individual enablement survive Working and Loaded Take isolation',()=>{
  const f=fixture(), {api,state}=f;
  state.lorasEnabledByModel.h3=false;
  state.lorasByModel.h3[0].enabled=false;
  api.loadGenerateTakeIntoEditor(take());
  assert.equal(state.lorasEnabledByModel.h3,true,'historical applied LoRAs restore enabled');
  assert.equal(state.lorasByModel.h3[0].enabled,undefined);
  api.switchGenerateEditorMode('working');
  assert.equal(state.lorasEnabledByModel.h3,false,'Working master bypass is preserved');
  assert.equal(state.lorasByModel.h3[0].enabled,false,'Working individual toggle is preserved');
  api.switchGenerateEditorMode('loaded');
  assert.equal(state.lorasEnabledByModel.h3,true,'Loaded bypass stays independent');
});

test('actual enabledFixedLoras omits bypassed LoRAs without mutating saved selections',()=>{
  const begin=source.indexOf('  function selectedLoras(modelId) {');
  const end=source.indexOf('  function loraFolder(name)',begin);
  assert.ok(begin>0 && end>begin);
  const state={lorasByModel:{h3:[
    {name:'keep.safetensors',strength:.9},
    {name:'off.safetensors',strength:.7,enabled:false}
  ]},lorasEnabledByModel:{h3:true}};
  const context={generateState:state};
  vm.runInNewContext(source.slice(begin,end)+'\nthis.enabledFixedLoras=enabledFixedLoras;',context);
  assert.deepEqual(Array.from(context.enabledFixedLoras('h3'),item=>item.name),['keep.safetensors']);
  state.lorasEnabledByModel.h3=false;
  assert.equal(context.enabledFixedLoras('h3').length,0,'master bypass suppresses all fixed LoRAs');
  assert.equal(state.lorasByModel.h3.length,2,'bypass does not delete either selected LoRA');
  state.lorasEnabledByModel.h3=true;
  assert.equal(context.enabledFixedLoras('h3').length,1,'restoring master preserves individual enablement');
});

test('Prompt Assistant locks the visible header Base Model and unlocks it afterward',()=>{
  const begin=source.indexOf('  function syncPromptAssistantDependencies() {');
  const end=source.indexOf('  function renderDirector() {',begin);
  assert.ok(begin>0 && end>begin);
  const nodes=new Map();
  const state={director:{busy:true}};
  const context={
    generateState:state,
    el:id=>{
      if (!nodes.has(id)) nodes.set(id,{disabled:false});
      return nodes.get(id);
    },
    document:{querySelectorAll:()=>[]},
    syncGenerateRunLabel(){},
    syncReferenceDropzone(){}
  };
  vm.runInNewContext(source.slice(begin,end)+'\nthis.sync=syncPromptAssistantDependencies;',context);
  context.sync();
  assert.equal(context.el('app-header-generate-model').disabled,true);
  assert.equal(context.el('generate-model').disabled,true);
  state.director.busy=false;
  context.sync();
  assert.equal(context.el('app-header-generate-model').disabled,false);
});
