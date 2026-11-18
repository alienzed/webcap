'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const markup = fs.readFileSync('tool/tool.html', 'utf8');
const css = fs.readFileSync('tool/css/generate.css', 'utf8');
const generate = fs.readFileSync('tool/js/generate.js', 'utf8');

function between(source,start,end) {
  const i = source.indexOf(start), j=source.indexOf(end,i);
  assert.ok(i>=0 && j>i, 'Expected Generation Settings region is missing');
  return source.slice(i,j);
}

test('Sampling lives in the Generation Settings header, without an Advanced toggle',()=>{
  const heading=between(markup,'<div class="generate-inspector-heading">','<section class="generate-output-settings">');
  assert.match(heading,/id="generate-field-samplingMode"/);
  assert.match(heading,/<select id="generate-sampling-mode"/);
  assert.match(heading,/<option value="turbo">/);
  assert.match(heading,/<option value="quality">/);
  assert.doesNotMatch(markup,/id="generate-advanced-toggle"|id="generate-advanced-panel"/);
  assert.doesNotMatch(generate,/generate-advanced-toggle|generate-advanced-panel/);
});

test('Aspect ratio, MP, Duration and Seed are consecutive primary controls',()=>{
  const primary=between(markup,'<div class="generate-settings-primary">','</div>');
  const ids=['generate-field-aspectRatio','generate-field-megapixels',
    'generate-field-duration','generate-field-seed'];
  let prior=-1;
  ids.forEach(id=>{
    const pos=primary.indexOf('id="'+id+'"');
    assert.ok(pos>prior, id+' is missing or out of order');
    prior=pos;
  });
  assert.match(primary,/id="generate-field-dimensions"/,
    'Model-specific dimensions remain available');
  assert.doesNotMatch(primary,/generate-field-samplingMode/,
    'Sampling belongs to the heading, not the primary row');
  assert.match(css,/grid-template-columns:\s*minmax\(0,\s*2fr\)[^;]*;/);
  assert.match(css,/@container \(max-width: 450px\)/);
});

test('Moving controls does not alter model field visibility or submitted settings',()=>{
  assert.match(generate,/'aspectRatio', 'megapixels', 'duration', 'samplingMode', 'dimensions', 'seed'/);
  for(const [field,control] of [
    ['aspectRatio','generate-aspect'],['megapixels','generate-megapixels'],
    ['duration','generate-duration'],['seed','generate-seed'],
    ['samplingMode','generate-sampling-mode']
  ]) {
    assert.ok(generate.includes("if (fieldVisible('"+field+"')) settings."+field+
      " = el('"+control+"').value"),field+' is still submitted conditionally');
  }
});
