import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarPackageNames } from "../scripts/velar-packages.mjs";
import { BROWSER_TEST_MODULE, webModuleInterfaces } from "../packages/web/dist/compiler.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = await mkdtemp(join(tmpdir(), "velar-installed-browser-"));

/**
 * Every Web module an application may import, read from the extension's own
 * interface table rather than listed here, so a module published tomorrow
 * fails this acceptance until the installed toolchain really serves it.
 *
 * `velar/web-test` is the one subtraction, and it is the compiler's own
 * constant rather than a name matched by spelling: importing it from
 * application source is refused outright (VEL5062 — it only has a runtime
 * under `velar test --browser`), so it is exercised by the generated browser
 * test instead, one layer below.
 *
 * Nothing else is subtracted. `velar/look` was missing from the hand-written
 * list this replaces, on the belief that it is syntax with no importable value
 * surface; its interface publishes 37 exports and the charter writes
 * `import {alpha, border, rgb, spacing} from "velar/look"`, so the belief was
 * simply wrong and the old count of nine was one short.
 *
 * The probe name per module is its first *function* export, because a value
 * with a runtime behind it proves the installed package actually serves the
 * module. A type name would prove only that the interface parsed.
 */
const applicationWebModules = [...webModuleInterfaces]
  .filter(([specifier]) => specifier !== BROWSER_TEST_MODULE)
  .map(([specifier, moduleInterface]) => {
    const probe = [...moduleInterface.exports]
      .filter(([, entry]) => entry?.kind === "function")
      .map(([name]) => name)
      .sort()[0];
    assert.ok(probe, `${specifier} publishes no function export to probe the installed module with`);
    return { specifier, probe };
  })
  .sort((left, right) => left.specifier.localeCompare(right.specifier));

try {
  // A-024: this file held the fifth copy of the eight-package roster — one
  // literal `pack()` list and four literal install lists — while
  // `docs/contributing/continuous-integration.md` said the installed set is
  // derived from `packages/*`. A publishable package added to the workspace
  // was packed, content-checked and installed by `test:packages` on the day it
  // existed, and never entered the installed-toolchain acceptance at all.
  const tarballs: string[] = [];
  for (const name of await velarPackageNames(root)) tarballs.push(join(directory, await pack(name)));
  /** Every packed tarball, as one `npm install` takes them. */
  const install = (extra: readonly string[], cwd: string) =>
    runNpm(["install", ...extra, "--ignore-scripts", "--no-audit", "--no-fund", ...tarballs], cwd);
  await writeFile(join(directory, "package.json"), "{}\n", "utf8");
  await install([], directory);
  const installedCli = join(directory, "node_modules", "@velarscript", "cli", "dist", "cli.js");
  const application = join(directory, "Team & App");
  await run(process.execPath, [installedCli, "create", application], directory);
  await install(["--save-dev"], application);
  await writeFile(join(application, "src", "web-contract.vel"), `${applicationWebModules
    .map(({ specifier, probe }) => `import {${probe}} from "${specifier}"`)
    .join("\n")}

export const installedWebModules = [
${applicationWebModules.map(({ probe }) => `    ${probe},`).join("\n")}
].size
`, "utf8");
  await writeFile(join(application, "src", "main.vel"), `
import {App} from "./app.vel"
import {installedWebModules} from "./web-contract.vel"

assert installedWebModules == ${applicationWebModules.length} else "The installed Web package must expose all application modules"
mount(<App />, "#app")
`.trimStart(), "utf8");
  const manifest = JSON.parse(await readFile(join(application, "package.json"), "utf8")) as { scripts: Record<string, string> };
  for (const script of ["format:check", "check", "test", "build", "verify", "test:browser"]) assert.ok(manifest.scripts[script], `missing generated script ${script}`);
  await runNpm(["run", "format:check"], application);
  await runNpm(["run", "check"], application);
  const core = await runNpm(["test"], application);
  assert.match(core.stdout, /app\.test\.vel" :: "application contract"/u);
  await runNpm(["run", "build"], application);
  const verification = await runNpm(["run", "verify"], application);
  assert.match(verification.stdout, /Verified production web build [a-f0-9]{64}/u);
  const result = await runNpm(["run", "test:browser", "--", "chromium"], application);
  assert.match(result.stdout, /chromium :: "src\/app\.browser\.test\.vel" :: "home page"/u);
  assert.match(result.stdout, /1 passed, 0 failed/u);

  const documentation = join(directory, "Product Docs");
  await run(process.execPath, [installedCli, "create", documentation, "--template", "docs"], directory);
  await install(["--save-dev"], documentation);
  await runNpm(["run", "format:check"], documentation);
  await runNpm(["run", "check"], documentation);
  await runNpm(["test"], documentation);
  await runNpm(["run", "build"], documentation);
  await runNpm(["run", "verify"], documentation);
  const docsBrowser = await runNpm(["run", "test:browser", "--", "chromium"], documentation);
  assert.match(docsBrowser.stdout, /chromium :: "src\/app\.browser\.test\.vel" :: "guide route"/u);
  assert.match(docsBrowser.stdout, /1 passed, 0 failed/u);

  const component = join(directory, "Info Card");
  await run(process.execPath, [installedCli, "create", component, "--template", "component"], directory);
  await install(["--save-dev"], component);
  const componentManifest = JSON.parse(await readFile(join(component, "package.json"), "utf8")) as {
    files: string[];
    velar: { entry: string };
    peerDependencies: Record<string, string>;
  };
  assert.deepEqual(componentManifest.files, ["src/index.vel", "README.md"]);
  assert.equal(componentManifest.velar.entry, "src/index.vel");
  assert.equal(componentManifest.peerDependencies["@velarscript/web"], "^0.10.1");
  await runNpm(["run", "format:check"], component);
  await runNpm(["run", "check"], component);
  await runNpm(["test"], component);
  await runNpm(["run", "build"], component);
  await runNpm(["run", "verify"], component);
  const componentBrowser = await runNpm(["run", "test:browser", "--", "chromium"], component);
  assert.match(componentBrowser.stdout, /chromium :: "src\/demo\.browser\.test\.vel" :: "component preview"/u);
  assert.match(componentBrowser.stdout, /1 passed, 0 failed/u);
  process.stdout.write("Installed VelarScript browser-project acceptance passed\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function pack(workspace: string): Promise<string> {
  const result = await runNpm(["pack", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
  const values = JSON.parse(result.stdout) as Array<{ filename: string }>;
  assert.equal(values.length, 1);
  return values[0]!.filename;
}

async function runNpm(arguments_: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const npm = process.env.npm_execpath;
  return npm
    ? run(process.execPath, [npm, ...arguments_], cwd)
    : run(process.platform === "win32" ? "npm.cmd" : "npm", arguments_, cwd);
}

async function run(command: string, arguments_: readonly string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  const child = spawn(command, arguments_, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const code = await new Promise<number | null>((resolvePromise, reject) => {
    child.once("error", reject);
    child.once("exit", resolvePromise);
  });
  if (code !== 0) throw new Error(`${command} ${arguments_.join(" ")} failed (${code})\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}
