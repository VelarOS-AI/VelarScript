import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { repositoryRoot } from "./repository-root.ts";

const root = repositoryRoot;

function runCommand(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
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

test("[D68-176] browser.box and browser.style read live Chromium layout", { timeout: 180_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-d68-browser-geometry-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "D68 browser geometry" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), `
const geometryLook = look:
    display = "grid"
    width = 120px
    height = 40px
    gap = 16px

component App:
    return <main data-geometry look={geometryLook}><span>a</span><span>b</span></main>

mount(<App />, "#app")
`.trimStart(), "utf8");
    await writeFile(join(directory, "src", "geometry.browser.test.vel"), `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "the declared layout reaches geometry and computed style":
    await browser.open("/")
    const area = await browser.box("[data-geometry]")
    expect(area.x).toBe(area.left)
    expect(area.y).toBe(area.top)
    expect(area.width).toBe(120)
    expect(area.height).toBe(40)
    expect(area.right - area.left).toBe(area.width)
    expect(area.bottom - area.top).toBe(area.height)
    expect(await browser.style("[data-geometry]", "gap")).toBe("16px")
`.trimStart(), "utf8");

    const output = await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
    assert.match(output, /chromium :: "src\/geometry\.browser\.test\.vel" :: "the declared layout reaches geometry and computed style"/u);
    assert.match(output, /1 passed, 0 failed/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
