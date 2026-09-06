import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { devServerPort } from "../support/free-port.ts";
import { compile, assertDevServerExit, stopDevServer, reportedChange, linkWorkspaceWebExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("dev server exits cleanly after browser requests", async (context) => {
  const child = spawn(process.execPath, [
    "packages/cli/src/cli.ts",
    "dev",
    "examples/tour/web",
    "--port",
    "0",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 5_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/);
  const port = devServerPort(output);
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /data-velar-error-overlay/);
  assert.match(html, /VelarScript runtime error/);
  assert.match(html, /update\.errors\.length/);
  assert.match(html, /"velar\/worker":"\/@velar\/worker\.js"/u);
  const workerRuntime = await fetch(`http://127.0.0.1:${port}/@velar/worker.js`);
  assert.equal(workerRuntime.status, 200);
  assert.match(await workerRuntime.text(), /export function worker\(/u);
  const javascript = await (await fetch(`http://127.0.0.1:${port}/main.js`)).text();
  const generatedLines = javascript.split("\n");
  const mountLine = generatedLines.findLastIndex((line) => line.includes("__velarMount(")) + 1;
  assert.ok(mountLine > 0);
  const mapped = await (await fetch(`http://127.0.0.1:${port}/__velar/map?file=%2Fmain.js&line=${mountLine}&column=1`)).json() as {
    path: string;
    line: number;
  };
  assert.equal(mapped.path, "main.vel");
  assert.ok(mapped.line > 0);
  const rejectedMethod = await fetch(`http://127.0.0.1:${port}/main.js`, { method: "POST", body: "ignored" });
  assert.equal(rejectedMethod.status, 405);
  assert.equal(rejectedMethod.headers.get("allow"), "GET, HEAD");
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Dev server did not stop")), 2_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server keeps the last good app behind compile-error overlays", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-overlay-");
  const mainPath = join(directory, "main.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(mainPath, "component App:\n    return <main>Ready</main>\n\n@main: mount(<App />, \"#app\")\n", "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  const port = devServerPort(output);
  const first = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(first.status, 200);
  await reportedChange(
    mainPath,
    "component App:\n    return <img />\n",
    () => /VelarScript app has \d+ error/u.test(output),
    "the dev-server project watch",
  );
  const retained = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(retained.status, 200);
  assert.match(await retained.text(), /data-velar-error-overlay/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server contains unexpected rebuild failures and recovers on the next edit", async () => {
  const directory = await makeTemporaryDirectory("velar-dev-rebuild-recovery-");
  const mainPath = join(directory, "main.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  const validSource = (label: string): string => `component App:\n    return <main>${label}</main>\n\n@main: mount(<App />, \"#app\")\n`;
  await writeFile(mainPath, validSource("Ready"), "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp, source: () => string = () => output): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!pattern.test(source()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(source(), pattern);
  };

  try {
    await waitForOutput(/VelarScript dev server:/u);
    const port = devServerPort(output);
    const excessiveImports = Array.from(
      { length: 4_097 },
      (_, index) => `import js unsafe {value as value${index}} from "overflow-${index}"`,
    ).join("\n");
    await reportedChange(
      mainPath,
      `${excessiveImports}\n${validSource("Too many")}`,
      () => /VelarScript rebuild failed: A browser project cannot import more than 4096 JavaScript packages/u.test(errors),
      "the dev-server project watch",
    );
    await waitForOutput(/VelarScript app has 1 error/u);
    assert.equal(child.exitCode, null);
    const failed = await (await fetch(`http://127.0.0.1:${port}/__velar/status`)).json() as {
      ready: boolean;
      errors: string[];
    };
    assert.equal(failed.ready, false);
    assert.equal(failed.errors.length, 1);
    assert.match(failed.errors[0]!, /cannot import more than 4096 JavaScript packages/u);
    const retained = await (await fetch(`http://127.0.0.1:${port}/main.js`)).text();
    assert.match(retained, /Ready/u);

    await writeFile(mainPath, validSource("Recovered"), "utf8");
    await waitForOutput(/VelarScript app rebuilt in/u);
    const recovered = await (await fetch(`http://127.0.0.1:${port}/__velar/status`)).json() as {
      ready: boolean;
      errors: string[];
    };
    assert.equal(recovered.ready, true);
    assert.deepEqual(recovered.errors, []);
    const rebuilt = await (await fetch(`http://127.0.0.1:${port}/main.js`)).text();
    assert.match(rebuilt, /Recovered/u);

    for (let index = 0; index < 64; index += 1) {
      await writeFile(mainPath, validSource(`Burst ${index}`), "utf8");
    }
    const finalDeadline = Date.now() + 10_000;
    let finalModule = "";
    while (!/Burst 63/u.test(finalModule) && Date.now() < finalDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      finalModule = await (await fetch(`http://127.0.0.1:${port}/main.js`)).text();
    }
    assert.match(finalModule, /Burst 63/u);
    assert.equal(child.exitCode, null);
  } finally {
    child.kill("SIGTERM");
  }
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, errors);
});

test("dev server polling watcher reports project changes without native file events", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-polling-");
  const mainPath = join(directory, "main.vel");
  const preloadPath = join(directory, "force-windows-platform.mjs");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(mainPath, "component App:\n    return <main>Before</main>\n\n@main: mount(<App />, \"#app\")\n", "utf8");
  await writeFile(preloadPath, "Object.defineProperty(process, 'platform', {value: 'win32'});\n", "utf8");
  const child = spawn(process.execPath, [
    "--import",
    pathToFileURL(preloadPath).href,
    "packages/cli/src/cli.ts",
    "dev",
    directory,
    "--port",
    "0",
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };

  await waitForOutput(/VelarScript dev server:/u);
  const port = devServerPort(output);
  await writeFile(mainPath, "component App:\n    return <main>After</main>\n\n@main: mount(<App />, \"#app\")\n", "utf8");
  await waitForOutput(/VelarScript app rebuilt in/u);
  const javascript = await (await fetch(`http://127.0.0.1:${port}/main.js`)).text();
  assert.match(javascript, /After/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server exposes incremental compilation status and reuses unaffected modules", async () => {
  const directory = await makeTemporaryDirectory("velar-dev-incremental-");
  const mainPath = join(directory, "main.vel");
  const storePath = join(directory, "store.vel");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(storePath, "export const label = \"Ready\"\n", "utf8");
  await writeFile(join(directory, "banner.vel"), "export component Banner:\n    return <strong>Banner</strong>\n", "utf8");
  await writeFile(mainPath, `
import {label} from "./store.vel"
import {Banner} from "./banner.vel"

component App:
    return <main><Banner />{label}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");
  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", directory, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  try {
    await waitForOutput(/VelarScript dev server:/u);
    const port = devServerPort(output);
    const initial = await (await fetch(`http://127.0.0.1:${port}/__velar/status`)).json() as {
      apiVersion: string;
      compilation: { moduleCount: number; compiledModules: number; reusedModules: number };
    };
    assert.equal(initial.apiVersion, "0.14");
    assert.deepEqual(initial.compilation, { ...initial.compilation, moduleCount: 3, compiledModules: 3, reusedModules: 0 });

    await reportedChange(
      storePath,
      "export const label = \"Updated\"\n",
      () => /VelarScript app rebuilt in .*\(2 compiled, 1 reused\)/u.test(output),
      "the dev-server project watch",
    );
    const updated = await (await fetch(`http://127.0.0.1:${port}/__velar/status`)).json() as {
      compilation: { compiledModules: number; reusedModules: number; affectedModules: number };
    };
    assert.equal(updated.compilation.compiledModules, 2);
    assert.equal(updated.compilation.reusedModules, 1);
    assert.equal(updated.compilation.affectedModules, 2);
  } finally {
    const exit = child.exitCode === null
      ? new Promise<number | null>((resolve) => child.once("exit", resolve))
      : Promise.resolve(child.exitCode);
    child.kill("SIGTERM");
    const exitCode = await exit;
    assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
  }
});

test("dev server watches installed VelarScript source package roots", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-package-");
  const projectRoot = join(directory, "app");
  const packageRoot = join(directory, "library");
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await mkdir(join(packageRoot, "generated"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "external-velar-kit",
    version: "1.0.0",
    type: "module",
    exports: { "./catalog": "./generated/catalog.json" },
    velar: {
      entry: "src/index.vel",
      targets: ["web"],
      requires: { capabilities: ["web"] },
      resources: { "./catalog": { path: "generated/catalog.json", type: "json" } },
    },
  }), "utf8");
  const packageEntry = join(packageRoot, "src", "index.vel");
  const resourcePath = join(packageRoot, "generated", "catalog.json");
  await writeFile(resourcePath, JSON.stringify({ label: "Library" }), "utf8");
  await writeFile(packageEntry, `
import json rawCatalog from "../generated/catalog.json"

type Catalog:
    readonly label: string

const catalog = Catalog.parse(rawCatalog)
export const label = catalog.label
`.trimStart(), "utf8");
  await symlink(packageRoot, join(projectRoot, "node_modules", "external-velar-kit"), "dir");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
import {label} from "external-velar-kit"
import json rawCatalog from "external-velar-kit/catalog"

type Catalog:
    readonly label: string

const directLabel = Catalog.parse(rawCatalog).label
component App:
    return <main>{label}:{directLabel}</main>
@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  const port = devServerPort(output);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /"external-velar-kit\/catalog":"\/@npm\/external-velar-kit\/catalog\.js"/u);
  const resourceModule = await fetch(`http://127.0.0.1:${port}/@npm/external-velar-kit/catalog.js`);
  assert.equal(resourceModule.status, 200);
  assert.match(await resourceModule.text(), /Library/u);
  await reportedChange(
    resourcePath,
    JSON.stringify({ label: "Updated library" }),
    () => /VelarScript app rebuilt in .*\(2 compiled, 0 reused\)/u.test(output),
    "the dev-server installed-package resource watch",
  );
  const updatedPackageResource = await fetch(`http://127.0.0.1:${port}/@npm/external-velar-kit/catalog.js`);
  assert.equal(updatedPackageResource.status, 200);
  assert.match(await updatedPackageResource.text(), /Updated library/u);
  const updatedRelativeResource = await fetch(`http://127.0.0.1:${port}/__velar_packages__/external-velar-kit/generated/catalog.json.js`);
  assert.equal(updatedRelativeResource.status, 200);
  assert.match(await updatedRelativeResource.text(), /Updated library/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));

  const built = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.equal(built.status, 0, String(built.stderr));
  const assets = await readdir(join(projectRoot, "dist", "assets"));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(javascript);
  assert.match(await readFile(join(projectRoot, "dist", "assets", javascript), "utf8"), /Updated library/u);
});

test("dev server watches JavaScript package subpath declarations and reanalyzes safe imports", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-js-types-");
  const projectRoot = join(directory, "app");
  const packageRoot = join(directory, "typed-library");
  await mkdir(join(projectRoot, "node_modules"), { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "typed-library",
    type: "module",
    exports: {
      "./format": { types: "./index.d.mts", default: "./index.js" },
    },
  }), "utf8");
  await writeFile(join(packageRoot, "index.js"), "export const format = value => String(value)\n", "utf8");
  const declarationPath = join(packageRoot, "index.d.mts");
  await writeFile(declarationPath, "export declare function format(value: number): string;\n", "utf8");
  await symlink(packageRoot, join(projectRoot, "node_modules", "typed-library"), "dir");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
import js {format} from "typed-library/format"
component App:
    return <main>{format(42)}</main>
@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const waitForOutput = async (pattern: RegExp): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!pattern.test(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.match(output, pattern);
  };
  await waitForOutput(/VelarScript dev server:/u);
  const port = devServerPort(output);
  await reportedChange(
    declarationPath,
    "export declare function format(value: string): string;\n",
    () => /VelarScript app has 1 error/u.test(output),
    "the dev-server installed-package watch",
  );
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server serves dual CJS/ESM packages through their import condition", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-dual-esm-");
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "dual-lib"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules", "dual-dep"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "dual-lib", "package.json"), JSON.stringify({
    name: "dual-lib",
    version: "1.2.3",
    exports: {
      ".": { import: "./index.mjs", require: "./index.js" },
    },
  }), "utf8");
  await writeFile(
    join(projectRoot, "node_modules", "dual-lib", "index.js"),
    "const { star } = require(\"dual-dep\");\nmodule.exports.decorate = (value) => `${star}${value}${star}`;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "dual-lib", "index.mjs"),
    "import { star } from \"dual-dep\";\nexport const decorate = (value) => `${star}${value}${star}`;\n",
    "utf8",
  );
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "package.json"), JSON.stringify({
    name: "dual-dep",
    version: "2.0.0",
    exports: {
      ".": { import: "./star.mjs", require: "./star.cjs" },
    },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "star.mjs"), "export const star = \"*\";\n", "utf8");
  await writeFile(join(projectRoot, "node_modules", "dual-dep", "star.cjs"), "module.exports.star = \"*\";\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "dual-lib":
    export def decorate(value: string) -> string

import js {decorate} from "dual-lib"

component App:
    return <main>{decorate("velar")}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const port = devServerPort(output);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.doesNotMatch(html, /Cannot resolve browser npm import/u);
  // The import map points both the direct dependency and the transitive bare
  // import of its ESM entry at their prebundled dev modules; other packages
  // stay external inside a prebundle and resolve through the import map.
  assert.match(html, /"dual-lib":"\/@npm\/dual-lib\/index\.js"/u);
  assert.match(html, /"dual-dep":"\/@npm\/dual-dep\/index\.js"/u);
  const entry = await fetch(`http://127.0.0.1:${port}/@npm/dual-lib/index.js`);
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /from "dual-dep"/u);
  const dependency = await fetch(`http://127.0.0.1:${port}/@npm/dual-dep/index.js`);
  assert.equal(dependency.status, 200);
  assert.match(await dependency.text(), /star/u);
  // The prebundle cache is keyed by package version under .velar/dev-deps.
  const meta = JSON.parse(await readFile(join(projectRoot, ".velar", "dev-deps", "dual-lib@1.2.3", "meta.json"), "utf8")) as {
    entries: Record<string, string>;
    externals: string[];
  };
  assert.equal(meta.entries["."], "index.js");
  assert.deepEqual(meta.externals, ["dual-dep"]);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server names genuinely CommonJS-only packages in its refusal", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-cjs-only-");
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "legacy-lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "legacy-lib", "package.json"), JSON.stringify({
    name: "legacy-lib",
    main: "index.js",
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "legacy-lib", "index.js"), "module.exports.decorate = (value) => value;\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "legacy-lib":
    export def decorate(value: string) -> string

import js {decorate} from "legacy-lib"

component App:
    return <main>{decorate("velar")}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const port = devServerPort(output);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  assert.match(html, /Cannot resolve browser npm import 'legacy-lib'/u);
  assert.match(html, /resolves to the CommonJS file &#39;index\.js&#39;|resolves to the CommonJS file 'index\.js'/u);
  assert.match(html, /needs an ESM build/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server prebundles dual packages whose ESM entry wraps CommonJS internals", async (context) => {
  // The npm ecosystem's standard dual-package-hazard wrapper (ledger W-20):
  // the "import"-condition entry is real ESM that default-imports the
  // package's own CommonJS internals, which native browser ESM cannot load
  // raw. The dev prebundle converts the internals exactly like 'velar build'.
  const directory = await makeTemporaryDirectory("velar-dev-cjs-wrapper-");
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "wrapper-lib", "es"), { recursive: true });
  await mkdir(join(projectRoot, "node_modules", "wrapper-lib", "lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "wrapper-lib", "package.json"), JSON.stringify({
    name: "wrapper-lib",
    version: "2.5.0",
    type: "commonjs",
    exports: {
      ".": { import: "./es/index.js", require: "./lib/index.js" },
      "./lib/util": { import: "./es/util.js", require: "./lib/util.js" },
    },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "wrapper-lib", "es", "package.json"), JSON.stringify({ type: "module" }), "utf8");
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "es", "index.js"),
    "import Wrapper from '../lib/index.js';\nexport default Wrapper;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "es", "util.js"),
    "import Util from '../lib/util.js';\nexport default Util;\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "lib", "index.js"),
    "const util = require('./util.js');\nmodule.exports = { frame: (value) => util.wrap(value) };\n",
    "utf8",
  );
  await writeFile(
    join(projectRoot, "node_modules", "wrapper-lib", "lib", "util.js"),
    "module.exports = { wrap: (value) => `[${value}]` };\n",
    "utf8",
  );
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
type Wrapper:
    frame: (value: string) -> string

type Util:
    wrap: (value: string) -> string

extern module "wrapper-lib":
    export const default: Wrapper

extern module "wrapper-lib/lib/util":
    export const default: Util

import js wrapper from "wrapper-lib"
import js util from "wrapper-lib/lib/util"

component App:
    return <main>{wrapper.frame(util.wrap("velar"))}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const port = devServerPort(output);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.doesNotMatch(html, /Cannot resolve browser npm import/u);
  assert.match(html, /"wrapper-lib":"\/@npm\/wrapper-lib\/index\.js"/u);
  assert.match(html, /"wrapper-lib\/lib\/util":"\/@npm\/wrapper-lib\/lib\/util\.js"/u);
  const entry = await fetch(`http://127.0.0.1:${port}/@npm/wrapper-lib/index.js`);
  assert.equal(entry.status, 200);
  const entryText = await entry.text();
  // The CommonJS internals were converted rather than left as raw relative
  // imports the browser would reject with a SyntaxError.
  assert.doesNotMatch(entryText, /from\s*['"]\.\.\/lib\//u);
  assert.match(entryText, /export\s*\{[^}]*default[^}]*\}|export default/u);
  const util = await fetch(`http://127.0.0.1:${port}/@npm/wrapper-lib/lib/util.js`);
  assert.equal(util.status, 200);
  // Both entries come from one splitting build, so the shared internals load
  // as one chunk module instead of two duplicated copies.
  const chunkImport = entryText.match(/from\s*"(\.\/chunk-[^"]+\.js)"/u);
  assert.ok(chunkImport, "expected the prebundled entry to import a shared chunk");
  const chunk = await fetch(`http://127.0.0.1:${port}/@npm/wrapper-lib/${chunkImport![1]!.slice(2)}`);
  assert.equal(chunk.status, 200);
  const meta = JSON.parse(await readFile(join(projectRoot, ".velar", "dev-deps", "wrapper-lib@2.5.0", "meta.json"), "utf8")) as {
    entries: Record<string, string>;
  };
  assert.equal(meta.entries["."], "index.js");
  assert.equal(meta.entries["./lib/util"], "lib/util.js");
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});

test("dev server names genuinely broken packages instead of serving raw module errors", async (context) => {
  const directory = await makeTemporaryDirectory("velar-dev-broken-npm-");
  const projectRoot = join(directory, "app");
  await mkdir(join(projectRoot, "node_modules", "broken-lib"), { recursive: true });
  await writeFile(join(projectRoot, "node_modules", "broken-lib", "package.json"), JSON.stringify({
    name: "broken-lib",
    version: "1.0.0",
    exports: { ".": { import: "./index.mjs" } },
  }), "utf8");
  await writeFile(join(projectRoot, "node_modules", "broken-lib", "index.mjs"), "export default {\n", "utf8");
  await linkWorkspaceWebExtension(projectRoot);
  await writeFile(join(projectRoot, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(projectRoot, "main.vel"), `
extern module "broken-lib":
    export def decorate(value: string) -> string

import js {decorate} from "broken-lib"

component App:
    return <main>{decorate("velar")}</main>

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const child = spawn(process.execPath, ["packages/cli/src/cli.ts", "dev", projectRoot, "--port", "0"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => stopDevServer(child));
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  const deadline = Date.now() + 10_000;
  while (!output.includes("VelarScript dev server:") && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.match(output, /VelarScript dev server:/u);
  const port = devServerPort(output);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  const html = await page.text();
  // The failure is velar-voiced and names the package; the browser never
  // receives a raw module for a package that cannot be prebundled.
  assert.match(html, /VelarScript build error/u);
  assert.match(html, /Cannot resolve browser npm import &#39;broken-lib&#39;|Cannot resolve browser npm import 'broken-lib'/u);
  child.kill("SIGTERM");
  const exitCode = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  assertDevServerExit(exitCode, String(child.stderr.read() ?? ""));
});
