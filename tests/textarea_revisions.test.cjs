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
    disabled:false, readOnly:false, isConnected:true, style:{paddingRight:''},
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
  let timerId=0;
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
    setTimeout:(fn,ms)=>{assert.equal(ms,10000);pending.set(++timerId,fn);return timerId;},
    clearTimeout:id=>pending.delete(id),
    Map,Array,String,Object});
  docHandlers.DOMContentLoaded();
  return {document,window,controls,toolbarHandlers,
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
  h.focus(field);
  h.click('[data-rev-prev]');
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

test('caption editor identity follows its saved media target, not shared editor ID',()=>{
  const h=harness();let current='caption:set/item-a';
  // The normal caption editor supplies its existing autosave identity.
  const field={id:'editor',dataset:{},getAttribute:()=>null,
    closest:()=>null};
  const sourceForIdentity=source.replace('typeof getAutosaveTargetAndPayload === \'function\'',
    'typeof getAutosaveTargetAndPayload === \'function\'');
  // Two targets must never share one caption history.
  const context={window:{},document:{readyState:'loading',addEventListener(){}},
    getAutosaveTargetAndPayload:()=>({key:current}),Map,Array,String,Object};
  vm.runInNewContext(sourceForIdentity,context);
  const keyA=context.window.webcapTextareaRevisions.identity(field);
  current='caption:set/item-b';
  const keyB=context.window.webcapTextareaRevisions.identity(field);
  assert.notEqual(keyA,keyB);
});
