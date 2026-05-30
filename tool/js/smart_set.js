function smartSetBuildDefaultName(term, suggested) {
  var cleanTerm = String(term || '').trim();
  if (suggested && String(suggested).trim()) {
    return String(suggested).trim();
  }
  var slug = cleanTerm.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/(^[-._]+|[-._]+$)/g, '');
  if (!slug) slug = 'smart-set';
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return 'smart-' + slug + '-' + y + m + day;
}

function runSmartSetMaterializeFlow() {
  var termInput = prompt('Smart Set term (searches captions and item tags across subfolders):');
  if (termInput === null) {
    setStatus('Smart set cancelled.');
    return;
  }
  var term = String(termInput || '').trim();
  if (!term) {
    setStatus('Smart set cancelled: missing search term.');
    return;
  }

  setStatus('Searching subfolders for "' + term + '"...');
  HttpModule.postJson('/fs/smart_set_materialize', { term: term, dry_run: true }, function (status, responseText) {
    if (status !== 200) {
      setStatus(getErrorMessage(responseText, 'Smart set search failed'));
      return;
    }

    var data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      setStatus('Smart set search failed: invalid response.');
      return;
    }

    var count = Number(data.match_count || 0);
    if (!isFinite(count) || count <= 0) {
      setStatus('No matches found for "' + term + '".');
      return;
    }

    var defaultName = smartSetBuildDefaultName(term, data.suggested_set_name);
    var setNameInput = prompt(
      'Found ' + count + ' matches. New set folder name:',
      defaultName
    );
    if (setNameInput === null) {
      setStatus('Smart set cancelled.');
      return;
    }
    var setName = String(setNameInput || '').trim();
    if (!setName) {
      setStatus('Smart set cancelled: missing set folder name.');
      return;
    }

    setStatus('Materializing smart set "' + setName + '"...');
    HttpModule.postJson(
      '/fs/smart_set_materialize',
      { term: term, set_name: setName, dry_run: false },
      function (createStatus, createResponseText) {
        if (createStatus !== 200) {
          setStatus(getErrorMessage(createResponseText, 'Smart set materialization failed'));
          return;
        }
        var created;
        try {
          created = JSON.parse(createResponseText);
        } catch (e) {
          setStatus('Smart set materialization failed: invalid response.');
          return;
        }

        var createdFolder = String(created.folder || setName);
        var copiedCount = Number(created.copied_count || 0);
        var originalsCount = Number(created.originals_copied_count || 0);
        setStatus(
          'Smart set ready: ' + createdFolder + ' (' + copiedCount + ' files, ' + originalsCount + ' originals).'
        );
        state.folder = createdFolder;
        state.currentItem = null;
        clearEditorAndPreview();
        refreshCurrentDirectory();
      }
    );
  });
}

function buildSourceMediaRelPath(mediaKey) {
  var name = String(mediaKey || '').replace(/\\/g, '/').replace(/^\/+/, '');
  var folder = String(state.folder || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!folder) return name;
  return folder + '/' + name;
}

function normalizeRelativeFolderPath(pathValue) {
  var normalized = String(pathValue || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized;
}

function parseSetDestinationPresetsFromConfig(cfg) {
  var setDestinations = cfg && cfg.set_destinations;
  var presets = setDestinations && setDestinations.presets;
  if (!Array.isArray(presets)) return [];
  var out = [];
  for (var i = 0; i < presets.length; i++) {
    var raw = presets[i];
    var path = '';
    var label = '';
    if (typeof raw === 'string') {
      path = normalizeRelativeFolderPath(raw);
      label = String(raw || '').trim();
    } else if (raw && typeof raw === 'object') {
      path = normalizeRelativeFolderPath(raw.path || raw.folder || raw.value || '');
      label = String(raw.label || raw.name || raw.path || '').trim();
    }
    if (!path && label === '/') path = '/';
    if (!path && label !== '/') continue;
    var normalizedPath = path || '/';
    if (!label) label = normalizedPath;
    out.push({
      label: label,
      path: normalizedPath
    });
  }
  return out;
}

function fetchAppConfigForCreateSet(callback) {
  HttpModule.get('/app/config', function (status, responseText) {
    if (status !== 200) {
      callback(null);
      return;
    }
    try {
      callback(JSON.parse(responseText));
    } catch (e) {
      callback(null);
    }
  });
}

function checkDestinationFolderExists(relPath, callback) {
  var normalized = normalizeRelativeFolderPath(relPath);
  var pathForApi = normalized || '';
  HttpModule.get('/fs/path_exists?path=' + encodeURIComponent(pathForApi), function (status, responseText) {
    if (status !== 200) {
      callback(false);
      return;
    }
    try {
      var data = JSON.parse(responseText);
      callback(!!(data && data.ok && data.exists && data.is_dir));
    } catch (e) {
      callback(false);
    }
  });
}

function filterExistingPresetDestinations(presets, callback) {
  if (!Array.isArray(presets) || !presets.length) {
    callback([]);
    return;
  }
  var pending = presets.length;
  var kept = [];
  presets.forEach(function (preset) {
    checkDestinationFolderExists(preset.path, function (exists) {
      if (exists) kept.push(preset);
      pending -= 1;
      if (pending === 0) callback(kept);
    });
  });
}

function buildCreateSetLocationOptions(currentFolder, presetDestinations) {
  var normalizedCurrent = normalizeRelativeFolderPath(currentFolder);
  var siblingParent = normalizedCurrent.indexOf('/') !== -1
    ? normalizedCurrent.slice(0, normalizedCurrent.lastIndexOf('/'))
    : '';
  var siblingPath = siblingParent || '/';
  var rootPath = '/';
  var options = [];
  var seen = {};

  function addOption(label, pathValue) {
    var normalizedPath = normalizeRelativeFolderPath(pathValue) || '/';
    var dedupeKey = normalizedPath.toLowerCase();
    if (seen[dedupeKey]) return;
    seen[dedupeKey] = true;
    options.push({ label: label, path: normalizedPath });
  }

  addOption('Sibling of Current Set (' + siblingPath + ')', siblingPath);
  addOption('Root (/)', rootPath);

  (presetDestinations || []).forEach(function (preset) {
    addOption('Preset: ' + preset.label + ' (' + preset.path + ')', preset.path);
  });

  return options;
}

function promptForDestinationOption(locationOptions) {
  if (!Array.isArray(locationOptions) || !locationOptions.length) return null;
  var lines = ['Where should the new set go?'];
  for (var i = 0; i < locationOptions.length; i++) {
    lines.push((i + 1) + ') ' + locationOptions[i].label);
  }
  lines.push('');
  lines.push('Enter 1-' + locationOptions.length + ':');
  var choiceInput = prompt(lines.join('\n'), '1');
  if (choiceInput === null) return null;
  var n = Number(String(choiceInput || '').trim());
  if (!isFinite(n)) return undefined;
  var idx = Math.floor(n) - 1;
  if (idx < 0 || idx >= locationOptions.length) return undefined;
  return locationOptions[idx];
}

function runCreateSetFromResultsFlow() {
  var visibleRows = Array.prototype.slice.call(
    ui.mediaListEl ? ui.mediaListEl.querySelectorAll('.media-item[data-type="media"]') : []
  );
  var visibleKeys = visibleRows
    .map(function (row) { return String(row.getAttribute('data-key') || '').trim(); })
    .filter(Boolean);
  if (!visibleKeys.length) {
    setStatus('No visible media items to copy.');
    return;
  }

  setStatus('Loading destination options...');
  fetchAppConfigForCreateSet(function (cfg) {
    var presetCandidates = parseSetDestinationPresetsFromConfig(cfg);
    filterExistingPresetDestinations(presetCandidates, function (existingPresets) {
      var currentFolder = String(state.folder || '/');
      var locationOptions = buildCreateSetLocationOptions(currentFolder, existingPresets);
      var selectedOption = promptForDestinationOption(locationOptions);
      if (selectedOption === null) {
        setStatus('Create Set cancelled.');
        return;
      }
      if (!selectedOption || !selectedOption.path) {
        setStatus('Create Set cancelled: invalid location choice.');
        return;
      }

      var defaultSetName = 'result_set';
      var setNameInput = prompt('New set folder name:', defaultSetName);
      if (setNameInput === null) {
        setStatus('Create Set cancelled.');
        return;
      }
      var setName = String(setNameInput || '').trim();
      if (!setName) {
        setStatus('Create Set cancelled: missing set folder name.');
        return;
      }

      var destinationParent = normalizeRelativeFolderPath(selectedOption.path) || '/';
      var items = visibleKeys.map(function (key) {
        return { source_media_rel: buildSourceMediaRelPath(key) };
      });

      if (ui.createSetFromResultsBtn) {
        ui.createSetFromResultsBtn.disabled = true;
      }
      setStatus('Creating set from results...');
      HttpModule.postJson(
        '/fs/create_set_from_results',
        {
          destination_parent: destinationParent,
          set_name: setName,
          items: items
        },
        function (status, responseText) {
          if (ui.createSetFromResultsBtn) {
            ui.createSetFromResultsBtn.disabled = false;
          }
          if (status !== 200) {
            setStatus(getErrorMessage(responseText, 'Create Set failed'));
            return;
          }
          var data;
          try {
            data = JSON.parse(responseText);
          } catch (e) {
            setStatus('Create Set failed: invalid response.');
            return;
          }
          if (!data || !data.ok) {
            setStatus('Create Set failed.');
            return;
          }
          var createdFolder = String(data.folder || '').trim();
          if (!createdFolder) {
            setStatus('Create Set failed: missing destination folder.');
            return;
          }
          setStatus('Set created: ' + createdFolder + ' (' + Number(data.copied_count || 0) + ' files).');
          state.folder = createdFolder;
          state.currentItem = null;
          clearEditorAndPreview();
          refreshCurrentDirectory();
        }
      );
    });
  });
}
