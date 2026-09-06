import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("safe JavaScript imports use explicit extern declarations", () => {
  const valid = compile(`
type TextTools:
    version: string
    normalize: (string) -> string

extern module "text-tools":
    export const version: string
    export const tools: TextTools
    export def lengthOf(value: string) -> number
    export def join(...values: string) -> string

import js {lengthOf, join, tools, version} from "text-tools"
import js * as namespaceTools from "text-tools"
const size: number = lengthOf("Velar")
const label: string = join("Velar", "Script")
const current: string = version
const normalized: string = tools.normalize(label)
const mirrored: string = namespaceTools.version
`.trimStart());
  assert.deepEqual(valid.diagnostics, []);
  assert.doesNotMatch(valid.code ?? "", /extern module/);

  // Extern record fields narrow like ordinary member locations, and index
  // reads on extern lists do not drop facts narrowed on unrelated bindings.
  const externalAggregates = compile(`
type Profile:
    label: string?

extern module "host-data":
    export const profile: Profile
    export const values: List<number>
    export def loadValues() -> List<number>

import js {loadValues, profile, values} from "host-data"

let current: string? = "ready"
if profile.label != null:
    const repeated: string = profile.label

current = "ready"
if current != null:
    const first = values[0]
    const afterConstant: string = current

const loaded = loadValues()
current = "ready"
if current != null:
    const first = loaded[0]
    const afterResult: string = current
`.trimStart());
  assert.equal(externalAggregates.diagnostics.filter((item) => /Cannot assign string\? to string/u.test(item.message)).length, 0);

  const invalid = compile(`
extern module "text-tools":
    export const version: string
    export def lengthOf(value: string) -> number
    export def join(...values: string) -> string

import js {lengthOf, join, version} from "text-tools"
const size = lengthOf(12)
const label = join("Velar", 2)
version = "next"
`.trimStart());
  assert.equal(invalid.diagnostics.filter((item) => item.code === "VEL4001" && /number to string/.test(item.message)).length, 2);
  // MOD-I3: an import is not a const declaration; the write says so and
  // names the owning module.
  assert.ok(invalid.diagnostics.some((item) => /Cannot assign to imported binding 'version'; imports are read-only\. Change the value in its owning module \("text-tools"\)/u.test(item.message)));

  const duplicate = compile(`
extern module "text-tools":
    export const format: string
    export def format(value: string) -> string
`.trimStart());
  assert.ok(duplicate.diagnostics.some((item) => /Extern export 'format' is declared more than once/u.test(item.message)));

  const unknown = compile(`
import js {mystery} from "mystery-package"
mystery()
`.trimStart());
  assert.ok(unknown.diagnostics.some((item) => /Cannot call an unknown JavaScript value/.test(item.message)));
});

test("JavaScript call boundaries receive raw reactive records", () => {
  const source = `data:text/javascript;base64,${Buffer.from(`
const root = globalThis;
const key = Symbol.for("velar.runtime.v1");
export function seesRaw(value) {
  const runtime = root[key];
  return runtime.toRaw(value) === value;
}
`.trimStart()).toString("base64")}`;
  // D90 R17: the boundary import is unknown until declared, so the probe
  // declares the one function it calls.
  const result = compile(`
extern module ${JSON.stringify(source)}:
    export def seesRaw(value: unknown) -> bool

import js {seesRaw} from ${JSON.stringify(source)}

type Payload:
    value: number

state payload: Payload = {value: 1}

export def probe():
    print(seesRaw(payload) == true ? "raw" : "proxy")
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /seesRaw\(__velarHostRaw\(payload\.get\(\)\)\)/u);
  const execution = executeModule(`${result.code ?? ""}

const NativeGlobal = globalThis;
const NativeObject = NativeGlobal.Object;
const NativeReflect = NativeGlobal.Reflect;
const NativeSymbol = NativeGlobal.Symbol;
const NativeError = NativeGlobal.Error;
let poisonCalls = 0;
const fail = name => () => { poisonCalls += 1; throw new NativeError("ambient " + name + " was used"); };
NativeGlobal.Object = fail("Object constructor");
NativeGlobal.Reflect = fail("Reflect object");
NativeGlobal.Symbol = fail("Symbol constructor");
NativeGlobal.TypeError = fail("TypeError constructor");
NativeObject.getOwnPropertyDescriptor = fail("Object.getOwnPropertyDescriptor");
NativeObject.getPrototypeOf = fail("Object.getPrototypeOf");
NativeObject.isExtensible = fail("Object.isExtensible");
NativeObject.getOwnPropertySymbols = fail("Object.getOwnPropertySymbols");
NativeReflect.apply = fail("Reflect.apply");
NativeSymbol.for = fail("Symbol.for");
NativeGlobal.globalThis = null;
probe();
NativeGlobal.process.stdout.write("poison:" + poisonCalls + "\\n");
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "raw\npoison:0\n");
});

test("collection reactivity resolves through captured bridge operations after module initialization", () => {
  const result = compile(`
state total = 0

export def exercise(items: List<number>):
    items.append(2)
    total = items.size
    print("items:" + str(total))
  `.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /const __velarReactiveCollectionReadOperation = __velarRuntime\.collectionRead/u);
  const execution = executeModule(`${result.code ?? ""}

const NativeGlobal = globalThis;
const NativeObject = NativeGlobal.Object;
const NativeReflect = NativeGlobal.Reflect;
const NativeSymbol = NativeGlobal.Symbol;
const NativeError = NativeGlobal.Error;
let poisonCalls = 0;
const fail = name => () => { poisonCalls += 1; throw new NativeError("ambient " + name + " was used"); };
NativeGlobal.Object = fail("Object constructor");
NativeGlobal.Reflect = fail("Reflect object");
NativeGlobal.Symbol = fail("Symbol constructor");
NativeGlobal.TypeError = fail("TypeError constructor");
NativeObject.getOwnPropertyDescriptor = fail("Object.getOwnPropertyDescriptor");
NativeObject.getPrototypeOf = fail("Object.getPrototypeOf");
NativeObject.isExtensible = fail("Object.isExtensible");
NativeObject.getOwnPropertySymbols = fail("Object.getOwnPropertySymbols");
NativeReflect.apply = fail("Reflect.apply");
NativeSymbol.for = fail("Symbol.for");
NativeGlobal.globalThis = null;
exercise([1]);
NativeGlobal.process.stdout.write("poison:" + poisonCalls + "\\n");
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "items:2\npoison:0\n");
});
