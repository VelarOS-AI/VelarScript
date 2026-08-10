import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { formatDiagnostic } from "@velarscript/compiler";
import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from "playwright";
import type { VelarProjectConfig } from "./config.ts";
import { compileProject } from "./project.ts";
import { standardModuleSource, standardModuleSources } from "./standard-modules.ts";
import { compiledTestModulePath, writeCompiledTestProject } from "./test-output.ts";
import { verifyProductionBuild } from "./production-verifier.ts";
import { startProductionPreview, type ProductionPreviewHandle } from "./preview-server.ts";
import { hostErrorStack } from "./host-error.ts";

export type BrowserEngine = "chromium" | "firefox" | "webkit";
export type BrowserEngineSelection = BrowserEngine | "all";

const browserTypes: Readonly<Record<BrowserEngine, BrowserType>> = { chromium, firefox, webkit };

export async function runBrowserTests(
  config: VelarProjectConfig,
  explicitInput: string | null,
  selection: BrowserEngineSelection,
): Promise<number> {
  const contract = config.framework?.host.browserTests;
  if (!config.framework || !contract) {
    process.stderr.write("The project framework does not provide browser-test hosting\n");
    return 1;
  }
  const runtimeKey = Symbol.for(contract.runtimeKey);
  const files = explicitInput?.endsWith(contract.sourceSuffix)
    ? [resolve(explicitInput)]
    : await discoverBrowserTestFiles(config.root, new Set([config.outDir, config.publicDir]), contract.sourceSuffix);
  if (files.length === 0) {
    process.stderr.write("No .browser.test.vel files were found\n");
    return 1;
  }

  const temporary = await mkdtemp(join(tmpdir(), "velar-browser-tests-"));
  const site = join(temporary, "site");
  const compiled = join(temporary, "tests");
  let server: ProductionPreviewHandle | null = null;
  let passed = 0;
  let failed = 0;
  try {
    const build = await buildProject(config, site);
    if (!build.ok) {
      process.stderr.write(build.output);
      return 1;
    }
    const verified = await verifyProductionBuild(site);
    await prepareStandardModules(compiled, config);
    const entries: Array<{ readonly file: string; readonly output: string; readonly tests: readonly string[] }> = [];
    for (const file of files) {
      const entry = await compileBrowserTest(file, compiled, config);
      if (!entry) {
        failed += 1;
        continue;
      }
      entries.push(entry);
    }
    if (entries.length === 0) {
      process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
      return 1;
    }

    server = await startProductionPreview(verified, 0);
    const origin = server.origin;
    const engines: readonly BrowserEngine[] = selection === "all"
      ? ["chromium", "firefox", "webkit"]
      : [selection];

    for (const engine of engines) {
      let browser: Browser;
      try {
        browser = await browserTypes[engine].launch({ headless: true });
      } catch (error) {
        failed += entries.reduce((count, entry) => count + entry.tests.length, 0);
        process.stderr.write(`✗ ${engine} could not start\n${stackOf(error)}\nInstall it with: npx playwright install ${engine}\n`);
        continue;
      }
      try {
        for (const entry of entries) {
          const namespace = await import(`${pathToFileURL(entry.output).href}?engine=${engine}&run=${Date.now()}`) as Record<string, unknown>;
          for (const name of entry.tests) {
            const test = namespace[name];
            const context = await browser.newContext();
            const page = await context.newPage();
            const runtimeFailures: string[] = [];
            page.on("pageerror", (error) => runtimeFailures.push(error.stack ?? error.message));
            page.on("console", (message) => {
              if (message.type() === "error" || message.type() === "warning") {
                runtimeFailures.push(`${message.type()}: ${message.text()}`);
              }
            });
            await installFrameworkRuntime(page, contract.initScript?.(config.framework.config));
            installBrowserRuntime(page, origin, verified.deployment.base, runtimeKey);
            try {
              if (typeof test !== "function") throw new Error(`Test function '${name}' was not emitted`);
              if (test.length !== 0) throw new Error(`Browser test function '${name}' cannot declare parameters`);
              await test();
              if (runtimeFailures.length > 0) throw new Error(`Browser runtime failures:\n${runtimeFailures.join("\n")}`);
              passed += 1;
              process.stdout.write(`✓ ${engine} :: ${relative(config.root, entry.file)} :: ${name}\n`);
            } catch (error) {
              failed += 1;
              process.stderr.write(`✗ ${engine} :: ${relative(config.root, entry.file)} :: ${name}\n${stackOf(error)}\n`);
            } finally {
              removeBrowserRuntime(runtimeKey);
              await context.close();
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    removeBrowserRuntime(runtimeKey);
    if (server) await server.close();
    await rm(temporary, { recursive: true, force: true });
  }
  process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
  return failed === 0 ? 0 : 1;
}

async function installFrameworkRuntime(page: Page, source: string | undefined): Promise<void> {
  if (source === undefined) return;
  if (typeof source !== "string" || source.length === 0 || Buffer.byteLength(source, "utf8") > 1024 * 1024) {
    throw new Error("Framework browser-test init script must contain 1 byte through 1 MiB of text");
  }
  await page.addInitScript({ content: source });
}

async function compileBrowserTest(
  file: string,
  outputRoot: string,
  config: VelarProjectConfig,
): Promise<{ readonly file: string; readonly output: string; readonly tests: readonly string[] } | null> {
  const project = await compileProject(file, new Map(), {
    sourceRoot: config.root,
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensions: config.compilerExtensions,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
    exportTestFunctions: true,
  });
  const errors = [
    ...project.failures.map((failure) => `${failure.path}: ${failure.message}`),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => formatDiagnostic(module.result.source, diagnostic))),
  ];
  if (errors.length > 0) {
    process.stderr.write(`✗ ${relative(config.root, file)}\n${errors.join("\n\n")}\n`);
    return null;
  }
  await writeCompiledTestProject(project, outputRoot);
  const entry = project.modules.find((module) => module.inputPath === file);
  const tests = entry?.result.moduleInterface.testFunctions ?? [];
  if (tests.length === 0) {
    process.stderr.write(`✗ ${relative(config.root, file)} contains no test_* functions\n`);
    return null;
  }
  return { file, output: entry ? compiledTestModulePath(project, entry, outputRoot) : join(outputRoot, relative(config.root, file).replace(/\.vel$/u, ".js")), tests };
}

function installBrowserRuntime(page: Page, origin: string, base: string, runtimeKey: symbol): void {
  const locator = (selector: unknown) => page.locator(String(selector));
  const storageArea = (area: unknown): "local" | "session" => {
    const value = String(area);
    if (value !== "local" && value !== "session") throw new Error("Browser test storage area must be local or session");
    return value;
  };
  const mockedRoutes = new Set<string>();
  const runtime = Object.freeze({
    async open(path = "/") {
      const value = String(path);
      if (!value.startsWith("/")) throw new Error("browser.open requires an application-relative path starting with '/'");
      const target = base === "/" ? value : `${base.slice(0, -1)}${value}`;
      await page.goto(new URL(target, origin).href, { waitUntil: "networkidle" });
      return null;
    },
    async reload() { await page.reload({ waitUntil: "networkidle" }); return null; },
    async click(selector: unknown) { await locator(selector).click(); return null; },
    async fill(selector: unknown, value: unknown) { await locator(selector).fill(String(value)); return null; },
    async select(selector: unknown, value: unknown) { await locator(selector).selectOption(String(value)); return null; },
    async press(selector: unknown, key: unknown) { await locator(selector).press(String(key)); return null; },
    async text(selector: unknown) { return await locator(selector).textContent() ?? ""; },
    async attribute(selector: unknown, name: unknown) { return locator(selector).getAttribute(String(name)); },
    async namespace(selector: unknown) {
      return locator(selector).evaluate((element) => element.namespaceURI ?? "");
    },
    async count(selector: unknown) { return locator(selector).count(); },
    async visible(selector: unknown) { return locator(selector).isVisible(); },
    async waitFor(selector: unknown, state = "visible") {
      const value = String(state);
      if (value !== "visible" && value !== "hidden" && value !== "attached" && value !== "detached") {
        throw new Error("browser.waitFor state must be visible, hidden, attached, or detached");
      }
      await locator(selector).waitFor({ state: value });
      return null;
    },
    async waitForText(selector: unknown, text: unknown) {
      await locator(selector).filter({ hasText: String(text) }).waitFor({ state: "visible" });
      return null;
    },
    async currentPath() {
      const url = new URL(page.url());
      const path = base === "/" ? url.pathname : `/${url.pathname.slice(base.length)}`;
      return `${path || "/"}${url.search}${url.hash}`;
    },
    async viewport(width: unknown, height: unknown) {
      const next = { width: Number(width), height: Number(height) };
      if (!Number.isInteger(next.width) || next.width < 1 || !Number.isInteger(next.height) || next.height < 1) {
        throw new Error("browser.viewport requires positive integer dimensions");
      }
      await page.setViewportSize(next);
      return null;
    },
    async storageGet(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      return page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        return target.getItem(itemKey);
      }, input);
    },
    async storageSet(area: unknown, key: unknown, value: unknown) {
      const input = { area: storageArea(area), key: String(key), value: String(value) };
      await page.evaluate(({ area: name, key: itemKey, value: itemValue }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.setItem(itemKey, itemValue);
      }, input);
      return null;
    },
    async storageRemove(area: unknown, key: unknown) {
      const input = { area: storageArea(area), key: String(key) };
      await page.evaluate(({ area: name, key: itemKey }) => {
        const target = name === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.removeItem(itemKey);
      }, input);
      return null;
    },
    async storageClear(area: unknown) {
      const name = storageArea(area);
      await page.evaluate((storageName) => {
        const target = storageName === "local" ? globalThis.localStorage : globalThis.sessionStorage;
        target.clear();
      }, name);
      return null;
    },
    async networkRespond(path: unknown, body: unknown, status: unknown, contentType: unknown, delayMs: unknown) {
      const pathname = String(path);
      const responseBody = String(body);
      const responseStatus = Number(status);
      const responseType = String(contentType);
      const delay = Number(delayMs);
      if (!pathname.startsWith("/") || pathname.includes("\0")) throw new Error("network.respond path must be application-relative and start with '/'");
      if (responseBody.length > 16 * 1024 * 1024) throw new Error("network.respond body cannot exceed 16 MiB");
      if (!Number.isInteger(responseStatus) || responseStatus < 100 || responseStatus > 599) throw new Error("network.respond status must be an HTTP status integer");
      if (!responseType || responseType.length > 1024 || /[\r\n]/u.test(responseType)) throw new Error("network.respond contentType must be bounded single-line text");
      if (!Number.isInteger(delay) || delay < 0 || delay > 30000) throw new Error("network.respond delayMs must be an integer from 0 through 30000");
      const target = new URL(base === "/" ? pathname : `${base.slice(0, -1)}${pathname}`, origin).href;
      if (mockedRoutes.has(target)) await page.unroute(target);
      mockedRoutes.add(target);
      await page.route(target, async (route) => {
        if (delay > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
        await route.fulfill({ status: responseStatus, contentType: responseType, body: responseBody });
      });
      return null;
    },
    async networkClear() {
      for (const target of mockedRoutes) await page.unroute(target);
      mockedRoutes.clear();
      return null;
    },
    async frameworkInvoke(capability: unknown, operation: unknown, args: unknown, timeout: unknown) {
      const input = { capability: String(capability), operation: String(operation), args, timeout: Number(timeout) };
      if (!input.capability || input.capability.length > 128 || !input.operation || input.operation.length > 128 || !Array.isArray(input.args)) {
        throw new TypeError("Framework test invoke requires bounded capability, operation, and argument values");
      }
      if (!Number.isSafeInteger(input.timeout) || input.timeout < 0 || input.timeout > 600000) {
        throw new RangeError("Framework test invoke timeout is outside its supported bounds");
      }
      return page.evaluate(async (request) => {
        const bridge = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("velar.desktop.bridge.v1"))?.value as {
          invoke?: (capability: string, operation: string, args: unknown[], timeout: number) => Promise<unknown>;
        } | undefined;
        if (!bridge || typeof bridge.invoke !== "function") throw new Error("Desktop application test bridge is unavailable");
        return bridge.invoke(request.capability, request.operation, request.args as unknown[], request.timeout);
      }, input);
    },
  });
  (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey] = runtime;
}

function removeBrowserRuntime(runtimeKey: symbol): void {
  delete (globalThis as unknown as { [key: symbol]: unknown })[runtimeKey];
}

async function buildProject(config: VelarProjectConfig, outputDirectory: string): Promise<{ readonly ok: boolean; readonly output: string }> {
  const executable = resolve(process.argv[1]!);
  const child = spawn(process.execPath, [executable, "build", config.root, "--out-dir", outputDirectory], {
    cwd: config.root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  return { ok: code === 0, output };
}

async function prepareStandardModules(root: string, config: VelarProjectConfig): Promise<void> {
  const packageRoot = join(root, "node_modules", "velar");
  await mkdir(packageRoot, { recursive: true });
  const exports: Record<string, string> = {};
  for (const [source, fallback] of standardModuleSources(config.compilerExtensions)) {
    const name = source.slice("velar/".length);
    exports[`./${name}`] = `./${name}.js`;
    await writeFile(join(packageRoot, `${name}.js`), standardModuleSource(source, config.extensionConfig, config.compilerExtensions) ?? fallback, "utf8");
  }
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "velar", private: true, type: "module", exports }), "utf8");
}

async function discoverBrowserTestFiles(root: string, excluded: ReadonlySet<string>, sourceSuffix: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || excluded.has(path)) continue;
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith(sourceSuffix)) output.push(path);
    }
  };
  await visit(root);
  return output.sort();
}

function stackOf(error: unknown): string {
  return hostErrorStack(error);
}
