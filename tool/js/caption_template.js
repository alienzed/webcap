// caption_template.js
// Minimal primer engine: auto-seed empty captions from template rules.

var CaptionTemplateModule = (function() {
  function parseRules(multiline) {
    var template = '';
    var defaults = {};
    var assignments = [];

    String(multiline || '')
      .split(/\r?\n/)
      .map(function(line) { return line.trim(); })
      .filter(Boolean)
      .forEach(function(line) {
        var lower = line.toLowerCase();

        if (lower.indexOf('template:') === 0) {
          template = line.slice('template:'.length).trim();
          return;
        }

        if (lower.indexOf('default:') === 0) {
          var defaultPart = line.slice('default:'.length).trim();
          var eq = defaultPart.indexOf('=');
          if (eq > 0) {
            var key = defaultPart.slice(0, eq).trim().toLowerCase();
            var value = defaultPart.slice(eq + 1).trim();
            if (key) {
              defaults[key] = value;
            }
          }
          return;
        }

        var idx = line.indexOf('=>');
        if (idx === -1) {
          return;
        }

        var left = line.slice(0, idx).trim().toLowerCase();
        var right = line.slice(idx + 2).trim();
        var eq = right.indexOf('=');
        if (!left || !right || eq <= 0) {
          return;
        }

        var key = right.slice(0, eq).trim().toLowerCase();
        var value = right.slice(eq + 1).trim();
        if (!key || !value) {
          return;
        }

        var scope = 'file';
        var trigger = left;
        var colon = left.indexOf(':');
        if (colon > 0) {
          var prefix = left.slice(0, colon).trim();
          var scopedTrigger = left.slice(colon + 1).trim();
          if ((prefix === 'file' || prefix === 'caption') && scopedTrigger) {
            scope = prefix;
            trigger = scopedTrigger;
          }
        }

        if (scope !== 'file') {
          return;
        }

        assignments.push({ trigger: trigger, key: key, value: value });
      });

    return {
      template: template,
      defaults: defaults,
      assignments: assignments
    };
  }

  function renderTemplate(template, values) {
    var rendered = String(template || '').replace(/\{\s*([a-zA-Z0-9_]+)\s*\}/g, function(_, rawKey) {
      var key = String(rawKey || '').toLowerCase();
      return values.hasOwnProperty(key) ? values[key] : '';
    });

    rendered = rendered
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,+/g, ', ')
      .replace(/^,\s*/, '')
      .replace(/,\s*$/, '')
      .trim();

    return rendered;
  }

  function buildPrimer(fileName, rulesText) {
    var cfg = parseRules(rulesText);
    if (!cfg.template) {
      return '';
    }

    var fileNorm = String(fileName || '').toLowerCase();
    var values = {};

    Object.keys(cfg.defaults).forEach(function(key) {
      values[key] = cfg.defaults[key];
    });

    cfg.assignments.forEach(function(rule) {
      if (fileNorm.indexOf(rule.trigger) !== -1) {
        values[rule.key] = rule.value;
      }
    });

    return renderTemplate(cfg.template, values);
  }

  return {
    buildPrimer: buildPrimer
  };
})();