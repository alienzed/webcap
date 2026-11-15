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
  const glyph = {textContent:''}, label = {textContent:''};
  const batch = {dataset:{}, disabled:false, title:'',
    setAttribute(key, value){this[key] = value;},
    querySelector(selector){return selector === '.storyboard-tool-label' ? label : glyph;},
    removeAttribute(key){delete this[key];},
    matches(){return false;}};
  const develop = {dataset:{}}, firstCut = {dataset:{}};
  const storyState = {story:{id:'project-1'},storyAction:null};
  let queued = false, running = false, firstCutQueued = false;
  const env = {
    storyState,
    storyHasPendingGeneration:()=>queued || running,
    storyHasQueuedGeneration:()=>queued,
    queuedFirstCutForStory:()=>firstCutQueued,
    directorTargetBlocked:()=>false,
    el:(id)=>({
      'storyboard-generate-scenes-btn':batch,
      'storyboard-develop-btn':develop,
      'storyboard-first-cut-btn':firstCut
    })[id],
    document:{querySelectorAll:()=>[batch]}
  };
  const sync = Function(...Object.keys(env),functionBody('syncPlanReplacementControls','storyboardInferenceJob')+
    'return syncPlanReplacementControls;')(...Object.values(env));
  return {sync,batch,glyph,label,setState(next){
    queued=!!next.queued;running=!!next.running;firstCutQueued=!!next.firstCutQueued;
  }};
}

test('one Studio batch button follows idle, queue, running and completed Take states', () => {
  const f=fixture();
  f.sync();
  assert.equal(f.batch.takesAction,undefined);
  assert.equal(f.batch.dataset.takesAction,'generate');
  assert.equal(f.label.textContent,'Generate Takes');
  assert.equal(f.batch.disabled,false);
  f.setState({queued:true,running:true});f.sync();
  assert.equal(f.batch.dataset.takesAction,'cancel');
  assert.equal(f.label.textContent,'Cancel Takes');
  assert.equal(f.batch.disabled,false);
  f.setState({queued:false,running:true});f.sync();
  assert.equal(f.batch.dataset.takesAction,'');
  assert.equal(f.label.textContent,'Take Running…');
  assert.equal(f.batch.disabled,true);
  f.setState({queued:false,running:false});f.sync();
  assert.equal(f.batch.dataset.takesAction,'generate');
  assert.equal(f.batch.disabled,false, 'button re-enables after final running Take ends');
});

test('pending command cannot double-submit, but cancelling existing queue survives First Cut blocking', () => {
  const f=fixture();
  f.batch.dataset.takesBusy='cancel';f.setState({queued:true});f.sync();
  assert.equal(f.label.textContent,'Cancelling…');
  assert.equal(f.batch.disabled,true);
  delete f.batch.dataset.takesBusy;
  f.setState({queued:true,firstCutQueued:true});f.sync();
  assert.equal(f.batch.dataset.takesAction,'cancel');
  assert.equal(f.batch.disabled,false);
  f.setState({queued:false,firstCutQueued:true});f.sync();
  assert.equal(f.batch.dataset.takesAction,'generate');
  assert.equal(f.batch.disabled,true);
});

test('Studio batch button is wired to existing operations, with no separate cancel button', () => {
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  assert.doesNotMatch(html,/id="storyboard-cancel-takes-btn"/);
  assert.match(source,/el\('storyboard-generate-scenes-btn'\)\.onclick = handleStoryTakesAction/);
  const dispatch = functionBody('handleStoryTakesAction','handleSceneInput');
  assert.match(dispatch,/storyHasQueuedGeneration\(storyState\.story\.id\)\) return cancelStoryTakes\(\)/);
  assert.match(dispatch,/storyHasPendingGeneration\(storyState\.story\.id\)\) return generateScenes\(\)/);
  assert.match(functionBody('cancelStoryTakes','regenerateArchivedTake'),/operation: 'cancel_story'/);
});
