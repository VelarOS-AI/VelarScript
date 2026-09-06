import assert from "node:assert/strict";
import test, { after } from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { VELAR_CLASS_FIELD_MODULE, VELAR_COLLECTION_HOST_MODULE, VELAR_COLLECTION_LOWERING_MODULE, VELAR_ERROR_NORMALIZATION_MODULE, VELAR_NARROWING_MODULE, VELAR_PRIMITIVE_METHOD_MODULE, VELAR_REACTIVE_BRIDGE_MODULE } from "@velarscript/compiler/extension";
import { type ValueType } from "../../packages/compiler/src/types.ts";
import { compileProject as compileProjectCore } from "../../packages/cli/src/project.ts";
import { standardModuleApi as standardModuleApiCore, standardModuleAsset as standardModuleAssetCore, standardModuleSource as standardModuleSourceCore } from "../../packages/cli/src/standard-modules.ts";
import { webModuleSource } from "../../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "../support/temporary-directory.ts";
import { executeModule } from "../support/execute-module.ts";
import { standardModuleWithDependencies } from "../support/standard-module-inline.ts";

after(removeTemporaryDirectories);

test("project compilation shares compiler runtime modules while standalone compilation stays self-contained", async () => {
  const source = "const values = [1]\nvalues.append(2)\n";
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /function __velarReactiveRaw\(value\) \{ return value; \}/u);
  assert.doesNotMatch(standalone.code ?? "", /function __velarResolveReactiveBridge/u);
  assert.doesNotMatch(standalone.code ?? "", /velar\.runtime\.v1/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-reactive-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_COLLECTION_LOWERING_MODULE]);
  assert.doesNotMatch(shared.code ?? "", /reactiveRaw as __velarReactiveRaw/u);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}`));
  assert.ok(!(shared.code ?? "").includes(`from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}`));
  assert.ok(!(shared.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}`));
  assert.doesNotMatch(shared.code ?? "", /function __velarResolveReactiveBridge/u);

  const directory = await makeTemporaryDirectory("velar-shared-compiler-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, "export def count() -> number:\n    const values = [1]\n    values.append(2)\n    return values.size\n", "utf8");
  await writeFile(entryPath, "import {count} from \"./dependency.vel\"\nconst values = [1, 2]\nprint(count() + values.size)\n", "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_COLLECTION_LOWERING_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.deepEqual(module.result.runtimeModules, [VELAR_COLLECTION_LOWERING_MODULE]);
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_LOWERING_MODULE)}`));
    assert.ok(!(module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_REACTIVE_BRIDGE_MODULE)}`));
    assert.ok(!(module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_COLLECTION_HOST_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /function __velarResolveReactiveBridge/u);
  }
  const runtimeSource = standardModuleSourceCore(VELAR_REACTIVE_BRIDGE_MODULE);
  assert.ok(runtimeSource);
  assert.doesNotMatch(runtimeSource, /__velarResolveReactiveBridge/u);
  const webRuntimeSource = webModuleSource(VELAR_REACTIVE_BRIDGE_MODULE);
  assert.ok(webRuntimeSource);
  assert.match(webRuntimeSource, /function __velarResolveReactiveBridge/u);
  assert.equal(standardModuleApiCore().modules[VELAR_REACTIVE_BRIDGE_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_REACTIVE_BRIDGE_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), [
    "hostRaw",
    "reactiveCollectionLink",
    "reactiveCollectionRead",
    "reactiveCollectionTrack",
    "reactiveCollectionTrigger",
    "reactiveCollectionUnlink",
    "reactiveIterateKey",
    "reactiveRaw",
    "reactiveStructureKey",
  ]);
});

test("project compilation shares primitive method runtime without publishing it", async () => {
  const source = "print(\" vel \".trim().upper())\nprint(1.5.toFixed(1))\n";
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarTextNativeString = globalThis\.String/u);
  assert.match(standalone.code ?? "", /const __velarNumberNativeNumber = globalThis\.Number/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-primitives-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_PRIMITIVE_METHOD_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_PRIMITIVE_METHOD_MODULE)}`));
  assert.match(shared.code ?? "", /stringTrim as __velarStringTrim/u);
  assert.match(shared.code ?? "", /stringUpper as __velarStringUpper/u);
  assert.match(shared.code ?? "", /numberToFixed as __velarNumberToFixed/u);
  assert.doesNotMatch(shared.code ?? "", /stringSize as __velarStringSize/u);
  assert.doesNotMatch(shared.code ?? "", /stringLower as __velarStringLower/u);
  assert.doesNotMatch(shared.code ?? "", /numberAbs as __velarNumberAbs/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarTextNativeString = globalThis\.String/u);
  assert.doesNotMatch(shared.code ?? "", /const __velarNumberNativeNumber = globalThis\.Number/u);

  const directory = await makeTemporaryDirectory("velar-shared-primitive-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, "export def format(value: string) -> string:\n    return value.trim().upper()\n", "utf8");
  await writeFile(entryPath, "import {format} from \"./dependency.vel\"\nprint(format(\" vel \"))\nprint(1.5.toFixed(1))\n", "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_PRIMITIVE_METHOD_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_PRIMITIVE_METHOD_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /const __velarTextNativeString = globalThis\.String/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_PRIMITIVE_METHOD_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_PRIMITIVE_METHOD_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_PRIMITIVE_METHOD_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  // D114 CO-U4b: this module now imports `__VelarIndexError` from the module
  // that publishes it, so evaluating it here needs its dependencies resolved.
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(standardModuleWithDependencies(runtimeSource)).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), [
    "numberAbs",
    "numberCeil",
    "numberFloor",
    "numberIsFinite",
    "numberIsInteger",
    "numberIsNaN",
    "numberRound",
    "numberSign",
    "numberToFixed",
    "numberTrunc",
    // D41 item 61: the dispatching comparator behind ordered comparisons of
    // `Comparable`-bounded type parameters.
    "orderCompare",
    "stringChar",
    "stringCompare",
    "stringCount",
    "stringEndsWith",
    "stringHas",
    "stringIndex",
    "stringIsBlank",
    "stringLower",
    "stringPadEnd",
    "stringPadStart",
    "stringRepeat",
    "stringReplace",
    "stringReplaceAll",
    "stringSize",
    "stringSlice",
    "stringSplit",
    "stringStartsWith",
    "stringTrim",
    "stringUpper",
  ]);
  assert.equal(runtimeNamespace.stringUpper("vel"), "VEL");
  assert.equal(runtimeNamespace.numberToFixed(1.5, 1), "1.5");
});

test("project runtime imports use exact JavaScript identifiers instead of source text fragments", () => {
  const primitive = compileCore(`
print(f"__velarStringTrim __velarStringReplace:{"aa".replaceAll("a", "b")}")
`.trimStart(), { sharedRuntimeModules: true });
  assert.deepEqual(primitive.diagnostics, []);
  assert.deepEqual(primitive.runtimeModules, [VELAR_PRIMITIVE_METHOD_MODULE]);
  assert.match(primitive.code ?? "", /stringReplaceAll as __velarStringReplaceAll/u);
  assert.doesNotMatch(primitive.code ?? "", /stringReplace as __velarStringReplace[, }]/u);
  assert.doesNotMatch(primitive.code ?? "", /stringTrim as __velarStringTrim/u);

  const collection = compileCore(`
const scores = Map({a: 1})
const marker = "__velarCollectionValue"
print(scores.values().size)
`.trimStart(), { sharedRuntimeModules: true });
  assert.deepEqual(collection.diagnostics, []);
  assert.deepEqual(collection.runtimeModules, [VELAR_COLLECTION_LOWERING_MODULE]);
  assert.match(collection.code ?? "", /__velarMapValues/u);
  assert.doesNotMatch(collection.code ?? "", /\s__velarCollectionValue,/u);
});

test("project output omits dead range, runtime-Type, and collection-host imports", () => {
  const counted = compileCore(`
let total = 0
for index in range(4): total += index
print(total)
`.trimStart(), { sharedRuntimeModules: true });
  assert.deepEqual(counted.diagnostics, []);
  assert.match(counted.code ?? "", /range as __velarCountedRangeOwner/u);
  assert.doesNotMatch(counted.code ?? "", /range as __velarRange[, }]/u);

  const rangedValue = compileCore("print(range(4).size)\n", { sharedRuntimeModules: true });
  assert.deepEqual(rangedValue.diagnostics, []);
  assert.match(rangedValue.code ?? "", /range as __velarRange/u);

  const pointFields = new Map<string, ValueType>([["x", { kind: "number" }], ["z", { kind: "number" }]]);
  const Point: ValueType = {
    kind: "typeObject",
    name: "Point",
    value: {
      kind: "object",
      fields: pointFields,
    },
  };
  const projection = compileCore(`
import {Point} from "./point.vel"

const source = {x: 1, z: 2, score: 9}
const point = Point.from(source)
print(point.x + point.z)
`.trimStart(), {
    sharedRuntimeModules: true,
    analysis: { imports: new Map([["Point", Point]]) },
  });
  assert.deepEqual(projection.diagnostics, []);
  assert.match(projection.code ?? "", /function __velarRecordFrom/u);
  assert.doesNotMatch(projection.code ?? "", /function __velar(?:SpreadRecord|CreateRecord)/u);
  assert.doesNotMatch(projection.code ?? "", /import \{\s*\} from/u);
  assert.doesNotMatch(projection.code ?? "", /compiler-runtime-types-v1/u);
  assert.doesNotMatch(projection.code ?? "", /__velarCollectionSetMap/u);
  assert.doesNotMatch(projection.code ?? "", /__velarCollectionListHost/u);
  assert.match(projection.code ?? "", /reactiveCollectionRead as __velarReactiveCollectionRead/u);
  assert.doesNotMatch(projection.code ?? "", /reactiveRaw as __velarReactiveRaw/u);
  assert.doesNotMatch(projection.code ?? "", /reactiveCollection(?:Link|Trigger|Unlink)/u);

  const makePoint: ValueType = {
    kind: "function",
    parameters: [{ kind: "number" }],
    parameterNames: ["x"],
    requiredParameters: 1,
    result: { kind: "number" },
  };
  const annotationOnly = compileCore(`
import {Point, makePoint} from "./point.vel"

export def project(value: Point) -> number: return makePoint(value.x)
`.trimStart(), {
    sharedRuntimeModules: true,
    analysis: {
      imports: new Map<string, ValueType>([["Point", Point], ["makePoint", makePoint]]),
      namedTypes: new Map([["Point", pointFields]]),
    },
  });
  assert.deepEqual(annotationOnly.diagnostics, []);
  assert.match(annotationOnly.code ?? "", /import \{ makePoint \} from "\.\/point\.js"/u);
  assert.doesNotMatch(annotationOnly.code ?? "", /import \{[^}]*\bPoint\b/u);

  const pureAnnotation = compileCore(`
import {Point} from "./point.vel"
export def x(value: Point) -> number: return value.x
`.trimStart(), {
    sharedRuntimeModules: true,
    analysis: {
      imports: new Map<string, ValueType>([["Point", Point]]),
      namedTypes: new Map([["Point", pointFields]]),
    },
  });
  assert.deepEqual(pureAnnotation.diagnostics, []);
  assert.match(pureAnnotation.code ?? "", /import "\.\/point\.js";/u);
});

test("project compilation shares checked class-field runtime without publishing it", async () => {
  const source = `
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

    def readPrivate() -> string:
        return self.privateValue

    static def readInherited() -> string:
        return Probe.inherited

const probe = Probe()
print(probe.publicValue)
print(probe.readPrivate())
print(Probe.readInherited())
print(Probe.own)
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /const __velarClassNativeObject = globalThis\.Object/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-class-fields-v1/u);

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  assert.deepEqual(shared.runtimeModules, [VELAR_CLASS_FIELD_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_CLASS_FIELD_MODULE)}`));
  assert.doesNotMatch(shared.code ?? "", /const __velarClassNativeObject = globalThis\.Object/u);

  const directory = await makeTemporaryDirectory("velar-shared-class-field-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
export class Score:
    const value: number

    constructor(value: number):
        self.value = value

    def read() -> number:
        return self.value
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {Score} from "./dependency.vel"

class Bonus:
    const value: number

    constructor(value: number):
        self.value = value

    def read() -> number:
        return self.value

print(Score(2).read() + Bonus(3).read())
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_CLASS_FIELD_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_CLASS_FIELD_MODULE)}`));
    assert.match(module.result.code ?? "", /readInstanceField as __velarReadInstanceField/u);
    assert.doesNotMatch(module.result.code ?? "", /readPrivateField as __velarReadPrivateField/u);
    assert.doesNotMatch(module.result.code ?? "", /readStaticField as __velarReadStaticField/u);
    assert.doesNotMatch(module.result.code ?? "", /const __velarClassNativeObject = globalThis\.Object/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_CLASS_FIELD_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_CLASS_FIELD_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_CLASS_FIELD_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), ["readInstanceField", "readPrivateField", "readStaticField"]);

  const hostile = executeModule(`
import {readInstanceField, readPrivateField, readStaticField} from ${JSON.stringify(runtimeUrl)};
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeTypeError = globalThis.TypeError;
const NativeFunction = globalThis.Function;
const NativeSymbol = globalThis.Symbol;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeDefine = NativeObject.defineProperty;
const nativeApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(NativeFunction.prototype, NativeSymbol.hasInstance).value;
const instance = {value: "public"};
class Parent {}
class Child extends Parent {}
nativeDefine(Parent, "inherited", {value: "base", configurable: true});
nativeDefine(Child, "own", {value: "own", configurable: true});
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned shared class host"); };
globalThis.Object = poison;
globalThis.Reflect = {apply: poison, get: poison};
globalThis.TypeError = poison;
nativeDefine(NativeObject, "getOwnPropertyDescriptor", {value: poison, writable: true, configurable: true});
nativeDefine(NativeObject, "getPrototypeOf", {value: poison, writable: true, configurable: true});
nativeDefine(NativeReflect, "apply", {value: poison, writable: true, configurable: true});
nativeDefine(NativeReflect, "get", {value: poison, writable: true, configurable: true});
console.log(readInstanceField(instance, "value"), readPrivateField("private", "secret"), readStaticField(Child, "inherited", 1), readStaticField(Child, "own", 0));
let failure = null;
try { readInstanceField({}, "missing"); } catch (error) { failure = error; }
console.log(failure?.name, nativeApply(nativeHasInstance, NativeTypeError, [failure]), poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  assert.equal(hostile.stdout, "public private base own\nTypeError true 0\n");
});

test("project compilation shares flow-narrowing errors without publishing their constructor", async () => {
  const source = `
let current: number? = 1

def clear():
    current = null

export def stale() -> number:
    assert current != null
    clear()
    return current + 1
`.trimStart();
  const standalone = compileCore(source);
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
  assert.match(standalone.code ?? "", /class __VelarNarrowingError extends __velarNarrowingNativeTypeError/u);
  assert.doesNotMatch(standalone.code ?? "", /compiler-runtime-narrowing-v1/u);
  const standaloneExecution = executeModule(`${standalone.code ?? ""}
try { stale(); } catch (error) { console.log(error.name); }
`);
  assert.equal(standaloneExecution.status, 0, String(standaloneExecution.stderr));
  assert.equal(standaloneExecution.stdout, "NarrowingError\n");

  const shared = compileCore(source, { sharedRuntimeModules: true });
  assert.deepEqual(shared.diagnostics, []);
  // The `assert` in this module raises the compiler-owned AssertionError, and
  // that class lives in the shared error module for the same reason
  // NarrowingError lives here: one identity across every module that raises
  // it. So a module that narrows *and* asserts consumes both runtime modules.
  assert.deepEqual(shared.runtimeModules, [VELAR_ERROR_NORMALIZATION_MODULE, VELAR_NARROWING_MODULE]);
  assert.ok((shared.code ?? "").includes(`from ${JSON.stringify(VELAR_NARROWING_MODULE)}`));
  assert.doesNotMatch(shared.code ?? "", /class __VelarNarrowingError/u);
  assert.match(shared.code ?? "", /^import \{ AssertionError as __VelarAssertionError \} from "velar\/compiler-runtime-errors-v1";$/mu);
  assert.doesNotMatch(shared.code ?? "", /class __VelarAssertionError/u);

  const directory = await makeTemporaryDirectory("velar-shared-narrowing-runtime-");
  const dependencyPath = join(directory, "dependency.vel");
  const entryPath = join(directory, "main.vel");
  await writeFile(dependencyPath, `
let value: number? = 1
def clear():
    value = null
export def dependency() -> number:
    assert value != null
    clear()
    return value + 1
`.trimStart(), "utf8");
  await writeFile(entryPath, `
import {dependency} from "./dependency.vel"
let value: number? = 2
def clear():
    value = null
def entry() -> number:
    assert value != null
    clear()
    return value + 1
try:
    print(dependency())
catch error:
    print(error.name)
try:
    print(entry())
catch error:
    print(error.name)
`.trimStart(), "utf8");
  const project = await compileProjectCore(entryPath, new Map(), { sourceRoot: directory, projectRoot: directory });
  assert.deepEqual(project.failures, []);
  const runtimeConsumers = project.modules.filter((module) => module.result.runtimeModules.includes(VELAR_NARROWING_MODULE));
  assert.equal(runtimeConsumers.length, 2);
  for (const module of runtimeConsumers) {
    assert.ok((module.result.code ?? "").includes(`from ${JSON.stringify(VELAR_NARROWING_MODULE)}`));
    assert.doesNotMatch(module.result.code ?? "", /class __VelarNarrowingError/u);
  }

  const runtimeSource = standardModuleSourceCore(VELAR_NARROWING_MODULE);
  assert.ok(runtimeSource);
  assert.equal(standardModuleApiCore().modules[VELAR_NARROWING_MODULE], undefined);
  const runtimeRoute = `/@velar/${VELAR_NARROWING_MODULE.slice("velar/".length)}.js`;
  assert.equal(standardModuleAssetCore(runtimeRoute), runtimeSource);
  const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeSource).toString("base64")}`;
  const runtimeNamespace = await import(runtimeUrl);
  assert.deepEqual(Object.keys(runtimeNamespace).sort(), ["NarrowingError", "narrow"]);

  // The module also raises AssertionError, whose class the shared error module
  // owns, so the hostile host resolves both runtime specifiers.
  const errorRuntimeSource = standardModuleSourceCore(VELAR_ERROR_NORMALIZATION_MODULE);
  assert.ok(errorRuntimeSource);
  const errorRuntimeUrl = `data:text/javascript;base64,${Buffer.from(errorRuntimeSource).toString("base64")}`;
  const sharedSource = (shared.code ?? "")
    .replaceAll(JSON.stringify(VELAR_NARROWING_MODULE), JSON.stringify(runtimeUrl))
    .replaceAll(JSON.stringify(VELAR_ERROR_NORMALIZATION_MODULE), JSON.stringify(errorRuntimeUrl));
  const hostile = executeModule(`${sharedSource}
const NativeTypeError = globalThis.TypeError;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeFunction = globalThis.Function;
const NativeSymbol = globalThis.Symbol;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(NativeFunction.prototype, NativeSymbol.hasInstance).value;
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned narrowing error host"); };
globalThis.TypeError = poison;
let failure = null;
try { stale(); } catch (error) { failure = error; }
let direct = null;
try { __velarNarrow("value", false, "number", ".value", "main.vel:3:9"); } catch (error) { direct = error; }
console.log(failure?.name, nativeApply(nativeHasInstance, NativeTypeError, [failure]), poisonCalls);
console.log(direct?.name, direct?.message, nativeApply(nativeHasInstance, NativeTypeError, [direct]), __velarNarrow(7, true, "number", ".value", "main.vel:3:9"), poisonCalls);
`);
  assert.equal(hostile.status, 0, String(hostile.stderr));
  // AS-U2: the guard's last argument is the source position, not a byte offset.
  assert.equal(hostile.stdout, "NarrowingError true 0\nNarrowingError Flow narrowing for '.value' no longer holds: expected number at main.vel:3:9 true 7 0\n");
});
