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
  syncConsoleToggleButton();
}

function toggleConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(!isConsolePanelVisible());
  syncConsoleToggleButton();
}

function hideConsolePanel() {
  if (!ui.consolePanelEl) return;
  setConsolePanelVisible(false);
  syncConsoleToggleButton();
}
