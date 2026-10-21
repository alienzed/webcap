/* Session-only recall for submitted LLM instructions. No persistence or UI ownership. */
(function () {
  'use strict';

  window.createSessionPromptHistory = function () {
    var entries = [];
    var cursors = new WeakMap();

    function cursorFor(input) {
      var cursor = cursors.get(input);
      if (!cursor || cursor.version !== entries.length) {
        cursor = {index: entries.length, draft: input.value, version: entries.length, applying: false};
        cursors.set(input, cursor);
      }
      return cursor;
    }

    function remember(value, input) {
      var instruction = String(value || '').trim();
      if (!instruction) return;
      if (entries[entries.length - 1] !== instruction) entries.push(instruction);
      if (input) reset(input);
    }

    function reset(input) {
      cursors.set(input, {index: entries.length, draft: input.value, version: entries.length, applying: false});
    }

    function handleInput(event) {
      var input = event.target;
      var cursor = cursorFor(input);
      if (cursor.applying) return;
      cursor.index = entries.length;
      cursor.draft = input.value;
    }

    function handleKeydown(event) {
      var input = event.target;
      if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
          event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
          event.isComposing || input.readOnly || input.disabled || !entries.length) return false;

      // In textareas leave Up/Down alone unless at the first/last line.
      if (input.tagName === 'TEXTAREA') {
        var start = input.selectionStart, end = input.selectionEnd;
        if (event.key === 'ArrowUp' && input.value.lastIndexOf('\n', Math.max(0, start - 1)) !== -1) return false;
        if (event.key === 'ArrowDown' && input.value.indexOf('\n', end) !== -1) return false;
      }

      var cursor = cursorFor(input);
      if (event.key === 'ArrowUp') {
        if (cursor.index === 0) return false;
        if (cursor.index === entries.length) cursor.draft = input.value;
        cursor.index--;
      } else {
        if (cursor.index === entries.length) return false;
        cursor.index++;
      }

      event.preventDefault();
      cursor.applying = true;
      try {
        input.value = cursor.index === entries.length ? cursor.draft : entries[cursor.index];
        input.dispatchEvent(new Event('input', {bubbles: true}));
      } finally {
        cursor.applying = false;
      }
      return true;
    }

    function bind(input) {
      input.addEventListener('input', handleInput);
      input.addEventListener('keydown', handleKeydown);
    }

    return {remember: remember, reset: reset, bind: bind, handleInput: handleInput, handleKeydown: handleKeydown};
  };
})();
