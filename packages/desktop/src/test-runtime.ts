import { DESKTOP_MAIN_WINDOW_KIND, type VelarDesktopConfig } from "./config.ts";
import { DESKTOP_SERVICE_HELLO, DESKTOP_SERVICE_READY, DESKTOP_SERVICE_REFUSED_CLOSE_CODE } from "./development-services.ts";
import { startLoopbackServiceServer, type LoopbackServiceRequest, type LoopbackServiceServer } from "./service-test-server.ts";
import type { FrameworkBrowserTestController } from "@velarscript/compiler/framework-host";
import {
  DESKTOP_BROWSER_TEST_BRIDGE,
  DESKTOP_BROWSER_TEST_FILESYSTEM,
  DESKTOP_BROWSER_TEST_HOST,
  DESKTOP_BROWSER_TEST_HOST_BOUNDS,
  DESKTOP_BROWSER_TEST_OPEN,
  DESKTOP_BROWSER_TEST_SERVICES,
  DESKTOP_BROWSER_TEST_WINDOWS,
} from "./runtime-sources.generated.ts";

export type DesktopTestPlatform = "macos" | "test";

/**
 * One served fake service: a real loopback WebSocket server, and the real
 * authenticated client connection the host would have opened to it. Both halves
 * are real because the point of the seam is to let a test watch a message leave
 * the application, cross a socket, reach a handler, and come back.
 */
interface ServedFakeService {
  readonly server: LoopbackServiceServer;
  readonly socket: WebSocket;
  readonly inbound: string[];
  readonly waiting: ((message: string | null) => void)[];
  pending: LoopbackServiceRequest | null;
  closed: boolean;
}

/**
 * Owns the one pre-navigation choice a Desktop browser test may make. Each
 * test receives a fresh controller, and the choice is sealed when its first
 * `browser.open()` requests the application init script.
 */
export function desktopBrowserTestController(config: VelarDesktopConfig): FrameworkBrowserTestController {
  let platform: DesktopTestPlatform = "test";
  let windowKind: string = DESKTOP_MAIN_WINDOW_KIND;
  let opened = false;
  const served = new Map<string, ServedFakeService>();
  return Object.freeze({
    initScript() {
      opened = true;
      // A service that is already served is a service that already answered the
      // authenticated handshake, so the document opens with it ready. Serving
      // one is therefore a pre-navigation choice like the platform and the
      // window kind, and for the same reason: the page cannot be told about a
      // service by a process it cannot call back into.
      return desktopBrowserTestInitScript(config, platform, windowKind, [...served.keys()]);
    },
    async invoke(capability: string, operation: string, args: readonly unknown[]) {
      if (capability === "service-test") return { handled: true, value: await fakeService(config, served, operation, args) };
      if (capability !== "desktop-test") return { handled: false };
      if (operation === "setPlatform") {
        if (opened) throw new Error("Desktop test platform must be set before the first browser.open()");
        if (args.length !== 1 || args[0] !== "macos" && args[0] !== "test") {
          throw new TypeError("Desktop test platform must be DesktopPlatform.macos or DesktopPlatform.test");
        }
        platform = args[0];
        return { handled: true, value: null };
      }
      // The window a document belongs to is decided before that document
      // exists, exactly as the platform is: a page cannot move itself into
      // another window kind after it has loaded, and neither can its test.
      if (operation === "setWindowKind") {
        if (opened) throw new Error("Desktop test window kind must be set before the first browser.open()");
        if (args.length !== 1 || typeof args[0] !== "string" || !Object.hasOwn(config.windows, args[0])) {
          throw new Error(`Desktop test window kind must be declared in desktop.windows (declared kinds: ${Object.keys(config.windows).join(", ")})`);
        }
        windowKind = args[0];
        return { handled: true, value: null };
      }
      return { handled: false };
    },
  });
}

/**
 * The half of `serveService` that needs real authority: a real listener, a real
 * upgrade, and the real authenticated client connection the native host would
 * have opened. The handler stays in the test's own VelarScript, driven from
 * `velar/desktop-test` through `accept` and `reply`, so what a test writes is a
 * service and what runs is a socket.
 */
async function fakeService(
  config: VelarDesktopConfig,
  served: Map<string, ServedFakeService>,
  operation: string,
  args: readonly unknown[],
): Promise<unknown> {
  const name = args[0];
  if (typeof name !== "string" || !Object.hasOwn(config.services, name)) {
    throw new Error(`Desktop test serveService cannot serve the undeclared service '${String(name)}'; `
      + `declare it under 'desktop.services' (declared services: ${Object.keys(config.services).join(", ") || "none"})`);
  }
  if (operation === "serve") {
    if (served.has(name)) throw new Error(`Desktop test service '${name}' is already served; stopService releases it`);
    const server = await startLoopbackServiceServer();
    const entry: ServedFakeService = {
      server,
      socket: await openAuthenticatedSocket(server.port, server.token),
      inbound: [],
      waiting: [],
      pending: null,
      closed: false,
    };
    entry.socket.addEventListener("message", (event) => {
      const message = typeof event.data === "string" ? event.data : "";
      const next = entry.waiting.shift();
      if (next) next(message);
      else entry.inbound.push(message);
    });
    served.set(name, entry);
    return null;
  }
  const entry = served.get(name);
  if (!entry) throw new Error(`Desktop test service '${name}' is not served; call serveService first`);
  if (operation === "accept") {
    const request = await entry.server.accept();
    if (request === null) return null;
    entry.pending = request;
    return request.message;
  }
  if (operation === "reply") {
    if (typeof args[1] !== "string") throw new TypeError("Desktop test service reply requires text");
    entry.pending?.reply(args[1]);
    entry.pending = null;
    return null;
  }
  if (operation === "roundTrip") {
    if (typeof args[1] !== "string") throw new TypeError("Desktop test service round trip requires text");
    entry.socket.send(args[1]);
    const queued = entry.inbound.shift();
    if (queued !== undefined) return queued;
    return new Promise<string | null>((resolve) => entry.waiting.push(resolve));
  }
  // The proof that the token gates the channel: the same endpoint, a token the
  // host never issued, and a service that closes the connection with the pinned
  // 1008 instead of answering it. The code is part of the assertion, because a
  // dropped connection is what a service that has not finished starting also
  // looks like, and only one of the two is a refusal.
  if (operation === "wrongToken") {
    const refused = entry.server.rejectedHandshakes();
    const code = await refusedHandshakeCloseCode(entry.server.port, `${entry.server.token}00`);
    return code === DESKTOP_SERVICE_REFUSED_CLOSE_CODE && entry.server.rejectedHandshakes() > refused;
  }
  if (operation === "close") {
    entry.closed = true;
    for (const resolve of entry.waiting.splice(0)) resolve(null);
    entry.socket.close();
    await entry.server.close();
    served.delete(name);
    return null;
  }
  throw new Error(`Unsupported Desktop test service operation '${operation}'`);
}

/**
 * The host's side of the handshake, written out once here so that a test proves
 * the same two frames `packages/desktop/README.md` pins and the native host
 * sends.
 */
async function openAuthenticatedSocket(port: number, token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    const failed = (): void => reject(new Error("The fake service refused the handshake"));
    socket.addEventListener("error", failed, { once: true });
    socket.addEventListener("close", failed, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ velar: DESKTOP_SERVICE_HELLO, token }));
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string" && (JSON.parse(event.data) as { velar?: string }).velar === DESKTOP_SERVICE_READY) {
          socket.removeEventListener("error", failed);
          socket.removeEventListener("close", failed);
          resolve();
        } else failed();
      }, { once: true });
    }, { once: true });
  });
  return socket;
}

/**
 * The same hello with a token the host never issued, and the close code the
 * service answered it with. `null` means the connection ended without one,
 * which is exactly the case the pinned code exists to be distinguishable from.
 */
async function refusedHandshakeCloseCode(port: number, token: string): Promise<number | null> {
  return new Promise<number | null>((settle) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
    let finished = false;
    const finish = (code: number | null): void => {
      if (finished) return;
      finished = true;
      settle(code);
    };
    socket.addEventListener("error", () => finish(null), { once: true });
    socket.addEventListener("close", (event) => finish(event.code), { once: true });
    // An answer to a token this service never issued would be the failure this
    // asks about, so a message is a refusal that did not happen.
    socket.addEventListener("message", () => { socket.close(); finish(null); }, { once: true });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ velar: DESKTOP_SERVICE_HELLO, token }));
    }, { once: true });
  });
}

/**
 * Creates the deterministic capability host used by `velar test --browser`.
 * It is intentionally an in-memory filesystem, not a browser polyfill for the
 * operating system. The native worker has a separate integration suite.
 */
export function desktopBrowserTestInitScript(
  config: VelarDesktopConfig,
  platform: DesktopTestPlatform = "test",
  windowKind: string = DESKTOP_MAIN_WINDOW_KIND,
  readyServices: readonly string[] = [],
): string {
  const files = JSON.stringify(config.permissions.files);
  const processes = JSON.stringify(config.permissions.processes);
  const links = JSON.stringify(config.permissions.links);
  const secureStorage = JSON.stringify(config.permissions.secureStorage);
  const notifications = JSON.stringify(config.permissions.notifications);
  const windows = JSON.stringify(config.windows);
  const services = JSON.stringify(Object.keys(config.services));
  const readyNames = JSON.stringify([...readyServices].sort());
  return `${DESKTOP_BROWSER_TEST_OPEN}  const grants = new Set(${files});
  const processGrants = new Set(${processes});
${DESKTOP_BROWSER_TEST_FILESYSTEM}  const windowKinds = ${windows};
  const currentWindowKind = ${JSON.stringify(windowKind)};
${DESKTOP_BROWSER_TEST_WINDOWS}  const linkGrants = new Set(${links});
  const secureStorageGrants = new Set(${secureStorage});
  const notificationsDeclared = ${notifications};
${DESKTOP_BROWSER_TEST_HOST_BOUNDS}  const installedIdentifier = ${JSON.stringify(config.identifier)};
${DESKTOP_BROWSER_TEST_HOST}  const declaredServices = new Set(${services});
  const readyServices = new Set(${readyNames});
${DESKTOP_BROWSER_TEST_SERVICES}    platform: ${JSON.stringify(platform)},
${DESKTOP_BROWSER_TEST_BRIDGE}`;
}
