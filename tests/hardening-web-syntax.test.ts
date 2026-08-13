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
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

test("#9 accepts an opening-indented layout string in a JSX child", () => {
  const result = compile(`
component Probe:
    return <p>{"
        plain content
    "}</p>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /plain content/u);
});

test("#9 keeps ordinary quote characters inside a JSX child layout string", () => {
  const result = compile(`
component Probe:
    return <p>{"
        3" of rain
    "}</p>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /3\\" of rain/u);
});

test("#10 preserves backslashes in static JSX attributes", () => {
  const result = compile(String.raw`
component Probe:
    return <input pattern="\d{3}" data-path="C:\Users\foo" />
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /"pattern",\s*"\\\\d\{3\}"/u);
  assert.match(result.code ?? "", /"data-path",\s*"C:\\\\Users\\\\foo"/u);
});

test("#32 accepts a layout string as a Look property expression", () => {
  const result = compile(`
const cardLook = look:
    gridTemplateAreas = "
        head head
        body body
    "

component Probe:
    return <main look={cardLook}>grid</main>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /head head\\nbody body/u);
  assert.match(result.css ?? "", /grid-template-areas/u);
});

test("#39 accepts an opening-indented layout string in a JSX attribute interpolation", () => {
  const result = compile(`
component Probe:
    const title = "layout title"
    return <p data-title={f"
        {title}
    "}>body</p>
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /"data-title"/u);
  assert.match(result.code ?? "", /layout title/u);
});

test("nested JSX keeps diagnostics and semantic expressions on absolute source spans", () => {
  const source = `
type Message:
    text: string

def preview(message: Message?) -> string:
    return message?.text ?? ""

component Probe(messages: Map<string, Message>):
    return <main>{[1].map(item => <p>{preview(messages.get("id"))}</p>)}</main>
`.trimStart();
  const result = compile(source);
  const argument = 'messages.get("id")';
  const start = source.indexOf(argument);
  const diagnostic = result.diagnostics.find((item) => item.message === "Cannot assign readonly Message? to Message?");

  assert.deepEqual(diagnostic?.span, { start, end: start + argument.length });
  assert.ok(result.semanticIndex.expressions.some((expression) => expression.span.start === start
    && expression.span.end === start + argument.length
    && expression.type === "readonly Message?"));
});

test("Web syntax hardening regressions render in Chromium", { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-hardening-web-syntax-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Web syntax hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), browserApplication, "utf8");
    await writeFile(join(directory, "src", "hardening.browser.test.vel"), browserTests, "utf8");

    const output = await run(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"),
      "test",
      directory,
      "--browser",
      "chromium",
    ]);
    assert.match(output, /5 passed, 0 failed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const browserApplication = String.raw`
const cardLook = look:
    gridTemplateAreas = "
        head head
        body body
    "

component App:
    const title = "layout title"
    return <main>
        <p data-child>{"
            plain content
        "}</p>
        <p data-quoted>{"
            3" of rain
        "}</p>
        <p data-title={f"
            {title}
        "}>body</p>
        <input data-static pattern="\d{3}" data-path="C:\Users\foo" />
        <section data-look look={cardLook}>grid</section>
    </main>

mount(<App />, "#app")
`.trimStart();

const browserTests = String.raw`
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "jsx child layout string":
    await browser.open("/")
    expect(await browser.text("[data-child]")).toBe("plain content")

test "jsx child layout string with quote content":
    await browser.open("/")
    expect(await browser.text("[data-quoted]")).toBe("3\u{22} of rain")

test "jsx attribute layout string":
    await browser.open("/")
    expect(await browser.attribute("[data-title]", "data-title")).toBe("layout title")

test "static attribute backslashes":
    await browser.open("/")
    expect(await browser.attribute("[data-static]", "pattern")).toBe("\\d{3}")
    expect(await browser.attribute("[data-static]", "data-path")).toBe("C:\\Users\\foo")

test "look layout string":
    await browser.open("/")
    expect(await browser.attribute("[data-look]", "style")).toBe("--velar-look-base-grid-template-areas: head head\nbody body;")
    expect(await browser.text("[data-look]")).toBe("grid")
`.trimStart();

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
