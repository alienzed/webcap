/* FIFO workflow admission above (not inside) WebCap's inference and LLM queues.
   Browser-owned Batch and First Cut retain their current job lifecycle. */
(function () {
  'use strict';
  function request(action, kind, key) {
    return fetch('/fs/workflow_gate', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({action:action,kind:kind,key:key})
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || !data.ok) throw new Error(data.error || 'Workflow coordination failed.');
        return data;
      });
    });
  }

  function acquire(kind, key, isAlive, onWait, onLost) {
    var released = false, interval = 0, owned = false;
    var lease = {
      release: function () {
        released = true;
        if (interval) clearInterval(interval);
        interval = 0;
        return request('release', kind, key);
      }
    };
    return request('register', kind, key).then(function (initial) {
      function wait(state) {
        if (released || (isAlive && !isAlive())) {
          return lease.release().then(function () { throw new Error('Workflow was stopped while queued.'); });
        }
        if (state.state === 'missing') throw new Error('Workflow admission expired; retry.');
        if (state.state === 'active') {
          owned = true;
          var heartbeatFailures = 0;
          function loseOwnership(message) {
            if (released) return;
            released = true;
            clearInterval(interval);
            interval = 0;
            if (onLost) onLost(message);
          }
          interval = setInterval(function () {
            if (released) return;
            request('heartbeat', kind, key).then(function (next) {
              heartbeatFailures = 0;
              if (next.state !== 'active') {
                loseOwnership('Lost workflow admission; stopped submitting new operations.');
              }
            }).catch(function (err) {
              heartbeatFailures++;
              if (heartbeatFailures >= 3)
                loseOwnership('Cannot verify workflow admission; stopped submitting new operations: ' + String(err.message || err));
              else if (onWait) onWait('Workflow admission reconnecting (' + heartbeatFailures + '/3).');
            });
          }, 30000);
          return lease;
        }
        if (onWait) onWait('Workflow queued · #' + state.position);
        return new Promise(function (resolve) { setTimeout(resolve, 1000); }).then(function () {
          return request('heartbeat', kind, key);
        }).then(wait);
      }
      return wait(initial);
    }).catch(function (error) {
      if (!owned) lease.release().catch(function () {});
      throw error;
    });
  }

  window.webcapWorkflowGate = {acquire:acquire};
})();
