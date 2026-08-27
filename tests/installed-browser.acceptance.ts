import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { velarWorkspacePackageNames } from "../scripts/velar-packages.mjs";
import { parseNpmPackResult } from "../scripts/npm-pack-result.mjs";
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
  // D90 R3(a): code-unit order, the same order the bare `.sort()` above gives,
  // so the probe roster does not reorder with the machine's `LC_ALL`.
  .sort((left, right) => left.specifier < right.specifier ? -1 : left.specifier > right.specifier ? 1 : 0);

try {
  /**
   * The revision of Playwright this checkout is tested against, read from the
   * one place that decides it. The packed CLI declares a caret range, so a
   * consumer install resolves whatever the registry's newest matching release
   * is on the day it runs, while the only browser binary on the machine is the
   * one provisioned from this lockfile — CI keys its Playwright cache on this
   * file's hash. The install below also passes `--ignore-scripts`, so the
   * consumer never downloads a browser of its own to fall back on. The day the
   * registry's newest match moves past the lockfile those two stop being the
   * same revision and this gate goes red on a push that changed nothing, so the
   * consumer is pinned to the toolchain's revision. Derived, never written down
   * a second time.
   */
  const toolchainPlaywright = await lockedVersion("playwright");
  // A-024: derive the packed set from workspace topology. The 1x1 gate installs
  // it once to obtain the published CLI, then once into the representative
  // generated application whose browser path it proves.
  const tarballs: string[] = [];
  for (const name of await velarWorkspacePackageNames(root)) tarballs.push(join(directory, await pack(name)));
  /** Every packed tarball, as one `npm install` takes them. */
  const install = (extra: readonly string[], cwd: string) =>
    runNpm([
      "install",
      ...extra,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `playwright@${toolchainPlaywright}`,
      ...tarballs,
    ], cwd);
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
  // Asked of the installed tree rather than of the install command: the pin is
  // only worth anything if the CLI the application runs resolves to it, and a
  // range the pin no longer satisfies would quietly nest a second copy the CLI
  // would load instead.
  const applicationCli = createRequire(join(application, "node_modules", "@velarscript", "cli", "dist", "cli.js"));
  const resolvedPlaywright = JSON.parse(await readFile(applicationCli.resolve("playwright/package.json"), "utf8")) as { version?: unknown };
  assert.equal(
    resolvedPlaywright.version,
    toolchainPlaywright,
    "the installed CLI must drive the Playwright revision this checkout has a browser for",
  );
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

  process.stdout.write("Installed VelarScript 1x1 Chromium acceptance passed\n");
} finally {
  await rm(directory, { recursive: true, force: true });
}

/** The version `npm ci` installs for a root dependency of this checkout. */
async function lockedVersion(name: string): Promise<string> {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { version?: unknown } | undefined>;
  };
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  assert.ok(typeof version === "string" && version.length > 0, `package-lock.json resolves no version for ${name}`);
  return version;
}

async function pack(workspace: string): Promise<string> {
  const result = await runNpm(["pack", "--workspace", workspace, "--pack-destination", directory, "--json"], root);
  return parseNpmPackResult(result.stdout, workspace).filename;
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
