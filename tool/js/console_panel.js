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
  ui.consolePanelEl.style.display = visible ? 'flex' : 'none';
  ui.consolePanelEl.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function appendToConsolePanel(msg) {
  var logEl = getConsolePanelLogEl();
  if (!logEl) return;
  var div = document.createElement('div');
  // Render newlines as <br> for streaming output
  div.innerHTML = String(msg).replace(/\n/g, '<br>');
  logEl.appendChild(div);
  // Limit to last 500 lines for performance
  var maxLines = 500;
  while (logEl.childNodes.length > maxLines) {
    logEl.removeChild(logEl.firstChild);
  }
  // Always scroll to bottom after append
  logEl.scrollTop = logEl.scrollHeight;
}

function isConsolePanelVisible() {
  if (!ui.consolePanelEl) return false;
  var display = ui.consolePanelEl.style.display;
  return !!display && display !== 'none';
}

function syncConsoleToggleButton() {
  var btn = document.getElementById('console-toggle-btn');
  if (!btn) return;
  wireConsolePanelUi();
  var expanded = isConsolePanelVisible();
  btn.innerHTML = expanded ? '&#x25BC;' : '&#x25B2;';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.setAttribute('aria-label', expanded ? 'Hide console' : 'Show console');
  syncWorkspaceConfigEditorUi();
  syncTrainingConsoleUi();
}

function showConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(true);
  syncConsoleToggleButton();
}

function toggleConsolePanel() {
  if (!ui.consolePanelEl) return;
  var style = ui.consolePanelEl.style;
  setConsolePanelVisible(style.display === 'none' || !style.display);
  syncConsoleToggleButton();
}

function hideConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(false);
  syncConsoleToggleButton();
}
