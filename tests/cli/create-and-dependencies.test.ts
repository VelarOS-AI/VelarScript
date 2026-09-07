import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveVelarProject } from "../../packages/cli/src/config.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";
import { verifyProductionBuild } from "../../packages/cli/src/production-verifier.ts";
import { parseDependencyArguments, runDependencyCommand } from "../../packages/cli/src/package-manager.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { parseNpmPackResult } from "../../scripts/npm-pack-result.mjs";
import { runNpmSync, linkWorkspaceWebExtension, linkWorkspaceDesktopExtension } from "../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("CLI creates explicit format-v2 projects and rejects legacy manifests without overwriting user files", async () => {
  const directory = await makeTemporaryDirectory("velar-lifecycle-");
  const projectRoot = join(directory, "my-app");
  const created = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const manifest = JSON.parse(await readFile(join(projectRoot, "velar.json"), "utf8")) as { formatVersion: number; name: string };
  assert.equal(manifest.formatVersion, 2);
  // D114 F9-node-cli residual 1: every template names its project, so no two
  // scaffolded projects share the identity a Node build bakes into
  // `velar/serve` just because they share the default entry.
  assert.equal(manifest.name, "my-app");
  const createdPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(createdPackage.dependencies["@velarscript/web"], "0.31.0");
  assert.equal(createdPackage.devDependencies["@velarscript/cli"], "0.31.0");
  assert.equal(createdPackage.scripts.format, "velar format");
  assert.equal(createdPackage.scripts["format:check"], "velar format --check");
  assert.equal(createdPackage.scripts["test:browser"], "velar test --browser");
  assert.equal(createdPackage.scripts.verify, "velar verify");
  assert.equal(createdPackage.scripts.preview, "velar preview");
  assert.equal(createdPackage.scripts["verify:deployment"], "velar verify-deployment");
  assert.match(await readFile(join(projectRoot, "src", "main.vel"), "utf8"), /import \{App\} from "\.\/app\.vel"/u);
  const webAgents = await readFile(join(projectRoot, "AGENTS.md"), "utf8");
  assert.match(webAgents, /velar skill core.*velar skill web/su);
  assert.doesNotMatch(webAgents, /velar skill node|velar skill desktop/u);
  const generatedApp = await readFile(join(projectRoot, "src", "app.vel"), "utf8");
  assert.match(generatedApp, /VelarScript Web/u);
  assert.equal(
    await readFile(join(projectRoot, "public", "velarscript-mark.svg"), "utf8"),
    await readFile(resolve("assets/brand/velarscript-mark.svg"), "utf8"),
  );
  assert.match(await readFile(join(projectRoot, "src", "app.test.vel"), "utf8"), /^test "application contract":$/mu);
  assert.match(await readFile(join(projectRoot, "src", "app.browser.test.vel"), "utf8"), /browser\.open/u);
  await linkWorkspaceWebExtension(projectRoot);
  const config = await resolveVelarProject(projectRoot);
  assert.equal(config.formatVersion, 2);
  assert.deepEqual(config.extensions, ["@velarscript/web"]);
  assert.equal(config.build.sourceMaps, false);
  assert.equal(config.framework?.host.id, "@velarscript/web");
  const checked = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  const coreTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(coreTest.status, 0, coreTest.stderr);
  assert.match(coreTest.stdout, /app\.test\.vel" :: "application contract"/u);

  const formatCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", "--check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(formatCheck.status, 0, formatCheck.stderr);
  assert.match(formatCheck.stdout, /Checked formatting of 4 VelarScript source files/u);
  await writeFile(join(projectRoot, "src", "app.vel"), generatedApp.replace("\n", "  \n"), "utf8");
  const unformatted = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", projectRoot, "--check"], { cwd: directory, encoding: "utf8" });
  assert.equal(unformatted.status, 1);
  assert.match(unformatted.stderr, /src[/\\]app\.vel is not formatted/u);
  const formatted = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(formatted.status, 0, formatted.stderr);
  assert.equal(await readFile(join(projectRoot, "src", "app.vel"), "utf8"), generatedApp);
  await writeFile(join(projectRoot, "src", "app.vel"), generatedApp.replace("\n", "  \n"), "utf8");
  const singleFileFormatted = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", join(projectRoot, "src", "app.vel")], { cwd: directory, encoding: "utf8" });
  assert.equal(singleFileFormatted.status, 0, singleFileFormatted.stderr);
  assert.equal(await readFile(join(projectRoot, "src", "app.vel"), "utf8"), generatedApp);

  await mkdir(join(projectRoot, "public"), { recursive: true });
  await writeFile(join(projectRoot, "public", "ignored.vel"), "const publicAsset = true", "utf8");
  const excludesPublic = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", "--check"], { cwd: projectRoot, encoding: "utf8" });
  assert.equal(excludesPublic.status, 0, excludesPublic.stderr);
  assert.equal(await readFile(join(projectRoot, "public", "ignored.vel"), "utf8"), "const publicAsset = true");

  const secondCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", projectRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(secondCreate.status, 1);
  assert.match(secondCreate.stderr, /not empty/u);

  const unusualRoot = join(directory, "_Hidden & App");
  const unusualCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", unusualRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(unusualCreate.status, 0, unusualCreate.stderr);
  const unusualPackage = JSON.parse(await readFile(join(unusualRoot, "package.json"), "utf8")) as { name: string };
  assert.equal(unusualPackage.name, "hidden-app");
  // The manifest name is the directory as a person reads it — capitalisation,
  // spaces and punctuation kept — where the npm name beside it is the same
  // directory reduced to what npm accepts. They are different jobs.
  assert.equal(JSON.parse(await readFile(join(unusualRoot, "velar.json"), "utf8")).name, "_Hidden & App");
  assert.match(await readFile(join(unusualRoot, "src", "app.vel"), "utf8"), /appName = "_Hidden & App"/u);
  await linkWorkspaceWebExtension(unusualRoot);
  const unusualCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", unusualRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(unusualCheck.status, 0, unusualCheck.stderr);

  const emptyRoot = join(directory, "existing-empty");
  await mkdir(emptyRoot);
  const emptyCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", emptyRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(emptyCreate.status, 0, emptyCreate.stderr);
  assert.equal(JSON.parse(await readFile(join(emptyRoot, "velar.json"), "utf8")).formatVersion, 2);

  const docsRoot = join(directory, "product-docs");
  const docsCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", docsRoot, "--template", "docs"], { cwd: directory, encoding: "utf8" });
  assert.equal(docsCreate.status, 0, docsCreate.stderr);
  assert.match(docsCreate.stdout, /Created VelarScript docs project/u);
  assert.match(await readFile(join(docsRoot, "src", "content.vel"), "utf8"), /export type DocPage/u);
  assert.match(await readFile(join(docsRoot, "src", "app.vel"), "utf8"), /Router routes/u);
  await linkWorkspaceWebExtension(docsRoot);
  const docsCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", docsRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(docsCheck.status, 0, docsCheck.stderr);
  const docsBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", docsRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(docsBuild.status, 0, docsBuild.stderr);
  await verifyProductionBuild(join(docsRoot, "dist"));

  const libraryRoot = join(directory, "text-library");
  const libraryCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", "--template=library", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryCreate.status, 0, libraryCreate.stderr);
  assert.match(libraryCreate.stdout, /Created VelarScript library project/u);
  const libraryPackage = JSON.parse(await readFile(join(libraryRoot, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string; targets: string[]; requires: { capabilities: string[] } };
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(libraryPackage.files, ["src", "dist"]);
  assert.equal(libraryPackage.velar.entry, "src/index.vel");
  assert.deepEqual(libraryPackage.velar.targets, ["core"]);
  assert.deepEqual(libraryPackage.velar.requires.capabilities, []);
  assert.equal(libraryPackage.scripts["pack:check"], "npm pack --dry-run --json");
  assert.match(libraryPackage.scripts.validate ?? "", /npm run pack:check$/u);
  assert.equal(libraryPackage.devDependencies["@velarscript/web"], undefined);
  assert.deepEqual(JSON.parse(await readFile(join(libraryRoot, "velar.json"), "utf8")).extensions, []);
  assert.doesNotMatch(await readFile(join(libraryRoot, "AGENTS.md"), "utf8"), /velar skill (?:web|node|desktop)/u);
  const libraryCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryCheck.status, 0, libraryCheck.stderr);
  const libraryFormat = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "format", libraryRoot, "--check"], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryFormat.status, 0, libraryFormat.stderr);
  const libraryTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", libraryRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryTest.status, 0, libraryTest.stderr);
  assert.match(libraryTest.stdout, /index\.test\.vel" :: "greeting"/u);
  const libraryBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", libraryRoot, "--mode", "readable"], { cwd: directory, encoding: "utf8" });
  assert.equal(libraryBuild.status, 0, libraryBuild.stderr);
  assert.match(await readFile(join(libraryRoot, "dist", "index.js"), "utf8"), /function greet/u);
  const libraryPack = runNpmSync(["pack", "--dry-run", "--json"], libraryRoot);
  assert.equal(libraryPack.status, 0, String(libraryPack.stderr));
  const libraryReceipt = parseNpmPackResult(String(libraryPack.stdout), "text-library") as { files: Array<{ path: string }> };
  assert.ok(libraryReceipt.files.some((file) => file.path === "src/index.vel"), String(libraryPack.stdout));

  const componentRoot = join(directory, "info-card");
  const componentCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", componentRoot, "--template", "component"], { cwd: directory, encoding: "utf8" });
  assert.equal(componentCreate.status, 0, componentCreate.stderr);
  assert.match(componentCreate.stdout, /Created VelarScript component project/u);
  const componentPackage = JSON.parse(await readFile(join(componentRoot, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string; targets: string[]; requires: { capabilities: string[] } };
    scripts: Record<string, string>;
    peerDependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(componentPackage.files, ["src/index.vel", "README.md"]);
  assert.equal(componentPackage.velar.entry, "src/index.vel");
  assert.deepEqual(componentPackage.velar.targets, ["web", "desktop"]);
  assert.deepEqual(componentPackage.velar.requires.capabilities, []);
  assert.equal(componentPackage.scripts["pack:check"], "npm pack --dry-run --json");
  assert.match(componentPackage.scripts.validate ?? "", /npm run pack:check$/u);
  assert.equal(componentPackage.peerDependencies["@velarscript/web"], "^0.31.0");
  assert.equal(componentPackage.devDependencies["@velarscript/web"], "0.31.0");
  assert.match(await readFile(join(componentRoot, "src", "index.vel"), "utf8"), /export component InfoCard/u);
  assert.deepEqual(JSON.parse(await readFile(join(componentRoot, "velar.json"), "utf8")).extensions, ["@velarscript/web"]);
  await linkWorkspaceWebExtension(componentRoot);
  const componentCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentCheck.status, 0, componentCheck.stderr);
  const componentTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentTest.status, 0, componentTest.stderr);
  assert.match(componentTest.stdout, /index\.test\.vel" :: "component content contract"/u);
  const componentBuild = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "build", componentRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(componentBuild.status, 0, componentBuild.stderr);
  await verifyProductionBuild(join(componentRoot, "dist"));
  const componentPack = runNpmSync(["pack", "--dry-run", "--json"], componentRoot);
  assert.equal(componentPack.status, 0, String(componentPack.stderr));
  const componentReceipt = parseNpmPackResult(String(componentPack.stdout), "info-card") as { files: Array<{ path: string }> };
  assert.ok(componentReceipt.files.some((file) => file.path === "src/index.vel"), String(componentPack.stdout));

  const nodeRoot = join(directory, "hello-node");
  const nodeCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", nodeRoot, "--template", "node"], { cwd: directory, encoding: "utf8" });
  assert.equal(nodeCreate.status, 0, nodeCreate.stderr);
  assert.match(nodeCreate.stdout, /Created VelarScript node project/u);
  const nodePackage = JSON.parse(await readFile(join(nodeRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.equal(nodePackage.dependencies["@velarscript/server"], "0.31.0");
  assert.equal(nodePackage.dependencies["@velarscript/node"], undefined);
  assert.equal(nodePackage.scripts.dev, "velar dev");
  assert.equal(nodePackage.scripts.start, "velar serve");
  const nodeManifest = JSON.parse(await readFile(join(nodeRoot, "velar.json"), "utf8"));
  assert.deepEqual(nodeManifest.extensions, ["@velarscript/server"]);
  assert.equal(nodeManifest.node, undefined);
  const nodeAgents = await readFile(join(nodeRoot, "AGENTS.md"), "utf8");
  assert.match(nodeAgents, /velar skill core.*velar skill node.*velar skill server/su);
  assert.doesNotMatch(nodeAgents, /velar skill web|velar skill desktop/u);
  assert.match(await readFile(join(nodeRoot, "src", "app.vel"), "utf8"), /@get\(p"\/api\/hello"\)/u);
  assert.match(await readFile(join(nodeRoot, "src", "main.vel"), "utf8"), /application\(routes\)/u);
  assert.match(await readFile(join(nodeRoot, "application.yml"), "utf8"), /port: 3000/u);
  assert.match(await readFile(join(nodeRoot, "public", "index.html"), "utf8"), /velarscript-mark\.svg/u);
  const nodeCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", nodeRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(nodeCheck.status, 0, nodeCheck.stderr);
  const nodeTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", nodeRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(nodeTest.status, 0, nodeTest.stderr);
  assert.match(nodeTest.stdout, /app\.test\.vel" :: "node application contract"/u);

  const desktopRoot = join(directory, "hello-desktop");
  const desktopCreate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", desktopRoot, "--template=desktop"], { cwd: directory, encoding: "utf8" });
  assert.equal(desktopCreate.status, 0, desktopCreate.stderr);
  assert.match(desktopCreate.stdout, /Created VelarScript desktop project/u);
  const desktopPackage = JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  assert.equal(desktopPackage.dependencies["@velarscript/desktop"], "0.31.0");
  assert.equal(desktopPackage.scripts.package, "velar package");
  assert.equal(desktopPackage.scripts["test:browser"], "velar test --browser=all");
  const desktopAgents = await readFile(join(desktopRoot, "AGENTS.md"), "utf8");
  assert.match(desktopAgents, /velar skill core.*velar skill web.*velar skill desktop/su);
  assert.doesNotMatch(desktopAgents, /velar skill node/u);
  assert.match(await readFile(join(desktopRoot, "src", "app.vel"), "utf8"), /VelarScript Desktop/u);
  assert.match(await readFile(join(desktopRoot, "public", "velarscript-mark.svg"), "utf8"), /<path d=/u);
  await linkWorkspaceDesktopExtension(desktopRoot);
  const desktopCheck = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "check", desktopRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(desktopCheck.status, 0, desktopCheck.stderr);
  const desktopTest = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "test", desktopRoot], { cwd: directory, encoding: "utf8" });
  assert.equal(desktopTest.status, 0, desktopTest.stderr);
  assert.match(desktopTest.stdout, /app\.test\.vel" :: "desktop application contract"/u);

  const unavailableGame = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", join(directory, "game"), "--template", "game"], { cwd: directory, encoding: "utf8" });
  assert.equal(unavailableGame.status, 2);
  assert.match(unavailableGame.stderr, /reserved for the future @velarscript\/game/u);
  const unknownTemplate = spawnSync(process.execPath, [resolve("packages/cli/src/cli.ts"), "create", join(directory, "unknown"), "--template=mobile"], { cwd: directory, encoding: "utf8" });
  assert.equal(unknownTemplate.status, 2);
  assert.match(unknownTemplate.stderr, /unknown template 'mobile'/u);

  const legacyRoot = join(directory, "legacy");
  await mkdir(legacyRoot);
  await writeFile(join(legacyRoot, "main.vel"), "const value = 1\n", "utf8");
  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ entry: "main.vel", web: { title: "Legacy", base: "/" } }, null, 2), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /'formatVersion' is required.*does not load legacy project formats/u);

  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ formatVersion: 1, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /unsupported formatVersion 1/u);

  await writeFile(join(legacyRoot, "velar.json"), JSON.stringify({ formatVersion: 99, entry: "main.vel", extensions: [] }), "utf8");
  await assert.rejects(resolveVelarProject(legacyRoot), /unsupported formatVersion 99/u);
});

test("CLI help is command-specific and malformed top-level invocations fail cleanly", () => {
  const cli = resolve("packages/cli/src/cli.ts");
  const help = spawnSync(process.execPath, [cli, "help", "build"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: velar build/u);
  assert.match(help.stdout, /standalone Node application/u);

  const serveHelp = spawnSync(process.execPath, [cli, "help", "serve"], { encoding: "utf8" });
  assert.equal(serveHelp.status, 0, serveHelp.stderr);
  assert.match(serveHelp.stdout, /Node server factory.*host and port belong to velar\/server configuration/u);

  const inlineHelp = spawnSync(process.execPath, [cli, "test", "--help"], { encoding: "utf8" });
  assert.equal(inlineHelp.status, 0, inlineHelp.stderr);
  assert.match(inlineHelp.stdout, /bare --browser defaults to Chromium/u);

  const createHelp = spawnSync(process.execPath, [cli, "help", "create"], { encoding: "utf8" });
  assert.equal(createHelp.status, 0, createHelp.stderr);
  assert.match(createHelp.stdout, /--template <web\|node\|desktop\|docs\|library\|component>/u);

  const addHelp = spawnSync(process.execPath, [cli, "help", "add"], { encoding: "utf8" });
  assert.equal(addHelp.status, 0, addHelp.stderr);
  assert.match(addHelp.stdout, /npm registry packages.*velar\.extension/u);
  const unsafeAdd = spawnSync(process.execPath, [cli, "add", "file:../local"], { encoding: "utf8" });
  assert.equal(unsafeAdd.status, 2);
  assert.match(unsafeAdd.stderr, /not a supported npm registry package specifier/u);

  const creator = resolve("packages/create/src/cli.ts");
  const creatorVersion = spawnSync(process.execPath, [creator, "--version"], { encoding: "utf8" });
  assert.equal(creatorVersion.status, 0, creatorVersion.stderr);
  assert.equal(creatorVersion.stdout, "create-velar 0.31.0\n");
  const creatorMissing = spawnSync(process.execPath, [creator], { encoding: "utf8" });
  assert.equal(creatorMissing.status, 2);
  assert.match(creatorMissing.stderr, /expected one project directory/u);

  const unknownHelp = spawnSync(process.execPath, [cli, "help", "missing"], { encoding: "utf8" });
  assert.equal(unknownHelp.status, 2);
  assert.match(unknownHelp.stderr, /unknown command 'missing'/u);
  assert.doesNotMatch(unknownHelp.stderr, /at .*cli/u);

  const invalidVersion = spawnSync(process.execPath, [cli, "--version", "extra"], { encoding: "utf8" });
  assert.equal(invalidVersion.status, 2);
  assert.match(invalidVersion.stderr, /does not accept arguments/u);
});

test("VelarScript dependency commands keep npm authoritative and project extensions explicit", async () => {
  assert.deepEqual(parseDependencyArguments("install", []), { packages: [], packageNames: [], dev: false });
  assert.deepEqual(parseDependencyArguments("add", ["@example/feature@1.2.3", "tiny-lib", "--dev"]), {
    packages: ["@example/feature@1.2.3", "tiny-lib"],
    packageNames: ["@example/feature", "tiny-lib"],
    dev: true,
  });
  assert.match(String(parseDependencyArguments("add", ["file:../feature"])), /not a supported npm registry package specifier/u);
  assert.match(String(parseDependencyArguments("remove", ["tiny-lib@1.0.0"])), /bare npm package name/u);
  assert.match(String(parseDependencyArguments("update", ["--dev"])), /available only/u);
  assert.match(String(parseDependencyArguments("add", ["tiny-lib", "tiny-lib@next"])), /cannot be repeated/u);

  const directory = await makeTemporaryDirectory("velar-dependency-command-");
  const root = join(directory, "project");
  const extensionRoot = join(root, "node_modules", "@example", "feature");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "dependency-project",
    private: true,
    type: "module",
    packageManager: "npm@11.4.2",
  }, null, 2), "utf8");
  await writeFile(join(root, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2), "utf8");
  await writeFile(join(root, "src", "main.vel"), "export const answer = 42\n", "utf8");
  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name: "@example/feature",
    version: "1.2.3",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", manifestKey: "feature" } },
  }, null, 2), "utf8");
  await writeFile(join(extensionRoot, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: "@example/feature", contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: Object.freeze({})}), capabilities: Object.freeze(["feature"])})
export const velarProjectExtension = Object.freeze({id: "@example/feature", manifestKey: "feature", parse(value) { return value ?? Object.freeze({}) }})
`.trimStart(), "utf8");

  const npmCalls: { readonly arguments: readonly string[]; readonly cwd: string }[] = [];
  const executeNpm = async (arguments_: readonly string[], cwd: string): Promise<void> => {
    npmCalls.push({ arguments: [...arguments_], cwd });
  };
  const add = parseDependencyArguments("add", ["@example/feature@1.2.3"]);
  assert.notEqual(typeof add, "string");
  if (typeof add === "string") return;
  const added = await runDependencyCommand("add", add, { cwd: join(root, "src"), executeNpm });
  assert.deepEqual(npmCalls[0], { arguments: ["install", "--save", "--", "@example/feature@1.2.3"], cwd: root });
  assert.deepEqual(added.activatedExtensions, ["@example/feature"]);
  const activated = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as { extensions: string[]; feature?: unknown };
  assert.deepEqual(activated.extensions, ["@example/feature"]);

  activated.feature = { enabled: true };
  await writeFile(join(root, "velar.json"), `${JSON.stringify(activated, null, 2)}\n`, "utf8");
  const remove = parseDependencyArguments("remove", ["@example/feature"]);
  assert.notEqual(typeof remove, "string");
  if (typeof remove === "string") return;
  const removed = await runDependencyCommand("remove", remove, { cwd: root, executeNpm });
  assert.deepEqual(npmCalls[1], { arguments: ["uninstall", "--", "@example/feature"], cwd: root });
  assert.deepEqual(removed.removedExtensions, ["@example/feature"]);
  const deactivated = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(deactivated.extensions, []);
  assert.equal(deactivated.feature, undefined);

  const update = parseDependencyArguments("update", []);
  assert.notEqual(typeof update, "string");
  if (typeof update === "string") return;
  await runDependencyCommand("update", update, { cwd: root, executeNpm });
  assert.deepEqual(npmCalls[2], { arguments: ["update"], cwd: root });

  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "dependency-project",
    private: true,
    packageManager: "bun@1.3.0",
  }, null, 2), "utf8");
  await assert.rejects(runDependencyCommand("update", update, { cwd: root, executeNpm }), /package commands use npm/u);
  assert.equal(npmCalls.length, 3);
});

test("VelarScript dependency activation rolls back only the project manifest on an invalid extension", async () => {
  const root = await makeTemporaryDirectory("velar-dependency-rollback-");
  const extensionRoot = join(root, "node_modules", "invalid-extension");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(extensionRoot, { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "rollback-project", private: true, type: "module" }, null, 2), "utf8");
  const original = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`;
  await writeFile(join(root, "velar.json"), original, "utf8");
  await writeFile(join(root, "src", "main.vel"), "const answer = 42\n", "utf8");
  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name: "invalid-extension",
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", manifestKey: "invalid", extends: {} } },
  }, null, 2), "utf8");
  await writeFile(join(extensionRoot, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: "invalid-extension", contract: Object.freeze({protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: Object.freeze({})}), capabilities: Object.freeze(["invalid"])})
export const velarProjectExtension = Object.freeze({id: "invalid-extension", manifestKey: "invalid", parse() { throw new Error("invalid configuration") }})
`.trimStart(), "utf8");
  const parsed = parseDependencyArguments("add", ["invalid-extension"]);
  assert.notEqual(typeof parsed, "string");
  if (typeof parsed === "string") return;
  await assert.rejects(
    runDependencyCommand("add", parsed, { cwd: root, executeNpm: async () => undefined }),
    /installed but could not be activated.*invalid configuration/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), original);

  await writeFile(join(root, "src", "alternate.vel"), "const answer = 43\n", "utf8");
  const concurrent = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/alternate.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: [],
  }, null, 2)}\n`;
  await assert.rejects(
    runDependencyCommand("add", parsed, {
      cwd: root,
      executeNpm: async () => { await writeFile(join(root, "velar.json"), concurrent, "utf8"); },
    }),
    /installed but its project declaration changed while npm was running and was not overwritten/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), concurrent);
  await writeFile(join(root, "velar.json"), original, "utf8");

  const missing = parseDependencyArguments("add", ["missing-package"]);
  assert.notEqual(typeof missing, "string");
  if (typeof missing === "string") return;
  await assert.rejects(
    runDependencyCommand("add", missing, { cwd: root, executeNpm: async () => undefined }),
    /installed but its VelarScript metadata is invalid.*cannot resolve installed package 'missing-package'/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), original);

  await writeFile(join(extensionRoot, "package.json"), JSON.stringify({
    name: "invalid-extension",
    version: "1.0.0",
    type: "module",
    exports: { "./compiler": "./compiler.js" },
    velar: { extension: { kind: "language", apiVersion: "1.0", manifestKey: "entry" } },
  }), "utf8");
  await assert.rejects(
    runDependencyCommand("add", parsed, { cwd: root, executeNpm: async () => undefined }),
    /installed but its VelarScript metadata is invalid.*manifestKey.*reserved project field 'entry'/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), original);
});

test("dependency removal prunes only orphaned inherited extension configuration", async () => {
  const root = await makeTemporaryDirectory("velar-extension-remove-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "extension-remove-project", private: true, type: "module" }), "utf8");
  await writeFile(join(root, "src", "main.vel"), "const answer = 42\n", "utf8");

  const writeExtension = async (
    name: string,
    kind: "application" | "capability",
    apiVersion: string,
    manifestKey: string,
    parents: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const packageRoot = join(root, "node_modules", name);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({
      name,
      version: "1.0.0",
      type: "module",
      exports: { "./compiler": "./compiler.js" },
      peerDependencies: Object.fromEntries(Object.keys(parents).map((parent) => [parent, "^1.0.0"])),
      velar: { extension: { kind, apiVersion, manifestKey, extends: parents } },
    }), "utf8");
    await writeFile(join(packageRoot, "compiler.js"), `
export const velarCompilerExtension = Object.freeze({id: ${JSON.stringify(name)}, contract: Object.freeze({protocolVersion: 1, apiVersion: ${JSON.stringify(apiVersion)}, kind: ${JSON.stringify(kind)}, extends: Object.freeze(${JSON.stringify(parents)})})})
export const velarProjectExtension = Object.freeze({id: ${JSON.stringify(name)}, manifestKey: ${JSON.stringify(manifestKey)}, parse(value) { return value ?? Object.freeze({}) }})
`.trimStart(), "utf8");
  };

  await writeExtension("fixture-app", "application", "1.0", "app", {});
  await writeExtension("fixture-first", "capability", "1.0", "first", { "fixture-app": "1.0" });
  await writeExtension("fixture-second", "capability", "1.0", "second", { "fixture-app": "1.0" });
  const originalManifest = `${JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: ["fixture-first", "fixture-second"],
    app: { title: "shared parent" },
    first: { enabled: true },
    second: { enabled: true },
  }, null, 2)}\n`;
  await writeFile(join(root, "velar.json"), originalManifest, "utf8");

  const npmCalls: string[][] = [];
  const stagedManifests: Record<string, unknown>[] = [];
  const executeNpm = async (arguments_: readonly string[]): Promise<void> => {
    npmCalls.push([...arguments_]);
    stagedManifests.push(JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as Record<string, unknown>);
  };
  const first = parseDependencyArguments("remove", ["fixture-first"]);
  assert.notEqual(typeof first, "string");
  if (typeof first === "string") return;
  await runDependencyCommand("remove", first, { cwd: root, executeNpm });
  const shared = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(shared.extensions, ["fixture-second"]);
  assert.deepEqual(shared.app, { title: "shared parent" });
  assert.equal(shared.first, undefined);
  assert.deepEqual(shared.second, { enabled: true });
  assert.deepEqual(stagedManifests[0]?.extensions, ["fixture-second"]);
  assert.deepEqual(stagedManifests[0]?.app, { title: "shared parent" });
  assert.equal(stagedManifests[0]?.first, undefined);

  const second = parseDependencyArguments("remove", ["fixture-second"]);
  assert.notEqual(typeof second, "string");
  if (typeof second === "string") return;
  await runDependencyCommand("remove", second, { cwd: root, executeNpm });
  const empty = JSON.parse(await readFile(join(root, "velar.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(empty.extensions, []);
  assert.equal(empty.app, undefined);
  assert.equal(empty.first, undefined);
  assert.equal(empty.second, undefined);
  assert.deepEqual(stagedManifests[1]?.extensions, []);
  assert.equal(stagedManifests[1]?.app, undefined);
  assert.deepEqual(npmCalls, [
    ["uninstall", "--", "fixture-first"],
    ["uninstall", "--", "fixture-second"],
  ]);

  await writeFile(join(root, "velar.json"), originalManifest, "utf8");
  await assert.rejects(
    runDependencyCommand("remove", first, { cwd: root, executeNpm: async () => { throw new Error("npm refused"); } }),
    /npm refused/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), originalManifest);

  const concurrentManifest = JSON.parse(originalManifest) as Record<string, unknown>;
  concurrentManifest.entry = "src/concurrent.vel";
  const concurrentSource = `${JSON.stringify(concurrentManifest, null, 2)}\n`;
  await assert.rejects(
    runDependencyCommand("remove", first, {
      cwd: root,
      executeNpm: async () => {
        await writeFile(join(root, "velar.json"), concurrentSource, "utf8");
        throw new Error("npm refused concurrently");
      },
    }),
    /Dependency removal failed: npm refused concurrently.*changed concurrently and was not overwritten/u,
  );
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), concurrentSource);

  const compactLargeSource = JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    extensions: ["fixture-first", "fixture-second"],
    app: {},
    first: {},
    second: { values: Array.from({ length: 120_000 }, () => 0) },
  });
  assert.ok(Buffer.byteLength(compactLargeSource, "utf8") < 1024 * 1024);
  await writeFile(join(root, "velar.json"), compactLargeSource, "utf8");
  let oversizedNpmCalled = false;
  await assert.rejects(
    runDependencyCommand("remove", first, {
      cwd: root,
      executeNpm: async () => { oversizedNpmCalled = true; },
    }),
    /serialized project declaration exceeds 1 MiB/u,
  );
  assert.equal(oversizedNpmCalled, false);
  assert.equal(await readFile(join(root, "velar.json"), "utf8"), compactLargeSource);

  const invalidManifest = JSON.parse(originalManifest) as Record<string, unknown>;
  invalidManifest.rogue = true;
  await writeFile(join(root, "velar.json"), `${JSON.stringify(invalidManifest, null, 2)}\n`, "utf8");
  let invalidNpmCalled = false;
  await assert.rejects(
    runDependencyCommand("remove", first, { cwd: root, executeNpm: async () => { invalidNpmCalled = true; } }),
    /unknown 'project' field 'rogue'/u,
  );
  assert.equal(invalidNpmCalled, false);
});
