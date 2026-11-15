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

test('Project Tools shares Generate, Revise and Coherence in one compact heading group',()=>{
  const heading=html.slice(html.indexOf('<div class="storyboard-scenes-heading">'),
    html.indexOf('id="storyboard-scene-progression"'));
  assert.match(heading,/id="storyboard-project-tool-bar"[^>]+role="group"/);
  assert.match(heading,/id="storyboard-generate-scenes-btn"[^>]+aria-label="Generate Takes"/);
  assert.match(heading,/id="storyboard-director-tools-btn"[^>]+aria-label="Revise &amp; Generate"/);
  assert.match(heading,/data-project-tool="coherence"[^>]+aria-label="Check Coherence"/);
  assert.match(heading,/id="storyboard-project-tools"/);
  for(const key of ['continuity','replace'])
    assert.match(heading,new RegExp('data-project-tool="'+key+'"'));
  assert.doesNotMatch(heading,/data-project-tool="director"|data-project-tool="revise"/);
  assert.doesNotMatch(heading,/id="storyboard-scenes-sequence-btn"/);
  for(const id of ['storyboard-generate-scenes-btn','storyboard-director-tools-btn','storyboard-cancel-takes-btn'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.match(css,/storyboard-project-tool-bar/);
  assert.match(css,/storyboard-scene-strip > #storyboard-scenes-sequence-btn/);
  assert.match(html,/<button id="storyboard-scenes-sequence-btn"/);
});

test('Project Tools preserve the established generation, revision and preset launch paths',()=>{
  assert.match(source,/el\('storyboard-generate-scenes-btn'\)\.onclick = generateScenes/);
  assert.match(source,/el\('storyboard-director-tools-btn'\)\.onclick = openDirectorTools/);
  assert.match(source,/el\('storyboard-cancel-takes-btn'\)\.onclick = cancelStoryTakes/);
  const binding=section("el('storyboard-project-tool-bar').addEventListener('click'",
    "el('storyboard-find-replace-find').addEventListener");
  assert.match(binding,/button\.dataset\.projectTool === 'replace'/);
  assert.match(binding,/openDirectorTools\(\)/);
  assert.match(binding,/button\.dataset\.projectTool === 'continuity' \? 'continuity' : 'coherence'/);
  assert.match(binding,/preset\.dispatchEvent\(new Event\('change'\)\)/);
  assert.match(source,/el\('storyboard-generate-scenes-btn'\)\.classList\.toggle\('hidden', sequenceMode\)/);
  assert.match(html,/id="studio-dw-coherence-check"/);
});

test('Scene strip combines Add and Extend into one action menu and owns Sequence',()=>{
  const render=section('  function renderSceneProgression(order) {','  function syncSceneViewControls(order) {');
  assert.match(render,/storyboard-add-scene/);
  assert.match(render,/data-scene-add="blank"/);
  assert.match(render,/data-scene-add="extend"/);
  assert.doesNotMatch(render,/storyboard-scenes-sequence-btn/);
  assert.doesNotMatch(render,/data-scene-progress-add|data-extend-story/);
  const click=section("    sceneProgression.addEventListener('click', function (event) {",
    "    sceneProgression.addEventListener('contextmenu', function (event) {");
  assert.match(click,/if \(addChoice.dataset.sceneAdd === 'blank'\) addScene\(\)/);
  assert.match(click,/else openSceneCreation\('extend'\)/);
  assert.match(source,/el\('storyboard-scenes-sequence-btn'\)\.onclick/);
});

test('literal replacement counts all matches and respects case without regex or LLM',()=>{
  const scope=vm.createContext({});
  vm.runInContext(section('  function projectReplaceText(', '  function previewProjectReplacement() {'),scope);
  const insensitive=scope.projectReplaceText('Red red RED redwood','red','x',false);
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
