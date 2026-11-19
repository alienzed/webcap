'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/storyboard.js'), 'utf8');

function functionBody(name, following) {
  const start = source.indexOf('  function ' + name + '(');
  const end = source.indexOf('  function ' + following + '(', start);
  assert.ok(start >= 0 && end > start, name + ' is present');
  return source.slice(start, end);
}

function fixture() {
  function makeButton() {
    const label = {textContent:''};
    const glyph = {textContent:''};
    const button = {dataset:{},disabled:false,title:'',
      setAttribute(key,value){this[key]=value;},
      querySelector(selector){return selector==='.storyboard-tool-label'?label:glyph;},
      removeAttribute(key){delete this[key];},
      matches(){return false;}};
    return {button,label,glyph};
  }
  const generate = makeButton(), cancel = makeButton();
  const develop = {dataset:{}}, firstCut = {dataset:{}};
  const storyState = {story:{id:'project-1'},storyAction:null};
  let queued = false, running = false, firstCutQueued = false;
  const env = {
    storyState,
    storyHasPendingGeneration:()=>queued||running,
    storyHasQueuedGeneration:()=>queued,
    queuedFirstCutForStory:()=>firstCutQueued,
    directorTargetBlocked:()=>false,
    el:(id)=>({
      'storyboard-generate-scenes-btn':generate.button,
      'storyboard-cancel-takes-btn':cancel.button,
      'storyboard-develop-btn':develop,
      'storyboard-first-cut-btn':firstCut
    })[id],
    document:{querySelectorAll:()=>[generate.button]}
  };
  const sync = Function(...Object.keys(env),
    functionBody('syncPlanReplacementControls','storyboardInferenceJob')+
    'return syncPlanReplacementControls;')(...Object.values(env));
  return {sync,generate,cancel,storyState,setState(next){
    queued=!!next.queued;running=!!next.running;firstCutQueued=!!next.firstCutQueued;
  }};
}

test('Generate and Cancel Takes remain independent through idle, queued, running and completion', () => {
  const f=fixture();
  f.sync();
  assert.equal(f.generate.label.textContent,'Generate Takes');
  assert.equal(f.generate.button['aria-label'],'Generate Takes');
  assert.equal(f.generate.button.disabled,false);
  assert.equal(f.cancel.label.textContent,'Cancel Takes');
  assert.equal(f.cancel.button['aria-label'],'Cancel Takes');
  assert.equal(f.cancel.button.disabled,true);

  f.setState({queued:true,running:true});f.sync();
  assert.equal(f.generate.label.textContent,'Generate Takes');
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.label.textContent,'Cancel Takes');
  assert.equal(f.cancel.button.disabled,false);
  assert.match(f.cancel.button.title,/running Take will finish/);

  f.setState({queued:false,running:true});f.sync();
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.button.disabled,true);
  assert.equal(f.generate.label.textContent,'Generate Takes');
  assert.equal(f.cancel.label.textContent,'Cancel Takes');

  f.setState({queued:false,running:false});f.sync();
  assert.equal(f.generate.button.disabled,false);
  assert.equal(f.cancel.button.disabled,true);
});

test('Busy submissions disable both operations, then restore independent availability', () => {
  const f=fixture();
  f.generate.button.dataset.takesBusy='generate';
  f.setState({queued:true});f.sync();
  assert.equal(f.generate.label.textContent,'Queueing…');
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.button.disabled,true);
  delete f.generate.button.dataset.takesBusy;
  f.sync();
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.button.disabled,false);

  f.cancel.button.dataset.takesBusy='cancel';f.sync();
  assert.equal(f.cancel.label.textContent,'Cancelling…');
  assert.equal(f.cancel.button.disabled,true);
  assert.equal(f.generate.button.disabled,true);
  delete f.cancel.button.dataset.takesBusy;
  f.setState({});f.sync();
  assert.equal(f.generate.button.disabled,false);
  assert.equal(f.cancel.button.disabled,true);
});

test('First Cut prevents new generation but cannot hide queued-Take cancellation', () => {
  const f=fixture();
  f.setState({queued:true,firstCutQueued:true});f.sync();
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.button.disabled,false);
  f.setState({queued:false,firstCutQueued:true});f.sync();
  assert.equal(f.generate.button.disabled,true);
  assert.equal(f.cancel.button.disabled,true);
  f.setState({});f.storyState.storyAction={active:true,storyId:'project-1'};f.sync();
  assert.equal(f.generate.button.disabled,true);
  f.storyState.storyAction=null;f.sync();
  assert.equal(f.generate.button.disabled,false);
});

test('Project toolbar exposes two distinct controls routed to existing generation endpoints', () => {
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  assert.match(html,/id="storyboard-generate-scenes-btn"[^>]*aria-label="Generate Takes"/);
  assert.match(html,/id="storyboard-cancel-takes-btn"[^>]*aria-label="Cancel Takes"/);
  assert.match(source,/el\('storyboard-generate-scenes-btn'\)\.onclick = generateScenes/);
  assert.match(source,/el\('storyboard-cancel-takes-btn'\)\.onclick = cancelStoryTakes/);
  assert.doesNotMatch(source,/function handleStoryTakesAction\(/);
  assert.match(functionBody('cancelStoryTakes','regenerateArchivedTake'),/operation: 'cancel_story'/);
  assert.match(functionBody('generateScenes','handleSceneInput'),/enqueueSceneGeneration\(storyId, sceneId\)/);
  assert.match(source,/el\('storyboard-cancel-takes-btn'\)\.classList\.toggle\('hidden', sequenceMode\)/);
});
