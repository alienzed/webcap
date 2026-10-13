(function () {
  
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

  var qaInteractiveRefreshCount = 0;
  var qaInteractiveRefreshWaiters = [];

  function qaWaitForInteractiveRefresh() {
    if (!qaInteractiveRefreshCount) return Promise.resolve();
    return new Promise(function (resolve) { qaInteractiveRefreshWaiters.push(resolve); });
  }

  function qaFocusReviewInteractiveRefresh(operation) {
    if (!qaFocusReviewCurrent()) return Promise.resolve().then(operation);
    qaInteractiveRefreshCount += 1;
    return Promise.resolve().then(operation).finally(function () {
      qaInteractiveRefreshCount -= 1;
      if (!qaInteractiveRefreshCount) {
        var waiters = qaInteractiveRefreshWaiters.splice(0);
        waiters.forEach(function (resolve) { resolve(); });
      }
    });
  }

  var qaFocusReviewState = {
    active: false, folder: '', scopeKey: '', items: [], handled: {},
    queued: {}, reviewFindings: {}, prepQueued: {}, prepChain: Promise.resolve(),
    autoOpen: false, opening: false, token: 0, loadToken: 0
  };

  var qaWorkbenchState = {
    view: 'overview',
    trainingFocus: '',
    focusExplicitlyEdited: false,
    findings: [],
    deterministicFindings: [],
    statisticalCandidates: [],
    aiFindings: [],
    conceptFindings: [],
    conceptQuery: '',
    conceptStatus: '',
    conceptSession: null,
    conceptCoverage: null, // Session-only coverage of the last explicit concept check.
    investigation: null, // Session-only outcome of the last selected hypothesis.
    captionQuality: {},
    qaAlternatives: {},
    aiSummary: '',
    qaReviewMode: '',
    aiScopeSignature: '',
    aiItemSignatures: {},
    aiCoverageValid: 0,
    aiCoverageTotal: 0,
    aiModel: '',
    deepScanSessionActive: false,
    deepScanStopRequested: false,
    deepScanSessionToken: 0,
    deepScanJobId: '',
    deepScanChallengerJobId: '',
    deepScanSubmitting: false,
    deepScanStatus: '',
    deepScanInputSignature: '',
    deepScanSkipped: {},
    deepScanVisionModel: '',
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
        // Preserve the complete normalized Sight evidence for the QA Director.
        inventory: inventory
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
            alias: getRequirementGroupAlias(entry && entry.requirement),
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
      vocabulary: checklistItems.map(function (group) {
        return [group, getRequirementGroupAlias(group), getChecklistKeywordTermsForRequirement(group)];
      }),
      primer: String(statsGetPrimerOptionsFromDom().template || ''),
      items: qaBuildDeepScanItems(items)
    });
  }

  function qaDeepScanFindingPayload(items) {
    var wanted = {};
    (items || []).forEach(function (item) {
      if (item && item.fileName) wanted[item.fileName] = true;
    });
    return qaWorkbenchState.deterministicFindings.concat(qaWorkbenchState.statisticalCandidates).filter(function (finding) {
      return (finding.files || []).some(function (file) { return !!wanted[file]; });
    }).map(function (finding) {
      return {
        category: finding.category,
        title: finding.source === 'statistical' ? 'Unverified statistical association: ' + finding.title : finding.title,
        summary: finding.summary,
        files: (finding.files || []).filter(function (file) { return !!wanted[file]; }).slice(0, 12)
      };
    });
  }

  function qaNormalizeAiFindings(analysis, model) {
    var rows = analysis && Array.isArray(analysis.findings) ? analysis.findings : [];
    return rows.map(function (finding) {
      var files = Array.isArray(finding.files) ? finding.files.slice() : [];
      var evidence = Array.isArray(finding.evidence) ? finding.evidence.slice(0, 4) : [];
      var confidence = String(finding.confidence || 'medium');
      var patches = Array.isArray(finding.patches) ? finding.patches.map(function (patch) {
        return {
          file: String(patch && patch.file || ''),
          action: String(patch && patch.action || ''),
          sourceText: String(patch && patch.sourceText || ''),
          replacementText: String(patch && patch.replacementText || ''),
          anchorText: String(patch && patch.anchorText || ''),
          confidence: confidence,
          knownTag: null
        };
      }).filter(function (patch) {
        return !!patch.file;
      }) : [];
      return {
        id: qaStableId(['ai', finding.category, finding.title].concat(files)),
        category: String(finding.category || 'consistency'),
        priority: String(finding.priority || 'normal'),
        confidence: confidence,
        trainingValue: String(finding.trainingValue || 'medium'),
        title: String(finding.title || ''),
        summary: String(finding.summary || ''),
        why: String(finding.why || ''),
        files: files,
        patches: patches,
        tagActions: Array.isArray(finding.tagActions) ? finding.tagActions.filter(function (row) {
          return row && files.indexOf(String(row.file || '')) !== -1 &&
            (row.action === 'add' || row.action === 'remove') && String(row.term || '').trim();
        }).map(function (row) {
          return { file: String(row.file), action: row.action, group: String(row.group || ''), term: String(row.term) };
        }) : [],
        facts: [{ value: String(files.length), label: 'affected items' }],
        meta: evidence,
        source: 'ai',
        concept: String(finding.concept || ''),
        dismissIf: String(finding.dismissIf || ''),
        candidates: Array.isArray(finding.candidates) ? finding.candidates.slice() : [],
        sourceLabel: 'AI · ' + String(model || 'Director')
      };
    });
  }

  // A Set-owned review receipt, not a duplicate copy of image metadata.
  var qaReviewLoadToken = 0;
  var qaReviewSaveChain = Promise.resolve();

  function qaItemInputSignatures() {
    return qaCurrentItemSignatureMap(qaGetTrainingItems());
  }

  function qaReviewPayload() {
    return {
      version: 1,
      qaReviewMode: qaWorkbenchState.qaReviewMode,
      aiScopeSignature: qaWorkbenchState.aiScopeSignature,
      scopeKey: qaWorkbenchState.scopeKey,
      trainingFocus: qaWorkbenchState.trainingFocus,
      itemSignatures: Object.assign({}, qaWorkbenchState.aiItemSignatures),
      aiFindings: qaWorkbenchState.aiFindings,
      captionQuality: qaWorkbenchState.captionQuality,
      qaAlternatives: qaWorkbenchState.qaAlternatives,
      aiSummary: qaWorkbenchState.aiSummary,
      aiModel: qaWorkbenchState.aiModel,
      dispositions: qaWorkbenchState.dispositions
    };
  }

  function qaSaveReview(requireSuccess) {
    var folder = String(state.folder || '');
    var review = qaReviewPayload();
    qaReviewSaveChain = qaReviewSaveChain.catch(function () {}).then(function () {
      return qaRequestJson('/fs/qa/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folder, review: review })
      });
    }).catch(function (err) {
      window.reportConsoleError('QA · Save review', err);
      qaWorkbenchState.statusMessage = 'QA review could not be saved.';
      if (requireSuccess) throw err;
    });
    return qaReviewSaveChain;
  }

  function qaRestoreReview(signature) {
    var token = ++qaReviewLoadToken;
    var folder = String(state.folder || '');
    var scopeKey = qaBuildScopeKey(qaGetTrainingItems());
    var focus = qaWorkbenchState.trainingFocus;
    qaWorkbenchState.aiFindings = [];
    qaWorkbenchState.captionQuality = {};
    qaWorkbenchState.qaAlternatives = {};
    qaWorkbenchState.aiSummary = '';
    qaWorkbenchState.qaReviewMode = '';
    qaWorkbenchState.aiScopeSignature = '';
    qaWorkbenchState.aiItemSignatures = {};
    qaWorkbenchState.aiCoverageValid = 0;
    qaWorkbenchState.aiCoverageTotal = 0;
    qaWorkbenchState.aiModel = '';
    qaWorkbenchState.dispositions = {};
    return qaRequestJson('/fs/qa/review?folder=' + encodeURIComponent(folder)).then(function (payload) {
      if (token !== qaReviewLoadToken || qaWorkbenchState.deepScanJobId || qaWorkbenchState.deepScanSubmitting || String(state.folder || '') !== folder
          || qaBuildScopeKey(qaGetTrainingItems()) !== scopeKey
          || qaWorkbenchState.trainingFocus !== focus) return;
      var saved = payload.review;
      if (!saved) return;
      // Restore the Set's saved intent on first entry, but never override a focus
      // deliberately chosen in this session (including an intentionally empty one).
      if (!qaWorkbenchState.focusExplicitlyEdited && !focus && saved.trainingFocus) {
        qaWorkbenchState.trainingFocus = String(saved.trainingFocus);
      }
      if (saved.trainingFocus !== qaWorkbenchState.trainingFocus) return;
      var legacyReview = !saved.qaReviewMode || saved.qaReviewMode === 'legacy-per-item';
      if (!legacyReview && (saved.qaReviewMode !== 'set-review-v1' || saved.aiScopeSignature !== signature)) return;
      qaWorkbenchState.qaReviewMode = legacyReview ? 'legacy-per-item' : saved.qaReviewMode;
      var before = saved.itemSignatures && typeof saved.itemSignatures === 'object'
        ? saved.itemSignatures
        : {};
      var changed = {};
      var current = qaItemInputSignatures();
      var validCount = 0;
      Object.keys(current).forEach(function (file) {
        if (before[file] !== current[file]) {
          changed[file] = true;
        } else {
          validCount += 1;
        }
      });
      qaWorkbenchState.aiFindings = (saved.aiFindings || []).filter(function (finding) {
        return !(finding.files || []).some(function (file) { return changed[file]; });
      }).map(function (finding) {
        return legacyReview ? Object.assign({}, finding, { sourceLabel: 'Legacy Deep QA · ' + String(saved.aiModel || 'Director') }) : finding;
      });
      qaWorkbenchState.captionQuality = Object.fromEntries(Object.entries(saved.captionQuality || {}).filter(function (entry) { return !changed[entry[0]]; }));
      qaWorkbenchState.qaAlternatives = Object.fromEntries(Object.entries(saved.qaAlternatives || {}).filter(function (entry) {
        return !changed[entry[0]] && typeof entry[1] === 'string' && !!entry[1].trim();
      }));
      qaWorkbenchState.aiSummary = String(saved.aiSummary || '');
      qaWorkbenchState.aiModel = String(saved.aiModel || '');
      qaWorkbenchState.aiScopeSignature = legacyReview ? signature : saved.aiScopeSignature;
      qaWorkbenchState.aiItemSignatures = Object.assign({}, before);
      qaWorkbenchState.aiCoverageValid = validCount;
      qaWorkbenchState.aiCoverageTotal = Object.keys(current).length;
      qaWorkbenchState.dispositions = saved.dispositions && typeof saved.dispositions === 'object'
        ? saved.dispositions : {};
      qaMergeFindings();
      qaSyncFocusReview();
      renderQaWorkbench();
    }).catch(function (err) {
      if (token !== qaReviewLoadToken) return;
      window.reportConsoleError('QA · Restore review', err);
      qaWorkbenchState.statusMessage = 'Saved QA review could not be restored.';
      renderQaWorkbench();
    });
  }

  function qaMergeFindings() {
    var items = qaGetTrainingItems(), current = qaCurrentItemSignatureMap(items), byFile = {};
    items.forEach(function (item) { byFile[item.fileName] = item; });
    var fresh = qaWorkbenchState.aiScopeSignature === qaBuildDeepScanSignature(items);
    var visibleAi = fresh ? qaWorkbenchState.aiFindings.map(function (finding) {
      if (finding.concept) return finding; // hypothesis, not a verified edit
      var files = (finding.files || []).filter(function (file) {
        var item = byFile[file];
        return item && current[file] && qaWorkbenchState.aiItemSignatures[file] === current[file]
          && qaFocusReviewHasAction(item.key, file, item.caption || '', finding);
      });
      return files.length ? Object.assign({}, finding, { files: files }) : null;
    }).filter(Boolean) : [];
    var conceptCurrent = qaConceptInputSignatures(items);
    var visibleConcept = qaWorkbenchState.conceptFindings.map(function (finding) {
      var files = (finding.files || []).filter(function (file) {
        var item = byFile[file];
        return item && conceptCurrent[file] && finding.inputSignatures[file] === conceptCurrent[file]
          && qaFocusReviewHasAction(item.key, file, item.caption || '', finding);
      });
      return files.length ? Object.assign({}, finding, { files: files }) : null;
    }).filter(Boolean);
    qaWorkbenchState.findings = qaSortFindings(
      qaWorkbenchState.deterministicFindings.concat(visibleAi, visibleConcept));
  }

  function qaGetReportObservations() {
    var promoted = {};
    qaWorkbenchState.findings.forEach(function (finding) { promoted[finding.id] = true; });
    var current = qaCurrentItemSignatureMap(qaGetTrainingItems());
    var others = qaWorkbenchState.aiFindings.concat(qaWorkbenchState.conceptFindings).filter(function (finding) {
      return !promoted[finding.id] && (finding.files || []).some(function (file) {
        return !!current[file] && (finding.source === 'concept'
          ? finding.inputSignatures && finding.inputSignatures[file] === qaConceptInputSignatures(qaGetTrainingItems().filter(function (item) { return item.fileName === file; }))[file]
          : qaWorkbenchState.aiItemSignatures[file] === current[file]);
      });
    }).map(function (finding) {
      return { id: finding.id, title: finding.title, summary: finding.summary, files: finding.files || [] };
    });
    return qaWorkbenchState.observations.concat(others);
  }

  function qaReconcileAiFindingsToCurrentInputs() {
    var current = qaItemInputSignatures();
    var invalid = {};
    Object.keys(current).forEach(function (file) {
      if (
        qaWorkbenchState.aiItemSignatures[file] &&
        qaWorkbenchState.aiItemSignatures[file] !== current[file]
      ) {
        invalid[file] = true;
      }
    });
    if (Object.keys(invalid).length) {
      Object.keys(invalid).forEach(function (file) {
        delete qaWorkbenchState.captionQuality[file];
        delete qaWorkbenchState.qaAlternatives[file];
      });
      qaWorkbenchState.aiFindings = qaWorkbenchState.aiFindings.filter(function (finding) {
        return finding.concept || !(finding.files || []).some(function (file) { return invalid[file]; });
      });
    }
    qaRefreshAiCoverage();
  }

  function qaWaitForDeepScan(job) {
    if (!job || !job.jobId) throw new Error('QA Deep Scan did not return a queued job.');
    var jobId = String(job.jobId || '');
    qaWorkbenchState.deepScanJobId = jobId;
    renderQaWorkbench();

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
        return qaRequestJson('/fs/director/job?job=' + encodeURIComponent(jobId) + '&consume=1');
      }).then(function (payload) {
        return poll(payload.job);
      });
    }

    return poll(job);
  }

  function qaMergeAiBatch(findings) {
    var byId = {};
    qaWorkbenchState.aiFindings.forEach(function (finding) {
      byId[finding.id] = finding;
    });
    (findings || []).forEach(function (finding) {
      byId[finding.id] = finding;
    });
    qaWorkbenchState.aiFindings = Object.keys(byId).map(function (id) {
      return byId[id];
    });
  }

  function qaCurrentItemSignatureMap(items) {
    var signatures = {};
    qaBuildDeepScanItems(items).forEach(function (item) {
      var source = JSON.stringify([item, getCaptionVisionModelId() || '']);
      var hash = 2166136261;
      for (var i = 0; i < source.length; i += 1) {
        hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
      }
      signatures[item.fileName] = (hash >>> 0).toString(16);
    });
    return signatures;
  }

  function qaPendingDeepScanItems() {
    var items = qaGetTrainingItems();
    var current = qaCurrentItemSignatureMap(items);
    return items.filter(function (item) {
      return qaWorkbenchState.aiItemSignatures[item.fileName] !== current[item.fileName]
        && !qaWorkbenchState.deepScanSkipped[item.fileName];
    });
  }

  function qaRefreshAiCoverage() {
    var items = qaGetTrainingItems();
    var current = qaCurrentItemSignatureMap(items);
    var valid = 0;
    Object.keys(current).forEach(function (file) {
      if (qaWorkbenchState.aiItemSignatures[file] === current[file]) valid += 1;
    });
    qaWorkbenchState.aiCoverageValid = valid;
    qaWorkbenchState.aiCoverageTotal = Object.keys(current).length;
  }

  function qaInvalidateDeepScanSession(message) {
    var jobId = String(qaWorkbenchState.deepScanJobId || qaWorkbenchState.deepScanChallengerJobId || '');
    qaWorkbenchState.deepScanChallengerJobId = '';
    qaWorkbenchState.deepScanSessionToken += 1;
    qaWorkbenchState.deepScanSkipped = {};
    qaWorkbenchState.deepScanSessionActive = false;
    qaWorkbenchState.deepScanStopRequested = true;
    qaWorkbenchState.deepScanSubmitting = false;
    qaWorkbenchState.deepScanJobId = '';
    qaWorkbenchState.aiFindings = [];
    qaWorkbenchState.captionQuality = {};
    qaWorkbenchState.qaAlternatives = {};
    qaWorkbenchState.aiSummary = '';
    qaWorkbenchState.aiItemSignatures = {};
    qaWorkbenchState.aiCoverageValid = 0;
    qaWorkbenchState.aiCoverageTotal = 0;
    qaWorkbenchState.aiScopeSignature = '';
    qaWorkbenchState.deepScanStatus = String(message || 'Deep QA context changed; run it again for the current scope.');
    if (jobId) {
      qaRequestJson('/fs/director/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'cancel_job', jobId: jobId })
      }).catch(function (err) {
        window.reportConsoleError('QA Deep Scan', err);
      });
    }
  }

  // One user-initiated set-wide discovery. No challenger, per-item judge, or implicit Sight run.
  function qaRunNextDeepScanBatch() {
    if (!qaWorkbenchState.deepScanSessionActive || qaWorkbenchState.deepScanStopRequested) return;
    var items = qaGetTrainingItems(), signature = qaBuildDeepScanSignature(items);
    var token = qaWorkbenchState.deepScanSessionToken;
    var folder = String(state.folder || ''), model = qaWorkbenchState.aiModel;
    var inputItems = items.map(function (item) {
      return {
        fileName: item.fileName,
        groupedTags: getChecklistAssignmentEntriesForMediaKey(item.key).map(function (entry) {
          return { group: entry.requirement, term: entry.term };
        }),
        otherTags: getUnscopedTagsForMediaKey(item.key)
      };
    });
    qaWorkbenchState.deepScanSubmitting = true;
    qaWorkbenchState.deepScanStatus = 'Deep QA · Reviewing ' + items.length + ' selected items';
    renderQaWorkbench();
    var reviewRequest = {
        setReview: true, folder: folder, model: model, trainingFocus: qaWorkbenchState.trainingFocus,
        primer: String(statsGetPrimerOptionsFromDom().template || ''),
        vocabulary: checklistItems.map(function (group) {
          return { group: group, alias: getRequirementGroupAlias(group), terms: getChecklistKeywordTermsForRequirement(group) };
        }),
        items: inputItems
    };
    qaRequestJson('/fs/qa/deep-scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ preflight: true }, reviewRequest))
    }).catch(function (err) {
      reportConsoleWarning('Deep QA · Context estimate unavailable', String(err.message || err));
      return { contextTokens: 0, estimatedTokens: 0 };
    }).then(function (capacity) {
      if (token !== qaWorkbenchState.deepScanSessionToken || !qaWorkbenchState.deepScanSessionActive) return null;
      var known = Number(capacity.contextTokens || 0);
      var needed = Number(capacity.estimatedTokens || 0);
      if (known && needed > known) {
        var proceed = window.confirm(
          'Deep QA may exceed this Director model\'s context.\n\n' +
          'Estimated requirement: ~' + needed.toLocaleString() + ' tokens (including response allowance)\n' +
          'Known context: ' + known.toLocaleString() + ' tokens\n\n' +
          'This is an estimate, not a guaranteed failure.\n\nProceed anyway?'
        );
        if (!proceed) {
          qaWorkbenchState.deepScanSessionActive = false;
          qaWorkbenchState.deepScanSubmitting = false;
          qaWorkbenchState.deepScanStatus = 'Deep QA cancelled before inference.';
          renderQaWorkbench();
          return null;
        }
      }
      return qaRequestJson('/fs/qa/deep-scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewRequest)
      });
    }).then(function (payload) {
      if (!payload) return null;
      if (token !== qaWorkbenchState.deepScanSessionToken || !qaWorkbenchState.deepScanSessionActive) {
        if (payload.job && payload.job.jobId) return qaRequestJson('/fs/director/job', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'cancel_job', jobId: payload.job.jobId })
        }).then(function () { return null; });
        return null;
      }
      qaWorkbenchState.deepScanSubmitting = false;
      return qaWaitForDeepScan(payload.job);
    }).then(function (job) {
      if (!job || token !== qaWorkbenchState.deepScanSessionToken ||
          !qaWorkbenchState.deepScanSessionActive || qaWorkbenchState.deepScanStopRequested) return;
      if (folder !== String(state.folder || '') || signature !== qaBuildDeepScanSignature(qaGetTrainingItems())) {
        qaInvalidateDeepScanSession('Deep QA inputs changed. Run again for this Set.');
        renderQaWorkbench();
        return;
      }
      var analysis = job.result && job.result.analysis;
      if (!analysis || !Array.isArray(analysis.findings)) throw new Error('Deep QA returned no structured investigation list.');
      var findings = qaNormalizeAiFindings(analysis, job.result.model);
      qaWorkbenchState.aiFindings = findings;
      qaWorkbenchState.captionQuality = {};
      qaWorkbenchState.qaAlternatives = {};
      qaWorkbenchState.aiSummary = String(analysis.summary || '');
      qaWorkbenchState.qaReviewMode = 'set-review-v1';
      qaWorkbenchState.aiScopeSignature = signature;
      qaWorkbenchState.aiItemSignatures = qaCurrentItemSignatureMap(items);
      qaWorkbenchState.aiModel = String(job.result.model || model);
      qaWorkbenchState.deepScanJobId = '';
      qaWorkbenchState.deepScanSubmitting = false;
      qaWorkbenchState.deepScanSessionActive = false;
      qaWorkbenchState.deepScanStatus = 'Deep QA · ' + findings.length + ' investigation' + (findings.length === 1 ? '' : 's') + '.';
      qaRefreshAiCoverage();
      reportConsoleInfo('Deep QA', 'Reviewed ' + items.length + ' items; ' + findings.length + ' investigations.');
      qaMergeFindings();
      qaSyncFocusReview();
      renderQaWorkbench();
      return qaSaveReview(true);
    }).catch(function (err) {
      if (token !== qaWorkbenchState.deepScanSessionToken) return;
      qaWorkbenchState.deepScanSubmitting = false;
      qaWorkbenchState.deepScanJobId = '';
      qaWorkbenchState.deepScanSessionActive = false;
      qaWorkbenchState.deepScanStatus = 'Deep QA failed: ' + String(err.message || err);
      if (['cancelled', 'stopped', 'interrupted'].indexOf(String(err.jobStatus || '')) === -1) {
        reportConsoleError('Deep QA · Set review', err);
      }
      renderQaWorkbench();
    });
  }

  function qaConceptCoverageCounts() {
    var report = qaWorkbenchState.conceptCoverage;
    if (!report || report.scope !== qaBuildScopeKey(qaGetTrainingItems())) return null;
    var counts = { actionable: 0, clean: 0, inconclusive: 0, failed: 0, unchecked: 0 };
    qaGetTrainingItems().forEach(function (item) {
      var record = report.items[item.fileName];
      var status = record && record.signature === qaConceptInputSignatures([item])[item.fileName]
        ? record.status : 'unchecked';
      var actionable = qaWorkbenchState.conceptFindings.some(function (finding) {
        return (finding.files || []).indexOf(item.fileName) !== -1 &&
          finding.inputSignatures[item.fileName] === qaConceptInputSignatures([item])[item.fileName] &&
          qaFocusReviewHasAction(item.key, item.fileName, item.caption || '', finding);
      });
      if (actionable && status !== 'failed') status = 'actionable';
      if (!Object.prototype.hasOwnProperty.call(counts, status)) status = 'unchecked';
      counts[status] += 1;
    });
    return { concept: report.concept, counts: counts };
  }

  function qaDeepCoverageCounts(items) {
    var signatures = qaCurrentItemSignatureMap(items);
    var counts = { actionable: 0, clean: 0, failed: 0, unchecked: 0 };
    items.forEach(function (item) {
      var file = item.fileName;
      if (qaWorkbenchState.aiItemSignatures[file] === signatures[file]) {
        var hasFinding = qaWorkbenchState.aiFindings.some(function (finding) {
          return (finding.files || []).indexOf(file) !== -1 &&
            !qaWorkbenchState.dispositions[finding.id] &&
            qaFocusReviewHasAction(item.key, file, item.caption || '', finding);
        });
        counts[hasFinding ? 'actionable' : 'clean'] += 1;
      } else if (qaWorkbenchState.deepScanSkipped[file]) {
        counts.failed += 1;
      } else {
        counts.unchecked += 1;
      }
    });
    return counts;
  }

  function qaCoverageLine(counts, isConcept) {
    var text = counts.actionable + ' actionable · ' + counts.clean + ' checked/no action · ' +
      (isConcept ? counts.inconclusive + ' inconclusive · ' : '') +
      counts.failed + ' failed · ' + counts.unchecked + ' unchecked';
    return text;
  }

  function qaConceptVocabulary(concept) {
    // Only send terms related to the question, not the Set's entire vocabulary.
    var tokens = String(concept || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    var stop = {check: 1, for: 1, the: 1, with: 1, any: 1, all: 1, are: 1, missing: 1, incorrect: 1, wrong: 1, images: 1, items: 1, tags: 1, captions: 1, have: 1, does: 1, that: 1, from: 1};
    var wanted = tokens.filter(function (term) { return term.length > 2 && !stop[term]; }).map(function (term) {
      return term.length > 4 ? term.replace(/s$/, '') : term;
    });
    return (checklistItems || []).map(function (group) {
      var terms = getChecklistKeywordTermsForRequirement(group).filter(function (term) {
        var words = String(term || '').toLowerCase().match(/[a-z0-9]+/g) || [];
        return words.some(function (word) {
          var stem = word.length > 4 ? word.replace(/s$/, '') : word;
          return wanted.indexOf(stem) !== -1;
        });
      });
      return { group: group, alias: getRequirementGroupAlias(group), terms: terms };
    }).filter(function (row) { return row.terms.length; });
  }

  function qaConceptInputSignatures(items) {
    // Concept checks inspect full Sight, so fingerprint that same full evidence.
    var signatures = {};
    qaBuildConceptItems(items).forEach(function (item) {
      var source = JSON.stringify([item, getCaptionVisionModelId() || '']);
      var hash = 2166136261;
      for (var i = 0; i < source.length; i += 1) {
        hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
      }
      signatures[item.fileName] = (hash >>> 0).toString(16);
    });
    return signatures;
  }

  function qaBuildConceptItems(items) {
    // Deep QA deliberately shortens Sight. A targeted check needs the whole
    // cached inventory to avoid losing the very detail being investigated.
    return qaBuildDeepScanItems(items).map(function (row, index) {
      var sight = items[index].metadata && items[index].metadata.vision_sight;
      row.analysis = sight && sight.description && sight.inventory
        ? { visionSight: { model: sight.model || '', description: sight.description, inventory: sight.inventory } }
        : {};
      return row;
    });
  }

  function qaStopConceptCheck(silent) {
    var session = qaWorkbenchState.conceptSession;
    if (!session) return;
    session.stopped = true;
    qaWorkbenchState.conceptSession = null;
    qaWorkbenchState.conceptStatus = 'Concept check stopped · completed findings retained.';
    if (session.jobId) {
      qaRequestJson('/fs/director/job', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'cancel_job', jobId: session.jobId })
      }).catch(function (err) { reportConsoleError('QA Concept Check · Stop', err); });
    }
    if (!silent) renderQaWorkbench();
  }

  function qaRunConceptCheck() {
    if (qaWorkbenchState.conceptSession) return;
    if (qaWorkbenchState.deepScanSessionActive) { setStatus('Stop Deep QA before running a concept check.'); return; }
    var concept = qaNormalizeLabel(qaWorkbenchState.conceptQuery).slice(0, 240);
    if (!concept) { setStatus('Describe the concept to investigate.'); return; }
    var model = String(getDirectorModelPreference() || '').trim();
    if (!model) { setStatus('Select a Director model for the concept check.'); return; }
    if (qaWorkbenchState.deepScanSubmitting || qaWorkbenchState.deepScanJobId) { setStatus('Finish or stop Deep QA first.'); return; }
    var selected = qaGetTrainingItems(), investigation = qaWorkbenchState.investigation;
    var candidateFiles = investigation && investigation.concept === concept ? investigation.files : null;
    var items = candidateFiles ? selected.filter(function (item) {
      return candidateFiles.indexOf(item.fileName) !== -1;
    }) : selected;
    if (!items.length) { setStatus('No media in current investigation selection.'); return; }
    if (qaWorkbenchState.investigation && qaWorkbenchState.investigation.concept !== concept) {
      qaWorkbenchState.investigation = null;
    }
    var conceptItems = qaBuildConceptItems(items);
    var available = conceptItems.filter(function (row) { return !!row.analysis.visionSight; });
    var missingCount = conceptItems.length - available.length;
    if (!available.length) {
      qaWorkbenchState.conceptStatus = 'No cached Sight for this selection. Run Set Intelligence explicitly first.';
      renderQaWorkbench();
      return;
    }
    var vocabulary = qaConceptVocabulary(concept);
    var coverage = { concept: concept, scope: qaBuildScopeKey(items), items: {} };
    items.forEach(function (item) {
      coverage.items[item.fileName] = {
        signature: qaConceptInputSignatures([item])[item.fileName], status: 'unchecked'
      };
    });
    qaWorkbenchState.conceptCoverage = coverage;
    var session = {
      folder: String(state.folder || ''), scope: qaBuildScopeKey(items),
      selectedFiles: items.map(function (item) { return item.fileName; }),
      investigationId: investigation && investigation.concept === concept ? investigation.id : '',
      concept: concept, model: model, items: available,
      vocabulary: vocabulary, missingCount: missingCount,
      signatures: qaConceptInputSignatures(items), index: 0,
      jobId: '', stopped: false
    };
    qaWorkbenchState.conceptFindings = [];
    qaMergeFindings();
    qaSyncFocusReview();
    qaWorkbenchState.conceptSession = session;
    reportConsoleInfo('QA Concept Check', 'Started "' + concept + '" for ' + available.length + '/' + items.length + ' items with cached Sight' + (missingCount ? '; ' + missingCount + ' need Sight.' : '.') );
    function current() {
      return qaWorkbenchState.conceptSession === session && !session.stopped &&
        String(state.folder || '') === session.folder &&
        qaBuildScopeKey(qaGetTrainingItems().filter(function (item) {
          return !session.investigationId || session.selectedFiles.indexOf(item.fileName) !== -1;
        })) === session.scope;
    }
    function next() {
      if (!current()) {
        if (qaWorkbenchState.conceptSession === session) qaStopConceptCheck();
        return Promise.resolve();
      }
      if (session.index >= session.items.length) {
        qaWorkbenchState.conceptSession = null;
        if (session.investigationId && qaWorkbenchState.investigation &&
            qaWorkbenchState.investigation.id === session.investigationId) {
          qaWorkbenchState.investigation.finished = true;
          qaWorkbenchState.investigation.examined = session.items.length;
          qaWorkbenchState.investigation.missing = missingCount;
          qaWorkbenchState.investigation.actions = qaWorkbenchState.conceptFindings.length;
        }
        qaWorkbenchState.conceptStatus = 'Concept check finished · ' + session.items.length + ' items examined' + (missingCount ? ' · ' + missingCount + ' without Sight (not checked).' : '.');
        reportConsoleInfo('QA Concept Check', qaWorkbenchState.conceptStatus);
        qaMergeFindings();
        qaSyncFocusReview();
        renderQaWorkbench();
        return Promise.resolve();
      }
      var batch = session.items.slice(session.index, session.index + 4);
      qaWorkbenchState.conceptStatus = 'Concept check · ' + session.index + '/' + session.items.length + ' examined';
      renderQaWorkbench();
      return qaRequestJson('/fs/qa/concept-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: session.folder, model: model, concept: concept,
          knownVocabulary: session.vocabulary, items: batch
        })
      }).then(function (payload) {
        if (!current()) {
          if (payload.job && payload.job.jobId) return qaRequestJson('/fs/director/job', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation: 'cancel_job', jobId: payload.job.jobId })
          });
          return null;
        }
        session.jobId = String(payload.job && payload.job.jobId || '');
        if (!session.jobId) throw new Error('Concept QA did not queue a Director job.');
        return qaWaitForConceptJob(payload.job);
      }).then(function (job) {
        if (!current() || !job) return;
        session.jobId = '';
        var analysis = job.result && job.result.analysis;
        if (!analysis || !Array.isArray(analysis.findings)) throw new Error('Concept QA returned no structured findings.');
        if (analysis.patchWarnings && analysis.patchWarnings.length) reportConsoleWarning('QA Concept Check', analysis.patchWarnings.join('; '));
        if (analysis.findingWarnings && analysis.findingWarnings.length) reportConsoleWarning('QA Concept Check', analysis.findingWarnings.join('; '));
        var liveItems = qaGetTrainingItems().filter(function (item) {
          return batch.some(function (row) { return row.fileName === item.fileName; });
        });
        var currentSignatures = qaConceptInputSignatures(liveItems);
        qaNormalizeAiFindings(analysis, session.model).forEach(function (finding) {
          var files = (finding.files || []).filter(function (file) { return session.signatures[file] === currentSignatures[file]; });
          finding.tagActions = (finding.tagActions || []).filter(function (action) {
            if (files.indexOf(action.file) === -1) return false;
            // New assigned terms must be in the existing vocabulary; do not
            // let a guessed term silently create a new Set vocabulary entry.
            if (action.action !== 'add') return true;
            return session.vocabulary.some(function (row) {
              return row.group.toLowerCase() === action.group.toLowerCase() &&
                row.terms.some(function (term) { return term.toLowerCase() === action.term.toLowerCase(); });
            });
          });
          finding.patches = (finding.patches || []).filter(function (patch) { return files.indexOf(patch.file) !== -1; });
          if (!files.length || (!(finding.tagActions || []).length && !(finding.patches || []).length)) return;
          finding.id = qaStableId(['concept', concept, finding.id].concat(files));
          finding.files = files;
          finding.inputSignatures = Object.assign({}, session.signatures);
          finding.source = 'concept';
          finding.sourceLabel = 'Concept QA · ' + concept;
          qaWorkbenchState.conceptFindings.push(finding);
        });
        batch.forEach(function (row) {
          var item = qaGetTrainingItems().find(function (entry) { return entry.fileName === row.fileName; });
          if (!item) return;
          var signature = qaConceptInputSignatures([item])[item.fileName];
          var hasAction = qaWorkbenchState.conceptFindings.some(function (finding) {
            return (finding.files || []).indexOf(row.fileName) !== -1 &&
              finding.inputSignatures[row.fileName] === signature;
          });
          coverage.items[row.fileName] = { signature: signature, status: hasAction ? 'actionable' : 'clean' };
        });
        session.index += batch.length;
        qaMergeFindings();
        qaSyncFocusReview();
        return next();
      }).catch(function (err) {
        if (!current()) return;
        batch.forEach(function (row) {
          var item = qaGetTrainingItems().find(function (entry) { return entry.fileName === row.fileName; });
          if (item) coverage.items[row.fileName] = {
            signature: qaConceptInputSignatures([item])[item.fileName], status: 'failed'
          };
        });
        qaWorkbenchState.conceptSession = null;
        if (session.investigationId && qaWorkbenchState.investigation &&
            qaWorkbenchState.investigation.id === session.investigationId) {
          qaWorkbenchState.investigation.error = String(err.message || err);
        }
        qaWorkbenchState.conceptStatus = 'Concept check failed at ' + session.index + '/' + session.items.length + ' · see Console.';
        reportConsoleError('QA Concept Check', err);
        renderQaWorkbench();
      });
    }
    next();
  }

  function qaWaitForConceptJob(job) {
    function poll(row) {
      var status = String(row && row.status || '');
      if (status === 'completed') return Promise.resolve(row);
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) throw new Error(row.error || 'Concept QA job ' + status);
      return new Promise(function (resolve) { setTimeout(resolve, status === 'queued' ? 2000 : 1000); })
        .then(function () { return qaRequestJson('/fs/director/job?job=' + encodeURIComponent(row.jobId) + '&consume=1'); })
        .then(function (payload) { return poll(payload.job); });
    }
    return poll(job);
  }

  function qaRunDeepScan() {
    if (qaWorkbenchState.conceptSession) { setStatus('Stop the concept check before Deep QA.'); return; }
    if (qaWorkbenchState.deepScanSessionActive || qaWorkbenchState.deepScanJobId || qaWorkbenchState.deepScanSubmitting) return;
    var items = qaGetTrainingItems();
    if (!items.length) throw new Error('Deep QA requires selected media.');
    var model = String(getDirectorModelPreference() || '').trim();
    if (!model) throw new Error('Select a Director model for Deep QA.');
    ++qaReviewLoadToken;
    qaWorkbenchState.aiModel = model;
    qaWorkbenchState.deepScanSessionToken += 1;
    qaWorkbenchState.deepScanSessionActive = true;
    qaWorkbenchState.deepScanStopRequested = false;
    qaWorkbenchState.deepScanStatus = 'Starting set-wide Deep QA…';
    reportConsoleInfo('Deep QA', 'Starting focused review for ' + items.length + ' items.');
    qaRunNextDeepScanBatch();
  }

  function qaInputsUpdated() {
    qaReconcileAiFindingsToCurrentInputs();
    if (
      qaWorkbenchState.deepScanSessionActive &&
      !qaWorkbenchState.deepScanJobId &&
      !qaWorkbenchState.deepScanSubmitting &&
      !qaWorkbenchState.deepScanStopRequested
    ) {
      qaRunNextDeepScanBatch();
      return;
    }
    if (
      normalizeWorkspaceSurface(workspaceState.surface) === 'reviewOutput' &&
      reviewWorkspaceState.detailTab === 'qa'
    ) {
      renderQaWorkbench();
    }
  }

  function qaCancelDeepScan() {
    if (!qaWorkbenchState.deepScanSessionActive && !qaWorkbenchState.deepScanJobId) return;
    qaWorkbenchState.deepScanStopRequested = true;
    reportConsoleInfo('Deep QA', 'Stop requested.');
    qaWorkbenchState.deepScanStatus = 'Stopping Deep QA…';
    renderQaWorkbench();
    if (!qaWorkbenchState.deepScanJobId) {
      var challengerId = qaWorkbenchState.deepScanChallengerJobId;
      if (challengerId) {
        qaRequestJson('/fs/director/job', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operation: 'cancel_job', jobId: challengerId })
        }).catch(function (err) { window.reportConsoleError('QA Deep Scan · Cancel challenger', err); });
      }
      cancelItemSightRefresh().catch(function (err) {
        window.reportConsoleError('QA Deep Scan · Cancel Vision', err);
      });
      qaWorkbenchState.deepScanSessionActive = false;
      qaWorkbenchState.deepScanStatus = 'Deep QA stopped.';
      renderQaWorkbench();
      return;
    }
    var jobId = qaWorkbenchState.deepScanJobId;
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
      var sourceLabel = groupByKey[row.sourceKey] + ': ' + labelByKey[row.sourceKey];
      var targetLabel = groupByKey[row.targetKey] + ': ' + labelByKey[row.targetKey];
      findings.push({
        id: qaStableId(['consistency', sourceLabel, targetLabel]),
        source: 'statistical',
        category: 'consistency',
        priority: 'normal',
        confidence: 'high',
        title: sourceLabel + ' almost always appears with ' + targetLabel,
        summary: row.co + ' of ' + row.sourceSupport + ' ' + sourceLabel + ' items also use ' + targetLabel + '; ' + row.exceptions + ' exception' + (row.exceptions === 1 ? '' : 's') + ' stand out.',
        why: 'This is only a statistical relationship; the exceptions may be legitimate variations rather than annotation errors.',
        files: exceptionFiles.slice(),
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

  function qaScopedPruneCandidates(items) {
    var scopeFiles = items.map(function (item) { return String(item.fileName || ''); }).filter(Boolean);
    if (state.pruneCandidatesStatus !== 'ready'
        || state.pruneCandidatesFolder !== String(state.folder || '')
        || state.pruneCandidatesScopeKey !== pruneCandidateScopeKey(scopeFiles)) return [];
    var allowed = {};
    scopeFiles.forEach(function (file) { allowed[file] = true; });
    return (state.pruneCandidates || []).filter(function (candidate) {
      return !!allowed[String(candidate && candidate.file || '')];
    });
  }

  function qaHasUnsupportedAspect(candidate) {
    return (candidate.reasons || []).some(function (reason) {
      return reason.code === 'unsupported_aspect_ratio';
    });
  }

  function qaBuildPruneFindings(items) {
    // An unsupported bucket is an observable problem for the current training
    // workflow. Missing metadata and relative resolution outliers are not proof
    // that a source image should be removed.
    var affected = qaScopedPruneCandidates(items).filter(qaHasUnsupportedAspect);
    if (!affected.length) return [];
    return [{
      id: 'prune:unsupported-aspect',
      category: 'prune',
      priority: 'high',
      confidence: 'high',
      title: qaFileCountText(affected.length) + ' use unsupported aspect ratios',
      summary: 'These files do not match a supported training aspect bucket. Inspect them to crop or exclude.',
      why: 'This is a supported-bucket mismatch, not a judgment about visual quality.',
      files: affected.map(function (row) { return row.file; }),
      facts: [{ value: String(affected.length), label: 'affected media' }],
      utilityTab: 'prune'
    }];
  }

  function qaBuildPruneObservations(items) {
    var other = qaScopedPruneCandidates(items).filter(function (candidate) {
      return !qaHasUnsupportedAspect(candidate);
    });
    if (!other.length) return [];
    return [{
      id: 'observation:technical-outliers',
      title: qaFileCountText(other.length) + ' have technical metadata or resolution anomalies',
      summary: 'These may be harmless; the existing Prune Candidates report contains their specific reasons.',
      files: other.map(function (row) { return row.file; })
    }];
  }

  function qaScopedDuplicateGroups(items) {
    var scopeFiles = items.map(function (item) { return String(item.fileName || ''); }).filter(Boolean);
    if (state.duplicateCandidatesStatus !== 'ready'
        || state.duplicateCandidatesFolder !== String(state.folder || '')
        || state.duplicateCandidatesScopeKey !== duplicateCandidateScopeKey(scopeFiles)) return [];
    var allowed = {};
    scopeFiles.forEach(function (file) { allowed[file] = true; });
    return (state.duplicateCandidateGroups || []).map(function (group) {
      var matching = (group.items || []).filter(function (item) {
        return !!allowed[String(item && item.file || '')];
      });
      return Object.assign({}, group, { items: matching });
    }).filter(function (group) { return group.items.length >= 2; });
  }

  function qaBuildDuplicateFindings(items) {
    // Only byte-identical groups are confirmed duplicates. A perceptual hash
    // match can hide meaningful differences in color, construction, or pose.
    return qaScopedDuplicateGroups(items).filter(function (group) {
      return group.match_type === 'exact';
    }).map(function (group) {
      var files = group.items.map(function (item) { return item.file; });
      return {
        id: qaStableId(['prune', 'exact-duplicates'].concat(files)),
        category: 'prune',
        priority: 'high',
        confidence: 'high',
        title: qaFileCountText(files.length) + ' are exact duplicates',
        summary: 'These files are byte-identical. Inspect the group and keep any intentional repeat.',
        why: 'Identical content hashes establish duplication; whether to retain extra training weight is your decision.',
        files: files,
        facts: [{ value: String(files.length - 1), label: 'additional copies' }],
        utilityTab: 'duplicates'
      };
    });
  }

  function qaBuildDuplicateObservations(items) {
    var similar = qaScopedDuplicateGroups(items).filter(function (group) {
      return group.match_type !== 'exact';
    });
    if (!similar.length) return [];
    var files = {};
    similar.forEach(function (group) {
      group.items.forEach(function (item) { files[item.file] = true; });
    });
    return [{
      id: 'observation:similar-media',
      title: similar.length + ' visually similar media group' + (similar.length === 1 ? '' : 's'),
      summary: 'Similarity alone does not establish redundancy. Different colors and garment details may be useful variation.',
      files: qaSortedFileNames(files)
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
        tagActions: row.files.map(function (file) {
          return { file: file, action: 'add', group: row.groups[0], term: row.term };
        }),
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

  function qaFindingActionRank(finding) {
    // An item-specific, evidence-backed discrepancy is more useful than rarity alone.
    var concrete = finding.files && finding.files.length;
    if (!concrete && !(finding.source === 'ai' && finding.concept)) return 0;
    if (finding.source === 'ai' && finding.concept) return 3;
    if (finding.source === 'ai' && ['captioning', 'consistency'].indexOf(finding.category) !== -1) return 3;
    if (['captioning', 'consistency'].indexOf(finding.category) !== -1) return 2;
    return 1;
  }

  function qaTrainingValueRank(value) {
    return { critical: 4, high: 3, medium: 2, low: 1 }[value] || 0;
  }

  function qaSortFindings(findings) {
    return findings.slice().sort(function (a, b) {
      var action = qaFindingActionRank(b) - qaFindingActionRank(a);
      if (action) return action;
      var value = qaTrainingValueRank(b.trainingValue) - qaTrainingValueRank(a.trainingValue);
      if (value) return value;
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
    var statisticalCandidates = qaBuildAssociationFindings(items);
    var representationObservations = qaBuildUnderrepresentedFindings(items, groups)
      .concat(qaBuildOverrepresentedFindings(items, groups));
    var findings = []
      .concat(qaBuildPruneFindings(items))
      .concat(qaBuildDuplicateFindings(items))
      .concat(qaBuildVisualAgreementFindings(items));
    return {
      findings: qaSortFindings(findings),
      statisticalCandidates: statisticalCandidates,
      observations: qaBuildObservations(items).concat(representationObservations)
        .concat(qaBuildCaptionFindings(items))
        .concat(qaBuildPruneObservations(items))
        .concat(qaBuildDuplicateObservations(items))
        .concat(statisticalCandidates.map(function (candidate) {
        return {
          id: candidate.id,
          title: 'Unverified pattern: ' + candidate.title,
          summary: candidate.summary,
          files: candidate.files.slice()
        };
      })),
      health: qaBuildHealth(items)
    };
  }

  function qaGetRecommendations() {
    return qaWorkbenchState.findings.slice();
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
    if (value === 'keep') return 'Dismissed';
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
    if (view !== 'overview' && qaWorkbenchState.deepScanSessionActive) {
      actions.appendChild(qaCreateButton('Stop Deep QA · ' + qaWorkbenchState.aiCoverageValid + '/' + qaWorkbenchState.aiCoverageTotal,
        '', 'deep-scan-stop'));
    }
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
    var high = undisposed.filter(function (finding) { return finding.priority === 'high'; }).length;

    var hero = document.createElement('section');
    hero.className = 'qa-hero';
    var copy = document.createElement('div');
    copy.className = 'qa-hero-copy';
    var h2 = document.createElement('h2');
    var deepCoverageCounts = qaDeepCoverageCounts(items);
    var evaluationIncomplete = qaWorkbenchState.aiScopeSignature !== qaBuildDeepScanSignature(items) || qaWorkbenchState.externalAnalysisRunning;
    h2.textContent = undisposed.length
      ? undisposed.length + ' actionable finding' + (undisposed.length === 1 ? '' : 's') + ' to review'
      : (evaluationIncomplete ? 'No actionable findings in available checks' : 'No outstanding QA findings');
    var intro = document.createElement('p');
    intro.textContent = undisposed.length
      ? 'Inspect the affected media and decide what, if anything, needs changing.'
      : (evaluationIncomplete ? 'No current set-wide Deep QA review. Existing observations remain in Reports.'
        : 'No outstanding findings from the current checks. Observations remain in Reports.');
    copy.appendChild(h2);
    copy.appendChild(intro);
    hero.appendChild(copy);

    var heroActions = document.createElement('div');
    heroActions.className = 'qa-hero-actions';
    if (undisposed.length) heroActions.appendChild(qaCreateButton('Review ' + undisposed.length + ' findings', '', 'browse-next'));
    var reviewReady = undisposed.some(function (finding) {
      return (finding.files || []).some(function (file) {
        var item = items.find(function (entry) { return entry.fileName === file; });
        return item && qaFocusReviewHasAction(item.key, file, item.caption || '', finding);
      });
    });
    heroActions.appendChild(qaCreateButton(
      qaWorkbenchState.deepScanSessionActive ? 'Deep QA running' : 'Run Deep QA',
      'qa-primary', 'qa-start'
    ));
    if (reviewReady && !qaWorkbenchState.deepScanSessionActive) {
      heroActions.appendChild(qaCreateButton('Review & Fix saved findings', '', 'qa-focus-review'));
    }
    var deepWrap = document.createElement('div');
    deepWrap.className = 'qa-deep-scan-wrap';
    if (qaWorkbenchState.deepScanSessionActive) {
      var deep = qaCreateButton('Stop Deep QA', '', 'deep-scan-stop');
      deep.title = 'Stop the current set-wide Director review';
      deepWrap.appendChild(deep);
    }
    var note = document.createElement('span');
    note.className = 'qa-deep-scan-note';
    var coveragePartial = qaWorkbenchState.aiCoverageTotal > 0
      && qaWorkbenchState.aiCoverageValid < qaWorkbenchState.aiCoverageTotal;
    note.textContent = qaWorkbenchState.deepScanStatus || (
      coveragePartial
        ? ('AI findings retained · ' + qaWorkbenchState.aiCoverageValid + '/' + qaWorkbenchState.aiCoverageTotal + ' inputs still current')
        : (qaWorkbenchState.aiFindings.length ? 'AI findings active · LLM' : 'Optional · LLM')
    );
    deepWrap.appendChild(note);
    heroActions.appendChild(deepWrap);
    var deepCoverage = document.createElement('div');
    deepCoverage.className = 'qa-deep-scan-note';
    deepCoverage.textContent = 'Deep QA: ' + (qaWorkbenchState.aiScopeSignature === qaBuildDeepScanSignature(items)
      ? 'Set review current · ' + qaWorkbenchState.aiFindings.length + ' investigations'
      : 'Set review not current');
    deepWrap.appendChild(deepCoverage);
    hero.appendChild(heroActions);
    container.appendChild(hero);

    var conceptWrap = document.createElement('section');
    conceptWrap.className = 'qa-section qa-concept-check';
    var conceptDetails = document.createElement('details');
    conceptDetails.className = 'qa-optional-check';
    var conceptSummary = document.createElement('summary');
    conceptSummary.textContent = 'Check a specific concept (optional)';
    conceptDetails.appendChild(conceptSummary);
    var conceptHeading = document.createElement('h2');
    conceptHeading.className = 'qa-section-title';
    conceptHeading.textContent = 'Check a specific concept';
    conceptHeading.classList.add('hidden');
    var conceptInput = document.createElement('input');
    conceptInput.type = 'text';
    conceptInput.id = 'qa-concept-input';
    conceptInput.maxLength = 240;
    conceptInput.placeholder = 'e.g. missing metal ring connectors';
    conceptInput.value = qaWorkbenchState.conceptQuery;
    conceptInput.disabled = !!qaWorkbenchState.conceptSession;
    conceptWrap.appendChild(conceptInput);
    var conceptButton = qaCreateButton(qaWorkbenchState.conceptSession ? 'Stop concept check' : 'Check selection',
      '', qaWorkbenchState.conceptSession ? 'concept-stop' : 'concept-run');
    conceptWrap.appendChild(conceptButton);
    var conceptNote = document.createElement('div');
    conceptNote.className = 'qa-deep-scan-note';
    conceptNote.textContent = qaWorkbenchState.conceptStatus || 'Uses cached Sight and existing annotations. No automatic VL scans.';
    conceptWrap.appendChild(conceptNote);
    var conceptCoverage = qaConceptCoverageCounts();
    if (conceptCoverage) {
      var conceptCounts = document.createElement('div');
      conceptCounts.className = 'qa-deep-scan-note';
      conceptCounts.textContent = 'Last check (' + conceptCoverage.concept + '): ' +
        qaCoverageLine(conceptCoverage.counts, true);
      conceptWrap.appendChild(conceptCounts);
    }
    conceptDetails.appendChild(conceptWrap);
    container.appendChild(conceptDetails);

    var summary = document.createElement('div');
    summary.className = 'qa-summary-line';
    var primary = document.createElement('strong');
    primary.textContent = high + ' higher-priority';
    summary.appendChild(primary);
    var normal = document.createElement('span');
    normal.textContent = Math.max(0, undisposed.length - high) + ' other findings';
    summary.appendChild(normal);
    var handledEl = document.createElement('span');
    handledEl.textContent = handled + ' set aside';
    summary.appendChild(handledEl);
    container.appendChild(summary);

    var categorySection = document.createElement('section');
    categorySection.className = 'qa-section';
    var categoryTitle = document.createElement('h2');
    categoryTitle.className = 'qa-section-title';
    categoryTitle.textContent = 'Findings by type';
    categorySection.appendChild(categoryTitle);
    var grid = document.createElement('div');
    grid.className = 'qa-category-grid';
    var counts = qaCategoryCounts(undisposed);
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
      empty.textContent = 'No supported corrections identified. Uncertain patterns remain in Reports.';
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
    card.appendChild(qaCreateButton('Open preview', '', 'inspect-file', fileName));
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
    handledText.textContent = handled + ' reviewed';
    progress.appendChild(handledText);
    container.appendChild(progress);

    var article = document.createElement('article');
    article.className = 'qa-recommendation';
    var eyebrow = document.createElement('div');
    eyebrow.className = 'qa-recommendation-eyebrow';
    eyebrow.textContent = (QA_CATEGORY_LABELS[finding.category] || 'QA') +
      (finding.sourceLabel ? ' · ' + finding.sourceLabel : '');
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
    // Keep the short diagnosis visible; explanation and metrics are optional.

    if (finding.concept) {
      var question = document.createElement('p');
      question.className = 'qa-investigation-question';
      question.textContent = 'Investigate: ' + finding.concept;
      article.appendChild(question);
      var condition = document.createElement('p');
      condition.className = 'qa-muted';
      condition.textContent = 'Dismiss if: ' + (finding.dismissIf || 'Visual evidence does not support the concern.');
      article.appendChild(condition);
    }
    if (finding.files && finding.files.length) {
      var evidenceHeading = document.createElement('div');
      evidenceHeading.className = 'qa-evidence-heading';
      var h3 = document.createElement('h3');
      h3.textContent = 'Evidence';
      var note = document.createElement('span');
      note.textContent = finding.concept ? finding.files.length + ' candidate items · not verified' :
        (finding.files.length > 1 ? finding.files.length + ' affected items' : '1 affected item');
      evidenceHeading.appendChild(h3);
      evidenceHeading.appendChild(note);
      article.appendChild(evidenceHeading);
      var strip = document.createElement('div');
      strip.className = 'qa-evidence-strip';
      finding.files.slice(0, 6).forEach(function (fileName) {
        var media = qaCreateEvidenceMedia(fileName);
        var candidate = (finding.candidates || []).find(function (entry) { return entry.file === fileName; });
        if (candidate) {
          var reason = document.createElement('span');
          reason.className = 'qa-muted';
          reason.textContent = candidate.reason;
          media.appendChild(reason);
        }
        strip.appendChild(media);
      });
      if (finding.files.length > 6) {
        var overflow = document.createElement('span');
        overflow.className = 'qa-muted';
        overflow.textContent = '+' + (finding.files.length - 6) + ' more in Inspect';
        strip.appendChild(overflow);
      }
      article.appendChild(strip);
    }

    var actions = document.createElement('div');
    actions.className = 'qa-recommendation-actions';
    if (finding.concept) {
      var active = qaWorkbenchState.investigation && qaWorkbenchState.investigation.id === finding.id
        ? qaWorkbenchState.investigation : null;
      if (active && active.finished) {
        var outcome = document.createElement('p');
        outcome.className = 'qa-investigation-result';
        outcome.textContent = active.examined + ' items checked · ' + active.actions +
          ' actionable findings · ' + active.missing + ' without Sight (unchecked).';
        article.appendChild(outcome);
      } else if (active && active.error) {
        var failure = document.createElement('p');
        failure.className = 'qa-investigation-result';
        failure.textContent = 'Investigation failed: ' + active.error;
        article.appendChild(failure);
      }
      var check = qaCreateButton(active && qaWorkbenchState.conceptSession ? 'Investigating…' :
        (active && active.finished ? 'Run check again' : 'Investigate'), 'qa-primary', 'check-finding-concept', finding.id);
      check.disabled = !!qaWorkbenchState.conceptSession || !(finding.candidates || []).length;
      actions.appendChild(check);
    } else if (finding.files && finding.files.length) {
      var primaryLabel = (finding.category === 'captioning' || (finding.patches || []).length) ? 'Open Caption Assist'
        : finding.utilityTab === 'duplicates' ? 'Inspect exact duplicates'
        : 'Inspect ' + finding.files.length;
      actions.appendChild(qaCreateButton(primaryLabel, 'qa-primary', 'inspect-finding', finding.id));
    }
    actions.appendChild(qaCreateButton('Dismiss', '', 'dispose', 'keep'));

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
    // Keep visual evidence visible while browsing. Detailed explanation stays collapsed.
    article.insertBefore(summary, actions);
    if (finding.files && finding.files.length) {
      article.insertBefore(evidenceHeading, actions);
      article.insertBefore(strip, actions);
    }
    var details = document.createElement('details');
    details.className = 'qa-recommendation-details';
    var detailsLabel = document.createElement('summary');
    detailsLabel.textContent = 'Why / evidence';
    details.appendChild(detailsLabel);
    details.appendChild(why);
    qaRenderFacts(details, finding);
    article.appendChild(details);

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
      finding.priority === 'high' ? 'Priority' : '',
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

    var reportObservations = qaGetReportObservations();
    if (reportObservations.length) {
      var details = document.createElement('details');
      details.className = 'qa-other-observations';
      var summary = document.createElement('summary');
      summary.textContent = 'Other observations · ' + reportObservations.length + ' signals';
      details.appendChild(summary);
      var list = document.createElement('div');
      list.className = 'qa-other-observations-list';
      reportObservations.forEach(function (observation) {
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

    if (folderChanged || scopeChanged) {
      qaWorkbenchState.investigation = null;
      qaStopConceptCheck(true);
      qaWorkbenchState.conceptFindings = [];
      qaWorkbenchState.conceptStatus = '';
      qaWorkbenchState.conceptCoverage = null;
      if (folderChanged) qaWorkbenchState.conceptQuery = '';
    }
    if (folderChanged) {
      qaWorkbenchState.trainingFocus = '';
      qaWorkbenchState.focusExplicitlyEdited = false;
      qaWorkbenchState.parentFocusSet = undefined;
      qaWorkbenchState.returnFindingId = '';
    }
    if (qaFocusReviewState.active && (folderChanged || scopeChanged) &&
        !qaFocusReviewCurrent()) {
      qaFocusReviewState.active = false;
      qaFocusReviewState.autoOpen = false;
    }
    if (folderChanged || scopeChanged || inputsChanged || !qaWorkbenchState.deepScanInputSignature) {
      qaWorkbenchState.browseIndex = 0;
      qaWorkbenchState.statusMessage = '';
      if (qaWorkbenchState.deepScanSessionActive && (folderChanged || scopeChanged)) {
        qaInvalidateDeepScanSession('Deep QA stopped because the review scope changed.');
        qaRestoreReview(inputSignature);
      } else if (qaWorkbenchState.deepScanSessionActive) {
        qaReconcileAiFindingsToCurrentInputs();
      } else {
        qaRestoreReview(inputSignature);
      }
      if (!qaWorkbenchState.deepScanJobId && !qaWorkbenchState.deepScanSessionActive && !qaWorkbenchState.deepScanStatus) {
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
    qaWorkbenchState.statisticalCandidates = result.statisticalCandidates;
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


  // Review membership is session-only. Deep QA owns durable evidence; Caption
  // Assist owns candidate generation. No second QA result store is introduced.
  function qaFocusReviewCurrent() {
    return qaFocusReviewState.active &&
      qaFocusReviewState.folder === String(state.folder || '') &&
      qaFocusReviewState.scopeKey === qaBuildScopeKey(qaGetTrainingItems());
  }

  function qaFocusReviewTagActionsForFinding(mediaKey, fileName, finding) {
    var assignments = getChecklistAssignmentEntriesForMediaKey(mediaKey);
    var unscoped = getUnscopedTagsForMediaKey(mediaKey);
    return (finding.tagActions || []).filter(function (action) {
      return action && action.file === fileName && (action.action === 'add' || action.action === 'remove');
    }).map(function (action) {
      var groupName = String(action.group || '').trim();
      var term = String(action.term || '').trim();
      var group = groupName ? (checklistItems || []).find(function (name) {
        return String(name).toLowerCase() === groupName.toLowerCase();
      }) : '';
      if (!term || (groupName && !group)) return null;
      var assigned = group
        ? assignments.some(function (entry) {
          return entry.requirement === group && entry.term.toLowerCase() === term.toLowerCase();
        })
        : unscoped.some(function (tag) { return tag.toLowerCase() === term.toLowerCase(); });
      if ((action.action === 'add' && assigned) || (action.action === 'remove' && !assigned)) return null;
      return { file: fileName, action: action.action, group: group, term: term };
    }).filter(Boolean);
  }

  function qaFocusReviewPatchesForFinding(fileName, captionText, finding) {
    return (finding.patches || []).filter(function (patch) {
      if (!patch || patch.file !== fileName || !captionVisionValidatePatch(captionText, patch)) return false;
      // Do not offer an add patch if its exact phrase is already present.
      if (patch.action === 'add' && captionContainsPhrase(captionText, patch.replacementText)) return false;
      return true;
    });
  }

  function qaFocusReviewHasAction(mediaKey, fileName, captionText, finding) {
    return qaFocusReviewPatchesForFinding(fileName, captionText, finding).length > 0 ||
      qaFocusReviewTagActionsForFinding(mediaKey, fileName, finding).length > 0;
  }

  function qaFocusReviewCandidateFindings(item) {
    if (!item) return [];
    var current = qaCurrentItemSignatureMap([item]);
    var found = qaWorkbenchState.aiFindings.concat(qaWorkbenchState.conceptFindings).filter(function (finding) {
      return (finding.category === 'captioning' || finding.category === 'consistency') &&
        !qaWorkbenchState.dispositions[finding.id] &&
        (finding.files || []).indexOf(item.fileName) !== -1 &&
        (finding.source === 'concept' ? finding.inputSignatures[item.fileName] === qaConceptInputSignatures([item])[item.fileName] : qaWorkbenchState.aiItemSignatures[item.fileName] === current[item.fileName]);
    });
    // Only the existing two-signal visual agreement check can introduce a
    // deterministic item-level tag action. Other QA observations stay in QA.
    qaWorkbenchState.deterministicFindings.forEach(function (finding) {
      if (finding.sourceLabel === 'WebCap + Vision' &&
          !qaWorkbenchState.dispositions[finding.id] &&
          (finding.files || []).indexOf(item.fileName) !== -1) found.push(finding);
    });
    return found.filter(function (finding) {
      return qaFocusReviewHasAction(item.key, item.fileName, item.caption || '', finding);
    }).sort(function (a, b) {
      return qaTrainingValueRank(b.trainingValue) - qaTrainingValueRank(a.trainingValue) ||
        qaPriorityRank(b.priority) - qaPriorityRank(a.priority);
    }).slice(0, 3);
  }

  function qaFocusReviewFindings(mediaKey) {
    if (!qaFocusReviewCurrent()) return [];
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) return [];
    if (qaFocusReviewState.queued[mediaKey] && qaFocusReviewState.reviewFindings[mediaKey]) {
      return qaFocusReviewState.reviewFindings[mediaKey];
    }
    return qaFocusReviewCandidateFindings(item);
  }

  // Recheck each suggested operation against live tags and the editable caption.
  // A stale AI title never counts as an unresolved QA warning on its own.
  function qaFocusReviewActionableFindings(mediaKey, captionText) {
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item || !qaFocusReviewCurrent()) return [];
    var caption = captionText === undefined ? String(item.caption || '') : String(captionText || '');
    return qaFocusReviewFindings(mediaKey).filter(function (finding) {
      return qaFocusReviewHasAction(mediaKey, item.fileName, caption, finding);
    });
  }

  function qaFocusReviewPatches(mediaKey, captionText) {
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) return [];
    var caption = captionText === undefined ? String(item.caption || '') : String(captionText || '');
    return qaFocusReviewActionableFindings(mediaKey, caption).reduce(function (all, finding) {
      return all.concat(qaFocusReviewPatchesForFinding(item.fileName, caption, finding));
    }, []);
  }

  function qaFocusReviewAlternative(mediaKey) {
    if (!qaFocusReviewCurrent()) return '';
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) return '';
    var current = qaCurrentItemSignatureMap([item]);
    if (qaWorkbenchState.aiItemSignatures[item.fileName] !== current[item.fileName]) return '';
    return String(qaWorkbenchState.qaAlternatives[item.fileName] || '');
  }

  function qaFocusReviewQuality(mediaKey) {
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item || !qaFocusReviewCurrent()) return null;
    if (qaWorkbenchState.aiItemSignatures[item.fileName] !== qaCurrentItemSignatureMap([item])[item.fileName] &&
        !(qaFocusReviewState.queued[mediaKey] && qaFocusReviewState.reviewFindings[mediaKey])) return null;
    return qaWorkbenchState.captionQuality[item.fileName] || null;
  }

  var qaTargetedRecheck = null;

  function qaCancelTargetedRecheck() {
    if (!qaTargetedRecheck) return;
    var operation = qaTargetedRecheck;
    operation.cancelled = true;
    qaTargetedRecheck = null;
    cancelItemSightRefresh().catch(function (err) { reportConsoleError('QA Recheck · Cancel Vision', err); });
    if (operation.jobId) {
      qaRequestJson('/fs/director/job', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation: 'cancel_job', jobId: operation.jobId })
      }).catch(function (err) { reportConsoleError('QA Recheck · Cancel Director', err); });
    }
    reportConsoleInfo('QA Recheck', 'Stopped. Existing annotations and findings retained.');
  }

  function qaReviewConcernOptions(mediaKey, captionText) {
    return qaFocusReviewActionableFindings(mediaKey, captionText).map(function (finding) {
      return { id: finding.id, title: finding.title };
    });
  }

  function qaRecheckCurrentFinding(findingId) {
    if (!isFocusedQaReviewMode() || !qaFocusReviewCurrent() || !state.currentItem) return Promise.resolve(false);
    if (qaTargetedRecheck) return Promise.resolve(false);
    var item = state.currentItem;
    var findings = qaFocusReviewActionableFindings(item.key, captionAssistCandidate && captionAssistCandidate.text);
    if (!findings.length) { setStatus('No actionable QA concern to recheck.'); return Promise.resolve(false); }
    var finding = findings.find(function (row) { return row.id === findingId; });
    if (!finding) { setStatus('Select an actionable concern to recheck.'); return Promise.resolve(false); }
    var model = String(getDirectorModelPreference() || '').trim();
    if (!model) { setStatus('Select a Director model first.'); return Promise.resolve(false); }
    if (qaWorkbenchState.deepScanSessionActive || qaWorkbenchState.conceptSession) {
      setStatus('Finish the running QA scan before rechecking this concern.');
      return Promise.resolve(false);
    }
    var folder = String(state.folder || '');
    var mediaKey = item.key;
    var caption = String(item.caption || '');
    var original = Object.assign({}, finding);
    var operation = { folder: folder, mediaKey: mediaKey, cancelled: false, jobId: '' };
    qaTargetedRecheck = operation;
    setStatus('Rechecking QA concern with fresh Vision…');
    reportConsoleInfo('QA Recheck', 'Reinspecting ' + item.fileName + ' · ' + original.title);
    function valid() {
      return qaTargetedRecheck === operation && !operation.cancelled &&
        String(state.folder || '') === folder && state.currentItem && state.currentItem.key === mediaKey &&
        isFocusedQaReviewMode() && qaFocusReviewCurrent();
    }
    return qaFocusReviewInteractiveRefresh(function () {
      return refreshSetIntelligenceItem(item, { open: true, isCancelled: function () { return !valid(); } })
        .then(function (saved) {
          if (!valid() || !saved) return false;
          setStatus('Fresh Sight saved. Director reassessing the concern…');
          var requestItem = qaBuildConceptItems([item])[0];
          return qaRequestJson('/fs/qa/concept-check', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folder: folder, model: model, concept: String(original.title || ''),
              knownVocabulary: qaConceptVocabulary(original.title || ''),
              recheckConcern: {
                title: original.title, summary: original.summary,
                why: original.why, evidence: original.evidence || []
              },
              items: [requestItem]
            })
          }).then(function (payload) {
            operation.jobId = String(payload.job && payload.job.jobId || '');
            if (!valid()) {
              if (operation.jobId) return qaRequestJson('/fs/director/job', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ operation: 'cancel_job', jobId: operation.jobId })
              }).then(function () { return false; });
              return false;
            }
            return qaWaitForConceptJob(payload.job);
          }).then(function (job) {
            if (!valid() || !job) return false;
            var analysis = job.result && job.result.analysis;
            if (!analysis || !analysis.recheckStatus) throw new Error('Director returned no recheck verdict.');
            if (analysis.patchWarnings && analysis.patchWarnings.length) reportConsoleWarning('QA Recheck', analysis.patchWarnings.join('; '));
            if (analysis.findingWarnings && analysis.findingWarnings.length) reportConsoleWarning('QA Recheck', analysis.findingWarnings.join('; '));
            var updated = qaNormalizeAiFindings(analysis, model);
            var current = qaConceptInputSignatures([item])[item.fileName];
            var replacements = [];
            if (analysis.recheckStatus === 'still_actionable') {
              updated.forEach(function (entry) {
                if ((entry.files || []).indexOf(item.fileName) === -1 ||
                    (!(entry.tagActions || []).length && !(entry.patches || []).length)) return;
                entry.id = qaStableId(['recheck', original.id, entry.id]);
                entry.source = 'concept';
                entry.sourceLabel = 'Vision recheck';
                entry.inputSignatures = { [item.fileName]: current };
                replacements.push(entry);
              });
              if (!replacements.length) throw new Error('Recheck marked actionable without a usable correction.');
            } else if (analysis.recheckStatus === 'inconclusive') {
              var retained = Object.assign({}, original, {
                source: 'concept', sourceLabel: 'Vision recheck · inconclusive',
                inputSignatures: { [item.fileName]: current }
              });
              retained.id = qaStableId(['recheck-inconclusive', original.id]);
              replacements.push(retained);
            }
            // Remove only this file's portion of a shared finding.
            function retainOtherFiles(entry) {
              if (entry.id !== original.id) return entry;
              var remaining = (entry.files || []).filter(function (file) { return file !== item.fileName; });
              if (!remaining.length) return null;
              return Object.assign({}, entry, {
                files: remaining,
                patches: (entry.patches || []).filter(function (patch) { return patch.file !== item.fileName; }),
                tagActions: (entry.tagActions || []).filter(function (action) { return action.file !== item.fileName; })
              });
            }
            qaWorkbenchState.aiFindings = qaWorkbenchState.aiFindings.map(retainOtherFiles).filter(Boolean);
            qaWorkbenchState.conceptFindings = qaWorkbenchState.conceptFindings.map(retainOtherFiles).filter(Boolean);
            replacements.forEach(function (entry) { qaWorkbenchState.conceptFindings.push(entry); });
            if (qaFocusReviewCurrent() && qaFocusReviewState.reviewFindings[mediaKey]) {
              qaFocusReviewState.reviewFindings[mediaKey] = qaFocusReviewState.reviewFindings[mediaKey].filter(function (entry) {
                return entry.id !== original.id;
              });
            }
            qaMergeFindings();
            qaSyncFocusReview();
            var label = { resolved: 'Resolved', still_actionable: 'Still actionable', inconclusive: 'Inconclusive' }[analysis.recheckStatus];
            setStatus('QA Vision recheck: ' + label + ' · ' + analysis.recheckReason);
            reportConsoleInfo('QA Recheck', label + ' · ' + analysis.recheckReason);
            return true;
          });
        });
    }).catch(function (err) {
      if (valid()) {
        reportConsoleError('QA Vision recheck', err);
        setStatus('QA Vision recheck failed: ' + String(err && err.message || err));
      }
      return false;
    }).finally(function () {
      if (qaTargetedRecheck === operation) qaTargetedRecheck = null;
      if (isFocusedQaReviewMode()) syncCaptionAssistCandidateUi();
    });
  }

  function qaFocusReviewReasons(mediaKey, captionText) {
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) return [];
    var caption = captionText === undefined ? String(item.caption || '') : String(captionText || '');
    return qaFocusReviewActionableFindings(mediaKey, caption).reduce(function (labels, finding) {
      qaFocusReviewTagActionsForFinding(mediaKey, item.fileName, finding).forEach(function (action) {
        labels.push((action.action === 'add' ? 'Add tag: ' : 'Remove tag: ') +
          (action.group ? action.group + ' / ' : '') + action.term);
      });
      qaFocusReviewPatchesForFinding(item.fileName, caption, finding).forEach(function (patch) {
        labels.push(patch.action === 'replace'
          ? 'Replace "' + patch.sourceText + '" with "' + patch.replacementText + '"'
          : (patch.action === 'remove' ? 'Remove caption text: "' + patch.sourceText + '"'
            : 'Insert caption text: "' + patch.replacementText + '"'));
      });
      return labels;
    }, []);
  }

  function qaFocusReviewTagActions(mediaKey, captionText) {
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) return [];
    return qaFocusReviewActionableFindings(mediaKey, captionText).reduce(function (all, finding) {
      return all.concat(qaFocusReviewTagActionsForFinding(mediaKey, item.fileName, finding));
    }, []);
  }

  function qaFocusQualityRank(key) {
    var assessment = qaFocusReviewQuality(key);
    return assessment ? { missing: 0, bad: 0, low: 1, neutral: 2, good: 3, high: 4, excellent: 5 }[assessment.rating] ?? 3 : 3;
  }

  function qaFocusReviewKeyRank(key) {
    return (qaFocusReviewState.reviewFindings[key] || []).reduce(function (best, finding) {
      return Math.max(best, qaTrainingValueRank(finding.trainingValue));
    }, 0);
  }

  function qaOrderFocusReviewKeys(keys) {
    return keys.slice().sort(function (a, b) {
      return qaFocusQualityRank(a) - qaFocusQualityRank(b) ||
        qaFocusReviewKeyRank(b) - qaFocusReviewKeyRank(a);
    });
  }

  function qaSyncFocusReviewButton() {
    var button = document.getElementById('qa-focus-review-btn');
    if (!button) throw new Error('QA Focus Review Set Tools button is missing.');
    if (!qaFocusReviewCurrent()) {
      button.textContent = 'QA Focus Review';
      return;
    }
    var ready = Object.keys(qaFocusReviewState.queued).filter(function (key) {
      return !qaFocusReviewState.handled[key];
    }).length;
    var pending = qaWorkbenchState.aiCoverageTotal - qaWorkbenchState.aiCoverageValid;
    var failed = Object.keys(qaWorkbenchState.deepScanSkipped).length;
    var complete = !qaWorkbenchState.deepScanSessionActive && pending === 0 && failed === 0;
    var suffix = qaWorkbenchState.deepScanSessionActive
      ? ' · ' + Math.max(0, pending) + ' checking'
      : (!complete && (pending || failed) ? ' · review incomplete' : '');
    button.textContent = 'QA Focus Review · ' +
      (ready ? ready + ' ready' : (complete ? 'No findings remaining' : '0 ready')) + suffix;
  }

  function qaFocusReviewRefreshAfterApply(mediaKey, previousFindings) {
    if (!qaFocusReviewCurrent()) return false;
    var item = (state.items || []).find(function (row) { return row && row.key === mediaKey; });
    if (!item) throw new Error('QA review item is missing after Apply.');
    var remaining = (previousFindings || []).filter(function (finding) {
      return qaFocusReviewHasAction(mediaKey, item.fileName, item.caption || '', finding);
    });
    qaFocusReviewState.reviewFindings[mediaKey] = remaining;
    if (!remaining.length) return false;
    qaFocusReviewState.queued[mediaKey] = true;
    qaSyncFocusReviewButton();
    return true;
  }

  function qaFocusReviewMarkHandled(mediaKey, disposition) {
    if (!qaFocusReviewCurrent()) throw new Error('QA Focus Review round is no longer current.');
    qaFocusReviewState.handled[String(mediaKey || '')] = String(disposition || 'applied');
    delete qaFocusReviewState.queued[String(mediaKey || '')];
    delete qaFocusReviewState.reviewFindings[String(mediaKey || '')];
    qaSyncFocusReviewButton();
    qaSyncFocusReview(); // Refill only the immediate lookahead after a reviewed item.
  }

  function qaFocusReviewStopped() {
    // Closing an overlay must not cancel the user's already-running Deep QA.
    qaFocusReviewState.autoOpen = false;
    qaFocusReviewState.opening = false;
    qaSyncFocusReviewButton();
  }

  function qaQueueFocusCandidatePreparation(item) {
    var session = qaFocusReviewState;
    var key = String(item && item.key || '');
    if (!key || session.prepQueued[key]) return;
    // The visible first item is prepared on demand by Caption Assist itself.
    var firstReadyKey = qaOrderFocusReviewKeys(session.items.filter(function (entry) {
      return session.queued[entry.key] && !session.handled[entry.key];
    }).map(function (entry) { return entry.key; }))[0];
    if ((session.autoOpen || session.opening) && firstReadyKey === key) return;
    session.prepQueued[key] = true;
    var token = session.token;
    session.prepChain = session.prepChain.catch(function () {}).then(function () {
      if (qaFocusReviewAlternative(key)) return false;
      return qaWaitForInteractiveRefresh();
    }).then(function (ready) {
      if (ready === false || !qaFocusReviewCurrent() || session.token !== token || session.handled[key]) return;
      if (isFocusedQaReviewMode() && focusedCaptionState.itemKey === key) return;
      var request = buildCaptionAssistRequest(item);
      var saved = captionAssistSavedCandidatesByMedia[key];
      var annotations = JSON.stringify([request.assignments, request.tags]);
      if (saved && saved.sourceCaption === String(item.caption || '') &&
          saved.annotationsAtGeneration === annotations &&
          (!saved.model || saved.model === String(request.model || ''))) return;
      return refreshSetIntelligenceItem(item, {
        open: 'missing', context: false, silent: true, allowOpenFailure: true
      }).then(function () {
        return qaWaitForInteractiveRefresh();
      }).then(function () {
        if (!qaFocusReviewCurrent() || session.token !== token || session.handled[key]) return;
        request = buildCaptionAssistRequest(item);
        var fingerprint = captionAssistRequestFingerprint(item, request);
        return requestCaptionAssistCandidate(item, request).then(function (candidate) {
          if (!qaFocusReviewCurrent() || session.token !== token || session.handled[key]) return;
          if (captionAssistRequestFingerprint(item, buildCaptionAssistRequest(item)) !== fingerprint) return;
          candidate.sourceCaption = String(item.caption || '');
          candidate.model = String(request.model || '');
          persistCaptionAssistCandidate(candidate, true);
        });
      });
    }).catch(function (err) {
      reportConsoleError('QA Focus Review · Prepare ' + item.fileName, err);
    });
  }

  function qaSyncFocusReview() {
    if (!qaFocusReviewCurrent()) return;
    var session = qaFocusReviewState;
    var candidatesByKey = {};
    var wanted = {};
    session.items.forEach(function (item) {
      var candidates = qaFocusReviewCandidateFindings(item);
      var pending = session.reviewFindings[item.key] || [];
      // Preserve reviewed-but-unresolved actions across a saved annotation change.
      pending.forEach(function (finding) {
        if (qaFocusReviewHasAction(item.key, item.fileName, item.caption || '', finding) &&
            !candidates.some(function (row) { return row.id === finding.id; })) candidates.push(finding);
      });
      candidatesByKey[item.key] = candidates;
      if (candidates.length) wanted[item.fileName] = true;
    });
    var newKeys = [];
    session.items.forEach(function (item) {
      if (!wanted[item.fileName] && session.queued[item.key] && !session.handled[item.key] &&
          !(isFocusedQaReviewMode() && focusedCaptionState.itemKey === item.key)) {
        delete session.queued[item.key];
        delete session.reviewFindings[item.key];
      }
    });
    if (isFocusedQaReviewMode()) {
      pruneFocusedQaReviewItems(session.items.filter(function (item) {
        return session.queued[item.key] && !session.handled[item.key];
      }).map(function (item) { return item.key; }));
    }
    session.items.forEach(function (item) {
      if (!wanted[item.fileName] || session.handled[item.key]) return;
      // Reconcile queued evidence when a new QA/Concept result arrives.
      // Do not preserve an obsolete snapshot merely because the item is queued.
      session.reviewFindings[item.key] = candidatesByKey[item.key];
      if (session.queued[item.key]) return;
      session.queued[item.key] = true;
      newKeys.push(item.key);
    });
    if (isFocusedQaReviewMode() && newKeys.length) {
      appendFocusedQaReviewItems(qaOrderFocusReviewKeys(newKeys));
    }
    // QA Focus Review never initiates Sight or Director inference. Deep QA and
    // Refresh Caption remain explicit actions.
    qaSyncFocusReviewButton();
    if (!isFocusedQaReviewMode() && session.autoOpen && !session.opening) {
      var keys = session.items.filter(function (item) {
        return session.queued[item.key] && !session.handled[item.key];
      }).map(function (item) { return item.key; });
      keys = qaOrderFocusReviewKeys(keys);
      if (keys.length) {
        session.opening = true;
        var token = session.token;
        var target = session.items.find(function (item) { return item.key === keys[0]; });
        selectPathMedia(target).then(function () {
          if (!qaFocusReviewCurrent() || session.token !== token || !session.autoOpen) return;
          if (startFocusedQaReview(keys)) session.autoOpen = false;
        }).catch(function (err) {
          reportConsoleError('QA Focus Review · Open', err);
          setStatus('Could not open QA Focus Review: ' + String(err && err.message || err));
        }).then(function () {
          session.opening = false;
        });
      }
    }
  }

  function qaStartFocusReview() {
    var items = qaGetTrainingItems();
    if (!items.length) {
      setStatus('QA Focus Review needs at least one item in the current training selection.');
      return;
    }
    var scopeKey = qaBuildScopeKey(items);
    if (!qaFocusReviewState.active || qaFocusReviewState.folder !== String(state.folder || '') ||
        qaFocusReviewState.scopeKey !== scopeKey) {
      qaFocusReviewState = {
        active: true, folder: String(state.folder || ''), scopeKey: scopeKey,
        items: items.slice(), handled: {}, queued: {}, reviewFindings: {}, prepQueued: {},
        prepChain: Promise.resolve(), autoOpen: true, opening: false,
        token: qaFocusReviewState.token + 1, loadToken: 0
      };
    } else {
      qaFocusReviewState.autoOpen = true;
    }
    qaRefreshComputedState(true);
    var session = qaFocusReviewState;
    var loadToken = ++session.loadToken;
    // Never clear an active Deep QA session just to restore saved findings.
    var restore = qaWorkbenchState.deepScanSessionActive || qaWorkbenchState.deepScanJobId || qaWorkbenchState.deepScanSubmitting
      ? Promise.resolve()
      : qaRestoreReview(qaBuildDeepScanSignature(items));
    restore.then(function () {
      if (!qaFocusReviewCurrent() || session !== qaFocusReviewState || session.loadToken !== loadToken) return;
      qaSyncFocusReview();
      if (!qaWorkbenchState.deepScanSessionActive &&
          !Object.keys(qaFocusReviewState.queued).length) {
        setStatus('No actionable saved QA findings. Run Deep QA separately to check more items.');
      }
      qaSyncFocusReviewButton();
    }).catch(function (err) {
      reportConsoleError('QA Focus Review · Restore', err);
      setStatus('Could not prepare QA Focus Review: ' + String(err && err.message || err));
    });
    setStatus('QA Focus Review: loading saved findings and checking remaining items.');
    qaSyncFocusReviewButton();
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

  function qaSelectFiles(files, source, findingId) {
    var clean = (files || []).filter(Boolean);
    if (!clean.length) return;
    qaWorkbenchState.parentFocusSet = qaCloneFocusSet(state.focusSet);
    qaWorkbenchState.returnFindingId = String(findingId || '');
    qaWorkbenchState.statusMessage = '';
    selectByFileName(clean[0], clean, source || 'Quality Assurance', 'qa', { preserveMediaFilters: true });
  }

  function qaReviewCaptionFiles(files, source, findingId) {
    var clean = (files || []).filter(Boolean);
    if (!clean.length) return;
    qaWorkbenchState.parentFocusSet = qaCloneFocusSet(state.focusSet);
    qaWorkbenchState.returnFindingId = String(findingId || '');
    qaWorkbenchState.statusMessage = '';

    var target = (state.items || []).find(function (item) {
      return item && item.fileName === clean[0];
    });
    if (!target) throw new Error('QA review target is missing from the current Set: ' + clean[0]);

    // QA chooses the items that need attention. Caption Assist performs a
    // fresh per-item Sight/Director pass, not a replay of historical patches.
    activateFocusSet(clean, source || 'Quality Assurance', 'qa');
    selectPathMedia(target).then(function () {
      startFocusedReview(target.key);
    }).catch(function (err) {
      reportConsoleError('QA · Caption Assist', err);
      setStatus('Could not open Caption Assist: ' + String(err && err.message ? err.message : err));
    });
  }

  function qaInspectFinding(findingId) {
    var finding = qaWorkbenchState.findings.find(function (row) { return row.id === findingId; });
    if (!finding) return;
    if (finding.concept) { qaWorkbenchState.conceptQuery = finding.concept; qaWorkbenchState.view = 'overview'; renderQaWorkbench(); return; }
    if (!finding.files || !finding.files.length) return;
    if (finding.category === 'captioning' || (finding.patches || []).length) {
      qaReviewCaptionFiles(finding.files, 'QA · ' + finding.title, finding.id);
      return;
    }
    if (finding.files.length === 1) {
      qaSelectFiles(finding.files, 'QA · ' + finding.title, finding.id);
      return;
    }
    // Group inspection belongs in the existing Grid: rate, select, or prune.
    // Keep the original selection so Return to QA restores its prior context.
    qaWorkbenchState.parentFocusSet = qaCloneFocusSet(state.focusSet);
    qaWorkbenchState.returnFindingId = finding.id;
    qaWorkbenchState.statusMessage = '';
    activateFocusSet(finding.files, 'QA · ' + finding.title, 'qa');
    openMediaGridSurface();
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
    qaSelectFiles(files, 'QA · ' + (labels[kind] || 'Dataset Health'), '');
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
    if (action === 'qa-start') {
      // Explicit user intent starts the existing progressive scan; review follows
      // saved and arriving findings without introducing a second QA engine.
      if (!qaWorkbenchState.deepScanSessionActive) qaRunDeepScan();
      return;
    }
    if (action === 'check-finding-concept') {
      var concern = qaWorkbenchState.findings.find(function (finding) { return finding.id === value; });
      if (concern && concern.concept) {
        var files = (concern.candidates || []).map(function (entry) { return entry.file; });
        qaWorkbenchState.conceptQuery = concern.concept;
        qaWorkbenchState.investigation = {
          id: concern.id, concept: concern.concept, files: files,
          finished: false, examined: 0, missing: 0, actions: 0, error: ''
        };
        if (!files.length) {
          qaWorkbenchState.statusMessage = 'No justified candidate files. Use a manual concept check if needed.';
          renderQaWorkbench();
          return;
        }
        qaRunConceptCheck();
        qaWorkbenchState.view = 'browse';
        renderQaWorkbench();
      }
      return;
    }
    if (action === 'concept-run') { qaRunConceptCheck(); return; }
    if (action === 'concept-stop') { qaStopConceptCheck(); return; }
    if (action === 'qa-focus-review') {
      qaStartFocusReview();
      return;
    }
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
    if (action === 'inspect-file') {
      qaSelectFiles([value], 'QA · Evidence', '');
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
      var nextFocus = qaNormalizeLabel(focusInput.value).slice(0, 240);
      if (nextFocus !== qaWorkbenchState.trainingFocus && qaWorkbenchState.deepScanSessionActive) {
        qaInvalidateDeepScanSession('Deep QA stopped because the training focus changed.');
      }
      qaWorkbenchState.trainingFocus = nextFocus;
      qaWorkbenchState.focusExplicitlyEdited = true;
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
    root.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'qa-concept-input') {
        qaWorkbenchState.conceptQuery = event.target.value;
      }
    });
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      if (event.target && event.target.id === 'qa-concept-input') { event.preventDefault(); qaRunConceptCheck(); return; }
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
  window.qaInputsUpdated = qaInputsUpdated;
  window.qaStartFocusReview = qaStartFocusReview;
  window.qaFocusReviewMarkHandled = qaFocusReviewMarkHandled;
  window.qaFocusReviewRefreshAfterApply = qaFocusReviewRefreshAfterApply;
  window.qaFocusReviewStopped = qaFocusReviewStopped;
  window.qaReviewConcernOptions = qaReviewConcernOptions;
  window.qaRecheckCurrentFinding = qaRecheckCurrentFinding;
  window.qaCancelTargetedRecheck = qaCancelTargetedRecheck;
  window.qaFocusReviewRecheckBusy = function () { return !!qaTargetedRecheck; };
  window.qaFocusReviewReasons = qaFocusReviewReasons;
  window.qaFocusReviewActionableFindings = qaFocusReviewActionableFindings;
  window.qaFocusReviewQuality = qaFocusReviewQuality;
  window.qaFocusReviewAlternative = qaFocusReviewAlternative;
  window.qaFocusReviewFindings = qaFocusReviewFindings;
  window.qaFocusReviewTagActions = qaFocusReviewTagActions;
  window.qaFocusReviewPatches = qaFocusReviewPatches;
  window.qaFocusReviewInteractiveRefresh = qaFocusReviewInteractiveRefresh;
})();
