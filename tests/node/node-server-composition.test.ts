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
 * The subject is what happens when one server is spread into another: which
 * spreads are statically resolvable enough to enter the composing server's
 * checks, which collision a report names, and the nominal contract a server
 * keeps across the module boundary.
 */

test("A statically resolvable spread enters the composing server's route checks", async () => {
  const composed = (order: string) => compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server app:
${order}
`).diagnostics.map((item) => item.message);

  // The spread wins or loses by written position at runtime, so both orders must report.
  assert.deepEqual(composed(`    ...base
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}`), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);
  assert.deepEqual(composed(`    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
    ...base`), [
    "Route 'GET /a/b/{y:string}' overlaps 'GET /a/{x:string}/b' (composed in from 'base'); both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  const duplicate = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server app:
    ...base
    @get(p"/a/{z:string}/b" as path) => {ok: "right"}
`);
  assert.deepEqual(duplicate.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{z:string}/b' conflicts with 'GET /a/{x:string}/b' (composed in from 'base'); parameter names do not make two route shapes distinct",
  ]);

  const fallback = compileNode(`
server base:
    @notFound() => {error: "missing"}

server app:
    ...base
    @notFound() => {error: "still_missing"}
`);
  assert.deepEqual(fallback.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; 'base' composes one in and this server declares another",
  ]);

  const transitive = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server mid:
    ...base

server app:
    ...mid
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(transitive.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'mid' → 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // The composed server already reported the pair; the server that spreads it must not repeat it.
  const reported = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}

server app:
    ...base
`);
  assert.equal(reported.diagnostics.length, 1);

  const aliased = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

const one = base
const two = one

server app:
    ...two
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(aliased.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);
});

test("A composition collision names its own cause, not the nearest one", () => {
  // Composing one server twice is what __velarCreateServeApp rejects as a conflicting route: the
  // same declaration is appended twice. Neither side has a parameter name to blame and neither can
  // be narrowed, so the message names the server that arrives twice and the spreads that carry it.
  const twice = compileNode(`
server base:
    @get(p"/a/{x:string}" as path) => {ok: "left"}

server app:
    ...base
    ...base
`);
  assert.deepEqual(twice.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}' is composed in twice, both times from 'base'; 'base' declares it once — remove one spread",
  ]);

  const diamond = compileNode(`
server base:
    @get(p"/a/{x:string}" as path) => {ok: "left"}

server mid1:
    ...base

server mid2:
    ...base

server app:
    ...mid1
    ...mid2
`);
  assert.deepEqual(diamond.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}' is composed in twice, from 'mid1' → 'base' and from 'mid2' → 'base'; 'base' declares it once — remove one spread",
  ]);

  // Two routes spelling one path collide over the path itself; parameter names are not the cause
  // and naming them sends the author looking for a difference that is not there.
  const composedPath = compileNode(`
server one:
    @get(p"/a" as path) => {ok: 1}

server two:
    @get(p"/a" as path) => {ok: 2}

server app:
    ...one
    ...two
`);
  assert.deepEqual(composedPath.diagnostics.map((item) => item.message), [
    "Route 'GET /a' (composed in from 'two') duplicates 'GET /a' (composed in from 'one'); one method and path answer from a single route",
  ]);

  const writtenPath = compileNode(`
server api:
    @get(p"/a" as path) => {ok: 1}
    @get(p"/a" as path) => {ok: 2}
`);
  assert.deepEqual(writtenPath.diagnostics.map((item) => item.message), [
    "Route 'GET /a' duplicates 'GET /a'; one method and path answer from a single route",
  ]);

  // Both @notFound contributors are named, whichever side is written here.
  const bothComposed = compileNode(`
server one:
    @notFound() => {error: "one"}

server two:
    @notFound() => {error: "two"}

server app:
    ...one
    ...two
`);
  assert.deepEqual(bothComposed.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; 'one' composes one in and 'two' composes another in",
  ]);

  const writtenFirst = compileNode(`
server base:
    @notFound() => {error: "base"}

server app:
    @notFound() => {error: "app"}
    ...base
`);
  assert.deepEqual(writtenFirst.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback; this server declares one and 'base' composes another in",
  ]);

  const writtenTwice = compileNode(`
server api:
    @notFound() => {error: "a"}
    @notFound() => {error: "b"}
`);
  assert.deepEqual(writtenTwice.diagnostics.map((item) => item.message), [
    "A server can declare only one @notFound fallback",
  ]);
});

test("Spread route checking stays inside what one module can resolve", async () => {
  // A cycle is not a program the runtime can build, but it must not be reported as a route
  // conflicting with itself either.
  const cycle = compileNode(`
server a:
    ...b
    @get(p"/x" as path) => {ok: true}

server b:
    ...a
    @get(p"/y" as path) => {ok: true}
`);
  assert.deepEqual(cycle.diagnostics.map((item) => item.message), []);

  // A `let` alias the module never reassigns holds its initializer exactly as a `const` does, so
  // the stability predicate lets it resolve and the genuine overlap is reported (D90 R19).
  const stableAlias = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

let other = base

server app:
    ...other
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(stableAlias.diagnostics.map((item) => item.message), [
    "Route 'GET /a/{x:string}/b' (composed in from 'base') overlaps 'GET /a/b/{y:string}'; both match '/a/b/b' and neither is more specific — narrow or remove one",
  ]);

  // A `let` that is actually reassigned contributes nothing: which server it holds depends on
  // execution order, and the assembly-time referee owns that question.
  const rebound = compileNode(`
server base:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}

server extra:
    @get(p"/c" as path) => {ok: true}

let other = base
other = extra

server app:
    ...other
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`);
  assert.deepEqual(rebound.diagnostics.map((item) => item.message), []);

  const distinct = compileNode(`
server base:
    @get(p"/users/me" as path) => {ok: true}

server app:
    ...base
    @get(p"/users/{id:string}" as path) => {ok: true}
    @post(p"/users/me" as path) => {ok: true}
`);
  assert.deepEqual(distinct.diagnostics.map((item) => item.message), []);

  // An imported server is a value this analyzer cannot see into. A prefix(...) call is now seen
  // through (D90 R19), but its app argument here is that same import, so both spreads stay
  // conservatively unchecked even where the composed routes would overlap the local ones — the
  // assembly-time referee owns them.
  const root = join(tmpdir(), "velar-node-server-spread-boundary");
  const users = join(root, "users.vel");
  const app = join(root, "app.vel");
  const project = await compileProject(app, new Map([
    [users, `
export server users:
    @get(p"/a/{x:string}/b" as path) => {ok: "left"}
`.trimStart()],
    [app, `
import {prefix} from "velar/serve"
import {users} from "./users.vel"

export server direct:
    ...users
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}

export server scoped:
    ...prefix("/api", users)
    @get(p"/a/b/{y:string}" as path) => {ok: "right"}
`.trimStart()],
  ]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
});

test("Node servers preserve their nominal contract across modules and composition", async () => {
  const root = join(tmpdir(), "velar-node-server-modules");
  const users = join(root, "users.vel");
  const app = join(root, "app.vel");
  const main = join(root, "main.vel");
  const project = await compileProject(main, new Map([
    [users, `
export server users:
    @get(p"/{id:string}" as path) => {id: path.params.id}
`.trimStart()],
    [app, `
import {prefix} from "velar/serve"
import {users} from "./users.vel"

export server app:
    ...prefix("/api/users", users)
`.trimStart()],
    [main, `
import {serve} from "velar/serve"
import {app} from "./app.vel"

await serve(app, port=3000)
`.trimStart()],
  ]), { extensions: [velarNodeCompilerExtension] });
  assert.deepEqual(project.failures, []);
  assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);
  assert.match(project.modules.find((module) => module.inputPath === app)?.result.code ?? "", /prefix\("\/api\/users", users\)/u);
});
