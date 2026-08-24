import assert from "node:assert/strict";
import test from "node:test";
import { compile, formatSource, type CompileResult } from "@velarscript/compiler";

function compiled(source: string): CompileResult {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

function a9(source: string): CompileResult["advisories"][number] {
  const result = compiled(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A9"], source);
  return result.advisories[0]!;
}

const declarations = `
type TerrainSample:
    position: string
    surfaceY: number
    temperature: number

type GenerationSampleResponse extends TerrainSample:
    worldId: string
`.trimStart();

test("[A9] a target literal mirroring one typed record teaches Type.from", () => {
  const source = `${declarations}
def response(worldId: string, sample: TerrainSample) -> GenerationSampleResponse:
    return {
        worldId,
        position: sample.position,
        surfaceY: sample.surfaceY,
        temperature: sample.temperature,
    }
`;
  const reported = a9(source);
  assert.match(reported.message, /GenerationSampleResponse\.from\(sample, \{worldId\}\)/u);
  assert.match(reported.message, /declared field set and declaration order/u);
  assert.ok(source.slice(reported.span.start, reported.span.end).trimStart().startsWith("{"));

  const canonical = compiled(`${declarations}
def response(worldId: string, sample: TerrainSample) -> GenerationSampleResponse:
    return GenerationSampleResponse.from(sample, {worldId})
`);
  assert.deepEqual(canonical.advisories, []);
});

test("[A9] exact all-field mirrors need no override literal", () => {
  const reported = a9(`
type Source:
    id: string
    name: string

type Target:
    id: string
    name: string

def convert(source: Source) -> Target:
    return {id: source.id, name: source.name}
`);
  assert.match(reported.message, /'Target\.from\(source\)' is the canonical exact projection/u);
});

test("[A9] transformations, effects, partial targets, mixed sources, spreads, and untyped contexts stay silent", () => {
  const fixtures = [
    `${declarations}
def response(worldId: string, sample: TerrainSample) -> GenerationSampleResponse:
    return {
        position: sample.position,
        surfaceY: sample.surfaceY,
        temperature: sample.temperature,
        worldId: worldId.trim(),
    }
`,
    `
type Source:
    id: string
    name: string?
type Target:
    id: string
    name: string?
def convert(source: Source) -> Target:
    return {id: source.id}
`,
    `
type Source:
    id: string
    name: string
type Target:
    id: string
    name: string
def convert(first: Source, second: Source) -> Target:
    return {id: first.id, name: second.name}
`,
    `
type Source:
    id: string
    name: string
type Target:
    id: string
    name: string
def convert(source: Source) -> Target:
    return {...source}
`,
    `
type Source:
    id: string
    name: string
def convert(source: Source):
    return {id: source.id, name: source.name}
`,
    `
type Source:
    id: string
type Target:
    id: string
    marker: string
def convert(source: Source) -> Target:
    return {id: source.id, marker: "fixed"}
`,
  ];
  for (const source of fixtures) assert.deepEqual(compiled(source).advisories, [], source);
});

test("[A9] a reasoned suppression preserves an intentional wire order", () => {
  const source = `${declarations}
def response(worldId: string, sample: TerrainSample) -> GenerationSampleResponse:
    return { // velar-allow A9: worldId must stay first in the serialized wire record
        worldId,
        position: sample.position,
        surfaceY: sample.surfaceY,
        temperature: sample.temperature,
    }
`;
  const suppressed = compiled(source);
  assert.deepEqual(suppressed.advisories, []);
  assert.equal(formatSource(source), source);
  assert.equal(formatSource(formatSource(source)), source);

  const bare = compile(source.replace(": worldId must stay first in the serialized wire record", ""));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);

  const stale = compile(`${declarations}
def response(worldId: string, sample: TerrainSample) -> GenerationSampleResponse:
    return GenerationSampleResponse.from(sample, {worldId}) // velar-allow A9: worldId must stay first
`);
  assert.deepEqual(stale.advisories, []);
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});
