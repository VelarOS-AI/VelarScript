import assert from "node:assert/strict";
import test, { after } from "node:test";
import { removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { BENCHMARK_WALL_CLOCK_BUDGET_MS, benchmarkProgram, dimension, timeBudget } from "../../support/runtime-benchmark.ts";

/**
 * D115 P5 — the emitted collections, one subject of the file that was
 * `performance-runtime.slow.test.ts` before it reached 987 lines.
 *
 * What is bounded here is the cost of the List, Map and Set operations the
 * compiler owns: appends and index reads, the pipeline methods, and the
 * hashed insert and lookup, each at a size where a per-element allocation or a
 * replayed scan would show. The harness and the budget convention are in
 * `tests/support/runtime-benchmark.ts`; the bodies below are the bodies that
 * file had.
 */

after(removeTemporaryDirectories);

const collectionProgram = `
import {monotonic} from "velar/time"

const size = 100000
const rangeSize = 2000
const rangeReads = 200000
const bucketGroups = 256

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

def buildMapBuckets(count: number) -> Map<number, List<number>>:
    const output: Map<number, List<number>> = Map()
    let index = 0
    while index < count:
        output.getOrSet(index % bucketGroups, []).append(index)
        index += 1
    return output

def buildMapBucketsByLookup(count: number) -> Map<number, List<number>>:
    const output: Map<number, List<number>> = Map()
    let index = 0
    while index < count:
        const key = index % bucketGroups
        const bucket = output.get(key)
        if bucket == null:
            output.set(key, [index])
        else:
            bucket.append(index)
        index += 1
    return output

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
let mapBucketSamples = ""
let mapLookupBucketSamples = ""
let setInsertSamples = ""
let setLookupSamples = ""
let rangeIndexSamples = ""

def warmUp():
    const values = buildList(size)
    sink += readList(values, size)
    sink += values.map(value => value + 1).size
    sink += values.filter(value => value % 2 == 0).size
    sink += values.sorted().size
    const pairs = buildMap(size)
    sink += readMap(pairs, size)
    sink += buildMapBuckets(size).size
    sink += buildMapBucketsByLookup(size).size
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
    const buckets = buildMapBuckets(size)
    mapBucketSamples += f"{str(monotonic() - start)},"
    start = monotonic()
    const lookupBuckets = buildMapBucketsByLookup(size)
    mapLookupBucketSamples += f"{str(monotonic() - start)},"
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
    sink += buckets.size
    sink += lookupBuckets.size
    round += 1

print(f"append={appendSamples}")
print(f"index={indexSamples}")
print(f"map={mapSamples}")
print(f"filter={filterSamples}")
print(f"sorted={sortedSamples}")
print(f"mapInsert={mapInsertSamples}")
print(f"mapLookup={mapLookupSamples}")
print(f"mapBuckets={mapBucketSamples}")
print(f"mapLookupBuckets={mapLookupBucketSamples}")
print(f"setInsert={setInsertSamples}")
print(f"setLookup={setLookupSamples}")
print(f"rangeIndex={rangeIndexSamples}")
print(f"sink={str(sink)},")
`.trimStart();

test("emitted collection operations hold their large-List and Map/Set budgets", { timeout: 180_000 }, async (t) => {
  const started = performance.now();
  const { samples, code } = await benchmarkProgram("velar-runtime-collections-", collectionProgram);

  assert.match(code, /__velarListIndexGet\(values,/u);
  assert.match(code, /__velarMapGet\(values,/u);
  assert.match(code, /__velarMapGetOrSet\(output,/u);
  assert.match(code, /__velarSetHas\(values,/u);
  assert.match(code, /__velarListSize\(values\)/u);
  assert.doesNotMatch(code, /\b__velarCollection(?:Get|Has|Size)\b/u,
    "statically typed collection operations fell back to runtime kind dispatch");

  const size = 100_000;
  const append = dimension(samples, "append");
  const index = dimension(samples, "index");
  const mapped = dimension(samples, "map");
  const filtered = dimension(samples, "filter");
  const sorted = dimension(samples, "sorted");
  const mapInsert = dimension(samples, "mapInsert");
  const mapLookup = dimension(samples, "mapLookup");
  const mapBuckets = dimension(samples, "mapBuckets");
  const mapLookupBuckets = dimension(samples, "mapLookupBuckets");
  const setInsert = dimension(samples, "setInsert");
  const setLookup = dimension(samples, "setLookup");
  const rangeIndex = dimension(samples, "rangeIndex");
  const context = `over ${size.toLocaleString("en-US")} items: append ${append.toFixed(1)}ms, index ${index.toFixed(1)}ms, `
    + `map ${mapped.toFixed(1)}ms, filter ${filtered.toFixed(1)}ms, sorted ${sorted.toFixed(1)}ms, `
    + `Map.set ${mapInsert.toFixed(1)}ms, Map.get ${mapLookup.toFixed(1)}ms, Map.getOrSet buckets ${mapBuckets.toFixed(1)}ms, `
    + `Map.get/null buckets ${mapLookupBuckets.toFixed(1)}ms, Set.add ${setInsert.toFixed(1)}ms, Set.has ${setLookup.toFixed(1)}ms, `
    + `200,000 index reads of a 2,000-item range() ${rangeIndex.toFixed(1)}ms`;
  t.diagnostic(context);

  // Baselines refreshed 2026-08-19 after Core's non-reactive bridge became
  // static and typed collection operations selected exact helpers. All cover
  // a 100,000-item List built by `append`.
  // Provenance is settled by validation, not by construction site: the first
  // operation that proves a List dense records its element count, and every
  // later operation takes the cheap path until a foreign length change breaks
  // the match. A List the compiler did not build therefore pays full
  // validation once instead of on every read.
  // append 17.5ms (175ns/item)
  assert.ok(append < timeBudget(65), `List.append exceeded its budget -- ${context}`);
  // index 7.1ms (71ns/read)
  assert.ok(index < timeBudget(30), `List index reads exceeded their budget -- ${context}`);
  // map 4.8ms, filter 4.6ms, sorted 16.5ms, measured 2026-08-19 after every
  // callback operation's snapshot (__velarCopyList) took the owned fast path.
  // Before that the snapshot revalidated the whole List and then re-read every
  // element through a second descriptor, so `map` paid roughly three
  // allocations per element before the first callback ran: map 16.6ms,
  // filter 15.9ms, sorted 24.0ms.
  assert.ok(mapped < timeBudget(30), `List.map exceeded its budget -- ${context}`);
  assert.ok(filtered < timeBudget(27), `List.filter exceeded its budget -- ${context}`);
  assert.ok(sorted < timeBudget(48), `List.sorted exceeded its budget -- ${context}`);
  // Baseline 2026-08-19 after Core's non-reactive bridge became static and
  // typed collection operations selected exact helpers: Map.set 4.6ms,
  // Map.get 2.5ms, Set.add 3.9ms, Set.has 2.0ms per 100,000 operations.
  assert.ok(mapInsert < timeBudget(18), `Map.set exceeded its budget -- ${context}`);
  assert.ok(mapLookup < timeBudget(10), `Map.get exceeded its budget -- ${context}`);
  // Baseline 2026-08-26: 100,000 appends distributed across 256 List buckets
  // take about 28ms. Both canonical getOrSet and an explicit Map.get/null branch
  // must stay linear: the latter's const optional copy proves only non-nullness,
  // so it must not deep-validate the growing List again on every append.
  assert.ok(mapBuckets < timeBudget(75), `Map.getOrSet bucket grouping exceeded its budget -- ${context}`);
  assert.ok(mapLookupBuckets < timeBudget(75), `Map.get/null bucket grouping exceeded its budget -- ${context}`);
  assert.ok(setInsert < timeBudget(15), `Set.add exceeded its budget -- ${context}`);
  assert.ok(setLookup < timeBudget(9), `Set.has exceeded its budget -- ${context}`);
  // rangeIndex 12.1ms for 200,000 index reads of the 2,000-item List `range()`
  // returns (61ns/read), measured 2026-08-19. This case used to be left out
  // of the gate deliberately: only mutating methods and map/filter/slice/sorted
  // marked a List owned, so a List that reached VelarScript from the standard
  // library revalidated all 2,000 elements on every single read and the same
  // 200,000 reads took 39,796ms (199us/read) -- quadratic document scanning
  // hiding behind an ordinary index expression.
  assert.ok(rangeIndex < timeBudget(130), `index reads of a standard-library List exceeded their budget -- ${context}`);

  assert.ok(performance.now() - started < BENCHMARK_WALL_CLOCK_BUDGET_MS,
    `the collection benchmark took ${(performance.now() - started).toFixed(0)}ms end to end`);
});
