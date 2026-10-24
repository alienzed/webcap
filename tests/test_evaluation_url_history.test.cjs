'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const shell=fs.readFileSync(path.join(__dirname,'../tool/js/workspace_shell.js'),'utf8');
const from=shell.indexOf('function normalizeShellRouteWorkspace(');
const to=shell.indexOf('function applyInitialShellLocationRoute(',from);
assert.ok(from>=0&&to>from,'Shell route parsing/writing functions must exist');
const routeFns=shell.slice(from,to);

function harness(hash='#/test?folder=dataset%2Fone') {
  const location={hash,pathname:'/tool',search:''};
  const writes=[];
  let mode='tests';
  const change=(kind,url)=>{
    writes.push({kind,url});
    location.hash=url.substring(url.indexOf('#'));
  };
  const window={
    location,
    history:{
      pushState(_state,_title,url){change('push',url);},
      replaceState(_state,_title,url){change('replace',url);}
    },
    epochFinderCurrentMode(){return mode;},
    appendMediaExplorerRouteParams(){throw new Error('Not expected');},
    getStoryboardRouteTarget(){throw new Error('Not expected');}
  };
  const ctx={
    window,URLSearchParams,
    state:{folder:'dataset/one'},
    deriveShellNavigationState(){return {activity:'test'};},
    getTrainingWorkspaceEntryKind(){return 'set';},
    initialShellLocationRoute:null,
    initialShellLocationRestored:true
  };
  vm.runInNewContext(routeFns,ctx);
  return {ctx,location,writes,setMode(next){mode=next;}};
}

test('Evaluation method is present in shareable URL and parsed on reload',()=>{
  const h=harness();
  h.setMode('screening');
  h.ctx.syncShellLocationRoute();
  assert.equal(h.location.hash,'#/test?folder=dataset%2Fone&method=screening');
  assert.equal(h.ctx.parseShellLocationRoute().evaluationMethod,'screening');
  assert.equal(h.ctx.parseShellLocationRoute().folder,'dataset/one');
  assert.equal(h.writes[0].kind,'replace');

  h.setMode('tests');
  h.ctx.syncShellLocationRoute();
  assert.equal(h.location.hash,'#/test?folder=dataset%2Fone');
  assert.equal(h.ctx.parseShellLocationRoute().evaluationMethod,'tests');
});

test('Explicit method selection adds Back/Forward entry; background sync does not',()=>{
  const h=harness();
  h.setMode('finder');
  h.ctx.syncShellLocationRoute({push:true});
  assert.equal(h.writes[0].kind,'push');
  assert.match(h.location.hash,/method=finder/);
  h.ctx.syncShellLocationRoute({push:true});
  assert.equal(h.writes.length,1,'Repeated navigation to same method adds no entry');
  h.setMode('analytics');
  h.ctx.syncShellLocationRoute();
  assert.equal(h.writes.at(-1).kind,'replace');
  assert.match(h.location.hash,/method=analytics/);
});

test('All Evaluation tabs round-trip without changing folder or shell route',()=>{
  for(const mode of ['screening','finder','analytics','references']){
    const h=harness();
    h.setMode(mode);
    h.ctx.syncShellLocationRoute({push:true});
    assert.equal(h.ctx.parseShellLocationRoute().workspace,'test');
    assert.equal(h.ctx.parseShellLocationRoute().evaluationMethod,mode);
    assert.equal(h.ctx.parseShellLocationRoute().folder,'dataset/one');
  }
  assert.match(shell,/window\.addEventListener\('popstate', function \(\)/);
  assert.match(shell,/window\.epochFinderShowMode\(route\.evaluationMethod, \{ restore: true \}\)/);
  assert.match(shell,/window\.epochFinderShowMode\(route\.evaluationMethod\)/);
});
