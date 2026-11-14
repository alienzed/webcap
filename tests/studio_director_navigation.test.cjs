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
