import assert from "node:assert/strict";
import test from "node:test";
import { nodeModuleSources, VELAR_NODE_HOST_MODULE } from "../packages/node/src/compiler.ts";
import { runtime } from "./node-runtime-harness.ts";

/**
 * D114 P6 item B: the Node Worker readiness handshake.
 *
 * Three official Node modules — `velar/process`, `velar/node-host-v1` and
 * `velar/terminal` — start a Worker and wait for it to report ready before the
 * module finishes evaluating. Each carried its own 10-second deadline, and a
 * saturated machine lost the race to all three of them: R2c, R2d and F6a each
 * watched `tests/node-process-spawn-failures.test.ts` go red for the handshake
 * rather than for anything it tests.
 *
 * The wait itself was already event-driven — a promise settled by the worker's
 * message — so what moved is the deadline and what happens when it passes: one
 * number, declared in all three under the same name, and a failure that goes
 * through the module's own failure path, which names the deadline it exceeded
 * and rejects every pending call. Silence is not one of the outcomes.
 */

const families = [
  { module: "velar/process", prefix: "__velarNodeProcess", worker: "Node process worker" },
  { module: VELAR_NODE_HOST_MODULE, prefix: "__velarNodeHost", worker: "Node host worker" },
  { module: "velar/terminal", prefix: "__velarTerminal", worker: "Node terminal worker" },
] as const;

function moduleSource(name: string): string {
  const source = nodeModuleSources.get(name);
  assert.ok(source, `${name} must have a Node runtime source`);
  return source;
}

test("the three Node Workers share one readiness deadline", () => {
  const declared = new Map<string, string>();
  for (const family of families) {
    const source = moduleSource(family.module);
    const match = new RegExp(`const ${family.prefix}ReadyDeadlineMs = ([0-9_]+);`, "u").exec(source);
    assert.ok(match, `${family.module} declares its readiness deadline as a named constant`);
    declared.set(family.module, match[1]!.replaceAll("_", ""));
  }
  const values = new Set(declared.values());
  assert.equal(values.size, 1, `one deadline, three declarations: ${JSON.stringify([...declared])}`);
  const [only] = values;
  assert.equal(only, "30000", "the deadline a saturated machine lost to was 10000");
});

test("each Node Worker holds the loop through one reference rule and nowhere else", () => {
  for (const family of families) {
    const source = moduleSource(family.module);
    // The rule: outstanding work refs the Worker and the MessagePort together,
    // and nothing else touches either handle's reference count. Two call sites
    // per handle is one `if`/`else` inside the accounting function; a third
    // would be a second definition of "is anything outstanding?".
    for (const operation of ["WorkerRef", "WorkerUnref", "MessagePortRef", "MessagePortUnref"]) {
      const name = `${family.prefix}${operation}`;
      const mentions = source.match(new RegExp(`\\b${name}\\b`, "gu"))?.length ?? 0;
      assert.equal(mentions, 2, `${family.module} names ${name} twice: the captured operation and the one call that uses it`);
    }
    assert.match(source, new RegExp(`function ${family.prefix}Outstanding\\(\\) \\{`, "u"), `${family.module} answers "is anything outstanding?" in one place`);
    // The readiness handshake is part of that answer, which is what holds both
    // handles while the worker is still starting.
    assert.match(source, new RegExp(`if \\(${family.prefix}Failure\\) return false;`, "u"));
    assert.match(source, new RegExp(`return !${family.prefix}Ready`, "u"));
    // The deadline goes through the module's failure path, never through a
    // bare readiness rejection that leaves the rest of the module's state
    // untouched.
    assert.match(source, new RegExp(`${family.prefix}Fail\\(new .*\\n?.*"${family.worker} did not become ready within " \\+ ${family.prefix}ReadyDeadlineMs`, "u"));
  }
});

test("a worker that never reports ready fails with the deadline it exceeded", async () => {
  // The handshake is cut at the application-Realm end — the worker starts and
  // reports ready as usual, and this module stops recognising the report — so
  // what is measured is the deadline path itself, with the deadline shortened
  // so the test does not have to wait 30 seconds for it.
  await assert.rejects(
    runtime<Record<string, unknown>>("velar/process", (source) => source
      .replace("const __velarNodeProcessReadyDeadlineMs = 30_000;", "const __velarNodeProcessReadyDeadlineMs = 50;")
      .replace(
        "    __velarNodeProcessMessage(__velarProcessCall(__velarNodeProcessMessageData, event, []));",
        "    const probe = __velarProcessCall(__velarNodeProcessMessageData, event, []);\n"
        + '    if (probe && probe.kind === "ready") return;\n'
        + "    __velarNodeProcessMessage(probe);",
      )),
    /Node process worker did not become ready within 50 ms/u,
    "the deadline reports a named failure rather than leaving the program suspended",
  );
});

test("the readiness handshake settles under contention, every time", async () => {
  // The shape `tests/node-process-spawn-failures.test.ts` was losing: the
  // module is evaluated, which is the handshake, over and over while the
  // machine is busy. A missed handshake is a rejected import here, never a
  // silent success.
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const module = await runtime<{ readonly run: unknown }>("velar/process");
    assert.equal(typeof module.run, "function", `attempt ${attempt}: velar/process finished its handshake and published its API`);
  }
});
