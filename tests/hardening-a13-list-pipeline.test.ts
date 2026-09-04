import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile, formatSource, type CompileResult } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";

function compiled(source: string): CompileResult {
  const result = compile(source.trimStart());
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.notEqual(result.code, null, "an advisory never blocks code generation");
  return result;
}

function a13(source: string): CompileResult["advisories"][number] {
  const result = compiled(source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A13"], source);
  return result.advisories[0]!;
}

const records = `
type Change:
    value: number
    changed: bool

type PublicChange:
    value: number

type Batch:
    changes: readonly List<readonly Change>
`.trimStart();

test("[A13] a pure Type.from append loop teaches List.map", () => {
  const source = `${records}
def project(changes: readonly List<readonly Change>) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in changes:
        output.append(PublicChange.from(change))
    return output
`;
  const reported = a13(source);
  assert.match(reported.message, /List\.map is the canonical collection pipeline/u);
  assert.match(reported.message, /changes\.map\(change => PublicChange\.from\(change\)\)/u);
  assert.equal(source.slice(reported.span.start, reported.span.end), "changes");
  assert.equal(reported.fix?.title, "Initialize 'output' with a collection pipeline");
  assert.equal(applyMechanicalFixes(source, [reported]).text, `${records}
def project(changes: readonly List<readonly Change>) -> List<PublicChange>:
    const output: List<PublicChange> = changes.map(change => PublicChange.from(change))
    return output
`);
});

test("[A13] ordinary data transforms and List extension teach map and flatMap", () => {
  const mapped = a13(`${records}
def doubled(changes: List<Change>) -> List<number>:
    const output: List<number> = []
    for change in changes: output.append(change.value * 2)
    return output
`);
  assert.match(mapped.message, /changes\.map\(change => change\.value \* 2\)/u);

  const flattened = a13(`
type Group:
    values: List<number>
    enabled: bool

def flatten(groups: List<Group>) -> List<number>:
    const output: List<number> = []
    for group in groups:
        if group.enabled: output.extend(group.values)
    return output
`);
  assert.match(flattened.message, /List\.filter\(\.\.\.\)\.flatMap is the canonical collection pipeline/u);
  assert.match(flattened.message, /groups\.filter\(group => group\.enabled\)\.flatMap\(group => group\.values\)/u);
});

test("[A13] a two-slot projection keeps the source index in List.map", () => {
  const source = `${records}
def numbered(changes: List<Change>) -> List<number>:
    const output: List<number> = []
    for change, index in changes: output.append(change.value + index)
    return output
`;
  const reported = a13(source);
  assert.match(reported.message, /changes\.map\(\(change, index\) => change\.value \+ index\)/u);
  const fixed = applyMechanicalFixes(source, [reported]).text;
  assert.deepEqual(compiled(fixed).advisories, []);
});

test("[A13] an indexed guarded loop stays explicit because filter would renumber it", () => {
  const source = `${records}
def positions(changes: List<Change>) -> List<number>:
    const output: List<number> = []
    for change, index in changes:
        if change.changed: output.append(index)
    return output
`;
  assert.deepEqual(compiled(source).advisories, []);
});

test("[A13] Web proves a native JSX projection while Core owns the map rewrite", () => {
  const source = `
type World:
    id: string
    name: string

def dots(worlds: List<World>, selectedIndex: number) -> List<WebNode>:
    const nodes: List<WebNode> = []
    for world, index in worlds:
        nodes.append(<button
            type="button"
            on:pointerenter={() => print(str(index))}
            on:click={() => print(str(index))}
            aria-label={f"Show {world.name}"}
            aria-current={str(index == selectedIndex)}
            data-carousel-dot={world.id}
        ></button>)
    return nodes
`.trimStart();
  const result = compile(source, { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics.map((item) => `${item.code}: ${item.message}`), [], source);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A13"]);
  const fixed = applyMechanicalFixes(source, result.advisories).text;
  assert.match(fixed, /worlds\.map\(\(world, index\) => <button/u);
  const clean = compile(fixed, { extensions: [webCompilerExtension] });
  assert.deepEqual(clean.diagnostics.map((item) => `${item.code}: ${item.message}`), [], fixed);
  assert.deepEqual(clean.advisories, []);
});

test("[A13] a stable member source and bool guard teach filter then map", () => {
  const source = `${records}
def project(batch: readonly Batch) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in batch.changes:
        if change.changed: output.append(PublicChange.from(change))
    return output
`;
  const reported = a13(source);
  assert.match(reported.message, /List\.filter\(\.\.\.\)\.map is the canonical collection pipeline/u);
  assert.match(reported.message, /batch\.changes\.filter\(change => change\.changed\)\.map\(change => PublicChange\.from\(change\)\)/u);
  assert.equal(applyMechanicalFixes(source, [reported]).text, `${records}
def project(batch: readonly Batch) -> List<PublicChange>:
    const output: List<PublicChange> = batch.changes.filter(change => change.changed).map(change => PublicChange.from(change))
    return output
`);
});

test("[A13] an identity append under a pure guard teaches filter without a redundant map", () => {
  const source = `${records}
def changedOnly(changes: readonly List<readonly Change>) -> List<readonly Change>:
    const output: List<readonly Change> = []
    for change in changes:
        if change.changed: output.append(change)
    return output
`;
  const reported = a13(source);
  assert.match(reported.message, /List\.filter is the canonical collection pipeline/u);
  assert.match(reported.message, /changes\.filter\(change => change\.changed\)/u);
  assert.doesNotMatch(reported.message, /\.map\(/u);
});

test("[A13] effects, getters, destination reads, wider loops, and computed sources stay silent", () => {
  const fixtures = [
    `${records}
def convert(change: readonly Change) -> PublicChange: return PublicChange.from(change)
def project(changes: List<Change>) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in changes: output.append(convert(change))
    return output
`,
    `
class Change:
    get changed() -> bool: return true
def project(changes: List<Change>) -> List<Change>:
    const output: List<Change> = []
    for change in changes:
        if change.changed: output.append(change)
    return output
`,
    `${records}
def project(changes: List<Change>) -> List<Change>:
    const output: List<Change> = []
    for change in changes:
        if output.size == 0: output.append(change)
    return output
`,
    `${records}
def project(changes: List<Change>) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in changes:
        output.append(PublicChange.from(change))
        print(change.value)
    return output
`,
    `${records}
def source() -> List<Change>: return []
def project() -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in source(): output.append(PublicChange.from(change))
    return output
`,
  ];
  for (const source of fixtures) assert.deepEqual(compiled(source).advisories, [], source);
});

test("[A13] a projection that relies on the filter branch's narrowing stays explicit", () => {
  const source = `
type Row:
    label: string?

def labels(rows: List<Row>) -> List<string>:
    const output: List<string> = []
    for row in rows:
        if row.label != null: output.append(row.label)
    return output
`;
  assert.deepEqual(compiled(source).advisories, []);
});

test("[A13] comments withhold the fix and a reason suppresses the advisory", () => {
  const commented = a13(`${records}
def project(changes: List<Change>) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in changes:
        // Keep the expanded steps visible in this lesson.
        output.append(PublicChange.from(change))
    return output
`);
  assert.equal(commented.fix, undefined);

  const suppressed = `${records}
def project(changes: List<Change>) -> List<PublicChange>:
    const output: List<PublicChange> = []
    for change in changes: // velar-allow A13: the expanded loop is the subject of this lesson
        output.append(PublicChange.from(change))
    return output
`;
  assert.deepEqual(compiled(suppressed).advisories, []);
  assert.equal(formatSource(formatSource(suppressed)), formatSource(suppressed));

  const bare = compile(suppressed.replace(": the expanded loop is the subject of this lesson", ""));
  assert.deepEqual(bare.diagnostics.map((item) => item.code), ["VEL1011"]);
  assert.deepEqual(bare.advisories, []);

  const stale = compile(`${records}
def project(changes: List<Change>) -> List<PublicChange>:
    return changes.map(change => PublicChange.from(change)) // velar-allow A13: the expanded loop is the subject of this lesson
`);
  assert.deepEqual(stale.advisories, []);
  assert.deepEqual(stale.diagnostics.map((item) => item.code), ["VEL1012"]);
});
