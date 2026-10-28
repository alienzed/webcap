const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tool/js/director_chat.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tool/tool.html'), 'utf8');

function part(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Missing Studio code: ' + start);
  return source.slice(a, b);
}

test('Studio scene reviewer has editable intent, placement and approval controls', () => {
  for (const name of [
    'director-studio-prepare-scene', 'studio-scene-draft-review',
    'studio-scene-draft-title', 'studio-scene-draft-summary',
    'studio-scene-draft-placement', 'studio-scene-draft-apply'
  ]) assert.match(html, new RegExp('id="' + name + '"'));
  assert.match(html, /Nothing is created until you approve/);
  assert.match(source, /operation: 'studio_scene_draft'/);
  assert.match(source, /\/fs\/studio\/director\/scene-draft/);
});

test('Only explicitly attached Story ID qualifies as a Scene target', () => {
  const state = { storyboardAttachments: {} };
  const context = vm.createContext({ state, Object });
  const target = vm.runInContext('(' + part('  function studioAttachedStoryId() {', '  function studioActionStatus(').trim() + ')', context);
  assert.equal(target(), '');
  state.storyboardAttachments['scene:other:scene-a'] = { label: 'Scene' };
  assert.equal(target(), '');
  state.storyboardAttachments['story:studio-a'] = { label: 'Story A' };
  assert.equal(target(), 'studio-a');
  state.storyboardAttachments['story:studio-b'] = { label: 'Story B' };
  assert.equal(target(), '');
});

test('Schema output parser rejects malformed drafts without inventing missing fields', () => {
  const context = vm.createContext({ JSON, String, Error });
  const parse = vm.runInContext('(' + part('  function parseStudioSceneDraft(raw) {', '  function showStudioSceneDraftReview() {').trim() + ')', context);
  const draft = parse(JSON.stringify({ title: '', summary: 'One short clear action', rationale: 'Simple clip' }));
  assert.equal(draft.title, '');
  assert.equal(draft.summary, 'One short clear action');
  assert.throws(() => parse('{}'), /must include a title, description and rationale/);
  assert.throws(() => parse('not JSON'), /invalid Scene draft JSON/);
  assert.throws(() => parse(JSON.stringify({ title: '', summary: '   ', rationale: '' })), /must include/);
});

test('Studio drafting is a staged proposal, not a silent Story mutation', () => {
  const prepare = part('  function prepareStudioSceneDraft() {', '  function applyStudioSceneDraft() {');
  assert.match(prepare, /studioAttachedStoryId\(\)/);
  assert.match(prepare, /window\.flushStudioDirectorStoryEdits\(storyId\)/);
  assert.match(prepare, /state\.studioSceneProposal =/);
  assert.match(prepare, /showStudioSceneDraftReview\(\)/);
  assert.doesNotMatch(prepare, /\/fs\/studio\/director\/scene-draft/);
  const apply = part('  function applyStudioSceneDraft() {', '  function startStudioWorkshop() {');
  assert.match(apply, /expectedUpdatedAt: proposal\.expectedUpdatedAt/);
  assert.match(apply, /placement: placement/);
  assert.match(apply, /relativeSceneId: relativeSceneId/);
  assert.match(apply, /persistSession\('storyboard'\)/);
  assert.match(apply, /refreshStudioDirectorStoryIfOpen\(proposal\.storyId\)/);
});


test('Studio project proposals remain separate from conversation and must be reviewed', () => {
  for (const name of [
    'director-studio-prepare-project', 'studio-project-review', 'studio-project-concept',
    'studio-project-style', 'studio-project-invariants', 'studio-project-include-scene',
    'studio-project-create'
  ]) assert.match(html, new RegExp('id="' + name + '"'));
  const prep = part('  function prepareStudioProject() {', '  function applyStudioProject() {');
  assert.match(prep, /operation: 'studio_project_draft'/);
  assert.match(prep, /showStudioProjectReview\(\)/);
  assert.doesNotMatch(prep, /\/fs\/studio\/director\/project-create/);
  const apply = part('  function applyStudioProject() {', '  function parseStudioSceneDraft(raw) {');
  assert.match(apply, /\/fs\/studio\/director\/project-create/);
  assert.match(apply, /persistSession\('storyboard'\)/);
  assert.match(apply, /refreshStudioDirectorStoryIfOpen/);
  assert.doesNotMatch(apply, /state\.storyboardAttachments\s*=/);
});

test('Unbound Project parser accepts zero Scenes and refuses invented or invalid structure', () => {
  const context = vm.createContext({ JSON, String, Error, Array });
  const parse = vm.runInContext('(' + part('  function parseStudioProjectDraft(raw) {', '  function addStudioProjectInvariant(').trim() + ')', context);
  const project = parse(JSON.stringify({
    title: '', concept: 'A single simple idea', style: '', rationale: '',
    invariants: []
  }));
  assert.equal(project.firstScene, undefined);
  assert.equal(project.title, '');
  assert.throws(() => parse('{}'), /Project proposal must contain/);
  assert.throws(() => parse(JSON.stringify({
    title: '', concept: '', style: '', rationale: '', invariants: []
  })), /at least an idea/);
});


test('Studio offers reviewed multi-Scene insert with arbitrary placement', () => {
  for (const id of [
    'director-studio-prepare-scenes', 'studio-scenes-review', 'studio-scenes-rows',
    'studio-scenes-placement', 'studio-scenes-apply', 'studio-scenes-add'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  const prep = part('  function prepareStudioScenes() {', '  function applyStudioScenes() {');
  assert.match(prep, /operation: 'studio_scene_sequence_draft'/);
  assert.match(prep, /studioAttachedStoryId\(\)/);
  assert.match(prep, /window\.flushStudioDirectorStoryEdits\(storyId\)/);
  assert.doesNotMatch(prep, /\/fs\/studio\/director\/scenes-draft/);
  const apply = part('  function applyStudioScenes() {', '  function parseStudioSceneDraft(raw) {');
  assert.match(apply, /expectedSceneOrder: proposal\.sceneOrder/);
  assert.match(apply, /\/fs\/studio\/director\/scenes-draft/);
  assert.match(apply, /persistSession\('storyboard'\)/);
  assert.match(source, /option\('before\|' \+ id/);
  assert.match(source, /option\('after\|' \+ id/);
});

test('Scene sequence parser rejects invalid or overlarge batches', () => {
  const context = vm.createContext({ JSON, Array, String, Error });
  const parse = vm.runInContext('(' + part('  function parseStudioScenesDraft(raw) {', '  function addStudioScenesRow(').trim() + ')', context);
  assert.equal(parse(JSON.stringify({scenes: [{title: '', summary: 'One'}], rationale: ''})).scenes.length, 1);
  assert.throws(() => parse('bad json'), /invalid Scene sequence JSON/);
  assert.throws(() => parse(JSON.stringify({scenes: [], rationale: ''})), /one to eight/);
  assert.throws(() => parse(JSON.stringify({
    scenes: Array.from({length: 9}, (_, i) => ({title: '', summary: 'Scene ' + i})),
    rationale: ''
  })), /one to eight/);
});


test('Studio brief review limits Apply to explicitly checked Story fields', () => {
  for (const id of [
    'director-studio-propose-brief', 'studio-brief-review',
    'studio-brief-concept-selected', 'studio-brief-style-selected',
    'studio-brief-invariants-selected', 'studio-brief-apply',
    'director-studio-undo-brief'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
  const prep = part('  function prepareStudioBrief() {', '  function applyStudioBrief() {');
  assert.match(prep, /studioAttachedStoryId\(\)/);
  assert.match(prep, /window\.flushStudioDirectorStoryEdits\(storyId\)/);
  assert.match(prep, /operation: 'studio_brief_draft'/);
  assert.doesNotMatch(prep, /\/fs\/studio\/director\/brief'/);
  const apply = part('  function applyStudioBrief() {', '  function undoStudioBrief() {');
  assert.match(apply, /studio-brief-concept-selected/);
  assert.match(apply, /studio-brief-style-selected/);
  assert.match(apply, /studio-brief-invariants-selected/);
  assert.match(apply, /expected: expected, changes: changes/);
  assert.match(apply, /\/fs\/studio\/director\/brief'/);
  assert.match(source, /\/fs\/studio\/director\/brief\/undo/);
});
