const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../tool/js/run_analytics.js'),'utf8');
const block=source.slice(source.indexOf('  var evalTimer='),source.indexOf('  function labRender(){'));
function setup(extra={}){
  const nodes={},requests=[],errors=[],timers=new Set();
  const scope=vm.createContext({folder:'set-a',window:{},
    lab:id=>nodes[id]||(nodes[id]={textContent:'',disabled:false}),
    error:e=>errors.push(e),clearInterval:id=>timers.delete(id),
    setInterval:fn=>{timers.add(fn);return fn;},
    loadCaptionVisionCapabilities:async()=>{},getCaptionVisionModelId:()=> 'vision',
    fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({evaluation:{}})};},
    ...extra});
  vm.runInContext(block,scope);
  return {scope,nodes,requests,errors,timers};
}
test('evaluation has no startup polling and stops on leaving Insights',async()=>{
  const {scope,requests,timers}=setup();
  assert.equal(requests.length,0);assert.equal(timers.size,0);
  scope.window.runAnalyticsSetVisible(true);
  await new Promise(setImmediate);
  assert.equal(requests.length,1);assert.equal(timers.size,1);
  scope.window.runAnalyticsSetVisible(false);
  await scope.evalRefresh();
  assert.equal(timers.size,0);assert.equal(requests.length,1);
});
test('progress distinguishes empty, unavailable, queued, failed and complete without replacing controls',()=>{
  const {scope,nodes}=setup();
  scope.renderEvaluation({evaluation:{total:0,unavailable:2}});
  const start=nodes['eval-start'];
  assert.equal(start.textContent,'No renders to evaluate');
  assert.match(nodes['eval-status'].textContent,/2 unavailable/);
  scope.renderEvaluation({evaluation:{total:2,queued:2}});
  assert.equal(start.textContent,'Evaluation in progress');
  assert.equal(nodes['eval-stop'].disabled,false);
  scope.renderEvaluation({evaluation:{total:2,failed:1,missing:1,actionable:2}});
  assert.match(nodes['eval-status'].textContent,/1 failed/);
  assert.equal(start.textContent,'Evaluate missing 2');
  scope.renderEvaluation({evaluation:{total:2,stopped:2,actionable:2}});
  assert.match(nodes['eval-status'].textContent,/2 stopped/);
  scope.renderEvaluation({evaluation:{total:2,completed:2}});
  assert.equal(start.textContent,'All evaluated ✓');
  assert.equal(nodes['eval-start'],start);
});
test('async model discovery preserves the initiating Set and excludes duplicate clicks',async()=>{
  let release;
  const discovery=new Promise(resolve=>{release=resolve;});
  const {scope,requests}=setup({loadCaptionVisionCapabilities:()=>discovery});
  const pending=scope.evalAction('test_evaluate_missing');
  scope.evalAction('test_evaluate_missing');
  scope.folder='set-b';scope.evalGeneration++;
  release();await pending;
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0],{folder:'set-a',operation:'test_evaluate_missing',criteria:{model:'vision'}});
});
test('progress failures stop polling and reach the shared error reporter',async()=>{
  const {scope,nodes,errors,timers}=setup({fetch:async()=>{throw Error('Network unavailable');}});
  scope.window.runAnalyticsSetVisible(true);
  await new Promise(setImmediate);
  assert.equal(timers.size,0);
  assert.equal(nodes['eval-start'].disabled,true);
  assert.match(nodes['eval-status'].textContent,/Network unavailable/);
  assert.equal(errors.length,1);
});
test('late progress from a previous visit cannot overwrite the current view',async()=>{
  let release;
  const {scope,nodes}=setup({fetch:()=>new Promise(resolve=>{release=resolve;})});
  scope.window.runAnalyticsSetVisible(true);
  scope.window.runAnalyticsSetVisible(false);
  scope.folder='set-b';
  release({ok:true,json:async()=>({evaluation:{total:99,completed:99}})});
  await new Promise(setImmediate);
  assert.equal(nodes['eval-count'],undefined);
});
