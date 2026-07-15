var TERM_FAMILY_MIN_MEMBERS = 3;
var termFamilyPopoverState = {
  el: null,
  listEl: null,
  trigger: null,
  closeTimer: 0
};

function getTermFamilyFirstWord(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  return text.split(/\s+/)[0].toLowerCase();
}

function getTermFamilyDisplayEntries(items, getTermText) {
  var list = Array.isArray(items) ? items : [];
  var getText = typeof getTermText === 'function' ? getTermText : function (item) { return item; };
  var byWord = {};
  list.forEach(function (item) {
    var term = String(getText(item) || '').trim();
    var word = getTermFamilyFirstWord(term);
    if (!word) return;
    if (!byWord[word]) byWord[word] = [];
    byWord[word].push(item);
  });

  var emittedFamilies = {};
  var entries = [];
  list.forEach(function (item) {
    var term = String(getText(item) || '').trim();
    var word = getTermFamilyFirstWord(term);
    var family = word ? byWord[word] : null;
    if (!family || family.length < TERM_FAMILY_MIN_MEMBERS) {
      entries.push({ type: 'term', item: item });
      return;
    }
    if (emittedFamilies[word]) return;
    emittedFamilies[word] = true;
    entries.push({
      type: 'family',
      word: term.split(/\s+/)[0],
      items: family
    });
  });
  return entries;
}

function getTermFamilyPopover() {
  if (termFamilyPopoverState.el && termFamilyPopoverState.el.isConnected) return termFamilyPopoverState.el;
  var popover = document.createElement('div');
  popover.id = 'term-family-popover';
  popover.className = 'term-family-popover hidden';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Related terms');
  var list = document.createElement('div');
  list.className = 'term-family-popover-list';
  popover.appendChild(list);
  popover.addEventListener('mouseenter', function () {
    clearTermFamilyPopoverCloseTimer();
  });
  popover.addEventListener('mouseleave', scheduleTermFamilyPopoverClose);
  popover.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('button') : null;
    if (target) closeTermFamilyPopover();
  });
  popover.addEventListener('contextmenu', function () {
    window.setTimeout(closeTermFamilyPopover, 0);
  });
  document.body.appendChild(popover);
  termFamilyPopoverState.el = popover;
  termFamilyPopoverState.listEl = list;
  return popover;
}

function clearTermFamilyPopoverCloseTimer() {
  if (!termFamilyPopoverState.closeTimer) return;
  window.clearTimeout(termFamilyPopoverState.closeTimer);
  termFamilyPopoverState.closeTimer = 0;
}

function scheduleTermFamilyPopoverClose() {
  clearTermFamilyPopoverCloseTimer();
  termFamilyPopoverState.closeTimer = window.setTimeout(function () {
    closeTermFamilyPopover();
  }, 110);
}

function closeTermFamilyPopover() {
  clearTermFamilyPopoverCloseTimer();
  var popover = termFamilyPopoverState.el;
  var trigger = termFamilyPopoverState.trigger;
  if (trigger) trigger.setAttribute('aria-expanded', 'false');
  termFamilyPopoverState.trigger = null;
  if (!popover) return;
  popover.className = 'term-family-popover hidden';
  popover.style.left = '';
  popover.style.top = '';
}

function positionTermFamilyPopover(trigger, popover) {
  var rect = trigger.getBoundingClientRect();
  var margin = 8;
  var width = popover.offsetWidth || 0;
  var height = popover.offsetHeight || 0;
  var left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
  var top = rect.bottom + 7;
  if (top + height > window.innerHeight - margin) {
    top = Math.max(margin, rect.top - height - 7);
  }
  popover.style.left = Math.round(left) + 'px';
  popover.style.top = Math.round(top) + 'px';
}

function openTermFamilyPopover(trigger, items, renderItem, options) {
  if (!trigger || !items || !items.length || typeof renderItem !== 'function') return;
  clearTermFamilyPopoverCloseTimer();
  var popover = getTermFamilyPopover();
  var list = termFamilyPopoverState.listEl;
  if (termFamilyPopoverState.trigger && termFamilyPopoverState.trigger !== trigger) {
    termFamilyPopoverState.trigger.setAttribute('aria-expanded', 'false');
  }
  termFamilyPopoverState.trigger = trigger;
  list.innerHTML = '';
  items.forEach(function (item) {
    var node = renderItem(item);
    if (node) list.appendChild(node);
  });
  popover.className = 'term-family-popover' + (options && options.popoverClass ? ' ' + options.popoverClass : '');
  trigger.setAttribute('aria-expanded', 'true');
  positionTermFamilyPopover(trigger, popover);
}

function getTermFamilyHintSummary(items, getHint) {
  var hints = [];
  var seen = {};
  (Array.isArray(items) ? items : []).forEach(function (item) {
    var hint = typeof getHint === 'function' ? getHint(item) : null;
    if (!hint || !hint.text) return;
    var key = String(hint.className || '') + '|' + String(hint.text || '');
    if (seen[key]) return;
    seen[key] = true;
    hints.push(hint);
  });
  return hints;
}

function createTermFamilyTrigger(entry, collapsedItems, renderItem, options) {
  var opts = options || {};
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'term-family-trigger' + (opts.triggerClass ? ' ' + opts.triggerClass : '');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = entry.word + '\u2026';

  var chevron = document.createElement('span');
  chevron.className = 'term-family-trigger-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '\u25be';
  trigger.appendChild(chevron);

  var hints = getTermFamilyHintSummary(collapsedItems, opts.getHint);
  var title = 'Show ' + collapsedItems.length + ' ' + entry.word + ' terms';
  if (hints.length) {
    trigger.classList.add('has-hint');
    trigger.classList.add('term-family-trigger--hint-' + String(hints[0].className || 'general'));
    title += ' \u2014 hidden variants include ' + hints.map(function (hint) { return hint.text; }).join(', ');
  }
  trigger.title = title;
  trigger.setAttribute('aria-label', title);
  trigger.addEventListener('mouseenter', function () {
    openTermFamilyPopover(trigger, collapsedItems, renderItem, opts);
  });
  trigger.addEventListener('mouseleave', scheduleTermFamilyPopoverClose);
  trigger.addEventListener('focus', function () {
    openTermFamilyPopover(trigger, collapsedItems, renderItem, opts);
  });
  trigger.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    openTermFamilyPopover(trigger, collapsedItems, renderItem, opts);
  });
  return trigger;
}

function renderTermFamilyEntries(container, items, options) {
  if (!container) return;
  var opts = options || {};
  var getText = opts.getText;
  var renderItem = opts.renderItem;
  if (typeof getText !== 'function' || typeof renderItem !== 'function') {
    throw new Error('Term family rendering requires getText and renderItem callbacks.');
  }
  getTermFamilyDisplayEntries(items, getText).forEach(function (entry) {
    if (entry.type === 'term') {
      container.appendChild(renderItem(entry.item));
      return;
    }
    var visibleItems = entry.items.filter(function (item) {
      return typeof opts.isBreakout === 'function' && !!opts.isBreakout(item);
    });
    var collapsedItems = entry.items.filter(function (item) {
      return visibleItems.indexOf(item) === -1;
    });
    if (collapsedItems.length) {
      container.appendChild(createTermFamilyTrigger(entry, collapsedItems, renderItem, opts));
    }
    visibleItems.forEach(function (item) {
      container.appendChild(renderItem(item));
    });
  });
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && termFamilyPopoverState.trigger) closeTermFamilyPopover();
});
window.addEventListener('resize', closeTermFamilyPopover);
window.addEventListener('scroll', closeTermFamilyPopover, true);
