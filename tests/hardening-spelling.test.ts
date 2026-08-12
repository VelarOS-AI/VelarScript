import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const root = resolve(new URL("..", import.meta.url).pathname);

function compile(source: string) {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

test("[D28 4] 'else:' inside match receives recovered guidance to 'case _:'", () => {
  const single = compileCore(`
def label(value: string) -> string:
    match value:
        case "known":
            return "known"
        else:
            return "other"
`.trimStart());
  assert.equal(single.code, null);
  // One diagnostic per site, and the recovery keeps analyzing: the else body
  // stands in as the wildcard case, so the non-null return contract is still
  // satisfied and no cascade follows.
  assert.deepEqual(single.diagnostics.map((item) => item.code), ["VEL2035"]);
  assert.equal(
    single.diagnostics[0]?.message,
    "Use 'case _:' for the fallback case; 'match' has no 'else' clause",
  );

  const two = compileCore(`
def first(value: string) -> string:
    match value:
        case "a":
            return "a"
        else:
            return "rest"

def second(value: number) -> string:
    match value:
        case 1:
            return "one"
        else:
            return "many"
`.trimStart());
  assert.equal(two.code, null);
  assert.deepEqual(two.diagnostics.map((item) => item.code), ["VEL2035", "VEL2035"]);
});

test("[D28 4] 'case _:' is the fallback and participates in required-return analysis", () => {
  const wildcard = compileCore(`
enum Status:
    open
    closed

def label(status: Status) -> string:
    match status:
        case Status.open:
            return "open"
        case _:
            return "other"

print(label(Status.open))
print(label(Status.closed))
`.trimStart());
  assert.deepEqual(wildcard.diagnostics, []);
  const execution = executeModule(wildcard.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "open\nother\n");
});

test("[D28 4] if/else and Look condition blocks keep their else spelling", () => {
  const ordinary = compileCore(`
const score = 91
if score >= 90:
    print("A")
else if score >= 80:
    print("B")
else:
    print("C")
`.trimStart());
  assert.deepEqual(ordinary.diagnostics, []);

  const look = compile(`
const dark = false
const panelLook = look:
    if dark:
        background = "black"
    else:
        background = "white"

component App:
    return <div look={panelLook}>panel</div>

mount(<App />, "#app")
`.trimStart());
  assert.deepEqual(look.diagnostics, []);
});

test("[D28 7] self-negating assignment is ordinary and 'invert' is an ordinary identifier", () => {
  const flip = compileCore(`
let active = false
active = not active
print(active)

def invert(values: List<bool>) -> List<bool>:
    return values.map(value => not value)

const invertible = invert([true, false])
print(invertible[0])
print(invertible[1])
`.trimStart());
  assert.deepEqual(flip.diagnostics, []);
  const execution = executeModule(flip.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\nfalse\ntrue\n");

  // The formatter no longer treats 'invert' as a statement keyword: a call
  // keeps its call spelling, and the flip formats as ordinary assignment.
  assert.equal(formatSource("print(invert([true]))\n"), "print(invert([true]))\n");
  assert.equal(formatSource("active=not   active\n"), "active = not active\n");
});

test(
  "[D28 7] x = not x publishes state, deep-field, and List-index updates in Chromium",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "velar-hardening-spelling-"));
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
      await symlink(
        join(root, "packages", "web"),
        join(directory, "node_modules", "@velarscript", "web"),
        "dir",
      );
      await writeFile(
        join(directory, "velar.json"),
        JSON.stringify({
          formatVersion: 2,
          entry: "src/main.vel",
          outDir: "dist",
          extensions: ["@velarscript/web"],
          web: { title: "Spelling hardening" },
        }),
        "utf8",
      );
      await writeFile(join(directory, "src", "main.vel"), browserApplication, "utf8");
      await writeFile(join(directory, "src", "spelling.browser.test.vel"), browserTests, "utf8");

      const output = await run(process.execPath, [
        join(root, "packages", "cli", "src", "cli.ts"),
        "test",
        directory,
        "--browser",
        "chromium",
      ]);
      assert.match(output, /1 passed, 0 failed/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const browserApplication = `
type Panel:
    visible: bool

state busy = false
state panel: Panel = {visible: false}
state flags: List<bool> = [false]

component App:
    def toggleBusy() -> null:
        busy = not busy

    def togglePanel() -> null:
        panel.visible = not panel.visible

    def toggleFlag() -> null:
        flags[0] = not flags[0]

    def localFlip() -> string:
        let value = false
        value = not value
        return value ? "local-on" : "local-off"

    return <main>
        <button type="button" data-toggle-busy on:click={toggleBusy}>busy</button>
        <button type="button" data-toggle-panel on:click={togglePanel}>panel</button>
        <button type="button" data-toggle-flag on:click={toggleFlag}>flag</button>
        <output data-busy>{busy ? "on" : "off"}</output>
        <output data-panel>{panel.visible ? "on" : "off"}</output>
        <output data-flag>{flags[0] ? "on" : "off"}</output>
        <output data-local>{localFlip()}</output>
    </main>

mount(<App />, "#app")
`.trimStart();

const browserTests = `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

async def test_self_negation_publishes_updates() -> null:
    await browser.open("/")
    expect(await browser.text("[data-busy]")).toBe("off")
    expect(await browser.text("[data-panel]")).toBe("off")
    expect(await browser.text("[data-flag]")).toBe("off")
    expect(await browser.text("[data-local]")).toBe("local-on")
    await browser.click("[data-toggle-busy]")
    await browser.waitForText("[data-busy]", "on")
    await browser.click("[data-toggle-panel]")
    await browser.waitForText("[data-panel]", "on")
    await browser.click("[data-toggle-flag]")
    await browser.waitForText("[data-flag]", "on")
    await browser.click("[data-toggle-busy]")
    await browser.waitForText("[data-busy]", "off")
`.trimStart();

async function run(command: string, arguments_: readonly string[]): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}
