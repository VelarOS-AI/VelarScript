import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit, type Browser, type BrowserServer, type BrowserType } from "playwright";
import { prepareExternalPreview } from "../scripts/prepare-external-preview.mjs";
import {
  boundedBrowserOperation,
  exitBrowserWorker,
  observeBrowserWorkerParent,
  superviseBrowserWorker,
  terminateBrowserServer,
} from "../packages/cli/src/browser-process-owner.ts";
import { verifyProductionBuild } from "../packages/cli/src/production-verifier.ts";
import { startProductionPreview, type ProductionPreviewHandle } from "../packages/cli/src/preview-server.ts";

type TrackedServer = Server & { velarUpgradedSockets?: Set<Duplex> };
interface ActiveBrowser {
  readonly server: BrowserServer;
  browser: Browser | null;
  closing: Promise<void> | null;
}

class BrowserAcceptanceInterrupted extends Error {
  readonly exitCode: number;

  constructor(signal: "SIGHUP" | "SIGINT" | "SIGTERM", exitCode: number) {
    super(`Browser acceptance interrupted by ${signal}`);
    this.name = "BrowserAcceptanceInterrupted";
    this.exitCode = exitCode;
  }
}

const root = fileURLToPath(new URL("..", import.meta.url));
const browserAcceptanceWorkerEnvironment = "VELAR_BROWSER_ACCEPTANCE_WORKER_V1";
if (process.env[browserAcceptanceWorkerEnvironment] === "1" && typeof process.send === "function") {
  const stopObservingParent = observeBrowserWorkerParent();
  let code = 0;
  try { await runBrowserAcceptance(); }
  catch (error) {
    code = error instanceof BrowserAcceptanceInterrupted ? error.exitCode : 1;
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  }
  stopObservingParent();
  await exitBrowserWorker(code);
} else {
  process.exitCode = await superviseBrowserWorker({
    executable: process.execPath,
    arguments: [fileURLToPath(import.meta.url)],
    cwd: root,
    environment: { ...process.env, [browserAcceptanceWorkerEnvironment]: "1" },
    deadlineMs: 20 * 60_000,
    cleanupTimeoutMs: 10_000,
  });
}

async function runBrowserAcceptance(): Promise<void> {
  const appPort = await availablePort();
  let devServer: ChildProcess | null = null;
  let staticServer: Server | null = null;
  let realtimeServer: Server | null = null;
  let externalPreview: ProductionPreviewHandle | null = null;
  const activeBrowsers = new Set<ActiveBrowser>();
  const activeChildren = new Set<ChildProcess>();
  const productionDirectory = await mkdtemp(join(tmpdir(), "velar-browser-production-"));
  const externalPreviewRoot = await mkdtemp(join(tmpdir(), "velar-browser-external-preview-"));
  let rejectInterruption!: (error: BrowserAcceptanceInterrupted) => void;
  const interruption = new Promise<never>((_resolve, reject) => { rejectInterruption = reject; });
  void interruption.catch(() => {});
  let interrupted: BrowserAcceptanceInterrupted | null = null;
  const stop = (error: BrowserAcceptanceInterrupted): void => {
    if (interrupted !== null) return;
    interrupted = error;
    rejectInterruption(error);
  };
  const onHangup = (): void => stop(new BrowserAcceptanceInterrupted("SIGHUP", 129));
  const onInterrupt = (): void => stop(new BrowserAcceptanceInterrupted("SIGINT", 130));
  const onTerminate = (): void => stop(new BrowserAcceptanceInterrupted("SIGTERM", 143));
  process.once("SIGHUP", onHangup);
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  let scenarioFailed = false;
  let scenarioFailure: unknown;
  try {
    const scenario = async (): Promise<void> => {
      const realtimePort = await availablePort();
      realtimeServer = await startRealtimeServer(realtimePort);
      devServer = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", "examples/production-web", "--port", String(appPort)], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const devOutput = collectOutput(devServer);
      await waitFor(() => devOutput.text.includes("VelarScript dev server:"), 8_000, () => devOutput.text);

      const baseUrl = `http://127.0.0.1:${appPort}/app/`;
      const status = await (await fetch(`${baseUrl}__velar/status`)).json() as {
        apiVersion: string;
        ready: boolean;
        notices: readonly string[];
        compilation: { moduleCount: number; compiledModules: number };
      };
      assert.equal(status.apiVersion, "0.10");
      assert.equal(status.ready, true);
      assert.deepEqual(status.notices, []);
      assert.ok(status.compilation.moduleCount >= 5);
      assert.equal(status.compilation.compiledModules, status.compilation.moduleCount);

      const browsers: Array<{ readonly name: string; readonly type: BrowserType }> = [
        { name: "Chromium", type: chromium },
        { name: "Firefox", type: firefox },
        { name: "WebKit", type: webkit },
      ];
      for (const browser of browsers) {
        await boundedBrowserOperation(acceptBrowser(`Dev ${browser.name}`, browser.type, baseUrl, false, realtimePort, activeBrowsers), 180_000, `Dev ${browser.name} acceptance`, interruption);
      }
      await stopChild(devServer);
      devServer = null;

      await run(process.execPath, ["packages/cli/src/cli.ts", "build", "examples/production-web", "--out-dir", productionDirectory], activeChildren);
      const staticPort = await availablePort();
      staticServer = await startStaticServer(productionDirectory, "/app/", staticPort);
      const productionUrl = `http://127.0.0.1:${staticPort}/app/`;
      for (const browser of browsers) {
        await boundedBrowserOperation(acceptBrowser(`Production ${browser.name}`, browser.type, productionUrl, true, realtimePort, activeBrowsers), 180_000, `Production ${browser.name} acceptance`, interruption);
      }
      const externalDirectory = join(externalPreviewRoot, "site");
      await prepareExternalPreview(externalDirectory);
      externalPreview = await startProductionPreview(await verifyProductionBuild(externalDirectory), 0);
      await boundedBrowserOperation(acceptExternalPreview(externalPreview, activeBrowsers), 120_000, "External preview Chromium acceptance", interruption);
      process.stdout.write(`VelarScript development and CSP production browser matrices passed\n`);
    };
    await Promise.race([scenario(), interruption]);
  } catch (error) {
    scenarioFailed = true;
    scenarioFailure = error;
  } finally {
    process.off("SIGHUP", onHangup);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
    const ownerCleanup = await Promise.allSettled([
      ...[...activeBrowsers].map(closeBrowserOwner),
      ...[...activeChildren].map(stopChild),
      stopChild(devServer),
      closeServer(staticServer),
      closeServer(realtimeServer),
      closeProductionPreview(externalPreview),
    ]);
    const storageCleanup = await Promise.allSettled([
      rm(productionDirectory, { recursive: true, force: true }),
      rm(externalPreviewRoot, { recursive: true, force: true }),
    ]);
    if (!scenarioFailed) {
      const cleanupFailure = [...ownerCleanup, ...storageCleanup].find((result) => result.status === "rejected");
      if (cleanupFailure?.status === "rejected") {
        scenarioFailed = true;
        scenarioFailure = cleanupFailure.reason;
      }
    }
  }
  if (scenarioFailed) throw scenarioFailure;
}

async function acceptExternalPreview(preview: ProductionPreviewHandle, active: Set<ActiveBrowser>): Promise<void> {
  const owner: ActiveBrowser = {
    server: await chromium.launchServer({ headless: true, timeout: 30_000 }),
    browser: null,
    closing: null,
  };
  active.add(owner);
  try {
    owner.browser = await chromium.connect(owner.server.wsEndpoint(), { timeout: 30_000 });
    const browser = owner.browser;
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") failures.push(`${message.type()}: ${message.text()}`);
    });
    const response = await page.goto(preview.url, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200);
    assert.match(response?.headers()["content-security-policy"] ?? "", /script-src 'self'/u);
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator("h1").textContent(), "VelarScript Release Studio");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://velar.example/");
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), "/share.svg");
    assert.equal((await page.request.get(new URL("share.svg", preview.url).href)).status(), 200);
    assert.equal((await page.request.get(new URL("assets/missing.js", preview.url).href)).status(), 404);
    await page.getByRole("link", { name: "About" }).click();
    await page.waitForURL("**/about");
    assert.equal(await page.locator("h1").textContent(), "About");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").textContent(), "About");
    assert.deepEqual(failures, [], `External preview Chromium: ${failures.join("\n")}`);
    process.stdout.write("✓ External preview Chromium\n");
  } finally {
    await closeBrowserOwner(owner);
    active.delete(owner);
  }
}

async function acceptBrowser(
  name: string,
  browserType: BrowserType,
  baseUrl: string,
  production: boolean,
  realtimePort: number,
  active: Set<ActiveBrowser>,
): Promise<void> {
  const owner: ActiveBrowser = {
    server: await browserType.launchServer({ headless: true, timeout: 30_000 }),
    browser: null,
    closing: null,
  };
  active.add(owner);
  try {
    owner.browser = await browserType.connect(owner.server.wsEndpoint(), { timeout: 30_000 });
    const browser = owner.browser;
    const page = await browser.newPage();
    const failures: string[] = [];
    let uploadRequests = 0;
    await page.route("**/api/upload", async (route) => {
      const request = route.request();
      assert.equal(request.method(), "POST");
      assert.match(request.headers()["content-type"] ?? "", /^multipart\/form-data; boundary=/u);
      const body = request.postDataBuffer()?.toString("utf8") ?? "";
      assert.match(body, /name="label"/u);
      assert.match(body, /release-studio/u);
      assert.match(body, /name="asset"; filename="velar\.txt"/u);
      uploadRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ fileName: "velar.txt", label: "release-studio", size: 14 }),
      });
    });
    page.on("pageerror", (error) => failures.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") failures.push(`${message.type()}: ${message.text()}`);
    });

    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (production) assert.match(response?.headers()["content-security-policy"] ?? "", /script-src 'self'/u);
    assert.equal(await page.locator("h1").textContent(), "VelarScript Release Studio");
    assert.equal(new URL(page.url()).pathname, "/app/");
    assert.equal(await page.title(), "VelarScript Release Studio");
    assert.equal(await page.locator('meta[name="description"]').getAttribute("content"), "VelarScript 0.10 Web platform application");
    assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://velar.example/app/");
    assert.equal(await page.locator('meta[name="robots"]').getAttribute("content"), "index,follow");
    assert.equal(await page.locator('meta[property="og:image"]').getAttribute("content"), "/app/share.svg");
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#0b1020");
    assert.equal(await page.locator(".status-badge").textContent(), "Theme: system");
    assert.equal(await page.locator("[data-format]").textContent(), "Vel value: 42 items · en-US: 1.5 / 2.5 · class number/en-US: 3.5 / 4.5");
    assert.equal(await page.getByRole("progressbar").count(), 8);
    assert.equal(await page.locator('[data-project="parser"] strong').textContent(), "Parser");
    assert.equal(await page.locator('[data-project="velar-integration"] strong').textContent(), "VelarScript Integration");
    assert.equal(await page.locator('.metrics .metric:first-child .value').textContent(), "8");
    await page.waitForFunction(() => document.querySelector("[data-database]")?.textContent === "database-ready");
    assert.equal(await page.locator("[data-browser]").textContent(), "/app/");
    assert.equal(await page.locator("[data-route]").textContent(), "/");
    assert.match(await page.locator("[data-environment]").textContent() ?? "", /^online\/visible\/(?:dark|light)$/u);
    assert.equal(await page.locator("[data-session]").textContent(), "session-ready");
    await page.waitForFunction(() => document.querySelector("[data-frame]")?.textContent === "frame-ready");
    assert.equal(await page.locator("[data-frame]").textContent(), "frame-ready");
    assert.equal(await page.locator("[data-layout]").textContent(), "measured");
    assert.equal(await page.locator("[data-error]").textContent(), "VelarScript recovery ready");
    assert.equal(await page.locator("[data-recovery]").textContent(), "finalized");
    assert.equal(await page.locator("[data-remainder]").textContent(), "3");
    assert.equal(await page.locator("[data-set]").textContent(), "4:set-ready");
    assert.equal(await page.locator("[data-config]").textContent(), "/api:preview:recovery");
    await page.waitForFunction(() => document.querySelector("[data-timer]")?.textContent === "after-ready:every-ready");
    await page.locator("[data-event-input]").fill("Velar");
    await page.waitForFunction(() => document.querySelector("[data-input-event]")?.textContent !== "none");
    await page.locator("[data-event-input]").press("Enter");
    await page.waitForFunction(() => document.querySelector("[data-keyboard-event]")?.textContent === "Enter");
    await page.locator("[data-pointer-probe]").click();
    await page.waitForFunction(() => document.querySelector("[data-pointer-event]")?.textContent === "mouse");
    await page.waitForFunction(() => document.querySelector("[data-resource]")?.textContent === "Resource recovery ready");
    assert.equal(await page.locator("[data-runtime-error]").textContent(), "resource:Resource recovery ready");
    await page.locator("[data-resource-retry]").click();
    await page.waitForFunction(() => document.querySelector("[data-resource]")?.textContent === "resource-ready");
    await page.locator("[data-action-retry]").click();
    await page.waitForFunction(() => document.querySelector("[data-action]")?.textContent === "Action recovery ready");
    assert.equal(await page.locator("[data-runtime-error]").textContent(), "action:Action recovery ready");
    await page.locator("[data-action-retry]").click();
    await page.waitForFunction(() => document.querySelector("[data-action]")?.textContent === "action-ready");
    await page.waitForFunction(() => document.querySelector("[data-log]")?.textContent === "Runtime configured");
    assert.equal(await page.locator("[data-render-stable]").textContent(), "render-stable");
    assert.match(await page.locator("[data-time]").textContent() ?? "", /^\d{4}-\d{2}-\d{2}T/u);

    await page.getByRole("button", { name: "Fail event safely" }).click();
    await page.waitForFunction(() => document.querySelector("[data-runtime-error]")?.textContent === "event:Event recovery ready");
    await page.getByRole("button", { name: "Fail render safely" }).click();
    await page.waitForFunction(() => document.querySelector("[data-runtime-error]")?.textContent === "render:Render recovery ready");
    assert.equal(await page.locator("[data-render-stable]").textContent(), "render-stable");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose text file" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "velar.txt", mimeType: "text/plain", buffer: Buffer.from("VelarScript file API") });
    await page.waitForFunction(() => document.querySelector("[data-file-text]")?.textContent === "VelarScript file API");
    assert.equal(await page.locator("[data-file]").textContent(), "velar.txt");
    await page.waitForFunction(() => document.querySelector("[data-upload]")?.textContent === "release-studio:velar.txt:14");
    assert.equal(uploadRequests, 1);

    if (!production) {
      await page.locator("[data-realtime-socket-url]").fill(`ws://127.0.0.1:${realtimePort}/socket`);
      await page.locator("[data-realtime-events-url]").fill(`http://127.0.0.1:${realtimePort}/events`);
      await page.locator("[data-realtime-connect]").click();
      await page.waitForFunction(() => document.querySelector("[data-realtime]")?.textContent === "velar-ws/1:velar-sse");
      assert.equal(await page.locator("[data-realtime]").textContent(), "velar-ws/1:velar-sse");
    }

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download status" }).click();
    assert.equal((await downloadPromise).suggestedFilename(), "velar-status.txt");

    await page.getByRole("button", { name: "Refresh activity" }).click();
    await page.waitForFunction(() => document.querySelector("[data-activity]")?.textContent?.includes("contracts are aligned"));

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.waitForFunction(() => document.querySelector(".status-badge")?.textContent === "Theme: dark");
    assert.equal(await page.getByRole("button", { name: "Toggle theme" }).evaluate((element) => element.classList.contains("active")), true);

    await page.getByRole("button", { name: "Subscribe" }).click();
    await page.locator('[data-velar-field-error="email"]').waitFor();
    assert.equal(await page.locator('[name="email"]').getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator('[name="email"]').evaluate((element) => element === document.activeElement), true);
    await page.waitForFunction(() => document.querySelector('[data-velar-announcer="assertive"]')?.textContent === "Email is required");

    await page.locator('[name="email"]').fill("dev@velar");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await page.waitForFunction(() => document.querySelector('[data-velar-announcer="assertive"]')?.textContent === "Email is incomplete");
    assert.equal(await page.locator('[data-velar-field-error="email"]').textContent(), "Enter a complete email address");

    await page.locator('[name="email"]').fill("dev@velar.test");
    await page.getByRole("button", { name: "Subscribe" }).click();
    await page.locator('[data-velar-field-error="email"]').waitFor({ state: "detached" });
    assert.equal(await page.locator('[name="email"]').getAttribute("aria-invalid"), null);
    await page.waitForFunction(() => document.querySelector('[data-velar-announcer="polite"]')?.textContent === "Subscription ready");

    await page.getByRole("link", { name: "About" }).click();
    await page.waitForURL("**/app/about");
    assert.equal(await page.locator("h1").textContent(), "About");
    assert.equal(await page.title(), "About · VelarScript Release Studio");
    assert.equal(await page.locator('meta[name="description"]').getAttribute("content"), "About the VelarScript production application");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("cleanup")), '{"label":"continued"}');
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("h1").textContent(), "About");
    assert.equal(new URL(page.url()).pathname, "/app/about");
    assert.deepEqual(failures, [], `${name}: ${failures.join("\n")}`);
    process.stdout.write(`✓ ${name}\n`);
  } finally {
    await closeBrowserOwner(owner);
    active.delete(owner);
  }
}

function closeBrowserOwner(owner: ActiveBrowser): Promise<void> {
  owner.closing ??= terminateBrowserServer(owner.browser, owner.server, 10_000);
  return owner.closing;
}

async function startRealtimeServer(port: number): Promise<Server> {
  const server = createHttpServer((request, response) => {
    if (request.url === "/events") {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
      });
      response.write("id: 1\ndata: velar-sse\n\n");
      return;
    }
    response.writeHead(404).end("Not found");
  });
  const upgradedSockets = new Set<Duplex>();
  (server as TrackedServer).velarUpgradedSockets = upgradedSockets;
  server.on("upgrade", (request, socket) => {
    if (request.url !== "/socket" || typeof request.headers["sec-websocket-key"] !== "string") {
      socket.destroy();
      return;
    }
    upgradedSockets.add(socket);
    socket.once("close", () => upgradedSockets.delete(socket));
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
    const payload = Buffer.from("velar-ws", "utf8");
    socket.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  return server;
}

async function availablePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function startStaticServer(directory: string, base: string, port: number): Promise<Server> {
  const deployment = JSON.parse(await readFile(join(directory, "velar-deploy.json"), "utf8")) as {
    headers: Array<{ path: string; values: Record<string, string> }>;
  };
  const securityHeaders = deployment.headers[0]?.values ?? {};
  const server = createHttpServer(async (request, response) => {
    try {
      const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`).pathname;
      if (!pathname.startsWith(base)) {
        response.writeHead(404).end("Not found");
        return;
      }
      const relativePath = pathname.slice(base.length) || "index.html";
      if (normalize(relativePath).startsWith("..")) {
        response.writeHead(400).end("Bad path");
        return;
      }
      let body;
      let servedPath = relativePath;
      try {
        body = await readFile(join(directory, relativePath));
      } catch {
        servedPath = "index.html";
        body = await readFile(join(directory, servedPath));
      }
      for (const [name, value] of Object.entries(securityHeaders)) response.setHeader(name, value);
      response.setHeader("Content-Type", contentType(servedPath));
      response.writeHead(200).end(body);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  return server;
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".map": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server) return;
  for (const socket of (server as TrackedServer).velarUpgradedSockets ?? []) socket.destroy();
  server.closeAllConnections();
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
}

async function closeProductionPreview(preview: ProductionPreviewHandle | null): Promise<void> {
  if (preview !== null) await preview.close();
}

async function run(command: string, arguments_: readonly string[], active: Set<ChildProcess>): Promise<void> {
  const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  active.add(child);
  const output = collectOutput(child);
  let code: number | null;
  try {
    code = await new Promise<number | null>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", resolvePromise);
    });
  } finally {
    active.delete(child);
  }
  if (code !== 0) throw new Error(`${command} failed (${code})\n${output.text}`);
}

function collectOutput(child: ChildProcess): { readonly text: string } {
  const output = { text: "" };
  child.stdout?.on("data", (chunk: Buffer) => { output.text += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output.text += chunk.toString("utf8"); });
  return output;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  details: () => string = () => "",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for browser acceptance state\n${details()}`);
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await boundedBrowserOperation(
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once("exit", () => resolve())),
    5_000,
    "Browser acceptance child cleanup",
  );
}
