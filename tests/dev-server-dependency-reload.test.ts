import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));

interface DevServer {
  readonly child: ChildProcess;
  output(): string;
  rebuilds(): number;
  waitForBanner(): Promise<void>;
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function startDevServer(directory: string, port: number): DevServer {
  const child = spawn(process.execPath, [cliPath, "dev", directory, "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  return {
    child,
    output: () => output,
    rebuilds: () => output.match(/VelarScript app rebuilt in/gu)?.length ?? 0,
    async waitForBanner(): Promise<void> {
      const deadline = Date.now() + 30_000;
      while (!/VelarScript dev server:/u.test(output) && Date.now() < deadline) await delay(10);
      assert.match(output, /VelarScript dev server:/u, output);
    },
  };
}

async function stopDevServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill(process.platform === "win32" ? "SIGKILL" : "SIGTERM");
  });
}

function runCli(arguments_: readonly string[], cwd: string): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function textContent(page: Page): Promise<string> {
  try { return await page.locator("[data-label]").textContent({ timeout: 250 }) ?? ""; }
  catch { return ""; }
}

async function changeUntilRendered(
  page: Page,
  change: (attempt: number) => Promise<string>,
  server: DevServer,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (let attempt = 0; Date.now() < deadline; attempt += 1) {
    const expected = await change(attempt);
    const retryAt = Date.now() + 750;
    while (Date.now() < retryAt) {
      if (await textContent(page) === expected) return expected;
      await delay(20);
    }
  }
  throw new Error(`the browser never rendered the changed dependency (last text ${JSON.stringify(await textContent(page))}); server output:\n${server.output()}`);
}

async function waitForStableRebuildCount(server: DevServer): Promise<void> {
  let observed = server.rebuilds();
  let stableSince = Date.now();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await delay(50);
    const current = server.rebuilds();
    if (current !== observed) {
      observed = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 500) {
      return;
    }
  }
  throw new Error(`the development server did not settle; output:\n${server.output()}`);
}

function applicationSource(pageLabel: string, packageName = "live-js"): string {
  return `extern module "${packageName}":
    export def npmLabel() -> string

import js {npmLabel} from "${packageName}"
import {frozenLabel} from "live-frozen"

const pageLabel = "${pageLabel}"

component App:
    return <main data-label>{f"{pageLabel}:{npmLabel()}:{frozenLabel()}"}</main>

@main: mount(<App />, "#app")
`;
}

test("velar dev reloads npm and frozen prebundles while ordinary Vel source stays hot", { timeout: 180_000 }, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "velar-dev-dependency-reload-"));
  const application = join(root, "application");
  const frozen = join(root, "frozen");
  context.after(() => rm(root, { recursive: true, force: true }));

  await writeTree(frozen, {
    "package.json": `${JSON.stringify({
      name: "live-frozen",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./dist/index.js" },
      velar: {
        entry: "src/index.vel",
        artifacts: { core: "dist/velar-library.json" },
        targets: ["core"],
        requires: { capabilities: [] },
      },
    }, null, 2)}\n`,
    "velar.json": `${JSON.stringify({
      formatVersion: VELAR_PROJECT_FORMAT_VERSION,
      kind: "library",
      entry: "src/index.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: [],
    }, null, 2)}\n`,
    "src/index.vel": 'export def frozenLabel() -> string: return "frozen-initial"\n',
  });
  const built = runCli(["build-library", frozen], root);
  assert.equal(built.status, 0, built.output);

  await writeTree(application, {
    "node_modules/live-js/package.json": `${JSON.stringify({
      name: "live-js",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }, null, 2)}\n`,
    "node_modules/live-js/index.js": 'export function npmLabel() { return "npm-initial"; }\n',
    "node_modules/map-js/package.json": `${JSON.stringify({
      name: "map-js",
      version: "1.0.0",
      type: "module",
      exports: "./index.js",
    }, null, 2)}\n`,
    "node_modules/map-js/index.js": 'export function npmLabel() { return "map-import"; }\n',
    "package.json": `${JSON.stringify({ name: "dependency-reload-app", version: "1.0.0", private: true, type: "module" }, null, 2)}\n`,
    "velar.json": `${JSON.stringify({
      formatVersion: VELAR_PROJECT_FORMAT_VERSION,
      entry: "src/main.vel",
      outDir: "dist",
      publicDir: "public",
      extensions: ["@velarscript/web"],
      web: { title: "Dependency reload" },
    }, null, 2)}\n`,
    "src/main.vel": applicationSource("page-initial"),
  });
  await mkdir(join(application, "node_modules", "@velarscript"), { recursive: true });
  await symlink(webPackageRoot, join(application, "node_modules", "@velarscript", "web"), "dir");
  await symlink(frozen, join(application, "node_modules", "live-frozen"), "dir");

  const port = await availablePort();
  const server = startDevServer(application, port);
  context.after(() => stopDevServer(server.child));
  await server.waitForBanner();

  const browser = await chromium.launch();
  context.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  let navigations = 0;
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
  assert.equal(await textContent(page), "page-initial:npm-initial:frozen-initial");

  await page.evaluate(() => { (globalThis as Record<string, unknown>).__velarReloadMarker = "hot"; });
  const initialNavigations = navigations;
  await changeUntilRendered(page, async (attempt) => {
    const label = `page-hot-${attempt}`;
    await writeFile(join(application, "src", "main.vel"), applicationSource(label), "utf8");
    return `${label}:npm-initial:frozen-initial`;
  }, server);
  assert.equal(navigations, initialNavigations, "an ordinary .vel edit must keep the current document");
  assert.equal(await page.evaluate(() => (globalThis as Record<string, unknown>).__velarReloadMarker), "hot");
  const hotLabel = (await textContent(page)).split(":")[0]!;

  const beforeNpmNavigations = navigations;
  await changeUntilRendered(page, async (attempt) => {
    const label = `npm-rebuilt-${attempt}`;
    await writeFile(join(application, "node_modules", "live-js", "index.js"), `export function npmLabel() { return "${label}"; }\n`, "utf8");
    return `${hotLabel}:${label}:frozen-initial`;
  }, server);
  assert.ok(navigations > beforeNpmNavigations, "a rebuilt npm prebundle must reload the document");
  assert.equal(await page.evaluate(() => (globalThis as Record<string, unknown>).__velarReloadMarker), undefined);
  await waitForStableRebuildCount(server);
  const settledNpmNavigations = navigations;
  await delay(750);
  assert.equal(navigations, settledNpmNavigations, "the full reload event must not replay into a reload loop");

  await page.evaluate(() => { (globalThis as Record<string, unknown>).__velarReloadMarker = "import-map"; });
  const beforeImportMapNavigations = navigations;
  const mappedText = await changeUntilRendered(page, async (attempt) => {
    const label = `page-map-${attempt}`;
    await writeFile(join(application, "src", "main.vel"), applicationSource(label, "map-js"), "utf8");
    return `${label}:map-import:frozen-initial`;
  }, server);
  assert.ok(navigations > beforeImportMapNavigations, "an import-map content change must reload the document");
  assert.equal(await page.evaluate(() => (globalThis as Record<string, unknown>).__velarReloadMarker), undefined);
  const mappedPageLabel = mappedText.split(":")[0]!;

  await page.evaluate(() => { (globalThis as Record<string, unknown>).__velarReloadMarker = "frozen"; });
  const beforeFrozenNavigations = navigations;
  await changeUntilRendered(page, async (attempt) => {
    const label = `frozen-rebuilt-${attempt}`;
    await writeFile(join(frozen, "src", "index.vel"), `export def frozenLabel() -> string: return "${label}"\n`, "utf8");
    const rebuilt = runCli(["build-library", frozen], root);
    assert.equal(rebuilt.status, 0, rebuilt.output);
    return `${mappedPageLabel}:map-import:${label}`;
  }, server);
  assert.ok(navigations > beforeFrozenNavigations, "a rebuilt frozen prebundle must reload the document");
  assert.equal(await page.evaluate(() => (globalThis as Record<string, unknown>).__velarReloadMarker), undefined);
  await waitForStableRebuildCount(server);
  const settledFrozenNavigations = navigations;
  await delay(750);
  assert.equal(navigations, settledFrozenNavigations, "the reloaded document must not receive the previous reload event");
  assert.deepEqual(pageErrors, []);
});
