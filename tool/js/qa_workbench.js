(function () {
  var QA_RECOMMENDATION_LIMIT = 10;
  var QA_CATEGORY_ORDER = ['underrepresented', 'overrepresented', 'prune', 'consistency', 'captioning'];
  var QA_CATEGORY_LABELS = {
    underrepresented: 'Underrepresented',
    overrepresented: 'Overrepresented',
    prune: 'Prune & Redundancy',
    consistency: 'Consistency',
    captioning: 'Captioning'
  };
  var QA_CATEGORY_DESCRIPTIONS = {
    underrepresented: 'Concepts too sparse to train reliably.',
    overrepresented: 'Patterns that may crowd out useful variation.',
    prune: 'Likely duplicates or items with weak training value.',
    consistency: 'Suspicious relationships or annotation drift.',
    captioning: 'Vocabulary or caption patterns likely to matter in training.'
  };

  var qaWorkbenchState = {
    view: 'overview',
    trainingFocus: '',
    findings: [],
    deterministicFindings: [],
    aiFindings: [],
    aiSummary: '',
    aiScopeSignature: '',
    deepScanJobId: '',
    deepScanSubmitting: false,
    deepScanStatus: '',
    deepScanInputSignature: '',
    observations: [],
    dispositions: {},
    browseIndex: 0,
    folderKey: '',
    scopeKey: '',
    parentFocusSet: undefined,
    returnFindingId: '',
    statusMessage: '',
    externalAnalysisAttemptKey: '',
    externalAnalysisRunning: false
  };

  function qaCloneFocusSet(focusSet) {
    if (!focusSet || !Array.isArray(focusSet.keys)) return null;
    return {
      keys: focusSet.keys.slice(),
      source: String(focusSet.source || ''),
      reportType: String(focusSet.reportType || '')
    };
  }

  function qaNormalizeLabel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function qaStableId(parts) {
    return parts.map(function (part) {
      return qaNormalizeLabel(part).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }).filter(Boolean).join(':');
  }

  function qaFileCountText(count) {
    return count + ' item' + (count === 1 ? '' : 's');
  }

  function qaPriorityRank(priority) {
    if (priority === 'high') return 3;
    if (priority === 'normal') return 2;
    return 1;
  }

  function qaGetTrainingFileNames() {
    return getVisibleMediaSelectionForTraining();
  }

  function qaGetTrainingItems() {
    var selected = qaGetTrainingFileNames();
    var byName = {};
    (state.items || []).forEach(function (item) {
      if (!item || !item.fileName) return;
      byName[item.fileName] = item;
    });
    return selected.map(function (fileName) { return byName[fileName]; }).filter(Boolean);
  }

  function qaBuildScopeKey(items) {
    return [
      String(state.folder || ''),
      (items || []).map(function (item) { return item.fileName; }).join('\n')
    ].join('\u0001');
  }

  function qaPrimeDeterministicSources(items) {
    var scopeKey = qaBuildScopeKey(items);
    if (!items.length || qaWorkbenchState.externalAnalysisAttemptKey === scopeKey) return;
    qaWorkbenchState.externalAnalysisAttemptKey = scopeKey;

    var scopeFiles = items.map(function (item) {
      return String(item && item.fileName || '');
    }).filter(Boolean);
    var pruneReady = state.pruneCandidatesStatus === 'ready'
      && state.pruneCandidatesFolder === String(state.folder || '')
      && state.pruneCandidatesScopeKey === pruneCandidateScopeKey(scopeFiles);
    var duplicateReady = state.duplicateCandidatesStatus === 'ready'
      && state.duplicateCandidatesFolder === String(state.folder || '')
      && state.duplicateCandidatesScopeKey === duplicateCandidateScopeKey(scopeFiles);
    var jobs = [];

    if (!pruneReady) {
      jobs.push(ensurePruneCandidatesForCurrentFolder(false, scopeFiles).catch(function (err) {
        reportConsoleError('QA · Prune analysis', err);
        return [];
      }));
    }
    if (!duplicateReady) {
      jobs.push(ensureDuplicateCandidatesForCurrentFolder(false, scopeFiles).catch(function (err) {
        reportConsoleError('QA · Duplicate analysis', err);
        return [];
      }));
    }
    if (!jobs.length) return;

    qaWorkbenchState.externalAnalysisRunning = true;
    Promise.all(jobs).then(function () {
      qaWorkbenchState.externalAnalysisRunning = false;
      if (qaBuildScopeKey(qaGetTrainingItems()) !== scopeKey) return;
      renderQaWorkbench(true);
    });
  }

  function qaRequestJson(url, options) {
    return fetch(url, options || {}).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload || payload.ok === false) {
          throw new Error(payload && payload.error ? payload.error : (response.statusText || 'Request failed'));
        }
        return payload;
      });
    });
  }

  function qaBuildCompactAnalysis(item) {
    var metadata = item && item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    var out = {};
    var face = metadata.face_focus && typeof metadata.face_focus === 'object' ? metadata.face_focus : null;
    if (face) {
      out.faceFocus = {
        bucket: String(face.bucket || 'unknown'),
        faceCount: Number(face.face_count || 0),
        largestHeightPct: Number(face.largest_height_pct || 0)
      };
    }
    var pose = metadata.selection_pose && typeof metadata.selection_pose === 'object' ? metadata.selection_pose : null;
    if (pose) {
      out.selectionPose = {
        faceDirection: String(pose.face_direction || 'unknown'),
        expression: String(pose.expression_primary || 'unknown'),
        bodyOrientation: String(pose.body_orientation || 'unknown'),
        poseClass: String(pose.pose_class || 'unknown'),
        armPosition: String(pose.arm_position || 'unknown')
      };
    }
    var complexity = metadata.scene_complexity && typeof metadata.scene_complexity === 'object' ? metadata.scene_complexity : null;
    if (complexity) {
      out.sceneComplexity = {
        bucket: String(complexity.bucket || 'unknown'),
        score: Number(complexity.score || 0)
      };
    }
    var sight = metadata.vision_sight && typeof metadata.vision_sight === 'object' ? metadata.vision_sight : null;
    if (sight && sight.description && sight.inventory) {
      var inventory = sight.inventory && typeof sight.inventory === 'object' ? sight.inventory : {};
      out.visionSight = {
        model: String(sight.model || ''),
        description: String(sight.description || ''),
        inventory: {
          viewpoint: (inventory.viewpoint || []).slice(0, 4),
          position: (inventory.position || []).slice(0, 6),
          things: (inventory.things || []).slice(0, 8),
          colors: (inventory.colors || []).slice(0, 8),
          setting: (inventory.setting || []).slice(0, 4),
          background: (inventory.background || []).slice(0, 4),
          lighting: (inventory.lighting || []).slice(0, 4),
          surface: (inventory.surface || []).slice(0, 4),
          details: (inventory.details || []).slice(0, 8)
        }
      };
    }
    var contextSight = metadata.vision_vocabulary_sight && typeof metadata.vision_vocabulary_sight === 'object'
      ? metadata.vision_vocabulary_sight
      : null;
    if (contextSight && contextSight.caption) {
      out.contextSight = {
        model: String(contextSight.model || ''),
        caption: String(contextSight.caption || ''),
        matches: (Array.isArray(contextSight.matches) ? contextSight.matches : []).slice(0, 16).map(function (match) {
          return {
            group: String(match && match.group || ''),
            terms: (match && Array.isArray(match.terms) ? match.terms : []).slice(0, 16)
          };
        })
      };
    }
    return out;
  }

  function qaBuildDeepScanItems(items) {
    return (items || []).map(function (item) {
      var key = item && item.key;
      return {
        fileName: String(item && item.fileName || ''),
        caption: String(item && item.caption || ''),
        groupedTags: getChecklistAssignmentEntriesForMediaKey(key).map(function (entry) {
          return {
            group: String(entry && entry.requirement || ''),
            term: String(entry && entry.term || '')
          };
        }),
        tags: getTagsForMediaKey(key).slice(),
        analysis: qaBuildCompactAnalysis(item)
      };
    });
  }

  function qaBuildDeepScanSignature(items) {
    return JSON.stringify({
      folder: String(state.folder || ''),
      trainingFocus: qaWorkbenchState.trainingFocus,
      items: qaBuildDeepScanItems(items)
    });
  }

  function qaDeepScanFindingPayload() {
    return qaWorkbenchState.deterministicFindings.map(function (finding) {
      return {
        category: finding.category,
        title: finding.title,
        summary: finding.summary,
        files: (finding.files || []).slice(0, 12)
      };
    });
  }

  function qaNormalizeAiFindings(analysis, model) {
    var rows = analysis && Array.isArray(analysis.findings) ? analysis.findings : [];
    return rows.map(function (finding) {
      var files = Array.isArray(finding.files) ? finding.files.slice() : [];
      var evidence = Array.isArray(finding.evidence) ? finding.evidence.slice(0, 4) : [];
      return {
        id: qaStableId(['ai', finding.category, finding.title].concat(files)),
        category: String(finding.category || 'consistency'),
        priority: String(finding.priority || 'normal'),
        confidence: String(finding.confidence || 'medium'),
        title: String(finding.title || ''),
        summary: String(finding.summary || ''),
        why: String(finding.why || ''),
        files: files,
        facts: [{ value: String(files.length), label: 'affected items' }],
        meta: evidence,
        source: 'ai',
        sourceLabel: 'AI · ' + String(model || 'Director')
      };
    });
  }

  // QA review state is derived data, scoped to the exact inputs that produced it.
  // No media or user-authored Set state is written by this cache.
  function qaSavedReviewKey(signature) {
    return 'webcap.qa.review.v1:' + String(signature || '');
  }

  function qaSaveReview() {
    if (!qaWorkbenchState.deepScanInputSignature) return;
    try {
      localStorage.setItem(qaSavedReviewKey(qaWorkbenchState.deepScanInputSignature), JSON.stringify({
        signature: qaWorkbenchState.deepScanInputSignature,
        aiScopeSignature: qaWorkbenchState.aiScopeSignature,
        aiFindings: qaWorkbenchState.aiFindings,
        aiSummary: qaWorkbenchState.aiSummary,
        dispositions: qaWorkbenchState.dispositions
      }));
    } catch (err) {
      window.reportConsoleError('QA · Save review', err);
      qaWorkbenchState.statusMessage = 'QA review could not be saved locally.';
    }
  }

  function qaRestoreReview(signature) {
    qaWorkbenchState.aiFindings = [];
    qaWorkbenchState.aiSummary = '';
    qaWorkbenchState.aiScopeSignature = '';
    qaWorkbenchState.dispositions = {};
    try {
      var raw = localStorage.getItem(qaSavedReviewKey(signature));
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || saved.signature !== signature) return;
      if (saved.aiScopeSignature === signature && Array.isArray(saved.aiFindings)) {
        qaWorkbenchState.aiFindings = saved.aiFindings;
        qaWorkbenchState.aiSummary = String(saved.aiSummary || '');
        qaWorkbenchState.aiScopeSignature = signature;
      }
      qaWorkbenchState.dispositions = saved.dispositions && typeof saved.dispositions === 'object'
        ? saved.dispositions : {};
    } catch (err) {
      window.reportConsoleError('QA · Restore review', err);
      qaWorkbenchState.statusMessage = 'Saved QA review could not be restored.';
    }
  }

  function qaMergeFindings() {
    var ai = qaWorkbenchState.aiScopeSignature === qaWorkbenchState.deepScanInputSignature
      ? qaWorkbenchState.aiFindings
      : [];
    qaWorkbenchState.findings = qaSortFindings(
      qaWorkbenchState.deterministicFindings.concat(ai)
    );
  }

  function qaWaitForDeepScan(job) {
    if (!job || !job.jobId) throw new Error('QA Deep Scan did not return a queued job.');
    qaWorkbenchState.deepScanJobId = String(job.jobId || '');

    function poll(current) {
      var status = String(current && current.status || '');
      if (status === 'completed') return Promise.resolve(current);
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        var error = new Error(current.error || ('QA Deep Scan job ' + status + '.'));
        error.jobStatus = status;
        throw error;
      }
      return new Promise(function (resolve) {
        setTimeout(resolve, status === 'queued' ? 2000 : 1000);
      }).then(function () {
        return qaRequestJson('/fs/director/job?job=' + encodeURIComponent(qaWorkbenchState.deepScanJobId) + '&consume=1');
      }).then(function (payload) {
        return poll(payload.job);
      });
    }

    return poll(job);
  }

  function qaRunDeepScan() {
    if (qaWorkbenchState.deepScanJobId || qaWorkbenchState.deepScanSubmitting) return;
    var items = qaGetTrainingItems();
    if (!items.length) throw new Error('QA Deep Scan requires at least one training item.');
    var model = String(getDirectorModelPreference() || '').trim();
    if (!model) throw new Error('Select a Director model before running Deep QA Scan.');

    var signature = qaBuildDeepScanSignature(items);
    qaWorkbenchState.deepScanInputSignature = signature;
    qaWorkbenchState.deepScanSubmitting = true;
    qaWorkbenchState.deepScanStatus = 'Starting deep scan…';
    renderQaWorkbench();

    qaRequestJson('/fs/qa/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folder: String(state.folder || ''),
        model: model,
        trainingFocus: qaWorkbenchState.trainingFocus,
        items: qaBuildDeepScanItems(items),
        deterministicFindings: qaDeepScanFindingPayload()
      })
    }).then(function (payload) {
      qaWorkbenchState.deepScanSubmitting = false;
      qaWorkbenchState.deepScanStatus = 'Deep scan running…';
      renderQaWorkbench();
      return qaWaitForDeepScan(payload.job);
    }).then(function (job) {
      qaWorkbenchState.deepScanJobId = '';
      var currentSignature = qaBuildDeepScanSignature(qaGetTrainingItems());
      if (currentSignature !== signature) {
        qaWorkbenchState.deepScanStatus = 'Scan finished, but QA inputs changed; result discarded.';
        renderQaWorkbench();
        return;
      }
      var analysis = job.result && job.result.analysis;
      if (!analysis || !Array.isArray(analysis.findings)) {
        throw new Error('QA Deep Scan completed without structured findings.');
      }
      qaWorkbenchState.aiFindings = qaNormalizeAiFindings(analysis, job.result.model);
      qaWorkbenchState.aiSummary = String(analysis.summary || '');
      qaWorkbenchState.aiScopeSignature = signature;
      qaWorkbenchState.deepScanInputSignature = signature;
      qaSaveReview();
      qaWorkbenchState.deepScanStatus = qaWorkbenchState.aiFindings.length
        ? 'AI added ' + qaWorkbenchState.aiFindings.length + ' finding' + (qaWorkbenchState.aiFindings.length === 1 ? '' : 's') + '.'
        : 'AI scan found nothing useful to add.';
      qaMergeFindings();
      renderQaWorkbench();
    }).catch(function (err) {
      qaWorkbenchState.deepScanSubmitting = false;
      qaWorkbenchState.deepScanJobId = '';
      if (['cancelled', 'stopped', 'interrupted'].indexOf(String(err && err.jobStatus || '')) !== -1) {
        qaWorkbenchState.deepScanStatus = 'Deep scan stopped.';
      } else {
        qaWorkbenchState.deepScanStatus = 'Deep scan failed.';
        window.reportConsoleError('QA Deep Scan', err);
      }
      renderQaWorkbench();
    });
  }

  function qaCancelDeepScan() {
    if (!qaWorkbenchState.deepScanJobId) return;
    var jobId = qaWorkbenchState.deepScanJobId;
    qaWorkbenchState.deepScanStatus = 'Stopping deep scan…';
    renderQaWorkbench();
    qaRequestJson('/fs/director/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'cancel_job', jobId: jobId })
    }).catch(function (err) {
      window.reportConsoleError('QA Deep Scan', err);
    });
  }

  function qaBuildGroupStats(items) {
    var groups = {};
    (items || []).forEach(function (item) {
      if (!item || !item.key) return;
      var entries = getChecklistAssignmentEntriesForMediaKey(item.key);
      var seen = {};
      entries.forEach(function (entry) {
        var group = qaNormalizeLabel(entry && entry.requirement);
        var term = qaNormalizeLabel(entry && entry.term);
        if (!group || !term) return;
        var pairKey = group.toLowerCase() + '\u0001' + term.toLowerCase();
        if (seen[pairKey]) return;
        seen[pairKey] = true;
        if (!groups[group]) groups[group] = { files: {}, terms: {} };
        groups[group].files[item.fileName] = true;
        if (!groups[group].terms[term]) groups[group].terms[term] = { files: {} };
        groups[group].terms[term].files[item.fileName] = true;
      });
    });
    return groups;
  }

  function qaSortedFileNames(lookup) {
    return Object.keys(lookup || {}).sort(function (a, b) { return a.localeCompare(b); });
  }

  function qaBuildUnderrepresentedFindings(items, groupStats) {
    var total = items.length;
    if (total < 12) return [];
    var findings = [];
    Object.keys(groupStats).forEach(function (group) {
      var groupInfo = groupStats[group];
      var groupFiles = qaSortedFileNames(groupInfo.files);
      var termRows = Object.keys(groupInfo.terms).map(function (term) {
        var files = qaSortedFileNames(groupInfo.terms[term].files);
        return { term: term, files: files, count: files.length };
      }).sort(function (a, b) {
        return a.count - b.count || a.term.localeCompare(b.term);
      });

      if (groupFiles.length <= 2 && termRows.length) {
        var labels = termRows.slice(0, 4).map(function (row) {
          return row.term + ' (' + row.count + ')';
        });
        findings.push({
          id: qaStableId(['underrepresented', 'group', group]),
          category: 'underrepresented',
          priority: groupFiles.length === 1 ? 'high' : 'normal',
          confidence: 'high',
          title: group + ' has almost no training support',
          summary: group + ' is represented on only ' + qaFileCountText(groupFiles.length) + ' in a ' + total + '-item training selection.',
          why: 'A concept this sparse is unlikely to become reliably learnable. Keeping the media can still be intentional.',
          files: groupFiles,
          facts: [
            { value: String(groupFiles.length), label: 'matching items' },
            { value: String(total), label: 'training items' }
          ],
          meta: labels
        });
        return;
      }

      var rare = termRows.filter(function (row) { return row.count <= 2; });
      if (!rare.length) return;
      var rareFiles = {};
      rare.forEach(function (row) {
        row.files.forEach(function (fileName) { rareFiles[fileName] = true; });
      });
      var rareSummary = rare.slice(0, 5).map(function (row) {
        return row.term + ' (' + row.count + ')';
      });
      var extra = Math.max(0, rare.length - rareSummary.length);
      findings.push({
        id: qaStableId(['underrepresented', 'terms', group]),
        category: 'underrepresented',
        priority: rare.some(function (row) { return row.count === 1; }) ? 'high' : 'normal',
        confidence: 'high',
        title: group + ' has ' + rare.length + ' weakly supported concept' + (rare.length === 1 ? '' : 's'),
        summary: rareSummary.join(', ') + (extra ? ' +' + extra + ' more' : '') + '.',
        why: 'These labels have too few examples to expect reliable control from training.',
        files: qaSortedFileNames(rareFiles),
        facts: [
          { value: String(rare.length), label: 'sparse concepts' },
          { value: String(total), label: 'training items' }
        ],
        meta: rareSummary
      });
    });
    return findings;
  }

  function qaBuildOverrepresentedFindings(items, groupStats) {
    var total = items.length;
    if (total < 20) return [];
    var findings = [];
    var minimumSupport = Math.max(12, Math.ceil(total * 0.15));
    Object.keys(groupStats).forEach(function (group) {
      var groupInfo = groupStats[group];
      var groupFiles = qaSortedFileNames(groupInfo.files);
      if (groupFiles.length < minimumSupport) return;
      var terms = Object.keys(groupInfo.terms).map(function (term) {
        var files = qaSortedFileNames(groupInfo.terms[term].files);
        return { term: term, files: files, count: files.length };
      }).sort(function (a, b) {
        return b.count - a.count || a.term.localeCompare(b.term);
      });
      if (terms.length < 2) return;
      var top = terms[0];
      var share = top.count / groupFiles.length;
      if (share < 0.75) return;
      findings.push({
        id: qaStableId(['overrepresented', group, top.term]),
        category: 'overrepresented',
        priority: 'normal',
        confidence: share >= 0.9 ? 'high' : 'medium',
        title: top.term + ' dominates ' + group,
        summary: top.term + ' appears on ' + top.count + ' of ' + groupFiles.length + ' items carrying a ' + group + ' annotation (' + Math.round(share * 100) + '%).',
        why: 'This is only worth changing if that dominance crowds out variation you want the model to learn.',
        files: top.files,
        facts: [
          { value: String(top.count), label: 'dominant items' },
          { value: Math.round(share * 100) + '%', label: 'within ' + group }
        ],
        meta: terms.slice(0, 4).map(function (row) { return row.term + ' ' + row.count; })
      });
    });
    return findings;
  }

  function qaBuildAssociationFindings(items) {
    var total = items.length;
    if (total < 20) return [];
    var supports = {};
    var pairSupports = {};
    var filesByKey = {};
    var groupByKey = {};
    var labelByKey = {};

    items.forEach(function (item) {
      var entries = getChecklistAssignmentEntriesForMediaKey(item.key);
      var keys = [];
      var seen = {};
      entries.forEach(function (entry) {
        var group = qaNormalizeLabel(entry && entry.requirement);
        var term = qaNormalizeLabel(entry && entry.term);
        if (!group || !term) return;
        var key = group.toLowerCase() + '\u0001' + term.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        keys.push(key);
        groupByKey[key] = group;
        labelByKey[key] = term;
        supports[key] = (supports[key] || 0) + 1;
        if (!filesByKey[key]) filesByKey[key] = [];
        filesByKey[key].push(item.fileName);
      });
      for (var i = 0; i < keys.length; i += 1) {
        for (var j = i + 1; j < keys.length; j += 1) {
          var left = keys[i];
          var right = keys[j];
          if (groupByKey[left] === groupByKey[right]) continue;
          var pairKey = left < right ? left + '\u0002' + right : right + '\u0002' + left;
          pairSupports[pairKey] = (pairSupports[pairKey] || 0) + 1;
        }
      }
    });

    var candidates = [];
    Object.keys(supports).forEach(function (sourceKey) {
      var sourceSupport = supports[sourceKey];
      if (sourceSupport < 6) return;
      var best = null;
      Object.keys(supports).forEach(function (targetKey) {
        if (sourceKey === targetKey || groupByKey[sourceKey] === groupByKey[targetKey]) return;
        var pairKey = sourceKey < targetKey ? sourceKey + '\u0002' + targetKey : targetKey + '\u0002' + sourceKey;
        var co = pairSupports[pairKey] || 0;
        var confidence = co / sourceSupport;
        var exceptions = sourceSupport - co;
        var targetPrevalence = supports[targetKey] / total;
        if (confidence < 0.9 || confidence >= 1 || exceptions < 1 || exceptions > 2 || targetPrevalence > 0.9) return;
        if (!best || confidence > best.confidence || (confidence === best.confidence && co > best.co)) {
          best = {
            sourceKey: sourceKey,
            targetKey: targetKey,
            sourceSupport: sourceSupport,
            targetSupport: supports[targetKey],
            co: co,
            confidence: confidence,
            exceptions: exceptions
          };
        }
      });
      if (best) candidates.push(best);
    });

    candidates.sort(function (a, b) {
      return b.confidence - a.confidence || b.sourceSupport - a.sourceSupport;
    });

    var seenPairs = {};
    var findings = [];
    candidates.forEach(function (row) {
      var canonical = [row.sourceKey, row.targetKey].sort().join('\u0003');
      if (seenPairs[canonical] || findings.length >= 3) return;
      seenPairs[canonical] = true;
      var sourceFiles = filesByKey[row.sourceKey] || [];
      var targetLookup = {};
      (filesByKey[row.targetKey] || []).forEach(function (fileName) { targetLookup[fileName] = true; });
      var exceptionFiles = sourceFiles.filter(function (fileName) { return !targetLookup[fileName]; });
      var sourceLabel = labelByKey[row.sourceKey];
      var targetLabel = labelByKey[row.targetKey];
      findings.push({
        id: qaStableId(['consistency', sourceLabel, targetLabel]),
        category: 'consistency',
        priority: 'normal',
        confidence: 'high',
        title: sourceLabel + ' almost always appears with ' + targetLabel,
        summary: row.co + ' of ' + row.sourceSupport + ' ' + sourceLabel + ' items also use ' + targetLabel + '; ' + row.exceptions + ' exception' + (row.exceptions === 1 ? '' : 's') + ' stand out.',
        why: 'A near-universal cross-group relationship makes the exceptions worth checking, without assuming they are wrong.',
        files: sourceFiles.slice(),
        facts: [
          { value: Math.round(row.confidence * 100) + '%', label: 'association' },
          { value: String(row.exceptions), label: 'exceptions' }
        ],
        meta: exceptionFiles.slice(0, 4).map(function (fileName) { return 'Exception: ' + fileName; })
      });
    });
    return findings;
  }

  function qaNormalizeCaption(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function qaBuildCaptionFindings(items) {
    var groups = {};
    items.forEach(function (item) {
      var caption = qaNormalizeCaption(item.caption || '');
      if (caption.length < 20) return;
      if (!groups[caption]) groups[caption] = [];
      groups[caption].push(item.fileName);
    });
    var repeated = Object.keys(groups).map(function (caption) {
      return { caption: caption, files: groups[caption] };
    }).filter(function (row) {
      return row.files.length >= 3;
    }).sort(function (a, b) {
      return b.files.length - a.files.length;
    });
    if (!repeated.length) return [];
    var affected = {};
    repeated.forEach(function (row) {
      row.files.forEach(function (fileName) { affected[fileName] = true; });
    });
    return [{
      id: 'captioning:exact-repetition',
      category: 'captioning',
      priority: 'normal',
      confidence: 'high',
      title: repeated.length + ' caption pattern' + (repeated.length === 1 ? '' : 's') + ' repeat exactly',
      summary: qaFileCountText(Object.keys(affected).length) + ' share captions with at least two other items.',
      why: 'Exact repetition can be intentional, but repeated caption text is worth checking for copy/paste residue or lost visual distinctions.',
      files: qaSortedFileNames(affected),
      facts: [
        { value: String(repeated.length), label: 'repeated captions' },
        { value: String(Object.keys(affected).length), label: 'affected items' }
      ],
      meta: repeated.slice(0, 4).map(function (row) { return row.files.length + '× exact caption'; })
    }];
  }

  function qaBuildPruneFindings(items) {
    var scopeFiles = items.map(function (item) { return String(item.fileName || ''); }).filter(Boolean);
    if (state.pruneCandidatesStatus !== 'ready'
        || state.pruneCandidatesFolder !== String(state.folder || '')
        || state.pruneCandidatesScopeKey !== pruneCandidateScopeKey(scopeFiles)) {
      return [];
    }
    var allow = {};
    items.forEach(function (item) { allow[item.fileName] = true; });
    var candidates = (state.pruneCandidates || []).filter(function (candidate) {
      return !!allow[String(candidate && candidate.file || '')];
    });
    if (!candidates.length) return [];
    var blocking = candidates.filter(function (candidate) { return candidate.priority === 'blocking'; });
    var outliers = candidates.filter(function (candidate) { return candidate.priority !== 'blocking'; });
    var findings = [];
    if (blocking.length) {
      findings.push({
        id: 'prune:blocking',
        category: 'prune',
        priority: 'high',
        confidence: 'high',
        title: qaFileCountText(blocking.length) + ' have confirmed technical prune problems',
        summary: 'Prune Candidates already flagged these items as blocking.',
        why: 'These are technical media problems, not aesthetic judgments.',
        files: blocking.map(function (candidate) { return candidate.file; }),
        facts: [{ value: String(blocking.length), label: 'blocking items' }],
        meta: blocking.slice(0, 4).map(function (candidate) {
          var reason = candidate.reasons && candidate.reasons[0];
          return String(reason && reason.message || candidate.kind || candidate.file);
        }),
        utilityTab: 'prune'
      });
    }
    if (outliers.length) {
      findings.push({
        id: 'prune:outliers',
        category: 'prune',
        priority: 'normal',
        confidence: 'high',
        title: qaFileCountText(outliers.length) + ' are technical outliers worth a prune check',
        summary: 'Existing Prune Candidates analysis found media that differs materially from the rest of the current training selection.',
        why: 'Review these as possible low-value or incompatible training inputs.',
        files: outliers.map(function (candidate) { return candidate.file; }),
        facts: [{ value: String(outliers.length), label: 'outliers' }],
        meta: [],
        utilityTab: 'prune'
      });
    }
    return findings;
  }

  function qaBuildDuplicateFindings(items) {
    var scopeFiles = items.map(function (item) { return String(item.fileName || ''); }).filter(Boolean);
    if (state.duplicateCandidatesStatus !== 'ready'
        || state.duplicateCandidatesFolder !== String(state.folder || '')
        || state.duplicateCandidatesScopeKey !== duplicateCandidateScopeKey(scopeFiles)) {
      return [];
    }
    var allow = {};
    items.forEach(function (item) { allow[item.fileName] = true; });
    var groups = (state.duplicateCandidateGroups || []).map(function (group) {
      var filteredItems = (group.items || []).filter(function (item) { return !!allow[String(item && item.file || '')]; });
      return Object.assign({}, group, { items: filteredItems });
    }).filter(function (group) {
      return group.items.length >= 2;
    });
    if (!groups.length) return [];
    var files = {};
    var exact = 0;
    groups.forEach(function (group) {
      if (group.match_type === 'exact') exact += 1;
      group.items.forEach(function (item) { files[item.file] = true; });
    });
    return [{
      id: 'prune:duplicates',
      category: 'prune',
      priority: exact ? 'high' : 'normal',
      confidence: 'high',
      title: groups.length + ' duplicate group' + (groups.length === 1 ? '' : 's') + ' may add redundant training weight',
      summary: qaFileCountText(Object.keys(files).length) + ' are grouped by the existing exact/visual duplicate detector.',
      why: 'Near-identical examples can unintentionally give one visual pattern more weight than intended.',
      files: qaSortedFileNames(files),
      facts: [
        { value: String(groups.length), label: 'duplicate groups' },
        { value: String(Object.keys(files).length), label: 'affected items' }
      ],
      meta: exact ? [exact + ' exact group' + (exact === 1 ? '' : 's')] : [],
      utilityTab: 'duplicates'
    }];
  }

  function qaSightSupportsTerm(metadata, term) {
    var sight = metadata && metadata.vision_sight && typeof metadata.vision_sight === 'object'
      ? metadata.vision_sight
      : null;
    var inventory = sight && sight.inventory && typeof sight.inventory === 'object' ? sight.inventory : null;
    if (!inventory) return false;

    function normalizeList(values) {
      return (Array.isArray(values) ? values : []).map(function (value) {
        return String(value || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
      }).filter(Boolean);
    }

    var wanted = String(term || '').toLowerCase().replace(/[_-]+/g, ' ').trim();
    var viewpointAliases = {
      'side': ['side'],
      'front': ['front'],
      'three quarter': ['three quarter', '3/4'],
      'rear': ['rear', 'back view', 'from behind'],
      'three quarter rear': ['three quarter rear', 'rear three quarter']
    };
    var positionAliases = {
      'standing': ['standing'],
      'sitting': ['sitting', 'seated'],
      'kneeling': ['kneeling', 'crouched'],
      'lying on her back': ['lying on her back', 'reclining'],
      'arms up': ['arms up', 'arms raised', 'both arms up'],
      'one arm up': ['one arm up', 'one arm raised'],
      'arms spread': ['arms spread', 'arms out'],
      'smiling': ['smiling', 'smile'],
      'surprised': ['surprised'],
      'neutral expression': ['neutral expression']
    };
    var source = viewpointAliases[wanted]
      ? normalizeList(inventory.viewpoint)
      : normalizeList(inventory.position);
    var aliases = viewpointAliases[wanted] || positionAliases[wanted] || [];
    return aliases.some(function (alias) {
      return source.some(function (value) { return value === alias || value.indexOf(alias + ' ') === 0; });
    });
  }

  function qaBuildVisualAgreementFindings(items) {
    var buckets = {};
    (items || []).forEach(function (item) {
      if (!item || !item.key || !item.metadata) return;
      var existingTags = getTagsForMediaKey(item.key).slice();
      var suggestions = getSelectionPoseSuggestedTags(item.metadata, existingTags);
      suggestions.forEach(function (term) {
        var groups = getChecklistRequirementsForTag(term);
        if (groups.length !== 1 || !qaSightSupportsTerm(item.metadata, term)) return;
        var key = String(term || '').toLowerCase();
        if (!buckets[key]) buckets[key] = { term: term, groups: groups.slice(), files: [] };
        buckets[key].files.push(item.fileName);
      });
    });
    return Object.keys(buckets).map(function (key) {
      var row = buckets[key];
      return {
        id: qaStableId(['visual-agreement', row.term].concat(row.files)),
        category: 'consistency',
        priority: row.files.length > 1 ? 'high' : 'normal',
        confidence: 'high',
        title: 'Independent visual signals suggest missing "' + row.term + '"',
        summary: qaFileCountText(row.files.length) + ' have matching MediaPipe and Vision evidence but are not tagged "' + row.term + '".',
        why: 'Two independent visual signals agree on a term that already exists in the Set vocabulary, making these strong annotation-review candidates.',
        files: row.files.slice(),
        facts: [
          { value: '2', label: 'agreeing visual sources' },
          { value: String(row.groups[0] || ''), label: 'annotation group' }
        ],
        sourceLabel: 'WebCap + Vision'
      };
    }).slice(0, 6);
  }

  function qaBuildObservations(items) {
    var total = items.length;
    if (total < 30) return [];
    var buckets = {};
    items.forEach(function (item) {
      var aspect = String(item && item.metadata && item.metadata.aspect || '').trim();
      if (!aspect) return;
      var bucket = mapAspectRatioToBucket(aspect);
      if (!bucket) return;
      if (!buckets[bucket]) buckets[bucket] = [];
      buckets[bucket].push(item.fileName);
    });
    return Object.keys(buckets).filter(function (bucket) {
      return buckets[bucket].length > 0 && buckets[bucket].length <= 3;
    }).map(function (bucket) {
      return {
        id: qaStableId(['observation', 'aspect', bucket]),
        title: 'Tiny ' + bucket + ' aspect-ratio cohort',
        summary: qaFileCountText(buckets[bucket].length) + ' use this aspect bucket in a ' + total + '-item training selection.',
        files: buckets[bucket].slice()
      };
    });
  }

  function qaBuildHealth(items) {
    var health = {
      captionless: [],
      incomplete: [],
      unreviewed: [],
      mismatch: [],
      invalidAr: []
    };
    items.forEach(function (item) {
      if (!item.hasCaption) health.captionless.push(item.fileName);
      if (mediaItemHasIncompleteRequirementGroups(item)) health.incomplete.push(item.fileName);
      if (!(state.reviewedSet && state.reviewedSet.has(item.key))) health.unreviewed.push(item.fileName);
      if (mediaItemHasTagMismatch(item)) health.mismatch.push(item.fileName);
      var aspect = String(item && item.metadata && item.metadata.aspect || '').trim();
      if (aspect && !hasSupportedAspectBucket(aspect)) health.invalidAr.push(item.fileName);
    });
    return health;
  }

  function qaSortFindings(findings) {
    return findings.slice().sort(function (a, b) {
      var priority = qaPriorityRank(b.priority) - qaPriorityRank(a.priority);
      if (priority) return priority;
      var ai = QA_CATEGORY_ORDER.indexOf(a.category);
      var bi = QA_CATEGORY_ORDER.indexOf(b.category);
      if (ai !== bi) return ai - bi;
      return a.title.localeCompare(b.title);
    });
  }

  function qaComputeFindings(items) {
    var groups = qaBuildGroupStats(items);
    var findings = []
      .concat(qaBuildUnderrepresentedFindings(items, groups))
      .concat(qaBuildOverrepresentedFindings(items, groups))
      .concat(qaBuildPruneFindings(items))
      .concat(qaBuildDuplicateFindings(items))
      .concat(qaBuildAssociationFindings(items))
      .concat(qaBuildVisualAgreementFindings(items))
      .concat(qaBuildCaptionFindings(items));
    return {
      findings: qaSortFindings(findings),
      observations: qaBuildObservations(items),
      health: qaBuildHealth(items)
    };
  }

  function qaGetRecommendations() {
    return qaWorkbenchState.findings.slice(0, QA_RECOMMENDATION_LIMIT);
  }

  function qaGetUndisposedRecommendationIndexes() {
    var recommendations = qaGetRecommendations();
    var indexes = [];
    recommendations.forEach(function (finding, index) {
      if (!qaWorkbenchState.dispositions[finding.id]) indexes.push(index);
    });
    return indexes;
  }

  function qaDispositionLabel(value) {
    if (value === 'keep') return 'Kept intentionally';
    if (value === 'skip') return 'Skipped for now';
    return '';
  }

  function qaSetView(view) {
    qaWorkbenchState.view = ['overview', 'browse', 'report'].indexOf(view) !== -1 ? view : 'overview';
    renderQaWorkbench();
  }

  function qaOpenUtility(tab) {
    setReviewDetailTab(tab);
  }

  function qaCreateButton(label, className, action, value) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className || '';
    button.textContent = label;
    if (action) button.setAttribute('data-qa-action', action);
    if (value !== undefined) button.setAttribute('data-qa-value', String(value));
    return button;
  }

  function qaRenderHeader(container, title, subtitle, view) {
    container.innerHTML = '';
    var header = document.createElement('div');
    header.className = 'qa-page-header';
    var copy = document.createElement('div');
    var h1 = document.createElement('h1');
    h1.className = 'qa-page-title';
    h1.textContent = title;
    var scope = document.createElement('div');
    scope.className = 'qa-page-scope';
    scope.textContent = subtitle;
    copy.appendChild(h1);
    copy.appendChild(scope);
    header.appendChild(copy);
    var actions = document.createElement('div');
    actions.className = 'qa-page-actions';
    if (view !== 'overview') actions.appendChild(qaCreateButton('QA Overview', '', 'view', 'overview'));
    if (view !== 'report') actions.appendChild(qaCreateButton('Full Report', '', 'view', 'report'));
    header.appendChild(actions);
    container.appendChild(header);
  }

  function qaRenderTrainingFocus(container) {
    var row = document.createElement('div');
    row.className = 'qa-training-focus';
    var label = document.createElement('span');
    label.className = 'qa-training-focus-label';
    label.textContent = 'Training focus';
    var value = document.createElement('span');
    value.id = 'qa-training-focus-value';
    value.className = 'qa-training-focus-value' + (qaWorkbenchState.trainingFocus ? '' : ' qa-training-focus-empty');
    value.textContent = qaWorkbenchState.trainingFocus || 'Not specified — generic training QA';
    var edit = qaCreateButton('Edit', '', 'edit-focus');
    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(edit);

    var editor = document.createElement('div');
    editor.id = 'qa-training-focus-editor';
    editor.className = 'qa-training-focus-editor hidden';
    var input = document.createElement('input');
    input.id = 'qa-training-focus-input';
    input.type = 'text';
    input.maxLength = 240;
    input.placeholder = 'What are you trying to teach the model?';
    input.value = qaWorkbenchState.trainingFocus;
    editor.appendChild(input);
    editor.appendChild(qaCreateButton('Save', 'qa-primary', 'save-focus'));
    editor.appendChild(qaCreateButton('Cancel', '', 'cancel-focus'));
    row.appendChild(editor);
    container.appendChild(row);
  }

  function qaCategoryCounts(recommendations) {
    var counts = {};
    QA_CATEGORY_ORDER.forEach(function (category) { counts[category] = 0; });
    recommendations.forEach(function (finding) {
      counts[finding.category] = (counts[finding.category] || 0) + 1;
    });
    return counts;
  }

  function qaRenderOverview(container, items, health) {
    qaRenderHeader(container, 'Quality Assurance', qaFileCountText(items.length) + ' in current training selection', 'overview');
    qaRenderTrainingFocus(container);

    var recommendations = qaGetRecommendations();
    var undisposed = recommendations.filter(function (finding) { return !qaWorkbenchState.dispositions[finding.id]; });
    var handled = recommendations.length - undisposed.length;
    var high = recommendations.filter(function (finding) { return finding.priority === 'high'; }).length;

    var hero = document.createElement('section');
    hero.className = 'qa-hero';
    var copy = document.createElement('div');
    copy.className = 'qa-hero-copy';
    var h2 = document.createElement('h2');
    h2.textContent = recommendations.length
      ? recommendations.length + ' recommendation' + (recommendations.length === 1 ? '' : 's') + ' ' + (recommendations.length === 1 ? 'is' : 'are') + ' worth your attention.'
      : 'Nothing prominent needs your attention right now.';
    var intro = document.createElement('p');
    intro.textContent = recommendations.length
      ? 'These are ranked for likely training impact. Browse them one at a time rather than treating QA like a backlog.'
      : 'The full report and existing utilities are still available if you want to dig deeper.';
    copy.appendChild(h2);
    copy.appendChild(intro);
    hero.appendChild(copy);

    var heroActions = document.createElement('div');
    heroActions.className = 'qa-hero-actions';
    if (recommendations.length) heroActions.appendChild(qaCreateButton('Browse Recommendations', 'qa-primary', 'browse-next'));
    var deepWrap = document.createElement('div');
    deepWrap.className = 'qa-deep-scan-wrap';
    var deep = qaCreateButton(
      qaWorkbenchState.deepScanSubmitting ? 'Starting…' : (qaWorkbenchState.deepScanJobId ? 'Stop Deep Scan' : '✦ Deep QA Scan'),
      '',
      qaWorkbenchState.deepScanJobId ? 'deep-scan-stop' : 'deep-scan'
    );
    deep.disabled = qaWorkbenchState.deepScanSubmitting;
    deep.title = 'Optional structured LLM scan of the current training selection';
    deepWrap.appendChild(deep);
    var note = document.createElement('span');
    note.className = 'qa-deep-scan-note';
    note.textContent = qaWorkbenchState.deepScanStatus || (qaWorkbenchState.aiFindings.length ? 'AI findings active · LLM' : 'Optional · LLM');
    deepWrap.appendChild(note);
    heroActions.appendChild(deepWrap);
    hero.appendChild(heroActions);
    container.appendChild(hero);

    var summary = document.createElement('div');
    summary.className = 'qa-summary-line';
    var primary = document.createElement('strong');
    primary.textContent = high + ' high-impact';
    summary.appendChild(primary);
    var normal = document.createElement('span');
    normal.textContent = Math.max(0, recommendations.length - high) + ' normal-priority';
    summary.appendChild(normal);
    var handledEl = document.createElement('span');
    handledEl.textContent = handled + ' handled this session';
    summary.appendChild(handledEl);
    container.appendChild(summary);

    var categorySection = document.createElement('section');
    categorySection.className = 'qa-section';
    var categoryTitle = document.createElement('h2');
    categoryTitle.className = 'qa-section-title';
    categoryTitle.textContent = 'What deserves attention';
    categorySection.appendChild(categoryTitle);
    var grid = document.createElement('div');
    grid.className = 'qa-category-grid';
    var counts = qaCategoryCounts(recommendations);
    QA_CATEGORY_ORDER.forEach(function (category) {
      if (!counts[category]) return;
      var card = qaCreateButton('', 'qa-category-card', 'open-category', category);
      card.setAttribute('data-category', category);
      var count = document.createElement('span');
      count.className = 'qa-category-count';
      count.textContent = counts[category];
      var cardCopy = document.createElement('span');
      cardCopy.className = 'qa-category-copy';
      var title = document.createElement('strong');
      title.textContent = QA_CATEGORY_LABELS[category];
      var description = document.createElement('span');
      description.textContent = QA_CATEGORY_DESCRIPTIONS[category];
      cardCopy.appendChild(title);
      cardCopy.appendChild(description);
      card.appendChild(count);
      card.appendChild(cardCopy);
      grid.appendChild(card);
    });
    if (!grid.children.length) {
      var empty = document.createElement('div');
      empty.className = 'qa-empty';
      empty.textContent = 'No actionable deterministic findings in the current training selection.';
      grid.appendChild(empty);
    }
    categorySection.appendChild(grid);
    container.appendChild(categorySection);

    var healthSection = document.createElement('section');
    healthSection.className = 'qa-section';
    var healthTitle = document.createElement('h2');
    healthTitle.className = 'qa-section-title';
    healthTitle.textContent = 'Dataset health';
    healthSection.appendChild(healthTitle);
    var healthRow = document.createElement('div');
    healthRow.className = 'qa-health-row';
    [
      ['captionless', 'captionless'],
      ['incomplete', 'incomplete'],
      ['unreviewed', 'unreviewed'],
      ['mismatch', 'tag mismatches'],
      ['invalidAr', 'invalid AR']
    ].forEach(function (entry) {
      var files = health[entry[0]] || [];
      var chip = qaCreateButton(files.length + ' ' + entry[1], 'qa-health-chip', 'inspect-health', entry[0]);
      chip.disabled = !files.length;
      healthRow.appendChild(chip);
    });
    healthSection.appendChild(healthRow);
    var healthNote = document.createElement('div');
    healthNote.className = 'qa-health-note';
    healthNote.textContent = 'Useful status, intentionally quieter than training-impact recommendations.';
    healthSection.appendChild(healthNote);
    container.appendChild(healthSection);

    var utilitySection = document.createElement('section');
    utilitySection.className = 'qa-section';
    var utilityTitle = document.createElement('h2');
    utilityTitle.className = 'qa-section-title';
    utilityTitle.textContent = 'Utilities';
    utilitySection.appendChild(utilityTitle);
    var utilityGrid = document.createElement('div');
    utilityGrid.className = 'qa-utility-grid';
    [
      ['Combined Captions', 'Read or copy the current training selection as one caption sheet.', 'captions'],
      ['Metadata Explorer', 'Inspect resolution, aspect ratio, duration and other media facts.', 'metadata'],
      ['Existing Reports', 'Caption analysis, Prune Candidates and Duplicates remain intact.', 'report']
    ].forEach(function (entry) {
      var card = document.createElement('div');
      card.className = 'qa-utility-card';
      var title = document.createElement('strong');
      title.textContent = entry[0];
      var desc = document.createElement('span');
      desc.textContent = entry[1];
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(qaCreateButton(entry[2] === 'report' ? 'Open Reports' : 'Open', '', 'utility', entry[2]));
      utilityGrid.appendChild(card);
    });
    utilitySection.appendChild(utilityGrid);
    container.appendChild(utilitySection);
  }

  function qaCreateEvidenceMedia(fileName) {
    var item = (state.items || []).find(function (row) { return row && row.fileName === fileName; });
    var card = document.createElement('div');
    card.className = 'qa-evidence-media';
    var preview = document.createElement('div');
    preview.className = 'qa-evidence-preview';
    var source = mediaGridMediaUrl({ fileName: fileName, key: item ? item.key : fileName });
    if (isPreviewVideoFileName(fileName)) {
      var video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.src = source;
      preview.appendChild(video);
    } else {
      var image = document.createElement('img');
      image.loading = 'lazy';
      image.src = source;
      image.alt = fileName;
      preview.appendChild(image);
    }
    var name = document.createElement('div');
    name.className = 'qa-evidence-file';
    name.textContent = fileName;
    name.title = fileName;
    card.appendChild(preview);
    card.appendChild(name);
    return card;
  }

  function qaRenderFacts(container, finding) {
    if (!finding.facts || !finding.facts.length) return;
    var row = document.createElement('div');
    row.className = 'qa-fact-row';
    finding.facts.forEach(function (fact) {
      var card = document.createElement('div');
      card.className = 'qa-fact';
      var value = document.createElement('strong');
      value.textContent = fact.value;
      var label = document.createElement('span');
      label.textContent = fact.label;
      card.appendChild(value);
      card.appendChild(label);
      row.appendChild(card);
    });
    container.appendChild(row);
  }

  function qaRenderBrowse(container, items) {
    qaRenderHeader(container, 'Browse Recommendations', qaFileCountText(items.length) + ' · one useful decision at a time', 'browse');
    var recommendations = qaGetRecommendations();
    if (!recommendations.length) {
      var empty = document.createElement('div');
      empty.className = 'qa-empty';
      empty.textContent = 'There are no prominent recommendations to browse.';
      container.appendChild(empty);
      return;
    }
    qaWorkbenchState.browseIndex = Math.max(0, Math.min(qaWorkbenchState.browseIndex, recommendations.length - 1));
    var finding = recommendations[qaWorkbenchState.browseIndex];
    var handled = recommendations.filter(function (row) { return !!qaWorkbenchState.dispositions[row.id]; }).length;

    var progress = document.createElement('div');
    progress.className = 'qa-progress';
    var progressText = document.createElement('strong');
    progressText.textContent = 'Recommendation ' + (qaWorkbenchState.browseIndex + 1) + ' of ' + recommendations.length;
    progress.appendChild(progressText);
    var track = document.createElement('div');
    track.className = 'qa-progress-track';
    var bar = document.createElement('div');
    bar.className = 'qa-progress-bar';
    bar.style.width = Math.round(((qaWorkbenchState.browseIndex + 1) / recommendations.length) * 100) + '%';
    track.appendChild(bar);
    progress.appendChild(track);
    var handledText = document.createElement('span');
    handledText.className = 'qa-muted';
    handledText.textContent = handled + ' handled this session';
    progress.appendChild(handledText);
    container.appendChild(progress);

    var article = document.createElement('article');
    article.className = 'qa-recommendation';
    var eyebrow = document.createElement('div');
    eyebrow.className = 'qa-recommendation-eyebrow';
    eyebrow.textContent = QA_CATEGORY_LABELS[finding.category] + ' · ' + (finding.priority === 'high' ? 'High impact' : 'Recommendation') + ' · ' + finding.confidence + ' confidence' + (finding.sourceLabel ? ' · ' + finding.sourceLabel : '');
    article.appendChild(eyebrow);
    var title = document.createElement('h2');
    title.className = 'qa-recommendation-title';
    title.textContent = finding.title;
    article.appendChild(title);
    var summary = document.createElement('p');
    summary.className = 'qa-recommendation-summary';
    summary.textContent = finding.summary;
    article.appendChild(summary);
    var why = document.createElement('p');
    why.className = 'qa-recommendation-why';
    why.textContent = finding.why;
    article.appendChild(why);
    qaRenderFacts(article, finding);

    if (finding.files && finding.files.length) {
      var evidenceHeading = document.createElement('div');
      evidenceHeading.className = 'qa-evidence-heading';
      var h3 = document.createElement('h3');
      h3.textContent = 'Evidence';
      var note = document.createElement('span');
      note.textContent = finding.files.length > 1 ? 'Scroll through ' + finding.files.length + ' affected items.' : '1 affected item.';
      evidenceHeading.appendChild(h3);
      evidenceHeading.appendChild(note);
      article.appendChild(evidenceHeading);
      var strip = document.createElement('div');
      strip.className = 'qa-evidence-strip';
      finding.files.forEach(function (fileName) { strip.appendChild(qaCreateEvidenceMedia(fileName)); });
      article.appendChild(strip);
    }

    var actions = document.createElement('div');
    actions.className = 'qa-recommendation-actions';
    if (finding.files && finding.files.length) {
      actions.appendChild(qaCreateButton('Inspect ' + finding.files.length, 'qa-primary', 'inspect-finding', finding.id));
    }
    if (finding.utilityTab) {
      actions.appendChild(qaCreateButton('Open ' + (finding.utilityTab === 'duplicates' ? 'Duplicates' : 'Prune Report'), '', 'utility', finding.utilityTab));
    }
    actions.appendChild(qaCreateButton('Keep intentionally', '', 'dispose', 'keep'));
    actions.appendChild(qaCreateButton('Skip for now', '', 'dispose', 'skip'));

    var nav = document.createElement('div');
    nav.className = 'qa-recommendation-nav';
    var previous = qaCreateButton('← Previous', '', 'browse-prev');
    previous.disabled = qaWorkbenchState.browseIndex <= 0;
    nav.appendChild(previous);
    var next = qaCreateButton('Next →', '', 'browse-next-index');
    next.disabled = qaWorkbenchState.browseIndex >= recommendations.length - 1;
    nav.appendChild(next);
    actions.appendChild(nav);
    article.appendChild(actions);

    var status = document.createElement('div');
    status.className = 'qa-recommendation-status';
    var disposition = qaDispositionLabel(qaWorkbenchState.dispositions[finding.id]);
    status.textContent = disposition ? disposition + '. This finding remains in Full Report.' : qaWorkbenchState.statusMessage;
    article.appendChild(status);
    container.appendChild(article);
  }

  function qaRenderReportFinding(container, finding) {
    var article = document.createElement('article');
    article.className = 'qa-report-finding' + (qaWorkbenchState.dispositions[finding.id] ? ' is-disposed' : '');
    var copy = document.createElement('div');
    var title = document.createElement('h3');
    title.textContent = finding.title;
    var summary = document.createElement('p');
    summary.textContent = finding.summary;
    copy.appendChild(title);
    copy.appendChild(summary);
    var meta = document.createElement('div');
    meta.className = 'qa-report-meta';
    [
      finding.priority === 'high' ? 'High impact' : 'Normal priority',
      finding.confidence + ' confidence',
      qaFileCountText((finding.files || []).length),
      finding.sourceLabel || ''
    ].filter(Boolean).concat(finding.meta || []).slice(0, 6).forEach(function (value) {
      var chip = document.createElement('span');
      chip.textContent = value;
      meta.appendChild(chip);
    });
    var disposition = qaDispositionLabel(qaWorkbenchState.dispositions[finding.id]);
    if (disposition) {
      var dispositionChip = document.createElement('span');
      dispositionChip.className = 'qa-report-disposition';
      dispositionChip.textContent = disposition;
      meta.appendChild(dispositionChip);
    }
    copy.appendChild(meta);
    article.appendChild(copy);
    var actions = document.createElement('div');
    actions.className = 'qa-utility-actions';
    var recommendationIndex = qaGetRecommendations().findIndex(function (row) { return row.id === finding.id; });
    if (recommendationIndex !== -1) actions.appendChild(qaCreateButton('Review', 'qa-primary', 'browse-finding', finding.id));
    if (finding.files && finding.files.length) actions.appendChild(qaCreateButton('Inspect ' + finding.files.length, '', 'inspect-finding', finding.id));
    if (finding.utilityTab) actions.appendChild(qaCreateButton('Open Report', '', 'utility', finding.utilityTab));
    article.appendChild(actions);
    container.appendChild(article);
  }

  function qaRenderReport(container, items, health) {
    qaRenderHeader(container, 'Full QA Report', qaFileCountText(items.length) + ' in current training selection', 'report');
    var intro = document.createElement('div');
    intro.className = 'qa-report-header';
    var copy = document.createElement('div');
    copy.className = 'qa-report-copy';
    var h2 = document.createElement('h2');
    h2.className = 'qa-section-title';
    h2.textContent = 'Everything QA currently knows.';
    var p = document.createElement('p');
    p.textContent = 'The recommendation browser is the attention queue. This view keeps findings visible even after you decide to keep or skip them.';
    copy.appendChild(h2);
    copy.appendChild(p);
    intro.appendChild(copy);
    var actions = document.createElement('div');
    actions.className = 'qa-utility-actions';
    if (qaGetRecommendations().length) actions.appendChild(qaCreateButton('Browse Recommendations', 'qa-primary', 'browse-next'));
    actions.appendChild(qaCreateButton('Reset review state', '', 'reset-dispositions'));
    intro.appendChild(actions);
    container.appendChild(intro);

    QA_CATEGORY_ORDER.forEach(function (category) {
      var rows = qaWorkbenchState.findings.filter(function (finding) { return finding.category === category; });
      if (!rows.length) return;
      var section = document.createElement('section');
      section.className = 'qa-report-category';
      var title = document.createElement('h2');
      title.className = 'qa-report-category-title';
      title.textContent = QA_CATEGORY_LABELS[category] + ' · ' + rows.length;
      section.appendChild(title);
      rows.forEach(function (finding) { qaRenderReportFinding(section, finding); });
      container.appendChild(section);
    });

    if (qaWorkbenchState.observations.length) {
      var details = document.createElement('details');
      details.className = 'qa-other-observations';
      var summary = document.createElement('summary');
      summary.textContent = 'Other observations · ' + qaWorkbenchState.observations.length + ' lower-impact signal' + (qaWorkbenchState.observations.length === 1 ? '' : 's');
      details.appendChild(summary);
      var list = document.createElement('div');
      list.className = 'qa-other-observations-list';
      qaWorkbenchState.observations.forEach(function (observation) {
        var row = document.createElement('div');
        row.textContent = observation.title + ' — ' + observation.summary;
        list.appendChild(row);
      });
      details.appendChild(list);
      container.appendChild(details);
    }

    var healthSection = document.createElement('section');
    healthSection.className = 'qa-section';
    var healthTitle = document.createElement('h2');
    healthTitle.className = 'qa-section-title';
    healthTitle.textContent = 'Dataset health';
    healthSection.appendChild(healthTitle);
    var healthRow = document.createElement('div');
    healthRow.className = 'qa-health-row';
    [
      ['captionless', 'captionless'],
      ['incomplete', 'incomplete'],
      ['unreviewed', 'unreviewed'],
      ['mismatch', 'tag mismatches'],
      ['invalidAr', 'invalid AR']
    ].forEach(function (entry) {
      var files = health[entry[0]] || [];
      var chip = qaCreateButton(files.length + ' ' + entry[1], 'qa-health-chip', 'inspect-health', entry[0]);
      chip.disabled = !files.length;
      healthRow.appendChild(chip);
    });
    healthSection.appendChild(healthRow);
    container.appendChild(healthSection);

    var utilitySection = document.createElement('section');
    utilitySection.className = 'qa-section';
    var utilityTitle = document.createElement('h2');
    utilityTitle.className = 'qa-section-title';
    utilityTitle.textContent = 'Utilities & existing reports';
    utilitySection.appendChild(utilityTitle);
    var buttons = document.createElement('div');
    buttons.className = 'qa-utility-actions';
    [
      ['Combined Captions', 'captions'],
      ['Metadata Explorer', 'metadata'],
      ['Caption Report', 'report'],
      ['Prune Candidates', 'prune'],
      ['Duplicates', 'duplicates']
    ].forEach(function (entry) {
      buttons.appendChild(qaCreateButton(entry[0], '', 'utility', entry[1]));
    });
    utilitySection.appendChild(buttons);
    container.appendChild(utilitySection);
  }

  function qaRefreshComputedState(force) {
    var items = qaGetTrainingItems();
    var folderKey = String(state.folder || '');
    var scopeKey = qaBuildScopeKey(items);
    var folderChanged = !!qaWorkbenchState.folderKey && qaWorkbenchState.folderKey !== folderKey;
    var scopeChanged = !!qaWorkbenchState.scopeKey && qaWorkbenchState.scopeKey !== scopeKey;
    var inputSignature = qaBuildDeepScanSignature(items);
    var inputsChanged = !!qaWorkbenchState.deepScanInputSignature
      && qaWorkbenchState.deepScanInputSignature !== inputSignature;

    if (folderChanged) {
      qaWorkbenchState.trainingFocus = '';
      qaWorkbenchState.parentFocusSet = undefined;
      qaWorkbenchState.returnFindingId = '';
    }
    if (folderChanged || scopeChanged || inputsChanged || !qaWorkbenchState.deepScanInputSignature) {
      qaWorkbenchState.browseIndex = 0;
      qaWorkbenchState.statusMessage = '';
      qaRestoreReview(inputSignature);
      if (!qaWorkbenchState.deepScanJobId) {
        qaWorkbenchState.deepScanStatus = '';
      }
    }

    qaWorkbenchState.folderKey = folderKey;
    qaWorkbenchState.deepScanInputSignature = inputSignature;
    if (!force && !scopeChanged && !inputsChanged && qaWorkbenchState.scopeKey === scopeKey && qaWorkbenchState.findings.length + qaWorkbenchState.observations.length > 0) {
      return { items: items, health: qaBuildHealth(items) };
    }
    qaWorkbenchState.scopeKey = scopeKey;
    var result = qaComputeFindings(items);
    qaWorkbenchState.deterministicFindings = result.findings;
    qaMergeFindings();
    qaWorkbenchState.observations = result.observations;
    var recommendations = qaGetRecommendations();
    if (qaWorkbenchState.returnFindingId) {
      var returnIndex = recommendations.findIndex(function (finding) { return finding.id === qaWorkbenchState.returnFindingId; });
      if (returnIndex !== -1) qaWorkbenchState.browseIndex = returnIndex;
      qaWorkbenchState.returnFindingId = '';
    }
    qaWorkbenchState.browseIndex = Math.max(0, Math.min(qaWorkbenchState.browseIndex, Math.max(0, recommendations.length - 1)));
    return { items: items, health: result.health };
  }

  function renderQaWorkbench(force) {
    if (normalizeWorkspaceSurface(workspaceState.surface) !== 'reviewOutput') return;
    if (reviewWorkspaceState.detailTab !== 'qa') return;
    var root = document.getElementById('qa-workbench');
    if (!root) throw new Error('QA workbench root is missing.');
    var currentItems = qaGetTrainingItems();
    qaPrimeDeterministicSources(currentItems);
    var data = qaRefreshComputedState(!!force);
    if (qaWorkbenchState.view === 'browse') {
      qaRenderBrowse(root, data.items);
    } else if (qaWorkbenchState.view === 'report') {
      qaRenderReport(root, data.items, data.health);
    } else {
      qaRenderOverview(root, data.items, data.health);
    }
  }

  function qaStartBrowsing(category) {
    var recommendations = qaGetRecommendations();
    var start = -1;
    if (category) {
      start = recommendations.findIndex(function (finding) {
        return finding.category === category && !qaWorkbenchState.dispositions[finding.id];
      });
      if (start === -1) {
        start = recommendations.findIndex(function (finding) { return finding.category === category; });
      }
    } else {
      start = recommendations.findIndex(function (finding) { return !qaWorkbenchState.dispositions[finding.id]; });
    }
    if (start === -1) start = 0;
    qaWorkbenchState.browseIndex = Math.max(0, start);
    qaWorkbenchState.statusMessage = '';
    qaSetView('browse');
  }

  function qaInspectFiles(files, source, findingId) {
    var clean = (files || []).filter(Boolean);
    if (!clean.length) return;
    qaWorkbenchState.parentFocusSet = qaCloneFocusSet(state.focusSet);
    qaWorkbenchState.returnFindingId = String(findingId || '');
    qaWorkbenchState.statusMessage = '';
    selectByFileName(clean[0], clean, source || 'Quality Assurance', 'qa', { preserveMediaFilters: true });
  }

  function qaInspectFinding(findingId) {
    var finding = qaWorkbenchState.findings.find(function (row) { return row.id === findingId; });
    if (!finding || !finding.files || !finding.files.length) return;
    qaInspectFiles(finding.files, 'QA · ' + finding.title, finding.id);
  }

  function qaInspectHealth(kind) {
    var data = qaRefreshComputedState(false);
    var files = data.health[kind] || [];
    if (!files.length) return;
    var labels = {
      captionless: 'Captionless',
      incomplete: 'Incomplete',
      unreviewed: 'Unreviewed',
      mismatch: 'Tag Mismatch',
      invalidAr: 'Invalid AR'
    };
    qaInspectFiles(files, 'QA · ' + (labels[kind] || 'Dataset Health'), '');
  }

  function returnToQaWorkbenchFromFocusSet() {
    var parent = qaWorkbenchState.parentFocusSet;
    var returnToFinding = !!qaWorkbenchState.returnFindingId;
    state.focusSet = parent ? qaCloneFocusSet(parent) : null;
    qaWorkbenchState.parentFocusSet = undefined;
    qaWorkbenchState.view = returnToFinding ? 'browse' : 'overview';
    updateFocusSetUi();
    renderFileList(ui.filterEl.value);
    pruneCandidatesScopeChanged();
    duplicateCandidatesScopeChanged();
    setWorkspaceWorkflowMode('review');
    setWorkspaceSurface('reviewOutput');
    renderQaWorkbench(true);
  }

  function qaHandleAction(action, value) {
    if (action === 'deep-scan') {
      qaRunDeepScan();
      return;
    }
    if (action === 'deep-scan-stop') {
      qaCancelDeepScan();
      return;
    }
    if (action === 'view') {
      qaSetView(value);
      return;
    }
    if (action === 'browse-next') {
      qaStartBrowsing('');
      return;
    }
    if (action === 'open-category') {
      qaStartBrowsing(value);
      return;
    }
    if (action === 'browse-prev') {
      qaWorkbenchState.browseIndex = Math.max(0, qaWorkbenchState.browseIndex - 1);
      qaWorkbenchState.statusMessage = '';
      renderQaWorkbench();
      return;
    }
    if (action === 'browse-next-index') {
      var recs = qaGetRecommendations();
      var next = qaWorkbenchState.browseIndex + 1;
      while (next < recs.length && qaWorkbenchState.dispositions[recs[next].id]) next += 1;
      if (next >= recs.length) next = Math.min(recs.length - 1, qaWorkbenchState.browseIndex + 1);
      qaWorkbenchState.browseIndex = Math.max(0, next);
      qaWorkbenchState.statusMessage = '';
      renderQaWorkbench();
      return;
    }
    if (action === 'browse-finding') {
      var idx = qaGetRecommendations().findIndex(function (finding) { return finding.id === value; });
      if (idx !== -1) qaWorkbenchState.browseIndex = idx;
      qaSetView('browse');
      return;
    }
    if (action === 'inspect-finding') {
      qaInspectFinding(value);
      return;
    }
    if (action === 'inspect-health') {
      qaInspectHealth(value);
      return;
    }
    if (action === 'utility') {
      qaOpenUtility(value);
      return;
    }
    if (action === 'dispose') {
      var current = qaGetRecommendations()[qaWorkbenchState.browseIndex];
      if (!current) return;
      qaWorkbenchState.dispositions[current.id] = value;
      qaSaveReview();
      qaWorkbenchState.statusMessage = qaDispositionLabel(value) + '. This finding remains in Full Report.';
      renderQaWorkbench();
      return;
    }
    if (action === 'reset-dispositions') {
      qaWorkbenchState.dispositions = {};
      qaSaveReview();
      qaWorkbenchState.statusMessage = '';
      renderQaWorkbench();
      return;
    }
    if (action === 'edit-focus') {
      var editor = document.getElementById('qa-training-focus-editor');
      var input = document.getElementById('qa-training-focus-input');
      if (!editor || !input) throw new Error('QA training focus editor is missing.');
      editor.classList.remove('hidden');
      input.focus();
      input.select();
      return;
    }
    if (action === 'cancel-focus') {
      renderQaWorkbench();
      return;
    }
    if (action === 'save-focus') {
      var focusInput = document.getElementById('qa-training-focus-input');
      if (!focusInput) throw new Error('QA training focus input is missing.');
      qaWorkbenchState.trainingFocus = qaNormalizeLabel(focusInput.value).slice(0, 240);
      renderQaWorkbench();
    }
  }

  function wireQaWorkbench() {
    var root = document.getElementById('qa-workbench');
    if (!root) throw new Error('QA workbench root is missing.');
    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-qa-action]');
      if (!button || !root.contains(button)) return;
      qaHandleAction(button.getAttribute('data-qa-action'), button.getAttribute('data-qa-value') || '');
    });
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      if (event.target && event.target.id === 'qa-training-focus-input') {
        event.preventDefault();
        qaHandleAction('save-focus', '');
      }
    });
  }

  function getQaTrainingFocus() {
    return qaWorkbenchState.trainingFocus;
  }

  function getQaTrainingItemsForAssistant() {
    return qaGetTrainingItems();
  }

  window.addEventListener('webcap:media-metadata-updated', function (event) {
    var detail = event && event.detail ? event.detail : {};
    if (String(detail.folder || '') !== String(state.folder || '')) return;
    qaWorkbenchState.externalAnalysisAttemptKey = '';
    if (normalizeWorkspaceSurface(workspaceState.surface) !== 'reviewOutput') return;
    if (reviewWorkspaceState.detailTab !== 'qa') return;
    renderQaWorkbench(true);
  });

  window.renderQaWorkbench = renderQaWorkbench;
  window.refreshQaWorkbench = function () { renderQaWorkbench(true); };
  window.wireQaWorkbench = wireQaWorkbench;
  window.returnToQaWorkbenchFromFocusSet = returnToQaWorkbenchFromFocusSet;
  window.getQaTrainingFocus = getQaTrainingFocus;
  window.getQaTrainingItemsForAssistant = getQaTrainingItemsForAssistant;
})();
