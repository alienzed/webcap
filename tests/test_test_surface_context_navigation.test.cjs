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
const end=finder.indexOf("  document.getElementById('epoch-finder-back-to-tests')",begin);
assert.ok(begin>0&&end>begin,'Native Test surface navigator must exist');
const modeController=finder.slice(begin,end);

function harness(){
  const nodes=new Map();
  const tabs=['tests','finder','references','analytics'].map(mode=>({
    dataset:{testWorkspaceMode:mode},
    classList:makeClassList(),
    attributes:{},
    setAttribute(name,value){this.attributes[name]=value;}
  }));
  const stats={finder:0,references:0,analytics:0};
  function makeNode(id){
    return {id,classList:makeClassList(id.startsWith('test-workspace-return-')?['hidden']:[]),
      link:{textContent:''},querySelector(selector){
        assert.equal(selector,'[data-test-workspace-back]');
        return this.link;
      }};
  }
  function node(id){if(!nodes.has(id))nodes.set(id,makeNode(id));return nodes.get(id);}
  const document={
    getElementById:node,
    querySelectorAll(selector){
      assert.equal(selector,'#test-workspace-main-tabs [data-test-workspace-mode]');
      return tabs;
    }
  };
  const win={
    testReferencesOpen(){stats.references++;},
    runAnalyticsOpen(){stats.analytics++;}
  };
  const ctx={window:win,document,els:id=>node('epoch-finder-'+id),refresh:()=>{stats.finder++;}};
  vm.runInNewContext("var mode='tests';var returnMode='';var surfaceLabels={tests:'Tests',finder:'Campaigns',references:'References',analytics:'Insights'};"+modeController,ctx);
  return {window:win,node,tabs,stats};
}
function makeClassList(initial=[]){
  const flags=new Set(initial);
  return {
    add(v){flags.add(v);},remove(v){flags.delete(v);},contains(v){return flags.has(v);},
    toggle(v,force){if(force===undefined?!flags.has(v):force)flags.add(v);else flags.delete(v);}
  };
}

test('deep-link to Campaign preserves an explicit return to Insights',()=>{
  const h=harness();
  h.window.epochFinderShowMode('analytics');
  assert.equal(h.stats.analytics,1);
  h.window.epochFinderShowMode('finder',{returnTo:'analytics'});
  const back=h.node('test-workspace-return-finder');
  assert.equal(back.classList.contains('hidden'),false);
  assert.equal(back.link.textContent,'← Back to Insights');
  assert.equal(h.stats.finder,1);
  h.window.epochFinderShowMode('analytics',{restore:true});
  assert.equal(h.stats.analytics,1,'return must not reload and overwrite Insights report');
  assert.equal(back.classList.contains('hidden'),true);
  assert.equal(h.window.epochFinderCurrentMode(),'analytics');
});
test('same native navigator supports Test session deep-link and explicit tab reset',()=>{
  const h=harness();
  h.window.epochFinderShowMode('tests',{returnTo:'analytics'});
  assert.equal(h.node('test-workspace-return-tests').classList.contains('hidden'),false);
  assert.equal(h.node('test-workspace-return-tests').link.textContent,'← Back to Insights');
  h.window.epochFinderShowMode('finder');
  assert.equal(h.node('test-workspace-return-tests').classList.contains('hidden'),true);
  assert.equal(h.node('test-workspace-return-finder').classList.contains('hidden'),true);
  assert.equal(h.tabs.find(x=>x.dataset.testWorkspaceMode==='finder').attributes['aria-pressed'],'true');
  assert.equal(h.tabs.find(x=>x.dataset.testWorkspaceMode==='tests').attributes['aria-pressed'],'false');
  assert.throws(()=>h.window.epochFinderShowMode('something-else'),/Unknown Test workspace destination/);
});
test('all origin-aware links remain native with a local Test checkpoint back path',()=>{
  assert.match(testJs,/window\.openTestBenchAnalyticsSession = function \(sessionId\)/);
  assert.match(testJs,/window\.epochFinderCurrentMode\(\)/);
  assert.match(inspector,/function backToTestResults\(\)/);
  assert.match(inspector,/back\.onclick=window\.epochInfoShowSession/);
  assert.match(inspector,/host\.prepend\(view\.mode==='analytics'\?backToInsights\(\):backToTestResults\(\)\)/);
  assert.match(html,/id="test-workspace-return-tests"/);
  assert.match(html,/id="test-workspace-return-finder"/);
});
