var DebounceModule = (function() {
  function create(waitMs) {
    var timer = null;
    return function(callback) {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(callback, waitMs);
    };
  }

  return {
    create: create
  };
})();
