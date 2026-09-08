// Read-only view of the calibration object already loaded by Settings.
function renderH3CalibrationResults(calibration) {
  var container = document.getElementById('h3-calibration-results');
  var hardware = calibration && calibration.hardware;
  var results = calibration && calibration.results || {};
  var safeShapes = calibration && calibration.safe_shapes || {};
  var aspects = { square: 'Square', '169': '16:9', '43': '4:3' };
  var statuses = { completed: 'Completed', oom: 'Out of memory', unsafe_slow: 'Slow limit reached', unsafe_vram: 'VRAM headroom limit reached' };
  var html = '';
  if (hardware) {
    html += '<p class="app-settings-help">' + escapeHtml(
      hardware.gpu_model + ' · ' + hardware.total_vram_mib + ' MiB VRAM · ' + hardware.total_ram_mib + ' MiB RAM'
    ) + '</p>';
  }
  var maximums = [];
  Object.keys(safeShapes).forEach(function (frames) {
    Object.keys(safeShapes[frames]).forEach(function (aspect) {
      var shape = safeShapes[frames][aspect];
      maximums.push('<tr><td>' + escapeHtml(frames) + '</td><td>' + escapeHtml(aspects[aspect] || aspect) +
        '</td><td>' + escapeHtml(shape[0] + ' × ' + shape[1]) + '</td></tr>');
    });
  });
  if (maximums.length) {
    html += '<table><caption>Saved maximum buckets</caption><thead><tr><th scope="col">Frames</th><th scope="col">Aspect</th><th scope="col">Maximum bucket</th></tr></thead><tbody>' +
      maximums.join('') + '</tbody></table>';
  }
  var keys = Object.keys(results);
  if (keys.length) {
    html += '<table><caption>Tested buckets</caption><thead><tr><th scope="col">Frames</th><th scope="col">Aspect</th><th scope="col">Resolution</th><th scope="col">Result</th></tr></thead><tbody>' + keys.map(function (key) {
      // Config validation owns this key format: e.g. 34f/169-736x416.
      var parts = /^(\d+)f\/([^-]+)-(\d+)x(\d+)$/.exec(key);
      var status = results[key].status;
      return '<tr><td>' + escapeHtml(parts[1]) + '</td><td>' + escapeHtml(aspects[parts[2]] || parts[2]) +
        '</td><td>' + escapeHtml(parts[3] + ' × ' + parts[4]) + '</td><td>' + escapeHtml(statuses[status] || status) + '</td></tr>';
    }).join('') + '</tbody></table>';
  } else if (!maximums.length) {
    html += '<p class="app-settings-help">No saved calibration results.</p>';
  }
  container.innerHTML = html;
}
