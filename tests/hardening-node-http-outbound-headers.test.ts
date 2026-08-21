import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources } from "../packages/node/src/compiler.ts";

async function runtime<T>(
  name: string,
  transform: (source: string) => string = (source) => source,
  transformDependency: (name: string, source: string) => string = (_name, source) => source,
): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name, transformDependency);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, transform(source), "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

async function materializeNodeRuntimeDependencies(
  directory: string,
  source: string,
  transform: (name: string, source: string) => string = (_name, value) => value,
): Promise<void> {
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit(source);
  if (dependencies.size === 0) return;
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), transform(dependency, moduleSource), "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}

interface HttpModule {
  readonly http: {
    get(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
    post(url: string, options?: Record<string, unknown>): { text(): Promise<string> };
  };
}

// A transport-owned header must be refused, whether the runtime raises while
// the request is constructed or while it is sent.
async function raisedBy(run: () => { text(): Promise<string> }): Promise<unknown> {
  let request: { text(): Promise<string> };
  try {
    request = run();
  } catch (error) {
    return error;
  }
  try {
    await request.text();
  } catch (error) {
    return error;
  }
  return null;
}

test("Node HTTP refuses transport-controlled outbound header names", async () => {
  const http = await runtime<HttpModule>("velar/http");
  const url = "http://127.0.0.1:1/target";
  const forbidden = [
    "content-length",
    "transfer-encoding",
    "host",
    "connection",
    "expect",
    "keep-alive",
    "proxy-connection",
    "te",
    "trailer",
    "upgrade",
  ];
  for (const name of forbidden) {
    const error = await raisedBy(() => http.http.get(url, { headers: new Map([[name, "4"]]) }));
    assert.ok(error instanceof TypeError, `${name} must be refused with a TypeError`);
    assert.match((error as TypeError).message, new RegExp(`HTTP header '${name}' is transport-controlled`, "u"));
  }
  // The refusal is case-insensitive, and it covers the body-bearing verbs too.
  for (const name of ["Content-Length", "Transfer-Encoding", "HOST"]) {
    const error = await raisedBy(() => http.http.post(url, { headers: new Map([[name, "4"]]), body: "x" }));
    assert.ok(error instanceof TypeError, `${name} must be refused with a TypeError`);
    assert.match((error as TypeError).message, new RegExp(`HTTP header '${name}' is transport-controlled`, "u"));
  }
});

test("Node HTTP still sends ordinary outbound headers verbatim", async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.headers));
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const http = await runtime<HttpModule>("velar/http");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const headers = new Map([
      ["x-tenant", "acme"],
      ["authorization", "Bearer token-value"],
      ["cookie", "session=abc"],
      ["content-type", "text/plain"],
    ]);
    const text = await http.http.post(`http://127.0.0.1:${address.port}/echo`, { headers, body: "payload" }).text();
    const observed = JSON.parse(text) as Record<string, string>;
    assert.equal(observed["x-tenant"], "acme");
    assert.equal(observed["authorization"], "Bearer token-value");
    assert.equal(observed["cookie"], "session=abc");
    assert.equal(observed["content-type"], "text/plain");
    // A JSON body revalidates the header map after the runtime adds its own
    // content-type, so that second pass must not refuse the request either.
    const jsonText = await http.http.post(`http://127.0.0.1:${address.port}/echo`, {
      headers: new Map([["x-tenant", "acme"]]),
      body: { value: 1 },
    }).text();
    const jsonObserved = JSON.parse(jsonText) as Record<string, string>;
    assert.equal(jsonObserved["x-tenant"], "acme");
    assert.equal(jsonObserved["content-type"], "application/json");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

test("the emitted velar/http source declares the transport-owned header set before headersOf", () => {
  const source = nodeModuleSources.get("velar/http");
  assert.ok(source, "velar/http must have a Node runtime source");
  assert.match(source, /const transportOwnedHttpHeaders = setOf\(\[/u);
  const declaration = source.indexOf("const transportOwnedHttpHeaders = setOf([");
  const validator = source.indexOf("function headersOf(");
  assert.ok(declaration >= 0 && validator >= 0);
  assert.ok(declaration < validator, "transportOwnedHttpHeaders must be declared before headersOf");
  assert.match(source, /call\(nativeSetHas, transportOwnedHttpHeaders, \[stringLower\(name\)\]\)/u);
  for (const name of ["connection", "content-length", "expect", "host", "keep-alive", "proxy-connection", "te", "trailer", "transfer-encoding", "upgrade"]) {
    assert.ok(
      source.slice(declaration, source.indexOf("]);", declaration)).includes(`"${name}"`),
      `${name} must be transport-owned`,
    );
  }
  // `cookie`, `cookie2` and `proxy-authorization` stay legal on the ordinary
  // headers map; they are forbidden only as secretHeader names.
  const transportSet = source.slice(declaration, source.indexOf("]);", declaration));
  for (const name of ["cookie", "cookie2", "proxy-authorization"]) {
    assert.ok(!transportSet.includes(`"${name}"`), `${name} must stay legal on the ordinary headers map`);
  }
  assert.match(source, /const forbiddenSecretHeaders = setOf\(\["connection", "content-length", "cookie", "cookie2", "host", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"\]\);/u);
});
