(function () {
  'use strict';

  var roles = ['visual', 'continuity', 'sequence'];
  var labels = {
    visual: 'Visual Director',
    continuity: 'Continuity & State Analyst',
    sequence: 'Sequence Director',
    editor: 'Creative Editor'
  };
  var descriptions = {
    visual: 'Focal subject, action visibility and framing.',
    continuity: 'State progression, regressions and physical relationships.',
    sequence: 'Cut selection, purpose, coverage and pacing.'
  };
  var state = {
    open: false, busy: false, storyId: '', sceneId: '', modelId: '',
    snapshot: null, sourcePrompt: '', sourceFingerprint: '',
    reviews: {}, reviewErrors: {}, synthesis: null, decisions: {},
    revisions: null, conversations: {visual: [], continuity: [], sequence: [], editor: []},
    sessions: {}
  };

  function el(id) { return document.getElementById(id); }
  function api(url, payload) {
    return fetch(url, payload ? {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    } : {}).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok)
          throw new Error((body && body.error) || 'Prompt Assist request failed.');
        return body;
      });
    });
  }
  function setStatus(message) { el('prompt-assist-status').textContent = message || ''; }
  function setBusy(value, message) {
    state.busy = value === true;
    ['prompt-assist-run', 'prompt-assist-synthesize', 'prompt-assist-accept-all',
      'prompt-assist-reject-all', 'prompt-assist-prepare-revision',
      'prompt-assist-apply', 'prompt-assist-restore', 'prompt-assist-ask',
      'prompt-assist-scene-prev', 'prompt-assist-scene-next'].forEach(function (id) {
      var node = el(id);
      if (node) node.disabled = state.busy;
    });
    el('prompt-assist-scene-select').disabled = state.busy;
    if (message) setStatus(message);
    if (!state.busy) syncActions();
  }
  function parseStructured(result, label) {
    var raw = String(result && (result.text || result.rawText) || '').trim();
    raw = raw.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '');
    try { return JSON.parse(raw); }
    catch (error) {
      throw new Error(label + ' returned output WebCap could not read as structured JSON. Inspect the raw Director job response.');
    }
  }
  function runJob(job) {
    if (!job || !job.jobId) return Promise.reject(new Error('Prompt Assist did not receive a Director job.'));
    function poll() {
      return api('/fs/director/job?job=' + encodeURIComponent(job.jobId)).then(function (body) {
        var current = body.job;
        if (!current) throw new Error('Director job status is missing.');
        if (['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(String(current.status || '')) !== -1) {
          return api('/fs/director/job?job=' + encodeURIComponent(job.jobId) + '&consume=1').then(function (terminal) {
            if (String(terminal.job.status) !== 'completed')
              throw new Error(terminal.job.error || ('Prompt Assist job ' + terminal.job.status + '.'));
            return terminal.job.result || {};
          });
        }
        return new Promise(function (resolve) {
          window.setTimeout(resolve, current.status === 'queued' ? 2200 : 1200);
        }).then(poll);
      });
    }
    return poll();
  }
  function request(operation, extra) {
    return api('/fs/storyboard/prompt-assist', Object.assign({
      storyId: state.storyId,
      sceneId: state.sceneId,
      scope: 'scene',
      model: state.modelId,
      operation: operation,
      expectedUpdatedAt: state.snapshot.story.updatedAt
    }, extra || {})).then(function (body) {
      if (body.sourceFingerprint) state.sourceFingerprint = body.sourceFingerprint;
      return runJob(body.job);
    });
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return {'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch];
    });
  }
  function currentScene() {
    return state.snapshot && state.snapshot.story && state.snapshot.story.scenes
      ? state.snapshot.story.scenes[state.sceneId] || {} : {};
  }
  function sceneTitle(id) {
    var scene = state.snapshot && state.snapshot.story && state.snapshot.story.scenes
      ? state.snapshot.story.scenes[id] : null;
    return scene && scene.title || id || 'Scene';
  }
  function parsePrompt(prompt) {
    var headings = /^(Subject|Scene Overview|Environment \/ Continuity Anchors|Style \/ Visual Treatment|integrated_multimodal_description|overall_soundscape|non_diegetic_music):\s*$/gim;
    var matches = Array.from(String(prompt || '').matchAll(headings));
    var sections = {};
    matches.forEach(function (match, index) {
      var end = index + 1 < matches.length ? matches[index + 1].index : prompt.length;
      var lineEnd = prompt.indexOf('\n', match.index + match[0].length);
      sections[match[1].toLowerCase()] = prompt.slice(lineEnd < 0 ? match.index + match[0].length : lineEnd + 1, end).trim();
    });
    var timed = sections.integrated_multimodal_description || '';
    var shotMatches = Array.from(timed.matchAll(/^\s*\[Shot\s+(\d+)\][^\n]*/gim));
    var shots = [];
    if (shotMatches.length) {
      shotMatches.forEach(function (match, index) {
        var end = index + 1 < shotMatches.length ? shotMatches[index + 1].index : timed.length;
        shots.push({number: Number(match[1]), text: timed.slice(match.index, end).trim()});
      });
    } else if (timed) {
      shots.push({number: 1, text: timed});
    } else {
      shots.push({number: 1, text: String(prompt || '')});
    }
    return {sections: sections, shots: shots};
  }
  function saveSession() {
    if (!state.sceneId || !state.sourcePrompt || !state.snapshot) return;
    state.sessions[state.sceneId] = {
      sourcePrompt: state.sourcePrompt,
      updatedAt: String(state.snapshot.story.updatedAt || ''),
      sourceFingerprint: state.sourceFingerprint,
      reviews: state.reviews,
      reviewErrors: state.reviewErrors,
      synthesis: state.synthesis,
      decisions: state.decisions,
      revisions: state.revisions,
      conversations: state.conversations
    };
  }
  function resetSession() {
    state.sourceFingerprint = '';
    state.reviews = {};
    state.reviewErrors = {};
    state.synthesis = null;
    state.decisions = {};
    state.revisions = null;
    state.conversations = {visual: [], continuity: [], sequence: [], editor: []};
  }
  function restoreSession() {
    var saved = state.sessions[state.sceneId];
    if (saved && saved.sourcePrompt === state.sourcePrompt &&
        saved.updatedAt === String(state.snapshot.story.updatedAt || '')) {
      state.sourceFingerprint = saved.sourceFingerprint || '';
      state.reviews = saved.reviews || {};
      state.reviewErrors = saved.reviewErrors || {};
      state.synthesis = saved.synthesis || null;
      state.decisions = saved.decisions || {};
      state.revisions = saved.revisions || null;
      state.conversations = saved.conversations || {visual: [], continuity: [], sequence: [], editor: []};
    } else {
      delete state.sessions[state.sceneId];
      resetSession();
    }
  }
  function populateSceneNavigation() {
    var story = state.snapshot.story;
    var select = el('prompt-assist-scene-select');
    select.innerHTML = '';
    (story.sceneOrder || []).forEach(function (id, index) {
      var scene = story.scenes && story.scenes[id] || {};
      var option = document.createElement('option');
      option.value = id;
      option.textContent = 'Scene ' + (index + 1) + ' · ' + (scene.title || 'Untitled Scene') +
        (scene.prompt && String(scene.prompt).trim() ? '' : ' · No prompt');
      select.appendChild(option);
    });
    select.value = state.sceneId;
    var index = (story.sceneOrder || []).indexOf(state.sceneId);
    el('prompt-assist-scene-position').textContent = 'Scene ' + (index + 1) + ' of ' + story.sceneOrder.length;
    el('prompt-assist-scene-prev').disabled = state.busy || index <= 0;
    el('prompt-assist-scene-next').disabled = state.busy || index < 0 || index >= story.sceneOrder.length - 1;
  }
  function renderProjectContext() {
    var story = state.snapshot.story;
    var host = el('prompt-assist-project-context-content');
    var invariants = Array.isArray(story.invariants) ? story.invariants : [];
    host.innerHTML = '<p><strong>Concept</strong><br>' + esc(story.concept || 'Not specified') + '</p>' +
      '<p><strong>Visual direction</strong><br>' + esc(story.style || 'Not specified') + '</p>' +
      (invariants.length ? '<div><strong>Project invariants</strong><ul>' + invariants.map(function (item) {
        return '<li>' + esc((item.title || item.kind || 'Invariant') + ': ' + (item.text || '')) + '</li>';
      }).join('') + '</ul></div>' : '');
  }
  function renderSceneSource() {
    var scene = currentScene();
    if (!state.sourcePrompt) {
      el('prompt-assist-scene-title').textContent = scene.title || 'Untitled Scene';
      el('prompt-assist-scene-overview').textContent = 'This Scene does not have a saved prompt yet.';
      el('prompt-assist-scene-findings').replaceChildren();
      el('prompt-assist-cuts').innerHTML = '<div class="prompt-assist-empty">Write a prompt for this Scene before running specialist review.</div>';
      return;
    }
    var parsed = parsePrompt(state.sourcePrompt);
    el('prompt-assist-scene-title').textContent = scene.title || 'Untitled Scene';
    el('prompt-assist-scene-overview').textContent =
      parsed.sections['scene overview'] || 'Review the cut descriptions and intended visual result.';
    var sectionRows = [
      ['Subject', parsed.sections.subject],
      ['Environment / continuity', parsed.sections['environment / continuity anchors']],
      ['Visual treatment', parsed.sections['style / visual treatment']],
      ['Soundscape', parsed.sections.overall_soundscape],
      ['Music', parsed.sections.non_diegetic_music]
    ].filter(function (row) { return !!row[1]; });
    var sceneFindings = [];
    roles.forEach(function (role) {
      (state.reviews[role] && state.reviews[role].findings || []).forEach(function (finding) {
        if (Number(finding.shotNumber) === 0) sceneFindings.push({role: role, finding: finding});
      });
    });
    var sceneRecs = (state.synthesis && state.synthesis.recommendations || [])
      .map(function (item, index) { return {item: item, index: index}; })
      .filter(function (row) { return Number(row.item.shotNumber) === 0; });
    var html = '';
    if (sectionRows.length) {
      html += '<div class="prompt-assist-scene-facts">' + sectionRows.map(function (row) {
        return '<div><span>' + esc(row[0]) + '</span><p>' + esc(row[1]) + '</p></div>';
      }).join('') + '</div>';
    }
    if (sceneFindings.length || sceneRecs.length) {
      html += '<section class="prompt-assist-inline-findings"><h4>Scene-level observations</h4>' +
        sceneFindings.map(renderFindingCard).join('') +
        sceneRecs.map(function (row) { return renderRecommendation(row.item, row.index); }).join('') +
        '</section>';
    }
    el('prompt-assist-scene-findings').innerHTML = html;
    el('prompt-assist-cuts').innerHTML = parsed.shots.map(function (shot) {
      var findings = [];
      roles.forEach(function (role) {
        (state.reviews[role] && state.reviews[role].findings || []).forEach(function (finding) {
          if (Number(finding.shotNumber) === shot.number) findings.push({role: role, finding: finding});
        });
      });
      var recs = (state.synthesis && state.synthesis.recommendations || [])
        .map(function (item, index) { return {item: item, index: index}; })
        .filter(function (row) { return Number(row.item.shotNumber) === shot.number; });
      return '<article class="prompt-assist-cut" id="prompt-assist-cut-' + shot.number + '">' +
        '<header><span class="prompt-assist-cut-number">CUT ' + shot.number + '</span><span>' +
        (findings.length + recs.length ? findings.length + ' findings · ' + recs.length + ' suggestions' : 'Source prompt') +
        '</span></header><div class="prompt-assist-cut-source">' + esc(shot.text) + '</div>' +
        (findings.length ? '<div class="prompt-assist-cut-findings"><h4>Specialist observations</h4>' +
          findings.map(renderFindingCard).join('') + '</div>' : '') +
        (recs.length ? '<div class="prompt-assist-cut-suggestions"><h4>Editor suggestions</h4>' +
          recs.map(function (row) { return renderRecommendation(row.item, row.index); }).join('') + '</div>' : '') +
        '</article>';
    }).join('');
    if (!state.reviews.visual && !state.reviews.continuity && !state.reviews.sequence) {
      el('prompt-assist-cuts').insertAdjacentHTML('beforeend',
        '<div class="prompt-assist-empty">Run the specialist review to see findings attached to the relevant cuts.</div>');
    }
  }
  function renderFindingCard(row) {
    var finding = row.finding;
    return '<article class="prompt-assist-finding" data-specialist="' + esc(row.role) + '">' +
      '<div class="prompt-assist-finding-meta"><span>' + esc(labels[row.role]) + '</span><em>' +
      esc(finding.priority || 'useful') + '</em></div><strong>' + esc(finding.issue) + '</strong>' +
      '<p class="prompt-assist-finding-evidence">' + esc(finding.evidence) + '</p>' +
      '<p>' + esc(finding.recommendation) + '</p><div class="prompt-assist-recommendation-actions"><button type="button" data-pa-ask-role="' + esc(row.role) + '" data-pa-ask="' + esc('Explain or reconsider this finding: ' + finding.issue + ' Evidence: ' + finding.evidence) + '">Discuss this</button></div></article>';
  }
  function recommendationKey(item, index) {
    return String(index) + ':' + String(item.sceneId) + ':' + String(item.shotNumber) + ':' + String(item.issue || '');
  }
  function renderRecommendation(item, index) {
    var key = recommendationKey(item, index);
    var decision = state.decisions[key] || 'pending';
    var label = decision === 'accepted' ? 'Accepted' : decision === 'rejected' ? 'Rejected' : 'Needs your decision';
    var actions = decision === 'pending'
      ? '<div class="prompt-assist-recommendation-actions"><button type="button" data-pa-decision="accepted" data-pa-rec="' + index + '"' + (state.busy ? ' disabled' : '') + '>Accept</button><button type="button" data-pa-decision="rejected" data-pa-rec="' + index + '"' + (state.busy ? ' disabled' : '') + '>Reject</button></div>'
      : '<div class="prompt-assist-recommendation-actions"><span>' + label + '</span><button type="button" class="prompt-assist-undo" data-pa-decision="pending" data-pa-rec="' + index + '"' + (state.busy ? ' disabled' : '') + '>Undo</button></div>';
    return '<article class="prompt-assist-recommendation ' + decision + '">' +
      '<div class="prompt-assist-recommendation-meta"><span>Creative Editor</span><em>' + esc(item.priority || 'useful') + '</em></div>' +
      '<strong>' + esc(item.issue) + '</strong><p>' + esc(item.rationale) + '</p>' +
      '<p class="prompt-assist-recommendation-change">' + esc(item.recommendation) + '</p>' +
      '<small>Sources: ' + esc((item.sources || []).map(sourceLabel).join(' · ')) + '</small>' +
      '<div class="prompt-assist-recommendation-actions"><button type="button" data-pa-ask-role="editor" data-pa-ask="' + esc('Explain the trade-offs behind this recommendation: ' + item.issue + ' Recommendation: ' + item.recommendation) + '">Discuss this</button></div>' +
      actions + '</article>';
  }
  function sourceLabel(id) {
    var parts = String(id || '').split(':');
    if (!labels[parts[0]] || parts.length < 4) return String(id || '');
    return labels[parts[0]] + (Number(parts[2]) > 0 ? ' · Cut ' + parts[2] : ' · Scene');
  }
  function renderTeam() {
    roles.forEach(function (role) {
      var review = state.reviews[role];
      var failed = state.reviewErrors[role];
      var findings = review && Array.isArray(review.findings) ? review.findings.length : 0;
      el('prompt-assist-' + role + '-count').textContent = failed ? 'Failed' : review ? findings + ' findings' : 'Waiting';
      el('prompt-assist-' + role + '-summary').textContent = failed
        ? failed : review ? review.summary || 'No additional observations.' : descriptions[role];
      var card = document.querySelector('[data-pa-specialist="' + role + '"]');
      card.classList.toggle('is-ready', !!review);
      card.classList.toggle('is-failed', !!failed);
    });
    var completed = roles.filter(function (role) { return !!state.reviews[role]; }).length;
    el('prompt-assist-team-status').textContent = completed + ' / 3 reviewed';
    var totalFindings = roles.reduce(function (sum, role) {
      return sum + (state.reviews[role] && state.reviews[role].findings || []).length;
    }, 0);
    el('prompt-assist-scene-progress').textContent = completed === 3
      ? totalFindings + ' observations · ' + (state.synthesis ? 'Editor ready' : 'Ready to consolidate')
      : completed ? completed + ' of 3 specialists complete' : 'Not reviewed';
    el('prompt-assist-editor-count').textContent = state.synthesis
      ? (state.synthesis.recommendations || []).length + ' suggestions' : 'Waiting';
    el('prompt-assist-editor-summary').textContent = state.synthesis
      ? state.synthesis.summary || 'No additional recommendations.' : 'The Editor will consolidate independent findings without hiding disagreements.';
    var disagreements = state.synthesis && state.synthesis.disagreements || [];
    el('prompt-assist-disagreements').innerHTML = disagreements.map(function (item) {
      return '<div class="prompt-assist-disagreement">' + esc(item) + '</div>';
    }).join('');
    syncActions();
  }
  function syncActions() {
    var allReviewed = roles.every(function (role) { return !!state.reviews[role]; });
    var recommendations = state.synthesis && state.synthesis.recommendations || [];
    var accepted = recommendations.filter(function (item, index) {
      return state.decisions[recommendationKey(item, index)] === 'accepted';
    }).length;
    var rejected = recommendations.filter(function (item, index) {
      return state.decisions[recommendationKey(item, index)] === 'rejected';
    }).length;
    el('prompt-assist-run').disabled = state.busy || !state.sourcePrompt;
    el('prompt-assist-synthesize').disabled = state.busy || !allReviewed;
    el('prompt-assist-accept-all').disabled = state.busy || !recommendations.length;
    el('prompt-assist-reject-all').disabled = state.busy || !recommendations.length;
    el('prompt-assist-prepare-revision').disabled = state.busy || !accepted;
    el('prompt-assist-apply').disabled = state.busy || !state.revisions || !el('prompt-assist-revision-prompt').value.trim() || el('prompt-assist-revision-prompt').value === state.sourcePrompt;
    el('prompt-assist-decision-summary').textContent = recommendations.length
      ? accepted + ' accepted · ' + rejected + ' rejected · ' + (recommendations.length - accepted - rejected) + ' pending'
      : 'No recommendations yet.';
    el('prompt-assist-chat-count').textContent = conversationCount() + ' messages';
    populateSceneNavigation();
  }
  function conversationCount() {
    return Object.keys(state.conversations).reduce(function (sum, role) {
      return sum + (state.conversations[role] || []).length;
    }, 0);
  }
  function validateReview(role, data) {
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.findings))
      throw new Error(labels[role] + ' returned an invalid review.');
    data.findings.forEach(function (item, index) {
      if (!item || item.sceneId !== state.sceneId || !Number.isInteger(item.shotNumber) ||
          item.shotNumber < 0 || !shotAllowed(item.shotNumber) ||
          typeof item.issue !== 'string' || typeof item.evidence !== 'string' ||
          typeof item.recommendation !== 'string') {
        throw new Error(labels[role] + ' returned an invalid or out-of-scope finding at position ' + (index + 1) + '.');
      }
    });
    return data;
  }
  function shotAllowed(number) {
    if (number === 0) return true;
    var matches = Array.from(state.sourcePrompt.matchAll(/^\s*\[Shot\s+(\d+)\]/gim))
      .map(function (match) { return Number(match[1]); });
    return matches.length ? matches.indexOf(number) >= 0 : number === 1;
  }
  function validateSynthesis(data) {
    if (!data || typeof data.summary !== 'string' || !Array.isArray(data.recommendations) ||
        !Array.isArray(data.disagreements)) throw new Error('Creative Editor returned an invalid synthesis.');
    var ids = [];
    roles.forEach(function (role) {
      (state.reviews[role].findings || []).forEach(function (item, index) {
        ids.push(role + ':' + item.sceneId + ':' + item.shotNumber + ':' + index);
      });
    });
    data.recommendations.forEach(function (item, index) {
      if (!item || item.sceneId !== state.sceneId || !Number.isInteger(item.shotNumber) ||
          item.shotNumber < 0 || !shotAllowed(item.shotNumber) ||
          typeof item.issue !== 'string' || typeof item.rationale !== 'string' ||
          typeof item.recommendation !== 'string' || !Array.isArray(item.sources) ||
          !item.sources.length || item.sources.some(function (id) { return ids.indexOf(id) < 0; })) {
        throw new Error('Creative Editor returned an invalid or ungrounded recommendation at position ' + (index + 1) + '.');
      }
    });
    return data;
  }
  function renderRevisions() {
    if (!state.revisions) return;
    var prompt = el('prompt-assist-revision-prompt');
    prompt.value = state.revisions.prompt;
    renderRevisionDiff();
    el('prompt-assist-revisions').classList.remove('hidden');
    syncActions();
  }
  function renderRevisionDiff() {
    window.studioDirectorRenderDiff(el('prompt-assist-revision-diff'), state.sourcePrompt,
      el('prompt-assist-revision-prompt').value);
  }
  function renderChat() {
    var role = el('prompt-assist-ask-role').value;
    var history = state.conversations[role] || [];
    var host = el('prompt-assist-chat');
    host.innerHTML = '';
    if (!history.length) {
      var empty = document.createElement('div');
      empty.className = 'prompt-assist-empty';
      empty.textContent = 'Ask why a finding matters, challenge a recommendation, or request another opinion.';
      host.appendChild(empty);
    }
    history.forEach(function (message) {
      var node = document.createElement('div');
      node.className = 'prompt-assist-chat-message ' + message.role;
      node.textContent = message.content;
      host.appendChild(node);
    });
    host.scrollTop = host.scrollHeight;
  }
  function renderAll() {
    renderSceneSource();
    renderTeam();
    renderChat();
    if (state.revisions) renderRevisions();
    else el('prompt-assist-revisions').classList.add('hidden');
  }
  function updateScene(snapshot, preserve) {
    var sceneId = snapshot.sceneId;
    var scene = snapshot.story.scenes && snapshot.story.scenes[sceneId];
    if (!scene) throw new Error('The selected Scene no longer exists in this Project.');
    state.snapshot = snapshot;
    state.storyId = snapshot.storyId;
    state.sceneId = sceneId;
    state.modelId = snapshot.modelId;
    state.sourcePrompt = scene.prompt;
    if (!state.modelId) throw new Error('Choose a Director model before using Prompt Assist.');
    if (preserve) restoreSession();
    else resetSession();
    populateSceneNavigation();
    renderProjectContext();
    renderAll();
  }
  function open() {
    if (state.busy) return;
    if (!el('prompt-assist-dialog').open) el('prompt-assist-dialog').showModal();
    setBusy(true, 'Preparing the current Scene…');
    return window.getPromptAssistSnapshot('scene').then(function (snapshot) {
      if (state.sceneId) saveSession();
      updateScene(snapshot, true);
      state.open = true;
      setStatus('Nothing has been changed.');
    }).catch(function (error) {
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist', error);
    }).finally(function () { setBusy(false); });
  }
  function switchScene(sceneId) {
    if (state.busy || sceneId === state.sceneId) return;
    saveSession();
    setBusy(true, 'Opening ' + sceneTitle(sceneId) + '…');
    return window.getPromptAssistSnapshot('scene').then(function () {
      return window.setPromptAssistScene(sceneId);
    }).then(function () {
      return window.getPromptAssistSnapshot('scene');
    }).then(function (snapshot) {
      updateScene(snapshot, true);
      setStatus('Reviewing ' + sceneTitle(sceneId) + '.');
    }).catch(function (error) {
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist Scene navigation', error);
    }).finally(function () { setBusy(false); });
  }
  function runReviews() {
    if (state.busy || !state.sourcePrompt) return;
    setBusy(true, 'Running three independent specialist reviews…');
    resetSession();
    renderAll();
    return Promise.all(roles.map(function (role) {
      return request('review', {role: role}).then(function (result) {
        state.reviews[role] = validateReview(role, parseStructured(result, labels[role]));
      }).catch(function (error) {
        state.reviewErrors[role] = String(error && error.message || error);
        if (window.reportConsoleError) window.reportConsoleError('Prompt Assist · ' + labels[role], error);
      }).then(function () {
        renderSceneSource();
        renderTeam();
      });
    })).then(function () {
      saveSession();
      var failed = roles.filter(function (role) { return !!state.reviewErrors[role]; });
      if (failed.length) setStatus(failed.length + ' specialist review(s) failed. Successful findings remain available; run review again to retry.');
      else setStatus('All three specialist reviews are complete.');
    }).finally(function () { setBusy(false); renderAll(); saveSession(); });
  }
  function synthesize() {
    if (state.busy || !roles.every(function (role) { return !!state.reviews[role]; })) return;
    setBusy(true, 'Creative Editor is consolidating the findings…');
    var reviews = roles.map(function (role) {
      return {role: role, summary: state.reviews[role].summary,
        findings: (state.reviews[role].findings || []).map(function (item, index) {
          return Object.assign({findingId: role + ':' + item.sceneId + ':' + item.shotNumber + ':' + index}, item);
        })};
    });
    return request('synthesize', {reviews: reviews}).then(function (result) {
      state.synthesis = validateSynthesis(parseStructured(result, 'Creative Editor'));
      state.decisions = {};
      renderAll();
      setStatus('Recommendations are ready. Accept or reject them individually.');
    }).catch(function (error) {
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist synthesis', error);
    }).finally(function () { setBusy(false); saveSession(); renderAll(); });
  }
  function setDecision(index, decision) {
    var item = state.synthesis && state.synthesis.recommendations[index];
    if (!item) return;
    state.decisions[recommendationKey(item, index)] = decision;
    state.revisions = null;
    el('prompt-assist-revisions').classList.add('hidden');
    renderSceneSource();
    renderTeam();
    saveSession();
  }
  function setAllDecisions(decision) {
    (state.synthesis && state.synthesis.recommendations || []).forEach(function (item, index) {
      state.decisions[recommendationKey(item, index)] = decision;
    });
    state.revisions = null;
    el('prompt-assist-revisions').classList.add('hidden');
    renderSceneSource();
    renderTeam();
    saveSession();
  }
  function selectedRecommendations() {
    return (state.synthesis && state.synthesis.recommendations || []).filter(function (item, index) {
      return state.decisions[recommendationKey(item, index)] === 'accepted';
    });
  }
  function prepareRevision() {
    var accepted = selectedRecommendations();
    if (!accepted.length || state.busy) return;
    setBusy(true, 'Creative Editor is preparing a revised Scene prompt…');
    return request('revise', {accepted: accepted}).then(function (result) {
      var data = parseStructured(result, 'Creative Editor revision');
      if (!Array.isArray(data.revisions) || data.revisions.length !== 1 ||
          data.revisions[0].sceneId !== state.sceneId || typeof data.revisions[0].prompt !== 'string' ||
          !data.revisions[0].prompt.trim()) {
        throw new Error('Creative Editor did not return one complete revised prompt for the current Scene.');
      }
      state.revisions = {prompt: data.revisions[0].prompt};
      renderRevisions();
      setStatus('Review the proposed prompt and diff. Nothing has been saved.');
      saveSession();
    }).catch(function (error) {
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist revision', error);
    }).finally(function () { setBusy(false); });
  }
  function applyRevision() {
    if (!state.revisions || state.busy) return;
    var proposed = el('prompt-assist-revision-prompt').value;
    if (!proposed.trim()) { setStatus('The revised prompt cannot be empty.'); return; }
    setBusy(true, 'Applying the reviewed prompt to this Scene…');
    return window.applyPromptAssistRevisions(state.storyId, [{
      sceneId: state.sceneId, expectedPrompt: state.sourcePrompt, prompt: proposed
    }], 'scene', state.sceneId, state.sourceFingerprint).then(function () {
      return window.getPromptAssistSnapshot('scene');
    }).then(function (snapshot) {
      updateScene(snapshot, false);
      delete state.sessions[state.sceneId];
      setStatus('Scene prompt applied. Previous prompt is available through Restore Previous Prompt.');
    }).catch(function (error) {
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist Apply', error);
    }).finally(function () { setBusy(false); });
  }
  function ask() {
    var question = el('prompt-assist-question').value.trim();
    if (!question || state.busy) return;
    var role = el('prompt-assist-ask-role').value;
    var history = state.conversations[role];
    history.push({role: 'user', content: question});
    renderChat();
    el('prompt-assist-question').value = '';
    setBusy(true, 'Asking ' + labels[role] + '…');
    var findings = role === 'editor'
      ? {synthesis: state.synthesis || {}, independentReviews: roles.map(function (name) {
          return {role: name, summary: (state.reviews[name] || {}).summary || '',
            findings: (state.reviews[name] || {}).findings || []};
        })}
      : state.reviews[role] || {};
    return request('followup', {
      role: role, findings: findings, conversation: history.slice(0, -1), question: question
    }).then(function (result) {
      history.push({role: 'assistant', content: String(result.text || '').trim() || 'No text response returned.'});
      renderChat();
      saveSession();
      setStatus(labels[role] + ' responded.');
    }).catch(function (error) {
      history.pop();
      renderChat();
      setStatus(error.message || String(error));
      if (window.reportConsoleError) window.reportConsoleError('Prompt Assist discussion', error);
    }).finally(function () { setBusy(false); });
  }
  function handleContextAsk(event) {
    var button = event.target.closest('[data-pa-ask-role]');
    if (!button) return;
    var role = button.dataset.paAskRole;
    if (!labels[role]) return;
    el('prompt-assist-ask-role').value = role;
    renderChat();
    el('prompt-assist-question').value = button.dataset.paAsk || '';
    el('prompt-assist-discussion').open = true;
    el('prompt-assist-question').focus();
  }
  function close() {
    if (state.busy) return;
    saveSession();
    el('prompt-assist-dialog').close();
    state.open = false;
  }

  el('storyboard-prompt-assist-btn').addEventListener('click', open);
  el('prompt-assist-close').addEventListener('click', close);
  el('prompt-assist-done').addEventListener('click', close);
  el('prompt-assist-run').addEventListener('click', runReviews);
  el('prompt-assist-synthesize').addEventListener('click', synthesize);
  el('prompt-assist-accept-all').addEventListener('click', function () { setAllDecisions('accepted'); });
  el('prompt-assist-reject-all').addEventListener('click', function () { setAllDecisions('rejected'); });
  el('prompt-assist-prepare-revision').addEventListener('click', prepareRevision);
  el('prompt-assist-apply').addEventListener('click', applyRevision);
  el('prompt-assist-restore').addEventListener('click', function () {
    if (!state.revisions) return;
    el('prompt-assist-revision-prompt').value = state.sourcePrompt;
    renderRevisionDiff();
    syncActions();
  });
  el('prompt-assist-revision-prompt').addEventListener('input', function () { renderRevisionDiff(); syncActions(); });
  el('prompt-assist-scene-select').addEventListener('change', function () { switchScene(this.value); });
  el('prompt-assist-scene-prev').addEventListener('click', function () {
    var order = state.snapshot.story.sceneOrder, index = order.indexOf(state.sceneId);
    if (index > 0) switchScene(order[index - 1]);
  });
  el('prompt-assist-scene-next').addEventListener('click', function () {
    var order = state.snapshot.story.sceneOrder, index = order.indexOf(state.sceneId);
    if (index >= 0 && index < order.length - 1) switchScene(order[index + 1]);
  });
  el('prompt-assist-ask').addEventListener('click', ask);
  el('prompt-assist-ask-role').addEventListener('change', renderChat);
  el('prompt-assist-question').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); }
  });
  el('prompt-assist-cuts').addEventListener('click', function (event) {
    handleContextAsk(event);
    var button = event.target.closest('[data-pa-rec][data-pa-decision]');
    if (button) setDecision(Number(button.dataset.paRec), button.dataset.paDecision);
  });
  el('prompt-assist-scene-findings').addEventListener('click', function (event) {
    handleContextAsk(event);
    var button = event.target.closest('[data-pa-rec][data-pa-decision]');
    if (button) setDecision(Number(button.dataset.paRec), button.dataset.paDecision);
  });
  el('prompt-assist-dialog').addEventListener('cancel', function (event) {
    if (state.busy) event.preventDefault();
    else close();
  });
})();