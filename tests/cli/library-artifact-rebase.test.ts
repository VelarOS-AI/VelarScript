import assert from "node:assert/strict";
import test from "node:test";
import { compile, genericApplicationType, inspectModule, type ModuleInterface, type ValueType } from "@velarscript/compiler";
import { decodeVelarLibraryInterface, encodeVelarLibraryInterface, rebaseModuleInterfaceIdentities } from "../../packages/cli/src/library-artifact.ts";

const physical = "/a/long/physical/source.vel";
const logical = "package:fixture@1.0.0/src/source.vel";
const replacements = [{physical, logical}];
const token = (path: string): ValueType => ({kind: "class", name: "Token", identity: `velar:${path}#Token`});
const box = (path: string, argument: ValueType): ValueType => genericApplicationType(`velar:${path}#type:Box`, "Box", [argument]);
const identity = (value: ValueType): string => {
  assert.ok(value.kind === "named" || value.kind === "class");
  assert.ok(value.identity);
  return value.identity;
};
const empty = (): ModuleInterface => inspectModule("", {path: physical}).moduleInterface;

test("package rebasing rebuilds nested generic identities and every indexed reference", () => {
  const inner = box(physical, token(physical));
  const outer = box(physical, {kind: "object", fields: new Map([["tokens", {kind: "list", element: inner, readonlyView: true}]])});
  const expectedInner = box(logical, token(logical));
  const expectedOuter = box(logical, {kind: "object", fields: new Map([["tokens", {kind: "list", element: expectedInner, readonlyView: true}]])});
  const fields = new Map<string, ValueType>([["value", outer]]);
  const input: ModuleInterface = {
    ...empty(), exports: new Map([["result", outer]]),
    namedTypes: new Map([[identity(inner), fields]]),
    namedTypeIdentities: new Map([["Result", identity(outer)]]),
    runtimeTypeExports: new Map([[identity(inner), "__velarRuntimeType_Inner"]]),
    extensionData: new Map([["references", new Set([identity(inner), identity(outer)])]]),
  };
  const before = encodeVelarLibraryInterface(input);
  const result = rebaseModuleInterfaceIdentities(input, replacements);
  assert.deepEqual(result.exports.get("result"), expectedOuter);
  assert.ok(result.namedTypes.has(identity(expectedInner)));
  assert.equal(result.namedTypeIdentities.get("Result"), identity(expectedOuter));
  assert.equal(result.runtimeTypeExports?.get(identity(expectedInner)), "__velarRuntimeType_Inner");
  assert.deepEqual(result.extensionData.get("references"), new Set([identity(expectedInner), identity(expectedOuter)]));
  assert.equal(encodeVelarLibraryInterface(decodeVelarLibraryInterface(encodeVelarLibraryInterface(result))), encodeVelarLibraryInterface(result));
  assert.deepEqual(rebaseModuleInterfaceIdentities(result, replacements), result);
  assert.equal(encodeVelarLibraryInterface(input), before, "the publishing input remains unchanged");
});

test("generic class bases and application-less references use the structured declaration index", () => {
  const source = `class Token:\n    const name: string = "token"\nclass Crate<T>:\n    let values: List<T> = []\nclass Derived extends Crate<Token>:\n    def size() -> number: return self.values.size\nexport def make() -> Derived: return Derived()\n`;
  const compiled = compile(source, {path: physical});
  assert.deepEqual(compiled.diagnostics, []);
  const input = compiled.moduleInterface;
  const result = rebaseModuleInterfaceIdentities(input, replacements);
  const derived = result.classes.get("Derived")!;
  assert.ok(derived.baseApplication);
  assert.ok(derived.base?.includes(logical));
  const output = decodeVelarLibraryInterface(encodeVelarLibraryInterface(result));
  assert.equal(output.classes.get("Derived")?.base, derived.base);
});

test("rebasing rejects inconsistent application identities and preserves opaque extension objects", () => {
  const application = box(physical, token(physical));
  const corrupt = {...application, identity: "wrong"} as ValueType;
  assert.throws(() => rebaseModuleInterfaceIdentities({...empty(), exports: new Map([["bad", corrupt]])}, replacements), /identity must match/u);
  const opaque = {identity: "opaque", application: {declaration: "business", arguments: [1, "x"]}};
  const result = rebaseModuleInterfaceIdentities({...empty(), extensionData: new Map([["opaque", opaque]])}, replacements);
  assert.deepEqual(result.extensionData.get("opaque"), opaque);
});
