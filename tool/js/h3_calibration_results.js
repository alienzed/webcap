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
      maximums.push(frames + ' frames · ' + (aspects[aspect] || aspect) + ' · ' + shape[0] + ' × ' + shape[1]);
    });
  });
  if (maximums.length) {
    html += '<p class="app-settings-help">Saved maximum buckets</p><ul class="app-settings-help">' +
      maximums.map(function (text) { return '<li>' + escapeHtml(text) + '</li>'; }).join('') + '</ul>';
  }
  var keys = Object.keys(results);
  if (keys.length) {
    html += '<p class="app-settings-help">Tested buckets</p><ul class="app-settings-help">' + keys.map(function (key) {
      // Config validation owns this key format: e.g. 34f/169-736x416.
      var parts = /^(\d+)f\/([^-]+)-(\d+)x(\d+)$/.exec(key);
      var bucket = parts[1] + ' frames · ' + (aspects[parts[2]] || parts[2]) + ' · ' + parts[3] + ' × ' + parts[4];
      var status = results[key].status;
      return '<li>' + escapeHtml(bucket + ' · ' + (statuses[status] || status)) + '</li>';
    }).join('') + '</ul>';
  } else if (!maximums.length) {
    html += '<p class="app-settings-help">No saved calibration results.</p>';
  }
  container.innerHTML = html;
}
