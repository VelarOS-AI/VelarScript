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
      const ready = await probeReadiness(service);
      services.push({ name, endpoint: `127.0.0.1:${port}`, ready });
      report(ready
        ? `VelarScript dev service '${name}': ready on 127.0.0.1:${port}\n`
        : `VelarScript dev service '${name}': did not answer the authenticated handshake on 127.0.0.1:${port} within ${DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS / 1000}s\n`);
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return Object.freeze({ services: Object.freeze(services), stop });
}

/**
 * Readiness is the handshake, retried until its deadline: a process that has
 * started is not a service until something answers on the endpoint it was
 * given, and a refused connection right after `spawn` is the normal case.
 */
async function probeReadiness(service: RunningService): Promise<boolean> {
  const deadline = Date.now() + DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (service.exited) return false;
    if (await handshake(service.port, service.token)) return true;
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
  }
  return false;
}

/**
 * One connection, one hello, one answer, and the connection closed the moment
 * it has one. The probe proves the service authenticates; it is not a channel.
 */
export async function handshake(port: number, token: string): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    let socket: WebSocket;
    try { socket = new WebSocket(`ws://127.0.0.1:${port}/`); }
    catch { settle(false); return; }
    let finished = false;
    const finish = (accepted: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* a socket that never opened needs no close */ }
      settle(accepted);
    };
    const timer = setTimeout(() => finish(false), DESKTOP_SERVICE_HANDSHAKE_TIMEOUT_MS);
    socket.addEventListener("error", () => finish(false));
    socket.addEventListener("close", () => finish(false));
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ velar: DESKTOP_SERVICE_HELLO, token }));
    });
    socket.addEventListener("message", (event) => {
      let answer: unknown;
      try { answer = JSON.parse(typeof event.data === "string" ? event.data : ""); }
      catch { finish(false); return; }
      finish(!!answer && typeof answer === "object" && (answer as Record<string, unknown>).velar === DESKTOP_SERVICE_READY);
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
