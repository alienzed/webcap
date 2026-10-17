(function () {
  'use strict';
  var currentFolder = '';
  var activeCampaign = '';
  var campaigns = [];
  var runs = [];
  var timer = null;
  var mode = 'tests';
  var lastFrameKey = '';
  var wizardStep = 1;
  var dimensions = [];
  var inspectedEpoch = null;
  var selectedEpochs = new Set();
  var selectedRunId = "";
  var proposalBusy = false;
  var copyingEpoch = false;
  var currentCampaign = null;
  var els = function (id) { return document.getElementById('epoch-finder-' + id); };
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function api(operation, criteria) {
    return fetch('/fs/epoch_finder', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: currentFolder, operation: operation, criteria: criteria || {} })
    }).then(function (response) { return response.json().then(function (json) {
      if (!response.ok || !json.ok) throw new Error(json.error || 'Epoch Finder request failed.');
      return json;
    }); });
  }
  function error(exc) {
    var node = els('error');
    node.textContent = String(exc && exc.message || exc);
    node.classList.remove('hidden');
    console.error('[Epoch Finder]', exc);
    if (typeof window.reportConsoleError === 'function') window.reportConsoleError('Epoch Finder', exc);
  }
  function clearError() { els('error').classList.add('hidden'); els('error').textContent = ''; }
  function showMode(next) {
    mode = next;
    var finder = next === 'finder';
    els('mode-finder').classList.toggle('active', finder);
    els('mode-tests').classList.toggle('active', !finder);
    els('mode-finder').setAttribute('aria-pressed', String(finder));
    els('mode-tests').setAttribute('aria-pressed', String(!finder));
    els('screen').classList.toggle('hidden', !finder);
    document.getElementById('test-generations-body').classList.toggle('hidden', finder);
    if (finder) refresh();
  }
  function renderSecondsEstimate(modelId, durationSeconds, megapixels) {
    // First real-machine seed measurements; not a formula or a claim about
    // other models, durations or resolutions.
    if (modelId === 'minimax_h3' && Number(durationSeconds) === 3) {
      if (Math.abs(megapixels - 0.3) < 0.0001) return { seconds: 10, seeded: true };
      if (Math.abs(megapixels - 0.4) < 0.0001) return { seconds: 15, seeded: true };
    }
    return { seconds: 30, seeded: false };
  }
  function wildcardParts(prompt) {
    // Match the server's top-level groups and fully expand their nested choices.
    var source = String(prompt || '');
    function parseSequence(position, stops) {
      var nodes = [], literal = '';
      while (position < source.length && !stops.includes(source[position])) {
        if (source[position] !== '{') { literal += source[position++]; continue; }
        if (literal) { nodes.push({ literal: literal }); literal = ''; }
        var group = parseGroup(position + 1);
        nodes.push({ alternatives: group.options });
        position = group.end;
      }
      if (literal) nodes.push({ literal: literal });
      return { nodes: nodes, end: position };
    }
    function parseGroup(position) {
      var options = [];
      while (true) {
        var parsed = parseSequence(position, '|}');
        options.push(parsed.nodes);
        position = parsed.end;
        if (position >= source.length) throw new Error('Unclosed wildcard group.');
        if (source[position++] === '}') return { options: options, end: position };
      }
    }
    function expand(nodes) {
      return nodes.reduce(function (values, node) {
        var choices = node.literal !== undefined ? [node.literal] :
          node.alternatives.flatMap(expand);
        return values.flatMap(function (prefix) {
          return choices.map(function (choice) { return prefix + choice; });
        });
      }, ['']);
    }
    var parsed = parseSequence(0, '');
    var groups = [], cursor = 0;
    parsed.nodes.forEach(function (node) {
      if (!node.alternatives) {
        cursor += node.literal.length;
        return;
      }
      var start = cursor, raw = source.slice(start);
      var scan = parseGroup(start + 1);
      cursor = scan.end;
      var options = Array.from(new Set(node.alternatives.flatMap(expand).map(function (v) {
        return v.trim().replace(/\s+/g, ' ');
      })));
      if (options.length < 2) throw new Error('Every wildcard needs at least two distinct resolved values.');
      groups.push({ start: start, end: cursor, options: options,
        nested: raw.slice(0, cursor - start).slice(1, -1).includes('{') });
    });
    if (!groups.length) throw new Error('Add at least one wildcard group.');
    return groups;
  }
  function updateDimensions() {
    var groups = wildcardParts(els('prompt').value);
    dimensions = groups.map(function (g, index) {
      var prev = dimensions[index] || {};
      var oldValues = (prev.options || []).join('|');
      return {label: String(prev.label || ('Attribute ' + (index + 1))),
        options: g.options.slice(),
        role: oldValues && oldValues !== g.options.join('|') ? 'primary' : (prev.role || 'primary'), nested: g.nested};
    });
    renderDimensions();
  }
  function renderDimensions() {
    els('attributes').innerHTML = dimensions.map(function (group, index) {
      return '<div class="epoch-finder-attribute" data-index="' + index + '">' +
        '<label>Attribute <input data-attr-name value="' + escape(group.label) + '"></label>' +
        '<label>Role <select data-attr-role>' +
        [['primary', 'Primary · 2×'], ['leakage', 'Leakage · 1×'], ['vary', 'Vary only · unscored']].map(function (item) {
          return '<option value="' + item[0] + '"' + (group.role === item[0] ? ' selected' : '') +
            '>' + item[1] + '</option>';
        }).join('') + '</select></label>' +
        '<label class="epoch-finder-options-field">Values (separate using |)' +
        '<input data-attr-values value="' + escape(group.options.join(' | ')) + '"' + (group.nested ? ' readonly title="Nested wildcard values are edited in the prompt"' : '') + '></label>' +
        '</div>';
    }).join('');
  }
  function recordDimensions() {
    var groups = wildcardParts(els('prompt').value);
    var rows = Array.from(els('attributes').querySelectorAll('[data-index]'));
    if (rows.length !== groups.length) throw new Error('Update attributes to match the wildcard prompt.');
    var edits = rows.map(function (row, index) {
      var values = row.querySelector('[data-attr-values]').value.split('|').map(function (x) { return x.trim(); });
      if (groups[index].nested) values = groups[index].options.slice();
      if (values.length < 2 || new Set(values).size !== values.length ||
          values.some(function (x) { return /[{}|]/.test(x); })) throw new Error('Attribute ' + (index + 1) + ' has invalid values.');
      var label = row.querySelector('[data-attr-name]').value.trim();
      if (!label) throw new Error('Every attribute needs a name.');
      return {label: label, role: row.querySelector('[data-attr-role]').value, options: values};
    });
    if (!edits.some(function (entry) { return entry.role !== 'vary'; })) {
      throw new Error('Mark at least one concept or leakage attribute for scoring.');
    }
    // Values editor owns the concrete wildcard choices. Preserve all literal
    // prompt text rather than reconstructing a caption from individual labels.
    var text = els('prompt').value;
    for (var i = groups.length - 1; i >= 0; i--) {
      if (groups[i].nested) continue;
      text = text.slice(0, groups[i].start) + '{' + edits[i].options.join('|') + '}' +
        text.slice(groups[i].end);
    }
    els('prompt').value = text;
    dimensions = edits.map(function (entry, index) { return Object.assign(entry, { nested: groups[index].nested }); });
    return edits;
  }
  function propose() {
    if (proposalBusy) return;
    if (!els('run').value) return error(new Error('Select a training run first.'));
    var directorModel = getDirectorModelPreference('webcap.director.model');
    if (!directorModel) return error(new Error('Select a Director model in the app header.'));
    clearError();
    proposalBusy = true;
    els('suggest').disabled = true;
    els('proposal-status').textContent = 'Director is analyzing Set captions and vocabulary…';
    var folder = currentFolder;
    var currentJobId = '';
    fetch('/fs/epoch_finder/propose', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({folder: folder, directorModel: directorModel,
        focus: els('concept').value.trim(),
        vocabulary: window.getTestGenerationPlanningVocabulary()})
    }).then(function (response) { return response.json().then(function (body) {
      if (!response.ok || !body.ok) throw new Error(body.error || 'Could not propose tests.');
      return body.job;
    }); }).then(function (job) {
      currentJobId = job.jobId;
      if (!currentJobId) throw new Error('Director request did not return a job ID.');
      if (typeof window.trackTransientLlmJob === 'function') window.trackTransientLlmJob(job);
      function poll() {
        return fetch('/fs/director/job?job=' + encodeURIComponent(currentJobId) + '&consume=1')
          .then(function (response) { return response.json(); }).then(function (body) {
            var result = body.job || {};
            if (result.status === 'completed') return result.result;
            if (['failed','interrupted','stopped','cancelled'].includes(result.status)) {
              throw new Error(result.error || 'Director proposal failed: ' + result.status);
            }
            return new Promise(function (resolve) { setTimeout(resolve, 1600); }).then(poll);
          });
      }
      return poll();
    }).then(function (result) {
      if (folder !== currentFolder) throw new Error('Set changed while planning. Reopen the wizard.');
      var analysis = result && result.analysis;
      if (!analysis || !analysis.wildcard || !Array.isArray(analysis.variationGroups)) {
        throw new Error('Director returned an incomplete test proposal.');
      }
      els('concept').value = analysis.concept || els('concept').value;
      els('prompt').value = analysis.wildcard;
      dimensions = analysis.variationGroups.map(function (g) {
        return {label: g.label, options: g.options, role: g.role};
      });
      renderDimensions();
      els('proposal-status').textContent = 'Proposed tests ready. Edit values and scoring roles freely.';
    }).catch(error).finally(function () {
      proposalBusy = false;
      els('suggest').disabled = false;
    });
  }
  function chosenEpochs() {
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    return run ? run.epochs.filter(function (epoch) { return selectedEpochs.has(epoch); }) : [];
  }
  function drawEpochPicker() {
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    var host = els('epoch-picker');
    if (!run) { host.classList.add('hidden'); host.innerHTML = ''; return; }
    host.classList.remove('hidden');
    var chosen = chosenEpochs();
    host.innerHTML = '<div class="epoch-finder-epoch-tools"><strong>' + chosen.length + ' / ' +
      run.epochs.length + ' epochs selected</strong>' +
      '<button type="button" data-epoch-action="all">All</button>' +
      '<button type="button" data-epoch-action="none">Clear</button>' +
      '<label>From <input type="number" data-epoch-min placeholder="Min"></label>' +
      '<label>To <input type="number" data-epoch-max placeholder="Max"></label>' +
      '<button type="button" data-epoch-action="range">Select range</button></div>' +
      '<div class="epoch-finder-epoch-grid">' + run.epochs.map(function (epoch) {
        return '<label><input type="checkbox" data-epoch-choice="' + epoch + '"' +
          (selectedEpochs.has(epoch) ? ' checked' : '') + '> ' + epoch + '</label>';
      }).join('') + '</div>';
  }
  function reviewWizard() {
    var parts = recordDimensions();
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    if (!run) throw new Error('Select a training run.');
    var roundSummary = getRoundPlans().map(function (round, index) {
      return 'R' + (index + 1) + ': ' + round.cases + ' tests/epoch · keep ' +
        round.keepPercent + '%' + (round.megapixels ? ' · ' + round.megapixels + ' MP' : '');
    });
    els('review').innerHTML = '<p><strong>' + escape(run.runName) + '</strong> · ' +
      chosenEpochs().length + ' selected of ' + run.epochs.length + ' saved epochs</p><p>' + escape(els('concept').value.trim() || 'Concept not specified') +
      '</p><p>' + parts.map(function (item) {
        return escape(item.label) + ' (' + escape(item.role) + ': ' + item.options.length + ' values)';
      }).join(' · ') + '</p><p>' + roundSummary.map(escape).join('<br>') +
      '</p><p>' + escape(els('estimate').textContent) + '</p>' +
      '<p class="epoch-finder-muted">Only Launch starts inference. Your approved prompt, roles, rounds, model and seeds are frozen for this campaign.</p>';
  }
  function showStep(value) {
    wizardStep = value;
    document.querySelectorAll('[data-epoch-wizard-step]').forEach(function (element) {
      element.classList.toggle('hidden', Number(element.dataset.epochWizardStep) !== value);
    });
    document.querySelectorAll('[data-epoch-step-label]').forEach(function (element) {
      element.classList.toggle('active', Number(element.dataset.epochStepLabel) === value);
    });
    els('back').classList.toggle('hidden', value === 1);
    els('next').classList.toggle('hidden', value === 4);
    els('start').classList.toggle('hidden', value !== 4);
    if (value === 3) roundPlan();
    if (value === 4) reviewWizard();
  }
  function advance() {
    try {
      if (wizardStep === 1 && !els('run').value) {
        throw new Error('Choose a saved training run.');
      }
      if (wizardStep === 1 && !chosenEpochs().length) {
        throw new Error('Select at least one epoch.');
      }
      if (wizardStep === 2) {
        if (!dimensions.length && els('prompt').value.trim()) updateDimensions();
        recordDimensions();
      }
      showStep(Math.min(4, wizardStep + 1));
    } catch (exc) { error(exc); }
  }
  function roundPlan() {
    var host = els('round-plan');
    var count = Number(els('rounds').value);
    if (!Number.isInteger(count) || count < 1 || count > 4) return;
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    var baseCount = chosenEpochs().length;
    var current = Array.from(host.querySelectorAll('[data-epoch-round]')).map(function (row) {
      return {
        cases: Number(row.querySelector('[data-case]').value),
        keepPercent: Number(row.querySelector('[data-keep]').value),
        megapixels: Number(row.querySelector('[data-mp]').value)
      };
    });
    host.innerHTML = '<strong>Round plan</strong>' + Array.from({ length: count }, function (_, index) {
      var saved = current[index] || {};
      var mp = saved.megapixels || Math.min(0.4, 0.2 + index * 0.1);
      var cases = saved.cases || Number(els('cases').value) || 2;
      var keep = saved.keepPercent || Number(els('retention').value) || 50;
      return '<div class="epoch-finder-round-row" data-epoch-round="' + (index + 1) + '">' +
        '<span>R' + (index + 1) + '</span>' +
        '<label>Tests<input data-case type="number" min="1" max="6" value="' + cases + '"></label>' +
        '<label>Keep %<input data-keep type="number" min="10" max="90" value="' + keep + '"></label>' +
        '<label>MP<input data-mp type="number" min="0.1" max="0.4" step="0.1" value="' + mp.toFixed(1) + '"></label></div>';
    }).join('');
    // Krea2 resolution is specified in the selected Test dimensions, not MP.
    var hasMp = !!document.getElementById('test-generations-megapixels') &&
      !document.getElementById('test-generations-megapixels-field').classList.contains('hidden');
    host.querySelectorAll('[data-mp]').forEach(function (input) {
      input.closest('label').classList.toggle('hidden', !hasMp);
    });
    function estimate() {
      var remaining = baseCount, renders = 0, estimatedSeconds = 0;
      var seededRenders = 0;
      var durationInput = document.getElementById('test-generations-duration');
      var duration = durationInput ? Number(durationInput.value) : NaN;
      var modelId = typeof window.getWorkingModelProfileId === 'function' ?
        String(window.getWorkingModelProfileId() || '') : '';
      Array.from(host.querySelectorAll('[data-epoch-round]')).forEach(function (row, index) {
        var tests = Number(row.querySelector('[data-case]').value);
        var keepPct = Number(row.querySelector('[data-keep]').value);
        var mpInput = row.querySelector('[data-mp]');
        var mp = mpInput && !mpInput.closest('label').classList.contains('hidden') ?
          Number(mpInput.value) : NaN;
        var projection = row.querySelector('span');
        projection.textContent = 'R' + (index + 1) + ' · ~' + remaining + ' epochs';
        var count = Number.isFinite(tests) && tests > 0 ? remaining * tests : 0;
        var time = renderSecondsEstimate(modelId, duration, mp);
        renders += count;
        estimatedSeconds += count * time.seconds;
        if (time.seeded) seededRenders += count;
        remaining = Math.max(1, Math.ceil(remaining * keepPct / 100));
      });
      var minutes = Math.floor(estimatedSeconds / 60);
      var seconds = estimatedSeconds % 60;
      var estimateText = minutes ? minutes + 'm' + (seconds ? ' ' + seconds + 's' : '') :
        seconds + 's';
      els('estimate').textContent = renders + ' projected renders · ~' + estimateText +
        (seededRenders ? ' (3s H3: 0.3 MP ≈ 10s, 0.4 MP ≈ 15s)' : '') +
        (seededRenders < renders ? ' · unmeasured: 30s/render' : '') +
        '. Excludes VL, queue time and possible cutoff ties.';
    }
    host.oninput = estimate;
    estimate();
  }
  function getRoundPlans() {
    return Array.from(els('round-plan').querySelectorAll('[data-epoch-round]')).map(function (row) {
      var plan = {cases: Number(row.querySelector('[data-case]').value),
        keepPercent: Number(row.querySelector('[data-keep]').value)};
      var mpField = row.querySelector('[data-mp]');
      if (!mpField.closest('label').classList.contains('hidden')) plan.megapixels = Number(mpField.value);
      return plan;
    });
  }
  function setup() {
    var current = String(window.getWorkingModelProfileId() || '');
    var options = runs.filter(function (run) { return run.modelId === current; });
    var select = els('run');
    var previous = select.value;
    select.innerHTML = '<option value="">Select saved training run…</option>' + options.map(function (run) {
      return '<option value="' + escape(run.jobId) + '">' + escape(run.runName) + ' · ' +
        run.epochs.length + ' epochs</option>';
    }).join('');
    if (options.some(function (run) { return run.jobId === previous; })) select.value = previous;
    select.onchange = function () {
      var run = options.find(function (item) { return item.jobId === select.value; });
      if (selectedRunId !== select.value) {
        selectedRunId = select.value;
        selectedEpochs = new Set(run ? run.epochs : []);
      }
      drawEpochPicker();
      els('run-detail').textContent = run ? run.epochs.length + ' saved epochs · ' +
        run.epochs[0] + '–' + run.epochs[run.epochs.length - 1] : '';
      roundPlan();
    };
    select.onchange();
    roundPlan();
    if (!els('prompt').value) {
      els('prompt').value = String(document.getElementById('test-generations-prompt').value || '');
    }
    els('start').disabled = !options.length;
  }
  function list() {
    els('count').textContent = String(campaigns.length);
    els('campaigns').innerHTML = campaigns.length ? campaigns.map(function (c) {
      return '<button type="button" class="epoch-finder-campaign ' +
        (c.id === activeCampaign ? 'active' : '') + '" data-id="' + escape(c.id) + '">' +
        '<strong>' + escape(c.name || c.id) + '</strong><small>Round ' + escape(c.round) +
        ' · ' + escape(c.phase || c.status) + '</small></button>';
    }).join('') : '<span class="epoch-finder-muted">No campaigns yet.</span>';
  }
  function progress(campaign) {
    var plan = campaign.rounds.find(function (r) { return r.number === campaign.round; }) || campaign.rounds[campaign.rounds.length - 1];
    var units = campaign.units.filter(function (u) { return u.round === plan.number; });
    var total = plan.epochs.length * plan.seeds.length;
    var frames = units.filter(function (u) { return !!u.frame; }).length;
    var evaluated = units.filter(function (u) { return u.assessment !== null; }).length;
    els('render-count').textContent = frames + ' / ' + total;
    els('vl-count').textContent = evaluated + ' / ' + total;
    els('field-count').textContent = plan.epochs.length + ' epochs';
    els('render-bar').style.width = (total ? frames / total * 100 : 0) + '%';
    els('vl-bar').style.width = (total ? evaluated / total * 100 : 0) + '%';
    els('timeline').innerHTML = campaign.rounds.map(function (round) {
      var done = round.number < campaign.round || campaign.status === 'complete';
      var active = round.number === campaign.round && campaign.status !== 'complete';
      return '<div class="epoch-finder-step ' + (done ? 'done' : active ? 'current' : '') + '">' +
        '<strong>' + (done ? '✓ ' : active ? '● ' : '○ ') + 'Round ' + round.number + '</strong>' +
        '<small>' + round.epochs.length + ' epochs · ' + round.seeds.length + ' tests each</small></div>';
    }).join('');
  }
  function ranking(campaign) {
    var ranking = campaign.scores || [];
    // Live and completed rankings share one cumulative score definition.
    var round = Math.min(campaign.round, campaign.rounds.length);
    var plan = campaign.rounds.find(function (r) { return r.number === round; });
    if (plan && campaign.phase !== 'Complete') {
      ranking = campaign.rounds[0].epochs.map(function (epoch) {
        var comparison = campaign.units.filter(function (u) {
          return u.round <= round && u.epoch === epoch && u.assessment;
        }).flatMap(function (unit) { return unit.assessment.comparison || []; });
        var matches = comparison.reduce(function (n, g) {
          return n + (g.result === 'match' ? Number(g.weight == null ? 1 : g.weight) : 0);
        }, 0);
        var mismatches = comparison.reduce(function (n, g) {
          return n + (g.result === 'mismatch' ? Number(g.weight == null ? 1 : g.weight) : 0);
        }, 0);
        return {epoch: epoch, matches: matches, mismatches: mismatches,
          active: plan.epochs.indexOf(epoch) !== -1,
          count: matches + mismatches, score: matches + mismatches ? matches / (matches + mismatches) : null};
      }).sort(function (a,b) {
        return (a.score == null) - (b.score == null) || (b.score || 0) - (a.score || 0) || a.epoch - b.epoch;
      });
    }
    var errors = (campaign.units || []).filter(function (unit) { return !!unit.error; }).length;
    els('ranking-note').textContent = ranking.length ? 'Cumulative concept fidelity · unclear excluded' +
      (errors ? ' · ' + errors + ' failed observation(s)' : '') :
      'Results appear as VL evaluates frames.';
    els('ranking').innerHTML = ranking.length ? ranking.map(function (entry, index) {
      return '<button type="button" class="epoch-finder-ranking-row" data-inspect-epoch="' + entry.epoch + '" title="Inspect all retained tests for this epoch"><span class="rank">#' + (index + 1) +
        '</span><span class="epoch">Epoch ' + entry.epoch + (entry.active === false ? ' · sidelined' : '') +
        '</span><span class="epoch-finder-score-track"><i style="width:' +
        Math.round((entry.score || 0) * 100) + '%"></i></span><span class="percent">' +
        (entry.score == null ? '—' : Math.round(entry.score * 100) + '%') + '</span></button>';
    }).join('') : '<p class="epoch-finder-muted">Waiting for VL judgments.</p>';
  }
  function gallery(campaign) {
    var units = campaign.units.filter(function (u) {
      return inspectedEpoch == null || u.epoch === inspectedEpoch;
    });
    var key = campaign.id + ':' + inspectedEpoch + ':' + units.map(function (u) {
      return u.frame + ':' + (u.assessment ? '1' : '0') + ':' + (u.error || '');
    }).join('|');
    if (lastFrameKey === key) return;
    lastFrameKey = key;
    var heading = inspectedEpoch == null ? '<strong>Recent retained frames</strong>' :
      '<strong>Epoch ' + inspectedEpoch + ' · All recorded tests</strong> ' +
      '<button type="button" data-copy-to-test' + (copyingEpoch ? ' disabled' : '') + '>Copy to Test</button> ' +
      '<button type="button" data-inspect-reset>Show all epochs</button>';
    var shown = inspectedEpoch == null ? units.filter(function (u) { return !!u.frame; }).slice(-40).reverse() :
      units.slice().sort(function (a,b) { return a.round - b.round || a.case - b.case; });
    els('frames').innerHTML = '<div class="epoch-finder-gallery-heading">' + heading + '</div>' +
      shown.map(function (unit) {
        var src = unit.frame ? '/fs/epoch_finder/frame?folder=' + encodeURIComponent(currentFolder) +
          '&campaign=' + encodeURIComponent(campaign.id) + '&frame=' + encodeURIComponent(unit.frame) : '';
        var assessment = unit.assessment || {};
        var checks = (assessment.comparison || []).map(function (g) {
          return '<div>' + escape(g.label) + ': ' + escape(g.result) +
            ' · expected ' + escape(g.expected == null ? 'unclear' : (unit.groups || []).find(function (v) {
              return v.id === g.id;
            })?.options?.[g.expected - 1] || '?') +
            ' · observed ' + escape(g.selected == null ? 'unclear' :
              (unit.groups || []).find(function (v) { return v.id === g.id; })?.options?.[g.selected - 1] || '?') + '</div>';
        }).join('');
        return '<figure class="epoch-finder-frame">' +
          (src ? '<img loading="lazy" src="' + escape(src) + '" alt="Epoch ' + unit.epoch + ' test frame">' :
            '<div class="epoch-finder-muted">Frame pruned or unavailable</div>') +
          '<figcaption>Epoch ' + unit.epoch + ' · Round ' + unit.round + ' · Test ' + (unit.case + 1) +
          '<small>' + (unit.error ? escape(unit.error) : unit.assessment ? 'VL evaluated' : 'Frame ready') +
          '</small>' + (inspectedEpoch == null ? '' : '<div>' + escape(unit.prompt || '') + '</div>' + checks) +
          '</figcaption></figure>';
      }).join('');
  }
  function render(campaign) {
    currentCampaign = campaign;
    els('empty').classList.add('hidden');
    els('active').classList.remove('hidden');
    els('phase').textContent = String(campaign.phase || campaign.status).toUpperCase();
    els('name').textContent = campaign.name || campaign.runName;
    els('detail').textContent = campaign.detail || '';
    var running = campaign.status === 'running';
    els('pause').classList.toggle('hidden', !running);
    els('stop').classList.toggle('hidden', !running);
    els('resume').classList.toggle('hidden', !['paused', 'interrupted', 'failed'].includes(campaign.status));
    els('delete').classList.toggle('hidden', running);
    progress(campaign);
    ranking(campaign);
    gallery(campaign);
  }
  function refreshStatus() {
    if (!activeCampaign) return Promise.resolve();
    return api('status', { campaignId: activeCampaign }).then(function (response) {
      if (response.campaign) render(response.campaign);
    });
  }
  function refresh() {
    if (!currentFolder || mode !== 'finder') return;
    api('list').then(function (response) {
      runs = response.runs || [];
      campaigns = response.campaigns || [];
      setup(); list();
      if (activeCampaign) return refreshStatus();
      if (campaigns.length) {
        activeCampaign = campaigns[0].id;
        list(); return refreshStatus();
      }
      els('active').classList.add('hidden'); els('empty').classList.remove('hidden');
    }).catch(error);
  }
  function send(operation) {
    clearError();
    return api(operation, {campaignId: activeCampaign}).then(function () { refresh(); }).catch(error);
  }
  function start() {
    clearError();
    var jobId = els('run').value;
    if (!jobId) return error(new Error('Select a saved training run.'));
    var settings = {};
    [['aspectRatio','test-generations-aspect'],['megapixels','test-generations-megapixels'],
      ['duration','test-generations-duration'],['dimensions','test-generations-dimensions']].forEach(function (entry) {
      var input = document.getElementById(entry[1]);
      if (input && String(input.value || '').trim()) settings[entry[0]] = input.value;
    });
    var criteria = {jobId: jobId, prompt: els('prompt').value, settings: settings,
      visionModel: window.getCaptionVisionModelId(), rounds: Number(els('rounds').value),
      cases: Number(els('cases').value), keepPercent: Number(els('retention').value),
      roundPlans: getRoundPlans(), concept: els("concept").value.trim(), dimensions: recordDimensions(),
      epochs: chosenEpochs()};
    els('start').disabled = true;
    api('start', criteria).then(function (response) {
      activeCampaign = response.campaign.id; inspectedEpoch = null; lastFrameKey = ''; refresh();
    }).catch(error).finally(function () { els('start').disabled = false; });
  }
  function applyFolder(folder) {
    inspectedEpoch = null;
    lastFrameKey = null;
    var changed = currentFolder !== folder;
    currentFolder = folder;
    if (changed) { activeCampaign = ''; runs = []; campaigns = []; lastFrameKey = ''; selectedRunId = ''; selectedEpochs = new Set(); }
    if (mode === 'finder') refresh();
  }
  window.epochFinderPrepare = applyFolder;
  els('mode-tests').onclick = function () { showMode('tests'); };
  els('mode-finder').onclick = function () { showMode('finder'); };
  els('refresh').onclick = refresh;
  els('start').onclick = start;
  els('suggest').onclick = propose;
  els('next').onclick = advance;
  els('back').onclick = function () { clearError(); showStep(Math.max(1, wizardStep - 1)); };
  els('epoch-picker').addEventListener('change', function (event) {
    var choice = event.target.closest('[data-epoch-choice]');
    if (!choice) return;
    var epoch = Number(choice.dataset.epochChoice);
    if (choice.checked) selectedEpochs.add(epoch); else selectedEpochs.delete(epoch);
    drawEpochPicker();
    roundPlan();
  });
  els('epoch-picker').addEventListener('click', function (event) {
    var action = event.target.closest('[data-epoch-action]');
    if (!action) return;
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    if (!run) return;
    if (action.dataset.epochAction === 'all') selectedEpochs = new Set(run.epochs);
    if (action.dataset.epochAction === 'none') selectedEpochs.clear();
    if (action.dataset.epochAction === 'range') {
      var minField = els('epoch-picker').querySelector('[data-epoch-min]');
      var maxField = els('epoch-picker').querySelector('[data-epoch-max]');
      var min = minField.value.trim() === '' ? -Infinity : Number(minField.value);
      var max = maxField.value.trim() === '' ? Infinity : Number(maxField.value);
      if (min > max) return error(new Error('Range start must not exceed range end.'));
      selectedEpochs = new Set(run.epochs.filter(function (epoch) { return epoch >= min && epoch <= max; }));
    }
    drawEpochPicker();
    roundPlan();
  });
  els('prompt').addEventListener('change', function () { try { updateDimensions(); } catch (exc) { error(exc); } });
  showStep(1);
  var testDuration = document.getElementById('test-generations-duration');
  if (testDuration) testDuration.addEventListener('input', function () {
    if (mode === 'finder') roundPlan();
  });
  els('rounds').onchange = roundPlan;
  els('cases').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  els('retention').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  els('ranking').onclick = function (event) {
    var row = event.target.closest('[data-inspect-epoch]');
    if (!row) return;
    inspectedEpoch = Number(row.dataset.inspectEpoch);
    lastFrameKey = null;
    refreshStatus().catch(error);
  };
  function copyInspectedEpoch() {
    if (copyingEpoch || !currentCampaign || inspectedEpoch == null) return;
    var campaign = currentCampaign;
    var epoch = inspectedEpoch;
    if (!campaign.rounds[0].epochs.includes(epoch)) throw new Error('Epoch is not part of this campaign.');
    copyingEpoch = true;
    clearError();
    lastFrameKey = null;
    gallery(campaign);
    fetch('/fs/training_candidates/copy_to_test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({folder: currentFolder, jobId: campaign.jobId, epoch: epoch})
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Copy to Test failed.');
        return payload;
      });
    }).then(function () {
      if (activeCampaign !== campaign.id) return;
      // Reopen the ordinary Test surface to refresh its staged-candidate inventory.
      showMode('tests');
      if (typeof window.openTestBenchForCurrentFolder !== 'function') {
        throw new Error('Test Generations navigation is unavailable.');
      }
      window.openTestBenchForCurrentFolder();
    }).catch(error).finally(function () {
      copyingEpoch = false;
      lastFrameKey = null;
      if (currentCampaign) gallery(currentCampaign);
    });
  }
  els('frames').onclick = function (event) {
    if (event.target.closest('[data-copy-to-test]')) { copyInspectedEpoch(); return; }
    if (!event.target.closest('[data-inspect-reset]')) return;
    inspectedEpoch = null;
    lastFrameKey = null;
    refreshStatus().catch(error);
  };
  els('pause').onclick = function () { send('pause'); };
  els('resume').onclick = function () { send('resume'); };
  els('stop').onclick = function () { send('stop'); };
  els('delete').onclick = function () {
    if (window.confirm('Delete this campaign, its frames, and its scoring history?')) {
      clearError();
      api('delete', { campaignId: activeCampaign }).then(function () {
        activeCampaign = ''; inspectedEpoch = null; lastFrameKey = ''; refresh();
      }).catch(error);
    }
  };
  els('campaigns').onclick = function (event) {
    var button = event.target.closest('[data-id]');
    if (button) { activeCampaign = button.dataset.id; inspectedEpoch = null; lastFrameKey = ''; list(); refreshStatus().catch(error); }
  };
  timer = setInterval(function () {
    if (mode === 'finder' && activeCampaign && !els('screen').classList.contains('hidden')) refreshStatus().catch(error);
  }, 2500);
})();