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

  function acquire(kind, key, isAlive, onWait) {
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
          interval = setInterval(function () {
            if (released) return;
            request('heartbeat', kind, key).then(function (next) {
              if (next.state !== 'active') {
                // Never continue silently after loss of ownership.
                if (onWait) onWait('Lost workflow admission. Stop and retry.');
              }
            }).catch(function (err) {
              if (onWait) onWait('Workflow admission heartbeat failed: ' + String(err.message || err));
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
