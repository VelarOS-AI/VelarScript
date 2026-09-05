import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";
import { resolveBrowserNpm, resolveBrowserNpmEntry } from "../packages/cli/src/npm.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const npmModule = pathToFileURL(new URL("../packages/cli/src/npm.ts", import.meta.url).pathname).href;
const projectModule = pathToFileURL(new URL("../packages/cli/src/project.ts", import.meta.url).pathname).href;

async function bundledEntry(root: string, specifier: string): Promise<string> {
  const project = await compileProject(join(root, "main.vel"), new Map(), { projectRoot: root });
  const resolved = await resolveBrowserNpm(project);
  assert.deepEqual(resolved.failures, []);
  const route = resolved.imports[specifier];
  const package_ = resolved.packages.find((candidate) => route?.startsWith(candidate.route));
  assert.ok(route && package_);
  return readFile(join(package_.serveRoot, route.slice(package_.route.length)), "utf8");
}

function bundledEntryInFreshProcess(root: string, specifier: string): string {
  const script = `
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {resolveBrowserNpm} from ${JSON.stringify(npmModule)};
import {compileProject} from ${JSON.stringify(projectModule)};
const root = process.argv[1];
const specifier = process.argv[2];
const project = await compileProject(join(root, "main.vel"), new Map(), {projectRoot: root});
const resolved = await resolveBrowserNpm(project);
if (resolved.failures.length > 0) throw new Error(resolved.failures.join("\\n"));
const route = resolved.imports[specifier];
const package_ = resolved.packages.find((candidate) => route.startsWith(candidate.route));
process.stdout.write(await readFile(join(package_.serveRoot, route.slice(package_.route.length)), "utf8"));
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script, root, specifier], {
    encoding: "utf8",
    timeout: 300_000,
  });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout;
}

async function writeLinkedSharedImporter(
  root: string,
  application: string,
  owner: string,
  shared: { readonly version: string; readonly marker?: string },
): Promise<void> {
  const packageRoot = join(root, owner);
  const sharedRoot = join(packageRoot, "node_modules", "shared");
  await mkdir(join(packageRoot, "src"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: owner,
    version: "1.0.0",
    type: "module",
    dependencies: { shared: shared.version },
    velar: {
      entry: "src/index.vel",
      targets: ["node"],
      requires: { capabilities: [] },
    },
  }), "utf8");
  await writeFile(join(packageRoot, "src", "index.vel"), [
    'extern module "shared":',
    "    export const version: string",
    'import js {version} from "shared"',
    "export def dependencyVersion() -> string: return version",
    "",
  ].join("\n"), "utf8");
  if (shared.marker !== undefined) {
    await mkdir(sharedRoot, { recursive: true });
    await writeFile(join(sharedRoot, "package.json"), JSON.stringify({
      name: "shared",
      version: shared.version,
      type: "module",
      exports: { ".": "./index.js" },
    }), "utf8");
    await writeFile(join(sharedRoot, "index.js"), `export const version = ${JSON.stringify(shared.marker)};\n`, "utf8");
  }
  await symlink(packageRoot, join(application, "node_modules", owner), "dir");
}

test("development prebundles reject stale same-version content and export remaps after restart", async () => {
  const root = await makeTemporaryDirectory("velar-dev-prebundle-fingerprint-");
  const packageRoot = join(root, "node_modules", "cache-fixture");
  const specifier = "cache-fixture/worker";
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(root, "main.vel"), [
    `extern module "${specifier}":`,
    "    export const marker: string",
    `import js {marker} from "${specifier}"`,
    "print(marker)",
    "",
  ].join("\n"), "utf8");
  const manifest = (entry: string): string => JSON.stringify({
    name: "cache-fixture",
    version: "1.0.0",
    type: "module",
    exports: { "./worker": entry },
  });
  await writeFile(join(packageRoot, "package.json"), manifest("./worker.mjs"), "utf8");
  await writeFile(join(packageRoot, "worker.mjs"), 'export const marker = "old-marker";\n', "utf8");
  assert.match(await bundledEntry(root, specifier), /old-marker/u);

  await writeFile(join(packageRoot, "worker.mjs"), 'export const marker = "new-content-marker";\n', "utf8");
  const contentRestart = bundledEntryInFreshProcess(root, specifier);
  assert.match(contentRestart, /new-content-marker/u);
  assert.doesNotMatch(contentRestart, /old-marker/u);

  await writeFile(join(packageRoot, "replacement.mjs"), 'export const marker = "remapped-marker";\n', "utf8");
  await writeFile(join(packageRoot, "package.json"), manifest("./replacement.mjs"), "utf8");
  const remappedRestart = bundledEntryInFreshProcess(root, specifier);
  assert.match(remappedRestart, /remapped-marker/u);
  assert.doesNotMatch(remappedRestart, /new-content-marker/u);

  const meta = JSON.parse(await readFile(join(root, ".velar", "dev-deps", "cache-fixture@1.0.0", "meta.json"), "utf8")) as {
    readonly formatVersion: number;
    readonly fingerprint?: {
      readonly entryTargets?: Readonly<Record<string, string>>;
      readonly inputs?: Readonly<Record<string, unknown>>;
      readonly snapshots?: Readonly<Record<string, unknown>>;
    };
  };
  assert.equal(meta.formatVersion, 3);
  assert.equal(meta.fingerprint?.entryTargets?.["./worker"], "replacement.mjs");
  assert.deepEqual(Object.keys(meta.fingerprint?.inputs ?? {}), ["replacement.mjs"]);
  assert.deepEqual(meta.fingerprint?.snapshots, {});
});

test("browser npm resolution rejects non-normalized package identities before filesystem lookup", async () => {
  const root = await makeTemporaryDirectory("velar-browser-package-name-");
  await assert.rejects(resolveBrowserNpmEntry("Upper/worker", root), /invalid npm package name/u);
  await assert.rejects(resolveBrowserNpmEntry("package\\..\\worker", root), /invalid npm package name/u);
});

test("development uses the shared package-exports pattern precedence", async () => {
  const root = await makeTemporaryDirectory("velar-browser-export-pattern-");
  const packageRoot = join(root, "node_modules", "pattern-package");
  await mkdir(join(packageRoot, "general", "feature"), { recursive: true });
  await mkdir(join(packageRoot, "browser"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "pattern-package",
    version: "1.0.0",
    type: "module",
    exports: {
      "./feature/*": "./general/feature/*.mjs",
      "./feature/*-browser": "./browser/*.mjs",
    },
  }), "utf8");
  await writeFile(join(packageRoot, "general", "feature", "item-browser.mjs"), "export const selected = 'general';\n", "utf8");
  await writeFile(join(packageRoot, "browser", "item.mjs"), "export const selected = 'browser-specific';\n", "utf8");

  assert.equal(
    await resolveBrowserNpmEntry("pattern-package/feature/item-browser", root),
    await realpath(join(packageRoot, "browser", "item.mjs")),
  );
});

test("browser npm resolution rejects one specifier resolved to different linked package instances", async () => {
  const root = await makeTemporaryDirectory("velar-browser-anchor-ambiguity-");
  const application = join(root, "application");
  await mkdir(join(application, "node_modules"), { recursive: true });
  await writeLinkedSharedImporter(root, application, "linked-a", { version: "1.0.0", marker: "A" });
  await writeLinkedSharedImporter(root, application, "linked-b", { version: "2.0.0", marker: "B" });
  await writeFile(join(application, "main.vel"), [
    'import {dependencyVersion as aVersion} from "linked-a"',
    'import {dependencyVersion as bVersion} from "linked-b"',
    'print(f"{aVersion()}:{bVersion()}")',
    "",
  ].join("\n"), "utf8");

  const project = await compileProject(join(application, "main.vel"), new Map(), { projectRoot: application });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const resolved = await resolveBrowserNpm(project);
  const firstRoot = await realpath(join(root, "linked-a", "node_modules", "shared"));
  const secondRoot = await realpath(join(root, "linked-b", "node_modules", "shared"));
  assert.equal(resolved.imports.shared, undefined);
  assert.deepEqual(Object.keys(resolved.imports), ["linked-a", "linked-b"]);
  assert.deepEqual(resolved.failures, [
    `Cannot resolve browser npm import 'shared': importer anchors resolve it to multiple canonical package targets: ${JSON.stringify(firstRoot)} (version "1.0.0", entry "./index.js"); ${JSON.stringify(secondRoot)} (version "2.0.0", entry "./index.js"); a browser import map can expose only one target for a bare specifier`,
  ]);
});

test("browser npm resolution rejects a specifier missing from any actual importer anchor", async () => {
  const root = await makeTemporaryDirectory("velar-browser-anchor-missing-");
  const application = join(root, "application");
  await mkdir(join(application, "node_modules"), { recursive: true });
  await writeLinkedSharedImporter(root, application, "linked-a", { version: "1.0.0" });
  await writeLinkedSharedImporter(root, application, "linked-b", { version: "2.0.0", marker: "B" });
  await writeFile(join(application, "main.vel"), [
    'import {dependencyVersion as aVersion} from "linked-a"',
    'import {dependencyVersion as bVersion} from "linked-b"',
    'print(f"{aVersion()}:{bVersion()}")',
    "",
  ].join("\n"), "utf8");

  const project = await compileProject(join(application, "main.vel"), new Map(), { projectRoot: application });
  const resolved = await resolveBrowserNpm(project);
  const missingAnchor = join(application, "node_modules", "linked-a", "src");
  assert.equal(resolved.imports.shared, undefined);
  assert.deepEqual(Object.keys(resolved.imports), ["linked-a", "linked-b"]);
  assert.deepEqual(resolved.failures, [
    `Cannot resolve browser npm import 'shared': actual importer anchor cannot resolve it: ${JSON.stringify(missingAnchor)}: package 'shared' is not installed in node_modules; a browser import map cannot supply a dependency that an actual importer cannot resolve`,
  ]);
});
