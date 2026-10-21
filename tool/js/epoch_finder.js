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
  var crossEvidence = null;
  var crossEvidenceKey = '';
  var crossEvidenceVersion = 0;
  var inspectedFrame = 0;
  var campaignState = null;
  var referenceSelections = {};
  var referenceGeneration = 0;
  var listRequestVersion = 0;
  var selectedEpochs = new Set();
  var selectedRunId = "";
  var runEpochSelections = {};
  var proposalBusy = false;
  var followUpSource = '';
  var timingProfiles = {};
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
    var references = next === 'references';
    var analytics = next === 'analytics';
    document.querySelectorAll('#test-workspace-main-tabs [data-test-workspace-mode]').forEach(function (button) {
      var active = button.dataset.testWorkspaceMode === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    els('screen').classList.toggle('hidden', !finder);
    document.getElementById('test-generations-body').classList.toggle('hidden', finder || references || analytics);
    document.getElementById('test-references-screen').classList.toggle('hidden', !references);
    document.getElementById('run-analytics-screen').classList.toggle('hidden', !analytics);
    if (finder) refresh();
    if (references) window.testReferencesOpen();
    if (analytics) window.runAnalyticsOpen();
  }
  window.epochFinderShowMode = showMode;
  document.getElementById('epoch-finder-back-to-tests').onclick = function () { showMode('tests'); };
  function renderSecondsEstimate(modelId, durationSeconds, megapixels) {
    var key = [modelId, Number.isFinite(megapixels) ? String(megapixels) : String(document.getElementById('test-generations-dimensions')?.value || ''), String(durationSeconds)].join('|');
    var samples = timingProfiles[key] && timingProfiles[key].seconds;
    if (Array.isArray(samples) && samples.length) {
      var ordered = samples.slice().sort(function (a,b) { return a-b; });
      return { seconds: ordered[Math.floor(ordered.length/2)], seeded: true, observed: true };
    }
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
  function suggestedRole(label, options) {
    var text = String(label || '').toLowerCase();
    if (/background|setting|lighting|surface|camera|viewpoint|environment|scenery|location/.test(text)) return 'vary';
    if (/hair|skin|eye|face|expression|pose|position|body|clothing|age|ethnicity/.test(text)) return 'leakage';
    return 'primary';
  }
  function updateDimensions() {
    var groups = wildcardParts(els('prompt').value);
    dimensions = groups.map(function (g, index) {
      var prev = dimensions[index] || {};
      var oldValues = (prev.options || []).join('|');
      var unchanged = oldValues === g.options.join('|');
      return {label: String(prev.label || ('Attribute ' + (index + 1))),
        options: g.options.slice(),
        annotationGroup: unchanged ? (prev.annotationGroup || '') : '',
        role: oldValues && !unchanged ? suggestedRole(prev.annotationGroup || prev.label, g.options) :
          (prev.role || suggestedRole(prev.annotationGroup || prev.label, g.options)), nested: g.nested};
    });
    renderDimensions();
  }
  function renderDimensions() {
    els('attributes').innerHTML = dimensions.map(function (group, index) {
      return '<div class="epoch-finder-attribute" data-index="' + index + '">' +
        '<label>Attribute <input data-attr-name value="' + escape(group.label) + '"></label>' +
        (group.annotationGroup ? '<small class="epoch-finder-muted">Set group: ' + escape(group.annotationGroup) + '</small>' : '') +
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
      var original = dimensions[index] || {};
      // Option edits do not change which Set component this dimension describes.
      var annotationGroup = original.annotationGroup || '';
      return {label: label, role: row.querySelector('[data-attr-role]').value,
        options: values, annotationGroup: annotationGroup};
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
        jobId: els('run').value, vocabulary: window.getTestGenerationPlanningVocabulary()})
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
        return {label: g.label, options: g.options, annotationGroup: g.annotationGroup || '',
          role: g.role || suggestedRole(g.annotationGroup || g.label, g.options)};
      });
      renderDimensions();
      els('proposal-status').textContent = 'Proposed tests ready. Edit values and scoring roles freely.';
    }).catch(error).finally(function () {
      proposalBusy = false;
      els('suggest').disabled = false;
    });
  }
  function selectedRunEntries() {
    return runs.filter(function (run) { return runEpochSelections[run.jobId] instanceof Set; }).map(function (run) {
      return {jobId:run.jobId, epochs:run.epochs.filter(function (epoch) { return runEpochSelections[run.jobId].has(epoch); })};
    });
  }
  function chosenEpochs() {
    return selectedRunEntries().flatMap(function (entry) { return entry.epochs; });
  }
  function candidateLabel(campaign, candidate) {
    var source = (campaign.candidateMap || {})[String(candidate)];
    if (!source) return 'Epoch ' + candidate;
    var run = String(source.runName || (source.runSequence ? 'Run ' + source.runSequence : source.jobId));
    return run + ' · Epoch ' + source.epoch;
  }
  function runIdentity(run) {
    var sequence = String(run.runSequence || '').trim().replace(/^0+(?=\d)/, '');
    var name = String(run.runName || '').trim();
    var identity = sequence ? 'Run ' + sequence : 'Run ' + String(run.jobId).slice(-8);
    if (name && name !== identity) identity += ' · ' + name;
    return identity;
  }
  function runDetails(run) {
    var summary = run.runSummary || {};
    var saved = Array.isArray(run.epochs) && run.epochs.length ? Math.max.apply(null, run.epochs) : 0;
    var current = Number(run.currentEpoch) || 0;
    var planned = Number(run.plannedEpochs || summary.epochs) || 0;
    var observed = Math.max(saved, current);
    var parts = [String(run.stage || run.modelId || '').toUpperCase(), run.epochs.length + ' checkpoints'];
    if (observed > 0) parts.push('E' + observed + (planned > 0 ? '/' + planned : ''));
    if (summary.lr != null && Number.isFinite(Number(summary.lr))) parts.push('LR ' + Number(summary.lr).toExponential(1).replace('.0e', 'e').replace('e+', 'e'));
    if (Number(summary.rank) > 0) parts.push('Rank ' + Number(summary.rank));
    return parts.filter(Boolean).join(' · ');
  }
  function drawRuns() {
    var model = String(window.getWorkingModelProfileId() || '');
    var options = runs.filter(function (run) { return run.modelId === model; });
    els('run-choices').innerHTML = options.length ? options.map(function (run) {
      var chosen = runEpochSelections[run.jobId] instanceof Set;
      var label = [run.setName, runIdentity(run)].filter(Boolean).join(' · ');
      return '<label class="epoch-finder-run-choice"><input type="checkbox" data-run-id="' + escape(run.jobId) +
        '"' + (chosen ? ' checked' : '') + '><span><strong>' + escape(label) + '</strong>' +
        '<small>' + escape(runDetails(run)) + '</small></span></label>';
    }).join('') : '<p class="epoch-finder-muted">No available saved checkpoints for this model.</p>';
    var selected = selectedRunEntries();
    els('run').value = selected.length ? selected[0].jobId : '';
    els('run-detail').textContent = selected.length + ' runs · ' + chosenEpochs().length + ' checkpoints selected';
  }
  function drawEpochPicker() {
    drawRuns();
    var host = els('epoch-picker'), selected = selectedRunEntries();
    host.classList.toggle('hidden', !selected.length);
    host.innerHTML = selected.map(function (choice) {
      var run = runs.find(function (item) { return item.jobId === choice.jobId; });
      return '<section class="epoch-finder-run-epochs" data-epoch-run="' + escape(run.jobId) + '">' +
        '<strong>' + escape(runIdentity(run)) + ' · ' + choice.epochs.length + '/' + run.epochs.length + ' selected</strong>' +
        '<div class="epoch-finder-epoch-timeline">' + run.epochs.map(function (epoch) {
          return '<button type="button" class="epoch-finder-epoch-tick' + (runEpochSelections[run.jobId].has(epoch) ? ' is-selected' : '') +
            '" data-epoch-choice="' + epoch + '" aria-pressed="' + runEpochSelections[run.jobId].has(epoch) + '"> ' + epoch + '</button>';
        }).join('') + '</div><div class="epoch-finder-epoch-tools">' +
        '<button type="button" data-epoch-action="all">All</button><button type="button" data-epoch-action="every5">Every 5</button>' +
        '<button type="button" data-epoch-action="last10">Last 10</button><button type="button" data-epoch-action="none">Clear</button>' +
        '</div></section>';
    }).join('');
  }

  function reviewWizard() {
    var parts = recordDimensions();
    var selections = selectedRunEntries();
    if (!selections.length || selections.some(function (entry) { return !entry.epochs.length; })) throw new Error('Select checkpoints from each chosen run.');
    var roundSummary = getRoundPlans().map(function (round, index) {
      return 'R' + (index + 1) + ': ' + round.cases + ' tests/epoch · keep ' +
        round.keepPercent + '%' + (round.megapixels ? ' · ' + round.megapixels + ' MP' : '') +
        (round.dimensions ? ' · ' + round.dimensions : '');
    });
    els('review').innerHTML = '<p><strong>' + selections.length + ' training runs</strong> · ' +
      chosenEpochs().length + ' saved checkpoints selected</p><p>' + escape(els('concept').value.trim() || 'Concept not specified') +
      '</p><p>' + parts.map(function (item) {
        return escape(item.label) + ' (' + escape(item.role) + ': ' + item.options.length + ' values)';
      }).join(' · ') + '</p><p>' + roundSummary.map(escape).join('<br>') +
      '</p><p>VL image ceiling: 0.45 MP (downscale only; evidence retained)</p>' +
      '<p>' + escape(els('estimate').textContent) + '</p>' +
      '<p class="epoch-finder-muted">Only Launch starts inference. Your approved prompt, roles, rounds, model and seeds are frozen for this campaign.</p>';
  }
  var referenceItems = [];
  var referenceIndex = 0;
  var referenceDraftChoices = {};
  var referencePlanSignature = '';
  function prepareReferences() {
    var version = ++referenceGeneration;
    referencePlanSignature = JSON.stringify([selectedRunEntries(), dimensions.map(function (d) { return [d.label,d.role,d.options,d.annotationGroup]; })]);
    referenceItems = dimensions.flatMap(function (d, index) {
      return d.role === 'primary' ? d.options.map(function (option) {
        return {attribute:d.label, dimensionId:'G' + (index + 1),
          option:option, annotationGroup:d.annotationGroup || '',
          key:JSON.stringify([index,option]), candidates:[]};
      }) : [];
    });
    referenceIndex = 0;
    els('start').disabled = true;
    els('reference-options').innerHTML = '<p class="epoch-finder-muted">Finding tagged reference candidates…</p>';
    return api('reference_vocabulary', {}).then(function (response) {
      var vocabulary = response.vocabulary || [];
      referenceItems.forEach(function (item) {
        item.groups = vocabulary.filter(function (group) {
          return (group.terms || []).some(function (term) { return term.term === item.option; });
        }).map(function (group) { return group.group; });
        // The Director's scoped group is a preference, not a restriction on manual choice.
        item.groups.sort(function (a, b) {
          return Number(b === item.annotationGroup) - Number(a === item.annotationGroup);
        });
      });
      return Promise.all(referenceItems.map(function (item) {
        return Promise.all(item.groups.map(function (group) {
          return api('reference_candidates', {group: group, term: item.option}).then(function (response) {
            return (response.references || []).map(function (candidate) {
              return Object.assign({}, candidate, {tag:item.option});
            });
          });
        })).then(function (candidateGroups) {
          item.candidates = candidateGroups.flat();
        });
      }));
    }).then(function () {
      if (version !== referenceGeneration) return;
      referenceDraftChoices = {};
      referenceItems.forEach(function (item) {
        var saved = referenceSelections[item.key];
        var cleared = Object.prototype.hasOwnProperty.call(referenceSelections, item.key) && saved === null;
        if (!saved && !cleared) {
          // Never guess which of two identically named tags a saved choice meant.
          var savedMatches = item.groups.map(function (group) {
            var chosen = window.testReferencesChoice(group, item.option);
            if (!chosen || !item.candidates.some(function (candidate) {
              return candidate.group === group && candidate.media === chosen.media;
            })) return null;
            return {attribute:item.attribute, dimensionId:item.dimensionId, option:item.option,
              group:group, tag:item.option, media:chosen.media};
          }).filter(Boolean);
          saved = item.annotationGroup
            ? (savedMatches.find(function (entry) {
                return entry.group === item.annotationGroup;
              }) || null)
            : (savedMatches.length === 1 ? savedMatches[0] : null);
        }
        if (item.annotationGroup && saved && saved.group !== item.annotationGroup &&
            !Object.prototype.hasOwnProperty.call(referenceSelections, item.key)) saved = null;
        var selectedIndex = !cleared && item.candidates.length ? item.candidates.findIndex(function (candidate) {
          return saved && candidate.media === saved.media && candidate.group === saved.group && candidate.tag === saved.tag;
        }) : -1;
        if (selectedIndex < 0 && !cleared && item.annotationGroup) {
          selectedIndex = item.candidates.findIndex(function (candidate) {
            return candidate.group === item.annotationGroup;
          });
        }
        if (selectedIndex < 0 && !cleared && !item.annotationGroup &&
            item.groups.length === 1 && item.candidates.length) selectedIndex = 0;
        var candidate = item.candidates[selectedIndex];
        // Ambiguous options remain unselected unless the source group is known.
        referenceSelections[item.key] = candidate ? {
          attribute:item.attribute, dimensionId:item.dimensionId, option:item.option,
          group:candidate.group, tag:candidate.tag, media:candidate.media
        } : null;
        referenceDraftChoices[item.key] = selectedIndex;
      });
      renderReferenceStep();
    }).catch(function (exc) { referencePlanSignature = ''; error(exc); });
  }
  function renderReferenceStep() {
    var host = els('reference-options'), galleryHost = els('reference-workspace');
    var item = referenceItems[referenceIndex];
    if (!item) {
      host.innerHTML = '<p class="epoch-finder-muted">No tagged training images matched these Primary options. Original VL scoring remains available.</p>';
      galleryHost.innerHTML = '<h3>Training references</h3><p class="epoch-finder-muted">No matching images found.</p>';
      els('reference-choices').textContent = '0 reference comparisons';
      els('start').disabled = false;
      return;
    }
    var selected = referenceDraftChoices[item.key] == null ? -1 : referenceDraftChoices[item.key];
    var selectedCandidate = item.candidates[selected];
    var sourceGroup = selectedCandidate ? selectedCandidate.group
      : item.annotationGroup || (item.groups.length === 1 ? item.groups[0] : '');
    var heading = (sourceGroup || (item.groups.length > 1 ? 'Choose Set group' : item.attribute)) +
      ' · ' + item.option;
    host.innerHTML = '<div class="epoch-finder-reference-step"><strong>' + escape(heading) +
      '</strong><span>' + (referenceIndex+1) + ' / ' +
      referenceItems.length + '</span></div><p class="epoch-finder-muted">References are optional; identically named tags in different groups are separate features.</p>' +
      '<div class="epoch-finder-reference-nav"><button type="button" data-reference-nav="prev"' +
      (referenceIndex===0?' disabled':'') + '>← Previous</button><button type="button" data-reference-nav="next">' +
      (referenceIndex===referenceItems.length-1?'Finish':'Next →') + '</button></div>';
    galleryHost.innerHTML = '<h3>' + escape(heading) +
      '</h3><p class="epoch-finder-muted">' + (item.candidates.length ?
        'Click Select to choose, or Preview to inspect a larger image.' :
        'No exact-tag training images available for this option. Reference comparisons will skip it.') + '</p>' +
      '<div class="epoch-finder-reference-gallery">' + item.candidates.map(function (candidate,i) {
        var active = selected === i;
        var media = '/caption/media?folder=' + encodeURIComponent(currentFolder) +
          '&media=' + encodeURIComponent(candidate.media);
        return '<div class="epoch-finder-reference-tile' + (active ? ' selected' : '') + '">' +
          '<img loading="lazy" src="' + media + '" alt="' + escape(candidate.media) + '">' +
          '<span title="' + escape(getRequirementGroupAlias(candidate.group)) + '">' + escape(candidate.group) + '</span>' +
          '<div class="epoch-finder-reference-tile-actions"><button type="button" data-reference-pick="' + i +
          '" aria-pressed="' + !!active + '">' + (active ? '✓ Selected' : 'Select') +
          '</button><button type="button" data-reference-preview="' + i + '">Preview</button></div></div>';
      }).join('') + '</div>';
    updateReferenceStatus();
  }
  function updateReferenceStatus() {
    var chosen = referenceItems.filter(function (item) { return !!referenceSelections[item.key]; }).length;
    els('reference-choices').textContent = chosen + ' / ' + referenceItems.length + ' references selected · others skipped';
    els('start').disabled = false;
  }
  function approvedReferences() {
    return referenceItems.map(function (item) {
      var chosen = referenceSelections[item.key];
      return chosen ? Object.assign({}, chosen, {alias:getRequirementGroupAlias(chosen.group)}) : null;
    }).filter(Boolean);
  }
  function showStep(value) {
    wizardStep = value;
    document.querySelectorAll('[data-epoch-wizard-step]').forEach(function (element) {
      element.classList.toggle('hidden', Number(element.dataset.epochWizardStep) !== value);
    });
    document.querySelectorAll('[data-epoch-step-label]').forEach(function (element) {
      element.classList.toggle('active', Number(element.dataset.epochStepLabel) === value);
    });
    els('reference-workspace').classList.toggle('hidden', value !== 4 || !!activeCampaign);
    els('empty').classList.toggle('hidden', value === 4 || !!activeCampaign);
    els('active').classList.toggle('hidden', value === 4 || !activeCampaign);
    els('back').classList.toggle('hidden', value === 1);
    els('next').classList.toggle('hidden', value === 4);
    els('start').classList.toggle('hidden', value !== 4);
    if (value === 3) roundPlan();
    if (value === 4) { reviewWizard(); if (referencePlanSignature !== JSON.stringify([selectedRunEntries(), dimensions.map(function (d) { return [d.label,d.role,d.options,d.annotationGroup]; })])) prepareReferences(); else renderReferenceStep(); }
  }
  function advance() {
    try {
      if (wizardStep === 1 && !selectedRunEntries().length) {
        throw new Error('Choose a saved training run.');
      }
      if (wizardStep === 1 && selectedRunEntries().some(function (entry) { return !entry.epochs.length; })) {
        throw new Error('Select at least one checkpoint in every checked run, or uncheck that run.');
      }
      if (wizardStep === 2) {
        if (!dimensions.length && els('prompt').value.trim()) updateDimensions();
        recordDimensions();
      }
      showStep(Math.min(4, wizardStep + 1));
    } catch (exc) { error(exc); }
  }
  function kreaRoundDimensions(options, roundIndex, fallback) {
    // Choose only supported presets, near 512 / 640 / 768 short-side pixels.
    var targets = [512, 640, 768, 768];
    var target = targets[Math.min(roundIndex, targets.length - 1)];
    var candidates = options.map(function (value) {
      var match = String(value).match(/(\d+)\s*[xX×]\s*(\d+)/);
      return match ? {value: value, shortSide: Math.min(Number(match[1]), Number(match[2]))} : null;
    }).filter(Boolean);
    if (!candidates.length) return fallback;
    candidates.sort(function (a, b) {
      return Math.abs(a.shortSide - target) - Math.abs(b.shortSide - target);
    });
    return candidates[0].value;
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
        megapixels: Number(row.querySelector('[data-mp]').value),
        dimensions: row.querySelector('[data-dimensions]') ? row.querySelector('[data-dimensions]').value : ''
      };
    });
    var kreaDimensions = window.getTestGenerationDimensionPresets();
    var hasDimensions = !document.getElementById('test-generations-dimensions-field').classList.contains('hidden');
    if (hasDimensions && !kreaDimensions.options.length) throw new Error('Krea resolution presets are unavailable in Test Generations.');
    host.innerHTML = '<strong>Round plan</strong>' + Array.from({ length: count }, function (_, index) {
      var saved = current[index] || {};
      var mp = saved.megapixels || Math.min(0.4, 0.2 + index * 0.1);
      var cases = saved.cases || Number(els('cases').value) || 2;
      var keep = saved.keepPercent || Number(els('retention').value) || 50;
      return '<div class="epoch-finder-round-row" data-epoch-round="' + (index + 1) + '">' +
        '<span>R' + (index + 1) + '</span>' +
        '<label>Tests<input data-case type="number" min="1" max="6" value="' + cases + '"></label>' +
        '<label>Keep %<input data-keep type="number" min="10" max="90" value="' + keep + '"></label>' +
        '<label>MP<input data-mp type="number" min="0.1" max="0.4" step="0.1" value="' + mp.toFixed(1) + '"></label>' +
        (hasDimensions ? '<label>Resolution<select data-dimensions>' + kreaDimensions.options.map(function (value) {
          var selected = saved.dimensions || kreaRoundDimensions(kreaDimensions.options, index, kreaDimensions.selected);
          return '<option value="' + escape(value) + '"' + (value === selected ? ' selected' : '') + '>' + escape(value) + '</option>';
        }).join('') + '</select></label>' : '') + '</div>';
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
        (seededRenders ? ' (observed samples or H3 seeds)' : '') +
        (seededRenders < renders ? ' · unmeasured: 30s/render' : '') +
        '. Observed render measurements exclude queue wait; VL and cutoff ties are extra.';
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
      var dimensionsField = row.querySelector('[data-dimensions]');
      if (dimensionsField) plan.dimensions = dimensionsField.value;
      return plan;
    });
  }
  function setup() {
    var current = String(window.getWorkingModelProfileId() || '');
    var options = runs.filter(function (run) { return run.modelId === current; });
    Object.keys(runEpochSelections).forEach(function (jobId) {
      if (!options.some(function (run) { return run.jobId === jobId; })) delete runEpochSelections[jobId];
    });
    els('run').innerHTML = '<option value="">No run selected</option>' + options.map(function (run) {
      return '<option value="' + escape(run.jobId) + '">' + escape(run.runName || run.jobId) + '</option>';
    }).join('');
    drawEpochPicker();
    roundPlan();
    if (!els('prompt').value) els('prompt').value = String(document.getElementById('test-generations-prompt').value || '');
    els('start').disabled = !options.length;
  }

  function list() {
    els('count').textContent = String(campaigns.length);
    var model = String(window.getWorkingModelProfileId() || '');
    var visible = campaigns.filter(function (c) { return c.modelId === model; });
    els('campaigns').innerHTML = visible.length ? visible.map(function (c) {
      return '<button type="button" class="epoch-finder-campaign ' +
        (c.id === activeCampaign ? 'active' : '') + '" data-id="' + escape(c.id) + '">' +
        '<strong>' + escape(c.name || c.id) + '</strong><small>' + escape(c.modelId || '') + ' · Round ' + escape(c.round) +
        ' · ' + escape(c.phase || c.status) + '</small></button>';
    }).join('') : '<span class="epoch-finder-muted">No campaigns for this model.</span>';
  }
  function progress(campaign) {
    var plan = campaign.rounds.find(function (r) { return r.number === campaign.round; }) || campaign.rounds[campaign.rounds.length - 1];
    var units = campaign.units.filter(function (u) { return u.round === plan.number; });
    var total = plan.epochs.length * plan.seeds.length;
    var frames = units.filter(function (u) { return !!u.frame; }).length;
    var evaluated = units.filter(function (u) { return u.assessment !== null; }).length;
    els('render-count').textContent = frames + ' / ' + total;
    els('vl-count').textContent = evaluated + ' / ' + total;
    ['rvn','dino'].forEach(function (kind) {
      var enabled = (campaign.referenceEvaluation || {})[kind];
      els(kind + '-progress').classList.toggle('hidden', !enabled);
      if (!enabled) return;
      var key = kind === 'rvn' ? 'referenceComplete' : 'dinoComplete';
      var errorKey = kind === 'rvn' ? 'referenceError' : 'dinoError';
      var completed = units.filter(function (u) { return u[key]; }).length;
      var errors = units.filter(function (u) { return u[errorKey]; }).length;
      els(kind + '-count').textContent = completed + ' / ' + total + (errors ? ' · ' + errors + ' failed' : '');
      if (kind === 'rvn') {
        var firstError = units.find(function (unit) { return !!unit.referenceError; });
        els('reference-compare-error').textContent = firstError ?
          'Reference Compare failed at ' + candidateLabel(campaign, firstError.epoch) + ': ' + firstError.referenceError : '';
        els('reference-compare-error').classList.toggle('hidden', !firstError);
      }
    });
    els('field-count').textContent = plan.epochs.length + ' checkpoints';
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
    // The existing campaign retention plan owns recommendations: no second cutoff
    // or unvalidated RVN/DINO score. All boundary ties already survive retention.
    var eligible = ranking.filter(function (entry) { return entry.score != null; });
    // During a running campaign, only epochs surviving an actual completed cut
    // are recommendations. At completion, the final round makes no further cut:
    // use the last retained field. Single-round campaigns have no cut, so show top ties.
    var completed = campaign.status === 'complete';
    var topScore = eligible.length ? Math.max.apply(null, eligible.map(function (row) { return row.score; })) : null;
    var advanced = campaign.rounds.length > 1 && (completed || round > 1);
    var finalField = campaign.rounds[campaign.rounds.length - 1];
    var recommended = new Set(advanced ?
      ((completed ? finalField : plan) || {epochs: []}).epochs :
      completed ? eligible.filter(function (row) { return row.score === topScore; }).map(function (row) { return row.epoch; }) : []);
    var suggested = eligible.filter(function (entry) { return recommended.has(entry.epoch); });
    els('shortlist').textContent = suggested.length ?
      'Recommended for human review: ' + suggested.map(function (entry) {
        return candidateLabel(campaign, entry.epoch);
      }).join(', ') + ' · ' + (completed ? (advanced ? 'final retained field' : 'top-scoring ties') : 'survived previous round, provisional') +
      ' · existing VL retention, not a final winner' :
      'Recommendations appear after a completed cut, or when the campaign finishes.';
    var filter = els('rank-filter').value, sort = els('rank-sort').value;
    ranking = ranking.filter(function (entry) {
      return filter === 'all' || (filter === 'recommended' ? recommended.has(entry.epoch) && entry.score != null :
        filter === 'active' ? entry.active !== false : entry.active === false);
    });
    if (sort === 'epoch') ranking.sort(function (a,b) { return a.epoch-b.epoch; });
    if (sort === 'count') ranking.sort(function (a,b) { return (b.count || 0)-(a.count || 0) || (b.score || 0)-(a.score || 0); });
    els('ranking').innerHTML = ranking.length ? ranking.map(function (entry, index) {
      var observed = (campaign.units || []).filter(function (u) { return u.epoch === entry.epoch && u.assessment; });
      var extra = (campaign.referenceEvaluation || {});
      var evidence = (extra.rvn ? ' · RVN ' + observed.filter(function (u) { return u.referenceComplete; }).length + '/' + observed.length : '') +
        (extra.dino ? ' · DINO ' + observed.filter(function (u) { return u.dinoComplete; }).length + '/' + observed.length : '');
      return '<button type="button" class="epoch-finder-ranking-row" data-inspect-epoch="' + entry.epoch + '" title="Inspect all retained tests for this epoch"><span class="rank">#' + (index + 1) +
        '</span><span class="epoch">' + escape(candidateLabel(campaign, entry.epoch)) + (recommended.has(entry.epoch) && entry.score != null ? ' · recommended' : '') + (entry.active === false ? ' · sidelined' : '') +
        '</span><span class="epoch-finder-score-track"><i style="width:' +
        Math.round((entry.score || 0) * 100) + '%"></i></span><span class="percent">' +
        (entry.score == null ? '—' : Math.round(entry.score * 100) + '%') + '</span><small>' + (entry.count || 0) + ' weighted observations' + escape(evidence) + '</small></button>';
    }).join('') : '<p class="epoch-finder-muted">Waiting for VL judgments.</p>';
  }
  function campaignSummary(campaign) {
    // Read-only: use the same cumulative weighted VL comparisons as the leaderboard.
    var epochs = (campaign.rounds[0] || {epochs: []}).epochs;
    var rows = epochs.map(function (epoch) {
      var units = (campaign.units || []).filter(function (u) { return u.epoch === epoch; });
      var comparisons = units.filter(function (u) { return !!u.assessment; })
        .flatMap(function (u) { return u.assessment.comparison || []; });
      var matches = comparisons.reduce(function (n, g) {
        return n + (g.result === 'match' ? Number(g.weight == null ? 1 : g.weight) : 0);
      }, 0);
      var mismatches = comparisons.reduce(function (n, g) {
        return n + (g.result === 'mismatch' ? Number(g.weight == null ? 1 : g.weight) : 0);
      }, 0);
      return {epoch: epoch, score: matches + mismatches ? matches / (matches + mismatches) : null,
        frames: units.filter(function (u) { return !!u.assessment; }).length};
    }).filter(function (row) { return row.score != null; })
      .sort(function (a, b) { return b.score - a.score || a.epoch - b.epoch; });
    var host = els('summary');
    if (!rows.length) {
      host.innerHTML = '<p class="epoch-finder-muted">Awaiting scoreable VL judgments. No leader yet.</p>';
      return;
    }
    var first = rows[0], second = rows[1];
    var pending = (campaign.units || []).filter(function (u) { return !u.assessment && !u.error; }).length;
    var failed = (campaign.units || []).filter(function (u) { return !!u.error; }).length;
    var observations = (campaign.units || []).filter(function (u) { return !!u.assessment; }).length;
    var note = !second ? 'Only one epoch has scored evidence' :
      Math.abs(first.score - second.score) < 0.0000001 ? 'Tied on weighted VL fidelity' :
      'Lead: ' + ((first.score - second.score) * 100).toFixed(1) + ' percentage points';
    var caveats = [];
    if (campaign.status !== 'complete') caveats.push('Provisional');
    if (second && first.frames !== second.frames) caveats.push('Unequal scored-frame coverage');
    if (pending) caveats.push(pending + ' pending frame(s)');
    if (failed) caveats.push(failed + ' failed frame(s)');
    ['rvn', 'dino'].forEach(function (kind) {
      if (!(campaign.referenceEvaluation || {})[kind]) return;
      var key = kind === 'rvn' ? 'referenceComplete' : 'dinoComplete';
      var errorKey = kind === 'rvn' ? 'referenceError' : 'dinoError';
      var assessed = (campaign.units || []).filter(function (u) { return !!u.assessment; });
      var complete = assessed.filter(function (u) { return !!u[key]; }).length;
      var errors = assessed.filter(function (u) { return !!u[errorKey]; }).length;
      caveats.push((kind === 'rvn' ? 'RVN' : 'DINO') + ' ' + complete + '/' + assessed.length +
        (errors ? ' (' + errors + ' failed)' : '') + ' · separate evidence');
    });
    host.innerHTML = '<div class="epoch-finder-summary-stats">' +
      '<div><small>Leading checkpoint</small><strong>' + escape(candidateLabel(campaign, first.epoch)) + '</strong><span>' +
      Math.round(first.score * 100) + '% · ' + first.frames + ' scored frames</span></div>' +
      '<div><small>Runner-up</small><strong>' + (second ? escape(candidateLabel(campaign, second.epoch)) : '—') +
      '</strong><span>' + (second ? Math.round(second.score * 100) + '% · ' + second.frames + ' scored frames' : 'No other scored epoch') +
      '</span></div></div><p class="epoch-finder-summary-takeaway">' + escape(note) +
      ' · ' + observations + ' VL-evaluated frames</p>' +
      (caveats.length ? '<p class="epoch-finder-muted">' + caveats.map(escape).join(' · ') + '</p>' : '');
  }
  function gallery(campaign) {
    var units=campaign.units.filter(function(u){
      return (inspectedEpoch==null||u.epoch===inspectedEpoch)&&!!u.frame&&!u.framePruned;
    });
    var key=campaign.id+':'+inspectedEpoch+':'+units.map(function(u){
      return [u.frame,JSON.stringify(u.assessment||null),JSON.stringify(u.referenceAssessments||[]),
        JSON.stringify(u.dinoAssessments||[]),u.error||''].join(':');
    }).join('|');
    if(lastFrameKey===key)return;
    lastFrameKey=key;
    var host=els('frames');
    var preserved=new Map();
    host.querySelectorAll('[data-gallery-epoch]').forEach(function(card){
      preserved.set(card.dataset.galleryEpoch+':'+card.dataset.galleryRound+':'+card.dataset.galleryCase,card);
    });
    var heading=host.querySelector('.epoch-finder-gallery-heading');
    if(!heading){heading=document.createElement('div');heading.className='epoch-finder-gallery-heading';}
    heading.replaceChildren();
    var label=document.createElement('strong');
    label.textContent=inspectedEpoch==null?'Recent retained frames':candidateLabel(campaign,inspectedEpoch)+' · Available renders';
    heading.appendChild(label);
    if(inspectedEpoch!=null){
      var reset=document.createElement('button');reset.type='button';reset.dataset.inspectReset='1';
      reset.textContent='Show all epochs';heading.appendChild(reset);
    }
    host.appendChild(heading);
    var shown=inspectedEpoch==null?units.slice(-40).reverse():units.slice().sort(function(a,b){return a.round-b.round||a.case-b.case;});
    var keep=new Set();
    shown.forEach(function(unit){
      var identity=unit.epoch+':'+unit.round+':'+unit.case;
      keep.add(identity);
      var version=[unit.frame,JSON.stringify(unit.assessment||null),JSON.stringify(unit.referenceAssessments||[]),JSON.stringify(unit.dinoAssessments||[]),unit.error||''].join('|');
      var prior=preserved.get(identity);
      if(prior&&prior.dataset.cardVersion===version){host.appendChild(prior);return;}
      var url='/fs/epoch_finder/frame?folder='+encodeURIComponent(currentFolder)+'&campaign='+encodeURIComponent(campaign.id)+'&frame='+encodeURIComponent(unit.frame);
      var checks=unit.assessment&&unit.assessment.comparison||[];
      var matched=checks.filter(function(c){return c.result==='match';}).length;
      var counted=checks.filter(function(c){return c.result==='match'||c.result==='mismatch';}).length;
      var selection=(unit.groups||[]).filter(function(g){return g.expected!=null&&g.options&&g.options[g.expected-1];})
        .map(function(g){return {label:g.label||g.id,value:g.options[g.expected-1]};});
      var evidence=[];
      if(unit.assessment)evidence.push({label:counted?'VL '+matched+'/'+counted:'VL ✓'});
      if((unit.referenceAssessments||[]).length)evidence.push({label:'Ref '+unit.referenceAssessments.length});
      if((unit.dinoAssessments||[]).length)evidence.push({label:'DINO '+unit.dinoAssessments.length});
      var details=[];
      if(unit.prompt)details.push({label:'Resolved prompt',value:unit.prompt,pre:true});
      if(unit.seed!=null)details.push({label:'Seed',value:String(unit.seed)});
      if(checks.length)details.push({label:'VL judgments',value:checks.map(function(c){
        return (c.label||c.id||'Attribute')+': '+c.result+' · expected '+(c.expectedText||'')+' · observed '+(c.selectedText||'');
      })});
      if((unit.referenceAssessments||[]).length)details.push({label:'Reference VL',value:unit.referenceAssessments.map(function(r){
        return (r.group||r.label||'Reference')+' · '+r.option+': '+r.verdict+' · '+(r.reference||'');
      })});
      if((unit.dinoAssessments||[]).length)details.push({label:'DINOv2',value:unit.dinoAssessments.map(function(r){
        return (r.reference||'Reference')+': '+Number(r.similarity).toFixed(3);
      })});
      var card=createTestPreviewCard({
        tag:'figure',className:'epoch-finder-frame',role:'button',tabIndex:0,
        ariaLabel:'Inspect epoch '+unit.epoch+', round '+unit.round+', test '+(unit.case+1),
        dataset:{galleryEpoch:unit.epoch,galleryRound:unit.round,galleryCase:unit.case},
        title:candidateLabel(campaign,unit.epoch),
        sourceDetail:'Round '+unit.round+' · Test '+(unit.case+1),
        elapsed:unit.renderSeconds!=null?Math.round(unit.renderSeconds)+'s':'',
        media:{kind:'image',url:url,alt:'Saved Campaign render'},
        wildcards:selection,evaluations:evidence,details:details,
        actions:[{label:'Open original',url:url}],
      });
      card.dataset.cardVersion=version;
      if(prior)prior.remove(); // Replace a changed card; never leave its old copy behind.
      host.appendChild(card);
    });
    preserved.forEach(function(card,id){if(!keep.has(id))card.remove();});
  }
  function evidenceSection(campaign) {
    if (inspectedEpoch == null) return '';
    var source = (campaign.candidateMap || {})[String(inspectedEpoch)];
    var key = currentFolder + ':' + (source ? source.jobId + ':' + source.epoch : campaign.jobId + ':' + inspectedEpoch);
    var rows = crossEvidenceKey === key ? crossEvidence : null;
    var html = '<details class="epoch-finder-cross-evidence"' + (rows ? ' open' : '') +
      '><summary>Checkpoint evidence across campaigns</summary>' +
      '<button type="button" data-load-cross-evidence>Load evidence</button>';
    if (rows) {
      html += rows.length ? rows.map(function (row) {
        var verdicts = row.rvnVerdicts || {};
        return '<p><strong>' + escape(row.campaignName || row.campaignId) + '</strong>' +
          ' · Concept ' + (row.score == null ? 'not scored' : Math.round(row.score * 100) + '%') +
          ' · ' + row.evaluatedRenders + ' evaluated renders' +
          ' · ' + row.weightedObservations + ' weighted observations' +
          ' · RVN ' + (verdicts.MATCH || 0) + '/' + (verdicts.PARTIAL || 0) + '/' +
          (verdicts.MISMATCH || 0) + '/' + (verdicts.UNCLEAR || 0) + ' (match/partial/mismatch/unclear)' +
          ' · DINO ' + row.dinoComparisons + ' comparisons' +
          (row.failedUnits ? ' · ' + row.failedUnits + ' failed units' : '') +
          (row.campaignId === campaign.id ? ' · current' : '') + '</p>';
      }).join('') : '<p>No saved campaign evidence.</p>';
    }
    return html + '<small>Campaigns are separate protocols. Missing evaluations are not failures.</small></details>';
  }
  function loadCrossEvidence() {
    if (!campaignState || inspectedEpoch == null) return;
    var folder = currentFolder, campaignId = campaignState.id;
    var source = (campaignState.candidateMap || {})[String(inspectedEpoch)];
    var jobId = source ? source.jobId : campaignState.jobId;
    var candidateId = inspectedEpoch, epoch = source ? source.epoch : inspectedEpoch, version = ++crossEvidenceVersion;
    api('checkpoint_evidence', {jobId:jobId}).then(function (result) {
      if (version !== crossEvidenceVersion || currentFolder !== folder ||
          !campaignState || campaignState.id !== campaignId || inspectedEpoch !== candidateId) return;
      var item = (result.checkpoints || []).find(function (row) { return row.epoch === epoch; });
      crossEvidenceKey = folder + ':' + jobId + ':' + epoch;
      crossEvidence = item ? item.campaigns : [];
      inspectFrame(campaignState);
    }).catch(error);
  }
  function inspectFrame(campaign) {
    var node = els('inspector');
    var units = campaign.units.filter(function (u) { return inspectedEpoch != null && u.epoch === inspectedEpoch; })
      .sort(function (a,b) { return a.round-b.round || a.case-b.case; });
    node.classList.toggle('hidden', !units.length);
    if (!units.length) { node.innerHTML = ''; return; }
    inspectedFrame = Math.max(0, Math.min(inspectedFrame, units.length-1));
    var unit = units[inspectedFrame], checks = (unit.assessment && unit.assessment.comparison) || [];
    var src = unit.frame && !unit.framePruned ? '/fs/epoch_finder/frame?folder=' +
      encodeURIComponent(currentFolder) + '&campaign=' + encodeURIComponent(campaign.id) +
      '&frame=' + encodeURIComponent(unit.frame) : '';
    var plannedReferences = (unit.groups || []).filter(function (g) { return g.role === 'primary' && g.expected != null; })
      .map(function (g) { return (campaign.referencePlan || []).find(function (r) {
        return r.attribute === g.label && r.option === g.options[g.expected - 1];
      }); }).filter(Boolean).map(function (r) { return r.media; });
    var referenceNames = Array.from(new Set(plannedReferences
      .concat((unit.referenceAssessments || []).map(function (v) { return v.reference; }))
      .concat((unit.dinoAssessments || []).map(function (v) { return v.reference; }))));
    var referenceThumbnails = referenceNames.map(function (name) {
      var href = '/caption/media?folder=' + encodeURIComponent(currentFolder) + '&media=' + encodeURIComponent(name);
      return '<a href="' + escape(href) + '" target="_blank" rel="noopener" title="Open full training reference">' +
        '<img loading="lazy" src="' + escape(href) + '" alt="Approved training reference: ' + escape(name) + '">' +
        '<small>' + escape(name) + '</small></a>';
    }).join('');
    node.innerHTML = '<div class="epoch-finder-inspect-top"><strong>' + escape(candidateLabel(campaign, unit.epoch)) +
      ' · Round ' + unit.round + ' / Test ' + (unit.case+1) + '</strong><span>' +
      (inspectedFrame+1) + ' / ' + units.length + '</span></div>' +
      '<div class="epoch-finder-inspect-actions"><button type="button" data-copy-epoch-to-test>Copy ' + escape(candidateLabel(campaign, unit.epoch)) + ' to Test Generations</button><button type="button" data-view-epoch-media>View all epoch media ↗</button></div>' +
      (src ? '<button type="button" data-inspect-zoom title="Open original image"><img src="' + escape(src) +
      '" alt="' + escape(candidateLabel(campaign, unit.epoch)) + ' enlarged preview"></button>' :
      '<p>Frame ' + (unit.framePruned ? 'pruned after scoring' : unit.error ? 'unavailable due to error' : 'not yet captured') + '</p>') +
      (referenceThumbnails ? '<div class="epoch-finder-reference-thumbnails"><strong>Approved training references</strong><div>' +
        referenceThumbnails + '</div></div>' : '') +
      '<div class="epoch-finder-inspect-nav"><button type="button" data-inspect-prev>← Previous</button>' +
      '<button type="button" data-inspect-next>Next →</button></div>' +
      '<details open><summary>VL judgments (' + checks.length + ')</summary>' +
      checks.map(function (c) {
        var g = (unit.groups || []).find(function (g) { return g.id === c.id; });
        var choices = g && g.options || [];
        return '<p>' + escape(c.label) + ': ' + escape(c.result) + ' · expected ' +
          escape(choices[c.expected-1] || 'unknown') + ' · observed ' +
          escape(choices[c.selected-1] || 'unclear') + '</p>';
      }).join('') + '</details><details><summary>Resolved prompt</summary><p>' +
      escape(unit.prompt || 'Not yet resolved') + '</p></details>' +
      ((unit.referenceAssessments || []).length ? '<details open><summary>Training-reference comparisons (' +
        unit.referenceAssessments.length + ')</summary>' + unit.referenceAssessments.map(function (v) {
          return '<div class="epoch-finder-reference-verdict"><strong>' + escape(v.group || v.label) +
          ' · ' + escape(v.option) + '</strong><span>' + escape(v.verdict) + '</span>' +
          '<small>Selected in render: ' + escape(v.selected == null ? 'unclear' : ((unit.groups || []).find(function (g) { return g.id === v.groupId; })?.options || [])[v.selected - 1] || 'unclear') + '</small>' +
          '<div>' + escape(v.response) + '</div><small>Reference: ' + escape(v.reference) +
          ' · ' + escape(v.elapsedSeconds) + 's</small></div>';
        }).join('') + '</details>' : '') +
      ((unit.dinoAssessments || []).length ? '<details open><summary>DINOv2 whole-image similarity (' +
        unit.dinoAssessments.length + ' distinct references)</summary>' + unit.dinoAssessments.map(function (v) {
          return '<div class="epoch-finder-reference-verdict"><strong>' + escape(v.reference) +
            '</strong><span>' + Number(v.similarity).toFixed(3) + '</span><div>' +
            escape((v.attributes || []).join(' · ')) + '</div></div>';
        }).join('') + '</details>' : '') +
      (unit.referenceError ? '<p class="epoch-finder-error">Reference VL: ' + escape(unit.referenceError) + '</p>' : '') +
      (unit.dinoError ? '<p class="epoch-finder-error">DINOv2: ' + escape(unit.dinoError) + '</p>' : '') +
      (unit.error ? '<p class="epoch-finder-error">' + escape(unit.error) + '</p>' : '') + evidenceSection(campaign);
  }
  function render(campaign) {
    campaignState = campaign;
    function median(values) {
      if (!values.length) return null;
      var sorted = values.slice().sort(function (a,b) { return a-b; });
      return sorted[Math.floor(sorted.length / 2)];
    }
    var rounds = campaign.rounds;
    var cases = campaign.units;
    var completedRenders = cases.filter(function (u) { return !!u.frame || !!u.error; }).length;
    var completedVision = cases.filter(function (u) { return !!u.assessment || !!u.error; }).length;
    var planned = rounds.reduce(function (sum, round) { return sum + round.epochs.length * round.seeds.length; }, 0);
    var renderMeasured = cases.filter(function (u) { return Number(u.renderSeconds) > 0; }).map(function (u) { return u.renderSeconds; });
    var vlMeasured = cases.filter(function (u) { return Number(u.visionWallSeconds) > 0; }).map(function (u) { return u.visionWallSeconds; });
    var renderPace = median(renderMeasured.slice(-10));
    var visionPace = median(vlMeasured.slice(-10));
    var remainingRender = Math.max(0, planned - completedRenders);
    var remainingVision = Math.max(0, planned - completedVision);
    var eta = (renderPace == null ? 0 : remainingRender * renderPace) +
      (visionPace == null ? 0 : remainingVision * visionPace);
    var incomplete = remainingRender || remainingVision;
    els('timing').textContent = campaign.status === 'complete' ? 'Campaign complete' :
      !renderMeasured.length && !vlMeasured.length ? 'Awaiting measured render / VL time' :
      (renderPace == null ? 'Render time unknown' : 'Render ~' + Math.round(renderPace) + 's') +
      ' · ' + (visionPace == null ? 'VL time unknown' : 'VL ~' + Math.round(visionPace) + 's') +
      (incomplete && renderPace != null && visionPace != null ?
        ' · ~' + Math.ceil(eta / 60) + 'm remaining (render queue excluded; VL queue included; future cutoff ties uncertain)' :
        ' · full ETA awaiting both measurements');
    els('empty').classList.add('hidden');
    els('reference-workspace').classList.add('hidden');
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
    els('follow-up').classList.toggle('hidden', campaign.status === 'running' || campaign.status === 'queued');
    ranking(campaign);
    campaignSummary(campaign);
    gallery(campaign);
    inspectFrame(campaign);
  }
  function refreshStatus() {
    if (!activeCampaign) return Promise.resolve();
    var requestedId = activeCampaign, requestedFolder = currentFolder;
    return api('status', { campaignId: requestedId }).then(function (response) {
      if (activeCampaign === requestedId && currentFolder === requestedFolder && response.campaign) render(response.campaign);
    });
  }
  function refresh() {
    if (!currentFolder || mode !== 'finder') return;
    var folderAtRequest = currentFolder, modelAtRequest = String(window.getWorkingModelProfileId() || '');
    var requestVersion = ++listRequestVersion;
    api('list').then(function (response) {
      if (requestVersion !== listRequestVersion || folderAtRequest !== currentFolder ||
          modelAtRequest !== String(window.getWorkingModelProfileId() || '') || mode !== 'finder') return;
      runs = response.runs || [];
      campaigns = response.campaigns || [];
      timingProfiles = response.timings || {};
      setup(); list();
      if (activeCampaign && campaigns.some(function (c) { return c.id === activeCampaign; })) return refreshStatus();
      activeCampaign = '';
      els('active').classList.add('hidden'); els('empty').classList.remove('hidden');
    }).catch(error);
  }
  function send(operation) {
    clearError();
    return api(operation, {campaignId: activeCampaign}).then(function () { refresh(); }).catch(error);
  }
  function followUpCampaign() {
    if (!campaignState) return;
    var source = campaignState;
    var first = source.rounds[0];
    activeCampaign = '';
    els('active').classList.add('hidden');
    els('empty').classList.remove('hidden');
    setup();
    runEpochSelections = {};
    (source.runSelections || [{jobId:source.jobId, epochs:first.epochs}]).forEach(function (item) {
      runEpochSelections[item.jobId] = new Set(item.epochs);
    });
    drawEpochPicker();
    els('prompt').value = first.prompt;
    els('concept').value = source.concept || '';
    dimensions = source.dimensions.map(function (item) {
      return {label:item.label, options:item.options.slice(), role:item.role};
    });
    renderDimensions();
    [['aspectRatio','test-generations-aspect'],['megapixels','test-generations-megapixels'],
      ['duration','test-generations-duration'],['dimensions','test-generations-dimensions']].forEach(function (pair) {
      var field = document.getElementById(pair[1]);
      if (field && first.settings[pair[0]] != null) field.value = String(first.settings[pair[0]]);
    });
    els('rounds').value = String(source.rounds.length);
    els('cases').value = String(first.seeds.length);
    els('retention').value = String(first.keepPercent);
    els('enable-rvn').checked = !!source.referenceEvaluation.rvn;
    els('enable-dino').checked = !!source.referenceEvaluation.dino;
    referenceSelections = {};
    source.dimensions.filter(function (item) { return item.role === 'primary'; }).forEach(function (item) {
      item.options.forEach(function (option) { referenceSelections[JSON.stringify([item.label, option])] = null; });
    });
    (source.referencePlan || []).forEach(function (ref) {
      referenceSelections[JSON.stringify([ref.attribute,ref.option])] = {
        attribute:ref.attribute, option:ref.option, group:ref.group, tag:ref.tag, media:ref.media
      };
    });
    followUpSource = source.id;
    els('round-plan').innerHTML = '';
    roundPlan();
    Array.from(els('round-plan').querySelectorAll('[data-epoch-round]')).forEach(function (row,index) {
      var plan = source.rounds[index];
      row.querySelector('[data-case]').value = String(plan.seeds.length);
      row.querySelector('[data-keep]').value = String(plan.keepPercent);
      if (row.querySelector('[data-mp]') && plan.settings.megapixels != null)
        row.querySelector('[data-mp]').value = String(plan.settings.megapixels);
      if (row.querySelector('[data-dimensions]') && plan.settings.dimensions != null)
        row.querySelector('[data-dimensions]').value = String(plan.settings.dimensions);
    });
    showStep(1);
    list();
  }
  function start() {
    clearError();
    try { approvedReferences(); recordDimensions(); } catch (exc) { return error(exc); }
    var selections = selectedRunEntries();
    if (!selections.length || selections.some(function (entry) { return !entry.epochs.length; }))
      return error(new Error('Select checkpoints from each chosen training run.'));
    var jobId = selections[0].jobId;
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
      vlImageMP: 0.45,
      runSelections: selections, epochs: selections[0].epochs, referencePlan: approvedReferences(),
      referenceEvaluation: {rvn: els('enable-rvn').checked, dino: els('enable-dino').checked},
      parentCampaignId: followUpSource};
    els('start').disabled = true;
    api('start', criteria).then(function (response) {
      followUpSource = ''; activeCampaign = response.campaign.id; inspectedEpoch = null; lastFrameKey = '';
      els('reference-workspace').classList.add('hidden');
      refresh();
    }).catch(error).finally(function () { els('start').disabled = false; });
  }
  function applyFolder(folder) {
    inspectedEpoch = null;
    lastFrameKey = null;
    var changed = currentFolder !== folder;
    if (changed) followUpSource = '';
    if (changed) { listRequestVersion++; crossEvidenceVersion++; crossEvidence = null; crossEvidenceKey = ''; }
    currentFolder = folder;
    if (changed) { activeCampaign = ''; runs = []; campaigns = []; lastFrameKey = ''; selectedRunId = ''; selectedEpochs = new Set(); runEpochSelections = {}; referenceSelections = {}; referenceItems = []; referencePlanSignature = ''; referenceGeneration++; }
    window.testReferencesPrepare(folder);
    window.runAnalyticsPrepare(folder);
    if (mode === 'finder') refresh();
  }
  window.epochFinderPrepare = applyFolder;
  window.epochFinderInspectCampaign = function (campaignId, sourceEpoch, sourceJobId) {
    activeCampaign = String(campaignId);
    inspectedEpoch = null; inspectedFrame = 0; lastFrameKey = '';
    showMode('finder');
    return refreshStatus().then(function () {
      if (sourceEpoch == null || !campaignState || campaignState.id !== String(campaignId)) return;
      var matched = Object.entries(campaignState.candidateMap || {}).find(function (entry) {
        return entry[1].epoch === Number(sourceEpoch) && (!sourceJobId || entry[1].jobId === sourceJobId);
      });
      if (sourceJobId && Object.keys(campaignState.candidateMap || {}).length && !matched) {
        throw new Error('Source checkpoint is not present in this campaign.');
      }
      inspectedEpoch = matched ? Number(matched[0]) : Number(sourceEpoch);
      inspectedFrame = 0; lastFrameKey = '';
      gallery(campaignState); inspectFrame(campaignState);
    }).catch(error);
  };
  document.querySelectorAll('#test-workspace-main-tabs [data-test-workspace-mode]').forEach(function (button) {
    button.addEventListener('click', function () { showMode(button.dataset.testWorkspaceMode); });
  });
  els('refresh').onclick = refresh;
  els('new').onclick = function () { followUpSource = ''; activeCampaign = ''; campaignState = null; inspectedEpoch = null; inspectedFrame = 0; lastFrameKey = ''; els('active').classList.add('hidden'); els('empty').classList.remove('hidden'); list(); showStep(1); };
  els('start').onclick = start;
  els('follow-up').onclick = followUpCampaign;
  els('suggest').onclick = propose;
  els('next').onclick = advance;
  els('back').onclick = function () { clearError(); showStep(Math.max(1, wizardStep - 1)); };
  els('run-choices').addEventListener('change', function (event) {
    var checkbox = event.target.closest('[data-run-id]');
    if (!checkbox) return;
    var jobId = checkbox.dataset.runId;
    var run = runs.find(function (item) { return item.jobId === jobId; });
    if (!run) throw new Error('Selected training run disappeared.');
    if (checkbox.checked) runEpochSelections[jobId] = new Set(run.epochs);
    else delete runEpochSelections[jobId];
    referenceSelections = {};
    referenceGeneration++;
    drawEpochPicker();
    roundPlan();
  });
  els('epoch-picker').addEventListener('click', function (event) {
    var region = event.target.closest('[data-epoch-run]');
    if (!region) return;
    var jobId = region.dataset.epochRun, choice = event.target.closest('[data-epoch-choice]');
    var selected = runEpochSelections[jobId];
    if (!(selected instanceof Set)) throw new Error('Run selection missing.');
    if (choice) {
      var epoch = Number(choice.dataset.epochChoice);
      if (selected.has(epoch)) selected.delete(epoch); else selected.add(epoch);
    } else {
      var action = event.target.closest('[data-epoch-action]');
      if (!action) return;
      var run = runs.find(function (item) { return item.jobId === jobId; });
      if (action.dataset.epochAction === 'all') runEpochSelections[jobId] = new Set(run.epochs);
      if (action.dataset.epochAction === 'none') selected.clear();
      if (action.dataset.epochAction === 'every5') runEpochSelections[jobId] = new Set(run.epochs.filter(function (epoch) { return epoch % 5 === 0; }));
      if (action.dataset.epochAction === 'last10') runEpochSelections[jobId] = new Set(run.epochs.slice(-10));
    }
    drawEpochPicker(); roundPlan();
  });

  function referenceClick(event) {
    var preview = event.target.closest('[data-reference-preview]');
    if (preview) {
      var candidate = referenceItems[referenceIndex].candidates[Number(preview.dataset.referencePreview)];
      els('preview-image').src = '/caption/media?folder=' + encodeURIComponent(currentFolder) + '&media=' + encodeURIComponent(candidate.media);
      els('preview-image').alt = candidate.media;
      els('preview-caption').textContent = candidate.media + ' · ' + candidate.group + ': ' + candidate.tag;
      els('reference-preview').showModal();
      return;
    }
    var pick = event.target.closest('[data-reference-pick]');
    if (pick) {
      var item = referenceItems[referenceIndex];
      var index = Number(pick.dataset.referencePick);
      var candidate = item.candidates[index];
      if (referenceDraftChoices[item.key] === index) {
        referenceDraftChoices[item.key] = -1;
        referenceSelections[item.key] = null;
      } else {
        referenceDraftChoices[item.key] = index;
        referenceSelections[item.key] = {attribute:item.attribute, dimensionId:item.dimensionId,
          option:item.option, group:candidate.group, tag:candidate.tag, media:candidate.media};
      }
      renderReferenceStep();
      return;
    }
    var nav = event.target.closest('[data-reference-nav]');
    if (!nav) return;
    if (nav.dataset.referenceNav === 'prev') referenceIndex = Math.max(0,referenceIndex-1);
    else if (referenceIndex < referenceItems.length-1) referenceIndex++;
    renderReferenceStep();
  }
  els('reference-options').addEventListener('click', referenceClick);
  els('reference-workspace').addEventListener('click', referenceClick);
  els('preview-close').onclick = function () { els('reference-preview').close(); };
  els('prompt').addEventListener('change', function () { try { updateDimensions(); } catch (exc) { error(exc); } });
  showStep(1);
  var testDuration = document.getElementById('test-generations-duration');
  if (testDuration) testDuration.addEventListener('input', function () {
    if (mode === 'finder') roundPlan();
  });
  els('rounds').onchange = roundPlan;
  els('cases').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  els('retention').onchange = function () { els('round-plan').innerHTML = ''; roundPlan(); };
  ['rank-filter','rank-sort'].forEach(function (id) { els(id).onchange = function () { if (campaignState) ranking(campaignState); }; });
  els('ranking').onclick = function (event) {
    var row = event.target.closest('[data-inspect-epoch]');
    if (!row) return;
    inspectedEpoch = Number(row.dataset.inspectEpoch);
    crossEvidenceVersion++;
    inspectedFrame = 0;
    lastFrameKey = null;
    refreshStatus().catch(error);
  };
  els('inspector').onclick = function (event) {
    if (!campaignState || inspectedEpoch == null) return;
    if (event.target.closest('[data-load-cross-evidence]')) { loadCrossEvidence(); return; }
    if (event.target.closest('[data-view-epoch-media]')) {
      var mapped=(campaignState.candidateMap||{})[String(inspectedEpoch)];
      window.runAnalyticsViewEpoch(mapped ? mapped.jobId : campaignState.jobId,
        mapped ? mapped.epoch : inspectedEpoch,'finder');
      return;
    }
    if (event.target.closest('[data-copy-epoch-to-test]')) {
      var button = event.target.closest('[data-copy-epoch-to-test]');
      var origin = (campaignState.candidateMap || {})[String(inspectedEpoch)];
      var folder = currentFolder, campaignId = campaignState.id, epoch = origin ? origin.epoch : inspectedEpoch;
      var sourceJobId = origin ? origin.jobId : campaignState.jobId;
      button.disabled = true;
      button.textContent = 'Copying epoch…';
      fetch('/fs/training_candidates/copy_to_test', {method:'POST',headers:{'Content-Type':'application/json'},
        body: JSON.stringify({folder:folder,jobId:sourceJobId,epoch:epoch})})
        .then(function (response) { return response.json().then(function (value) {
          if (!response.ok || !value.ok) throw new Error(value.error || 'Could not copy checkpoint.');
          return value;
        }); }).then(function () {
          if (currentFolder === folder && campaignState?.id === campaignId) showMode('tests');
        }).catch(function (exc) {
          button.disabled = false;
          button.textContent = 'Copy epoch ' + epoch + ' to Test Generations';
          error(exc);
        });
      return;
    }
    if (event.target.closest('[data-inspect-prev]')) inspectedFrame--;
    else if (event.target.closest('[data-inspect-next]')) inspectedFrame++;
    else if (event.target.closest('[data-inspect-zoom]')) {
      var image = els('inspector').querySelector('img');
      if (image) window.open(image.src, '_blank', 'noopener');
      return;
    } else return;
    inspectFrame(campaignState);
  };
  function selectGalleryFrame(element) {
    inspectedEpoch = Number(element.dataset.galleryEpoch);
    var found = (campaignState?.units || []).filter(function (u) { return u.epoch === inspectedEpoch; })
      .sort(function (a,b) { return a.round-b.round || a.case-b.case; });
    inspectedFrame = Math.max(0, found.findIndex(function (u) {
      return u.round === Number(element.dataset.galleryRound) && u.case === Number(element.dataset.galleryCase);
    }));
    lastFrameKey = null;
    refreshStatus().catch(error);
  }
  els('frames').onclick = function (event) {
    if (event.target.closest('[data-inspect-reset]')) {
      inspectedEpoch = null; inspectedFrame = 0; lastFrameKey = null; refreshStatus().catch(error);
      return;
    }
    if (event.target.closest('.test-preview-card-utility, .test-preview-card-details')) return;
    var frame = event.target.closest('[data-gallery-epoch]');
    if (frame) selectGalleryFrame(frame);
  };
  els('frames').onkeydown = function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.test-preview-card-utility, .test-preview-card-details')) return;
    var frame = event.target.closest('[data-gallery-epoch]');
    if (!frame) return;
    event.preventDefault();
    selectGalleryFrame(frame);
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
    if (button) { activeCampaign = button.dataset.id; inspectedEpoch = null; inspectedFrame = 0; lastFrameKey = ''; list(); refreshStatus().catch(error); }
  };
  window.addEventListener('webcap:working-model-changed', function () {
    listRequestVersion++;
    activeCampaign = ''; inspectedEpoch = null; campaignState = null;
    els('active').classList.add('hidden'); els('empty').classList.remove('hidden');
    if (mode === 'finder') refresh();
  });
  timer = setInterval(function () {
    if (mode === 'finder' && activeCampaign && campaignState &&
        ['queued', 'running'].includes(campaignState.status) &&
        !els('screen').classList.contains('hidden')) refreshStatus().catch(error);
  }, 2500);
})();
