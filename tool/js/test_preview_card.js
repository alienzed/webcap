/* The common render card. Screens own their data, navigation, queues and persistence.
 * This renderer owns one media element, a compact footer and optional details.
 * Preserve the node while media is playing or any interactive control is active.
 */
(function () {
  'use strict';

  function node(tag, className, label) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (label != null) el.textContent = String(label);
    return el;
  }
  function text(value) { return String(value == null ? '' : value); }

  function updateRating(card, value) {
    var rating = card.querySelector('.test-generations-result-rating');
    if (!rating) return;
    rating.querySelectorAll('[data-test-rating]').forEach(function (star) {
      var active = Number(star.dataset.testRating) <= Number(value || 0);
      star.classList.toggle('active', active);
      star.textContent = active ? '★' : '☆';
      star.disabled = false;
    });
  }

  function createTestPreviewCard(options) {
    var o = options || {};
    var card = node(o.tag || 'article', o.className || 'test-generations-result-card');
    if (o.key != null) card.dataset.resultKey = text(o.key);
    Object.keys(o.dataset || {}).forEach(function (name) {
      card.dataset[name] = text(o.dataset[name]);
    });
    if (o.ariaLabel) card.setAttribute('aria-label', o.ariaLabel);
    if (o.role) card.setAttribute('role', o.role);
    if (o.tabIndex != null) card.tabIndex = o.tabIndex;

    var media = o.media;
    if (media && media.url) {
      var preview = node(media.kind === 'video' ? 'video' : 'img');
      preview.src = media.url;
      if (media.kind === 'video') {
        preview.preload = 'metadata';
        preview.muted = !!media.muted;
        preview.playsInline = true;
        if (o.videoTransport) o.videoTransport(card, preview);
        else preview.controls = true;
      } else {
        preview.loading = 'lazy';
        preview.alt = media.alt || 'Generated preview';
      }
      if (!preview.parentNode) card.appendChild(preview);
    } else if (o.placeholder != null) {
      card.appendChild(node('div', 'test-generations-preview-placeholder' +
        (o.failed ? ' test-generations-failure-placeholder' : ''), o.placeholder));
    }
    if (o.removeNode) card.appendChild(o.removeNode);

    var footer = node(o.tag === 'figure' ? 'figcaption' : 'div',
      'test-generations-result-footer' + (o.failed ? ' test-generations-failure-footer' : ''));
    var copy = node('div', o.failed ? 'test-generations-failure-copy' : 'test-generations-result-copy');
    var primary = node('div', 'test-generations-result-primary');
    var name = node('div', 'test-generations-result-name');
    var label = text(o.title);
    var epoch = o.epochLink;
    if (epoch && label.includes(epoch.text)) {
      var at = label.indexOf(epoch.text);
      name.appendChild(document.createTextNode(label.slice(0, at)));
      var jump = node('button', 'test-generations-epoch-link', epoch.text);
      jump.type = 'button';
      jump.dataset.testEpochMediaJob = text(epoch.jobId);
      jump.dataset.testEpochMediaEpoch = text(epoch.epoch);
      jump.title = 'See all recorded results for this training checkpoint';
      name.appendChild(jump);
      name.appendChild(document.createTextNode(label.slice(at + epoch.text.length)));
    } else {
      name.textContent = label;
    }
    if (o.sourceDetail) {
      var secondary = node('span', 'test-generations-result-source', ' · ' + o.sourceDetail);
      secondary.title = text(o.sourceTooltip || o.sourceDetail);
      name.appendChild(secondary);
    }
    name.title = text(o.titleTooltip || [label,o.sourceTooltip].filter(Boolean).join(' · '));
    primary.appendChild(name);
    if (o.elapsed || o.reserveElapsed) {
      primary.appendChild(node('span', 'test-generations-result-elapsed', o.elapsed || ''));
    }
    copy.appendChild(primary);

    var meta = (o.metadata || []).filter(function (value) { return value != null && text(value).trim(); });
    if (meta.length || o.rating) {
      var second = node('div', 'test-generations-result-secondary');
      if (meta.length) {
        var line = node('div', 'test-generations-result-metadata', meta.join(' · '));
        line.title = line.textContent;
        second.appendChild(line);
      }
      if (o.rating) {
        var rating = node('div', 'test-generations-result-rating');
        rating.setAttribute('aria-label', 'Rate this Test result');
        for (var i = 1; i <= 5; i++) {
          var star = node('button', 'test-generations-result-star', '');
          star.type = 'button';
          star.dataset.testRating = String(i);
          star.dataset.mediaFile = text(o.rating.mediaFile);
          star.dataset.testSession = text(o.rating.session);
          star.title = 'Rate ' + i + ' star' + (i === 1 ? '' : 's');
          star.setAttribute('aria-label', star.title);
          if (o.rating.onRate) {
            (function (value) {
              star.addEventListener('click', function (event) {
                event.stopPropagation();
                o.rating.onRate(value, card);
              });
            })(i);
          }
          rating.appendChild(star);
        }
        second.appendChild(rating);
        rating.querySelectorAll('[data-test-rating]').forEach(function (star) {
          var active = Number(star.dataset.testRating) <= Number(o.rating.value || 0);
          star.classList.toggle('active', active);
          star.textContent = active ? '★' : '☆';
        });
      }
      copy.appendChild(second);
    }

    if (o.failed && o.error) copy.appendChild(node('div','test-generations-result-error',o.error));

    if (Array.isArray(o.wildcards) && o.wildcards.length) {
      var chips = node('div', 'test-preview-card-chips');
      var extra = [];
      o.wildcards.forEach(function (choice) {
        var value = typeof choice === 'string' ? choice : text(choice.value || choice.text);
        if (!value) return;
        var chip = node('span', 'test-preview-card-chip', value);
        if (choice && typeof choice === 'object' && choice.label) chip.title = text(choice.label);
        if (chips.querySelectorAll('.test-preview-card-chip').length >= 2) {
          chip.classList.add('hidden');
          extra.push(chip);
        }
        chips.appendChild(chip);
      });
      if (extra.length) {
        var expand = node('button', 'test-preview-card-chip-more', '+' + extra.length + ' more');
        expand.type = 'button';
        expand.setAttribute('aria-expanded', 'false');
        expand.title = 'Show all wildcard choices';
        expand.addEventListener('click', function (event) {
          event.stopPropagation();
          var open = expand.getAttribute('aria-expanded') !== 'true';
          extra.forEach(function (chip) { chip.classList.toggle('hidden', !open); });
          expand.setAttribute('aria-expanded', String(open));
          expand.textContent = open ? 'Show less' : '+' + extra.length + ' more';
        });
        chips.appendChild(expand);
      }
      if (chips.childNodes.length) copy.appendChild(chips);
    }

    // The compact bottom row owns per-render evaluations, Details and actions.
    // Epoch-wide averages remain queryable but live inside Details, not beside
    // the per-render VL score.
    var utility = node('div', 'test-preview-card-utility');
    var metrics = null;
    if (o.testEvaluation) {
      var evaluation = node('div', 'test-generations-result-evaluation hidden');
      var action = node('button', 'review-captions-btn test-generations-vl-result hidden');
      action.type = 'button';
      action.dataset.testVlResult = text(o.testEvaluation.mediaFile);
      evaluation.appendChild(action);
      utility.appendChild(evaluation);

      metrics = node('div', 'test-generations-result-epoch-metrics');
      var manual = node('span', 'test-generations-vl-epoch-score hidden');
      manual.dataset.testManualEpochScore = '1';
      var vl = node('span', 'test-generations-vl-epoch-score hidden');
      vl.dataset.testVlEpochScore = '1';
      metrics.appendChild(manual);
      metrics.appendChild(vl);
    } else if (o.evaluations && o.evaluations.length) {
      var row = node('div', 'test-preview-card-evaluations');
      o.evaluations.forEach(function (entry) {
        if (!entry || !entry.label) return;
        var badge = node('span', 'test-preview-card-score', entry.label);
        if (entry.title) badge.title = entry.title;
        row.appendChild(badge);
      });
      if (row.childNodes.length) utility.appendChild(row);
    }

    if (o.details && o.details.length || metrics) {
      var details = node('details','test-preview-card-details');
      details.appendChild(node('summary','', 'Details'));
      var inner = node('div','test-preview-card-details-content');
      if (metrics) {
        var epochSection = node('section','test-preview-card-epoch-metrics hidden');
        epochSection.appendChild(node('strong','', 'Epoch averages'));
        epochSection.appendChild(metrics);
        inner.appendChild(epochSection);
      }
      (o.details || []).forEach(function (entry) {
        if (!entry || entry.value == null || entry.value === '') return;
        var section = node('section');
        if (entry.label) section.appendChild(node('strong','',entry.label));
        if (Array.isArray(entry.value)) entry.value.forEach(function (line) {
          section.appendChild(node('p','',line));
        });
        else section.appendChild(node(entry.pre ? 'pre' : 'p','',entry.value));
        inner.appendChild(section);
      });
      details.appendChild(inner);
      utility.appendChild(details);
    }
    if (o.actions && o.actions.length) {
      var menu = node('details','test-preview-card-menu');
      var trigger = node('summary','','⋯');trigger.title = 'More render actions';
      trigger.setAttribute('aria-label','More render actions');
      menu.appendChild(trigger);
      var items = node('div','test-preview-card-menu-items');
      o.actions.forEach(function (action) {
        var item = node(action.url ? 'a' : 'button', '',action.label);
        if (action.url) {item.href = action.url;item.target='_blank';item.rel='noopener noreferrer';}
        else {item.type='button';item.addEventListener('click', function (event) {event.stopPropagation();menu.open=false;action.onClick();});}
        if (action.dataset) Object.keys(action.dataset).forEach(function (key) {item.dataset[key] = text(action.dataset[key]);});
        items.appendChild(item);
      });
      menu.appendChild(items);utility.appendChild(menu);
    }
    if (utility.childNodes.length) copy.appendChild(utility);
    footer.appendChild(copy);card.appendChild(footer);
    return card;
  }
  window.createTestPreviewCard = createTestPreviewCard;
  window.updateTestPreviewCardRating = updateRating;
})();