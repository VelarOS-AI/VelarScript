import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { compileNode } from "../support/node-compile.ts";

/**
 * D115 §三 — one subject per file, split out of the 1,012-line
 * `node-server-framework.test.ts`. Every test here is the one that was there,
 * moved verbatim.
 *
 * The subject is the `RoutePattern` literal itself: what a capture projects,
 * what `as` binds, what an enum or a scalar alias decodes to, and where Node's
 * ownership of the pattern string stops and Core's ordinary strings resume.
 */

test("inline RoutePattern captures project directly while 'as' binds the complete match", () => {
  const projected = compileNode(`
server api:
    @get(p"/worlds/{worldId:string}?{details:bool?}") => {worldId, details}
`);
  assert.deepEqual(projected.diagnostics, []);
  assert.match(projected.code ?? "", /async \(\{params:\{worldId\},query:\{details\}\}\) =>/u);

  const bound = compileNode(`
server api:
    @get(p"/worlds/{worldId:string}?{details:bool?}" as route) => {
        pattern: str(route.pattern),
        pathname: route.pathname,
        worldId: route.params.worldId,
        details: route.query.details,
    }
`);
  assert.deepEqual(bound.diagnostics, []);
  assert.match(bound.code ?? "", /async \(route\) =>/u);

  const hidden = compileNode(`
const world = p"/worlds/{worldId:string}"
server api:
    @get(world) => {worldId}
`);
  assert.ok(hidden.diagnostics.some((item) => /cannot introduce hidden names/u.test(item.message)));

  const legacySource = `server api:\n    @get(path=p"/worlds/{worldId:string}") => {worldId: path.params.worldId}\n`;
  const legacy = compileNode(legacySource);
  const positional = legacy.diagnostics.find((item) => /route pattern is positional/u.test(item.message));
  assert.ok(positional?.fix);
  const fixed = applyMechanicalFixes(legacySource, [positional]).text;
  assert.equal(fixed, `server api:\n    @get(p"/worlds/{worldId:string}" as path) => {worldId: path.params.worldId}\n`);
  assert.deepEqual(compileNode(fixed).diagnostics, []);
});

test("A11 shortens a redundant same-name query mapping without rejecting it", () => {
  const source = `server api:\n    @get(p"/articles?details={details:bool?}" as path) => {details: path.query.details}\n`;
  const result = compileNode(source);
  assert.deepEqual(result.diagnostics, []);
  assert.notEqual(result.code, null, "a canonical-form advisory must not block emission");
  assert.deepEqual(result.advisories.map((item) => item.code), ["A11"]);
  assert.equal(result.advisories[0]?.fix?.title, "Use query shorthand '{details:bool?}'");
  assert.equal(
    applyMechanicalFixes(source, result.advisories).text,
    `server api:\n    @get(p"/articles?{details:bool?}" as path) => {details: path.query.details}\n`,
  );

  const intentionalAlias = compileNode(`server api:\n    @get(p"/articles?include-details={details:bool?}" as path) => {details: path.query.details}\n`);
  const shorthand = compileNode(`server api:\n    @get(p"/articles?{details:bool?}" as path) => {details: path.query.details}\n`);
  assert.deepEqual(intentionalAlias.advisories, []);
  assert.deepEqual(shorthand.advisories, []);
});

test("RoutePattern enum captures keep their exact OpenAPI values", () => {
  const result = compileNode(`
enum Visibility:
    public = "published"
    private = "restricted"

server api:
    @get(p"/articles/{visibility:Visibility}?{filter:Visibility?}" as path) => {
        visibility: path.params.visibility,
        filter: path.query.filter,
    }
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /name:"visibility"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);
  assert.match(code, /name:"filter"[^\n]*schema:\{"type":"string","enum":\["published","restricted"\]\}/u);
});

test("RoutePattern scalar aliases keep their decoded runtime kinds", () => {
  const result = compileNode(`
type Identifier = number
type Enabled = bool

server api:
    @get(p"/articles/{id:Identifier}?{enabled:Enabled}" as path) => {
        id: path.params.id,
        enabled: path.query.enabled,
    }
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /name:"id"[^\n]*kind:"number"[^\n]*schema:\{"type":"number"\}/u);
  assert.match(code, /name:"enabled"[^\n]*kind:"bool"[^\n]*schema:\{"type":"boolean"\}/u);
});

test("Node owns and validates path-pattern strings without changing Core strings", () => {
  const fullWidth = compileNode(`server api:\n    @get(p"/articles/{id：string}" as path) => {ok: true}\n`);
  assert.ok(fullWidth.diagnostics.some((item) => /declares its field and type/u.test(item.message)));

  const plain = compileNode(`server api:\n    @get(path="/articles/{id:string}") => {ok: true}\n`);
  assert.ok(plain.diagnostics.some((item) => /route pattern is positional/u.test(item.message)));

  const core = compile(`const path = p"/articles/{id:string}"\n`, { path: "core.vel" });
  assert.ok(core.diagnostics.length > 0);
});
