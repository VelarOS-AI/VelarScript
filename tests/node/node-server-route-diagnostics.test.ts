import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { compileProject } from "../../packages/cli/src/project.ts";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { compileNode } from "../support/node-compile.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,012-line
 * `node-server-framework.test.ts`. Every test here is the one that was there,
 * moved verbatim.
 *
 * The subject is the diagnostics one module's routes earn on their own: a
 * contract that has to stay static and unambiguous, and two paths that overlap
 * with no more specific winner between them.
 */

test("Node server diagnostics keep route contracts static and unambiguous", async () => {
  const source = `
type Body:
    value: string

server invalid:
    @get(p"/users/{id:Body}" as path, query: Body):
        return {ok: true}

    @get(p"/users/{name:string}" as path):
        return {ok: true}

    @post(p"/items" as path, first: Body, second: Body):
        return {ok: true}

    @post(p"/untyped" as path, input):
        return {ok: true}
`;
  const messages = compileNode(source).diagnostics.map((item) => item.message);
  assert.ok(messages.some((message) => /GET routes do not infer a JSON body/u.test(message)));
  assert.ok(messages.some((message) => /Route field 'id' must be string, number, bool, or an enum/u.test(message)));
  assert.ok(messages.some((message) => /conflicts with 'GET \/users\/\{id:Body\}'/u.test(message)));
  assert.ok(messages.some((message) => /only one structured JSON body/u.test(message)));
  assert.ok(messages.some((message) => /requires an explicit type/u.test(message)));
  assert.ok(messages.every((message) => !/matching '.*: Type' declaration/u.test(message)));
  const unknown = compileNode(`server api:\n    @head(p"/unsupported") => {ok: true}\n`);
  assert.ok(unknown.diagnostics.some((item) => /Unknown compiler-owned name '@head'/u.test(item.message)));
  const wildcard = compileNode(`server api:\n    @get(p"/files/*" as path) => {ok: true}\n`);
  assert.ok(wildcard.diagnostics.some((item) => /use staticFiles/u.test(item.message)));
  const requestPath = join(tmpdir(), "velar-node-server-request-diagnostic.vel");
  const requestProject = await compileProject(requestPath, new Map([[requestPath, `
import {Request} from "velar/serve"

server api:
    @get(p"/request" as path, first: Request, second: Request) => {ok: true}
    @notFound(request: Request) => {error: "missing", path: request.path}
`.trimStart()]]), { extensions: [velarNodeCompilerExtension] });
  const requestDiagnostics = requestProject.modules.flatMap((module) => module.result.diagnostics);
  assert.ok(requestDiagnostics.some((item) => /only one Request parameter/u.test(item.message)));
  assert.ok(requestDiagnostics.every((item) => !/@notFound/u.test(item.message)));

  const fallbackPath = join(tmpdir(), "velar-node-server-fallback.vel");
  const fallbackProject = await compileProject(fallbackPath, new Map([[fallbackPath, `
import {Request} from "velar/serve"

server api:
    @notFound(request: Request) => {error: "missing", path: request.path}
`.trimStart()]]), {extensions: [velarNodeCompilerExtension]});
  assert.deepEqual(fallbackProject.failures, []);
  assert.deepEqual(fallbackProject.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(fallbackProject.modules.find((module) => module.inputPath === fallbackPath)?.result.code ?? "", /__velarCreateServeNotFound\(async \(request\)/u);

  const duplicateFallback = compileNode(`
server api:
    @notFound() => {error: "missing"}
    @notFound() => {error: "still_missing"}
`);
  const fallbackMessages = duplicateFallback.diagnostics.map((item) => item.message);
  assert.ok(fallbackMessages.some((message) => /only one @notFound fallback/u.test(message)));

  const invalidFallback = compileNode(`
server api:
    @notFound(request) => {error: "missing"}
`);
  assert.ok(invalidFallback.diagnostics.some((item) => /requires the explicit Request type/u.test(item.message)));

  const wrongFallback = compileNode(`
server api:
    @notFound(path: string) => {error: "missing", path}
`);
  assert.ok(wrongFallback.diagnostics.some((item) => /parameter must be Request/u.test(item.message)));

  const scopedPolicies = compileNode(`
import {HttpOutcome, prefix} from "velar/serve"

server child:
    @get(p"/health" as path) => {ok: true}
    @notFound() => {error: "missing"}
    @response(outcome: HttpOutcome) => {ok: outcome.ok}

server api:
    ...prefix("/api", child)
`);
  const scopedMessages = scopedPolicies.diagnostics.map((item) => item.message);
  assert.ok(scopedMessages.some((message) => /prefix cannot scope @notFound/u.test(message)));
  assert.ok(scopedMessages.some((message) => /prefix cannot scope @response/u.test(message)));

  const tooManyQueryFields = Array.from({length: 65}, (_value, index) => `{field${index}:string}`).join("&");
  const bounded = compileNode(`server api:\n    @get(p"/items?${tooManyQueryFields}" as path) => {ok: true}\n`);
  assert.ok(bounded.diagnostics.some((item) => /more than 64 query fields/u.test(item.message)));

  const longWireName = "q".repeat(257);
  const longWire = compileNode(`server api:\n    @get(p"/items?${longWireName}={value:string}" as path) => {ok: true}\n`);
  assert.ok(longWire.diagnostics.some((item) => /wire name cannot exceed 256/u.test(item.message)));

  const longPath = compileNode(`server api:\n    @get(p"/${" as pathx".repeat(4096)}") => {ok: true}\n`);
  assert.ok(longPath.diagnostics.some((item) => /1 through 4096 code units/u.test(item.message)));
});

test("Routes that share a path without a more specific winner are rejected", () => {
  const ambiguous = compileNode(`
server api:
    @get(p"/a/{x:string}/b" as path) => {ok: true}
    @get(p"/a/b/{y:string}" as path) => {ok: true}
`);
  assert.deepEqual(ambiguous.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const captures = compileNode(`
server api:
    @get(p"/a/{x:string}/b/{p:string}" as path) => {ok: true}
    @get(p"/a/b/{y:string}/{q:string}" as path) => {ok: true}
`);
  assert.deepEqual(captures.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b/{p:string}' overlaps 'GET /a/b/{y:string}/{q:string}'; both match '/a/b/b/p' and neither is more specific — narrow or remove one",
  ]);

  const specific = compileNode(`
server api:
    @get(p"/users/me" as path) => {ok: true}
    @get(p"/users/{id:string}" as path) => {ok: true}
    @get(p"/users/{id:string}/settings" as path) => {ok: true}
    @get(p"/users/{id:string}/{section:string}" as path) => {ok: true}
`);
  assert.deepEqual(specific.diagnostics, []);

  const unrealizable = compileNode(`
server api:
    @get(p"/a/{n:number}/b" as path) => {ok: true}
    @get(p"/a/b/{m:string}" as path) => {ok: true}
    @get(p"/a/{f:bool}/c" as path) => {ok: true}
    @get(p"/a/c/{m:string}" as path) => {ok: true}
`);
  assert.deepEqual(unrealizable.diagnostics, []);

  const separate = compileNode(`
server api:
    @get(p"/a/{x:string}" as path) => {ok: true}
    @get(p"/a/b/{y:string}" as path) => {ok: true}
    @post(p"/a/{x:string}/b" as path) => {ok: true}
    @get(p"/a/true/{y:string}" as path) => {ok: true}
`);
  assert.deepEqual(separate.diagnostics.map((item) => item.message), []);
});
