import assert from "node:assert/strict";
import test from "node:test";
import { measurement, probeModule } from "../support/emitted-web-module.ts";

/**
 * D115 P5 — the reactive graph itself, one subject of the file that was
 * `tests/web/reactive-graph-and-runtime-abi.slow.test.ts` before it reached
 * 881 lines.
 *
 * Fix wave 2 of the marathon defect ledger
 * (docs/decisions/archive/MARATHON-DEFECTS.md): the Web runtime items. Each
 * probe stays at the level the ledger's evidence was taken at.
 * Retention is measured where it was measured — in the graph — so each of these
 * runs the emitted module under Node with a probe appended and reads what the
 * probe printed: the parent links a replaced state root leaves behind, the
 * identity probe a primitive record-field write must not do, the subscriptions
 * a reused dependency buffer drops and re-adds, and the structural change
 * creating an absent key has to publish. The bodies below are the bodies that
 * file had.
 */

interface RootReplacementProbe {
  readonly parents: number;
  readonly microseconds: number;
  readonly alive: number;
  readonly total: number;
}

// ---------------------------------------------------------------------------
// beta-1: replacing a state root left every descendant linked to the dead root.
// ---------------------------------------------------------------------------

const rootReplacementProgram = `
type Theme:
    mode: string

type Settings:
    label: string
    theme: Theme

state settings: Settings = {label: "start", theme: {mode: "dark"}}
let changes = 0

watch settings.theme.mode:
    changes += 1

def replace(label: string):
    settings = {...settings, label}

def touch(mode: string):
    settings.theme.mode = mode
`;

const rootReplacementProbe = `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeGenerations = Number(process.env.VELAR_PROBE_GENERATIONS);
const __probeRoots = [];
for (let index = 0; index < __probeGenerations; index += 1) {
  __probeRoots.push(new WeakRef(__probeRuntime.toRaw(settings.get())));
  replace("label-" + index);
}
const __probeTheme = __probeRuntime.toRaw(__probeRuntime.toRaw(settings.get()).theme);
const __probeMeasure = (rounds) => {
  const start = process.hrtime.bigint();
  for (let index = 0; index < rounds; index += 1) touch(index % 2 === 0 ? "dark" : "light");
  return Number(process.hrtime.bigint() - start) / rounds / 1000;
};
__probeMeasure(500);
let __probeCost = Infinity; for (let a = 0; a < 5; a += 1) __probeCost = Math.min(__probeCost, __probeMeasure(2000));
const __probeParents = __probeRuntime.parents.get(__probeTheme);
for (let round = 0; round < 3; round += 1) {
  globalThis.gc();
  await new Promise((resolve) => setTimeout(resolve, 20));
}
let __probeAlive = 0;
for (const reference of __probeRoots) if (reference.deref()) __probeAlive += 1;
console.log(JSON.stringify({
  parents: __probeParents ? __probeParents.size : 0,
  microseconds: __probeCost,
  alive: __probeAlive,
  total: __probeRoots.length,
}));
`;

test("[beta-1] replacing a state root releases the dead root and keeps deep mutation flat", { timeout: 180_000 }, (t) => {
  // The idiom is the one docs/web-api.md teaches: `settings = {...settings, ...}`.
  // Before the fix the surviving `theme` kept one parent link per replaced root,
  // so every dead root stayed strongly reachable (200/200 alive after gc, 200
  // parents) and each deep mutation walked one more generation (51 generations
  // 9.1us, 3200 generations 268.6us on the baseline machine).
  const shallow = measurement<RootReplacementProbe>(probeModule(rootReplacementProgram, rootReplacementProbe, ["--expose-gc"], {
    VELAR_PROBE_GENERATIONS: "51",
  }));
  const deep = measurement<RootReplacementProbe>(probeModule(rootReplacementProgram, rootReplacementProbe, ["--expose-gc"], {
    VELAR_PROBE_GENERATIONS: "3200",
  }));
  t.diagnostic(`51 generations: parents ${shallow.parents}, ${shallow.alive}/${shallow.total} roots alive, ${shallow.microseconds.toFixed(3)}us per deep mutation`);
  t.diagnostic(`3200 generations: parents ${deep.parents}, ${deep.alive}/${deep.total} roots alive, `
    + `${deep.microseconds.toFixed(3)}us per deep mutation`);

  // The live root owns the surviving descendant, and nothing else does.
  assert.equal(shallow.parents, 1, "a replaced state root still owns a descendant");
  assert.equal(deep.parents, 1, "a replaced state root still owns a descendant");
  // The most recent `previous` value can still be held by the running frame, so
  // the bound is a constant, not zero -- what must not survive is a count that
  // grows with the number of replacements.
  assert.ok(shallow.alive <= 2, `${shallow.alive} of ${shallow.total} replaced roots survived collection`);
  assert.ok(deep.alive <= 2, `${deep.alive} of ${deep.total} replaced roots survived collection`);
  // 3200 generations cost 268.6us per deep mutation before the fix; the bubble walk is now
  // independent of how many were replaced. Both figures are the best of five probe samples:
  // a busy host can only lengthen one, so the shortest of them is the walk itself.
  assert.ok(deep.microseconds < 25, `a deep mutation after 3200 replacements took ${deep.microseconds.toFixed(3)}us`);
  assert.ok(deep.microseconds < shallow.microseconds * 4,
    `deep mutation still scales with replacements: ${shallow.microseconds.toFixed(3)}us at 51 vs ${deep.microseconds.toFixed(3)}us at 3200`);
});

// ---------------------------------------------------------------------------
// beta-7 / beta-9: the record write and property read paths.
// ---------------------------------------------------------------------------

const recordWriteProgram = `
type Section:
    label: string

type Form:
    one: string
    two: string
    three: string
    four: string
    five: string
    six: string
    seven: string
    eight: string
    section: Section

state form: Form = {one: "", two: "", three: "", four: "", five: "", six: "", seven: "", eight: "", section: {label: "start"}}

def typeInto(value: string):
    form.one = value

def replaceSection(label: string):
    form.section = {label}
`;

test("[beta-7] a primitive record-field write never probes collection identity", { timeout: 180_000 }, (t) => {
  // `contains` ran on every write, including writes of a primitive where
  // `unlink` is a documented no-op: two thrown-and-caught exceptions plus a
  // descriptor walk over every field, on every keystroke through bind:value.
  const measured = measurement<{ readonly microseconds: number; readonly detached: number; readonly attached: number }>(probeModule(recordWriteProgram, `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeMeasure = (rounds) => {
  const start = process.hrtime.bigint();
  for (let index = 0; index < rounds; index += 1) typeInto(index % 2 === 0 ? "a" : "b");
  return Number(process.hrtime.bigint() - start) / rounds / 1000;
};
__probeMeasure(2000);
const __probeCost = __probeMeasure(20000);

// The object case still detaches: the replaced section loses its owner and
// with it every link the dead section alone held.
const __probeSection = __probeRuntime.toRaw(form.get().section);
replaceSection("next");
console.log(JSON.stringify({
  microseconds: __probeCost,
  detached: __probeRuntime.parents.has(__probeSection) ? 0 : 1,
  attached: __probeRuntime.parents.has(__probeRuntime.toRaw(form.get().section)) ? 1 : 0,
}));
`));
  t.diagnostic(`record-field write ${(measured.microseconds * 1000).toFixed(0)}ns (baseline before the fix: 4858ns)`);
  assert.equal(measured.detached, 1, "the replaced record field kept its owner");
  assert.equal(measured.attached, 1, "the new record field never became owned");
  // 4.86us per write before the fix, 0.41us after. Windows' timer and hosted
  // runner overhead is measurably higher, but 3us still separates that noise
  // from the old throwing collection-brand probe.
  const budget = process.platform === "win32" ? 3 : 2;
  assert.ok(measured.microseconds < budget, `a primitive record-field write took ${measured.microseconds.toFixed(3)}us`);
});

test("[beta-9] a reused dependency buffer still drops and re-adds subscriptions", { timeout: 180_000 }, () => {
  // runTracked now recycles the previous run's dependency Set instead of
  // allocating one per run. The buffer must be empty when it is handed back,
  // or a stale dependency would keep an observer subscribed forever.
  //
  // D90 R15(a) moved the branch out of the watch subject and into a computed,
  // so the observer whose buffer is recycled here is the computed rather than
  // the watch. It is the same runTracked and the same redirect: the recorded
  // sequence below still says the subscription followed the branch.
  const execution = probeModule(`
state useLeft = true
state left = "L"
state right = "R"
let seen = ""

computed shown = useLeft ? left : right

watch shown:
    seen += useLeft ? "l" : "r"

def choose(next: bool):
    useLeft = next

def writeLeft(value: string):
    left = value

def writeRight(value: string):
    right = value

def report() -> string:
    return seen
`, `
const __probeTick = () => new Promise((resolve) => queueMicrotask(resolve));
writeLeft("L1");
await __probeTick();
writeRight("R1");
await __probeTick();
choose(false);
await __probeTick();
writeRight("R2");
await __probeTick();
writeLeft("L2");
await __probeTick();
console.log(JSON.stringify({ seen: report() }));
`);
  // 'l' for the tracked left write, nothing for the untracked right write,
  // 'r' for the switch itself and for the tracked right write, nothing for the
  // now-untracked left write.
  assert.equal(measurement<{ readonly seen: string }>(execution).seen, "lrr");
});

// ---------------------------------------------------------------------------
// beta-13: assigning `undefined` to an absent key.
// ---------------------------------------------------------------------------

test("[beta-13] creating an absent key with undefined publishes the structural change", { timeout: 180_000 }, () => {
  // Reachable through `import js unsafe`: the write created the property but
  // compared `undefined` with the absent key's `undefined` reading, decided
  // nothing changed, and published nothing.
  const measured = measurement<{ readonly created: number; readonly published: number }>(probeModule(`
type Row:
    label: string

state row: Row = {label: "start"}

def label(value: string):
    row.label = value
`, `
const __probeRuntime = globalThis[Symbol.for("velar.runtime.v1")];
const __probeRaw = __probeRuntime.toRaw(row.get());
const __probeBefore = __probeRuntime.versionOf(__probeRaw);
row.get().extra = undefined;
const __probeAfter = __probeRuntime.versionOf(__probeRaw);
console.log(JSON.stringify({
  created: "extra" in __probeRaw ? 1 : 0,
  published: __probeAfter > __probeBefore ? 1 : 0,
}));
`));
  assert.equal(measured.created, 1, "the key was not created");
  assert.equal(measured.published, 1, "creating the key published no change");
});
