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
    disabled:false, readOnly:false, isConnected:true, dispatched:[],
    dispatchEvent(event){this.dispatched.push(event.type);return true;},
    style:{paddingRight:'',paddingTop:'',paddingBottom:''},
    parentElement:null,
    matches(s) { return s === 'textarea' || s.split(',').some(part => {
      part = part.trim();
      return (this.id && part === '#' + this.id) ||
        (part.includes('textarea[data-scene-field="prompt"]') && this.dataset.sceneField === 'prompt');
    }); },
    getAttribute:()=>null,
    getBoundingClientRect:()=>({top:100,left:100,right:600,bottom:250,width:500}),
    closest:s => {
      if (s === '[data-scene-id]') return {dataset:{sceneId}};
      if (s.includes('[data-item-id]')) return {attributes:[{name:'data-scene-id',value:sceneId}]};
      return null;
    }
  };
}

function harness(savedPreferences, showSettings) {
  const preferenceStorage = savedPreferences ? Object.assign({},savedPreferences) : {};
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
  let injectedCss='';
  function settingsElement(tag) {
    return {
      tagName:tag.toUpperCase(), dataset:{}, children:[], checked:false, disabled:false,
      listeners:{}, textContent:'', open:false, firstChild:null,
      setAttribute(name,value){this[name]=value;},
      addEventListener(name,fn){this.listeners[name]=fn;},
      append(...nodes){nodes.forEach(node=>this.appendChild(node));},
      appendChild(node){this.children.push(node);this.firstChild=this.children[0];node.parentNode=this;},
      replaceChildren(){this.children=[];this.firstChild=null;},
      querySelector(selector){return this.querySelectorAll(selector)[0]||null;},
      querySelectorAll(selector){
        const match=selector.match(/^\[data-history-(master|field|group-count)(?:="([^"]+)")?\]$/);
        const found=[];
        function walk(node) {
          if(match && node.dataset) {
            const key={master:'historyMaster',field:'historyField','group-count':'historyGroupCount'}[match[1]];
            if(node.dataset[key]!==undefined && (match[2]===undefined||node.dataset[key]===match[2])) found.push(node);
          }
          (node.children||[]).forEach(walk);
        }
        walk(this);
        return found;
      }
    };
  }
  const settingsHost=showSettings?settingsElement('div'):null;
  const head={appendChild(node){injectedCss=node.textContent;}};
  const body={appendChild(node){node.parentNode=this;}};
  const document={
    readyState:'loading',head,body,
    getElementById:id=>id==='app-settings-textarea-history'?settingsHost:null,
    createElement:name=>name==='style'?{textContent:''}:(name==='div'&&!toolbar.parentNode?toolbar:settingsElement(name)),
    addEventListener(name,fn){docHandlers[name]=fn;}
  };
  const window={
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(preferenceStorage,key) ? preferenceStorage[key] : null; },
      setItem(key,value) { preferenceStorage[key] = value; }
    },
    getStudioDirectorNavigation:()=>({projectId:'project-1'}),
    addEventListener(){}
  };
  vm.runInNewContext(source,{document,window,innerHeight:1000,
    getAutosaveTargetAndPayload:()=>({key:captionKey}),
    getComputedStyle:()=>({paddingBottom:'8px'}),
    setTimeout:(fn,ms)=>{assert.equal(ms,10000);pending.set(++timerId,fn);return timerId;},
    clearTimeout:id=>pending.delete(id),
    Map,Array,String,Object,Event:class Event {constructor(type){this.type=type;}}});
  docHandlers.DOMContentLoaded();
  return {document,window,controls,toolbarHandlers,toolbar,settingsHost,
    preferences:()=>Object.assign({},preferenceStorage),
    css:()=>injectedCss,
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

test('History applies previous/next versions to the live editor and emits autosave input',()=>{
  const h=harness(),field=editor('Original','scene-b');
  const key=h.window.webcapTextareaRevisions.identity(field);
  h.focus(field);
  field.value='New';h.input(field);h.idle();
  h.click('[data-rev-prev]');
  assert.equal(field.value,'Original');
  assert.equal(field.dispatched.at(-1),'input','History must notify the existing editor');
  h.blur(field);
  assert.equal(field.value,'Original','previous is an applied version, not a preview');
  assert.equal(h.window.webcapTextareaRevisions.history(key).index,0);
  h.focus(field);h.click('[data-rev-next]');
  assert.equal(field.value,'New');
  h.click('[data-rev-prev]');
  field.value='Original but changed';h.input(field);h.idle();
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
  field.dataset = {};
  h.window.webcapTextareaRevisions.setEnabled('caption.editor',true);
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

test('History footer is centered at the bottom without changing text top or width',()=>{
  const h=harness(), field=editor('Long editable text','scene-compact');
  field.style.paddingRight='11px';
  field.style.paddingTop='8px';
  field.style.paddingBottom='8px';
  h.focus(field);
  assert.equal(field.style.paddingRight,'11px','text width is unchanged');
  assert.equal(field.style.paddingTop,'8px','text starts in its usual position');
  assert.equal(field.style.paddingBottom,'29px','compact controls reduce the reserved inset');
  assert.equal(h.toolbar.style.left,'529px');
  assert.equal(h.toolbar.style.top,'223px');
  assert.equal(h.toolbar.style.width,undefined,'history should not span the textarea width');
  assert.doesNotMatch(h.css(),/transform:translateX/);
  assert.match(h.css(),/border:0;border-radius:3px/);
  h.blur(field);
  assert.equal(field.style.paddingBottom,'8px','original bottom padding is restored');
});

test('narrow textarea does not acquire footer padding',()=>{
  const h=harness(), field=editor('Small','scene-small');
  field.getBoundingClientRect=()=>({top:100,left:100,right:190,bottom:180,width:90});
  h.focus(field);
  assert.equal(field.style.paddingBottom,'');
  assert.equal(h.toolbar.style.display,'none');
});

test('Scene Prompt uses the same bottom footer, never a toolbar in its heading',()=>{
  const h=harness(), field=editor('Subject:','scene-header');
  const actions={insertBefore(){throw Error('History should not enter heading');}};
  const promptBlock={querySelector:()=>actions};
  const originalClosest=field.closest;
  const originalMatches=field.matches;
  field.matches=selector=>originalMatches.call(field,selector) ||
    selector==='.storyboard-prompt-textarea[data-scene-field="prompt"]';
  field.closest=selector=>selector==='.storyboard-prompt-block'
    ? promptBlock : originalClosest(selector);
  h.focus(field);
  assert.equal(h.toolbar.style.top,'223px');
  assert.equal(h.toolbar.style.left,'529px');
  assert.equal(field.style.paddingTop,'');
  field.value='Subject: revised';h.input(field);h.idle();
  h.click('[data-rev-prev]');
  assert.equal(field.value,'Subject:');
  h.blur(field);
  assert.equal(field.value,'Subject:','History revision remains applied on blur');
  assert.ok(field.dispatched.includes('input'));
});

test('Chat and Studio Director conversation composer does not attach History',()=>{
  const h=harness(), field=editor('A question','unused');
  field.id='director-chat-input';
  field.dataset = {};
  h.focus(field);
  assert.equal(field.style.paddingBottom,'');
  assert.equal(h.toolbar.style.display,undefined);
  assert.equal(h.window.webcapTextareaRevisions.history(
    h.window.webcapTextareaRevisions.identity(field)),undefined);
});

test('explicit field allowlist disables unknown textareas by default',()=>{
  const h=harness(),field=editor('Transient','unused');
  field.dataset={};
  assert.equal(h.window.webcapTextareaRevisions.enabledFor(field),false);
  h.focus(field);
  assert.equal(h.toolbar.style.display,undefined);
  assert.equal(h.window.webcapTextareaRevisions.history(h.window.webcapTextareaRevisions.identity(field)),undefined);
});

test('history preferences opt in and master switch disable the field without losing revisions',()=>{
  const h=harness(),field=editor('First','scene-preferences');
  const api=h.window.webcapTextareaRevisions;
  assert.equal(api.enabledFor(field),true);
  h.focus(field);
  field.value='Second';h.input(field);h.idle();
  const key=api.identity(field);
  api.setEnabled('scene.prompt',false);
  assert.equal(api.enabledFor(field),false);
  assert.equal(h.toolbar.style.display,'none');
  assert.equal(api.history(key).versions.length,2);
  api.setEnabled('scene.prompt',true);
  api.setMasterEnabled(false);
  assert.equal(api.enabledFor(field),false);
  api.setMasterEnabled(true);
  assert.equal(api.enabledFor(field),true);
  assert.equal(api.history(key).versions.length,2);
});

test('Storyboard fields reuse stable Scene prompt history keys',()=>{
  const h=harness(),field=editor('Original','scene-shared');
  const key=h.window.webcapTextareaRevisions.identity(field);
  const review=editor('Revised','unused');
  review.dataset={revisionKey:key,field:'prompt'};
  assert.equal(h.window.webcapTextareaRevisions.identity(review),key);
});

test('browser-local preferences survive reload while revision content does not',()=>{
  const h=harness(),field=editor('Private text','scene-local');
  const api=h.window.webcapTextareaRevisions;
  h.focus(field);
  field.value='Private revision';h.input(field);h.idle();
  api.setEnabled('scene.prompt',false);
  api.setEnabled('generation.prompt',true);
  api.setMasterEnabled(false);
  const storage=h.preferences();
  const serialized=Object.values(storage).join(' ');
  assert.doesNotMatch(serialized,/Private text|Private revision/);
  const reloaded=harness(storage);
  assert.equal(reloaded.window.webcapTextareaRevisions.enabledFor(field),false);
  assert.equal(reloaded.window.webcapTextareaRevisions.history(api.identity(field)),undefined);
  reloaded.window.webcapTextareaRevisions.setMasterEnabled(true);
  assert.equal(reloaded.window.webcapTextareaRevisions.enabledFor(field),false);
  reloaded.window.webcapTextareaRevisions.setEnabled('scene.prompt',true);
  assert.equal(reloaded.window.webcapTextareaRevisions.enabledFor(field),true);
});

test('Settings groups are collapsible, show live counts and retain open state when changed',()=>{
  const h=harness(null,true),api=h.window.webcapTextareaRevisions,host=h.settingsHost;
  const details=host.children.filter(node=>node.tagName==='DETAILS');
  assert.equal(details.length,7);
  assert.equal(details[0].open,true);
  assert.equal(details[1].open,false);
  const counts=host.querySelectorAll('[data-history-group-count]');
  assert.equal(counts[0].textContent,'4 / 4 enabled');
  const scene=host.querySelector('[data-history-field="scene.prompt"]');
  assert.equal(scene.checked,true);
  details[1].open=true;
  scene.checked=false;
  scene.listeners.change();
  assert.equal(details[1].open,true,'checkbox change must preserve expanded group');
  assert.equal(host.querySelector('[data-history-field="scene.prompt"]'),scene,'rows should not be rebuilt');
  assert.equal(counts[1].textContent,'2 / 6 enabled');
  const master=host.querySelector('[data-history-master]');
  master.checked=false;master.listeners.change();
  assert.equal(scene.disabled,true);
  assert.equal(details[1].open,true);
  master.checked=true;master.listeners.change();
  assert.equal(scene.disabled,false);
});

test('direct Write registers model-produced fields without a Review layer',()=>{
  const h=harness(),api=h.window.webcapTextareaRevisions;
  const field=editor('Old Prompt','scene-direct');
  const key=api.identity(field);
  api.recordFieldChange(key,'Old Prompt','Model authored prompt');
  const history=api.history(key);
  assert.deepEqual(Array.from(history.versions),['Old Prompt','Model authored prompt']);
  field.value='Model authored prompt';
  h.focus(field);
  h.click('[data-rev-prev]');
  assert.equal(field.value,'Old Prompt');
  h.click('[data-rev-next]');
  assert.equal(field.value,'Model authored prompt');
});

test('History includes Studio title and duration editor types',()=>{
  const h=harness(),entries=h.window.webcapTextareaRevisions.fieldTypes;
  for(const id of ['project.title','scene.title','scene.duration']) {
    const type=entries.find(t=>t.id===id);
    assert.ok(type,'Missing editable History category '+id);
    assert.equal(type.enabled,true);
  }
});
