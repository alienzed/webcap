'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/caption_enrichment.js','utf8');
function fixture() {
  let resolveJob, resolveStart;
  const candidate = {mediaKey:'item-a',text:'A woman posing in a swimsuit, front view.'};
  const logs=[], calls=[], classes=new Set(), nodes={};
  function node() {
    const n={textContent:'',disabled:false,className:'',children:[],attributes:{},
      classList:{toggle(name,bool){bool?classes.add(name):classes.delete(name);}},
      appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},
      setAttribute(name,v){this.attributes[name]=v;},
      addEventListener(name,fn){this['on'+name]=fn;}};
    return n;
  }
  const document={
    getElementById(id){return nodes[id]||(nodes[id]=node());},
    createElement(){return node();},
    createTextNode(text){return {textContent:text};}
  };
  const ctx={document,Promise,JSON,console,
    state:{folder:'set-a',currentItem:{key:'item-a',fileName:'a.jpg',
      metadata:{vision_sight:{description:'A swimsuit with ring connectors.'}}}},
    captionAssistCandidate:candidate,
    isFocusedQaReviewMode(){return false;},isCaptionAssistRunning(){return false;},
    getMetadataForMedia(){return {};},
    buildCaptionAssistRequest(){return {model:'director-a',assignments:[],tags:[],
      openSight:{description:'A swimsuit with ring connectors.'}};},
    getCaptionAssistOmittedAssignments(){return [];},
    getCaptionAssistOmittedCorrections(){return [];},
    resetFocusedCaptionUseArm(){},syncCaptionAssistCandidateUi(){calls.push('sync');},
    setStatus(msg){logs.push(['status',msg]);},
    reportConsoleWarning(label,msg){logs.push(['warn',msg]);},
    reportConsoleError(label,err){logs.push(['error',String(err)]);},
    cancelCaptionAssistJob(job){calls.push(['cancel',job]);return Promise.resolve(true);},
    captionAssistRequestJson(url,options){calls.push(['request',url,JSON.parse(options.body)]);return new Promise(r=>{resolveStart=r;});},
    waitForCaptionAssistJob(){return new Promise(r=>{resolveJob=r;});}
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  return {ctx,candidate,nodes,logs,calls,resolveStart:()=>resolveStart,resolveJob:()=>resolveJob};
}

test('enrichment accepts verbatim unique anchor insertions, rejects malformed and duplicates',()=>{
  const f=fixture(),p=f.ctx.parseCaptionAssistEnrichment;
  let v=p('{"suggestions":[{"anchor":"swimsuit","addition":" with metal rings"}]}',
    'A swimsuit on a model.');
  assert.equal(v.suggestions.length,1);
  assert.equal(f.ctx.captionAssistEnrichmentInsert('A swimsuit on a model.',v.suggestions[0]),
    'A swimsuit with metal rings on a model.');
  v=p('{"suggestions":[{"anchor":"swimsuit","addition":" with rings"},{"anchor":"not present","addition":" extra"}]}','A swimsuit.');
  assert.equal(v.suggestions.length,1);
  assert.equal(v.rejected.length,1);
  assert.throws(()=>p('{"suggestions":[{"anchor":"a","addition":" extra"}]}','a cat and a dog'),/unique/);
  assert.throws(()=>p('not json','A swimsuit.'),SyntaxError);
});

test('proposals remain separate until accepted; reject and restore never overwrite original',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',
    suggestions:[
      {anchor:'swimsuit',addition:' with metal rings',pending:true},
      {anchor:'front view',addition:' and soft side lighting',pending:true}]};
  c.syncCaptionAssistEnrichmentUi(candidate);
  const preview=f.nodes['editor-caption-enrichment-preview'];
  assert.equal(preview.children.filter(x=>x.className==='caption-enrichment-proposal').length,2);
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  c.resolveCaptionAssistEnrichment(c.captionAssistEnrichment.suggestions[0],false);
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  c.resolveCaptionAssistEnrichment(c.captionAssistEnrichment.suggestions[1],true);
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view and soft side lighting.');
  c.finishCaptionAssistEnrichment('restore');
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  assert.equal(c.captionAssistEnrichment,null);
});

test('enrichment is opt-in, keeps draft during generation and discards cancelled result',async()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  const task=c.runCaptionAssistEnrichment();
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='request').length,1);
  assert.equal(f.calls.find(x=>Array.isArray(x)&&x[0]==='request')[2].mode,'enrich');
  f.resolveStart()({job:{jobId:'task-1'}});
  await Promise.resolve();await Promise.resolve();
  c.cancelCaptionAssistEnrichment();
  f.resolveJob()({result:{text:'{"suggestions":[{"anchor":"swimsuit","addition":" with rings"}]}' }});
  await task;
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  assert.equal(c.captionAssistEnrichment,null);
});

test('out-of-date candidates cannot receive old model proposals',async()=>{
  const f=fixture(),c=f.ctx;
  const task=c.runCaptionAssistEnrichment();
  f.resolveStart()({job:{jobId:'task-1'}});
  await Promise.resolve();await Promise.resolve();
  c.captionAssistCandidate={mediaKey:'item-b',text:'New item.'};
  c.cancelCaptionAssistEnrichment();
  f.resolveJob()({result:{text:'{"suggestions":[{"anchor":"swimsuit","addition":" with rings"}]}' }});
  await task;
  assert.equal(c.captionAssistCandidate.text,'New item.');
});
