import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "@velarscript/compiler";
import { velarNodeCompilerExtension } from "@velarscript/node/compiler";
import { compileNode } from "../support/node-compile.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,012-line
 * `node-server-framework.test.ts`. Every test here is the one that was there,
 * moved verbatim.
 *
 * The subject is `server` syntax as the compiler owns it: what an anonymous
 * route lowers to, what the formatter does with it, and the fact that a route
 * name is compiler-owned rather than a value a program can reach.
 */

test("Node server syntax lowers anonymous async routes without decorator functions", () => {
  const source = `
type CreateUser:
    name: string

type User:
    id: string
    name: string

export server api:
    /// Reports whether the service is ready.
    @get(p"/health" as path) => {ok: true}

    @get(p"/users/{id:number}?{details:bool?}" as path) -> User:
        return {id: str(path.params.id), name: (path.query.details ?? false) ? "full" : "short"}

    @post(p"/users" as path, input: CreateUser):
        return {id: "u1", name: input.name}

    @notFound() => {error: "route_not_found"}
`;
  const result = compileNode(source);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /export const api = __velarCreateServeApp\("api"/u);
  assert.match(code, /__velarCreateServeRoute\("GET", __velarCreateServePattern\(\{definition:"\/health"/u);
  assert.match(code, /description:"Reports whether the service is ready\."\}, true\)/u);
  assert.match(code, /definition:"\/users\/\{id:number\}\?\{details:bool\?\}"/u);
  assert.match(code, /path:\[\{name:"id"[^\n]*kind:"number"/u);
  assert.match(code, /query:\[\{name:"details"[^\n]*optional:true[^\n]*kind:"bool"/u);
  assert.match(code, /async \(path\)/u);
  assert.match(code, /source:"body",kind:"data"/u);
  assert.match(code, /__velarCreateServeNotFound\(async \(\)/u);
  assert.match(code, /schema:\{"type":"object","properties":\{"name":\{"type":"string"\}\},"required":\["name"\],"additionalProperties":false\}/u);
  assert.match(code, /responseSchema:/u);
  assert.match(code, /description:"Reports whether the service is ready\."/u);
  assert.doesNotMatch(code, /function health|function getUser|function createUser/u);

  const unusedRouteMatch = compileNode(`server api:\n    @get(p"/health") => {ok: true}\n`);
  assert.deepEqual(unusedRouteMatch.diagnostics, []);
  assert.match(unusedRouteMatch.code ?? "", /definition:"\/health"[^\n]*\[\], async \(\) =>/u);
  assert.match(unusedRouteMatch.code ?? "", /description:null\}, false\)/u);

  const formatted = formatSource(source.trimStart(), { extensions: [velarNodeCompilerExtension] });
  assert.match(formatted, /@get\(p"\/health" as path\) => \{ok: true\}/u);
  assert.match(formatted, /@notFound\(\) => \{error: "route_not_found"\}/u);
  assert.equal(formatSource(formatted, { extensions: [velarNodeCompilerExtension] }), formatted);
});

test("compiler-owned route names are not decorators or top-level values", () => {
  const result = compileNode(`
@get(p"/health" as path)
def health():
    return {ok: true}
`);
  assert.ok(result.diagnostics.some((item) => /valid only directly inside a server block/u.test(item.message)));
});
