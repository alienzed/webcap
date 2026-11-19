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

test('Scenes header keeps context left and four responsive actions right',()=>{
  const heading=html.slice(html.indexOf('<div class="storyboard-scenes-heading">'),
    html.indexOf('id="storyboard-scene-progression"'));
  assert.match(heading,/id="storyboard-project-tool-bar"[^>]+role="group"/);
  const generate=heading.indexOf('id="storyboard-generate-scenes-btn"');
  const cancel=heading.indexOf('id="storyboard-cancel-takes-btn"');
  const revise=heading.indexOf('id="storyboard-director-tools-btn"');
  const replace=heading.indexOf('id="storyboard-find-replace-btn"');
  assert.ok(generate > 0 && generate < cancel && cancel < revise && revise < replace);
  assert.ok(heading.indexOf('id="storyboard-progress-summary"') < generate);
  assert.match(heading,/aria-label="Scene Revision"/);
  assert.match(heading,/aria-label="Find &amp; Replace"/);
  assert.doesNotMatch(heading,/id="storyboard-project-tools"|data-project-tool="coherence"/);
  assert.doesNotMatch(heading,/id="storyboard-scenes-sequence-btn"/);
  for(const id of ['storyboard-generate-scenes-btn','storyboard-director-tools-btn','storyboard-find-replace-btn','storyboard-cancel-takes-btn'])
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.match(css,/@container \(max-width: 760px\)/);
  assert.match(css,/#storyboard-project-tool-bar \.storyboard-tool-label \{ display: none; \}/);
  assert.match(html,/<button id="storyboard-scenes-sequence-btn"/);
});

test('Header preserves generation, revision presets and direct Find & Replace',()=>{
  assert.match(source,/el\('storyboard-generate-scenes-btn'\)\.onclick = generateScenes/);
  assert.match(source,/el\('storyboard-director-tools-btn'\)\.onclick = function \(\) \{\s*window\.openStudioDirectorRevision\(\)/);
  assert.match(html,/id="director-studio-revision-preset"/);
  assert.match(source,/el\('storyboard-find-replace-btn'\)\.onclick = openProjectReplace/);
  assert.match(source,/el\('storyboard-cancel-takes-btn'\)\.onclick = cancelStoryTakes/);
  assert.match(source,/this\.value === 'continuity'/);
  assert.match(source,/this\.value === 'coherence'/);
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


test('Scene title stays compact and wide Takes aligns with Generation without an outer frame',()=>{
  assert.match(source,/storyboard-scene-title-field"><input data-scene-field="title" aria-label="Scene title"/);
  assert.doesNotMatch(source,/storyboard-scene-title-field"><span>Scene title<\/span>/);
  const focus=fs.readFileSync('tool/css/storyboard.css','utf8');
  assert.match(focus,/\.storyboard-scenes-list\.is-focus \.storyboard-scene-title-field input \{\s*font-size: 16px;/);
  const takes=focus.split('.storyboard-scenes-list.is-focus .storyboard-scene:has(> .storyboard-takes[open]) > .storyboard-takes {')[1].split('}',1)[0];
  assert.match(takes,/margin-top: 0/);
  assert.match(takes,/border: 0/);
  assert.match(takes,/background: transparent/);
  assert.match(focus,/\.storyboard-scenes-list\.is-focus \.storyboard-scene:has\(> \.storyboard-takes\[open\]\) \.storyboard-takes-summary \{\s*padding: 0;/);
});

test('Scenes toolbar keeps distinct labeled buttons visible with responsive wrapping',()=>{
  const labelRule=css.split('.storyboard-tool-label {').at(-1).split('}',1)[0];
  assert.match(labelRule,/display:\s*inline/);
  const buttons=css.split('#storyboard-project-tool-bar > .storyboard-tool-icon {').at(-1).split('}',1)[0];
  assert.match(buttons,/width:\s*auto/);
  assert.match(buttons,/min-width:\s*36px/);
  assert.match(buttons,/white-space:\s*nowrap/);
  assert.match(css,/@container \(max-width: 760px\)\s*\{\s*#storyboard-project-tool-bar \{ flex-wrap: wrap; \}/);
  for(const id of ['storyboard-generate-scenes-btn','storyboard-cancel-takes-btn','storyboard-director-tools-btn','storyboard-find-replace-btn'])
    assert.match(html,new RegExp('id="'+id+'"[^>]*aria-label="[^"]+"'));
});

test('Wide Takes heading aligns with Generation and retains left inset',()=>{
  const takesSummary=css.split('.storyboard-scenes-list.is-focus .storyboard-scene:has(> .storyboard-takes[open]) .storyboard-takes-summary {')[1].split('}',1)[0];
  const takesContent=css.split('.storyboard-scenes-list.is-focus .storyboard-scene:has(> .storyboard-takes[open]) .storyboard-takes-content {')[1].split('}',1)[0];
  assert.match(takesSummary,/min-height:\s*0/);
  assert.match(takesSummary,/padding:\s*16px 14px 12px/);
  assert.match(takesContent,/padding:\s*0 14px 14px/);
});
