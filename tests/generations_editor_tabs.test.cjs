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
const code = source.slice(from, to) + '\nthis.api = {captureGenerateEditorSnapshot, applyGenerateEditorSnapshot, switchGenerateEditorMode, loadGenerateTakeIntoEditor, useLoadedAsWorking};';

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
    modelId:'h3', lorasByModel:{h3:[{name:'work.safetensors',strength:.35}]},
    loraMode:'sweep', sweepFolderByModel:{h3:'shapes'},
    sweepSelections:{'h3|shapes':{'strap.safetensors':true}}, editorMode:'working',
    workingSnapshot:null, loadedSnapshot:null, loadedLabel:'',
    director:{busy:false,previousPrompt:'old prompt'},
    promptLibrary:{activeId:'saved-prompt'},
  };
  const warnings=[];
  const context = {
    generateState:state, el:element, pendingRestoreSelection:0,
    DataTransfer: class {
      constructor() { this.files=[]; this.items={add:f=>this.files.push(f)}; }
    },
    closeGenerateLoraPicker() {},
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
    window:{reportConsoleWarning:(_,message)=>warnings.push(message)},
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
  return {api:context.api,state,element,warnings,workingFile,context};
}
const take=(name='a')=>({
  jobId:name, modelId:'h3',sourcePrompt:'Loaded prompt '+name,
  settings:{duration:3,seed:101,samplingMode:'turbo',megapixels:.5},
  loras:[{name:'take.safetensors',strength:.75}],references:{first_frame:'some/saved/reference.png'}
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
  assert.equal(state.sweepSelections['h3|shapes']['strap.safetensors'],true);
  assert.equal(element('generate-reference-first_frame').files[0],f.workingFile);
  assert.equal(element('generate-editor-loaded').disabled,false);
});

test('each tab retains editable settings, LoRAs and references on repeated switching',()=>{
  const f=fixture(), {api,state,element}=f;
  api.loadGenerateTakeIntoEditor(take());
  element('generate-prompt').value='Edited loaded prompt';
  element('generate-duration').value='9';
  state.lorasByModel.h3[0].strength=.9;
  const loadedFile={name:'loaded.png'};
  element('generate-reference-first_frame').files=[loadedFile];
  api.switchGenerateEditorMode('working');
  element('generate-prompt').value='More Working edits';
  state.lorasByModel.h3[0].strength=.22;
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Edited loaded prompt');
  assert.equal(element('generate-duration').value,'9');
  assert.equal(state.lorasByModel.h3[0].strength,.9);
  assert.equal(element('generate-reference-first_frame').files[0],loadedFile);
  api.switchGenerateEditorMode('working');
  assert.equal(element('generate-prompt').value,'More Working edits');
  assert.equal(state.lorasByModel.h3[0].strength,.22);
  assert.equal(element('generate-reference-first_frame').files[0],f.workingFile);
});

test('Use as Working copies current Loaded values without erasing editable Loaded configuration',()=>{
  const f=fixture(),{api,state,element}=f;
  api.loadGenerateTakeIntoEditor(take());
  element('generate-prompt').value='Promoted prompt';
  state.lorasByModel.h3[0].strength=.65;
  const newFile={name:'fresh.png'};
  element('generate-reference-first_frame').files=[newFile];
  api.useLoadedAsWorking();
  assert.equal(state.editorMode,'working');
  assert.equal(element('generate-prompt').value,'Promoted prompt');
  assert.equal(state.lorasByModel.h3[0].strength,.65);
  assert.equal(element('generate-reference-first_frame').files[0],newFile);
  element('generate-prompt').value='Separate Working change';
  api.switchGenerateEditorMode('loaded');
  assert.equal(element('generate-prompt').value,'Promoted prompt');
  assert.equal(state.lorasByModel.h3[0].strength,.65);
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
  assert.equal(element('generate-prompt').value,'Edited Loaded');
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
  assert.equal(sent[0].loras[0].name,'take.safetensors');
  assert.equal(sent[0].loras[0].strength,.75);
  assert.equal(sent[0].references.first_frame,'submitted-ref.png');
  assert.equal(element('generate-prompt').value,'Changed Working prompt');
});
