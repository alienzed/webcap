/* QA-owned curation; an explicit training handoff activates the existing Focus Set. */
(function () {
  'use strict';

  var session = {
    token: 0, phase: 'idle', folder: '', signature: '', rows: [], concepts: [],
    eligible: [], order: [], choices: new Set(), sizes: {}, preset: 'balanced',
    filter: 'selected', limit: 72, summary: '', jobId: '', error: '',
    analysis: null, balanceGroups: new Set(), overriddenGroups: new Set(), conceptRoles: new Map(), availableGroups: [],
    status: '', missingSight: 0, ignored: 0, draftStale: false, initialChoices: [],
    sourceEvidence: {}, sourceFiles: [], drift: null, reviewReturn: null, galleryGroup: '', previousDraft: null,
    pairGroups: []
  };

  var draftWrite = Promise.resolve();
  function compactSignature(signature) {
    var first = 2166136261, second = 2246822519;
    signature = String(signature || '');
    for (var i = 0; i < signature.length; i += 1) {
      var code = signature.charCodeAt(i);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ code, 3266489917);
    }
    return 'v2:' + signature.length.toString(36) + ':' +
      (first >>> 0).toString(16).padStart(8, '0') +
      (second >>> 0).toString(16).padStart(8, '0');
  }
  function signaturesMatch(left, right) {
    return left === right || compactSignature(left) === right || left === compactSignature(right);
  }
  function evidenceFingerprint(item) {
    var analysis = item.analysis || {};
    // Field-level evidence fingerprints explain drift without storing duplicated captions.
    // Ratings, filters and unrelated QA settings are not curation evidence.
    return {
      caption:compactSignature(item.caption || ''),
      tags:compactSignature(JSON.stringify(item.groupedTags || [])),
      sight:compactSignature(JSON.stringify(analysis.visionSight || null)),
      pose:compactSignature(JSON.stringify(analysis.selectionPose || null)),
      complexity:compactSignature(JSON.stringify(analysis.sceneComplexity || null)),
      resolution:String(item.resolution || '')
    };
  }
  function captureEvidence(items) {
    session.sourceFiles = (items || []).map(function(item) { return item.fileName; });
    session.sourceEvidence = {};
    (items || []).forEach(function(item) {
      session.sourceEvidence[item.fileName] = evidenceFingerprint(item);
    });
  }
  function currentDrift() {
    var before = session.sourceFiles || [];
    if (!before.length) return {changed:[],missing:[],viewChanged:false};
    var available = new Set((state.items || []).map(function(item) { return item.fileName; }));
    // Query authoritative QA assignments and metadata from the original filenames,
    // regardless of which Focus Set or text filter happens to be active.
    var live = window.qaCurrentCurationEvidence(before);
    var byFile = new Map(live.map(function(item) { return [item.fileName,item]; }));
    var missing = before.filter(function(file) { return !available.has(file); });
    var changed = before.map(function(file) {
      var item = byFile.get(file);
      if (!item) return null;
      var current = evidenceFingerprint(item);
      var prior = session.sourceEvidence[file];
      var fields = Object.keys(current).filter(function(key) {
        return !prior || prior[key] !== current[key];
      });
      return fields.length ? {file:file,fields:fields} : null;
    }).filter(Boolean);
    return {changed:changed, missing:missing, viewChanged:!signaturesMatch(session.signature,qaCurrentCurationSignature()),
      // Current display filters must never alter the persisted source population.
      sourceCount:before.length};
  }
  function draftPayload() {
    return {version:2, signature:session.signature.startsWith('v2:') ? session.signature : compactSignature(session.signature),
      focus:session.focus, analysis:session.analysis, summary:session.summary,
      choices:Array.from(session.choices), initialChoices:session.initialChoices, preset:session.preset,
      balanceGroups:Array.from(session.balanceGroups), overriddenGroups:Array.from(session.overriddenGroups),
      conceptRoles:Array.from(session.conceptRoles), reviewReturn:session.reviewReturn,
      pairGroups:session.pairGroups.slice(),
      snapshot:{
        concepts:session.concepts,
        rows:session.rows.map(function(row) {
          return [row.fileName, row.inventoryIds || [], row.analysis && row.analysis.sceneComplexity
            ? row.analysis.sceneComplexity.score : null, row.resolution || ''];
        }),
        order:session.order.slice(), sizes:Object.assign({},session.sizes),
        ignored:session.ignored, missingSight:session.missingSight,
        evidence:session.sourceEvidence
      }};
  }
  function saveDraft() {
    if (!session.analysis || session.phase !== 'ready') return;
    var folder = session.folder, draft = draftPayload();
    draftWrite = draftWrite.catch(function() {}).then(function() {
      return request('/fs/qa/curate/draft', {folder:folder, draft:draft});
    }).catch(function(err) { window.reportConsoleError('QA Curate · Save draft',err); });
  }
  function restoreDraft(draft) {
    if (!draft || ![1,2].includes(draft.version) || !draft.analysis) return false;
    if (!Array.isArray(draft.choices) || !Array.isArray(draft.balanceGroups) ||
        !Array.isArray(draft.overriddenGroups) || !Array.isArray(draft.conceptRoles)) {
      throw new Error('Curate draft contains invalid selections.');
    }
    var hasSnapshot = draft.version === 2 && draft.snapshot &&
      Array.isArray(draft.snapshot.concepts) && Array.isArray(draft.snapshot.rows);
    if (hasSnapshot) {
      session.concepts = draft.snapshot.concepts;
      session.rows = draft.snapshot.rows.map(function(parts) {
        return {fileName:parts[0], ids:[], inventoryIds:parts[1] || [],
          resolution:parts[3] || '',
          analysis:parts[2] === null ? {} : {sceneComplexity:{score:parts[2]}}};
      });
      session.sourceFiles = session.rows.map(function(row) {return row.fileName;});
      session.sourceEvidence = draft.snapshot.evidence || {};
      session.ignored = Number(draft.snapshot.ignored || 0);
      session.missingSight = Number(draft.snapshot.missingSight || 0);
      session.availableGroups = Array.from(new Set(session.concepts.map(function(c) {return c.group;}))).sort();
    } else if (!signaturesMatch(draft.signature,session.signature)) {
      // v1 did not preserve the concept-to-file mapping. Never reinterpret its
      // positional concept IDs after source edits, but retain the saved choices.
      session.choices = new Set(draft.choices);
      session.phase = 'legacy';
      session.status = 'Legacy Curate draft: selections are preserved, but scored evidence needs optional reanalysis.';
      return true;
    }
    session.signature = draft.signature;
    session.focus = String(draft.focus || session.focus || '');
    session.summary = String(draft.summary || '');
    session.analysis = draft.analysis;
    session.balanceGroups = new Set(draft.balanceGroups);
    session.overriddenGroups = new Set(draft.overriddenGroups);
    session.conceptRoles = new Map(draft.conceptRoles);
    session.pairGroups = Array.isArray(draft.pairGroups) ? draft.pairGroups.slice(0,2) : [];
    session.preset = ['lean','balanced','broad'].includes(draft.preset) ? draft.preset : 'custom';
    applyBalancePriorities();
    if (hasSnapshot && Array.isArray(draft.snapshot.order) && draft.snapshot.sizes) {
      session.order = draft.snapshot.order.slice();
      session.sizes = Object.assign({},draft.snapshot.sizes);
    }
    session.choices = new Set(draft.choices);
    session.initialChoices = Array.isArray(draft.initialChoices)
      ? draft.initialChoices.slice() : draft.choices.slice();
    session.phase = 'ready';
    session.reviewReturn = draft.reviewReturn || null;
    session.filter = 'selected';
    session.status = 'Saved Curate draft restored.';
    session.draftStale = false;
    return true;
  }

  function normalize(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function addConcept(lookup, row, group, term, source) {
    group = normalize(group);
    term = normalize(term);
    if (!group || !term) return;
    var key = group.toLowerCase() + '\u001f' + term.toLowerCase();
    if (!lookup.has(key)) {
      lookup.set(key, {
        key: key, id: '', group: group, term: term,
        source: source, files: new Set(), example: ''
      });
    }
    var feature = lookup.get(key);
    feature.files.add(row.fileName);
    row.keys.add(key);
    if (!feature.example && source === 'tag') {
      feature.example = normalize(row.caption).slice(0, 110);
    }
  }

  function buildInventory(items) {
    var lookup = new Map();
    var rows = (items || []).map(function (raw) {
      var row = {
        fileName: String(raw.fileName || ''), caption: String(raw.caption || ''),
        analysis: raw.analysis || {}, resolution: String(raw.resolution || ''),
        keys: new Set(), ids: [], hash: ''
      };
      (raw.groupedTags || []).forEach(function (tag) {
        addConcept(lookup, row, tag.group, tag.term, 'tag');
      });
      var sight = row.analysis.visionSight;
      var inventory = sight && sight.inventory;
      if (inventory) {
        (inventory.things || []).forEach(function (thing) {
          addConcept(lookup, row, 'Sight · object', thing.name, 'sight');
          (thing.qualities || []).slice(0, 4).forEach(function (quality) {
            addConcept(lookup, row, 'Sight · detail', thing.name + ': ' + quality, 'sight');
          });
        });
        (inventory.details || []).slice(0, 12).forEach(function (detail) {
          addConcept(lookup, row, 'Sight · detail', detail, 'sight');
        });
        (inventory.viewpoint || []).slice(0, 2).forEach(function (view) {
          addConcept(lookup, row, 'Sight · viewpoint', view, 'sight');
        });
      }
      return row;
    });
    var all = Array.from(lookup.values()).sort(function (a, b) {
      return b.files.size - a.files.size || a.key.localeCompare(b.key);
    });
    // Retain frequent evidence and rare construction observations in a bounded
    // Director request; never send the entire caption corpus.
    var chosen = [];
    var seen = new Set();
    function append(feature) {
      if (chosen.length >= 120 || seen.has(feature.key)) return;
      seen.add(feature.key);
      chosen.push(feature);
    }
    // Human-approved groups precede noisier Sight-derived observations.
    // Reserve space for rare approved constructions before popular backgrounds
    // or repeated visual descriptions exhaust the fixed Director budget.
    var approved = all.filter(function (feature) { return feature.source === 'tag'; });
    approved.slice(0, 72).forEach(append);
    approved.filter(function (feature) { return feature.files.size <= 3; })
      .sort(function (a, b) { return a.files.size - b.files.size || a.key.localeCompare(b.key); })
      .slice(0, 28).forEach(append);
    all.slice(0, 80).forEach(append);
    all.filter(function (feature) { return feature.files.size <= 3; })
      .sort(function (a, b) { return a.files.size - b.files.size || a.key.localeCompare(b.key); })
      .slice(0, 24).forEach(append);
    all.forEach(append);
    chosen.forEach(function (row, index) { row.id = 'c' + String(index + 1).padStart(3, '0'); });
    var byKey = new Map(chosen.map(function (feature) { return [feature.key, feature.id]; }));
    rows.forEach(function (row) {
      row.ids = Array.from(row.keys).map(function (key) { return byKey.get(key); }).filter(Boolean);
      row.inventoryIds = row.ids.slice();
      delete row.keys;
    });
    return {
      rows: rows,
      concepts: chosen.map(function (row) {
        return {
          id: row.id, group: row.group, term: row.term,
          count: row.files.size, source: row.source,
          example: chosen.indexOf(row) < 22 ? row.example : ''
        };
      }),
      ignored: Math.max(0, all.length - chosen.length)
    };
  }

  function strength(count, role) {
    return 1 - Math.exp(-count / (role === 'core' ? 3 : 2));
  }

  function deriveEligible(concepts, analysis, rows, balanceGroups, overriddenGroups, conceptRoles) {
    var core = new Set(analysis.coreIds);
    var supporting = new Set(analysis.supportingIds);
    var available = new Map(concepts.map(function (row) { return [row.id, row]; }));
    var selected = new Map();
    function include(id) {
      var row = available.get(id);
      if (!row) throw new Error('Curation result references unknown concept: ' + id);
      var preference = conceptRoles.get(id);
      if (preference === 'ignore') return;
      var role = preference || (balanceGroups.has(row.group) && (core.has(id) || overriddenGroups.has(row.group))
        ? 'core' : 'supporting');
      selected.set(id, {id: id, label: row.term, group: row.group, source:row.source, role: role,
        count: row.count, weight: row.source === 'sight'
          ? (role === 'core' ? 0.62 : 0.13)
          : (role === 'core' ? 1 : 0.28)});
    }
    core.forEach(include);
    supporting.forEach(function (id) {
      if (core.has(id)) throw new Error('Curation classified a concept twice: ' + id);
      include(id);
    });
    if (!core.size) throw new Error('Director found no core visual concepts.');
    // Preserve the Director's per-concept defaults until the user changes a
    // group. A manually selected group can promote even omitted concepts.
    concepts.forEach(function (row) {
      if ((balanceGroups.has(row.group) && overriddenGroups.has(row.group)) || conceptRoles.has(row.id)) include(row.id);
    });
    rows.forEach(function (row) {
      row.ids = row.inventoryIds.filter(function (id) { return selected.has(id); });
    });
    return Array.from(selected.values());
  }

  function prioritizedTaggedGroups() {
    return Array.from(session.balanceGroups).filter(function(group) {
      return session.eligible.some(function(c) { return c.source === 'tag' && c.group === group; });
    });
  }

  function reconcilePairGroups(groups) {
    if (groups.length < 2) { session.pairGroups = []; return; }
    if (session.pairGroups.length === 2 && session.pairGroups[0] !== session.pairGroups[1] &&
        session.pairGroups.every(function(group) { return groups.includes(group); })) return;
    // Prefer explicit human tag groups over alphabetically selected arbitrary axes.
    var position = groups.find(function(g) { return /position|pose/i.test(g); });
    var viewpoint = groups.find(function(g) { return /viewpoint|view|camera angle/i.test(g) && g !== position; });
    session.pairGroups = position && viewpoint ? [position, viewpoint] : groups.slice(0, 2);
  }

  function applyBalancePriorities() {
    session.eligible = deriveEligible(session.concepts, session.analysis, session.rows,
      session.balanceGroups, session.overriddenGroups, session.conceptRoles);
    reconcilePairGroups(prioritizedTaggedGroups());
    var ranked = rank(session.rows, session.eligible, session.pairGroups);
    session.order = ranked.order;
    session.sizes = ranked.sizes;
    // Changing priorities must not overwrite manually checked/unchecked media.
    // Only an active preset receives its newly ranked proposed subset.
    if (session.preset !== 'custom') {
      session.choices = new Set(session.order.slice(0, session.sizes[session.preset]));
    }
  }

  function coverage(rows, concepts, selectedFiles) {
    var byId = new Map(concepts.map(function (c) { return [c.id, 0]; }));
    rows.forEach(function (row) {
      if (!selectedFiles.has(row.fileName)) return;
      row.ids.forEach(function (id) { byId.set(id, byId.get(id) + 1); });
    });
    var obtained = 0, available = 0, represented = 0;
    concepts.forEach(function (c) {
      var n = byId.get(c.id) || 0;
      if (n > 0) represented += 1;
      obtained += c.weight * strength(n, c.role);
      available += c.weight * strength(c.count, c.role);
    });
    return { ratio: available ? obtained / available : 0, represented: represented,
      total: concepts.length };
  }

  function sourcePixels(row) {
    var match = String(row && row.resolution || '').match(/^(\d+)\s*[x×]\s*(\d+)$/i);
    if (!match) return null;
    var width = Number(match[1]), height = Number(match[2]);
    return width > 0 && height > 0 && Number.isSafeInteger(width * height)
      ? width * height : null;
  }
  function resolutionText(row) {
    return sourcePixels(row) === null ? 'Resolution unknown' : String(row.resolution);
  }
  function score(row, concepts, byId, selected) {
    var core = 0, supporting = 0;
    row.ids.forEach(function (id) {
      var c = byId.get(id);
      var n = selected.get(id) || 0;
      var gain = c.weight * (strength(n + 1, c.role) - strength(n, c.role));
      if (c.role === 'core') core += gain;
      else supporting += gain;
    });
    var complexity = Number(row.analysis.sceneComplexity && row.analysis.sceneComplexity.score);
    var quality = Number.isFinite(complexity) && row.analysis.sceneComplexity
      ? 1 - Math.min(0.14, Math.max(0, complexity) * 0.14) : 1;
    return {core: core * quality, supporting: supporting * quality};
  }

  function rank(rows, concepts, pairGroups) {
    var byId = new Map(concepts.map(function (feature) { return [feature.id, feature]; }));
    var pairByFile = new Map(), pairCounts = new Map();
    if (Array.isArray(pairGroups) && pairGroups.length >= 2) {
      var left = new Set(concepts.filter(function(c) {
        return c.source === 'tag' && c.group === pairGroups[0];
      }).map(function(c) {return c.id;}));
      var right = new Set(concepts.filter(function(c) {
        return c.source === 'tag' && c.group === pairGroups[1];
      }).map(function(c) {return c.id;}));
      rows.forEach(function(row) {
        var a = row.ids.filter(function(id) {return left.has(id);});
        var b = row.ids.filter(function(id) {return right.has(id);});
        var pairs = [];
        a.forEach(function(x) {b.forEach(function(y) {pairs.push(x+'|'+y);});});
        pairByFile.set(row.fileName,pairs);
      });
    }
    function pairGain(row) {
      var pairs = pairByFile.get(row.fileName) || [];
      if (!pairs.length) return 0;
      var sum = pairs.reduce(function(total,id) {
        var count = pairCounts.get(id) || 0;
        return total + strength(count+1,'supporting') - strength(count,'supporting');
      },0);
      // Mean instead of sum prevents multi-label items from gaming the bonus.
      return 0.18 * sum / pairs.length;
    }
    var counts = new Map(concepts.map(function (feature) { return [feature.id, 0]; }));
    var remaining = rows.slice(), ordered = [], gains = [];
    while (remaining.length) {
      var scores = remaining.map(function (row) { return score(row, concepts, byId, counts); });
      var maxCore = scores.reduce(function (best, value) { return Math.max(best, value.core); }, 0);
      // Select for evidence first; use source resolution only between images
      // whose weighted marginal gains are within 2% of the best gain.
      var candidateGains = scores.map(function(value, i) {
        var pairBonus = pairGain(remaining[i]);
        return value.core + (maxCore > 0
          ? Math.min(value.supporting, maxCore * 0.2) +
            Math.min(pairBonus, maxCore * 0.16)
          : value.supporting + pairBonus);
      });
      var bestGain = Math.max.apply(null, candidateGains);
      var best = candidateGains.indexOf(bestGain);
      var bestPixels = sourcePixels(remaining[best]);
      for (var i = 0; i < remaining.length; i += 1) {
        if (i === best || candidateGains[i] < bestGain * 0.98) continue;
        var pixels = sourcePixels(remaining[i]);
        // Unknown dimensions cannot resolve a tie in either direction.
        if (pixels !== null && bestPixels !== null && pixels > bestPixels) {
          best = i;
          bestPixels = pixels;
        }
      }
      var chosen = remaining.splice(best, 1)[0];
      bestGain = candidateGains[best];
      ordered.push(chosen.fileName);
      gains.push(bestGain);
      chosen.ids.forEach(function (id) { counts.set(id, counts.get(id) + 1); });
      (pairByFile.get(chosen.fileName) || []).forEach(function(id) {
        pairCounts.set(id, (pairCounts.get(id) || 0) + 1);
      });
    }
    var selected = new Set(), ratios = [];
    ordered.forEach(function (file) {
      selected.add(file);
      ratios.push(coverage(rows, concepts, selected).ratio);
    });
    var first = gains.slice(0, Math.min(6, gains.length));
    var baseline = first.reduce(function (sum, value) { return sum + value; }, 0) / first.length;
    function bend(target, fraction) {
      for (var i = 0; i < gains.length; i += 1) {
        if (i < Math.min(7, gains.length - 1) || ratios[i] < target) continue;
        var tail = gains.slice(Math.max(0, i - 4), i + 1);
        var current = tail.reduce(function (sum, n) { return sum + n; }, 0) / tail.length;
        if (current <= baseline * fraction) return i + 1;
      }
      return gains.length;
    }
    return { order: ordered, gains: gains, ratios: ratios,
      sizes: {lean: bend(0.83, 0.14), balanced: bend(0.91, 0.085),
        broad: bend(0.97, 0.045)} };
  }

  function clearNode(el) { el.replaceChildren(); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function button(label, click, className) {
    var node = element('button', className || 'review-captions-btn', label);
    node.type = 'button';
    node.onclick = click;
    return node;
  }
  function currentSelection() {
    return new Set(session.choices);
  }
  function selectedCount() { return session.choices.size; }
  function updateStats(root) {
    var selected = currentSelection();
    var metric = coverage(session.rows, session.eligible, selected);
    var number = root.querySelector('[data-curation-selected]');
    var completeness = root.querySelector('[data-curation-coverage]');
    var variations = root.querySelector('[data-curation-variations]');
    var bar = root.querySelector('[data-curation-bar]');
    var trainButton = root.querySelector('[data-curation-train]');
    if (number) number.textContent = String(selectedCount());
    if (completeness) completeness.textContent = Math.round(metric.ratio * 100) + '%';
    if (variations) variations.textContent = metric.represented + ' / ' + metric.total;
    if (bar) { bar.value = Math.round(metric.ratio * 100); }
    if (trainButton) {
      trainButton.disabled = !selectedCount();
      trainButton.textContent = 'Use for Training · ' + selectedCount() + ' items';
    }
    var byId = new Map(session.eligible.map(function (c) {return [c.id,c];}));
    var counts = new Map(session.eligible.map(function (c) {return [c.id,0];}));
    session.rows.forEach(function(row) {
      if (!selected.has(row.fileName)) return;
      row.ids.forEach(function(id) { counts.set(id,(counts.get(id)||0)+1); });
    });
    root.querySelectorAll('[data-curation-contribution]').forEach(function(node) {
      var file = node.getAttribute('data-curation-contribution');
      var modified = new Set(session.choices);
      var included = modified.has(file);
      if (included) modified.delete(file); else modified.add(file);
      var delta = Math.abs((coverage(session.rows,session.eligible,modified).ratio -
        coverage(session.rows,session.eligible,session.choices).ratio) * 100);
      node.textContent = (included ? 'Keeping contributes ' : 'Including would add ') +
        delta.toFixed(2) + ' coverage points';
    });
    root.querySelectorAll('[data-curation-pair-left]').forEach(function(cell) {
      var left = cell.getAttribute('data-curation-pair-left');
      var right = cell.getAttribute('data-curation-pair-right');
      var total = Number(cell.getAttribute('data-curation-pair-total'));
      var selectedPair = session.rows.filter(function(row) {
        return selected.has(row.fileName) && row.ids.includes(left) && row.ids.includes(right);
      }).length;
      cell.textContent = selectedPair + ' / ' + total;
    });
    root.querySelectorAll('[data-curation-concept]').forEach(function(node) {
      var id = node.getAttribute('data-curation-concept'), concept = byId.get(id);
      if (!concept) throw new Error('QA curation concept meter is stale: ' + id);
      var count = counts.get(id)||0;
      var total = node.querySelector('[data-curation-concept-count]');
      var meter = node.querySelector('progress');
      total.textContent = count + '/' + concept.count;
      meter.value = Math.round(100 * count / Math.max(1, concept.count));
    });
  }


  function openCurateReview(host, startGroup, startCursor) {
    var group = startGroup || 'selected', cursor = Number(startCursor) || 0, autoNext = false;
    var originalFocus = document.activeElement;
    var overlay = element('div', 'qa-curation-review');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Curate review');
    var panel = element('div', 'qa-curation-review-panel');
    overlay.appendChild(panel);
    // Navigation order is fixed for this review, so a changed choice can be reconsidered.
    var selectedOrder = session.order.filter(function(file) { return session.choices.has(file); });
    var excludedOrder = session.order.filter(function(file) { return !session.choices.has(file); });
    function list() { return group === 'selected' ? selectedOrder : excludedOrder; }
    function close() {
      session.reviewReturn = {group:group, cursor:cursor};
      saveDraft();
      document.removeEventListener('keydown', keydown);
      overlay.remove();
      renderQaCuration(host, session.signature);
      if (originalFocus && originalFocus.isConnected) originalFocus.focus();
    }
    function next(n) { cursor = Math.max(0, Math.min(list().length - 1, cursor + n)); render(); }
    function keydown(e) {
      if (!overlay.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      var target = e.target;
      if (target && (target.closest('input, select, textarea, [contenteditable="true"]'))) return;
      if (e.key === 'Enter' && !e.repeat) {
        // Keep native Enter for secondary buttons; the primary decision works from anywhere else.
        if (target && target.closest('button:not(.qa-curation-review-decision)')) return;
        e.preventDefault();
        var primary = panel.querySelector('.qa-curation-review-decision');
        if (primary) primary.click();
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); next(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); next(1); }
      if (e.key === 'Tab') {
        var controls = Array.from(panel.querySelectorAll('button:not(:disabled), input:not(:disabled)'));
        if (e.shiftKey && document.activeElement === controls[0]) {
          e.preventDefault(); controls[controls.length - 1].focus();
        } else if (!e.shiftKey && document.activeElement === controls[controls.length - 1]) {
          e.preventDefault(); controls[0].focus();
        }
      }
    }
    function render() {
      var retainedFocus = document.activeElement && document.activeElement.className;
      panel.replaceChildren();
      var heading = element('div', 'qa-curation-review-top');
      heading.appendChild(element('strong', '', 'Curate Review'));
      heading.appendChild(button('Close', close));
      panel.appendChild(heading);
      var tabs = element('div', 'qa-curation-review-tabs');
      [['selected', 'Review original inclusions'], ['excluded', 'Review original exclusions']].forEach(function(part) {
        var ctl = button(part[1], function() { group = part[0]; cursor = 0; render(); });
        ctl.setAttribute('aria-pressed', String(group === part[0]));
        tabs.appendChild(ctl);
      });
      panel.appendChild(tabs);
      var items = list();
      if (!items.length) { panel.appendChild(element('p', '', 'No media in this group.')); return; }
      var name = items[cursor], row = session.rows.find(function(r) { return r.fileName === name; });
      if (!row) throw new Error('Curate Review missing media: ' + name);
      var included = session.choices.has(name);
      var imageArea = element('div', 'qa-curation-review-image');
      var media = element(isPreviewVideoFileName(name) ? 'video' : 'img');
      media.src = mediaGridMediaUrl({fileName: name, key: name});
      if (media.tagName === 'VIDEO') { media.controls = true; media.playsInline = true; media.preload = 'metadata'; }
      else media.alt = name;
      imageArea.appendChild(media);
      panel.appendChild(imageArea);
      var explanation = element('div', 'qa-curation-review-evidence');
      explanation.appendChild(element('strong', 'qa-curation-review-counter',
        (included ? 'INCLUDED' : 'EXCLUDED') + ' · ' + (cursor + 1) + ' / ' + items.length));
      explanation.appendChild(element('div','qa-curation-review-rank',
        'Recommendation rank #' + (session.order.indexOf(name) + 1) + ' of ' + session.order.length +
        ' · by weighted concept coverage, source detail and minor complexity preference'));
      var source = element('div', 'qa-curation-review-source');
      var filename = element('span', 'qa-curation-review-filename', name);
      filename.title = name;
      source.appendChild(filename);
      source.appendChild(button('Open in Single Item', function() {
        close();
        window.qaInspectCurationItem(name);
      }, 'qa-curation-review-open-item'));
      explanation.appendChild(source);
      var changedEvidence = (session.drift && session.drift.changed || []).find(function(change) {
        return change.file === name;
      });
      if (changedEvidence) {
        explanation.appendChild(element('p','qa-curation-drift',
          'Changed since recommendation: ' + changedEvidence.fields.join(', ') +
          '. Review the current source evidence; reanalysis is optional.'));
      }
      var live = window.qaCurrentCurationEvidence([name])[0];
      explanation.appendChild(element('div','qa-curation-review-resolution',resolutionText(live || row)));
      explanation.appendChild(element('small','',
        'When candidates have nearly equal coverage value, higher source resolution breaks the tie.'));
      if (live) {
        var tags = (live.groupedTags || []).map(function(t) {
          return (t.group || '') + ': ' + (t.term || '');
        });
        explanation.appendChild(element('div','qa-curation-review-tags',
          'Current tags: ' + (tags.join(' · ') || 'None')));
        if (live.caption) {
          var captionDetails = element('details','qa-curation-review-caption');
          captionDetails.appendChild(element('summary','','Current caption'));
          captionDetails.appendChild(element('p','',live.caption));
          explanation.appendChild(captionDetails);
        }
      } else {
        explanation.appendChild(element('p','qa-curation-drift','Source media missing; saved analysis is retained.'));
      }
      var withChange = new Set(session.choices);
      if (included) withChange.delete(name); else withChange.add(name);
      var before = coverage(session.rows, session.eligible, session.choices).ratio * 100;
      var after = coverage(session.rows, session.eligible, withChange).ratio * 100;
      var delta = after - before;
      explanation.appendChild(element('strong', 'qa-curation-review-verdict',
        (included ? 'Keeping contributes ' : 'Including would contribute ') +
        Math.abs(delta).toFixed(2) + ' weighted coverage points'));
      explanation.appendChild(element('small','',
        'This is marginal tagged/Sight evidence, not visual similarity or proven training quality.'));
      var bar = element('div', 'qa-curation-review-bar');
      var fill = element('div', 'qa-curation-review-bar-fill');
      fill.style.width = before.toFixed(2) + '%';
      function preview(show) {
        fill.style.width = (show ? after : before).toFixed(2) + '%';
        conceptPreviews.forEach(function(update) { update(show); });
      }
      bar.appendChild(fill);
      explanation.appendChild(bar);
      explanation.appendChild(element('span', 'qa-curation-review-numbers',
        'Current ' + before.toFixed(1) + '% → With change ' + after.toFixed(1) + '%'));
      var matched = row.ids.map(function(id) { return session.eligible.find(function(c) { return c.id === id; }); }).filter(Boolean);
      var counts = new Map();
      session.rows.forEach(function(r) {
        if (session.choices.has(r.fileName)) r.ids.forEach(function(id) {
          counts.set(id, (counts.get(id) || 0) + 1);
        });
      });
      // Compare like-for-like concepts within each group and role, not raw
      // counts across unrelated concepts. This is descriptive, not a target.
      var conceptPreviews = [];
      var shown = matched.filter(function(c) { return c.role === 'core'; }).slice(0, 4);
      if (!shown.length) shown = matched.slice(0, 4);
      shown.forEach(function(c) {
        var count = counts.get(c.id) || 0;
        var projected = count + (included ? -1 : 1);
        var max = Math.max(1, c.count);
        var peers = session.eligible.filter(function(p) {
          return p.group === c.group && p.role === c.role;
        });
        var line = element('div', 'qa-curation-review-concept');
        line.appendChild(element('strong', '', c.label));
        var meter = element('div', 'qa-curation-review-concept-meter');
        var fill = element('div', 'qa-curation-review-concept-fill');
        meter.appendChild(fill);
        line.appendChild(meter);
        var countLabel = element('span', '', '');
        line.appendChild(countLabel);
        function update(show) {
          var n = show ? projected : count;
          var relative = strength(n, c.role) / strength(max, c.role);
          var peerMean = peers.reduce(function(sum, p) {
            var peerCount = (counts.get(p.id) || 0) +
              (show && row.ids.includes(p.id) ? (included ? -1 : 1) : 0);
            return sum + strength(peerCount, p.role) / strength(Math.max(1, p.count), p.role);
          }, 0) / peers.length;
          // Border intensity indicates relative divergence, not a hard failure.
          var divergence = peers.length > 1 ? Math.abs(relative - peerMean) : 0;
          meter.style.setProperty('--curate-divergence', Math.min(0.75, divergence).toFixed(3));
          fill.style.width = (100 * n / max) + '%';
          countLabel.textContent = n + ' / ' + max;
        }
        update(false);
        conceptPreviews.push(update);
        explanation.appendChild(line);
      });
      if (!matched.length) explanation.appendChild(element('span', '', 'No prioritized concepts'));
      explanation.appendChild(element('small', '', 'Bars show representation among available items, not an ideal target or visual quality.'));
      var actions = element('div', 'qa-curation-review-actions');
      var prev = button('← Previous', function() { next(-1); }, 'qa-curation-review-previous'); prev.disabled = cursor === 0; actions.appendChild(prev);
      var decision = button(included ? 'Remove' : 'Include', function() {
        if (included) session.choices.delete(name); else session.choices.add(name);
        session.preset = 'custom';
        if (autoNext && cursor < items.length - 1) cursor += 1;
        saveDraft();
        render();
      }, 'qa-curation-review-decision');
      decision.addEventListener('mouseenter', function() { preview(true); });
      decision.addEventListener('mouseleave', function() { preview(false); });
      decision.addEventListener('focus', function() { preview(true); });
      decision.addEventListener('blur', function() { preview(false); });
      actions.appendChild(decision);
      var forward = button('Next →', function() { next(1); }, 'qa-curation-review-next');
      forward.disabled = cursor === items.length - 1; actions.appendChild(forward);
      var option = element('label', 'qa-curation-review-option');
      var checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.checked = autoNext;
      checkbox.onchange = function() { autoNext = checkbox.checked; };
      option.appendChild(checkbox); option.appendChild(element('span', '', 'Auto-advance'));
      actions.appendChild(option);
      panel.appendChild(explanation);
      // Navigation stays below both columns, independent of per-item evidence height.
      panel.appendChild(actions);
      if (retainedFocus === 'qa-curation-review-decision') decision.focus();
      else if (retainedFocus === 'qa-curation-review-previous' && !prev.disabled) prev.focus();
      else if (retainedFocus === 'qa-curation-review-next' && !forward.disabled) forward.focus();
    }
    document.body.appendChild(overlay);
    document.addEventListener('keydown', keydown);
    render();
    panel.querySelector('button').focus();
  }

  function showProposal(host) {
    var title = element('h2', 'qa-curation-heading', 'Your training shortlist');
    host.appendChild(title);
    var counters = element('div', 'qa-curation-metrics');
    [
      ['Selected', 'selected'], ['Evidence coverage', 'coverage'], ['Represented concepts', 'variations']
    ].forEach(function (entry) {
      var tile = element('div', 'qa-curation-metric');
      tile.appendChild(element('strong', '', '0')).setAttribute('data-curation-' + entry[1], '');
      tile.appendChild(element('span', '', entry[0]));
      counters.appendChild(tile);
    });
    host.appendChild(counters);
    var progress = element('progress', 'qa-curation-progress');
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute('data-curation-bar', '');
    progress.setAttribute('aria-label', 'Weighted concept evidence represented');
    host.appendChild(progress);
    host.appendChild(element('p', 'qa-curation-helper',
      'Coverage is measured against available annotated evidence, not predicted LoRA accuracy.'));
    host.appendChild(element('p', 'qa-curation-summary', session.summary));
    if (session.status) host.appendChild(element('p', 'qa-curation-helper', session.status));
    var drift = session.drift || currentDrift();
    if (drift.changed.length || drift.missing.length) {
      var driftText = 'Saved recommendation retained · ' + drift.changed.length +
        ' image(s) changed supporting evidence' + (drift.missing.length
          ? ' · ' + drift.missing.length + ' source file(s) missing' : '') +
        '. Reanalyze only if you want new Director priorities.';
      host.appendChild(element('p', 'qa-curation-drift', driftText));
      var driftDetails = element('details','qa-curation-drift-files');
      driftDetails.appendChild(element('summary','', 'Review affected filenames'));
      driftDetails.appendChild(element('p','', drift.changed.map(function(change) {
        return change.file + ' (' + change.fields.join(', ') + ' changed)';
      }).concat(drift.missing.map(function(file) {
        return file + ' (missing source)';
      })).join(' · ')));
      host.appendChild(driftDetails);
    }

    var priorities = element('section', 'qa-curation-priorities');
    priorities.appendChild(element('h3', '', 'Balance priorities'));
    priorities.appendChild(element('p', 'qa-curation-helper',
      'Director suggestions are preselected. Check groups whose variations should drive the shortlist; other Director concepts remain supporting variation.'));
    var groupChoices = element('div', 'qa-curation-balance-groups');
    session.availableGroups.forEach(function (group) {
      var label = element('label', 'qa-curation-balance-choice');
      var toggle = element('input');
      toggle.type = 'checkbox';
      toggle.checked = session.balanceGroups.has(group);
      toggle.setAttribute('data-curation-balance-group', group);
      toggle.setAttribute('aria-label', 'Prioritize balancing ' + group);
      toggle.onchange = function () {
        session.overriddenGroups.add(group);
        session.concepts.filter(function (concept) { return concept.group === group; }).forEach(function (concept) {
          session.conceptRoles.delete(concept.id);
        });
        if (toggle.checked) session.balanceGroups.add(group);
        else session.balanceGroups.delete(group);
        applyBalancePriorities();
        saveDraft();
        renderQaCuration(host, session.signature);
      };
      label.appendChild(toggle);
      label.appendChild(element('span', '', group));
      groupChoices.appendChild(label);
    });
    priorities.appendChild(groupChoices);
    var conceptDetails = element('details', 'qa-curation-concept-controls');
    var conceptSummary = element('summary', '', 'Fine-tune concepts · Balance / Supporting / Ignore');
    conceptDetails.appendChild(conceptSummary);
    var conceptChoices = element('div', 'qa-curation-concept-choices');
    var eligibleById = new Map(session.eligible.map(function (feature) { return [feature.id, feature]; }));
    session.concepts.forEach(function (concept) {
      var current = eligibleById.get(concept.id);
      var control = element('label', 'qa-curation-concept-choice');
      var name = element('span', '', concept.group + ' · ' + concept.term + ' (' + concept.count + ')');
      var select = element('select');
      [['core', 'Balance'], ['supporting', 'Supporting'], ['ignore', 'Ignore']].forEach(function (choice) {
        var option = element('option', '', choice[1]);
        option.value = choice[0];
        select.appendChild(option);
      });
      select.value = current ? current.role : 'ignore';
      select.setAttribute('aria-label', 'Priority for ' + concept.group + ': ' + concept.term);
      select.onchange = function () {
        session.conceptRoles.set(concept.id, select.value);
        applyBalancePriorities();
        saveDraft();
        renderQaCuration(host, session.signature);
        var nextDetails = host.querySelector('.qa-curation-concept-controls');
        if (nextDetails) nextDetails.open = true;
      };
      control.appendChild(name);
      control.appendChild(select);
      conceptChoices.appendChild(control);
    });
    conceptDetails.appendChild(conceptChoices);
    priorities.appendChild(conceptDetails);
    if (session.preset === 'custom') priorities.appendChild(element('p', 'qa-curation-helper',
      'Manual image selections are preserved. Choose Lean, Balanced, or Broad to apply the new ranking.'));
    host.appendChild(priorities);
    var coreFeatures = session.eligible.filter(function(c) {
      return session.balanceGroups.has(c.group);
    }).sort(function(a,b) {
      return a.group.localeCompare(b.group) || a.label.localeCompare(b.label);
    });
    if (!coreFeatures.length) coreFeatures = session.eligible.filter(function(c) {return c.role==='core';})
      .sort(function(a,b) {return a.group.localeCompare(b.group) || a.label.localeCompare(b.label);});
    host.appendChild(element('h3','', 'Priority-group representation · Selected / Available'));
    host.appendChild(element('p','qa-curation-helper',
      'Every prioritized concept is shown. This is observed coverage, not an equal-quota target or predicted LoRA accuracy.'));
    var conceptGrid = element('div', 'qa-curation-concepts');
    coreFeatures.forEach(function (feature) {
      var cell = element('div','qa-curation-concept');
      cell.setAttribute('data-curation-concept',feature.id);
      var heading = element('div','qa-curation-concept-heading');
      heading.appendChild(element('span','', feature.group + ' · ' + feature.label +
        (feature.role === 'core' ? ' (priority)' : ' (supporting)')));
      var total = element('strong','','0/' + feature.count);
      total.setAttribute('data-curation-concept-count','');
      heading.appendChild(total);
      cell.appendChild(heading);
      var meter = element('progress','qa-curation-concept-progress');
      meter.max=100;meter.value=0;
      meter.setAttribute('aria-label',feature.label + ' evidence coverage');
      cell.appendChild(meter);
      conceptGrid.appendChild(cell);
    });
    host.appendChild(conceptGrid);
    var matrixGroups = session.pairGroups.slice();
    var availablePairGroups = prioritizedTaggedGroups();
    if (matrixGroups.length === 2) {
      var approvedIds = new Set(session.concepts.filter(function(c) {
        return c.source === 'tag';
      }).map(function(c) {return c.id;}));
      var first = session.eligible.filter(function(c) {
        return c.group === matrixGroups[0] && approvedIds.has(c.id);
      });
      var second = session.eligible.filter(function(c) {
        return c.group === matrixGroups[1] && approvedIds.has(c.id);
      });
      if (first.length && second.length) {
        var matrix = element('details','qa-curation-pair');
        matrix.appendChild(element('summary','',
          'Cross-category coverage · '+matrixGroups[0]+' × '+matrixGroups[1]));
        matrix.appendChild(element('p','qa-curation-helper',
          'These two groups drive the small pairwise ranking bonus. Observed tags only; no equal quotas.'));
        var selectors = element('div','qa-curation-pair-axes');
        [0,1].forEach(function(index) {
          var label = element('label','',index === 0 ? 'First group' : 'Second group');
          var select = element('select','qa-curation-pair-select');
          select.setAttribute('data-curation-pair-axis',String(index));
          availablePairGroups.forEach(function(group) {
            var option = element('option','',group);
            option.value = group;
            select.appendChild(option);
          });
          select.value = matrixGroups[index];
          select.onchange = function() {
            var next = session.pairGroups.slice();
            var old = next[index];
            next[index] = select.value;
            if (next[index] === next[1-index]) next[1-index] = old; // Swap, never silently collapse to one axis.
            session.pairGroups = next;
            applyBalancePriorities();
            saveDraft();
            renderQaCuration(host,session.signature);
            var details = host.querySelector('.qa-curation-pair');
            if (details) details.open = true;
          };
          label.appendChild(select);
          selectors.appendChild(label);
        });
        matrix.appendChild(selectors);
        var scroll = element('div','qa-curation-pair-scroll');
        var table = element('table','qa-curation-pair-table');
        var head = element('tr');
        head.appendChild(element('th','',matrixGroups[0]+' / '+matrixGroups[1]));
        second.forEach(function(c) {head.appendChild(element('th','',c.label));});
        table.appendChild(head);
        first.forEach(function(left) {
          var line = element('tr');
          line.appendChild(element('th','',left.label));
          second.forEach(function(right) {
            var found = 0, selected = 0;
            session.rows.forEach(function(row) {
              if (row.ids.includes(left.id) && row.ids.includes(right.id)) {
                found += 1;
                if (session.choices.has(row.fileName)) selected += 1;
              }
            });
            var pairCell = element('td','',selected+' / '+found);
            pairCell.setAttribute('data-curation-pair-left',left.id);
            pairCell.setAttribute('data-curation-pair-right',right.id);
            pairCell.setAttribute('data-curation-pair-total',String(found));
            line.appendChild(pairCell);
          });
          table.appendChild(line);
        });
        scroll.appendChild(table);
        matrix.appendChild(scroll);
        host.appendChild(matrix);
      }
    }
    if (session.ignored) host.appendChild(element('p', 'qa-curation-helper',
      session.ignored + ' uncommon or redundant labels fell outside the Director inventory; they were not scored.'));
    if (session.missingSight) host.appendChild(element('p', 'qa-curation-helper',
      session.missingSight + ' images have no cached Sight; saved tags still contribute.'));

    var presets = element('div', 'qa-curation-controls');
    ['lean', 'balanced', 'broad'].forEach(function (name) {
      var active = session.preset === name;
      var control = button(name[0].toUpperCase() + name.slice(1) + ' · ' + session.sizes[name],
        function () {
          session.preset = name;
          session.choices = new Set(session.order.slice(0, session.sizes[name]));
          saveDraft();
          renderQaCuration(host, session.signature);
        }, 'review-captions-btn' + (active ? ' qa-curation-active' : ''));
      control.setAttribute('aria-pressed', active ? 'true' : 'false');
      presets.appendChild(control);
    });
    host.appendChild(presets);
    host.appendChild(element('p','qa-curation-helper',
      'Lean / Balanced / Broad choose progressively larger subsets where additional concept coverage tapers off. Balanced is not an equal-category quota. Higher source resolution breaks near-ties; it does not replace useful concept coverage.'));

    host.appendChild(button('Reset selections to original recommendation', function() {
      session.choices = new Set(session.initialChoices);
      session.preset = 'custom';
      saveDraft();
      renderQaCuration(host, session.signature);
    }));
    var reviews = element('div', 'qa-curation-controls');
    reviews.appendChild(button('Review included · Full screen', function() {
      openCurateReview(host, 'selected');
    }, 'qa-curation-primary'));
    reviews.appendChild(button('Review excluded · Full screen', function() {
      openCurateReview(host, 'excluded');
    }));
    if (session.reviewReturn) {
      reviews.appendChild(button('Resume review', function() {
        openCurateReview(host,session.reviewReturn.group,session.reviewReturn.cursor);
      }));
    }
    host.appendChild(reviews);
    var controls = element('div', 'qa-curation-controls');
    ['selected', 'all'].forEach(function (filter) {
      var ctl = button(filter === 'selected' ? 'Selected' : 'All images',
        function () { session.filter = filter; session.limit = 72; renderQaCuration(host, session.signature); },
        'review-captions-btn' + (session.filter === filter ? ' qa-curation-active' : ''));
      ctl.setAttribute('aria-pressed', session.filter === filter ? 'true' : 'false');
      controls.appendChild(ctl);
    });
    host.appendChild(controls);
    var galleryFilters = element('div','qa-curation-gallery-filters');
    var groupLabel = element('label','', 'Inspect group ');
    var groupSelect = element('select','qa-curation-group-select');
    var allOption = element('option','', 'All prioritized groups · Selection rank');
    allOption.value = '';
    groupSelect.appendChild(allOption);
    session.availableGroups.forEach(function(group) {
      var option = element('option','',group);
      option.value = group;
      groupSelect.appendChild(option);
    });
    groupSelect.value = session.galleryGroup || '';
    groupSelect.onchange = function() {
      session.galleryGroup = groupSelect.value;
      session.limit = 72;
      renderQaCuration(host,session.signature);
    };
    groupLabel.appendChild(groupSelect);
    galleryFilters.appendChild(groupLabel);
    galleryFilters.appendChild(element('span','qa-curation-helper',
      'Default order is recommendation rank, not alphabetical or random.'));
    host.appendChild(galleryFilters);
    var images = session.filter === 'selected'
      ? session.order.filter(function (file) { return session.choices.has(file); })
      : session.order;
    if (session.galleryGroup) {
      var ids = new Set(session.eligible.filter(function(feature) {
        return feature.group === session.galleryGroup;
      }).map(function(feature) {return feature.id;}));
      images = images.filter(function(file) {
        var row = session.rows.find(function(item) {return item.fileName === file;});
        return row && row.ids.some(function(id) {return ids.has(id);});
      });
    }
    var grid = element('div', 'qa-curation-grid');
    var byFile = new Map(session.rows.map(function (row) { return [row.fileName, row]; }));
    images.slice(0, session.limit).forEach(function (fileName) {
      var row = byFile.get(fileName), checked = session.choices.has(fileName);
      var card = element('label', 'qa-curation-card' + (checked ? ' is-selected' : ''));
      var source = mediaGridMediaUrl({fileName: fileName, key: fileName});
      if (isPreviewVideoFileName(fileName)) {
        var video = element('video', 'qa-curation-thumb');
        video.src = source;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        card.appendChild(video);
      } else {
        var image = element('img', 'qa-curation-thumb');
        image.src = source;
        image.loading = 'lazy';
        image.alt = fileName;
        card.appendChild(image);
      }
      var foot = element('div', 'qa-curation-tile-foot');
      var input = element('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.setAttribute('aria-label', 'Include ' + fileName);
      input.onchange = function () {
        if (input.checked) session.choices.add(fileName);
        else session.choices.delete(fileName);
        session.preset = 'custom';
        saveDraft();
        card.classList.toggle('is-selected', input.checked);
        updateStats(host);
        if (session.filter === 'selected' && !input.checked) {
          card.remove();
        }
      };
      foot.appendChild(input);
      foot.appendChild(element('span', 'qa-curation-filename', fileName));
      card.appendChild(foot);
      card.appendChild(element('div','qa-curation-card-rank',
        'Recommendation rank #' + (session.order.indexOf(fileName) + 1) +
        ' of ' + session.order.length));
      var features = row.ids.map(function(id) {
        return session.eligible.find(function(concept) { return concept.id === id; });
      }).filter(Boolean);
      var primary = features.find(function(feature) { return feature.role === 'core'; });
      if (!primary) primary = features[0];
      var chip = element('div', 'qa-curation-card-insight',
        primary ? (primary.role === 'core' ? 'Core · ' : 'Variation · ') + primary.label
          : 'No prioritized concept');
      chip.title = features.map(function(feature) {
        return feature.group + ': ' + feature.label;
      }).join(' · ');
      card.appendChild(chip);
      card.appendChild(element('div','qa-curation-card-resolution',resolutionText(row)));
      var without = new Set(session.choices);
      var included = without.has(fileName);
      if (included) without.delete(fileName); else without.add(fileName);
      var contribution = Math.abs((coverage(session.rows,session.eligible,without).ratio -
        coverage(session.rows,session.eligible,session.choices).ratio) * 100);
      var reason = element('div','qa-curation-card-insight',
        (included ? 'Keeping contributes ' : 'Including would add ') +
        contribution.toFixed(2) + ' coverage points');
      reason.setAttribute('data-curation-contribution',fileName);
      card.appendChild(reason);
      var inspect = button('Inspect item', function(event) {
        event.preventDefault();
        event.stopPropagation();
        window.qaInspectCurationItem(fileName);
      }, 'qa-curation-inspect');
      card.appendChild(inspect);
      grid.appendChild(card);
    });
    host.appendChild(grid);
    if (images.length > session.limit) {
      host.appendChild(button('Show more · ' + (images.length - session.limit) + ' remaining',
        function () { session.limit += 72; renderQaCuration(host, session.signature); }));
    }
    var actions = element('div', 'qa-curation-actions');
    var train = button('Use for Training · ' + selectedCount() + ' items', function () {
      var chosen = session.order.filter(function (file) { return session.choices.has(file); });
      if (!chosen.length) throw new Error('Select at least one item before training.');
      if (String(state.folder || '') !== session.folder) {
        throw new Error('The source Set changed; return to the original Set to train this selection.');
      }
      var available = new Set((state.items || []).map(function(item) {return item.fileName;}));
      var missing = chosen.filter(function(file) {return !available.has(file);});
      if (missing.length) {
        throw new Error('Some selected source media no longer exists: ' + missing.join(', '));
      }
      var label = session.preset === 'custom'
        ? 'Custom' : session.preset[0].toUpperCase() + session.preset.slice(1);
      window.qaUseCuratedSelectionForTraining(chosen, 'QA Curate · ' + label);
    }, 'review-captions-btn qa-curation-primary');
    train.setAttribute('data-curation-train', '');
    actions.appendChild(train);
    host.appendChild(actions);
    updateStats(host);
  }

  function renderQaCuration(host, signature) {
    if (!host) throw new Error('QA curation requires the QA workbench root.');
    clearNode(host);
    var header = element('div', 'qa-curation-header');
    header.appendChild(button('← Quality Assurance', function () {
      if (session.phase === 'analyzing') stopQaCuration();
      window.qaShowOverviewFromCuration();
    }));
    header.appendChild(element('span', '', 'Training Set Curation'));
    if (session.phase === 'ready') {
      header.appendChild(button('Reanalyze', function() { window.qaReanalyzeCuration(); }));
    }
    host.appendChild(header);
    if (String(state.folder || '') !== session.folder) {
      host.appendChild(element('p', 'qa-curation-status', 'The training selection changed. Return to QA and analyze it again.'));
      return;
    }
    if (session.phase === 'ready') session.drift = currentDrift();
    if (session.phase === 'legacy') {
      host.appendChild(element('h2', 'qa-curation-heading', 'Saved selections from an older Curate draft'));
      host.appendChild(element('p', 'qa-curation-status', session.status));
      host.appendChild(element('p', 'qa-curation-helper', session.choices.size +
        ' selected filenames are retained. Older drafts did not save enough evidence to reconstruct their original ranking.'));
      host.appendChild(button('Use saved selections for Training', function() {
        var files = Array.from(session.choices);
        if (!files.length) throw new Error('No selected items in the saved Curate draft.');
        var available = new Set((state.items || []).map(function(item) {return item.fileName;}));
        var missing = files.filter(function(name) {return !available.has(name);});
        if (missing.length) throw new Error('Selected media no longer exists: '+missing.join(', '));
        window.qaUseCuratedSelectionForTraining(files,'QA Curate · Saved selection');
      }, 'qa-curation-primary'));
      host.appendChild(button('Reanalyze for updated recommendations', function() { window.qaReanalyzeCuration(); }));
      return;
    }
    if (session.phase !== 'ready') {
      host.appendChild(element('h2', 'qa-curation-heading',
        session.phase === 'failed' ? 'Curation failed' : 'Finding the useful variation'));
      host.appendChild(element('p', 'qa-curation-status', session.error || session.status));
      if (session.phase === 'analyzing') {
        var loading = element('progress', 'qa-curation-progress');
        loading.removeAttribute('value');
        host.appendChild(loading);
        host.appendChild(button('Stop analysis', stopQaCuration));
      } else if (session.phase === 'failed') {
        host.appendChild(button('Try again', function () { startQaCuration(session.input, session.focus, session.signature); }));
      }
      return;
    }
    showProposal(host);
  }

  function renderCurrent() {
    var host = document.getElementById('qa-workbench');
    if (host) renderQaCuration(host, qaCurrentCurationSignature());
  }

  function request(url, payload) {
    return fetch(url, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || result.ok !== true) throw new Error(result.error || 'QA curation request failed.');
        return result;
      });
    });
  }

  function poll(jobId, token) {
    if (token !== session.token) return Promise.resolve(null);
    return fetch('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1').then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Director polling failed.');
        return payload.job;
      });
    }).then(function (job) {
      if (token !== session.token) return null;
      if (job.status === 'completed') return job;
      if (['failed', 'cancelled', 'stopped', 'interrupted'].includes(job.status)) {
        throw new Error(job.error || ('Director ' + job.status));
      }
      session.status = job.status === 'queued' ? 'Director queued · waiting for available runtime'
        : 'Director interpreting training concepts…';
      renderCurrent();
      return new Promise(function (resolve) { setTimeout(resolve, 1800); })
        .then(function () { return poll(jobId, token); });
    });
  }

  function stopQaCuration() {
    session.token += 1;
    var jobId = session.jobId;
    session.jobId = '';
    if (session.previousDraft) {
      restoreDraft(session.previousDraft);
      session.previousDraft = null;
      session.status = 'Reanalysis stopped; previous curation preserved.';
    } else {
      session.phase = 'stopped';
      session.status = 'Analysis stopped.';
    }
    if (jobId) request('/fs/director/job', {operation:'cancel_job',jobId:jobId})
      .catch(function (err) { window.reportConsoleError('QA Curation · Stop Director', err); });
    renderCurrent();
  }

  function startQaCuration(items, focus, signature, options) {
    var reanalyze = !!(options && options.reanalyze);
    if (!reanalyze && session.phase === 'ready' && session.folder === String(state.folder || '')) {
      window.qaShowCuration();
      renderCurrent();
      return;
    }
    var previousDraft = reanalyze && session.phase === 'ready' ? draftPayload() : null;
    session.previousDraft = previousDraft;
    var priorChoices = reanalyze && session.folder === String(state.folder || '')
      ? new Set(session.choices) : null;
    var priorPreset = reanalyze ? session.preset : '';
    var token = ++session.token;
    var inventory = buildInventory(items);
    var model = String(getDirectorModelPreference() || '').trim();
    session.input = items;
    session.focus = String(focus || '');
    session.folder = String(state.folder || '');
    session.signature = signature;
    session.phase = 'analyzing';
    session.rows = inventory.rows;
    session.concepts = inventory.concepts;
    captureEvidence(items);
    session.ignored = inventory.ignored;
    session.analysis = null;
    session.choices = new Set();
    session.initialChoices = [];
    session.preset = 'balanced';
    session.balanceGroups = new Set();
    session.overriddenGroups = new Set();
    session.conceptRoles = new Map();
    session.pairGroups = [];
    session.availableGroups = Array.from(new Set(session.concepts.map(function (c) { return c.group; }))).sort();
    session.missingSight = inventory.rows.filter(function (row) {return !row.analysis.visionSight;}).length;
    session.status = 'Step 1/3 · Indexed ' + items.length + ' images into ' + inventory.concepts.length + ' candidate concepts.';
    session.error = '';
    session.jobId = '';
    session.draftStale = false;
    session.galleryGroup = '';
    window.qaShowCuration();
    renderCurrent();
    if (reanalyze) {
      if (!model) {
        if (previousDraft) {
          restoreDraft(previousDraft);
          session.status = 'No Director model selected. Your saved curation is unchanged.';
        } else {
          session.phase = 'failed';
          session.error = 'Choose a Director model for QA Curation.';
        }
        renderCurrent();
        return;
      }
      beginDirector();
      return;
    }
    draftWrite.catch(function() {}).then(function() {
      return fetch('/fs/qa/curate/draft?folder=' + encodeURIComponent(session.folder));
    }).then(function(resp) {
      return resp.json().then(function(body) {
        if (!resp.ok || !body.ok) throw new Error(body.error || 'Curate draft read failed.');
        return body.draft;
      });
    }).then(function(draft) {
      if (token !== session.token) return null;
      if (restoreDraft(draft)) { renderCurrent(); return null; }
      if (!model) throw new Error('Choose a Director model for QA Curation.');
      return beginDirector();
    }).catch(function(err) {
      if (token !== session.token) return;
      session.phase = 'failed';
      session.error = String(err.message || err);
      window.reportConsoleError('QA Curate draft',err);
      renderCurrent();
    });
    function beginDirector() {
    if (!session.concepts.length) throw new Error('QA Curation needs grouped annotations or saved visual Sight.');
    session.status = 'Step 2/3 · Asking Director what matters for training…';
    renderCurrent();
    request('/fs/qa/curate', {
      folder: session.folder,
      files: items.map(function (item) {return item.fileName;}),
      trainingFocus: session.focus,
      concepts: session.concepts,
      model: model
    }).then(function (result) {
      if (!result || !result.job || !result.job.jobId) {
        throw new Error('QA Curation did not receive a Director job ID.');
      }
      var receivedId = String(result.job.jobId);
      if (token !== session.token) {
        // Stop may be clicked while enqueue is in flight. The newly created
        // job still needs explicit cancellation even though our UI moved on.
        return request('/fs/director/job', {operation: 'cancel_job', jobId: receivedId})
          .catch(function (err) {
            window.reportConsoleError('QA Curation · Cancel late Director job', err);
          }).then(function () { return null; });
      }
      session.jobId = receivedId;
      return poll(receivedId, token);
    }).then(function (job) {
      if (!job || token !== session.token) return;
      // Director classified the immutable concept inventory submitted with this job.
      // Current captions, tags and view filters may drift while it runs; report
      // the drift after accepting the result rather than wasting the analysis.
      if (String(state.folder || '') !== session.folder) {
        throw new Error('The source Set changed while Director was running.');
      }
      var result = job.result && job.result.analysis;
      if (!result || !Array.isArray(result.coreIds) || !Array.isArray(result.supportingIds))
        throw new Error('Director did not return a validated concept priority analysis.');
      session.status = 'Step 3/3 · Choosing complementary images…';
      renderCurrent();
      session.analysis = result;
      var core = new Set(result.coreIds);
      session.balanceGroups = new Set(session.concepts.filter(function (c) {
        return core.has(c.id);
      }).map(function (c) { return c.group; }));
      session.overriddenGroups = new Set();
      session.conceptRoles = new Map();
      session.preset = ['lean', 'balanced', 'broad'].includes(priorPreset)
        ? priorPreset : 'balanced';
      applyBalancePriorities();
      session.initialChoices = Array.from(session.choices);
      if (priorChoices && priorPreset === 'custom') {
        var currentFiles = new Set(session.rows.map(function(row) { return row.fileName; }));
        session.choices = new Set(Array.from(priorChoices).filter(function(file) {
          return currentFiles.has(file);
        }));
        session.preset = 'custom';
      }
      session.filter = 'selected';
      session.summary = String(result.summary || 'A curated mix of key constructions and supporting variation.');
      session.phase = 'ready';
      session.jobId = '';
      session.previousDraft = null;
      session.draftStale = false;
      saveDraft();
      renderCurrent();
    }).catch(function (err) {
      if (token !== session.token) return;
      if (previousDraft) {
        restoreDraft(previousDraft);
        session.previousDraft = null;
        session.status = 'Reanalysis failed; your previous curation is preserved: ' + String(err && err.message || err);
      } else {
        session.phase = 'failed';
        session.error = String(err && err.message || err);
      }
      window.reportConsoleError('QA Curation', err);
      renderCurrent();
    });
    }
  }

  window.startQaCuration = startQaCuration;
  window.renderQaCuration = renderQaCuration;
  window.stopQaCuration = stopQaCuration;
  window.qaCurationCoverage = coverage;
  window.qaCurationInventory = buildInventory;
  window.qaCurationRank = rank;
})();
