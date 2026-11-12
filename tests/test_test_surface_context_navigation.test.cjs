const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const finder=fs.readFileSync(path.join(root,'tool/js/epoch_finder.js'),'utf8');
const testJs=fs.readFileSync(path.join(root,'tool/js/test_generations.js'),'utf8');
const inspector=fs.readFileSync(path.join(root,'tool/js/epoch_info.js'),'utf8');
const html=fs.readFileSync(path.join(root,'tool/tool.html'),'utf8');
const begin=finder.indexOf('  function showMode(next, options) {');
const end=finder.indexOf('  function renderSecondsEstimate(',begin);
assert.ok(begin>0&&end>begin,'Evaluation surface navigator must exist');
const modeController=finder.slice(begin,end);
const helpersStart=finder.indexOf('  function emptyMethodWorkspace() {');
const helpersEnd=finder.indexOf('  window.epochFinderReceiveSetPrompt',helpersStart);
assert.ok(helpersStart>0&&helpersEnd>helpersStart,'Method-owned selection helpers must exist');
const methodHelpers=finder.slice(helpersStart,helpersEnd);

function makeClassList(initial=[]){
  const flags=new Set(initial);
  return {
    add(v){flags.add(v);},remove(v){flags.delete(v);},contains(v){return flags.has(v);},
    toggle(v,force){if(force===undefined?!flags.has(v):force)flags.add(v);else flags.delete(v);}
  };
}
function harness(){
  const nodes=new Map();
  const tabs=['tests','finder','analytics','references'].map(mode=>({
    dataset:{testWorkspaceMode:mode},classList:makeClassList(),attributes:{},
    setAttribute(name,value){this.attributes[name]=value;}
  }));
  const stats={finder:0,references:0,analytics:0,urlWrites:[]};
  function makeNode(id){
    return {id,classList:makeClassList(id.startsWith('test-workspace-return-')?['hidden']:[]),
      link:{textContent:''},querySelector(selector){
        assert.equal(selector,'[data-test-workspace-back]');return this.link;
      }};
  }
  function node(id){if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id);}
  const document={
    getElementById:node,
    querySelectorAll(selector){
      assert.equal(selector,'#test-workspace-main-tabs [data-test-workspace-mode]');return tabs;
    }
  };
  const win={
    getWorkingModelProfileId(){return 'h3';},
    testReferencesOpen(){stats.references++;},
    runAnalyticsOpen(){stats.analytics++;},
    runAnalyticsSetVisible(visible){stats.analyticsVisible=visible;},
    syncShellLocationRoute(options){stats.urlWrites.push(options||null);}
  };
  const ctx={window:win,document,els:id=>node('epoch-finder-'+id),
    refresh:()=>{stats.finder++;},currentFolder:'my-set',activeCampaign:'',
    campaignState:null,campaigns:[],listRequestVersion:0,
    runEpochSelections:{},stagedSelection:new Set(),sourceMode:'runs',
    referenceSelections:{},referenceGeneration:0,
    inspectedEpoch:null,inspectedFrame:0,lastFrameKey:'',wizardStep:1,
    showStep:()=>{stats.referenceRestores=(stats.referenceRestores||0)+1;},Set};
  vm.runInNewContext("var mode='tests';var returnMode='';var surfaceLabels={tests:'Prompt Tests',finder:'Campaigns',references:'References',analytics:'Insights'};"+methodHelpers+modeController,ctx);
  return {window:win,node,tabs,stats,ctx};
}

test('Campaign deep-link returns to Insights without destroying the report',()=>{
  const h=harness();
  h.window.epochFinderShowMode('analytics');
  assert.equal(h.stats.analytics,1);
  h.window.epochFinderShowMode('finder',{returnTo:'analytics'});
  const back=h.node('test-workspace-return-finder');
  assert.equal(back.classList.contains('hidden'),false);
  assert.equal(back.link.textContent,'← Back to Insights');
  assert.equal(h.stats.finder,1);
  h.window.epochFinderShowMode('analytics',{restore:true});
  assert.equal(h.stats.analytics,1);
  assert.equal(back.classList.contains('hidden'),true);
  assert.equal(h.window.epochFinderCurrentMode(),'analytics');
});

test('Campaign history and picker state survive a visit to Insights',()=>{
  const h=harness();
  h.window.epochFinderShowMode('finder');
  h.ctx.activeCampaign='campaign-one';
  h.ctx.sourceMode='staged';
  h.ctx.stagedSelection.add('campaign.safetensors');
  h.ctx.runEpochSelections={'run-a':new Set([1,2])};
  h.ctx.referenceSelections={red:{media:'ref.jpg'}};
  h.window.epochFinderShowMode('analytics');
  assert.equal(h.window.epochFinderCurrentMode(),'analytics');
  assert.equal(h.stats.analyticsVisible,true);

  h.window.epochFinderShowMode('finder');
  assert.equal(h.ctx.activeCampaign,'campaign-one');
  assert.equal(h.ctx.sourceMode,'staged');
  assert.deepEqual([...h.ctx.stagedSelection],['campaign.safetensors']);
  assert.deepEqual([...h.ctx.runEpochSelections['run-a']],[1,2]);
  assert.equal(h.ctx.referenceSelections.red.media,'ref.jpg');
  assert.equal(h.stats.analyticsVisible,false);
  assert.throws(()=>h.window.epochFinderShowMode('screening'),/Unknown Test workspace destination/);
  assert.doesNotMatch(html,/id="epoch-finder-campaign-type"/);
});

test('returning to Campaign references restarts an interrupted reference lookup',()=>{
  const h=harness();
  h.window.epochFinderShowMode('analytics');
  h.ctx.wizardStep=4;
  h.window.epochFinderShowMode('finder');
  assert.equal(h.stats.referenceRestores,1);
});

test('native Test deep-link and explicit tab reset preserve contextual returns',()=>{
  const h=harness();
  h.window.epochFinderShowMode('tests',{returnTo:'finder'});
  assert.equal(h.node('test-workspace-return-tests').classList.contains('hidden'),false);
  assert.equal(h.node('test-workspace-return-tests').link.textContent,'← Back to Campaigns');
  h.window.epochFinderShowMode('finder');
  assert.equal(h.node('test-workspace-return-tests').classList.contains('hidden'),true);
  assert.equal(h.node('test-workspace-return-finder').classList.contains('hidden'),true);
  assert.throws(()=>h.window.epochFinderShowMode('bogus'),/Unknown Test workspace destination/);
});

test('origin-aware links keep the native checkpoint and campaign return path',()=>{
  assert.match(testJs,/window\.openTestBenchAnalyticsSession = function \(sessionId\)/);
  assert.match(testJs,/window\.epochFinderCurrentMode\(\)/);
  assert.match(inspector,/function backToTestResults\(\)/);
  assert.match(inspector,/back\.onclick=window\.epochInfoShowSession/);
  assert.match(html,/id="test-workspace-return-tests"/);
  assert.match(html,/id="test-workspace-return-finder"/);
  assert.match(finder,/returnTo:previous,keepCampaign:true,campaignId:String\(campaignId\)/);
});

test('switching methods before a status response does not replace the new method',async()=>{
  const h=harness();
  h.window.epochFinderShowMode('finder');
  h.ctx.activeCampaign='campaign-loading';
  const pending=[];
  const rendered=[];
  h.ctx.api=()=>new Promise(resolve=>pending.push(resolve));
  h.ctx.render=campaign=>rendered.push(campaign);
  vm.runInNewContext(finder.slice(finder.indexOf('  function refreshStatus() {'),
    finder.indexOf('  function refresh() {')),h.ctx);
  const status=h.ctx.refreshStatus();
  h.window.epochFinderShowMode('analytics');
  pending.shift()({campaign:{id:'campaign-loading',mode:'campaign'}});
  await status;
  assert.equal(rendered.length,0);
  h.window.epochFinderShowMode('finder');
  assert.equal(h.ctx.activeCampaign,'campaign-loading');
});

test('switching between live method lists rejects stale responses',()=>{
  assert.match(finder,/var modeAtRequest = mode, requestVersion = \+\+listRequestVersion/);
  assert.match(finder,/mode !== modeAtRequest\) return/);
});
