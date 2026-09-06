  const serviceStates = new Map([...declaredServices].map(name => [name, readyServices.has(name) ? "ready" : "starting"]));
  // The failure detail that goes out beside a state, held per service the way
  // the host holds it: the tail of what that process last wrote to stderr, and
  // null for every service that has not failed at anything.
  const serviceDetails = new Map([...declaredServices].map(name => [name, null]));
  const serviceConnections = new Map();
  const serviceWatchers = new Map();
  const serviceOutbound = [];
  const serviceOutboundWaiting = [];
  let nextServiceHandle = 1;
  const maxServiceQueuedMessages = 1024;
  function serviceConnection(handle, operation) {
    const connection = serviceConnections.get(handle);
    if (!connection) throw new Error("Desktop test service connection is closed or unknown");
    return connection;
  }
  function settleServiceOutbound() {
    while (serviceOutboundWaiting.length > 0 && serviceOutbound.length > 0) {
      serviceOutboundWaiting.shift()(serviceOutbound.shift());
    }
  }
  function publishServiceState(name, state, detail) {
    serviceStates.set(name, state);
    serviceDetails.set(name, detail);
    for (const watcher of serviceWatchers.values()) {
      if (watcher.closed) continue;
      if (watcher.pending && watcher.events.length === 0) {
        const deliver = watcher.pending;
        watcher.pending = null;
        deliver({name, state, detail});
        continue;
      }
      const index = watcher.events.findIndex(event => event.name === name);
      if (index >= 0) watcher.events[index] = {name, state, detail};
      else watcher.events.push({name, state, detail});
    }
    return null;
  }
  async function serviceCapability(operation, args) {
    if (operation === "connect") {
      const name = args[0];
      if (!declaredServices.has(name)) throw new Error("Desktop service '" + String(name) + "' is not declared in 'desktop.services'");
      const state = serviceStates.get(name);
      if (state !== "ready") {
        throw new Error("Desktop service '" + name + "' is " + state + " rather than ready; watchServices() reports when it becomes ready");
      }
      const handle = nextServiceHandle++;
      serviceConnections.set(handle, {
        name, queue: [], pending: null, closed: false,
        closeCode: 1006, closeReason: "the service channel ended without a close frame",
      });
      return handle;
    }
    if (operation === "send") {
      const connection = serviceConnection(args[0], "send");
      if (typeof args[1] !== "string") throw new TypeError("Desktop test service send requires text");
      if (connection.closed) throw new Error("Desktop test service connection is closed");
      serviceOutbound.push({connection: args[0], message: args[1]});
      settleServiceOutbound();
      return null;
    }
    if (operation === "receive") {
      const connection = serviceConnections.get(args[0]);
      if (!connection) return null;
      if (connection.pending) throw new Error("ServiceConnection.next already has an active pull");
      if (connection.queue.length > 0) return connection.queue.shift();
      if (connection.closed) { serviceConnections.delete(args[0]); return null; }
      return new Promise(resolve => { connection.pending = resolve; });
    }
    if (operation === "state") return serviceConnections.get(args[0])?.closed === false ? "open" : "closed";
    if (operation === "closeInfo") {
      const connection = serviceConnection(args[0], "closeInfo");
      return {code: connection.closeCode, reason: connection.closeReason};
    }
    if (operation === "close") {
      const connection = serviceConnections.get(args[0]);
      if (!connection) return false;
      connection.closed = true;
      connection.closeCode = args[1];
      connection.closeReason = args[2];
      if (connection.pending) { const deliver = connection.pending; connection.pending = null; deliver(null); }
      serviceConnections.delete(args[0]);
      return true;
    }
    if (operation === "watchStart") {
      const handle = nextServiceHandle++;
      serviceWatchers.set(handle, {
        events: [...serviceStates].map(([name, state]) => ({name, state, detail: serviceDetails.get(name) ?? null})),
        pending: null,
        closed: false,
      });
      return handle;
    }
    if (operation === "watchNext") {
      const watcher = serviceWatchers.get(args[0]);
      if (!watcher || watcher.closed) throw new Error("Desktop ServiceStateStream handle is unknown or already released");
      if (watcher.pending) throw new Error("ServiceStateStream.next already has an active pull");
      if (watcher.events.length > 0) return watcher.events.shift();
      return new Promise(resolve => { watcher.pending = resolve; });
    }
    if (operation === "watchClose") {
      const watcher = serviceWatchers.get(args[0]);
      if (!watcher) return false;
      watcher.closed = true;
      watcher.pending = null;
      serviceWatchers.delete(args[0]);
      return true;
    }
    throw new Error("Unsupported Desktop test service operation '" + operation + "'");
  }
  function deliverToServiceConnection(connection, message) {
    if (connection.pending) { const deliver = connection.pending; connection.pending = null; deliver(message); return; }
    if (connection.queue.length >= maxServiceQueuedMessages) throw new RangeError("Desktop test service receive queue reached its bound");
    connection.queue.push(message);
  }
  async function serviceTestCapability(operation, args) {
    if (operation === "setState") {
      if (!declaredServices.has(args[0])) throw new Error("Desktop test setServiceState cannot name the undeclared service '" + String(args[0]) + "'");
      return publishServiceState(args[0], args[1], args[2] ?? null);
    }
    // The test process pulls what the application sent and pushes back what the
    // real loopback service answered. A bounded wait rather than an open-ended
    // one, so a pump outlives neither the page nor the test that started it.
    if (operation === "poll") {
      if (serviceOutbound.length > 0) return serviceOutbound.shift();
      return new Promise(resolve => {
        const waiter = value => resolve(value ?? null);
        serviceOutboundWaiting.push(waiter);
        setTimeout(() => {
          const index = serviceOutboundWaiting.indexOf(waiter);
          if (index >= 0) { serviceOutboundWaiting.splice(index, 1); resolve(null); }
        }, 100);
      });
    }
    if (operation === "deliver") {
      const connection = serviceConnections.get(args[0]);
      if (!connection || connection.closed) return null;
      deliverToServiceConnection(connection, args[1]);
      return null;
    }
    // deliver answers one connection because it answers one request, and the
    // request carried the handle. A push has no request to carry one, so it is
    // addressed by service name and reaches every open connection to it -- the
    // real envelope's push leg has the same shape, since a service pushing a
    // stream frame is not replying to anybody. The count is returned so a test
    // can tell "delivered to nobody" from "delivered", which is the difference
    // between pushing before connect() and pushing after it.
    if (operation === "push") {
      let delivered = 0;
      for (const connection of serviceConnections.values()) {
        if (connection.name !== args[0] || connection.closed) continue;
        deliverToServiceConnection(connection, args[1]);
        delivered += 1;
      }
      return delivered;
    }
    throw new Error("Unsupported Desktop test service seam operation '" + operation + "'");
  }

  const bridge = Object.freeze({
