import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

// D57 rules 137 and 138 — the two published dead ends.
//
// Rule 137 retired `velar/fs.Blob` and `velar/fs.readBlob`: the class had no
// fields, getters, methods, or text form, and no API anywhere accepted the
// value, so a `Blob` could only be held. Rule 138 put `velar/web-test` behind
// the file name the browser runner actually looks at, because the module only
// has a runtime under `velar test --browser` and importing it anywhere else
// compiled a call that was certain to fail.
//
// Both probes run the real CLI, which is the level the ledger's evidence was
// taken at: a `velar check` that used to pass.

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "packages", "cli", "src", "cli.ts");

interface CommandResult {
  readonly code: number | null;
  readonly output: string;
}

function runCommand(command: string, arguments_: readonly string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ code, output }));
  });
}

async function coreProject(prefix: string, modules: Readonly<Record<string, string>>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
  }), "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source, "utf8");
  }
  return directory;
}

async function webProject(prefix: string, modules: Readonly<Record<string, string>>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "public"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
  }), "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source, "utf8");
  }
  return directory;
}

const WEB_COMPONENT = `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>
`.trimStart();

const WEB_APPLICATION = `${WEB_COMPONENT}
@main: mount(<App />, "#app")
`.trimStart();

// ─── Rule 137: velar/fs publishes no Blob and no readBlob ───────────────────

test("[D57-137] velar/fs no longer publishes the Blob dead end", async () => {
  const directory = await coreProject("velar-d57-blob-", {
    "main.vel": `
import {Blob, readBlob, readText} from "velar/fs"

print(await readText("velar.json"))
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Module 'velar\/fs' has no export named 'Blob'/u);
  assert.match(result.output, /Module 'velar\/fs' has no export named 'readBlob'/u);
});

test("[D57-137] the rest of velar/fs is untouched by the retirement", async () => {
  const directory = await coreProject("velar-d57-fs-intact-", {
    "main.vel": `
import {appendText, canonical, copyFile, createText, exists, info, list, makeDirectory, move, readText, removeFile, replaceTextIfMatches, watchFiles, writeText} from "velar/fs"

async def touch(path: string) -> bool:
    await writeText(path, "one")
    await appendText(path, " two")
    await createText(path + ".new", "fresh")
    await makeDirectory(path + ".dir")
    await copyFile(path, path + ".copy")
    await move(path + ".copy", path + ".moved")
    await replaceTextIfMatches(path, "one two", "three")
    print(await canonical(path))
    print(str((await info(path))?.kind))
    print(str((await list(".")).size))
    print(await readText(path))
    using watcher = await watchFiles(path)
    print(str((await watcher.next())?.rescan))
    await removeFile(path)
    return await exists(path)

print(str(await touch("note.txt")))
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 0, result.output);
});

// ─── Rule 138: velar/web-test is refused outside a browser test ─────────────

test("[D57-138] a plain Web module cannot import velar/web-test", async () => {
  const directory = await webProject("velar-d57-web-test-module-", {
    "main.vel": `
import {peek} from "./probe.vel"

${WEB_APPLICATION}
print(await peek())
`.trimStart(),
    "probe.vel": `
import {browser} from "velar/web-test"

export async def peek() -> string:
    return await browser.text("#x")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /error VEL5062/u);
  assert.match(result.output, /only has a runtime under 'velar test --browser'/u);
  assert.match(result.output, /import it from a '\*\.browser\.test\.vel' module/u);
  // D51 rule 109: the refusal lands on the import, not on the eventual call.
  assert.match(result.output, /probe\.vel:1:23/u);
});

test("[D57-138] a plain .test.vel cannot import velar/web-test either", async () => {
  const directory = await webProject("velar-d57-web-test-core-test-", {
    "main.vel": WEB_APPLICATION,
    "main.test.vel": `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "reaching for the page from a Core test":
    expect(await browser.text("#go")).toBe("Count: 0")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /main\.test\.vel:2:23 error VEL5062/u);
});

test("[D57-138] the JavaScript bridge and a re-export are the same import", async () => {
  const bridge = await webProject("velar-d57-web-test-bridge-", {
    "main.vel": `
import js {browser} from "velar/web-test"

${WEB_COMPONENT}
@main:
    print(str(browser != null))
    mount(<App />, "#app")
`.trimStart(),
  });
  const bridgeResult = await runCommand(process.execPath, [cli, "check", bridge]);
  assert.equal(bridgeResult.code, 1, bridgeResult.output);
  assert.match(bridgeResult.output, /error VEL5062/u);

  const barrel = await webProject("velar-d57-web-test-barrel-", {
    "main.vel": `
import {browser} from "./barrel.vel"

${WEB_COMPONENT}
@main:
    print(await browser.text("#go"))
    mount(<App />, "#app")
`.trimStart(),
    "barrel.vel": `export {browser} from "velar/web-test"\n`,
  });
  const barrelResult = await runCommand(process.execPath, [cli, "check", barrel]);
  assert.equal(barrelResult.code, 1, barrelResult.output);
  assert.match(barrelResult.output, /barrel\.vel:1:23 error VEL5062/u);
});

test("[D57-138] a .browser.test.vel still imports velar/web-test cleanly", async () => {
  const directory = await webProject("velar-d57-web-test-allowed-", {
    "main.vel": WEB_APPLICATION,
    "page.browser.test.vel": `
import {expect} from "velar/test"
import {browser, localStorage, network, sessionStorage} from "velar/web-test"

test "driving the page from the file the runner looks in":
    await browser.open("/")
    await localStorage.clear()
    await sessionStorage.clear()
    await network.clear()
    expect(await browser.text("#go")).toBe("Count: 0")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 0, result.output);
});
