import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";

// D114 P6 item 4 (0.29.0 Web ledger LC-C1): `tick()` hands an unowned flush
// failure to a pending awaiter first.
//
// Charter section 16 and web-api both said, with no condition attached, that
// `tick()` rejects with a failure no handler claimed, "so awaiting `tick()`
// cannot step over a broken update". That was true off the browser and false in
// it: with a document present the runtime threw the failure from a microtask —
// which the host error event catches and the page survives — and the awaiting
// `tick()` resolved. The one host `tick()` is documented for was the one host
// where the promise did not hold, so `velar/web-test` stepped silently over a
// broken update there.
//
// The rule is now the same in every host: an awaiting `tick()` is the claimant.
// With no `tick()` pending nothing changes — the failure goes to the host error
// event in a browser and to the report channel elsewhere.
//
// D114 F9-web (0.30.0 ledger WB-C1, WB-U1/U2/U3) finishes the rule, because
// "the awaiting caller is the claimant" was singular and the sentence beside it
// was not: the park was drained by whoever looked first, so a *second* `tick()`
// awaiting the same broken flush resolved — it stepped over the broken update
// that "awaiting `tick()` cannot step over a broken update" is about, in both
// hosts. Every `tick()` pending at that flush is a claimant now, and the rule
// is stated in three parts, which is what the cases below pin:
//
//   - every pending `tick()` rejects with the flush's first unowned failure;
//   - a claimed failure goes nowhere else, so the Node host's report channel is
//     silent while somebody is waiting — it was writing the failure twice;
//   - everything else goes to the host, with no second channel beside a
//     claimant: a `tick()` awaited after the flush was never waiting on it and
//     resolves, and a second failure in one flush, whose claimants are already
//     spoken for, is the host's like any unowned failure with nobody waiting.

// The data-only document stand-in: its presence is the whole variable here, so
// it carries nothing but the nodes a mounted program needs.
const dom = `
class FakeNode {
  constructor(nodeType = 1, value = "") { this.nodeType = nodeType; this.value = value; this.childNodes = []; this.attributes = new Map(); this.parentNode = null; }
  adopt(child, index) {
    if (child.nodeType === 11) { const moved = child.childNodes.splice(0); for (const node of moved) { node.parentNode = null; this.adopt(node, index); index += 1; } return; }
    if (child.parentNode) child.parentNode.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
    child.parentNode = this;
    this.childNodes.splice(index, 0, child);
  }
  append(...values) { for (const child of values) this.adopt(child, this.childNodes.length); }
  insertBefore(child, before) { this.adopt(child, before === null ? this.childNodes.length : this.childNodes.indexOf(before)); return child; }
  before(...values) { const parent = this.parentNode; if (parent) for (const child of values) parent.adopt(child, parent.childNodes.indexOf(this)); }
  replaceChildren(...values) { for (const child of this.childNodes.splice(0)) child.parentNode = null; for (const child of values) this.adopt(child, this.childNodes.length); }
  remove() { const parent = this.parentNode; if (!parent) return; parent.childNodes.splice(parent.childNodes.indexOf(this), 1); this.parentNode = null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
}
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.value; }, set(next) { this.value = String(next); } });
const target = new FakeNode();
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return new FakeNode(3, String(value)); },
  createComment(value) { return new FakeNode(8, String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
  querySelector(selector) { return selector === "#app" ? target : null; },
};
`;

/** The ledger's LC-F4 program, verbatim: one watch that throws, one `tick()` awaiting the flush. */
const awaited = `
state count = 0

watch count:
    throw Error("watch blew up")

@main:
    count = 1
    try:
        await tick()
        print("tick resolved")
    catch e:
        print(f"tick rejected: {e.message}")
    print("still running")
`;

/** The same failure with nobody awaiting it. */
const unawaited = `
state count = 0

watch count:
    throw Error("watch blew up")

@main:
    count = 1
    print("wrote")
`;

interface Run {
  readonly output: string;
  readonly failed: boolean;
}

function run(source: string, host: "browser" | "node"): Run {
  const result = compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${host === "browser" ? dom : ""}\n${result.code ?? ""}`,
  });
  return { output: `${execution.stdout}${execution.stderr}`, failed: execution.status !== 0 };
}

test("[LC-C1] with a document present, the awaiting tick() is the claimant", () => {
  const browser = run(awaited, "browser");
  assert.equal(browser.failed, false, browser.output);
  assert.deepEqual(browser.output.split("\n").filter((line) => line !== ""), [
    "tick rejected: watch blew up",
    "still running",
  ]);
});

test("[WB-C1] a claimed failure goes nowhere else: the Node host's report channel stays silent", () => {
  // The Node host used to hand the same failure to the awaiting `tick()` *and*
  // write it to the report channel, so one broken update was reported twice and
  // the charter's "only when none is pending does it go to the host" was false
  // in the host it was written for. A claimant is a claimant.
  const node = run(awaited, "node");
  assert.equal(node.failed, false, node.output);
  assert.deepEqual(node.output.split("\n").filter((line) => line !== ""), [
    "tick rejected: watch blew up",
    "still running",
  ]);
});

test("[LC-C1] with no tick() pending, a document still sends the failure to the host", () => {
  // In a browser this microtask throw is the host `error` event and the page
  // survives it. Under `node --test` there is no such host, so the process
  // ends — which is the evidence that the failure took the host path and was
  // not parked for an awaiter that does not exist.
  const browser = run(unawaited, "browser");
  assert.equal(browser.failed, true, browser.output);
  assert.match(browser.output, /wrote/u, browser.output);
  assert.match(browser.output, /Error: watch blew up/u, browser.output);
});

test("[LC-C1] a tick() over a clean flush still resolves", () => {
  const clean = run(`
state count = 0
let seen = 0

watch count:
    seen = seen + 1

@main:
    count = 1
    await tick()
    print(f"tick resolved seen={seen}")
`, "browser");
  assert.equal(clean.failed, false, clean.output);
  assert.deepEqual(clean.output.split("\n").filter((line) => line !== ""), ["tick resolved seen=1"]);
});

test("[LC-C1] a handled failure is claimed by its handler, so the tick() still resolves", () => {
  // "Unowned" is the whole condition, and it is what keeps `tick()` from
  // failing an application that already dealt with the error. The handler is
  // registered through the runtime registry rather than `velar/app`'s
  // `onError`, because a single-module compile has no module graph to import
  // it from; it is the same error chain either way.
  const result = compileCore(`
state count = 0

watch count:
    throw Error("watch blew up")

component App():
    return <p>{str(count)}</p>
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${dom}\n${result.code ?? ""}
const runtime = globalThis[Symbol.for("velar.runtime.v1")];
runtime.errorHandlers.add((report) => { console.log("handled " + report.phase + "|" + report.error.message); });
count.set(1);
try { await __velarTick(); console.log("tick resolved"); } catch (error) { console.log("tick rejected: " + error.message); }
console.log("still running");
`,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(`${execution.stdout}`.split("\n").filter((line) => line !== ""), [
    "handled watch|watch blew up",
    "tick resolved",
    "still running",
  ]);
});

/**
 * The claim cases need two `tick()` promises in flight at once, and a Web
 * module's own `@main` has one statement position for that. The runtime entry
 * point is the same one `tick()` compiles to, so the probe drives it directly,
 * as the handler case above drives the error chain directly for the same
 * reason.
 */
function runProbe(probe: string, host: "browser" | "node"): Run {
  const result = compileCore(`
state count = 0

watch count:
    throw Error("watch blew up")

component App():
    return <p>{str(count)}</p>
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${host === "browser" ? dom : ""}\n${result.code ?? ""}\n${probe}`,
  });
  return { output: `${execution.stdout}${execution.stderr}`, failed: execution.status !== 0 };
}

const concurrent = `
count.set(1);
const first = __velarTick().then(() => "a resolved", (error) => "a rejected: " + error.message);
const second = __velarTick().then(() => "b resolved", (error) => "b rejected: " + error.message);
console.log(await first);
console.log(await second);
console.log("done");
`;

for (const host of ["browser", "node"] as const) {
  test(`[WB-U1] two tick() promises awaiting one broken flush both reject, in the ${host} host`, () => {
    // The ledger's WB-C1: `b` used to resolve, because the first look drained
    // the park. It was awaiting the same broken update `a` was.
    const both = runProbe(concurrent, host);
    assert.equal(both.failed, false, both.output);
    assert.deepEqual(both.output.split("\n").filter((line) => line !== ""), [
      "a rejected: watch blew up",
      "b rejected: watch blew up",
      "done",
    ]);
  });
}

test("[WB-U2] a tick() awaited after the flush does not claim its failure", () => {
  // Nothing is parked for a caller who is not there, so the failure took the
  // host path — the report channel, in a host with no document — and the
  // `tick()` that arrives afterwards is about the flush it did await, which was
  // clean.
  const node = runProbe(`
count.set(1);
await new Promise((resolve) => setTimeout(resolve, 20));
try { await __velarTick(); console.log("late resolved"); } catch (error) { console.log("late rejected: " + error.message); }
console.log("done");
`, "node");
  assert.equal(node.failed, false, node.output);
  assert.match(node.output, /Unhandled VelarScript error report: Error: watch blew up/u, node.output);
  assert.deepEqual(node.output.split("\n").filter((line) => line.startsWith("late") || line === "done"), [
    "late resolved",
    "done",
  ]);
});

test("[WB-U3] a second failure in one flush has no claimant left and goes to the host", () => {
  // Every pending `tick()` rejects with the flush's *first* unowned failure —
  // one broken update, one report, whatever shape the caller awaited it in —
  // and the rest of that flush's failures are the host's, exactly as they are
  // when nobody is waiting at all. That is the rule charter section 16 and
  // web-api state, and it is why nothing is silently dropped.
  const result = compileCore(`
state count = 0

watch count:
    throw Error("first blew up")

watch count as current, previous:
    throw Error("second blew up")

@main:
    count = 1
    try:
        await tick()
        print("tick resolved")
    catch e:
        print(f"tick rejected: {e.message}")
    print("done")
`.trimStart(), { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: result.code ?? "" });
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.deepEqual(`${execution.stdout}`.split("\n").filter((line) => line !== ""), [
    "tick rejected: first blew up",
    "done",
  ]);
  assert.match(execution.stderr, /Unhandled VelarScript error report: Error: second blew up/u, execution.stderr);
  assert.equal(/first blew up/u.test(execution.stderr), false, execution.stderr);
});
