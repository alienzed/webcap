const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
function harness(saved,frameWidth=1400) {
  const handlers={},windowHandlers={},attributes={},storage=new Map(saved ? [['webcap.studioDirector.width',String(saved)]] : []);
  let width;
  const drawer={style:{setProperty(key,value){assert.equal(key,'--studio-director-width');width=parseInt(value);}},
    getBoundingClientRect:()=>({width:Math.min(width,frame.clientWidth-42)})};
  const grip={classList:{add(){},remove(){}},setPointerCapture(){},
    setAttribute:(key,value)=>attributes[key]=value,addEventListener:(name,fn)=>handlers[name]=fn};
  const frame={clientWidth:frameWidth};
  const scope=vm.createContext({el:id=>({'studio-director-resizer':grip,'director-chat-drawer':drawer,'app-frame':frame})[id],
    state:{open:true,activeMode:'storyboard'},window:{addEventListener:(name,fn)=>windowHandlers[name]=fn},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,String(value))}});
  vm.runInContext(source.slice(source.indexOf('  function bindStudioDrawerResize() {'),source.indexOf('  function bind() {')),scope);
  scope.bindStudioDrawerResize();
  return {handlers,windowHandlers,attributes,storage,frame,width:()=>width};
}
test('dragging the left edge resizes Director, clamps to the workspace and remembers the width',()=>{
  const h=harness();assert.equal(h.width(),820);
  h.handlers.pointerdown({button:0,clientX:600,pointerId:1,preventDefault(){}});
  h.handlers.pointermove({clientX:400});assert.equal(h.width(),1020);
  h.handlers.pointermove({clientX:-10000});assert.equal(h.width(),1358);
  h.handlers.pointerup();assert.equal(h.storage.get('webcap.studioDirector.width'),'1358');
  h.handlers.pointermove({clientX:500});assert.equal(h.width(),1358,'pointer movement after release has no effect');
  assert.equal(harness(710).width(),710);
});
test('keyboard resizing and reset share the same limits, including narrow windows',()=>{
  const h=harness(600);
  h.handlers.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(h.width(),640);
  h.handlers.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(h.width(),600);
  h.handlers.dblclick();assert.equal(h.width(),820);
  h.frame.clientWidth=390;
  h.windowHandlers.resize();
  assert.equal(h.attributes['aria-valuenow'],348);
  assert.equal(h.width(),820,'window resizing preserves the preferred width');
  h.handlers.keydown({key:'ArrowRight',preventDefault(){}});
  assert.equal(h.width(),348);assert.equal(h.attributes['aria-valuenow'],348);
});

test('opening in a narrow window preserves the preferred width when the window grows',()=>{
  const h=harness(820,390);
  assert.equal(h.width(),820);
  assert.equal(h.attributes['aria-valuenow'],348);
  h.frame.clientWidth=1400;
  h.windowHandlers.resize();
  assert.equal(h.width(),820);
  assert.equal(h.attributes['aria-valuenow'],820);
});
