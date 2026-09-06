import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile as compileCore, formatSource, inspectModule as inspectCoreModule } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../../support/temporary-directory.ts";
import { executeModule } from "../../support/execute-module.ts";
import { compile, compileProject } from "../../support/compiler-suite.ts";

after(removeTemporaryDirectories);

test("imported classes preserve construction, aliases, and nominal checks", async () => {
  const directory = await makeTemporaryDirectory("velar-module-class-");
  const output = join(directory, "dist");
  await writeFile(join(directory, "models.vel"), `
export class Player:
    const name: string

    constructor(name: string):
        self.name = name

    def label() -> string:
        return self.name
`.trimStart(), "utf8");
  await writeFile(join(directory, "main.vel"), `
import {Player as Hero} from "./models.vel"
const player = Hero("Nova")
print(player.label())
print(player is Hero)
`.trimStart(), "utf8");
  const build = spawnSync(process.execPath, ["packages/cli/src/cli.ts", "build", join(directory, "main.vel"), "--out-dir", output], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const execution = spawnSync(process.execPath, [join(output, "main.js")], { encoding: "utf8" });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "Nova\ntrue\n");
});

test("VelarScript classes use module identities instead of colliding display names", async () => {
  const directory = await makeTemporaryDirectory("velar-class-identity-");
  await writeFile(join(directory, "first.vel"), "export class Session:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n", "utf8");
  await writeFile(join(directory, "second.vel"), "export class Session:\n    const id: string\n\n    constructor(id: string):\n        self.id = id\n", "utf8");
  const entry = join(directory, "main.vel");
  await writeFile(entry, `
import {Session as FirstSession} from "./first.vel"
import {Session as SameSession} from "./first.vel"
import {Session as SecondSession} from "./second.vel"
const first = FirstSession("one")
const same: SameSession = first
const wrong: SecondSession = first
`.trimStart(), "utf8");

  const result = await compileProject(entry);
  const diagnostics = result.modules.flatMap((module) => module.result.diagnostics);
  assert.equal(diagnostics.filter((item) => /Cannot assign/u.test(item.message)).length, 1);
  assert.ok(diagnostics.some((item) => /Cannot assign FirstSession to SecondSession/u.test(item.message)));
});

test("class inheritance, abstract contracts, super, static methods, and Error remain native JavaScript", () => {
  const result = compile(`
abstract class Shape:
    abstract def area() -> number

class Circle extends Shape:
    const radius: number

    constructor(radius: number):
        super()
        self.radius = radius

    override def area() -> number:
        return self.radius * self.radius

class Entity:
    const id: string

    constructor(id: string):
        self.id = id

    def describe() -> string:
        return self.id

class Player extends Entity:
    let score: number

    constructor(id: string, score: number = 0):
        super(id)
        self.score = score

    override def describe() -> string:
        return f"{super.describe()}:{self.score}"

    static def guest() -> Player:
        return Player("guest", 1)

class RequiredFieldError extends Error:
    const field: string

    constructor(field: string, message: string):
        super(message)
        self.field = field

const shape: Shape = Circle(3)
const entity: Entity = Player.guest()
const error: Error = RequiredFieldError("name", "Required")
print(shape.area())
print(entity.describe())
print(entity is Entity)
print(error.message)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /class Circle extends Shape/);
  assert.match(result.code ?? "", /super\(\);/);
  assert.match(result.code ?? "", /class Player extends Entity/);
  assert.match(result.code ?? "", /super\(id\);/);
  assert.match(result.code ?? "", /static guest\(\)/);
  assert.match(result.code ?? "", /class RequiredFieldError extends Error/);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "9\nguest:1\ntrue\nRequired\n");
});

test("super follows class-member lexical boundaries and supports checked static overrides", () => {
  const result = compile(`
class Base:
    static const prefix: string = "base"

    static get category() -> string:
        return "entity"

    static def label() -> string:
        return Base.prefix

    def instanceLabel() -> string:
        return "instance"

class Child extends Base:
    override static get category() -> string:
        return super.category + ":child"

    override static def label() -> string:
        const read = () => super.label()
        return f"{read()}:{super.prefix}"

    override def instanceLabel() -> string:
        const read = () => super.instanceLabel()
        return read() + ":child"

print(Child.category)
print(Child.label())
print(Child().instanceLabel())
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "entity:child\nbase:base\ninstance:child\n");

  const nestedFunction = compile(`
class Base:
    def label() -> string:
        return "base"

class Child extends Base:
    override def label() -> string:
        def nested() -> string:
            return super.label()
        return nested()
`.trimStart());
  assert.ok(nestedFunction.diagnostics.some((item) => /nested arrow/u.test(item.message)), JSON.stringify(nestedFunction.diagnostics));
  assert.equal(nestedFunction.code, null);

  const missingOverride = compile(`
class Base:
    static get category() -> string:
        return "base"

    static def label() -> string:
        return "base"

class Child extends Base:
    static get category() -> string:
        return "child"

    static def label() -> string:
        return "child"
`.trimStart());
  assert.equal(missingOverride.diagnostics.filter((item) => /must use 'override'/u.test(item.message)).length, 2);

  const invalid = compile(`
class Base:
    static const version: string = "1"

    static def label(value: string) -> string:
        return value

class Child extends Base:
    static const version: string = "2"

    override static def label(value: number) -> string:
        return str(value)
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => /static fields cannot be overridden/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => /must keep the base method signature/u.test(item.message)));
});

test("constructor parameter fields initialize public and private state after super", () => {
  const source = `
export class Base:
    constructor(const prefix: string): pass

export class Session extends Base:
    constructor(prefix: string, private const secret: string, let count: number = 1, label: string = "ready"):
        super(prefix)
        assert label == "ready"

    def reveal() -> string: return f"{self.prefix}:{self.secret}:{self.count}"

const session = Session("agent", "token")
session.count += 1
print(session.reveal())
`.trimStart();
  assert.equal(formatSource(source), source);
  const result = compileCore(source);
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /constructor\(prefix, secret, count = 1, label = "ready"\)/u);
  assert.match(result.code ?? "", /super\(prefix\);\n\s+this\.#secret = secret;\n\s+this\.count = count;/u);
  assert.match(result.code ?? "", /#secret;/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "agent:token:2\n");

  const inspected = inspectCoreModule(source, { path: "/constructor-fields.vel" });
  assert.deepEqual(inspected.diagnostics, []);
  const base = inspected.moduleInterface.classes.get("Base")!;
  const session = inspected.moduleInterface.classes.get("Session")!;
  assert.deepEqual([...base.fields], [["prefix", { mutable: false, type: { kind: "string" } }]]);
  assert.deepEqual([...session.fields], [["count", { mutable: true, type: { kind: "number" } }]]);
  assert.equal(session.fields.has("secret"), false);

  const invalid = compileCore(`
class Invalid:
    constructor(private value: string, private const missingType, ...const values: number, static let shared: number):
        pass
`.trimStart());
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL2021" && /private constructor parameter must declare a field/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL2021" && /parameter fields require an explicit type/u.test(item.message)));
  // CLS-D3: source constructors reject rest outright (both spellings were
  // broken at runtime), so the field-specific rest diagnostic is gone.
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL2016" && /Class constructors do not support rest parameters/u.test(item.message)));
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL2021" && /parameters cannot be static/u.test(item.message)));
});

test("constructors initialize fields once after the base constructor and preserve bound methods", () => {
  const result = compile(`
def invoke(callback: () -> null):
    callback()

class Base:
    let steps: List<string>

    constructor(steps: List<string>):
        self.steps = steps
        self.steps.append("base")

class Child extends Base:
    const value: number
    let doubled: number

    constructor(steps: List<string>, value: number):
        super(steps)
        self.value = value
        self.doubled = value * 2
        assert value > 0 else "Value must be positive"
        invoke(self.record)

    def record():
        self.steps.append(f"value:{self.doubled}")

const steps: List<string> = []
const child = Child(steps, 3)
print(steps[0])
print(steps[1])
print(child.doubled)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /super\(steps\);/u);
  assert.match(result.code ?? "", /self\.value = value;/u);
  assert.match(result.code ?? "", /self\.doubled = \(value \* 2\);/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "base\nvalue:6\n6\n");

  for (const binding of ["const", "let"]) {
    const duplicateInitializer = compile(`class Invalid:
    ${binding} value: number = 1

    constructor():
        self.value = 2
`);
    assert.equal(duplicateInitializer.diagnostics.filter((item) => /initializes field 'value' more than once/u.test(item.message)).length, 1);
  }

  const inheritedConst = compile(`
class Base:
    const id: string

    constructor(id: string):
        self.id = id

class Child extends Base:
    constructor():
        super("fixed")
        self.id = "other"
`.trimStart());
  assert.ok(inheritedConst.diagnostics.some((item) => /Cannot assign to const field 'id'/u.test(item.message)));
});

test("constructors own one synchronous non-returning execution boundary", () => {
  const valid = compile(`
async def ready() -> number:
    return 1

class Scheduler:
    constructor():
        async def later() -> number:
            return await ready()
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);

  const direct = compile(`
async def ready() -> number:
    return 1

class Invalid:
    constructor():
        const value = await ready()
        return null
`.trimStart());
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL4007" && /constructor/u.test(item.message)));
  assert.ok(direct.diagnostics.some((item) => item.code === "VEL3014" && /constructor/u.test(item.message)));

  const duplicate = compile("class Invalid:\n    constructor():\n        pass\n    constructor():\n        pass\n");
  assert.ok(duplicate.diagnostics.some((item) => item.code === "VEL2022" && /more than one constructor/u.test(item.message)));

  for (const modifier of ["async", "static", "override", "abstract"]) {
    const modified = compile(`class Invalid:\n    ${modifier} constructor():\n        pass\n`);
    assert.ok(modified.diagnostics.some((item) => item.code === "VEL2022" && /does not accept method modifiers/u.test(item.message)), JSON.stringify(modified.diagnostics));
  }
});

test("init remains an ordinary identifier after the init block syntax is removed", () => {
  const result = compile(`
type Options:
    init: string

class Worker:
    const label: string

    constructor(label: string):
        self.label = label
        assert label != ""

    def init(suffix: string) -> string:
        return self.label + suffix

const init: string = "ready"
const options: Options = {init}
const worker = Worker("Velar")
print(options.init)
print(worker.init("!"))
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ready\nVelar!\n");
});

test("class body fields keep body-owned instance state out of constructor signatures", () => {
  const result = compile(`
class Ledger:
    static const kind: string = "ledger"
    static let created: number = 0
    const label: string
    const display: string
    const entries: List<number> = []
    let total: number = 0

    constructor(label: string):
        self.label = label
        self.display = f"{label} ledger"

    def add(value: number):
        self.entries.append(value)
        self.total += value

    def summary() -> string:
        return f"{self.display}:{self.total}:{self.entries.size}"

const ledger = Ledger("main")
Ledger.created += 1
ledger.add(4)
ledger.add(7)
print(Ledger.kind)
print(Ledger.created)
print(ledger.summary())
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /static kind = "ledger";/u);
  assert.match(result.code ?? "", /constructor\(label\)/u);
  assert.match(result.code ?? "", /self\.label = label;/u);
  assert.match(result.code ?? "", /self\.display = `\$\{label\} ledger`;/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "ledger\n1\nmain ledger:11:2\n");

  const invalidSyntax = compile(`
class Broken:
    const missing = 1
    async const delayed: number = 1
`.trimStart());
  assert.ok(invalidSyntax.diagnostics.some((item) => item.code === "VEL2021" && /require an explicit type/u.test(item.message)));
  assert.ok(invalidSyntax.diagnostics.some((item) => /Class fields support only the 'private' and 'static' modifiers/u.test(item.message)));

  const invalidSemantics = compile(`
class Broken:
    const code: string = "broken"
    let count: number = "one"
    const delayed: number = await load()
    static const name: string = "broken"
    static def name() -> string:
        return "duplicate"

const value = Broken()
value.code = "changed"
Broken.name = "changed"
`.trimStart());
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign string to number/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /'await' cannot be used in a class field initializer/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /conflicts with a static field/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign to const field 'code'/u.test(item.message)));
  assert.ok(invalidSemantics.diagnostics.some((item) => /Cannot assign to read-only static member 'name'/u.test(item.message)));
});

test("static fields cannot expose JavaScript initialization-order undefined", () => {
  const direct = compile(`
class Counter:
    static const first: number = Counter.second
    static const second: number = 2
`.trimStart());
  assert.ok(direct.diagnostics.some((item) => /Static field 'second' is read before it is initialized/u.test(item.message)));

  const privateDirect = compile(`
class Counter:
    private static const first: number = Counter.second
    private static const second: number = 2
`.trimStart());
  assert.ok(privateDirect.diagnostics.some((item) => /Static field 'second' is read before it is initialized/u.test(item.message)));

  const indirect = compile(`
class Counter:
    static const first: number = Counter.readSecond()
    static const second: number = 2

    static def readSecond() -> number:
        return Counter.second
`.trimStart());
  assert.deepEqual(indirect.diagnostics, []);
  assert.match(indirect.code ?? "", /__velarReadStaticField\(Counter, "second", 0\)/u);
  const failed = executeModule(indirect.code ?? "");
  assert.notEqual(failed.status, 0);
  assert.match(String(failed.stderr), /Static field 'second' was read before initialization/u);

  const compound = compile(`
class Label:
    static const first: string = Label.extend()
    static let second: string = "ready"

    static def extend() -> string:
        Label.second += "!"
        return Label.second
`.trimStart());
  assert.deepEqual(compound.diagnostics, []);
  const compoundFailure = executeModule(compound.code ?? "");
  assert.notEqual(compoundFailure.status, 0);
  assert.match(String(compoundFailure.stderr), /Static field 'second' was read before initialization/u);

  const valid = compile(`
async def next() -> number:
    return 3

class Base:
    static const value: number = 2

class Derived extends Base:
    static const copy: number = Derived.value
    static const load: () -> Promise<number> = async () => await next()

print(Derived.copy)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.match(valid.code ?? "", /__velarReadStaticField\(Derived, "value", 1\)/u);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "2\n");
});

test("instance fields cannot expose partially initialized JavaScript values", () => {
  const direct = compile(`
class User:
    const name: string

    constructor():
        print(self.name)
        self.name = "Ada"

User()
`.trimStart());
  assert.deepEqual(direct.diagnostics, []);
  assert.match(direct.code ?? "", /__velarReadInstanceField\(self, "name"\)/u);
  const directFailure = executeModule(direct.code ?? "");
  assert.notEqual(directFailure.status, 0);
  assert.match(String(directFailure.stderr), /Field 'name' was read before initialization/u);

  const privateDirect = compile(`
class Vault:
    private const secret: string

    constructor():
        print(self.secret)
        self.secret = "token"

Vault()
`.trimStart());
  assert.deepEqual(privateDirect.diagnostics, []);
  assert.match(privateDirect.code ?? "", /__velarReadPrivateField\(self\.#secret, "secret"\)/u);
  const privateFailure = executeModule(privateDirect.code ?? "");
  assert.notEqual(privateFailure.status, 0);
  assert.match(String(privateFailure.stderr), /Private field 'secret' was read before initialization/u);

  // CLS-D9: the dynamic-dispatch leak is now rejected at compile time — a
  // base constructor cannot use a member a visible subclass overrides, so the
  // partially initialized read never reaches the runtime guard.
  const dynamicDispatch = compile(`
class Base:
    constructor():
        self.validate()

    def validate():
        pass

class Child extends Base:
    const name: string

    constructor():
        super()
        self.name = "Ada"

    override def validate():
        print(self.name)

Child()
`.trimStart());
  assert.equal(dynamicDispatch.code, null);
  assert.ok(dynamicDispatch.diagnostics.some((item) => item.code === "VEL4001"
    && /Constructor of 'Base' cannot use 'validate': 'Child' overrides it/u.test(item.message)));

  const valid = compile(`
class Score:
    let value: number = 2

    def add(amount: number):
        self.value += amount

const score = Score()
score.add(3)
print(score.value)
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  const execution = executeModule(valid.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "5\n");
});

test("class field reads retain their initialization-owned host ABI", () => {
  const result = compile(`
class Base:
    static const inherited: string = "base"

class Probe extends Base:
    static const own: string = "own"
    const publicValue: string
    private const privateValue: string

    constructor():
        super()
        self.publicValue = "public"
        self.privateValue = "private"

    def readPublic() -> string:
        return self.publicValue

    def readPrivate() -> string:
        return self.privateValue

    static def readInherited() -> string:
        return Probe.inherited

    static def readOwn() -> string:
        return Probe.own

class Broken:
    const missing: string

    constructor():
        print(self.missing)
        self.missing = "late"
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarClassNativeObject = globalThis\.Object/u);
  assert.match(result.code ?? "", /__velarClassHostCall\(__velarClassGetPrototypeOf/u);

  const execution = executeModule(`${result.code ?? ""}
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const NativeFunction = globalThis.Function;
const NativeSymbol = globalThis.Symbol;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeDefine = NativeObject.defineProperty;
const nativeApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(NativeFunction.prototype, NativeSymbol.hasInstance).value;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned class host"); };
globalThis.Object = poison;
globalThis.Reflect = {apply: poison, get: poison};
globalThis.TypeError = poison;
nativeDefine(NativeObject, "getOwnPropertyDescriptor", {value: poison, writable: true, configurable: true});
nativeDefine(NativeObject, "getPrototypeOf", {value: poison, writable: true, configurable: true});
nativeDefine(NativeReflect, "apply", {value: poison, writable: true, configurable: true});
nativeDefine(NativeReflect, "get", {value: poison, writable: true, configurable: true});

const probe = new Probe();
console.log(probe.readPublic(), probe.readPrivate(), Probe.readInherited(), Probe.readOwn());
let failure = null;
try { new Broken(); } catch (error) { failure = error; }
console.log(failure?.name, nativeApply(nativeHasInstance, NativeTypeError, [failure]));
console.log(poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "public private base own\nTypeError true\n0\n");
});
