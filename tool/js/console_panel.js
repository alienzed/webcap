// Minimal console panel logic for webcap
// Expects ui.consolePanelEl to be set in constants.js
function appendToConsolePanel(msg) {
  if (!ui.consolePanelEl) return;
  var div = document.createElement('div');
  // Render newlines as <br> for streaming output
  div.innerHTML = String(msg).replace(/\n/g, '<br>');
  ui.consolePanelEl.appendChild(div);
  // Limit to last 500 lines for performance
  var maxLines = 500;
  while (ui.consolePanelEl.childNodes.length > maxLines) {
    ui.consolePanelEl.removeChild(ui.consolePanelEl.firstChild);
  }
}

function toggleConsolePanel() {
  if (!ui.consolePanelEl) return;
  var style = ui.consolePanelEl.style;
  style.display = (style.display === 'none' || !style.display) ? 'block' : 'none';
}
