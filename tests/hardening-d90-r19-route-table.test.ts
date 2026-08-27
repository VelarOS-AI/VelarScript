import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compileProject } from "../packages/cli/src/project.ts";
import { standardModuleDependencies, standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import type { VariableDeclaration } from "../packages/compiler/src/ast.ts";
import { bindingNeverReassigned } from "../packages/compiler/src/binding-stability.ts";
import { Lexer } from "../packages/compiler/src/lexer.ts";
import { Parser } from "../packages/compiler/src/parser.ts";
import { nodeModuleDependencies, nodeModuleSources, velarNodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { ROUTE_SHAPE_FROM_SEGMENTS_SOURCE, routeShape, routeShapeFromSegments } from "../packages/node/src/route-shape.ts";
import { VELAR_NODE_SERVE_RUNTIME } from "../packages/node/src/serve-runtime.ts";

// D90 R19: what compile time can decide, compile time decides — the analyzer
// learns the path-preserving velar/serve combinators; what it cannot, the
// runtime decides at assembly, loudly and by name; and both referees judge
// with the one shape definition in packages/node/src/route-shape.ts.

let moduleCounter = 0;

async function diagnose(source: string): Promise<string[]> {
  moduleCounter += 1;
  const path = join(tmpdir(), `velar-r19-route-table-${process.pid}-${moduleCounter}.vel`);
  const project = await compileProject(path, new Map([[path, source.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  return project.modules.flatMap((module) => module.result.diagnostics.map((item) => item.message));
}

test("prefix with a literal path enters the static overlap check at the translated address", async () => {
  const diagnostics = await diagnose(`
import {prefix, json} from "velar/serve"

server routes:
    @get(p"/health" as path) => json({ok: true})

server app:
    ...prefix("/api", routes)
    @get(p"/api/health" as path) => json({ok: false})
`);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!, /GET \/api\/health.*composed in from 'routes'/u);
});

test("every path-preserving combinator carries the composed routes through", async () => {
  const wrappers = [
    "use(routes, [mw])",
    "bodyLimit(routes, 1024)",
    "docs(routes)",
    "lifecycle(routes, startup=async () => null)",
  ];
  for (const wrapper of wrappers) {
    const diagnostics = await diagnose(`
import {use, bodyLimit, docs, lifecycle, json, Request, ServeResponse} from "velar/serve"

async def mw(request: Request, next: () -> Promise<ServeResponse>) -> ServeResponse:
    return await next()

server routes:
    @get(p"/health" as path) => json({ok: true})

server app:
    ...${wrapper}
    @get(p"/health" as path) => json({ok: false})
`);
    assert.equal(diagnostics.length, 1, wrapper);
    assert.match(diagnostics[0]!, /GET \/health.*composed in from 'routes'/u, wrapper);
  }
});

test("combinators nest, and prefixes accumulate outside-in", async () => {
  const diagnostics = await diagnose(`
import {prefix, use, json, Request, ServeResponse} from "velar/serve"

async def mw(request: Request, next: () -> Promise<ServeResponse>) -> ServeResponse:
    return await next()

server inner:
    @get(p"/health" as path) => json({ok: true})

server mid:
    ...prefix("/v1", inner)

server app:
    ...use(prefix("/api", mid), [mw])
    @get(p"/api/v1/health" as path) => json({ok: false})
`);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!, /GET \/api\/v1\/health.*composed in from 'mid' → 'inner'/u);
});

test("an alias of a combinator call resolves exactly as the spelled-out spread", async () => {
  // The example fixed and the class left open would be `...prefix(...)` seen
  // through while `const scoped = prefix(...)` stays invisible; the alias's
  // initializer re-enters the same resolver instead.
  const diagnostics = await diagnose(`
import {prefix, json} from "velar/serve"

server routes:
    @get(p"/health" as path) => json({ok: true})

const scoped = prefix("/api", routes)

server app:
    ...scoped
    @get(p"/api/health" as path) => json({ok: false})
`);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!, /GET \/api\/health.*composed in from 'routes'/u);
});

test("a computed prefix path contributes nothing; the assembly referee owns it", async () => {
  // A false conflict must never block a correct program: which paths this
  // spread claims is only knowable when the value takes shape at run time.
  const diagnostics = await diagnose(`
import {prefix, json} from "velar/serve"

const scope = "/api"

server routes:
    @get(p"/health" as path) => json({ok: true})

server app:
    ...prefix(scope, routes)
    @get(p"/api/health" as path) => json({ok: false})
`);
  assert.deepEqual(diagnostics, []);
});

test("only a callee that reaches the velar/serve import is a combinator", async () => {
  // A module-local function spelled `prefix` is somebody else's idea; claiming
  // its argument's routes would report conflicts against a table it may never
  // build.
  const diagnostics = await diagnose(`
import {ServeApp, json} from "velar/serve"

def prefix(path: string, app: ServeApp) -> ServeApp:
    return app

server routes:
    @get(p"/health" as path) => json({ok: true})

server app:
    ...prefix("/api", routes)
    @get(p"/api/health" as path) => json({ok: false})
`);
  assert.deepEqual(diagnostics, []);
});

test("a root prefix composes untranslated", async () => {
  const diagnostics = await diagnose(`
import {prefix, json} from "velar/serve"

server routes:
    @get(p"/health" as path) => json({ok: true})

server app:
    ...prefix("/", routes)
    @get(p"/health" as path) => json({ok: false})
`);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!, /GET \/health.*composed in from 'routes'/u);
});

test("a fallback seen through a prefix reports the global-policy boundary once", async () => {
  // @notFound 是最终服务器的全局策略，不能被 prefix 伪装成局部策略。
  // 编译期应直接说明这个边界，而不是把它误报成两个 fallback 冲突。
  const diagnostics = await diagnose(`
import {prefix, json, Request} from "velar/serve"

server routes:
    @get(p"/health" as path) => json({ok: true})
    @notFound(request: Request) => {error: "routes"}

server app:
    ...prefix("/api", routes)
    @notFound(request: Request) => {error: "app"}
`);
  assert.deepEqual(diagnostics, [
    "prefix cannot scope @notFound; compose the fallback on the final server instead",
  ]);
});

test("a let alias reassigned or shadowed anywhere stays out of the static check", async () => {
  // The stable half — a never-reassigned `let` resolving like a `const` — is
  // pinned in node-server-framework.test.ts; these are the conservative NOs.
  const throughFunction = await diagnose(`
import {json} from "velar/serve"

server base:
    @get(p"/health" as path) => json({ok: true})

server extra:
    @get(p"/other" as path) => json({ok: true})

let other = base

def rebind():
    other = extra
    return null

server app:
    ...other
    @get(p"/health" as path) => json({ok: false})
`);
  assert.deepEqual(throughFunction, []);

  const shadowedByParameter = await diagnose(`
import {json} from "velar/serve"

server base:
    @get(p"/health" as path) => json({ok: true})

let other = base

def read(other: number) -> number:
    return other

server app:
    ...other
    @get(p"/health" as path) => json({ok: false})
`);
  assert.deepEqual(shadowedByParameter, []);
});

test("the binding-stability predicate is conservative and decidable", () => {
  const stability = (source: string, name: string): boolean => {
    const lexed = new Lexer(source.trimStart()).lex();
    const parsed = new Parser(lexed.tokens).parse();
    assert.deepEqual([...lexed.diagnostics, ...parsed.diagnostics], []);
    const declaration = parsed.program.body.find((statement): statement is VariableDeclaration =>
      statement.kind === "VariableDeclaration" && statement.pattern.kind === "NameBindingPattern" && statement.pattern.name === name);
    assert.ok(declaration && declaration.pattern.kind === "NameBindingPattern");
    return bindingNeverReassigned(parsed.program, name, declaration.pattern.span);
  };

  assert.equal(stability(`let a = 1\nconst b = a\n`, "a"), true);
  assert.equal(stability(`let a = 1\na = 2\n`, "a"), false);
  assert.equal(stability(`let a = 1\na += 2\n`, "a"), false);
  assert.equal(stability(`let a = 1\ndef f() -> null:\n    a = 2\n    return null\n`, "a"), false);
  assert.equal(stability(`let a = 1\ndef f() -> number:\n    const a = 2\n    return a\n`, "a"), false);
  assert.equal(stability(`let a = 1\ndef f(a: number) -> number:\n    return a\n`, "a"), false);
  assert.equal(stability(`let a = [1]\nfor a, index in [1, 2]:\n    pass\n`, "a"), false);
  // Reads, member writes, and field keys are not rebindings.
  assert.equal(stability(`let a = {n: 1}\na.n = 2\nconst b = {a: 3}\nprint(a)\n`, "a"), true);
  assert.equal(stability(`let a = 1\nlet c = 2\nc = a\n`, "a"), true);
});

// ---------------------------------------------------------------------------
// R19(c): one shape definition for both referees.

test("the analyzer and the emitted runtime share one route-shape definition", () => {
  // The runtime template interpolates the exact compiled source of the shared
  // core, so the rule is written once.
  assert.ok(VELAR_NODE_SERVE_RUNTIME.includes(ROUTE_SHAPE_FROM_SEGMENTS_SOURCE));
  const embedded = (0, eval)(`(${ROUTE_SHAPE_FROM_SEGMENTS_SOURCE})`) as (segments: readonly string[]) => string;
  const corpus = [
    "/",
    "/health",
    "/a/{x:string}",
    "/a/{x:string}/b",
    "/{a:string}/{b:bool}",
    "/api/v1/a/{id:number}",
    "/users/me",
    "/trailing/",
    "/a//b",
    "/{}",
    "/x/{broken",
    "/x/broken}",
    "/{x:string}suffix",
  ];
  for (const path of corpus) {
    const segments = path.split("/");
    assert.equal(embedded(segments), routeShape(path), `runtime shape of ${path}`);
    assert.equal(routeShapeFromSegments(segments), routeShape(path), `analyzer shape of ${path}`);
  }
});

// ---------------------------------------------------------------------------
// R19(b): the runtime referee judges the final table at assembly and names
// both routes and both origins. No listening port is involved: assembly is
// where the table first exists in full.

async function runtime<T>(name: string): Promise<T> {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  const directory = await mkdtemp(join(tmpdir(), "velar-node-runtime-"));
  await materializeNodeRuntimeDependencies(directory, name);
  const path = join(directory, `${name.slice("velar/".length)}.mjs`);
  await writeFile(path, source, "utf8");
  const module = await import(`${pathToFileURL(path).href}?test=${Date.now()}`) as T;
  await rm(directory, { recursive: true, force: true });
  return module;
}

async function materializeNodeRuntimeDependencies(directory: string, source: string): Promise<void> {
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
    await writeFile(join(root, `${name}.js`), moduleSource, "utf8");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({name: "velar", private: true, type: "module", exports: exports_}), "utf8");
}

interface ServeBridge {
  createPattern(source: Record<string, unknown>): unknown;
  createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
}

test("assembly rejects a statically invisible overlap naming both routes and both origins", async () => {
  const serveRuntime = await runtime<{readonly ServeApp: object; prefix(path: string, app: unknown): unknown}>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(serveRuntime.ServeApp, "__velarCompilerBridge")?.value as ServeBridge | undefined;
  assert.ok(bridge);
  const pattern = (definition: string, captures: readonly Record<string, unknown>[] = []) => bridge.createPattern({
    definition,
    pathname: definition,
    path: captures,
    query: [],
  });

  // A prefix whose path only takes shape at run time is exactly what the
  // static check let through; the final table still refuses to assemble.
  const routes = bridge.createApp("routes", [bridge.createRoute("GET", pattern("/health"), [], async () => ({ok: true}))]);
  const scoped = serveRuntime.prefix("/" + "api", routes);
  const direct = bridge.createRoute("GET", pattern("/api/health"), [], async () => ({ok: false}));
  assert.throws(() => bridge.createApp("app", [scoped, direct]), (error: unknown) => {
    const message = String((error as Error).message);
    assert.match(message, /^ServeApp 'app' contains conflicting routes: /u);
    assert.match(message, /'GET \/api\/health' declared by this server/u);
    assert.match(message, /'GET \/api\/health' composed in from 'routes'/u);
    assert.match(message, /both answer 'GET \/api\/health'/u);
    return true;
  });

  // Two spellings of one shape: the message names both actual paths, because
  // the shape key alone cannot tell the author which routes collided.
  const stringCapture = {name: "x", wireName: "x", explicitWireName: false, typeName: "string", optional: false, kind: "string", check: (value: unknown) => typeof value === "string", schema: {type: "string"}};
  const numberCapture = {name: "x", wireName: "x", explicitWireName: false, typeName: "number", optional: false, kind: "number", check: (value: unknown) => typeof value === "number", schema: {type: "number"}};
  const left = bridge.createApp("left", [bridge.createRoute("GET", pattern("/a/{x:string}", [stringCapture]), [], async () => null)]);
  const right = bridge.createApp("right", [bridge.createRoute("GET", pattern("/a/{x:number}", [numberCapture]), [], async () => null)]);
  assert.throws(() => bridge.createApp("app", [left, right]), (error: unknown) => {
    const message = String((error as Error).message);
    assert.match(message, /'GET \/a\/\{x:number\}' composed in from 'right'/u);
    assert.match(message, /'GET \/a\/\{x:string\}' composed in from 'left'/u);
    assert.match(message, /both answer 'GET \/a\/\{\}'/u);
    return true;
  });
});
