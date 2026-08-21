import assert from "node:assert/strict";
import test from "node:test";
import { compile, type CompilerExtension } from "@velarscript/compiler";
import { standardModuleInterfaces } from "@velarscript/core";
import type { ValueType } from "../packages/compiler/src/types.ts";
import { velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * D90 (coherence): the Node guide rules that ambient Node globals are not the
 * door — "use velar/fs, velar/path, velar/process, velar/env, velar/terminal,
 * velar/http, velar/worker, and velar/websocket instead of ambient Node
 * globals" — but the rule had no enforcement arm. The Web extension answered
 * `fetch` with the module that replaced it while the Node extension answered
 * the same mistake with a bare `Unknown name`, so two models writing the two
 * halves of one product got a teaching diagnostic on one surface and a dead
 * end on the other.
 *
 * Every module and member a message names is compiled below as well as quoted,
 * because guidance that names an API which does not exist is worse than the
 * bare message it replaces.
 */
const nodeExtensions: readonly CompilerExtension[] = [velarNodeCompilerExtension];
const moduleInterfaces = standardModuleInterfaces([velarNodeCompilerExtension]);

function reported(source: string, extensions: readonly CompilerExtension[] = nodeExtensions): string[] {
  return compile(source, { extensions }).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function guidanceFor(name: string, extensions: readonly CompilerExtension[] = nodeExtensions): string {
  const messages = reported(`const value = ${name}\n`, extensions);
  const guidance = messages.find((item) => item.startsWith("VEL3008"));
  assert.ok(guidance, `${name} earned no guidance: ${messages.join(" | ")}`);
  assert.ok(messages.every((item) => !item.startsWith("VEL3001")), messages.join(" | "));
  return guidance.slice("VEL3008 ".length);
}

/**
 * The project driver hands the analyzer a flat table of what each import
 * resolved to; this rebuilds the slice of it a probe needs so a successor can
 * be compiled here without standing a whole project up.
 */
function analysisFor(source: string) {
  const imports = new Map<string, ValueType>();
  const namedTypes = new Map<string, ReadonlyMap<string, ValueType>>();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/gu)) {
    const module = moduleInterfaces.get(match[2]!);
    assert.ok(module, `no module interface for ${match[2]}`);
    for (const raw of match[1]!.split(",")) {
      const imported = raw.trim();
      if (imported.length === 0) continue;
      const type = module.exports.get(imported);
      assert.ok(type, `${match[2]} does not export '${imported}'`);
      imports.set(imported, type);
    }
    for (const [name, fields] of module.namedTypes) {
      if (!namedTypes.has(name)) namedTypes.set(name, fields);
      const identity = module.namedTypeIdentities?.get(name);
      if (identity && !namedTypes.has(identity)) namedTypes.set(identity, fields);
    }
  }
  return { imports, namedTypes };
}

function compilesClean(source: string): void {
  const result = compile(source, { extensions: nodeExtensions, analysis: analysisFor(source) });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [], source);
}

test("[D90] every ambient Node global a reflex reaches for names the module that replaced it", () => {
  for (const [name, quoted] of [
    ["process", ["velar/env", "velar/process", "velar/host"]],
    ["Buffer", ["velar/binary", "Bytes"]],
    ["require", ["import {name} from"]],
    ["exports", ["export"]],
    ["global", ["import the capability you need"]],
    ["__dirname", ["velar/path", "dirname"]],
    ["__filename", ["velar/path", "basename"]],
    ["fetch", ["velar/http"]],
    ["WebSocket", ["velar/websocket", "connect", "listen"]],
  ] as const) {
    const guidance = guidanceFor(name);
    for (const fragment of quoted) assert.ok(guidance.includes(fragment), `${name} -> ${guidance}`);
  }
});

test("[D90] the successors the Node guidance names all exist and compile", () => {
  // velar/env, velar/process and velar/host — the three doors `process` opens.
  compilesClean(`import {get, require} from "velar/env"\n\nconst port: string? = get("PORT")\nconst key: string = require("API_KEY")\n`);
  compilesClean(`import {run, start} from "velar/process"\n\nasync def main():\n  const result = await run("ls", ["-la"])\n  const child = await start("node", ["server.js"])\n  await child.wait()\n`);
  compilesClean(`import {exit} from "velar/host"\n\ndef stop():\n  exit(1)\n`);
  // velar/binary — the door `Buffer` opens.
  compilesClean(`import {Bytes} from "velar/binary"\n\ndef take(value: Bytes) -> number:\n  return value.size\n`);
  // velar/path — the door `__dirname` and `__filename` open.
  compilesClean(`import {resolve, join, dirname, basename} from "velar/path"\n\nconst joined: string = join(["a", "b"])\nconst folder: string = dirname(joined)\nconst leaf: string = basename(joined)\nconst absolute: string = resolve(["."])\n`);
  // velar/http — the door `fetch` opens.
  compilesClean(`import {http} from "velar/http"\n\nasync def load() -> string:\n  return await http.get("https://example.com").text()\n`);
  // velar/websocket — the door `WebSocket` opens. Both members the message
  // names are compiled, because this surface is the one that has `listen`.
  compilesClean(`import {connect, listen} from "velar/websocket"\n\nasync def dial(url: string):\n  const socket = await connect(url)\n  await socket.send("ping")\n`);
});

test("[D90] one mistake has one answer: `fetch` reads the same on both surfaces", () => {
  assert.equal(guidanceFor("fetch"), guidanceFor("fetch", [velarWebCompilerExtension]));
  assert.equal(guidanceFor("fetch"), "Use velar/http instead of the raw fetch global");
  // The two can never be loaded into one compile — only one extension may own
  // syntax parsing — so the duplicate entry is a deliberate copy of one
  // sentence onto a second surface, never a merge whose winner is in doubt.
  assert.throws(() => reported("const value = fetch\n", [velarNodeCompilerExtension, velarWebCompilerExtension]), /one compiler extension may own syntax parsing/u);
});

test("[D90] the target-neutral globals stay Core's answer, not a second Node copy", () => {
  // The boundary lives in the test as well as in the brief: duplicating one of
  // these here would give one mistake two spellings in two files.
  const registered = velarNodeCompilerExtension.analysis?.globalGuidance;
  assert.ok(registered);
  for (const name of [
    "setTimeout", "setInterval", "clearTimeout", "clearInterval", "structuredClone",
    "URL", "RegExp", "TextEncoder", "TextDecoder", "AbortController", "Symbol",
    "localStorage", "sessionStorage",
    // `velar/worker` is a Core module, so the ambient `Worker` is Core's answer
    // too, even though both extensions carry a worker surface.
    "Worker",
  ]) {
    assert.equal(registered.has(name), false, `${name} must not be answered by the Node extension`);
  }
  // Core still answers them, and reads identically with the Node extension
  // loaded and without it.
  for (const name of ["setTimeout", "structuredClone", "URL", "RegExp", "TextEncoder", "AbortController", "Symbol", "Worker"]) {
    assert.equal(guidanceFor(name), guidanceFor(name, []), name);
  }
  assert.match(guidanceFor("Worker"), /velar\/worker/u);
});

test("[D90] `WebSocket` is answered on both surfaces, each naming what that surface can do", () => {
  // `velar/websocket` is extension-owned rather than Core's, so leaving it to
  // Core would answer neither surface — and answering only Node would rebuild
  // the very asymmetry this finding is about.
  const node = guidanceFor("WebSocket");
  const web = guidanceFor("WebSocket", [velarWebCompilerExtension]);
  for (const message of [node, web]) {
    assert.match(message, /velar\/websocket/u);
    assert.match(message, /connect/u);
  }
  // A browser cannot accept connections, so its sentence must not name
  // `listen` — the Node interface has it and the Web interface does not.
  assert.match(node, /listen/u);
  assert.equal(/listen/u.test(web), false, web);
  assert.equal(moduleInterfaces.get("velar/websocket")?.exports.has("listen"), true);
});

test("[D90] `module` is a keyword, so it is answered by the keyword rule rather than by guidance", () => {
  // It never reaches name resolution, so guidance for it would be dead code.
  assert.equal(velarNodeCompilerExtension.analysis?.globalGuidance?.has("module"), false);
  const messages = reported("const value = module\n");
  assert.ok(messages.some((item) => item.startsWith("VEL2002") && item.includes("keyword")), messages.join(" | "));
});

test("[D90] the answer does not depend on which side of the '=' the name stands on", () => {
  // The sink, not the spelling: there are two unresolved-name sites in the
  // analyzer, and only the read site consulted guidance. `exports = {run: run}`
  // is the CommonJS reflex this packet exists to answer, and it reaches the
  // assignment site, so it used to earn a bare "Unknown name" while
  // `const value = exports` earned the module that replaced it.
  for (const [name, source] of [
    ["exports", 'def run():\n  print("x")\n\nexports = {run: run}\n'],
    ["fetch", "def go():\n  fetch = 1\n"],
    ["process", "def go():\n  process = 1\n"],
    ["WebSocket", "def go():\n  WebSocket = 1\n"],
  ] as const) {
    const written = reported(source).find((item) => item.startsWith("VEL3008"));
    assert.ok(written, `${name} earned no guidance as an assignment target: ${reported(source).join(" | ")}`);
    assert.equal(written.slice("VEL3008 ".length), guidanceFor(name), name);
  }
  // Core's roster and the Web extension's reach the same site, because the
  // fix closes the site rather than the eight names this packet owns.
  assert.match(reported("def go():\n  len = 1\n").join(" | "), /VEL3008 .*value\.size/u);
  assert.match(
    reported("def go():\n  document = 1\n", [velarWebCompilerExtension]).join(" | "),
    /VEL3008 .*velar\/browser/u,
  );
  // A genuine typo keeps the nearest-name hint it has on the read side, and a
  // resolved target is still silent.
  assert.deepEqual(
    reported("let total: number = 0\n\ndef go():\n  totl = 1\n"),
    ["VEL3001 Unknown name 'totl'; did you mean 'total'?"],
  );
  assert.deepEqual(reported("let total: number = 0\n\ndef go():\n  total = 1\n"), []);
});

test("[D90] guidance answers an unresolved name only, so the same spellings stay legal as names", () => {
  // A false positive on a legitimate binding is worse than the silence this
  // change replaced, because it blocks a correct program.
  for (const source of [
    "const process: number = 1\nprint(str(process))\n",
    "def run(fetch: string) -> string:\n  return fetch\n",
    "const options = {global: 1}\nprint(str(options.global))\n",
    "type Wire:\n  Buffer: string\n\ndef read(wire: Wire) -> string:\n  return wire.Buffer\n",
  ]) {
    assert.deepEqual(reported(source), [], source);
  }
});

test("[D90] the bare Node module specifiers name the module that replaced them", () => {
  // The `const path = require("path")` reflex arrives as a bare module
  // specifier rather than as a global, and `path` was the one name in this
  // roster that answered *wrongly* rather than emptily.
  for (const [name, quoted] of [
    ["path", ["velar/path", "join", "dirname"]],
    ["fs", ["velar/fs", "readText", "writeText"]],
    ["http", ["velar/http", "http.get(url)"]],
    ["url", ["velar/url", "withQuery"]],
    ["crypto", ["velar/id", "velar/random", "no crypto module", "hashing and ciphers have no successor"]],
    ["child_process", ["velar/process", "run", "start"]],
    ["worker_threads", ["velar/worker", "workerPool"]],
  ] as const) {
    const guidance = guidanceFor(name);
    for (const fragment of quoted) assert.ok(guidance.includes(fragment), `${name} -> ${guidance}`);
  }
  // The edit-distance fallback used to answer `path` with `Math` — a namespace
  // that has no `join`, so a model told to do exactly what the diagnostic says
  // was sent one step further from a working program. Guidance is consulted
  // first, so naming the successor retires the guess as well.
  assert.equal(reported("const value = path\n").some((item) => item.includes("did you mean")), false);
});

test("[D90] the successors the module-specifier guidance names all exist and compile", () => {
  compilesClean(`import {join, resolve, dirname, basename} from "velar/path"\n\nconst joined: string = join(["a", "b"])\nconst folder: string = dirname(resolve([joined]))\nconst leaf: string = basename(joined)\n`);
  compilesClean(`import {readText, writeText, exists, list} from "velar/fs"\n\nasync def load(path: string) -> string:\n  if not await exists(path):\n    await writeText(path, "")\n  return await readText(path)\n`);
  compilesClean(`import {http} from "velar/http"\n\nasync def load(url: string) -> string:\n  return await http.get(url).text()\n`);
  compilesClean(`import {parse, join, withQuery, encode} from "velar/url"\n\nconst escaped: string = encode("a b")\n`);
  compilesClean(`import {run, start} from "velar/process"\n\nasync def build():\n  const done = await run("ls", ["-la"])\n  const child = await start("node", ["server.js"])\n  await child.wait()\n`);
  compilesClean(`import {worker, workerPool} from "velar/worker"\n`);
  compilesClean(`import {uuid} from "velar/id"\n\nconst id: string = uuid()\n`);
  compilesClean(`import {random, Random} from "velar/random"\n\nconst source: Random = random("seed")\n`);
  // The `crypto` message says the registry has no crypto module; that claim is
  // only true while it stays true.
  for (const module of ["velar/crypto", "velar/hash", "velar/os", "velar/events", "velar/stream"]) {
    assert.equal(moduleInterfaces.has(module), false, module);
  }
});

test("[D90] the Node-only names are answered once, by the Node extension alone", () => {
  const registered = velarNodeCompilerExtension.analysis?.globalGuidance;
  assert.ok(registered);
  for (const name of [
    "path", "fs", "http", "url", "crypto", "child_process", "worker_threads",
    "setImmediate", "clearImmediate",
  ]) {
    assert.ok(registered.has(name), `${name} must be answered by the Node extension`);
    // Core carries no entry for any of them, so the Node answer is the only
    // answer rather than a second spelling of one.
    assert.equal(reported(`const value = ${name}\n`, []).some((item) => item.startsWith("VEL3008")), false, name);
  }
  // `setImmediate` is Node's alone; `setTimeout` exists on both hosts, so it
  // stays Core's answer and reads the same with the extension loaded.
  assert.equal(registered.has("setTimeout"), false);
  assert.equal(guidanceFor("setTimeout"), guidanceFor("setTimeout", []));
  assert.match(guidanceFor("setImmediate"), /Promise\.sleep\(0ms\)/u);
  assert.match(guidanceFor("clearImmediate"), /no callback scheduler to clear/u);
  compilesClean("async def go():\n  await Promise.sleep(0ms)\n");
});

test("[D90] the module-specifier spellings stay legal as ordinary names", () => {
  // `path`, `url`, `fs` and `http` are ordinary English words a Node program
  // binds constantly; guidance is consulted at the unresolved-name site only.
  for (const source of [
    'def read(path: string) -> string:\n  return path\n',
    'const url: string = "https://example.com"\nprint(url)\n',
    'const config = {http: 1, url: "a", crypto: true, path: "b"}\nprint(str(config.http))\n',
    "def go():\n  let fs: number = 1\n  fs = 2\n  print(str(fs))\n",
  ]) {
    assert.deepEqual(reported(source), [], source);
  }
  // A resolved import shadows the guidance too: the name the message tells the
  // author to import is itself a legal binding of the spelling it replaces.
  compilesClean(`import {join} from "velar/path"\n\nconst path: string = join(["a", "b"])\nprint(path)\n`);
});
