import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const FLOATING = "VEL4027";
const DETACHED_TYPE = "VEL4028";

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

test("a floating Promise expression statement is intercepted with both current spellings", () => {
  const result = compile(`
async def boom():
    throw Error("background failure")

boom()
print("after the call")
`.trimStart());
  assert.equal(result.diagnostics.length, 1, result.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(result.diagnostics[0]?.code, FLOATING);
  assert.equal(
    result.diagnostics[0]?.message,
    "This call returns Promise<null>; 'await boom()' to wait for it, or 'async boom()' to run it detached",
  );
});

test("member calls and Promise-carrying optionals and unions are intercepted too", () => {
  const member = compile(`
type Client:
    push: () -> Promise<null>

def use(client: Client):
    client.push()
`.trimStart());
  assert.equal(member.diagnostics.length, 1, member.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(member.diagnostics[0]?.code, FLOATING);
  assert.match(member.diagnostics[0]?.message ?? "", /'await client\.push\(\)' to wait for it, or 'async client\.push\(\)'/u);

  const union = compile(`
async def tick():
    pass

def pick(flag: bool) -> Promise<null> | null:
    return flag ? tick() : null

pick(true)
`.trimStart());
  assert.equal(union.diagnostics.length, 1, union.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(union.diagnostics[0]?.code, FLOATING);

  const held = compile(`
async def tick():
    pass

const pending: Promise<null>? = tick()
pending
`.trimStart());
  assert.equal(held.diagnostics.length, 1, held.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(held.diagnostics[0]?.code, FLOATING);
});

test("'await boom()' and 'async boom()' are both legal, at module scope and inside bodies", () => {
  const result = compile(`
async def boom():
    pass

await boom()
async boom()

def fire():
    async boom()

async def sequence():
    await boom()
    async boom()
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // The detached Promise takes the same normalization every other Promise
  // consumer applies, so a foreign thenable cannot reach Promise.prototype.then.
  assert.ok(result.code?.includes("__velarDetachedTask(__velarNormalizePromiseValue(boom()))"));
});

test("a detached task must resolve null: the result would be lost", () => {
  const result = compile(`
type User:
    id: string

async def loadUser(id: string) -> User:
    return {id: id}

async loadUser("u1")
`.trimStart());
  assert.equal(result.diagnostics.length, 1, result.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(result.diagnostics[0]?.code, DETACHED_TYPE);
  assert.equal(result.diagnostics[0]?.message, "The result would be lost; await it, or discard it explicitly in an async def");
});

test("a non-Promise expression cannot detach", () => {
  const result = compile(`
def plain():
    pass

async plain()
`.trimStart());
  assert.equal(result.diagnostics.length, 1, result.diagnostics.map((item) => item.message).join("\n"));
  assert.equal(result.diagnostics[0]?.code, DETACHED_TYPE);
  assert.equal(result.diagnostics[0]?.message, "'async' runs a Promise<null> expression detached; this expression is null");
});

test("the async statement is statement-position only", () => {
  const result = compile(`
async def boom():
    pass

const held = async boom()
`.trimStart());
  assert.ok(result.diagnostics.length > 0);
  assert.ok(result.diagnostics.some((item) => item.code.startsWith("VEL2")));
});

test("a bare 'async' names all three continuations", () => {
  const result = compile("async\n");
  assert.equal(result.diagnostics[0]?.code, "VEL2001");
  assert.equal(result.diagnostics[0]?.message, "'async' must be followed by 'def', 'for', or a call to run detached");
});

test("Node: a detached failure is reported on stderr and the process does not die", () => {
  const result = compile(`
async def boom():
    throw Error("detached failure")

async boom()
print("after the call")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "after the call\n");
  assert.match(String(execution.stderr), /Detached async task failed: Error: detached failure/u);
});

test("Node: a foreign non-Error rejection is normalized to Error before the report", () => {
  const result = compile(`
async def tick():
    pass

async tick()
print("still running")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  // Drive the compiler-owned observer with a hostile foreign rejection value:
  // a bare string rejection is what an untyped JavaScript boundary produces.
  const execution = executeModule(`${result.code ?? ""}\n__velarDetachedTask(Promise.reject("raw failure"));\n`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "still running\n");
  // The report carries a real Error normalized from the raw string.
  assert.match(String(execution.stderr), /Detached async task failed: Error: raw failure/u);
});

test("Node: a resolved detached task reports nothing", () => {
  const result = compile(`
async def tick():
    pass

async tick()
print("done")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "done\n");
  assert.equal(String(execution.stderr), "");
});

test("Web output routes a detached failure through the velar/app chain with the detached phase", () => {
  // The browser report path belongs to modules that actually emit the Web
  // runtime: `state` here is what makes this Web output rather than a plain
  // Core module that merely happens to be compiled with the extension loaded.
  const result = compile(`
state ready = true

async def boom():
    throw Error("web detached failure")

async boom()
print("web module continues")
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.ok(code.includes("__velarDetachedTask(__velarNormalizePromiseValue(boom()))"));
  assert.ok(code.includes('phase: "detached", detail: "", unhandled: true'));

  // Execution-level: the report reaches the application runtime the module
  // itself installed -- a foreign object at that key is refused ownership --
  // and the module keeps running. The handler is registered synchronously,
  // before the rejection microtask drains.
  const handler = [
    "const runtime = globalThis[Symbol.for(\"velar.runtime.v1\")];",
    "runtime.errorHandlers.add((report) => {",
    "  console.log(\"REPORT\", report.phase, report.error instanceof Error, report.error.message);",
    "});",
  ].join("\n");
  const execution = executeModule(`${code}\n${handler}`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "web module continues\nREPORT detached true web detached failure\n");
  assert.equal(String(execution.stderr), "");
});

test("Web output without an error handler keeps a detached failure loud and the host process alive", () => {
  const result = compile(`
state ready = true

async def boom():
    throw Error("pre-runtime failure")

async boom()
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  // With no onError handler installed the report escalates. In a browser that
  // is the host error event; in a non-browser host the same microtask throw
  // would end the whole process (under `velar test`, the whole suite), so the
  // runtime traces the failure to the console and parks it for the next
  // tick() instead: loud on stderr, and the process survives.
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.match(String(execution.stderr), /Unhandled VelarScript error report/u);
  assert.match(String(execution.stderr), /pre-runtime failure/u);
});

test(
  "browser: a detached failure reports through onError with the detached phase and the page stays alive",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "velar-hardening-detached-"));
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
          web: { title: "Detached hardening" },
        }),
        "utf8",
      );
      await writeFile(join(directory, "src", "main.vel"), browserApplication, "utf8");
      await writeFile(join(directory, "src", "detached.browser.test.vel"), browserTests, "utf8");

      const output = await run(process.execPath, [
        join(root, "packages", "cli", "src", "cli.ts"),
        "test",
        directory,
        "--browser",
        "chromium",
      ]);
      assert.match(output, /2 passed, 0 failed/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const browserApplication = `
import {onError} from "velar/app"

state detachedReport = "none"
state clicks = 0

def capture(phase: string, message: string):
    detachedReport = phase + ":" + message

onError(report => capture(report.phase, report.error.message))

async def boom():
    throw Error("detached boom")

def fire():
    async boom()

def bump():
    clicks += 1

component App:
    return <main>
        <button data-fire on:click={fire}>Fire</button>
        <button data-bump on:click={bump}>Bump</button>
        <p data-detached>{detachedReport}</p>
        <p data-clicks>{clicks}</p>
    </main>

mount(<App />, "#app")
`.trimStart();

const browserTests = `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "detached failure reports with the detached phase":
    await browser.open("/")
    expect(await browser.text("[data-detached]")).toBe("none")
    await browser.click("[data-fire]")
    await browser.waitForText("[data-detached]", "detached:detached boom")

test "the page survives a detached failure":
    await browser.open("/")
    await browser.click("[data-fire]")
    await browser.waitForText("[data-detached]", "detached:detached boom")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-clicks]", "1")
`.trimStart();

async function run(
  command: string,
  arguments_: readonly string[],
): Promise<string> {
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
      else
        rejectPromise(
          new Error(output || `Command exited with ${String(code)}`),
        );
    });
  });
}
