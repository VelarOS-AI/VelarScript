import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test, { after } from "node:test";
import { VELAR_COLLECTION_LOWERING_MODULE } from "@velarscript/compiler/extension";
import { velarCompilerExtension } from "@velarscript/web/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleClosure, standardModuleSource, standardModuleSources } from "../packages/cli/src/standard-modules.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// Closing wave — D50 rules 97.2 and 97.3.

const root = resolve(new URL("..", import.meta.url).pathname);

after(async () => {
  await removeTemporaryDirectories();
});

/** Runs a one-file test project through the real `velar test` runner. */
async function runTests(source: string): Promise<{ readonly status: number; readonly stdout: string; readonly stderr: string }> {
  const directory = await makeTemporaryDirectory("velar-closing-");
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "src/main.vel" }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "export def identity(value: number) -> number:\n    return value\n", "utf8");
  await writeFile(join(directory, "src", "main.test.vel"), source.trimStart(), "utf8");
  const execution = spawnSync(process.execPath, [join(root, "packages", "cli", "src", "cli.ts"), "test", directory], {
    encoding: "utf8",
    timeout: 120_000,
  });
  return { status: execution.status ?? 1, stdout: String(execution.stdout), stderr: String(execution.stderr) };
}

// Every generated module names its dependencies by specifier, so the whole
// standard module graph is linked as data URLs before the program runs. Three
// passes settle the graph: each pass rewrites specifiers against the URLs the
// previous pass minted, which is enough for the two-level core dependencies.
function linkedModuleUrls(): ReadonlyMap<string, string> {
  const sources = standardModuleSources();
  const urls = new Map<string, string>();
  const encode = (source: string): string => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const link = (source: string): string => {
    let linked = source;
    for (const name of sources.keys()) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(urls.get(name)!));
    return linked;
  };
  for (const [name, source] of sources) urls.set(name, encode(source));
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, source] of sources) urls.set(name, encode(link(source)));
  }
  return urls;
}

/**
 * Runs plain JavaScript against the linked standard modules. Structures deeper
 * than the 512-level delimiter budget cannot be written in VelarScript source
 * and recursive type aliases are rejected, so the depth divergence wave R2
 * measured lives only below the language — which is where this harness looks.
 */
function runAgainstRuntime(body: string): string {
  const urls = linkedModuleUrls();
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    timeout: 60_000,
    input: [
      `import { expect } from ${JSON.stringify(urls.get("velar/test")!)};`,
      `import { __velarEquals } from ${JSON.stringify(urls.get(VELAR_COLLECTION_LOWERING_MODULE)!)};`,
      body,
    ].join("\n"),
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

/*
 * D50 rule 97.2 — velar/test's assertion used to carry its own comparison,
 * which answered differently from the language's own equals on NaN, on Sets of
 * records, and past 512 levels of nesting. Each probe asserts the two agree,
 * not merely that either one says "true": a matcher that disagrees with the
 * language is the worst kind of test-framework trap.
 */

test("[D50-97.2] toEqual and equals agree that NaN equals itself", async () => {
  const execution = await runTests(`
import {expect} from "velar/test"

test "NaN compares equal to itself, and both spellings say so":
    const left = [0.0 / 0.0]
    const right = [0.0 / 0.0]
    expect(equals(left, right)).toBe(true)
    expect(left).toEqual(right)
`);
  assert.equal(execution.status, 0, execution.stdout + execution.stderr);
});

test("[D50-97.2] toEqual and equals agree on a Set of records", async () => {
  const execution = await runTests(`
import {expect} from "velar/test"

test "a Set of equal records compares equal, and both spellings say so":
    const left = Set([{name: "ada", year: 1815}])
    const right = Set([{name: "ada", year: 1815}])
    expect(equals(left, right)).toBe(true)
    expect(left).toEqual(right)
`);
  assert.equal(execution.status, 0, execution.stdout + execution.stderr);
});

test("[D50-97.2] toEqual and equals agree past 512 levels of nesting", () => {
  const output = runAgainstRuntime(`
const nest = (depth) => { let value = [1]; for (let level = 0; level < depth; level += 1) value = [value]; return value; };
const left = nest(600);
const right = nest(600);
console.log(String(__velarEquals(left, right)));
let passed = true;
try { expect(left).toEqual(right); } catch { passed = false; }
console.log(String(passed));
`);
  assert.equal(output, "true\ntrue\n");
});

test("[D50-97.2] toEqual refuses what equals refuses, with the same words", () => {
  // Past its budget equals throws rather than answering "not equal". The
  // assertion now inherits that refusal verbatim instead of reporting a
  // failure the language itself would never report.
  const output = runAgainstRuntime(`
const nest = (depth) => { let value = [1]; for (let level = 0; level < depth; level += 1) value = [value]; return value; };
const left = nest(2000);
const right = nest(2000);
const reason = (work) => { try { work(); return "no error"; } catch (error) { return error.message; } };
console.log(reason(() => __velarEquals(left, right)));
console.log(reason(() => expect(left).toEqual(right)));
`);
  const [fromEquals, fromToEqual] = output.trimEnd().split("\n");
  assert.equal(fromEquals, "equals cannot compare data nested more than 1000 collections deep");
  assert.equal(fromToEqual, fromEquals);
});

test("[D50-97.2] velar/test carries no second comparison implementation", () => {
  const source = standardModuleSource("velar/test")!;
  // One source of truth: the module reaches for the Core algorithm and
  // restates none of it.
  assert.match(source, /^import \{ __velarEquals \} from "velar\/compiler-runtime-collection-lowering-v1";$/mu);
  assert.doesNotMatch(source, /__velarDeepEqual|__velarEqualValue/u);
  assert.equal(source.split("__velarEquals").length - 1, 2);
  // An unbundled target must still materialize what the assertion reaches for.
  assert.ok(standardModuleClosure(["velar/test"]).has(VELAR_COLLECTION_LOWERING_MODULE));
});

test("[D50-97.3] a namespace import of a retired module earns the same migration", async () => {
  const entry = join(tmpdir(), "velar-closing-namespace", "main.vel");
  const project = await compileProject(entry, new Map([[entry, `
import * as text from "velar/text"
import * as json from "velar/json"
import * as tasks from "velar/async"
import * as look from "velar/look"

print(text.slug("a") + json.stringify(1))
`.trimStart()]]), { extensions: [velarCompilerExtension] });
  const failures = project.failures.map((item) => item.message);
  for (const message of [
    "Use Text directly; VelarScript's pure namespaces need no import",
    "Use Json directly; VelarScript's pure namespaces need no import",
    "Use Promise directly; VelarScript's pure namespaces need no import",
    "Use Look directly; VelarScript's pure namespaces need no import",
  ]) assert.ok(failures.includes(message), failures.join("\n"));
});

test("[D50-97.3] a namespace import of a module that still needs importing stays legal", async () => {
  const entry = join(tmpdir(), "velar-closing-namespace-capability", "main.vel");
  const project = await compileProject(entry, new Map([[entry, `
import * as math from "velar/math"
import * as url from "velar/url"

print(str(math.sqrt(4)) + url.encode("a b"))
`.trimStart()]]), { extensions: [velarCompilerExtension] });
  assert.deepEqual(project.failures.map((item) => item.message), []);
});
