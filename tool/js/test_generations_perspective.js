(function () {
  'use strict';
  var body = document.getElementById('test-generations-body');
  if (!body) throw new Error('Test Generations workspace is missing.');
  var buttons = Array.from(document.querySelectorAll('[data-test-generations-perspective]'));
  if (buttons.length !== 2) throw new Error('Test Generations perspective controls are missing.');
  function select(next) {
    if (next !== 'build' && next !== 'explore') throw new Error('Unknown Test Generations perspective: ' + next);
    body.classList.toggle('test-generations-explore', next === 'explore');
    buttons.forEach(function (button) {
      var active = button.dataset.testGenerationsPerspective === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  buttons.forEach(function (button) {
    button.addEventListener('click', function () { select(button.dataset.testGenerationsPerspective); });
  });
  select('build');
})();
