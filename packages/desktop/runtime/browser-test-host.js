  let installedTeam = null;
  const stagedUpdates = new Map();
  const appliedUpdates = [];
  const keychain = new Map();
  const systemPermissions = new Map();
  const powerWatchers = new Map();
  const dropWatchers = new Map();
  const notificationWatchers = new Map();
  let notificationPermission = "undetermined";
  let powerState = "resumed";
  let nextHostWatcherHandle = 1;

  function hostGrant(condition, operation, declaration) {
    if (!condition) throw new Error("Desktop test " + operation + " requires " + declaration + " in this project's velar.json");
  }
  function hostWatcher(watchers, handle, label) {
    const watcher = watchers.get(handle);
    if (!watcher) throw new Error("Desktop test " + label + " handle is unknown or already released");
    return watcher;
  }
  function startHostWatcher(watchers, label) {
    if (watchers.size >= 128) throw new RangeError("Desktop test host cannot own more than 128 " + label + " streams");
    const handle = nextHostWatcherHandle++;
    watchers.set(handle, {handle, events: [], pending: null});
    return handle;
  }
  function settleHostWatcher(watcher) {
    if (!watcher.pending || watcher.events.length === 0) return;
    const resolveNext = watcher.pending;
    watcher.pending = null;
    resolveNext(watcher.events.shift());
  }
  function nextHostEvent(watchers, handle, label) {
    const watcher = hostWatcher(watchers, handle, label);
    if (watcher.pending) throw new Error(label + ".next already has an active pull");
    if (watcher.events.length > 0) return watcher.events.shift();
    return new Promise(resolveNext => { watcher.pending = resolveNext; });
  }
  function closeHostWatcher(watchers, handle) {
    const watcher = watchers.get(handle);
    if (!watcher) return false;
    watchers.delete(handle);
    if (watcher.pending) { const resolveNext = watcher.pending; watcher.pending = null; resolveNext(null); }
    return true;
  }
  // Power is a transition stream: the machine is either asleep or awake, so a
  // state it is already in publishes nothing. A queue at its bound drops its
  // oldest entry, because the newest is the state the machine is actually in.
  function publishPower(state) {
    if (state === powerState) return null;
    powerState = state;
    for (const watcher of powerWatchers.values()) {
      watcher.events.push(state);
      if (watcher.events.length > maxHostEvents) watcher.events.shift();
      settleHostWatcher(watcher);
    }
    return null;
  }
  // A dropped-files stream is one batch deep. A gesture that arrives while a
  // batch is still waiting is appended to it in gesture order, so a slow
  // consumer sees the two drops as one drop rather than losing either. The
  // batch is bounded, and a merge that would pass the bound drops the oldest
  // paths in it — the newest gesture is the one the user just made.
  function publishDroppedFiles(paths) {
    for (const watcher of dropWatchers.values()) {
      const merged = watcher.events.length > 0 ? watcher.events[0].paths.concat(paths) : [...paths];
      while (merged.length > maxDroppedPaths || textUnits(merged) > maxDroppedTextUnits) merged.shift();
      watcher.events.length = 0;
      watcher.events.push(Object.freeze({paths: Object.freeze(merged)}));
      settleHostWatcher(watcher);
    }
    return null;
  }
  function textUnits(values) {
    let units = 0;
    for (const value of values) units += value.length;
    return units;
  }
  // Two activations of the same notification are one activation, so a tag
  // already queued is not queued twice; a queue at its bound drops its oldest.
  function publishActivation(tag) {
    for (const watcher of notificationWatchers.values()) {
      if (watcher.events.some(event => event.tag === tag)) continue;
      watcher.events.push(Object.freeze({tag}));
      if (watcher.events.length > maxHostEvents) watcher.events.shift();
      settleHostWatcher(watcher);
    }
    return null;
  }
  function notificationName(value, operation) {
    if (value == null) return null;
    if (typeof value !== "string" || value.length === 0 || value.length > 128) throw new TypeError("Desktop test " + operation + " tag is invalid");
    return value;
  }
  function storageName(value, operation) {
    if (typeof value !== "string" || !secureStorageGrants.has(value)) {
      throw new Error("Desktop test " + operation + " cannot reach the undeclared secure storage name '" + String(value)
        + "'; declare it under 'desktop.permissions.secureStorage' (declared names: "
        + ([...secureStorageGrants].join(", ") || "none") + ")");
    }
    return value;
  }

  async function notificationCapability(operation, args) {
    hostGrant(notificationsDeclared, operation, "'notifications: true' under 'desktop.permissions'");
    if (operation === "requestPermission") return notificationPermission;
    if (operation === "show") {
      // The operating system's answer is the second gate, and a notification it
      // never authorized fails rather than being quietly dropped.
      if (notificationPermission !== "granted") {
        throw new Error("Desktop test show cannot deliver a notification the operating system has not authorized (permission: " + notificationPermission + ")");
      }
      const value = args[0];
      if (!value || typeof value !== "object" || typeof value.title !== "string" || typeof value.body !== "string"
        || value.title.length === 0 || value.title.length > 256 || value.body.length === 0 || value.body.length > 1024) {
        throw new TypeError("Desktop test show requires a bounded notification");
      }
      if (notificationInbox.length >= 256) throw new RangeError("Desktop test host cannot hold more than 256 notifications");
      notificationInbox.push(Object.freeze({title: value.title, body: value.body, tag: notificationName(value.tag, "show")}));
      return null;
    }
    if (operation === "watchStart") return startHostWatcher(notificationWatchers, "NotificationActivationStream");
    if (operation === "watchNext") return nextHostEvent(notificationWatchers, args[0], "NotificationActivationStream");
    if (operation === "watchClose") return closeHostWatcher(notificationWatchers, args[0]);
    throw new Error("Unsupported Desktop test notification operation '" + operation + "'");
  }

  async function secureStorageCapability(operation, args) {
    const name = storageName(args[0], operation);
    if (operation === "set") {
      const value = args[1];
      if (typeof value !== "string") throw new TypeError("Desktop test set requires a text value");
      if (new TextEncoder().encode(value).byteLength > maxSecureStorageValueBytes) throw new RangeError("Desktop test set cannot store more than 8 KiB");
      keychain.set(name, value);
      return null;
    }
    if (operation === "get") return keychain.has(name) ? keychain.get(name) : null;
    if (operation === "remove") { keychain.delete(name); return null; }
    throw new Error("Unsupported Desktop test secure storage operation '" + operation + "'");
  }

  async function desktopHostSurface(operation, args) {
    if (operation === "openExternal") {
      const url = args[0];
      if (typeof url !== "string" || url.length === 0 || url.length > 2048) throw new TypeError("Desktop test openExternal requires a bounded URL");
      let scheme;
      try { scheme = new URL(url).protocol.slice(0, -1); }
      catch { throw new TypeError("Desktop test openExternal requires an absolute URL"); }
      hostGrant(linkGrants.has(scheme), "openExternal", "the '" + scheme + "' scheme under 'desktop.permissions.links'");
      if (openedLinks.length >= 256) throw new RangeError("Desktop test host cannot record more than 256 opened links");
      openedLinks.push(url);
      return null;
    }
    // The same four questions the native host asks, asked here so a browser test
    // can drive the whole refusal matrix. The native copy is in
    // packages/desktop/native/macos/VelarDesktopHost.swift; the two must not
    // drift, and the wording below is deliberately the wording there.
    if (operation === "applyUpdate") {
      const archivePath = args[0];
      if (typeof archivePath !== "string" || archivePath.length === 0 || archivePath[0] !== "/" || archivePath.length > 4096) {
        throw new TypeError("Desktop test applyUpdate requires a bounded absolute archive path");
      }
      if (installedTeam === null) {
        throw new Error("Desktop applyUpdate refuses to update an application signed with no Team ID. "
          + "This install is ad-hoc or unsigned, so there is no signing identity an update could be required to match, "
          + "and accepting one anyway would accept every archive. Install a Developer ID signed build to update in place.");
      }
      const update = stagedUpdates.get(archivePath);
      if (!update) throw new Error("Desktop applyUpdate archive does not identify an ordinary file");
      if (update.bundleIdentifier !== installedIdentifier) {
        throw new Error("Desktop applyUpdate refuses an archive whose bundle identifier is '" + update.bundleIdentifier
          + "' and not '" + installedIdentifier + "'");
      }
      if (update.teamIdentifier === null) throw new Error("Desktop applyUpdate refuses an archive signed with no Team ID");
      if (update.teamIdentifier !== installedTeam) {
        throw new Error("Desktop applyUpdate refuses an archive signed by Team ID '" + update.teamIdentifier + "' and not '" + installedTeam + "'");
      }
      if (appliedUpdates.length >= 64) throw new RangeError("Desktop test host cannot record more than 64 applied updates");
      appliedUpdates.push(archivePath);
      return null;
    }
    if (operation === "displays") return [display];
    if (operation === "permissionStatus") {
      const kind = args[0];
      if (kind !== "screenRecording" && kind !== "accessibility" && kind !== "microphone") {
        throw new TypeError("Desktop test permissionStatus requires a SystemPermission value");
      }
      return systemPermissions.get(kind) ?? "undetermined";
    }
    if (operation === "powerWatchStart") return startHostWatcher(powerWatchers, "PowerStream");
    if (operation === "powerWatchNext") return nextHostEvent(powerWatchers, args[0], "PowerStream");
    if (operation === "powerWatchClose") return closeHostWatcher(powerWatchers, args[0]);
    if (operation === "dropWatchStart") {
      hostGrant(droppedFilesGranted, "watchDroppedFiles", "the 'dropped' root in 'desktop.permissions.files'");
      return startHostWatcher(dropWatchers, "DroppedFilesStream");
    }
    if (operation === "dropWatchNext") return nextHostEvent(dropWatchers, args[0], "DroppedFilesStream");
    if (operation === "dropWatchClose") return closeHostWatcher(dropWatchers, args[0]);
    return undefined;
  }

  async function hostTestCapability(capability, operation, args) {
    if (capability === "notification-test") {
      if (operation === "setPermission") {
        if (args[0] !== "granted" && args[0] !== "denied" && args[0] !== "undetermined") {
          throw new TypeError("Desktop test setNotificationPermission requires a NotificationPermission value");
        }
        notificationPermission = args[0];
        return null;
      }
      if (operation === "shown") return notificationInbox.map(item => ({title: item.title, body: item.body, tag: item.tag}));
      if (operation === "activate") return publishActivation(notificationName(args[0], "activateNotification"));
      throw new Error("Unsupported Desktop test notification event '" + operation + "'");
    }
    if (capability === "secure-storage-test") {
      if (operation === "names") return [...keychain.keys()].sort();
      throw new Error("Unsupported Desktop test secure storage event '" + operation + "'");
    }
    if (operation === "publishPower") {
      if (args[0] !== "suspended" && args[0] !== "resumed") throw new TypeError("Desktop test publishPower requires a PowerState value");
      return publishPower(args[0]);
    }
    if (operation === "dropFiles") {
      hostGrant(droppedFilesGranted, "dropFiles", "the 'dropped' root in 'desktop.permissions.files'");
      const paths = args[0];
      if (!Array.isArray(paths) || paths.length === 0 || paths.length > maxDroppedPaths
        || paths.some(path => typeof path !== "string" || path.length === 0 || path[0] !== "/" || path.length > 4096 || path.includes("\0"))) {
        throw new TypeError("Desktop test dropFiles requires a non-empty bounded list of absolute paths");
      }
      return publishDroppedFiles(paths);
    }
    if (operation === "setSystemPermission") {
      if (args[0] !== "screenRecording" && args[0] !== "accessibility" && args[0] !== "microphone") {
        throw new TypeError("Desktop test setSystemPermission requires a SystemPermission value");
      }
      if (args[1] !== "granted" && args[1] !== "denied" && args[1] !== "undetermined") {
        throw new TypeError("Desktop test setSystemPermission requires a PermissionStatus value");
      }
      systemPermissions.set(args[0], args[1]);
      return null;
    }
    if (operation === "openedLinks") return [...openedLinks];
    // The two halves of the update identity check a test controls: what this
    // install was signed by, and what an archive on disk claims to be. Neither
    // is a value the application can read — a program cannot ask its own host
    // for its Team ID — so they exist here and nowhere in velar/desktop.
    if (operation === "setSigningTeam") {
      if (args[0] !== null && (typeof args[0] !== "string" || !/^[A-Z0-9]{2,32}$/u.test(args[0]))) {
        throw new TypeError("Desktop test setSigningTeam requires an Apple Team ID or none");
      }
      installedTeam = args[0];
      return null;
    }
    if (operation === "stageUpdate") {
      const archivePath = args[0];
      if (typeof archivePath !== "string" || archivePath.length === 0 || archivePath[0] !== "/" || archivePath.length > 4096) {
        throw new TypeError("Desktop test stageUpdate requires a bounded absolute archive path");
      }
      if (typeof args[1] !== "string" || args[1].length === 0 || args[1].length > 256) {
        throw new TypeError("Desktop test stageUpdate requires the archived application's bundle identifier");
      }
      if (args[2] !== null && (typeof args[2] !== "string" || !/^[A-Z0-9]{2,32}$/u.test(args[2]))) {
        throw new TypeError("Desktop test stageUpdate requires an Apple Team ID or none");
      }
      if (stagedUpdates.size >= 64) throw new RangeError("Desktop test host cannot stage more than 64 update archives");
      stagedUpdates.set(archivePath, {bundleIdentifier: args[1], teamIdentifier: args[2]});
      return null;
    }
    if (operation === "appliedUpdates") return [...appliedUpdates];
    throw new Error("Desktop test capability '" + capability + "' has no operation '" + operation + "'");
  }

  // The page's side of the service channel. It is deliberately the same shape
  // the native host presents — the renderer holds a handle and never a socket —
  // and the frames it carries are pumped over a real loopback WebSocket by
  // 'velar/desktop-test.serveService' in the test process. The renderer never
  // opens a socket in production either: the host dials, so a fake that opened
  // one from the page would be modelling the wrong architecture.
