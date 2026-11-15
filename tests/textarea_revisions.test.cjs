'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../tool/js/textarea_revisions.js'), 'utf8');

function editor(value, sceneId) {
  return {
    id: '', name: '', dataset: {sceneField:'prompt'}, value,
    disabled:false, readOnly:false, isConnected:true, style:{paddingRight:'',paddingTop:''},
    parentElement:null,
    matches: s => s === 'textarea',
    getAttribute:()=>null,
    getBoundingClientRect:()=>({top:100,right:600,bottom:250,width:500}),
    closest:s => {
      if (s === '[data-scene-id]') return {dataset:{sceneId}};
      if (s.includes('[data-item-id]')) return {attributes:[{name:'data-scene-id',value:sceneId}]};
      return null;
    }
  };
}

function harness() {
  const docHandlers={}, controls={}, toolbarHandlers={}, pending=new Map();
  let timerId=0,captionKey='caption:set/item-a';
  for (const name of ['[data-rev-prev]','[data-rev-next]','[data-rev-count]']) {
    controls[name]={disabled:false,textContent:''};
  }
  const toolbar={
    style:{},parentNode:null,
    setAttribute(){},
    addEventListener(name,fn){toolbarHandlers[name]=fn;},
    querySelector:s=>controls[s],
    contains:()=>false
  };
  const head={appendChild(){}};
  const body={appendChild(node){node.parentNode=this;}};
  const document={
    readyState:'loading',head,body,
    createElement:name=>name==='style'?{textContent:''}:toolbar,
    addEventListener(name,fn){docHandlers[name]=fn;}
  };
  const window={
    getStudioDirectorNavigation:()=>({projectId:'project-1'}),
    addEventListener(){}
  };
  vm.runInNewContext(source,{document,window,innerHeight:1000,
    getAutosaveTargetAndPayload:()=>({key:captionKey}),
    getComputedStyle:()=>({paddingTop:'8px'}),
    setTimeout:(fn,ms)=>{assert.equal(ms,10000);pending.set(++timerId,fn);return timerId;},
    clearTimeout:id=>pending.delete(id),
    Map,Array,String,Object});
  docHandlers.DOMContentLoaded();
  return {document,window,controls,toolbarHandlers,toolbar,
    captionTarget(key){captionKey=key;},
    focus(field){docHandlers.focusin({target:field});},
    input(field){docHandlers.input({target:field});},
    blur(field){docHandlers.focusout({target:field,relatedTarget:null});},
    click(name){toolbarHandlers.click({target:{closest:s=>s===name?{}:null}});},
    idle(){const tasks=Array.from(pending.values());pending.clear();tasks.forEach(fn=>fn());}
  };
}

test('shared textarea history keeps every distinct version and never truncates prior versions',()=>{
  const h=harness(), field=editor('Original','scene-a');
  const key=h.window.webcapTextareaRevisions.identity(field);
  h.focus(field);
  for(let i=1;i<=25;i++){
    field.value='Revision '+i;
    h.input(field);
    h.idle();
  }
  const history=h.window.webcapTextareaRevisions.history(key);
  assert.equal(history.versions.length,26);
  assert.equal(history.versions[0],'Original');
  assert.equal(history.versions[25],'Revision 25');
  h.input(field);h.idle();
  assert.equal(history.versions.length,26,'consecutive duplicates do not add revisions');
});

test('browsing is non-destructive; editing an earlier version appends after the latest',()=>{
  const h=harness(), field=editor('Original','scene-b');
  const key=h.window.webcapTextareaRevisions.identity(field);
  h.focus(field);
  field.value='New';h.input(field);h.idle();
  h.click('[data-rev-prev]');
  assert.equal(field.value,'Original');
  assert.equal(h.window.webcapTextareaRevisions.history(key).versions.length,2);
  h.blur(field);
  assert.equal(field.value,'New','browsing does not change the real field on blur');
  assert.equal(h.window.webcapTextareaRevisions.history(key).index,1,
    'leaving history returns the cursor to the latest version');
  h.focus(field);
  h.click('[data-rev-prev]');
  assert.equal(field.value,'Original','browsing works again after reattachment');
  field.value='Original but changed';
  h.input(field);h.idle();
  assert.equal(h.window.webcapTextareaRevisions.history(key).versions.join('|'),
    'Original|New|Original but changed');
});

test('recreated Scene textareas reuse the same key, other Scenes stay isolated',()=>{
  const h=harness(),old=editor('First','scene-1'),again=editor('First','scene-1'),other=editor('Second','scene-2');
  const key=h.window.webcapTextareaRevisions.identity(old);
  assert.equal(key,h.window.webcapTextareaRevisions.identity(again));
  assert.notEqual(key,h.window.webcapTextareaRevisions.identity(other));
  h.focus(old);old.value='Edited';h.input(old);h.idle();h.blur(old);
  h.focus(again);
  assert.equal(h.window.webcapTextareaRevisions.history(key).versions.length,2);
  assert.equal(again.value,'First','reattachment does not overwrite current source data');
});

test('the same caption textarea switches histories when WebCap changes its media target',()=>{
  const h=harness(),field=editor('Caption A','unused');
  field.id='editor';
  h.focus(field);
  const first=h.window.webcapTextareaRevisions.identity(field);
  field.value='Caption A edited';h.input(field);h.idle();
  h.captionTarget('caption:set/item-b');
  field.value='Caption B edited';
  h.input(field);h.idle();
  const second=h.window.webcapTextareaRevisions.identity(field);
  assert.notEqual(first,second);
  assert.equal(h.window.webcapTextareaRevisions.history(first).versions.at(-1),'Caption A edited');
  assert.equal(h.window.webcapTextareaRevisions.history(second).versions.at(-1),'Caption B edited');
});

test('repeated unnamed rows use structural selectors rather than sharing one key',()=>{
  const h=harness();
  const parent={id:'list',tagName:'DIV',parentElement:null,children:[]};
  function row() {
    const host={id:'',tagName:'SECTION',parentElement:parent,children:[]};
    const field={id:'',name:'',tagName:'TEXTAREA',dataset:{},parentElement:host,
      getAttribute:()=>null,closest:()=>null};
    host.children=[field];parent.children.push(host);
    return field;
  }
  const first=row(),second=row();
  const a=h.window.webcapTextareaRevisions.identity(first);
  const b=h.window.webcapTextareaRevisions.identity(second);
  assert.notEqual(a,b);
  const recreated=row();
  parent.children.pop();parent.children[0]=first.parentElement;
  parent.children[1]=recreated.parentElement;
  assert.equal(b,h.window.webcapTextareaRevisions.identity(recreated));
});

test('History controls occupy only the top inset, preserving full text width',()=>{
  const h=harness(), field=editor('Long editable text','scene-compact');
  field.style.paddingRight='11px';
  field.style.paddingTop='8px';
  h.focus(field);
  assert.equal(field.style.paddingRight,'11px','right-side text width is unchanged');
  assert.equal(field.style.paddingTop,'31px','only the toolbar row is reserved');
  assert.equal(h.toolbar.style.left,'511px','toolbar is positioned at the top right');
  h.blur(field);
  assert.equal(field.style.paddingTop,'8px','original top inset restored on blur');
  assert.equal(field.style.paddingRight,'11px','original right padding remains untouched');
});

test('narrow textarea keeps its original padding',()=>{
  const h=harness(), field=editor('Small','scene-small');
  field.getBoundingClientRect=()=>({top:100,right:200,bottom:180,width:120});
  h.focus(field);
  assert.equal(field.style.paddingTop,'');
  assert.equal(h.toolbar.style.display,'none');
});
