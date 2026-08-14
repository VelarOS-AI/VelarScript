import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile } from "@velarscript/compiler";
import { TEXT_NAMESPACE_MEMBERS } from "@velarscript/compiler/extension";
import { standardModuleInterfaces, standardModuleSources } from "../packages/cli/src/standard-modules.ts";

// The generated standard modules name each other by specifier, so the whole
// graph is linked as data URLs before a program runs. Three passes settle the
// two-level core dependencies.
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

function execute(code: string): { readonly status: number | null; readonly stdout: string; readonly stderr: string } {
  const urls = linkedModuleUrls();
  let linked = code;
  for (const [name, url] of urls) linked = linked.replaceAll(JSON.stringify(name), JSON.stringify(url));
  const result = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: linked, timeout: 20_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.equal(execution.status, 0, execution.stderr);
  return execution.stdout;
}

function runFailing(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  const execution = execute(result.code ?? "");
  assert.notEqual(execution.status, 0);
  return execution.stderr;
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

function clean(source: string): void {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
}

// ---------------------------------------------------------------------------
// TXT-U3 — Text.normalize
// ---------------------------------------------------------------------------

test("[TXT-U3] canonically equivalent text is unequal until Text.normalize joins it", () => {
  const output = run(`
const composed = "caf\\u{e9}"
const decomposed = "cafe\\u{301}"
print(str(composed == decomposed))
print(str(composed.size))
print(str(decomposed.size))
print(str(Text.normalize(decomposed) == composed))
print(str(Text.normalize(composed, "NFD") == decomposed))
print(str(Text.normalize(composed, "NFC") == composed))
`.trimStart());
  assert.equal(output, ["false", "4", "5", "true", "true", "true"].join("\n") + "\n");
});

test("[TXT-U3] Text.normalize accepts the four Unicode forms and rejects anything else", () => {
  const output = run(`
const ligature = "\\u{fb01}n"
print(Text.normalize(ligature, "NFKC"))
print(Text.normalize(ligature, "NFKD"))
print(str(Text.normalize(ligature, "NFC") == ligature))
print(str(Text.normalize(ligature, "NFD") == ligature))
`.trimStart());
  assert.equal(output, ["fin", "fin", "true", "true"].join("\n") + "\n");

  const failure = runFailing('print(Text.normalize("a", "nfc"))\n');
  assert.match(failure, /normalize form must be NFC, NFD, NFKC, or NFKD/u);
});

test("[TXT-U3] normalized text agrees as a Map and Set key", () => {
  const output = run(`
const composed = "caf\\u{e9}"
const decomposed = "cafe\\u{301}"
const seen = Set([composed])
print(str(decomposed in seen))
print(str(Text.normalize(decomposed) in seen))
const counts = Map([[composed, 1]])
counts.set(Text.normalize(decomposed), 2)
print(str(counts.size))
`.trimStart());
  assert.equal(output, ["false", "true", "1"].join("\n") + "\n");
});

test("[TXT-U3] Text.normalize is a permanent Text member with a two-argument contract", () => {
  assert.ok(TEXT_NAMESPACE_MEMBERS.includes("normalize"));
  assert.deepEqual([...TEXT_NAMESPACE_MEMBERS].sort(),
    [...standardModuleInterfaces().get("velar/text")!.exports.keys()].sort());
  assert.deepEqual(messages('print(Text.normalize("a", "NFC", "NFD"))\n'),
    ["Expected 1-2 arguments but received 3"]);
  assert.deepEqual(messages('print(Text.normalize("a", 1))\n'), ["Cannot assign number to string"]);
  clean('print(Text.normalize("a"))\n');
});
