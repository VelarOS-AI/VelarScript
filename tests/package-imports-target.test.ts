import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { resolveBrowserNpm } from "../packages/cli/src/npm.ts";
import { resolvePackageImportsSpecifier } from "../packages/cli/src/package-imports.ts";
import { checkResolvedProject } from "../packages/cli/src/project-check.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { buildProductionFramework } from "../packages/cli/src/production-build.ts";
import { VELAR_PROJECT_FORMAT_VERSION } from "../packages/create/src/types.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const webPackageRoot = fileURLToPath(new URL("../packages/web", import.meta.url));

async function createConditionalImportsProject(): Promise<string> {
  const root = await makeTemporaryDirectory("velar-package-imports-target-");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "@velarscript"), { recursive: true });
  await mkdir(join(root, "node_modules", "conditional-dep"), { recursive: true });
  await symlink(webPackageRoot, join(root, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "conditional-imports-app",
    version: "1.0.0",
    private: true,
    type: "module",
    imports: {
      "#platform": {
        browser: "./src/browser.mjs",
        default: "node:fs",
      },
      "#dep": "conditional-dep",
      "#import-fallback": { import: "./src/import.mjs", default: "node:fs" },
      "#nested": { browser: "./src/nested-browser.mjs", default: "node:fs" },
      "#node-target": { browser: "missing-browser-package", node: "./src/node.mjs", import: "./src/import.mjs" },
      "#node-addon": { "node-addons": "./src/node-addon.mjs", node: "./src/node.mjs" },
      "#browser-module": { module: "./src/browser-module.mjs", default: "./src/node.mjs" },
    },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "velar.json"), `${JSON.stringify({
    formatVersion: VELAR_PROJECT_FORMAT_VERSION,
    kind: "application",
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "Conditional imports" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "browser.mjs"), [
    'import {nested} from "#nested";',
    'export const platform = `browser-branch:${nested}`;',
    "",
  ].join("\n"), "utf8");
  await writeFile(join(root, "src", "nested-browser.mjs"), 'export const nested = "nested-browser-branch";\n', "utf8");
  await writeFile(join(root, "src", "node.mjs"), 'export const platform = "node-branch";\n', "utf8");
  await writeFile(join(root, "src", "node-addon.mjs"), 'export const platform = "node-addon-branch";\n', "utf8");
  await writeFile(join(root, "src", "browser-module.mjs"), 'export const platform = "browser-module-branch";\n', "utf8");
  await writeFile(join(root, "src", "import.mjs"), 'export const platform = "import-branch";\n', "utf8");
  await writeFile(join(root, "node_modules", "conditional-dep", "package.json"), `${JSON.stringify({
    name: "conditional-dep",
    version: "1.0.0",
    type: "module",
    exports: { ".": { browser: "./browser.mjs", default: "./node.mjs" } },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "node_modules", "conditional-dep", "browser.mjs"), 'export const dependency = "browser-dependency";\n', "utf8");
  await writeFile(join(root, "node_modules", "conditional-dep", "node.mjs"), 'export const dependency = "node-dependency";\n', "utf8");
  await writeFile(join(root, "src", "main.vel"), [
    'extern module "#platform":',
    "    export const platform: string",
    'extern module "#dep":',
    "    export const dependency: string",
    'import js {platform} from "#platform"',
    'import js {dependency} from "#dep"',
    "component App:",
    '    return <main>{f"{platform}:{dependency}"}</main>',
    '@main: mount(<App />, "#app")',
    "",
  ].join("\n"), "utf8");
  return root;
}

async function developmentEntry(
  root: string,
  resolution: Awaited<ReturnType<typeof resolveBrowserNpm>>,
  specifier: string,
): Promise<string> {
  const route = resolution.imports[specifier];
  const package_ = resolution.packages.find((candidate) => route?.startsWith(candidate.route));
  assert.ok(route && package_, `No development route for ${specifier}`);
  return readFile(join(package_.serveRoot, route.slice(package_.route.length)), "utf8");
}

test("Web check, development, and production share browser package-import conditions", async () => {
  const root = await createConditionalImportsProject();
  const browserTarget = await resolvePackageImportsSpecifier("#platform", join(root, "src"), "browser");
  assert.deepEqual(browserTarget.target, { kind: "file", path: await realpath(join(root, "src", "browser.mjs")) });

  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, null);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.project.failures, []);
  assert.deepEqual(checked.project.modules.flatMap((module) => module.result.diagnostics), []);

  const development = await resolveBrowserNpm(checked.project);
  assert.deepEqual(development.failures, []);
  const platformCode = await developmentEntry(root, development, "#platform");
  assert.match(platformCode, /browser-branch/u);
  assert.match(platformCode, /nested-browser-branch/u);
  assert.doesNotMatch(platformCode, /node:fs|node-branch/u);
  const dependencyCode = await developmentEntry(root, development, "#dep");
  assert.match(dependencyCode, /browser-dependency/u);
  assert.doesNotMatch(dependencyCode, /node-dependency/u);
  assert.ok(development.packages.some((package_) => package_.name === "conditional-dep"),
    "an external #dep mapping keeps the dependency package identity");

  const output = join(root, "production");
  const production = await buildProductionFramework(checked.project, output, "readable");
  const emitted = (await Promise.all((await readdir(join(output, "assets")))
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFile(join(output, "assets", path), "utf8")))).join("\n");
  assert.match(emitted, /browser-branch/u);
  assert.match(emitted, /nested-browser-branch/u);
  assert.match(emitted, /browser-dependency/u);
  assert.doesNotMatch(emitted, /node:fs|node-branch|node-dependency/u);
  assert.ok(production.entryPath.endsWith(".js"));
});

test("Node package-import conditions select node before import and default", async () => {
  const root = await createConditionalImportsProject();
  const nodeTarget = await resolvePackageImportsSpecifier("#node-target", join(root, "src"), "node");
  assert.deepEqual(nodeTarget.target, { kind: "file", path: await realpath(join(root, "src", "node.mjs")) });
  const importTarget = await resolvePackageImportsSpecifier("#import-fallback", join(root, "src"), "node");
  assert.deepEqual(importTarget.target, { kind: "file", path: await realpath(join(root, "src", "import.mjs")) });
  const addonTarget = await resolvePackageImportsSpecifier("#node-addon", join(root, "src"), "node");
  assert.deepEqual(addonTarget.target, { kind: "file", path: await realpath(join(root, "src", "node-addon.mjs")) });
  await mkdir(join(root, "node"), { recursive: true });
  await writeFile(join(root, "node", "node-main.vel"), [
    'extern module "#node-target":',
    "    export const platform: string",
    'import js {platform} from "#node-target"',
    "print(platform)",
    "",
  ].join("\n"), "utf8");
  const checked = await compileProject(join(root, "node", "node-main.vel"), new Map(), {
    projectRoot: root,
    packageTarget: "node",
  });
  assert.deepEqual(checked.failures, []);
  assert.deepEqual(checked.modules.flatMap((module) => module.result.diagnostics), []);
});

test("Browser package-import conditions include the bundler module condition", async () => {
  const root = await createConditionalImportsProject();
  const target = await resolvePackageImportsSpecifier("#browser-module", join(root, "src"), "browser");
  assert.deepEqual(target.target, { kind: "file", path: await realpath(join(root, "src", "browser-module.mjs")) });
  await writeFile(join(root, "src", "main.vel"), [
    'extern module "#browser-module":',
    "    export const platform: string",
    'import js {platform} from "#browser-module"',
    "component App:",
    "    return <main>{platform}</main>",
    '@main: mount(<App />, "#app")',
    "",
  ].join("\n"), "utf8");
  const config = await resolveVelarProject(root);
  const checked = await checkResolvedProject(config, null);
  assert.deepEqual(checked.errors, []);
  const output = join(root, "module-condition-production");
  await buildProductionFramework(checked.project, output, "readable");
  const emitted = (await Promise.all((await readdir(join(output, "assets")))
    .filter((path) => path.endsWith(".js"))
    .map((path) => readFile(join(output, "assets", path), "utf8")))).join("\n");
  assert.match(emitted, /browser-module-branch/u);
  assert.doesNotMatch(emitted, /node-branch/u);
});
