// Minimal console panel logic for webcap
// Expects ui.consolePanelEl to be set in constants.js
function appendToConsolePanel(msg) {
  var div = document.createElement('div');
  // Render newlines as <br> for streaming output
  div.innerHTML = String(msg).replace(/\n/g, '<br>');
  ui.consolePanelEl.appendChild(div);
  // Limit to last 500 lines for performance
  var maxLines = 500;
  while (ui.consolePanelEl.childNodes.length > maxLines) {
    ui.consolePanelEl.removeChild(ui.consolePanelEl.firstChild);
  }
  // Always scroll to bottom after append
  ui.consolePanelEl.scrollTop = ui.consolePanelEl.scrollHeight;
}

function isConsolePanelVisible() {
  if (!ui.consolePanelEl) return false;
  var display = ui.consolePanelEl.style.display;
  return !!display && display !== 'none';
}

function syncConsoleToggleButton() {
  var btn = document.getElementById('console-toggle-btn');
  if (!btn) return;
  var expanded = isConsolePanelVisible();
  btn.innerHTML = expanded ? '&#x25BC;' : '&#x25B2;';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  btn.setAttribute('aria-label', expanded ? 'Hide console' : 'Show console');
}

function showConsolePanel() {
  if (!ui.consolePanelEl) return;
  ui.consolePanelEl.style.display = 'block';
  syncConsoleToggleButton();
}

function toggleConsolePanel() {
  if (!ui.consolePanelEl) return;
  var style = ui.consolePanelEl.style;
  style.display = (style.display === 'none' || !style.display) ? 'block' : 'none';
  syncConsoleToggleButton();
}

function hideConsolePanel() {
  if (!ui.consolePanelEl) return;
  ui.consolePanelEl.style.display = 'none';
  syncConsoleToggleButton();
}
