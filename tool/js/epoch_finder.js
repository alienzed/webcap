(function () {
  'use strict';
  var currentFolder = '';
  var activeCampaign = '';
  var campaigns = [];
  var runs = [];
  var timer = null;
  var mode = 'tests';
  var lastFrameKey = '';
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
  function roundPlan() {
    var host = els('round-plan');
    var count = Number(els('rounds').value);
    if (!Number.isInteger(count) || count < 1 || count > 4) return;
    var run = runs.find(function (item) { return item.jobId === els('run').value; });
    var baseCount = run ? run.epochs.length : 0;
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
      var remaining = baseCount, renders = 0;
      Array.from(host.querySelectorAll('[data-epoch-round]')).forEach(function (row, index) {
        var tests = Number(row.querySelector('[data-case]').value);
        var keepPct = Number(row.querySelector('[data-keep]').value);
        var projection = row.querySelector('span');
        projection.textContent = 'R' + (index + 1) + ' · ~' + remaining + ' epochs';
        if (tests > 0) renders += remaining * tests;
        remaining = Math.max(1, Math.ceil(remaining * keepPct / 100));
      });
      els('estimate').textContent = renders + ' projected renders · ~' + Math.ceil(renders * 60 / 60) +
        ' min at 60s/render, excluding VL and queue time. Ties may increase the workload.';
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
        var matches = comparison.filter(function (g) { return g.result === 'match'; }).length;
        var mismatches = comparison.filter(function (g) { return g.result === 'mismatch'; }).length;
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
      return '<div class="epoch-finder-ranking-row"><span class="rank">#' + (index + 1) +
        '</span><span class="epoch">Epoch ' + entry.epoch + (entry.active === false ? ' · sidelined' : '') +
        '</span><span class="epoch-finder-score-track"><i style="width:' +
        Math.round((entry.score || 0) * 100) + '%"></i></span><span class="percent">' +
        (entry.score == null ? '—' : Math.round(entry.score * 100) + '%') + '</span></div>';
    }).join('') : '<p class="epoch-finder-muted">Waiting for VL judgments.</p>';
  }
  function gallery(campaign) {
    var units = campaign.units.filter(function (u) { return !!u.frame; });
    var key = units.map(function (u) { return u.frame + ':' + (u.assessment ? '1' : '0'); }).join('|');
    if (lastFrameKey === key) return;
    lastFrameKey = key;
    els('frames').innerHTML = units.slice(-40).reverse().map(function (unit) {
      var src = '/fs/epoch_finder/frame?folder=' + encodeURIComponent(currentFolder) +
        '&campaign=' + encodeURIComponent(campaign.id) + '&frame=' + encodeURIComponent(unit.frame);
      return '<figure class="epoch-finder-frame"><img loading="lazy" src="' + escape(src) +
        '" alt="Epoch ' + unit.epoch + ' test frame"><figcaption>Epoch ' + unit.epoch +
        ' · Test ' + (unit.case + 1) + '<small>' + (unit.assessment ? 'VL evaluated' : 'Frame ready') +
        '</small></figcaption></figure>';
    }).join('');
  }
  function render(campaign) {
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
      roundPlans: getRoundPlans()};
    els('start').disabled = true;
    api('start', criteria).then(function (response) {
      activeCampaign = response.campaign.id; lastFrameKey = ''; refresh();
    }).catch(error).finally(function () { els('start').disabled = false; });
  }
  function applyFolder(folder) {
    var changed = currentFolder !== folder;
    currentFolder = folder;
    if (changed) { activeCampaign = ''; runs = []; campaigns = []; lastFrameKey = ''; }
    if (mode === 'finder') refresh();
  }
  window.epochFinderPrepare = applyFolder;
  els('mode-tests').onclick = function () { showMode('tests'); };
  els('mode-finder').onclick = function () { showMode('finder'); };
  els('refresh').onclick = refresh;
  els('start').onclick = start;
  els('rounds').onchange = roundPlan;
  els('cases').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  els('retention').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  els('pause').onclick = function () { send('pause'); };
  els('resume').onclick = function () { send('resume'); };
  els('stop').onclick = function () { send('stop'); };
  els('delete').onclick = function () {
    if (window.confirm('Delete this campaign, its frames, and its scoring history?')) {
      clearError();
      api('delete', { campaignId: activeCampaign }).then(function () {
        activeCampaign = ''; lastFrameKey = ''; refresh();
      }).catch(error);
    }
  };
  els('campaigns').onclick = function (event) {
    var button = event.target.closest('[data-id]');
    if (button) { activeCampaign = button.dataset.id; lastFrameKey = ''; list(); refreshStatus().catch(error); }
  };
  timer = setInterval(function () {
    if (mode === 'finder' && activeCampaign && !els('screen').classList.contains('hidden')) refreshStatus().catch(error);
  }, 2500);
})();