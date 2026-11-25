const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const start = source.indexOf('  function studioReplyText(content) {');
const end = source.indexOf('  function renderStudioOperations() {',start);

function harness() {
  function node() {
    const classes = new Set();
    return {children:[],parent:null,dataset:{},scrollTop:0,scrollHeight:0,clientHeight:0,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),
      contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}},
      detach(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;},
      appendChild(n){n.detach();this.children.push(n);n.parent=this;return n;},
      append(...nodes){nodes.forEach(n=>this.appendChild(n));},
      insertBefore(n,before){n.detach();const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,n);n.parent=this;},
      remove(){this.detach();},
      replaceChildren(...nodes){this.children.forEach(n=>{n.parent=null;});this.children=[];this.append(...nodes);},
      addEventListener(){},
      before(n){n.detach();const p=this.parent;p.children.splice(p.children.indexOf(this),0,n);n.parent=p;},
      get lastElementChild(){return this.children[this.children.length-1];},
      set innerHTML(value){assert.equal(value,'');this.children.forEach(n=>{n.parent=null;});this.children=[];},
      set textContent(value){this.text=value;},get textContent(){return this.text||'';}};
  }
  const root=node(),host=node(),suggestion=node(),empty=node(),button=node();
  root.appendChild(suggestion);root.appendChild(host);suggestion.appendChild(button);
  const scope=vm.createContext({state:{activeMode:'storyboard'},messages:[{role:'assistant',content:'Ready for review.'}],
    el:id=>({'director-chat-messages':host,'director-chat-empty':empty,'studio-dw-suggestions':suggestion})[id],
    document:{createElement:node},currentElapsedMap:()=>({}),currentMetricsMap:()=>({})});
  scope.currentMessages=()=>scope.messages;
  vm.runInContext(source.slice(start,end),scope);
  return {scope,host,suggestion,button};
}

test('ordinary Studio replies never resurrect chat-generated Write actions across rerenders',()=>{
  const h=harness();let calls=0;h.button.onclick=()=>calls++;
  h.scope.renderMessages();
  assert.equal(h.suggestion.classList.contains('hidden'),true);
  assert.equal(h.host.children.some(row=>row.children.includes(h.suggestion)),false);
  h.scope.renderMessages();
  assert.equal(h.suggestion.classList.contains('hidden'),true);
  assert.equal(h.host.children.some(row=>row.children.includes(h.suggestion)),false);
  assert.equal(calls,0);
});

test('later user messages and Apply receipts leave no action beneath an older reply',()=>{
  for(const content of ['A new direction.','Saved changes.\n[WEBCAP APPLIED FIELD VALUES]{}[END WEBCAP APPLY]']) {
    const h=harness();h.scope.renderMessages();
    h.scope.messages.push({role:'user',content});h.scope.renderMessages();
    assert.equal(h.suggestion.classList.contains('hidden'),true);
    assert.ok(!h.host.children.includes(h.suggestion));
    assert.ok(h.host.children.every(row=>!row.children.includes(h.suggestion)));
  }
});

test('stale actions and General Chat do not show a review button',()=>{
  const h=harness();h.suggestion.children=[];h.scope.renderMessages();
  assert.equal(h.suggestion.classList.contains('hidden'),true);
  h.suggestion.children=[h.button];h.scope.state.activeMode='chat';h.scope.renderMessages();
  assert.equal(h.suggestion.classList.contains('hidden'),true);
});

test('historical Read responses preserve stored creative text without synthetic receipt badges',()=>{
  const h=harness();
  const raw='RECEIVED: project.title, scene:scene-a:prompt\n\nKeep the full creative answer.';
  h.scope.messages=[{role:'user',content:'Read the selected saved context and acknowledge receipt.\n[WEBCAP EXPLICIT READ]\n{}\n[END WEBCAP READ]'},
    {role:'assistant',content:raw}];
  h.scope.renderMessages();
  const row=h.host.lastElementChild;
  const badge=row.children.find(n=>n.className==='director-chat-context-receipt');
  const body=row.children.find(n=>n.className==='director-chat-message-body');
  assert.equal(badge,undefined,'Read is no longer an LLM request or synthetic acknowledgement');
  assert.equal(body.textContent,'Keep the full creative answer.');
  assert.equal(h.scope.messages[1].content,raw,'original content remains intact');
  assert.equal(h.scope.studioReplyText('RECEIVED: project.title. Keep this same-line answer.'),'Keep this same-line answer.');
  assert.equal(h.scope.studioReplyText('Received: a letter from Mara.'),'Received: a letter from Mara.');
});

test('Read and Apply cards retain exact payloads and expanded DOM across refreshes',()=>{
  const h=harness();
  const payload={project:{title:'Lighthouse',concept:'Warm light',style:'Cinematic',invariants:[]},scenes:[{number:2,prompt:'Full prompt'}]};
  const read='[WEBCAP EXPLICIT READ — SAVED SNAPSHOT]\n'+JSON.stringify(payload,null,2)+'\n[END WEBCAP READ]';
  const save='Saved Scene 2 · Answering Light: H3 Prompt\n[WEBCAP APPLIED FIELD VALUES]\n'+
    JSON.stringify({operation:'scene.update',projectId:'p',fields:{prompt:'Saved prompt'}})+'\n[END WEBCAP APPLY]';
  h.scope.messages=[{role:'user',content:read},{role:'user',content:save}];
  const original=JSON.stringify(h.scope.messages);
  h.scope.renderMessages();
  const row=h.host.children[0],body=row.children[1],details=body.children[1];
  assert.equal(body.children[0].textContent,'Read Lighthouse · Overview + Scene 2');
  assert.equal(details.children[1].textContent,read);
  assert.equal(details.open,undefined,'snapshots start collapsed');
  details.open=true;
  assert.equal(h.host.children[1].children[1].children[0].textContent,'Saved Scene 2 · Answering Light: H3 Prompt');
  assert.equal(h.host.children[1].children[1].children[1].children[1].textContent,save);
  h.host.scrollHeight=2000;h.host.clientHeight=400;h.host.scrollTop=200;
  h.scope.messages.push({role:'assistant',content:'A useful next observation.'});
  h.scope.renderMessages();
  assert.equal(h.host.children[0],row);
  assert.equal(h.host.children[0].children[1].children[1],details);
  assert.equal(details.open,true);
  assert.equal(h.host.scrollTop,200,'refresh preserves reading position');
  assert.equal(JSON.stringify(h.scope.messages.slice(0,2)),original,'presentation never rewrites model context');
});

test('unrecognized snapshot bodies stay inspectable and ordinary prose stays ordinary',()=>{
  const h=harness();
  const legacy='[WEBCAP EXPLICIT READ]\nA legacy free-form snapshot.\n[END WEBCAP READ]';
  const card=h.scope.studioMessageCard({role:'user',content:legacy});
  assert.equal(card.summary,'Read Project snapshot');
  assert.equal(h.scope.studioMessageCard({role:'user',content:'Please read this story.'}),null);
  h.scope.messages=[{role:'user',content:legacy}];
  h.scope.renderMessages();
  assert.equal(h.host.children[0].children[1].children[1].children[1].textContent,legacy);
  const singleInvariant='[WEBCAP EXPLICIT READ]\n'+JSON.stringify({project:{title:'Film',invariants:[{title:'Keeper'}]}})+'\n[END WEBCAP READ]';
  assert.equal(h.scope.studioMessageCard({role:'user',content:singleInvariant}).summary,'Read Film · 1 Invariant');
});
