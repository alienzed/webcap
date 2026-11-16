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
    projectId:'p1',projectTitle:'Current Project',sceneId:'b',sceneNumber:2,sceneTitle:'',sceneOrder:['a','b']});
  assert.doesNotMatch(JSON.stringify(navigation),/Private/);
  navigation.sceneOrder.push('c');
  assert.deepEqual(story.sceneOrder,['a','b'],'navigation cannot mutate saved order');
  scope.storyState.story=null;
  assert.equal(scope.getStudioDirectorNavigation().projectId,'');
});

test('sending a Studio message never attaches an open Project automatically',()=>{
  const chat=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const start=chat.indexOf("  function sendMessage() {");
  const end=chat.indexOf("  function ",start+10);
  assert.ok(start>=0&&end>start);
  const code=chat.slice(start,end);
  assert.doesNotMatch(code,/state\\.studioStoryAccess\\s*=/,
    'Only explicit attachment can change the Director association');
  assert.match(code,/studioAttachedStoryId\\(\\).*selectedNavigation/,
    'Navigation may still supply a suggested Write destination');
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
  const state={studioStoryAccess:null,storyboardAttachments:{},sceneRead:null,studioApprovedRead:null,studioWorkingDraft:{projects:{},scenes:{},newProject:{},newScene:{}}};
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
    'window.studioDirectorWorkbench={approvedReadPayload:readPayload,'+sceneRead+'};',scope);
  vm.runInContext(section(director,'  function studioDirectorSelectedScene(navigation, authorRequest, explicitProject) {',
    '  function syncModeUi() {')+
    section(director,'  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
      '  // Retain available conversational work across ordinary follow-up questions.'),scope);
  return {scope,state,stories,requests,setNavigation:next=>{navigation=next;}};
}

test('selected Project/Scene never supplies saved facts before author approval',async()=>{
  const h=actualSceneRequestFixture();
  const history=[{role:'user',content:'Draft a new Project unrelated to the open Project.'}];
  const outbound=await h.scope.studioDirectorChatRequestMessages(history,h.scope.studioDirectorSelectedScene());
  assert.equal(outbound[1].content,history[0].content);
  assert.match(outbound[0].content,/NO SAVED PROJECT\/SCENE CONTEXT APPROVED/);
  assert.doesNotMatch(outbound[0].content,/Mara walks toward the rover|Naturalistic moonlight|Red suit/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,0);
});

test('approved Overview and Scene fields refresh on each message without another approval or LLM request',async()=>{
  const h=actualSceneRequestFixture();
  h.state.studioApprovedRead={projectId:'p1',keys:['project.concept','scene:a:title',
    'scene:a:prompt','scene:a:durationSeconds'],label:'Moon crossing · Overview + Scene 1'};
  const messages=[{role:'user',content:'What is happening?'}];
  const first=await h.scope.studioDirectorChatRequestMessages(messages,h.scope.studioDirectorSelectedScene());
  assert.match(first[0].content,/AUTHOR-APPROVED SAVED CONTEXT/);
  assert.match(first[0].content,/Mara walks toward the rover/);
  assert.match(first[0].content,/scene:a:durationSeconds/);
  assert.doesNotMatch(first[0].content,/Naturalistic moonlight|Red suit|The rover drives into a crater/);
  h.stories.p1.scenes.a.prompt='Mara now rides the rover.';
  const refreshed=await h.scope.studioDirectorChatRequestMessages(messages,h.scope.studioDirectorSelectedScene());
  assert.match(refreshed[0].content,/Mara now rides the rover/);
  assert.doesNotMatch(refreshed[0].content,/Mara walks toward the rover/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,2);
  assert.equal(h.requests.filter(url=>url.includes('/fs/director/chat')).length,0);
});

test('approved source remains distinct from selected Write destination',async()=>{
  const h=actualSceneRequestFixture();
  h.stories.p2={id:'p2',title:'Unrelated Project',concept:'A private different premise',
    style:'Blue light',invariants:[],sceneOrder:[],scenes:{}};
  h.state.studioApprovedRead={projectId:'p1',keys:['scene:a:prompt'],label:'Moon crossing · Scene 1'};
  h.setNavigation({projectId:'p2',projectTitle:'Unrelated Project',sceneId:'',sceneNumber:0,sceneOrder:[]});
  const bound={};
  const outbound=await h.scope.studioDirectorChatRequestMessages(
    [{role:'user',content:'Discuss our approved reference.'}],null,
    {projectId:'p2',projectTitle:'Unrelated Project',sceneId:'',sceneNumber:0,sceneOrder:[]},bound);
  assert.equal(bound.projectId,'p2');
  assert.match(outbound[0].content,/Mara walks toward the rover/);
  assert.doesNotMatch(outbound[0].content,/A private different premise/);
});

test('approved source load failure remains visible instead of sending guessed context',async()=>{
  const h=actualSceneRequestFixture();
  h.state.studioApprovedRead={projectId:'p1',keys:['scene:a:prompt'],label:'Moon crossing · Scene 1'};
  h.scope.requestJson=async url=>{
    if(url.includes('/guidance?'))return {system:'Director guidance',actions:[],promptContract:'H3'};
    throw new Error('Approved saved Project cannot be loaded');
  };
  await assert.rejects(h.scope.studioDirectorChatRequestMessages([{role:'user',content:'Read it.'}],null),
    /Approved saved Project cannot be loaded/);
});

test('navigation changes do not silently change the approved context badge',async()=>{
  const director=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)+start.length));
  const h=actualSceneRequestFixture();
  h.state.activeMode='storyboard';
  h.state.studioApprovedRead={projectId:'p1',keys:['scene:a:prompt'],label:'Moon crossing · Scene 1'};
  const badge={textContent:'',title:'',hidden:true,classList:{
    toggle(name,hidden){if(name==='hidden')badge.hidden=hidden;}
  }};
  h.scope.el=()=>badge;
  vm.runInContext(section(director,'  function syncModeUi() {',
    "    var row = el('director-chat-mode-row');")+'  }',h.scope);
  h.scope.syncModeUi();
  assert.equal(badge.hidden,false);
  assert.equal(badge.textContent,'Approved context · Moon crossing · Scene 1');
  h.setNavigation({projectId:'p1',projectTitle:'Moon crossing',sceneId:'b',
    sceneNumber:2,sceneOrder:['a','b']});
  h.scope.syncModeUi();
  assert.equal(badge.textContent,'Approved context · Moon crossing · Scene 1');
  assert.deepEqual(h.requests,[],'navigation never asks the model to read');
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


test('new Project continuation cannot inherit the old approved Read grant',()=>{
  const director=fs.readFileSync(path.join(__dirname,'../tool/js/director_chat.js'),'utf8');
  assert.match(director,/state\.studioApprovedRead = null;\s*\/\/ The Scene from the previous Project/);
  assert.match(director,/state\.studioStoryAccess = \{storyId: payload\.story\.id, label: name\}/);
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
    workshopProposal:{text:'Temporary'}};
  const status={textContent:'prior message'};
  const ctx=vm.createContext({state,activeChatMode:'storyboard',
    studioAttachedStoryId:()=>state.studioStoryAccess.storyId,
    window:{getStudioDirectorNavigation:()=>({projectId:'p1',projectTitle:'Moon crossing'})},
    el:()=>status});
  vm.runInContext(chat.slice(start,end),ctx);
  assert.strictEqual(state.studioSceneProposal,scene);
  assert.strictEqual(state.studioScenesProposal,scenes);
  assert.strictEqual(state.studioBriefProposal,project);
  assert.equal(state.workshopProposal,null);
  assert.equal(status.textContent,'');
  assert.equal(state.sceneRead.sceneId,'a');
  assert.equal(state.studioStoryAccess.storyId,'p1');
});

test('mentioning a different Project title in prose does not silently attach its saved data',async()=>{
  const h=actualSceneRequestFixture();
  h.stories.p2={id:'p2',title:'Rainy Bookshop',concept:'Quiet late evening',
    style:'Blue rain',invariants:[],sceneOrder:[],scenes:{}};
  const response=await h.scope.studioDirectorChatRequestMessages([
    {role:'user',content:'Tell me about Rainy Bookshop.'}
  ],h.scope.studioDirectorSelectedScene());
  assert.doesNotMatch(response[0].content,/Quiet late evening|Mara walks toward the rover/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,0);
});
