state = {
  folder: '',
  suppressInput: false,
  items: [],
  childFolders: [],
  currentItem: null,
  objectUrl: '',
  mode: 'path',
  dirStack: [],
  listRenderSeq: 0,
  reviewedSet: new Set(),
  focusSet: null,
  flags: {} // key: file or folder name, value: color string (red/yellow/orange/green)
};
// Define global UI object (all static elements)
ui = {
  editorEl: document.getElementById('editor'),
  previewEl: document.getElementById('preview'),
  mediaListEl: document.getElementById('media-list'),
  filterEl: document.getElementById('media-filter'),
  captionFilterCount: document.getElementById('caption-filter-count'),
  statusEl: document.getElementById('status-text'),
  refreshBtn: document.getElementById('refresh-btn'),
  reviewBtn: document.getElementById('review-captions-btn'),
  upRow: document.getElementById('up-one-directory-row'),
  focusSetExitBtn: document.getElementById('focus-set-exit-btn'),
  currentFolderRow: document.getElementById('current-folder-row'),
  consolePanelEl: document.getElementById('console-panel'),
};


// Set this to true to enable debug logging
var DEBUG = false;
var FOLDER_STATE_VERSION = 1;
var FOLDER_STATE_FILE = '.webcap_state.json';
var IMAGE_EXTENSIONS = { '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true };
var MEDIA_EXTENSIONS = {
  '.mp4': true, '.webm': true, '.ogg': true, '.mov': true, '.mkv': true, '.avi': true, '.m4v': true,
  '.jpg': true, '.jpeg': true, '.png': true, '.gif': true, '.webp': true, '.bmp': true
};

// Global variable for the root folder label (set from config)
var ROOT_FOLDER_LABEL = '/';

// Tokens in this blacklist will be ignored when counting frequency for stats/primer purposes. This is a simple way to filter out common stop words without needing a full NLP pipeline. The list can be expanded as needed.
var TOKEN_BLACKLIST = {
  a: true,
  an: true,
  the: true,
  is: true,
  are: true,
  was: true,
  were: true,
  be: true,
  being: true,
  been: true,
  on: true,
  in: true,
  to: true,
  of: true,
  for: true,
  with: true,
  by: true,
  from: true,
  at: true,
  as: true,
  or: true,
  but: true,
  she: true,
  her: true,
  his: true,
  it: true,
  they: true,
  he: true,
  him: true,
  them: true,
  this: true,
  that: true,
  these: true,
  those: true,
  and: true
};