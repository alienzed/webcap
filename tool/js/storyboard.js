(function () {
  'use strict';

  var storyState = {
    stories: [],
    story: null,
    saveTimer: 0,
    pendingStorySave: null,
    sceneTimers: {},
    storySavePromise: null,
    storySaveError: null,
    sceneSavePromises: {},
    sceneSaveErrors: {},
    generationJobs: {},
    generationReceipts: {},
    newTakeCounts: {},
    sequenceExport: null,
    sequenceEncodingWarnings: [],
    sequenceWarningsVisible: false,
    sequenceCollapsed: window.localStorage.getItem('webcap.storyboard.sequenceCollapsed') === '1',
    sceneViewMode: window.localStorage.getItem('webcap.storyboard.sceneView') || 'focus',
    activeSceneId: '',
    openStoryRequestId: 0,
    storyCollapsed: window.localStorage.getItem('webcap.storyboard.storyCollapsed') === '1',
    storyLibraryCompact: window.localStorage.getItem('webcap.storyboard.storyLibraryCompact') === '1',
    storyAction: null,
    storyActionQueue: [],
    storyActionTimer: 0,
    generationCapabilities: {
      loras: [],
      baseLoras: [],
      available: false,
      error: ''
    },
    director: {
      models: [],
      modelId: '',
      available: false,
      busy: false,
      pendingTargets: {},
      pendingOrder: [],
      recoveryJobs: {},
      runtimeLabel: '',
      error: '',
      activityTimer: 0,
      activityStartedAt: 0,
      activityHistory: [],
      activityLastMemory: null,
      activityLoadBaseline: null,
      activityLoadModelId: '',
      activityTarget: null,
      dismissedActivityTargetKey: '',
      sceneCompletions: {},
      activityErrorReported: false,
      activitySlotSample: null,
      requestByJobId: {}
    }
  };

  var STORY_SECTION_DEFAULTS = {
    story: true,
    continuity: false,
    defaults: false
  };

  var DIRECTOR_PASS_PRESETS = {
    continuity: {
      instruction: 'Review this Scene against the Story overview, visual atmosphere, continuity invariants, and the preceding Scene. Repair meaningful continuity gaps, contradictions, missing generation-critical context, or prompt omissions while preserving the Scene\'s intended action, chronology, and narrative purpose. If it is already coherent and complete, leave it unchanged.'
    }
  };

  var STORY_STYLE_PRESETS = [
    {
      id: 'naturalistic-cinematic',
      label: 'Naturalistic cinematic',
      text: 'Naturalistic cinematic realism, grounded performances, believable lighting, subtle camera movement, clean visual continuity, detailed real-world textures, restrained color grading, emotionally credible atmosphere.'
    },
    {
      id: 'moody-noir',
      label: 'Moody noir',
      text: 'Moody noir atmosphere, low-key lighting, deep shadows, reflective surfaces, cool dark palette with selective highlights, cinematic contrast, tension-filled framing, ominous and suspenseful tone.'
    },
    {
      id: 'dreamy-ethereal',
      label: 'Dreamy ethereal',
      text: 'Dreamy ethereal atmosphere, soft diffused light, gentle glow, delicate textures, airy composition, graceful movement, slightly surreal mood, poetic and emotionally elevated tone.'
    },
    {
      id: 'documentary-handheld',
      label: 'Documentary handheld',
      text: 'Documentary-style realism, handheld camera feel, observational framing, available-light look, raw environmental texture, immediate and unpolished atmosphere, grounded natural motion, candid emotional tone.'
    },
    {
      id: 'clean-commercial',
      label: 'Clean commercial',
      text: 'Clean polished commercial look, crisp lighting, carefully controlled composition, premium production design, flattering textures, refined color palette, smooth camera language, clear and appealing visual presentation.'
    },
    {
      id: 'warm-intimate-drama',
      label: 'Warm intimate drama',
      text: 'Warm intimate dramatic atmosphere, soft practical lighting, close human focus, gentle contrast, rich skin tones, emotionally sensitive framing, subtle camera movement, personal and vulnerable tone.'
    },
    {
      id: 'cool-futuristic-scifi',
      label: 'Cool futuristic sci-fi',
      text: 'Cool futuristic sci-fi aesthetic, sleek surfaces, controlled blue-cyan palette, luminous accents, modern production design, precise framing, polished high-tech atmosphere, immersive and slightly clinical tone.'
    },
    {
      id: 'stylized-painterly',
      label: 'Stylized painterly',
      text: 'Stylized painterly visual treatment, expressive composition, rich color design, textural surfaces, heightened artistic mood, visually curated framing, soft realism with artistic exaggeration, elegant cinematic tone.'
    },
    {
      id: 'gritty-urban-realism',
      label: 'Gritty urban realism',
      text: 'Gritty urban realism, worn textures, imperfect environments, practical lighting, muted palette, natural contrast, grounded camera language, rough lived-in atmosphere, emotionally tense and unsentimental tone.'
    },
    {
      id: 'epic-high-contrast',
      label: 'Epic high-contrast',
      text: 'Epic high-contrast cinematic style, bold lighting separation, dramatic scale, striking silhouettes, powerful composition, heightened visual intensity, dynamic atmosphere, emotionally forceful and visually assertive tone.'
    },
    {
      id: 'fashion-runway-editorial',
      label: 'Fashion runway editorial',
      text: 'High-fashion runway editorial, sculpted directional lighting, polished catwalk staging, confident model movement, graphic silhouettes, luxurious materials, bold styling, crisp composition, premium magazine-campaign energy.'
    },
    {
      id: 'luxury-fashion-film',
      label: 'Luxury fashion film',
      text: 'Luxury fashion-film aesthetic, elegant controlled movement, refined soft-to-hard lighting transitions, tactile fabrics, architectural framing, restrained glamour, premium color grading, sophisticated editorial atmosphere.'
    },
    {
      id: 'studio-beauty-campaign',
      label: 'Studio beauty campaign',
      text: 'Studio beauty-campaign look, immaculate controlled lighting, luminous skin and material detail, minimal backgrounds, precise close framing, polished movement, pristine surfaces, high-end cosmetic-advertising atmosphere.'
    },
    {
      id: 'theatrical-stage',
      label: 'Theatrical stage',
      text: 'Theatrical stage atmosphere, deliberate blocking, dramatic pools of light, visible depth and negative space, expressive silhouettes, heightened gestures, controlled staging, performance-first visual language.'
    },
    {
      id: 'retro-70s-celluloid',
      label: 'Retro 1970s celluloid',
      text: '1970s-inspired celluloid look, warm film stock, soft contrast, practical interiors, subtle grain, period color response, natural zooms and restrained camera movement, tactile analog atmosphere.'
    },
    {
      id: 'retro-80s-neon',
      label: 'Retro 1980s neon',
      text: '1980s neon-inflected atmosphere, saturated practical lights, glossy surfaces, deep colored shadows, bold geometric composition, hazy highlights, stylized nightlife energy, cinematic retro-futurist mood.'
    },
    {
      id: 'y2k-gloss',
      label: 'Y2K gloss',
      text: 'Y2K glossy visual language, bright flash-lit surfaces, chrome and translucent materials, playful futurism, punchy framing, cool highlights, pop-commercial polish, energetic turn-of-the-millennium styling.'
    },
    {
      id: 'sun-drenched-mediterranean',
      label: 'Sun-drenched Mediterranean',
      text: 'Sun-drenched Mediterranean atmosphere, hard natural sunlight, bleached stone and warm earth tones, bright skies, textured shadows, breezy movement, sensual realism, relaxed but visually rich composition.'
    },
    {
      id: 'pastel-pop',
      label: 'Pastel pop',
      text: 'Pastel pop aesthetic, clean graphic color blocking, soft candy-toned palette, playful composition, bright even light, crisp surfaces, upbeat movement, stylized but accessible commercial energy.'
    },
    {
      id: 'minimal-architectural',
      label: 'Minimal architectural',
      text: 'Minimal architectural visual language, strong lines and negative space, restrained palette, geometric framing, controlled natural or practical light, slow deliberate movement, elegant spatial composition, quiet precision.'
    },
    {
      id: 'clinical-sterile',
      label: 'Clinical sterile',
      text: 'Clinical sterile atmosphere, cool neutral palette, bright controlled illumination, clean hard surfaces, symmetrical composition, precise movement, low visual clutter, detached and highly ordered mood.'
    },
    {
      id: 'romantic-soft-focus',
      label: 'Romantic soft focus',
      text: 'Romantic soft-focus atmosphere, gentle bloom, warm diffused light, delicate contrast, intimate framing, graceful movement, tactile softness, emotionally heightened but tasteful cinematic tone.'
    },
    {
      id: 'surreal-dream-logic',
      label: 'Surreal dream logic',
      text: 'Surreal dream-logic visual language, uncanny but coherent spaces, unexpected scale or composition, smooth impossible-feeling transitions, controlled symbolism, atmospheric lighting, elegant visual disorientation without horror.'
    },
    {
      id: 'expressionist-shadow',
      label: 'Expressionist shadow',
      text: 'Expressionist shadow-driven style, exaggerated light and darkness, angular compositions, distorted spatial emphasis, bold silhouettes, theatrical contrast, psychologically charged visual tension.'
    },
    {
      id: 'coastal-natural-light',
      label: 'Coastal natural light',
      text: 'Coastal natural-light atmosphere, soft overcast or late-day sun, pale natural palette, open air, wind-shaped movement, reflective water and weathered textures, calm observational framing, understated cinematic realism.'
    },
    {
      id: 'kinetic-music-video',
      label: 'Kinetic music video',
      text: 'Kinetic music-video energy, bold camera movement, rhythmic framing, punchy lighting changes, expressive color, dynamic performance staging, visually memorable transitions, polished contemporary spectacle.'
    }
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function storySectionStorageKey(sectionName) {
    return 'webcap.storyboard.storySection.' + sectionName;
  }

  function initStorySections() {
    var sections = document.querySelectorAll('#storyboard-story-authoring details[data-story-section]');
    sections.forEach(function (section) {
      var sectionName = String(section.dataset.storySection || '');
      if (!Object.prototype.hasOwnProperty.call(STORY_SECTION_DEFAULTS, sectionName)) {
        throw new Error('Unknown Storyboard Story section: ' + sectionName);
      }
      var stored = window.localStorage.getItem(storySectionStorageKey(sectionName));
      section.open = stored === null ? STORY_SECTION_DEFAULTS[sectionName] : stored === '1';
      section.addEventListener('toggle', function () {
        window.localStorage.setItem(storySectionStorageKey(sectionName), section.open ? '1' : '0');
        if (directorActivityActive()) positionDirectorActivity();
      });
    });
  }

  function storyStylePresetById(presetId) {
    return STORY_STYLE_PRESETS.find(function (preset) {
      return preset.id === String(presetId || '');
    }) || null;
  }

  function storyStylePresetIdForText(value) {
    var normalized = String(value || '').trim();
    var match = STORY_STYLE_PRESETS.find(function (preset) {
      return preset.text === normalized;
    });
    return match ? match.id : '';
  }

  function renderStoryStylePresetSelector() {
    var select = el('storyboard-story-style-preset');
    var textarea = el('storyboard-story-style');
    if (!select || !textarea) return;
    if (!select.dataset.ready) {
      select.innerHTML = '<option value="">Custom…</option>' + STORY_STYLE_PRESETS.map(function (preset) {
        return '<option value="' + escapeHtml(preset.id) + '">' + escapeHtml(preset.label) + '</option>';
      }).join('');
      select.dataset.ready = '1';
    }
    select.value = storyStylePresetIdForText(textarea.value);
  }

  function applyStoryStylePreset(presetId) {
    var preset = storyStylePresetById(presetId);
    var textarea = el('storyboard-story-style');
    if (!textarea || !preset) return;
    textarea.value = preset.text;
    renderStoryStylePresetSelector();
    scheduleStorySave();
  }

  function reportError(err) {
    var message = String(err && err.message ? err.message : err || 'Storyboard request failed.');
    var status = el('storyboard-save-state');
    if (status) status.textContent = 'Error: ' + message;
    if (typeof reportConsoleError === 'function') reportConsoleError('Storyboard', err);
    else if (window.console && console.error) console.error('[Storyboard] ' + message, err);
  }

  function request(payload, query) {
    var url = '/fs/storyboard' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard request failed.');
        }
        return body;
      });
    });
  }

  function assemblyRequest(payload, query) {
    var url = '/fs/storyboard/assembly' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard sequence export failed.');
        }
        return body;
      });
    });
  }

  function refreshGenerationCapabilities() {
    return fetch('/fs/storyboard/generation/capabilities').then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard generation capabilities failed.');
        }
        storyState.generationCapabilities.available = body.available !== false;
        storyState.generationCapabilities.loras = body.loras || [];
        storyState.generationCapabilities.baseLoras = body.baseLoras || [];
        storyState.generationCapabilities.error = String(body.error || '');
        if (storyState.story) {
          renderStoryLoras();
          renderScenes();
        }
        return body;
      });
    }).catch(function (err) {
      storyState.generationCapabilities.available = false;
      storyState.generationCapabilities.loras = [];
      storyState.generationCapabilities.baseLoras = [];
      storyState.generationCapabilities.error = String(err && err.message ? err.message : err);
      if (storyState.story) {
        renderStoryLoras();
        renderScenes();
      }
      return null;
    });
  }

  function directorJobRequest(jobId, consume) {
    var url = '/fs/director/job?job=' + encodeURIComponent(jobId);
    if (consume) url += '&consume=1';
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok || !body.job) {
          throw new Error((body && body.error) || 'Storyboard Director job request failed.');
        }
        trackTransientLlmJob(body.job);
        if (['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(String(body.job.status || '')) !== -1) {
          reportTransientLlmTiming(body.job);
        }
        return body.job;
      });
    });
  }

  function waitForDirectorJob(job) {
    if (!job || !job.jobId) throw new Error('Storyboard Director did not return a queued job.');
    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') return Promise.resolve(current.result || {});
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        var terminalError = new Error(current.error || ('Storyboard Director job ' + status + '.'));
        terminalError.jobStatus = status;
        throw terminalError;
      }
      return new Promise(function (resolve) { setTimeout(resolve, directorJobPollDelay(current)); }).then(function () {
        return directorJobRequest(current.jobId, false);
      }).then(poll);
    }
    return poll(job);
  }

  function directorJobPollDelay(job) {
    return String(job && job.status || '') === 'queued' ? 3000 : 1500;
  }

  function directorQueueSnapshot(includeTerminal) {
    var url = '/fs/director/queue' + (includeTerminal ? '?includeTerminal=1' : '');
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok || !body.queue) {
          throw new Error((body && body.error) || 'Director queue snapshot failed.');
        }
        return body.queue;
      });
    });
  }

  function consumeDirectorJob(jobId) {
    return directorJobRequest(jobId, true).finally(function () {
      delete storyState.director.requestByJobId[String(jobId || '')];
    });
  }

  function directorTargetFromJob(job) {
    if (!job || job.client !== 'storyboard' || !job.storyId) return null;
    if (job.operation === 'expand_concept' || job.operation === 'define_invariants') return { kind: 'concept', storyId: job.storyId };
    if (job.operation === 'develop_story' || job.operation === 'insert_scene') return { kind: 'scenes', storyId: job.storyId };
    if (job.operation === 'repair_scenes') return { kind: 'repair', storyId: job.storyId };
    if ((job.operation === 'write_prompt' || job.operation === 'refine_prompt') && job.sceneId) {
      return { kind: 'scene-prompt', storyId: job.storyId, sceneId: job.sceneId, operation: job.operation };
    }
    return null;
  }

  function applyDirectorResultToVisibleStory(job) {
    var storyId = String(job && job.storyId || '');
    var sceneId = String(job && job.sceneId || '');
    var operation = String(job && job.operation || '');
    if (!storyId) return Promise.resolve();
    if ((operation === 'write_prompt' || operation === 'refine_prompt') && sceneId && job.clearCorrection === true) {
      markSceneDirectorCompletion(storyId, sceneId, operation);
    }

    return request(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      var canonical = payload.story;
      if (!storyState.story || String(storyState.story.id || '') !== storyId) {
        return refreshLibrary();
      }

      if ((operation === 'write_prompt' || operation === 'refine_prompt') && sceneId) {
        var savedScene = canonical && canonical.scenes ? canonical.scenes[sceneId] : null;
        var currentScene = storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
        if (savedScene && currentScene) {
          currentScene.summary = savedScene.summary;
          currentScene.entryState = savedScene.entryState;
          currentScene.exitState = savedScene.exitState;
          currentScene.prompt = savedScene.prompt;
          currentScene.previousPrompt = savedScene.previousPrompt;
          currentScene.previousRevision = savedScene.previousRevision || null;
          currentScene.promptDirectorModel = savedScene.promptDirectorModel;
          currentScene.promptDirectorJobId = savedScene.promptDirectorJobId;
          currentScene.refineComplete = !!savedScene.refineComplete;
          currentScene.durationSeconds = savedScene.durationSeconds;
          currentScene.updatedAt = savedScene.updatedAt;
          var currentRoot = sceneElement(sceneId);
          var currentSummary = currentRoot && currentRoot.querySelector('[data-scene-field="summary"]');
          var currentEntry = currentRoot && currentRoot.querySelector('[data-scene-field="entryState"]');
          var currentExit = currentRoot && currentRoot.querySelector('[data-scene-field="exitState"]');
          var currentPrompt = currentRoot && currentRoot.querySelector('[data-scene-field="prompt"]');
          var currentDuration = currentRoot && currentRoot.querySelector('[data-scene-field="durationSeconds"]');
          if (currentSummary) currentSummary.value = savedScene.summary || '';
          if (currentEntry) currentEntry.value = savedScene.entryState || '';
          if (currentExit) currentExit.value = savedScene.exitState || '';
          if (currentPrompt) currentPrompt.value = savedScene.prompt || '';
          if (currentDuration) currentDuration.value = savedScene.durationSeconds == null ? '' : savedScene.durationSeconds;
          if (operation === 'refine_prompt' && job.clearCorrection !== false) {
            var currentCorrection = currentRoot && currentRoot.querySelector('[data-director-correction]');
            if (currentCorrection) currentCorrection.value = '';
          }
          syncSceneDirectorRestore(sceneId);
          syncSceneRefineState(sceneId);
          updateSceneDirectorStatus(sceneId, 'Director completed.');
        }
      } else if (operation === 'insert_scene') {
        storyState.story.sceneOrder = canonical.sceneOrder || [];
        storyState.story.scenes = canonical.scenes || {};
        storyState.story.updatedAt = canonical.updatedAt;
        var anchorIndex = storyState.story.sceneOrder.indexOf(sceneId);
        var insertedSceneId = anchorIndex >= 0 ? storyState.story.sceneOrder[anchorIndex + 1] : '';
        if (insertedSceneId) {
          storyState.sceneViewMode = 'focus';
          storyState.activeSceneId = insertedSceneId;
          window.localStorage.setItem('webcap.storyboard.sceneView', 'focus');
        }
        renderScenes();
        renderStoryReadiness();
        setSaveState('Saved');
      } else if (operation === 'define_invariants') {
        storyState.story.invariants = canonical.invariants || [];
        storyState.story.updatedAt = canonical.updatedAt;
        renderStoryInvariants();
        setSaveState('Saved');
      } else if (operation === 'expand_concept') {
        storyState.story.concept = canonical.concept;
        storyState.story.previousConcept = canonical.previousConcept;
        storyState.story.updatedAt = canonical.updatedAt;
        var concept = el('storyboard-story-concept');
        if (concept) concept.value = canonical.concept || '';
        var restore = el('storyboard-restore-concept-btn');
        if (restore) restore.classList.toggle('hidden', typeof canonical.previousConcept !== 'string');
        setDevelopStatus('Concept expansion completed.');
      } else if (operation === 'repair_scenes') {
        storyState.story.scenes = canonical.scenes || {};
        storyState.story.previousSceneRepair = canonical.previousSceneRepair || null;
        storyState.story.repairInstruction = canonical.repairInstruction || '';
        storyState.story.repairComplete = !!canonical.repairComplete;
        storyState.story.updatedAt = canonical.updatedAt;
        renderScenes();
        renderStoryReadiness();
        setRepairStatus('Revise Scenes completed.');
      } else if (operation === 'develop_story') {
        storyState.story.sceneOrder = canonical.sceneOrder || [];
        storyState.story.scenes = canonical.scenes || {};
        storyState.story.removedScenes = canonical.removedScenes || {};
        storyState.story.development = canonical.development || null;
        storyState.story.updatedAt = canonical.updatedAt;
        storyState.sequenceExport = null;
      storyState.sequenceEncodingWarnings = [];
      storyState.sequenceWarningsVisible = false;
        renderScenes();
        renderStoryReadiness();
        var developButton = el('storyboard-develop-btn');
        if (developButton) developButton.textContent = storyState.story.sceneOrder.length ? 'Re-develop Scenes…' : 'Develop Scenes';
        setDevelopStatus('Story development completed.');
      }
      setSaveState('Saved');
      return refreshLibrary();
    });
  }

  function applyRecoveredDirectorResult(job) {
    return applyDirectorResultToVisibleStory(job);
  }

  function watchRecoveredDirectorJob(job) {
    if (!job || !job.jobId || storyState.director.recoveryJobs[job.jobId]) return;
    var target = directorTargetFromJob(job);
    if (!target) return;

    storyState.director.recoveryJobs[job.jobId] = true;
    if (!directorTargetPending(target)) setDirectorPending(target, true);
    startDirectorActivity();

    function poll(current) {
      var status = String(current.status || '');
      if (status === 'completed') {
        return consumeDirectorJob(current.jobId).then(function () {
          if (!libraryStory(current.storyId)) return;
          return applyRecoveredDirectorResult(current);
        });
      }
      if (['failed', 'cancelled', 'stopped', 'interrupted'].indexOf(status) !== -1) {
        return consumeDirectorJob(current.jobId).then(function () {
          throw new Error(current.error || ('Storyboard Director job ' + status + '.'));
        });
      }
      return new Promise(function (resolve) { setTimeout(resolve, directorJobPollDelay(current)); }).then(function () {
        return directorJobRequest(current.jobId, false);
      }).then(poll);
    }

    poll(job).catch(reportError).finally(function () {
      delete storyState.director.recoveryJobs[job.jobId];
      setDirectorPending(target, false);
      finishDirectorActivity();
    });
  }

  function reconcileDirectorJobs() {
    return directorQueueSnapshot(true).then(function (queue) {
      (queue.jobs || []).forEach(function (job) {
        if (!job || job.client !== 'storyboard') return;
        if (
          storyState.storyAction &&
          storyState.storyAction.active &&
          String(storyState.storyAction.storyId || '') === String(job.storyId || '')
        ) return;
        var target = directorTargetFromJob(job);
        if (target && !directorTargetPending(target)) watchRecoveredDirectorJob(job);
      });
    });
  }

  function directorRequest(payload) {
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch('/fs/storyboard/director', options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard Director request failed.');
        }
        if (payload && body.job) {
          if (body.job.request) storyState.director.requestByJobId[String(body.job.jobId || '')] = body.job.request;
          trackTransientLlmJob(body.job);
          return waitForDirectorJob(body.job).then(function (result) {
            result.jobId = body.job.jobId;
            if (payload.operation !== 'expand_concept' && payload.operation !== 'develop_story') return result;
            return request(null, 'story=' + encodeURIComponent(payload.storyId)).then(function (storyPayload) {
              result.story = storyPayload.story;
              return result;
            });
          }).catch(function (err) {
            return consumeDirectorJob(body.job.jobId).catch(function () {}).then(function () { throw err; });
          });
        }
        return body;
      });
    });
  }

  function renderDirectorSelector() {
    var select = el('storyboard-director-model');
    if (!select) return;

    var models = storyState.director.models || [];
    if (!storyState.director.available) {
      select.innerHTML = '<option value="">Director unavailable</option>';
      select.disabled = true;
      select.title = storyState.director.error || 'Director unavailable';
      return;
    }

    if (!models.length) {
      select.innerHTML = '<option value="">No Director models found</option>';
      select.disabled = true;
      select.title = 'No Director models available';
      return;
    }

    select.disabled = false;
    var selected = renderDirectorModelOptions(select, models, storyState.director.modelId);
    if (storyState.director.modelId !== selected) {
      storyState.director.modelId = selected;
      setDirectorModelPreference('webcap.storyboard.directorModel', selected);
    }
    select.title = '';
  }

  function refreshDirector() {
    return directorRequest(null).then(function (payload) {
      storyState.director.available = !!payload.available;
      storyState.director.models = payload.models || [];
      storyState.director.runtimeLabel = payload.runtime || '';
      storyState.director.error = payload.error || '';
      renderDirectorSelector();
      return payload;
    }).catch(function (err) {
      storyState.director.available = false;
      storyState.director.models = [];
      storyState.director.runtimeLabel = '';
      storyState.director.error = String(err && err.message ? err.message : err);
      renderDirectorSelector();
    });
  }

  function directorActivityRequest(url) {
    return fetch(url).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || body.ok === false) {
          throw new Error((body && body.error) || 'Director activity request failed.');
        }
        return body;
      });
    });
  }

  function directorPhaseLabel(phase) {
    var labels = {
      queued: 'Queued…',
      preparing: 'Preparing…',
      freeing_comfy: 'Preparing GPU…',
      loading_model: 'Loading model…',
      generating: 'Generating response…',
      complete: 'Complete',
      stopped: 'Stopped',
      error: 'Failed'
    };
    return labels[String(phase || '')] || 'Working…';
  }

  function directorMemoryGiB(mib) {
    var value = Number(mib);
    return isFinite(value) && value >= 0 ? (value / 1024).toFixed(1) + ' GiB' : '';
  }

  function directorBytesGiB(bytes) {
    var value = Number(bytes);
    return isFinite(value) && value > 0 ? (value / (1024 * 1024 * 1024)).toFixed(1) + ' GiB' : '';
  }

  function directorTokenCount(value) {
    var count = Number(value);
    if (!isFinite(count) || count < 0) return '';
    if (count < 1000) return String(Math.round(count));
    if (count < 10000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(count / 1000) + 'k';
  }

  function directorCompletionStats(activity) {
    var usage = activity && activity.usage && typeof activity.usage === 'object' ? activity.usage : {};
    var timings = activity && activity.timings && typeof activity.timings === 'object' ? activity.timings : {};
    var promptTokens = Number(usage.prompt_tokens);
    if (!isFinite(promptTokens)) promptTokens = Number(timings.prompt_n);
    var completionTokens = Number(usage.completion_tokens);
    if (!isFinite(completionTokens)) completionTokens = Number(timings.predicted_n);
    var totalTokens = Number(usage.total_tokens);
    if (!isFinite(totalTokens) && isFinite(promptTokens) && isFinite(completionTokens)) {
      totalTokens = promptTokens + completionTokens;
    }

    var speed = Number(timings.predicted_per_second);
    if ((!isFinite(speed) || speed <= 0) && isFinite(completionTokens)) {
      var predictedMs = Number(timings.predicted_ms);
      if (isFinite(predictedMs) && predictedMs > 0) speed = completionTokens / predictedMs * 1000;
    }

    var cachedTokens = NaN;
    var promptDetails = usage.prompt_tokens_details;
    if (promptDetails && typeof promptDetails === 'object') cachedTokens = Number(promptDetails.cached_tokens);
    if (!isFinite(cachedTokens)) cachedTokens = Number(usage.cached_tokens);
    if (!isFinite(cachedTokens)) cachedTokens = Number(timings.cached_n);
    if (!isFinite(cachedTokens)) cachedTokens = Number(timings.cache_n);

    var contextSize = Number(activity && activity.contextSize);
    var parts = [];
    if (isFinite(promptTokens) && promptTokens >= 0) parts.push(directorTokenCount(promptTokens) + ' in');
    if (isFinite(completionTokens) && completionTokens >= 0) parts.push(directorTokenCount(completionTokens) + ' out');
    if (isFinite(speed) && speed > 0) parts.push((speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)) + ' tok/s');
    if (isFinite(cachedTokens) && cachedTokens > 0) parts.push(directorTokenCount(cachedTokens) + ' cached');
    if (isFinite(totalTokens) && totalTokens >= 0 && isFinite(contextSize) && contextSize > 0) {
      parts.push(Math.max(0, Math.min(100, Math.round(totalTokens / contextSize * 100))) + '% ctx');
    }
    return parts;
  }

  function directorLiveStats(activity) {
    var slot = activity && activity.slot && typeof activity.slot === 'object' ? activity.slot : null;
    if (!slot || String(activity.phase || '') !== 'generating') {
      storyState.director.activitySlotSample = null;
      return [];
    }

    var now = Date.now();
    var generated = Number(slot.generatedTokens);
    var promptTokens = Number(slot.promptTokens);
    var promptProcessed = Number(slot.promptProcessed);
    var contextSize = Number(slot.contextSize || activity.contextSize);
    var maxTokens = Number(slot.maxTokens);
    var parts = [];

    if (isFinite(generated) && generated >= 0) {
      var previous = storyState.director.activitySlotSample;
      var processed = isFinite(promptProcessed) ? promptProcessed : 0;
      var changed = !previous || generated !== previous.tokens || processed !== previous.promptProcessed;
      var lastChangeTime = previous ? previous.lastChangeTime : now;
      if (previous && generated > previous.tokens && now > previous.time) {
        var speed = (generated - previous.tokens) / ((now - previous.time) / 1000);
        if (isFinite(speed) && speed > 0) parts.push((speed >= 10 ? speed.toFixed(0) : speed.toFixed(1)) + ' tok/s');
      }
      if (changed) lastChangeTime = now;
      storyState.director.activitySlotSample = {
        tokens: generated,
        promptProcessed: processed,
        time: now,
        lastChangeTime: lastChangeTime
      };
      parts.unshift(directorTokenCount(generated) + ' generated');
      var stalledSeconds = Math.floor((now - lastChangeTime) / 1000);
      if (stalledSeconds >= 30) parts.push('no token progress ' + String(stalledSeconds) + 's');
    }

    if (isFinite(promptTokens) && promptTokens > 0) {
      if (isFinite(promptProcessed) && promptProcessed >= 0 && promptProcessed < promptTokens) {
        parts.push(directorTokenCount(promptProcessed) + '/' + directorTokenCount(promptTokens) + ' prompt');
      } else {
        parts.push(directorTokenCount(promptTokens) + ' prompt');
      }
    }

    if (isFinite(contextSize) && contextSize > 0) {
      var used = (isFinite(promptTokens) ? promptTokens : 0) + (isFinite(generated) ? generated : 0);
      parts.push(directorTokenCount(used) + '/' + directorTokenCount(contextSize) + ' ctx');
    }
    if (isFinite(maxTokens)) parts.push(maxTokens < 0 ? 'output Auto' : ('max ' + directorTokenCount(maxTokens) + ' out'));
    return parts;
  }

  function directorMemorySample(system) {
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var ramBytes = ram && ram.available ? Number(ram.used) : NaN;
    var vramMiB = primary ? Number(primary.memoryUsed) : NaN;
    if (!isFinite(ramBytes) || !isFinite(vramMiB)) return null;
    return {
      ramBytes: ramBytes,
      vramBytes: vramMiB * 1024 * 1024
    };
  }

  function updateDirectorModelLoad(activity, system) {
    var meter = el('storyboard-director-model-load');
    var label = el('storyboard-director-model-load-label');
    var fill = el('storyboard-director-model-load-fill');
    if (!meter || !label || !fill) return;

    var phase = String(activity && activity.phase || '');
    var sample = directorMemorySample(system);
    if (phase !== 'loading_model') {
      meter.classList.add('hidden');
      if (sample) storyState.director.activityLastMemory = sample;
      if (phase === 'preparing' || phase === 'queued' || phase === 'freeing_comfy') {
        storyState.director.activityLoadBaseline = null;
        storyState.director.activityLoadModelId = '';
      }
      return;
    }

    var modelId = String(activity && activity.model || '');
    if (storyState.director.activityLoadModelId !== modelId) {
      storyState.director.activityLoadModelId = modelId;
      storyState.director.activityLoadBaseline = storyState.director.activityLastMemory || sample;
    } else if (!storyState.director.activityLoadBaseline && sample) {
      storyState.director.activityLoadBaseline = storyState.director.activityLastMemory || sample;
    }

    var track = meter.querySelector('.director-model-load-track');
    var modelSizeBytes = Number(activity && activity.modelSizeBytes);
    var baseline = storyState.director.activityLoadBaseline;
    meter.classList.remove('hidden');

    if (!sample || !baseline) {
      label.textContent = 'Waiting for memory sample…';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'Waiting for a RAM / VRAM sample before estimating Director model residency.';
      return;
    }

    if (!isFinite(modelSizeBytes) || modelSizeBytes <= 0) {
      label.textContent = 'Model size unavailable';
      fill.style.width = '0%';
      if (track) track.removeAttribute('aria-valuenow');
      meter.title = 'WebCap could not resolve the selected model size from llama.cpp metadata or the configured model path.';
      return;
    }

    var ramDelta = Math.max(0, sample.ramBytes - baseline.ramBytes);
    var vramDelta = Math.max(0, sample.vramBytes - baseline.vramBytes);
    var residentBytes = Math.max(0, ramDelta + vramDelta);
    var displayBytes = Math.min(modelSizeBytes, residentBytes);
    var percent = Math.max(0, Math.min(100, residentBytes / modelSizeBytes * 100));
    label.textContent = '≈ ' + directorBytesGiB(displayBytes) + ' / ' + directorBytesGiB(modelSizeBytes) + ' · ~' + Math.round(percent) + '%';
    fill.style.width = percent.toFixed(1) + '%';
    if (track) track.setAttribute('aria-valuenow', String(Math.round(percent)));
    meter.title = 'Approximate model residency from RAM + VRAM growth since loading began. mmap, caching, and GPU offload can make this differ from the GGUF file size.';
  }

  function directorTrendPath(history, key) {
    var path = '';
    var cutoff = Date.now() - 60000;
    history.forEach(function (sample, index) {
      var value = sample[key];
      if (!isFinite(value)) return;
      var x = Math.max(0, Math.min(120, (sample.time - cutoff) / 60000 * 120));
      var y = 28 - Math.max(0, Math.min(100, value)) * 0.26;
      path += (path ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return path;
  }

  function updateDirectorTrend(activity, system) {
    var graph = el('storyboard-director-activity-trend');
    if (!graph) throw new Error('Storyboard Director system history markup is missing.');
    var remote = String(activity && activity.runtimeMode || '') === 'remote';
    graph.classList.toggle('is-remote', remote);
    var legend = graph.querySelector('.director-activity-trend-legend');
    var plot = graph.querySelector('svg');
    if (legend) legend.classList.toggle('hidden', remote);
    if (plot) plot.classList.toggle('hidden', remote);
    if (remote) {
      storyState.director.activityHistory = [];
      graph.setAttribute('aria-label', 'Remote runtime telemetry');
      return;
    }
    var gpu = system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    var ram = system && system.ram;
    var vramPercent = primary ? Number(primary.memoryUsed) / Number(primary.memoryTotal) * 100 : NaN;
    var ramPercent = ram && ram.available ? Number(ram.used) / Number(ram.total) * 100 : NaN;
    var gpuPercent = primary ? Number(primary.utilization) : NaN;
    var gpuTemperature = primary ? Number(primary.temperature) : NaN;
    if (isFinite(vramPercent) || isFinite(ramPercent) || isFinite(gpuPercent) || isFinite(gpuTemperature)) {
      storyState.director.activityHistory.push({
        time: Date.now(),
        ram: ramPercent,
        vram: vramPercent,
        gpu: gpuPercent,
        thermal: gpuTemperature
      });
      if (storyState.director.activityHistory.length > 40) storyState.director.activityHistory.shift();
    }
    var cutoff = Date.now() - 60000;
    while (storyState.director.activityHistory.length && storyState.director.activityHistory[0].time < cutoff) storyState.director.activityHistory.shift();
    var history = storyState.director.activityHistory;
    graph.querySelector('.director-activity-trend-ram-line').setAttribute('d', directorTrendPath(history, 'ram'));
    graph.querySelector('.director-activity-trend-vram-line').setAttribute('d', directorTrendPath(history, 'vram'));
    graph.querySelector('.director-activity-trend-gpu-line').setAttribute('d', directorTrendPath(history, 'gpu'));
    graph.querySelector('.director-activity-trend-thermal-line').setAttribute('d', directorTrendPath(history, 'thermal'));
    var latest = history[history.length - 1];
    var latestParts = [];
    if (latest) {
      if (isFinite(latest.ram)) latestParts.push('RAM ' + Math.round(latest.ram) + '%');
      if (isFinite(latest.vram)) latestParts.push('VRAM ' + Math.round(latest.vram) + '%');
      if (isFinite(latest.gpu)) latestParts.push('GPU ' + Math.round(latest.gpu) + '%');
      if (isFinite(latest.thermal)) latestParts.push('GPU temperature ' + Math.round(latest.thermal) + '°C');
    }
    graph.setAttribute('aria-label', latestParts.length
      ? 'System history for the last minute. Latest: ' + latestParts.join(', ') + '. ' + history.length + ' samples.'
      : 'System history, waiting for samples');
  }
  function directorActivityTargetElement() {
    var target = storyState.director.activityTarget || {};
    var currentStoryId = storyState.story ? String(storyState.story.id || '') : '';
    var targetStoryId = String(target.storyId || '');
    if (targetStoryId && targetStoryId !== currentStoryId) return null;

    if (target.kind === 'concept') {
      return el('storyboard-story-overview');
    }
    if (
      target.kind === 'scene-prompt' ||
      target.kind === 'scenes' ||
      target.kind === 'repair'
    ) {
      return document.querySelector('.storyboard-scene-workspace');
    }
    return document.querySelector('.storyboard-scene-workspace');
  }

  function positionDirectorActivity() {
    var card = el('storyboard-director-activity');
    var editor = document.querySelector('.storyboard-editor');
    var sceneWorkspace = document.querySelector('.storyboard-scene-workspace');
    var kind = String((storyState.director.activityTarget || {}).kind || '');
    var target = directorActivityTargetElement();
    if (!card || !editor) return;

    var detachedTarget = !!kind && !target;
    var hidden = card.classList.contains('hidden');
    var fillsWorkspace = (
      kind === 'scene-prompt' ||
      kind === 'scenes' ||
      kind === 'repair'
    );
    var fillsOverview = kind === 'concept';
    var fillsRegion = fillsWorkspace || fillsOverview;
    if (sceneWorkspace) {
      sceneWorkspace.classList.toggle('director-active', fillsWorkspace && !detachedTarget && !hidden);
    }

    card.classList.toggle('is-detached-target', detachedTarget);
    card.classList.toggle('is-workspace-overlay', fillsRegion);
    if (detachedTarget || !target || hidden) return;

    var editorRect = editor.getBoundingClientRect();
    var targetRect = target.getBoundingClientRect();
    card.classList.toggle('is-structure-overlay', !fillsRegion);

    card.style.height = '';

    if (fillsRegion) {
      var workspaceWidth = Math.max(0, targetRect.width - 48);
      var availableWidth = Math.max(0, editorRect.width - 24);
      var preferredOverlayWidth = 840;
      var cardWidth = Math.min(preferredOverlayWidth, workspaceWidth || preferredOverlayWidth, availableWidth || preferredOverlayWidth);
      cardWidth = Math.max(320, cardWidth);
      if (cardWidth > availableWidth && availableWidth > 0) cardWidth = availableWidth;
      card.style.width = Math.round(cardWidth) + 'px';
      card.style.left = Math.round(
        targetRect.left - editorRect.left + Math.max(0, (targetRect.width - cardWidth) / 2)
      ) + 'px';

      window.requestAnimationFrame(function () {
        if (card.classList.contains('hidden')) return;
        var targetTop = targetRect.top - editorRect.top;
        var insetTop = 24;
        var centeredTop = targetTop + Math.max(insetTop, (targetRect.height - card.offsetHeight) / 2);
        var maxTop = targetTop + Math.max(insetTop, targetRect.height - card.offsetHeight - insetTop);
        card.style.top = Math.round(Math.max(targetTop + insetTop, Math.min(maxTop, centeredTop))) + 'px';
      });
      return;
    }

    var preferredWidth = 440;
    var targetWidth = Math.max(0, targetRect.width - 24);
    var editorWidth = Math.max(0, editorRect.width - 24);
    var structureWidth = Math.min(preferredWidth, targetWidth || preferredWidth, editorWidth || preferredWidth);
    structureWidth = Math.max(300, structureWidth);
    if (structureWidth > editorWidth && editorWidth > 0) structureWidth = editorWidth;

    card.style.width = Math.round(structureWidth) + 'px';

    var left = targetRect.right - editorRect.left - structureWidth - 12;
    var top = targetRect.top - editorRect.top + 12;
    var maxLeft = Math.max(12, editorRect.width - structureWidth - 12);
    left = Math.max(12, Math.min(maxLeft, left));

    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(12, top)) + 'px';

    window.requestAnimationFrame(function () {
      if (card.classList.contains('hidden')) return;
      var maxTop = Math.max(12, editorRect.height - card.offsetHeight - 12);
      var currentTop = parseFloat(card.style.top) || 12;
      card.style.top = Math.round(Math.max(12, Math.min(maxTop, currentTop))) + 'px';
    });
  }

  function directorActivityForTargetQueue(activity, queue) {
    var target = storyState.director.activityTarget;
    if (!target || !queue || !Array.isArray(queue.jobs)) return null;

    var targetKey = directorTargetKey(target);
    var job = queue.jobs.find(function (candidate) {
      var candidateTarget = directorTargetFromJob(candidate);
      if (target.kind === 'story-action') {
        return candidateTarget && String(candidateTarget.storyId || '') === String(target.storyId || '');
      }
      if (target.kind === 'repair') {
        return candidateTarget
          && candidateTarget.kind === 'scene-prompt'
          && String(candidateTarget.storyId || '') === String(target.storyId || '')
          && candidate.operation === 'refine_prompt';
      }
      return candidateTarget && directorTargetKey(candidateTarget) === targetKey;
    });
    if (!job) return null;

    var jobId = String(job.jobId || '');
    var jobStatus = String(job.status || '');
    var active = String(queue.activeJobId || '') === jobId;
    if (jobStatus !== 'queued' || active) {
      if (!active && jobStatus !== 'queued') {
        return {
          active: true,
          phase: 'preparing',
          model: job.modelId || '',
          operation: job.operation || '',
          startedAt: job.startedAt || job.createdAt,
          jobId: jobId,
          jobStatus: jobStatus
        };
      }
      return Object.assign({}, activity || {}, {
        jobId: jobId,
        jobStatus: jobStatus
      });
    }

    var queuedPosition = Math.max(1, Number(job.queuePosition) || 1);
    var activeAhead = queue.activeJobId && String(queue.activeJobId) !== jobId ? 1 : 0;
    var ahead = Math.max(0, queuedPosition - 1 + activeAhead);
    var waitOwner = ahead > 0 ? 'llm' : String(queue.waitOwner || '');
    var waitReason = ahead > 0
      ? String(ahead) + ' Director / Prompt Assistant request' + (ahead === 1 ? ' is' : 's are') + ' ahead.'
      : String(queue.waitReason || '');

    return {
      active: true,
      phase: 'queued',
      model: job.modelId || '',
      operation: job.operation || '',
      startedAt: job.createdAt,
      queuePosition: queuedPosition,
      queueAhead: ahead,
      queueDepth: Number(queue.queueDepth) || 0,
      waitOwner: waitOwner,
      waitReason: waitReason,
      jobId: jobId,
      jobStatus: jobStatus
    };
  }

  function directorQueuedLabel(activity) {
    if (!activity || String(activity.phase || '') !== 'queued') return [];
    var ahead = Math.max(0, Number(activity.queueAhead) || 0);
    var parts = [ahead > 0 ? ('Queue #' + String(ahead + 1)) : 'Next in queue'];
    var owner = String(activity.waitOwner || '');
    var ownerLabels = {
      llm: 'Waiting for Director',
      inference: 'Waiting for Inference',
      training: 'Waiting for Training',
      paused: 'Queue paused',
      unknown: 'Waiting for GPU'
    };
    if (ownerLabels[owner]) parts.push(ownerLabels[owner]);
    return parts;
  }

  function directorRequestDiagnosticLabel(request) {
    request = request && typeof request === 'object' ? request : null;
    if (!request) return '';
    var count = Number(request.messageCount) || 0;
    var chars = Number(request.contentChars) || 0;
    return 'Prompt sent · ' + (count === 1 ? '1 msg' : String(count) + ' msgs') + ' · ' + chars.toLocaleString() + ' chars · Copy';
  }

  function copyDirectorRequestDiagnostic(request) {
    if (!request || !Array.isArray(request.messages)) throw new Error('Director request diagnostic is missing its messages.');
    return navigator.clipboard.writeText(JSON.stringify(request.messages, null, 2));
  }

  function renderDirectorActivity(activity, system) {
    var card = el('storyboard-director-activity');
    var phase = el('storyboard-director-activity-phase');
    var detail = el('storyboard-director-activity-detail');
    var stop = el('storyboard-director-stop');
    var copy = el('storyboard-director-prompt-copy');
    if (!card || !phase || !detail || !stop || !copy) throw new Error('Storyboard Director activity markup is missing.');

    var phaseName = String(activity && activity.phase || '');
    var terminal = activity && ['complete', 'error', 'stopped'].indexOf(phaseName) !== -1;
    var activityTargetKey = directorTargetKey(storyState.director.activityTarget);
    var dismissed = !!(
      activityTargetKey &&
      storyState.director.dismissedActivityTargetKey === activityTargetKey
    );
    var visible = !dismissed && (directorActivityActive() || (activity && activity.active) || terminal);
    card.classList.toggle('hidden', !visible);
    var jobId = String(activity && activity.jobId || '');
    var jobStatus = String(activity && activity.jobStatus || '');
    var canStop = !!jobId && ['completed', 'failed', 'cancelled', 'stopped', 'interrupted'].indexOf(jobStatus) === -1;
    stop.dataset.directorJobId = jobId;
    stop.classList.toggle('hidden', !canStop);
    stop.disabled = jobStatus === 'stopping';
    stop.textContent = jobStatus === 'stopping' ? 'Stopping…' : 'Stop';
    var requestDiagnostic = storyState.director.requestByJobId[jobId] || null;
    var requestLabel = directorRequestDiagnosticLabel(requestDiagnostic);
    copy.classList.toggle('hidden', !requestLabel);
    copy.textContent = requestLabel;
    copy.dataset.directorJobId = jobId;
    copy.title = requestLabel ? 'Copy the exact messages WebCap sent to the LLM' : '';
    positionDirectorActivity();
    if (!visible) return;
    updateDirectorTrend(activity, system);
    updateDirectorModelLoad(activity, String(activity && activity.runtimeMode || '') === 'remote' ? null : system);
    phase.textContent = directorPhaseLabel(activity && activity.phase);
    var startedAt = Number(activity && activity.startedAt) || storyState.director.activityStartedAt;
    var parts = [];
    directorQueuedLabel(activity).forEach(function (label) {
      var reason = String(activity && activity.waitReason || '');
      parts.push('<span' + (reason ? ' title="' + escapeHtml(reason) + '"' : '') + '>' + escapeHtml(label) + '</span>');
    });
    if (startedAt) {
      var endedAt = terminal ? Number(activity && activity.updatedAt) : Date.now() / 1000;
      if (!isFinite(endedAt) || endedAt < startedAt) endedAt = Date.now() / 1000;
      parts.push('<span>' + escapeHtml(String(Math.max(0, Math.round(endedAt - startedAt))) + 's elapsed') + '</span>');
    }
    if (terminal && String(activity && activity.phase || '') === 'complete') {
      directorCompletionStats(activity).forEach(function (stat) {
        parts.push('<span>' + escapeHtml(stat) + '</span>');
      });
    } else {
      directorLiveStats(activity).forEach(function (stat) {
        parts.push('<span>' + escapeHtml(stat) + '</span>');
      });
    }

    var isRemote = String(activity && activity.runtimeMode || '') === 'remote';
    if (isRemote) {
      var provider = String(activity && activity.runtimeProvider || '').trim();
      parts.push('<span>' + escapeHtml(provider === 'ollama' ? 'Remote Ollama' : 'Remote') + '</span>');
      var showRemoteModelTelemetry = phaseName !== 'queued';
      var remoteModelSizeBytes = showRemoteModelTelemetry ? Number(activity && activity.modelSizeBytes) : NaN;
      if (isFinite(remoteModelSizeBytes) && remoteModelSizeBytes > 0) {
        parts.push('<span>Model ' + escapeHtml(directorBytesGiB(remoteModelSizeBytes)) + '</span>');
      }
      var remoteVramBytes = showRemoteModelTelemetry ? Number(activity && activity.remoteModelVramBytes) : NaN;
      if (isFinite(remoteVramBytes) && remoteVramBytes > 0) {
        parts.push('<span title="Model bytes reported resident on the remote GPU">GPU-resident ' + escapeHtml(directorBytesGiB(remoteVramBytes)) + '</span>');
      }
      var remoteContextSize = showRemoteModelTelemetry ? Number(activity && activity.contextSize) : NaN;
      if (isFinite(remoteContextSize) && remoteContextSize > 0 && phaseName !== 'complete') {
        parts.push('<span>' + escapeHtml(directorTokenCount(remoteContextSize)) + ' ctx</span>');
      }
    }

    var gpu = !isRemote && system && system.gpu;
    var primary = gpu && gpu.available && Array.isArray(gpu.gpus) ? gpu.gpus[0] : null;
    if (primary) {
      var utilization = Number(primary.utilization);
      if (isFinite(utilization)) {
        parts.push('<span title="GPU utilization">GPU ' + Math.round(utilization) + '%</span>');
      }
      var memoryUsed = Number(primary.memoryUsed);
      var memoryTotal = Number(primary.memoryTotal);
      var used = directorMemoryGiB(memoryUsed);
      var total = directorMemoryGiB(memoryTotal);
      var vramPercent = memoryTotal > 0 ? memoryUsed / memoryTotal * 100 : NaN;
      if (isFinite(vramPercent)) {
        var vramTitle = used && total ? used + ' used of ' + total : '';
        parts.push('<span' + (vramTitle ? ' title="' + escapeHtml(vramTitle) + '"' : '') + '>VRAM ' + Math.round(vramPercent) + '%</span>');
      }
    }

    var ram = !isRemote && system && system.ram;
    if (ram && ram.available) {
      var ramUsedBytes = Number(ram.used);
      var ramTotalBytes = Number(ram.total);
      var ramUsed = directorBytesGiB(ramUsedBytes);
      var ramTotal = directorBytesGiB(ramTotalBytes);
      var ramPercent = ramTotalBytes > 0 ? ramUsedBytes / ramTotalBytes * 100 : NaN;
      if (isFinite(ramPercent)) {
        var ramTitle = ramUsed && ramTotal ? ramUsed + ' used of ' + ramTotal : '';
        parts.push('<span' + (ramTitle ? ' title="' + escapeHtml(ramTitle) + '"' : '') + '>RAM ' + Math.round(ramPercent) + '%</span>');
      }
    }
    detail.innerHTML = parts.join(' · ');
  }

  function directorActivityActive() {
    return storyState.director.busy;
  }

  function directorActivityForCurrentRun(activity) {
    if (!activity) return activity;

    var localStartedAt = Number(storyState.director.activityStartedAt) || 0;
    var phase = String(activity.phase || '');
    var terminal = ['complete', 'error', 'stopped'].indexOf(phase) !== -1;
    if (!localStartedAt || !terminal) return activity;

    var activityTime = Math.max(
      Number(activity.startedAt) || 0,
      Number(activity.updatedAt) || 0
    );
    if (activityTime >= localStartedAt) return activity;

    return Object.assign({}, activity, {
      phase: 'preparing',
      active: true,
      startedAt: localStartedAt
    });
  }

  function refreshDirectorActivity() {
    if (!directorActivityActive()) return Promise.resolve();
    return Promise.all([
      directorActivityRequest('/fs/director/activity'),
      directorActivityRequest('/fs/system_status').catch(function () { return null; })
    ]).then(function (values) {
      storyState.director.activityErrorReported = false;
      observeTransientLlmActivity(values[0]);
      var scopedActivity = directorActivityForTargetQueue(values[0], values[0] && values[0].queue);
      renderDirectorActivity(directorActivityForCurrentRun(scopedActivity), values[1]);
    }).catch(function (err) {
      var card = el('storyboard-director-activity');
      if (card) card.classList.add('hidden');
      positionDirectorActivity();
      if (!storyState.director.activityErrorReported) {
        storyState.director.activityErrorReported = true;
        reportError(err);
      }
    }).then(function () {
      if (!directorActivityActive()) return;
      if (storyState.director.activityTimer) clearTimeout(storyState.director.activityTimer);
      storyState.director.activityTimer = setTimeout(refreshDirectorActivity, 2500);
    });
  }

  function directorWasStopped(err) {
    return !!(err && ['stopped', 'cancelled'].indexOf(String(err.jobStatus || '')) !== -1);
  }

  function stopDirectorJob() {
    var button = el('storyboard-director-stop');
    var jobId = String(button && button.dataset.directorJobId || '');
    if (!button || !jobId || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Stopping…';
    fetch('/fs/director/job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'stop_or_cancel', jobId: jobId })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || body.ok === false) {
          throw new Error((body && body.error) || 'Director Stop failed.');
        }
        return body;
      });
    }).then(function () {
      storyState.director.dismissedActivityTargetKey = directorTargetKey(storyState.director.activityTarget);
      var card = el('storyboard-director-activity');
      if (card) card.classList.add('hidden');
      positionDirectorActivity();
    }).catch(function (err) {
      button.disabled = false;
      button.textContent = 'Stop';
      reportError(err);
    });
  }

  function startDirectorActivity() {
    if (storyState.director.pendingOrder.length === 1) {
      storyState.director.dismissedActivityTargetKey = '';
      storyState.director.activityStartedAt = Date.now() / 1000;
      storyState.director.activityHistory = [];
      storyState.director.activitySlotSample = null;
      storyState.director.activityErrorReported = false;
      renderDirectorActivity({ phase: 'preparing', active: true, startedAt: storyState.director.activityStartedAt }, null);
    } else {
      positionDirectorActivity();
    }
    if (!storyState.director.activityTimer) refreshDirectorActivity();
  }

  function finishDirectorActivity() {
    if (storyState.director.activityTimer) clearTimeout(storyState.director.activityTimer);
    storyState.director.activityTimer = 0;
    if (directorActivityActive()) {
      positionDirectorActivity();
      refreshDirectorActivity();
      return;
    }

    var card = el('storyboard-director-activity');
    if (card) card.classList.add('hidden');
    positionDirectorActivity();
    storyState.director.activityTarget = null;
    storyState.director.activityStartedAt = 0;
  }

  function updateSceneDirectorStatus(sceneId, text) {
    var message = String(text || '');
    var root = sceneElement(sceneId);
    var node = root && root.querySelector('[data-director-status]');
    if (node) node.textContent = message;
    if (message) reportConsoleInfo(generationConsoleLabel(sceneId), message);
  }

  function syncSceneDirectorRestore(sceneId) {
    var root = sceneElement(sceneId);
    var button = root && root.querySelector('[data-director-restore]');
    if (!button) return;
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    button.classList.toggle('hidden', !scene || typeof scene.previousPrompt !== 'string');
  }

  function syncSceneRefineState(sceneId) {
    var root = sceneElement(sceneId);
    var button = root && root.querySelector('[data-director-refine]');
    if (!button) return;
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var correction = root.querySelector('[data-director-correction]');
    var complete = !!(scene && scene.refineComplete) && !(correction && correction.value.trim());
    button.textContent = complete ? '✓' : 'Refine';
    button.title = complete
      ? 'Last refinement completed. Start typing another instruction to refine again.'
      : 'Apply this correction to the existing generation prompt.';
  }

  function restoreSceneDirectorPrompt(sceneId) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'scene-prompt', storyId: storyId, sceneId: sceneId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('That Scene prompt already has Director work pending.'));
      return;
    }
    flushPendingSaves().then(function () {
      return request({
        operation: 'restore_previous_prompt',
        storyId: storyId,
        sceneId: sceneId
      });
    }).then(function (payload) {
      if (!storyState.story || String(storyState.story.id || '') !== String(storyId)) return;
      storyState.story.scenes[sceneId] = payload.scene;
      var root = sceneElement(sceneId);
      var summary = root && root.querySelector('[data-scene-field="summary"]');
      var entry = root && root.querySelector('[data-scene-field="entryState"]');
      var exit = root && root.querySelector('[data-scene-field="exitState"]');
      var prompt = root && root.querySelector('[data-scene-field="prompt"]');
      var duration = root && root.querySelector('[data-scene-field="durationSeconds"]');
      if (summary) summary.value = payload.scene.summary || '';
      if (entry) entry.value = payload.scene.entryState || '';
      if (exit) exit.value = payload.scene.exitState || '';
      if (prompt) prompt.value = payload.scene.prompt || '';
      if (duration) duration.value = payload.scene.durationSeconds == null ? '' : payload.scene.durationSeconds;
      syncSceneDirectorRestore(sceneId);
      syncSceneRefineState(sceneId);
      updateSceneDirectorStatus(sceneId, 'Previous prompt restored.');
      setSaveState('Saved');
    }).catch(reportError);
  }

  function directorContractPreviewText(contract) {
    contract = contract || {};
    var parts = [String(contract.prompt || '')];
    if (contract.response_schema) {
      parts.push('--- OUTPUT SCHEMA ---\n' + JSON.stringify(contract.response_schema, null, 2));
    } else {
      parts.push('--- OUTPUT ---\n' + String(contract.output || 'text'));
    }
    if (contract.result_renderer) {
      parts.push('--- WEBCAP RESULT RENDERER ---\n' + JSON.stringify(contract.result_renderer, null, 2));
    }
    return parts.filter(Boolean).join('\n\n');
  }

  function previewDirectorRequest(sceneId, operation) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');
    var output = root.querySelector('[data-director-request-preview-output]');
    if (!output) throw new Error('Director request preview output is missing.');

    var instruction = '';
    if (operation === 'refine_prompt') {
      var correction = root.querySelector('[data-director-correction]');
      instruction = correction ? correction.value.trim() : '';
      if (!instruction) {
        output.textContent = 'Enter a refinement instruction first.';
        return;
      }
    }

    output.textContent = 'Building exact Director request…';
    flushPendingSaves().then(function () {
      return directorRequest({
        storyId: storyId,
        sceneId: sceneId,
        operation: operation,
        model: storyState.director.modelId,
        instruction: instruction,
        previewOnly: true
      });
    }).then(function (payload) {
      output.textContent = directorContractPreviewText(payload.contract);
    }).catch(function (err) {
      output.textContent = 'Director request preview failed: ' + String(err && err.message ? err.message : err);
      reportError(err);
    });
  }

  function requestSceneDirector(storyId, sceneId, operation, instruction, modelId, clearCorrection) {
    return directorRequest({
      storyId: storyId,
      sceneId: sceneId,
      operation: operation,
      model: modelId,
      instruction: instruction || ''
    }).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        sceneId: sceneId,
        operation: operation,
        jobId: payload.jobId,
        clearCorrection: clearCorrection
      }).then(function () {
        return consumeDirectorJob(payload.jobId).then(function () {
          return payload;
        });
      });
    });
  }

  function runSceneDirectorPass(storyId, sceneIds, instruction, modelId, onScene) {
    return sceneIds.reduce(function (promise, sceneId, index) {
      return promise.then(function () {
        if (onScene) onScene(sceneId, index);
        return requestSceneDirector(storyId, sceneId, 'refine_prompt', instruction, modelId, false);
      });
    }, Promise.resolve());
  }

  function requestStoryDirector(storyId, operation, modelId, replaceExisting) {
    var requestPayload = {
      storyId: storyId,
      operation: operation,
      model: modelId
    };
    if (operation === 'develop_story') requestPayload.replaceExisting = !!replaceExisting;
    return directorRequest(requestPayload).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        operation: operation,
        jobId: payload.jobId
      }).then(function () {
        syncDirectorPendingControls();
        return consumeDirectorJob(payload.jobId).then(function () {
          return payload;
        });
      });
    });
  }

  function runDirector(sceneId, operation) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'scene-prompt', storyId: storyId, sceneId: sceneId, operation: operation };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('That Scene prompt already has Director work pending.'));
      return;
    }
    if (!storyState.director.modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');

    var instruction = '';
    if (operation === 'refine_prompt') {
      var correction = root.querySelector('[data-director-correction]');
      instruction = correction ? correction.value.trim() : '';
      if (!instruction) {
        updateSceneDirectorStatus(sceneId, 'Enter a correction first.');
        return;
      }
    }

    var saveBarrier = flushPendingSaves();
    clearSceneDirectorCompletion(storyId, sceneId);
    setDirectorPending(directorTarget, true);
    updateSceneDirectorStatus(sceneId, 'Director working…');
    startDirectorActivity();
    saveBarrier.then(function () {
      return requestSceneDirector(storyId, sceneId, operation, instruction, storyState.director.modelId, true);
    }).catch(function (err) {
      if (directorWasStopped(err)) updateSceneDirectorStatus(sceneId, 'Director stopped');
      else {
        updateSceneDirectorStatus(sceneId, 'Director failed');
        reportError(err);
      }
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function setDevelopStatus(text) {
    var message = String(text || '');
    var node = el('storyboard-develop-status');
    if (node) node.textContent = message;
    if (message) reportConsoleInfo('Storyboard', message);
  }

  function setRepairStatus(text) {
    var message = String(text || '');
    var node = el('storyboard-repair-status');
    if (node) node.textContent = message;
    if (message) reportConsoleInfo('Storyboard', message);
  }


  function directorTargetKey(target) {
    target = target || {};
    var storyId = String(target.storyId || '');
    if (!storyId) return '';
    if (target.kind === 'concept') return 'story-concept:' + storyId;
    if (target.kind === 'scenes') return 'story-scenes:' + storyId;
    if (target.kind === 'repair') return 'story-repair:' + storyId;
    if (target.kind === 'story-action') return 'story-action:' + storyId;
    if (target.kind === 'scene-prompt' && target.sceneId) {
      return 'scene-prompt:' + storyId + ':' + String(target.sceneId);
    }
    return '';
  }

  function directorTargetPending(target) {
    var key = directorTargetKey(target);
    return !!(key && storyState.director.pendingTargets[key]);
  }

  function directorTargetsConflict(target, pending) {
    if (!target || !pending || String(target.storyId || '') !== String(pending.storyId || '')) return false;
    if (target.kind === 'story-action' || pending.kind === 'story-action') return true;
    if (target.kind === 'concept') return pending.kind === 'concept';
    if (target.kind === 'scenes' || target.kind === 'repair') return true;
    if (target.kind === 'scene-prompt') {
      if (pending.kind === 'concept' || pending.kind === 'scenes' || pending.kind === 'repair') return true;
      return pending.kind === 'scene-prompt'
        && String(target.sceneId || '') === String(pending.sceneId || '');
    }
    return false;
  }

  function directorTargetBlocked(target) {
    if (target && target.kind !== 'story-action' && queuedFirstCutForStory(target.storyId)) return true;
    return Object.keys(storyState.director.pendingTargets).some(function (key) {
      return directorTargetsConflict(target, storyState.director.pendingTargets[key]);
    });
  }

  function setDirectorRegionProtected(region, protectedState) {
    if (!region) throw new Error('Storyboard Director protection region is missing.');
    region.inert = !!protectedState;
    region.classList.toggle('director-protected', !!protectedState);
    if (protectedState) region.setAttribute('aria-busy', 'true');
    else region.removeAttribute('aria-busy');
  }

  function setDirectorTargetProtected(target, protectedState) {
    target = target || {};
    if (!storyState.story || String(target.storyId || '') !== String(storyState.story.id || '')) return;
    if (target.kind === 'story-action') {
      document.querySelectorAll(
        '#storyboard-story-authoring button, #storyboard-story-authoring input, #storyboard-story-authoring select, #storyboard-story-authoring textarea, ' +
        '#storyboard-scenes-list button, #storyboard-scenes-list input, #storyboard-scenes-list select, #storyboard-scenes-list textarea, ' +
        '#storyboard-scene-progression [data-scene-action], #storyboard-scene-progression [data-scene-progress-add], ' +
        '#storyboard-sequence-preview button, #storyboard-generate-scenes-btn, #storyboard-director-model'
      ).forEach(function (control) {
        if (control.matches('[data-story-action-cancel]')) return;
        if (protectedState) {
          if (!control.disabled) {
            control.disabled = true;
            control.dataset.storyActionDisabled = '1';
          }
        } else if (control.dataset.storyActionDisabled === '1') {
          control.disabled = false;
          delete control.dataset.storyActionDisabled;
        }
      });
      return;
    }
    if (target.kind === 'concept') {
      setDirectorRegionProtected(el('storyboard-story-overview'), protectedState);
      return;
    }
    if (target.kind === 'scenes') {
      setDirectorRegionProtected(el('storyboard-story-authoring'), protectedState);
      setDirectorRegionProtected(document.querySelector('.storyboard-scene-workspace'), protectedState);
      return;
    }
    if (target.kind === 'scene-prompt' || target.kind === 'repair') {
      setDirectorRegionProtected(document.querySelector('.storyboard-scene-workspace'), protectedState);
    }
  }

  function syncDirectorPendingControls() {
    var currentStoryId = storyState.story ? String(storyState.story.id || '') : '';
    var conceptTarget = { kind: 'concept', storyId: currentStoryId };
    var repairTarget = { kind: 'repair', storyId: currentStoryId };
    var selector = el('storyboard-director-model');

    document.querySelectorAll('[data-story-action-disabled="1"]').forEach(function (control) {
      control.disabled = false;
      delete control.dataset.storyActionDisabled;
    });
    setDirectorRegionProtected(el('storyboard-story-authoring'), false);
    setDirectorRegionProtected(el('storyboard-story-overview'), false);
    setDirectorRegionProtected(document.querySelector('.storyboard-scene-workspace'), false);
    if (selector) selector.disabled = !storyState.director.available || !(storyState.director.models || []).length;

    setDirectorTargetProtected(conceptTarget, directorTargetPending(conceptTarget));
    setDirectorTargetProtected(repairTarget, directorTargetPending(repairTarget));
    Object.keys(storyState.director.pendingTargets).forEach(function (key) {
      setDirectorTargetProtected(storyState.director.pendingTargets[key], true);
    });
    syncPlanReplacementControls();
  }

  function setDirectorPending(target, pending) {
    var key = directorTargetKey(target);
    if (!key) throw new Error('Storyboard Director target is missing its Story identity.');

    if (pending) {
      if (storyState.director.pendingTargets[key]) {
        throw new Error('Storyboard Director target is already pending: ' + key);
      }
      storyState.director.pendingTargets[key] = target;
      storyState.director.pendingOrder.push(key);
    } else {
      var existing = storyState.director.pendingTargets[key];
      if (existing) setDirectorTargetProtected(existing, false);
      if (storyState.director.dismissedActivityTargetKey === key) {
        storyState.director.dismissedActivityTargetKey = '';
      }
      delete storyState.director.pendingTargets[key];
      storyState.director.pendingOrder = storyState.director.pendingOrder.filter(function (pendingKey) {
        return pendingKey !== key;
      });
    }

    storyState.director.busy = storyState.director.pendingOrder.length > 0;
    setShellDirectorActive(storyState.director.busy);
    storyState.director.activityTarget = storyState.director.pendingOrder.length
      ? storyState.director.pendingTargets[storyState.director.pendingOrder[0]]
      : null;
    syncDirectorPendingControls();
  }

  function defineInvariants() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'concept', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('That Director target already has pending work.'));
      return;
    }
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var concept = el('storyboard-story-concept').value.trim();
    if (!concept) {
      setSaveState('Write a Story concept first.');
      return;
    }

    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    startDirectorActivity();
    saveBarrier.then(function () {
      return directorRequest({
        storyId: storyId,
        operation: 'define_invariants',
        model: modelId
      });
    }).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        operation: 'define_invariants',
        jobId: payload.jobId
      }).then(function () {
        reportConsoleInfo('Storyboard', 'Defined ' + String(payload.addedCount || 0) + ' new Story invariant' + (Number(payload.addedCount || 0) === 1 ? '' : 's') + ' from the concept.');
        return consumeDirectorJob(payload.jobId);
      });
    }).catch(function (err) {
      if (!directorWasStopped(err)) reportError(err);
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function expandConcept() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'concept', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('That Director target already has pending work.'));
      return;
    }
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var concept = el('storyboard-story-concept').value.trim();
    if (!concept) {
      setDevelopStatus('Write a Story concept first.');
      return;
    }

    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    setDevelopStatus('Director is expanding the concept…');
    startDirectorActivity();
    saveBarrier.then(function () {
      return directorRequest({
        storyId: storyId,
        operation: 'expand_concept',
        model: modelId
      });
    }).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        operation: 'expand_concept',
        jobId: payload.jobId
      }).then(function () {
        setDevelopStatus('Concept expanded with ' + String(payload.model || modelId) + '.');
        return consumeDirectorJob(payload.jobId);
      });
    }).catch(function (err) {
      if (directorWasStopped(err)) setDevelopStatus('Concept expansion stopped.');
      else {
        setDevelopStatus('Concept expansion failed.');
        reportError(err);
      }
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function restorePreviousConcept() {
    if (!storyState.story || typeof storyState.story.previousConcept !== 'string') return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'concept', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('The Story concept already has Director work pending.'));
      return;
    }
    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    setSaveState('Saving...');
    saveBarrier.then(function () {
      return request({
        operation: 'restore_previous_concept',
        storyId: storyId
      });
    }).then(function (payload) {
      if (!storyState.story || storyState.story.id !== storyId) return;
      storyState.story = payload.story;
      renderStory();
      setDevelopStatus('Previous concept restored.');
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(reportError).finally(function () {
      setDirectorPending(directorTarget, false);
    });
  }

  function reviseScenes(instruction, modelId) {
    if (!storyState.story) return Promise.reject(new Error('Choose a Story first.'));
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'repair', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      return Promise.reject(new Error('This Story already has Director work that conflicts with Revise Scenes.'));
    }
    modelId = String(modelId || storyState.director.modelId || '');
    if (!modelId) return Promise.reject(new Error('Choose a Director model first.'));

    var sceneIds = Array.isArray(storyState.story.sceneOrder)
      ? storyState.story.sceneOrder.slice()
      : [];
    if (!sceneIds.length) return Promise.reject(new Error('Develop Scenes first.'));

    instruction = String(instruction || '').trim();
    if (!instruction) return Promise.reject(new Error('Enter what should be revised across these Scenes.'));

    storyState.story.repairInstruction = instruction;
    storyState.story.repairComplete = false;

    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    startDirectorActivity();
    return saveBarrier.then(function () {
      return runSceneDirectorPass(
        storyId,
        sceneIds,
        instruction,
        modelId,
        function (sceneId, index) {
          var scene = storyState.story && storyState.story.scenes
            ? storyState.story.scenes[sceneId]
            : null;
          setRepairStatus(
            'Revising Scene ' + String(index + 1) + ' / ' + String(sceneIds.length)
            + (scene && scene.title ? ' · ' + scene.title : '')
          );
        }
      );
    }).then(function () {
      if (storyState.story && String(storyState.story.id || '') === String(storyId)) {
        storyState.story.repairComplete = true;
        scheduleStorySave();
      }
      setRepairStatus('Revised ' + String(sceneIds.length) + ' Scenes.');
      return { text: 'Revised ' + String(sceneIds.length) + ' Scenes.' };
    }).catch(function (err) {
      if (directorWasStopped(err)) setRepairStatus('Revise Scenes stopped.');
      else setRepairStatus('Revise Scenes failed.');
      throw err;
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
      if (typeof window.refreshAssistantModes === 'function') window.refreshAssistantModes();
    });
  }


  function developStory() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var directorTarget = { kind: 'scenes', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('This Story already has Director work that conflicts with Develop Scenes.'));
      return;
    }
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }
    var concept = el('storyboard-story-concept').value.trim();
    if (!concept) {
      setDevelopStatus('Write a Story concept first.');
      return;
    }

    var hasScenes = Array.isArray(storyState.story.sceneOrder) && storyState.story.sceneOrder.length > 0;
    if (hasScenes && !window.confirm(
      'Developing this Story again will replace the active Scene plan. Existing Scenes and Takes will remain recoverable in Removed Scenes. Continue?'
    )) return;

    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    setDevelopStatus('Director is developing the Story…');
    startDirectorActivity();
    saveBarrier.then(function () {
      return directorRequest({
        storyId: storyId,
        operation: 'develop_story',
        model: modelId,
        replaceExisting: hasScenes
      });
    }).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        operation: 'develop_story',
        jobId: payload.jobId
      }).then(function () {
        setDevelopStatus('Developed ' + String(payload.sceneCount || 0) + ' Scenes with ' + String(payload.model || modelId) + '.');
        return consumeDirectorJob(payload.jobId);
      });
    }).catch(function (err) {
      if (directorWasStopped(err)) setDevelopStatus('Story development stopped.');
      else {
        setDevelopStatus('Story development failed.');
        reportError(err);
      }
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function storyActionElapsed(seconds) {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    var minutes = Math.floor(seconds / 60);
    var remainder = seconds % 60;
    return minutes ? (String(minutes) + 'm ' + String(remainder) + 's') : (String(remainder) + 's');
  }

  function queuedFirstCutForStory(storyId) {
    storyId = String(storyId || '');
    return storyState.storyActionQueue.find(function (action) {
      return !action.cancelled && String(action.storyId || '') === storyId;
    }) || null;
  }

  function firstCutQueuePosition(action) {
    var index = storyState.storyActionQueue.indexOf(action);
    return index < 0 ? 0 : index + 1;
  }

  function firstCutQueueDisplayPosition(action) {
    return firstCutQueuePosition(action) + (
      storyState.storyAction && storyState.storyAction.active ? 1 : 0
    );
  }

  function removeQueuedFirstCut(storyId) {
    storyId = String(storyId || '');
    var removed = null;
    storyState.storyActionQueue = storyState.storyActionQueue.filter(function (action) {
      if (!removed && String(action.storyId || '') === storyId) {
        removed = action;
        return false;
      }
      return true;
    });
    if (removed) {
      removed.queued = false;
      removed.cancelled = true;
    }
    return removed;
  }

  function renderStoryAction() {
    if (storyState.storyActionTimer) clearTimeout(storyState.storyActionTimer);
    storyState.storyActionTimer = 0;

    var button = el('storyboard-first-cut-btn');
    var card = el('storyboard-story-action-card');
    var phase = el('storyboard-story-action-phase');
    var detail = el('storyboard-story-action-detail');
    var elapsed = el('storyboard-story-action-elapsed');
    var cancel = el('storyboard-story-action-cancel');
    if (!button || !card || !phase || !detail || !elapsed || !cancel) {
      throw new Error('Storyboard Story action card markup is missing.');
    }

    var currentStoryId = storyState.story ? String(storyState.story.id || '') : '';
    var activeAction = storyState.storyAction;
    var queuedAction = queuedFirstCutForStory(currentStoryId);
    var action = activeAction && String(activeAction.storyId || '') === currentStoryId
      ? activeAction
      : queuedAction;
    var queued = !!(action && action.queued);
    var anotherRunning = !!(activeAction && activeAction.active);

    button.textContent = anotherRunning ? 'Queue First Cut' : 'First Cut';
    button.classList.toggle('hidden', !!(action && (action.active || queued)));
    card.classList.toggle('hidden', !action);
    syncPlanReplacementControls();
    if (!action) return;

    if (queued) {
      var displayPosition = firstCutQueueDisplayPosition(action);
      var ahead = Math.max(0, displayPosition - 1);
      phase.textContent = 'Queued · #' + String(displayPosition);
      detail.textContent = ahead
        ? String(ahead) + ' First Cut' + (ahead === 1 ? '' : 's') + ' ahead.'
        : 'Next First Cut.';
      elapsed.textContent = storyActionElapsed(
        (Date.now() / 1000) - Number(action.queuedAt || Date.now() / 1000)
      ) + ' queued' + (action.modelId ? ' · ' + action.modelId : '');
      cancel.classList.remove('hidden');
      storyState.storyActionTimer = setTimeout(renderStoryAction, 1000);
      return;
    }

    phase.textContent = action.phase || 'Preparing';
    detail.textContent = action.detail || '';
    elapsed.textContent = storyActionElapsed((Date.now() / 1000) - Number(action.startedAt || Date.now() / 1000))
      + (action.modelId ? ' · ' + action.modelId : '');
    cancel.classList.toggle('hidden', !action.active);
    if (action.active) storyState.storyActionTimer = setTimeout(renderStoryAction, 1000);
  }

  function cancelStoryAction() {
    var visibleStoryId = storyState.story ? String(storyState.story.id || '') : '';
    var queued = queuedFirstCutForStory(visibleStoryId);
    if (queued) {
      removeQueuedFirstCut(visibleStoryId);
      renderLibrary();
      renderStoryAction();
      return;
    }

    var action = storyState.storyAction;
    if (!action || !action.active || String(action.storyId || '') !== visibleStoryId) return;
    action.cancelled = true;
    action.detail = 'Stopping…';
    renderStoryAction();
    stopDirectorJob();
  }

  function requireStoryAction(action) {
    if (storyState.storyAction !== action || action.cancelled) {
      var err = new Error('First Cut stopped.');
      err.storyActionStopped = true;
      throw err;
    }
  }

  function updateStoryAction(action, phase, detail) {
    if (storyState.storyAction !== action) return;
    action.phase = phase;
    action.detail = detail || '';
    renderStoryAction();
  }

  function runFirstCut(action) {
    if (!action || action.cancelled) return;
    if (storyState.storyAction && storyState.storyAction.active) {
      throw new Error('Cannot start a second First Cut while one is active.');
    }

    var storyId = String(action.storyId || '');
    var modelId = String(action.modelId || '');
    var directorTarget = { kind: 'story-action', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      action.active = false;
      action.queued = false;
      action.phase = 'Failed';
      action.detail = 'This Story has Director work in progress.';
      storyState.storyAction = action;
      reportError(new Error('Queued First Cut could not start because this Story has Director work in progress.'));
      renderLibrary();
      renderStoryAction();
      startNextFirstCut();
      return;
    }

    action.active = true;
    action.queued = false;
    action.cancelled = false;
    action.startedAt = Date.now() / 1000;
    action.phase = 'Preparing';
    action.detail = '';
    storyState.storyAction = action;
    setDirectorPending(directorTarget, true);
    startDirectorActivity();
    renderLibrary();
    renderStoryAction();

    var replaceExisting = false;
    flushPendingSaves().then(function () {
      requireStoryAction(action);
      return request(null, 'story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      requireStoryAction(action);
      var actionStory = payload.story;
      replaceExisting = Array.isArray(actionStory && actionStory.sceneOrder) && actionStory.sceneOrder.length > 0;
      updateStoryAction(action, 'Expanding Concept', '');
      return requestStoryDirector(storyId, 'expand_concept', modelId, false);
    }).then(function () {
      requireStoryAction(action);
      updateStoryAction(action, 'Defining Continuity', '');
      return requestStoryDirector(storyId, 'define_invariants', modelId, false);
    }).then(function () {
      requireStoryAction(action);
      updateStoryAction(action, 'Developing Scenes', '');
      return requestStoryDirector(storyId, 'develop_story', modelId, replaceExisting);
    }).then(function () {
      requireStoryAction(action);
      return request(null, 'story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      requireStoryAction(action);
      var actionStory = payload.story;
      var sceneIds = Array.isArray(actionStory && actionStory.sceneOrder)
        ? actionStory.sceneOrder.slice()
        : [];
      if (!sceneIds.length) throw new Error('First Cut developed no Scenes.');
      action.sceneCount = sceneIds.length;
      updateStoryAction(action, 'Refining Scenes', '0 / ' + String(sceneIds.length));
      return runSceneDirectorPass(
        storyId,
        sceneIds,
        DIRECTOR_PASS_PRESETS.continuity.instruction,
        modelId,
        function (sceneId, index) {
          requireStoryAction(action);
          var scene = actionStory.scenes && actionStory.scenes[sceneId];
          updateStoryAction(
            action,
            'Refining Scenes',
            String(index + 1) + ' / ' + String(sceneIds.length)
              + (scene && scene.title ? ' · ' + scene.title : '')
          );
        }
      ).then(function () {
        return sceneIds;
      });
    }).then(function (sceneIds) {
      requireStoryAction(action);
      updateStoryAction(action, 'Queuing First Takes', '0 / ' + String(sceneIds.length));
      return sceneIds.reduce(function (promise, sceneId, index) {
        return promise.then(function () {
          requireStoryAction(action);
          updateStoryAction(
            action,
            'Queuing First Takes',
            String(index + 1) + ' / ' + String(sceneIds.length)
          );
          return enqueueSceneGeneration(storyId, sceneId);
        });
      }, Promise.resolve());
    }).then(function () {
      requireStoryAction(action);
      action.active = false;
      action.phase = 'Complete';
      action.detail = 'First Takes queued.';
      setDevelopStatus('First Cut queued one Take for every Scene.');
      renderStoryAction();
      return refreshLibrary();
    }).catch(function (err) {
      action.active = false;
      if (action.cancelled || err.storyActionStopped || directorWasStopped(err)) {
        action.phase = 'Stopped';
        action.detail = 'Completed steps were kept.';
      } else {
        action.phase = 'Failed';
        action.detail = String(err && err.message ? err.message : err);
        reportError(err);
      }
      renderStoryAction();
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
      renderLibrary();
      renderStoryAction();
      startNextFirstCut();
    });
  }

  function startNextFirstCut() {
    if (storyState.storyAction && storyState.storyAction.active) return;
    var next = null;
    while (storyState.storyActionQueue.length && !next) {
      var candidate = storyState.storyActionQueue.shift();
      if (!candidate.cancelled) next = candidate;
    }
    renderLibrary();
    renderStoryAction();
    if (next) runFirstCut(next);
  }

  function startFirstCut() {
    if (!storyState.story) return;

    var storyId = String(storyState.story.id || '');
    if (
      (storyState.storyAction && storyState.storyAction.active
        && String(storyState.storyAction.storyId || '') === storyId)
      || queuedFirstCutForStory(storyId)
    ) {
      reportError(new Error('This Story already has a First Cut running or queued.'));
      return;
    }

    var modelId = String(storyState.director.modelId || '');
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }

    var directorTarget = { kind: 'story-action', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('This Story already has Director work in progress.'));
      return;
    }

    var action = {
      storyId: storyId,
      modelId: modelId,
      active: false,
      queued: false,
      cancelled: false,
      queuedAt: Date.now() / 1000,
      startedAt: 0,
      phase: 'Preparing',
      detail: ''
    };

    if (storyState.storyAction && storyState.storyAction.active) {
      action.queued = true;
      action.phase = 'Queued';
      storyState.storyActionQueue.push(action);
      renderLibrary();
      renderStoryAction();
      return;
    }

    runFirstCut(action);
  }

  function setSaveState(text) {
    var node = el('storyboard-save-state');
    if (node) node.textContent = text || '';
    if (
      text &&
      typeof reportConsoleInfo === 'function' &&
      text !== 'Saved' &&
      text !== 'Saving...' &&
      text !== 'Unsaved changes' &&
      text !== 'Loading...'
    ) {
      reportConsoleInfo('Storyboard', text);
    }
  }

  function invariantRowHtml(item, expanded) {
    item = item || {};
    var kind = String(item.kind || 'custom');
    var title = String(item.title || '');
    var invariantText = String(item.text || '');
    var labels = { visual: 'Visual', character: 'Character', location: 'Location', world: 'World', sound: 'Sound', custom: 'Custom' };
    return '<div class="storyboard-invariant-row' + (expanded ? ' is-open' : '') + '" data-story-invariant-row>' +
      '<div class="storyboard-invariant-row-head">' +
        '<button type="button" class="storyboard-invariant-toggle" data-story-invariant-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '" title="' + (expanded ? 'Collapse invariant' : 'Expand invariant') + '" aria-label="' + (expanded ? 'Collapse invariant' : 'Expand invariant') + '">▸</button>' +
        '<select data-story-invariant-kind aria-label="Invariant type">' +
          Object.keys(labels).map(function (value) {
            return '<option value="' + value + '"' + (value === kind ? ' selected' : '') + '>' + labels[value] + '</option>';
          }).join('') +
        '</select>' +
        '<input type="text" data-story-invariant-title value="' + escapeHtml(title) + '" placeholder="Name / subject" aria-label="Invariant name">' +
        '<button type="button" class="storyboard-invariant-remove" data-story-invariant-remove title="Remove invariant" aria-label="Remove invariant">×</button>' +
      '</div>' +
      '<div class="storyboard-invariant-body">' +
        '<textarea data-story-invariant-text rows="2" placeholder="What must stay consistent across Scenes?" aria-label="Invariant description">' + escapeHtml(invariantText) + '</textarea>' +
      '</div>' +
    '</div>';
  }

  function setInvariantRowOpen(row, open) {
    if (!row) return;
    row.classList.toggle('is-open', !!open);
    var toggle = row.querySelector('[data-story-invariant-toggle]');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('title', open ? 'Collapse invariant' : 'Expand invariant');
    toggle.setAttribute('aria-label', open ? 'Collapse invariant' : 'Expand invariant');
  }

  function storyInvariantsFromUi() {
    var list = el('storyboard-invariants-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('[data-story-invariant-row]'), function (row) {
      return {
        kind: row.querySelector('[data-story-invariant-kind]').value,
        title: row.querySelector('[data-story-invariant-title]').value,
        text: row.querySelector('[data-story-invariant-text]').value
      };
    }).filter(function (item) { return !!String(item.text || '').trim(); });
  }

  function renderStoryInvariants() {
    var list = el('storyboard-invariants-list');
    if (!list || !storyState.story) return;
    var invariants = Array.isArray(storyState.story.invariants) ? storyState.story.invariants : [];
    list.innerHTML = invariants.map(function (item) { return invariantRowHtml(item, false); }).join('');
  }

  function setStoryCollapsed(collapsed) {
    storyState.storyCollapsed = !!collapsed;
    window.localStorage.setItem('webcap.storyboard.storyCollapsed', storyState.storyCollapsed ? '1' : '0');
    var authoring = el('storyboard-story-authoring');
    var editor = el('storyboard-editor-content');
    var toggleButton = el('storyboard-story-toggle');
    authoring.classList.toggle('hidden', storyState.storyCollapsed);
    editor.classList.toggle('story-collapsed', storyState.storyCollapsed);
    toggleButton.textContent = storyState.storyCollapsed ? 'Show Overview' : 'Hide Overview';
    toggleButton.setAttribute('aria-expanded', storyState.storyCollapsed ? 'false' : 'true');
  }

  function ensureActiveScene(order) {
    order = Array.isArray(order) ? order : [];
    if (!order.length) {
      storyState.activeSceneId = '';
      return '';
    }
    if (order.indexOf(storyState.activeSceneId) < 0) storyState.activeSceneId = order[0];
    return storyState.activeSceneId;
  }

  function sceneDirectorCompletionKey(storyId, sceneId) {
    return String(storyId || '') + ':' + String(sceneId || '');
  }

  function sceneDirectorCompletionNotice(sceneId) {
    if (!storyState.story || !sceneId) return null;
    return storyState.director.sceneCompletions[
      sceneDirectorCompletionKey(storyState.story.id, sceneId)
    ] || null;
  }

  function sceneDirectorCompletionDescription(notice) {
    var operation = String(notice && notice.operation || '');
    if (operation === 'refine_prompt') return 'Refine completed while you were elsewhere.';
    if (operation === 'write_prompt') return 'Write with Director completed while you were elsewhere.';
    return 'Director update completed while you were elsewhere.';
  }

  function sceneDirectorCompletionHtml(sceneId) {
    var notice = sceneDirectorCompletionNotice(sceneId);
    var description = notice ? sceneDirectorCompletionDescription(notice) : '';
    return '<span class="storyboard-scene-progress-director-complete' + (notice ? '' : ' hidden') +
      '" data-scene-director-completion' +
      (notice
        ? ' title="' + escapeHtml(description) + '" aria-label="' + escapeHtml(description) + '"'
        : ' aria-hidden="true"') +
      '>✓</span>';
  }

  function sceneDirectorCompletionVisible(storyId, sceneId) {
    var workspace = el('storyboard-workspace');
    return !!(
      workspace &&
      !workspace.classList.contains('hidden') &&
      storyState.story &&
      String(storyState.story.id || '') === String(storyId || '') &&
      storyState.sceneViewMode === 'focus' &&
      String(storyState.activeSceneId || '') === String(sceneId || '')
    );
  }

  function markSceneDirectorCompletion(storyId, sceneId, operation) {
    if (!storyId || !sceneId || sceneDirectorCompletionVisible(storyId, sceneId)) return;
    storyState.director.sceneCompletions[sceneDirectorCompletionKey(storyId, sceneId)] = {
      operation: operation
    };
    if (storyState.story && String(storyState.story.id || '') === String(storyId)) {
      syncSceneProgressionCard(sceneId);
    }
  }

  function clearSceneDirectorCompletion(storyId, sceneId) {
    if (!storyId || !sceneId) return;
    var key = sceneDirectorCompletionKey(storyId, sceneId);
    if (!Object.prototype.hasOwnProperty.call(storyState.director.sceneCompletions, key)) return;
    delete storyState.director.sceneCompletions[key];
    if (storyState.story && String(storyState.story.id || '') === String(storyId)) {
      syncSceneProgressionCard(sceneId);
    }
  }

  function clearSceneNewTakeCount(sceneId) {
    if (!sceneId) return;
    delete storyState.newTakeCounts[sceneId];
  }

  function sceneProgressionIndicatorsHtml(sceneId) {
    var newTakeCount = Number(storyState.newTakeCounts[sceneId] || 0);
    var jobs = generationJobsForScene(sceneId);
    var queuedCount = jobs.filter(function (job) {
      return ['backlog', 'queued'].indexOf(String(job.status || '')) !== -1;
    }).length;
    var activeCount = jobs.filter(function (job) {
      return ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
    }).length;
    var workBadge = activeCount
      ? '<span class="storyboard-scene-progress-work is-generating" title="' + String(activeCount) + ' active generation' + (activeCount === 1 ? '' : 's') + '"></span>'
      : (queuedCount
        ? '<span class="storyboard-scene-progress-work is-queued" title="' + String(queuedCount) + ' queued generation' + (queuedCount === 1 ? '' : 's') + '">Q' + (queuedCount > 1 ? String(queuedCount) : '') + '</span>'
        : '');
    return workBadge +
      (newTakeCount ? '<span class="storyboard-scene-progress-badge" title="' + String(newTakeCount) + ' new Take' + (newTakeCount === 1 ? '' : 's') + '">' + String(newTakeCount) + '</span>' : '');
  }

  function syncSceneProgressionCard(sceneId) {
    if (!sceneId || !storyState.story) return;
    var card = document.querySelector('.storyboard-scene-progress-card[data-scene-id="' + CSS.escape(sceneId) + '"]');
    if (!card) return;
    var scene = storyState.story.scenes && storyState.story.scenes[sceneId] || {};
    card.classList.toggle('has-selected-take', !!scene.selectedTakeId);
    var indicators = card.querySelector('.storyboard-scene-progress-indicators');
    var title = card.querySelector('[data-scene-progress-title]');
    var directorCompletion = card.querySelector('[data-scene-director-completion]');
    if (!indicators || !title || !directorCompletion) throw new Error('Storyboard Scene progression card markup is missing.');
    indicators.innerHTML = sceneProgressionIndicatorsHtml(sceneId);
    title.textContent = scene.title || 'Untitled Scene';
    var notice = sceneDirectorCompletionNotice(sceneId);
    directorCompletion.classList.toggle('hidden', !notice);
    if (notice) {
      var description = sceneDirectorCompletionDescription(notice);
      directorCompletion.title = description;
      directorCompletion.setAttribute('aria-label', description);
      directorCompletion.removeAttribute('aria-hidden');
    } else {
      directorCompletion.removeAttribute('title');
      directorCompletion.removeAttribute('aria-label');
      directorCompletion.setAttribute('aria-hidden', 'true');
    }
  }

  function markSceneNewTake(sceneId) {
    if (!sceneId || !storyState.story) return;
    if (storyState.sceneViewMode === 'focus' && storyState.activeSceneId === sceneId) return;
    storyState.newTakeCounts[sceneId] = Number(storyState.newTakeCounts[sceneId] || 0) + 1;
    syncSceneProgressionCard(sceneId);
  }

  function renderSceneProgression(order) {
    var host = el('storyboard-scene-progression');
    if (!host || !storyState.story) return;
    order = Array.isArray(order) ? order : [];
    var scenes = storyState.story.scenes || {};
    var active = ensureActiveScene(order);
    host.innerHTML = order.map(function (sceneId, index) {
      var scene = scenes[sceneId] || {};
      var isCurrent = storyState.sceneViewMode === 'focus' && sceneId === active;
      var planDirectorModel = String(scene.planDirectorModel || '').trim();
      return '<div class="storyboard-scene-progress-card' +
          (isCurrent ? ' active' : '') +
          (scene.selectedTakeId ? ' has-selected-take' : '') +
          '" data-scene-id="' + escapeHtml(sceneId) + '">' +
        '<button type="button" class="storyboard-scene-progress-step" data-scene-progress="' + escapeHtml(sceneId) + '">' +
          '<span class="storyboard-scene-progress-kicker"' +
            (planDirectorModel ? ' title="Scene plan originated from Director model ' + escapeHtml(planDirectorModel) + '"' : '') +
          '>Scene ' + String(index + 1).padStart(2, '0') +
            '<span class="storyboard-scene-progress-indicators">' + sceneProgressionIndicatorsHtml(sceneId) + '</span>' +
          '</span>' +
          '<div class="storyboard-scene-progress-title-row">' +
            '<strong data-scene-progress-title>' + escapeHtml(scene.title || 'Untitled Scene') + '</strong>' +
            sceneDirectorCompletionHtml(sceneId) +
          '</div>' +
        '</button>' +
        '<details class="storyboard-scene-menu storyboard-scene-progress-menu">' +
          '<summary title="Scene actions" aria-label="Scene actions">•••</summary>' +
          '<div class="storyboard-scene-menu-popover">' +
            '<button type="button" data-scene-action="duplicate">Duplicate Scene</button>' +
            '<button type="button" data-scene-action="insert-director"' + (index === order.length - 1 ? ' disabled' : '') + '>Insert Director Scene After</button>' +
            '<button type="button" data-scene-action="up"' + (index === 0 ? ' disabled' : '') + '>Move earlier</button>' +
            '<button type="button" data-scene-action="down"' + (index === order.length - 1 ? ' disabled' : '') + '>Move later</button>' +
            '<button type="button" class="danger" data-scene-action="delete">Remove Scene</button>' +
          '</div>' +
        '</details>' +
      '</div>';
    }).join('') +
      '<button type="button" class="storyboard-scene-progress-add" data-scene-progress-add title="Add Scene" aria-label="Add Scene">+</button>';
  }

  function syncSceneViewControls(order) {
    order = Array.isArray(order) ? order : [];
    if (['overview', 'focus', 'sequence'].indexOf(storyState.sceneViewMode) === -1) storyState.sceneViewMode = 'focus';
    ensureActiveScene(order);
    [
      ['storyboard-scenes-overview-btn', 'overview'],
      ['storyboard-scenes-focus-btn', 'focus'],
      ['storyboard-scenes-sequence-btn', 'sequence']
    ].forEach(function (item) {
      var button = el(item[0]);
      var active = storyState.sceneViewMode === item[1];
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    var modeTitle = el('storyboard-workspace-mode-title');
    if (modeTitle) modeTitle.textContent = storyState.sceneViewMode === 'sequence' ? 'Sequence' : 'Scenes';
    var progression = el('storyboard-scene-progression');
    if (progression) progression.classList.toggle('hidden', storyState.sceneViewMode === 'sequence');
    var directorHeader = document.querySelector('.storyboard-scenes-heading .storyboard-director-header');
    if (directorHeader) directorHeader.classList.toggle('hidden', storyState.sceneViewMode === 'sequence');
    renderSceneProgression(order);
  }

  function setSceneViewMode(mode, sceneId) {
    if (['overview', 'focus', 'sequence'].indexOf(mode) === -1) throw new Error('Unknown Storyboard Scene view.');
    var previousMode = storyState.sceneViewMode;
    return flushPendingSaves().then(function () {
      storyState.sceneViewMode = mode;
      if (sceneId) storyState.activeSceneId = sceneId;
      if (mode === 'focus') {
        var order = storyState.story && Array.isArray(storyState.story.sceneOrder) ? storyState.story.sceneOrder : [];
        clearSceneNewTakeCount(ensureActiveScene(order));
        if (sceneId && storyState.story) clearSceneDirectorCompletion(storyState.story.id, sceneId);
      }
      window.localStorage.setItem('webcap.storyboard.sceneView', mode);
      renderScenes();
      renderSequencePreview();
      if (mode !== previousMode || sceneId) {
        var sceneWorkspace = document.querySelector('.storyboard-scene-workspace');
        if (sceneWorkspace) sceneWorkspace.scrollTop = 0;
      }
    }).catch(reportError);
  }

  function takeMediaUrl(storyId, sceneId, take) {
    var mediaPath = String(take && take.mediaPath ? take.mediaPath : '');
    return '/fs/storyboard/media?story=' + encodeURIComponent(storyId) + '&path=' + encodeURIComponent(mediaPath);
  }

  function takePreviewHtml(storyId, sceneId, take) {
    var url = takeMediaUrl(storyId, sceneId, take);
    var path = String(take && take.mediaPath ? take.mediaPath : '').toLowerCase();
    if (/\.(png|jpe?g|webp|gif|bmp)$/.test(path)) {
      return '<img src="' + escapeHtml(url) + '" alt="">';
    }
    return '<video src="' + escapeHtml(url) + '" controls muted preload="metadata"></video>';
  }

  function takeAspectRatioCss(take) {
    var value = String(take && take.aspectRatio || '').trim();
    var match = value.match(/^(\d+)\s*:\s*(\d+)/);
    if (!match) return '16 / 9';
    var width = Number(match[1]);
    var height = Number(match[2]);
    if (!width || !height) return '16 / 9';
    return String(width) + ' / ' + String(height);
  }

  function selectedSequenceItems(story) {
    var selected = [];
    (story.sceneOrder || []).forEach(function (sceneId, index) {
      var scene = (story.scenes || {})[sceneId] || {};
      var takeId = scene.selectedTakeId;
      var take = takeId && scene.takes ? scene.takes[takeId] : null;
      if (!take) return;
      selected.push({ sceneId: sceneId, scene: scene, take: take, number: index + 1 });
    });
    return selected;
  }

  function renderStoryReadiness() {
    var node = el('storyboard-progress-summary');
    if (!node || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var selected = 0;
    var selectedSeconds = 0;
    var generating = 0;
    var scenesWithTake = 0;
    var needsTake = 0;
    var needsSelection = 0;

    order.forEach(function (sceneId) {
      var scene = (story.scenes || {})[sceneId] || {};
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var takeIds = Array.isArray(scene.takeOrder) ? scene.takeOrder.filter(function (takeId) {
        return !!takes[takeId];
      }) : [];
      var jobs = generationJobsForScene(sceneId);
      if (jobs.length) generating += jobs.length;
      if (takeIds.length) scenesWithTake += 1;

      var selectedTake = scene.selectedTakeId && takes[scene.selectedTakeId];
      if (selectedTake) {
        selected += 1;
        var seconds = Number(selectedTake.durationSeconds);
        if (!Number.isFinite(seconds)) seconds = Number(scene.durationSeconds || 0);
        if (Number.isFinite(seconds) && seconds > 0) selectedSeconds += seconds;
      } else if (takeIds.length) {
        needsSelection += 1;
      } else if (!jobs.length) {
        needsTake += 1;
      }
    });

    var parts = [String(order.length) + ' Scene' + (order.length === 1 ? '' : 's')];
    if (selected) parts.push(String(selected) + ' selected');
    if (generating) parts.push(String(generating) + ' generating');
    if (needsTake) parts.push(String(needsTake) + ' needs Take');
    if (needsSelection) parts.push(String(needsSelection) + ' needs selection');
    if (selectedSeconds > 0) {
      var displaySeconds = Math.round(selectedSeconds * 10) / 10;
      parts.push(String(displaySeconds) + 's selected');
    }
    node.textContent = parts.join(' · ');
    node.title = selected === order.length && order.length
      ? 'All Scenes have a selected Take and are ready to export.'
      : 'Story completion summary';

    var sequenceButton = el('storyboard-scenes-sequence-btn');
    if (!sequenceButton) throw new Error('Storyboard Sequence control is missing.');
    var sequenceReady = !!order.length && scenesWithTake === order.length;
    sequenceButton.classList.toggle('is-ready', sequenceReady);
    sequenceButton.title = sequenceReady
      ? 'Every Scene has at least one Take. Review the sequence.'
      : '';
  }

  function assemblyMatchesSelection(job, selected) {
    if (!job || !storyState.story || job.storyId !== storyState.story.id || !Array.isArray(job.selection)) return false;
    if (job.selection.length !== selected.length) return false;
    return job.selection.every(function (item, index) {
      return item.sceneId === selected[index].sceneId && item.takeId === selected[index].take.id;
    });
  }

  function renderSequencePreview() {
    var host = el('storyboard-sequence-preview');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var selected = selectedSequenceItems(story);
    if (storyState.sceneViewMode !== 'sequence') {
      host.innerHTML = '';
      host.classList.add('hidden');
      return;
    }
    host.classList.remove('hidden');
    if (!selected.length) {
      host.innerHTML = '<header class="storyboard-sequence-header"><div><strong>Selected sequence</strong><span>No Takes selected yet</span></div></header>' +
        '<div class="storyboard-sequence-empty">Select a Take in one or more Scenes to build the sequence.</div>';
      return;
    }

    var selectedSeconds = selected.reduce(function (total, item) {
      var seconds = Number(item.take && item.take.durationSeconds);
      if (!Number.isFinite(seconds) || seconds <= 0) seconds = Number(item.scene && item.scene.durationSeconds);
      return total + (Number.isFinite(seconds) && seconds > 0 ? seconds : 0);
    }, 0);
    var selectedSecondsLabel = selectedSeconds > 0
      ? String(Math.round(selectedSeconds * 10) / 10) + 's'
      : '';

    var assembly = storyState.sequenceExport;
    var encodingWarnings = storyState.sequenceEncodingWarnings || [];
    var warningByTake = {};
    encodingWarnings.forEach(function (warning) {
      warningByTake[String(warning.sceneId || '') + ':' + String(warning.takeId || '')] = warning;
    });
    var assemblyCurrent = assemblyMatchesSelection(assembly, selected) && assembly.current !== false;
    var assemblyStatus = '';
    if (assemblyCurrent) assemblyStatus = 'Exported · ' + String(assembly.itemCount || selected.length) + ' Takes';
    else if (assembly && !assemblyCurrent) assemblyStatus = 'Selection changed since last export';

    var outputHtml = '';
    if (assemblyCurrent) {
      var outputUrl = '/fs/storyboard/media?story=' + encodeURIComponent(assembly.storyId) +
        '&path=' + encodeURIComponent(assembly.mediaPath || ('exports/' + assembly.media));
      outputHtml = '<div class="storyboard-sequence-output">' +
        '<div class="storyboard-sequence-output-label">Export preview</div>' +
        '<video src="' + escapeHtml(outputUrl) + '" controls preload="metadata"></video></div>';
    }

    host.innerHTML = '<header class="storyboard-sequence-header"><div class="storyboard-sequence-heading-copy"><strong>Selected sequence</strong><span>' +
      selected.length + ' selected Take' + (selected.length === 1 ? '' : 's') +
      (selectedSecondsLabel ? ' · ' + selectedSecondsLabel : '') +
      '</span></div><div class="storyboard-sequence-actions">' +
      '<span class="storyboard-save-state" data-sequence-status>' + assemblyStatus + '</span>' +
      '<button type="button" class="review-captions-btn" data-sequence-toggle aria-expanded="' + (storyState.sequenceCollapsed ? 'false' : 'true') + '">' +
        (storyState.sequenceCollapsed ? 'Show' : 'Hide') +
      '</button>' +
      '<button type="button" class="storyboard-primary-btn" data-sequence-export>Export Sequence</button>' +
      '</div></header>' +
      (encodingWarnings.length ? '<div class="storyboard-sequence-encoding-warning"><strong>This requires encoding</strong>' +
        '<button type="button" class="review-captions-btn" data-sequence-warnings>' +
          (storyState.sequenceWarningsVisible ? 'Hide warnings' : 'Show warnings') +
        '</button>' +
        '<button type="button" class="storyboard-primary-btn" data-sequence-encode>Encode</button></div>' : '') +
      '<div class="storyboard-sequence-body' + (storyState.sequenceCollapsed ? ' hidden' : '') + '">' +
      outputHtml +
      '<section class="storyboard-sequence-timeline" aria-label="Selected Takes timeline">' +
        '<div class="storyboard-sequence-timeline-header"><strong>Timeline</strong><span>' +
          selected.length + ' clip' + (selected.length === 1 ? '' : 's') +
          (selectedSecondsLabel ? ' · ' + selectedSecondsLabel : '') +
        '</span></div>' +
        '<div class="storyboard-sequence-list">' +
        selected.map(function (item) {
          var seconds = Number(item.take && item.take.durationSeconds);
          if (!Number.isFinite(seconds) || seconds <= 0) seconds = Number(item.scene && item.scene.durationSeconds);
          var duration = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 10) / 10 : 10;
          var durationLabel = Number.isFinite(seconds) && seconds > 0 ? String(duration) + 's' : '';
          var title = item.scene.title || 'Untitled Scene';
          var warning = warningByTake[String(item.sceneId || '') + ':' + String(item.take.id || '')];
          var warningText = warning && Array.isArray(warning.differences) ? warning.differences.join(' · ') : '';
          return '<article class="storyboard-sequence-card' + (warning ? ' requires-encoding' : '') + '" style="--sequence-clip-seconds:' + String(duration) + '">' +
            '<div class="storyboard-sequence-label">' +
              '<span>Scene ' + String(item.number).padStart(2, '0') + '</span>' +
              '<strong title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</strong>' +
              (durationLabel ? '<em>' + escapeHtml(durationLabel) + '</em>' : '') +
            '</div>' +
            (warning && storyState.sequenceWarningsVisible ? '<div class="storyboard-sequence-card-warning">' + escapeHtml(warningText) + '</div>' : '') +
            '<div class="storyboard-sequence-media">' + takePreviewHtml(story.id, item.sceneId, item.take) + '</div>' +
          '</article>';
        }).join('') +
        '</div>' +
      '</section>' +
      '</div>';
  }

  function refreshSequenceExport(storyId) {
    return assemblyRequest(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) {
        storyState.sequenceExport = payload.export || null;
        renderSequencePreview();
      }
      return payload;
    });
  }

  function exportSelectedSequence(encode) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    setSaveState(encode ? 'Encoding sequence...' : 'Exporting sequence...');
    flushPendingSaves().then(function () {
      return assemblyRequest({ storyId: storyId, encode: !!encode });
    }).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) {
        if (payload.requiresEncoding) {
          storyState.sequenceEncodingWarnings = payload.warnings || [];
          storyState.sequenceWarningsVisible = false;
        } else {
          storyState.sequenceExport = payload.export || null;
          storyState.sequenceEncodingWarnings = [];
          storyState.sequenceWarningsVisible = false;
        }
        renderSequencePreview();
      }
      setSaveState('Saved');
    }).catch(reportError);
  }

  function closeStoryActionMenus(exceptMenu) {
    document.querySelectorAll('.storyboard-story-menu[open]').forEach(function (menu) {
      if (menu !== exceptMenu) menu.open = false;
    });
  }

  function positionStoryActionMenu(menu) {
    if (!menu || !menu.open) return;
    var summary = menu.querySelector('summary');
    var popover = menu.querySelector('.storyboard-story-menu-popover');
    if (!summary || !popover) return;

    var anchorRect = summary.getBoundingClientRect();
    var width = popover.offsetWidth || 150;
    var height = popover.offsetHeight || 0;
    var gap = 4;
    var margin = 8;
    var left = Math.min(
      Math.max(margin, anchorRect.right - width),
      Math.max(margin, window.innerWidth - width - margin)
    );
    var below = anchorRect.bottom + gap;
    var above = anchorRect.top - height - gap;
    var top = below + height <= window.innerHeight - margin || above < margin
      ? below
      : above;

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(Math.max(margin, top)) + 'px';
  }

  function closeSceneActionMenus(exceptMenu) {
    document.querySelectorAll('.storyboard-scene-menu[open]').forEach(function (menu) {
      if (menu !== exceptMenu) menu.open = false;
    });
  }

  function positionSceneActionMenu(menu) {
    if (!menu || !menu.open) return;
    var summary = menu.querySelector('summary');
    var popover = menu.querySelector('.storyboard-scene-menu-popover');
    if (!summary || !popover) throw new Error('Storyboard Scene action menu markup is missing.');

    var anchorRect = summary.getBoundingClientRect();
    var width = popover.offsetWidth || 180;
    var height = popover.offsetHeight || 0;
    var gap = 4;
    var margin = 8;
    var left = Math.min(
      Math.max(margin, anchorRect.right - width),
      Math.max(margin, window.innerWidth - width - margin)
    );
    var below = anchorRect.bottom + gap;
    var above = anchorRect.top - height - gap;
    var top = below + height <= window.innerHeight - margin || above < margin
      ? below
      : above;

    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(Math.max(margin, top)) + 'px';
  }

  var STORY_RAIL_ICONS = {
    book: '<path d="M5 4.5h14v15H5z M8 8h8 M8 12h8 M8 16h5"/>',
    image: '<path d="M4.5 18.5 9 11l3 4 2-3 5.5 6.5z M8 8.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z"/>',
    star: '<path d="M12 3.8 14.4 9l5.6.7-4.1 3.8 1.1 5.5-5-2.8-5 2.8 1.1-5.5L4 9.7 9.6 9z"/>',
    film: '<path d="M6 5.5h12v13H6z M9 5.5v13 M13 9h3 M13 12h3 M13 15h3"/>',
    eye: '<path d="M4.5 15.5c2.2-4.7 5.2-7.1 9-7.1 2.4 0 4.5.8 6 2.4-1.6 4.7-4.6 7-9 7-2.4 0-4.4-.8-6-2.3z M12 11.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z"/>',
    spark: '<path d="M12 4v16 M4 12h16 M6.3 6.3l11.4 11.4 M17.7 6.3 6.3 17.7"/>',
    mountain: '<path d="M5 17c2.5-4.6 5.2-7 8.2-7 2.3 0 4.2 1.2 5.8 3.5 M5 19h14 M8 8.5 10.5 5l2.3 3.5"/>',
    calendar: '<path d="M5 6.5h14v11H5z M8 4.5v4 M16 4.5v4 M8 12h8"/>',
    camera: '<path d="M5 8h3l1.5-2h5L16 8h3v10H5z M12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>',
    clapperboard: '<path d="M5 9h14v10H5z M5 9l2-4h12l-2 4z M9 5l-2 4 M14 5l-2 4"/>',
    music: '<path d="M9 6v10 M9 8l8-2v8 M6.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M14.5 16a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>',
    microphone: '<path d="M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M6.5 11.5a5.5 5.5 0 0 0 11 0 M12 17v3 M9 20h6"/>',
    headphones: '<path d="M5 13a7 7 0 0 1 14 0v5h-3v-5h3 M8 13H5v5h3z"/>',
    heart: '<path d="M12 19s-7-4.3-7-9a3.5 3.5 0 0 1 6-2.4L12 9l1-1.4A3.5 3.5 0 0 1 19 10c0 4.7-7 9-7 9z"/>',
    moon: '<path d="M16.8 17.5A7 7 0 0 1 9.5 6.2 7 7 0 1 0 16.8 17.5z"/>',
    sun: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M18.4 5.6l-2.1 2.1 M7.7 16.3l-2.1 2.1"/>',
    cloud: '<path d="M6 17h11a3 3 0 0 0 .3-6A5.5 5.5 0 0 0 7 10.5 3.5 3.5 0 0 0 6 17z"/>',
    lightning: '<path d="M13.5 3 7 13h4l-.5 8L17 10h-4z"/>',
    fire: '<path d="M12 20c4 0 6-2.5 6-6 0-3-2-5-4-7 .2 2-1 3-2 3-1.5 0-1.2-2.5-.5-5C8 7.5 6 10.5 6 14c0 3.5 2 6 6 6z"/>',
    compass: '<circle cx="12" cy="12" r="8"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    map: '<path d="M5 6l4-2 6 2 4-2v14l-4 2-6-2-4 2z M9 4v14 M15 6v14"/>',
    globe: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16 M12 4c2 2 3 5 3 8s-1 6-3 8 M12 4c-2 2-3 5-3 8s1 6 3 8"/>',
    home: '<path d="M4 11.5 12 5l8 6.5 M6.5 10.5V19h11v-8.5 M10 19v-5h4v5"/>',
    building: '<path d="M6 20V5h9v15 M15 9h3v11 M9 8h2 M9 11h2 M9 14h2 M9 17h2"/>',
    car: '<path d="M5 15h14l-1.5-5h-11z M6 15v3 M18 15v3 M8 18h8 M7.5 13h2 M14.5 13h2"/>',
    train: '<path d="M7 4h10a2 2 0 0 1 2 2v9a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2z M8 8h8 M9 18l-2 3 M15 18l2 3"/>',
    plane: '<path d="m3 13 8-2 3-7 2 1-2 7 6 3-1 2-6-1-3 4-1-1 1-4-6-1z"/>',
    ship: '<path d="M5 13h14l-2 5H7z M9 13V7h6v6 M12 4v3 M4 20c2 1 4 1 6 0 2 1 4 1 6 0 1 .5 2 .7 4 .5"/>',
    tree: '<path d="M12 4 8 10h2l-3 5h4v5h2v-5h4l-3-5h2z"/>',
    flower: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-4-1-4-5-1-5 2 0 2 3 1 5z M14 12c1-4 5-4 5-1 0 2-3 2-5 1z M12 14c4 1 4 5 1 5-2 0-2-3-1-5z M10 12c-1 4-5 4-5 1 0-2 3-2 5-1z"/>',
    paw: '<circle cx="12" cy="15" r="3"/><circle cx="7" cy="10" r="1.5"/><circle cx="10" cy="7" r="1.5"/><circle cx="14" cy="7" r="1.5"/><circle cx="17" cy="10" r="1.5"/>',
    skull: '<path d="M7 17v-2a6 6 0 1 1 10 0v2l-2 2H9z M9 12h1 M14 12h1 M11 16h2 M10 19v2 M14 19v2"/>',
    crown: '<path d="M5 8l4 4 3-6 3 6 4-4-2 10H7z"/>',
    gem: '<path d="M7 6h10l3 4-8 10-8-10z M4 10h16 M9 6l-2 4 5 10 5-10-2-4"/>',
    rocket: '<path d="M8 15c-1-4 1-8 6-11 3 5 2 9-2 12z M8 15l-3 1 3 3 1-3 M12 16l-1 4 4-2 1-3 M13 8h.01"/>',
    robot: '<path d="M7 8h10v9H7z M12 5v3 M10 5h4 M9 12h.01 M15 12h.01 M10 15h4 M5 11H3 M21 11h-2"/>',
    ghost: '<path d="M7 19V10a5 5 0 0 1 10 0v9l-2-2-2 2-2-2-2 2z M10 11h.01 M14 11h.01"/>',
    mask: '<path d="M5 8c4-2 10-2 14 0v6c-2 4-5 6-7 6s-5-2-7-6z M8 12h2 M14 12h2 M10 16c1 .7 3 .7 4 0"/>',
    coffee: '<path d="M6 8h10v8a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4z M16 10h2a2 2 0 0 1 0 4h-2 M9 4c-1 1 1 2 0 3 M13 4c-1 1 1 2 0 3"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    key: '<circle cx="8" cy="12" r="3"/><path d="M11 12h8 M16 12v3 M19 12v2"/>'
  };

  var STORY_ICON_LABELS = {
    book: 'Book', image: 'Image', star: 'Star', film: 'Film', eye: 'Eye', spark: 'Spark',
    mountain: 'Mountain', calendar: 'Calendar', camera: 'Camera', clapperboard: 'Clapperboard',
    music: 'Music', microphone: 'Microphone', headphones: 'Headphones', heart: 'Heart',
    moon: 'Moon', sun: 'Sun', cloud: 'Cloud', lightning: 'Lightning', fire: 'Fire',
    compass: 'Compass', map: 'Map', globe: 'Globe', home: 'Home', building: 'Building',
    car: 'Car', train: 'Train', plane: 'Plane', ship: 'Ship', tree: 'Tree', flower: 'Flower',
    paw: 'Paw', skull: 'Skull', crown: 'Crown', gem: 'Gem', rocket: 'Rocket', robot: 'Robot',
    ghost: 'Ghost', mask: 'Mask', coffee: 'Coffee', clock: 'Clock', key: 'Key'
  };

  function storyIconSvgHtml(iconName) {
    var path = STORY_RAIL_ICONS[iconName];
    if (!path) return '';
    return '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">' + path + '</svg>';
  }

  function renderStoryIconPicker() {
    var menu = el('storyboard-story-icon-menu');
    if (!menu) return;
    var selected = String(el('storyboard-story-icon').value || '');
    var autoIcon = storyRailIconName(storyState.story || {});
    var html = '<button type="button" class="storyboard-icon-option' + (!selected ? ' active' : '') + '" data-story-icon-option="" role="menuitem" title="Auto">' +
      '<span class="storyboard-icon-option-glyph">' + storyIconSvgHtml(autoIcon) + '</span>' +
      '<span>Auto</span>' +
    '</button>';
    html += Object.keys(STORY_RAIL_ICONS).map(function (iconName) {
      return '<button type="button" class="storyboard-icon-option' + (selected === iconName ? ' active' : '') +
        '" data-story-icon-option="' + escapeHtml(iconName) + '" role="menuitem" title="' + escapeHtml(STORY_ICON_LABELS[iconName] || iconName) + '">' +
        '<span class="storyboard-icon-option-glyph">' + storyIconSvgHtml(iconName) + '</span>' +
        '<span>' + escapeHtml(STORY_ICON_LABELS[iconName] || iconName) + '</span>' +
      '</button>';
    }).join('');
    menu.innerHTML = html;
  }

  function syncStoryIconPicker() {
    var input = el('storyboard-story-icon');
    var preview = el('storyboard-story-icon-preview');
    var label = el('storyboard-story-icon-label');
    if (!input || !preview || !label) return;
    var selected = String(input.value || '');
    var effective = selected && STORY_RAIL_ICONS[selected]
      ? selected
      : storyRailIconName(storyState.story || {});
    preview.innerHTML = storyIconSvgHtml(effective);
    label.textContent = selected ? (STORY_ICON_LABELS[selected] || selected) : 'Auto';
    renderStoryIconPicker();
  }

  function setStoryIconSelection(iconName) {
    var input = el('storyboard-story-icon');
    if (!input) return;
    iconName = String(iconName || '');
    if (iconName && !STORY_RAIL_ICONS[iconName]) throw new Error('Unsupported Story icon: ' + iconName);
    input.value = iconName;
    syncStoryIconPicker();
    var trigger = el('storyboard-story-icon-trigger');
    var menu = el('storyboard-story-icon-menu');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (menu) menu.classList.add('hidden');
    scheduleStorySave();
  }

  function storyRailIconName(story) {
    var selected = String(story && story.icon || '');
    if (STORY_RAIL_ICONS[selected]) return selected;
    var names = Object.keys(STORY_RAIL_ICONS);
    var key = String(story && (story.id || story.title) || 'story');
    var hash = 0;
    for (var index = 0; index < key.length; index += 1) {
      hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
    }
    return names[Math.abs(hash) % names.length];
  }

  function storyRailIconHtml(story) {
    var key = String(story && (story.id || story.title) || 'story');
    var hash = 0;
    for (var index = 0; index < key.length; index += 1) {
      hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
    }
    var toneIndex = Math.abs(hash >> 3) % 6;
    var iconName = storyRailIconName(story);
    return '<span class="storyboard-story-rail-icon storyboard-story-rail-icon-tone-' + toneIndex + '" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" focusable="false">' + STORY_RAIL_ICONS[iconName] + '</svg>' +
    '</span>';
  }

  function setStoryLibraryCompact(compact) {
    storyState.storyLibraryCompact = !!compact;
    window.localStorage.setItem('webcap.storyboard.storyLibraryCompact', storyState.storyLibraryCompact ? '1' : '0');
    var workspace = el('storyboard-workspace');
    var button = el('storyboard-library-compact-toggle');
    if (workspace) workspace.classList.toggle('story-library-compact', storyState.storyLibraryCompact);
    if (button) {
      button.setAttribute('aria-pressed', storyState.storyLibraryCompact ? 'true' : 'false');
      button.setAttribute('title', storyState.storyLibraryCompact ? 'Expand Stories' : 'Collapse Stories to icons');
      button.setAttribute('aria-label', storyState.storyLibraryCompact ? 'Expand Stories' : 'Collapse Stories to icons');
      button.textContent = storyState.storyLibraryCompact ? '›' : '‹';
    }
  }

  function renderLibrary() {
    var host = el('storyboard-library-list');
    if (!host) return;
    var stories = Array.isArray(storyState.stories) ? storyState.stories : [];
    if (!stories.length) {
      host.innerHTML = '<div class="storyboard-library-empty">No Stories yet.</div>';
      return;
    }

    var pinned = stories.filter(function (story) { return !!story.pinned; });
    var mainStories = stories.filter(function (story) { return !story.pinned && story.status !== 'archived'; });
    var archived = stories.filter(function (story) { return !story.pinned && story.status === 'archived'; });

    function rows(items) {
      return items.map(function (story) {
        var active = storyState.story && storyState.story.id === story.id;
        var meta = [];
        var activeFirstCut = storyState.storyAction
          && storyState.storyAction.active
          && String(storyState.storyAction.storyId || '') === String(story.id || '');
        var queuedFirstCut = queuedFirstCutForStory(story.id);
        if (activeFirstCut) meta.push('First Cut running');
        else if (queuedFirstCut) meta.push('First Cut queued #' + String(firstCutQueueDisplayPosition(queuedFirstCut)));
        if (story.status && story.status !== 'active') meta.push(story.status);
        meta.push(String(Number(story.sceneCount || 0)) + ' scene' + (Number(story.sceneCount || 0) === 1 ? '' : 's'));
        return '<div class="storyboard-story-row' + (active ? ' active' : '') + '" data-story-id="' + escapeHtml(story.id) + '">' +
          '<button type="button" class="storyboard-story-open" data-story-open title="' + escapeHtml(story.title || 'Untitled Story') + '">' +
            storyRailIconHtml(story) +
            '<span class="storyboard-story-row-copy">' +
              '<strong>' + escapeHtml(story.title || 'Untitled Story') + '</strong>' +
              '<span>' + escapeHtml(meta.join(' · ')) + '</span>' +
            '</span>' +
          '</button>' +
          '<details class="storyboard-story-menu">' +
            '<summary aria-label="Story actions">⋯</summary>' +
            '<div class="storyboard-story-menu-popover">' +
              '<button type="button" data-story-action="duplicate">Duplicate</button>' +
              '<button type="button" data-story-action="pin">' + (story.pinned ? 'Unpin' : 'Pin') + '</button>' +
              '<button type="button" data-story-action="archive">' + (story.status === 'archived' ? 'Restore' : 'Archive') + '</button>' +
              '<button type="button" data-story-action="export">Export</button>' +
              '<button type="button" class="danger" data-story-action="delete">Delete…</button>' +
            '</div>' +
          '</details>' +
        '</div>';
      }).join('');
    }

    var html = '';
    if (pinned.length) html += '<div class="storyboard-list-section-title">Pinned</div>' + rows(pinned);
    if (mainStories.length) html += '<div class="storyboard-list-section-title">Stories</div>' + rows(mainStories);
    if (archived.length) html += '<div class="storyboard-list-section-title">Archived</div>' + rows(archived);
    host.innerHTML = html;
  }

  function sceneValue(scene, key, fallback) {
    var value = scene && scene[key];
    return value == null ? fallback : value;
  }

  function syncSceneGenerationDefaultHints() {
    var aspectNode = el('storyboard-story-aspect-ratio');
    var megapixelsNode = el('storyboard-story-megapixels');
    if (!aspectNode || !megapixelsNode) return;
    var aspectRatio = aspectNode.value || '4:3 (Standard)';
    var megapixels = megapixelsNode.value || '0.2';
    Array.prototype.forEach.call(document.querySelectorAll('[data-scene-field="aspectRatio"]'), function (select) {
      var inherit = select.querySelector('option[value=""]');
      if (inherit) inherit.textContent = 'Inherit · ' + aspectRatio;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-scene-field="megapixels"]'), function (input) {
      input.placeholder = 'Inherit · ' + megapixels;
    });
  }

  function seedInheritedSceneMegapixels(input) {
    if (!input || String(input.value || '').trim() !== '') return;
    var defaults = storyState.story && storyState.story.generationDefaults || {};
    input.value = String(defaults.megapixels == null ? 0.2 : defaults.megapixels);
  }

  function loraOptions(selectedName) {
    var names = (storyState.generationCapabilities.loras || []).slice();
    if (selectedName && names.indexOf(selectedName) < 0) names.unshift(selectedName);
    if (!names.length) return '<option value="">No selectable LoRAs</option>';
    return names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '"' + (name === selectedName ? ' selected' : '') + '>' +
        escapeHtml(name) + '</option>';
    }).join('');
  }

  function loraNamesMatching(query, excludedNames) {
    var needle = String(query || '').trim().toLowerCase();
    var excluded = {};
    (excludedNames || []).forEach(function (name) {
      excluded[String(name || '').toLowerCase()] = true;
    });
    return (storyState.generationCapabilities.loras || []).filter(function (name) {
      var key = String(name || '').toLowerCase();
      return !excluded[key] && (!needle || key.indexOf(needle) !== -1);
    });
  }

  function availableLoraName(typedName, excludedNames) {
    var typed = String(typedName || '').trim().toLowerCase();
    if (!typed) return '';
    return loraNamesMatching('', excludedNames).find(function (name) {
      return String(name || '').toLowerCase() === typed;
    }) || '';
  }

  function loraPickerMenuFor(picker) {
    var wrap = picker && picker.closest('.storyboard-lora-picker-wrap');
    return wrap && wrap.querySelector('[data-lora-picker-menu]');
  }

  function loraPickerExcludedNames(picker) {
    if (!picker) return [];
    if (picker.id === 'storyboard-story-lora-picker') {
      return storyLorasFromUi().map(function (item) { return item.name; });
    }
    var scene = picker.closest('.storyboard-scene[data-scene-id]');
    if (!scene) throw new Error('LoRA picker Scene is missing.');
    var names = storyLorasFromUi().map(function (item) { return item.name; });
    Array.prototype.forEach.call(scene.querySelectorAll('[data-scene-lora-row]'), function (row) {
      var select = row.querySelector('[data-scene-lora-name]');
      if (select && select.value) names.push(select.value);
    });
    return names;
  }

  function setLoraPickerActive(menu, index) {
    var options = Array.prototype.slice.call(menu.querySelectorAll('[data-lora-picker-option]'));
    if (!options.length) {
      menu.dataset.activeIndex = '-1';
      return;
    }
    var next = Math.max(0, Math.min(index, options.length - 1));
    menu.dataset.activeIndex = String(next);
    options.forEach(function (option, optionIndex) {
      option.classList.toggle('active', optionIndex === next);
    });
    options[next].scrollIntoView({ block: 'nearest' });
  }

  function positionLoraPickerMenu(picker, menu) {
    var pickerRect = picker.getBoundingClientRect();
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    var below = Math.max(0, viewportHeight - pickerRect.bottom - 8);
    var above = Math.max(0, pickerRect.top - 8);
    var opensUp = below < 180 && above > below;
    var available = opensUp ? above : below;

    menu.classList.toggle('opens-up', opensUp);
    menu.style.maxHeight = String(Math.max(40, Math.min(220, Math.floor(available - 4)))) + 'px';
  }

  function renderLoraPickerMenu(picker) {
    var menu = loraPickerMenuFor(picker);
    if (!menu) throw new Error('LoRA picker menu is missing.');
    var matches = loraNamesMatching(picker.value, loraPickerExcludedNames(picker));
    menu.innerHTML = matches.length
      ? matches.map(function (name) {
          return '<button type="button" class="storyboard-lora-picker-option" data-lora-picker-option="' +
            escapeHtml(name) + '" role="option">' + escapeHtml(name) + '</button>';
        }).join('')
      : '<div class="storyboard-lora-picker-empty">No matching LoRAs</div>';
    menu.classList.remove('hidden');
    positionLoraPickerMenu(picker, menu);
    picker.setAttribute('aria-expanded', 'true');
    setLoraPickerActive(menu, matches.length ? 0 : -1);
  }

  function closeLoraPicker(picker) {
    var menu = loraPickerMenuFor(picker);
    if (!menu) return;
    menu.classList.add('hidden');
    menu.classList.remove('opens-up');
    menu.style.maxHeight = '';
    menu.dataset.activeIndex = '-1';
    picker.setAttribute('aria-expanded', 'false');
  }

  function closeAllLoraPickers() {
    Array.prototype.forEach.call(document.querySelectorAll('.storyboard-lora-picker[aria-expanded="true"]'), function (picker) {
      closeLoraPicker(picker);
    });
  }

  function chooseLoraPickerOption(picker, name) {
    var selectedName = availableLoraName(name, loraPickerExcludedNames(picker));
    if (!selectedName) return;

    if (picker.id === 'storyboard-story-lora-picker') {
      el('storyboard-story-lora-list').insertAdjacentHTML('beforeend', storyLoraRowHtml({ name: selectedName, strength: 0.9 }));
      picker.value = '';
      closeLoraPicker(picker);
      syncStoryLorasIntoScenes();
      scheduleStorySave();
      picker.focus();
      return;
    }

    var scene = picker.closest('.storyboard-scene[data-scene-id]');
    if (!scene) throw new Error('LoRA picker Scene is missing.');
    var list = scene.querySelector('[data-scene-lora-list]');
    if (!list) throw new Error('LoRA list is missing.');
    list.insertAdjacentHTML('beforeend', sceneLoraRowHtml({ name: selectedName, strength: 0.9 }));
    picker.value = '';
    closeLoraPicker(picker);
    scheduleSceneSave(scene.dataset.sceneId);
    picker.focus();
  }

  function handleLoraPickerKeydown(event) {
    var picker = event.target.closest('.storyboard-lora-picker');
    if (!picker) return;
    var menu = loraPickerMenuFor(picker);
    if (!menu) throw new Error('LoRA picker menu is missing.');

    if (event.key === 'Escape') {
      closeLoraPicker(picker);
      return;
    }

    if (menu.classList.contains('hidden')) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        renderLoraPickerMenu(picker);
      }
      return;
    }

    var options = Array.prototype.slice.call(menu.querySelectorAll('[data-lora-picker-option]'));
    var active = Number(menu.dataset.activeIndex || 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setLoraPickerActive(menu, Math.min(active + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setLoraPickerActive(menu, Math.max(active - 1, 0));
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault();
      chooseLoraPickerOption(picker, options[Math.max(0, active)].dataset.loraPickerOption);
    }
  }

  function storyLorasFromUi() {
    var list = el('storyboard-story-lora-list');
    if (!list) return [];
    return Array.prototype.map.call(list.querySelectorAll('[data-story-lora-row]'), function (row) {
      var item = {
        name: row.querySelector('[data-story-lora-name]').value,
        strength: row.querySelector('[data-story-lora-strength]').value
      };
      if (!row.querySelector('[data-story-lora-global-enabled]').checked) item.enabled = false;
      return item;
    }).filter(function (item) { return !!item.name; });
  }

  function storyLoraRowHtml(lora) {
    lora = lora || {};
    var name = String(lora.name || '');
    var strength = lora.strength == null ? 1 : lora.strength;
    var enabled = lora.enabled !== false;
    return '<div class="storyboard-lora-row storyboard-lora-row-story" data-story-lora-row>' +
      '<label class="storyboard-lora-enabled storyboard-lora-story-enabled" title="Enable this Story LoRA">' +
        '<input type="checkbox" data-story-lora-global-enabled' + (enabled ? ' checked' : '') +
          ' aria-label="Enable Story LoRA ' + escapeHtml(name) + '">' +
      '</label>' +
      '<select data-story-lora-name>' + loraOptions(name) + '</select>' +
      '<input type="number" step="0.05" data-story-lora-strength value="' + escapeHtml(strength) + '" aria-label="Story LoRA strength">' +
      '<button type="button" class="review-captions-btn" data-story-lora-remove title="Remove Story LoRA">×</button>' +
    '</div>';
  }

  function renderStoryLoras() {
    var list = el('storyboard-story-lora-list');
    var status = el('storyboard-story-lora-status');
    if (!list || !status || !storyState.story) return;
    var loras = Array.isArray(storyState.story.loras) ? storyState.story.loras : [];
    list.innerHTML = loras.map(storyLoraRowHtml).join('');
    var picker = el('storyboard-story-lora-picker');
    if (picker) {
      picker.value = '';
      closeLoraPicker(picker);
    }
    status.textContent = storyState.generationCapabilities.available
      ? (loras.length ? 'Applied to every Scene by default.' : 'No Story-wide LoRAs.')
      : (storyState.generationCapabilities.error || 'ComfyUI LoRAs unavailable.');
  }

  function sceneLoraRowHtml(lora) {
    lora = lora || {};
    var name = String(lora.name || '');
    var strength = lora.strength == null ? 1 : lora.strength;
    return '<div class="storyboard-lora-row" data-scene-lora-row>' +
      '<select data-scene-lora-name>' + loraOptions(name) + '</select>' +
      '<input type="number" step="0.05" data-scene-lora-strength value="' + escapeHtml(strength) + '" aria-label="Scene LoRA strength">' +
      '<button type="button" class="review-captions-btn" data-scene-lora-remove title="Remove Scene LoRA">×</button>' +
    '</div>';
  }

  function storyLoraOverrideMap(scene) {
    var result = {};
    var overrides = Array.isArray(scene && scene.storyLoraOverrides) ? scene.storyLoraOverrides : [];
    overrides.forEach(function (item) {
      if (item && item.name) result[String(item.name).toLowerCase()] = item;
    });
    return result;
  }

  function inheritedLoraRowHtml(lora, override) {
    lora = lora || {};
    override = override || {};
    var storyEnabled = lora.enabled !== false;
    var enabled = override.enabled !== false;
    var defaultStrength = Number(lora.strength == null ? 1 : lora.strength);
    var strength = override.strength == null ? defaultStrength : Number(override.strength);
    var disabledAttr = storyEnabled ? '' : ' disabled';
    return '<div class="storyboard-lora-row storyboard-lora-row-inherited' + (storyEnabled ? '' : ' storyboard-lora-row-story-disabled') +
      '" data-story-lora-inherited-row data-lora-name="' +
      escapeHtml(lora.name || '') + '" data-story-default-strength="' + escapeHtml(defaultStrength) + '">' +
      '<label class="storyboard-lora-enabled" title="' + escapeHtml(storyEnabled ? 'Use this Story LoRA in this Scene' : 'Disabled at Story level') +
        '"><input type="checkbox" data-story-lora-enabled' + (enabled ? ' checked' : '') + disabledAttr + '><span>Story</span></label>' +
      '<span class="storyboard-lora-inherited-name" title="' + escapeHtml(lora.name || '') + '">' + escapeHtml(lora.name || '') + '</span>' +
      '<input type="number" step="0.05" data-story-lora-scene-strength value="' + escapeHtml(strength) +
        '" aria-label="Inherited Story LoRA strength"' + disabledAttr + '>' +
    '</div>';
  }

  function syncStoryLorasIntoScenes() {
    var storyLoras = storyLorasFromUi();
    var storyNames = storyLoras.map(function (item) { return item.name; });
    Array.prototype.forEach.call(document.querySelectorAll('.storyboard-scene[data-scene-id]'), function (root) {
      var list = root.querySelector('[data-story-lora-inherited-list]');
      if (!list) return;
      var previous = {};
      Array.prototype.forEach.call(list.querySelectorAll('[data-story-lora-inherited-row]'), function (row) {
        var name = String(row.dataset.loraName || '').toLowerCase();
        var defaultStrength = Number(row.dataset.storyDefaultStrength);
        var input = row.querySelector('[data-story-lora-scene-strength]');
        previous[name] = {
          enabled: !!row.querySelector('[data-story-lora-enabled]').checked,
          strength: Number(input.value),
          overridden: Number(input.value) !== defaultStrength
        };
      });
      var sceneId = root.dataset.sceneId;
      var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : {};
      var stored = storyLoraOverrideMap(scene);
      list.innerHTML = storyLoras.map(function (lora) {
        var key = String(lora.name || '').toLowerCase();
        var old = previous[key];
        var override = old
          ? { enabled: old.enabled, strength: old.overridden ? old.strength : null }
          : (stored[key] || {});
        return inheritedLoraRowHtml(lora, override);
      }).join('');
      var picker = root.querySelector('[data-scene-lora-picker]');
      if (picker) {
        if (picker.value && !availableLoraName(picker.value, loraPickerExcludedNames(picker))) picker.value = '';
        closeLoraPicker(picker);
      }
    });
  }

  function formatGenerationElapsedMs(value) {
    var ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return '';
    var totalSeconds = Math.max(0, Math.round(ms / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + String(seconds).padStart(2, '0') + 's';
    return seconds + 's';
  }

  function generationJobStatusText(job) {
    return formatInferenceJobStatus({
      status: job && job.status,
      queuePosition: job && job.queuePosition,
      startedAt: job && job.startedAt,
      progress: job && job.progress
    });
  }

  function generationJobPreviewPrimary(job) {
    var status = String(job && job.status || '');
    if (status === 'backlog') return 'Backlog';
    if (status === 'queued') return 'Queued';
    if (status === 'starting') return 'Starting…';
    if (status === 'stopping') return 'Stopping…';
    return 'Generating…';
  }

  function generationJobPreviewDetail(job) {
    var parts = [];
    var progress = formatInferenceProgress(job && job.progress);
    if (progress) parts.push(progress);
    var startedAt = Number(job && job.startedAt || 0);
    if (startedAt > 0) {
      var elapsed = formatInferenceElapsedMs(Date.now() - (startedAt * 1000));
      if (elapsed) parts.push(elapsed);
    }
    return parts.join(' · ');
  }

  function takeMetaLabel(take) {
    var parts = [take && take.generated ? 'Generated' : 'Imported'];
    var createdAt = take && take.createdAt ? new Date(take.createdAt) : null;
    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      parts.push(createdAt.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }));
    }
    if (take && take.generated && take.seed !== undefined && take.seed !== null && take.seed !== '') {
      parts.push('Seed ' + String(take.seed));
    }
    var elapsed = formatGenerationElapsedMs(take && take.elapsedMs);
    if (elapsed) parts.push(elapsed);
    return parts.join(' · ');
  }

  function takeEffectiveInputHtml(take) {
    if (!take || !take.generated || !take.effectiveInput) return '';
    var input = take.effectiveInput || {};
    var references = input.references && typeof input.references === 'object' ? input.references : {};
    var requiredLoras = Array.isArray(input.requiredLoras) ? input.requiredLoras : [];
    var loras = Array.isArray(input.loras) ? input.loras : [];
    var facts = [
      'Duration: ' + String(input.durationSeconds == null ? '' : input.durationSeconds) + 's',
      'Aspect: ' + String(input.aspectRatio || ''),
      'Megapixels: ' + String(input.megapixels == null ? '' : input.megapixels),
      'Seed: ' + String(input.seed == null ? '' : input.seed),
      'Prompt mode: ' + String(input.promptMode || '')
    ].filter(function (value) { return !/:\s*$/.test(value); });

    var referenceLines = Object.keys(references).map(function (role) {
      return role + ': ' + String(references[role] || '');
    });
    var requiredLoraLines = requiredLoras.map(function (item) {
      return String(item.name || '') +
        ' · model ' + String(item.strengthModel == null ? 1 : item.strengthModel) +
        ' · CLIP ' + String(item.strengthClip == null ? 1 : item.strengthClip);
    });
    var loraLines = loras.map(function (item) {
      return String(item.name || '') + ' @ ' + String(item.strength == null ? 1 : item.strength);
    });

    return '<details class="storyboard-take-effective-input">' +
      '<summary>Effective H3 Input</summary>' +
      '<div class="storyboard-take-effective-input-body">' +
        '<div class="storyboard-effective-input-meta">' + escapeHtml(facts.join(' · ')) + '</div>' +
        '<strong>Exact prompt sent to ComfyUI</strong>' +
        '<pre>' + escapeHtml(String(input.prompt || take.prompt || '')) + '</pre>' +
        (referenceLines.length ? '<strong>Reference inputs</strong><pre>' + escapeHtml(referenceLines.join('\n')) + '</pre>' : '') +
        (requiredLoraLines.length ? '<strong>Required workflow LoRA</strong><pre>' + escapeHtml(requiredLoraLines.join('\n')) + '</pre>' : '') +
        (loraLines.length ? '<strong>Effective LoRAs</strong><pre>' + escapeHtml(loraLines.join('\n')) + '</pre>' : '') +
      '</div>' +
    '</details>';
  }

  function takeCardHtml(storyId, sceneId, takeId, take, takeIndex, selectedTakeId) {
    var rating = Math.max(0, Math.min(5, Number(take && take.rating || 0)));
    var selected = selectedTakeId === takeId;
    var ratingHtml = '<div class="storyboard-take-rating" aria-label="Rate this Take">';
    [1, 2, 3, 4, 5].forEach(function (value) {
      ratingHtml += '<button type="button" class="storyboard-take-star' + (value <= rating ? ' active' : '') +
        '" data-take-rating="' + escapeHtml(takeId) + '" data-rating-value="' + value +
        '" title="Rate ' + value + ' star' + (value === 1 ? '' : 's') + '" aria-label="Rate ' + value + ' star' + (value === 1 ? '' : 's') + '">' +
        (value <= rating ? '★' : '☆') + '</button>';
    });
    ratingHtml += '</div>';
    return '<article class="storyboard-take' + (selected ? ' selected' : '') + '" data-take-id="' + escapeHtml(takeId) + '">' +
      '<div class="storyboard-take-media" style="--take-aspect: ' + escapeHtml(takeAspectRatioCss(take)) + ';">' + takePreviewHtml(storyId, sceneId, take) +
        '<button type="button" class="storyboard-take-remove" data-take-action="remove" data-take-id="' + escapeHtml(takeId) + '" title="Remove Take" aria-label="Remove Take">×</button>' +
      '</div>' +
      '<div class="storyboard-take-footer">' +
        '<div class="storyboard-take-identity" title="' + escapeHtml(take.sourceFilename || '') + '">' +
          '<strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong>' +
          '<span>' + escapeHtml(takeMetaLabel(take)) + '</span>' +
          '<input type="text" maxlength="120" data-take-label="' + escapeHtml(takeId) + '" value="' + escapeHtml(take.label || '') + '" placeholder="Label this Take…" aria-label="Take label">' +
        '</div>' +
        ratingHtml +
        '<button type="button" class="review-captions-btn" data-take-action="select" data-take-id="' + escapeHtml(takeId) + '"' + (selected ? ' disabled' : '') + '>' + (selected ? 'Selected' : 'Select') + '</button>' +
      '</div>' +
      takeEffectiveInputHtml(take) +
    '</article>';
  }

  function pendingTakeCardHtml(job, takeIndex) {
    var status = String(job && job.status || '');
    var statusText = generationJobStatusText(job);
    var action = (status === 'backlog' || status === 'queued')
      ? '<button type="button" class="review-captions-btn" data-generation-action="cancel" data-job-id="' + escapeHtml(job.jobId) + '">Cancel</button>'
      : (status === 'starting' || status === 'running')
        ? '<button type="button" class="review-captions-btn" data-generation-action="stop" data-job-id="' + escapeHtml(job.jobId) + '">Stop</button>'
        : '';
    var previewPrimary = generationJobPreviewPrimary(job);
    var previewDetail = generationJobPreviewDetail(job);
    return '<article class="storyboard-take storyboard-take-pending" data-generation-job-id="' + escapeHtml(job.jobId) + '">' +
      '<div class="storyboard-take-media storyboard-take-pending-media"><div class="storyboard-take-pending-indicator" aria-hidden="true"></div><strong>' + escapeHtml(previewPrimary) + '</strong><span class="storyboard-take-pending-detail">' + escapeHtml(previewDetail) + '</span></div>' +
      '<div class="storyboard-take-footer storyboard-take-pending-footer">' +
        '<div class="storyboard-take-identity"><strong>Take ' + String(takeIndex + 1).padStart(2, '0') + '</strong><span>' + escapeHtml(statusText) + '</span></div>' +
        action +
      '</div>' +
    '</article>';
  }

  function activeTakeOptions(story, selectedTakeId) {
    var options = '<option value="">Choose a Take</option>';
    (story.sceneOrder || []).forEach(function (sourceSceneId, sceneIndex) {
      var sourceScene = (story.scenes || {})[sourceSceneId] || {};
      (sourceScene.takeOrder || []).forEach(function (takeId, takeIndex) {
        if (!sourceScene.takes || !sourceScene.takes[takeId]) return;
        options += '<option value="' + escapeHtml(sourceSceneId + '|' + takeId) + '"' +
          (takeId === selectedTakeId ? ' selected' : '') + '>Scene ' +
          String(sceneIndex + 1).padStart(2, '0') + ' · Take ' + String(takeIndex + 1).padStart(2, '0') +
          '</option>';
      });
    });
    return options;
  }

  function referenceForRole(scene, role) {
    var references = Array.isArray(scene && scene.references) ? scene.references : [];
    for (var i = 0; i < references.length; i += 1) {
      if (references[i] && references[i].role === role) return references[i];
    }
    return null;
  }

  function removedScenesHtml(removedScenes) {
    removedScenes = removedScenes && typeof removedScenes === 'object' ? removedScenes : {};
    var ids = Object.keys(removedScenes);
    if (!ids.length) return '';
    return '<details class="storyboard-removed-scenes">' +
      '<summary><span>Removed Scenes</span><span class="storyboard-removed-scenes-count">' + String(ids.length) + '</span></summary>' +
      '<div class="storyboard-removed-scenes-list">' +
        ids.map(function (sceneId) {
          var scene = removedScenes[sceneId] || {};
          return '<div class="storyboard-removed-scene" data-removed-scene-id="' + escapeHtml(sceneId) + '">' +
            '<span class="storyboard-removed-scene-title">' + escapeHtml(scene.title || 'Untitled Scene') + '</span>' +
            '<button type="button" class="storyboard-restore-scene-btn" data-restore-scene="' + escapeHtml(sceneId) + '" title="Restore Scene">↺ Restore</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</details>';
  }

  function renderScenes() {
    var host = el('storyboard-scenes-list');
    if (!host || !storyState.story) return;
    var story = storyState.story;
    var order = Array.isArray(story.sceneOrder) ? story.sceneOrder : [];
    var scenes = story.scenes || {};
    var removedScenes = story.removedScenes || {};
    var storyLoras = Array.isArray(story.loras) ? story.loras : [];
    var activeStoryLoras = storyLoras.filter(function (lora) { return lora && lora.enabled !== false; });

    syncSceneViewControls(order);
    if (storyState.sceneViewMode === 'sequence') {
      host.classList.remove('is-focus', 'is-overview');
      host.classList.add('is-sequence');
      host.innerHTML = '';
      return;
    }
    host.classList.remove('is-sequence');
    if (storyState.sceneViewMode === 'overview') {
      host.classList.remove('is-focus');
      host.classList.add('is-overview');
      var overviewHtml = order.map(function (sceneId, index) {
        var scene = scenes[sceneId] || {};
        var takeCount = Array.isArray(scene.takeOrder) ? scene.takeOrder.length : 0;
        var pendingTakeCount = generationJobsForScene(sceneId).length;
        return '<button type="button" class="storyboard-scene-overview-card' + (scene.selectedTakeId ? ' has-selected-take' : '') + '" data-scene-open="' + escapeHtml(sceneId) + '">' +
          '<span class="storyboard-scene-overview-number">Scene ' + String(index + 1).padStart(2, '0') + '</span>' +
          '<strong>' + escapeHtml(scene.title || 'Untitled Scene') + '</strong>' +
          '<span class="storyboard-scene-overview-summary">' + escapeHtml(scene.summary || 'No Scene intent yet.') + '</span>' +
          '<span class="storyboard-scene-overview-meta">' + String(takeCount) + ' Take' + (takeCount === 1 ? '' : 's') +
            (pendingTakeCount ? ' · ' + String(pendingTakeCount) + ' pending' : '') +
            (scene.selectedTakeId ? ' · selected' : '') + '</span>' +
        '</button>';
      }).join('');
      overviewHtml += removedScenesHtml(removedScenes);
      host.innerHTML = overviewHtml || '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';
      return;
    }

    host.classList.remove('is-overview');
    host.classList.add('is-focus');
    var focusedSceneId = ensureActiveScene(order);
    var renderOrder = focusedSceneId ? [focusedSceneId] : [];

    var activeHtml = renderOrder.map(function (sceneId) {
      var index = order.indexOf(sceneId);
      var scene = scenes[sceneId] || {};
      var promptDirectorModel = String(scene.promptDirectorModel || '').trim();
      var seedMode = sceneValue(scene, 'seedMode', 'random');
      var seed = sceneValue(scene, 'seed', '');
      var seedDisplay = seedMode === 'fixed' && seed !== '' && seed != null ? seed : -1;
      var sceneReferences = Array.isArray(scene.references) ? scene.references : [];
      var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
      var removedTakes = scene.removedTakes && typeof scene.removedTakes === 'object' ? scene.removedTakes : {};
      var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
      var previousSceneId = index > 0 ? order[index - 1] : '';
      var previousScene = previousSceneId ? scenes[previousSceneId] || {} : {};
      var previousSelectedTakeId = previousScene.selectedTakeId || '';
      var sceneGenerationJobs = generationJobsForScene(sceneId);
      var storyGenerationDefaults = story.generationDefaults || {};
      var inheritedAspectRatio = storyGenerationDefaults.aspectRatio || '4:3 (Standard)';
      var inheritedMegapixels = storyGenerationDefaults.megapixels == null ? 0.2 : storyGenerationDefaults.megapixels;
      var sceneAspectRatio = scene.aspectRatio == null ? '' : scene.aspectRatio;
      var sceneMegapixels = scene.megapixels == null ? '' : scene.megapixels;
      var sceneLoras = Array.isArray(scene.loras) ? scene.loras : [];
      var overrides = storyLoraOverrideMap(scene);
      var inheritedLoraRowsHtml = storyLoras.map(function (lora) {
        return inheritedLoraRowHtml(lora, overrides[String(lora.name || '').toLowerCase()]);
      }).join('');
      var loraRowsHtml = sceneLoras.map(sceneLoraRowHtml).join('');
      var baseLoras = storyState.generationCapabilities.baseLoras || [];
      var loraStatusTitle = storyState.generationCapabilities.available
        ? (baseLoras.length ? 'Required Turbo: ' + baseLoras.join(', ') : 'ComfyUI LoRAs loaded.')
        : (storyState.generationCapabilities.error || 'ComfyUI LoRAs unavailable.');
      var loraStatusText = storyState.generationCapabilities.available
        ? (baseLoras.length ? 'Turbo active' : 'LoRAs ready')
        : 'LoRAs unavailable';
      var referencesHtml = sceneReferences.map(function (reference) {
        if (!reference || !reference.role) return '';
        return '<span class="storyboard-reference-chip">' +
          escapeHtml(reference.role.replace(/_/g, ' ')) + ' · ' +
          escapeHtml(reference.frame || reference.sourceFilename || reference.source || 'source') +
          '<button type="button" data-reference-clear="' + escapeHtml(reference.role) + '" title="Clear reference" aria-label="Clear reference">×</button>' +
        '</span>';
      }).join('');
      var conditioningSummaryParts = [];
      if (activeStoryLoras.length) conditioningSummaryParts.push(String(activeStoryLoras.length) + ' inherited');
      var overrideCount = Object.keys(overrides).length;
      if (overrideCount) conditioningSummaryParts.push(String(overrideCount) + ' override' + (overrideCount === 1 ? '' : 's'));
      if (sceneLoras.length) conditioningSummaryParts.push(String(sceneLoras.length) + ' Scene');
      if (sceneReferences.length) conditioningSummaryParts.push(String(sceneReferences.length) + ' ref' + (sceneReferences.length === 1 ? '' : 's'));
      var conditioningSummary = conditioningSummaryParts.length ? conditioningSummaryParts.join(' · ') : 'None';
      var removedTakeIds = Object.keys(removedTakes);
      var removedTakesHtml = removedTakeIds.length
        ? '<section class="storyboard-removed-takes">' +
            '<header class="storyboard-removed-takes-header">' +
              '<strong>Removed Takes</strong>' +
              '<span>' + String(removedTakeIds.length) + '</span>' +
            '</header>' +
            '<div class="storyboard-removed-takes-list">' +
              removedTakeIds.map(function (takeId) {
                var take = removedTakes[takeId] || {};
                var filename = String(take.sourceFilename || takeId);
                return '<div class="storyboard-removed-take-row">' +
                  '<span class="storyboard-removed-take-name" title="' + escapeHtml(filename) + '">' +
                    escapeHtml(filename) +
                  '</span>' +
                  '<div class="storyboard-removed-take-actions">' +
                    '<button type="button" class="review-captions-btn" data-take-action="restore" data-take-id="' +
                      escapeHtml(takeId) + '">Restore</button>' +
                    '<button type="button" class="review-captions-btn storyboard-take-delete" data-take-action="delete" data-take-id="' +
                      escapeHtml(takeId) + '">Delete</button>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
          '</section>'
        : '';
      var takesHtml = takeOrder.map(function (takeId, takeIndex) {
        var take = takes[takeId];
        return take ? takeCardHtml(story.id, sceneId, takeId, take, takeIndex, scene.selectedTakeId) : '';
      }).join('');
      var pendingTakesHtml = sceneGenerationJobs.map(function (job, pendingIndex) {
        return pendingTakeCardHtml(job, takeOrder.length + pendingIndex);
      }).join('');
      var takeSummaryParts = [
        String(takeOrder.length) + ' Take' + (takeOrder.length === 1 ? '' : 's')
      ];
      if (scene.selectedTakeId) takeSummaryParts.push('1 selected');
      if (sceneGenerationJobs.length) {
        takeSummaryParts.push(String(sceneGenerationJobs.length) + ' pending');
      }
      var takesInitiallyOpen = takeOrder.length > 0 || sceneGenerationJobs.length > 0;
      return '<section class="storyboard-scene" data-scene-id="' + escapeHtml(sceneId) + '">' +
        '<div class="storyboard-scene-body">' +
          '<div class="storyboard-scene-main">' +
            '<label class="storyboard-field storyboard-scene-title-field"><span>Title</span><input data-scene-field="title" value="' + escapeHtml(sceneValue(scene, 'title', '')) + '" placeholder="Scene title"></label>' +
            '<label class="storyboard-field storyboard-scene-intent"><span>Scene intent</span><textarea data-scene-field="summary" rows="2" placeholder="Describe what happens in this Scene.">' + escapeHtml(sceneValue(scene, 'summary', '')) + '</textarea></label>' +
            '<div class="storyboard-prompt-block">' +
              '<div class="storyboard-prompt-heading">' +
                '<span' +
                  (promptDirectorModel ? ' title="Last populated by Director model ' + escapeHtml(promptDirectorModel) + '"' : '') +
                '>Generation prompt</span>' +
                '<div class="storyboard-prompt-actions">' +
                  '<button type="button" class="review-captions-btn storyboard-director-action" data-director-write title="Draft a complete H3 prompt from this Scene intent and the useful Story context.">Write with Director</button>' +
                  '<button type="button" class="review-captions-btn' +
                    (typeof scene.previousPrompt === 'string' ? '' : ' hidden') +
                    '" data-director-restore title="Restore the Scene state from before the last Director edit.">Restore Previous</button>' +
                '</div>' +
              '</div>' +
              '<textarea class="storyboard-prompt-textarea" data-scene-field="prompt" rows="7" placeholder="Full model-facing prompt. Write it directly or let the Director draft it from the Scene intent.">' + escapeHtml(sceneValue(scene, 'prompt', '')) + '</textarea>' +
              '<div class="storyboard-director-actions">' +
                '<input type="text" data-director-correction placeholder="Tell the Director what to change in this prompt...">' +
                '<button type="button" class="review-captions-btn storyboard-director-action" data-director-refine title="' +
                  (scene.refineComplete ? 'Last refinement completed. Start typing another instruction to refine again.' : 'Apply this correction to the existing generation prompt.') +
                  '">' + (scene.refineComplete ? '✓' : 'Refine') + '</button>' +
                '<span class="storyboard-save-state" data-director-status></span>' +
              '</div>' +
              '<details class="storyboard-scene-disclosure storyboard-prompt-pipeline-details">' +
                '<summary><span>Prompt pipeline</span><span class="storyboard-disclosure-summary-state">Inspect Director → H3</span></summary>' +
                '<div class="storyboard-disclosure-body storyboard-prompt-pipeline-body">' +
                  '<div class="storyboard-prompt-pipeline-actions">' +
                    '<button type="button" class="review-captions-btn" data-director-preview="write_prompt">Preview Write request</button>' +
                    '<button type="button" class="review-captions-btn" data-director-preview="refine_prompt">Preview Refine request</button>' +
                  '</div>' +
                  '<span class="storyboard-prompt-pipeline-note">This is the exact current Director contract. Generated Takes preserve the exact effective H3 input separately.</span>' +
                  '<pre data-director-request-preview-output>Choose a request to inspect what WebCap will send to the Director.</pre>' +
                '</div>' +
              '</details>' +
            '</div>' +
            '<details class="storyboard-scene-disclosure storyboard-continuity-details">' +
              '<summary><span>Continuity</span><span class="storyboard-disclosure-summary-state">' +
                ((String(sceneValue(scene, 'entryState', '')).trim() || String(sceneValue(scene, 'exitState', '')).trim()) ? 'Entry + Exit defined' : 'Optional') +
              '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<div class="storyboard-scene-handoff-row storyboard-scene-handoff-primary">' +
                  '<label class="storyboard-field"><span>Entry state</span><textarea data-scene-field="entryState" rows="3" placeholder="What must already be true when this Scene begins?">' + escapeHtml(sceneValue(scene, 'entryState', '')) + '</textarea></label>' +
                  '<label class="storyboard-field"><span>Exit state</span><textarea data-scene-field="exitState" rows="3" placeholder="What should be true when this Scene ends?">' + escapeHtml(sceneValue(scene, 'exitState', '')) + '</textarea></label>' +
                '</div>' +
              '</div>' +
            '</details>' +
            '<details class="storyboard-scene-disclosure storyboard-notes-details">' +
              '<summary><span>Notes</span><span class="storyboard-disclosure-summary-state">' + (String(sceneValue(scene, 'notes', '')).trim() ? 'Added' : 'Optional') + '</span></summary>' +
              '<div class="storyboard-disclosure-body">' +
                '<label class="storyboard-field"><textarea data-scene-field="notes" rows="3" placeholder="Continuity reminders, corrections, ideas...">' + escapeHtml(sceneValue(scene, 'notes', '')) + '</textarea></label>' +
              '</div>' +
            '</details>' +
          '</div>' +
          '<aside class="storyboard-scene-inspector" aria-label="Scene inspector">' +
            '<section class="storyboard-inspector-section storyboard-generation-inspector">' +
              '<div class="storyboard-inspector-section-heading"><strong>Generation</strong></div>' +
              '<div class="storyboard-generation-settings">' +
                '<label class="storyboard-field" title="Scene-specific clip duration."><span>Duration (s)</span><input type="number" min="9" max="15" step="0.1" data-scene-field="durationSeconds" value="' + escapeHtml(sceneValue(scene, 'durationSeconds', 10)) + '"></label>' +
                '<label class="storyboard-field" title="Inherit the Story aspect ratio unless this Scene needs an override."><span>Aspect ratio</span><select data-scene-field="aspectRatio">' +
                  '<option value=""' + (sceneAspectRatio === '' ? ' selected' : '') + '>Inherit · ' + escapeHtml(inheritedAspectRatio) + '</option>' +
                  ['1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)', '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'].map(function (value) {
                    return '<option value="' + escapeHtml(value) + '"' + (sceneAspectRatio === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
                  }).join('') +
                '</select></label>' +
                '<label class="storyboard-field" title="Leave blank to inherit the Story megapixel target."><span>Megapixels</span><input type="number" min="0.05" step="0.05" data-scene-field="megapixels" value="' + escapeHtml(sceneMegapixels) + '" placeholder="Inherit · ' + escapeHtml(inheritedMegapixels) + '"></label>' +
                '<label class="storyboard-field" title="Use -1 for a random seed, or enter a non-negative integer for a fixed seed."><span>Seed</span><input type="number" min="-1" step="1" data-scene-field="seed" value="' + escapeHtml(seedDisplay) + '"></label>' +
              '</div>' +
              '<button type="button" class="storyboard-primary-btn storyboard-generate-btn" data-scene-generate title="Queue a new Take from the current saved Scene.">' +
                (sceneGenerationJobs.length ? 'Generate Another Take' : 'Generate Take') +
              '</button>' +
            '</section>' +
            '<section class="storyboard-inspector-section storyboard-conditioning-panel">' +
              '<div class="storyboard-inspector-section-heading"><strong>Conditioning</strong><span>' + escapeHtml(conditioningSummary) + '</span></div>' +
              '<div class="storyboard-conditioning-body">' +
                '<div class="storyboard-lora-panel">' +
                  '<div class="storyboard-lora-header"><strong>LoRAs</strong></div>' +
                  (storyLoras.length ? '<div class="storyboard-lora-subsection"><span class="storyboard-lora-subtitle">Inherited from Story</span><div class="storyboard-lora-list" data-story-lora-inherited-list>' + inheritedLoraRowsHtml + '</div></div>' : '<div class="storyboard-lora-list hidden" data-story-lora-inherited-list></div>') +
                  (storyLoras.length ? '<div class="storyboard-lora-subsection"><span class="storyboard-lora-subtitle">Scene only</span><div class="storyboard-lora-list" data-scene-lora-list>' + loraRowsHtml + '</div></div>' : '<div class="storyboard-lora-list" data-scene-lora-list>' + loraRowsHtml + '</div>') +
                  '<div class="storyboard-lora-picker-wrap">' +
                    '<input type="search" class="storyboard-lora-picker" data-scene-lora-picker autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" placeholder="Filter / choose LoRA…" aria-label="Filter and choose available LoRA">' +
                    '<div class="storyboard-lora-picker-menu hidden" data-lora-picker-menu role="listbox"></div>' +
                  '</div>' +
                  '<span class="storyboard-lora-status" title="' + escapeHtml(loraStatusTitle) + '">' + escapeHtml(loraStatusText) + '</span>' +
                '</div>' +
                '<details class="storyboard-scene-disclosure storyboard-reference-details">' +
                  '<summary><span>References</span><span class="storyboard-disclosure-summary-state">' + (sceneReferences.length ? sceneReferences.length + ' assigned' : 'None') + '</span></summary>' +
                  '<div class="storyboard-disclosure-body">' +
                    (referencesHtml ? '<div class="storyboard-reference-chips">' + referencesHtml + '</div>' : '<span class="storyboard-reference-empty">No references assigned.</span>') +
                    (previousSelectedTakeId
                      ? '<button type="button" class="review-captions-btn storyboard-reference-quick" data-reference-previous title="Use the previous Scene\'s selected Take as this Scene\'s first-frame reference.">Previous selected Take → first frame</button>'
                      : (index > 0 ? '<span class="storyboard-reference-empty">Select a Take in the previous Scene for quick continuity.</span>' : '')) +
                    '<div class="storyboard-reference-editor">' +
                      '<select data-reference-role title="Which reference slot this media should fill."><option value="first_frame">First frame</option><option value="last_frame">Last frame</option></select>' +
                      '<select data-reference-source title="Choose an existing Take to use as a reference.">' + activeTakeOptions(story, '') + '</select>' +
                      '<select data-reference-frame title="Choose which frame from the source Take to use."><option value="last">Last frame</option><option value="first">First frame</option></select>' +
                      '<button type="button" class="review-captions-btn" data-reference-apply title="Assign the selected Take frame to this reference slot.">Assign Take</button>' +
                      '<label class="storyboard-reference-upload-btn reference-dropzone" data-reference-dropzone title="Drop an image directly into the selected first/last-frame reference slot, or click to browse.">' +
                        '<input type="file" accept="image/*" data-reference-upload>' +
                        '<span class="reference-dropzone-copy"><strong>Drop image here or browse</strong><small>Uploads to the selected reference slot</small></span>' +
                      '</label>' +
                    '</div>' +
                  '</div>' +
                '</details>' +
              '</div>' +
            '</section>' +
          '</aside>' +
        '</div>' +
        '<details class="storyboard-takes"' + (takesInitiallyOpen ? ' open' : '') + '>' +
          '<summary class="storyboard-takes-summary"><strong>Takes</strong><span>' + escapeHtml(takeSummaryParts.join(' · ')) + '</span>' +
            '<label class="review-captions-btn storyboard-take-upload-btn" title="Import existing image or video media as a Take for this Scene. Imported media is copied into this Story and keeps a frozen Scene snapshot.">Import Take<input type="file" accept="image/*,video/*" data-take-upload hidden></label>' +
          '</summary>' +
          '<div class="storyboard-takes-content">' +
            '<div class="storyboard-takes-grid">' + (takesHtml + pendingTakesHtml || '<div class="storyboard-takes-empty">No Takes yet.</div>') + '</div>' +
            removedTakesHtml +
          '</div>' +
        '</details>' +
      '</section>';
    }).join('');

    if (!activeHtml) activeHtml = '<div class="storyboard-library-empty">No Scenes yet. Add the first generatable scene.</div>';

    host.innerHTML = activeHtml + removedScenesHtml(removedScenes);
    syncDirectorPendingControls();
    if (storyState.director.busy && storyState.director.activityTarget) positionDirectorActivity();
  }

  function renderStory() {
    var empty = el('storyboard-editor-empty');
    var editor = el('storyboard-editor-content');
    var overviewToggle = el('storyboard-story-toggle');
    if (!storyState.story) {
      if (empty) empty.classList.remove('hidden');
      if (editor) editor.classList.add('hidden');
      overviewToggle.classList.add('hidden');
      setSaveState('');
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (editor) editor.classList.remove('hidden');
    overviewToggle.classList.remove('hidden');

    el('storyboard-story-title').value = storyState.story.title || '';
    el('storyboard-story-icon').value = STORY_RAIL_ICONS[storyState.story.icon] ? storyState.story.icon : '';
    syncStoryIconPicker();
    el('storyboard-story-concept').value = storyState.story.concept || '';
    el('storyboard-story-style').value = storyState.story.style || '';
    renderStoryStylePresetSelector();
    renderStoryInvariants();
    el('storyboard-story-status').value = storyState.story.status || 'active';
    var targetSceneCount = storyState.story.targetSceneCount;
    var targetScenesInput = el('storyboard-story-target-scenes');
    var autoSceneCountButton = el('storyboard-scene-count-auto');
    var autoSceneCount = targetSceneCount == null;
    targetScenesInput.value = autoSceneCount ? '' : targetSceneCount;
    targetScenesInput.disabled = autoSceneCount;
    autoSceneCountButton.classList.toggle('active', autoSceneCount);
    autoSceneCountButton.setAttribute('aria-pressed', autoSceneCount ? 'true' : 'false');
    var storyDefaults = storyState.story.generationDefaults || {};
    el('storyboard-story-aspect-ratio').value = storyDefaults.aspectRatio || '4:3 (Standard)';
    el('storyboard-story-megapixels').value = storyDefaults.megapixels == null ? 0.2 : storyDefaults.megapixels;
    var developButton = el('storyboard-develop-btn');
    if (developButton) {
      var hasScenes = (storyState.story.sceneOrder || []).length > 0;
      developButton.textContent = hasScenes ? 'Re-develop Scenes…' : 'Develop Scenes';
      developButton.classList.toggle('storyboard-redevelop-btn', hasScenes);
      var developRow = developButton.closest('.storyboard-develop-row');
      if (developRow) developRow.classList.toggle('has-scenes', hasScenes);
    }
    var restoreConceptButton = el('storyboard-restore-concept-btn');
    if (restoreConceptButton) {
      restoreConceptButton.classList.toggle('hidden', typeof storyState.story.previousConcept !== 'string');
    }
    setStoryCollapsed(storyState.storyCollapsed);
    renderStoryLoras();
    renderScenes();
    renderStoryReadiness();
    syncDirectorPendingControls();
    renderSequencePreview();
    renderLibrary();
    renderStoryAction();
  }

  function refreshLibrary() {
    return request(null, '').then(function (payload) {
      storyState.stories = payload.stories || [];
      renderLibrary();
      return payload;
    });
  }

  function openStory(storyId) {
    storyId = String(storyId || '');
    if (!storyId) throw new Error('Storyboard Story ID is required.');
    var requestId = ++storyState.openStoryRequestId;
    var previousStoryId = storyState.story && storyState.story.id;
    setSaveState('Loading...');
    return flushPendingSaves().then(function () {
      if (requestId !== storyState.openStoryRequestId) return null;
      return request(null, 'story=' + encodeURIComponent(storyId));
    }).then(function (payload) {
      if (!payload || requestId !== storyState.openStoryRequestId) return null;
      if (!payload.story || String(payload.story.id || '') !== storyId) {
        throw new Error('Storyboard Story response identity mismatch.');
      }
      storyState.story = payload.story;
      if (previousStoryId !== payload.story.id && storyState.storyCollapsed) setStoryCollapsed(false);
      if (storyState.director.busy && storyState.director.activityTarget) positionDirectorActivity();
      storyState.sequenceExport = null;
      storyState.sequenceEncodingWarnings = [];
      storyState.sequenceWarningsVisible = false;
      storyState.newTakeCounts = {};
      return refreshGenerationQueue(storyId).then(function () {
        if (requestId !== storyState.openStoryRequestId) return null;
        return reconcileDirectorJobs();
      });
    }).then(function () {
      if (requestId !== storyState.openStoryRequestId) return null;
      renderStory();
      if (typeof window.refreshAssistantModes === 'function') window.refreshAssistantModes();
      setSaveState('Saved');
      return refreshSequenceExport(storyId);
    }).catch(function (err) {
      if (requestId !== storyState.openStoryRequestId) return null;
      reportError(err);
      return null;
    });
  }

  function createStory() {
    return flushPendingSaves().then(function () {
      return request({
        operation: 'create_story',
        story: {
          title: 'Untitled Story',
          concept: '',
          style: '',
          invariants: [],
          tags: [],
          status: 'active',
          pinned: false,
          targetSceneCount: 12,
          generationDefaults: { aspectRatio: '4:3 (Standard)', megapixels: 0.2 }
        }
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      if (storyState.storyCollapsed) setStoryCollapsed(false);
      storyState.sequenceExport = null;
      storyState.sequenceEncodingWarnings = [];
      storyState.sequenceWarningsVisible = false;
      storyState.newTakeCounts = {};
      storyState.generationJobs = {};
      Object.keys(storyState.generationReceipts).forEach(clearGenerationReceipt);
      syncStoryboardGenerationActivity();
      return refreshLibrary().then(function () {
        renderStory();
        setSaveState('Saved');
      });
    }).catch(reportError);
  }

  function deleteStory(storyId, title) {
    if (!storyId) return;
    var deletedWasOpen = !!(storyState.story && storyState.story.id === storyId);
    title = String(title || 'Untitled Story');
    if (!window.confirm(
      'Delete "' + title + '" and permanently remove all of its Scenes, Takes, references, and exports? This cannot be undone.'
    )) return;

    setSaveState('Deleting...');
    flushPendingSaves().then(function () {
      return request({
        operation: 'delete_story',
        storyId: storyId
      });
    }).then(function () {
      removeQueuedFirstCut(storyId);
      if (deletedWasOpen) {
        storyState.story = null;
        storyState.sequenceExport = null;
        storyState.sequenceEncodingWarnings = [];
        storyState.sequenceWarningsVisible = false;
        storyState.newTakeCounts = {};
        storyState.activeSceneId = '';
        storyState.generationJobs = {};
        Object.keys(storyState.generationReceipts).forEach(clearGenerationReceipt);
        syncStoryboardGenerationActivity();
      }
      return refreshLibrary();
    }).then(function () {
      if (!deletedWasOpen) {
        renderLibrary();
        setSaveState('');
        return;
      }
      var next = storyState.stories && storyState.stories[0];
      if (next) return openStory(next.id);
      renderStory();
      setSaveState('');
    }).catch(reportError);
  }

  function libraryStory(storyId) {
    return (storyState.stories || []).find(function (story) { return story.id === storyId; }) || null;
  }

  function updateStoryFromLibrary(storyId, changes) {
    return request({
      operation: 'update_story',
      storyId: storyId,
      story: changes || {}
    }).then(function (payload) {
      if (storyState.story && storyState.story.id === storyId) storyState.story = payload.story;
      return refreshLibrary().then(function () {
        renderStory();
        return payload.story;
      });
    });
  }

  function duplicateStory(storyId) {
    setSaveState('Duplicating...');
    return flushPendingSaves().then(function () {
      return request({ operation: 'duplicate_story', storyId: storyId });
    }).then(function (payload) {
      return refreshLibrary().then(function () {
        setSaveState('Saved');
        return openStory(payload.story.id);
      });
    }).catch(reportError);
  }

  function toggleStoryPin(storyId) {
    var story = libraryStory(storyId);
    if (!story) return;
    setSaveState(story.pinned ? 'Unpinning...' : 'Pinning...');
    updateStoryFromLibrary(storyId, { pinned: !story.pinned }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function toggleStoryArchive(storyId) {
    var story = libraryStory(storyId);
    if (!story) return;
    var archived = story.status === 'archived';
    setSaveState(archived ? 'Restoring...' : 'Archiving...');
    updateStoryFromLibrary(storyId, { status: archived ? 'active' : 'archived' }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function exportStory(storyId) {
    setSaveState('Exporting sequence...');
    flushPendingSaves().then(function () {
      return assemblyRequest({ storyId: storyId });
    }).then(function (payload) {
      if (payload.requiresEncoding) {
        if (storyState.story && storyState.story.id === storyId) {
          storyState.sequenceEncodingWarnings = payload.warnings || [];
          storyState.sequenceWarningsVisible = false;
          renderSequencePreview();
          setSaveState('Saved');
          return;
        }
        throw new Error('This Story requires encoding. Open its Sequence view to review warnings and encode it.');
      }
      if (storyState.story && storyState.story.id === storyId) {
        storyState.sequenceExport = payload.export || null;
        renderSequencePreview();
      }
      setSaveState('Saved');
    }).catch(reportError);
  }

  function storyPayloadFromUi() {
    var payload = {
      title: el('storyboard-story-title').value,
      icon: el('storyboard-story-icon').value,
      concept: el('storyboard-story-concept').value,
      style: el('storyboard-story-style').value,
      repairInstruction: String(storyState.story.repairInstruction || ''),
      repairComplete: !!storyState.story.repairComplete,
      invariants: storyInvariantsFromUi(),
      loras: storyLorasFromUi(),
      targetSceneCount: el('storyboard-scene-count-auto').getAttribute('aria-pressed') === 'true'
        ? null
        : (el('storyboard-story-target-scenes').value || 12),
      generationDefaults: {
        aspectRatio: el('storyboard-story-aspect-ratio').value || '4:3 (Standard)',
        megapixels: el('storyboard-story-megapixels').value || 0.2
      },
      status: el('storyboard-story-status').value,
      pinned: !!storyState.story.pinned
    };
    if (directorTargetPending({ kind: 'concept', storyId: storyState.story.id })) {
      delete payload.concept;
    }
    return payload;
  }

  function saveStoryNow(target) {
    if (!target) {
      if (!storyState.story) return Promise.resolve();
      target = {
        storyId: storyState.story.id,
        payload: storyPayloadFromUi()
      };
    }
    setSaveState('Saving...');
    var storyId = target.storyId;
    var storyPayload = target.payload;
    var previous = storyState.storySavePromise;
    var promise = (previous ? previous.catch(function () {}) : Promise.resolve()).then(function () {
      return request({
        operation: 'update_story',
        storyId: storyId,
        story: storyPayload
      });
    }).then(function (payload) {
      if (storyState.story && String(storyState.story.id || '') === String(storyId)) {
        storyState.story = payload.story;
        setSaveState('Saved');
      }
      if (storyState.storySavePromise === promise) storyState.storySaveError = null;
      return refreshLibrary();
    }).catch(function (err) {
      if (storyState.storySavePromise === promise) storyState.storySaveError = err;
      throw err;
    }).finally(function () {
      if (storyState.storySavePromise === promise) storyState.storySavePromise = null;
    });
    storyState.storySavePromise = promise;
    return promise;
  }

  function scheduleStorySave() {
    if (!storyState.story) return;
    if (storyState.saveTimer) clearTimeout(storyState.saveTimer);
    storyState.pendingStorySave = {
      storyId: storyState.story.id,
      payload: storyPayloadFromUi()
    };
    setSaveState('Unsaved changes');
    storyState.saveTimer = setTimeout(function () {
      var target = storyState.pendingStorySave;
      storyState.saveTimer = 0;
      storyState.pendingStorySave = null;
      saveStoryNow(target).catch(reportError);
    }, 450);
  }

  function sceneElement(sceneId) {
    return document.querySelector('.storyboard-scene[data-scene-id="' + CSS.escape(sceneId) + '"]');
  }

  function sceneSaveKey(storyId, sceneId) {
    return String(storyId || '') + ':' + String(sceneId || '');
  }

  function scenePayloadFromUi(sceneId) {
    var root = sceneElement(sceneId);
    if (!root) throw new Error('Scene editor is missing for ' + sceneId + '.');
    var currentScene = storyState.story && storyState.story.scenes
      ? storyState.story.scenes[sceneId] || {}
      : {};
    function field(name) {
      return root.querySelector('[data-scene-field="' + name + '"]');
    }
    var seedNode = field('seed');
    var seedText = String(seedNode.value || '').trim();
    var randomSeed = seedText === '' || seedText === '-1';
    var promptValue = field('prompt').value;
    var promptUnchanged = promptValue === String(currentScene.prompt || '');
    var promptDirectorModel = promptUnchanged ? String(currentScene.promptDirectorModel || '') : '';
    var promptDirectorJobId = promptUnchanged ? String(currentScene.promptDirectorJobId || '') : '';
    var refineComplete = promptUnchanged && !!currentScene.refineComplete;
    var payload = {
      title: field('title').value,
      summary: field('summary').value,
      entryState: field('entryState').value,
      exitState: field('exitState').value,
      prompt: promptValue,
      promptDirectorModel: promptDirectorModel,
      promptDirectorJobId: promptDirectorJobId,
      refineComplete: refineComplete,
      notes: field('notes').value,
      durationSeconds: field('durationSeconds').value,
      aspectRatio: field('aspectRatio').value || null,
      megapixels: String(field('megapixels').value || '').trim() || null,
      seedMode: randomSeed ? 'random' : 'fixed',
      seed: randomSeed ? null : seedText,
      loras: Array.prototype.map.call(root.querySelectorAll('[data-scene-lora-row]'), function (row) {
        return {
          name: row.querySelector('[data-scene-lora-name]').value,
          strength: row.querySelector('[data-scene-lora-strength]').value
        };
      }).filter(function (item) { return !!item.name; }),
      storyLoraOverrides: Array.prototype.map.call(root.querySelectorAll('[data-story-lora-inherited-row]'), function (row) {
        var name = String(row.dataset.loraName || '');
        var enabled = row.querySelector('[data-story-lora-enabled]').checked;
        var strength = Number(row.querySelector('[data-story-lora-scene-strength]').value);
        var defaultStrength = Number(row.dataset.storyDefaultStrength);
        if (!name) return null;
        if (!enabled) return { name: name, enabled: false };
        if (strength !== defaultStrength) return { name: name, strength: strength };
        return null;
      }).filter(Boolean)
    };
    if (directorTargetPending({ kind: 'scene-prompt', storyId: storyState.story.id, sceneId: sceneId })) {
      delete payload.prompt;
      delete payload.promptDirectorModel;
      delete payload.promptDirectorJobId;
      delete payload.refineComplete;
    }
    if (directorTargetPending({ kind: 'repair', storyId: storyState.story.id })) {
      delete payload.summary;
      delete payload.entryState;
      delete payload.exitState;
      delete payload.prompt;
      delete payload.promptDirectorModel;
      delete payload.promptDirectorJobId;
      delete payload.refineComplete;
    }
    return payload;
  }

  function saveSceneNow(sceneId, target) {
    if (!target) {
      if (!storyState.story) return Promise.resolve();
      target = {
        storyId: storyState.story.id,
        sceneId: sceneId,
        payload: scenePayloadFromUi(sceneId)
      };
    }
    setSaveState('Saving...');
    var storyId = target.storyId;
    var scenePayload = target.payload;
    var saveKey = sceneSaveKey(storyId, sceneId);
    var previous = storyState.sceneSavePromises[saveKey];
    var promise = (previous ? previous.catch(function () {}) : Promise.resolve()).then(function () {
      return request({
        operation: 'update_scene',
        storyId: storyId,
        sceneId: sceneId,
        scene: scenePayload
      });
    }).then(function (payload) {
      if (storyState.story && String(storyState.story.id || '') === String(storyId)) {
        storyState.story = payload.story;
        setSaveState('Saved');
      }
      if (storyState.sceneSavePromises[saveKey] === promise) delete storyState.sceneSaveErrors[saveKey];
      return refreshLibrary();
    }).catch(function (err) {
      if (storyState.sceneSavePromises[saveKey] === promise) storyState.sceneSaveErrors[saveKey] = err;
      throw err;
    }).finally(function () {
      if (storyState.sceneSavePromises[saveKey] === promise) delete storyState.sceneSavePromises[saveKey];
    });
    storyState.sceneSavePromises[saveKey] = promise;
    return promise;
  }

  function scheduleSceneSave(sceneId) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var saveKey = sceneSaveKey(storyId, sceneId);
    var existing = storyState.sceneTimers[saveKey];
    if (existing) clearTimeout(existing.timer);
    var target = {
      storyId: storyId,
      sceneId: sceneId,
      payload: scenePayloadFromUi(sceneId)
    };
    setSaveState('Unsaved changes');
    target.timer = setTimeout(function () {
      if (storyState.sceneTimers[saveKey] === target) delete storyState.sceneTimers[saveKey];
      saveSceneNow(sceneId, target).catch(reportError);
    }, 450);
    storyState.sceneTimers[saveKey] = target;
  }

  function flushPendingSaves() {
    if (storyState.saveTimer) {
      clearTimeout(storyState.saveTimer);
      storyState.saveTimer = 0;
      var storyTarget = storyState.pendingStorySave;
      storyState.pendingStorySave = null;
      saveStoryNow(storyTarget);
    }
    Object.keys(storyState.sceneTimers).forEach(function (saveKey) {
      var target = storyState.sceneTimers[saveKey];
      clearTimeout(target.timer);
      delete storyState.sceneTimers[saveKey];
      saveSceneNow(target.sceneId, target);
    });

    var pending = [];
    if (storyState.storySavePromise) pending.push(storyState.storySavePromise);
    Object.keys(storyState.sceneSavePromises).forEach(function (saveKey) {
      pending.push(storyState.sceneSavePromises[saveKey]);
    });

    return Promise.all(pending).then(function () {
      if (storyState.storySaveError) throw storyState.storySaveError;
      var failedSaveKeys = Object.keys(storyState.sceneSaveErrors);
      if (failedSaveKeys.length) throw storyState.sceneSaveErrors[failedSaveKeys[0]];
    });
  }

  function addScene() {
    if (!storyState.story) return;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'add_scene',
      storyId: storyState.story.id,
      scene: { title: 'New Scene', durationSeconds: 10, seedMode: 'random' }
    }); }).then(function (payload) {
      storyState.story = payload.story;
      storyState.sceneViewMode = 'focus';
      storyState.activeSceneId = (payload.story.sceneOrder || []).slice(-1)[0] || '';
      window.localStorage.setItem('webcap.storyboard.sceneView', 'focus');
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function reorderScene(sceneId, delta) {
    var order = storyState.story && Array.isArray(storyState.story.sceneOrder)
      ? storyState.story.sceneOrder.slice()
      : [];
    var index = order.indexOf(sceneId);
    var next = index + delta;
    if (index < 0 || next < 0 || next >= order.length) return;
    var temp = order[index];
    order[index] = order[next];
    order[next] = temp;
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'reorder_scenes',
      storyId: storyState.story.id,
      sceneOrder: order
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function insertDirectorSceneAfter(sceneId) {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var order = Array.isArray(storyState.story.sceneOrder) ? storyState.story.sceneOrder : [];
    var index = order.indexOf(sceneId);
    if (index < 0 || index + 1 >= order.length) {
      reportError(new Error('Insert Director Scene requires a following Scene.'));
      return;
    }
    var directorTarget = { kind: 'scenes', storyId: storyId };
    if (directorTargetBlocked(directorTarget)) {
      reportError(new Error('This Story already has Director work that conflicts with Scene insertion.'));
      return;
    }
    var modelId = storyState.director.modelId;
    if (!modelId) {
      reportError(new Error('Choose a Storyboard Director model first.'));
      return;
    }

    var saveBarrier = flushPendingSaves();
    setDirectorPending(directorTarget, true);
    setSaveState('Director inserting Scene...');
    startDirectorActivity();
    saveBarrier.then(function () {
      return directorRequest({
        storyId: storyId,
        sceneId: sceneId,
        operation: 'insert_scene',
        model: modelId
      });
    }).then(function (payload) {
      return applyDirectorResultToVisibleStory({
        storyId: storyId,
        sceneId: sceneId,
        operation: 'insert_scene',
        jobId: payload.jobId
      }).then(function () {
        return consumeDirectorJob(payload.jobId);
      });
    }).then(function () {
      setSaveState('Saved');
      return refreshLibrary();
    }).catch(function (err) {
      if (!directorWasStopped(err)) reportError(err);
    }).finally(function () {
      setDirectorPending(directorTarget, false);
      finishDirectorActivity();
    });
  }

  function duplicateScene(sceneId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'duplicate_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      var duplicatedOrder = payload.story.sceneOrder || [];
      var sourceIndex = duplicatedOrder.indexOf(sceneId);
      storyState.sceneViewMode = 'focus';
      storyState.activeSceneId = duplicatedOrder[sourceIndex + 1] || sceneId;
      window.localStorage.setItem('webcap.storyboard.sceneView', 'focus');
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function deleteScene(sceneId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'delete_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function restoreScene(sceneId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'restore_scene',
      storyId: storyState.story.id,
      sceneId: sceneId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function uploadTake(sceneId, file) {
    if (!storyState.story || !file) return;
    setSaveState('Adding Take...');
    flushPendingSaves().then(function () {
      var form = new FormData();
      form.append('storyId', storyState.story.id);
      form.append('sceneId', sceneId);
      form.append('file', file, file.name);
      return fetch('/fs/storyboard/take_upload', { method: 'POST', body: form }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body || !body.ok) throw new Error((body && body.error) || 'Take upload failed.');
          return body;
        });
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
      refreshLibrary();
    }).catch(reportError);
  }

  function labelTake(sceneId, takeId, label) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'label_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId,
      label: String(label || '').trim()
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function rateTake(sceneId, takeId, rating) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'rate_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId,
      rating: rating === '' ? null : Number(rating)
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function selectTake(sceneId, takeId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'select_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      storyState.sequenceEncodingWarnings = [];
      storyState.sequenceWarningsVisible = false;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function removeTake(sceneId, takeId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'remove_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function deleteTake(sceneId, takeId) {
    var scene = storyState.story && storyState.story.scenes ? storyState.story.scenes[sceneId] : null;
    var take = scene && scene.takes ? scene.takes[takeId] : null;
    if (!take && scene && scene.removedTakes) take = scene.removedTakes[takeId];
    var label = take && (take.label || take.sourceFilename) ? (take.label || take.sourceFilename) : 'this Take';
    var selected = !!(scene && scene.selectedTakeId === takeId);
    var message = 'Delete "' + label + '" permanently? This deletes its media and metadata and cannot be undone.';
    if (selected) {
      message += '\n\nThis Take is currently selected. Deleting it will leave the Scene without a selected Take.';
    }
    if (!window.confirm(message)) return;
    setSaveState('Deleting...');
    flushPendingSaves().then(function () { return request({
      operation: 'delete_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function restoreTake(sceneId, takeId) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'restore_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      takeId: takeId
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function setSceneReference(sceneId, role, sourceSceneId, sourceTakeId, frame) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'set_scene_reference_from_take',
      storyId: storyState.story.id,
      sceneId: sceneId,
      role: role,
      sourceSceneId: sourceSceneId,
      sourceTakeId: sourceTakeId,
      frame: frame
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function clearSceneReference(sceneId, role) {
    setSaveState('Saving...');
    flushPendingSaves().then(function () { return request({
      operation: 'clear_scene_reference',
      storyId: storyState.story.id,
      sceneId: sceneId,
      role: role
    }); }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function uploadSceneReference(sceneId, role, file) {
    if (!storyState.story || !file) return;
    setSaveState('Adding reference...');
    flushPendingSaves().then(function () {
      var form = new FormData();
      form.append('storyId', storyState.story.id);
      form.append('sceneId', sceneId);
      form.append('role', role);
      form.append('file', file, file.name);
      return fetch('/fs/storyboard/reference_upload', { method: 'POST', body: form }).then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok || !body || !body.ok) {
            throw new Error((body && body.error) || 'Reference upload failed.');
          }
          return body;
        });
      });
    }).then(function (payload) {
      storyState.story = payload.story;
      renderStory();
      setSaveState('Saved');
    }).catch(reportError);
  }

  function generationRequest(payload, query) {
    var url = '/fs/storyboard/generation' + (query ? '?' + query : '');
    var options = payload
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      : {};
    return fetch(url, options).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error((body && body.error) || 'Storyboard generation request failed.');
        }
        return body;
      });
    });
  }

  function generationConsoleLabel(sceneId) {
    if (!storyState.story) return 'Storyboard';
    var order = Array.isArray(storyState.story.sceneOrder) ? storyState.story.sceneOrder : [];
    var scene = storyState.story.scenes && storyState.story.scenes[sceneId];
    var index = order.indexOf(sceneId);
    var label = index >= 0 ? 'Scene ' + String(index + 1).padStart(2, '0') : 'Scene';
    var title = String(scene && scene.title || '').trim();
    return title ? label + ' · ' + title : label;
  }

  function generationJobIsActive(job) {
    return !!job && ['backlog', 'queued', 'starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
  }

  function generationJobIsExecuting(job) {
    return !!job && ['starting', 'running', 'stopping'].indexOf(String(job.status || '')) !== -1;
  }

  function storyHasPendingGeneration(storyId) {
    storyId = String(storyId || '');
    return Object.keys(storyState.generationJobs).some(function (jobId) {
      var job = storyState.generationJobs[jobId];
      return job
        && String(job.storyId || '') === storyId
        && generationJobIsActive(job);
    });
  }

  function syncPlanReplacementControls() {
    if (!storyState.story) return;
    var storyId = String(storyState.story.id || '');
    var generationBlocked = storyHasPendingGeneration(storyId);
    var queuedFirstCut = !!queuedFirstCutForStory(storyId);
    var developBlocked = generationBlocked || directorTargetBlocked({ kind: 'scenes', storyId: storyId });
    var firstCutBlocked = generationBlocked || directorTargetBlocked({ kind: 'story-action', storyId: storyId });
    var developButton = el('storyboard-develop-btn');
    var firstCutButton = el('storyboard-first-cut-btn');

    if (developButton) {
      developButton.disabled = developBlocked;
      developButton.title = generationBlocked
        ? 'Wait for or cancel this Story\'s pending Take generation before replacing its Scene plan.'
        : '';
    }
    if (firstCutButton) {
      if (!firstCutButton.dataset.defaultTitle) {
        firstCutButton.dataset.defaultTitle = firstCutButton.title || '';
      }
      firstCutButton.disabled = firstCutBlocked;
      firstCutButton.title = generationBlocked
        ? 'Wait for or cancel this Story\'s pending Take generation before starting First Cut.'
        : firstCutButton.dataset.defaultTitle;
    }

    document.querySelectorAll('#storyboard-generate-scenes-btn, #storyboard-scenes-list [data-scene-generate]').forEach(function (control) {
      if (queuedFirstCut) {
        if (!control.disabled) {
          control.disabled = true;
          control.dataset.firstCutQueuedDisabled = '1';
        }
        control.title = 'Remove this Story from the First Cut queue before adding new Take generation.';
      } else if (control.dataset.firstCutQueuedDisabled === '1') {
        delete control.dataset.firstCutQueuedDisabled;
        var activeFirstCut = storyState.storyAction
          && storyState.storyAction.active
          && String(storyState.storyAction.storyId || '') === storyId;
        if (activeFirstCut) {
          control.disabled = true;
          control.dataset.storyActionDisabled = '1';
        } else {
          control.disabled = false;
        }
        if (control.matches('[data-scene-generate]')) {
          control.title = 'Queue a new Take from the current saved Scene.';
        } else {
          control.removeAttribute('title');
        }
      }
    });
  }

  function storyboardInferenceJob(job) {
    if (!job || String(job.client || '') !== 'storyboard') return null;
    return {
      jobId: String(job.jobId || ''),
      storyId: String(job.storyId || ''),
      sceneId: String(job.sceneId || ''),
      status: String(job.status || ''),
      queuedAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.finishedAt,
      queuePosition: Number(job.queuePosition || 0),
      comfyJobId: String(job.providerJobId || ''),
      comfyStatus: String(job.providerStatus || ''),
      progress: job.progress && typeof job.progress === 'object' ? job.progress : {},
      takeId: job.result && job.result.takeId,
      requestedAction: String(job.requestedAction || ''),
      error: String(job.error || '')
    };
  }

  function syncStoryboardInferenceSnapshot(queue) {
    if (!storyState.story || !queue || !Array.isArray(queue.jobs)) return;
    var storyId = String(storyState.story.id || '');
    var seenJobIds = Object.create(null);
    queue.jobs.forEach(function (rawJob) {
      if (String(rawJob.client || '') !== 'storyboard' || String(rawJob.storyId || '') !== storyId) return;
      var job = storyboardInferenceJob(rawJob);
      if (!job || !job.jobId) return;
      seenJobIds[job.jobId] = true;
      var previousJob = storyState.generationJobs[job.jobId] || null;
      var changed = !previousJob ||
        String(previousJob.status || '') !== String(job.status || '') ||
        String(previousJob.comfyStatus || '') !== String(job.comfyStatus || '') ||
        JSON.stringify(previousJob.progress || {}) !== JSON.stringify(job.progress || {}) ||
        Number(previousJob.queuePosition || 0) !== Number(job.queuePosition || 0);
      storyState.generationJobs[job.jobId] = job;
      reportGenerationStatus(job.sceneId, job, previousJob);
      if (changed) syncSceneTakeDom(job.sceneId);
    });

    Object.keys(storyState.generationJobs).forEach(function (jobId) {
      var cachedJob = storyState.generationJobs[jobId];
      if (!cachedJob || String(cachedJob.storyId || '') !== storyId || !generationJobIsActive(cachedJob) || seenJobIds[jobId]) return;
      // The shared snapshot contains active queue work only. Missing means the job
      // may have just become terminal, so reconcile its one-shot receipt.
      reconcileGenerationReceipt(storyId, jobId);
    });

    syncStoryboardGenerationActivity();
    syncPlanReplacementControls();
  }

  function generationJobsForScene(sceneId) {
    return Object.keys(storyState.generationJobs).map(function (jobId) {
      return storyState.generationJobs[jobId];
    }).filter(function (job) {
      return job && job.sceneId === sceneId && generationJobIsActive(job);
    }).sort(function (a, b) {
      return Number(a.queuedAt || 0) - Number(b.queuedAt || 0);
    });
  }

  function syncStoryboardGenerationActivity() {
    var running = Object.keys(storyState.generationJobs).some(function (jobId) {
      var status = String(storyState.generationJobs[jobId] && storyState.generationJobs[jobId].status || '');
      return status === 'starting' || status === 'running' || status === 'stopping';
    });
    setShellGeneratingActive(running);
    if (storyState.story) {
      (storyState.story.sceneOrder || []).forEach(syncSceneProgressionCard);
    }
    renderStoryReadiness();
  }

  function reportGenerationStatus(sceneId, job, previousJob) {
    if (!job) return;
    var currentKey = String(job.status || '') + '|' + String(job.comfyStatus || '');
    var previousKey = previousJob
      ? String(previousJob.status || '') + '|' + String(previousJob.comfyStatus || '')
      : '';
    if (currentKey === previousKey) return;
    if (job.status === 'backlog') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation added to backlog.');
    } else if (job.status === 'queued') {
      var queuePosition = Number(job.queuePosition || 0);
      reportConsoleInfo(
        generationConsoleLabel(sceneId),
        'Take generation queued' + (queuePosition ? ' · #' + queuePosition : '') + '.'
      );
    } else if (job.status === 'starting') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation starting.');
    } else if (job.status === 'running') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'ComfyUI · ' + String(job.comfyStatus || 'starting'));
    } else if (job.status === 'stopping') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation stopping.');
    } else if (job.status === 'completed') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation completed.');
    } else if (job.status === 'stopped' || job.status === 'cancelled') {
      reportConsoleInfo(generationConsoleLabel(sceneId), 'Take generation ' + job.status + '.');
    }
  }


  function sceneTakeCardById(grid, takeId) {
    return Array.prototype.find.call(grid.querySelectorAll('[data-take-id]'), function (card) {
      return card.dataset.takeId === takeId;
    }) || null;
  }

  function sceneGenerationCardById(grid, jobId) {
    return Array.prototype.find.call(grid.querySelectorAll('[data-generation-job-id]'), function (card) {
      return card.dataset.generationJobId === jobId;
    }) || null;
  }

  function syncSceneTakeDom(sceneId) {
    if (!storyState.story || !storyState.story.scenes) return;
    var root = sceneElement(sceneId);
    if (!root) return;
    var grid = root.querySelector('.storyboard-takes-grid');
    if (!grid) throw new Error('Storyboard Takes grid is missing.');

    var scene = storyState.story.scenes[sceneId] || {};
    var takes = scene.takes && typeof scene.takes === 'object' ? scene.takes : {};
    var takeOrder = Array.isArray(scene.takeOrder) ? scene.takeOrder : [];
    var jobs = generationJobsForScene(sceneId);
    var activeJobIds = {};
    var hadNoTakeActivity = !grid.querySelector('[data-take-id], [data-generation-job-id]');
    var empty = grid.querySelector('.storyboard-takes-empty');
    if ((takeOrder.length || jobs.length) && empty) empty.remove();

    takeOrder.forEach(function (takeId, takeIndex) {
      var take = takes[takeId];
      if (!take || sceneTakeCardById(grid, takeId)) return;
      var pending = grid.querySelector('[data-generation-job-id]');
      var html = takeCardHtml(storyState.story.id, sceneId, takeId, take, takeIndex, scene.selectedTakeId);
      if (pending) pending.insertAdjacentHTML('beforebegin', html);
      else grid.insertAdjacentHTML('beforeend', html);
    });

    jobs.forEach(function (job, pendingIndex) {
      activeJobIds[job.jobId] = true;
      var card = sceneGenerationCardById(grid, job.jobId);
      if (!card) {
        grid.insertAdjacentHTML('beforeend', pendingTakeCardHtml(job, takeOrder.length + pendingIndex));
        card = sceneGenerationCardById(grid, job.jobId);
      }
      syncGenerationJobCard(job, card);
    });

    Array.prototype.forEach.call(grid.querySelectorAll('[data-generation-job-id]'), function (card) {
      if (!activeJobIds[card.dataset.generationJobId]) card.remove();
    });

    if (!grid.querySelector('[data-take-id], [data-generation-job-id]') && !grid.querySelector('.storyboard-takes-empty')) {
      grid.insertAdjacentHTML('beforeend', '<div class="storyboard-takes-empty">No Takes yet.</div>');
    }

    if (hadNoTakeActivity && (takeOrder.length || jobs.length)) {
      var takesDetails = root.querySelector('.storyboard-takes');
      if (!takesDetails) throw new Error('Storyboard Takes disclosure is missing.');
      takesDetails.open = true;
    }

    var generateButton = root.querySelector('[data-scene-generate]');
    if (generateButton) generateButton.textContent = (takeOrder.length || jobs.length) ? 'Generate Another Take' : 'Generate Take';
  }

  function mergeFetchedSceneTakeState(storyId, sceneId, latestStory) {
    if (!storyState.story || storyState.story.id !== storyId || !latestStory || latestStory.id !== storyId) return;
    var currentScene = storyState.story.scenes && storyState.story.scenes[sceneId];
    var latestScene = latestStory.scenes && latestStory.scenes[sceneId];
    if (!currentScene || !latestScene) return;
    currentScene.takes = latestScene.takes && typeof latestScene.takes === 'object' ? latestScene.takes : {};
    currentScene.removedTakes = latestScene.removedTakes && typeof latestScene.removedTakes === 'object' ? latestScene.removedTakes : {};
    currentScene.takeOrder = Array.isArray(latestScene.takeOrder) ? latestScene.takeOrder : [];
    currentScene.selectedTakeId = latestScene.selectedTakeId || null;
    currentScene.updatedAt = latestScene.updatedAt || currentScene.updatedAt;
    storyState.story.updatedAt = latestStory.updatedAt || storyState.story.updatedAt;
    syncSceneTakeDom(sceneId);
  }

  function syncGenerationJobCard(job, card) {
    if (!job) return;
    if (!card) {
      var root = sceneElement(job.sceneId);
      var grid = root && root.querySelector('.storyboard-takes-grid');
      card = grid && sceneGenerationCardById(grid, String(job.jobId || ''));
    }
    if (!card) return;
    var status = String(job.status || '');
    var statusText = generationJobStatusText(job);
    var mediaStatus = card.querySelector('.storyboard-take-pending-media strong');
    var mediaDetail = card.querySelector('.storyboard-take-pending-detail');
    var footerStatus = card.querySelector('.storyboard-take-identity span');
    if (mediaStatus) mediaStatus.textContent = generationJobPreviewPrimary(job);
    if (mediaDetail) mediaDetail.textContent = generationJobPreviewDetail(job);
    if (footerStatus) footerStatus.textContent = statusText;

    var actionHost = card.querySelector('.storyboard-take-pending-footer');
    var action = card.querySelector('[data-generation-action]');
    var wantedAction = (status === 'backlog' || status === 'queued')
      ? 'cancel'
      : ((status === 'starting' || status === 'running') ? 'stop' : '');
    if (!wantedAction) {
      if (action) action.remove();
      return;
    }
    if (!action || action.dataset.generationAction !== wantedAction) {
      if (action) action.remove();
      action = document.createElement('button');
      action.type = 'button';
      action.className = 'review-captions-btn';
      action.dataset.generationAction = wantedAction;
      action.dataset.jobId = String(job.jobId || '');
      action.textContent = wantedAction === 'cancel' ? 'Cancel' : 'Stop';
      actionHost.appendChild(action);
    }
  }

  function clearGenerationReceipt(jobId) {
    delete storyState.generationReceipts[jobId];
  }

  function reconcileGenerationReceipt(storyId, jobId) {
    if (storyState.generationReceipts[jobId]) return storyState.generationReceipts[jobId];

    var pending = generationRequest(null, 'job=' + encodeURIComponent(jobId) + '&consume=1').then(function (payload) {
      var job = payload.job;
      var previousJob = storyState.generationJobs[jobId] || null;
      storyState.generationJobs[jobId] = job;
      reportGenerationStatus(job.sceneId, job, previousJob);
      syncStoryboardGenerationActivity();

      if (generationJobIsActive(job)) {
        if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
        return job;
      }

      delete storyState.generationJobs[jobId];
      syncStoryboardGenerationActivity();

      if (job.status === 'failed') {
        if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
        throw new Error(job.error || 'Storyboard generation failed.');
      }

      if (job.status === 'stopped' || job.status === 'cancelled') {
        if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(job.sceneId);
        return job;
      }

      if (job.status === 'completed') {
        if (!storyState.story || storyState.story.id !== storyId) {
          return refreshLibrary();
        }
        return request(null, 'story=' + encodeURIComponent(storyId)).then(function (storyPayload) {
          mergeFetchedSceneTakeState(storyId, job.sceneId, storyPayload.story);
          markSceneNewTake(job.sceneId);
          setSaveState('Saved');
          return job;
        });
      }

      throw new Error('Storyboard generation returned unknown status: ' + String(job.status || 'empty'));
    }).catch(function (err) {
      reportError(err);
    }).then(function (result) {
      clearGenerationReceipt(jobId);
      return result;
    });

    storyState.generationReceipts[jobId] = pending;
    return pending;
  }

  function refreshGenerationQueue(storyId) {
    storyId = String(storyId || '');
    Object.keys(storyState.generationJobs).forEach(function (jobId) {
      var cachedJob = storyState.generationJobs[jobId];
      if (cachedJob && String(cachedJob.storyId || '') === storyId) return;
      clearGenerationReceipt(jobId);
      delete storyState.generationJobs[jobId];
    });
    if (!storyId) {
      syncStoryboardGenerationActivity();
      return Promise.resolve();
    }
    return generationRequest(null, 'story=' + encodeURIComponent(storyId)).then(function (payload) {
      if (!storyState.story || String(storyState.story.id || '') !== storyId) {
        return payload.queue;
      }
      var jobs = payload.queue && Array.isArray(payload.queue.jobs) ? payload.queue.jobs : [];
      var seenJobIds = Object.create(null);
      jobs.forEach(function (job) {
        seenJobIds[job.jobId] = true;
        storyState.generationJobs[job.jobId] = job;
      });
      Object.keys(storyState.generationJobs).forEach(function (jobId) {
        var cachedJob = storyState.generationJobs[jobId];
        if (!cachedJob || String(cachedJob.storyId || '') !== storyId || !generationJobIsActive(cachedJob) || seenJobIds[jobId]) return;
        reconcileGenerationReceipt(storyId, jobId);
      });
      syncStoryboardGenerationActivity();
      syncPlanReplacementControls();
      return payload.queue;
    });
  }

  function generationAction(operation, jobId) {
    return generationRequest({ operation: operation, jobId: jobId }).then(function (payload) {
      if (payload.job) {
        storyState.generationJobs[payload.job.jobId] = payload.job;
        reportGenerationStatus(payload.job.sceneId, payload.job, null);
        if (!generationJobIsActive(payload.job)) delete storyState.generationJobs[payload.job.jobId];
        syncSceneTakeDom(payload.job.sceneId);
      }
      syncStoryboardGenerationActivity();
      syncPlanReplacementControls();
      return payload;
    }).catch(reportError);
  }

  function enqueueSceneGeneration(storyId, sceneId) {
    return generationRequest({
      storyId: storyId,
      sceneId: sceneId
    }).then(function (payload) {
      var job = payload.job;
      var previousJob = storyState.generationJobs[job.jobId] || null;
      storyState.generationJobs[job.jobId] = job;
      reportGenerationStatus(sceneId, job, previousJob);
      syncStoryboardGenerationActivity();
      syncPlanReplacementControls();
      if (storyState.story && storyState.story.id === storyId) syncSceneTakeDom(sceneId);
      return window.refreshInferenceQueue().then(function () {
        return job;
      });
    });
  }

  function generateScene(sceneId) {
    if (!storyState.story) return;
    setSaveState('Saving...');
    var storyId = storyState.story.id;
    flushPendingSaves().then(function () {
      return enqueueSceneGeneration(storyId, sceneId);
    }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function generateScenes() {
    if (!storyState.story) return;
    var storyId = storyState.story.id;
    var sceneIds = Array.isArray(storyState.story.sceneOrder)
      ? storyState.story.sceneOrder.slice()
      : [];
    setSaveState('Saving...');
    flushPendingSaves().then(function () {
      return sceneIds.reduce(function (promise, sceneId) {
        return promise.then(function () {
          return enqueueSceneGeneration(storyId, sceneId).catch(reportError);
        });
      }, Promise.resolve());
    }).then(function () {
      setSaveState('Saved');
    }).catch(reportError);
  }

  function handleSceneInput(event) {
    var correction = event.target.closest('[data-director-correction]');
    if (correction) {
      var correctionScene = correction.closest('.storyboard-scene[data-scene-id]');
      if (!correctionScene) return;
      var correctionSceneId = correctionScene.dataset.sceneId;
      var currentScene = storyState.story && storyState.story.scenes
        ? storyState.story.scenes[correctionSceneId]
        : null;
      if (currentScene && currentScene.refineComplete) {
        currentScene.refineComplete = false;
        syncSceneRefineState(correctionSceneId);
        scheduleSceneSave(correctionSceneId);
      } else {
        syncSceneRefineState(correctionSceneId);
      }
      return;
    }

    var field = event.target.closest('[data-scene-field]');
    if (!field) return;
    var scene = field.closest('.storyboard-scene[data-scene-id]');
    if (!scene) return;
    var sceneId = scene.dataset.sceneId;
    if (field.dataset.sceneField === 'title') {
      var progressCard = document.querySelector('.storyboard-scene-progress-card[data-scene-id="' + CSS.escape(sceneId) + '"]');
      var progressTitle = progressCard && progressCard.querySelector('[data-scene-progress-title]');
      if (!progressTitle) throw new Error('Storyboard Scene progression title is missing.');
      progressTitle.textContent = field.value.trim() || 'Untitled Scene';
    }
    if (field.dataset.sceneField === 'prompt') {
      var promptScene = storyState.story && storyState.story.scenes
        ? storyState.story.scenes[sceneId]
        : null;
      if (promptScene && promptScene.refineComplete) {
        promptScene.refineComplete = false;
        syncSceneRefineState(sceneId);
      }
    }
    scheduleSceneSave(sceneId);
  }

  function handleSceneAction(event) {
    var button = event.target.closest('[data-scene-action]');
    if (!button) return;
    var scene = button.closest('[data-scene-id]');
    if (!scene) throw new Error('Storyboard Scene action target is missing.');
    var sceneId = scene.dataset.sceneId;
    var action = button.dataset.sceneAction;
    if (action === 'up') reorderScene(sceneId, -1);
    else if (action === 'down') reorderScene(sceneId, 1);
    else if (action === 'duplicate') duplicateScene(sceneId);
    else if (action === 'insert-director') insertDirectorSceneAfter(sceneId);
    else if (action === 'delete') deleteScene(sceneId);
  }

  function closeStoryboardActivity() {
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (workspace) workspace.classList.add('hidden');
    if (frame) frame.classList.remove('workspace-storyboard-open');
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    if (typeof window.refreshAssistantModes === 'function') window.refreshAssistantModes();
  }

  function openStoryboardActivity(target) {
    target = target && typeof target === 'object' ? target : {};
    var targetStoryId = String(target.storyId || '');
    var targetSceneId = String(target.sceneId || '');
    if (typeof window.closeGenerateActivity === 'function') window.closeGenerateActivity();
    var frame = el('app-frame');
    var workspace = el('storyboard-workspace');
    if (!frame || !workspace) throw new Error('Storyboard workspace markup is missing.');
    if (typeof window.closeTestBenchActivity === 'function') window.closeTestBenchActivity();
    storyState.director.modelId = getDirectorModelPreference('webcap.storyboard.directorModel');
    frame.classList.add('workspace-storyboard-open');
    workspace.classList.remove('hidden');
    if (typeof window.refreshAssistantModes === 'function') window.refreshAssistantModes();
    if (typeof window.syncApplicationShellContext === 'function') window.syncApplicationShellContext();
    if (typeof window.syncShellLocationRoute === 'function') window.syncShellLocationRoute();
    refreshDirector();
    refreshGenerationCapabilities();
    refreshLibrary().then(function () {
      return reconcileDirectorJobs();
    }).then(function () {
      if (targetStoryId) return openStory(targetStoryId);
      if (storyState.story) {
        return refreshGenerationQueue(storyState.story.id).then(function () {
          renderStory();
        });
      }
      var first = storyState.stories && storyState.stories[0];
      if (first) return openStory(first.id);
      renderStory();
      return null;
    }).then(function () {
      if (!targetSceneId || !storyState.story || String(storyState.story.id || '') !== targetStoryId) return;
      if (!storyState.story.scenes || !storyState.story.scenes[targetSceneId]) {
        throw new Error('Storyboard activity Scene no longer exists: ' + targetSceneId);
      }
      return setSceneViewMode('focus', targetSceneId);
    }).catch(reportError);
  }

  function bindUi() {
    var workspace = el('storyboard-workspace');
    if (!workspace) throw new Error('Storyboard workspace markup is missing.');

    initStorySections();
    setStoryLibraryCompact(storyState.storyLibraryCompact);

    el('storyboard-library-compact-toggle').onclick = function () {
      setStoryLibraryCompact(!storyState.storyLibraryCompact);
      this.blur();
    };
    el('storyboard-new-btn').onclick = createStory;
    el('storyboard-story-toggle').onclick = function () { setStoryCollapsed(!storyState.storyCollapsed); };
    el('storyboard-scenes-overview-btn').onclick = function () { setSceneViewMode('overview'); };
    el('storyboard-scenes-focus-btn').onclick = function () { setSceneViewMode('focus'); };
    el('storyboard-scenes-sequence-btn').onclick = function () { setSceneViewMode('sequence'); };
    el('storyboard-generate-scenes-btn').onclick = generateScenes;
    el('storyboard-assistant-btn').onclick = function () {
      var hasScenes = !!(storyState.story && Array.isArray(storyState.story.sceneOrder) && storyState.story.sceneOrder.length);
      if (typeof window.openAssistant === 'function') {
        window.openAssistant({ mode: hasScenes ? 'revise-scenes' : 'chat' });
      }
    };
    el('storyboard-expand-concept-btn').onclick = expandConcept;
    el('storyboard-restore-concept-btn').onclick = restorePreviousConcept;
    el('storyboard-develop-btn').onclick = developStory;
    el('storyboard-scene-count-auto').onclick = function () {
      var input = el('storyboard-story-target-scenes');
      var nextAuto = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', nextAuto ? 'true' : 'false');
      this.classList.toggle('active', nextAuto);
      input.disabled = nextAuto;
      if (!nextAuto && !input.value) input.value = '12';
      scheduleStorySave();
    };
    var sceneWorkspace = document.querySelector('.storyboard-scene-workspace');
    if (sceneWorkspace) {
      sceneWorkspace.addEventListener('scroll', function () {
        if (directorActivityActive()) positionDirectorActivity();
      }, { passive: true });
    }

    window.addEventListener('webcap:inference-queue-snapshot', function (event) {
      syncStoryboardInferenceSnapshot(event && event.detail && event.detail.queue);
    });
    if (typeof window.getInferenceQueueSnapshot === 'function') {
      syncStoryboardInferenceSnapshot(window.getInferenceQueueSnapshot());
    }

    var sceneProgression = el('storyboard-scene-progression');
    sceneProgression.addEventListener('click', function (event) {
      var menuSummary = event.target.closest('.storyboard-scene-progress-menu > summary');
      if (menuSummary) {
        var sceneMenu = menuSummary.closest('.storyboard-scene-menu');
        window.setTimeout(function () {
          if (!sceneMenu.open) return;
          closeSceneActionMenus(sceneMenu);
          positionSceneActionMenu(sceneMenu);
        }, 0);
        return;
      }
      var actionButton = event.target.closest('[data-scene-action]');
      if (actionButton) {
        var menu = actionButton.closest('details');
        if (menu) menu.open = false;
        handleSceneAction(event);
        return;
      }
      var sceneButton = event.target.closest('[data-scene-progress]');
      if (sceneButton) {
        setSceneViewMode('focus', sceneButton.dataset.sceneProgress);
        return;
      }
      if (event.target.closest('[data-scene-progress-add]')) addScene();
    });
    sceneProgression.addEventListener('scroll', function () {
      closeSceneActionMenus();
    }, { passive: true });
    el('storyboard-director-stop').onclick = function () {
      stopDirectorJob();
    };
    el('storyboard-director-prompt-copy').onclick = function () {
      var button = this;
      var jobId = String(button.dataset.directorJobId || '');
      var requestDiagnostic = storyState.director.requestByJobId[jobId];
      copyDirectorRequestDiagnostic(requestDiagnostic).then(function () {
        var original = directorRequestDiagnosticLabel(requestDiagnostic);
        button.textContent = 'Copied';
        window.setTimeout(function () {
          if (storyState.director.requestByJobId[jobId]) button.textContent = original;
        }, 1200);
      }).catch(reportError);
    };
    el('storyboard-story-action-cancel').onclick = cancelStoryAction;
    el('storyboard-first-cut-btn').onclick = startFirstCut;

    el('storyboard-director-model').addEventListener('change', function () {
      storyState.director.modelId = this.value;
      setDirectorModelPreference('webcap.storyboard.directorModel', this.value);
    });
    window.addEventListener('webcap:director-model-changed', function (event) {
      var selected = String(event && event.detail && event.detail.modelId || '');
      if (!selected || selected === storyState.director.modelId) return;
      storyState.director.modelId = selected;
      var modelSelect = el('storyboard-director-model');
      if (modelSelect && Array.prototype.some.call(modelSelect.options, function (option) { return option.value === selected; })) {
        modelSelect.value = selected;
      }
    });
    el('storyboard-director-refresh').onclick = function () {
      var button = this;
      button.disabled = true;
      refreshDirector().then(function () {
        button.disabled = false;
      });
    };

    el('storyboard-sequence-preview').addEventListener('click', function (event) {
      if (event.target.closest('[data-sequence-export]')) {
        exportSelectedSequence(false);
        return;
      }
      if (event.target.closest('[data-sequence-encode]')) {
        exportSelectedSequence(true);
        return;
      }
      if (event.target.closest('[data-sequence-warnings]')) {
        storyState.sequenceWarningsVisible = !storyState.sequenceWarningsVisible;
        renderSequencePreview();
        return;
      }
      if (event.target.closest('[data-sequence-toggle]')) {
        storyState.sequenceCollapsed = !storyState.sequenceCollapsed;
        window.localStorage.setItem('webcap.storyboard.sequenceCollapsed', storyState.sequenceCollapsed ? '1' : '0');
        renderSequencePreview();
      }
    });

    var storyLibraryList = el('storyboard-library-list');
    storyLibraryList.onclick = function (event) {
      var row = event.target.closest('[data-story-id]');
      if (!row) return;
      var storyId = row.dataset.storyId;
      var menuSummary = event.target.closest('.storyboard-story-menu > summary');
      if (menuSummary) {
        var storyMenu = menuSummary.closest('.storyboard-story-menu');
        window.setTimeout(function () {
          if (!storyMenu.open) return;
          closeStoryActionMenus(storyMenu);
          positionStoryActionMenu(storyMenu);
        }, 0);
        return;
      }
      var actionButton = event.target.closest('[data-story-action]');
      if (actionButton) {
        var story = libraryStory(storyId);
        var action = actionButton.dataset.storyAction;
        var menu = actionButton.closest('details');
        if (menu) menu.open = false;
        if (action === 'duplicate') duplicateStory(storyId);
        else if (action === 'pin') toggleStoryPin(storyId);
        else if (action === 'archive') toggleStoryArchive(storyId);
        else if (action === 'export') exportStory(storyId);
        else if (action === 'delete') deleteStory(storyId, story && story.title);
        return;
      }
      if (event.target.closest('[data-story-open]')) openStory(storyId);
    };
    storyLibraryList.addEventListener('scroll', function () {
      closeStoryActionMenus();
    });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('.storyboard-story-menu')) closeStoryActionMenus();
      if (!event.target.closest('.storyboard-scene-menu')) closeSceneActionMenus();
    });
    window.addEventListener('resize', function () {
      closeStoryActionMenus();
      closeSceneActionMenus();
      if (directorActivityActive()) positionDirectorActivity();
    });
    workspace.addEventListener('scroll', function () {
      if (directorActivityActive()) positionDirectorActivity();
    }, true);

    ['storyboard-story-title', 'storyboard-story-concept', 'storyboard-story-target-scenes'].forEach(function (id) {
      el(id).addEventListener('input', scheduleStorySave);
    });
    el('storyboard-story-style').addEventListener('input', function () {
      renderStoryStylePresetSelector();
      scheduleStorySave();
    });
    el('storyboard-story-style-preset').addEventListener('change', function () {
      if (this.value) applyStoryStylePreset(this.value);
    });
    el('storyboard-story-megapixels').addEventListener('input', function () {
      syncSceneGenerationDefaultHints();
      scheduleStorySave();
    });
    el('storyboard-story-aspect-ratio').addEventListener('change', function () {
      syncSceneGenerationDefaultHints();
      scheduleStorySave();
    });
    el('storyboard-invariants-list').addEventListener('input', scheduleStorySave);
    el('storyboard-invariants-list').addEventListener('change', scheduleStorySave);
    document.querySelector('.storyboard-continuity-summary .storyboard-invariants-actions').addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    el('storyboard-invariant-define').addEventListener('click', defineInvariants);
    el('storyboard-invariant-add').addEventListener('click', function () {
      var continuitySection = document.querySelector('[data-story-section="continuity"]');
      if (continuitySection) continuitySection.open = true;
      el('storyboard-invariants-list').insertAdjacentHTML('beforeend', invariantRowHtml({ kind: 'character', title: '', text: '' }, true));
    });
    el('storyboard-invariants-list').addEventListener('click', function (event) {
      var toggle = event.target.closest('[data-story-invariant-toggle]');
      if (toggle) {
        var toggleRow = toggle.closest('[data-story-invariant-row]');
        if (!toggleRow) throw new Error('Story invariant row is missing.');
        setInvariantRowOpen(toggleRow, !toggleRow.classList.contains('is-open'));
        return;
      }
      var remove = event.target.closest('[data-story-invariant-remove]');
      if (!remove) return;
      var row = remove.closest('[data-story-invariant-row]');
      if (!row) throw new Error('Story invariant row is missing.');
      row.remove();
      scheduleStorySave();
    });
    el('storyboard-story-icon-trigger').addEventListener('click', function (event) {
      event.stopPropagation();
      var menu = el('storyboard-story-icon-menu');
      var opening = menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !opening);
      this.setAttribute('aria-expanded', opening ? 'true' : 'false');
      if (opening) renderStoryIconPicker();
    });
    el('storyboard-story-icon-menu').addEventListener('click', function (event) {
      var option = event.target.closest('[data-story-icon-option]');
      if (!option) return;
      setStoryIconSelection(option.dataset.storyIconOption || '');
    });
    document.addEventListener('click', function (event) {
      var picker = event.target.closest('.storyboard-icon-picker');
      if (picker) return;
      var menu = el('storyboard-story-icon-menu');
      var trigger = el('storyboard-story-icon-trigger');
      if (menu) menu.classList.add('hidden');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
    el('storyboard-story-status').addEventListener('change', scheduleStorySave);

    el('storyboard-story-lora-list').addEventListener('input', function (event) {
      if (!event.target.closest('[data-story-lora-row]')) return;
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });
    el('storyboard-story-lora-list').addEventListener('change', function (event) {
      if (!event.target.closest('[data-story-lora-row]')) return;
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });
    var storyLoraPicker = el('storyboard-story-lora-picker');
    storyLoraPicker.addEventListener('focus', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('click', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('input', function () { renderLoraPickerMenu(storyLoraPicker); });
    storyLoraPicker.addEventListener('keydown', handleLoraPickerKeydown);
    storyLoraPicker.closest('.storyboard-lora-picker-wrap').addEventListener('click', function (event) {
      var option = event.target.closest('[data-lora-picker-option]');
      if (option) chooseLoraPickerOption(storyLoraPicker, option.dataset.loraPickerOption);
    });

    el('storyboard-story-lora-list').addEventListener('click', function (event) {
      var remove = event.target.closest('[data-story-lora-remove]');
      if (!remove) return;
      var row = remove.closest('[data-story-lora-row]');
      if (!row) return;
      row.remove();
      syncStoryLorasIntoScenes();
      scheduleStorySave();
    });

    el('storyboard-scenes-list').addEventListener('focusin', function (event) {
      var focusedScene = event.target.closest('.storyboard-scene[data-scene-id]');
      if (focusedScene && storyState.story) {
        clearSceneDirectorCompletion(storyState.story.id, focusedScene.dataset.sceneId);
      }
      var inheritedMegapixels = event.target.closest('[data-scene-field="megapixels"]');
      if (inheritedMegapixels) seedInheritedSceneMegapixels(inheritedMegapixels);
      var picker = event.target.closest('[data-scene-lora-picker]');
      if (picker) renderLoraPickerMenu(picker);
    });
    el('storyboard-scenes-list').addEventListener('keydown', handleLoraPickerKeydown);
    el('storyboard-scenes-list').addEventListener('input', function (event) {
      var picker = event.target.closest('[data-scene-lora-picker]');
      if (picker) {
        renderLoraPickerMenu(picker);
        return;
      }
      var loraRow = event.target.closest('[data-scene-lora-row], [data-story-lora-inherited-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      handleSceneInput(event);
    });
    el('storyboard-scenes-list').addEventListener('dragover', function (event) {
      var dropzone = event.target.closest('[data-reference-dropzone]');
      if (!dropzone) return;
      event.preventDefault();
      dropzone.classList.add('is-dragover');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });
    el('storyboard-scenes-list').addEventListener('dragleave', function (event) {
      var dropzone = event.target.closest('[data-reference-dropzone]');
      if (!dropzone) return;
      if (!event.relatedTarget || !dropzone.contains(event.relatedTarget)) dropzone.classList.remove('is-dragover');
    });
    el('storyboard-scenes-list').addEventListener('drop', function (event) {
      var dropzone = event.target.closest('[data-reference-dropzone]');
      if (!dropzone) return;
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      var input = dropzone.querySelector('[data-reference-upload]');
      if (!input) throw new Error('Reference dropzone file input is missing.');
      var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
      if (!file) return;
      if (file.type && file.type.indexOf('image/') !== 0) {
        window.alert('Reference files must be images.');
        return;
      }
      var transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    el('storyboard-scenes-list').addEventListener('change', function (event) {
      var loraRow = event.target.closest('[data-scene-lora-row], [data-story-lora-inherited-row]');
      if (loraRow) {
        var loraScene = loraRow.closest('.storyboard-scene[data-scene-id]');
        if (!loraScene) throw new Error('LoRA Scene is missing.');
        scheduleSceneSave(loraScene.dataset.sceneId);
        return;
      }
      var referenceUpload = event.target.closest('[data-reference-upload]');
      if (referenceUpload) {
        var referenceUploadScene = referenceUpload.closest('.storyboard-scene[data-scene-id]');
        if (!referenceUploadScene) throw new Error('Reference upload Scene is missing.');
        var referenceRole = referenceUploadScene.querySelector('[data-reference-role]');
        uploadSceneReference(
          referenceUploadScene.dataset.sceneId,
          referenceRole ? referenceRole.value : 'first_frame',
          referenceUpload.files && referenceUpload.files[0]
        );
        return;
      }
      var upload = event.target.closest('[data-take-upload]');
      if (upload) {
        var uploadScene = upload.closest('.storyboard-scene[data-scene-id]');
        if (!uploadScene) throw new Error('Take upload Scene is missing.');
        uploadTake(uploadScene.dataset.sceneId, upload.files && upload.files[0]);
        return;
      }
      var takeLabel = event.target.closest('[data-take-label]');
      if (takeLabel) {
        var labelScene = takeLabel.closest('.storyboard-scene[data-scene-id]');
        if (!labelScene) throw new Error('Take label Scene is missing.');
        labelTake(labelScene.dataset.sceneId, takeLabel.dataset.takeLabel, takeLabel.value);
        return;
      }
      handleSceneInput(event);
    });
    workspace.addEventListener('click', function (event) {
      if (event.target.closest('.storyboard-lora-picker-wrap')) return;
      closeAllLoraPickers();
    });

    el('storyboard-scenes-list').addEventListener('click', function (event) {
      var openScene = event.target.closest('[data-scene-open]');
      if (openScene) {
        setSceneViewMode('focus', openScene.dataset.sceneOpen);
        return;
      }
      var pickerOption = event.target.closest('[data-lora-picker-option]');
      if (pickerOption) {
        var pickerWrap = pickerOption.closest('.storyboard-lora-picker-wrap');
        var optionPicker = pickerWrap && pickerWrap.querySelector('[data-scene-lora-picker]');
        if (!optionPicker) throw new Error('Scene LoRA picker is missing.');
        chooseLoraPickerOption(optionPicker, pickerOption.dataset.loraPickerOption);
        return;
      }
      var clickedPicker = event.target.closest('[data-scene-lora-picker]');
      if (clickedPicker) {
        renderLoraPickerMenu(clickedPicker);
        return;
      }
      var removeLora = event.target.closest('[data-scene-lora-remove]');
      if (removeLora) {
        var removeLoraScene = removeLora.closest('.storyboard-scene[data-scene-id]');
        if (!removeLoraScene) throw new Error('LoRA Scene is missing.');
        var removeRow = removeLora.closest('[data-scene-lora-row]');
        if (!removeRow) throw new Error('LoRA row is missing.');
        removeRow.remove();
        scheduleSceneSave(removeLoraScene.dataset.sceneId);
        return;
      }
      var directorPreview = event.target.closest('[data-director-preview]');
      if (directorPreview) {
        var previewScene = directorPreview.closest('.storyboard-scene[data-scene-id]');
        if (!previewScene) throw new Error('Director preview Scene is missing.');
        previewDirectorRequest(previewScene.dataset.sceneId, directorPreview.dataset.directorPreview);
        return;
      }
      var directorWrite = event.target.closest('[data-director-write]');
      if (directorWrite) {
        var writeScene = directorWrite.closest('.storyboard-scene[data-scene-id]');
        if (!writeScene) throw new Error('Director Scene is missing.');
        runDirector(writeScene.dataset.sceneId, 'write_prompt');
        return;
      }
      var directorRefine = event.target.closest('[data-director-refine]');
      if (directorRefine) {
        var refineScene = directorRefine.closest('.storyboard-scene[data-scene-id]');
        if (!refineScene) throw new Error('Director Scene is missing.');
        runDirector(refineScene.dataset.sceneId, 'refine_prompt');
        return;
      }
      var directorRestore = event.target.closest('[data-director-restore]');
      if (directorRestore) {
        var restorePromptScene = directorRestore.closest('.storyboard-scene[data-scene-id]');
        if (!restorePromptScene) throw new Error('Director Scene is missing.');
        restoreSceneDirectorPrompt(restorePromptScene.dataset.sceneId);
        return;
      }
      var generate = event.target.closest('[data-scene-generate]');
      if (generate) {
        var generateSceneRoot = generate.closest('.storyboard-scene[data-scene-id]');
        if (!generateSceneRoot) throw new Error('Generation Scene is missing.');
        generateScene(generateSceneRoot.dataset.sceneId);
        return;
      }
      var executionAction = event.target.closest('[data-generation-action]');
      if (executionAction) {
        generationAction(executionAction.dataset.generationAction, executionAction.dataset.jobId);
        return;
      }
      var takeRating = event.target.closest('[data-take-rating][data-rating-value]');
      if (takeRating) {
        var ratingScene = takeRating.closest('.storyboard-scene[data-scene-id]');
        if (!ratingScene) throw new Error('Take rating Scene is missing.');
        rateTake(ratingScene.dataset.sceneId, takeRating.dataset.takeRating, takeRating.dataset.ratingValue);
        return;
      }
      var takeAction = event.target.closest('[data-take-action]');
      if (takeAction) {
        var takeScene = takeAction.closest('.storyboard-scene[data-scene-id]');
        if (!takeScene) throw new Error('Take action Scene is missing.');
        if (takeAction.dataset.takeAction === 'select') selectTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'remove') removeTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'delete') deleteTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        else if (takeAction.dataset.takeAction === 'restore') restoreTake(takeScene.dataset.sceneId, takeAction.dataset.takeId);
        return;
      }
      var referenceClear = event.target.closest('[data-reference-clear]');
      if (referenceClear) {
        var clearScene = referenceClear.closest('.storyboard-scene[data-scene-id]');
        if (!clearScene) throw new Error('Reference Scene is missing.');
        clearSceneReference(clearScene.dataset.sceneId, referenceClear.dataset.referenceClear);
        return;
      }
      var previousReference = event.target.closest('[data-reference-previous]');
      if (previousReference) {
        var targetScene = previousReference.closest('.storyboard-scene[data-scene-id]');
        if (!targetScene) throw new Error('Reference Scene is missing.');
        var order = storyState.story.sceneOrder || [];
        var targetIndex = order.indexOf(targetScene.dataset.sceneId);
        if (targetIndex <= 0) throw new Error('Previous Scene is missing.');
        var sourceSceneId = order[targetIndex - 1];
        var sourceScene = storyState.story.scenes[sourceSceneId];
        if (!sourceScene || !sourceScene.selectedTakeId) throw new Error('Previous Scene has no selected Take.');
        setSceneReference(targetScene.dataset.sceneId, 'first_frame', sourceSceneId, sourceScene.selectedTakeId, 'last');
        return;
      }
      var referenceApply = event.target.closest('[data-reference-apply]');
      if (referenceApply) {
        var referenceScene = referenceApply.closest('.storyboard-scene[data-scene-id]');
        if (!referenceScene) throw new Error('Reference Scene is missing.');
        var role = referenceScene.querySelector('[data-reference-role]').value;
        var sourceValue = referenceScene.querySelector('[data-reference-source]').value;
        var frame = referenceScene.querySelector('[data-reference-frame]').value;
        if (!sourceValue || sourceValue.indexOf('|') < 0) {
          window.alert('Choose a Take to assign as a reference.');
          return;
        }
        var sourceParts = sourceValue.split('|');
        setSceneReference(referenceScene.dataset.sceneId, role, sourceParts[0], sourceParts[1], frame);
        return;
      }
      var restore = event.target.closest('[data-restore-scene]');
      if (restore) {
        restoreScene(restore.dataset.restoreScene);
        return;
      }
    });
  }

  window.openStoryboardActivity = openStoryboardActivity;
  window.closeStoryboardActivity = closeStoryboardActivity;

  if (typeof window.registerAssistantMode === 'function') {
    window.registerAssistantMode({
      id: 'revise-scenes',
      label: 'Revise Scenes',
      description: 'Apply a targeted revision across the current Story\'s Scene plan.',
      placeholder: 'What should be revised across these Scenes?',
      successMessage: 'Scene revisions completed.',
      presets: [{
        label: 'Continuity pass',
        title: 'Review every Scene for continuity and prompt completeness',
        instruction: DIRECTOR_PASS_PRESETS.continuity.instruction
      }],
      available: function () {
        var workspace = el('storyboard-workspace');
        return !!(
          workspace &&
          !workspace.classList.contains('hidden') &&
          storyState.story &&
          Array.isArray(storyState.story.sceneOrder) &&
          storyState.story.sceneOrder.length > 0 &&
          !directorTargetBlocked({ kind: 'repair', storyId: storyState.story.id })
        );
      },
      execute: function (request) {
        return reviseScenes(request && request.instruction, request && request.modelId);
      },
      cancel: function () {
        stopDirectorJob();
      }
    });
  }

  bindUi();
})();
