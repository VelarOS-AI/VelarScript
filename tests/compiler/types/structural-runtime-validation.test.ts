import assert from "node:assert/strict";
import test from "node:test";
import { compile, type ValueType } from "@velarscript/compiler";
import { VELAR_TYPE_VALIDATION_MODULE, VELAR_TYPE_VALIDATION_MODULE_SOURCE } from "@velarscript/compiler/extension";
import type {LoweringHints} from "../../../packages/compiler/src/contracts.ts";
import { TypeCheckEmitter, type TypeCheckEmitterHost } from "../../../packages/compiler/src/emit/type-checks.ts";
import { validationPlanExpression } from "../../../packages/compiler/src/emit/validation-plans.ts";

function linked(source: string, analysis: NonNullable<NonNullable<Parameters<typeof compile>[1]>["analysis"]>) {
  const result = compile(source, {analysis, sharedRuntimeModules: true});
  return {...result, code: result.code?.replaceAll(JSON.stringify(VELAR_TYPE_VALIDATION_MODULE), JSON.stringify(`data:text/javascript,${encodeURIComponent(VELAR_TYPE_VALIDATION_MODULE_SOURCE)}`)) ?? null};
}

const text: ValueType = {kind: "string"};
const object = (fields: ReadonlyMap<string, ValueType>, optionalFields?: ReadonlySet<string>): ValueType => ({kind: "object", fields, ...(optionalFields ? {optionalFields} : {})});
function checkerHost(): TypeCheckEmitterHost {
  return {
    genericTypeBinding: () => false, genericTypeParameters: null,
    hints: {enumNames: new Set(), classNames: new Set()} as unknown as LoweringHints,
    hoistedGenericInstances: new Map(), needsAssertionErrorClass: false, needsCollectionHelpers: false,
    needsNarrowingErrorClass: false, needsRuntimeTypeHelpers: false,
    nominalRuntimeReceiver: () => null, requiredHostErrorClasses: new Set(), runtimeTypeBinding: () => false,
    runtimeTypeTraversalGuards: new Map(), typeCheckDeclarations: [], typeDeclarations: new Map(),
  };
}
async function predicate(type: ValueType, narrow = false): Promise<(value: unknown) => boolean> {
  const host = checkerHost();
  const emitter = new TypeCheckEmitter(host);
  const expression = narrow ? emitter.emitNarrowingCheck(type, "value") : emitter.emitTypeCheck(type, "value");
  const source = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + host.typeCheckDeclarations.join("\n") + `\nexport const accepts = (value) => !!(${expression});`;
  return (await import(`data:text/javascript,${encodeURIComponent(source)}`)).accepts;
}

test("anonymous record checks require own data descriptors and never execute getters", async () => {
  for (const narrow of [false, true]) {
    const accepts = await predicate(object(new Map([["name", text]])), narrow);
    let reads = 0;
    assert.equal(accepts({get name() { reads++; return "getter"; }}), false);
    assert.equal(reads, 0);
    assert.equal(accepts(Object.create({name: "inherited"})), false);
    assert.equal(accepts(Object.defineProperty({}, "name", {value: "hidden", enumerable: false})), false);
    assert.equal(accepts(Object.freeze({name: "present"})), true);
    assert.equal(accepts({name: "present"}), true);
  }
});

test("anonymous checks retain required unknown fields and constant-false strict proofs", async () => {
  const unknownField = await predicate(object(new Map([["payload", {kind: "unknown"}]])));
  assert.equal(unknownField({}), false);
  assert.equal(unknownField({payload: null}), true);
  const opaqueField = object(new Map([["payload", {kind: "named", name: "UnavailableHostType"}]]));
  assert.equal((await predicate(opaqueField))({payload: {}}), false);
  assert.equal((await predicate(opaqueField, true))({payload: {}}), true);
});

test("anonymous structural checks validate beyond the former inline depth limit", async () => {
  let type: ValueType = text;
  let valid: unknown = "value";
  let invalid: unknown = 7;
  for (let index = 0; index < 32; index++) {
    type = object(new Map([["child", type]]));
    valid = {child: valid};
    invalid = {child: invalid};
  }
  for (const narrow of [false, true]) {
    const accepts = await predicate(type, narrow);
    assert.equal(accepts(valid), true);
    assert.equal(accepts(invalid), false);
  }
});

test("recursive anonymous ValueTypes reject cycles without skipping other shape plans", async () => {
  const fields = new Map<string, ValueType>();
  const recursive = object(fields);
  fields.set("next", {kind: "optional", inner: recursive});
  const accepts = await predicate(recursive);
  assert.equal(accepts({next: {next: null}}), true);
  const cycle: {next?: unknown} = {};
  cycle.next = cycle;
  assert.equal(accepts(cycle), false);
  const shared = {name: "ok"};
  const pair = object(new Map([
    ["first", object(new Map([["name", text]]))],
    ["second", object(new Map([["name", {kind: "number"}]]))],
  ]));
  assert.equal((await predicate(pair))({first: shared, second: shared}), false);
});

test("anonymous diagnostic plans terminate when their ValueType graph is recursive", () => {
  const fields = new Map<string, ValueType>();
  const recursive = object(fields);
  fields.set("next", {kind: "optional", inner: recursive});
  const emitter = new TypeCheckEmitter(checkerHost());
  assert.doesNotThrow(() => validationPlanExpression(emitter, recursive));
});

test("compiled inferred narrowings retain reusable checks and shared-runtime bindings", async () => {
  for (const sharedRuntimeModules of [false, true]) {
    const result = compile(`let item = true ? {name: "ok"} : null
export def read() -> string:
    if item == null: return "none"
    return item.name
`, {sharedRuntimeModules});
    assert.deepEqual(result.diagnostics, []);
    let code = result.code!;
    assert.equal((code.match(/function __velarStructuralCheck\d+/gu) ?? []).length, 1);
    if (sharedRuntimeModules) {
      assert.match(code, /objectTypeIs as __velarObjectTypeIs/u);
      assert.match(code, /validationOwnDescriptor as __velarValidationOwnDescriptor/u);
      const runtimeUrl = `data:text/javascript,${encodeURIComponent(VELAR_TYPE_VALIDATION_MODULE_SOURCE)}`;
      code = code.replaceAll(JSON.stringify(VELAR_TYPE_VALIDATION_MODULE), JSON.stringify(runtimeUrl));
      // Other shared families retain their own source module owners.
      const {VELAR_NARROWING_MODULE, VELAR_NARROWING_MODULE_SOURCE} = await import("@velarscript/compiler/extension");
      code = code.replaceAll(JSON.stringify(VELAR_NARROWING_MODULE), JSON.stringify(`data:text/javascript,${encodeURIComponent(VELAR_NARROWING_MODULE_SOURCE)}`));
    }
    const module = await import(`data:text/javascript,${encodeURIComponent(code + '\nexport function inject(value) { item = value; }')}`);
    assert.equal(module.read(), "ok");
    let getters = 0;
    module.inject({get name() { getters++; return "bad"; }});
    assert.throws(() => module.read(), {name: "NarrowingError"});
    assert.equal(getters, 0);
    module.inject(Object.create({name: "bad"}));
    assert.throws(() => module.read(), {name: "NarrowingError"});
    module.inject({name: 42});
    assert.throws(() => module.read(), {name: "NarrowingError"});
  }
});

test("anonymous generic checks carry distinct argument bindings through one reusable function", async () => {
  const host = checkerHost();
  host.genericTypeParameters = ["T"];
  const emitter = new TypeCheckEmitter(host);
  const type = object(new Map([["payload", {kind: "parameter", name: "T", index: 0}]]));
  const expression = emitter.emitTypeCheck(type, "value");
  const code = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + host.typeCheckDeclarations.join("\n") + `
export function accepts(value, __velarArguments) { return ${expression}; }
export function nested(value) {
  const outer = {nested: true};
  const inner = {nested: false};
  function check(value, state, args) { return args.nested ? __velarObjectTypeIs(value, check, state, inner) : true; }
  return __velarObjectTypeIs(value, check, undefined, outer);
}`;
  const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  assert.equal(module.accepts({payload: "text"}, {checks: [(v: unknown) => typeof v === "string"]}), true);
  assert.equal(module.accepts({payload: "text"}, {checks: [(v: unknown) => typeof v === "number"]}), false);
  assert.equal(module.nested({}), true, "one value can be active under two distinct instantiations");
});

test("recursive anonymous diagnostics execute with bounded paths and reject accessors", async () => {
  const fields = new Map<string, ValueType>();
  const recursive = object(fields);
  fields.set("next", {kind: "optional", inner: recursive});
  const emitter = new TypeCheckEmitter(checkerHost());
  const plan = validationPlanExpression(emitter, recursive);
  const module = await import(`data:text/javascript,${encodeURIComponent(VELAR_TYPE_VALIDATION_MODULE_SOURCE + `\nexport const explain = value => __velarValidationExplain({diagnosticPlan() {return ${plan};}}, value);`)}`);
  const cycle: {next?: unknown} = {};
  cycle.next = cycle;
  assert.deepEqual(module.explain(cycle).path, [{kind: "field", name: "next"}]);
  let deep: unknown = {next: 3};
  for (let index = 0; index < 80; index++) deep = {next: deep};
  const error = module.explain(deep);
  assert.equal(error.path.length, 64);
  assert.equal(error.path.at(-1).kind, "truncated");
  let reads = 0;
  assert.deepEqual(module.explain({get next() { reads++; return null; }}).path, [{kind: "field", name: "next"}]);
  assert.equal(reads, 0);
});

test("repeated wide and deep structural reads reuse their compiled plans", async (context) => {
  const depth = 16;
  const width = 24;
  let type: ValueType = text;
  let value: unknown = "leaf";
  let source = "";
  for (let level = 0; level < depth; level++) {
    const fields = new Map<string, ValueType>([["child", type]]);
    const record: Record<string, unknown> = {child: value};
    source += `export type Level${level}:\n    child: ${level === 0 ? "string" : `Level${level - 1}`}\n`;
    for (let index = 0; index < width; index++) {
      fields.set(`field${index}`, text);
      record[`field${index}`] = "value";
      source += `    field${index}: string\n`;
    }
    type = object(fields);
    value = record;
  }
  const anonymous = await predicate(type, true);
  const compiled = compile(source);
  assert.deepEqual(compiled.diagnostics, []);
  const named = (await import(`data:text/javascript,${encodeURIComponent(compiled.code!)}`))[`Level${depth - 1}`].is;
  const measure = (check: (value: unknown) => boolean) => {
    for (let index = 0; index < 200; index++) assert.equal(check(value), true);
    const start = performance.now();
    for (let index = 0; index < 2000; index++) assert.equal(check(value), true);
    return performance.now() - start;
  };
  const namedMs = measure(named);
  const anonymousMs = measure(anonymous);
  context.diagnostic(`2000 checks of ${depth} levels × ${width + 1} fields: named ${namedMs.toFixed(1)} ms; anonymous ${anonymousMs.toFixed(1)} ms`);
  const host = checkerHost();
  const emitter = new TypeCheckEmitter(host);
  const first = emitter.emitNarrowingCheck(type, "value");
  for (let index = 0; index < 50; index++) assert.equal(emitter.emitNarrowingCheck(type, "value"), first);
  assert.equal(host.typeCheckDeclarations.length, depth);
});



test("runtime imports select canonical owners when unrelated declarations share one display name", async () => {
  const host = checkerHost();
  const textOwner = `data:text/javascript,${encodeURIComponent('export const Leaf = {is(value) {return typeof value === "string";}};')}`;
  const numberOwner = `data:text/javascript,${encodeURIComponent('export const Leaf = {is(value) {return typeof value === "number";}};')}`;
  Object.assign(host.hints, {runtimeTypeImports: new Map([
    ["text#type:Leaf", {source: textOwner, exported: "Leaf"}],
    ["number#type:Leaf", {source: numberOwner, exported: "Leaf"}],
  ])});
  const type = object(new Map([
    ["text", {kind: "named", name: "Leaf", identity: "text#type:Leaf"}],
    ["number", {kind: "named", name: "Leaf", identity: "number#type:Leaf"}],
  ]));
  const emitter = new TypeCheckEmitter(host);
  const expression = emitter.emitNarrowingCheck(type, "value");
  const source = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + host.typeCheckDeclarations.join("\n") + `\nexport const accepts = value => ${expression};`;
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal(module.accepts({text: "ok", number: 1}), true);
  assert.equal(module.accepts({text: 1, number: "wrong"}), false);
  assert.equal(host.typeCheckDeclarations.filter((line) => line.startsWith("import ")).length, 2);
});

test("empty and optional anonymous records retain the plain data object contract", async () => {
  const empty = await predicate(object(new Map()));
  assert.equal(empty({}), true);
  assert.equal(empty(Object.create(null)), true);
  assert.equal(empty([]), false);
  assert.equal(empty(new (class Value {})()), false);
  const optional = await predicate(object(new Map([["name", text]]), new Set(["name"])));
  assert.equal(optional({}), true);
  assert.equal(optional({name: "ok"}), true);
  assert.equal(optional({name: 4}), false);
  let calls = 0;
  assert.equal(optional({get name() { calls++; return "getter"; }}), false);
  assert.equal(calls, 0);
});

test("private runtime exports retain their declared validators and transitive field dependencies", async () => {
  const source = `type Detail:
    name: string
type Leaf:
    detail: Detail
export def value() -> Leaf:
    return {detail: {name: "ok"}}
`;
  const result = linked(source, {runtimeTypeExports: new Map([["Leaf", "__velarRuntimeType_Leaf"]])});
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code!, /export \{ __velarGetRuntimeType_Leaf as __velarRuntimeType_Leaf \}/u);
  const module = await import(`data:text/javascript,${encodeURIComponent(result.code!)}`);
  assert.equal(module.__velarRuntimeType_Leaf().is(module.value()), true);
  assert.equal(module.__velarRuntimeType_Leaf().is({detail: {name: 7}}), false);
  assert.deepEqual(Object.keys(module), ["__velarRuntimeType_Leaf", "value"]);
  const {inspectModule} = await import("@velarscript/compiler");
  assert.deepEqual([...inspectModule(source).moduleInterface.exports.keys()], ["value"]);
});

test("compiler-private Type forwarding preserves the source binding without a language export", async () => {
  const owner = linked("type Leaf:\n    name: string\n", {runtimeTypeExports: new Map([["Leaf", "__velarRuntimeType_Leaf"]])});
  assert.deepEqual(owner.diagnostics, []);
  const ownerUrl = `data:text/javascript,${encodeURIComponent(owner.code!)}`;
  const forwarder = linked("", {runtimeTypeReExports: [{source: ownerUrl, imported: "__velarRuntimeType_Leaf", exported: "__velarRuntimeType_Forwarded", accessor: true}]});
  assert.deepEqual(forwarder.diagnostics, []);
  assert.deepEqual([...forwarder.moduleInterface.exports], []);
  const module = await import(`data:text/javascript,${encodeURIComponent(forwarder.code!)}`);
  assert.equal(module.__velarRuntimeType_Forwarded().is({name: "ok"}), true);
  assert.equal(module.__velarRuntimeType_Forwarded().is({name: 1}), false);
});

test("hidden generic runtime owners receive concrete validators and diagnostic plans", async () => {
  const owner = linked("type Box<T>:\n    value: T\n", {runtimeTypeExports: new Map([["Box", "__velarRuntimeType_Box"]])});
  assert.deepEqual(owner.diagnostics, []);
  const host = checkerHost();
  Object.assign(host.hints, {runtimeTypeImports: new Map([["owner#type:Box", {source: `data:text/javascript,${encodeURIComponent(owner.code!)}`, exported: "__velarRuntimeType_Box", accessor: true}]])});
  const box: ValueType = {kind: "named", name: "Box<string>", application: {declaration: "owner#type:Box", name: "Box", arguments: [text]}};
  const emitter = new TypeCheckEmitter(host);
  const expression = emitter.emitNarrowingCheck(box, "value");
  const accessors = [...host.hoistedGenericInstances].map(([expression, name]) => `function ${name}() { return ${expression}; }`);
  const source = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + [...host.typeCheckDeclarations, ...accessors].join("\n") + `\nexport const accepts = value => ${expression};`;
  const module = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  assert.equal(module.accepts({value: "ok"}), true);
  assert.equal(module.accepts({value: 1}), false);
});


test("is checks and instantiated classes use canonical runtime owners before display names", async () => {
  const host = checkerHost();
  host.runtimeTypeBinding = () => true;
  const owner = `data:text/javascript,${encodeURIComponent('export const Leaf = {is: value => typeof value === "string"}; export class Box {}')}`;
  Object.assign(host.hints, {runtimeTypeImports: new Map([
    ["owner#type:Leaf", {source: owner, exported: "Leaf"}],
    ["owner#class:Box", {source: owner, exported: "Box"}],
  ]), runtimeTypeIdentities: new Map([["Leaf", "other#type:Leaf"]])});
  const emitter = new TypeCheckEmitter(host);
  const is = emitter.emitIsCheck({kind: "named", name: "Leaf", identity: "owner#type:Leaf"}, "value");
  const classCheck = emitter.emitNarrowingCheck({kind: "class", name: "Box<string>", identity: "owner#class:Box<string>", application: {declaration: "owner#class:Box", name: "Box", arguments: [text]}}, "value");
  const code = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + host.typeCheckDeclarations.join("\n") + `
const Leaf = {is: () => false};
export const accepts = value => ${is};
export const acceptsBox = value => ${classCheck};
`;
  const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  const ownerModule = await import(owner);
  assert.equal(module.accepts("ok"), true);
  assert.equal(module.accepts(4), false);
  assert.equal(module.acceptsBox(new ownerModule.Box()), true);
  assert.equal(module.acceptsBox({}), false);
});


test("an exported generic instance alias is checked directly before consulting its factory", async () => {
  const owner = compile("type Box<T>:\n    value: T\nexport type TextBox = Box<string>\n");
  assert.deepEqual(owner.diagnostics, []);
  const host = checkerHost();
  const ownerUrl = `data:text/javascript,${encodeURIComponent(owner.code!)}`;
  Object.assign(host.hints, {runtimeTypeImports: new Map([
    ["owner#type:Box<string>", {source: ownerUrl, exported: "TextBox"}],
    ["owner#type:Box", {source: "unreachable-factory", exported: "Box"}],
  ])});
  const type: ValueType = {kind: "named", name: "Box<string>", identity: "owner#type:Box<string>", application: {declaration: "owner#type:Box", name: "Box", arguments: [text]}};
  const emitter = new TypeCheckEmitter(host);
  const expression = emitter.emitNarrowingCheck(type, "value");
  const reference = emitter.runtimeTypeObjectExpression(type);
  assert.equal(host.hoistedGenericInstances.size, 0);
  const code = VELAR_TYPE_VALIDATION_MODULE_SOURCE + "\n" + host.typeCheckDeclarations.join("\n") + `\nexport const accepts = value => ${expression}; export const Type = ${reference};`;
  const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  assert.equal(module.accepts({value: "ok"}), true);
  assert.equal(module.accepts({value: 1}), false);
  assert.throws(() => module.Type.parse({value: 1}), {name: "ValidationError"});
});


test("runtime link metadata requires shared runtime emission while standalone compilation remains available", () => {
  assert.throws(() => compile("", {analysis: {runtimeTypeExports: new Map([["Leaf", "__internal"]])}}), /requires sharedRuntimeModules: true/u);
  const standalone = compile('type Leaf:\n    name: string\nexport def value() -> Leaf: return {name: "ok"}\n');
  assert.deepEqual(standalone.diagnostics, []);
  assert.deepEqual(standalone.runtimeModules, []);
});
