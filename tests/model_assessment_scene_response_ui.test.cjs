'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('tool/js/diagnostics.js','utf8');
const start=source.indexOf('function diagnosticsAssessmentInspectResponse(');
const end=source.indexOf('function diagnosticsAssessmentSize(',start);
assert.ok(start>=0 && end>start,'Response inspector must be available');
function harness(runs) {
  const host={textContent:'',children:[],appendChild(element){this.children.push(element);}};
  const ctx=vm.createContext({
    document:{createElement(tag){return {tagName:tag,textContent:'',className:''};}},
    encodeURIComponent,
    modelLabRequest(path){
      const id=new URLSearchParams(path.split('?')[1]).get('run');
      if(!runs[id])return Promise.reject(new Error('Run not found'));
      return Promise.resolve({run:runs[id]});
    },
    reportConsoleError(errorType,error){throw new Error(errorType+': '+error.message);}
  });
  vm.runInContext(source.slice(start,end),ctx);
  return {host,ctx};
}
test('Inspecting a saved failure exposes its exact response and finish reason',async()=>{
  const {host,ctx}=harness({a:{attempts:[{
    id:'x',kind:'director_scene_plan_8192',modelRef:'local::director',
    status:'failed',error:'Malformed JSON',result:{text:'{"scenes":[',finishReason:'length'}
  }]}});
  ctx.diagnosticsAssessmentInspectResponse('a','local::director','director_scene_plan_8192',host);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(host.textContent,/failed.*Malformed JSON.*length/);
  assert.equal(host.children[0].textContent,'{"scenes":[');
});
test('Inspecting reused evidence resolves the original saved attempt',async()=>{
  const {host,ctx}=harness({
    newer:{attempts:[],reused:{'director_scene_plan_2048|local::director|':{runId:'older',attemptId:'original'}}},
    older:{attempts:[{id:'original',kind:'director_scene_plan_2048',modelRef:'local::director',status:'completed',result:{text:'{"scenes":[]}',finishReason:'stop'}}]}
  });
  ctx.diagnosticsAssessmentInspectResponse('newer','local::director','director_scene_plan_2048',host);
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(host.textContent,/completed.*stop/);
  assert.equal(host.children[0].textContent,'{"scenes":[]}');
});
