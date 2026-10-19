/* Shared lightweight review: proposal is inert until explicit Apply. */
(function () {
  'use strict';
  var active = null;
  var applying = false;
  function el(id) { return document.getElementById(id); }
  function hide() {
    if (applying) return;
    active = null;
    el('director-lora-review-modal').classList.add('hidden');
    el('director-lora-review-modal').setAttribute('aria-hidden', 'true');
  }
  function render() {
    var list = el('director-lora-review-list');
    list.replaceChildren();
    active.items.forEach(function (item, index) {
      var row = document.createElement('div');
      row.className = 'keep-lora-field';
      row.style.cssText = 'border:1px solid var(--border-color,#7775);border-radius:8px;padding:10px;';
      var check = document.createElement('input');
      check.type = 'checkbox'; check.checked = item.enabled;
      check.addEventListener('change', function () { item.enabled = check.checked; });
      var name = document.createElement('strong');
      name.textContent = ' ' + item.name;
      var explanation = document.createElement('div');
      explanation.textContent = item.reason || 'Manually added';
      explanation.style.opacity = '.75';
      var strength = document.createElement('input');
      strength.type = 'number'; strength.min = '-2'; strength.max = '2'; strength.step = '.05';
      strength.value = String(item.strength); strength.setAttribute('aria-label', 'Strength for ' + item.name);
      strength.addEventListener('input', function () { item.strength = Number(strength.value); });
      var label = document.createElement('label'); label.textContent = 'Strength '; label.appendChild(strength);
      var phrases = document.createElement('input');
      phrases.type = 'text'; phrases.value = item.phrases.join(', ');
      phrases.style.width = '100%'; phrases.setAttribute('aria-label', 'Phrases for ' + item.name);
      phrases.addEventListener('input', function () {
        item.phrases = phrases.value.split(',').map(function (text) { return text.trim(); }).filter(Boolean);
      });
      if (active.scenes && active.scenes.length) {
        var target = document.createElement('select');
        target.setAttribute('aria-label', 'Apply ' + item.name + ' to');
        target.add(new Option('Story-wide', ''));
        active.scenes.forEach(function (scene) { target.add(new Option(scene.title || scene.id, scene.id)); });
        target.value = item.sceneId || '';
        target.addEventListener('change', function () { item.sceneId = target.value; });
        row.appendChild(target);
      }
      row.appendChild(check); row.appendChild(name); row.appendChild(explanation);
      row.appendChild(label); row.appendChild(phrases); list.appendChild(row);
    });
    el('director-lora-review-summary').textContent =
      active.items.length + ' suggested LoRA' + (active.items.length === 1 ? '' : 's') + '. Review before applying.';
  }
  function open(args) {
    if (active) throw new Error('Another LoRA review is already open.');
    active = {
      items: (args.items || []).map(function (item) {
        return {name: item.name, strength: item.strength, reason: item.reason,
          phrases: (item.phrases || []).slice(), sceneId:item.sceneId || '', enabled: true};
      }), catalogue: args.catalogue || [], scenes:args.scenes || [], apply: args.apply
    };
    var add = el('director-lora-review-add');
    add.replaceChildren(new Option('Choose from library…', ''));
    active.catalogue.forEach(function (item) { add.add(new Option(item.name, item.name)); });
    el('director-lora-review-error').textContent = '';
    render();
    el('director-lora-review-modal').classList.remove('hidden');
    el('director-lora-review-modal').setAttribute('aria-hidden', 'false');
    el('director-lora-review-cancel').focus();
  }
  window.openDirectorLoraReview = open;
  function apply() {
    if (!active) return;
    var selected = active.items.filter(function (item) { return item.enabled; });
    var allowed = {};
    active.catalogue.forEach(function (entry) {
      var words = (entry.trainedWords || []).slice();
      Object.keys(entry.promptOptions || {}).forEach(function (group) {
        words = words.concat(entry.promptOptions[group] || []);
      });
      allowed[entry.name] = words;
    });
    var issue = selected.find(function (item) {
      return !Number.isFinite(item.strength) || item.strength < -2 || item.strength > 2 ||
        !allowed[item.name] || item.phrases.some(function (phrase) {
          return allowed[item.name].indexOf(phrase) === -1;
        });
    });
    if (issue) {
      el('director-lora-review-error').textContent =
        'Invalid strength or undocumented phrase for ' + issue.name + '. Check the metadata.';
      return;
    }
    var callback = active.apply;
    var button = el('director-lora-review-apply');
    button.disabled = true;
    applying = true;
    el('director-lora-review-cancel').disabled = true;
    el('director-lora-review-close').disabled = true;
    Promise.resolve().then(function () {
      return callback(selected.map(function (item) {
        return {name:item.name,strength:item.strength,phrases:item.phrases,sceneId:item.sceneId || ''};
      }));
    }).then(function () {
      applying = false;
      hide();
    }).catch(function (error) {
      el('director-lora-review-error').textContent = String(error.message || error);
    }).finally(function () {
      applying = false;
      button.disabled = false;
      el('director-lora-review-cancel').disabled = false;
      el('director-lora-review-close').disabled = false;
    });
  }
  document.addEventListener('click', function (event) {
    if (event.target.closest('#director-lora-review-apply')) apply();
    else if (event.target.closest('#director-lora-review-cancel,#director-lora-review-close')) hide();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && active && !applying) {
      event.preventDefault();
      hide();
    }
  });
  document.addEventListener('change', function (event) {
    if (event.target.id !== 'director-lora-review-add' || !active) return;
    var name = event.target.value;
    if (!name) return;
    if (!active.scenes.length && active.items.some(function (item) { return item.name === name; })) return;
    active.items.push({name:name, strength:.9, phrases:[], sceneId:'', reason:'Manually added', enabled:true});
    render();
    event.target.value = '';
  });
})();
