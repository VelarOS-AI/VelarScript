import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import test from "node:test";
import { nodeModuleSources } from "../../packages/node/src/compiler.ts";
import { routePattern, runtime, type ServeCompilerBridge } from "../support/node-runtime.ts";
import { runVelarProject } from "../support/velar-project.ts";

/**
 * D114 P6 item 12 (audit SV-D2 / SV-C1): `HttpProblem`'s semantic code is
 * `reason`.
 *
 * Through 0.29 the class declared it as a field named `code`, and charter
 * section 11 owns that name on every checked `Error` as the instance's class
 * name and forbids a subclass from redeclaring it. All three of the charter,
 * the Node contract and the emitter could not be right at once, and what gave
 * was the read: the constructor stored `route.not_found` and every read
 * answered the constant `"HttpProblem"` — including `outcome.problem.code`,
 * the spelling the official skill and the repository tour both taught, which
 * shipped that constant to clients with no diagnostic anywhere.
 *
 * Three things have to hold together for the rename to be finished, and each
 * is one test below: the value is readable as `reason`; `code` is the class
 * name the charter promises and the retired read is refused with `reason`
 * named and mechanically applied; and the wire problem document is untouched,
 * because its JSON field name `code` is the contract clients and `openapi()`
 * already have.
 */

type ServeRuntime = {
  readonly ServeApp: object;
  serve(app: unknown, port: number): Promise<{ readonly port: number; stop(): Promise<null> }>;
  HttpProblem: new (options: Record<string, unknown>) => Error & { readonly reason: string };
};

type Bridge = ServeCompilerBridge & {
  createRoute(method: string, path: unknown, parameters: readonly Record<string, unknown>[], handler: (...arguments_: never[]) => Promise<unknown>, metadata?: Record<string, unknown>): unknown;
  createApp(name: string, items: readonly unknown[]): unknown;
};

async function serveRuntime(): Promise<{ readonly module: ServeRuntime; readonly bridge: Bridge }> {
  const module = await runtime<ServeRuntime>("velar/serve");
  const bridge = Object.getOwnPropertyDescriptor(module.ServeApp, "__velarCompilerBridge")?.value as Bridge;
  assert.ok(bridge, "velar/serve publishes its compiler bridge");
  return { module, bridge };
}

test("HttpProblem carries its semantic code as 'reason' and declares no 'code' of its own", async () => {
  const { module } = await serveRuntime();
  const problem = new module.HttpProblem({ status: 409, reason: "x.conflict", title: "Conflict", detail: "d" });
  assert.equal(problem.reason, "x.conflict");
  // Charter section 11: `code` is the Error contract's own member, and the
  // compiler lowers a read of it to the declared class name. Nothing defines it
  // as a property any more, which is what "no longer shadowed" means on the
  // emitted object; the class-name value is asserted from VelarScript below.
  assert.equal(Object.hasOwn(problem, "code"), false, "HttpProblem no longer defines an own 'code' property");
  assert.equal(problem.name, "HttpProblem");
  assert.equal(problem.message, "d");
  // The option name moved with the field: the retired spelling is not a second
  // way to say the same thing, it is an unknown field.
  assert.throws(
    () => new module.HttpProblem({ status: 409, code: "x.conflict", title: "Conflict" }),
    /HttpProblem options has an unknown field/u,
  );
  assert.throws(
    () => new module.HttpProblem({ status: 409, reason: "Not An Identifier", title: "Conflict" }),
    /HttpProblem reason must be a stable lowercase identifier/u,
  );
});

test("the wire problem document still publishes the reason under its JSON name 'code'", async () => {
  const { module, bridge } = await serveRuntime();
  const conflict = bridge.createRoute("GET", routePattern(bridge, "/conflict"), [], async () => {
    throw new module.HttpProblem({ status: 409, reason: "a.conflict", title: "Conflict" });
  });
  const app = bridge.createApp("problems", [conflict]);
  // What `openapi()` publishes and what the wire carries are one shape, and
  // that shape did not move: `code` is still the field name a client reads.
  const source = nodeModuleSources.get("velar/serve") ?? "";
  assert.match(source, /required: \["type", "title", "status", "code"\]/u);
  assert.equal(source.includes('reason: {type: "string"}'), false, "'reason' is the source spelling, not a published wire field");
  const server = await module.serve(app, 0);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const thrown = await fetch(`${base}/conflict`);
    assert.equal(thrown.status, 409);
    assert.match(thrown.headers.get("content-type") ?? "", /application\/problem\+json/u);
    assert.equal((await thrown.json() as { code: string }).code, "a.conflict");
    // The framework's own refusals travel the same field.
    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as { code: string }).code, "route.not_found");
    const method = await fetch(`${base}/conflict`, { method: "POST" });
    assert.equal(method.status, 405);
    assert.equal((await method.json() as { code: string }).code, "route.method_not_allowed");
  } finally {
    await server.stop();
  }
});

test("a response policy reads outcome.problem.reason as the semantic code", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {http} from "velar/http"
import {HttpOutcome, HttpProblem, Request, ServeApp, json, serve} from "velar/serve"

server api:
    @get ok(p"/ok") => {ok: true}

    @get conflict(p"/conflict"):
        throw HttpProblem({status: 409, reason: "article.conflict", title: "Article conflict"})

    // The envelope answers 200 so the probe below reads the body directly; the
    // subject here is which member carries the semantic code, not the status.
    @response(outcome: HttpOutcome, request: Request):
        if outcome.problem != null:
            return json({ok: false, error: outcome.problem.reason, path: request.path})
        return json({ok: true, data: outcome.value})

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    try:
        const conflict = await http.get(f"http://127.0.0.1:{server.port}/conflict").text()
        print(f"conflict={conflict}")
        const missing = await http.get(f"http://127.0.0.1:{server.port}/nope").text()
        print(f"missing={missing}")
    finally: await server.stop()
`.trimStart(),
  }, { prefix: "velar-problem-reason-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^conflict=\{"ok":false,"error":"article\.conflict","path":"\/conflict"\}$/mu);
  assert.match(run.stdout, /^missing=\{"ok":false,"error":"route\.not_found","path":"\/nope"\}$/mu);
});

test("reading '.code' on an HttpProblem is refused, names 'reason', and 'velar fix' applies the rename", async () => {
  const source = `
import {HttpProblem} from "velar/serve"

@main:
    const problem = HttpProblem({status: 409, reason: "article.conflict", title: "Article conflict"})
    print(f"semantic={problem.code}")
`.trimStart();
  const checked = await runVelarProject({ "src/main.vel": source }, { command: "check", prefix: "velar-problem-retired-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  assert.match(
    checked.stderr,
    /error VEL4001: 'HttpProblem' reads its semantic problem code as 'reason'; 'code' is the Error contract's own member and is always the class name 'HttpProblem'/u,
  );

  const fixed = await runVelarProject({ "src/main.vel": source }, { command: "fix", keep: true, prefix: "velar-problem-fix-" });
  try {
    assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
    assert.match(fixed.stdout, /fixed VEL4001: Use 'reason'/u);
    const rewritten = await readFile(join(fixed.root, "src", "main.vel"), "utf8");
    assert.match(rewritten, /print\(f"semantic=\{problem\.reason\}"\)/u);
    // The rewrite compiles, and it means what the source meant before the
    // rename: the semantic problem code, not the class name.
    const ran = await runVelarProject({ "src/main.vel": rewritten }, { prefix: "velar-problem-fixed-run-" });
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
    assert.match(ran.stdout, /^semantic=article\.conflict$/mu);
  } finally {
    await rm(fixed.root, { recursive: true, force: true });
  }
});

test("the Error contract's 'code' is still readable through an Error-typed receiver", async () => {
  const run = await runVelarProject({
    "src/main.vel": `
import {HttpProblem} from "velar/serve"

@main:
    const problem = HttpProblem({status: 409, reason: "article.conflict", title: "Article conflict"})
    const failure: Error = problem
    print(f"class={failure.code}")
    try:
        throw problem
    catch error:
        print(f"caught={error.code}")
`.trimStart(),
  }, { prefix: "velar-problem-class-name-" });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /^class=HttpProblem$/mu);
  assert.match(run.stdout, /^caught=HttpProblem$/mu);
});

/**
 * D114 F9-node-cli, audit NO-I1: the construction site, which is the one every
 * 0.29 program has.
 *
 * The read side above is the model — one rejection, `reason` named, `velar fix`
 * applying it. The same rename's construction side answered with two reports
 * that never said `reason`: the object contract's "missing required field" on
 * the whole literal and "has no field 'code'" on the entry, and `velar fix`
 * changed nothing, so a migration that was mechanical on one side was manual on
 * the other. One report now, on the retired key, carrying the rewrite.
 */
test("constructing an HttpProblem with 'code' is one report that names 'reason', and 'velar fix' applies it", async () => {
  const source = `
import {HttpProblem, ServeApp, serve} from "velar/serve"

server api:
    @get conflict(p"/conflict"):
        throw HttpProblem({status: 409, code: "article.conflict", title: "Article conflict"})

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await server.stop()
    print("started")
`.trimStart();
  const checked = await runVelarProject({ "src/main.vel": source }, { command: "check", prefix: "velar-problem-option-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  const reports = checked.stderr.split("\n").filter((line) => line.includes("error VEL"));
  assert.equal(reports.length, 1, `one error, one report: ${checked.stderr}`);
  assert.match(
    reports[0]!,
    /error VEL4001: 'HttpProblem' takes its semantic problem code as 'reason'; 'code' is the Error contract's own member and cannot be given a value\. The wire problem document still publishes 'reason' under its JSON name "code"$/u,
  );
  // The report stands on the key it is about, not on the whole options record.
  assert.match(checked.stderr, /^\s+\^{4}$/mu);

  const fixed = await runVelarProject({ "src/main.vel": source }, { command: "fix", keep: true, prefix: "velar-problem-option-fix-" });
  try {
    assert.equal(fixed.status, 0, `${fixed.stdout}\n${fixed.stderr}`);
    assert.match(fixed.stdout, /fixed VEL4001: Use 'reason'/u);
    const rewritten = await readFile(join(fixed.root, "src", "main.vel"), "utf8");
    assert.match(rewritten, /HttpProblem\(\{status: 409, reason: "article\.conflict", title: "Article conflict"\}\)/u);
    const ran = await runVelarProject({ "src/main.vel": rewritten }, { prefix: "velar-problem-option-run-" });
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
    assert.match(ran.stdout, /^started$/mu);
  } finally {
    await rm(fixed.root, { recursive: true, force: true });
  }
});

/** A construction that says neither name keeps the object contract's own answer. */
test("an HttpProblem missing its reason entirely is still the object contract's report", async () => {
  const checked = await runVelarProject({
    "src/main.vel": `
import {HttpProblem} from "velar/serve"

@main:
    const problem = HttpProblem({status: 409, title: "Conflict"})
    print(f"x={problem.status}")
`.trimStart(),
  }, { command: "check", prefix: "velar-problem-option-absent-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  assert.match(checked.stderr, /error VEL4001: Object is missing required field 'reason'/u);
});

/**
 * D114 F10-node, audit NO-I2: the same construction, written through a name.
 *
 * `HttpProblem(record)` is one report — the object contract's "Cannot assign"
 * on the variable — and it never says `reason`, never says `code`, and carries
 * no rewrite: the one form of this migration a reader could not act on. The
 * report belongs on the `code:` the author actually wrote, which is in the
 * declaration, and `velar fix` finishes it there.
 */
test("constructing an HttpProblem from a named record reports on that record's own 'code:' key", async () => {
  const source = `
import {HttpProblem, ServeApp, serve} from "velar/serve"

const conflict = {status: 409, code: "article.conflict", title: "Article conflict"}

server api:
    @get conflict(p"/conflict"):
        throw HttpProblem(conflict)

@main:
    const app: ServeApp = api
    const server = await serve(app, 0)
    await server.stop()
    print("started")
`.trimStart();
  const checked = await runVelarProject({ "src/main.vel": source }, { command: "check", prefix: "velar-problem-record-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  const reports = checked.stderr.split("\n").filter((line) => line.includes("error VEL"));
  assert.equal(reports.length, 1, `one error, one report: ${checked.stderr}`);
  assert.match(
    reports[0]!,
    /src\/main\.vel:3:\d+ error VEL4001: 'HttpProblem' takes its semantic problem code as 'reason'; 'code' is the Error contract's own member and cannot be given a value\./u,
    `the caret stands on the record literal's own line, not on the call: ${checked.stderr}`,
  );

  const fixed = await runVelarProject({ "src/main.vel": source }, { command: "fix", keep: true, prefix: "velar-problem-record-fix-" });
  try {
    assert.match(fixed.stdout, /fixed VEL4001: Use 'reason'/u);
    assert.match(
      await readFile(join(fixed.root, "src", "main.vel"), "utf8"),
      /const conflict = \{status: 409, reason: "article\.conflict", title: "Article conflict"\}/u,
    );
    // What is left is a different rule and says so: a record reached through a
    // name is not a fresh literal, so it is judged field for field against the
    // options type. The rename is finished either way, which is what this test
    // is about, and nothing in what remains mentions `code`.
    assert.doesNotMatch(fixed.stderr, /'code'/u, fixed.stderr);
  } finally {
    await rm(fixed.root, { recursive: true, force: true });
  }
});

/** A record this module cannot see the literal of still gets the sentence. */
test("an HttpProblem built from a record declared elsewhere is told what 'code' became", async () => {
  const checked = await runVelarProject({
    "src/main.vel": `
import {HttpProblem} from "velar/serve"
import {conflict} from "./problems.vel"

@main:
    const problem = HttpProblem(conflict())
    print(f"x={problem.status}")
`.trimStart(),
    "src/problems.vel": `
type Problem:
    status: number
    code: string
    title: string

export def conflict() -> Problem:
    return {status: 409, code: "article.conflict", title: "Article conflict"}
`.trimStart(),
  }, { command: "check", prefix: "velar-problem-hidden-record-" });
  assert.notEqual(checked.status, 0, checked.stdout);
  const reports = checked.stderr.split("\n").filter((line) => line.includes("error VEL"));
  assert.equal(reports.length, 1, `one error, one report: ${checked.stderr}`);
  assert.match(
    reports[0]!,
    /error VEL4001: 'HttpProblem' takes its semantic problem code as 'reason'; this record writes the retired 'code', which is the Error contract's own member and cannot be given a value\./u,
    checked.stderr,
  );
});
