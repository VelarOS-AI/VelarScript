import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// Batch N-2 (audit fix wave, readonly and lowering): regressions for the D44
// rulings 72 (readonly accepts only pure data at every depth) and 74 (class
// methods live on the prototype and method references bind at the reference
// site), and the D45 rulings 75 (class names are not values) and 77 (a match
// over a class hierarchy must be provably exhaustive).

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

function compile(source: string): ReturnType<typeof compileCore> {
  return compileCore(source.trimStart());
}

function compileWeb(source: string): ReturnType<typeof compileCore> {
  return compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: code,
  });
}

/** Compiles cleanly and runs to completion; returns stdout. */
function run(source: string): string {
  const result = compile(source);
  assert.deepEqual(result.diagnostics.map((item) => item.message), [], source);
  assert.ok(result.code, source);
  const execution = executeModule(result.code);
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

function rejects(source: string, code: string, pattern: RegExp): void {
  const result = compile(source);
  assert.equal(result.code, null, source);
  const matched = result.diagnostics.find((item) => item.code === code && pattern.test(item.message));
  assert.ok(
    matched,
    `${source}\nexpected ${code} ${String(pattern)}, received ${JSON.stringify(result.diagnostics.map((item) => `${item.code}: ${item.message}`))}`,
  );
}

/** Writes a multi-module fixture to disk and runs its entry through the CLI. */
async function runProject(
  modules: Readonly<Record<string, string>>,
  entry: string,
): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), "velar-audit-class-"));
  try {
    for (const [name, text] of Object.entries(modules)) {
      await writeFile(join(directory, name), text, "utf8");
    }
    const execution = spawnSync(process.execPath, [cliPath, "run", join(directory, entry)], {
      encoding: "utf8",
      timeout: 120_000,
    });
    return { status: execution.status, stdout: String(execution.stdout), stderr: String(execution.stderr) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// D44 rule 72: `readonly T` requires pure data at every depth.
// ---------------------------------------------------------------------------

test("[D44-72] a record with a class member rejects readonly at the declaration site", () => {
  // The audited hole: `h.item.n = 5` compiled and really mutated through the
  // readonly view because protection silently ended at the class member.
  rejects(`
class Scale:
    let n: number = 1

    def peek() -> number:
        return self.n

type Holder:
    item: Scale

def look(h: readonly Holder) -> number:
    h.item.n = 5
    return h.item.peek()
`, "VEL4001", /'readonly' accepts only pure data at every depth; 'Holder\.item' is class 'Scale' — model it as a data record, or drop 'readonly'/u);

  // Two levels of nesting report the full path.
  rejects(`
class Scale:
    let n: number = 1

type Wrap:
    scale: Scale

type Holder:
    wrap: Wrap

def look(h: readonly Holder):
    return null
`, "VEL4001", /'Holder\.wrap\.scale' is class 'Scale'/u);

  // A class in a List element position rejects with the element path.
  rejects(`
class Scale:
    let n: number = 1

type Holder:
    items: List<Scale>

def look(h: readonly Holder):
    return null
`, "VEL4001", /'Holder\.items\[element\]' is class 'Scale'/u);

  // The readonly field modifier makes the same deep promise as `readonly T`.
  rejects(`
class Scale:
    let n: number = 1

type Holder:
    readonly item: Scale
`, "VEL4001", /'Holder\.item' is class 'Scale'/u);
});

test("[D44-72] a union arm containing a class rejects readonly", () => {
  rejects(`
class Scale:
    let n: number = 1

type Plain:
    n: number

type Holder:
    slot: Plain | Scale

def look(h: readonly Holder):
    return null
`, "VEL4001", /'Holder\.slot' is class 'Scale'/u);
});

test("[D44-72] bare type parameters, unknown members, and pure data stay legal", () => {
  // Opacity is as good as immutability: `readonly List<T>` stays legal.
  const generic = compile(`
def keep<T>(items: readonly List<T>) -> number:
    return items.size
`);
  assert.deepEqual(generic.diagnostics, []);

  // `unknown` members pass — they are already where static promises end.
  const unknownMember = compile(`
type Carrier:
    raw: unknown

def look(c: readonly Carrier):
    return null
`);
  assert.deepEqual(unknownMember.diagnostics, []);

  // The pure-data readonly path keeps working end to end.
  const output = run(`
type Profile:
    name: string

type Holder:
    profile: Profile

def read(h: readonly Holder) -> string:
    return h.profile.name

print(read({profile: {name: "Ada"}}))
`);
  assert.equal(output, "Ada\n");
});

test("[D44-72] recursive record types stay cycle-safe under the deep scan", () => {
  // A pure recursive record neither hangs nor rejects.
  const pure = compile(`
type Node:
    next: Node?
    label: string

def look(n: readonly Node) -> string:
    return n.label
`);
  assert.deepEqual(pure.diagnostics, []);

  // A recursive record that also reaches a class still rejects.
  rejects(`
class Scale:
    let n: number = 1

type Node:
    next: Node?
    scale: Scale

def look(n: readonly Node):
    return null
`, "VEL4001", /'Node\.scale' is class 'Scale'/u);

  // Mutually recursive records where only one arm reaches the class report
  // the shortest visible path instead of looping.
  rejects(`
class Scale:
    let n: number = 1

type Left:
    right: Right?
    label: string

type Right:
    left: Left?
    scale: Scale

def look(l: readonly Left):
    return null
`, "VEL4001", /'Left\.right\.scale' is class 'Scale'/u);
});

test("[D44-72/D74] mutable props admit classes while explicit readonly keeps the pure-data boundary", () => {
  // The bare class prop is visibly behavioral: passed as-is, methods callable.
  const bare = compileWeb(`
class ChartScale:
    let domain: number

    constructor(domain: number):
        self.domain = domain

    def scaled(value: number) -> number:
        return value * self.domain

component Chart(scale: ChartScale):
    return <span>{scale.scaled(2)}</span>
`);
  assert.deepEqual(bare.diagnostics, []);

  // D74: the same class buried inside a mutable data prop is legal because the
  // Web extension no longer adds an implicit readonly projection.
  const mutableBuried = compileWeb(`
class ChartScale:
    let domain: number

    constructor(domain: number):
        self.domain = domain

type Config:
    scale: ChartScale

component Chart(config: Config):
    return <span>ready</span>
`);
  assert.deepEqual(mutableBuried.diagnostics, []);

  // An author who explicitly chooses readonly still gets Core's pure-data
  // boundary, including at nested fields.
  const readonlyBuried = compileWeb(`
class ChartScale:
    let domain: number

    constructor(domain: number):
        self.domain = domain

type Config:
    scale: ChartScale

component Chart(config: readonly Config):
    return <span>ready</span>
`);
  assert.deepEqual(readonlyBuried.diagnostics.map((item) => item.message), [
    "'readonly' accepts only pure data at every depth; 'Config.scale' is class 'ChartScale' — model it as a data record, or drop 'readonly'",
  ]);
});

// ---------------------------------------------------------------------------
// D44 rule 74: methods live on the prototype; references bind at the site.
// ---------------------------------------------------------------------------

test("[D44-74] an extracted method reference calls correctly with self intact", () => {
  const output = run(`
class Counter:
    let n: number = 41

    def read() -> number:
        return self.n + 1

const counter = Counter()
const read = counter.read
print(read())
`);
  assert.equal(output, "42\n");
});

test("[D44-74] the reference receiver is evaluated once at the reference site", () => {
  // The collection-method rule of charter section 8, applied to classes.
  const output = run(`
class Counter:
    let n: number = 0

    def bump() -> number:
        self.n += 1
        return self.n

let reads = 0
const shared = Counter()

def source() -> Counter:
    reads += 1
    return shared

const bump = source().bump
bump()
bump()
print(shared.n)
print(reads)
`);
  assert.equal(output, "2\n1\n");
});

test("[D44-74] optional and static method references keep their receivers", () => {
  const output = run(`
class Counter:
    let n: number = 41

    def read() -> number:
        return self.n + 1

    static let made: number = 0

    static def make() -> number:
        Counter.made += 1
        return Counter.made

def pick(counter: Counter?) -> string:
    const read = counter?.read
    if read != null:
        return str(read())
    return "missing"

print(pick(Counter()))
print(pick(null))
const make = Counter.make
print(make())
print(make())
`);
  assert.equal(output, "42\nmissing\n1\n2\n");
});

test("[D44-74] prototype methods stay out of print output and off the instance", () => {
  const result = compile(`
class Counter:
    let n: number = 41

    def read() -> number:
        return self.n + 1

const counter = Counter()
print(counter)
`);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.code);
  const execution = executeModule(`${result.code}
console.log(Object.keys(counter).join(","));
console.log(typeof counter.read);
console.log(Object.getOwnPropertyDescriptor(counter, "read") === undefined);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  // Inspection shows the data field only; the method resolves through the
  // prototype and is not an own property of the instance.
  const [printed, keys, methodType, notOwn] = String(execution.stdout).split("\n");
  assert.match(printed ?? "", /\{ n: 41 \}/u);
  assert.doesNotMatch(printed ?? "", /read/u);
  assert.equal(keys, "n");
  assert.equal(methodType, "function");
  assert.equal(notOwn, "true");
});

test("[D44-74] inheritance chain lookup works through the prototype", () => {
  const output = run(`
class Base:
    let n: number = 1

    def bump() -> number:
        return self.n + 1

class Mid extends Base:
    let m: number = 2

class Leaf extends Mid:
    let k: number = 3

    def peek() -> number:
        return self.k

const leaf = Leaf()
print(leaf.bump())
print(leaf.peek())
const bump = leaf.bump
print(bump())
`);
  assert.equal(output, "2\n3\n2\n");
});

test("[D44-74] the emitted class carries no per-instance method closures", () => {
  const result = compile(`
class Counter:
    let n: number = 41

    def read() -> number:
        return self.n + 1

    private def hidden() -> number:
        return 7

    def open() -> number:
        return self.hidden()

const counter = Counter()
print(counter.read())
print(counter.open())
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  // No constructor re-binding and no arrow-holding private fields: methods —
  // private ones included — are native (private) methods on the class body.
  assert.doesNotMatch(code, /this\.read = this\.read\.bind\(this\)/u);
  assert.doesNotMatch(code, /#hidden = /u);
  assert.match(code, /^  read\(\) \{$/mu);
  assert.match(code, /^  #hidden\(\) \{$/mu);
  const execution = executeModule(code);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "42\n7\n");
});

test("[D90 R18] async for drives a Velar class through its declared asynchronous '@iterate:'", () => {
  // D90 R18: a user class streams by declaration, not by a structural `next`
  // method — the block is pulled once per element, and null is exhaustion.
  const output = run(`
class Pull:
    let position: number = 0

    @iterate:
        if self.position >= 2:
            return null
        self.position += 1
        return self.position

async def drain() -> string:
    let output = ""
    async for value in Pull():
        output += str(value)
    return output

print(await drain())
`);
  assert.equal(output, "12\n");
});

// ---------------------------------------------------------------------------
// D45 rule 75: class names are not values.
// ---------------------------------------------------------------------------

test("[D45-75] the five value positions reject a class name with the arrow-factory teaching", () => {
  const positions = [
    "const factory = P\n",
    "def hold(value: unknown):\n    return null\n\nhold(P)\n",
    "const items = [P]\n",
    "def pick() -> unknown:\n    return P\n",
    "print(P)\n",
  ];
  for (const position of positions) {
    rejects(`
class P:
    const x: number = 1

${position}`, "VEL4001", /A class name is not a value; call 'P\(\)' directly, or wrap a factory as an arrow '\(\) => P\(\)'/u);
  }
});

test("[D45-75] abstract and extern classes follow the same rule", () => {
  // Abstract classes previously rejected these positions only through their
  // instantiation error; all classes now share one behavior.
  rejects(`
abstract class Job:
    abstract def go() -> number

const alias = Job
`, "VEL4001", /A class name is not a value; call 'Job\(\)' directly/u);

  rejects(`
extern module "sdk":
    export class Remote:
        constructor()

import js {Remote} from "sdk"

const alias = Remote
`, "VEL4001", /A class name is not a value; call 'Remote\(\)' directly/u);
});

test("[D45-75] the legal class-name positions all stay legal", async () => {
  // Direct call, static access, extends, type position, is/case patterns.
  const output = run(`
class Base:
    const x: number = 1
    static const kind: string = "base"

    static def make() -> Base:
        return Base()

class Sub extends Base:
    const y: number = 2

def check(value: Base) -> string:
    if value is Sub:
        return "sub"
    match value:
        case Base:
            return "base"

const direct: Base = Base()
print(direct.x)
print(Base.kind)
print(Base.make().x)
print(check(Sub()))
print(check(Base()))
`);
  assert.equal(output, "1\nbase\n1\nsub\nbase\n");

  // Export declarations carry the class name across modules.
  const project = await runProject({
    "model.vel": `
export class Point:
    const x: number = 7
`.trimStart(),
    "barrel.vel": `
export {Point} from "./model.vel"
`.trimStart(),
    "main.vel": `
import {Point} from "./barrel.vel"

print(Point().x)
`.trimStart(),
  }, "main.vel");
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stdout, "7\n");
});

test("[D45-75] the arrow factory spelling works end to end", () => {
  const output = run(`
class P:
    const x: number = 1

def use(factory: () -> P) -> P:
    return factory()

const factories = [() => P()]
print(use(() => P()).x)
const made = factories.get(0)
if made != null:
    print(made().x)
`);
  assert.equal(output, "1\n1\n");
});

// ---------------------------------------------------------------------------
// D45 rule 77: class-hierarchy matches must be provably exhaustive.
// ---------------------------------------------------------------------------

test("[D45-77] a class match without a fallback is rejected", () => {
  // The audited behavior: a missed branch silently did nothing at runtime.
  rejects(`
class Base:
    let n: number = 1

class Sub extends Base:
    let m: number = 2

def check(b: Base):
    match b:
        case Sub:
            print("sub")
`, "VEL4015", /Match on Base is missing a fallback; class hierarchies are open — end with 'case Base:' or 'case _:'/u);
});

test("[D45-77] guarded cases do not count toward exhaustiveness", () => {
  rejects(`
class Base:
    let n: number = 1

def check(b: Base):
    match b:
        case Base if b.n > 0:
            print("positive")
`, "VEL4015", /Match on Base is missing a fallback/u);
});

test("[D45-77] base, wildcard, union, and null tails prove exhaustiveness", () => {
  const output = run(`
class Base:
    let n: number = 1

class Sub extends Base:
    let m: number = 2

class Other:
    let k: number = 3

def viaBase(b: Base) -> string:
    match b:
        case Sub:
            return "sub"
        case Base:
            return "base"

def viaWildcard(b: Base) -> string:
    match b:
        case Sub:
            return "sub"
        case _:
            return "other"

def viaUnion(value: Base | Other) -> string:
    match value:
        case Base:
            return "base"
        case Other:
            return "other"

def viaNull(b: Base?) -> string:
    match b:
        case Base:
            return "base"
        case null:
            return "missing"

print(viaBase(Sub()))
print(viaBase(Base()))
print(viaWildcard(Base()))
print(viaUnion(Other()))
print(viaNull(null))
`);
  assert.equal(output, "sub\nbase\nother\nother\nmissing\n");
});

test("[D45-77] an extern class subject is proved only by the wildcard", () => {
  // An extern runtime check may fail cross-realm, so its own case cannot
  // prove coverage; the diagnostic teaches the wildcard tail directly.
  rejects(`
extern module "sdk":
    export class Remote:
        constructor()

import js {Remote} from "sdk"

def check(value: Remote):
    match value:
        case Remote:
            print("remote")
`, "VEL4015", /Match on Remote is missing a fallback; class hierarchies are open — end with 'case _:'/u);
});

test("[D45-77] enum match exhaustiveness keeps its member-listing diagnostic", () => {
  rejects(`
enum Status:
    pending
    done

def check(s: Status):
    match s:
        case Status.pending:
            print("p")
`, "VEL4015", /Match on Status is missing: done/u);

  const output = run(`
enum Status:
    pending
    done

def check(s: Status) -> string:
    match s:
        case Status.pending:
            return "p"
        case Status.done:
            return "d"

print(check(Status.done))
`);
  assert.equal(output, "d\n");
});
