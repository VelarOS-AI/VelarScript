import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Runtime performance gate. `tests/performance.test.ts` bounds compile-time
// work; this file bounds the wall-clock cost of the code the emitter produces,
// so a language change that slows every program down is visible as a failing
// gate instead of an invisible regression.
//
// Each benchmark is a VelarScript program that times itself with
// `monotonic()` (the compiler's binding for `performance.now()`), reports one
// `label=sample,sample,...` line per dimension, and is discarded. The harness
// takes the median of the reported rounds; every program runs one untimed
// warm-up round first so the samples describe optimized code rather than the
// interpreter's first pass.
//
// Budgets are set at roughly three times the median measured on the reference
// machine (Apple Silicon, Node 24, 2026-08-12) and each one records that
// measurement next to it. They are regression gates, not targets: a budget is
// only ever tightened after the measured baseline moves.

const root = resolve(new URL("..", import.meta.url).pathname);

/** Wall-clock ceiling for one benchmark, covering compilation and execution. */
const BENCHMARK_WALL_CLOCK_BUDGET_MS = 20_000;

function median(values: readonly number[]): number {
  assert.ok(values.length > 0, "a benchmark dimension reported no samples");
  const ordered = [...values].sort((left, right) => left - right);
  const middle = ordered.length >> 1;
  return ordered.length % 2 === 1 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function parseSamples(stdout: string): Map<string, number[]> {
  const samples = new Map<string, number[]>();
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const values = line.slice(separator + 1).split(",").filter((value) => value.trim() !== "").map(Number);
    assert.ok(values.every((value) => Number.isFinite(value)), `benchmark line reported a non-numeric sample: ${line}`);
    samples.set(line.slice(0, separator), values);
  }
  return samples;
}

function dimension(samples: ReadonlyMap<string, number[]>, label: string): number {
  const values = samples.get(label);
  assert.ok(values, `benchmark did not report the '${label}' dimension`);
  return median(values);
}

/** Compiles a single-module VelarScript program and runs the emitted JavaScript under Node. */
async function benchmarkProgram(prefix: string, source: string): Promise<{ samples: Map<string, number[]>; code: string }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  const entry = join(directory, "main.vel");
  const output = join(directory, "dist");
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: [] }), "utf8");
  await writeFile(entry, source, "utf8");

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", entry, "--out-dir", output], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  const execution = spawnSync(process.execPath, [join(output, "main.js")], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr || execution.error));
  return { samples: parseSamples(execution.stdout), code: await readFile(join(output, "main.js"), "utf8") };
}

/**
 * Compiles a Web application and runs its production bundle under Node. The
 * reactive runtime only reaches the DOM through `mount`, so an unmounted
 * program exercises state, `computed`, and `watch` headlessly; the repo's own
 * reactivity regressions still run in Chromium through the browser gate.
 */
async function benchmarkWebProgram(prefix: string, source: string): Promise<Map<string, number[]>> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "Runtime performance" },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), source, "utf8");

  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", directory], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(build.status, 0, String(build.stderr || build.error));
  const assets = await readdir(join(directory, "dist", "assets"));
  const bundle = assets.find((name) => name.startsWith("main-") && name.endsWith(".js"));
  assert.ok(bundle, `Web build produced no main bundle: ${assets.join(", ")}`);
  const execution = spawnSync(process.execPath, [join(directory, "dist", "assets", bundle)], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.equal(execution.status, 0,
    `the Web bundle did not run under Node; if the reactive runtime now needs a DOM at module scope, move this case into tests/browser.acceptance.ts: ${String(execution.stderr || execution.error)}`);
  return parseSamples(execution.stdout);
}

const equalityProgram = `
import {monotonic} from "velar/time"

enum Status:
    active
    paused

const iterations = 10000000

def numberEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? 11 : 22
        const right = index % 5 < 3 ? 11 : 22
        if left == right:
            hits += 1
        index += 1
    return hits

def stringEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? "alpha" : "beta"
        const right = index % 5 < 3 ? "alpha" : "beta"
        if left == right:
            hits += 1
        index += 1
    return hits

def enumEquality(rounds: number) -> number:
    let hits = 0
    let index = 0
    while index < rounds:
        const left = index % 7 < 3 ? Status.active : Status.paused
        const right = index % 5 < 3 ? Status.active : Status.paused
        if left == right:
            hits += 1
        index += 1
    return hits

let sink = 0
let numberSamples = ""
let stringSamples = ""
let enumSamples = ""

sink += numberEquality(iterations)
sink += stringEquality(iterations)
sink += enumEquality(iterations)

let round = 0
while round < 5:
    let start = monotonic()
    sink += numberEquality(iterations)
    numberSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += stringEquality(iterations)
    stringSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += enumEquality(iterations)
    enumSamples += f"{str(monotonic() - start)},"
    round += 1

print(f"number={numberSamples}")
print(f"string={stringSamples}")
print(f"enum={enumSamples}")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted equality holds the SameValueZero hot-loop budget", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples, code } = await benchmarkProgram("velar-runtime-equality-", equalityProgram);

  // The three loops are structurally identical -- same modulo, same
  // comparison, same select -- so the only difference between them is the
  // operand type and therefore the lowering the analyzer chose.
  assert.match(code, /if \(__velarSameValueZero\(left, right\)\) \{/u,
    "numeric == no longer lowers to the SameValueZero repair");
  assert.equal(code.match(/if \(\(left === right\)\) \{/gu)?.length, 2,
    "string and enum == no longer elide the SameValueZero repair down to ===");

  const iterations = 10_000_000;
  const numberElapsed = dimension(samples, "number");
  const stringElapsed = dimension(samples, "string");
  const enumElapsed = dimension(samples, "enum");
  const ratio = numberElapsed / stringElapsed;
  const perComparison = (elapsed: number): string => `${((elapsed * 1e6) / iterations).toFixed(2)}ns/comparison`;
  const context = `${iterations.toLocaleString("en-US")} comparisons: number ${numberElapsed.toFixed(1)}ms (${perComparison(numberElapsed)}), `
    + `string ${stringElapsed.toFixed(1)}ms (${perComparison(stringElapsed)}), enum ${enumElapsed.toFixed(1)}ms (${perComparison(enumElapsed)}), `
    + `number/string ratio ${ratio.toFixed(2)}`;
  t.diagnostic(context);

  // Baseline 2026-08-12: number 20.9ms (2.09ns/comparison) for 10M `==` on
  // numbers, which the analyzer cannot prove NaN-free so every one calls
  // __velarSameValueZero.
  assert.ok(numberElapsed < 63, `SameValueZero numeric equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: string 15.1ms (1.51ns/comparison). Elided to ===.
  assert.ok(stringElapsed < 45, `elided string equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: enum 20.4ms (2.04ns/comparison). Also elided to ===;
  // the gap to the string case is the frozen-object property load an enum
  // member read costs, not equality work.
  assert.ok(enumElapsed < 62, `elided enum equality exceeded its budget -- ${context}`);
  // Baseline 2026-08-12: ratio 1.32 to 1.41 across runs, so SameValueZero
  // costs roughly 0.6ns per comparison once V8 inlines it. This bound is the
  // diagnostic that separates "equality lowering regressed" from "the whole
  // machine got slower", since both loops move together in the second case.
  assert.ok(ratio < 4, `SameValueZero cost too much relative to elided equality -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the equality benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});

const collectionProgram = `
import {monotonic} from "velar/time"
import {range} from "velar/collections"

const size = 100000
const rangeSize = 2000
const rangeReads = 200000

def buildList(count: number) -> List<number>:
    const output: List<number> = []
    let index = 0
    while index < count:
        output.append((index * 2654435761) % 1000003)
        index += 1
    return output

def readList(values: List<number>, reads: number) -> number:
    let total = 0
    let index = 0
    while index < reads:
        total += values[index % values.size]
        index += 1
    return total

def buildMap(count: number) -> Map<number, number>:
    const output: Map<number, number> = Map()
    let index = 0
    while index < count:
        output.set(index, index * 3)
        index += 1
    return output

def readMap(values: Map<number, number>, reads: number) -> number:
    let total = 0
    let index = 0
    while index < reads:
        total += values.get(index % 100000) ?? 0
        index += 1
    return total

def buildSet(count: number) -> Set<number>:
    const output: Set<number> = Set()
    let index = 0
    while index < count:
        output.add(index)
        index += 1
    return output

def readSet(values: Set<number>, reads: number) -> number:
    let total = 0
    let index = 0
    while index < reads:
        if values.has(index % 100000):
            total += 1
        index += 1
    return total

def readProvided(values: List<number>, reads: number) -> number:
    let total = 0
    let index = 0
    while index < reads:
        total += values[index % values.size]
        index += 1
    return total

let sink = 0
let appendSamples = ""
let indexSamples = ""
let mapSamples = ""
let filterSamples = ""
let sortedSamples = ""
let mapInsertSamples = ""
let mapLookupSamples = ""
let setInsertSamples = ""
let setLookupSamples = ""
let rangeIndexSamples = ""

def warmUp() -> null:
    const values = buildList(size)
    sink += readList(values, size)
    sink += values.map(value => value + 1).size
    sink += values.filter(value => value % 2 == 0).size
    sink += values.sorted().size
    const pairs = buildMap(size)
    sink += readMap(pairs, size)
    const members = buildSet(size)
    sink += readSet(members, size)
    sink += readProvided(range(0, rangeSize), rangeReads)

warmUp()

let round = 0
while round < 5:
    let start = monotonic()
    const values = buildList(size)
    appendSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += readList(values, size)
    indexSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const mapped = values.map(value => value + 1)
    mapSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const filtered = values.filter(value => value % 2 == 0)
    filterSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const ordered = values.sorted()
    sortedSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const pairs = buildMap(size)
    mapInsertSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += readMap(pairs, size)
    mapLookupSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const members = buildSet(size)
    setInsertSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += readSet(members, size)
    setLookupSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += readProvided(range(0, rangeSize), rangeReads)
    rangeIndexSamples += f"{str(monotonic() - start)},"
    sink += mapped.size + filtered.size + ordered.size + pairs.size + members.size
    round += 1

print(f"append={appendSamples}")
print(f"index={indexSamples}")
print(f"map={mapSamples}")
print(f"filter={filterSamples}")
print(f"sorted={sortedSamples}")
print(f"mapInsert={mapInsertSamples}")
print(f"mapLookup={mapLookupSamples}")
print(f"setInsert={setInsertSamples}")
print(f"setLookup={setLookupSamples}")
print(f"rangeIndex={rangeIndexSamples}")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted collection operations hold their large-List and Map/Set budgets", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples } = await benchmarkProgram("velar-runtime-collections-", collectionProgram);

  const size = 100_000;
  const append = dimension(samples, "append");
  const index = dimension(samples, "index");
  const mapped = dimension(samples, "map");
  const filtered = dimension(samples, "filter");
  const sorted = dimension(samples, "sorted");
  const mapInsert = dimension(samples, "mapInsert");
  const mapLookup = dimension(samples, "mapLookup");
  const setInsert = dimension(samples, "setInsert");
  const setLookup = dimension(samples, "setLookup");
  const rangeIndex = dimension(samples, "rangeIndex");
  const context = `over ${size.toLocaleString("en-US")} items: append ${append.toFixed(1)}ms, index ${index.toFixed(1)}ms, `
    + `map ${mapped.toFixed(1)}ms, filter ${filtered.toFixed(1)}ms, sorted ${sorted.toFixed(1)}ms, `
    + `Map.set ${mapInsert.toFixed(1)}ms, Map.get ${mapLookup.toFixed(1)}ms, Set.add ${setInsert.toFixed(1)}ms, Set.has ${setLookup.toFixed(1)}ms, `
    + `200,000 index reads of a 2,000-item range() ${rangeIndex.toFixed(1)}ms`;
  t.diagnostic(context);

  // Baselines 2026-08-12, all over a 100,000-item List built by `append`.
  // Provenance is settled by validation, not by construction site: the first
  // operation that proves a List dense records its element count, and every
  // later operation takes the cheap path until a foreign length change breaks
  // the match. A List the compiler did not build therefore pays full
  // validation once instead of on every read.
  // append 29.4ms (294ns/item)
  assert.ok(append < 90, `List.append exceeded its budget -- ${context}`);
  // index 22.8ms (228ns/read)
  assert.ok(index < 70, `List index reads exceeded their budget -- ${context}`);
  // map 9.7ms, filter 8.8ms, sorted 15.9ms, measured 2026-08-12 after every
  // callback operation's snapshot (__velarCopyList) took the owned fast path.
  // Before that the snapshot revalidated the whole List and then re-read every
  // element through a second descriptor, so `map` paid roughly three
  // allocations per element before the first callback ran: map 16.6ms,
  // filter 15.9ms, sorted 24.0ms.
  assert.ok(mapped < 30, `List.map exceeded its budget -- ${context}`);
  assert.ok(filtered < 27, `List.filter exceeded its budget -- ${context}`);
  assert.ok(sorted < 48, `List.sorted exceeded its budget -- ${context}`);
  // Map.set 22.0ms (220ns/insert), Map.get 14.2ms (142ns/lookup)
  assert.ok(mapInsert < 70, `Map.set exceeded its budget -- ${context}`);
  assert.ok(mapLookup < 45, `Map.get exceeded its budget -- ${context}`);
  // Set.add 14.2ms (142ns/insert)
  assert.ok(setInsert < 45, `Set.add exceeded its budget -- ${context}`);
  // Set.has 11.3ms (113ns/lookup), measured 2026-08-12 after the Map/Set brand
  // probe stopped identifying a non-Map by catching the TypeError the Map
  // `size` getter throws. The probe is still the only unforgeable, cross-realm
  // test JavaScript offers, but its verdict can never change for a given
  // object, so it runs once per object and is answered from a WeakMap after
  // that. Before the fix this dimension measured 190.0ms (1.90us/lookup),
  // roughly thirteen times Map.get for the same work.
  assert.ok(setLookup < 34, `Set.has exceeded its budget -- ${context}`);
  // rangeIndex 42.9ms for 200,000 index reads of the 2,000-item List `range()`
  // returns (214ns/read), measured 2026-08-12. This case used to be left out
  // of the gate deliberately: only mutating methods and map/filter/slice/sorted
  // marked a List owned, so a List that reached VelarScript from the standard
  // library revalidated all 2,000 elements on every single read and the same
  // 200,000 reads took 39,796ms (199us/read) -- quadratic document scanning
  // hiding behind an ordinary index expression.
  assert.ok(rangeIndex < 130, `index reads of a standard-library List exceeded their budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the collection benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});

const textProgram = `
import {monotonic} from "velar/time"

const corpus = "velarscript-runtime-benchmark-corpus;".repeat(6000)
const words = "alpha,beta,gamma,delta,epsilon,zeta,eta,theta,".repeat(4000)

def sliceCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        const start = (index * 6553) % 200000
        total += text.slice(start, start + 24).size
        index += 1
    return total

def searchCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        if text.has("benchmark-corpus"):
            total += 1
        if text.has("absent-needle-value"):
            total += 1
        index += 1
    return total

def padValues(count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        total += str(index).padStart(12, "0").size
        index += 1
    return total

def splitCorpus(text: string, count: number) -> number:
    let total = 0
    let index = 0
    while index < count:
        total += text.split(",").size
        index += 1
    return total

let sink = 0
let sliceSamples = ""
let searchSamples = ""
let padSamples = ""
let splitSamples = ""

sink += sliceCorpus(corpus, 300)
sink += searchCorpus(corpus, 2000)
sink += padValues(200000)
sink += splitCorpus(words, 20)

let round = 0
while round < 5:
    let start = monotonic()
    sink += sliceCorpus(corpus, 300)
    sliceSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += searchCorpus(corpus, 2000)
    searchSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += padValues(200000)
    padSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    sink += splitCorpus(words, 20)
    splitSamples += f"{str(monotonic() - start)},"
    round += 1

print(f"slice={sliceSamples}")
print(f"search={searchSamples}")
print(f"pad={padSamples}")
print(f"split={splitSamples}")
print(f"corpus={str(corpus.size)},")
print(f"words={str(words.size)},")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted string and value methods hold their large-corpus budgets", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples } = await benchmarkProgram("velar-runtime-text-", textProgram);

  // The budgets below are calibrated against these exact fixture sizes, so a
  // change to either invalidates them rather than merely moving the numbers.
  const corpus = dimension(samples, "corpus");
  assert.equal(corpus, 222_000, "the slice/has corpus changed size");
  assert.equal(dimension(samples, "words"), 184_000, "the split corpus changed size");

  const slice = dimension(samples, "slice");
  const search = dimension(samples, "search");
  const pad = dimension(samples, "pad");
  const split = dimension(samples, "split");
  const context = `over a ${corpus.toLocaleString("en-US")} code-point corpus: 300 slices ${slice.toFixed(1)}ms, `
    + `4,000 has ${search.toFixed(1)}ms, 200,000 padStart ${pad.toFixed(1)}ms, 20 splits ${split.toFixed(1)}ms`;
  t.diagnostic(context);

  // Baselines 2026-08-12.
  // slice 0.1ms for 300 slices spread evenly across the corpus (~0.3us each),
  // measured after the code-point-to-code-unit conversion gained the fast path
  // String.size already had: a string whose code-point count equals its
  // code-unit count carries no surrogate pair, so the position is already the
  // offset. Before that, the conversion walked code points from zero, making
  // every slice cost O(corpus + start offset) even for pure ASCII -- 153.8ms
  // for the same 300 slices (~510us each), which made any code that scans a
  // document by slicing quadratic. The budget stays well above the measured
  // value because the dimension is now dominated by fixed per-call overhead.
  assert.ok(slice < 12, `String.slice exceeded its budget -- ${context}`);
  // search 31.6ms for 4,000 String.has calls (~7.9us each, half of them a
  // full scan for an absent needle). Delegates to native indexOf, and is the
  // noisiest dimension in this file (25.9ms to 35.2ms across runs).
  assert.ok(search < 100, `String.has exceeded its budget -- ${context}`);
  // pad 13.6ms for 200,000 padStart calls (~68ns each)
  assert.ok(pad < 42, `String.padStart exceeded its budget -- ${context}`);
  // split 58.3ms for 20 splits into 32,001 parts (~2.9ms each)
  assert.ok(split < 180, `String.split exceeded its budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the text benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});

const reactiveProgram = `
import {monotonic} from "velar/time"

type Fields:
    one: string
    two: string
    three: string
    four: string
    five: string
    six: string
    seven: string
    eight: string

type Form:
    fields: Fields

state counter = 0
state form: Form = {fields: {one: "", two: "", three: "", four: "", five: "", six: "", seven: "", eight: ""}}
const doubled = computed(() => counter * 2)
let notifications = 0

watch doubled():
    notifications += 1

async def pushRound(updates: number) -> number:
    const start = monotonic()
    let index = 0
    while index < updates:
        counter += 1
        await tick()
        index += 1
    return monotonic() - start

def pullRound(updates: number) -> number:
    const start = monotonic()
    let total = 0
    let index = 0
    while index < updates:
        counter += 1
        total += doubled()
        index += 1
    if total < 0:
        print("unreachable")
    return monotonic() - start

def writeRound(updates: number) -> number:
    const start = monotonic()
    let index = 0
    while index < updates:
        form.fields.one = index % 2 == 0 ? "a" : "b"
        index += 1
    return monotonic() - start

def readRound(updates: number) -> number:
    const start = monotonic()
    let total = 0
    let index = 0
    while index < updates:
        total += form.fields.one.size + form.fields.eight.size
        index += 1
    if total < 0:
        print("unreachable")
    return monotonic() - start

let pushSamples = ""
let pullSamples = ""
let writeSamples = ""
let readSamples = ""

await pushRound(10000)
pullRound(10000)
writeRound(10000)
readRound(10000)
const observedAfterWarmUp = notifications

let round = 0
while round < 5:
    pushSamples += f"{str(await pushRound(10000))},"
    pullSamples += f"{str(pullRound(10000))},"
    writeSamples += f"{str(writeRound(10000))},"
    readSamples += f"{str(readRound(10000))},"
    round += 1

await tick()
print(f"push={pushSamples}")
print(f"pull={pullSamples}")
print(f"write={writeSamples}")
print(f"read={readSamples}")
print(f"notifications={str(notifications - observedAfterWarmUp)},")
`.trimStart();

test("emitted reactive updates hold the 10k-update throughput budget", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const samples = await benchmarkWebProgram("velar-runtime-reactive-", reactiveProgram);

  // Every pushed update must have reached the observer exactly once: five
  // rounds of 10,000 awaited updates, plus the trailing notification each
  // untimed pull round leaves queued.
  const notifications = dimension(samples, "notifications");
  assert.ok(notifications >= 50_000 && notifications <= 50_010,
    `reactive observer ran ${notifications} times for 50,000 pushed updates`);

  const push = dimension(samples, "push");
  const pull = dimension(samples, "pull");
  const write = dimension(samples, "write");
  const read = dimension(samples, "read");
  const context = `per 10,000 updates: state -> computed -> observer ${push.toFixed(1)}ms (${(push * 100).toFixed(0)}ns/update), `
    + `state -> computed recomputation ${pull.toFixed(1)}ms (${(pull * 100).toFixed(0)}ns/update), `
    + `deep record field write ${write.toFixed(1)}ms (${(write * 100).toFixed(0)}ns/write), `
    + `deep record field read ${read.toFixed(1)}ms (${(read * 100).toFixed(0)}ns/read-pair)`;
  t.diagnostic(context);

  // Baselines 2026-08-12, Web runtime driven headlessly under Node.
  // push 9.4ms per 10,000 mutate -> flush -> observer cycles (940ns each,
  // one microtask turn per update since each awaits tick()). The marathon
  // fix wave 2 did not move this dimension: the microtask turn dominates it.
  assert.ok(push < 30, `reactive observer notification exceeded its budget -- ${context}`);
  // pull 1.9ms per 10,000 mutate -> computed recomputations (190ns each),
  // from 2.0ms before the reactive read path stopped linking primitives and
  // stopped rebuilding a dependency Set per observer run (marathon beta-9).
  assert.ok(pull < 6, `computed recomputation exceeded its budget -- ${context}`);
  // write 4.2ms per 10,000 writes of one field of a nine-field reactive record
  // (420ns each), from 48.6ms (4,858ns each) before the write path stopped
  // running the containment probe -- two thrown-and-caught exceptions plus a
  // descriptor walk -- for primitive values (marathon beta-7).
  assert.ok(write < 13, `deep record field writes exceeded their budget -- ${context}`);
  // read 3.7ms per 10,000 two-field deep reads (370ns each), from 4.1ms
  // (marathon beta-9's early primitive bail on the proxy read path).
  assert.ok(read < 12, `deep record field reads exceeded their budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the reactive benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
