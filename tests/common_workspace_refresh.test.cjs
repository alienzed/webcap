'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/common.js'),'utf8');
const from=source.indexOf('var workspaceWorkbenchRefreshFrame = 0;');
const to=source.indexOf('\nfunction setStatus(',from);
assert.ok(from>=0&&to>from,'Shared workbench refresh production function exists');

test('initial async workbench refresh waits for all classic feature scripts before touching their globals',()=>{
  let count=0,registered=0,frames=0,readyCallback,frameCallback;
  const document={readyState:'loading',addEventListener:(name,callback,options)=>{
    assert.equal(name,'DOMContentLoaded');
    assert.equal(options.once,true);
    registered++;
    readyCallback=callback;
  }};
  const window={requestAnimationFrame:callback=>{frames++;frameCallback=callback;return frames;}};
  const request=new Function('document','window','renderChecklistPanel',
    source.slice(from,to)+'return requestWorkspaceWorkbenchRefresh;')(
    document,window,()=>count++);
  request();
  request();
  assert.equal(registered,1,'Repeated early refreshes register one load callback');
  assert.equal(frames,0,'No animation frame may render before feature scripts exist');
  document.readyState='complete';
  readyCallback();
  assert.equal(frames,1);
  request();
  assert.equal(frames,1,'Coalesce requests while a frame is queued');
  frameCallback();
  assert.equal(count,1,'Render once after all scripts are available');
});
