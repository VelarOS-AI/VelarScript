import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveVelarProject } from "../packages/cli/src/config.ts";
import { applyProjectMechanicalFixes } from "../packages/cli/src/mechanical-fixer.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

async function temporaryRoot(name: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${name}-`));
}

async function writeTree(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, "utf8");
  }
}

function runCli(cwd: string, arguments_: readonly string[], environment: Readonly<Record<string, string>> = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    env: { ...process.env, ...environment },
  });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

/** An installed VelarScript package the project imports by name. */
function velarPackageManifest(name: string): string {
  return `${JSON.stringify({
    name,
    version: "1.0.0",
    velar: {
      entry: "src/index.vel",
      targets: ["core", "node", "web", "desktop"],
      requires: { capabilities: [] },
    },
  }, null, 2)}\n`;
}

async function fixProject(root: string) {
  const config = await resolveVelarProject(root);
  return applyProjectMechanicalFixes(config, (path) => relative(root, path) || path);
}

test("[CLI-x1] a fix inside an f-string interpolation lands on the interpolation, not on line 1", async () => {
  const root = await temporaryRoot("velar-fix-interpolation");
  try {
    const banner = 'const banner = "hello world"\n';
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "src/main.vel": `${banner}\nexport def report(missing: string?) -> string:\n    return f"{missing === null}{banner}"\n\nprint(report(null))\n`,
    });

    const report = await fixProject(root);
    const source = await readFile(join(root, "src", "main.vel"), "utf8");
    // The rewrite the diagnostic named, and nothing else: the first line still
    // holds the exact bytes the author wrote.
    assert.equal(source.slice(0, banner.length), banner);
    assert.match(source, /return f"\{missing == null\}\{banner\}"/u);
    assert.deepEqual(report.changes, ["src/main.vel:4:23 fixed VEL1005: Use VelarScript strict equality '=='"]);
    // A fix reported at an offset it did not rewrite would be re-reported on
    // every pass until the cap; one pass to fix and one to confirm is the whole
    // run.
    assert.equal(report.passes, 2);
    assert.deepEqual(report.remainingDiagnostics, []);
    assert.deepEqual(report.writeFailures, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x12] velar fix leaves installed package sources under node_modules alone", async () => {
  const root = await temporaryRoot("velar-fix-node-modules");
  try {
    const dependency = "export def twice(a: int) -> int:\n    if a === 1:\n        return 2\n    return a * 2\n";
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "src/main.vel": 'import {twice} from "@acme/lib"\n\nif twice(2) === 4:\n    print("ok")\n',
      "node_modules/@acme/lib/package.json": velarPackageManifest("@acme/lib"),
      "node_modules/@acme/lib/src/index.vel": dependency,
    });
    const installed = join(root, "node_modules", "@acme", "lib", "src", "index.vel");

    const report = await fixProject(root);

    // The installed tree is byte-identical: an edit here is invisible to git and
    // destroyed by the next `npm ci`.
    assert.equal(await readFile(installed, "utf8"), dependency);
    assert.equal(report.changedFiles.includes(installed), false);
    assert.deepEqual(report.changedFiles, [join(root, "src", "main.vel")]);
    assert.equal(report.changes.some((line) => line.includes("node_modules")), false);
    // The author's own module is still rewritten on the ordinary terms.
    assert.match(await readFile(join(root, "src", "main.vel"), "utf8"), /if twice\(2\) == 4:/u);
    // The dependency's diagnostics are not silently dropped — they reach the
    // author on the same channel `velar check` reports them on.
    assert.equal(report.remainingDiagnostics.some((line) => line.includes("VEL1005")), true);

    const executed = runCli(root, ["fix"]);
    assert.equal(executed.stdout.includes("node_modules"), false);
    assert.equal(await readFile(installed, "utf8"), dependency);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x19] velar fix keeps an edit that landed during the pass and reports the conflict", async () => {
  const root = await temporaryRoot("velar-fix-concurrent-edit");
  try {
    const saved = 'let a = 1\nif a === 1:\n    print("one")\n// saved by the editor mid-run\n';
    await writeTree(root, {
      "velar.json": `${JSON.stringify({
        formatVersion: 2,
        entry: "src/main.vel",
        outDir: "dist",
        extensions: ["velar-fix-race"],
      })}\n`,
      "src/main.vel": 'let a = 1\nif a === 1:\n    print("one")\n',
      "node_modules/velar-fix-race/package.json": `${JSON.stringify({
        name: "velar-fix-race",
        version: "1.0.0",
        type: "module",
        exports: { "./compiler": "./compiler.js" },
        velar: { extension: { kind: "language", apiVersion: "1.0" } },
      })}\n`,
      // The lexer consults every extension scanner while it tokenizes, which is
      // strictly after the driver read the file and strictly before `velar fix`
      // writes it — exactly the window an editor save lands in.
      "node_modules/velar-fix-race/compiler.js": [
        'import { writeFileSync } from "node:fs";',
        "let done = false;",
        "export const velarCompilerExtension = {",
        '  id: "velar-fix-race",',
        '  contract: { protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: {} },',
        "  lexical: {",
        "    scan() {",
        "      if (!done && process.env.VELAR_FIX_RACE_TARGET) {",
        "        done = true;",
        `        writeFileSync(process.env.VELAR_FIX_RACE_TARGET, ${JSON.stringify(saved)}, "utf8");`,
        "      }",
        "      return null;",
        "    },",
        "  },",
        "};",
        "",
      ].join("\n"),
    });
    const target = join(root, "src", "main.vel");

    const executed = runCli(root, ["fix"], { VELAR_FIX_RACE_TARGET: target });

    assert.equal(executed.status, 1);
    assert.match(
      executed.stderr,
      /velar fix: could not write src\/main\.vel: the file changed on disk during this fix pass; nothing was written/u,
    );
    assert.match(executed.stdout, /1 file could not be written/u);
    // The save survives verbatim: the stale snapshot never reaches the disk.
    assert.equal(await readFile(target, "utf8"), saved);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x19] the atomic replacement keeps the module's mode and writes through a symlink", async () => {
  const root = await temporaryRoot("velar-fix-atomic-replace");
  try {
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "shared/module.vel": "export def one() -> number:\n    let a = 1\n    if a === 1:\n        return 1\n    return 0\n",
      "src/main.vel": 'import {one} from "./linked.vel"\n\nprint(one())\n',
    });
    const linked = join(root, "src", "linked.vel");
    await symlink(join(root, "shared", "module.vel"), linked);
    await chmod(join(root, "shared", "module.vel"), 0o600);

    const report = await fixProject(root);

    assert.deepEqual(report.writeFailures, []);
    assert.equal(report.changes.length, 1);
    // A rename replaces the name; the link still names the file it named before
    // and the rewrite landed in that file.
    assert.equal((await lstat(linked)).isSymbolicLink(), true);
    assert.match(await readFile(join(root, "shared", "module.vel"), "utf8"), /if a == 1:/u);
    assert.equal((await stat(join(root, "shared", "module.vel"))).mode & 0o777, 0o600);
    // The temporary the replacement went through is gone.
    assert.deepEqual((await readdir(join(root, "shared"))).sort(), ["module.vel"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x12] velar fix leaves a module symlinked into an installed package alone", async () => {
  const root = await temporaryRoot("velar-fix-linked-dependency");
  try {
    const dependency = "export def twice(a: int) -> int:\n    if a === 1:\n        return 2\n    return a * 2\n";
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "src/main.vel": 'import {twice} from "./lib.vel"\n\nprint(twice(2))\n',
      "node_modules/@acme/lib/package.json": velarPackageManifest("@acme/lib"),
      "node_modules/@acme/lib/src/index.vel": dependency,
    });
    const installed = join(root, "node_modules", "@acme", "lib", "src", "index.vel");
    const linked = join(root, "src", "lib.vel");
    await symlink(installed, linked);

    const report = await fixProject(root);

    // The module's own path clears every containment test — it is `src/lib.vel`,
    // inside the project and outside `node_modules` — and the write would still
    // have landed in the installed package, because it follows the link.
    assert.equal(await readFile(installed, "utf8"), dependency);
    assert.equal((await lstat(linked)).isSymbolicLink(), true);
    assert.deepEqual(report.changedFiles, []);
    assert.equal(report.remainingDiagnostics.some((line) => line.includes("VEL1005")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x19] a hard-linked module keeps both of its names", async () => {
  const root = await temporaryRoot("velar-fix-hard-link");
  try {
    const source = 'let a = 1\nif a === 1:\n    print("one")\n';
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "src/main.vel": source,
    });
    const second = join(root, "other-name.vel");
    await link(join(root, "src", "main.vel"), second);

    const report = await fixProject(root);

    assert.deepEqual(report.writeFailures, []);
    assert.equal(report.changes.length, 1);
    // A rename would have left the second name pointing at the original inode,
    // so the author's two names would disagree about what the module says.
    assert.match(await readFile(join(root, "src", "main.vel"), "utf8"), /if a == 1:/u);
    assert.match(await readFile(second, "utf8"), /if a == 1:/u);
    assert.equal((await stat(second)).ino, (await stat(join(root, "src", "main.vel"))).ino);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x19] a read-only module is refused rather than replaced through its directory", async () => {
  const root = await temporaryRoot("velar-fix-read-only");
  try {
    const source = 'let a = 1\nif a === 1:\n    print("one")\n';
    await writeTree(root, {
      "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist" })}\n`,
      "src/main.vel": source,
    });
    const target = join(root, "src", "main.vel");
    await chmod(target, 0o444);

    const executed = runCli(root, ["fix"]);

    assert.equal(executed.status, 1);
    assert.match(executed.stderr, /velar fix: could not write src\/main\.vel: the file is read-only; nothing was written/u);
    // `rename` needs a writable directory and nothing more, so without the
    // explicit test the module's own marker would have stopped nothing.
    assert.equal(await readFile(target, "utf8"), source);
    assert.equal((await stat(target)).mode & 0o777, 0o444);
    assert.deepEqual((await readdir(join(root, "src"))).sort(), ["main.vel"]);
  } finally {
    await chmod(join(root, "src", "main.vel"), 0o644).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("[CLI-x5] the language server offers no formatting edits for source the formatter cannot stabilize", async (context: TestContext) => {
  const root = await temporaryRoot("velar-lsp-format-fixed-point");
  const source = "def f():\n   raw  x\n";
  await writeTree(root, {
    "main.vel": source,
    "velar.json": `${JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["velar-unstable-format"] })}\n`,
    "node_modules/velar-unstable-format/package.json": `${JSON.stringify({
      name: "velar-unstable-format",
      version: "1.0.0",
      type: "module",
      exports: { "./compiler": "./compiler.js" },
      velar: { extension: { kind: "language", apiVersion: "1.0" } },
    })}\n`,
    // The scan claims its region only at an even offset, so re-indenting the
    // line flips the claim and the second pass produces different bytes.
    "node_modules/velar-unstable-format/compiler.js": [
      "export const velarCompilerExtension = {",
      '  id: "velar-unstable-format",',
      '  contract: { protocolVersion: 1, apiVersion: "1.0", kind: "language", extends: {} },',
      "  formatting: {",
      "    scanOpaqueSource(source, start) {",
      '      if (!source.startsWith("raw", start) || start % 2 !== 0) return null;',
      '      const end = source.indexOf("\\n", start);',
      "      return { end: end === -1 ? source.length : end, attachedToPrevious: false };",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
  });

  const child = spawn(process.execPath, [cliPath, "lsp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  context.after(async () => {
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  });
  let output = Buffer.alloc(0);
  const messages: Array<Record<string, unknown>> = [];
  child.stdout.on("data", (chunk: Buffer) => {
    output = Buffer.concat([output, chunk]);
    while (true) {
      const boundary = output.indexOf("\r\n\r\n");
      if (boundary === -1) break;
      const header = output.subarray(0, boundary).toString("ascii");
      const match = /Content-Length:\s*(\d+)/iu.exec(header);
      if (!match) break;
      const size = Number(match[1]);
      const end = boundary + 4 + size;
      if (output.length < end) break;
      messages.push(JSON.parse(output.subarray(boundary + 4, end).toString("utf8")) as Record<string, unknown>);
      output = output.subarray(end);
    }
  });
  const send = (message: unknown): void => {
    const body = JSON.stringify(message);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  };
  const waitFor = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for LSP message. stderr: ${String(child.stderr.read() ?? "")}`);
  };

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href, capabilities: {} } });
  await waitFor((message) => message.id === 1);
  send({ jsonrpc: "2.0", method: "initialized", params: {} });
  const uri = pathToFileURL(join(root, "main.vel")).href;
  send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri, languageId: "velar", version: 1, text: source } },
  });
  await waitFor((message) => message.method === "textDocument/publishDiagnostics"
    && (message.params as { uri?: string }).uri === uri);

  send({
    jsonrpc: "2.0",
    id: 2,
    method: "textDocument/formatting",
    params: { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } },
  });
  // Format-on-save would otherwise write the unstable form, and the save after
  // it would produce a module that does not parse.
  assert.deepEqual((await waitFor((message) => message.id === 2)).result, []);

  send({ jsonrpc: "2.0", id: 3, method: "shutdown", params: null });
  await waitFor((message) => message.id === 3);
  send({ jsonrpc: "2.0", method: "exit", params: null });
});
