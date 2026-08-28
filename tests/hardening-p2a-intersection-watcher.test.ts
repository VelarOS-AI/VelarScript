import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { standardModuleSource } from "../packages/cli/src/standard-modules.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * P2a-4 — `velar/browser`'s fourth watcher, checked at the level the other
 * three are: the shipped module source runs under Node against a hostile fake
 * host, so what is asserted is the module the toolchain writes rather than a
 * re-implementation of it.
 *
 * The three claims that make it a member of the family rather than a
 * passthrough: the configuration is validated before the browser is reached,
 * the entry is read through the captured native getters rather than through
 * whatever the host object happens to expose, and the cleanup disconnects
 * exactly once. The fourth is the family's error contract — a callback that
 * throws reaches the application error channel with its own phase and detail,
 * and does not escape into the observer.
 */
function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
}

/** The `velar/browser` source the toolchain writes into a build. */
function shippedBrowserModule(): string {
  const source = standardModuleSource("velar/browser", { base: "/" }, [velarCompilerExtension]);
  assert.ok(source, "velar/browser has no standard module source");
  return source;
}

/** A fake host with just enough of Element, IntersectionObserver, and its entry. */
const intersectionHost = `
let observed = 0;
let disconnected = 0;
let deliver = null;
let lastOptions = null;
const reports = [];
globalThis[Symbol.for("velar.runtime.v1")] = { report(error, options) { reports.push(options.phase + ":" + options.detail + ":" + error.name); } };
class Element {}
class IntersectionObserverEntry {
  constructor(intersecting, ratio) { this._intersecting = intersecting; this._ratio = ratio; }
  get isIntersecting() { return this._intersecting; }
  get intersectionRatio() { return this._ratio; }
}
class IntersectionObserver {
  constructor(callback, options) { deliver = callback; lastOptions = options; }
  observe() { observed += 1; }
  disconnect() { disconnected += 1; }
}
globalThis.Element = Element;
globalThis.IntersectionObserver = IntersectionObserver;
globalThis.IntersectionObserverEntry = IntersectionObserverEntry;
const target = new Element();
const scroller = new Element();
`;

test("[P2a-4] the intersection watcher validates its own configuration before reaching the browser", () => {
  const source = shippedBrowserModule();
  const execution = executeModule(`
${intersectionHost}
${source}
const rejected = [];
const attempts = [
  () => watchIntersection(target, 42),
  () => watchIntersection({}, () => null),
  () => watchIntersection(target, () => null, {root: {}}),
  () => watchIntersection(target, () => null, {thresholds: []}),
  () => watchIntersection(target, () => null, {thresholds: [1.5]}),
  () => watchIntersection(target, () => null, {thresholds: [-0.1]}),
  () => watchIntersection(target, () => null, {thresholds: new Array(33).fill(0)}),
  () => watchIntersection(target, () => null, {thresholds: ["0"]}),
  () => watchIntersection(target, () => null, {rootMargin: "10px"}),
];
for (const attempt of attempts) {
  try { attempt(); rejected.push("accepted"); }
  catch (error) { rejected.push(error.name); }
}
console.log(rejected.join(","));
// Nothing above reached the browser: no observer was ever asked to observe.
console.log(String(observed));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // a callback that is not one, an element that is not one, a root that is
    // not one, an empty and an over-long threshold list, two ratios outside
    // 0..1, a threshold that is text, and an option the surface does not have.
    "TypeError,TypeError,TypeError,RangeError,RangeError,RangeError,RangeError,RangeError,TypeError",
    "0",
    "",
  ].join("\n"));
});

test("[P2a-4] the intersection watcher reads entries through captured getters and disconnects once", () => {
  const source = shippedBrowserModule();
  const execution = executeModule(`
${intersectionHost}
${source}
const seen = [];
const stop = watchIntersection(target, entry => seen.push(entry.intersecting + ":" + entry.ratio), {
  root: scroller,
  thresholds: [0.0, 1.0],
});
console.log(observed + ":" + (lastOptions.root === scroller) + ":" + lastOptions.threshold.join("|"));

// One delivery may carry several crossings, oldest first. The newest is the
// only one that still describes the element, and it is what the callback gets.
deliver([new IntersectionObserverEntry(false, 0), new IntersectionObserverEntry(true, 1)]);
deliver([new IntersectionObserverEntry(false, 0)]);

// A synthetic entry cannot forge the fields: the getters are the captured
// prototype ones, and an own enumerable data field is what a test host uses.
deliver([Object.defineProperty({}, "isIntersecting", { enumerable: true, get() { return true; } })]);

// A callback failure belongs to the application error channel, not to the
// browser's observer callback.
const stopThrowing = watchIntersection(target, () => { throw new Error("reader failed"); });
deliver([new IntersectionObserverEntry(true, 1)]);
stopThrowing();

stop();
stop();
console.log(seen.join(","));
console.log(String(disconnected));
console.log(reports.join("|"));
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, [
    // observed once, the root passed through, both thresholds forwarded in order
    "1:true:0|1",
    // the newest entry of the batch, then the single one
    "true:1,false:0",
    // two watchers, each disconnected exactly once despite the doubled stop()
    "2",
    // the forged entry and the throwing reader, both on the observer channel
    "observer:intersection:TypeError|observer:intersection:Error",
    "",
  ].join("\n"));
});
