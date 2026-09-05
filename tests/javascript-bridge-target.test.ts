import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const cli = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));
const nodePackage = fileURLToPath(new URL("../packages/node", import.meta.url));
const webPackage = fileURLToPath(new URL("../packages/web", import.meta.url));

function runCli(arguments_: readonly string[], cwd: string) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function linkExtension(root: string, name: "node" | "web"): Promise<void> {
  const scope = join(root, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(name === "node" ? nodePackage : webPackage, join(scope, name), "dir");
}

async function writeWebProject(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await linkExtension(root, "web");
  await writeFile(join(root, "src", "main.vel"), [
    'import js unsafe {readFileSync} from "node:fs"',
    "component App:",
    "    return <main>Target boundary</main>",
    '@main: mount(<App />, "#app")',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "Target boundary" },
  }, null, 2)}\n`, "utf8");
}

async function writeLibrary(root: string, target: "core" | "node"): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  if (target === "node") await linkExtension(root, "node");
  await writeFile(join(root, "src", "index.vel"), [
    'import js unsafe {readFileSync} from "node:fs"',
    `export def targetName() -> string: return ${JSON.stringify(target)}`,
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: `${target}-javascript-builtin-library`,
    version: "1.0.0",
    type: "module",
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { [target]: "dist/velar-library.json" },
      targets: [target],
      requires: { capabilities: target === "node" ? ["node"] : [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: target === "node" ? ["@velarscript/node"] : [],
  }, null, 2)}\n`, "utf8");
}

async function writeJavaScriptDependency(
  root: string,
  target: "core" | "node",
  specifier: string,
  packageName: string,
  manifest: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  await writeLibrary(root, target);
  await writeFile(join(root, "src", "index.vel"), [
    `import js unsafe {value} from ${JSON.stringify(specifier)}`,
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");
  await installJavaScriptPackage(root, packageName, manifest, files);
}

async function installJavaScriptPackage(
  root: string,
  packageName: string,
  manifest: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const dependency = join(root, "node_modules", packageName);
  await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, "package.json"), manifest, "utf8");
  for (const [path, contents] of Object.entries(files)) {
    const output = join(dependency, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents, "utf8");
  }
}

test("Web check and build reject direct Node builtin JavaScript imports", async () => {
  const root = await makeTemporaryDirectory("velar-web-js-builtin-target-");
  await writeWebProject(root);
  for (const command of ["check", "build"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted node:fs\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /JavaScript Node builtin import "node:fs" is available only to the Node target; the current target is 'web'/u);
  }
});

test("Web check and build require a browser-resolvable JavaScript package entry", async () => {
  const fixtures = [
    {
      suffix: "blocked-export",
      manifest: JSON.stringify({
        name: "web-runtime-dependency",
        version: "1.0.0",
        type: "module",
        exports: { ".": { browser: null, node: "./node.mjs", default: null } },
      }),
      files: { "node.mjs": "export const value = 1;\n" },
      expected: /does not export '\.' under browser ESM conditions/u,
    },
    {
      suffix: "legacy-browser-map",
      manifest: JSON.stringify({
        name: "web-runtime-dependency",
        version: "1.0.0",
        type: "module",
        main: "index.js",
        browser: { "./index.js": "./browser.js" },
      }),
      files: {
        "index.js": "export const value = 1;\n",
        "browser.js": "export const value = 2;\n",
      },
      expected: /legacy package\.json#browser map.*explicit browser ESM branch.*package\.json#exports/u,
    },
  ] as const;
  for (const fixture of fixtures) {
    const root = await makeTemporaryDirectory(`velar-web-js-${fixture.suffix}-`);
    await writeWebProject(root);
    await writeFile(join(root, "src", "main.vel"), [
      'import js unsafe {value} from "web-runtime-dependency"',
      "component App:",
      "    return <main>Target boundary</main>",
      '@main: mount(<App />, "#app")',
      "",
    ].join("\n"), "utf8");
    await installJavaScriptPackage(root, "web-runtime-dependency", fixture.manifest, fixture.files);
    for (const command of ["check", "build"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, 1, `${command} unexpectedly accepted ${fixture.suffix}\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, fixture.expected);
    }
  }
});

test("Core library check and build-library reject direct Node builtin imports", async () => {
  const root = await makeTemporaryDirectory("velar-core-js-builtin-target-");
  await writeLibrary(root, "core");
  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted node:fs\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /JavaScript Node builtin import "node:fs" is available only to the Node target; the current target is 'core'/u);
  }
});

test("Core check and build-library reject a Node builtin hidden inside an inline data module", async () => {
  const root = await makeTemporaryDirectory("velar-core-data-builtin-target-");
  await writeLibrary(root, "core");
  const dataModule = "data:text/javascript,import%20%22node%3Afs%22%3Bexport%20const%20value%20%3D%201";
  await writeFile(join(root, "src", "index.vel"), [
    `extern module ${JSON.stringify(dataModule)}:`,
    "    export const value: number",
    `import js {value} from ${JSON.stringify(dataModule)}`,
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted a hidden Node builtin\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Inline JavaScript data module.*Node builtin 'node:fs' is available only to the Node target/u);
  }
});

test("Node check and build-library accept a Node builtin inside a closed inline data module", async () => {
  const root = await makeTemporaryDirectory("velar-node-data-builtin-target-");
  await writeLibrary(root, "node");
  const dataModule = "data:text/javascript,import%20%22node%3Afs%22%3Bexport%20const%20value%20%3D%201";
  await writeFile(join(root, "src", "index.vel"), [
    `extern module ${JSON.stringify(dataModule)}:`,
    "    export const value: number",
    `import js {value} from ${JSON.stringify(dataModule)}`,
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 0, `${command} unexpectedly rejected the Node data module\n${result.stdout}${result.stderr}`);
  }
});

test("Node library check and build-library retain direct Node builtin imports", async () => {
  const root = await makeTemporaryDirectory("velar-node-js-builtin-target-");
  await writeLibrary(root, "node");
  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 0, `${command} unexpectedly rejected node:fs\n${result.stdout}${result.stderr}`);
  }
});

test("package imports aliases cannot smuggle a Node builtin into Core", async () => {
  const root = await makeTemporaryDirectory("velar-core-js-builtin-alias-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "core-builtin-alias",
    version: "1.0.0",
    type: "module",
    imports: { "#filesystem": "node:fs" },
  }, null, 2)}\n`, "utf8");
  const input = join(root, "src", "main.vel");
  await writeFile(input, 'import js unsafe {readFileSync} from "#filesystem"\n', "utf8");
  const core = await compileProject(input, new Map(), { projectRoot: root, packageTarget: "core" });
  const coreMessages = [
    ...core.failures.map((failure) => failure.message),
    ...core.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  assert.match(coreMessages, /Node builtin 'node:fs' is available only to the Node target/u);

  const node = await compileProject(input, new Map(), { projectRoot: root, packageTarget: "node" });
  assert.deepEqual(node.failures, []);
  assert.deepEqual(node.modules.flatMap((module) => module.result.diagnostics), []);
});

test("Node check and build-library select the node-addons package-import condition", async () => {
  const root = await makeTemporaryDirectory("velar-node-js-node-addons-");
  await writeLibrary(root, "node");
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.imports = {
    "#platform": { "node-addons": "./javascript/addon.mjs", node: "./javascript/node.mjs" },
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(join(root, "javascript"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "javascript", "addon.mjs"), 'export const platform = "node-addon-branch";\n', "utf8"),
    writeFile(join(root, "javascript", "node.mjs"), 'export const platform = "node-branch";\n', "utf8"),
  ]);
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "#platform":',
    "    export const platform: string",
    'import js {platform} from "#platform"',
    "export def selected() -> string: return platform",
    "",
  ].join("\n"), "utf8");

  const checked = runCli(["check", root], root);
  assert.equal(checked.status, 0, checked.stderr);
  const built = runCli(["build-library", root, "--mode", "readable"], root);
  assert.equal(built.status, 0, built.stderr);
  const output = await readFile(join(root, "dist", "index.js"), "utf8");
  assert.match(output, /node-addon-branch/u);
  assert.doesNotMatch(output, /node-branch/u);
});

test("package-owned JavaScript aliases cannot hide Node builtins from Core check", async () => {
  for (const target of ["core", "node"] as const) {
    const root = await makeTemporaryDirectory(`velar-${target}-owned-js-builtin-`);
    await writeLibrary(root, target);
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.imports = { "#helper": "./javascript/helper.mjs" };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await mkdir(join(root, "javascript"), { recursive: true });
    await writeFile(join(root, "javascript", "helper.mjs"), [
      'import "node:fs";',
      "export const value = 1;",
      "",
    ].join("\n"), "utf8");
    await writeFile(join(root, "src", "index.vel"), [
      'extern module "#helper":',
      "    export const value: number",
      'import js {value} from "#helper"',
      "export def answer() -> number: return value",
      "",
    ].join("\n"), "utf8");

    for (const command of ["check", "build-library"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, target === "node" ? 0 : 1, `${command} ${target}\n${result.stdout}${result.stderr}`);
      if (target === "core") assert.match(result.stderr, /Node builtin 'node:fs' is available only to the Node target/u);
    }
  }
});

test("package-owned JavaScript bare edges use the Core package target fence", async () => {
  const root = await makeTemporaryDirectory("velar-core-owned-js-package-");
  await writeLibrary(root, "core");
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.imports = { "#helper": "./javascript/helper.mjs" };
  manifest.dependencies = { "node-only-javascript": "1.0.0" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(join(root, "javascript"), { recursive: true });
  await writeFile(join(root, "javascript", "helper.mjs"), [
    'import { platformValue } from "node-only-javascript";',
    "export const value = platformValue;",
    "",
  ].join("\n"), "utf8");
  await installJavaScriptPackage(root, "node-only-javascript", JSON.stringify({
    name: "node-only-javascript",
    version: "1.0.0",
    type: "module",
    exports: { ".": { node: "./node.mjs", browser: null, default: null } },
  }), { "node.mjs": "export const platformValue = 1;\n" });
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "#helper":',
    "    export const value: number",
    'import js {value} from "#helper"',
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted a Node-only nested package\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /does not export '\.' under both Node and browser ESM conditions/u);
  }
});

test("package-owned JavaScript bare edges require runtime dependency ownership", async () => {
  const root = await makeTemporaryDirectory("velar-core-owned-js-runtime-owner-");
  await writeLibrary(root, "core");
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.imports = { "#helper": "./javascript/helper.mjs" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(join(root, "javascript"), { recursive: true });
  await writeFile(join(root, "javascript", "helper.mjs"), [
    'import { platformValue } from "portable-javascript";',
    "export const value = platformValue;",
    "",
  ].join("\n"), "utf8");
  await installJavaScriptPackage(root, "portable-javascript", JSON.stringify({
    name: "portable-javascript",
    version: "1.0.0",
    type: "module",
    exports: { ".": "./index.mjs" },
  }), { "index.mjs": "export const platformValue = 1;\n" });
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "#helper":',
    "    export const value: number",
    'import js {value} from "#helper"',
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted an unowned package edge\n${result.stdout}${result.stderr}`);
    assert.match(
      result.stderr,
      /retains runtime import 'portable-javascript'.*package\.json#dependencies does not declare 'portable-javascript'/u,
    );
  }

  manifest.dependencies = { "portable-javascript": "1.0.0" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(root, "javascript", "helper.mjs"), [
    'import { platformValue } from "portable-javascript/missing";',
    "export const value = platformValue;",
    "",
  ].join("\n"), "utf8");
  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted a missing nested subpath\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /does not export '\.\/missing' under both Node and browser ESM conditions/u);
  }
});

test("package self JavaScript helpers cannot hide Node builtins from Core check", async () => {
  const root = await makeTemporaryDirectory("velar-core-self-js-builtin-");
  await writeLibrary(root, "core");
  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.exports = { ".": "./dist/index.js", "./helper": "./javascript/helper.mjs" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await mkdir(join(root, "javascript"), { recursive: true });
  await writeFile(join(root, "javascript", "helper.mjs"), 'import "node:fs";\nexport const value = 1;\n', "utf8");
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "core-javascript-builtin-library/helper":',
    "    export const value: number",
    'import js {value} from "core-javascript-builtin-library/helper"',
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted a self helper builtin\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Node builtin 'node:fs' is available only to the Node target/u);
  }
});

test("Core rejects JavaScript packages without a browser ESM export", async () => {
  const root = await makeTemporaryDirectory("velar-core-js-package-target-");
  await mkdir(join(root, "src"), { recursive: true });
  const dependency = join(root, "node_modules", "node-only-javascript");
  await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, "package.json"), `${JSON.stringify({
    name: "node-only-javascript",
    version: "1.0.0",
    type: "module",
    exports: { ".": { node: "./node.js", browser: null, default: null } },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(dependency, "node.js"), 'export const value = "node";\n', "utf8");
  await writeFile(join(root, "src", "index.vel"), [
    'import js unsafe {value} from "node-only-javascript"',
    'export def name() -> string: return "core"',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "core-node-only-dependency",
    version: "1.0.0",
    type: "module",
    dependencies: { "node-only-javascript": "1.0.0" },
    exports: { ".": "./dist/index.js" },
    velar: {
      entry: "src/index.vel",
      artifacts: { core: "dist/velar-library.json" },
      targets: ["core"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "library",
    entry: "src/index.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`, "utf8");

  for (const command of ["check", "build-library"] as const) {
    const result = runCli([command, root], root);
    assert.equal(result.status, 1, `${command} unexpectedly accepted a Node-only package\n${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Core JavaScript package import "node-only-javascript" is not target-neutral.*does not export '\.' under both Node and browser ESM conditions/u);
  }
});

test("Core requires an explicit Node-and-browser ESM package contract", async () => {
  const fixtures = [
    {
      suffix: "legacy",
      manifest: JSON.stringify({ name: "core-runtime-dependency", version: "1.0.0", main: "index.cjs" }),
      files: { "index.cjs": "module.exports.value = 1;\n" },
      expected: /has no explicit Node-and-browser ESM exports map/u,
    },
    {
      suffix: "commonjs-export",
      manifest: JSON.stringify({
        name: "core-runtime-dependency",
        version: "1.0.0",
        type: "commonjs",
        exports: { ".": "./index.js" },
      }),
      files: { "index.js": "module.exports.value = 1;\n" },
      expected: /export '\.\/index\.js' is not provably ESM for both Node and browser consumers/u,
    },
    {
      suffix: "nested-commonjs-scope",
      manifest: JSON.stringify({
        name: "core-runtime-dependency",
        version: "1.0.0",
        type: "module",
        exports: { ".": "./nested/index.js" },
      }),
      files: {
        "nested/package.json": JSON.stringify({ type: "commonjs" }),
        "nested/index.js": "module.exports.value = 1;\n",
      },
      expected: /export '\.\/nested\/index\.js' is not provably ESM for both Node and browser consumers/u,
    },
  ] as const;
  for (const fixture of fixtures) {
    const root = await makeTemporaryDirectory(`velar-core-js-${fixture.suffix}-`);
    await writeJavaScriptDependency(
      root,
      "core",
      "core-runtime-dependency",
      "core-runtime-dependency",
      fixture.manifest,
      fixture.files,
    );
    for (const command of ["check", "build-library"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, 1, `${command} unexpectedly accepted ${fixture.suffix}\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, fixture.expected);
    }
  }
});

test("JavaScript package checks reject missing subpaths, missing targets, and invalid manifests", async () => {
  const fixtures = [
    {
      suffix: "legacy-subpath",
      specifier: "legacy-javascript/missing.js",
      manifest: JSON.stringify({ name: "legacy-javascript", version: "1.0.0", type: "module", main: "index.js" }),
      files: { "index.js": "export const value = 1;\n" },
      expected: /legacy node entry 'missing\.js' does not resolve to an ordinary file/u,
    },
    {
      suffix: "legacy-url-ambiguous",
      specifier: "legacy-javascript",
      manifest: JSON.stringify({ name: "legacy-javascript", version: "1.0.0", type: "module", main: "index.js?tag" }),
      files: { "index.js?tag": "export const value = 1;\n" },
      expected: /invalid legacy node entry 'index\.js\?tag'/u,
    },
    {
      suffix: "missing-export",
      specifier: "exported-javascript/missing",
      manifest: JSON.stringify({
        name: "exported-javascript",
        version: "1.0.0",
        type: "module",
        exports: { ".": "./index.js" },
      }),
      files: { "index.js": "export const value = 1;\n" },
      expected: /does not export '\.\/missing' under node ESM conditions/u,
    },
    {
      suffix: "missing-target",
      specifier: "exported-javascript",
      manifest: JSON.stringify({
        name: "exported-javascript",
        version: "1.0.0",
        type: "module",
        exports: { ".": "./missing.js" },
      }),
      files: {},
      expected: /export '\.\/missing\.js' does not resolve to an ordinary file/u,
    },
    {
      suffix: "invalid-manifest",
      specifier: "invalid-javascript",
      manifest: "{ invalid",
      files: { "index.js": "export const value = 1;\n" },
      expected: /has an unreadable or invalid package\.json/u,
    },
  ] as const;
  for (const fixture of fixtures) {
    const root = await makeTemporaryDirectory(`velar-node-js-${fixture.suffix}-`);
    const packageName = fixture.specifier.split("/")[0]!;
    await writeJavaScriptDependency(root, "node", fixture.specifier, packageName, fixture.manifest, fixture.files);
    for (const command of ["check", "build-library"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, 1, `${command} unexpectedly accepted ${fixture.suffix}\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, fixture.expected);
    }
  }
});

test("JavaScript package export targets reject URL and path ambiguity during check and build", async () => {
  const fixtures = [
    { suffix: "encoded-separator", target: "./foo%2fbar.js", file: "foo%2fbar.js", expected: /must be an exact normalized package-relative path/u },
    { suffix: "query", target: "./index.js?tag", file: "index.js?tag", expected: /must be an exact normalized package-relative path/u },
    { suffix: "fragment", target: "./index.js#tag", file: "index.js#tag", expected: /must be an exact normalized package-relative path/u },
    { suffix: "empty-segment", target: "./folder//index.js", file: "folder/index.js", expected: /cannot contain empty path segments/u },
  ] as const;
  for (const fixture of fixtures) {
    const root = await makeTemporaryDirectory(`velar-node-js-export-${fixture.suffix}-`);
    await writeJavaScriptDependency(
      root,
      "node",
      "ambiguous-javascript",
      "ambiguous-javascript",
      JSON.stringify({
        name: "ambiguous-javascript",
        version: "1.0.0",
        type: "module",
        exports: { ".": fixture.target },
      }),
      { [fixture.file]: "export const value = 1;\n" },
    );
    for (const command of ["check", "build-library"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, 1, `${command} unexpectedly accepted ${fixture.target}\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, fixture.expected);
    }
  }
});

test("package imports file targets reject encoded and empty path segments", async () => {
  const fixtures = [
    { suffix: "encoded", target: "./javascript/foo%2fbar.mjs", file: "javascript/foo%2fbar.mjs" },
    { suffix: "empty", target: "./javascript//helper.mjs", file: "javascript/helper.mjs" },
  ] as const;
  for (const fixture of fixtures) {
    const root = await makeTemporaryDirectory(`velar-core-js-imports-${fixture.suffix}-`);
    await writeLibrary(root, "core");
    const manifestPath = join(root, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest.imports = { "#helper": fixture.target };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const helperPath = join(root, fixture.file);
    await mkdir(dirname(helperPath), { recursive: true });
    await writeFile(helperPath, "export const value = 1;\n", "utf8");
    await writeFile(join(root, "src", "index.vel"), [
      'extern module "#helper":',
      "    export const value: number",
      'import js {value} from "#helper"',
      "export def answer() -> number: return value",
      "",
    ].join("\n"), "utf8");
    for (const command of ["check", "build-library"] as const) {
      const result = runCli([command, root], root);
      assert.equal(result.status, 1, `${command} unexpectedly accepted ${fixture.target}\n${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /invalid package\.json#imports target/u);
    }
  }
});

test("build-library requires retained JavaScript packages in runtime dependencies", async () => {
  const root = await makeTemporaryDirectory("velar-node-js-runtime-owner-");
  await writeJavaScriptDependency(
    root,
    "node",
    "runtime-javascript",
    "runtime-javascript",
    JSON.stringify({
      name: "runtime-javascript",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./index.js" },
    }),
    { "index.js": "export const value = 1;\n" },
  );
  await writeFile(join(root, "src", "index.vel"), [
    'extern module "runtime-javascript":',
    "    export const value: number",
    'import js {value} from "runtime-javascript"',
    "export def answer() -> number: return value",
    "",
  ].join("\n"), "utf8");

  const checked = runCli(["check", root], root);
  assert.equal(checked.status, 0, checked.stderr);
  const undeclared = runCli(["build-library", root], root);
  assert.equal(undeclared.status, 1, `${undeclared.stdout}${undeclared.stderr}`);
  assert.match(
    undeclared.stderr,
    /retains runtime import 'runtime-javascript'.*package\.json#dependencies does not declare 'runtime-javascript'/u,
  );

  const manifestPath = join(root, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest.dependencies = { "runtime-javascript": "1.0.0" };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const declared = runCli(["build-library", root], root);
  assert.equal(declared.status, 0, `${declared.stdout}${declared.stderr}`);
});

test("Core package imports aliases must select one environment-neutral target", async () => {
  const root = await makeTemporaryDirectory("velar-core-js-conditional-alias-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "core-conditional-alias",
    version: "1.0.0",
    type: "module",
    imports: {
      "#platform": { node: "./src/node.mjs", browser: "./src/browser.mjs" },
    },
  }, null, 2)}\n`, "utf8");
  await Promise.all([
    writeFile(join(root, "src", "node.mjs"), 'export const platform = "node";\n', "utf8"),
    writeFile(join(root, "src", "browser.mjs"), 'export const platform = "browser";\n', "utf8"),
  ]);
  const input = join(root, "src", "main.vel");
  await writeFile(input, 'import js unsafe {platform} from "#platform"\n', "utf8");

  const core = await compileProject(input, new Map(), { projectRoot: root, packageTarget: "core" });
  const messages = [
    ...core.failures.map((failure) => failure.message),
    ...core.modules.flatMap((module) => module.result.diagnostics.map((diagnostic) => diagnostic.message)),
  ].join("\n");
  assert.match(messages, /Core package imports aliases must resolve to the same target under Node and browser conditions/u);

  const node = await compileProject(input, new Map(), { projectRoot: root, packageTarget: "node" });
  assert.deepEqual(node.failures, []);
  assert.deepEqual(node.modules.flatMap((module) => module.result.diagnostics), []);
});
