var StatusModule = (function() {
  function create(element) {
    return {
      set: function(text) {
        element.textContent = text || '';
      }
    };
  }

  return {
    create: create
  };
})();
