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
    };
    select.onchange();
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
    // Live current-round preliminary scores, until the round ranking is saved.
    var round = campaign.round;
    var plan = campaign.rounds.find(function (r) { return r.number === round; });
    if (campaign.phase !== 'Complete' && campaign.phase !== 'Ranking' && plan) {
      var live = plan.epochs.map(function (epoch) {
        var comparison = campaign.units.filter(function (u) {
          return u.round === round && u.epoch === epoch && u.assessment;
        }).flatMap(function (unit) { return unit.assessment.comparison || []; });
        var matches = comparison.filter(function (g) { return g.result === 'match'; }).length;
        var mismatches = comparison.filter(function (g) { return g.result === 'mismatch'; }).length;
        return {epoch: epoch, matches: matches, mismatches: mismatches,
          count: matches + mismatches, score: matches + mismatches ? matches / (matches + mismatches) : null};
      }).filter(function (r) { return r.count; });
      if (live.length) ranking = live.sort(function (a,b) { return b.score - a.score || b.count - a.count; });
    }
    els('ranking-note').textContent = ranking.length ? 'Sorted by concept fidelity · unobservable attributes excluded' :
      'Results appear as VL evaluates frames.';
    els('ranking').innerHTML = ranking.length ? ranking.map(function (entry, index) {
      return '<div class="epoch-finder-ranking-row"><span class="rank">#' + (index + 1) +
        '</span><span class="epoch">Epoch ' + entry.epoch + '</span><span class="epoch-finder-score-track"><i style="width:' +
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
      cases: Number(els('cases').value), keepPercent: Number(els('retention').value)};
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
  els('pause').onclick = function () { send('pause'); };
  els('resume').onclick = function () { send('resume'); };
  els('stop').onclick = function () { send('stop'); };
  els('delete').onclick = function () {
    if (window.confirm('Delete this campaign, its frames, and its scoring history?')) {
      send('delete').then(function () { activeCampaign = ''; lastFrameKey = ''; refresh(); });
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