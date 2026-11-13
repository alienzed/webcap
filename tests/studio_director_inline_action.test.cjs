const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
const start = source.indexOf('  function placeStudioSuggestion(node) {');
const end = source.indexOf('  function renderStudioOperations() {',start);

function harness() {
  function node() {
    const classes = new Set();
    return {children:[],parent:null,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),
      contains:x=>classes.has(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}},
      detach(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);this.parent=null;},
      appendChild(n){n.detach();this.children.push(n);n.parent=this;return n;},
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

test('the current reply owns the existing action; message rerenders preserve its node and handler',()=>{
  const h=harness();let calls=0;h.button.onclick=()=>calls++;
  h.scope.renderMessages();
  assert.equal(h.suggestion.parent,h.host.lastElementChild);
  assert.equal(h.suggestion.classList.contains('hidden'),false);
  h.scope.renderMessages();
  assert.equal(h.suggestion.parent,h.host.lastElementChild);
  assert.equal(h.suggestion.children[0],h.button);
  h.button.onclick();assert.equal(calls,1);
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
