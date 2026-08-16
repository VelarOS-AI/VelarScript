import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const root = resolve(new URL("..", import.meta.url).pathname);

function compile(source: string) {
  return compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
}

test("[D74] component prop data is mutable unless the author writes readonly", () => {
  const mutable = compile(`
type Task:
    title: string
    tags: List<string>

class Box:
    let label: string = "box"

type Carrier:
    box: Box

def retitle(task: Task):
    task.title = "helper"

component Editor(task: Task, carrier: Carrier):
    task.title = "component"
    task.tags.append("edited")
    retitle(task)
    carrier.box.label = "nested class"
    return <p>{task.title}</p>
`);

  assert.deepEqual(mutable.diagnostics, []);
  assert.match(mutable.code ?? "", /task\.get\(\)\.title = "component"/u);
  assert.match(mutable.code ?? "", /task\.get\(\)\.tags/u);

  const guarded = compile(`
type Task:
    title: string
    tags: List<string>

def retitle(task: Task):
    task.title = "helper"

component Guarded(task: readonly Task):
    task.title = "component"
    task.tags.append("edited")
    retitle(task)
    return <p>{task.title}</p>
`);

  assert.equal(guarded.diagnostics.length, 3, guarded.diagnostics.map((item) => item.message).join("\n"));
  const directWrites = guarded.diagnostics.filter((item) => /Cannot mutate prop 'task'/u.test(item.message));
  assert.equal(directWrites.length, 2, guarded.diagnostics.map((item) => item.message).join("\n"));
  assert.ok(directWrites.every((item) => /component's author explicitly declared it 'readonly'/u.test(item.message)));
  assert.ok(guarded.diagnostics.some((item) => /Cannot assign readonly Task to Task/u.test(item.message)));
});

test("[D74] readonly outside props keeps the Core data-view contract", () => {
  const result = compile(`
type Task:
    title: string

def overwrite(task: readonly Task):
    task.title = "blocked"
`);

  assert.deepEqual(result.diagnostics.map((item) => item.message), [
    "Cannot assign through readonly Task; it is a read-only view",
  ]);
});

test("[D74] prop writes and source-state writes publish through the same deep-reactive path", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-d74-mutable-props-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "D74 mutable props" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), `
type Task:
    title: string
    revision: number

state task: Task = {title: "initial", revision: 0}

def mutateFromStore():
    task.title = "store"
    task.revision += 1

component Editor(task: Task):
    def mutateFromProp():
        task.title = "prop"
        task.revision += 1

    return <section>
        <p data-child>{f"{task.title}:{task.revision}"}</p>
        <button type="button" data-prop on:click={mutateFromProp}>prop</button>
    </section>

component App:
    return <main>
        <Editor task={task} />
        <p data-parent>{f"{task.title}:{task.revision}"}</p>
        <button type="button" data-store on:click={mutateFromStore}>store</button>
    </main>

mount(<App />, "#app")
`.trimStart(), "utf8");
    await writeFile(join(directory, "src", "mutable-props.browser.test.vel"), `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "prop and store aliases publish the same object changes":
    await browser.open("/")
    expect(await browser.text("[data-child]")).toBe("initial:0")
    expect(await browser.text("[data-parent]")).toBe("initial:0")
    await browser.click("[data-prop]")
    expect(await browser.text("[data-child]")).toBe("prop:1")
    expect(await browser.text("[data-parent]")).toBe("prop:1")
    await browser.click("[data-store]")
    expect(await browser.text("[data-child]")).toBe("store:2")
    expect(await browser.text("[data-parent]")).toBe("store:2")
`.trimStart(), "utf8");

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
});

async function run(command: string, arguments_: readonly string[]): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { output += chunk; });
    child.stderr.on("data", (chunk: string) => { output += chunk; });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(output || `Command exited with ${String(code)}`));
    });
  });
}
