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
import { chromium, type Browser, type BrowserServer, type BrowserType } from "playwright";
import {
  boundedBrowserOperation,
  exitBrowserWorker,
  observeBrowserWorkerParent,
  superviseBrowserWorker,
  terminateBrowserServer,
} from "../packages/cli/src/browser-process-owner.ts";

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
  const activeBrowsers = new Set<ActiveBrowser>();
  const activeChildren = new Set<ChildProcess>();
  const productionDirectory = await mkdtemp(join(tmpdir(), "velar-browser-production-"));
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
      devServer = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", "tests/fixtures/web-capabilities", "--port", String(appPort)], {
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
      assert.equal(status.apiVersion, "0.11");
      assert.equal(status.ready, true);
      assert.deepEqual(status.notices, []);
      assert.ok(status.compilation.moduleCount >= 5);
      assert.equal(status.compilation.compiledModules, status.compilation.moduleCount);

      await boundedBrowserOperation(
        acceptBrowser("Dev Chromium", chromium, baseUrl, false, realtimePort, activeBrowsers),
        180_000,
        "Dev Chromium acceptance",
        interruption,
      );
      await stopChild(devServer);
      devServer = null;

      await run(process.execPath, ["packages/cli/src/cli.ts", "build", "tests/fixtures/web-capabilities", "--out-dir", productionDirectory], activeChildren);
      const staticPort = await availablePort();
      staticServer = await startStaticServer(productionDirectory, "/app/", staticPort);
      const productionUrl = `http://127.0.0.1:${staticPort}/app/`;
      await boundedBrowserOperation(
        acceptBrowser("Production Chromium", chromium, productionUrl, true, realtimePort, activeBrowsers),
        180_000,
        "Production Chromium acceptance",
        interruption,
      );
      process.stdout.write("VelarScript 1x1 Chromium gate passed for development and CSP production\n");
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
    ]);
    const storageCleanup = await Promise.allSettled([
      rm(productionDirectory, { recursive: true, force: true }),
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
    // The clipboard assertion below needs the two clipboard permissions, and a
    // default page has no context to grant them on. Chromium is the only engine
    // that knows the names — Firefox rejects `clipboard-write` outright and
    // WebKit rejects it when the page opens — and this suite is Chromium by
    // design, which `tests/ci.acceptance.ts` asserts by refusing to find any
    // other engine named here.
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const page = await context.newPage();
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
    // D70 rule 180: the frozen-read report is a development-mode warning, and it
    // is the one warning this page is supposed to produce. It is collected
    // rather than counted as a failure so the assertions below can check that it
    // fired, when it fired, and what it said.
    const frozenReadWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && message.text().includes("was being built was frozen at")) {
        frozenReadWarnings.push(message.text());
        return;
      }
      if (message.type() === "error" || message.type() === "warning") failures.push(`${message.type()}: ${message.text()}`);
    });

    const response = await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (production) assert.match(response?.headers()["content-security-policy"] ?? "", /script-src 'self'/u);
    assert.equal(await page.locator("h1").textContent(), "VelarScript Web capabilities");
    assert.equal(new URL(page.url()).pathname, "/app/");
    assert.equal(await page.title(), "VelarScript Web capabilities");
    assert.equal(await page.locator('meta[name="description"]').getAttribute("content"), "VelarScript 0.19 · Web API 0.11 platform application");
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
    await page.waitForFunction(() => document.querySelector("[data-worker]")?.textContent === "worker:17");
    assert.equal(await page.locator("[data-worker]").textContent(), "worker:17");
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

    // D104 rule 4. The fixture has had a copy button since the Web API landed
    // and nothing ever pressed it, so `writeClipboardText` reached three
    // engines and a release with no evidence that a click ever put text on the
    // clipboard. A P2c consumer read the module's export table looking for the
    // write, did not recognise the name it had then, and shipped a product with
    // the copy button deliberately left out — which is a naming defect, but the
    // reason it survived a survey is that no test could be pointed at as proof
    // the capability worked. The assertion reads the clipboard back rather than
    // trusting the label, because a label is what the defect looked like.
    await page.getByRole("button", { name: "Copy status" }).click();
    await page.waitForFunction(() => document.querySelector("[data-clipboard]")?.textContent === "Copied");
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "VelarScript Web API 0.11");

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

    // D70 rules 179/180. Before the theme changes, both readings agree and the
    // detector has said nothing: a snapshot that never diverges is never worth a
    // warning, which is the whole reason the report fires on divergence rather
    // than on the read.
    assert.equal(await page.locator("[data-frozen-theme]").textContent(), "day");
    assert.equal(await page.locator("[data-live-theme]").textContent(), "day");
    await page.waitForTimeout(50);
    assert.deepEqual(frozenReadWarnings, [], `frozen-read warning before any change: ${frozenReadWarnings.join("\n")}`);

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.waitForFunction(() => document.querySelector(".status-badge")?.textContent === "Theme: dark");
    assert.equal(await page.getByRole("button", { name: "Toggle theme" }).evaluate((element) => element.classList.contains("active")), true);

    // Now the source really has changed: the live reading follows, the frozen one
    // does not -- the behaviour D70 rule 179 accepted as correct -- and the
    // detector reports the divergence rather than leaving the page silently
    // wrong. The detection is development-mode only, so the production run of
    // this same page must stay silent.
    await page.waitForFunction(() => document.querySelector("[data-live-theme]")?.textContent === "night");
    assert.equal(await page.locator("[data-frozen-theme]").textContent(), "day");
    for (let attempt = 0; attempt < 40 && frozenReadWarnings.length === 0 && !production; attempt += 1) {
      await page.waitForTimeout(50);
    }
    if (production) {
      assert.deepEqual(frozenReadWarnings, [], `a production build reported a frozen read: ${frozenReadWarnings.join("\n")}`);
    } else {
      assert.ok(frozenReadWarnings.length >= 1, "the frozen reactive read was not reported after the source diverged");
      assert.match(frozenReadWarnings[0] ?? "", /read while FrozenVersusLive was being built was frozen at false, and the source has now changed to true/u);
      assert.match(frozenReadWarnings[0] ?? "", /declare it with 'computed name = <expression>'/u);
      // The capture site is mapped back to the module the author wrote, not
      // left as a position in generated JavaScript.
      assert.match(frozenReadWarnings[0] ?? "", /read at src\/pages\/home\.vel:\d+:\d+/u);
    }

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
    assert.equal(await page.title(), "About · VelarScript Web capabilities");
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
