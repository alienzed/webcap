const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../tool/js/storyboard.js'),'utf8');
test('Director navigation supplies identity and Scene order without saved creative content',()=>{
  const story={id:'p1',title:'Current Project',sceneOrder:['a','b'],
    concept:'Private concept',style:'Private style',scenes:{a:{prompt:'Private prompt'}}};
  const scope=vm.createContext({storyState:{story,sceneViewMode:'focus',activeSceneId:'b'}});
  vm.runInContext(source.slice(source.indexOf('  function getStoryboardRouteTarget() {'),
    source.indexOf('  function openStoryboardActivity(target) {')),scope);
  const navigation=scope.getStudioDirectorNavigation();
  assert.deepEqual(JSON.parse(JSON.stringify(navigation)),{
    projectId:'p1',projectTitle:'Current Project',sceneId:'b',sceneNumber:2,sceneOrder:['a','b']});
  assert.doesNotMatch(JSON.stringify(navigation),/Private/);
  navigation.sceneOrder.push('c');
  assert.deepEqual(story.sceneOrder,['a','b'],'navigation cannot mutate saved order');
  scope.storyState.story=null;
  assert.equal(scope.getStudioDirectorNavigation().projectId,'');
});

test('the first explicit Studio message retains the Project destination without a Read',()=>{
  const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const start=chat.indexOf('      // An explicit message starts work in the open Project.');
  const code=chat.slice(start,chat.indexOf('      state.storyGuidelineProposal = null;',start));
  for (const existing of ['', 'chosen-project']) {
    const state={studioStoryAccess:existing ? {storyId:existing,label:'Chosen'} : null};
    const scope=vm.createContext({state,studioAttachedStoryId:()=>existing,
      window:{getStudioDirectorNavigation:()=>({projectId:'open-project',projectTitle:'Open Project'})}});
    vm.runInContext(code,scope);
    assert.equal(state.studioStoryAccess.storyId,existing || 'open-project');
    assert.deepEqual(Object.keys(state),['studioStoryAccess']);
    assert.deepEqual(Object.keys(state.studioStoryAccess).sort(),['label','storyId']);
  }
});

test('Director binds only after classic scripts have registered Studio navigation',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  assert.ok(html.indexOf('/static/js/director_chat.js') < html.indexOf('/static/js/storyboard.js'),
    'Director currently loads before the Studio navigation owner');
  assert.match(chat,/if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', bind\)/);
  assert.match(chat,/else bind\(\)/);
  assert.match(source,/window\.getStudioDirectorNavigation = getStudioDirectorNavigation;/);
});


function actualSceneRequestFixture() {
  const director = fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const workbench = fs.readFileSync(path.join(__dirname,'../tool/js/studio_director_workbench.js'),'utf8');
  function section(source, start, end) {
    const i=source.indexOf(start), j=source.indexOf(end,i+start.length);
    assert.ok(i>=0 && j>i, 'missing test section: '+start);
    return source.slice(i,j);
  }
  const stories = {
    'p1': {id:'p1',title:'Moon crossing',updatedAt:'t1',
      concept:'The crew returns to the moon.',style:'Naturalistic moonlight.',
      invariants:[{kind:'character',title:'Mara',text:'Red suit'}],
      sceneOrder:['a','b'],scenes:{
        a:{title:'Arrival',prompt:'Mara walks toward the rover.',durationSeconds:12,
          summary:'Dormant old Intent - never send'},
        b:{title:'Departure',prompt:'The rover drives into a crater.',durationSeconds:9}
      }}
  };
  let navigation={projectId:'p1',projectTitle:'Moon crossing',sceneId:'a',sceneNumber:1,sceneOrder:['a','b']};
  const requests=[];
  const state={studioStoryAccess:null,storyboardAttachments:{},sceneRead:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
  const window={getStudioDirectorNavigation:()=>navigation};
  const scope=vm.createContext({
    state, window, Promise, JSON, String, Object, encodeURIComponent,
    studioAttachedStoryId:()=>state.studioStoryAccess && state.studioStoryAccess.storyId || '',
    projectFields:['title','concept','style','invariants'],
    storyName:story=>story.title || story.id,
    requestJson:async url=>{
      requests.push(url);
      if(url.startsWith('/fs/studio/director/guidance'))
        return {system:'Director guidance',actions:[],promptContract:'H3 prompt format'};
      if(url==='/fs/storyboard') return {stories:Object.values(stories)};
      if(url.startsWith('/fs/storyboard?story=')) {
        const id=decodeURIComponent(url.split('=')[1]);
        return {story:stories[id]};
      }
      throw new Error('Unexpected request '+url);
    }
  });
  const sceneRead=section(workbench,'    sceneRead: function (story, sceneId) {',
    '    applyScenePrompt: function').trim().replace(/,$/,'');
  vm.runInContext(section(workbench,'  function readPayload(story, keys) {',
    '  function updateReadSelection() {')+
    'window.studioDirectorWorkbench={'+sceneRead+'};',scope);
  vm.runInContext(section(director,'  function studioDirectorSelectedScene(navigation, authorRequest, explicitProject) {',
    '  function syncModeUi() {')+
    section(director,'  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
      '  // Retain available conversational work across ordinary follow-up questions.'),scope);
  return {scope,state,stories,requests,setNavigation:next=>{navigation=next;}};
}

test('Studio chat supplies the selected saved Scene in the actual model request, without rewriting the author message',async()=>{
  const h=actualSceneRequestFixture();
  const history=[{role:'user',content:'What does the saved Scene do?'}];
  const target=h.scope.studioDirectorSelectedScene();
  const outgoing=await h.scope.studioDirectorChatRequestMessages(history,target);
  assert.equal(outgoing[1].content,history[0].content);
  assert.equal(history[0].content,'What does the saved Scene do?');
  assert.equal(outgoing.length,2,'context must stay in the request, not a synthetic conversation turn');
  assert.match(outgoing[0].content,/CURRENT SAVED SCENE/);
  assert.match(outgoing[0].content,/"sceneId":"a"/);
  assert.match(outgoing[0].content,/"sceneNumber":1/);
  assert.match(outgoing[0].content,/Mara walks toward the rover/);
  assert.match(outgoing[0].content,/scene:a:durationSeconds","value":12/);
  assert.doesNotMatch(outgoing[0].content,/Dormant old Intent/);
  assert.deepEqual(h.requests,[
    '/fs/storyboard',
    '/fs/storyboard?story=p1',
    '/fs/studio/director/guidance?targetModel=minimax_h3'
  ]);
  assert.equal(h.stories.p1.scenes.a.prompt,'Mara walks toward the rover.',
    'context lookup must not mutate saved Scene data');
});

test('each subsequent message fetches fresh saved Scene values without an acknowledgement call',async()=>{
  const h=actualSceneRequestFixture();
  h.state.sceneRead={projectId:'p1',sceneId:'a',label:'Scene 1 · Arrival'};
  h.setNavigation({projectId:'p1',projectTitle:'Moon crossing',sceneId:'',sceneNumber:0,sceneOrder:['a','b']});
  const history=[{role:'user',content:'What is its duration?'}];
  const target=h.scope.studioDirectorSelectedScene();
  assert.equal(target.sceneId,'a','Scene toolbar entry remains bound in overview');
  const initial=await h.scope.studioDirectorChatRequestMessages(history,target);
  assert.match(initial[0].content,/Mara walks toward the rover/);
  h.stories.p1.scenes.a.prompt='Mara now rides the rover.';
  h.stories.p1.scenes.a.durationSeconds=15;
  const fresh=await h.scope.studioDirectorChatRequestMessages(history,h.scope.studioDirectorSelectedScene());
  assert.match(fresh[0].content,/Mara now rides the rover/);
  assert.match(fresh[0].content,/scene:a:durationSeconds","value":15/);
  assert.doesNotMatch(fresh[0].content,/Mara walks toward the rover/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,2);
  assert.equal(h.requests.filter(url=>url.includes('/fs/director/chat')).length,0);
});

test('current focused Scene wins over an older Scene entry, and changing Projects drops stale context',async()=>{
  const h=actualSceneRequestFixture();
  h.state.sceneRead={projectId:'p1',sceneId:'a',label:'Scene 1 · Arrival'};
  h.setNavigation({projectId:'p1',projectTitle:'Moon crossing',sceneId:'b',sceneNumber:2,sceneOrder:['a','b']});
  const selected=h.scope.studioDirectorSelectedScene();
  assert.equal(selected.sceneId,'b');
  const outgoing=await h.scope.studioDirectorChatRequestMessages([{role:'user',content:'What happens?'}],selected);
  assert.match(outgoing[0].content,/The rover drives into a crater/);
  assert.doesNotMatch(outgoing[0].content,/Mara walks toward the rover/);
  h.stories.p2={id:'p2',title:'New Project',concept:'Fresh direction',style:'Blue dusk',
    invariants:[],sceneOrder:[],scenes:{}};
  h.setNavigation({projectId:'p2',projectTitle:'New Project',sceneId:'',sceneNumber:0,sceneOrder:[]});
  assert.equal(h.scope.studioDirectorSelectedScene(),null);
  const withoutScene=await h.scope.studioDirectorChatRequestMessages([{role:'user',content:'Discuss an idea.'}],null,
    {projectId:'p2',projectTitle:'New Project',sceneOrder:[]});
  assert.doesNotMatch(withoutScene[0].content,/CURRENT SAVED SCENE/);
  assert.match(withoutScene[0].content,/CURRENT SAVED PROJECT OVERVIEW/);
  assert.match(withoutScene[0].content,/Fresh direction/);
  assert.doesNotMatch(withoutScene[0].content,/Mara walks toward the rover/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,2);
});

test('missing Scene and retrieval errors reject instead of sending guessed or stale context',async()=>{
  const h=actualSceneRequestFixture();
  const selected=h.scope.studioDirectorSelectedScene();
  h.stories.p1.sceneOrder=['b'];
  await assert.rejects(h.scope.studioDirectorChatRequestMessages([{role:'user',content:'What happens?'}],selected),
    /selected Scene is no longer available/);
  const h2=actualSceneRequestFixture();
  h2.scope.requestJson=async url=>{
    if(url.includes('/guidance?'))return {system:'Director guidance',actions:[],promptContract:'H3'};
    throw new Error('Saved Project cannot be loaded');
  };
  await assert.rejects(h2.scope.studioDirectorChatRequestMessages(
    [{role:'user',content:'How long is this Scene?'}],h2.scope.studioDirectorSelectedScene()),
  /Saved Project cannot be loaded/);
});


test('Studio request freezes navigation with the Scene target, even if navigation changes while guidance loads',async()=>{
  const h=actualSceneRequestFixture();
  const initialNavigation={projectId:'p1',projectTitle:'Moon crossing',sceneId:'a',sceneNumber:1,sceneOrder:['a','b']};
  h.setNavigation(initialNavigation);
  const selected=h.scope.studioDirectorSelectedScene(initialNavigation);
  const pending=h.scope.studioDirectorChatRequestMessages(
    [{role:'user',content:'What is happening in this Scene?'}],
    selected, initialNavigation);
  h.setNavigation({projectId:'p1',projectTitle:'Moon crossing',sceneId:'b',sceneNumber:2,sceneOrder:['a','b']});
  const outgoing=await pending;
  assert.match(outgoing[0].content,/"sceneId":"a","sceneNumber":1/);
  assert.match(outgoing[0].content,/Mara walks toward the rover/);
  assert.doesNotMatch(outgoing[0].content,/"sceneId":"b","sceneNumber":2/);
});

test('open Director badge follows Scene 1 to Scene 2 navigation without starting a new conversation', async()=>{
  const director=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  function section(code,start,end) {
    const i=code.indexOf(start),j=code.indexOf(end,i+start.length);
    assert.ok(i>=0 && j>i,'missing source section: '+start);
    return code.slice(i,j);
  }
  const h=actualSceneRequestFixture();
  const messages=[{role:'user',content:'Continue discussing this Scene.'}];
  h.state.modeMessages={storyboard:messages};
  h.state.open=true;
  h.state.activeMode='storyboard';
  // Scene toolbar origin remains available as fallback, but focus navigation wins.
  h.state.sceneRead={projectId:'p1',sceneId:'a',label:'Scene 1 · Arrival'};
  const badge={textContent:'',title:'',hidden:true,classList:{
    toggle(name,hidden) {if(name==='hidden')badge.hidden=hidden;}
  }};
  h.scope.el=id=>{
    assert.equal(id,'director-chat-scene-context');
    return badge;
  };
  // Exercise the actual badge block of syncModeUi without unrelated drawer DOM.
  vm.runInContext(section(director,'  function syncModeUi() {',
    "    var row = el('director-chat-mode-row');")+'  }',h.scope);
  h.scope.window.refreshAssistantModes=()=>h.scope.syncModeUi();

  const storyState={story:h.stories.p1,sceneViewMode:'focus',activeSceneId:'a'};
  const navigation=vm.createContext({
    storyState,Promise,window:h.scope.window,
    flushPendingSaves:()=>Promise.resolve(),
    clearSceneNewTakeCount(){},clearSceneDirectorCompletion(){},inspectSceneRefinement(){},
    renderScenes(){},renderSequencePreview(){},
    document:{querySelector:()=>null},
    reportError(error){throw error;}
  });
  vm.runInContext(section(source,'  function ensureActiveScene(order) {',
    '  function followRevisionProgress(job) {')+
    section(source,'  function setSceneViewMode(mode, sceneId) {',
      '  function takeMediaUrl(storyId, sceneId, take)')+
    section(source,'  function getStoryboardRouteTarget() {',
      '  function openStoryboardActivity(target) {'),navigation);
  h.scope.window.getStudioDirectorNavigation=()=>navigation.getStudioDirectorNavigation();
  h.scope.window.refreshAssistantModes();
  assert.equal(badge.textContent,'Scene 1');
  assert.equal(badge.hidden,false);

  await navigation.setSceneViewMode('focus','b');
  assert.equal(storyState.activeSceneId,'b');
  assert.equal(badge.textContent,'Scene 2');
  assert.equal(badge.hidden,false);
  assert.strictEqual(h.state.modeMessages.storyboard,messages,'navigation cannot reset conversation');
  assert.deepEqual(h.requests,[],'navigation must not issue an LLM request');

  const resolved=h.scope.studioDirectorSelectedScene();
  assert.equal(resolved.sceneId,'b');
  assert.equal(resolved.label,badge.textContent,'badge and request share target resolver');
  const outbound=await h.scope.studioDirectorChatRequestMessages(
    messages,resolved,h.scope.window.getStudioDirectorNavigation());
  assert.match(outbound[0].content,/"sceneId":"b","sceneNumber":2/);
  assert.match(outbound[0].content,/The rover drives into a crater/);
  assert.match(outbound[0].content,/scene:b:durationSeconds","value":9/);
  assert.doesNotMatch(outbound[0].content,/Mara walks toward the rover/);
});


function assistantRailHarness() {
  const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const bootstrap=/  if \(document\.readyState === 'loading'\) document\.addEventListener\('DOMContentLoaded', bind\);\n  else bind\(\);\n\}\)\(\);\s*$/;
  assert.match(chat,bootstrap);
  const instrumented=chat.replace(bootstrap,
    '  syncModeUi = function () {};\n  syncControls = function () {};\n' +
    '  finishProgress = function () {};\n' +
    '  window.__assistantNav = {state:state,setMode:setMode,setOpen:setOpen,studioWorkspaceVisible:studioWorkspaceVisible};\n})();');
  const elements={};
  const node=()=>({
    value:'',attrs:{},classes:{},
    classList:{
      toggle(name,value){this[name]=!!value;},
      add(name){this[name]=true;},
      remove(name){this[name]=false;}
    },
    setAttribute(key,value){this.attrs[key]=value;},
    focus(){}
  });
  let studio=false;
  const requests=[];
  const ctx=vm.createContext({
    getDirectorModelPreference:()=> '',
    document:{
      getElementById:id=>elements[id] ||= node(),
      querySelector:selector=>selector==='#storyboard-workspace:not(.hidden)' && studio ? {} : null
    },
    window:{},
    fetch:url=>{requests.push(url);throw new Error('Navigation must not request a model');},
    console,Promise
  });
  vm.runInContext(instrumented,ctx);
  ctx.document.getElementById('director-chat-input'); // The production composer exists before binding.
  const {state,setOpen,setMode}=ctx.window.__assistantNav;
  state.modelsLoaded=true;
  state.sessionReady=true;
  state.sessionByMode.storyboard={id:'existing-studio-conversation'};
  const begin=chat.indexOf('    toggle.onclick = function () {');
  const end=chat.indexOf('    pin.onclick',begin);
  assert.ok(begin>0 && end>begin);
  vm.runInContext('var state=window.__assistantNav.state, setOpen=window.__assistantNav.setOpen, ' +
    'studioWorkspaceVisible=window.__assistantNav.studioWorkspaceVisible;\n' +
    'var toggle=document.getElementById("director-chat-rail-btn");\n' +
    chat.slice(begin,end),ctx);
  return {
    state,requests,elements,setMode,setOpen,
    rail:()=>elements['director-chat-rail-btn'].onclick(),
    studio:value=>{studio=value;},
    exitStudio:()=>ctx.window.closeStudioDirectorOnExit()
  };
}

test('Assistant rail restores the last Studio Chat or Director surface, retaining drafts and conversations', async()=>{
  const h=assistantRailHarness();
  h.studio(true);
  assert.equal(h.state.lastStudioMode,'chat','first entry preserves the existing Chat default');
  h.rail();
  assert.equal(h.state.activeMode,'chat');
  h.elements['director-chat-input'].value='Unsent Chat draft';
  h.setOpen(true,'storyboard'); // Explicit Project/Scene Director entry
  assert.equal(h.state.activeMode,'storyboard');
  assert.equal(h.state.lastStudioMode,'storyboard');
  assert.equal(h.state.draftByMode.chat,'Unsent Chat draft');
  h.state.modeMessages.storyboard=[{role:'user',content:'Earlier Studio conversation'}];
  h.elements['director-chat-input'].value='Unsent Director draft';
  h.rail();
  assert.equal(h.state.open,false,'rail closes Director instead of switching it to Chat');
  h.rail();
  assert.equal(h.state.activeMode,'storyboard');
  assert.equal(h.state.open,true);

  h.studio(false);
  h.exitStudio();
  assert.equal(h.state.activeMode,'chat','ordinary Assistant is Chat outside Studio');
  assert.equal(h.state.lastStudioMode,'storyboard','Studio remembers its previous surface');
  assert.equal(h.state.draftByMode.storyboard,'Unsent Director draft');
  h.rail();
  assert.equal(h.state.activeMode,'chat');
  h.rail();
  h.studio(true);
  h.rail();
  assert.equal(h.state.activeMode,'storyboard','returning to Studio restores Director');
  assert.equal(h.elements['director-chat-input'].value,'Unsent Director draft');
  assert.equal(h.state.modeMessages.storyboard[0].content,'Earlier Studio conversation');

  h.setMode('chat'); // Select Chat while in Studio
  assert.equal(h.state.lastStudioMode,'chat');
  assert.equal(h.elements['director-chat-input'].value,'Unsent Chat draft');
  h.rail();
  h.rail();
  assert.equal(h.state.activeMode,'chat','Studio remembers an explicit Chat choice');
  assert.deepEqual(h.requests,[],'navigation never calls the LLM');
});

test('global Chat navigation never overwrites the Studio surface choice',()=>{
  const h=assistantRailHarness();
  h.studio(true);
  h.setOpen(true,'storyboard');
  h.studio(false);
  h.exitStudio();
  h.rail();
  assert.equal(h.state.activeMode,'chat');
  assert.equal(h.state.lastStudioMode,'storyboard');
  h.setOpen(true,'chat');
  assert.equal(h.state.lastStudioMode,'storyboard');
  h.rail();
  h.studio(true);
  h.rail();
  assert.equal(h.state.activeMode,'storyboard');
  assert.deepEqual(h.requests,[]);
});


test('Project Apply continuation owns subsequent context despite older shell Scene',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const part=(a,b)=>{
    const i=code.indexOf(a),j=code.indexOf(b,i+a.length);
    assert.ok(i>=0&&j>i,'Missing Director function '+a);
    return code.slice(i,j);
  };
  const h=actualSceneRequestFixture(),a=h.stories.p1;
  const b={id:'p2',title:'Rainy Bookshop',
    concept:'The bookseller leaves a warm window glowing.',style:'Blue rain and amber light.',
    invariants:[{kind:'character',title:'Bookseller',text:'Burgundy cardigan'},
      {kind:'location',title:'Bookshop',text:'Green front door'}],
    sceneOrder:[],scenes:{}};
  h.state.studioStoryAccess={storyId:a.id,label:a.title};
  h.state.sceneRead={projectId:a.id,sceneId:'a',sceneNumber:1,label:'Scene 1'};
  h.state.studioProjectProposal={title:b.title};
  h.state.pending=false;h.state.activeMode='storyboard';
  const badge={hidden:false,textContent:'',title:'',classList:{
    toggle(name,hidden){if(name==='hidden')badge.hidden=hidden;}}};
  const nodes={
    'studio-project-title':{value:b.title},
    'studio-project-concept':{value:b.concept},
    'studio-project-style':{value:b.style},
    'studio-project-invariants':{querySelectorAll:()=>[]},
    'studio-project-extra-scenes':{querySelectorAll:()=>[]},
    'studio-project-include-scene':{checked:false},
    'studio-project-continue':{checked:true},
    'studio-project-error':{textContent:''},
    'studio-project-review':{close(){}},
    'director-studio-access-status':{textContent:''},
    'director-studio-access-data':{classList:{add(){}}},
    'director-chat-scene-context':badge
  };
  h.scope.el=id=>{assert.ok(nodes[id],'Unexpected UI element '+id);return nodes[id];};
  let creates=0,unexpectedPosts=0,done;
  const refreshed=new Promise(resolve=>{done=resolve;});
  h.scope.requestJson=async(url,options)=>{
    h.requests.push(url);
    if(url==='/fs/studio/director/project-create'){
      creates++;
      assert.equal(options.method,'POST');
      assert.equal(JSON.parse(options.body).proposal.title,b.title);
      h.stories[b.id]=b;
      return {story:b};
    }
    if(options&&options.method==='POST')unexpectedPosts++;
    if(url==='/fs/storyboard') return {stories:Object.values(h.stories)};
    if(url.startsWith('/fs/studio/director/guidance'))
      return {system:'Director guidance',actions:[],promptContract:'H3'};
    if(url.startsWith('/fs/storyboard?story='))
      return {story:h.stories[decodeURIComponent(url.split('=')[1])]};
    throw new Error('Unexpected request '+url);
  };
  h.scope.syncControls=()=>{};
  h.scope.syncModeUi=()=>{};
  h.scope.recordStudioOperation=()=>{};
  h.scope.studioActionStatus=()=>{};
  h.scope.writeInitialProjectScenes=async(_story,briefs)=>{
    assert.equal(_story.id,b.id);assert.equal(briefs.length,0);
    return {saved:[],failed:[],notAttempted:[],reportingErrors:[]};
  };
  h.scope.window.studioDirectorBridge={recordApplied:async()=>{}};
  h.scope.window.reportConsoleError=(_label,error)=>assert.fail(error.message);
  h.scope.window.refreshStudioDirectorStoryIfOpen=async id=>{
    assert.equal(id,b.id);done();
  };
  vm.runInContext(part('  function applyStudioProject() {',
    '  function parseStudioBriefDraft(raw) {'),h.scope);
  h.scope.applyStudioProject();
  await refreshed;
  assert.equal(creates,1);
  assert.equal(h.state.studioStoryAccess.storyId,b.id);
  assert.equal(h.state.sceneRead,null);
  assert.equal(h.scope.window.getStudioDirectorNavigation().projectId,a.id);
  assert.equal(h.scope.studioDirectorSelectedScene(),null);

  // Run the actual Scene badge selection code without unrelated drawer UI.
  vm.runInContext(part('  function syncModeUi() {',
    "    var row = el('director-chat-mode-row');")+'  }',h.scope);
  h.scope.syncModeUi();
  assert.equal(badge.hidden,true);
  const message=[{role:'user',content:'What are this Project’s saved concept and invariants?'}];
  const ask=()=>h.scope.studioDirectorChatRequestMessages(
    message,h.scope.studioDirectorSelectedScene(),
    h.scope.window.getStudioDirectorNavigation());
  const outgoing=await ask(),system=outgoing[0].content;
  assert.equal(outgoing[1].content,message[0].content);
  assert.ok(system.includes('CURRENT SAVED PROJECT OVERVIEW'));
  assert.ok(system.includes('"projectId":"p2","projectTitle":"Rainy Bookshop","sceneId":"","sceneNumber":0,"sceneOrder":[]'));
  assert.ok(system.includes(b.concept)&&system.includes('Burgundy cardigan')&&system.includes('Green front door'));
  assert.ok(!system.includes('CURRENT SAVED SCENE'));
  assert.ok(!system.includes('Mara walks toward the rover'));
  assert.ok(!system.includes('Moon crossing'));
  b.concept='The bookseller greets a late visitor.';
  const updated=await ask();
  assert.ok(updated[0].content.includes(b.concept));
  assert.ok(!updated[0].content.includes('leaves a warm window glowing'));
  assert.equal(creates,1);assert.equal(unexpectedPosts,0);

  // Project writes without an explicit target snapshot use B, not shell A.
  const prepared=await h.scope.studioDirectorRequestMessages(
    [{role:'user',content:'Revise this Project.'}],false,true);
  assert.ok(prepared[0].content.includes('"projectId":"p2","projectTitle":"Rainy Bookshop"'));
  assert.ok(!prepared[0].content.includes('"sceneId":"a"'));
  // A launched Scene write may still supply its frozen A destination explicitly.
  const aNavigation=h.scope.window.getStudioDirectorNavigation();
  const explicit=await h.scope.studioDirectorRequestMessages(
    [{role:'user',content:'Revise Scene 1 in A.'}],true,true,aNavigation);
  assert.ok(explicit[0].content.includes('"projectId":"p1"'));

  // The explicit Scene entry point uses the existing Project destination method.
  h.scope.scheduleSessionSave=()=>{};
  const entry=part('    selectWriteProject: function (storyId, storyTitle) {',
    '    prepareWrite: function (kind, storyId, storyTitle, options) {')
    .trim().replace(/,$/,'');
  vm.runInContext('window.studioDirectorBridge={'+entry+'};',h.scope);
  h.scope.window.studioDirectorBridge.selectWriteProject(a.id,a.title);
  h.state.sceneRead={projectId:a.id,sceneId:'a',sceneNumber:1,label:'Scene 1'};
  h.scope.syncModeUi();
  assert.equal(badge.hidden,false);
  const scene=h.scope.studioDirectorSelectedScene();
  assert.equal(scene.sceneId,'a');
  const back=await h.scope.studioDirectorChatRequestMessages(message,scene,aNavigation);
  assert.ok(back[0].content.includes('CURRENT SAVED SCENE'));
  assert.ok(back[0].content.includes('Mara walks toward the rover'));
  assert.ok(!back[0].content.includes('Burgundy cardigan'));
  assert.equal(creates,1);assert.equal(unexpectedPosts,0);
});

test('Project creation label is truthful for zero Scenes',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../tool/tool.html'),'utf8');
  assert.ok(html.includes('id="studio-project-create" type="button">Create Project</button>'));
});


test('ordinary Director conversation preserves prepared Scene reviews without mutating saved Projects',()=>{
  const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const start=chat.indexOf("    if (activeChatMode === 'storyboard') {\n      // An explicit message starts work");
  const end=chat.indexOf('    // Freeze the Project destination alongside the user',start);
  assert.ok(start>=0&&end>start,'Director conversation transition section exists');
  const scene={storyId:'p1',prompt:'Complete existing prompt'};
  const scenes={storyId:'p1',drafts:[{title:'First',prompt:'Complete first prompt'}]};
  const project={storyId:'p1',draft:{concept:'A complete concept'}};
  const state={studioStoryAccess:{storyId:'p1',label:'Moon crossing'},
    storyboardAttachments:{},sceneRead:{projectId:'p1',sceneId:'a'},
    studioSceneProposal:scene,studioScenesProposal:scenes,studioBriefProposal:project,
    storyGuidelineProposal:{text:'Temporary'},workshopProposal:{text:'Temporary'}};
  const status={textContent:'prior message'};
  const ctx=vm.createContext({state,activeChatMode:'storyboard',
    studioAttachedStoryId:()=>state.studioStoryAccess.storyId,
    window:{getStudioDirectorNavigation:()=>({projectId:'p1',projectTitle:'Moon crossing'})},
    el:()=>status});
  vm.runInContext(chat.slice(start,end),ctx);
  assert.strictEqual(state.studioSceneProposal,scene);
  assert.strictEqual(state.studioScenesProposal,scenes);
  assert.strictEqual(state.studioBriefProposal,project);
  assert.equal(state.storyGuidelineProposal,null);
  assert.equal(state.workshopProposal,null);
  assert.equal(status.textContent,'');
  assert.equal(state.sceneRead.sceneId,'a');
  assert.equal(state.studioStoryAccess.storyId,'p1');
});
