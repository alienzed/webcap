var captionHelperActiveTab = 'requirements';
var captionHelperPhrases = [];
var captionQuickPhrases = [];
var captionHelperNotes = '';
var debouncedSetNotesSave = debounceCreate(500);
var annotateStripVisible = false;
var captionHelperPanelCollapsed = false;

function saveCaptionHelpersToFolderState() {
  var snapshot = snapshotFolderStateFromDom();
  snapshot.caption_phrases = captionHelperPhrases.slice();
  snapshot.quick_phrases = captionQuickPhrases.slice();
  snapshot.caption_set_notes = captionHelperNotes;
  snapshot.annotate_strip_visible = !!annotateStripVisible;
  snapshot.caption_helper_panel_collapsed = !!captionHelperPanelCollapsed;
  writeFolderStateFile(state.folder, snapshot);
}
