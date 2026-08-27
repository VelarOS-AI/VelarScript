import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {pathToFileURL} from "node:url";
import {compileProject} from "../packages/cli/src/project.ts";
import {standardModuleDependencies, standardModuleSource} from "../packages/cli/src/standard-modules.ts";
import {nodeModuleDependencies, nodeModuleSources, velarNodeCompilerExtension} from "../packages/node/src/compiler.ts";

type Capture = {
  readonly name: string;
  readonly wireName: string;
  readonly explicitWireName: boolean;
  readonly typeName: string;
  readonly optional: boolean;
  readonly kind: "string" | "number" | "bool" | "enum";
  readonly check: (value: unknown) => boolean;
  readonly schema: Readonly<Record<string, unknown>>;
};

type Bridge = {
  createPattern(source: Record<string, unknown>): unknown;
  createRoute(method: string, pattern: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
  createNotFound(handler: (...arguments_: never[]) => Promise<unknown>): unknown;
  createResponse(handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
};

type ServeRuntime = {
  readonly ServeApp: object;
  readonly HttpProblem: new (options: Record<string, unknown>) => Error;
  serve(app: unknown, port: number): Promise<{readonly port: number; stop(): Promise<null>}>;
  openapi(app: unknown, title?: string, version?: string): {readonly paths: Record<string, unknown>};
};

async function serveRuntime(): Promise<ServeRuntime> {
  const source = nodeModuleSources.get("velar/serve");
  assert.ok(source);
  const directory = await mkdtemp(join(tmpdir(), "velar-route-v2-runtime-"));
  const dependencies = new Set<string>();
  const visit = (name: string): void => {
    for (const dependency of nodeModuleDependencies.get(name) ?? standardModuleDependencies(name) ?? []) {
      if (dependencies.has(dependency)) continue;
      dependencies.add(dependency);
      visit(dependency);
    }
  };
  visit("velar/serve");
  const root = join(directory, "node_modules", "velar");
  await mkdir(root, {recursive: true});
  const exports_: Record<string, string> = {};
  for (const dependency of dependencies) {
    const moduleSource = nodeModuleSources.get(dependency) ?? standardModuleSource(dependency);
    assert.ok(moduleSource);
    const name = dependency.slice("velar/".length);
    exports_[`./${name}`] = `./${name}.js`;
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
  const path = join(directory, "serve.mjs");
  await writeFile(path, source, "utf8");
  const loaded = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as ServeRuntime;
  await rm(directory, {recursive: true, force: true});
  return loaded;
}

function capture(name: string, kind: Capture["kind"], optional = false, wireName = name, explicitWireName = wireName !== name): Capture {
  const typeName = kind;
  const check = kind === "number" ? (value: unknown) => typeof value === "number"
    : kind === "bool" ? (value: unknown) => typeof value === "boolean"
      : (value: unknown) => typeof value === "string";
  const schema = kind === "number" ? {type: "number"} : kind === "bool" ? {type: "boolean"} : {type: "string"};
  return {name, wireName, explicitWireName, typeName, optional, kind, check, schema};
}

function pattern(bridge: Bridge, definition: string, pathname: string, path: readonly Capture[] = [], query: readonly Capture[] = []): unknown {
  return bridge.createPattern({definition, pathname, path, query});
}

test("RoutePattern binds aliases and requiredness before invoking a handler", async () => {
  const runtime = await serveRuntime();
  const bridge = Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as Bridge | undefined;
  assert.ok(bridge);
  let calls = 0;
  const articlePattern = pattern(
    bridge,
    "/articles/{articleId:number}?{details:bool?}&page-size={limit:number}&page={page:number?}",
    "/articles/{articleId:number}",
    [capture("articleId", "number")],
    [capture("details", "bool", true), capture("limit", "number", false, "page-size"), capture("page", "number", true, "page", true)],
  );
  const route = bridge.createRoute("GET", articlePattern, [], async (path: {
    readonly pattern: {toString(): string};
    readonly pathname: string;
    readonly params: {readonly articleId: number};
    readonly query: {readonly details?: boolean; readonly limit: number; readonly page?: number};
    toString(): string;
  }) => {
    calls += 1;
    return {definition: String(path.pattern), rendered: String(path), id: path.params.articleId, details: path.query.details ?? false, limit: path.query.limit, page: path.query.page ?? 1};
  });
  const app = bridge.createApp("routes", [route]);
  const document = runtime.openapi(app);
  const parameters = (document.paths["/articles/{articleId}"] as {get: {parameters: unknown[]}}).get.parameters;
  assert.deepEqual(JSON.parse(JSON.stringify(parameters)), [
    {name: "articleId", in: "path", required: true, schema: {type: "number"}},
    {name: "details", in: "query", required: false, schema: {type: "boolean"}},
    {name: "page-size", in: "query", required: true, schema: {type: "number"}},
    {name: "page", in: "query", required: false, schema: {type: "number"}},
  ]);
  const validation = (document.paths["/articles/{articleId}"] as {get: {responses: Record<string, {content?: Record<string, unknown>}>}}).get.responses["422"];
  assert.ok(validation?.content?.["application/problem+json"]);

  const server = await runtime.serve(app, 0);
  try {
    const accepted = await fetch(`http://127.0.0.1:${server.port}/articles/42?page-size=8&details=true&page=2`);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      definition: "/articles/{articleId:number}?{details:bool?}&page-size={limit:number}&page={page:number?}",
      rendered: "/articles/{articleId:number}?{details:bool?}&page-size={limit:number}&page={page:number?}",
      id: 42,
      details: true,
      limit: 8,
      page: 2,
    });

    const missing = await fetch(`http://127.0.0.1:${server.port}/articles/42`);
    assert.equal(missing.status, 422);
    assert.equal(missing.headers.get("content-type"), "application/problem+json; charset=utf-8");
    assert.deepEqual(await missing.json(), {
      type: "about:blank",
      title: "Request validation failed",
      status: 422,
      code: "request.missing.parameter",
      instance: "/articles/42",
      source: "parameter",
      parameter: "page-size",
    });
    assert.equal(calls, 1, "a missing required field must not enter the handler");

    const duplicate = await fetch(`http://127.0.0.1:${server.port}/articles/42?page-size=8&page-size=9`);
    assert.equal(duplicate.status, 422);
    assert.equal((await duplicate.json()).code, "request.duplicate.parameter");
    assert.equal(calls, 1);

    const unacceptable = await fetch(`http://127.0.0.1:${server.port}/articles/42?page-size=8`, {headers: {accept: "text/plain"}});
    assert.equal(unacceptable.status, 406);
    assert.equal((await unacceptable.json()).code, "response.not_acceptable");
  } finally {
    await server.stop();
  }
});

test("one @response policy maps framework successes and failures exactly once", async () => {
  const runtime = await serveRuntime();
  const bridge = Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as Bridge | undefined;
  assert.ok(bridge);
  let policyCalls = 0;
  const required = pattern(bridge, "/required?{limit:number}", "/required", [], [capture("limit", "number")]);
  const route = bridge.createRoute("GET", required, [], async () => ({name: "ok"}));
  const failure = bridge.createRoute("GET", pattern(bridge, "/failure", "/failure"), [], async () => {
    throw new runtime.HttpProblem({status: 409, code: "article.conflict", title: "Article conflict"});
  });
  const defaultTitle = bridge.createRoute("GET", pattern(bridge, "/default-title", "/default-title"), [], async () => {
    throw new runtime.HttpProblem({status: 410, code: "article.gone"});
  });
  const envelopeSchema = {type: "object", properties: {ok: {type: "boolean"}}, required: ["ok"], additionalProperties: true};
  const response = bridge.createResponse(async (outcome: {readonly status: number; readonly value: unknown; readonly problem: {readonly code: string} | null}) => {
    policyCalls += 1;
    return outcome.problem === null ? {ok: true, data: outcome.value} : {ok: false, error: outcome.problem.code};
  }, {responseSchema: envelopeSchema, responseContentTypes: ["application/json"]});
  const app = bridge.createApp("policy", [route, failure, defaultTitle, response]);
  assert.throws(() => bridge.createApp("duplicate", [response, response]), /more than one @response policy/u);
  const document = runtime.openapi(app);
  const operation = document.paths["/required"] as {get: {responses: Record<string, {content?: Record<string, {schema: unknown}>}>}};
  assert.deepEqual(JSON.parse(JSON.stringify(operation.get.responses["200"]?.content?.["application/json"]?.schema)), envelopeSchema);
  assert.deepEqual(JSON.parse(JSON.stringify(operation.get.responses["422"]?.content?.["application/json"]?.schema)), envelopeSchema);
  assert.equal(operation.get.responses["422"]?.content?.["application/problem+json"], undefined);
  const server = await runtime.serve(app, 0);
  try {
    const success = await fetch(`http://127.0.0.1:${server.port}/required?limit=3`);
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {ok: true, data: {name: "ok"}});

    const invalid = await fetch(`http://127.0.0.1:${server.port}/required`);
    assert.equal(invalid.status, 422);
    assert.deepEqual(await invalid.json(), {ok: false, error: "request.missing.parameter"});

    const conflict = await fetch(`http://127.0.0.1:${server.port}/failure`);
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {ok: false, error: "article.conflict"});

    const gone = await fetch(`http://127.0.0.1:${server.port}/default-title`);
    assert.equal(gone.status, 410);
    assert.deepEqual(await gone.json(), {ok: false, error: "article.gone"});

    const missing = await fetch(`http://127.0.0.1:${server.port}/missing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {ok: false, error: "route.not_found"});

    const method = await fetch(`http://127.0.0.1:${server.port}/failure`, {method: "POST"});
    assert.equal(method.status, 405);
    assert.deepEqual(await method.json(), {ok: false, error: "route.method_not_allowed"});
    assert.equal(policyCalls, 6);
  } finally {
    await server.stop();
  }
});

test("@response distinguishes a null representation from no mapping", async () => {
  const runtime = await serveRuntime();
  const bridge = Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as Bridge | undefined;
  assert.ok(bridge);
  const route = bridge.createRoute("GET", pattern(bridge, "/null", "/null"), [], async () => ({ignored: true}));
  const response = bridge.createResponse(async () => null, {
    responseSchema: {type: "null"},
    responseContentTypes: ["application/json"],
  });
  const server = await runtime.serve(bridge.createApp("null-policy", [route, response]), 0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.port}/null`);
    assert.equal(result.status, 200);
    assert.equal(await result.text(), "null");
  } finally {
    await server.stop();
  }
});

test("a failing @response policy is never invoked twice", async () => {
  const runtime = await serveRuntime();
  const bridge = Object.getOwnPropertyDescriptor(runtime.ServeApp, "__velarCompilerBridge")?.value as Bridge | undefined;
  assert.ok(bridge);
  let calls = 0;
  const route = bridge.createRoute("GET", pattern(bridge, "/failure", "/failure"), [], async () => ({ok: true}));
  const response = bridge.createResponse(async () => {
    calls += 1;
    throw new Error("policy failed");
  });
  const server = await runtime.serve(bridge.createApp("failed-policy", [route, response]), 0);
  try {
    const result = await fetch(`http://127.0.0.1:${server.port}/failure`);
    assert.equal(result.status, 500);
    assert.equal((await result.json()).code, "server.response_policy");
    assert.equal(calls, 1);
  } finally {
    await server.stop();
  }
});

test("exported RoutePattern catalogs remain statically typed across modules", async () => {
  const root = join(tmpdir(), `velar-route-catalog-${process.pid}`);
  const catalog = join(root, "catalog.vel");
  const app = join(root, "app.vel");
  const project = await compileProject(app, new Map([
    [catalog, `
export type ArticleId = number

export enum Visibility:
    public = "published"
    private = "restricted"

export const apiPaths = {
    article: p"/articles/{articleId:ArticleId}?include-details={details:bool?}&{visibility:Visibility?}",
}
`.trimStart()],
    [app, `
import {apiPaths} from "./catalog.vel"

export server routes:
    @get(apiPaths.article as path) => {
        definition: str(path.pattern),
        articleId: path.params.articleId,
        details: path.query.details,
        visibility: path.query.visibility,
    }
`.trimStart()],
  ]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  const catalogCode = project.modules.find((module) => module.inputPath === catalog)?.result.code ?? "";
  const appCode = project.modules.find((module) => module.inputPath === app)?.result.code ?? "";
  assert.match(catalogCode, /export const apiPaths = \{ article: __velarCreateServePattern/u);
  assert.match(catalogCode, /name:"articleId"[^\n]*kind:"number"[^\n]*schema:\{"type":"number"\}/u);
  assert.match(catalogCode, /name:"visibility"[^\n]*kind:"enum"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);
  assert.match(appCode, /__velarCreateServeRoute\("GET", apiPaths\.article/u);
  assert.match(appCode, /path\.pattern/u);
  assert.match(appCode, /path\.params\.articleId/u);
  assert.match(appCode, /path\.query\.details/u);
  assert.match(appCode, /path\.query\.visibility/u);
});
