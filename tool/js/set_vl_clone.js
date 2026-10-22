// A deliberately isolated Prep action: create a sibling Set with cached Open Sight captions.
function wireVlSetCloneUi() {
  var modal = document.getElementById('clone-set-vl-modal');
  var modelSelect = document.getElementById('clone-set-vl-model');
  var nameInput = document.getElementById('clone-set-vl-name');
  var summary = document.getElementById('clone-set-vl-summary');
  var create = document.getElementById('clone-set-vl-create');
  var close = document.getElementById('clone-set-vl-close');
  var cancel = document.getElementById('clone-set-vl-cancel');
  if (!modal || !modelSelect || !nameInput || !summary || !create || !close || !cancel) {
    throw new Error('Clone Set with VL Captions UI is incomplete.');
  }
  var snapshot = null;
  var sourceFolder = '';
  var busy = false;
  var openRequestId = 0;

  function hide() {
    if (busy) return;
    openRequestId += 1;
    modal.classList.add('hidden');
  }
  function selectedSource() {
    return snapshot && snapshot.sources.find(function (item) { return item.model === modelSelect.value; });
  }
  function updateSummary() {
    var item = selectedSource();
    var available = item ? Number(item.available) : 0;
    summary.textContent = item
      ? available + ' of ' + snapshot.total + ' media items have current Sight from this model. ' +
        item.excluded + ' without matching Sight will be excluded from the clone.'
      : 'No cached Open Sight responses available for this Set.';
    create.disabled = busy || !available || !nameInput.value.trim();
  }
  function suggestedName(model) {
    var suffix = String(model || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
    var folderName = sourceFolder.split('/').pop();
    return folderName + '-vl-' + (suffix || 'sight');
  }
  function open(folder) {
    if (busy) return;
    sourceFolder = String(folder || '').trim();
    if (!sourceFolder) {
      setStatus('Open a Set folder before cloning.');
      return;
    }
    snapshot = null;
    var requestFolder = sourceFolder;
    var requestId = ++openRequestId;
    modelSelect.replaceChildren();
    summary.textContent = 'Checking cached VL captions…';
    create.disabled = true;
    modal.classList.remove('hidden');
    fetch('/fs/set-vl-clone?folder=' + encodeURIComponent(sourceFolder)).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || !data.ok) throw new Error(data.error || 'Could not inspect saved Sight.');
        return data;
      });
    }).then(function (data) {
      if (modal.classList.contains('hidden') || requestFolder !== sourceFolder || requestId !== openRequestId) return;
      snapshot = data;
      data.sources.forEach(function (item) {
        var option = document.createElement('option');
        option.value = item.model;
        option.textContent = item.model;
        modelSelect.appendChild(option);
      });
      modelSelect.value = data.sources.length ? data.sources[0].model : '';
      nameInput.value = suggestedName(modelSelect.value);
      updateSummary();
    }).catch(function (err) {
      if (modal.classList.contains('hidden') || requestId !== openRequestId) return;
      summary.textContent = err.message;
      reportConsoleError('VL Set Clone', err);
    });
  }
  window.openVlSetClone = open;
  close.onclick = hide;
  cancel.onclick = hide;
  nameInput.oninput = updateSummary;
  modelSelect.onchange = function () {
    nameInput.value = suggestedName(modelSelect.value);
    updateSummary();
  };
  modal.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hide();
  });
  create.onclick = function () {
    if (busy || !selectedSource() || !nameInput.value.trim()) return;
    var requestedSource = sourceFolder;
    busy = true;
    create.disabled = true;
    cancel.disabled = true;
    summary.textContent = 'Copying Set and applying cached captions…';
    fetch('/fs/set-vl-clone', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folder: requestedSource, model: modelSelect.value, set_name: nameInput.value.trim()})
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || !data.ok) throw new Error(data.error || 'Clone failed.');
        return data;
      });
    }).then(function (data) {
      reportConsoleInfo('VL Set Clone', 'Created ' + data.folder + ': ' + data.copied_count +
        ' VL-captioned items, ' + data.excluded_count + ' excluded.');
      modal.classList.add('hidden');
      setStatus('Created VL-captioned Set: ' + data.folder + ' (' + data.copied_count + ' items).');
      state.folder = data.folder;
      state.currentItem = null;
      clearEditorAndPreview();
      refreshCurrentDirectory();
    }).catch(function (err) {
      summary.textContent = err.message;
      reportConsoleError('VL Set Clone', err);
      setStatus('VL Set clone failed: ' + err.message);
    }).finally(function () {
      busy = false;
      cancel.disabled = false;
      updateSummary();
    });
  };
}
