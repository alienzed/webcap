/* Shared presentation only. Workflow ownership and job control remain with consumers. */
(function () {
  'use strict';

  function append(parent, tag, className, marker) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (marker) node.setAttribute('data-progress-' + marker, '');
    parent.appendChild(node);
    return node;
  }

  function create(options) {
    options = options || {};
    var card = document.createElement('article');
    card.className = 'activity-monitor-card progress-card' + (options.compact ? ' progress-card-compact' : '');
    card.setAttribute('data-progress-card-id', '');
    append(card, 'span', 'activity-monitor-dot active', 'dot');
    var copy = append(card, 'div', 'activity-monitor-copy', 'copy');
    append(copy, 'strong', '', 'title');
    append(copy, 'span', '', 'detail');
    append(copy, 'small', '', 'phase');
    append(copy, 'small', '', 'counts');
    append(copy, 'small', '', 'elapsed').setAttribute('aria-live', 'off');
    var track = append(copy, 'div', 'activity-monitor-progress', 'track');
    append(track, 'span', '', 'fill');
    var open = append(card, 'button', 'activity-monitor-open', 'open');
    open.type = 'button';
    open.textContent = 'Open';
    return card;
  }

  function elapsed(startedAt) {
    var time = Number(startedAt);
    if (!isFinite(time) || time <= 0) return '';
    var seconds = Math.max(0, Math.floor(Date.now() / 1000 - time));
    if (seconds < 60) return seconds + 's elapsed';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's elapsed';
    return Math.floor(minutes / 60) + 'h ' + String(minutes % 60).padStart(2, '0') + 'm elapsed';
  }

  function update(card, item, options) {
    options = options || {};
    if (!card || !item || !item.id) throw new Error('Progress card requires a node and stable operation ID.');
    var status = String(item.status || 'running');
    card.className = 'activity-monitor-card progress-card status-' + status +
      (options.compact ? ' progress-card-compact' : '');
    card.setAttribute('data-progress-card-id', String(item.id));
    card.querySelector('[data-progress-title]').textContent = String(item.title || item.label || 'Activity');
    card.querySelector('[data-progress-detail]').textContent = String(item.detail || '');
    var phase = card.querySelector('[data-progress-phase]');
    phase.textContent = String(item.phase || '');
    phase.hidden = !phase.textContent;
    var counts = card.querySelector('[data-progress-counts]');
    counts.textContent = String(item.progressLabel || '');
    counts.hidden = !counts.textContent;
    var time = card.querySelector('[data-progress-elapsed]');
    time.textContent = elapsed(item.startedAt);
    time.hidden = !time.textContent;
    var dot = card.querySelector('[data-progress-dot]');
    dot.className = 'activity-monitor-dot ' + (item.kind === 'storage' ? 'background' : 'active');

    var track = card.querySelector('[data-progress-track]');
    var p = item.progress && typeof item.progress === 'object' ? item.progress : null;
    var completed = Number(p && p.completed);
    var total = Number(p && p.total);
    var determinate = p && p.total != null && p.completed != null &&
      isFinite(completed) && completed >= 0 && isFinite(total) && total > 0;
    track.classList.toggle('indeterminate', !determinate);
    track.title = determinate
      ? (p.totalIsUpperBound ? 'Progress against an upper bound, not an ETA' : 'Completed work')
      : 'Progress cannot yet be measured';
    card.querySelector('[data-progress-fill]').style.width =
      determinate ? Math.max(0, Math.min(100, completed / total * 100)).toFixed(1) + '%' : '';
    var open = card.querySelector('[data-progress-open]');
    open.hidden = typeof options.onOpen !== 'function';
    open.onclick = typeof options.onOpen === 'function' ? options.onOpen : null;
    return card;
  }

  window.ProgressCard = { create: create, update: update };
})();
