addEventListener('DOMContentLoaded', function() {
  console.log('[webcap] initializing');

  // Load the root directory - read from tool/config.js
  refreshCurrentDirectory();
  // Wire up Review Captions button
  if (typeof wireReviewActions === 'function') {
    wireReviewActions(state);
  }

});