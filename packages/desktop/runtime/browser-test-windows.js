  const windowRegistry = new Map();
  const windowWatchers = new Map();
  const maxWindowStateEvents = 64;
  let nextWindowHandle = 1;
  let nextWindowWatcherHandle = 1;
  const display = Object.freeze({
    id: "velar-test-display",
    bounds: Object.freeze({x: 0, y: 0, width: 1440, height: 900}),
    workArea: Object.freeze({x: 0, y: 25, width: 1440, height: 875}),
    scale: 2,
    primary: true,
  });

  function declaredWindow(kind, operation) {
    if (typeof kind !== "string" || !Object.hasOwn(windowKinds, kind)) {
      throw new Error("Desktop test " + operation + " cannot use the undeclared window kind '" + String(kind)
        + "'; declare it under 'desktop.windows' (declared kinds: " + Object.keys(windowKinds).join(", ") + ")");
    }
    return windowKinds[kind];
  }
  // The fake registry's half of the instance-key rule; see windowKeyOf in
  // packages/desktop/src/compiler.ts for the other two copies and why.
  function windowKeyValue(value, operation) {
    if (value == null) return null;
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) throw new TypeError("Desktop test " + operation + " key is invalid");
    return value;
  }
  function windowBoundsValue(value, operation) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop test " + operation + " requires bounds");
    const output = {};
    for (const name of ["x", "y", "width", "height"]) {
      const item = value[name];
      if (typeof item !== "number" || !Number.isFinite(item)) throw new TypeError("Desktop test " + operation + " requires bounds");
      output[name] = item;
    }
    if (output.width < 1 || output.height < 1) throw new RangeError("Desktop test " + operation + " requires a window at least one point wide and tall");
    return Object.freeze(output);
  }
  function ownedWindow(handle) {
    const record = windowRegistry.get(handle);
    if (!record || record.closed) throw new Error("Desktop test window handle is unknown or already closed");
    return record;
  }
  function windowIdentity(kind, key) {
    for (const record of windowRegistry.values()) {
      if (!record.closed && record.kind === kind && record.key === key) return record;
    }
    return null;
  }
  // A slow consumer never grows the queue: moved and resized carry no payload
  // of their own, so a repeat of one already queued *is* the latest, and the
  // focus pair is collapsed to whichever arrived last. A queue that reached
  // its bound drops its oldest entry rather than the newest, because the
  // newest is the state the window is actually in.
  function publishWindowState(record, state) {
    for (const watcher of record.watchers) {
      if (watcher.closed) continue;
      if ((state === "moved" || state === "resized") && watcher.events.includes(state)) continue;
      watcher.events.push(state);
      if (watcher.events.length > maxWindowStateEvents) watcher.events.shift();
      settleWindowWatcher(watcher);
    }
  }
  function settleWindowWatcher(watcher) {
    if (!watcher.pending || watcher.events.length === 0) return;
    const resolveNext = watcher.pending;
    watcher.pending = null;
    resolveNext(watcher.events.shift());
  }
  function releaseWindowWatcher(watcher) {
    if (watcher.closed) return;
    watcher.closed = true;
    windowWatchers.delete(watcher.handle);
    watcher.owner.watchers.delete(watcher);
    if (watcher.pending) { const resolveNext = watcher.pending; watcher.pending = null; resolveNext(null); }
  }
  function focusWindowRecord(record) {
    for (const other of windowRegistry.values()) {
      if (other === record || other.closed || !other.focused) continue;
      other.focused = false;
      publishWindowState(other, "blurred");
    }
    if (record.focused) return;
    record.focused = true;
    publishWindowState(record, "focused");
  }
  function closeWindowRecord(record) {
    if (record.closed) return false;
    record.closed = true;
    record.focused = false;
    publishWindowState(record, "closed");
    // A closed event is the stream's last, and the stream then drains
    // normally: queued events are still delivered, and the pull that finds the
    // queue empty answers null instead of failing on a released handle.
    for (const watcher of record.watchers) watcher.draining = true;
    return true;
  }
  function openWindowRecord(kind, options) {
    const declared = declaredWindow(kind, "openWindow");
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new TypeError("Desktop test openWindow requires options");
    const key = windowKeyValue(options.key, "openWindow");
    const existing = windowIdentity(kind, key);
    if (existing) {
      focusWindowRecord(existing);
      return existing.handle;
    }
    if (windowRegistry.size >= 256) throw new RangeError("Desktop test host cannot own more than 256 windows");
    const handle = nextWindowHandle++;
    const record = {
      handle,
      kind,
      key,
      bounds: options.bounds == null
        ? Object.freeze({x: 0, y: 0, width: declared.width, height: declared.height})
        : windowBoundsValue(options.bounds, "openWindow"),
      focused: false,
      closed: false,
      watchers: new Set(),
    };
    windowRegistry.set(handle, record);
    focusWindowRecord(record);
    return handle;
  }

  const mainWindowHandle = openWindowRecord(currentWindowKind, {route: "/", key: null, bounds: null});

  async function windowCapability(operation, args) {
    if (operation === "open") return openWindowRecord(args[0], args[1]);
    if (operation === "list") {
      const output = [];
      for (const record of windowRegistry.values()) {
        if (!record.closed) output.push({kind: record.kind, key: record.key, focused: record.focused});
      }
      return output;
    }
    if (operation === "watchNext") {
      const watcher = windowWatchers.get(args[0]);
      if (!watcher) throw new Error("Desktop test window state stream handle is unknown or already released");
      if (watcher.pending) throw new Error("WindowStateStream.next already has an active pull");
      if (watcher.events.length > 0) return watcher.events.shift();
      if (watcher.draining) { releaseWindowWatcher(watcher); return null; }
      return new Promise(resolveNext => { watcher.pending = resolveNext; });
    }
    if (operation === "watchClose") {
      const watcher = windowWatchers.get(args[0]);
      if (!watcher) return false;
      releaseWindowWatcher(watcher);
      return true;
    }
    if (operation === "close") {
      const record = windowRegistry.get(args[0]);
      return record ? closeWindowRecord(record) : false;
    }
    const owned = ownedWindow(args[0]);
    if (operation === "focus") { focusWindowRecord(owned); return null; }
    if (operation === "bounds") return owned.bounds;
    if (operation === "setBounds") {
      const bounds = windowBoundsValue(args[1], "setBounds");
      const moved = bounds.x !== owned.bounds.x || bounds.y !== owned.bounds.y;
      const resized = bounds.width !== owned.bounds.width || bounds.height !== owned.bounds.height;
      owned.bounds = bounds;
      if (moved) publishWindowState(owned, "moved");
      if (resized) publishWindowState(owned, "resized");
      return null;
    }
    if (operation === "display") return display;
    if (operation === "watchStart") {
      if (windowWatchers.size >= 128) throw new RangeError("Desktop test host cannot own more than 128 window state streams");
      const handle = nextWindowWatcherHandle++;
      const watcher = {handle, owner: owned, events: [], pending: null, closed: false, draining: false};
      windowWatchers.set(handle, watcher);
      owned.watchers.add(watcher);
      return handle;
    }
    throw new Error("Unsupported Desktop test window operation '" + operation + "'");
  }

  async function windowTestCapability(operation, args) {
    declaredWindow(args[0], operation + "Window");
    const record = windowIdentity(args[0], windowKeyValue(args[1], operation + "Window"));
    if (!record) throw new Error("Desktop test window '" + args[0] + "' is not open");
    if (operation === "focus") { focusWindowRecord(record); return null; }
    if (operation === "close") { closeWindowRecord(record); return null; }
    if (operation === "move") {
      const bounds = windowBoundsValue(args[2], "moveWindow");
      const resized = bounds.width !== record.bounds.width || bounds.height !== record.bounds.height;
      record.bounds = bounds;
      publishWindowState(record, "moved");
      if (resized) publishWindowState(record, "resized");
      return null;
    }
    throw new Error("Unsupported Desktop test window event '" + operation + "'");
  }

  // The rest of the host surface, reduced to what a browser test can observe.
  // Every grant is asked a second time here, the way the native host asks it a
  // second time: the generated module already refused an ungranted call, and a
  // page that reached the bridge another way is refused again.
