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
  const state={studioStoryAccess:null,storyboardAttachments:{},sceneRead:null};
  const window={getStudioDirectorNavigation:()=>navigation};
  const scope=vm.createContext({
    state, window, Promise, JSON, String, Object, encodeURIComponent,
    projectFields:['title','concept','style','invariants'],
    storyName:story=>story.title || story.id,
    requestJson:async url=>{
      requests.push(url);
      if(url.startsWith('/fs/studio/director/guidance'))
        return {system:'Director guidance',actions:[],promptContract:'H3 prompt format'};
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
  vm.runInContext(section(director,'  function studioDirectorSelectedScene() {',
    '  function syncModeUi() {')+
    section(director,'  function studioDirectorRequestMessages(messages, includePromptContract, explicitWrite, navigationSnapshot) {',
      '  // The creative assessment is advisory.'),scope);
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
    '/fs/studio/director/guidance?targetModel=minimax_h3',
    '/fs/storyboard?story=p1'
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
  h.setNavigation({projectId:'p2',projectTitle:'New Project',sceneId:'',sceneNumber:0,sceneOrder:[]});
  assert.equal(h.scope.studioDirectorSelectedScene(),null);
  const withoutScene=await h.scope.studioDirectorChatRequestMessages([{role:'user',content:'Discuss an idea.'}],null);
  assert.doesNotMatch(withoutScene[0].content,/CURRENT SAVED SCENE/);
  assert.equal(h.requests.filter(url=>url.startsWith('/fs/storyboard?story=')).length,1);
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
