import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "packages", "cli", "src", "cli.ts");
const testRunner = join(root, "packages", "cli", "src", "test-runner.ts");
const configModule = join(root, "packages", "cli", "src", "config.ts");

interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

function runCommand(command: string, arguments_: readonly string[]): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => resolvePromise({ code, stdout, stderr, output: `${stdout}${stderr}` }));
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
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "Blind round two hardening" },
  }), "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source, "utf8");
  }
  return directory;
}

/**
 * The Node runner's per-test and settle bounds are not a CLI surface, so a
 * regression that needs a short one drives the runner from a spawned script.
 * A spawned process is also the only honest place to observe quiescence: the
 * node:test harness keeps its own work on the loop forever.
 */
async function runTestsWithLimits(
  directory: string,
  testTimeoutMs: number,
  settleTimeoutMs: number,
): Promise<CommandResult> {
  const script = join(directory, "run-tests.mjs");
  await writeFile(script, [
    `const { resolveVelarProject } = await import(${JSON.stringify(`file://${configModule}`)});`,
    `const { runTests } = await import(${JSON.stringify(`file://${testRunner}`)});`,
    `const config = await resolveVelarProject(${JSON.stringify(directory)});`,
    `process.exitCode = await runTests(config, null, {`,
    `  testTimeoutMs: ${testTimeoutMs},`,
    `  settleTimeoutMs: ${settleTimeoutMs},`,
    "});",
  ].join("\n"), "utf8");
  return runCommand(process.execPath, [script]);
}

// ─── Item 1: any unowned error during a test fails that test ────────────────
// Blind round two watched a browser test print `velar/storage requires a
// browser storage environment`, then `document.createElement API is
// unavailable`, and report `1 passed, 0 failed` with exit code 0 both times.
// The Node runner had taken the stance (ASY-D2 / WEB-N5 / BLD-D1); the browser
// runner had never been brought under it, because the reports arrive on the
// worker's host error channel rather than through the page.

test("[BLIND2-1] a browser test whose imported module fails on the host fails the run", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-blind2-browser-load-", {
    "app.vel": `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>
`.trimStart(),
    "main.vel": `
import {App} from "./app.vel"

export const heading = "Blind round two"

mount(<App />, "#app")
`.trimStart(),
    // The mounted entry is imported by the test, so its top-level mount runs in
    // the test process, where there is no DOM.
    "load.browser.test.vel": `
import {expect} from "velar/test"
import {heading} from "./main.vel"

test "importing the mounted entry":
    expect(heading).toBe("Blind round two")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory, "--browser", "chromium"]);
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /reported an unowned error while loading/u);
  assert.match(result.output, /document\.createElement API is unavailable/u);
  assert.match(result.output, /velar\/web-test/u);
  assert.match(result.stdout, /\n0 passed, 1 failed\n/u);
});

test("[BLIND2-1] a browser test that mounts in its own body fails the run", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-blind2-browser-body-", {
    "app.vel": `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>
`.trimStart(),
    "main.vel": `
import {App} from "./app.vel"

mount(<App />, "#app")
`.trimStart(),
    "body.browser.test.vel": `
import {expect} from "velar/test"
import {App} from "./app.vel"

test "mounting from the test body":
    mount(<App />, "#app")
    expect(1).toBe(1)
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory, "--browser", "chromium"]);
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /✗ chromium :: "src\/body\.browser\.test\.vel" :: "mounting from the test body"/u);
  assert.match(result.output, /document\.createElement API is unavailable/u);
  assert.match(result.output, /browser\.waitForText\(selector, text\)/u);
  assert.match(result.stdout, /\n0 passed, 1 failed\n/u);
});

test("[BLIND2-1] a browser test whose page throws fails the run", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-blind2-browser-page-", {
    "main.vel": `
export component App():
    state count = 0

    @mounted:
        throw Error("the page throws while mounting")

    return <button id="go">Count: {count}</button>

mount(<App />, "#app")
`.trimStart(),
    "page.browser.test.vel": `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "the page throws during mount":
    await browser.open("/")
    expect(await browser.text("#go")).toBe("Count: 0")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory, "--browser", "chromium"]);
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /✗ chromium :: "src\/page\.browser\.test\.vel" :: "the page throws during mount"/u);
  assert.match(result.output, /the page throws while mounting/u);
  assert.match(result.stdout, /\n0 passed, 1 failed\n/u);
});

test("[BLIND2-1] work a browser test leaves running fails the run instead of being dropped", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-blind2-browser-straggler-", {
    "main.vel": `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>

mount(<App />, "#app")
`.trimStart(),
    "straggler.browser.test.vel": `
import {expect} from "velar/test"

async def late():
    await Promise.sleep(1200ms)
    throw Error("a straggler started by the browser test")

test "starting work that outlives the test":
    async late()
    expect(1).toBe(1)
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory, "--browser", "chromium"]);
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /an unowned error was reported after the last browser test/u);
  assert.match(result.output, /a straggler started by the browser test/u);
  // The printed count is the verdict a human reads; it must agree with the code.
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

// The Node runner's own straggler window: a fixed 20 millisecond sleep let a
// failure that landed one turn later reach stderr with nobody counting it, and
// a failure that landed inside the window was charged to whichever later test
// happened to be running. Quiescence replaces the window.

test("[BLIND2-1] a late detached failure fails the test that started it", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-blind2-late-", {
    "main.vel": `
export def hello() -> string:
    return "hello"
`.trimStart(),
    "late.test.vel": `
import {expect} from "velar/test"

async def late():
    await Promise.sleep(300ms)
    throw Error("started by the first test")

test "the first test starts detached work":
    async late()
    expect(1).toBe(1)

test "the second test is innocent":
    await Promise.sleep(600ms)
    expect(2).toBe(2)
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /✗ "src\/late\.test\.vel" :: "the first test starts detached work"/u);
  assert.match(result.output, /started by the first test/u);
  assert.match(result.output, /✓ "src\/late\.test\.vel" :: "the second test is innocent"/u);
  assert.match(result.stdout, /\n1 passed, 1 failed\n/u);
});

test("[BLIND2-1] a compiled failure names the .vel source, not the runner's sandbox", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-blind2-sources-", {
    "main.vel": `
export def hello() -> string:
    return "hello"
`.trimStart(),
    "mapped.test.vel": `
import {expect} from "velar/test"

async def late():
    await Promise.sleep(50ms)
    throw Error("a mapped failure")

test "a detached failure carries a source location":
    async late()
    expect(1).toBe(1)
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "test", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /mapped\.test\.vel:5:\d+/u);
  assert.doesNotMatch(result.output, /\.velar[/\\]test-[^\s]*\.js/u);
});

test("[BLIND2-1] a test that never finishes is bounded and reported", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-blind2-hang-", {
    "main.vel": `
export def hello() -> string:
    return "hello"
`.trimStart(),
    "hang.test.vel": `
import {expect} from "velar/test"

test "this test never finishes":
    await Promise.sleep(120s)
    expect(1).toBe(1)
`.trimStart(),
  });
  const started = Date.now();
  const result = await runTestsWithLimits(directory, 500, 1_000);
  assert.equal(result.code, 1, result.output);
  assert.ok(Date.now() - started < 60_000, "a bounded run must not wait out the test's own sleep");
  assert.match(result.output, /✗ "src\/hang\.test\.vel" :: "this test never finishes"/u);
  assert.match(result.output, /did not finish within its 500 millisecond bound/u);
  assert.match(result.output, /work started during this run was still running 1000 milliseconds later/u);
});

test("[BLIND2-1] a passing suite still settles immediately", { timeout: 120_000 }, async () => {
  const directory = await coreProject("velar-blind2-clean-", {
    "main.vel": `
export def hello() -> string:
    return "hello"
`.trimStart(),
    "clean.test.vel": `
import {expect} from "velar/test"

test "a test that owns everything it starts":
    await Promise.sleep(10ms)
    expect(1).toBe(1)
`.trimStart(),
  });
  const started = Date.now();
  const result = await runTestsWithLimits(directory, 120_000, 30_000);
  assert.equal(result.code, 0, result.output);
  // Quiescence is observed, not waited out: a clean suite never reaches its
  // settle bound.
  assert.ok(Date.now() - started < 30_000, "quiescence must resolve well before the settle bound");
  assert.match(result.stdout, /\n1 passed, 0 failed\n/u);
});

// ─── Item 2: velar/web-test is the door a browser test knocks on ────────────

test("[BLIND2-2] DOM globals in a .browser.test.vel point at velar/web-test", async () => {
  const directory = await webProject("velar-blind2-guidance-", {
    "main.vel": `
export component App():
    state count = 0
    return <button id="go">Count: {count}</button>

mount(<App />, "#app")
`.trimStart(),
    "probe.browser.test.vel": `
import {expect} from "velar/test"

test "probing the driving surface":
    print(document)
    print(localStorage)
    expect(1).toBe(1)
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", join(directory, "src", "probe.browser.test.vel")]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /A browser test drives the running page, so 'document' is not available in its body/u);
  assert.match(result.output, /import \{browser\} from "velar\/web-test"/u);
  assert.match(result.output, /'localStorage' is not available in its body/u);
});

test("[BLIND2-2] a component still learns JSX, refs, and velar/browser for document", async () => {
  const directory = await webProject("velar-blind2-guidance-component-", {
    "main.vel": `
export component App():
    state count = 0
    print(document)
    return <button id="go">Count: {count}</button>

mount(<App />, "#app")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Use JSX, refs, and velar\/browser instead of the untyped document global/u);
  assert.doesNotMatch(result.output, /velar\/web-test/u);
});

test("[BLIND2-2] the skill brief carries a runnable browser-test recipe", async () => {
  const brief = await readFile(join(root, "docs", "ai-skill.md"), "utf8");
  const mirror = await readFile(join(root, "packages", "cli", "skill", "ai-skill.md"), "utf8");
  assert.equal(brief, mirror);
  assert.ok(brief.length > 0);
  assert.match(brief, /import \{browser, localStorage\} from "velar\/web-test"/u);
  assert.match(brief, /await browser\.open\("\/"\)/u);
  assert.match(brief, /await browser\.fill\("#title", "Vel"\)/u);
  assert.match(brief, /await browser\.click\("#add"\)/u);
  assert.match(brief, /await browser\.waitForText\("\[data-item\]", "Vel"\)/u);
  // D50 rule 98: the brief grows by cutting, never by raising the budget.
  assert.ok(brief.split("\n").length <= 750, "the skill brief stays inside its 750-line budget");
});

// ─── Item 3: velar/storage teaches the whole read ───────────────────────────

test("[BLIND2-3] the first storage diagnostic carries a working read", async () => {
  const directory = await webProject("velar-blind2-storage-", {
    "main.vel": `
import {storage} from "velar/storage"

const raw = storage.get("reading")
print(str(raw != null))
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /storage\.get\(key, Type\) validates what it reads and parses the stored JSON itself/u);
  assert.match(result.output, /type SavedItems = List<Item>/u);
  assert.match(result.output, /storage\.get\("items", SavedItems, \[\]\)/u);
  assert.match(result.output, /storage\.set\("items", items\)/u);
});

test("[BLIND2-3] a primitive spelling in a runtime-type position names the alias step", async () => {
  const directory = await webProject("velar-blind2-storage-primitive-", {
    "main.vel": `
import {storage} from "velar/storage"

const bad = storage.get("reading", null)
const worse = storage.get("reading", string)
print(str(bad != null and worse != null))
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Runtime parsing requires a VelarScript runtime type: pass a declared type, enum, or alias name/u);
  assert.match(result.output, /'string' names a type, not a value; declare an alias — 'type Saved = string'/u);
});

test("[BLIND2-3] the storage read the diagnostic recommends compiles", async () => {
  const directory = await webProject("velar-blind2-storage-recipe-", {
    "main.vel": `
import {storage} from "velar/storage"

type Item:
    title: string

type SavedItems = List<Item>

const items = storage.get("reading", SavedItems, [])
storage.set("reading", items)
print(str(items.size))
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 0, result.output);
});

// ─── Item 4: a readonly projection names the signature that accepts it ──────

test("[BLIND2-4] a refused component prop names the helper's parameter and element types", async () => {
  const directory = await webProject("velar-blind2-readonly-", {
    "main.vel": `
type Item:
    title: string

def visible(items: List<Item>) -> List<Item>:
    return items.filter(item => item.title != "")

export component ProjectList(items: List<Item>):
    const shown = computed(() => visible(items))
    return <ul>{shown().map(item => <li key={item.title}>{item.title}</li>)}</ul>

const empty: List<Item> = []

mount(<ProjectList items={empty} />, "#app")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Cannot assign readonly List<Item> to List<Item>/u);
  assert.match(result.output, /declare the receiving parameter as 'readonly List<Item>'/u);
  assert.match(result.output, /a List built from it is 'List<readonly Item>'/u);
});

test("[BLIND2-4] the signature the diagnostic recommends compiles", async () => {
  const directory = await webProject("velar-blind2-readonly-fixed-", {
    "main.vel": `
type Item:
    title: string

def visible(items: readonly List<Item>) -> List<readonly Item>:
    return items.filter(item => item.title != "")

export component ProjectList(items: List<Item>):
    const shown = computed(() => visible(items))
    return <ul>{shown().map(item => <li key={item.title}>{item.title}</li>)}</ul>

const empty: List<Item> = []

mount(<ProjectList items={empty} />, "#app")
`.trimStart(),
  });
  const result = await runCommand(process.execPath, [cli, "check", directory]);
  assert.equal(result.code, 0, result.output);
});
