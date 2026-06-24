// Caption helper tab switching and folder-state loading.

function setCaptionHelperTab(tabName) {
  if (tabName !== 'requirements' && tabName !== 'tags' && tabName !== 'analysis' && tabName !== 'metadata') {
    tabName = 'requirements';
  }
  captionHelperActiveTab = tabName;
  var requirementsBtn = document.getElementById('caption-helper-tab-requirements-btn');
  var tagsBtn = document.getElementById('caption-helper-tab-tags-btn');
  var analysisBtn = document.getElementById('caption-helper-tab-analysis-btn');
  var metadataBtn = document.getElementById('caption-helper-tab-metadata-btn');
  var requirementsPane = document.getElementById('caption-helper-tab-requirements');
  var tagsPane = document.getElementById('caption-helper-tab-tags');
  var analysisPane = document.getElementById('caption-helper-tab-analysis');
  var metadataPane = document.getElementById('caption-helper-tab-metadata');
  var checklistPanel = document.getElementById('caption-checklist-panel');
  var splitLayout = !!(checklistPanel && checklistPanel.getAttribute('data-layout') === 'split');

  requirementsBtn.classList.remove('active');
  tagsBtn.classList.remove('active');
  analysisBtn.classList.remove('active');
  metadataBtn.classList.remove('active');
  requirementsPane.classList.add('hidden');
  tagsPane.classList.add('hidden');
  analysisPane.classList.add('hidden');
  metadataPane.classList.add('hidden');
  var tagResults = document.getElementById('tag-term-results');
  if (tagResults) tagResults.classList.add('hidden');

  if (splitLayout) {
    requirementsPane.classList.remove('hidden');
    tagsPane.classList.remove('hidden');
    if (tabName === 'tags') tagsBtn.classList.add('active');
    else requirementsBtn.classList.add('active');
    return;
  }

  if (tabName === 'requirements') {
    requirementsBtn.classList.add('active');
    requirementsPane.classList.remove('hidden');
    return;
  }
  if (tabName === 'tags') {
    tagsBtn.classList.add('active');
    tagsPane.classList.remove('hidden');
    return;
  }
  if (tabName === 'analysis') {
    analysisBtn.classList.add('active');
    analysisPane.classList.remove('hidden');
    return;
  }
  if (tabName === 'metadata') {
    metadataBtn.classList.add('active');
    metadataPane.classList.remove('hidden');
    return;
  }
}

function loadCaptionHelpersFromFolderState(folderState) {
  captionHelperPhrases = [];
  captionHelperNotes = String(folderState.caption_set_notes || '');
  annotateStripVisible = !!folderState.annotate_strip_visible;
  captionHelperPanelCollapsed = !!folderState.caption_helper_panel_collapsed;
  updateAnnotateStripToggleUi();
  updateCaptionHelperCollapseUi();
  var notesEditor = document.getElementById('set-notes-editor');
  if (notesEditor) {
    notesEditor.value = captionHelperNotes;
  }
  renderAnnotateStrip();
}

window.loadCaptionHelpersFromFolderState = loadCaptionHelpersFromFolderState;
window.setCaptionHelperTab = setCaptionHelperTab;
