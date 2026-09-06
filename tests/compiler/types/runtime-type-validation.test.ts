import assert from "node:assert/strict";
import test from "node:test";
import { join, resolve } from "node:path";
import { compile as compileCore } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";
import { compile } from "../../support/compiler-suite.ts";

test("runtime data validation composes nested data types and class identity", () => {
  const result = compile(`
type Profile:
    name: string

class Player:
    const name: string

    constructor(name: string):
        self.name = name

    def label() -> string:
        return self.name

type Session:
    profile: Profile
    player: Player

const raw = {profile: {name: "Ada"}, player: Player("Nova")}
const session = Session.parse(raw)
print(session.profile.name)
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarTypeCheck_Profile/u);
  assert.match(result.code ?? "", /__velarValidationIsInstance\([^\n]+, Player\)/u);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "Ada\n");
});

test("acyclic runtime Types emit straight-line validators without graph state", () => {
  const result = compileCore(`
export type Point:
    x: number
    y: number

export type Marker:
    point: Point
    label: string?

export type PointAlias = Point

export def pointIs(value: unknown) -> bool:
    return Point.is(value)

export def markerIs(value: unknown) -> bool:
    return Marker.is(value)

print(pointIs({x: 1, y: 2}))
print(markerIs({point: {x: 1, y: 2}, label: "origin"}))
print(PointAlias.is({x: 1, y: "bad"}))
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  assert.match(code, /function __velarTypeCheck_Point\(value\) \{/u);
  assert.match(code, /function __velarTypeCheck_Marker\(value\) \{/u);
  assert.match(code, /function __velarTypeCheck_PointAlias\(value\) \{/u);
  assert.doesNotMatch(code, /function __velarTypeCheck_(?:Point|Marker|PointAlias)\(value, __state/u);
  assert.doesNotMatch(code, /__velarTypeCheck_(?:Point|Marker|PointAlias)[\s\S]{0,900}__velarValidationWeakMap/u);
  assert.match(code, /return __velarTypeCheck_Point\(value\);/u);
  const execution = executeModule(code);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true\ntrue\nfalse\n");
});

test("recursive record types validate finite trees and reject cyclic or excessive graphs", () => {
  const result = compile(`
type TreeNode:
    label: string
    children: List<TreeNode>

type Forest = List<TreeNode>

type LinkedNode:
    label: string
    next: LinkedNode | string

type Folder:
    name: string
    entries: List<FolderEntry>

type FolderEntry:
    name: string
    folder: Folder?

const tree = TreeNode.parse({label: "root", children: [{label: "leaf", children: []}]})
const forest = Forest.parse([tree])
const linked = LinkedNode.parse({label: "root", next: {label: "leaf", next: "end"}})
const folder = Folder.parse({name: "docs", entries: [{name: "guide.md", folder: null}]})
print(tree.children[0].label)
print(forest[0].label)
print(linked.label)
print(folder.entries[0].name)
print(tree is TreeNode)
try:
    TreeNode.parse({label: "broken", children: [{label: 42, children: []}]})
catch error:
    print(error.name)
`.trimStart());
  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /function __velarTypeCheck_TreeNode/u);
  assert.match(result.code ?? "", /__velarValidationSetHas\(__active, __velarTypeCheck_TreeNode\)/u);
  const runtimeProbe = [
    result.code ?? "",
    'const cyclic = { label: "cycle", children: [] };',
    'cyclic.children.push(cyclic);',
    'console.log(TreeNode.is(cyclic));',
    'const cyclicFolder = { name: "cycle", entries: [] };',
    'cyclicFolder.entries.push({ name: "loop", folder: cyclicFolder });',
    'console.log(Folder.is(cyclicFolder));',
    'const leaf = { label: "shared", children: [] };',
    'console.log(TreeNode.is({ label: "dag", children: [leaf, leaf] }));',
    'console.log(TreeNode.is([]));',
    'let deep = { label: "leaf", children: [] };',
    'for (let index = 0; index < 1001; index += 1) deep = { label: "deep", children: [deep] };',
    'console.log(TreeNode.is(deep));',
  ].join("\n");
  const execution = executeModule(runtimeProbe);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "leaf\nroot\nroot\nguide.md\ntrue\nValidationError\nfalse\nfalse\ntrue\nfalse\nfalse\n");

  const structural = compile(`
type Alpha:
    label: string
    children: List<Alpha>

type Mirror:
    label: string
    children: List<Mirror>

type Wrong:
    label: number
    children: List<Wrong>

const mirror: Mirror = {label: "ok", children: []}
const compatible: Alpha = mirror
const wrong: Wrong = {label: 1, children: []}
const incompatible: Alpha = wrong
`.trimStart());
  assert.equal(structural.diagnostics.filter((item) => /Cannot assign Wrong to Alpha/u.test(item.message)).length, 1);

  const unproductive = compile(`
type Loop:
    next: Loop

type Left:
    right: Right

type Right:
    left: Left

type AliasLoop = AliasRecord

type AliasRecord:
    next: AliasLoop

type UnionLeft:
    next: UnionLeft | UnionRight

type UnionRight:
    next: UnionLeft | UnionRight
`.trimStart());
  assert.equal(unproductive.diagnostics.filter((item) => /cannot construct a finite value/u.test(item.message)).length, 6);
});

test("runtime data Type validation retains its initialization-owned graph and host ABI", () => {
  const result = compile(`
export type Tree:
    label: string
    children: List<Tree>

export type FutureNumber = Promise<number>

export enum Status:
    ready
    done

class Box:
    const value: number

    constructor(value: number):
        self.value = value

export type Boxed:
    box: Box
`.trimStart());

  assert.deepEqual(result.diagnostics, []);
  assert.match(result.code ?? "", /__velarValidationState/u);
  assert.match(result.code ?? "", /__velarValidationIsPromise/u);
  assert.doesNotMatch(result.code ?? "", /function __velarTypeCheck_Tree\(value, __state = \{ active: new WeakMap/u);

  const execution = executeModule(`${result.code ?? ""}
const NativeArray = globalThis.Array;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeWeakMap = globalThis.WeakMap;
const NativeSet = globalThis.Set;
const NativePromise = globalThis.Promise;
const NativeFunction = globalThis.Function;
const NativeSymbol = globalThis.Symbol;
const NativeTypeError = globalThis.TypeError;
const nativeDefine = NativeObject.defineProperty;
const nativeDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeIsFrozen = NativeObject.isFrozen;
const nativeReflectApply = NativeReflect.apply;
const nativeHasInstance = nativeDescriptor(NativeFunction.prototype, NativeSymbol.hasInstance).value;
const valid = {label: "root", children: [{label: "leaf", children: []}]};
const cyclic = {label: "cycle", children: []};
cyclic.children[0] = cyclic;
const leaf = {label: "shared", children: []};
const dag = {label: "dag", children: [leaf, leaf]};
let getterReads = 0;
const accessor = nativeDefine({children: []}, "label", {enumerable: true, configurable: true, get() { getterReads += 1; return "unsafe"; }});
const promise = NativePromise.resolve(1);
const box = new Box(1);
let poisonCalls = 0;
const poison = () => { poisonCalls += 1; throw new NativeTypeError("poisoned validation host"); };
globalThis.Array = poison;
globalThis.Object = poison;
globalThis.Reflect = {apply: poison};
globalThis.WeakMap = poison;
globalThis.Set = poison;
globalThis.Promise = poison;
globalThis.Function = poison;
globalThis.Symbol = poison;
globalThis.Boolean = poison;
globalThis.TypeError = poison;
NativeArray.isArray = poison;
NativeObject.getOwnPropertyDescriptor = poison;
NativeObject.freeze = poison;
NativeReflect.apply = poison;
for (const name of ["get", "set", "delete"]) nativeDefine(NativeWeakMap.prototype, name, {value: poison, writable: true, configurable: true});
for (const name of ["has", "add", "delete"]) nativeDefine(NativeSet.prototype, name, {value: poison, writable: true, configurable: true});
nativeDefine(NativeSet.prototype, "size", {get: poison, configurable: true});
nativeDefine(NativePromise, NativeSymbol.hasInstance, {value: poison, configurable: true});
nativeDefine(Box, NativeSymbol.hasInstance, {value: poison, configurable: true});
nativeDefine(NativeArray.prototype, NativeSymbol.iterator, {value: poison, writable: true, configurable: true});

const parseFailure = (() => { try { Tree.parse({label: 1, children: []}); return null; } catch (error) { return error; } })();
const originalError = nativeReflectApply(nativeHasInstance, NativeTypeError, [parseFailure]);
console.log(Tree.is(valid), Tree.is(cyclic), Tree.is(dag));
console.log(Tree.is(accessor), getterReads);
console.log(FutureNumber.is(promise), Status.is("ready"));
console.log(Boxed.is({box}), Boxed.is({box: {value: 1}}));
console.log(parseFailure?.name, originalError);
console.log(nativeIsFrozen(Tree), nativeIsFrozen(FutureNumber), nativeIsFrozen(Status), nativeIsFrozen(Boxed));
console.log(poisonCalls);
`);
  assert.equal(execution.status, 0, String(execution.stderr));
  assert.equal(execution.stdout, "true false true\nfalse 0\ntrue true\ntrue false\nValidationError true\ntrue true true true\n0\n");
});
