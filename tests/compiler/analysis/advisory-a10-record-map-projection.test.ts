import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile, type CompileResult } from "@velarscript/compiler";

function compiled(source: string): CompileResult {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

const declarations = `
type Slots<T>:
    air: T
    dirt: T
    stone: T
    water: T

type IdentitySlots = Slots<string>
type RuntimeSlots = Slots<number>
`.trimStart();

test("[A10] a large same-field transform teaches Type.mapFrom", () => {
  const source = `${declarations}
def resolve(key: string) -> number: return key.size

def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return {
        air: resolve(keys.air),
        dirt: resolve(keys.dirt),
        stone: resolve(keys.stone),
        water: resolve(keys.water),
    }
`;
  const result = compiled(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A10"]);
  const reported = result.advisories[0]!;
  assert.match(reported.message, /RuntimeSlots\.mapFrom\(keys, resolve\)/u);
  assert.match(reported.message, /all 4 fields/u);
  assert.equal(reported.fix?.title, "Use 'RuntimeSlots.mapFrom(...)'");
  assert.equal(applyMechanicalFixes(source, [reported]).text, `${declarations}
def resolve(key: string) -> number: return key.size

def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return RuntimeSlots.mapFrom(keys, resolve)
`);
});

test("[A10] small, reordered, mixed-source, and mixed-transform literals stay silent", () => {
  const fixtures = [
    `
type Source:
    a: string
    b: string
    c: string
type Target:
    a: number
    b: number
    c: number
def resolve(value: string) -> number: return value.size
def convert(source: Source) -> Target:
    return {a: resolve(source.a), b: resolve(source.b), c: resolve(source.c)}
`,
    `${declarations}
def resolve(key: string) -> number: return key.size
def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return {
        water: resolve(keys.water),
        air: resolve(keys.air),
        dirt: resolve(keys.dirt),
        stone: resolve(keys.stone),
    }
`,
    `${declarations}
def resolve(key: string) -> number: return key.size
def runtime(first: IdentitySlots, second: IdentitySlots) -> RuntimeSlots:
    return {
        air: resolve(first.air),
        dirt: resolve(first.dirt),
        stone: resolve(second.stone),
        water: resolve(first.water),
    }
`,
    `${declarations}
def resolve(key: string) -> number: return key.size
def other(key: string) -> number: return key.size
def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return {
        air: resolve(keys.air),
        dirt: resolve(keys.dirt),
        stone: other(keys.stone),
        water: resolve(keys.water),
    }
`,
  ];
  for (const source of fixtures) assert.deepEqual(compiled(source).advisories, [], source);
});

test("[A10] comments withhold the mechanical fix and a reason suppresses the advisory", () => {
  const commented = compiled(`${declarations}
def resolve(key: string) -> number: return key.size
def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return {
        // Keep the individual conversions visible for this audit fixture.
        air: resolve(keys.air),
        dirt: resolve(keys.dirt),
        stone: resolve(keys.stone),
        water: resolve(keys.water),
    }
`);
  assert.deepEqual(commented.advisories.map((item) => item.code), ["A10"]);
  assert.equal(commented.advisories[0]!.fix, undefined);

  const suppressed = compiled(`${declarations}
def resolve(key: string) -> number: return key.size
def runtime(keys: IdentitySlots) -> RuntimeSlots:
    return { // velar-allow A10: audit fixture keeps every conversion visible
        air: resolve(keys.air),
        dirt: resolve(keys.dirt),
        stone: resolve(keys.stone),
        water: resolve(keys.water),
    }
`);
  assert.deepEqual(suppressed.advisories, []);
});
