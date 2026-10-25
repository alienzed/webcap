'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const scanSource = fs.readFileSync('tool/js/set_scan.js', 'utf8');
const visionSource = fs.readFileSync('tool/js/caption_vision.js', 'utf8');
function slice(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'Expected source section: ' + start);
  return source.slice(a, b);
}

function node() {
  const classes = new Set();
  return {
    dataset:{},disabled:false,hidden:false,style:{}, textContent:'',value:'',
    attributes:{},children:[],
    classList:{toggle(k,v){v?classes.add(k):classes.delete(k);},contains:k=>classes.has(k),
      add:k=>classes.add(k),remove:k=>classes.delete(k)},
    setAttribute(k,v){this.attributes[k]=v;},
    focus(){this.focused=true;},
    getAttribute(k){return this.attributes[k]||null;},
    replaceChildren(...next){this.children=next;},appendChild(x){this.children.push(x);}
  };
}

test('VL navigation follows filtered media order, skips unsupported, and never starts inference',()=>{
  const names=['a.jpg','x.txt','b.mp4','hidden.jpg','c.png'];
  const items=names.map((name,n)=>({fileName:name,key:'k'+n}));
  let visible=items.filter(x=>x.fileName!=='hidden.jpg');
  const elements={ 'vl-workspace-prev':node(),'vl-workspace-next':node(),
    'vl-workspace-position':node(),'saved-intelligence-modal':node() };
  elements['saved-intelligence-modal'].dataset.vlTab='describe';
  const scanned=[],requests=[];
  const s={reviewMediaItem:items[0]};
  const ctx={
    setScanState:s,
    getFilteredMediaItems(){return visible;},
    isCaptionVisionSupportedMedia(name){return /\.(jpg|png|mp4)$/i.test(name);},
    el(id){return elements[id];},
    openSavedIntelligenceForMedia(item,tab){scanned.push([item.fileName,tab]);s.reviewMediaItem=item;}
  };
  vm.createContext(ctx);
  vm.runInContext(slice(scanSource,'  function vlWorkspaceVisibleMedia() {','  function closeSavedIntelligence() {')+
    '\nthis.nav=navigateVlWorkspace;this.syncNav=syncVlWorkspaceNavigation;',ctx);
  ctx.syncNav();
  assert.equal(elements['vl-workspace-prev'].disabled,true);
  assert.equal(elements['vl-workspace-next'].disabled,false);
  assert.equal(elements['vl-workspace-position'].textContent,'1 / 3');
  assert.equal(ctx.nav(1),true);
  assert.equal(scanned[0][0],'b.mp4');
  assert.equal(scanned[0][1],'describe');
  ctx.syncNav();
  assert.equal(elements['vl-workspace-position'].textContent,'2 / 3');
  assert.equal(ctx.nav(1),true);
  ctx.syncNav();
  assert.equal(elements['vl-workspace-position'].textContent,'3 / 3');
  assert.equal(elements['vl-workspace-next'].disabled,true);
  assert.equal(ctx.nav(1),false);
  assert.equal(ctx.nav(-1),true);
  assert.equal(requests.length,0,'navigation does not start a VL model operation');
  visible=[items[4]];
  ctx.syncNav();
  assert.equal(elements['vl-workspace-position'].textContent,'Outside visible selection');
  assert.equal(elements['vl-workspace-next'].disabled,true);
  assert.equal(elements['vl-workspace-prev'].disabled,true);
  assert.throws(()=>ctx.nav(4),/Unknown VL Workspace navigation direction/);
});

test('out-of-order Sight loads do not replace the newly navigated item',async()=>{
  const items=['old.jpg','new.jpg'].map((fileName,i)=>({fileName,key:'k'+i}));
  const elements={};
  const ids=['saved-intelligence-modal','saved-intelligence-file','saved-intelligence-status',
    'sight-review-description','sight-review-issue','sight-review-activate',
    'sight-review-image','sight-review-video','sight-review-model','saved-intelligence-close-btn'];
  ids.forEach(id=>{elements[id]=node();});
  const pending=[],tabs=[],selection=[];
  const s={reviewMediaItem:null,reviewRequestToken:0,reviewData:null};
  const ctx={
    setScanState:s,state:{folder:'my-set'},document:{
      createElement(){return node();}
    },
    el(id){return elements[id];},
    isCaptionVisionSupportedMedia(){return true;},
    syncVisionImageCaptionSelection(key){selection.push(key);},
    syncVlWorkspaceNavigation(){},
    updateSightPreviewMedia(){},
    selectVlWorkspaceTab(tab){tabs.push(tab);},
    requestJson(_url,options){
      return new Promise(resolve=>pending.push({media:JSON.parse(options.body).media,resolve}));
    },
    renderSightReview(){elements['sight-review-description'].textContent=s.reviewData.file;},
    reportConsoleError(){throw Error('Unexpected Sight load error');}
  };
  vm.createContext(ctx);
  vm.runInContext(slice(scanSource,
    '  function openSavedIntelligenceForMedia(mediaItem, initialTab) {',
    '  function openSightReviewForFile(file) {')+
    '\nthis.openMedia=openSavedIntelligenceForMedia;',ctx);
  ctx.openMedia(items[0],'ask');
  ctx.openMedia(items[1],'ask');
  pending[1].resolve({models:{v:{description:'new'}},activeModel:'v',file:'new.jpg'});
  await Promise.resolve();await Promise.resolve();
  pending[0].resolve({models:{v:{description:'old'}},activeModel:'v',file:'old.jpg'});
  await Promise.resolve();await Promise.resolve();
  assert.equal(s.reviewMediaItem.key,'k1');
  assert.equal(s.reviewData.file,'new.jpg');
  assert.equal(elements['saved-intelligence-file'].textContent,'new.jpg');
  assert.deepEqual(tabs,['ask','ask'],'tab is retained rather than returning to Sight');
  assert.deepEqual(selection,['k1'],'switching item invalidates old caption and Ask results');
});

test('VL Describe button changes to Refresh caption when a caption exists and tracks current busy state',()=>{
  const elements={}; const ids=['vision-image-caption-modal','vision-image-caption-model',
    'vision-image-caption-loading','vision-image-caption-error','vision-image-caption-text',
    'vision-image-caption-copy','vision-image-caption-use','vision-image-caption-cancel',
    'vl-workspace-describe-run'];
  ids.forEach(id=>elements[id]=node());
  const vision={open:true,mediaKey:'a',model:'vl',text:'',error:'',pending:false};
  const ctx={document:{getElementById(id){return elements[id];}},
    visionImageCaptionState:vision,state:{currentItem:{key:'a'}},isVlWorkspaceTab(){return true;}};
  vm.createContext(ctx);
  vm.runInContext(slice(visionSource,'function getVisionImageCaptionEls() {',
    'function cancelVisionImageCaptionRequest() {')+
    '\nthis.sync=syncVisionImageCaptionModal;',ctx);
  ctx.sync();
  assert.equal(elements['vl-workspace-describe-run'].textContent,'Generate caption');
  vision.text='One multi-strap bikini';
  ctx.sync();
  assert.equal(elements['vl-workspace-describe-run'].textContent,'Refresh caption');
  assert.equal(elements['vl-workspace-describe-run'].disabled,false);
  vision.pending=true;ctx.sync();
  assert.equal(elements['vl-workspace-describe-run'].disabled,true);
});

test('caption refresh preserves earlier result on failure and ignores stale failure after switching item',async()=>{
  const requests=[], errors=[],vision={pending:false,jobId:'',open:true,model:'v',
    requestToken:0,mediaKey:'a',text:'original caption',error:''};
  const ctx={state:{currentItem:{key:'a',fileName:'a.jpg'}},
    visionImageCaptionState:vision,
    isCaptionVisionSupportedMedia(){return true;},
    loadCaptionVisionCapabilities(){return Promise.resolve();},
    getCaptionVisionModelId(){return 'v';},
    syncVisionImageCaptionModal(){},
    setStatus(){},reportConsoleInfo(){},reportConsoleError(_,err){errors.push(err.message);},
    requestVisionImageCaptionDescription(){return new Promise((resolve,reject)=>requests.push({resolve,reject}));}
  };
  vm.createContext(ctx);
  vm.runInContext(slice(visionSource,'function runVisionImageCaption(mediaItemOverride) {',
    'function copyVisionImageCaption() {')+
    '\nthis.run=runVisionImageCaption;',ctx);
  const one=ctx.run(ctx.state.currentItem);
  await Promise.resolve();await Promise.resolve();
  requests[0].reject(new Error('backend unavailable'));
  await one;
  assert.equal(vision.text,'original caption','failed refresh retains previous description');
  assert.equal(vision.error,'backend unavailable');

  const stale=ctx.run(ctx.state.currentItem);
  await Promise.resolve();await Promise.resolve();
  // VL Workspace moved to another item while its previous request was active.
  vision.requestToken++;
  vision.mediaKey='b';vision.text='other caption';vision.pending=false;
  ctx.state.currentItem={key:'b',fileName:'b.jpg'};
  requests[1].reject(new Error('old item error'));
  await stale;
  assert.equal(vision.mediaKey,'b');
  assert.equal(vision.text,'other caption');
  assert.notEqual(vision.error,'old item error');
  assert.deepEqual(errors,['backend unavailable']);
});
