var workingContextState = {
  modelProfileId: 'wan22_t2v'
};

function workingModelProfileStorageKey(folder) {
  return 'webcap.trainingProfile.' + String(folder || '');
}

function getWorkingModelProfileId() {
  return String(workingContextState.modelProfileId || 'wan22_t2v');
}

function hasWorkingModelProfile(profiles, profileId) {
  var id = String(profileId || '');
  return !!id && (Array.isArray(profiles) ? profiles : []).some(function (profile) {
    return profile && profile.id === id;
  });
}

function syncWorkingModelProfileForFolder(folder, profiles) {
  var availableProfiles = Array.isArray(profiles) ? profiles : [];
  var stored = '';
  try { stored = localStorage.getItem(workingModelProfileStorageKey(folder)) || ''; } catch (err) {}

  var current = getWorkingModelProfileId();
  var next = hasWorkingModelProfile(availableProfiles, stored)
    ? stored
    : (hasWorkingModelProfile(availableProfiles, current)
      ? current
      : (availableProfiles.length ? String(availableProfiles[0].id || '') : current));

  workingContextState.modelProfileId = next || 'wan22_t2v';
  try {
    localStorage.setItem(workingModelProfileStorageKey(folder), workingContextState.modelProfileId);
  } catch (err) {}
  return workingContextState.modelProfileId;
}

function setWorkingModelProfileId(profileId, folder) {
  workingContextState.modelProfileId = String(profileId || 'wan22_t2v');
  try {
    localStorage.setItem(workingModelProfileStorageKey(folder), workingContextState.modelProfileId);
  } catch (err) {}
  return workingContextState.modelProfileId;
}

window.getWorkingModelProfileId = getWorkingModelProfileId;
window.setWorkingModelProfileId = setWorkingModelProfileId;
window.syncWorkingModelProfileForFolder = syncWorkingModelProfileForFolder;
