/* Smoke-test the unified workspace DOM ownership without running inference. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');

const actions=['explore','build','experiments','checkpoints','reload','legacy','normal','finder','references','analytics','new'];
const buttons = actions.map(name=>'<button id="test-unified-'+name+'"></button>').join('');
const html = `<!doctype html><html><body>
<div id="test-generations-body">
 <aside class="test-generations-rail">
  <button data-test-generations-perspective="build"></button> 
  <button data-test-generations-perspective="explore"></button>
  <div class="test-generations-controls">
   <section class="test-generations-next-run" id="real-test-form"><input id="test-generations-prompt"></section>
   <details id="test-generations-batch-summary"></details>
   <div id="test-generations-status"></div><div id="test-generations-error"></div>
   <section><div class="test-generations-staged-panel" id="real-candidates"></div></section>
  </div>
 </aside>
</div>
<section id="epoch-finder-screen"></section>
<section id="test-references-screen"></section>
<section id="run-analytics-screen"></section>
<div id="test-unified-workspace" class="hidden">
 <aside class="test-unified-rail">${buttons}<div id="test-unified-list"></div></aside>
 <main><h2 id="test-unified-title"></h2><p id="test-unified-description"></p>
 <div id="test-unified-gallery"></div><div id="test-unified-builder" class="hidden"></div></main>
 <aside id="test-unified-inspector"><div id="test-unified-details"></div></aside>
</div></body></html>`;

test('Explore, Build and Finder preserve original control nodes and image attribution', async()=>{
 const dom=new JSDOM(html,{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window, d=w.document, calls=[];
 w.getWorkingModelProfileId=()=> 'h3';
 w.epochFinderShowMode=mode=>calls.push('mode:'+mode);
 w.epochFinderPrepare=folder=>calls.push('prepare:'+folder);
 w.epochFinderInspectCampaign=(id,epoch,job)=>calls.push('campaign:'+id+':'+epoch+':'+job);
 w.openTestBenchAnalyticsSession=id=>calls.push('session:'+id);
 w.reportConsoleError=(context,error)=>{throw error;};
 const payload={ok:true,sessions:[{id:'test-one',name:'Prompt stress test',modelId:'h3'}],
   campaigns:[{id:'abc123',name:'Epoch comparison',modelId:'h3'}],
   runs:[{jobId:'run1',runName:'H3 Training',modelId:'h3',epochs:[75,80]}],
   media:[
     {id:'test:test-one:a.png',source:'test',collectionId:'test:test-one',
       session:'test-one',mediaFile:'a.png',jobId:'run1',epoch:75,runName:'H3 Training',prompt:'red outfit',rating:5},
     {id:'campaign:abc123:0',source:'campaign',collectionId:'campaign:abc123',
       campaignId:'abc123',frame:'r1-e0-c1.png',jobId:'run1',epoch:75,runName:'H3 Training',prompt:'blue outfit'}],
   warnings:[]};
 w.fetch=async()=>({ok:true,json:async()=>payload});
 w.eval(fs.readFileSync('tool/js/test_generations_perspective.js','utf8')); 
 w.eval(fs.readFileSync('tool/js/test_generations_unified.js','utf8'));
 w.epochFinderPrepare('sets/foo');
 d.querySelector('[data-test-generations-perspective="explore"]').click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(d.querySelectorAll('.test-unified-card').length,2);
 assert.ok(d.getElementById('test-generations-body').classList.contains('hidden'));
 d.getElementById('test-unified-build').click();
 assert.ok(d.getElementById('test-unified-builder').contains(d.getElementById('real-test-form')));
 assert.ok(d.getElementById('test-unified-builder').contains(d.getElementById('real-candidates')));
 d.getElementById('test-unified-finder').click();
 assert.ok(d.getElementById('test-unified-builder').contains(d.getElementById('epoch-finder-screen')));
 assert.ok(calls.includes('mode:finder'));
 d.getElementById('test-unified-references').click();
 assert.ok(d.getElementById('test-unified-builder').contains(d.getElementById('test-references-screen')));
 d.getElementById('test-unified-analytics').click();
 assert.ok(d.getElementById('test-unified-builder').contains(d.getElementById('run-analytics-screen')));
 d.getElementById('test-unified-explore').click();
 assert.ok(!d.getElementById('test-unified-builder').contains(d.getElementById('real-test-form')));
 assert.equal(d.querySelectorAll('.test-unified-card').length,2);
 d.getElementById('test-unified-checkpoints').click();
 assert.equal(d.querySelectorAll('.test-unified-item').length,2);
 d.querySelectorAll('.test-unified-item')[0].click();
 assert.equal(d.querySelectorAll('.test-unified-card').length,2);
 d.querySelectorAll('.test-unified-card')[0].click();
 assert.match(d.getElementById('test-unified-details').textContent,/Source/);
 assert.match(d.getElementById('test-unified-details').textContent,/red outfit/);
 d.querySelector('#test-unified-details button').click();
 assert.ok(calls.includes('session:test-one'));
 assert.ok(d.getElementById('test-unified-workspace').classList.contains('hidden')); 
 assert.ok(!d.getElementById('test-generations-body').classList.contains('test-generations-explore'));
 dom.window.close();
});

test('real WebCap Test markup retains all live controls through unified view transitions',async()=>{
 const real=fs.readFileSync('tool/tool.html','utf8');
 const dom=new JSDOM(real,{url:'http://localhost/',runScripts:'outside-only'});
 const w=dom.window,d=w.document;
 w.getWorkingModelProfileId=()=> 'h3';
 w.epochFinderShowMode=()=>{};
 w.epochFinderPrepare=()=>{};
 w.epochFinderInspectCampaign=()=>{};
 w.openTestBenchAnalyticsSession=()=>{};
 w.reportConsoleError=()=>{};
 w.fetch=async()=>({ok:true,json:async()=>({ok:true,sessions:[],campaigns:[],runs:[],media:[]})});
 w.eval(fs.readFileSync('tool/js/test_generations_perspective.js','utf8'));
 w.eval(fs.readFileSync('tool/js/test_generations_unified.js','utf8'));
 w.epochFinderPrepare('set-one');
 d.querySelector('[data-test-generations-perspective="explore"]').click();
 await new Promise(resolve=>setImmediate(resolve));
 d.getElementById('test-unified-build').click();
 const builder=d.getElementById('test-unified-builder');
 assert.ok(builder.contains(d.getElementById('test-generations-run-btn')));
 assert.ok(builder.contains(d.getElementById('test-generations-batch-btn')));
 assert.ok(builder.contains(d.getElementById('test-generations-files')));
 d.getElementById('test-unified-finder').click();
 assert.ok(builder.contains(d.getElementById('epoch-finder-start')));
 d.getElementById('test-unified-references').click();
 assert.ok(builder.contains(d.getElementById('test-references-gallery')));
 d.getElementById('test-unified-analytics').click();
 assert.ok(builder.contains(d.getElementById('run-analytics-director')));
 d.getElementById('test-unified-explore').click();
 assert.ok(!builder.contains(d.getElementById('epoch-finder-start')));
 assert.ok(d.getElementById('test-generations-body').contains(d.getElementById('test-generations-run-btn')));
 d.getElementById('test-unified-legacy').click();
 assert.ok(!d.getElementById('test-generations-body').classList.contains('hidden'));
 assert.ok(!d.getElementById('test-generations-body').classList.contains('test-generations-explore'));
 dom.window.close();
});
