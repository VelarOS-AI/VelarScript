import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { desktopSigningPlan } from "../packages/desktop/src/signing.ts";
import { velarCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { handshake } from "../packages/desktop/src/development-services.ts";

// L3 — product service processes.
//
// The acceptance the spec asks for, in the order it asks for it: the declared
// and undeclared matrix, a token the host never issued refused by the service
// side, a readiness timeout, the restart backoff and its terminal state, SIGTERM
// convergence and the SIGKILL deadline, and one real round trip in each of the
// two forms an application runs in.
//
// The service side of every case is `tests/fixtures/desktop/service/main.js`, a
// real dependency-free WebSocket server. Nothing here simulates a socket.

const cli = resolve("packages/cli/src/cli.ts");
const serviceFixture = resolve("tests/fixtures/desktop/service/main.js");

interface FixtureProject {
  readonly root: string;
  readonly directory: string;
}

async function makeServiceProject(label: string): Promise<FixtureProject> {
  const directory = await mkdtemp(join(tmpdir(), `velar-desktop-services-${label}-`));
  const root = join(directory, "app");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  for (const name of ["compiler", "core", "web", "node", "desktop", "cli"]) {
    await symlink(resolve("packages", name), join(directory, "node_modules", "@velarscript", name), "dir");
  }
  await writeFile(join(directory, "package.json"), JSON.stringify({ name: "services-fixture", version: "0.1.0", private: true, type: "module" }), "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist/renderer",
    extensions: ["@velarscript/desktop"],
    desktop: {
      productName: "Velar Service Fixture",
      identifier: "dev.velarscript.services",
      windows: { main: { width: 900, height: 640 } },
      services: {
        // Two policies, because a restart policy that is never contrasted is a
        // field nothing proves.
        notes: { payload: "service-notes", entry: "main.js", restart: "always" },
        once: { payload: "service-once", entry: "main.js", restart: "never" },
      },
      permissions: { files: ["app-data"] },
    },
  }, null, 2), "utf8");
  await writeFile(join(root, "src", "main.vel"), `
import {connect, watchServices} from "velar/service"

component App:
    state detail: string = "idle"

    action ask():
        using channel = await connect("notes")
        await channel.send("ping")
        detail = (await channel.next()) ?? ""

    action watch():
        using states = await watchServices()
        const event = await states.next()
        detail = event == null ? "none" : f"{event.name}:{event.state}"

    return <main>
        <button on:click={ask}>Ask</button>
        <button on:click={watch}>Watch</button>
        <p>{detail}</p>
    </main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");
  for (const payload of ["service-notes", "service-once"]) {
    await mkdir(join(root, payload), { recursive: true });
    await cp(serviceFixture, join(root, payload, "main.js"));
  }
  return { root, directory };
}

test("a service name and payload are checked where they are declared", async () => {
  const project = await makeServiceProject("manifest");
  try {
    const manifest = join(project.root, "velar.json");
    const original = await readFile(manifest, "utf8");
    const write = async (services: unknown): Promise<void> => {
      const value = JSON.parse(original) as { desktop: Record<string, unknown> };
      value.desktop.services = services;
      await writeFile(manifest, JSON.stringify(value, null, 2), "utf8");
    };
    for (const [services, expected] of [
      [{ Notes: { payload: "service-notes", entry: "main.js" } }, /must be lowercase words joined by single hyphens/u],
      [{ notes: { payload: "/etc", entry: "main.js" } }, /must be a project directory, not an absolute or escaping path/u],
      [{ notes: { payload: "service-notes", entry: "../escape.js" } }, /must be a path inside the payload directory/u],
      [{ notes: { payload: "service-notes", entry: "main.sh" } }, /must be a JavaScript file/u],
      [{ notes: { payload: "service-notes", entry: "main.js", restart: "sometimes" } }, /must be one of 'always', 'never'/u],
      [{ notes: { payload: "service-notes", entry: "main.js", command: "node" } }, /unknown 'desktop\.services\.notes' field 'command'/u],
      [Object.fromEntries(Array.from({ length: 9 }, (_value, index) => [`service-${"abcdefghi"[index]}`, { payload: "service-notes", entry: "main.js" }])),
        /cannot declare more than 8 services/u],
    ] as const) {
      await write(services);
      await assert.rejects(resolveVelarProject(project.root), expected, JSON.stringify(services));
    }
    await writeFile(manifest, original, "utf8");
    const resolved = await resolveVelarProject(project.root);
    const config = resolved.extensionConfig.get("@velarscript/desktop") as { services: Record<string, unknown> };
    // Sorted keys, defaulted policy: the packaged `desktop.json` is byte-stable
    // for the same reason the window map is.
    assert.deepEqual(config.services, {
      notes: { payload: "service-notes", entry: "main.js", restart: "always" },
      once: { payload: "service-once", entry: "main.js", restart: "never" },
    });

    // An application that reaches for the module without declaring a service is
    // told so once, at the import, because every export of it is refused.
    const value = JSON.parse(original) as { desktop: Record<string, unknown> };
    delete value.desktop.services;
    await writeFile(manifest, JSON.stringify(value, null, 2), "utf8");
    const checked = spawnSync(process.execPath, [cli, "check"], { cwd: project.root, encoding: "utf8" });
    assert.equal(checked.status, 1, checked.stdout);
    assert.match(checked.stderr + checked.stdout, /imports 'velar\/service' but desktop\.services declares no service/u);
  } finally {
    await rm(project.directory, { recursive: true, force: true });
  }
});

test("a service payload's native code is signed before the runtime that loads it", () => {
  const plan = desktopSigningPlan({
    applicationBundle: "/tmp/Example.app",
    nestedCode: [
      { path: "Contents/Resources/services/notes/native/deep/probe.node", entitlements: null },
      { path: "Contents/Resources/services/notes/probe.dylib", entitlements: null },
      { path: "Contents/MacOS/node", entitlements: "/tmp/runtime.entitlements" },
    ],
    executable: "Contents/MacOS/VelarDesktopHost",
    identity: null,
    entitlements: null,
  });
  // Inside-out, and a service payload's own code is the deepest thing in the
  // bundle: it is signed before the runtime that loads it, which is signed
  // before the host, which is signed before the bundle.
  assert.deepEqual(plan.map((step) => step.label), [
    "Contents/Resources/services/notes/native/deep/probe.node",
    "Contents/Resources/services/notes/probe.dylib",
    "Contents/MacOS/node",
    "Contents/MacOS/VelarDesktopHost",
    "application bundle",
    "verify",
  ]);
});

test("a declared service connects and an undeclared one is refused at the call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-service-module-"));
  const bridgeKey = Symbol.for("velar.desktop.bridge.v1");
  const calls: { operation: string; args: readonly unknown[] }[] = [];
  const watchAnswers: unknown[] = [];
  try {
    const bridge = {
      invoke(_capability: string, operation: string, args: readonly unknown[]) {
        calls.push({ operation, args });
        if (operation === "connect") return Promise.resolve(7);
        if (operation === "send") return Promise.resolve(null);
        if (operation === "receive") return Promise.resolve("pong");
        if (operation === "state") return Promise.resolve("open");
        if (operation === "closeInfo") return Promise.resolve({ code: 1000, reason: "done" });
        if (operation === "close") return Promise.resolve(true);
        if (operation === "watchStart") return Promise.resolve(3);
        // Scripted one event at a time, because the interesting cases are what
        // arrives *in* an event rather than how many arrive.
        if (operation === "watchNext") return Promise.resolve(watchAnswers.shift() ?? { name: "notes", state: "ready", detail: null });
        if (operation === "watchClose") return Promise.resolve(true);
        throw new Error(`unexpected service operation '${operation}'`);
      },
    };
    Object.defineProperty(globalThis, bridgeKey, { value: bridge, configurable: true });
    const source = velarCompilerExtension.modules?.source?.("velar/service", {
      services: { notes: { payload: "service-notes", entry: "main.js", restart: "always" } },
    });
    assert.ok(source, "velar/service must be generated from the project's declared services");
    const path = join(directory, "service.mjs");
    await writeFile(path, source, "utf8");
    const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as {
      ServiceState: { values(): string[] };
      ServiceConnection: { is(value: unknown): boolean };
      ServiceStateStream: { is(value: unknown): boolean };
      ServiceClose: { is(value: unknown): boolean };
      ServiceStateEvent: { is(value: unknown): boolean };
      connect(name: string): Promise<{
        state(): Promise<string>;
        send(message: string): Promise<null>;
        next(): Promise<string | null>;
        closeInfo(): Promise<{ code: number; reason: string }>;
        close(code?: number, reason?: string): Promise<null>;
      }>;
      watchServices(): Promise<{ next(): Promise<unknown>; close(): Promise<null> }>;
    };

    // Undeclared: refused where it is written, with the manifest field that
    // would declare it, and nothing reaches the host.
    await assert.rejects(
      module.connect("terminal"),
      /undeclared service 'terminal'.*desktop\.services.*declared services: notes/su,
    );
    assert.equal(calls.length, 0, "an undeclared service name must never reach the host");

    assert.deepEqual(module.ServiceState.values(), ["starting", "ready", "restarting", "failed", "stopped"]);
    const channel = await module.connect("notes");
    assert.equal(module.ServiceConnection.is(channel), true);
    assert.equal(await channel.state(), "open");
    assert.equal(await channel.send("ping"), null);
    assert.equal(await channel.next(), "pong");
    assert.equal(module.ServiceClose.is(await channel.closeInfo()), true);
    // The channel's own bounds are the client's, checked before anything leaves.
    await assert.rejects(channel.send(42 as unknown as string), /requires text/u);
    await assert.rejects(channel.close(999), /from 1000 through 4999/u);
    await assert.rejects(channel.close(1000, "x".repeat(200)), /123 UTF-8 bytes/u);
    assert.equal(await channel.close(), null);
    // Releasing twice is the state it is already in, not an error.
    assert.equal(await channel.close(), null);

    const states = await module.watchServices();
    assert.equal(module.ServiceStateStream.is(states), true);
    const event = await states.next();
    assert.equal(module.ServiceStateEvent.is(event), true);
    // Three fields, always: a state that did not fail carries a null detail
    // rather than an absent one, so an application reads one shape.
    assert.deepEqual(event, { name: "notes", state: "ready", detail: null });

    // A failure quotes the service. The text is the host's to produce and this
    // module's only to bound — it is never parsed here.
    watchAnswers.push({ name: "notes", state: "failed", detail: "Error: listen EADDRINUSE 127.0.0.1:51000" });
    assert.deepEqual(await states.next(), {
      name: "notes", state: "failed", detail: "Error: listen EADDRINUSE 127.0.0.1:51000",
    });

    // A detail on a state that did not fail, and a detail past the 4 KiB bound,
    // are both a host this module does not recognise rather than something it
    // passes through to the application.
    watchAnswers.push({ name: "notes", state: "ready", detail: "all is well" });
    await assert.rejects(states.next(), /attached a failure detail to the 'ready' state/u);
    const reopened = await module.watchServices();
    watchAnswers.push({ name: "notes", state: "failed", detail: "x".repeat(4097) });
    await assert.rejects(reopened.next(), /invalid service failure detail/u);

    assert.equal(await states.close(), null);

    // A project with no services at all still loads the module — D60 rule 153 —
    // and refuses every call by name.
    const ungranted = velarCompilerExtension.modules?.source?.("velar/service", { services: {} });
    const ungrantedPath = join(directory, "ungranted.mjs");
    await writeFile(ungrantedPath, ungranted!, "utf8");
    const closed = await import(`${pathToFileURL(ungrantedPath).href}?test=${Date.now()}`) as {
      connect(name: string): Promise<unknown>;
      watchServices(): Promise<unknown>;
    };
    await assert.rejects(closed.connect("notes"), /declared services: none/u);
    await assert.rejects(closed.watchServices(), /requires at least one service under 'desktop\.services'/u);
  } finally {
    delete (globalThis as { [key: symbol]: unknown })[bridgeKey];
    await rm(directory, { recursive: true, force: true });
  }
});

/**
 * One packaged fixture, built once and reused: `velar package` is the expensive
 * part of every case below, and the behaviours differ by what the service does
 * rather than by what was packaged.
 */
let packaged: Promise<FixtureProject> | null = null;

async function packagedFixture(): Promise<FixtureProject> {
  packaged ??= (async () => {
    const project = await makeServiceProject("packaged");
    const result = spawnSync(process.execPath, [cli, "package"], { cwd: project.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return project;
  })();
  return packaged;
}

const deprivation = resolve("tests/fixtures/desktop/no-external-node.sb");

/**
 * `deprived` is the same run on a machine stripped of every Node the
 * application could borrow — `env -i` with a PATH that holds none, and a sandbox
 * profile that denies the three package-manager roots the host falls back to. A
 * service that starts there started on the interpreter the bundle carries.
 */
function smoke(
  project: FixtureProject,
  mode: string,
  logDirectory: string,
  deprived = false,
): { status: number | null; stdout: string; stderr: string } {
  const host = join(project.root, "dist", "desktop", "Velar Service Fixture.app", "Contents", "MacOS", "VelarDesktopHost");
  const environment = { VELAR_DESKTOP_PROJECT_ROOT: project.root, FIXTURE_SERVICE_MODE: mode, FIXTURE_SERVICE_LOG_DIR: logDirectory };
  if (!deprived) return spawnSync(host, ["--headless-smoke"], { encoding: "utf8", env: { ...process.env, ...environment } });
  return spawnSync("/usr/bin/sandbox-exec", [
    "-f", deprivation,
    "/usr/bin/env", "-i", `HOME=${process.env.HOME ?? ""}`, "PATH=/usr/bin",
    ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    host, "--headless-smoke",
  ], { encoding: "utf8" });
}

async function serviceLog(directory: string, name: string): Promise<string[]> {
  try { return (await readFile(join(directory, `${name}.log`), "utf8")).trimEnd().split("\n").filter(Boolean); }
  catch { return []; }
}

function running(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

test("a packaged application carries, weighs and starts its declared services", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await packagedFixture();
  const output = join(project.root, "dist", "desktop");
  const application = join(output, "Velar Service Fixture.app");

  // The payload is copied whole, one directory per service.
  const servicesRoot = join(application, "Contents", "Resources", "services");
  assert.deepEqual((await readdir(servicesRoot)).sort(), ["notes", "once"]);
  assert.deepEqual((await readdir(join(servicesRoot, "notes"))).sort(), ["main.js"]);

  const manifest = JSON.parse(await readFile(join(output, "velar-desktop-build.json"), "utf8")) as {
    services: { name: string; entry: string; restart: string; bytes: number; entrySha256: string }[];
    sizes: { servicesBytes: number; applicationBytes: number; hostBytes: number; rendererBytes: number; capabilityHostBytes: number; metadataBytes: number };
  };
  assert.deepEqual(manifest.services.map((service) => [service.name, service.entry, service.restart]), [
    ["notes", "main.js", "always"],
    ["once", "main.js", "never"],
  ]);
  assert.equal(manifest.services[0]!.entrySha256, manifest.services[1]!.entrySha256);
  assert.match(manifest.services[0]!.entrySha256, /^[0-9a-f]{64}$/u);
  // A payload is application code, so it is a named component inside the budget
  // and the components still sum to the application.
  assert.ok(manifest.sizes.servicesBytes > 0, JSON.stringify(manifest.sizes));
  assert.equal(manifest.sizes.servicesBytes, manifest.services[0]!.bytes + manifest.services[1]!.bytes);
  const sizes = manifest.sizes;
  assert.equal(sizes.hostBytes + sizes.rendererBytes + sizes.capabilityHostBytes + sizes.servicesBytes + sizes.metadataBytes, sizes.applicationBytes);

  // The host reads the entry and the policy, never the project path that
  // produced the payload.
  const hostConfig = JSON.parse(await readFile(join(application, "Contents", "Resources", "desktop.json"), "utf8")) as {
    services: Record<string, { entry: string; restart: string; payload?: unknown } | undefined>;
  };
  assert.deepEqual(hostConfig.services, {
    notes: { entry: "main.js", restart: "always" },
    once: { entry: "main.js", restart: "never" },
  });
  assert.equal(Object.hasOwn(hostConfig.services.notes ?? {}, "payload"), false);

  const verification = spawnSync(join(application, "Contents", "MacOS", "VelarDesktopHost"), ["--verify-bundle"], {
    encoding: "utf8",
    env: { ...process.env, VELAR_DESKTOP_PROJECT_ROOT: project.root },
  });
  assert.equal(verification.status, 0, verification.stderr);
  assert.deepEqual((JSON.parse(verification.stdout) as { services: string[] }).services, ["notes", "once"]);
});

test("the packaged smoke starts each service, authenticates, reaches ready, and converges", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await packagedFixture();
  const logs = await mkdtemp(join(tmpdir(), "velar-service-log-"));
  try {
    for (const deprived of [false, true]) {
      const round = await mkdtemp(join(logs, "round-"));
      const accepted = smoke(project, "answer", round, deprived);
      assert.equal(accepted.status, 0, `${deprived ? "deprived" : "ordinary"}: ${accepted.stderr}`);
      const report = JSON.parse(accepted.stdout) as { runtime: string; services: { name: string; state: string }[] };
      assert.deepEqual(report.services, [{ name: "notes", state: "ready" }, { name: "once", state: "ready" }]);
      assert.equal(report.runtime.endsWith("/Contents/MacOS/node"), true, report.runtime);

      // The service's own record of what happened to it: started once, the
      // handshake accepted, and SIGTERM delivered — the whole of the spec's
      // "start, authenticate, ready, converge" round, seen from the other side.
      for (const name of ["notes", "once"]) {
        const lines = await serviceLog(round, name);
        assert.equal(lines.filter((line) => line.startsWith("start ")).length, 1, `${name}: ${lines.join(" | ")}`);
        assert.equal(lines.includes("hello accepted"), true, `${name}: ${lines.join(" | ")}`);
        assert.equal(lines.includes("terminated"), true, `${name}: ${lines.join(" | ")}`);
        const started = lines.find((line) => line.startsWith("start "))!;
        assert.equal(running(Number(started.split(" ")[2])), false, `${name} outlived the host that started it`);
      }
    }
  } finally {
    await rm(logs, { recursive: true, force: true });
  }
});

test("a service that ignores SIGTERM is killed when its grace period ends", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await packagedFixture();
  const logs = await mkdtemp(join(tmpdir(), "velar-service-log-"));
  try {
    const started = Date.now();
    const accepted = smoke(project, "stubborn", logs);
    const elapsed = Date.now() - started;
    assert.equal(accepted.status, 0, accepted.stderr);
    // The grace is thirty seconds and it is real: the host waited it out before
    // reaching for SIGKILL, and it did not wait for ever.
    assert.ok(elapsed >= 30_000 && elapsed < 90_000, `convergence took ${elapsed}ms`);
    for (const name of ["notes", "once"]) {
      const lines = await serviceLog(logs, name);
      assert.equal(lines.includes("ignored SIGTERM"), true, `${name}: ${lines.join(" | ")}`);
      const start = lines.find((line) => line.startsWith("start "))!;
      assert.equal(running(Number(start.split(" ")[2])), false, `${name} survived its SIGKILL`);
    }
  } finally {
    await rm(logs, { recursive: true, force: true });
  }
});

test("a crashing service backs off to a terminal state, and 'never' does not restart at all", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await packagedFixture();
  const logs = await mkdtemp(join(tmpdir(), "velar-service-log-"));
  // The host's own capture, which is a real path under the real app-data root
  // rather than a fixture directory: it is what a person opens after the fact,
  // so the test opens the same file.
  const hostLogs = join(homedir(), "Library", "Application Support", "dev.velarscript.services", "service-logs");
  await rm(hostLogs, { recursive: true, force: true });
  try {
    const started = Date.now();
    const refused = smoke(project, "exit", logs);
    const elapsed = Date.now() - started;
    assert.equal(refused.status, 1, refused.stdout);
    // The failure names the state *and* what the service said on its way down,
    // with the carriage return the service wrote dropped: a detail an
    // application shows a person must not be able to rewrite the line it is
    // shown on. `once` never failed at anything, so it carries no detail.
    assert.match(
      refused.stderr,
      /every declared service settled without becoming ready \(notes=failed: Error: notes refused to start {5}at main\.js, once=stopped\)/u,
      refused.stderr,
    );
    // 1 + 2 + 4 + 8 seconds of backoff before the fifth failure is terminal, so
    // the run cannot have been faster than the backoff it is supposed to apply.
    assert.ok(elapsed >= 15_000, `the backoff took only ${elapsed}ms`);
    assert.equal((await serviceLog(logs, "notes")).filter((line) => line.startsWith("start ")).length, 5);
    assert.equal((await serviceLog(logs, "once")).filter((line) => line.startsWith("start ")).length, 1);

    // The whole of each service's output went to its own log file, byte for
    // byte: the 4 KiB detail summarises one failure, and this is the record of
    // all five.
    const captured = await readFile(join(hostLogs, "notes.log"), "utf8");
    assert.equal(captured.split("Error: notes refused to start").length - 1, 5, captured);
    assert.equal(captured.includes("\r"), true, "the log keeps the bytes the service actually wrote");
    assert.deepEqual((await readdir(hostLogs)).sort(), ["notes.log", "once.log"]);
  } finally {
    await rm(logs, { recursive: true, force: true });
  }
});

/**
 * `velar dev` runs the same services on the system Node. The handshake it
 * performs is the same one the packaged host performs, so the round trip below
 * is the second of the two forms the spec asks to see it in.
 */
async function freePort(): Promise<number> {
  const server = createServer();
  try {
    await new Promise<void>((settle, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => settle());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    return address.port;
  } finally {
    await new Promise<void>((settle) => server.close(() => settle()));
  }
}

async function runDevelopmentServer(
  project: FixtureProject,
  mode: string,
  logs: string,
  probe: (output: string) => Promise<void> = async () => {},
): Promise<{ output: string; pids: number[] }> {
  const child = spawn(process.execPath, [cli, "dev", "--port", String(await freePort())], {
    cwd: project.root,
    env: { ...process.env, FIXTURE_SERVICE_MODE: mode, FIXTURE_SERVICE_LOG_DIR: logs },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { output += chunk; });
  child.stderr.on("data", (chunk: string) => { output += chunk; });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !/dev server: http/u.test(output) && child.exitCode === null) {
    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
  }
  await probe(output);
  const pids: number[] = [];
  for (const name of ["notes", "once"]) {
    for (const line of await serviceLog(logs, name)) {
      if (line.startsWith("start ")) pids.push(Number(line.split(" ")[2]));
    }
  }
  child.kill("SIGTERM");
  await exited;
  return { output, pids };
}

test("velar dev starts the declared services, authenticates them, and converges them", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await makeServiceProject("dev");
  const logs = await mkdtemp(join(tmpdir(), "velar-service-log-"));
  try {
    // While the services are up, the same endpoint is offered a token the host
    // never issued. The service side closes the connection with the pinned 1008
    // instead of answering it, which is what makes the token's authority a fact
    // rather than a claim — and what makes a refusal distinguishable from a
    // service that has not finished starting.
    let refused: string | null = null;
    const { output, pids } = await runDevelopmentServer(project, "answer", logs, async (running) => {
      const port = Number(/dev service 'notes': ready on 127\.0\.0\.1:(\d+)/u.exec(running)?.[1]);
      assert.ok(Number.isSafeInteger(port), running);
      refused = await handshake(port, "0".repeat(32));
    });
    // The endpoint is host-assigned and the handshake is real: a service is
    // reported ready only after it answered `service-ready` to a token it was
    // given in its environment.
    assert.match(output, /VelarScript dev service 'notes': ready on 127\.0\.0\.1:\d+/u, output);
    assert.match(output, /VelarScript dev service 'once': ready on 127\.0\.0\.1:\d+/u, output);
    assert.equal(refused, "refused", "a token the host never issued must be closed with 1008, not merely dropped");
    assert.equal((await serviceLog(logs, "notes")).includes("hello refused 1008"), true);
    for (const name of ["notes", "once"]) {
      assert.equal((await serviceLog(logs, name)).includes("hello accepted"), true, name);
    }
    assert.equal(pids.length, 2, output);
    // Nothing the dev server started outlives it.
    for (const pid of pids) assert.equal(running(pid), false, `service ${pid} outlived velar dev`);
  } finally {
    await rm(logs, { recursive: true, force: true });
    await rm(project.directory, { recursive: true, force: true });
  }
});

test("a service that never answers the handshake is reported as not ready", async (context) => {
  if (process.platform !== "darwin") return context.skip("the Desktop host is macOS-only in 0.10");
  const project = await makeServiceProject("dev-silent");
  const logs = await mkdtemp(join(tmpdir(), "velar-service-log-"));
  try {
    const { output, pids } = await runDevelopmentServer(project, "silent", logs);
    // The token was accepted, so this is not a connection failure: the service
    // is running, reachable, and never said it was ready, and thirty seconds is
    // where the host stops waiting.
    assert.equal((await serviceLog(logs, "notes")).includes("hello accepted"), true);
    assert.match(output, /VelarScript dev service 'notes': did not answer the authenticated handshake on 127\.0\.0\.1:\d+ within 30s/u, output);
    for (const pid of pids) assert.equal(running(pid), false, `service ${pid} outlived velar dev`);
  } finally {
    await rm(logs, { recursive: true, force: true });
    await rm(project.directory, { recursive: true, force: true });
  }
});

test.after(async () => {
  const project = await packaged?.catch(() => null);
  if (project) await rm(project.directory, { recursive: true, force: true });
});
