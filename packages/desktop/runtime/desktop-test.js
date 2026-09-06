const runtimeKey = Symbol.for("velar.browser.test.v1");
// The same 4 KiB bound the host applies to a service's captured stderr, so a
// detail a test can write is a detail a service could actually have produced.
const maxServiceDetailBytes = 4 * 1024;
// The same bound ServiceConnection.send puts on a frame, so a frame a test can
// push is a frame the transport could actually have carried.
const maxServicePushBytes = 8 * 1024 * 1024;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const reflectApply = Reflect.apply;
function invoke(capability, operation, args, timeout) {
  // The controller replaces this runtime for every isolated browser test, so
  // this test-only module deliberately resolves one data-only snapshot per
  // call instead of retaining a previous test's Page authority.
  const runtimeDescriptor = getOwnPropertyDescriptor(globalThis, runtimeKey);
  if (!runtimeDescriptor || !("value" in runtimeDescriptor) || !runtimeDescriptor.value || typeof runtimeDescriptor.value !== "object") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  const runtime = runtimeDescriptor.value;
  const invokeDescriptor = getOwnPropertyDescriptor(runtime, "frameworkInvoke");
  if (!invokeDescriptor || !("value" in invokeDescriptor) || typeof invokeDescriptor.value !== "function") {
    throw new Error("velar/desktop-test requires 'velar test --browser'");
  }
  return reflectApply(invokeDescriptor.value, runtime, [capability, operation, args, timeout]);
}
export async function setPlatform(value) {
  if (value !== "macos" && value !== "test") throw new TypeError("Desktop test setPlatform requires a DesktopPlatform value");
  const result = await invoke("desktop-test", "setPlatform", [value], 30000);
  if (result !== null) throw new TypeError("Desktop test host returned an invalid platform setup result");
  return null;
}
export async function appDataDirectory() {
  const value = await invoke("desktop", "appDataDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute app-data path");
  return value;
}
export async function projectDirectory() {
  const value = await invoke("desktop", "projectDirectory", [], 30000);
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new TypeError("Desktop test host returned an invalid absolute project path");
  return value;
}
export async function makeDirectory(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test makeDirectory requires a bounded path");
  const value = await invoke("fs", "makeDirectory", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid directory result");
  return null;
}
export async function readText(path, maxBytes) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test readText requires a bounded path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new RangeError("Desktop test readText maxBytes is outside its supported bounds");
  const value = await invoke("fs", "readText", [path, maxBytes], 30000);
  if (typeof value !== "string") throw new TypeError("Desktop test host returned invalid file text");
  return value;
}
export async function writeText(path, text) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test writeText requires a bounded path");
  if (typeof text !== "string") throw new TypeError("Desktop test writeText requires text");
  const value = await invoke("fs", "writeText", [path, text], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid write result");
  return null;
}
export async function removeFile(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) throw new TypeError("Desktop test removeFile requires a bounded path");
  const value = await invoke("fs", "removeFile", [path], 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid remove result");
  return null;
}
// The declared kinds live in the manifest, and the fake registry answers from
// them, so this bounds the argument and lets the registry refuse an undeclared
// kind by name rather than restating the manifest's own naming rule here.
function testWindowKind(value, operation) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("Desktop test " + operation + " requires a declared window kind");
  }
  return value;
}
function testWindowKey(value, operation) {
  if (value == null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new TypeError("Desktop test " + operation + " key must be at most 128 characters of letters, digits, '.', '_', ':' or '-'");
  }
  return value;
}
function testWindowBounds(value, operation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop test " + operation + " requires WindowBounds");
  const output = {};
  for (const name of ["x", "y", "width", "height"]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor?.enumerable || !("value" in descriptor) || typeof descriptor.value !== "number" || !Number.isFinite(descriptor.value)) {
      throw new TypeError("Desktop test " + operation + " requires WindowBounds");
    }
    output[name] = descriptor.value;
  }
  return output;
}
export async function setWindowKind(kind) {
  const result = await invoke("desktop-test", "setWindowKind", [testWindowKind(kind, "setWindowKind")], 30000);
  if (result !== null) throw new TypeError("Desktop test host returned an invalid window kind setup result");
  return null;
}
export async function openWindows() {
  const value = await invoke("window", "list", [], 30000);
  if (!Array.isArray(value) || value.length > 256) throw new TypeError("Desktop test host returned an invalid window list");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object" || typeof item.focused !== "boolean") throw new TypeError("Desktop test host returned invalid window information");
    output[output.length] = Object.freeze({
      kind: testWindowKind(item.kind, "openWindows"),
      key: testWindowKey(item.key, "openWindows"),
      focused: item.focused,
    });
  }
  return output;
}
async function windowEvent(operation, args) {
  const value = await invoke("window-test", operation, args, 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid " + operation + " result");
  return null;
}
export async function focusWindow(kind, key = null) {
  return windowEvent("focus", [testWindowKind(kind, "focusWindow"), testWindowKey(key, "focusWindow")]);
}
export async function moveWindow(kind, key, bounds) {
  return windowEvent("move", [testWindowKind(kind, "moveWindow"), testWindowKey(key, "moveWindow"), testWindowBounds(bounds, "moveWindow")]);
}
export async function closeWindow(kind, key = null) {
  return windowEvent("close", [testWindowKind(kind, "closeWindow"), testWindowKey(key, "closeWindow")]);
}
// Each real capability's test seam is that capability's own name with '-test'
// after it. The Desktop one is split by *when* rather than by what: the
// pre-navigation choices above are answered by the browser-test controller,
// and the host events below fall through to the page's fake host, because a
// controller that does not handle an operation hands it on.
function testBoundedText(value, operation, field, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\0")) {
    throw new TypeError("Desktop test " + operation + " " + field + " must be text of at most " + maximum + " characters");
  }
  return value;
}
function testOptionalTag(value, operation) {
  if (value == null) return null;
  return testBoundedText(value, operation, "tag", 128);
}
async function testSettle(capability, operation, args, name) {
  const value = await invoke(capability, operation, args, 30000);
  if (value !== null) throw new TypeError("Desktop test host returned an invalid " + name + " result");
  return null;
}
async function testTextList(capability, operation, name, maximum) {
  const value = await invoke(capability, operation, [], 30000);
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError("Desktop test host returned an invalid " + name + " list");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    output[output.length] = testBoundedText(value[index], name, "entry", 4096);
  }
  return output;
}
export async function setNotificationPermission(permission) {
  if (permission !== "granted" && permission !== "denied" && permission !== "undetermined") {
    throw new TypeError("Desktop test setNotificationPermission requires a NotificationPermission value");
  }
  return testSettle("notification-test", "setPermission", [permission], "setNotificationPermission");
}
export async function shownNotifications() {
  const value = await invoke("notification-test", "shown", [], 30000);
  if (!Array.isArray(value) || value.length > 256) throw new TypeError("Desktop test host returned an invalid notification inbox");
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") throw new TypeError("Desktop test host returned an invalid notification");
    output[output.length] = Object.freeze({
      title: testBoundedText(item.title, "shownNotifications", "title", 256),
      body: testBoundedText(item.body, "shownNotifications", "body", 1024),
      tag: testOptionalTag(item.tag, "shownNotifications"),
    });
  }
  return output;
}
export async function activateNotification(tag = null) {
  return testSettle("notification-test", "activate", [testOptionalTag(tag, "activateNotification")], "activateNotification");
}
const servedServices = new Map();
function testServiceName(value, operation) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    throw new TypeError("Desktop test " + operation + " requires a declared service name");
  }
  return value;
}
/**
 * The transitions a real supervisor publishes, including the detail it attaches
 * to the two states that carry one. A detail on any other state is refused here
 * rather than dropped: a test that wrote one and saw it vanish would be reading
 * a stream that does not behave like the host's.
 */
export async function setServiceState(name, state, detail = null) {
  if (state !== "starting" && state !== "ready" && state !== "restarting" && state !== "failed" && state !== "stopped") {
    throw new TypeError("Desktop test setServiceState requires a ServiceState value");
  }
  if (detail !== null) {
    if (typeof detail !== "string") throw new TypeError("Desktop test setServiceState requires text or none for the failure detail");
    if (state !== "failed" && state !== "restarting") {
      throw new Error("Desktop test setServiceState carries a failure detail only for the 'failed' and 'restarting' states, not '" + state + "'");
    }
    if (__velarUtf8ByteLength(detail) > maxServiceDetailBytes) {
      throw new RangeError("Desktop test setServiceState detail cannot exceed 4 KiB");
    }
  }
  return testSettle("service-fake", "setState", [testServiceName(name, "setServiceState"), state, detail], "setServiceState");
}
/**
 * The push leg of the service envelope. serveService's handler answers a
 * question the application asked; this emits a frame nobody asked for, which is
 * what a streaming service actually does — a downstream token, a progress
 * notice, a cache invalidation. Without it a browser test can only exercise the
 * half of an ingestion path that replies reach.
 *
 * The frame is addressed by service name rather than by connection, because a
 * push is not a reply and carries no request to be correlated with. Every open
 * connect() to that service receives it, in push order, at its next next()
 * — pushing to a connection that has none pending queues the frame rather than
 * dropping it, exactly as a delivered reply does.
 *
 * The answer is how many connections took it. A push before the application
 * connected reaches nobody and answers 0, which is a real ordering mistake in a
 * test and is worth being able to see rather than having to infer from a
 * next() that never settles.
 */
export async function pushService(name, message) {
  const service = testServiceName(name, "pushService");
  if (typeof message !== "string") throw new TypeError("Desktop test pushService requires text");
  if (__velarUtf8ByteLength(message) > maxServicePushBytes) {
    throw new RangeError("Desktop test pushService message cannot exceed 8 MiB");
  }
  const value = await invoke("service-fake", "push", [service, message], 30000);
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Desktop test host returned an invalid pushService result");
  return value;
}
/**
 * Starts a real loopback WebSocket server for this service and pumps the
 * application's channel through it: what the page sends leaves over a socket,
 * reaches the handler here, and comes back the same way. The service is reported
 * ready, because a served service is one that answered the authenticated
 * handshake — which is exactly what readiness means in the packaged host.
 */
export async function serveService(name, handler) {
  const service = testServiceName(name, "serveService");
  if (typeof handler !== "function") throw new TypeError("Desktop test serveService requires a handler");
  // The host is asked first, because the host is the authority on whether this
  // service is served and this module is not. The host controller is rebuilt
  // for every test; servedServices below is module state that every test in the
  // file shares. Guarding on the module state made an earlier test's failure
  // permanent: a test that failed before its stopService left the name
  // registered here and unknown there, and every later serveService in the file
  // was refused for a service nothing was actually serving.
  await testSettle("service-test", "serve", [service], "serveService");
  // The host accepted, so anything still registered under this name belongs to
  // a test that has already ended. Its pumps are aimed at a controller that no
  // longer exists, so they are stopped rather than left spinning.
  const abandoned = servedServices.get(service);
  if (abandoned) {
    abandoned.stop();
    servedServices.delete(service);
  }
  let running = true;
  // The service half: what arrives on the real socket is handed to the test's
  // own handler, and its answer goes back out the same socket.
  const handlerPump = (async () => {
    while (running) {
      let request;
      try { request = await invoke("service-test", "accept", [service], 0); }
      catch { return; }
      if (request === null) return;
      let reply;
      try { reply = await handler(request); }
      catch { reply = ""; }
      try { await invoke("service-test", "reply", [service, typeof reply === "string" ? reply : ""], 30000); }
      catch { return; }
    }
  })();
  // The application half: what the page sent goes out over the real socket, and
  // the real answer is delivered back into the page. It tolerates a document
  // that does not exist yet, because a service is served before the first
  // browser.open() and a page appears only afterwards.
  const channelPump = (async () => {
    while (running) {
      let outbound;
      try { outbound = await invoke("service-fake", "poll", [service], 0); }
      catch {
        await new Promise(resolve => setTimeout(resolve, 50));
        continue;
      }
      if (outbound == null) continue;
      let reply;
      try { reply = await invoke("service-test", "roundTrip", [service, outbound.message], 0); }
      catch { return; }
      if (typeof reply !== "string") return;
      try { await invoke("service-fake", "deliver", [outbound.connection, reply], 30000); }
      catch { return; }
    }
  })();
  servedServices.set(service, {
    stop() { running = false; },
    settled: Promise.all([handlerPump, channelPump]),
  });
  return null;
}
/**
 * The token is the whole authentication of a loopback channel every process on
 * the machine can reach, so a test can watch the service side refuse one that
 * is not the host's.
 */
export async function serviceRejectsWrongToken(name) {
  const value = await invoke("service-test", "wrongToken", [testServiceName(name, "serviceRejectsWrongToken")], 30000);
  if (typeof value !== "boolean") throw new TypeError("Desktop test host returned an invalid handshake refusal result");
  return value;
}
/**
 * Releases a served service: the real server closes, both pumps settle, and the
 * application sees the service stopped. A test owns the work it starts, and the
 * pumps are work, so this is how a test hands it back.
 */
export async function stopService(name) {
  const service = testServiceName(name, "stopService");
  const served = servedServices.get(service);
  // The registration is released first, and unconditionally. servedServices
  // is module state, so it is shared by every test in the file, while the host
  // controller behind close is rebuilt for each one. A stop that threw after
  // the pumps were already told to stop used to leave the name registered
  // forever: serveService then refused it as "already served", and the
  // stopService that would have cleared it threw first at "is not served" --
  // so one failing test turned every later service test in the file red. The
  // deleted entry is kept in served so the pumps are still awaited below.
  if (served) {
    served.stop();
    servedServices.delete(service);
  }
  try { await testSettle("service-test", "close", [service], "stopService"); }
  finally { if (served) await served.settled; }
  try { await setServiceState(service, "stopped"); }
  catch { /* the document a state event would reach may already be gone */ }
  return null;
}
// Names only. The fake keychain holds values the way the real one does, and
// neither hands one back through a test seam.
export async function secureStorageNames() {
  return testTextList("secure-storage-test", "names", "secureStorageNames", 64);
}
export async function publishPower(state) {
  if (state !== "suspended" && state !== "resumed") throw new TypeError("Desktop test publishPower requires a PowerState value");
  return testSettle("desktop-test", "publishPower", [state], "publishPower");
}
export async function dropFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 4096) {
    throw new TypeError("Desktop test dropFiles requires a non-empty bounded List<string> of absolute paths");
  }
  const output = [];
  for (let index = 0; index < paths.length; index += 1) {
    const path = testBoundedText(paths[index], "dropFiles", "path", 4096);
    if (path[0] !== "/") throw new TypeError("Desktop test dropFiles requires absolute paths");
    output[output.length] = path;
  }
  return testSettle("desktop-test", "dropFiles", [output], "dropFiles");
}
export async function setSystemPermission(kind, status) {
  if (kind !== "screenRecording" && kind !== "accessibility" && kind !== "microphone") {
    throw new TypeError("Desktop test setSystemPermission requires a SystemPermission value");
  }
  if (status !== "granted" && status !== "denied" && status !== "undetermined") {
    throw new TypeError("Desktop test setSystemPermission requires a PermissionStatus value");
  }
  return testSettle("desktop-test", "setSystemPermission", [kind, status], "setSystemPermission");
}
export async function openedLinks() {
  return testTextList("desktop-test", "openedLinks", "openedLinks", 256);
}
// The two halves of the identity applyUpdate checks. Neither is readable by a
// program — an application cannot ask what Team ID signed it — so they exist
// only here, where a test states what the install is and what an archive claims
// to be, and then watches the same four refusals the native host produces.
function testTeamIdentifier(value, operation) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Z0-9]{2,32}$/u.test(value)) {
    throw new TypeError("Desktop test " + operation + " requires an Apple Team ID of uppercase letters and digits, or none");
  }
  return value;
}
export async function setSigningTeam(team = null) {
  return testSettle("desktop-test", "setSigningTeam", [testTeamIdentifier(team, "setSigningTeam")], "setSigningTeam");
}
export async function stageUpdate(archivePath, bundleIdentifier, team = null) {
  const path = testBoundedText(archivePath, "stageUpdate", "archive path", 4096);
  if (path[0] !== "/") throw new TypeError("Desktop test stageUpdate requires an absolute archive path");
  return testSettle("desktop-test", "stageUpdate", [
    path,
    testBoundedText(bundleIdentifier, "stageUpdate", "bundle identifier", 256),
    testTeamIdentifier(team, "stageUpdate"),
  ], "stageUpdate");
}
export async function appliedUpdates() {
  return testTextList("desktop-test", "appliedUpdates", "appliedUpdates", 64);
}
