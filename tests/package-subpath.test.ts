import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { resolveBrowserNpm } from "../packages/cli/src/npm.ts";
import { compileProject, projectImportKey } from "../packages/cli/src/project.ts";
import { parseVelarSourcePackageManifest } from "../packages/cli/src/source-package-manifest.ts";
import { writeCompiledTestProject } from "../packages/cli/src/test-output.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

function messages(project: Awaited<ReturnType<typeof compileProject>>): string {
  return [
    ...project.failures.map((failure) => failure.message),
    ...project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message)),
  ].join("\n");
}

async function writePackage(
  consumer: string,
  name: string,
  velar: Record<string, unknown>,
  sources: Readonly<Record<string, string>>,
  exports?: Readonly<Record<string, unknown>>,
): Promise<string> {
  const root = join(consumer, "node_modules", ...name.split("/"));
  await writePackageAt(root, name, velar, sources, exports);
  return root;
}

async function writePackageAt(
  root: string,
  name: string,
  velar: Record<string, unknown>,
  sources: Readonly<Record<string, string>>,
  exports?: Readonly<Record<string, unknown>>,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    ...(exports === undefined ? {} : { exports }),
    velar,
  }), "utf8");
  for (const [path, source] of Object.entries(sources)) {
    const output = join(root, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, source, "utf8");
  }
}

test("declared VelarScript package subpaths resolve beside the root entry", async () => {
  const consumer = await makeTemporaryDirectory("velar-package-subpath-");
  const packageRoot = await writePackage(consumer, "@fixture/tools", {
    entry: "src/index.vel",
    entries: { "./worker": "src/worker.vel" },
    targets: ["core"],
    requires: { capabilities: [] },
  }, {
    "src/index.vel": "export const rootValue = 2\n",
    "src/helper.vel": "export const offset = 3\n",
    "src/worker.vel": "import {offset} from \"./helper.vel\"\nexport const workerValue = 4 + offset\n",
  });
  const entry = join(consumer, "main.vel");
  await writeFile(entry, [
    'import {rootValue} from "@fixture/tools"',
    'import {workerValue} from "@fixture/tools/worker"',
    "print(rootValue + workerValue)",
    "",
  ].join("\n"), "utf8");

  const project = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.equal(messages(project), "");
  assert.equal(project.velarPackages.length, 1, "root and subpath imports are one installed package identity");
  const package_ = project.velarPackages[0]!;
  assert.equal(package_.root, packageRoot);
  assert.deepEqual([...package_.entries.keys()], [".", "./worker"]);
  assert.equal(package_.artifacts.size, 0);
  assert.equal(project.velarImports.get(projectImportKey(entry, "@fixture/tools")), join(packageRoot, "src/index.vel"));
  assert.equal(project.velarImports.get(projectImportKey(entry, "@fixture/tools/worker")), join(packageRoot, "src/worker.vel"));

  const browser = await resolveBrowserNpm(project);
  assert.deepEqual(browser.failures, []);
  assert.match(browser.imports["@fixture/tools"] ?? "", /__velar_packages__\/@fixture\/tools\/src\/index\.js$/u);
  assert.match(browser.imports["@fixture/tools/worker"] ?? "", /__velar_packages__\/@fixture\/tools\/src\/worker\.js$/u);

  const output = join(consumer, "compiled");
  await writeCompiledTestProject(project, output, false);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "9\n");
});

test("package self-references inspect only the importer's nearest package scope", async () => {
  const outer = await makeTemporaryDirectory("velar-package-self-scope-");
  const contract = {
    entry: "src/index.vel",
    entries: { "./worker": "src/worker.vel" },
    resources: { "./catalog": { path: "generated/catalog.json", type: "json" } },
    targets: ["core"],
    requires: { capabilities: [] },
  };
  const exports = {
    ".": "./src/index.js",
    "./worker": "./src/worker.js",
    "./catalog": "./generated/catalog.json",
  };
  await writePackageAt(outer, "outer", contract, {
    "src/index.vel": "export const root = \"outer\"\n",
    "src/worker.vel": "export const label = \"outer\"\n",
    "generated/catalog.json": JSON.stringify({ label: "outer" }),
  }, exports);
  const dependency = await writePackage(outer, "dep", {
    entry: "src/index.vel",
    targets: ["core"],
    requires: { capabilities: [] },
  }, {
    "src/index.vel": [
      'import {label} from "outer/worker"',
      'import json rawCatalog from "outer/catalog"',
      "",
      "export const selected = label",
      "",
    ].join("\n"),
  });
  const nested = await writePackage(dependency, "outer", contract, {
    "src/index.vel": "export const root = \"nested\"\n",
    "src/worker.vel": "export const label = \"nested\"\n",
    "generated/catalog.json": JSON.stringify({ label: "nested" }),
  }, exports);
  const entry = join(outer, "main.vel");
  await writeFile(entry, 'import {selected} from "dep"\nprint(selected)\n', "utf8");

  const project = await compileProject(entry, new Map(), { projectRoot: outer });
  assert.equal(messages(project), "");
  const dependencyEntry = join(dependency, "src", "index.vel");
  assert.equal(
    project.velarImports.get(projectImportKey(dependencyEntry, "outer/worker")),
    join(nested, "src", "worker.vel"),
  );
  assert.equal(
    project.resourceImports.get(projectImportKey(dependencyEntry, "outer/catalog"))?.inputPath,
    join(nested, "generated", "catalog.json"),
  );
  assert.ok(project.modules.some((module) => module.inputPath === join(nested, "src", "worker.vel")));
  assert.ok(!project.modules.some((module) => module.inputPath === join(outer, "src", "worker.vel")));
});

test("undeclared and malformed package subpaths fail closed", async () => {
  const consumer = await makeTemporaryDirectory("velar-package-subpath-closed-");
  await writePackage(consumer, "closed-package", {
    entry: "src/index.vel",
    entries: { "./public": "src/public.vel" },
    targets: ["core"],
    requires: { capabilities: [] },
  }, {
    "src/index.vel": "export const value = 1\n",
    "src/public.vel": "export const value = 2\n",
    "src/private.vel": "export const secret = 3\n",
  });
  const entry = join(consumer, "main.vel");
  await writeFile(entry, 'import {secret} from "closed-package/private"\nprint(secret)\n', "utf8");
  const undeclared = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(undeclared), /does not declare VelarScript entry '\.\/private' in package\.json#velar\.entries/u);
  assert.ok(!undeclared.modules.some((module) => module.inputPath.endsWith("private.vel")));

  await writeFile(entry, 'import {secret} from "closed-package/../private"\nprint(secret)\n', "utf8");
  const traversal = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(traversal), /must be an exact '\.\/name' package subpath/u);

  await writeFile(entry, 'import {value} from "closed-package/"\nprint(value)\n', "utf8");
  const trailingSlash = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(trailingSlash), /must be an exact '\.\/name' package subpath/u);

  for (const specifier of ["Closed-package/public", "@Scope/closed/public", "closed-package\\public"]) {
    await writeFile(entry, `import {value} from ${JSON.stringify(specifier)}\nprint(value)\n`, "utf8");
    const invalidName = await compileProject(entry, new Map(), { projectRoot: consumer });
    assert.match(messages(invalidName), /invalid npm package name/u, specifier);
  }
});

test("velar.entries accepts only exact normalized source declarations", async () => {
  const consumer = await makeTemporaryDirectory("velar-package-subpath-manifest-");
  const entry = join(consumer, "main.vel");
  await writeFile(entry, 'import {value} from "malformed/worker"\nprint(value)\n', "utf8");
  const cases = [
    [{ "./*": "src/worker.vel" }, /exact '\.\/name' package subpath/u],
    [{ "./worker.vel": "src/worker.vel" }, /must not end with \.vel/u],
    [{ "./worker": "../worker.vel" }, /normalized package-relative \.vel source path/u],
    [{ "./worker": "src/worker.js" }, /must point to a \.vel source file/u],
  ] as const;
  for (const [entries, expected] of cases) {
    await writePackage(consumer, "malformed", {
      entry: "src/index.vel",
      entries,
      targets: ["core"],
      requires: { capabilities: [] },
    }, { "src/index.vel": "export const value = 1\n", "src/worker.vel": "export const value = 2\n" });
    const project = await compileProject(entry, new Map(), { projectRoot: consumer });
    assert.match(messages(project), expected);
  }
});

test("package resources use strict ordered npm export conditions", () => {
  const resource = { "./data": { path: "generated/data.json", type: "json" } };
  const manifest = (exports: unknown): Record<string, unknown> => ({
    name: "resource-conditions",
    version: "1.0.0",
    exports,
    velar: {
      entry: "src/index.vel",
      resources: resource,
      targets: ["core"],
      requires: { capabilities: [] },
    },
  });
  assert.doesNotThrow(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    ".": "./dist/index.js",
    "./data": { types: "./generated/data.d.ts", default: "./generated/data.json" },
  })));
  assert.doesNotThrow(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    ".": "./dist/index.js",
    "./data": ["../invalid.json", "./generated/data.json"],
  })));
  assert.throws(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    ".": "./dist/index.js",
  })), /must expose resource '\.\/data'/u);
  assert.throws(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    ".": "./dist/index.js",
    "./data": { browser: null, default: "./generated/data.json" },
  })), /must expose resource '\.\/data'/u);
  assert.throws(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    ".": "./dist/index.js",
    "./data": { browser: "../outside.json", default: "./generated/data.json" },
  })), /package\.json 'exports' target '\.\.\/outside\.json' must start with '\.\/'/u);
  assert.throws(() => parseVelarSourcePackageManifest("resource-conditions", "/package", manifest({
    "./data": "./generated/data.json",
    browser: "./dist/browser.js",
  })), /cannot mix package subpath keys with condition keys/u);
  assert.throws(
    () => parseVelarSourcePackageManifest("resource-conditions", "/package", null),
    /package\.json must contain a JSON object/u,
  );
});

test("VelarScript package entries cannot escape or alias physical sources through symlinks", async () => {
  const consumer = await makeTemporaryDirectory("velar-package-subpath-symlink-");
  const entry = join(consumer, "main.vel");
  await writeFile(entry, 'import {value} from "linked/worker"\nprint(value)\n', "utf8");
  const packageRoot = await writePackage(consumer, "linked", {
    entry: "src/index.vel",
    entries: { "./worker": "src/worker.vel" },
    targets: ["core"],
    requires: { capabilities: [] },
  }, { "src/index.vel": "export const value = 1\n" });
  const outside = join(consumer, "outside.vel");
  await writeFile(outside, "export const value = 2\n", "utf8");
  await symlink(outside, join(packageRoot, "src", "worker.vel"));
  const escaped = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(escaped), /entry '\.\/worker' cannot escape the package root through a symbolic link/u);
  assert.ok(!escaped.modules.some((module) => module.inputPath === outside));

  await unlink(join(packageRoot, "src", "worker.vel"));
  await writeFile(join(packageRoot, "src", "worker.vel"), "export const value = 3\n", "utf8");
  await symlink("worker.vel", join(packageRoot, "src", "alias.vel"));
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "linked",
    version: "1.0.0",
    type: "module",
    velar: {
      entry: "src/index.vel",
      entries: { "./worker": "src/worker.vel", "./alias": "src/alias.vel" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  const aliased = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(aliased), /resolve 'src\/worker\.vel' and 'src\/alias\.vel' to the same physical source/u);
});

test("subpath source entries obey language, target, and capability gates before compilation", async () => {
  const consumer = await makeTemporaryDirectory("velar-package-subpath-contract-");
  const entry = join(consumer, "main.vel");
  await writeFile(entry, 'import {value} from "guarded/worker"\nprint(value)\n', "utf8");
  const base = {
    entry: "src/index.vel",
    entries: { "./worker": "src/worker.vel" },
  };
  const sources = {
    "src/index.vel": "export const value = 1\n",
    "src/worker.vel": "this source must not be compiled after a rejected package contract\n",
  };

  await writePackage(consumer, "guarded", {
    ...base,
    targets: ["node"],
    requires: { capabilities: [], language: "0.1" },
  }, sources);
  const language = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(language), /requires VelarScript language 0\.1/u);
  assert.equal(language.modules.length, 1);

  await writePackage(consumer, "guarded", {
    ...base,
    targets: ["web"],
    requires: { capabilities: [] },
  }, sources);
  const target = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(target), /does not support the 'node' target/u);
  assert.equal(target.modules.length, 1);

  await writePackage(consumer, "guarded", {
    ...base,
    targets: ["node"],
    requires: { capabilities: ["gpu"] },
  }, sources);
  const capability = await compileProject(entry, new Map(), { projectRoot: consumer });
  assert.match(messages(capability), /requires host capability 'gpu'/u);
  assert.equal(capability.modules.length, 1);
});
