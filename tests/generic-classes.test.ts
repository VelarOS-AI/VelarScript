import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { compileProject } from "../packages/cli/src/project.ts";
import { projectCompletionsAt, projectExpressionAt, projectSymbolAt } from "../packages/cli/src/project-semantic.ts";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * D55 rule 120 layer two, decided by D77 rule 194 and D114's 定案: a class takes
 * type parameters. It is invariant in them (rule 194 item 1), they are erased
 * at runtime (item 2), the construction reads them from the arguments and from
 * the position (item 3, through D114 item ①), and a parameter none of that
 * solves is an error where the construction is written.
 */

const stack = `
class Stack<T>:
    private let items: List<T> = []

    def push(value: T):
        self.items.append(value)

    def pop() -> T?:
        return self.items.size > 0 ? self.items.pop() : null

    def all() -> List<T>:
        return self.items.copy()
`.trimStart();

function messages(source: string): readonly string[] {
  return compile(source.trimStart()).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function webMessages(source: string): readonly string[] {
  return compile(source.trimStart(), { path: "probe.vel", extensions: [webCompilerExtension] })
    .diagnostics.map((item) => `${item.code} ${item.message}`);
}

function bindingType(source: string, name: string): string | null | undefined {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  return result.semanticIndex.symbols.find((item) => item.name === name)?.type;
}

function run(source: string): string {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: result.code ?? "",
    timeout: 20_000,
  });
  assert.equal(execution.status, 0, String(execution.stderr));
  return String(execution.stdout);
}

test("[D55 120] a class declares type parameters, with and without a bound", () => {
  assert.deepEqual(messages(`${stack}
const numbers: Stack<number> = Stack()
numbers.push(1)
print(f"{numbers.all().size}")
`), []);

  assert.deepEqual(messages(`
class Sorted<T: Comparable>:
    private let items: List<T> = []

    def add(value: T):
        self.items.append(value)

    def ordered() -> List<T>:
        return self.items.sorted()

const names: Sorted<string> = Sorted()
names.add("b")
print(f"{names.ordered().size}")
`), []);

  assert.deepEqual(messages(`
abstract class Repository<T>:
    abstract def load(id: string) -> T?

class Numbers extends Repository<number>:
    override def load(id: string) -> number?:
        return id == "" ? null : 1

const repository: Repository<number> = Numbers()
print(f"{repository.load("a") ?? 0}")
`), []);
});

test("[D55 120] the class's parameters are out of scope in a static member", () => {
  assert.deepEqual(messages(`
class Holder<T>:
    let value: T
    static let seed: T = 1

    constructor(value: T):
        self.value = value
`), [
    "VEL4021 Type parameter 'T' belongs to class 'Holder', and a static member belongs to the class rather than to an instantiation, so 'T' has no value here; declare '<T>' on this member, or make it an instance member",
  ]);

  assert.deepEqual(messages(`
class Holder<T>:
    let value: T

    constructor(value: T):
        self.value = value

    static def build() -> T:
        return 1
`), [
    "VEL4021 Type parameter 'T' belongs to class 'Holder', and a static member belongs to the class rather than to an instantiation, so 'T' has no value here; declare '<T>' on this member, or make it an instance member",
  ]);

  assert.deepEqual(messages(`
class Holder<T>:
    let value: T

    constructor(value: T):
        self.value = value

    static get label() -> T:
        return 1
`), [
    "VEL4021 Type parameter 'T' belongs to class 'Holder', and a static member belongs to the class rather than to an instantiation, so 'T' has no value here; declare '<T>' on this member, or make it an instance member",
  ]);

  // A static member with its own parameter list is fine — it is solved at its
  // own call, and the class's is what it may not name.
  assert.deepEqual(messages(`
class Holder<T>:
    let value: T

    constructor(value: T):
        self.value = value

    static def echo<U>(value: U) -> U:
        return value

print(f"{Holder.echo("a")}")
`), []);
});

test("[D55 120] a method keeps its own type parameters beside the class's", () => {
  assert.deepEqual(messages(`
class Boxes<T>:
    private let items: List<T> = []

    def add(value: T):
        self.items.append(value)

    def mapped<U>(transform: (T) -> U) -> List<U>:
        return self.items.map(transform)

const boxes: Boxes<number> = Boxes()
boxes.add(1)
const rendered: List<string> = boxes.mapped(value => str(value))
print(f"{rendered.size}")
`), []);

  assert.deepEqual(messages(`
class Dup<T>:
    def method<T>(value: T) -> T:
        return value
`), ["VEL4021 Type parameter 'T' is already declared by class 'Dup' and is in scope here; rename this one"]);
});

test("[D55 121] an instantiation is a type in every type position, and an alias names it", () => {
  assert.deepEqual(messages(`${stack}
type Numbers = Stack<number>

type Holder:
    stack: Stack<number>
    nested: List<Stack<number>>
    doubled: Stack<Stack<string>>?

def take(value: Stack<number>) -> Stack<number>:
    return value

const numbers: Numbers = Stack()
const holder: Holder = {stack: numbers, nested: [numbers], doubled: null}
print(f"{take(holder.stack).all().size + holder.nested.size}")
`), []);
});

test("[D55 126] a bare generic class is not a type, and a self reference passes its parameters through", () => {
  assert.deepEqual(messages(`${stack}
def take(value: Stack) -> number:
    return 1
`), ["VEL4001 Generic class 'Stack' needs a type argument; write 'Stack<T>' with concrete types"]);

  assert.deepEqual(messages(`
class Node<T>:
    let next: Node<T>? = null
    let value: T

    constructor(value: T):
        self.value = value

const node: Node<number> = Node(1)
print(f"{node.next == null}")
`), []);

  assert.deepEqual(messages(`
class Bad<T>:
    let next: Bad<List<T>>? = null
`), [
    "VEL4021 Recursive generic class 'Bad' must use its own type parameters where it refers to 'Bad'; write 'Bad<T>' — arguments that change with the depth would need a new instantiation at every depth, without end",
  ]);
});

test("[D114 定案] a construction reads its type arguments from the arguments, the callbacks, and the position", () => {
  const box = `
class Box<T>:
    let value: T

    constructor(value: T):
        self.value = value
`.trimStart();

  // Phase 1: a fixed argument.
  assert.deepEqual(messages(`${box}
const boxed = Box(5)
const value: number = boxed.value
print(f"{value}")
`), []);

  // Phase 2: a callback's result.
  assert.deepEqual(messages(`
class Mapper<T>:
    let make: () -> T

    constructor(make: () -> T):
        self.make = make

const mapper = Mapper(() => "text")
const made: string = mapper.make()
print(f"{made}")
`), []);

  // Phase 3, the five Core-visible positions: a binding, an argument, a
  // return, an annotated record field, and — below — Web state and a JSX
  // attribute.
  assert.deepEqual(messages(`${stack}
type Holder:
    stack: Stack<bool>

def take(value: Stack<string>) -> number:
    return value.all().size

def produce() -> Stack<number>:
    return Stack()

const binding: Stack<number> = Stack()
const argument = take(Stack())
const field: Holder = {stack: Stack()}
print(f"{binding.all().size + argument + field.stack.all().size + produce().all().size}")
`), []);

  assert.deepEqual(webMessages(`${stack}
component Row(values: Stack<string>):
    return <li>{f"{values.all().size}"}</li>

export component Panel():
    state held: Stack<number> = Stack()

    return <ul><Row values={Stack()} />{f"{held.all().size}"}</ul>
`), []);
});

test("[D114 定案] a type parameter no argument and no position solves is an error at the construction", () => {
  assert.deepEqual(messages(`${stack}
const held = Stack()
print(f"{held.all().size}")
`), [
    "VEL4039 Constructing 'Stack' leaves type parameter 'T' unsolved; nothing at this position says what it stands for — annotate the binding ('const value: Stack<string> = Stack(...)'), or pass an argument that solves it",
  ]);

  // D55 rule 123 still refuses the written spelling, and the construction does
  // not name the same mistake a second time.
  assert.deepEqual(messages(`${stack}
const held = Stack<number>()
print(f"{held.all().size}")
`), ["VEL2031 Type arguments are inferred at each call site; write 'Stack(...)' without '<...>'"]);
});

test("[D77 194 item 1] a class is invariant in its type arguments", () => {
  assert.deepEqual(messages(`${stack}
def wide(values: Stack<number | string>) -> number:
    return 1

def narrow(values: Stack<number>) -> number:
    return 1

const n: Stack<number> = Stack()
const w: Stack<number | string> = Stack()
print(f"{wide(n)}")
print(f"{narrow(w)}")
const a: Stack<number> = w
const b: Stack<number | string> = n
`), [
    "VEL4001 Cannot assign Stack<number> to Stack<number | string>",
    "VEL4001 Cannot assign Stack<number | string> to Stack<number>",
    "VEL4001 Cannot assign Stack<number | string> to Stack<number>",
    "VEL4001 Cannot assign Stack<number> to Stack<number | string>",
  ]);
});

test("[D77 194 item 1] invariance does not depend on how a field is declared", () => {
  // A record widens through a read-only field (section 6); a class does not,
  // whatever its fields are declared as, because a class puts `T` in method
  // parameters too. One rule each.
  assert.deepEqual(messages(`
class Held<T>:
    const value: T

    constructor(value: T):
        self.value = value

const narrow: Held<number> = Held(1)
const wide: Held<number | string> = narrow
`), ["VEL4001 Cannot assign Held<number> to Held<number | string>"]);
});

test("[D77 194 item 2] a record field annotated with an instantiation validates the class itself", () => {
  const generic = compile(`
class Stack<T>:
    let n: number = 0

type Holder:
    stack: Stack<number>

const held: Stack<number> = Stack()
const raw: unknown = {stack: held}
const parsed: Holder? = try Holder.parse(raw)
print(f"{parsed != null}")
`.trimStart());
  const concrete = compile(`
class Stack:
    let n: number = 0

type Holder:
    stack: Stack

const held: Stack = Stack()
const raw: unknown = {stack: held}
const parsed: Holder? = try Holder.parse(raw)
print(f"{parsed != null}")
`.trimStart());
  assert.deepEqual(generic.diagnostics, []);
  assert.deepEqual(concrete.diagnostics, []);
  // The one difference between the two emitted validators is the type text the
  // failure report prints; the check itself is the same instance test, because
  // the arguments are erased.
  assert.equal((generic.code ?? "").replaceAll("Stack<number>", "Stack").replaceAll(/\d{3,}/gu, "N"),
    (concrete.code ?? "").replaceAll(/\d{3,}/gu, "N"));

  assert.equal(run(`
class Stack<T>:
    let n: number = 0

type Holder:
    stack: Stack<number>

const held: Stack<number> = Stack()
const raw: unknown = {stack: held}
const parsed: Holder? = try Holder.parse(raw)
print(f"{parsed != null}")
`), "true\n");
});

test("[D55 120] class matching over an instantiation is exhaustive by the ordinary rule", () => {
  assert.deepEqual(messages(`${stack}
class Other:
    let m: number = 0

def probe(value: Stack<number> | Other) -> number:
    match value:
        case Stack:
            return value.all().size
        case Other:
            return value.m
`), []);

  assert.ok(messages(`${stack}
class Other:
    let m: number = 0

def probe(value: Stack<number> | Other) -> number:
    match value:
        case Stack:
            return value.all().size
`).some((item) => item.startsWith("VEL4")));
});

test("[D55 120] a base applies a generic class, and the chain carries its arguments", () => {
  assert.deepEqual(messages(`${stack}
class IntStack extends Stack<number>:
    def total() -> number:
        return self.all().sum()

class Passthrough<T> extends Stack<T>:
    def count() -> number:
        return self.all().size

const applied: Stack<number> = IntStack()
const passed: Stack<string> = Passthrough()
print(f"{applied.all().size + passed.all().size}")
`), []);

  assert.deepEqual(messages(`${stack}
class Bad extends Stack:
    def count() -> number:
        return 0
`), [
    "VEL4001 Generic class 'Stack' needs a type argument; write 'extends Stack<T>' with concrete types",
  ]);

  assert.deepEqual(messages(`
class Plain:
    let count: number = 0

class Bad extends Plain<number>:
    def read() -> number:
        return 0
`), ["VEL4001 Class 'Plain' declares no type parameters, so it takes no type arguments"]);

  // A subclass of one instantiation is not a subclass of another.
  assert.deepEqual(messages(`${stack}
class IntStack extends Stack<number>:
    def total() -> number:
        return self.all().sum()

const wrong: Stack<string> = IntStack()
`), ["VEL4001 Cannot assign IntStack to Stack<string>"]);
});

test("[D55 120] an override is compared with the base arguments substituted", () => {
  assert.deepEqual(messages(`${stack}
class IntStack extends Stack<number>:
    override def push(value: number):
        super.push(value * 2)

const held: Stack<number> = IntStack()
held.push(2)
print(f"{held.all().size}")
`), []);

  assert.deepEqual(messages(`${stack}
class IntStack extends Stack<number>:
    override def push(value: string):
        pass
`), ["VEL4001 Override 'push' must keep the base method signature (value: number) -> null"]);
});

test("[D77 194 item 2] type arguments are erased, so a runtime check names the class", () => {
  assert.deepEqual(messages(`${stack}
def probe(value: unknown) -> bool:
    return value is Stack<number>
`), [
    "VEL4022 Type arguments are erased at runtime, so 'Stack<number>' cannot be checked; check 'Stack' itself",
  ]);

  assert.deepEqual(messages(`${stack}
def probe(value: unknown) -> bool:
    return value is not Stack<number>
`), [
    "VEL4022 Type arguments are erased at runtime, so 'Stack<number>' cannot be checked; check 'Stack' itself",
  ]);

  assert.deepEqual(messages(`${stack}
def probe(value: Stack<number> | string) -> string:
    match value:
        case Stack<number>:
            return "yes"
        case _:
            return "no"
`), [
    "VEL4022 Type arguments are erased at runtime, so 'Stack<number>' cannot be checked; check 'Stack' itself",
  ]);

  // The bare name is the whole of what an instance check can ask, so it is
  // accepted — and it keeps an argument the subject already named.
  assert.deepEqual(messages(`${stack}
def known(value: Stack<number> | string) -> number:
    if value is Stack:
        return value.all().sum()
    return value.size

def unknownSubject(value: unknown) -> number:
    if value is Stack:
        return value.all().size
    return 0

const held: Stack<number> = Stack()
print(f"{known(held) + unknownSubject(held)}")
`), []);

  // What the bare check proves, read off the narrowed binding: an unknown
  // subject gains `unknown` at every argument, and a subject that already
  // named one keeps it rather than losing it to the check.
  assert.equal(bindingType(`${stack}
def unknownSubject(value: unknown) -> number:
    if value is Stack:
        const held = value
        return held.all().size
    return 0
`, "held"), "Stack<unknown>");

  assert.equal(bindingType(`${stack}
def knownSubject(value: Stack<string> | number) -> number:
    if value is Stack:
        const held = value
        return held.all().size
    return 0
`, "held"), "Stack<string>");

  assert.deepEqual(messages(`${stack}
def take(value: readonly Stack<number>) -> number:
    return 1
`), [
    "VEL4001 'readonly' applies only to data records, structural objects, List, Set, Map, and Record values; Stack<number> is outside that boundary",
  ]);
});

test("[D55 124] a bound on a class parameter grants the body its capability and is checked at every instantiation", () => {
  assert.deepEqual(messages(`
class Sorted<T: Comparable>:
    private let items: List<T> = []

    def add(value: T):
        self.items.append(value)

    def ordered() -> List<T>:
        return self.items.sorted()

type Opaque:
    close: () -> null

const refused: Sorted<Opaque> = Sorted()
`), [
    "VEL4031 Type parameter 'T' of 'Sorted' is bound by Comparable, so this argument cannot be Opaque; a Comparable parameter accepts the types with a runtime order — numbers and strings",
  ]);

  // The body may only use what the bound promises.
  assert.deepEqual(messages(`
class Unsorted<T>:
    private let items: List<T> = []

    def ordered() -> List<T>:
        return self.items.sorted()
`), ["VEL4001 List<T>.sorted() requires an explicit comparator"]);
});

test("[D68 177 / D43 69] the compiler-owned class roles carry the class's parameters", () => {
  assert.equal(run(`
class Bag<T>:
    private let items: List<T> = []

    def add(value: T):
        self.items.append(value)

    @iterate:
        return self.items.copy()

const numbers: Bag<number> = Bag()
numbers.add(2)
numbers.add(3)
let total = 0
for item in numbers:
    total += item
print(f"{total}")
`), "5\n");

  assert.equal(run(`
class Owned<T>:
    let value: T

    constructor(value: T):
        self.value = value

    @dispose:
        print("released")

def main() -> number:
    using held = Owned(7)
    return held.value

print(f"{main()}")
`), "released\n7\n");
});

test("[D77 194 item 2] a generic class emits exactly what its monomorphic twin emits", () => {
  const generic = compile(`
class Stack<T>:
    private let items: List<T> = []

    def push(value: T):
        self.items.append(value)

    def pop() -> T?:
        return self.items.size > 0 ? self.items.pop() : null

    @iterate:
        return self.items.copy()

const numbers: Stack<number> = Stack()
numbers.push(1)
numbers.push(2)
for item in numbers:
    print(f"{item}")
print(f"{numbers.pop() ?? 0}")
`.trimStart());
  const concrete = compile(`
class Stack:
    private let items: List<number> = []

    def push(value: number):
        self.items.append(value)

    def pop() -> number?:
        return self.items.size > 0 ? self.items.pop() : null

    @iterate:
        return self.items.copy()

const numbers: Stack = Stack()
numbers.push(1)
numbers.push(2)
for item in numbers:
    print(f"{item}")
print(f"{numbers.pop() ?? 0}")
`.trimStart());
  assert.deepEqual(generic.diagnostics, []);
  assert.deepEqual(concrete.diagnostics, []);
  assert.equal(generic.code, concrete.code);
});

test("[D55 120] a generic class runs", () => {
  assert.equal(run(`
class Stack<T: Comparable>:
    private let items: List<T> = []

    def push(value: T):
        self.items.append(value)

    def ordered() -> List<T>:
        return self.items.sorted()

    def mapped<U>(transform: (T) -> U) -> List<U>:
        return self.items.map(transform)

class DoubledStack extends Stack<number>:
    override def push(value: number):
        super.push(value * 2)

const numbers: Stack<number> = Stack()
numbers.push(3)
numbers.push(1)
const doubled: Stack<number> = DoubledStack()
doubled.push(5)
print(f"{numbers.mapped(value => str(value)).join("|")}")
print(f"{doubled.mapped(value => str(value)).join("|")}")
print(f"{numbers.ordered().size}")
print(f"{numbers is Stack}")
`), "3|1\n10\n2\ntrue\n");
});

test("[D55 121] a generic class keeps its parameters and its identity across a module boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-generic-classes-"));
  try {
    const libraryPath = join(directory, "stack.vel");
    const mainPath = join(directory, "main.vel");
    const mainSource = `
import {Stack, IntStack} from "./stack.vel"
import {Stack as Pile} from "./stack.vel"
import * as library from "./stack.vel"

const direct: Stack<string> = Stack()
const renamed: Pile<string> = Pile()
const namespaced: Stack<string> = library.Stack()
const derived: Stack<number> = IntStack()

direct.push("a")
renamed.push("b")
namespaced.push("c")
print(f"{direct.ordered().size + renamed.ordered().size + namespaced.ordered().size + derived.ordered().size}")
`.trimStart();
    await writeFile(libraryPath, `
export class Stack<T: Comparable>:
    private let items: List<T> = []

    def push(value: T):
        self.items.append(value)

    def ordered() -> List<T>:
        return self.items.sorted()

export class IntStack extends Stack<number>:
    def total() -> number:
        return self.ordered().sum()
`.trimStart(), "utf8");
    await writeFile(mainPath, mainSource, "utf8");

    const project = await compileProject(mainPath, new Map(), {});
    assert.deepEqual(project.failures, []);
    assert.deepEqual(project.modules.flatMap((module) => module.result.diagnostics), []);

    const main = project.modules.find((module) => module.inputPath === mainPath);
    const typeOf = (name: string): string | null | undefined =>
      main?.result.semanticIndex.symbols.find((item) => item.name === name)?.type;
    assert.equal(typeOf("direct"), "Stack<string>");
    // A renamed import names the same instantiation, so it reads back under
    // the one display text that identity carries — the behavior a generic
    // record imported twice already has.
    assert.equal(typeOf("renamed"), "Stack<string>");
    assert.equal(typeOf("derived"), "Stack<number>");

    // The editor reads the substituted member surface an instantiation opens.
    const memberOffset = mainSource.indexOf("direct.push") + "direct.pu".length;
    const member = projectExpressionAt(project, mainPath, memberOffset);
    assert.equal(member?.ownerType, "Stack<string>");
    assert.equal(member?.type, "(value: string) -> null");

    const dotOffset = mainSource.indexOf("direct.push") + "direct.".length;
    const completions = projectCompletionsAt(project, mainPath, dotOffset);
    assert.deepEqual(completions?.map((item) => `${item.label}: ${item.detail}`), [
      "push: (value: string) -> null",
      "ordered: () -> List<string>",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D55 127.2] the formatter round-trips a generic class header and a generic base", () => {
  const source = `
class Stack<T: Comparable>:
    private let items: List<T> = []

    def push(value: T):
        self.items.append(value)

    def mapped<U>(transform: (T) -> U) -> List<U>:
        return self.items.map(transform)

abstract class Repository<T>:
    abstract def load(id: string) -> T?

class IntStack extends Stack<number>:
    override def push(value: number):
        super.push(value * 2)

class Passthrough<T: Comparable> extends Stack<T>:
    def count() -> number:
        return 0

const numbers: Stack<number> = Stack()
const nested: List<Stack<number>> = [numbers]
print(f"{nested.size}")
`.trimStart();
  assert.deepEqual(messages(source), []);
  const formatted = formatSource(source);
  assert.equal(formatSource(formatted), formatted);
  for (const header of [
    "class Stack<T: Comparable>:",
    "def mapped<U>(transform: (T) -> U) -> List<U>:",
    "abstract class Repository<T>:",
    "class IntStack extends Stack<number>:",
    "class Passthrough<T: Comparable> extends Stack<T>:",
    "const nested: List<Stack<number>> = [numbers]",
  ]) {
    assert.ok(formatted.includes(header), `${header}\n---\n${formatted}`);
  }
});

// D114 0.28.0 I-I2: a `def` publishes its type parameters in a hover and a
// generic class published none, so `class Stack<T: Comparable>` read back as
// `class Stack: Stack` at its declaration and at every construction — the
// reader was never told the class takes a parameter, let alone what it must
// satisfy. The declaration is what a class symbol has to show.
