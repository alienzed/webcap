// Minimal console panel logic for webcap
// Expects ui.consolePanelEl to be set in constants.js
function getConsolePanelLogEl() {
  return document.getElementById('console-panel-log') || ui.consolePanelEl;
}

function wireConsolePanelUi() {
  var panel = ui && ui.consolePanelEl;
  var closeBtn = document.getElementById('console-close-btn');
  if (!panel || !closeBtn || closeBtn.__consoleWired) return;
  closeBtn.__consoleWired = true;
  closeBtn.onclick = function () {
    hideConsolePanel();
  };
}

function setConsolePanelVisible(visible) {
  if (!ui.consolePanelEl) return;
  wireConsolePanelUi();
  var expanded = !!visible;
  ui.consolePanelEl.classList.toggle('hidden', !expanded);
  ui.consolePanelEl.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  var frame = document.getElementById('app-frame');
  if (frame) frame.classList.toggle('console-open', expanded);
}

function appendToConsolePanel(msg) {
  var logEl = getConsolePanelLogEl();
  if (!logEl) return;
  var div = document.createElement('div');
  div.textContent = String(msg);
  logEl.appendChild(div);
  // Limit to last 500 lines for performance
  var maxLines = 500;
  while (logEl.childNodes.length > maxLines) {
    logEl.removeChild(logEl.firstChild);
  }
  // Always scroll to bottom after append
  logEl.scrollTop = logEl.scrollHeight;
}

function markConsoleAttention(active) {
  var btn = document.getElementById('console-toggle-btn');
  if (!btn) return;
  btn.classList.toggle('has-attention', !!active);
}

function reportConsoleError(source, err) {
  var message = String(err && err.message ? err.message : err || 'Unknown error');
  var prefix = '[' + String(source || 'WebCap') + '] ';
  appendToConsolePanel(prefix + message);
  if (window.console && console.error) console.error(prefix + message, err);
  if (!isConsolePanelVisible()) markConsoleAttention(true);
}

function reportConsoleWarning(source, message) {
  appendToConsolePanel('[' + String(source || 'WebCap') + '] ' + String(message || ''));
  if (!isConsolePanelVisible()) markConsoleAttention(true);
}


function reportConsoleInfo(source, message) {
  appendToConsolePanel('[' + String(source || 'WebCap') + '] ' + String(message || ''));
}


function isConsolePanelVisible() {
  if (!ui.consolePanelEl) return false;
  return !ui.consolePanelEl.classList.contains('hidden') &&
    ui.consolePanelEl.getAttribute('aria-hidden') !== 'true';
}

function syncConsoleToggleButton() {
  var btn = document.getElementById('console-toggle-btn');
  if (!btn) return;
  wireConsolePanelUi();
  var expanded = isConsolePanelVisible();
  btn.classList.toggle('active', expanded);
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.setAttribute('aria-label', expanded ? 'Hide console' : 'Show console');
  btn.title = expanded ? 'Hide console' : 'Show console';
}

function showConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(true);
  markConsoleAttention(false);
  syncConsoleToggleButton();
}

function toggleConsolePanel() {
  if (!ui.consolePanelEl) return;
  var willShow = !isConsolePanelVisible();
  setConsolePanelVisible(willShow);
  if (willShow) markConsoleAttention(false);
  syncConsoleToggleButton();
}

function hideConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(false);
  syncConsoleToggleButton();
}
