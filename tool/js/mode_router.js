var ModeRouterModule = (function() {
  var factories = {};

  function registerMode(name, factory) {
    factories[name] = factory;
  }

  function hasMode(name) {
    return !!factories[name];
  }

  function startMode(name, context) {
    var factory = factories[name];
    if (!factory) {
      throw new Error('Unknown mode: ' + name);
    }
    return factory(context || {});
  }

  return {
    registerMode: registerMode,
    hasMode: hasMode,
    startMode: startMode
  };
})();
