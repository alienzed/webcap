'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('tool/js/caption_enrichment.js','utf8');
function fixture() {
  let resolveJob, resolveStart, syncRenderer=false;
  const candidate = {mediaKey:'item-a',text:'A woman posing in a swimsuit, front view.'};
  const logs=[], calls=[], nodes={}, listeners={};
  function node() {
    const classes=new Set();
    const n={textContent:'',disabled:false,className:'',children:[],attributes:{},focusCount:0,
      classList:{toggle(name,bool){bool?classes.add(name):classes.delete(name);},contains(name){return classes.has(name);}},
      appendChild(child){this.children.push(child);},replaceChildren(...children){this.children=children;},
      focus(){this.focusCount++;},
      setAttribute(name,v){this.attributes[name]=v;},
      addEventListener(name,fn){this['on'+name]=fn;}};
    return n;
  }
  const document={
    activeElement:null,
    getElementById(id){return nodes[id]||(nodes[id]=node());},
    createElement(){return node();},
    createTextNode(text){return {textContent:text};},
    addEventListener(type,fn){listeners[type]=fn;}
  };
  const ctx={document,Promise,JSON,console,
    state:{folder:'set-a',currentItem:{key:'item-a',fileName:'a.jpg',
      metadata:{vision_sight:{description:'A swimsuit with ring connectors.'}}}},
    captionAssistCandidate:candidate,
    isFocusedQaReviewMode(){return false;},isCaptionAssistRunning(){return false;},
    isFocusedCaptionOpen(){return false;},
    isEditableElement(el){return !!(el && el.isContentEditable);},
    getMetadataForMedia(){return {};},
    captionAssistSightFingerprint(sight){return sight && sight.description || '';},
    buildCaptionAssistRequest(){return {model:'director-a',assignments:[],tags:[],
      openSight:{description:'A swimsuit with ring connectors.'}};},
    getCaptionAssistOmittedAssignments(){return [];},
    getCaptionAssistOmittedCorrections(){return [];},
    resetFocusedCaptionUseArm(){},syncCaptionAssistCandidateUi(){
      calls.push('sync');
      if(syncRenderer) ctx.syncCaptionAssistEnrichmentUi(ctx.captionAssistCandidate);
    },
    setStatus(msg){logs.push(['status',msg]);},
    reportConsoleWarning(label,msg){logs.push(['warn',msg]);},
    reportConsoleError(label,err){logs.push(['error',String(err)]);},
    cancelCaptionAssistJob(job){calls.push(['cancel',job]);return Promise.resolve(true);},
    captionAssistRequestJson(url,options){calls.push(['request',url,JSON.parse(options.body)]);return new Promise(r=>{resolveStart=r;});},
    waitForCaptionAssistJob(){return new Promise(r=>{resolveJob=r;});}
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  return {ctx,candidate,nodes,logs,calls,listeners,enableUiSync(){syncRenderer=true;},
    resolveStart:()=>resolveStart,resolveJob:()=>resolveJob};
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

test('proposals remain separate until accepted; final decision returns to editable draft',()=>{
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
  assert.equal(c.captionAssistEnrichment,null,'last decision returns to editable draft');
  assert.equal(c.finishCaptionAssistEnrichment('restore'),false,'review is already complete');
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view and soft side lighting.');
});

test('restore is available before the last enrichment suggestion is resolved',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',suggestions:[
      {anchor:'swimsuit',addition:' with metal rings',pending:true},
      {anchor:'front view',addition:' and soft side lighting',pending:true}]};
  c.resolveCaptionAssistEnrichment(c.captionAssistEnrichment.suggestions[0],true);
  assert.equal(candidate.text,'A woman posing in a swimsuit with metal rings, front view.');
  assert.equal(c.finishCaptionAssistEnrichment('restore'),true);
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  assert.equal(c.captionAssistEnrichment,null);
});

test('overlapping Sight suggestions cannot blank the preview or overwrite the draft',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  candidate.text='A swimsuit, front view against a wall.';
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',suggestions:[
      {anchor:'swimsuit',addition:' with metal rings',pending:true},
      {anchor:'swimsuit, front view',addition:' in soft light',pending:true},
      {anchor:'wall',addition:' with blue paint',pending:true}]};
  f.enableUiSync();
  c.syncCaptionAssistEnrichmentUi(candidate);
  const preview=f.nodes['editor-caption-enrichment-preview'];
  assert.equal(preview.children.filter(x=>x.className==='caption-enrichment-proposal').length,3);
  c.resolveCaptionAssistEnrichment(c.captionAssistEnrichment.suggestions[0],true);
  assert.equal(candidate.text,'A swimsuit with metal rings, front view against a wall.');
  assert.equal(c.captionAssistEnrichment.suggestions[1].pending,false,
    'conflicting anchor must be skipped after the accepted edit');
  assert.equal(preview.children.filter(x=>x.className==='caption-enrichment-proposal').length,1);
  assert.match(preview.children.map(x=>x.textContent || '').join(''),/A swimsuit with metal rings, front view against a wall/);
  assert.match(f.nodes['editor-caption-enrichment-status'].textContent,/1 conflicting skipped/);
  assert.equal(preview.focusCount,1,'focus stays inside the review after a suggestion button is replaced');
  assert.ok(f.logs.some(entry=>entry[0]==='warn' && /conflicting suggestion/.test(entry[1])),
    'discarding a stale suggestion must be visible in diagnostics');
  c.resolveCaptionAssistEnrichment(c.captionAssistEnrichment.suggestions[2],true);
  assert.equal(c.captionAssistEnrichment,null);
  assert.equal(candidate.text,'A swimsuit with metal rings, front view against a wall with blue paint.');
  assert.equal(f.nodes['editor-caption-candidate-text'].focusCount,1,
    'last review action restores focus to the real draft');
});

test('accept all skips anchors invalidated by earlier suggestions and leaves a focused draft',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  candidate.text='A swimsuit, front view against a wall.';
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',suggestions:[
      {anchor:'swimsuit',addition:' with rings',pending:true},
      {anchor:'swimsuit, front view',addition:' with details',pending:true},
      {anchor:'wall',addition:' with paint',pending:true}]};
  f.enableUiSync();
  c.syncCaptionAssistEnrichmentUi(candidate);
  assert.equal(c.finishCaptionAssistEnrichment('accept'),true);
  assert.equal(c.captionAssistEnrichment,null);
  assert.equal(candidate.text,'A swimsuit with rings, front view against a wall with paint.');
  assert.equal(f.nodes['editor-caption-candidate-text'].focusCount,1);
});

test('Edit caption exits review and focuses the existing contenteditable draft without applying proposals',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',suggestions:[
      {anchor:'swimsuit',addition:' with rings',pending:true}]};
  f.enableUiSync();
  c.syncCaptionAssistEnrichmentUi(candidate);
  assert.match(f.nodes['editor-caption-enrichment-status'].textContent,/Review mode .*Accept\/reject or Edit caption/);
  assert.equal(c.finishCaptionAssistEnrichment('done'),true);
  assert.equal(candidate.text,'A woman posing in a swimsuit, front view.');
  assert.equal(c.captionAssistEnrichment,null);
  assert.equal(f.nodes['editor-caption-candidate-text'].focusCount,1);
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


function automaticFixture() {
  const requests=[], waiters={}, cancelled=[], statuses=[];
  let model='director-a';
  const current={key:'item-a',fileName:'a.jpg',caption:'',metadata:{
    vision_sight:{description:'A swimsuit with ring connectors.'}
  }};
  const candidate={mediaKey:current.key,text:'A woman in a swimsuit.',model};
  const ctx={
    Promise,JSON,Map,console,
    state:{folder:'set-a',currentItem:current},
    captionAssistCandidate:candidate, focusedCaptionState:{open:true},
    isFocusedQaReviewMode(){return false;},isCaptionAssistRunning(){return false;},
    captionAssistSightFingerprint(sight){return JSON.stringify(sight || {});},
    getMetadataForMedia(){return {};},
    buildCaptionAssistRequest(item){
      return {model, assignments:[],tags:[],renderedPrimer:'A description.',
        preferredCaptionSequence:'subject then details', openSight:item.metadata.vision_sight};
    },
    syncCaptionAssistCandidateUi(){},
    getCaptionAssistOmittedAssignments(){return [];},
    getCaptionAssistOmittedCorrections(){return [];},
    resetFocusedCaptionUseArm(){},
    setStatus(status){statuses.push(status);},
    reportConsoleWarning(){},
    reportConsoleError(label,error){throw new Error(label+': '+String(error));},
    cancelCaptionAssistJob(jobId){cancelled.push(jobId);return Promise.resolve(true);},
    captionAssistRequestJson(url,options){
      const jobId='enrich-'+(requests.length+1);
      requests.push({url,request:JSON.parse(options.body),jobId});
      return Promise.resolve({job:{jobId,status:'queued'}});
    },
    waitForCaptionAssistJob(job){return new Promise(resolve=>{waiters[job.jobId]=resolve;});}
  };
  vm.createContext(ctx);
  vm.runInContext(source,ctx);
  function complete(i,body) {
    const request=requests[i];
    assert.ok(request && waiters[request.jobId],'job should already be submitted');
    waiters[request.jobId]({result:{text:JSON.stringify({suggestions:body})}});
  }
  return {ctx,current,candidate,requests,cancelled,statuses,complete,
    setModel(value){model=value;}};
}

test('automatic enrichment proposes without changing a ready draft and reuses results',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const first=c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,1);
  assert.equal(f.requests[0].request.mode,'enrich');
  assert.equal(f.candidate.text,'A woman in a swimsuit.');
  await Promise.resolve();
  f.complete(0,[{anchor:'swimsuit',addition:' with metal rings'}]);
  await first;
  assert.equal(c.captionAssistEnrichment.phase,'review');
  assert.equal(f.candidate.text,'A woman in a swimsuit.','suggestions must not auto-apply');
  c.cancelCaptionAssistEnrichment();
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,1,'reopen should use cached parsed suggestions');
  assert.equal(c.captionAssistEnrichment.suggestions.length,1);
  assert.equal(c.finishCaptionAssistEnrichment('discard'),true);
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,1,'dismissed suggestions stay dismissed for identical inputs');
});

test('lookahead shares an in-flight enrichment with its next visible item',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const next={key:'item-b',fileName:'b.jpg',caption:'',metadata:{
    vision_sight:{description:'Bright side lighting and metal rings.'}
  }};
  const candidate={mediaKey:'item-b',text:'A person in a swimsuit.',model:'director-a'};
  const warming=c.warmCaptionAssistEnrichment(next,candidate);
  assert.equal(f.requests.length,1);
  await Promise.resolve();
  c.state.currentItem=next;
  c.captionAssistCandidate=candidate;
  const adopted=c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,1,'adopting lookahead must not enqueue another Director job');
  assert.equal(c.captionAssistEnrichmentLookahead,null);
  f.complete(0,[{anchor:'swimsuit',addition:' with metal rings'}]);
  await Promise.all([warming,adopted]);
  assert.equal(c.captionAssistEnrichment.phase,'review');
  assert.equal(c.captionAssistEnrichment.candidate,candidate);
  assert.equal(candidate.text,'A person in a swimsuit.');
});

test('cancelling lookahead stops its job and drops stale proposals',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const next={key:'item-b',fileName:'b.jpg',metadata:{
    vision_sight:{description:'A bright studio.'}
  }};
  const prefetch=c.warmCaptionAssistEnrichment(next,{mediaKey:'item-b',text:'A studio.'});
  await Promise.resolve();
  await c.cancelCaptionAssistEnrichmentLookahead();
  assert.equal(f.cancelled.length,1);
  f.complete(0,[{anchor:'studio',addition:' with soft lighting'}]);
  await prefetch;
  assert.equal(c.captionAssistEnrichmentCache.size,0);
  assert.equal(c.captionAssistEnrichment,null);
});

test('enrichment cache is keyed by model, exact caption, and Sight',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const start=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  f.complete(0,[]);
  await start;
  assert.equal(f.requests.length,1);
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,1,'empty enrichment is still a reusable result');
  f.current.metadata.vision_sight={description:'Detailed view of the swimsuit ring fasteners.'};
  f.candidate.sightFingerprint=c.captionAssistSightFingerprint(f.current.metadata.vision_sight);
  const changedSight=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  assert.equal(f.requests.length,2);
  f.complete(1,[]);
  await changedSight;
  f.setModel('director-b');
  f.candidate.model='director-b';
  const changedModel=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  assert.equal(f.requests.length,3);
  f.complete(2,[]);
  await changedModel;
  f.candidate.text='A person standing in a swimsuit.';
  const changedDraft=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  assert.equal(f.requests.length,4);
  f.complete(3,[]);
  await changedDraft;
});

test('automatic enrichment skips missing Sight, outdated candidates and QA review',async()=>{
  const f=automaticFixture(),c=f.ctx;
  f.current.metadata.vision_sight=null;
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,0);
  f.current.metadata.vision_sight={description:'Some details.'};
  f.candidate.model='older-director';
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,0);
  f.candidate.model='director-a';
  f.candidate.sourceCaption='old saved caption';
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,0);
  f.candidate.sourceCaption='';
  f.current.caption='Caption saved elsewhere.';
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,0,'stale originally-empty source captions must not auto-run');
  delete f.candidate.sourceCaption;
  c.isFocusedQaReviewMode=()=>true;
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,0);
});


test('running enrichment discards output when the Sight evidence changes mid-request',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const current=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  f.current.metadata.vision_sight={description:'Revised Sight shows a different outfit.'};
  f.complete(0,[{anchor:'swimsuit',addition:' with metal rings'}]);
  assert.equal(await current,false);
  assert.equal(c.captionAssistEnrichment,null);
  assert.equal(c.captionAssistEnrichmentCache.size,0);
  assert.equal(f.cancelled.length,0,'completed jobs should not receive a stale cancellation');
  assert.ok(f.statuses.some(x=>x.includes('inputs changed during enrichment')));
});

test('a newly queued lookahead cancels the previous item and keeps only useful results',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const itemB={key:'item-b',fileName:'b.jpg',metadata:{vision_sight:{description:'Sight B'}}};
  const itemC={key:'item-c',fileName:'c.jpg',metadata:{vision_sight:{description:'Sight C'}}};
  const b=c.warmCaptionAssistEnrichment(itemB,{mediaKey:'item-b',text:'A studio.'});
  await Promise.resolve();
  const z=c.warmCaptionAssistEnrichment(itemC,{mediaKey:'item-c',text:'A studio.'});
  await Promise.resolve();
  assert.equal(f.requests.length,2);
  assert.deepEqual(f.cancelled,['enrich-1']);
  f.complete(0,[{anchor:'studio',addition:' B detail'}]);
  f.complete(1,[{anchor:'studio',addition:' C detail'}]);
  await Promise.all([b,z]);
  assert.equal(c.captionAssistEnrichmentCache.size,1);
  assert.equal(c.captionAssistEnrichmentLookahead.mediaKey,'item-c');
});

test('late Director enqueue is cancelled after leaving a speculative item',async()=>{
  const f=automaticFixture(),c=f.ctx;
  let finishSubmit;
  c.captionAssistRequestJson=()=>new Promise(resolve=>{finishSubmit=resolve;});
  const itemB={key:'item-b',fileName:'b.jpg',metadata:{vision_sight:{description:'Sight B'}}};
  const pending=c.warmCaptionAssistEnrichment(itemB,{mediaKey:'item-b',text:'A studio.'});
  await c.cancelCaptionAssistEnrichmentLookahead();
  finishSubmit({job:{jobId:'late-job'}});
  assert.equal(await pending,false);
  assert.deepEqual(f.cancelled,['late-job']);
  assert.equal(c.captionAssistEnrichmentCache.size,0);
});


test('changed next-item draft cancels its mismatched lookahead instead of duplicating it',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const next={key:'item-b',fileName:'b.jpg',caption:'',metadata:{
    vision_sight:{description:'Studio with a bright backdrop.'}
  }};
  const ahead=c.warmCaptionAssistEnrichment(next,{mediaKey:'item-b',text:'An original caption.'});
  await Promise.resolve();
  c.state.currentItem=next;
  c.captionAssistCandidate={mediaKey:'item-b',text:'A revised caption.'};
  const current=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  assert.equal(f.requests.length,2);
  assert.deepEqual(f.cancelled,['enrich-1']);
  f.complete(0,[]);
  f.complete(1,[]);
  await Promise.all([ahead,current]);
  assert.equal(c.captionAssistEnrichmentCache.size,1);
});


test('a successful empty Enrich result shows quiet feedback beside the button, not an empty review',async()=>{
  const f=fixture(),c=f.ctx;
  const first=c.runCaptionAssistEnrichment();
  f.resolveStart()({job:{jobId:'enrich-empty'}});
  await Promise.resolve();await Promise.resolve();
  f.resolveJob()({result:{text:'{"suggestions":[]}' }});
  assert.equal(await first,true);
  assert.equal(c.captionAssistEnrichment.phase,'empty');
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  const note=f.nodes['editor-caption-enrichment-empty'];
  assert.equal(note.classList.contains('hidden'),false);
  const html=fs.readFileSync('tool/tool.html','utf8');
  assert.match(html,/id="editor-caption-enrichment-empty"[^>]*role="status"[^>]*>✓ No additional details found<\/span>/,
    'the actual HTML supplies the accessible, quiet completion text');
  assert.equal(f.nodes['editor-caption-enrichment-preview'].classList.contains('hidden'),true);
  assert.equal(f.nodes['editor-caption-enrichment-actions'].classList.contains('hidden'),true);
  assert.equal(f.nodes['editor-caption-enrich'].disabled,false,'the user may request a fresh review');
  assert.equal(f.candidate.text,'A woman posing in a swimsuit, front view.');

  f.candidate.text+=' A new phrase.';
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  assert.equal(note.classList.contains('hidden'),true,'changing the draft clears the stale confirmation');

  c.cancelCaptionAssistEnrichment();
  f.candidate.text='A woman posing in a swimsuit, front view.';
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  assert.equal(note.classList.contains('hidden'),true,'the confirmation does not leak after exit');
});

test('an explicit Enrich retry clears empty feedback while running and can show suggestions',async()=>{
  const f=fixture(),c=f.ctx;
  const first=c.runCaptionAssistEnrichment();
  f.resolveStart()({job:{jobId:'enrich-empty'}});
  await Promise.resolve();await Promise.resolve();
  f.resolveJob()({result:{text:'{"suggestions":[]}' }});
  await first;
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  assert.equal(f.nodes['editor-caption-enrichment-empty'].classList.contains('hidden'),false);

  const refreshed=c.runCaptionAssistEnrichment();
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  assert.equal(f.nodes['editor-caption-enrichment-empty'].classList.contains('hidden'),true);
  assert.equal(f.nodes['editor-caption-enrich'].textContent,'✦ Director reviewing…');
  f.resolveStart()({job:{jobId:'enrich-refreshed'}});
  await Promise.resolve();await Promise.resolve();
  f.resolveJob()({result:{text:'{"suggestions":[{"anchor":"swimsuit","addition":" with metal rings"}]}' }});
  assert.equal(await refreshed,true);
  c.syncCaptionAssistEnrichmentUi(f.candidate);
  assert.equal(c.captionAssistEnrichment.phase,'review');
  assert.equal(f.nodes['editor-caption-enrichment-empty'].classList.contains('hidden'),true);
  assert.equal(f.nodes['editor-caption-enrichment-preview'].classList.contains('hidden'),false);
});

test('cached and lookahead empty results remain visible only when their own item is opened',async()=>{
  const f=automaticFixture(),c=f.ctx;
  const first=c.maybeRunCaptionAssistEnrichment();
  await Promise.resolve();
  f.complete(0,[]);
  await first;
  assert.equal(c.captionAssistEnrichment.phase,'empty');
  c.cancelCaptionAssistEnrichment();
  const restored=c.maybeRunCaptionAssistEnrichment();
  await restored;
  assert.equal(f.requests.length,1,'cached empty results should not make extra requests');
  assert.equal(c.captionAssistEnrichment.phase,'empty','cached completion restores its UI state');

  const next={key:'item-b',fileName:'b.jpg',caption:'',metadata:{
    vision_sight:{description:'A window-lit studio.'}
  }};
  const candidate={mediaKey:'item-b',text:'A person inside a studio.',model:'director-a'};
  const lookahead=c.warmCaptionAssistEnrichment(next,candidate);
  await Promise.resolve();
  f.complete(1,[]);
  await lookahead;
  assert.equal(c.captionAssistEnrichment.candidate,f.candidate,
    'background lookahead never displays on the previous item');

  c.state.currentItem=next;
  c.captionAssistCandidate=candidate;
  await c.maybeRunCaptionAssistEnrichment();
  assert.equal(f.requests.length,2);
  assert.equal(c.captionAssistEnrichment.candidate,candidate);
  assert.equal(c.captionAssistEnrichment.phase,'empty');
});


test('active enrichment review owns arrows and media shortcuts without stealing button Enter',()=>{
  const file=fs.readFileSync('tool/js/focused_caption.js','utf8');
  const start=file.indexOf('function wireFocusedCaption() {');
  const stop=file.indexOf('\nwireFocusedCaption();',start);
  assert.ok(start>=0 && stop>start);
  const sourceWire=file.slice(start,stop);
  let reviewing=true;
  const moves=[];
  const listeners={};
  function button(){return {addEventListener(){}};}
  const doc={
    activeElement:null,
    getElementById(){return button();},
    addEventListener(type,handler){listeners[type]=handler;}
  };
  const ctx={
    document:doc,window:{addEventListener(){}},
    ui:{previewFocusCaptionBtnEl:button(),previewFocusCaptionSkipBtnEl:button()},
    focusedCaptionState:{open:true},captionAssistCandidate:{mediaKey:'item-a'},
    captionAssistEnrichmentReviewActive(){return reviewing;},
    captionAssistEnrichmentBlocksMediaShortcut(event){
      return reviewing && !(doc.activeElement && doc.activeElement.isContentEditable) &&
        !event.altKey && !event.ctrlKey && !event.metaKey &&
        (/^Arrow(?:Left|Right|Up|Down)$/.test(event.key) || /^[a-z0-5]$/i.test(event.key));
    },
    isEditableElement(element){return !!(element && element.isContentEditable);},
    moveFocusedCaption(delta){moves.push(delta);},
    syncFocusedCaptionControls(){},renderFileList(){},
    stopFocusedCaption(){return true;}
  };
  vm.createContext(ctx);
  vm.runInContext(sourceWire+'\nwireFocusedCaption();',ctx);
  function key(name) {
    const event={key:name,defaultPrevented:false,repeat:false,
      ctrlKey:false,metaKey:false,altKey:false,
      preventDefault(){this.defaultPrevented=true;},
      stopImmediatePropagation(){this.stopped=true;}};
    listeners.keydown(event);
    return event;
  }
  ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','s','r','1'].forEach(name=>{
    const event=key(name);
    assert.equal(event.stopped,true,'review should block '+name+' from global shortcuts');
    assert.equal(event.defaultPrevented,false,'review should preserve native text scrolling');
  });
  assert.deepEqual(moves,[]);
  assert.equal(key('Enter').stopped,undefined,'Enter must still activate focused accept/reject buttons');
  assert.equal(key('Tab').stopped,undefined,'Tab must keep working during review');
  reviewing=false;
  assert.equal(key('ArrowRight').defaultPrevented,true);
  assert.deepEqual(moves,[1],'normal focus navigation remains intact after review');
  doc.activeElement={isContentEditable:true};
  assert.equal(key('ArrowLeft').defaultPrevented,false);
  assert.deepEqual(moves,[1],'actual contenteditable caret keeps arrow keys');
});

test('standalone Caption Assist review also blocks media shortcuts and releases them on exit',()=>{
  const f=fixture(),c=f.ctx,candidate=f.candidate;
  c.captionAssistEnrichment={candidate,mediaKey:candidate.mediaKey,phase:'review',
    originalText:candidate.text,jobId:'',suggestions:[]};
  c.wireCaptionAssistEnrichment();
  assert.equal(typeof f.listeners.keydown,'function');
  function key(value) {
    const event={key:value,defaultPrevented:false,repeat:false,
      ctrlKey:false,metaKey:false,altKey:false,
      stopImmediatePropagation(){this.stopped=true;}};
    f.listeners.keydown(event);
    return event;
  }
  for(const value of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','r','s','1'])
    assert.equal(key(value).stopped,true,'review should own '+value+' even without Focus Caption');
  assert.equal(key('Enter').stopped,undefined,'native suggestion-button Enter stays available');
  assert.equal(key('Tab').stopped,undefined);
  c.captionAssistEnrichment=null;
  assert.equal(key('ArrowRight').stopped,undefined,'global shortcuts return after review');
});

test('review visuals distinguish the read-only focusable preview from contenteditable draft',()=>{
  const html=fs.readFileSync('tool/tool.html','utf8');
  const css=fs.readFileSync('tool/css/modals.css','utf8');
  const primer=fs.readFileSync('tool/js/primer_settings.js','utf8');
  assert.match(html,/id="editor-caption-enrichment-preview"[^>]*role="region"[^>]*tabindex="0"/);
  assert.match(css,/\.editor-caption-candidate-draft\.is-enrichment-review\s*\{/);
  assert.match(css,/\.caption-enrichment-preview:focus-visible/);
  assert.match(primer,/textEl\.parentElement\.classList\.toggle\('is-enrichment-review', enrichmentPreview\)/);
  assert.match(primer,/textEl\.setAttribute\('contenteditable', visible && !enrichmentPreview \? 'true' : 'false'\)/);
});
