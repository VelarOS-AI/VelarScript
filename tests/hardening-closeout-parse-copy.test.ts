import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile } from "@velarscript/compiler";
import { nodeModuleDependencies, nodeModuleSources } from "../packages/node/src/compiler.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension as velarWebCompilerExtension } from "../packages/web/src/compiler.ts";

// closeout co-7 asked whether a runtime Type reading a freshly decoded text may
// skip D90 rule R5's copy, because the decode hands it a brand new, privately
// held object. It may not: that copy is not a defensive duplicate. It rebuilds
// the value from the *declared* fields, so it strips client-controlled extra
// keys, neutralises a literal `__proto__` field, and lands a record on
// Object.prototype where an untyped read lands it on a null prototype. Those are
// behaviour and safety properties of the shipped path, not incidental ones.
//
// The rebuild that is redundant on that path is the other one. `__velarJsonParse`
// walks the host parser's fresh tree and rebuilds it into owned data, and R5's
// copy then discards that rebuild and builds its own from the declared fields.
// `__velarJsonParseTyped` runs the same validating walk — the walk is what
// enforces the depth, node, and encoded size budgets — and skips only the
// rebuild the Type is about to discard. Every typed read of a freshly decoded
// text in velar/http and velar/storage goes through it.
//
// `ServeRequest.parse` is built three times over — once per transport and once
// for the server-test harness — so both transports are driven here rather than
// the one call site the finding named. Those three still read through `json()`:
// scripts/check-runtime-boundary.mjs pins that call's spelling, and the gate is
// not this wave's to edit.

interface ServeBridge {
  createRoute(method: string, path: string, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
}

interface ServeRuntime {
  readonly ServeApp: object;
  serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
}

interface WebsocketRuntime {
  listen(options: Record<string, unknown>): Promise<{port: number; stop(): Promise<null>}>;
}

interface ParseType {
  parse(value: unknown): unknown;
}

const REQUEST_PARAMETER = {name: "request", source: "request", kind: "request", required: true};

function serveBridge(app: object): ServeBridge {
  return Object.getOwnPropertyDescriptor(app, "__velarCompilerBridge")?.value as ServeBridge;
}

/**
 * Loads the real velar/serve and velar/websocket runtimes beside a
 * compiler-emitted Type module, so `request.parse` runs against the Type the
 * emitter actually generates rather than a hand-written stand-in.
 */
async function runtimesWithType<T>(directory: string, source: string): Promise<{serve: ServeRuntime; websocket: WebsocketRuntime; types: T}> {
  const compiled = compile(source.trimStart());
  assert.deepEqual(compiled.diagnostics, [], JSON.stringify(compiled.diagnostics));
  assert.ok(compiled.code !== null);
  const dependencies = new Set<string>(["velar/serve", "velar/websocket"]);
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/serve");
  visit("velar/websocket");
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
  const require = createRequire(import.meta.url);
  await cp(resolve(require.resolve("ws/package.json"), ".."), join(directory, "node_modules", "ws"), {recursive: true});
  await writeFile(join(directory, "types.mjs"), compiled.code, "utf8");
  const stamp = Date.now();
  return {
    serve: await import(pathToFileURL(join(root, "serve.js")).href) as ServeRuntime,
    websocket: await import(`${pathToFileURL(join(root, "websocket.js")).href}?closeout=${stamp}`) as WebsocketRuntime,
    types: await import(`${pathToFileURL(join(directory, "types.mjs")).href}?closeout=${stamp}`) as T,
  };
}

const PROFILE = `
export type Profile:
    name: string
    tags: List<string>
`;

test("both serve transports hand a handler the declared shape, not the client's object", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-closeout-parse-"));
  try {
    const {serve, websocket, types} = await runtimesWithType<{Profile: ParseType}>(directory, PROFILE);
    const bridge = serveBridge(serve.ServeApp);
    const shape = bridge.createRoute("POST", "/shape", [REQUEST_PARAMETER], async (request: never) => {
      const source = request as unknown as {json(maxBytes?: number): Promise<unknown>; parse<V>(target: ParseType, maxBytes?: number): Promise<V>};
      const before = await source.json(1 << 20) as Record<string, unknown>;
      const parsed = await source.parse<Record<string, unknown>>(types.Profile, 1 << 20);
      // A shared substructure would survive a handler's write into a value the
      // request layer builds again for the same body.
      (parsed.tags as string[]).push("written by the handler");
      const after = await source.json(1 << 20) as Record<string, unknown>;
      return {
        keys: Reflect.ownKeys(parsed) as string[],
        onObjectPrototype: Object.getPrototypeOf(parsed) === Object.prototype,
        rawOnNullPrototype: Object.getPrototypeOf(before) === null,
        aliasesTheSource: parsed === before || parsed.tags === before.tags,
        sourceTags: (after.tags as string[]).length,
        pollutedPrototype: ({} as Record<string, unknown>).polluted !== undefined,
        ownProtoField: Object.hasOwn(parsed, "__proto__"),
      };
    });
    const app = bridge.createApp("closeout-parse", [shape]);
    const hostServer = await serve.serve(app, 0);
    const nativeServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/ws", http: app});
    try {
      for (const [label, port] of [["host", hostServer.port], ["native", nativeServer.port]] as const) {
        const response = await fetch(`http://127.0.0.1:${port}/shape`, {
          method: "POST",
          body: String.raw`{"name":"Ada","tags":["one"],"extra":"client-controlled","__proto__":{"polluted":"yes"}}`,
        });
        assert.equal(response.status, 200, `${label} transport accepts the body`);
        assert.deepEqual(await response.json(), {
          // Undeclared keys the client sent are stripped, and so is a literal
          // '__proto__' field: neither reaches the handler.
          keys: ["name", "tags"],
          onObjectPrototype: true,
          rawOnNullPrototype: true,
          // Nothing the request layer builds for this body is aliased by the
          // value the handler was handed.
          aliasesTheSource: false,
          sourceTags: 1,
          // A '__proto__' key in the body pollutes nothing and lands as no own
          // field, because it is not a declared one.
          pollutedPrototype: false,
          ownProtoField: false,
        }, `${label} transport hands over the declared shape`);
      }
    } finally {
      await nativeServer.stop();
      await hostServer.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("both serve transports reject a mistyped body with the Type's own validation error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-closeout-parse-"));
  try {
    const {serve, websocket, types} = await runtimesWithType<{Profile: ParseType}>(directory, PROFILE);
    const bridge = serveBridge(serve.ServeApp);
    const reject = bridge.createRoute("POST", "/reject", [REQUEST_PARAMETER], async (request: never) => {
      const source = request as unknown as {parse<V>(target: ParseType, maxBytes?: number): Promise<V>};
      try {
        await source.parse(types.Profile, 1 << 20);
        return {accepted: true, name: "", message: ""};
      } catch (error) {
        return {accepted: false, name: (error as Error).constructor.name, message: (error as Error).message};
      }
    });
    const app = bridge.createApp("closeout-reject", [reject]);
    const hostServer = await serve.serve(app, 0);
    const nativeServer = await websocket.listen({port: 0, host: "127.0.0.1", path: "/ws", http: app});
    try {
      for (const [label, port] of [["host", hostServer.port], ["native", nativeServer.port]] as const) {
        // The rejection is the Type's own, named field and all: the request
        // layer neither rewrites it nor wraps it.
        const mistyped = await fetch(`http://127.0.0.1:${port}/reject`, {method: "POST", body: JSON.stringify({name: 42, tags: []})});
        assert.equal(mistyped.status, 200);
        assert.deepEqual(await mistyped.json(), {
          accepted: false,
          name: "ValidationError",
          message: "Value does not match Profile — field 'name' does not match string",
        }, `${label} transport reports the mistyped field`);

        const missing = await fetch(`http://127.0.0.1:${port}/reject`, {method: "POST", body: JSON.stringify({name: "Ada"})});
        assert.equal(missing.status, 200);
        assert.deepEqual(await missing.json(), {
          accepted: false,
          name: "ValidationError",
          message: "Value does not match Profile — field 'tags' is missing",
        }, `${label} transport reports the missing field`);
      }
    } finally {
      await nativeServer.stop();
      await hostServer.stop();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

interface HttpRequest {
  json(): Promise<unknown>;
  parse<V>(target: ParseType): Promise<V>;
  response(): Promise<{json(): Promise<unknown>; parse<V>(target: ParseType): Promise<V>}>;
}

interface HttpRuntime {
  readonly http: {get(url: string, options?: Record<string, unknown>): HttpRequest};
}

/**
 * Loads the real velar/http runtime beside a compiler-emitted Type module, so
 * the typed decode runs against the Type the emitter actually generates.
 */
async function httpWithType<T>(directory: string, source: string): Promise<{http: HttpRuntime; types: T}> {
  const compiled = compile(source.trimStart());
  assert.deepEqual(compiled.diagnostics, [], JSON.stringify(compiled.diagnostics));
  assert.ok(compiled.code !== null);
  const dependencies = new Set<string>(["velar/http"]);
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/http");
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
  await writeFile(join(directory, "types.mjs"), compiled.code, "utf8");
  const stamp = Date.now();
  return {
    http: await import(`${pathToFileURL(join(root, "http.js")).href}?closeout=${stamp}`) as HttpRuntime,
    types: await import(`${pathToFileURL(join(directory, "types.mjs")).href}?closeout=${stamp}`) as T,
  };
}

/** A one-shot origin that answers every path with the same body and counts its requests. */
async function origin(body: string): Promise<{port: number; requests(): number; close(): Promise<void>}> {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, {"content-type": "application/json"});
    response.end(body);
  });
  await new Promise<void>((done) => { server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {port: address.port, requests: () => requests, close: () => new Promise<void>((done) => { server.close(() => { done(); }); })};
}

const HOSTILE_BODY = String.raw`{"name":"Ada","tags":["one"],"extra":"client-controlled","__proto__":{"polluted":"yes"}}`;

test("velar/http reads a body into the declared shape through the typed decode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-closeout-http-"));
  const server = await origin(HOSTILE_BODY);
  try {
    const {http, types} = await httpWithType<{Profile: ParseType}>(directory, PROFILE);
    const url = `http://127.0.0.1:${server.port}/profile`;
    // Both surfaces answer `parse`: the request delegates to its response, and
    // the response is where the decode happens.
    const direct = await http.http.get(url).parse<Record<string, unknown>>(types.Profile);
    const viaResponse = await (await http.http.get(url).response()).parse<Record<string, unknown>>(types.Profile);
    for (const [label, parsed] of [["request", direct], ["response", viaResponse]] as const) {
      assert.deepEqual(Reflect.ownKeys(parsed), ["name", "tags"], `${label} strips undeclared keys`);
      assert.equal(Object.getPrototypeOf(parsed), Object.prototype, `${label} lands the record on Object.prototype`);
      assert.equal(Object.hasOwn(parsed, "__proto__"), false, `${label} drops a literal '__proto__' field`);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    // Skipping the owned-data rebuild is invisible: the typed read answers what
    // parsing the untyped read answers, and shares nothing with it.
    const untyped = await http.http.get(url).json() as Record<string, unknown>;
    assert.deepEqual(direct, types.Profile.parse(untyped));
    assert.equal(Object.getPrototypeOf(untyped), null, "the untyped read still hands back owned data");
    assert.notEqual(direct.tags, untyped.tags);
    (direct.tags as string[]).push("written by the caller");
    assert.equal((untyped.tags as string[]).length, 1);
    // The request-level `parse` reads the Type before it reaches the wire, so a
    // value that is not a runtime Type still costs no request. Routing the read
    // through the response must not move that check behind the await.
    const before = server.requests();
    await assert.rejects(http.http.get(url).parse({parse: (value: unknown) => value}), /compiler-known VelarScript runtime type/u);
    assert.equal(server.requests(), before, "an invalid Type is refused before the request is sent");
  } finally {
    await server.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test("the typed decode keeps every strict-JSON budget the untyped decode enforces", async () => {
  const cases = [
    // A record nested past the strict-JSON depth ceiling, a number the host
    // parser rounds to Infinity, and text that is not JSON at all: the walk the
    // typed decode shares with the untyped one is what rejects each.
    [`{"name":${"[".repeat(129)}${"]".repeat(129)},"tags":[]}`, /cannot exceed 128 nested collections/u],
    ['{"name":1e400,"tags":[]}', /numbers must be finite/u],
    ["not json at all", /Unexpected token|JSON/u],
  ] as const;
  for (const [body, expected] of cases) {
    const directory = await mkdtemp(join(tmpdir(), "velar-closeout-http-"));
    const server = await origin(body);
    try {
      const {http, types} = await httpWithType<{Profile: ParseType}>(directory, PROFILE);
      const url = `http://127.0.0.1:${server.port}/profile`;
      await assert.rejects(http.http.get(url).json(), expected, `the untyped read rejects ${body.slice(0, 24)}`);
      await assert.rejects(http.http.get(url).parse(types.Profile), expected, `the typed read rejects ${body.slice(0, 24)}`);
    } finally {
      await server.close();
      await rm(directory, {recursive: true, force: true});
    }
  }
});

test("the emitted runtimes route every typed read of a decoded text through the typed decode", () => {
  const strictJson = standardModuleSource("velar/json");
  assert.ok(strictJson);
  // The mechanism itself: one validating walk, no rebuild, and the Type is taken
  // here rather than the tree returned, so a value that skipped the rebuild
  // cannot reach anyone but the Type that is about to rebuild it.
  assert.match(strictJson, /function __velarJsonParseTyped\(Type, text, name = "JSON text"\) \{\n {2}return Type\.parse\(__velarJsonDecode\(text, name, false\)\);\n\}/u);
  assert.match(strictJson, /function __velarJsonParse\(text, name = "JSON text"\) \{\n {2}return __velarJsonDecode\(text, name, true\);\n\}/u);

  const nodeHttp = nodeModuleSources.get("velar/http");
  assert.ok(nodeHttp);
  const webHttp = standardModuleSource("velar/http", {}, [velarWebCompilerExtension]);
  assert.ok(webHttp);
  const webStorage = standardModuleSource("velar/storage", {}, [velarWebCompilerExtension]);
  assert.ok(webStorage);
  for (const [name, source, sinks] of [
    ["velar/http (Node)", nodeHttp, 1],
    ["velar/http (Web)", webHttp, 1],
    ["velar/storage", webStorage, 2],
  ] as const) {
    assert.equal((source.match(/__velarJsonParseTyped\(/gu) ?? []).length, sinks + 1, `${name} routes its typed reads through the typed decode`);
    // Close the sink, not the spelling: no typed read may go back to parsing the
    // owned-data rebuild it is about to discard.
    assert.equal(/Type\.parse\(__velarJsonParse\(|Type\.parse\(await this\.json\(\)\)/u.test(source), false, `${name} keeps no discarded rebuild`);
  }
});

interface StorageRuntime {
  readonly storage: {get(key: string, target: ParseType, fallback?: unknown, maxBytes?: number): unknown};
}

/** A synchronous stand-in for the browser storage area velar/storage captures at import. */
function storageArea(entries: ReadonlyMap<string, string>): Record<string, unknown> {
  const items = new Map(entries);
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, String(value)); },
    removeItem: (key: string) => { items.delete(key); },
    clear: () => { items.clear(); },
    key: (index: number) => [...items.keys()][index] ?? null,
    get length() { return items.size; },
  };
}

test("velar/storage reads a stored value into the declared shape through the typed decode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-closeout-storage-"));
  const host = globalThis as Record<string, unknown>;
  const saved = ["localStorage", "sessionStorage", "window", "addEventListener", "removeEventListener"].map((name) => [name, Object.getOwnPropertyDescriptor(host, name)] as const);
  try {
    const area = storageArea(new Map([["profile", HOSTILE_BODY]]));
    host.localStorage = area;
    host.sessionStorage = area;
    host.window = globalThis;
    host.addEventListener ??= () => null;
    host.removeEventListener ??= () => null;

    const compiled = compile(PROFILE.trimStart(), {extensions: [velarWebCompilerExtension]});
    assert.deepEqual(compiled.diagnostics, [], JSON.stringify(compiled.diagnostics));
    assert.ok(compiled.code !== null);
    const wanted = new Set<string>(["velar/storage"]);
    const visit = (name: string): void => {
      for (const dependency of standardModuleDependencies(name, {}, [velarWebCompilerExtension]) ?? []) {
        if (wanted.has(dependency)) continue;
        wanted.add(dependency);
        visit(dependency);
      }
    };
    visit("velar/storage");
    const root = join(directory, "node_modules", "velar");
    await mkdir(root, {recursive: true});
    const exports_: Record<string, string> = {};
    for (const name of wanted) {
      const moduleSource = standardModuleSource(name, {}, [velarWebCompilerExtension]);
      assert.ok(moduleSource, `missing standard module ${name}`);
      const short = name.slice("velar/".length);
      exports_[`./${short}`] = `./${short}.js`;
      await writeFile(join(root, `${short}.js`), moduleSource, "utf8");
    }
    await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
    await writeFile(join(directory, "types.mjs"), compiled.code, "utf8");
    const stamp = Date.now();
    const {Profile} = await import(`${pathToFileURL(join(directory, "types.mjs")).href}?closeout=${stamp}`) as {Profile: ParseType};
    const storage = await import(`${pathToFileURL(join(root, "storage.js")).href}?closeout=${stamp}`) as StorageRuntime;

    const read = storage.storage.get("profile", Profile, null) as Record<string, unknown>;
    assert.deepEqual(Reflect.ownKeys(read), ["name", "tags"]);
    assert.equal(Object.getPrototypeOf(read), Object.prototype);
    assert.equal(Object.hasOwn(read, "__proto__"), false);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    // The fallback path is unchanged: a stored value the Type rejects reads back
    // as the fallback rather than as the decoded text.
    assert.equal(storage.storage.get("missing", Profile, "fallback"), "fallback");
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor === undefined) delete host[name];
      else Object.defineProperty(host, name, descriptor);
    }
    await rm(directory, {recursive: true, force: true});
  }
});
