import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile, formatDiagnostic } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

interface Execution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

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

function runCli(cwd: string, ...arguments_: readonly string[]): Execution {
  const result = spawnSync(process.execPath, [cliPath, ...arguments_], { cwd, encoding: "utf8", timeout: 300_000 });
  return { status: result.status, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function diagnosticMessages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code}: ${item.message}`);
}

test("[D82] extension statements declare their direct-await frame semantics", () => {
  const direct = compile(`
class Probe:
    @dispose:
        state value = await tick()
`.trimStart(), { path: "probe.vel", extensions: [webCompilerExtension] });
  assert.deepEqual(direct.diagnostics, []);
  assert.equal(direct.moduleInterface.classes.get("Probe")?.dispose, "async");
  assert.match(direct.code ?? "", /async \["__velar:dispose[^"]*"\]\(\)/u);
  assert.doesNotThrow(() => new Function(direct.code ?? ""));

  const childFrame = compile(`
class NestedProbe:
    @dispose:
        async def releaseLater():
            await tick()
`.trimStart(), { path: "nested-probe.vel", extensions: [webCompilerExtension] });
  assert.deepEqual(childFrame.diagnostics, []);
  assert.equal(childFrame.moduleInterface.classes.get("NestedProbe")?.dispose, "sync");
});

test("[A-012/A-013/A-014/A-015] recovery and terminal diagnostics stay actionable in one pass", () => {
  assert.deepEqual(diagnosticMessages('prnit("hello")\n'), ["VEL3001: Unknown name 'prnit'; did you mean 'print'?"]);
  assert.match(diagnosticMessages("let items = [1]\nitems.apend(2)\n").join("\n"), /did you mean 'append'/u);
  assert.match(diagnosticMessages("const accountTotal = 1\nprint(acountTotal)\n").join("\n"), /did you mean 'accountTotal'/u);

  const incompleteImport = compile('import {value from "./library.vel"\nprint("still parsed")\n');
  assert.deepEqual(incompleteImport.diagnostics.map((item) => item.code), ["VEL2001"]);

  const bom = compile('\ufeffconst value = "ok"\n');
  assert.match(bom.diagnostics[0]?.message ?? "", /UTF-8 BOM \(U\+FEFF\).*save the file as UTF-8 without BOM/u);

  const unicode = compile('print(f"👨‍👩‍👧‍👦 é {missingName}")\n', { path: "unicode.vel" });
  const rendered = formatDiagnostic(unicode.source, unicode.diagnostics[0]!);
  assert.equal(rendered.split("\n")[2], `${" ".repeat(14)}${"^".repeat(11)}`);
  assert.equal(unicode.source.location(unicode.diagnostics[0]!.span.start).column, 25, "LSP/source coordinates remain UTF-16 based");
});

test("[A-017/A-018/A-019/A-020/A-021] migration guidance is truthful and closes in one analysis", async () => {
  const promise = diagnosticMessages(`
async def load(value: string) -> string:
    return value
async def report() -> string:
    const rows = Promise.map(["a"], async value => await load(value))
    return rows.join(",")
`.trimStart());
  assert.deepEqual(promise, [
    "VEL4001: Promise<List<string>> has no member 'join'; add 'await' at the initializer — 'const rows = await ...' — then read 'rows.join'",
  ]);

  const matcherRoot = await temporaryRoot("velar-audit-set-matcher");
  try {
    await writeTree(matcherRoot, { "main.test.vel": 'import {expect} from "velar/test"\ntest "size":\n    expect(Set(["a"])).toHaveLength(1)\n' });
    const setMatcher = runCli(matcherRoot, "test", "main.test.vel");
    assert.equal(setMatcher.status, 1, setMatcher.stdout + setMatcher.stderr);
    assert.match(setMatcher.stderr, /expect\(set\.size\)\.toBe\(expected\)/u);
  } finally {
    await rm(matcherRoot, { recursive: true, force: true });
  }

  const nested = diagnosticMessages("const values: List<number> = [1]\nvalues.push(values.length)\n");
  assert.equal(nested.filter((item) => /List has no member/u.test(item)).length, 2, nested.join("\n"));
  assert.match(nested.join("\n"), /append\(value\).*Use 'size'/su);

  const map = diagnosticMessages('const owners = Map([["t-1", "Ada"]])\nprint(owners["t-1"] ?? "none")\n');
  assert.deepEqual(map, ["VEL4001: Use Map.get(key) instead of bracket access"]);

  const forEach = diagnosticMessages('const tags = ["ready"]\ntags.forEach(tag => print(tag))\n');
  assert.match(forEach.join("\n"), /structured loop for side effects.*for value in values:/u);
});

test("[A-001/A-004/A-005/A-008/A-009/D57] every JavaScript boundary is resolved and checked by meaning", async () => {
  const root = await temporaryRoot("velar-audit-js-boundaries");
  try {
    const missingInline = join(root, "missing-inline");
    await writeTree(missingInline, {
      "main.vel": 'extern js()`\n    import {missing} from "velar-audit-package-that-does-not-exist"\n    export {missing}\n`:\n    export const missing: number\nprint(missing)\n',
    });
    const missing = runCli(missingInline, "check", "main.vel");
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /VEL6006: JavaScript package import.*does not resolve/u);

    const mapped = join(root, "mapped");
    await writeTree(mapped, {
      "package.json": JSON.stringify({ private: true, type: "module", imports: { "#fixture": "fixture-package" } }),
      "node_modules/fixture-package/package.json": JSON.stringify({ name: "fixture-package", type: "module", exports: "./index.js" }),
      "node_modules/fixture-package/index.js": 'export const version = "fixture-1";\n',
      "main.vel": 'extern module "#fixture":\n    export const version: string\nimport js {version} from "#fixture"\nprint(version)\n',
    });
    const mappedRun = runCli(mapped, "run", "main.vel");
    assert.equal(mappedRun.status, 0, mappedRun.stdout + mappedRun.stderr);
    assert.equal(mappedRun.stdout, "fixture-1\n");

    const missingHash = join(root, "missing-hash");
    await writeTree(missingHash, {
      "package.json": JSON.stringify({ private: true, type: "module" }),
      "main.vel": 'import js unsafe {value} from "#missing"\nprint(value)\n',
    });
    assert.match(runCli(missingHash, "check", "main.vel").stderr, /package\.json#imports map/u);
    const missingNode = join(root, "missing-node");
    await writeTree(missingNode, { "main.vel": 'import js unsafe {value} from "node:velar-audit-missing"\nprint(value)\n' });
    assert.match(runCli(missingNode, "check", "main.vel").stderr, /is not a Node builtin/u);

    const namespace = join(root, "namespace");
    await writeTree(namespace, {
      "node_modules/fixture-package/package.json": JSON.stringify({ name: "fixture-package", type: "module", exports: "./index.js" }),
      "node_modules/fixture-package/index.js": "export const present = 1;\n",
      "main.vel": 'extern module "fixture-package":\n    export def missing(value: string) -> string\nimport js * as api from "fixture-package"\nprint(api.missing("x"))\n',
    });
    const namespaceRun = runCli(namespace, "run", "main.vel");
    assert.equal(namespaceRun.status, 1, namespaceRun.stdout + namespaceRun.stderr);
    assert.match(namespaceRun.stderr, /declares 'missing', but the JavaScript module has no such export/u);

    const declarations = join(root, "declarations");
    await writeTree(declarations, {
      "node_modules/typed-package/package.json": JSON.stringify({ name: "typed-package", type: "module", exports: "./index.js", types: "./index.d.ts" }),
      "node_modules/typed-package/index.js": 'export const urlAlphabet = "abc";\n',
      "node_modules/typed-package/index.d.ts": "export const urlAlphabet: string\n",
      "main.vel": 'import js {urlAlphabet} from "typed-package"\nconst value: string = urlAlphabet\nprint(value)\n',
    });
    const declarationCheck = runCli(declarations, "check", "main.vel");
    assert.equal(declarationCheck.status, 0, declarationCheck.stdout + declarationCheck.stderr);
    assert.doesNotMatch(declarationCheck.stderr, /has no export 'urlAlphabet'/u);

    const internal = join(root, "internal");
    await writeTree(internal, {
      "node_modules/velar/package.json": JSON.stringify({ name: "velar", type: "module", exports: { "./compiler-runtime-narrowing-v1": "./runtime.js" } }),
      "node_modules/velar/runtime.js": "export const narrow = () => null;\n",
      "main.vel": 'import js unsafe {narrow} from "velar/compiler-runtime-narrowing-v1"\nprint(narrow)\n',
    });
    const internalCheck = runCli(internal, "check", "main.vel");
    assert.equal(internalCheck.status, 1, internalCheck.stdout + internalCheck.stderr);
    assert.match(internalCheck.stderr, /compiler-internal runtime module.*cannot be imported/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[A-006] --out bundles npm runtime edges into a bare Node program", async () => {
  const root = await temporaryRoot("velar-audit-standalone");
  try {
    const project = join(root, "project");
    const output = join(root, "bare", "main.js");
    await writeTree(project, {
      "node_modules/fixture-package/package.json": JSON.stringify({ name: "fixture-package", type: "module", exports: "./index.js" }),
      "node_modules/fixture-package/index.js": 'export const version = "portable";\n',
      "main.vel": 'extern module "fixture-package":\n    export const version: string\nimport js {version} from "fixture-package"\nprint(version)\n',
    });
    const build = runCli(project, "build", "main.vel", "--out", output);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.deepEqual((await readdir(dirname(output))).sort(), ["main.js"]);
    const execution = spawnSync(process.execPath, [output], { cwd: dirname(output), encoding: "utf8" });
    assert.equal(execution.status, 0, String(execution.stderr));
    assert.equal(execution.stdout, "portable\n");
    assert.doesNotMatch(await readFile(output, "utf8"), /from ["']fixture-package["']/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[A-007] Web embedded-JavaScript resolution errors point at the authoring .vel line", async () => {
  const root = await temporaryRoot("velar-audit-web-location");
  try {
    await writeTree(root, {
      "velar.json": JSON.stringify({ formatVersion: 2, entry: "src/main.vel", outDir: "dist", publicDir: "public", extensions: ["@velarscript/web"], web: { title: "Probe" } }),
      "src/main.vel": 'extern js()`\n    import {basename} from "node:path"\n    export function label() { return basename("/tmp/file.txt") }\n`:\n    export def label() -> string\ncomponent App:\n    return <main>{label()}</main>\n@main: mount(<App />, "#app")\n',
    });
    const build = runCli(root, "build", ".");
    assert.equal(build.status, 1, build.stdout + build.stderr);
    assert.match(build.stderr, /src\/main\.vel:2:\d+: ERROR:.*Node builtin 'node:path'/u);
    assert.doesNotMatch(build.stderr, /velar-embedded:|\.embedded-\d+\.js/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[A-011] the public 4096-module limit is not shadowed by the host call stack", async () => {
  const root = await temporaryRoot("velar-audit-deep-graph");
  try {
    for (let end = 3000; end > 0; end -= 100) {
      const writes: Promise<void>[] = [];
      for (let index = end - 1; index >= Math.max(0, end - 100); index -= 1) {
        const next = index === 2999
          ? "export const value = 1\n"
          : `import {value as next} from "./module-${String(index + 1).padStart(4, "0")}.vel"\nexport const value = next\n`;
        writes.push(writeFile(join(root, `module-${String(index).padStart(4, "0")}.vel`), next, "utf8"));
      }
      await Promise.all(writes);
    }
    const check = runCli(root, "check", "module-0000.vel");
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /Checked 3000 modules/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("[A-025] the next build reclaims only marked staging owned by its output", async () => {
  const root = await temporaryRoot("velar-audit-staging-recovery");
  try {
    const output = resolve(root, "dist");
    const orphan = resolve(root, ".velar-dist-interrupted");
    const foreign = resolve(root, ".velar-dist-foreign");
    await writeTree(root, {
      "main.vel": 'print("ok")\n',
      ".velar-dist-interrupted/.velar-build-staging.json": `${JSON.stringify({
        formatVersion: 1,
        kind: "velar-build-staging",
        outputDirectory: output,
        stagingDirectory: orphan,
        ownerPid: 99_999_999,
      })}\n`,
      ".velar-dist-interrupted/partial.js": "partial\n",
      ".velar-dist-foreign/user.txt": "keep\n",
    });
    const build = runCli(root, "build", "main.vel", "--out-dir", output);
    assert.equal(build.status, 0, build.stdout + build.stderr);
    assert.equal(await readFile(join(foreign, "user.txt"), "utf8"), "keep\n");
    assert.deepEqual((await readdir(root)).filter((name) => name.startsWith(".velar-dist-")).sort(), [".velar-dist-foreign"]);
    assert.equal(await readFile(join(output, "main.js"), "utf8").then(() => true), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
