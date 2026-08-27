import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { nodeModuleDependencies, nodeModuleSources } from "../packages/node/src/compiler.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";

interface AuditCounters {
  readonly routeLookups: number;
  readonly routeMatches: number;
  readonly routeBindings: number;
  readonly jsonStringifies: number;
}

interface TestResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

interface TestClient {
  get(path: string): Promise<TestResponse>;
  close(): Promise<null>;
}

interface ServeBridge {
  createPattern(source: Record<string, unknown>): unknown;
  createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>, bindRoute?: boolean): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
  testClient(app: unknown): Promise<TestClient>;
}

interface ServeRuntime {
  readonly ServeApp: object;
  __performanceAudit(): AuditCounters;
}

/**
 * 性能回归不用极易受 CI 负载影响的毫秒阈值，而是在真实运行时源码里
 * 记录三个可直接表达复杂度的次数。这些计数器只存在于测试生成的临时模块，
 * 不会进入发布产物。
 */
function instrument(source: string): string {
  const counters = `
let __performanceRouteLookups = 0;
let __performanceRouteMatches = 0;
let __performanceRouteBindings = 0;
let __performanceJsonStringifies = 0;
`;
  const withCounters = source.replace("function __velarJsonStringify(value, pretty = false) {", `${counters}function __velarJsonStringify(value, pretty = false) {\n  __performanceJsonStringifies += 1;`)
    .replace("function __velarServeMatch(route, actual) {", "function __velarServeMatch(route, actual) {\n  __performanceRouteMatches += 1;")
    .replace("function __velarServeRouteBinding(pattern, pathname, params, query) {", "function __velarServeRouteBinding(pattern, pathname, params, query) {\n  __performanceRouteBindings += 1;")
    .replace("function __velarServeRouterRoutes(app, method, actual) {", "function __velarServeRouterRoutes(app, method, actual) {\n  __performanceRouteLookups += 1;");
  assert.notEqual(withCounters, source, "serve runtime performance probes must attach to the current implementation");
  return `${withCounters}\nexport function __performanceAudit() { return {routeLookups: __performanceRouteLookups, routeMatches: __performanceRouteMatches, routeBindings: __performanceRouteBindings, jsonStringifies: __performanceJsonStringifies}; }\n`;
}

async function materializeDependencies(directory: string, source: string): Promise<void> {
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit(source);
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
}

async function runtime(): Promise<ServeRuntime> {
  const source = nodeModuleSources.get("velar/serve");
  assert.ok(source);
  const directory = await mkdtemp(join(tmpdir(), "velar-server-performance-"));
  await materializeDependencies(directory, "velar/serve");
  const path = join(directory, "serve.mjs");
  await writeFile(path, instrument(source), "utf8");
  try {
    return await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as ServeRuntime;
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

function bridgeOf(runtime: ServeRuntime): ServeBridge {
  return Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as ServeBridge;
}

function pattern(bridge: ServeBridge, pathname: string): unknown {
  return bridge.createPattern({definition: pathname, pathname, path: [], query: []});
}

function dynamicPattern(bridge: ServeBridge, pathname: string): unknown {
  return bridge.createPattern({
    definition: pathname,
    pathname,
    path: [{
      name: "worldId",
      wireName: "worldId",
      explicitWireName: false,
      typeName: "string",
      optional: false,
      kind: "string",
      check: (value: unknown) => typeof value === "string",
      schema: {type: "string"},
    }],
    query: [],
  });
}

test("server hot route work stays proportional to the matched path instead of the route table", async (t) => {
  const serve = await runtime();
  const bridge = bridgeOf(serve);
  const routeCount = 512;
  const routes = [];
  for (let index = 0; index < routeCount; index += 1) {
    const route = bridge.createRoute("GET", pattern(bridge, `/api/worlds/world-${index}/chunks/current`), [], async () => ({world: index, ok: true}), {}, false);
    routes.push(route);
  }
  const client = await bridge.testClient(bridge.createApp("performance", routes));
  try {
    const before = serve.__performanceAudit();
    const response = await client.get("/api/worlds/world-377/chunks/current");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {world: 377, ok: true});
    const after = serve.__performanceAudit();
    const lookups = after.routeLookups - before.routeLookups;
    const matches = after.routeMatches - before.routeMatches;
    const bindings = after.routeBindings - before.routeBindings;
    const serializations = after.jsonStringifies - before.jsonStringifies;
    t.diagnostic(`${routeCount} same-prefix routes: ${lookups} method lookups, ${matches} candidate matches, ${bindings} request bindings, ${serializations} JSON serializations`);

    // 方法快路只查一次索引，全路径段索引只交给匹配器一个候选项。
    // JSON 在 finalize、测试/传输边界之间复用创建响应时的同一份快照。
    assert.equal(lookups, 1);
    assert.equal(matches, 1);
    assert.equal(bindings, 0);
    assert.equal(serializations, 1);
  } finally {
    await client.close();
  }
});

test("dynamic route parsing is compiled once while each request binds only its values", async () => {
  const serve = await runtime();
  const bridge = bridgeOf(serve);
  const route = bridge.createRoute(
    "GET",
    dynamicPattern(bridge, "/api/worlds/{worldId:string}/chunks"),
    [],
    async (binding: {params: {worldId: string}}) => ({worldId: binding.params.worldId}),
    {},
    true,
  );
  const client = await bridge.testClient(bridge.createApp("dynamic-performance", [route]));
  try {
    const before = serve.__performanceAudit();
    const response = await client.get("/api/worlds/main/chunks");
    assert.deepEqual(await response.json(), {worldId: "main"});
    const after = serve.__performanceAudit();
    assert.equal(after.routeLookups - before.routeLookups, 1);
    assert.equal(after.routeMatches - before.routeMatches, 1);
    assert.equal(after.routeBindings - before.routeBindings, 1);
    assert.equal(after.jsonStringifies - before.jsonStringifies, 1);
  } finally {
    await client.close();
  }
});

test("an explicitly bound static RouteMatch keeps per-request identity", async () => {
  const serve = await runtime();
  const bridge = bridgeOf(serve);
  let previous: unknown = null;
  const route = bridge.createRoute("GET", pattern(bridge, "/identity"), [], async (binding: unknown) => {
    const repeated = binding === previous;
    previous = binding;
    return {repeated};
  });
  const client = await bridge.testClient(bridge.createApp("binding-identity", [route]));
  try {
    const before = serve.__performanceAudit();
    assert.deepEqual(await (await client.get("/identity")).json(), {repeated: false});
    assert.deepEqual(await (await client.get("/identity")).json(), {repeated: false});
    const after = serve.__performanceAudit();
    assert.equal(after.routeBindings - before.routeBindings, 2);
  } finally {
    await client.close();
  }
});
