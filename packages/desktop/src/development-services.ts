import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { VelarDesktopConfig } from "./config.ts";

/**
 * The two frames the host and a service exchange before anything else, and the
 * thirty seconds each side waits. They are the same on both sides of the
 * product's life: `packages/desktop/native/macos/VelarDesktopHost.swift` sends
 * them in a packaged application and this file sends them under `velar dev`, so
 * a service written against one is a service that works under the other.
 * `packages/desktop/README.md` is where they are written down for a product to
 * implement against.
 */
export const DESKTOP_SERVICE_HELLO = "service-hello";
export const DESKTOP_SERVICE_READY = "service-ready";
export const DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS = 30_000;
export const DESKTOP_SERVICE_TERMINATION_GRACE_MS = 30_000;
/**
 * The close code a service owes a hello it will not accept: RFC 6455's 1008,
 * "policy violation". It is pinned because "the connection ended" is what a
 * service that has crashed, a service that is still binding its port, and a
 * service that refused the token all look like otherwise — and only the third
 * is a misconfiguration a person has to be told about rather than a start the
 * host should keep retrying.
 */
export const DESKTOP_SERVICE_REFUSED_CLOSE_CODE = 1008;

export interface DesktopDevelopmentService {
  readonly name: string;
  readonly endpoint: string;
  readonly ready: boolean;
}

export interface DesktopDevelopmentServices {
  readonly services: readonly DesktopDevelopmentService[];
  readonly stop: () => Promise<void>;
}

interface RunningService {
  readonly name: string;
  readonly child: ChildProcess;
  readonly port: number;
  readonly token: string;
  exited: boolean;
}

/**
 * `velar dev` runs the same services a packaged application runs, on the system
 * Node this toolchain is itself running on rather than on an embedded runtime a
 * development tree does not have. There is no hot reload: watching a service's
 * sources and rebuilding them is the product's own toolchain, and a dev server
 * that guessed at it would be guessing at the product's build.
 *
 * What it does keep identical is the contract — one loopback endpoint, one
 * 128-bit token, one authenticated handshake — so the service a product debugs
 * here is the service it ships.
 */
export async function startDesktopDevelopmentServices(
  projectRoot: string,
  config: VelarDesktopConfig,
  report: (line: string) => void = () => {},
): Promise<DesktopDevelopmentServices> {
  const names = Object.keys(config.services);
  const running: RunningService[] = [];
  const services: DesktopDevelopmentService[] = [];
  const stop = async (): Promise<void> => {
    await Promise.all(running.map((service) => convergeService(service)));
  };
  try {
    for (const name of names) {
      const declared = config.services[name]!;
      const payload = projectDirectory(projectRoot, declared.payload, `desktop.services.${name}.payload`);
      const entry = join(payload, declared.entry);
      const information = await stat(entry).catch(() => null);
      if (!information?.isFile()) {
        throw new Error(`'desktop.services.${name}.entry' names ${declared.entry}, which is not an ordinary file inside ${declared.payload}`);
      }
      const port = await allocateLoopbackPort();
      const token = randomBytes(16).toString("hex");
      const child = spawn(process.execPath, [entry], {
        cwd: payload,
        // The product's own process, so the product's own environment. A
        // service is not capability-scoped: `desktop.permissions` governs what
        // the renderer may reach, not what the product's process inherits.
        env: { ...process.env, VELAR_SERVICE_ENDPOINT: `127.0.0.1:${port}`, VELAR_SERVICE_TOKEN: token },
        stdio: ["ignore", "inherit", "inherit"],
      });
      const service: RunningService = { name, child, port, token, exited: false };
      child.once("exit", () => { service.exited = true; });
      running.push(service);
      const outcome = await probeReadiness(service);
      services.push({ name, endpoint: `127.0.0.1:${port}`, ready: outcome === "ready" });
      if (outcome === "ready") report(`VelarScript dev service '${name}': ready on 127.0.0.1:${port}\n`);
      else if (outcome === "refused") {
        report(`VelarScript dev service '${name}': refused the token this host issued it on 127.0.0.1:${port} (close ${DESKTOP_SERVICE_REFUSED_CLOSE_CODE}); it is reading something other than VELAR_SERVICE_TOKEN\n`);
      } else {
        report(`VelarScript dev service '${name}': did not answer the authenticated handshake on 127.0.0.1:${port} within ${DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS / 1000}s\n`);
      }
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return Object.freeze({ services: Object.freeze(services), stop });
}

/**
 * What one probe found. `unavailable` is the ordinary case a millisecond after
 * `spawn` — nothing is listening yet — and is worth retrying; `refused` is the
 * service closing the hello with 1008, which is a service that will refuse the
 * same token for the whole of the deadline, so it is worth reporting instead.
 */
export type DesktopServiceHandshake = "ready" | "refused" | "unavailable";

/**
 * Readiness is the handshake, retried until its deadline: a process that has
 * started is not a service until something answers on the endpoint it was
 * given, and an unreachable endpoint right after `spawn` is the normal case.
 * A service that answers 1008 is not slow, though — it read the token and said
 * no — so that ends the probe where it happens rather than thirty seconds later.
 */
async function probeReadiness(service: RunningService): Promise<DesktopServiceHandshake> {
  const deadline = Date.now() + DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.exited) return "unavailable";
    const outcome = await handshake(service.port, service.token);
    if (outcome !== "unavailable") return outcome;
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
  }
  return "unavailable";
}

/**
 * One connection, one hello, one answer, and the connection closed the moment
 * it has one. The probe proves the service authenticates; it is not a channel.
 */
export async function handshake(port: number, token: string): Promise<DesktopServiceHandshake> {
  return new Promise<DesktopServiceHandshake>((settle) => {
    let socket: WebSocket;
    try { socket = new WebSocket(`ws://127.0.0.1:${port}/`); }
    catch { settle("unavailable"); return; }
    let finished = false;
    const finish = (outcome: DesktopServiceHandshake): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* a socket that never opened needs no close */ }
      settle(outcome);
    };
    const timer = setTimeout(() => finish("unavailable"), DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS);
    socket.addEventListener("error", () => finish("unavailable"));
    socket.addEventListener("close", (event) => {
      finish(event.code === DESKTOP_SERVICE_REFUSED_CLOSE_CODE ? "refused" : "unavailable");
    });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ velar: DESKTOP_SERVICE_HELLO, token }));
    });
    socket.addEventListener("message", (event) => {
      let answer: unknown;
      try { answer = JSON.parse(typeof event.data === "string" ? event.data : ""); }
      catch { finish("unavailable"); return; }
      const ready = !!answer && typeof answer === "object" && (answer as Record<string, unknown>).velar === DESKTOP_SERVICE_READY;
      finish(ready ? "ready" : "unavailable");
    });
  });
}

/** SIGTERM, then SIGKILL after the grace period — the packaged host's rule. */
async function convergeService(service: RunningService): Promise<void> {
  if (service.exited || service.child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => service.child.once("exit", () => resolve()));
  service.child.kill("SIGTERM");
  let deadline: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    exited,
    new Promise<void>((resolve) => { deadline = setTimeout(resolve, DESKTOP_SERVICE_TERMINATION_GRACE_MS); }),
  ]);
  clearTimeout(deadline);
  if (!service.exited) {
    service.child.kill("SIGKILL");
    await exited;
  }
}

async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("The loopback endpoint did not report a port");
    return address.port;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function projectDirectory(root: string, value: string, field: string): string {
  if (isAbsolute(value)) throw new Error(`'${field}' must be relative to the project`);
  const path = resolve(root, value);
  const fromRoot = relative(root, path);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith("../") || isAbsolute(fromRoot)) {
    throw new Error(`'${field}' must stay below the project root`);
  }
  return path;
}
