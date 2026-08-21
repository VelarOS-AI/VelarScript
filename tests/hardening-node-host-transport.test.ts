import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { nodeModuleDependencies, nodeModuleSources, VELAR_NODE_HOST_MODULE } from "../packages/node/src/compiler.ts";

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
    // A Node runtime module may depend on a compiler-owned Core runtime module
    // (D50 rule 89 put the nameable capability error classes there), so the
    // materializer resolves both registries.
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource, `missing Node runtime dependency ${dependency}`);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), transform(dependency, moduleSource), "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}

test("a mid-body transport failure on bytes() rejects only that request", async () => {
  const http = await runtime<{
    readonly HttpTransportError: new (message: string, phase: string) => Error & { readonly phase: string };
    readonly HttpTransportPhase: Readonly<{ readonly request: "request"; readonly response: "response" }>;
    readonly http: {
      get(url: string, options?: Record<string, unknown>): {
        bytes(): Promise<{ readonly size: number }>;
        text(): Promise<string>;
      };
    };
  }>("velar/http");
  const server = createServer((request, response) => {
    if (request.url === "/transport-response") {
      response.writeHead(200, { "content-length": "100", "content-type": "text/plain" });
      response.flushHeaders();
      response.write("partial");
      setTimeout(() => response.socket?.destroy(), 10);
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("healthy");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    await assert.rejects(
      http.http.get(`${base}/transport-response`, { timeout: 0 }).bytes(),
      (error: unknown) => error instanceof http.HttpTransportError
        && error.phase === http.HttpTransportPhase.response
        && error.message === "HTTP response transport failed",
    );
    // The host must not have latched a permanent failure: the byte read is a
    // per-request rejection, not transport corruption.
    assert.equal(await http.http.get(`${base}/healthy`).text(), "healthy");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the Node host proxy rebuilds byte-read transport errors and never fails the whole host", () => {
  const source = nodeModuleSources.get(VELAR_NODE_HOST_MODULE);
  assert.ok(source, "the shared Node host module must have a runtime source");
  const start = source.indexOf("function __velarNodeHostErrorOf(");
  assert.ok(start >= 0, "the shared Node host module must define __velarNodeHostErrorOf");
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, "__velarNodeHostErrorOf must be a complete function");
  const errorOf = source.slice(start, end);
  assert.match(errorOf, /operation !== "http\.readBytes"/u);
  assert.doesNotMatch(errorOf, /\bthrow\b/u);
  // A byte read carries a request handle exactly like http.read does.
  assert.match(source, /const handle = [^;]*operation === "http\.readBytes"/u);
});
