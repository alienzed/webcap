const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('tool/js/storyboard.js','utf8');
const html = fs.readFileSync('tool/tool.html','utf8');
const css = fs.readFileSync('tool/css/storyboard.css','utf8');

function section(start,end) {
  const from = source.indexOf(start),to = source.indexOf(end,from);
  assert.ok(from>=0&&to>from,'Missing '+start);
  return source.slice(from,to);
}

test('Scene header contains one Project Tools launchpad and no Sequence header control',()=>{
  const heading=html.slice(html.indexOf('<div class="storyboard-scenes-heading">'),
    html.indexOf('id="storyboard-scene-progression"'));
  assert.match(heading,/id="storyboard-project-tools"/);
  for(const key of ['director','revise','continuity','coherence','replace'])
    assert.match(heading,new RegExp('data-project-tool="'+key+'"'));
  assert.doesNotMatch(heading,/id="storyboard-scenes-sequence-btn"/);
  assert.equal((html.match(/id="storyboard-director-tools-btn"/g)||[]).length,1);
  assert.match(css,/storyboard-scene-progression > #storyboard-scenes-sequence-btn/);
});

test('Scene strip combines Add and Extend into one action menu and owns Sequence',()=>{
  const render=section('  function renderSceneProgression(order) {','  function syncSceneViewControls(order) {');
  assert.match(render,/storyboard-add-scene/);
  assert.match(render,/data-scene-add="blank"/);
  assert.match(render,/data-scene-add="extend"/);
  assert.match(render,/storyboard-scenes-sequence-btn/);
  assert.doesNotMatch(render,/data-scene-progress-add|data-extend-story/);
  const click=section("    sceneProgression.addEventListener('click', function (event) {",
    "    sceneProgression.addEventListener('contextmenu', function (event) {");
  assert.match(click,/if \(addChoice.dataset.sceneAdd === 'blank'\) addScene\(\)/);
  assert.match(click,/else openSceneCreation\('extend'\)/);
  assert.match(click,/setSceneViewMode\('sequence'\)/);
});

test('literal replacement counts all matches and respects case without regex or LLM',()=>{
  const scope=vm.createContext({});
  vm.runInContext(section('  function projectReplaceText(', '  function previewProjectReplacement() {'),scope);
  const insensitive=scope.projectReplaceText('Red red RED redwood','blue','x',false);
  assert.equal(insensitive.count,4);
  assert.equal(insensitive.text,'x x x xwood');
  const sensitive=scope.projectReplaceText('Red red RED','red','blue',true);
  assert.equal(sensitive.count,1);
  assert.equal(sensitive.text,'Red blue RED');
  const story={sceneOrder:['a','b'],scenes:{
    a:{prompt:'Orange orange'},b:{prompt:'ORANGE and apple'}}};
  const plan=scope.projectReplacementPlan(story,'orange','pear',false);
  assert.equal(plan.matches,3);
  assert.equal(plan.scenes.length,2);
  assert.deepEqual(Array.from(plan.scenes,x=>x.after),['pear pear','pear and apple']);
  assert.equal(story.scenes.a.prompt,'Orange orange','preview must not mutate');
});

test('Project Replace All uses saved Scene updates, not an LLM operation',()=>{
  const apply=section('  function applyProjectReplacement() {','  function bindUi() {');
  assert.match(apply,/flushPendingSaves\(\)/);
  assert.match(apply,/request\(null,'story='/);
  assert.match(apply,/operation:'update_scene'/);
  assert.match(apply,/scene:\{prompt:change.after\}/);
  assert.doesNotMatch(apply,/directorRequest|enqueue_llm|\/fs\/director\/chat/);
});
