import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("collection operations use VelarScript return and bounds semantics", () => {
  const result = compile(`
let values = [1, 2]
print(values.get(9) == null)
print(values.append(3) == null)
print(values.extend([4, 5]) == null)
print(values.size)
print(values.remove(2))
print(values.pop())
print(values.some(value => value == 4))
print(values.every(value => value > 0))

const lookup: Map<string, number> = Map()
lookup.set("answer", 42)
print(lookup.get("missing") == null)
print(lookup.remove("answer"))

try:
    print(values[20])
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\ntrue\n5\ntrue\n5\ntrue\ntrue\ntrue\ntrue\nIndexError\n");

  const invalid = compile(`
const values = [1]
values.extend(["two"])
values.push(2)

const lookup: Map<string, number> = Map()
lookup.set("answer", 42)
print(lookup["answer"])
lookup["answer"] = 43
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign List<string> to List<number>/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /List has no member 'push'.*append/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Use Map\.get\(key\) instead of bracket access/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Use Map\.set\(key, value\) instead of bracket assignment/u.test(item.message)));
});

test("strict List indexing counts negative positions from the end", () => {
  const result = compileCore(`
let values = [10, 20, 30]
print(values[-1])
print(values[-3])
values[-1] = 40
values[-2] += 5
print(values[-1])
print(values[-2])

try:
    print(values[-4])
catch error:
    print(error.name)

try:
    values[-4] = 0
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "30\n10\n40\n25\nIndexError\nIndexError\n");
});

test("List, Set, and Map use familiar collection vocabulary without legacy aliases", () => {
  const result = compile(`
let values: List<number> = []
values.append(2)
values.extend([4, 6])
values.insert(1, 3)
print(values.size)
print(values.get(-1))
print(values.has(3))
print(values.remove(4))
print(values.pop())
print(values.some(value => value == 3))
print(values.every(value => value > 0))
print(values.index(3))

const words = ["beta", "alpha"]
print(words.sorted().join("|"))
print(words.map(word => f"<{word}>").filter(word => word != "<beta>").reduce((text, word) => text + word, ""))

const tags = Set(["web"])
print(tags.update(["game", "web"]) == null)
print(tags.has("game"))
print(tags.remove("web"))

const scores: Map<string, number> = Map()
scores.set("Ada", 9)
const more: Map<string, number> = Map()
more.set("Lin", 7)
print(scores.update(more) == null)
print(scores.get("Lin"))
print(scores.remove("Ada"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarListAppend/u);
  assert.match(result.code ?? "", /__velarListMap/u);
  assert.match(result.code ?? "", /__velarListFilter/u);
  assert.match(result.code ?? "", /__velarListReduce/u);
  assert.match(result.code ?? "", /__velarListJoin/u);
  assert.match(result.code ?? "", /__velarListSorted/u);
  assert.match(result.code ?? "", /__velarSetUpdate/u);
  assert.match(result.code ?? "", /__velarMapUpdate/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "4\n6\ntrue\ntrue\n6\ntrue\ntrue\n1\nalpha|beta\n<alpha>\ntrue\ntrue\ntrue\ntrue\n7\ntrue\n");

  const legacy = compile(`
const values = [1]
values.add(2)
values.addAll([3])
values.deleteAt(0)
values.splice(0, 1)
values.any(value => value > 0)
values.findIndex(value => value > 0)

const tags: Set<string> = Set()
tags.addAll(["web"])
tags.append("game")
tags.delete("web")

const scores: Map<string, number> = Map()
scores.setAll(Map())
scores.put("Ada", 9)
scores.delete("Ada")
`.trimStart());
  const messages = legacy.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /append\(value\)/u);
  assert.match(messages, /extend\(values\)/u);
  assert.match(messages, /pop\(index\)/u);
  assert.match(messages, /insert.*remove.*pop.*slice/u);
  assert.match(messages, /some\(test\)/u);
  assert.match(messages, /find\(test\).*index\(value\)/u);
  assert.match(messages, /Set has no member 'addAll'.*update/u);
  assert.match(messages, /Set has no member 'append'.*add/u);
  assert.match(messages, /Map has no member 'setAll'.*update/u);
  assert.match(messages, /Map has no member 'put'.*set/u);
  assert.match(messages, /remove/u);
  assert.doesNotMatch(messages, /Cannot call an unknown JavaScript value/u);
  assert.doesNotMatch(messages, /Ordered comparison requires/u);
});

test("collection methods use the same named-argument contract as ordinary functions", () => {
  const result = compileCore(`
def markIndex(label: string, value: number) -> number:
    print(label)
    return value

def markText(label: string, value: string) -> string:
    print(label)
    return value

let values = ["a", "c"]
values.insert(value=markText("value", "b"), index=markIndex("index", 1))
print(values.join(separator=","))
print(values.slice(end=2, start=1).join(separator="-"))
print([1, 2, 3].reduce(initial=0, combine=(sum, value) => sum + value))

const scores: Map<string, number> = Map()
scores.set(value=2, key="b")
print(scores.get(key="b"))

const tags: Set<string> = Set()
tags.add(value="web")
print(tags.has(value="web"))

const absent: List<string>? = null
absent?.append(value=markText("skipped", "x"))
print("done")
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "value\nindex\na,b,c\nb\n6\n2\ntrue\ndone\n");

  const inferred = compileCore(`
let values: List<number> = []
values.append(value=1)
const first: number = values[0]

let tags: Set<string> = Set()
tags.add(value="web")
const tag: string = tags.values()[0]

let scores: Map<string, number> = Map()
scores.set(value=1, key="Ada")
const score: number? = scores.get(key="Ada")
`.trimStart());
  assert.deepEqual(inferred.diagnostics, []);

  const wrongTypes = compileCore(`
const values = [1]
values.get(index="zero")
values.map(transform=1)

const scores: Map<string, number> = Map()
scores.get(key=1)
`.trimStart());
  const typeMessages = wrongTypes.diagnostics.map((item) => item.message).join("\n");
  assert.match(typeMessages, /Cannot assign string to number/u);
  // D114 S3b item A: one contract for every element callback, and the words the
  // author reads are the words assignability judges — both parameters arrive.
  assert.match(typeMessages, /Cannot assign number to \(number, number\) -> unknown/u);
  assert.match(typeMessages, /number and string have no values in common, so 'Map\.get' can never match/u);

  const invalidNames = compileCore(`
const values = [1]
values.append(item=2)
values.insert(value=2)
values.insert(index=0, index=1, value=2)
`.trimStart());
  const nameMessages = invalidNames.diagnostics.map((item) => item.message).join("\n");
  assert.match(nameMessages, /Unknown named argument 'item'/u);
  assert.match(nameMessages, /Missing required named argument: index/u);
  assert.match(nameMessages, /Parameter 'index' is provided more than once/u);
});

test("collection methods remain callable when stored as first-class values", () => {
  const result = compileCore(`
let values = [1]
const append = values.append
const get = values.get
append(value=2)
print(get(index=-1))
let receiverReads = 0
def source() -> List<number>:
    receiverReads += 1
    return values
const appendFromSource = source().append
appendFromSource(3)
print(receiverReads)
const present: List<number>? = values
const optionalAppend = present?.append
optionalAppend?.(value=4)
const absent: List<number>? = null
print(absent?.append == null)
print(values.get(-1))

const tags: Set<string> = Set()
const add = tags.add
const has = tags.has
add(value="web")
print(has(value="web"))

const scores: Map<string, number> = Map()
const setScore = scores.set
const getScore = scores.get
setScore(value=9, key="Ada")
print(getScore(key="Ada"))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /values\.append|tags\.add|scores\.set/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n1\ntrue\n4\ntrue\n9\n");
});

test("List aggregation and key sorting use checked snapshot semantics", () => {
  const result = compileCore(`
type Item:
    name: string
    rank: number

let items: List<Item> = [
    {name: "long", rank: 2},
    {name: "a", rank: 1},
    {name: "mid", rank: 2},
]
let keyCalls = 0
def rank(item: Item) -> number:
    keyCalls += 1
    if keyCalls == 1:
        items.append({name: "late", rank: 0})
    return item.rank

print([1, 2, 3].sum())
print([3, 1, 2].min())
print([3, 1, 2].max())
print([].min() == null)
print(["b", "a"].min())
print(items.sorted(by=rank).map(item => item.name).join("|"))
print(keyCalls)
print(items.size)

const sort = items.sorted
print(sort(by=item => item.name.size).get(0)?.name ?? "missing")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarListSum/u);
  assert.match(result.code ?? "", /__velarListMin/u);
  assert.match(result.code ?? "", /__velarListMax/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "6\n1\n3\ntrue\na\na|long|mid\n3\n4\na\n");

  const invalid = compileCore(`
print([true].sum())
print([true].min())
print([1, 2].sorted((left, right) => left - right, by=value => value))
print([1, 2].sorted(value => value))
const scores: Map<string, number> = Map()
print(scores.get("Ada", 0))
`.trimStart());
  const messages = invalid.diagnostics.map((item) => item.message).join("\n");
  assert.match(messages, /List\.sum requires List<number>/u);
  assert.match(messages, /List\.min requires List<number> or List<string>/u);
  assert.match(messages, /either a comparator or 'by=selector', not both/u);
  assert.match(messages, /Use 'sorted\(by=selector\)'/u);
  assert.match(messages, /Use 'get\(key\) \?\? fallback'/u);
});

test("empty collections take their element type from their own position", () => {
  // D85 rule 207: an annotation, a contextual type, or the constructor's own
  // arguments settle it — never a mutation on a later line.
  const settled = compile(`
type Bucket:
    values: List<number>

def share(tags: Set<string>):
    print(tags.size)

def empty() -> Map<string, number>:
    return Map()

let appended: List<number> = []
appended.append(1)
const first: number = appended[0]

const bucket: Bucket = {values: []}
const initial = Set(["web"])
share(Set())

component Values:
    state values: List<number> = []
    def addValues():
        values = [...values, 1, 2, 3]
    return <div>{values.map(value => <span key={value}>{value + 1}</span>)}</div>

print(first + empty().size + bucket.values.size + initial.size)
`.trimStart());
  assert.deepEqual(settled.diagnostics, []);
  const execution = executeModule(settled.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\n2\n");

  const unsettled = compile(`
const values = []
const tags = Set()
const scores = Map()
values.append(1)
tags.add("web")
scores.set("Ada", 9)
`.trimStart());
  assert.deepEqual(unsettled.diagnostics.map((item) => item.code), ["VEL4039", "VEL4039", "VEL4039"]);
  // The compiler cannot know which type was meant, so it offers no fix that
  // would turn the omission into a silently wrong annotation.
  assert.ok(unsettled.diagnostics.every((item) => item.fix === undefined));
  assert.match(unsettled.diagnostics[0]?.message ?? "", /Empty '\[\]' requires an explicit type/u);
  assert.match(unsettled.diagnostics[1]?.message ?? "", /const tags: Set<string> = Set\(\)/u);
  assert.match(unsettled.diagnostics[2]?.message ?? "", /what the Map holds/u);

  // A populated construction says what it holds even when that is `unknown`.
  const populated = compile("def take(value: unknown):\n    const items = [value]\n    print(items.size)\n");
  assert.deepEqual(populated.diagnostics, []);

  // VEL2031 already named where the type belongs, so VEL4039 stays quiet
  // rather than reporting the same mistake a second time.
  const misplaced = compile("const tags = Set<string>()\nprint(tags.size)\n");
  assert.deepEqual(misplaced.diagnostics.map((item) => item.code), ["VEL2031"]);
  assert.match(misplaced.diagnostics[0]?.message ?? "", /takes its type from the binding/u);
  assert.equal(misplaced.diagnostics[0]?.fix, undefined);
  const generic = compile("const values = mapValues<string, bool>([1])\n");
  assert.ok(generic.diagnostics.some((item) => item.code === "VEL2031" && item.fix !== undefined));
});

test("a check against unknown leaves the subject's own type alone", () => {
  // D85 rule 210: `unknown` is the one checked domain that proves nothing, so
  // a membership probe against a container of `unknown` must not replace the
  // subject's type with it.
  const probes = compile(`
def check(items: List<string>, tags: Set<unknown>, other: List<unknown>, keyed: Map<unknown, number>):
    for tag in items:
        if tag in tags:
            print(f"{tag}")
        if tag in other:
            print(f"{tag}")
        if tag in keyed:
            print(f"{tag}")
        assert tag not in tags else f"duplicate {tag}"
`.trimStart());
  assert.deepEqual(probes.diagnostics, []);

  // A checked domain that does prove something still narrows, and a nominal
  // `is` still establishes the named type rather than the structural one it
  // was assigned from.
  const narrows = compile(`
type User:
    name: string

def narrow(tag: string?, tags: Set<string>) -> number:
    if tag in tags:
        return tag.size
    return 0

const raw: unknown = {name: "n", age: 39}
assert raw is User
const named = raw
print(narrow("a", Set(["a"])) + named.name.size)
`.trimStart());
  assert.deepEqual(narrows.diagnostics, []);
});

test("Map.set contextually types its key and value like List.append does", () => {
  // D85 rule 211: the receiver's declared types reach the arguments, so a
  // value that reads its shape from context arrives checked, not `unknown`.
  const result = compile(`
const rows: Map<string, List<number>> = Map()
rows.set("a", [])
const handlers: Map<string, (number) -> number> = Map()
handlers.set("inc", value => value + 1)
print(rows.size + handlers.size)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n");

  // One wrong value is still exactly one diagnostic.
  const invalid = compile("const scores: Map<string, number> = Map()\nscores.set(\"a\", \"bad\")\n");
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), ["Cannot assign string to number"]);
});

test("Map.getOrSet returns one required value and inserts only when the key is absent", () => {
  const result = compile(`
const buckets: Map<string, List<number>> = Map()
const first = buckets.getOrSet("terrain", [])
first.append(1)
const second = buckets.getOrSet(fallback=[9], key="terrain")
const created = buckets.getOrSet("caves", [2])
print(first == second)
print(second)
print(created)
print(buckets.size)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarMapGetOrSet\(buckets,/u);
  assert.doesNotMatch(result.code ?? "", /__velarNarrow\(/u,
    "getOrSet returns V directly instead of creating an optional flow fact");
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\n[ 1 ]\n[ 2 ]\n2\n");

  const invalid = compile(`
const scores: Map<string, number> = Map()
scores.getOrSet(1, "bad")
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), [
    "Cannot assign number to string",
    "Cannot assign string to number",
  ]);

  const readonlyMap = compile(`
def fill(scores: readonly Map<string, number>):
    scores.getOrSet("a", 1)
`.trimStart());
  assert.deepEqual(readonlyMap.diagnostics.map((item) => item.message), [
    "Cannot call mutating method 'getOrSet' through readonly Map<string, number>; it is a read-only view",
  ]);
});

test("Map.getOrSetWith creates a missing value lazily and contextually types its factory", () => {
  const result = compile(`
const buckets: Map<string, List<number>> = Map()
let factoryCalls = 0

def createBucket() -> List<number>:
    factoryCalls += 1
    return [factoryCalls]

const first = buckets.getOrSetWith("terrain", createBucket)
const existing = buckets.getOrSetWith(factory=() => [], key="terrain")
const empty = buckets.getOrSetWith("caves", () => [])
empty.append(9)
print(first == existing)
print(first)
print(empty)
print(factoryCalls)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarMapGetOrSetWith\(buckets,/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\n[ 1 ]\n[ 9 ]\n1\n");

  const invalid = compile(`
const scores: Map<string, number> = Map()
scores.getOrSetWith("bad", () => "wrong")
`.trimStart());
  assert.deepEqual(invalid.diagnostics.map((item) => item.message), ["Cannot assign () -> string to () -> number"]);

  const readonlyMap = compile(`
def fill(scores: readonly Map<string, number>):
    scores.getOrSetWith("a", () => 1)
`.trimStart());
  assert.deepEqual(readonlyMap.diagnostics.map((item) => item.message), [
    "Cannot call mutating method 'getOrSetWith' through readonly Map<string, number>; it is a read-only view",
  ]);
});

test("optional collection annotations contextually type empty values", () => {
  const result = compileCore(`
type Names = List<string>

const names: Names? = []
const scores: Map<string, number>? = Map()
const tags: Set<string>? = Set()
print(names?.size)
print(scores?.size)
print(tags?.size)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\n0\n0\n");
});

test("null coalescing contextually types its deferred fallback", () => {
  const result = compileCore(`
type Mapper = (string) -> string

const optionalNames: List<string>? = null
const optionalScores: Map<string, number>? = null
const optionalTags: Set<string>? = null
const optionalMapper: Mapper? = null

const names: List<string> = optionalNames ?? []
const scores: Map<string, number> = optionalScores ?? Map()
const tags: Set<string> = optionalTags ?? Set()
const mapper: Mapper = optionalMapper ?? (value => value)

print(names.size)
print(scores.size)
print(tags.size)
print(mapper("Ada"))
print((value => value) == (value => value))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "0\n0\n0\nAda\nfalse\n");
});

test("List.slice returns a typed checked copy with familiar positional semantics", () => {
  const result = compile(`
const values = [1, 2, 3, 4]
const copied = values.slice()
const middle = values.slice(1, 3)
const tail = values.slice(-2)
copied[0] = 9
print(values[0])
print(middle[0])
print(tail[0])
print(values.slice(20).size)

try:
    print(values.slice(0.5).size)
catch error:
    print(error.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarCollectionSlice\(values, 1, 3\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  // COL-I2: every List position error is an IndexError.
  assert.equal(execution.stdout, "1\n2\n3\n0\nIndexError\n");

  const invalid = compile(`
const values = [1, 2, 3]
values.slice("1")
values.slice(0, 1, 2)
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /Expected 0-2 arguments but received 3/u.test(item.message)));
});

test("does not rewrite class methods that share collection method names", () => {
  const result = compile(`
class Box:
    def get() -> number:
        return 7

print(Box().get())
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(result.code ?? "", /__velarCollectionGet/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.stdout, "7\n");
});
