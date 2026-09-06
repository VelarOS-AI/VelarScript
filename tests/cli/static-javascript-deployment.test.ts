import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { build } from "esbuild";
import { createEsbuildJavaScriptSnapshotCapture } from "../../packages/cli/src/esbuild-javascript-snapshot.ts";
import { ordinaryEsbuildInputPaths } from "../../packages/cli/src/esbuild-inputs.ts";
import {
  assertStaticJavaScriptDeploymentInputs,
  assertStaticJavaScriptDeploymentSources,
} from "../../packages/cli/src/static-javascript-deployment.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";

after(removeTemporaryDirectories);

test("static deployment accepts direct literal CommonJS edges", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-visible-");
  const input = join(root, "index.cjs");
  await writeFile(input, 'const path = require("node:path");\nmodule.exports = path.sep;\n', "utf8");
  await assert.doesNotReject(assertStaticJavaScriptDeploymentInputs([input], "Fixture build"));
});

test("static deployment proves the same ordinary JavaScript bytes that esbuild consumed", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-snapshot-");
  const input = join(root, "index.js");
  await writeFile(input, 'globalThis.require("hidden-package");\n', "utf8");
  const capture = createEsbuildJavaScriptSnapshotCapture("Fixture build");
  const bundled = await build({
    absWorkingDir: root,
    bundle: true,
    entryPoints: [input],
    format: "esm",
    logLevel: "silent",
    metafile: true,
    outdir: join(root, "output"),
    platform: "node",
    plugins: [capture.plugin],
    write: false,
  });
  await writeFile(input, "export const safe = true;\n", "utf8");

  await assert.rejects(
    capture.assertInputs(ordinaryEsbuildInputPaths(bundled.metafile, root)),
    /indirect CommonJS require/u,
  );
});

test("static deployment checks generated sources without requiring a physical package owner", () => {
  const builtin = assertStaticJavaScriptDeploymentSources([
    { code: 'const path = require("node:path");\nexport const separator = path.sep;\n', label: "generated fixture" },
  ], "Fixture build");
  assert.equal(builtin.requiresNodeBundle, true);
  const packageLoad = assertStaticJavaScriptDeploymentSources([
    { code: 'export const value = require("fixture-package");\n', label: "generated fixture" },
  ], "Fixture build");
  assert.equal(packageLoad.requiresNodeBundle, true);
  const packageImport = assertStaticJavaScriptDeploymentSources([
    { code: 'import { value } from "fixture-package";\nexport { value };\n', label: "generated fixture" },
  ], "Fixture build");
  assert.equal(packageImport.requiresNodeBundle, true);
  const packageAlias = assertStaticJavaScriptDeploymentSources([
    { code: 'export { value } from "#fixture";\n', label: "generated fixture" },
  ], "Fixture build");
  assert.equal(packageAlias.requiresNodeBundle, true);
  const standardRuntime = assertStaticJavaScriptDeploymentSources([
    { code: 'import { value } from "velar/fixture";\nexport { value };\n', label: "generated fixture" },
  ], "Fixture build", new Set(["velar/fixture"]));
  assert.equal(standardRuntime.requiresNodeBundle, false);
  assert.throws(() => assertStaticJavaScriptDeploymentSources([
    {
      code: 'import {createRequire} from "node:module"; createRequire(import.meta.url)("hidden");\n',
      label: "generated fixture",
    },
  ], "Fixture build"), /generated fixture uses createRequire/u);

  const hidden = `data:text/javascript,${encodeURIComponent('globalThis.require("hidden-package");')}`;
  const nested = `data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(hidden)};`)}`;
  assert.throws(() => assertStaticJavaScriptDeploymentSources([
    { code: `import ${JSON.stringify(nested)};\n`, label: "generated nested data fixture" },
  ], "Fixture build"), /inline JavaScript data module .* uses indirect CommonJS require/u);
});

test("static deployment rejects module loads that esbuild cannot close", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-opaque-");
  await mkdir(root, { recursive: true });
  const cases = [
    ['const name = "hidden"; require(name);', /computed CommonJS require/u],
    ['globalThis.require("hidden");', /indirect CommonJS require/u],
    ['require.resolve("hidden");', /indirect CommonJS require/u],
    ['import {createRequire} from "node:module"; createRequire(import.meta.url)("hidden");', /createRequire/u],
    [[
      'const moduleNamespace = await import("node:module");',
      "var factory;",
      "var factory = moduleNamespace.createRequire;",
      "factory(import.meta.url)(\"hidden\");",
    ].join("\n"), /createRequire/u],
    [[
      'const moduleNamespace = await import("node:module");',
      "const factory = enabled ? moduleNamespace.createRequire : null;",
      "factory(import.meta.url)(\"hidden\");",
    ].join("\n"), /createRequire/u],
    [[
      'const moduleNamespace = await import("node:module");',
      "const factory = fallback || moduleNamespace.createRequire;",
      "factory(import.meta.url)(\"hidden\");",
    ].join("\n"), /createRequire/u],
    ['function invoke(load = require) { load("hidden"); } invoke();', /indirect CommonJS require/u],
    ['const [load] = [require]; load("hidden");', /indirect CommonJS require/u],
    ['const {load = require} = {}; load("hidden");', /indirect CommonJS require/u],
    ['const pass = (load) => load("hidden"); pass(require);', /indirect CommonJS require/u],
    ['require?.("hidden");', /indirect CommonJS require/u],
    ['new require("hidden");', /indirect CommonJS require/u],
    [[
      'const namespace = await import("node:module");',
      "const { ...rest } = namespace;",
      'rest.createRequire(import.meta.url)("hidden");',
    ].join("\n"), /createRequire/u],
    ['const key = "require"; globalThis[key]("hidden");', /indirect CommonJS require/u],
    ['const key = "require"; module[key]("hidden");', /indirect CommonJS require/u],
    [[
      'import * as nodeModule from "node:module";',
      'const key = "createRequire";',
      'nodeModule[key](import.meta.url)("hidden");',
    ].join("\n"), /createRequire/u],
    ['process.getBuiltinModule("node:module").createRequire(import.meta.url)("hidden");', /process\.getBuiltinModule/u],
    ['const name = "hidden.js"; void import(`.\/${name}`);', /computed dynamic import/u],
  ] as const;
  for (let index = 0; index < cases.length; index += 1) {
    const [source, expected] = cases[index]!;
    const input = join(root, `case-${index}.js`);
    await writeFile(input, `${source}\n`, "utf8");
    await assert.rejects(
      assertStaticJavaScriptDeploymentInputs([input], "Fixture build"),
      expected,
      source,
    );
  }
});

test("static deployment accepts nested and passed ordinary functions", () => {
  const source = [
    "function outer(require) {",
    "  function inner(load = require) { return load(\"local\"); }",
    "  const container = [require, { require }];",
    "  const pass = (callback) => callback();",
    "  pass(require);",
    "  return [inner(), container];",
    "}",
    "const ordinaryRequire = () => 1;",
    "const callbacks = { load: ordinaryRequire };",
    "void callbacks;",
    "function localProcess(process, globalThis) {",
    '  process.getBuiltinModule("local");',
    '  globalThis.process.getBuiltinModule("local");',
    "}",
    "const ordinary = { getBuiltinModule() {} };",
    'ordinary.getBuiltinModule("local");',
    "void localProcess;",
    "",
  ].join("\n");

  assert.doesNotThrow(() => assertStaticJavaScriptDeploymentSources([
    { code: source, label: "generated ordinary callback fixture" },
  ], "Fixture build"));
});

test("static deployment accepts package self, dependency, optional, and peer edges", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-owned-");
  const packageRoot = join(root, "node_modules", "fixture-package");
  const input = join(packageRoot, "index.js");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "fixture-package",
    version: "1.0.0",
    dependencies: { "direct-package": "1.0.0" },
    optionalDependencies: { "optional-package": "1.0.0" },
    peerDependencies: { "peer-package": "1.0.0" },
  })}\n`, "utf8");
  await writeFile(input, [
    'import "fixture-package/internal";',
    'import "direct-package/subpath";',
    'export * from "optional-package";',
    'void import("peer-package/runtime");',
    'require("direct-package/commonjs");',
  ].join("\n"), "utf8");

  await assert.doesNotReject(assertStaticJavaScriptDeploymentInputs([input], "Fixture build"));
});

test("static deployment rejects a transitive package edge satisfied only by hoisting", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-hoist-");
  const transitiveRoot = join(root, "node_modules", "transitive-package");
  const input = join(transitiveRoot, "index.js");
  const hoistedRoot = join(root, "node_modules", "hoisted-package");
  const hoistedInput = join(hoistedRoot, "index.js");
  await mkdir(transitiveRoot, { recursive: true });
  await mkdir(hoistedRoot, { recursive: true });
  await writeFile(join(transitiveRoot, "package.json"), `${JSON.stringify({
    name: "transitive-package",
    version: "1.0.0",
  })}\n`, "utf8");
  await writeFile(join(hoistedRoot, "package.json"), `${JSON.stringify({
    name: "hoisted-package",
    version: "1.0.0",
  })}\n`, "utf8");
  await writeFile(input, 'import "hoisted-package/subpath";\n', "utf8");
  await writeFile(hoistedInput, "export const value = 1;\n", "utf8");

  await assert.rejects(
    assertStaticJavaScriptDeploymentInputs([input, hoistedInput], "Fixture build"),
    /imports undeclared npm package 'hoisted-package'.*physical owner 'transitive-package'.*relying on hoisting/u,
  );
});

test("static deployment applies owner proof through package imports aliases", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-imports-owner-");
  const packageRoot = join(root, "node_modules", "fixture-package");
  const input = join(packageRoot, "index.js");
  const hoistedRoot = join(root, "node_modules", "hidden-package");
  const hoistedInput = join(hoistedRoot, "index.js");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(hoistedRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "fixture-package",
    version: "1.0.0",
    imports: { "#hidden": "hidden-package" },
  })}\n`, "utf8");
  await writeFile(join(hoistedRoot, "package.json"), `${JSON.stringify({
    name: "hidden-package",
    version: "1.0.0",
  })}\n`, "utf8");
  await writeFile(input, 'import "#hidden";\n', "utf8");
  await writeFile(hoistedInput, "export const value = 1;\n", "utf8");

  await assert.rejects(
    assertStaticJavaScriptDeploymentInputs([input, hoistedInput], "Fixture build"),
    /imports undeclared npm package 'hidden-package'.*physical owner 'fixture-package'.*relying on hoisting/u,
  );
});

test("static deployment resolves package imports with the actual CommonJS edge conditions", async () => {
  const root = await makeTemporaryDirectory("velar-static-deployment-imports-require-");
  const packageRoot = join(root, "node_modules", "fixture-package");
  const input = join(packageRoot, "index.cjs");
  const hiddenRoot = join(root, "node_modules", "hidden-package");
  const declaredRoot = join(root, "node_modules", "declared-package");
  await mkdir(packageRoot, { recursive: true });
  await mkdir(hiddenRoot, { recursive: true });
  await mkdir(declaredRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: "fixture-package",
    version: "1.0.0",
    dependencies: { "declared-package": "1.0.0" },
    imports: {
      "#dependency": {
        import: "declared-package",
        require: "hidden-package",
      },
    },
  })}\n`, "utf8");
  for (const [root_, name] of [[hiddenRoot, "hidden-package"], [declaredRoot, "declared-package"]] as const) {
    await writeFile(join(root_, "package.json"), `${JSON.stringify({ name, version: "1.0.0" })}\n`, "utf8");
    await writeFile(join(root_, "index.js"), "module.exports = true;\n", "utf8");
  }
  await writeFile(input, 'module.exports = require("#dependency");\n', "utf8");

  await assert.rejects(
    assertStaticJavaScriptDeploymentInputs(
      [input, join(hiddenRoot, "index.js"), join(declaredRoot, "index.js")],
      "Fixture build",
    ),
    /imports undeclared npm package 'hidden-package'.*physical owner 'fixture-package'.*relying on hoisting/u,
  );
});
