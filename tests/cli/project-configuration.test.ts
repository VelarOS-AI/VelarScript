import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";
import { velarFrameworkHost } from "../../packages/web/src/host.ts";
import type { VelarWebConfig } from "../../packages/web/src/project-config.ts";
import { verifyProductionBuild } from "../../packages/cli/src/production-verifier.ts";
import { startProductionPreview } from "../../packages/cli/src/preview-server.ts";
import { verifyRemoteDeployment, type DeploymentFetch } from "../../packages/cli/src/deployment-verifier.ts";
import { parseDependencyArguments, runDependencyCommand } from "../../packages/cli/src/package-manager.ts";
import { validateApplicationPackageResult } from "../../packages/cli/src/application-package-host.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { compileProject, linkWorkspaceWebExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("velar.json defines a self-contained Web project and standard modules", async () => {
  const directory = await makeTemporaryDirectory("velar-config-project-");
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "assets"), { recursive: true });
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "build",
    publicDir: "assets",
    build: { sourceMaps: true },
    extensions: ["@velarscript/web"],
    web: {
      title: "Configured Velar",
      base: "/demo",
      publicConfig: { apiBase: "https://api.example.com", features: { releases: true } },
    },
  }), "utf8");
  await writeFile(join(directory, "assets", "message.txt"), "VelarScript asset\n", "utf8");
  await writeFile(join(directory, "src", "main.vel"), `
import {route, Router, Link} from "velar/web"
import {http} from "velar/http"
import {storage} from "velar/storage"
import {publicConfig} from "velar/config"

type Settings:
    theme: string

type Features:
    releases: bool

type AppConfig:
    apiBase: string
    features: Features

const appConfig = publicConfig(AppConfig)

async def load() -> Settings:
    return await http.get("/api/settings").parse(Settings)

component Home:
    const saved = storage.get("settings", Settings, {theme: "system"})
    return <main><Link to="/settings">{saved.theme}:{appConfig.apiBase}</Link></main>

const routes = [route("/", Home)]

component App:
    return <Router routes={routes} />

@main: mount(<App />, "#app")
`.trimStart(), "utf8");

  const config = await resolveVelarProject(null, directory);
  const web = config.extensionConfig.get("@velarscript/web") as VelarWebConfig;
  assert.equal(config.entryPath, join(directory, "src", "main.vel"));
  assert.match(config.manifestIdentity ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(web.base, "/demo/");
  assert.deepEqual(web.publicConfig, { apiBase: "https://api.example.com", features: { releases: true } });
  assert.equal(config.build.sourceMaps, true);
  assert.equal(web.security.contentSecurityPolicy, true);
  assert.equal(web.deployment.spaFallback, true);
  assert.equal(config.framework?.host.id, "@velarscript/web");
  assert.equal(config.framework?.host.protocolVersion, 3);
  const project = await compileProject(config.entryPath, new Map(), {
    projectRoot: config.root,
    publicRoot: config.publicDir,
    extensionConfig: config.extensionConfig,
    framework: config.framework,
  });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules[0]?.result.code ?? "", /from "velar\/web"/);
  assert.match(project.modules[0]?.result.code ?? "", /function __velarGetRuntimeType_Settings\(\) \{ return __velarGetRuntimeType_Settings_cache \?\?= __velarRegisterRuntimeType\(__velarValidationFreeze/u);
  assert.match(project.modules[0]?.result.code ?? "", /const Settings = __velarGetRuntimeType_Settings\(\);/u);

  await mkdir(join(directory, "build"));
  await writeFile(join(directory, "build", "stale.txt"), "stale\n", "utf8");
  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, String(execution.stderr));
  const html = await readFile(join(directory, "build", "index.html"), "utf8");
  assert.match(html, /<title>Configured Velar<\/title>/);
  assert.match(html, /src="\/demo\/assets\/main-[A-Z0-9]+\.js"/);
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /script-src 'self'/u);
  assert.doesNotMatch(html, /importmap/);
  assert.equal(await readFile(join(directory, "build", "message.txt"), "utf8"), "VelarScript asset\n");
  await assert.rejects(readFile(join(directory, "build", "stale.txt")), /ENOENT/u);
  assert.equal(await readFile(join(directory, "build", "404.html"), "utf8"), html);
  const deployment = JSON.parse(await readFile(join(directory, "build", "velar-deploy.json"), "utf8"));
  assert.equal(deployment.kind, "velar-static-deployment");
  assert.equal(deployment.base, "/demo/");
  assert.match(deployment.headers[0].values["Content-Security-Policy"], /frame-ancestors 'none'/u);
  const assets = await readdir(join(directory, "build", "assets"));
  const javascript = assets.find((name) => /^main-[A-Z0-9]+\.js$/u.test(name));
  assert.ok(javascript);
  assert.match(await readFile(join(directory, "build", "assets", javascript), "utf8"), /HttpResponseError/);
  assert.match(await readFile(join(directory, "build", "assets", javascript), "utf8"), /https:\/\/api\.example\.com/u);
  assert.ok(assets.includes(`${javascript}.map`));
  const productionManifest = JSON.parse(await readFile(join(directory, "build", "velar-build.json"), "utf8")) as { sourceMaps: boolean };
  assert.equal(productionManifest.sourceMaps, true);

  const verifiedBuild = await verifyProductionBuild(join(directory, "build"));
  const subpathPreview = await startProductionPreview(verifiedBuild, 0);
  try {
    const remote = await verifyRemoteDeployment(verifiedBuild, subpathPreview.origin);
    assert.equal(remote.url, `${subpathPreview.origin}/demo/`);
    assert.equal(remote.buildId, verifiedBuild.manifest.buildId);
  } finally {
    await subpathPreview.close();
  }

  await writeFile(join(directory, "assets", "index.html"), "unsafe public override\n", "utf8");
  const refused = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /public asset 'index\.html' is reserved/u);
  assert.equal(await readFile(join(directory, "build", "index.html"), "utf8"), html);
});

/**
 * D114 F9-node-cli residual 1: `velar.json`'s optional `name`.
 *
 * NO-D1 bakes the project's identity into every Node output, so that a `dist/`
 * standing beside a stranger's directory cannot publish the stranger's files as
 * its own. Without a name that identity is the project-relative entry — and
 * every scaffolded project declares the same one, so two of them were the same
 * project as far as an output could tell. The name is what tells them apart,
 * which is why it is held to a shape a reader and a build agree on rather than
 * accepted as any string at all.
 *
 * Each way of getting it wrong is refused by the one sentence that states the
 * whole rule, because an author who wrote one of them wants to be told what a
 * name is, not which clause caught them.
 */
test("velar.json optionally names the project, and refuses a name a reader could not trust", async () => {
  const directory = await makeTemporaryDirectory("velar-config-name-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), '@main: print("ok")\n', "utf8");
  const declare = async (name: unknown, declared = true): Promise<void> => {
    await writeFile(join(directory, "velar.json"), `${JSON.stringify({
      formatVersion: 2,
      ...(declared ? { name } : {}),
      kind: "application",
      entry: "src/main.vel",
    })}\n`, "utf8");
  };

  await declare(undefined, false);
  assert.equal((await resolveVelarProject(directory)).entryPath, join(directory, "src", "main.vel"), "the key is optional");
  // A name is read, not parsed: capitalisation, spaces, punctuation and script
  // are the author's, and only the bound is this toolchain's.
  for (const accepted of ["storefront", "My Store Front", "店面 · v2", "y".repeat(100), "\u{1F680}".repeat(50)]) {
    await declare(accepted);
    assert.equal((await resolveVelarProject(directory)).formatVersion, 2, `${JSON.stringify(accepted)} is a name`);
  }

  // Empty is not a name. Whitespace at either end is invisible in every
  // renderer a manifest is read through, so two identities that look identical
  // would differ. A control character is text no terminal shows.
  // NO-I9: the bound is 100 UTF-16 code units, at both ends — the identity
  // derivation used to accept 214, so a legal manifest could never reach it.
  const refusal = /'name' must be a non-empty string of at most 100 characters \(UTF-16 code units\), with no control characters and no leading or trailing whitespace/u;
  for (const refused of ["", "x".repeat(101), `${"\u{1F680}".repeat(50)}a`, "store\u0007front", "  storefront", "storefront ", 7, null]) {
    await declare(refused);
    await assert.rejects(resolveVelarProject(directory), refusal, `${JSON.stringify(refused)} is not a name`);
  }
});

test("project configuration rejects destructive output layouts and unsafe CSP origins", async () => {
  const directory = await makeTemporaryDirectory("velar-secure-config-");
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  await linkWorkspaceWebExtension(directory);
  const manifestPath = join(directory, "velar.json");
  const manifest = (value: Record<string, unknown>): string => JSON.stringify({ formatVersion: 2, extensions: ["@velarscript/web"], ...value });
  await writeFile(manifestPath, manifest({ entry: "main.vel", outDir: "." }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*project root/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", outDir: "dist", publicDir: "dist/public" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /outDir.*publicDir.*overlap/u);

  await writeFile(manifestPath, manifest({
    entry: "main.vel",
    web: { security: { connectSources: ["https://api.example.com/path"] } },
  }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported origin/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { security: { connectSources: ["ws://example.com"] } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported origin/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { security: { connectSources: ["ws://127.0.0.1:8080"] } } }), "utf8");
  assert.deepEqual(((await resolveVelarProject(directory)).extensionConfig.get("@velarscript/web") as VelarWebConfig).security.connectSources, ["ws://127.0.0.1:8080"]);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { publicConfig: ["not", "an", "object"] } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /web\.publicConfig.*JSON object/u);

  await writeFile(manifestPath, '{"formatVersion":2,"extensions":["@velarscript/web"],"entry":"main.vel","web":{"publicConfig":{"__proto__":"unsafe"}}}\n', "utf8");
  await assert.rejects(resolveVelarProject(directory), /reserved key '__proto__'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { publicConfig: { value: "x".repeat(65_537) } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /cannot exceed 64 KiB/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { deployment: { adapter: "netlify" } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web\.deployment' field 'adapter'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", build: { sourceMaps: "yes" } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /build\.sourceMaps.*boolean/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", outdir: "misspelled" }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'project' field 'outdir'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { titel: "misspelled" } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web' field 'titel'/u);

  await writeFile(manifestPath, manifest({ entry: "main.vel", web: { security: { connectSource: [] } } }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unknown 'web\.security' field 'connectSource'/u);

  for (const base of ["/double//segment/", "/../escape/", "/encoded%2Fslash/", "/query/?value=1", "/bad%ZZ/"]) {
    await writeFile(manifestPath, manifest({ entry: "main.vel", web: { base } }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /web\.base/u);
  }
});

test("project framework hosts are versioned, capability-bound, and singular", async () => {
  const directory = await makeTemporaryDirectory("velar-framework-host-config-");
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const writeExtension = async (name: string, protocolVersion: number, compilerCapability: string, hostCapability = compilerCapability): Promise<void> => {
    const root = join(directory, "node_modules", name);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: { "./compiler": "./compiler.js", "./host": "./host.js" },
      velar: { extension: { kind: "application", apiVersion: "1.0", manifestKey: name, extends: {} } },
    }), "utf8");
    await writeFile(join(root, "compiler.js"), `
export const velarCompilerExtension = {id: ${JSON.stringify(name)}, contract: {protocolVersion: 1, apiVersion: "1.0", kind: "application", extends: {}}, capabilities: [${JSON.stringify(compilerCapability)}]}
export const velarProjectExtension = {id: ${JSON.stringify(name)}, manifestKey: ${JSON.stringify(name)}, parse(value) { return value ?? {} }}
`.trimStart(), "utf8");
    await writeFile(join(root, "host.js"), `
export const velarFrameworkHost = {
  protocolVersion: ${protocolVersion},
  id: ${JSON.stringify(name)},
  capability: ${JSON.stringify(hostCapability)},
  displayName: "Fixture",
  target: "browser",
  apiVersion: "1.0",
  artifactKind: "fixture-build",
  base() { return "/" },
  createArtifacts() { return {entryModule: "/main.js", css: "", html: "<!doctype html>"} },
  createErrorDocument() { return "<!doctype html>" },
  staticDeployment() { return {base: "/", spaFallback: false, contentSecurityPolicy: null} },
}
`.trimStart(), "utf8");
  };

  await writeExtension("fixture-version", 99, "fixture");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-version"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /unsupported framework host protocol 99/u);

  await writeExtension("fixture-capability", 3, "fixture", "other");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-capability"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /must bind one capability owned by its compiler extension/u);

  await writeExtension("fixture-one", 3, "one");
  await writeExtension("fixture-two", 3, "two");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["fixture-one", "fixture-two"] }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /only one application extension/u);
});

test("extension packages resolve a deterministic semantic dependency graph", async () => {
  const directory = await makeTemporaryDirectory("velar-extension-graph-");
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const writeExtension = async (
    name: string,
    kind: "application" | "capability",
    apiVersion: string,
    parents: Readonly<Record<string, string>>,
    moduleName: string | null = null,
    manifestKeyOverride: string | null = null,
    packageVersion = "1.0.0",
  ): Promise<void> => {
    const root = join(directory, "node_modules", ...name.split("/"));
    const manifestKey = manifestKeyOverride ?? name.replace(/^@/u, "").replaceAll("/", "-");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({
      name,
      version: packageVersion,
      type: "module",
      exports: { "./compiler": "./compiler.js" },
      peerDependencies: Object.fromEntries(Object.keys(parents).map((parent) => [parent, "^1.0.0"])),
      velar: { extension: { kind, apiVersion, manifestKey, extends: parents } },
    }), "utf8");
    const moduleContract = moduleName
      ? `, modules: {apiVersion: ${JSON.stringify(apiVersion)}, interfaces: new Map([[${JSON.stringify(moduleName)}, {exports:new Map(), mutableExports:new Set(), reactiveExports:new Map(), reExports:new Map(), namedTypes:new Map(), namedTypeIdentities:new Map(), typeAliases:new Map(), enums:new Map(), classes:new Map(), tests:[], extensionExports:new Map(), extensionData:new Map()}]]), sources: new Map([[${JSON.stringify(moduleName)}, "export const ready = true\\n"]])}`
      : "";
    await writeFile(join(root, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: ${JSON.stringify(name)}, contract: Object.freeze({protocolVersion: 1, apiVersion: ${JSON.stringify(apiVersion)}, kind: ${JSON.stringify(kind)}, extends: Object.freeze(${JSON.stringify(parents)})})${moduleContract}})
export const velarProjectExtension = Object.freeze({id: ${JSON.stringify(name)}, manifestKey: ${JSON.stringify(manifestKey)}, parse(value) { return value ?? Object.freeze({}) }})
`.trimStart(), "utf8");
  };

  await writeExtension("fixture-parent", "application", "1.0", {});
  await writeExtension("fixture-child", "capability", "2.0", { "fixture-parent": "1.0" });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: ["fixture-child"],
    "fixture-parent": {},
    "fixture-child": {},
  }), "utf8");
  const project = await resolveVelarProject(directory);
  assert.deepEqual(project.extensions, ["fixture-child"]);
  assert.deepEqual(project.extensionGraph.map((item) => [item.name, item.direct]), [
    ["fixture-parent", false],
    ["fixture-child", true],
  ]);
  assert.deepEqual(project.compilerExtensions.map((item) => item.id), ["fixture-parent", "fixture-child"]);

  await writeExtension("fixture-child", "capability", "2.0", { "fixture-parent": "9.9" });
  await assert.rejects(resolveVelarProject(directory), /requires fixture-parent API 9\.9, but 1\.0 is installed/u);

  await writeExtension("fixture-parent", "capability", "1.0", { "fixture-child": "2.0" });
  await assert.rejects(resolveVelarProject(directory), /dependency cycle: fixture-child -> fixture-parent -> fixture-child/u);

  // A compiler source cannot seize another package's ordinary npm namespace;
  // ownership is checked before either extension can shadow the other package.
  await writeExtension("fixture-collision-parent", "application", "1.0", {}, "fixture-collision/shared");
  await writeExtension("fixture-collision-child", "capability", "2.0", { "fixture-collision-parent": "1.0" }, "fixture-collision/shared");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: ["fixture-collision-child"],
    "fixture-collision-parent": {},
    "fixture-collision-child": {},
  }), "utf8");
  await assert.rejects(resolveVelarProject(directory), /must declare module 'fixture-collision\/shared' under its own npm package name/u);

  await writeExtension("fixture-reserved-namespace", "capability", "1.0", {}, "velar/collision");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: ["fixture-reserved-namespace"],
    "fixture-reserved-namespace": {},
  }), "utf8");
  await assert.rejects(
    resolveVelarProject(directory),
    /cannot declare Velar module 'velar\/collision'; the 'velar' package belongs to the language/u,
  );

  for (const [index, version] of ["1.0.0+build.7", "1.0.0-alpha.1+build.7", "0.0.0-0"].entries()) {
    const name = `fixture-valid-version-${index}`;
    await writeExtension(name, "capability", "1.0", {}, null, null, version);
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: [name],
      [name]: {},
    }), "utf8");
    assert.deepEqual((await resolveVelarProject(directory)).extensions, [name]);
  }

  for (const [index, version] of ["01.0.0", "1.01.0", "1.0.01", "1.0.0-01", "1.0.0-alpha..1", "1.0.0+build..1"].entries()) {
    const name = `fixture-invalid-version-${index}`;
    await writeExtension(name, "capability", "1.0", {}, null, null, version);
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: [name],
      [name]: {},
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /valid SemVer 2\.0 version/u);
  }

  for (const [index, apiVersion] of ["01.0", "1.00"].entries()) {
    const name = `fixture-invalid-api-${index}`;
    await writeExtension(name, "capability", apiVersion, {});
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: [name],
      [name]: {},
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /apiVersion.*major\.minor/u);
  }

  for (const reserved of ["entry", "extensions", "constructor"]) {
    const name = `fixture-reserved-${reserved}`;
    await writeExtension(name, "capability", "1.0", {}, null, reserved);
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "main.vel",
      extensions: [name],
    }), "utf8");
    await assert.rejects(
      resolveVelarProject(directory),
      new RegExp(`manifestKey.*reserved project field '${reserved}'`, "u"),
    );
  }
});

test("official toolchain targets resolve for zero-npm projects without weakening third-party extension lookup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-toolchain-target-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({
      name: "zero-npm-desktop",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: {},
      devDependencies: {},
    }), "utf8");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      extensions: ["@velarscript/desktop"],
      desktop: {
        productName: "Zero npm Desktop",
        identifier: "dev.velarscript.zero-npm",
        permissions: {},
      },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), "component App:\n    return <main>ready</main>\n\n@main: mount(<App />, \"#app\")\n", "utf8");

    const project = await resolveVelarProject(directory);
    assert.deepEqual(project.extensionGraph.map((item) => [item.name, item.resolution]), [
      ["@velarscript/desktop", "toolchain"],
    ]);
    await assert.rejects(readFile(join(directory, "node_modules", "@velarscript", "desktop", "package.json"), "utf8"), /ENOENT/u);
    const checked = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", directory], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /Checked 1 module/u);

    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      extensions: ["@example/missing"],
    }), "utf8");
    await assert.rejects(resolveVelarProject(directory), /cannot resolve installed package '@example\/missing'/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("application package results stay bounded inside the project owner", () => {
  const root = resolve("package-result-owner");
  assert.deepEqual(validateApplicationPackageResult({
    artifactPath: join(root, "dist", "Example.app"),
    details: ["ready"],
  }, root), {
    artifactPath: join(root, "dist", "Example.app"),
    details: ["ready"],
  });
  assert.throws(() => validateApplicationPackageResult({ artifactPath: root, details: [] }, root), /outside the project root/u);
  assert.throws(() => validateApplicationPackageResult({ artifactPath: resolve(root, "..", "escape.app"), details: [] }, root), /outside the project root/u);
  assert.throws(() => validateApplicationPackageResult({ artifactPath: join(root, "dist", "Example.app"), details: ["bad\nline"] }, root), /invalid result/u);
});

test("extension resolution never skips an invalid nearer package manifest", async () => {
  const sandbox = await makeTemporaryDirectory("velar-extension-shadow-");
  const project = join(sandbox, "project");
  const localManifest = join(project, "node_modules", "shadow-extension", "package.json");
  const ancestorPackage = join(sandbox, "node_modules", "shadow-extension");
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(localManifest, { recursive: true });
  await mkdir(ancestorPackage, { recursive: true });
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "shadow-project", private: true, type: "module" }), "utf8");
  await writeFile(join(project, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: ["shadow-extension"],
    shadow: {},
  }), "utf8");
  await writeFile(join(project, "src", "main.vel"), "const answer = 42\n", "utf8");
  await writeFile(join(ancestorPackage, "package.json"), JSON.stringify({
    name: "shadow-extension",
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "capability", apiVersion: "1.0", manifestKey: "shadow" } },
  }), "utf8");
  await writeFile(join(ancestorPackage, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: "shadow-extension", contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "capability", extends: Object.freeze({})})})
export const velarProjectExtension = Object.freeze({id: "shadow-extension", manifestKey: "shadow", parse(value) { return value ?? Object.freeze({}) }})
`.trimStart(), "utf8");

  await assert.rejects(
    resolveVelarProject(project),
    /project[\\/]node_modules[\\/]shadow-extension[\\/]package\.json: installed package manifest must be an ordinary file/u,
  );
});

test("project discovery never skips an invalid nearer manifest or accepts manifest symlinks", async () => {
  const sandbox = await makeTemporaryDirectory("velar-project-shadow-");
  const child = join(sandbox, "child");
  const localManifest = join(child, "velar.json");
  await mkdir(join(child, "src"), { recursive: true });
  await writeFile(join(sandbox, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(join(sandbox, "main.vel"), "const ancestor = true\n", "utf8");
  await writeFile(join(child, "package.json"), JSON.stringify({ name: "child-project", private: true, type: "module" }), "utf8");
  await writeFile(join(child, "src", "main.vel"), "const childValue = true\n", "utf8");
  await mkdir(localManifest);

  await assert.rejects(resolveVelarProject(null, child), /project manifest must be an ordinary file/u);
  const update = parseDependencyArguments("update", []);
  assert.notEqual(typeof update, "string");
  if (typeof update === "string") return;
  let npmCalled = false;
  await assert.rejects(
    runDependencyCommand("update", update, { cwd: child, executeNpm: async () => { npmCalled = true; } }),
    /velar\.json must be an ordinary file/u,
  );
  assert.equal(npmCalled, false);

  await rm(localManifest, { recursive: true });
  await symlink(join(sandbox, "velar.json"), localManifest);
  await assert.rejects(resolveVelarProject(null, child), /project manifest must be an ordinary file/u);
  await assert.rejects(
    runDependencyCommand("update", update, { cwd: child, executeNpm: async () => { npmCalled = true; } }),
    /velar\.json must be an ordinary file/u,
  );
  assert.equal(npmCalled, false);
});

test("compiler extension loading reports hostile thrown values deterministically", async () => {
  const directory = await makeTemporaryDirectory("velar-hostile-extension-");
  await writeFile(join(directory, "main.vel"), "const value = 1\n", "utf8");
  const root = join(directory, "node_modules", "hostile-extension");
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "hostile-extension",
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", extends: {} } },
  }), "utf8");
  await writeFile(join(root, "compiler.js"), `
throw {
  toString() { throw new Error("hostile conversion hook ran") },
  [Symbol.toPrimitive]() { throw new Error("hostile primitive hook ran") },
}
`.trimStart(), "utf8");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    extensions: ["hostile-extension"],
  }), "utf8");

  await assert.rejects(
    resolveVelarProject(directory),
    /cannot load compiler extension 'hostile-extension': A non-Error value was thrown by JavaScript/u,
  );
});

test("static Web builds remain reproducible and provider-neutral", async () => {
  const directory = await makeTemporaryDirectory("velar-static-deployment-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "src", "main.vel"), `component App:\n    return <main><h1>Static Velar</h1></main>\n\n@main: mount(<App />, "#app")\n`, "utf8");
  await linkWorkspaceWebExtension(directory);
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    build: { sourceMaps: true },
    extensions: ["@velarscript/web"],
    web: { base: "/", deployment: { spaFallback: true } },
  }), "utf8");
  await assert.rejects(verifyProductionBuild(directory), /run 'velar build' first/u);

  const execution = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build"], { cwd: directory, encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  await assert.rejects(readFile(join(directory, "dist", "_headers")), /ENOENT/u);
  await assert.rejects(readFile(join(directory, "dist", "_redirects")), /ENOENT/u);
  const deployment = JSON.parse(await readFile(join(directory, "dist", "velar-deploy.json"), "utf8")) as Record<string, unknown>;
  assert.equal(deployment.adapter, undefined);
  const build = JSON.parse(await readFile(join(directory, "dist", "velar-build.json"), "utf8")) as {
    buildId: string;
    deployment: Record<string, unknown>;
    assets: Array<{ path: string; role: string }>;
  };
  assert.equal(build.deployment.adapter, undefined);
  assert.equal(build.assets.some((asset) => asset.path === "_headers" || asset.path === "_redirects"), false);

  const repeat = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", "--out-dir", "dist-repeat"], { cwd: directory, encoding: "utf8" });
  assert.equal(repeat.status, 0, repeat.stderr);
  const repeatedBuild = JSON.parse(await readFile(join(directory, "dist-repeat", "velar-build.json"), "utf8"));
  assert.deepEqual(repeatedBuild, build);
  for (const asset of build.assets) {
    assert.deepEqual(
      await readFile(join(directory, "dist-repeat", asset.path)),
      await readFile(join(directory, "dist", asset.path)),
      `non-reproducible asset ${asset.path}`,
    );
  }

  const verified = await verifyProductionBuild(join(directory, "dist"));
  assert.equal(verified.manifest.buildId, build.buildId);
  const cliVerification = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "verify", "dist"], { cwd: directory, encoding: "utf8" });
  assert.equal(cliVerification.status, 0, cliVerification.stderr);
  assert.match(cliVerification.stdout, new RegExp(build.buildId, "u"));

  const preview = await startProductionPreview(verified, 0);
  try {
    const root = await fetch(preview.url, { headers: { Accept: "text/html" } });
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-security-policy") ?? "", /script-src 'self'/u);
    assert.equal(root.headers.get("cache-control"), "no-cache");
    assert.match(await root.text(), /<div id="app"><\/div>/u);
    const deep = await fetch(new URL("deep/route", preview.url), { headers: { Accept: "text/html" } });
    assert.equal(deep.status, 200);
    assert.match(await deep.text(), /<div id="app"><\/div>/u);
    const malformedNavigation = await fetch(`${preview.url}%E0%A4%A`, { headers: { Accept: "text/html" } });
    assert.equal(malformedNavigation.status, 200);
    assert.match(await malformedNavigation.text(), /<div id="app"><\/div>/u);
    const malformedAsset = await fetch(`${preview.url}%E0%A4%A`, { headers: { Accept: "application/javascript" } });
    assert.equal(malformedAsset.status, 400);
    const missingAsset = await fetch(new URL("assets/missing.js", preview.url), { headers: { Accept: "*/*" } });
    assert.equal(missingAsset.status, 404);
    const method = await fetch(preview.url, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "GET, HEAD");
    const head = await fetch(preview.url, { method: "HEAD", headers: { Accept: "text/html" } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const remote = await verifyRemoteDeployment(verified, preview.origin);
    assert.equal(remote.url, preview.url);
    assert.equal(remote.buildId, build.buildId);
    assert.equal(remote.checkedRoutes, 3);
    assert.ok(remote.checkedFiles >= build.assets.length - 1);
    assert.ok(remote.checkedHeaders > remote.checkedFiles);

    const cli = spawn(process.execPath, [
      resolve("packages/cli/src/cli.ts"),
      "verify-deployment",
      "dist",
      "--url",
      preview.origin,
    ], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    let cliStdout = "";
    let cliStderr = "";
    cli.stdout.on("data", (chunk: Buffer) => { cliStdout += chunk.toString("utf8"); });
    cli.stderr.on("data", (chunk: Buffer) => { cliStderr += chunk.toString("utf8"); });
    const cliStatus = await new Promise<number | null>((resolvePromise) => cli.once("exit", resolvePromise));
    assert.equal(cliStatus, 0, cliStderr);
    assert.match(cliStdout, new RegExp(`Verified deployed web build ${build.buildId}`, "u"));

    const jsonCli = spawn(process.execPath, [
      resolve("packages/cli/src/cli.ts"),
      "verify-deployment",
      "dist",
      "--json",
    ], {
      cwd: directory,
      env: { ...process.env, VELAR_DEPLOYMENT_URL: preview.origin },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let jsonStdout = "";
    let jsonStderr = "";
    jsonCli.stdout.on("data", (chunk: Buffer) => { jsonStdout += chunk.toString("utf8"); });
    jsonCli.stderr.on("data", (chunk: Buffer) => { jsonStderr += chunk.toString("utf8"); });
    const jsonStatus = await new Promise<number | null>((resolvePromise) => jsonCli.once("exit", resolvePromise));
    assert.equal(jsonStatus, 0, jsonStderr);
    const report = JSON.parse(jsonStdout) as {
      formatVersion: number;
      kind: string;
      verifiedAt: string;
      target: { origin: string; url: string; base: string };
      build: { buildId: string; apiVersion: string; sourceMaps: boolean };
      checks: { files: number; routes: number; headers: number };
    };
    assert.equal(report.formatVersion, 1);
    assert.equal(report.kind, "velar-deployment-verification");
    assert.ok(Number.isFinite(Date.parse(report.verifiedAt)));
    assert.deepEqual(report.target, { origin: preview.origin, url: preview.url, base: "/" });
    assert.equal(report.build.buildId, build.buildId);
    assert.equal(report.build.sourceMaps, true);
    assert.equal(report.checks.routes, 3);
    assert.ok(report.checks.files > 0);
    assert.ok(report.checks.headers > 0);

    const entryPath = verified.manifest.entry;
    const tamperedFetch: DeploymentFetch = async (input, init) => {
      const response = await fetch(input, init);
      if (new URL(input).pathname.endsWith(entryPath)) {
        await response.body?.cancel();
        return new Response("tampered", { status: response.status, headers: response.headers });
      }
      return response;
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, tamperedFetch),
      /Deployed file.*has 8 bytes|SHA-256/u,
    );

    const badCacheFetch: DeploymentFetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!new URL(input).pathname.startsWith("/assets/")) return response;
      const body = await response.arrayBuffer();
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Cache-Control", "no-cache");
      return new Response(body, { status: response.status, headers: responseHeaders });
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, badCacheFetch),
      /Deployment header 'Cache-Control'.*expected 'public, max-age=31536000, immutable'/u,
    );

    const redirectFetch: DeploymentFetch = async (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/") return new Response(null, { status: 302, headers: { Location: "/login" } });
      return fetch(input, init);
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, redirectFetch),
      /redirected '\/' with HTTP 302/u,
    );

    const fallbackAssetFetch: DeploymentFetch = async (input, init) => {
      const url = new URL(input);
      if (!url.pathname.includes("/__velar_missing_")) return fetch(input, init);
      return new Response(await readFile(join(directory, "dist", "index.html")), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };
    await assert.rejects(
      verifyRemoteDeployment(verified, preview.origin, fallbackAssetFetch),
      /missing production asset returned HTTP 200.*expected 404/u,
    );

    await assert.rejects(verifyRemoteDeployment(verified, "http://example.com"), /must use HTTPS/u);
    await assert.rejects(verifyRemoteDeployment(verified, `${preview.origin}/wrong/`), /origin without a path/u);
  } finally {
    await preview.close();
  }

  const unexpected = join(directory, "dist", "unexpected.txt");
  await writeFile(unexpected, "not declared\n", "utf8");
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /undeclared file 'unexpected\.txt'/u);
  await unlink(unexpected);
  const link = join(directory, "dist", "linked.txt");
  await symlink(join(directory, "src", "main.vel"), link);
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /symbolic link 'linked\.txt'/u);
  await unlink(link);
  const entryAsset = build.assets.find((asset) => asset.role === "entry")!;
  await writeFile(join(directory, "dist", entryAsset.path), "tampered\n", "utf8");
  await assert.rejects(verifyProductionBuild(join(directory, "dist")), /size does not match|SHA-256 does not match/u);
});
