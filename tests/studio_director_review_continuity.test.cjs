'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workbench = fs.readFileSync('tool/js/studio_director_workbench.js','utf8');

function part(source,start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'Missing production function '+start);
  return source.slice(a,b);
}
function tick() {return new Promise(resolve=>setImmediate(resolve));}
async function drain() {for(let i=0;i<6;i++)await tick();}

function harness(){
  const elements=new Map();
  function node(tag='div'){
    return {
      tagName:tag,children:[],dataset:{},classList:{add(){},remove(){},contains(){return false;}},
      style:{},attrs:{},value:'',textContent:'',disabled:false,open:false,
      events:{},setAttribute(k,v){this.attrs[k]=v;},
      append(...items){this.children.push(...items);},
      appendChild(item){this.children.push(item);},
      replaceChildren(...items){this.children=items;},
      addEventListener(type,callback){this.events[type]=callback;},
      trigger(type){assert.ok(this.events[type],'Missing '+type+' callback');this.events[type]();},
      showModal(){this.open=true;},close(){this.open=false;},
      querySelector(selector){
        return this.children.find(x=>selector==='.studio-dw-suggestion-action' &&
          x.className==='studio-dw-suggestion-action');
      },
      querySelectorAll(selector){
        if(selector==='[data-field]'){
          const nodes=[];
          const visit=item=>{
            if(item.dataset&&item.dataset.field)nodes.push(item);
            (item.children||[]).forEach(visit);
          };
          visit(this);return nodes;
        }
        return [];
      }
    };
  }
  function el(id){
    if(!elements.has(id))elements.set(id,node());
    return elements.get(id);
  }
  const story={id:'p1',title:'Project',sceneOrder:['s1'],scenes:{
    s1:{id:'s1',title:'Old title',prompt:'Old H3 Scene prompt',durationSeconds:8}
  }};
  const document={createElement:node,createTextNode:text=>({textContent:text})};
  const statuses=[],tracked=[];
  let active=null,edits=0,reported=0;
  const window={
    studioDirectorRenderDiff(){},
    studioDirectorBridge:{
      canReview:()=>true,isReady:()=>true,readinessMessage:()=>'',markWriteActionEdited(action){
        assert.equal(action,active,'edit belongs to the currently presented action');
        edits++;
      },
      placeSuggestedAction(host,index,action){active=action;tracked.push([index,action]);},
      finishWriteAction(){reported++;}
    }
  };
  const labels={title:'Title',prompt:'H3 Prompt',durationSeconds:'Duration'};
  const reviewSource=part(workbench,'  function showSceneReview(story, sceneId, fields, candidate, options) {',
    '  function openWriteForCapture() {');
  const showSceneReview=new Function('el','document','window','labels','storyName','status','Promise',
    reviewSource+'return showSceneReview;')(
    el,document,window,labels,x=>x.title,
    (msg,failed)=>statuses.push([msg,failed]),Promise);
  const actionSource=part(workbench,'  function selectedSceneIds(story, selectedScene) {',
    '  window.studioDirectorWorkbench = {');
  const functions=new Function('el','document','window','refreshProjects','loadStory',
    'storyName','projectFields','status','openWriteForCapture','showConversationWrite',
    'showSceneReview',actionSource+'return {presentAction,selectedSceneIds};')(
      el,document,window,async()=>[{id:'p1',title:'Project'}],async id=>{
        assert.equal(id,'p1');return story;
      },
      x=>x.title,['title','concept','style','invariants'],
      (msg,failed)=>statuses.push([msg,failed]),()=>{},()=>{},showSceneReview);
  function candidate(){
    return {kind:'write_scenes',actionKey:'primary',instruction:'Revise the Scene',
      authoredFields:{title:'Proposed title',prompt:'Proposed complete H3 Scene prompt',
        durationSeconds:12},request:'Make it quieter',projectId:'p1',
      scene:{projectId:'p1',sceneId:'s1',sceneNumber:1}};
  }
  function present(action){
    functions.presentAction(action,action.scene,{projectId:'p1'},action.request,3);
    const button=el('studio-dw-suggestions').children.find(x=>x.className==='studio-dw-suggestion-action');
    assert.ok(button,'Review must remain actionable');return button;
  }
  function editor(field){
    const node=el('studio-dw-scene-editors').querySelectorAll('[data-field]')
      .find(x=>x.dataset.field===field);
    assert.ok(node,'Missing '+field+' editor');return node;
  }
  return {el,editor,present,candidate,story,statuses,tracked,
    edited:()=>edits,reported:()=>reported,active:()=>active};
}

test('edits to an existing Scene proposal survive Cancel and reopening that same review',async()=>{
  const h=harness();
  const button=h.present(h.candidate());
  button.onclick();await drain();
  assert.equal(h.el('studio-dw-scene-review').open,true);
  assert.equal(h.editor('prompt').value,'Proposed complete H3 Scene prompt');
  h.editor('title').value='My preferred title';
  h.editor('title').trigger('input');
  h.editor('prompt').value='My carefully edited complete H3 Scene prompt';
  h.editor('prompt').trigger('input');
  h.editor('durationSeconds').value='10';
  h.editor('durationSeconds').trigger('input');
  assert.equal(h.edited(),3);
  h.el('studio-dw-scene-review').close();
  assert.equal(h.story.scenes.s1.prompt,'Old H3 Scene prompt',
    'Cancel cannot modify authoritative saved Scene content');
  button.onclick();await drain();
  assert.equal(h.editor('title').value,'My preferred title');
  assert.equal(h.editor('prompt').value,'My carefully edited complete H3 Scene prompt');
  assert.equal(h.editor('durationSeconds').value,'10');
  assert.equal(h.reported(),0,'reopening does not claim a save');
});

test('an edited existing Scene review can be reconstructed from the stored response action',async()=>{
  const h=harness();
  const button=h.present(h.candidate());
  button.onclick();await drain();
  h.editor('prompt').value='Edited follow-up Scene';
  h.editor('prompt').trigger('input');
  const stored=JSON.parse(JSON.stringify(h.active()));
  assert.equal(stored.reviewDraft.sceneId,'s1');
  assert.equal(stored.reviewDraft.values.prompt,'Edited follow-up Scene');
  h.el('studio-dw-scene-review').close();
  const restored=h.present(stored);
  restored.onclick();await drain();
  assert.equal(h.editor('prompt').value,'Edited follow-up Scene');
  assert.equal(h.story.scenes.s1.prompt,'Old H3 Scene prompt');
});
