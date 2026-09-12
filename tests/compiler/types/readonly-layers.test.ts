import assert from "node:assert/strict";
import test from "node:test";
import { compile, formatSource, type ValueType } from "@velarscript/compiler";
import { executeModule } from "../../support/execute-module.ts";

const state = "type State:\n    x: number\n\n";
function check(source: string): void {
  assert.deepEqual(compile(source).diagnostics, [], source);
}
function refuses(source: string, message: RegExp): void {
  const result = compile(source);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.match(result.diagnostics[0]!.message, message);
}

test("List structure and element slots are independent capabilities", () => {
  for (const outer of [false, true]) for (const inner of [false, true]) {
    const head = state + `def change(items: ${outer ? "readonly " : ""}List<${inner ? "readonly " : ""}State>):\n`;
    const field = head + "    items[0].x = 2\n";
    if (inner) refuses(field, /readonly State/); else check(field);
    for (const body of ["items[0] = {x: 2}", "items.append({x: 2})", "items.clear()"]) {
      const source = head + `    ${body}\n`;
      if (outer) refuses(source, /readonly List/); else check(source);
    }
  }
});

test("readonly fields and declarations protect only their own slots", () => {
  const header = state + "readonly type Snapshot:\n    state: State\n    states: List<State>\n\n";
  check(header + "def change(s: Snapshot):\n    s.state.x = 2\n    s.states.append({x: 3})\n");
  refuses(header + "def change(s: Snapshot):\n    s.state = {x: 2}\n", /read-only field/);
  check(header + "def take(s: Snapshot): pass\ndef forward(s: readonly Snapshot): take(s)\n");
  const explicit = state + "readonly type Snapshot:\n    state: readonly State\n    states: readonly List<readonly State>\n\n";
  refuses(explicit + "def change(s: Snapshot):\n    s.state.x = 2\n", /readonly State/);
  refuses(explicit + "def change(s: Snapshot):\n    s.states[0].x = 2\n", /readonly State/);
  refuses(state + "def take(s: State): pass\ndef forward(s: readonly State): take(s)\n", /Cannot assign readonly State/);
});

test("reads, callbacks, destructuring, spreads and copies preserve element contracts", () => {
  for (const qualifier of ["", "readonly "]) {
    const header = state + "def touch(s: State) -> number:\n    s.x = 2\n    return s.x\n\n" + `def change(items: readonly List<${qualifier}State>):\n`;
    for (const body of [
      "for item in items:\n        item.x = 2",
      "const mapped = items.map(item => touch(item))",
      "const [item] = items\n    item.x = 2",
      "const copied = items.copy()\n    copied[0].x = 2",
      "const copied = [...items]\n    copied[0].x = 2",
      "const copied = items.slice(0)\n    copied[0].x = 2",
      "const found = items.get(0)\n    if found != null:\n        found.x = 2",
    ]) {
      const source = header + `    ${body}\n`;
      if (qualifier) refuses(source, /readonly State/); else check(source);
    }
  }
  check(state + "def change(s: readonly State):\n    const copy = {...s}\n    copy.x = 2\n");
});

test("Map, Set and Record readers preserve key and value contracts", () => {
  for (const qualifier of ["", "readonly "]) {
    for (const [type, expression] of [
      [`Map<string, ${qualifier}State>`, 'items.values()[0]'],
      [`Map<${qualifier}State, number>`, 'items.keys()[0]'],
      [`Set<${qualifier}State>`, 'items.values()[0]'],
      [`Record<${qualifier}State>`, 'items.values()[0]'],
    ]) {
      const source = state + `def change(items: readonly ${type}):\n    ${expression}.x = 2\n`;
      if (qualifier) refuses(source, /readonly State/); else check(source);
    }
  }
});

test("readonly covariance never widens a writable nested slot", () => {
  const header = "type Narrow:\n    x: string\ntype Wide:\n    x: string | number\n";
  refuses(header + "def widen(v: readonly List<Narrow>) -> readonly List<Wide>: return v\n", /Cannot assign/);
  check(header + "def widen(v: readonly List<Narrow>) -> readonly List<readonly Wide>: return v\n");
  refuses(header + "def leak(v: List<readonly Narrow>) -> List<Narrow>: return v\n", /Cannot assign/);
});

test("explicit nested readonly survives object projection, aliasing and optional narrowing", () => {
  const header = state + "type View = readonly State\nreadonly type Snapshot:\n    state: View?\n";
  refuses(header + "def change(s: Snapshot):\n    const {state} = s\n    if state != null:\n        state.x = 2\n", /readonly State/);
  refuses(header + "def change(s: Snapshot):\n    const copy = {...s}\n    if copy.state != null:\n        copy.state.x = 2\n", /readonly State/);
});

test("readonly layers erase without freezing or copying the shared element", () => {
  const result = compile(state + `def change(items: readonly List<State>):\n    items[0].x = 9\nconst item: State = {x: 1}\nconst items: List<State> = [item]\nchange(items)\nprint(item.x)\n`);
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code!);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "9\n");
  const source = "export readonly type Snapshot:\n    states: readonly List<readonly State>\n";
  assert.equal(formatSource(source), source);
});

test("record and list match bindings keep the authored nested types", () => {
  for (const qualifier of ["", "readonly "]) {
    const record = state + `readonly type Holder:\n    state: ${qualifier}State\ndef change(holder: Holder):\n    match holder:\n        case {state}:\n            state.x = 2\n`;
    const list = state + `def change(items: readonly List<${qualifier}State>):\n    match items:\n        case [first, ...rest]:\n            first.x = 2\n        case []: pass\n`;
    for (const source of [record, list]) {
      if (qualifier) refuses(source, /readonly State/); else check(source);
    }
  }
});

test("generic readonly declarations protect own and inherited slots without an extra view", () => {
  const header = state + "readonly type Box<T>:\n    value: T\nreadonly type Child<T> extends Box<T>:\n    label: string\n";
  check(header + "def take(box: Child<State>): pass\ndef forward(box: readonly Child<State>):\n    box.value.x = 2\n    take(box)\n");
  refuses(header + "def change(box: Child<State>):\n    box.value = {x: 2}\n", /read-only field/);
});

test("structural readonly slots cannot acquire writes through a Record contract", () => {
  const result = compile('import js {settings} from "fixture"\nconst dict: Record<number> = settings\n', {
    analysis: { imports: new Map([["settings", { kind: "object", readonlyView: true, fields: new Map([["value", { kind: "number" }]]) }]]) },
  });
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0]!.message, /Cannot assign/);
});

test("runtime shape narrowing preserves explicit readonly at every data layer", () => {
  const header = "readonly type State:\n    x: number\ntype Mutable:\n    x: number\n";
  refuses(header + "def change(s: State):\n    if s is Mutable:\n        s.x = 2\n", /readonly|read-only/);
  for (const type of ["List<State>", "readonly List<State>", "Record<State>"]) {
    const checked = type.includes("Record") ? "Record<Mutable>" : "List<Mutable>";
    const read = type.includes("Record") ? 's.get("x")' : 's.get(0)';
    refuses(header + `type Writable = ${checked}\ndef change(s: ${type}):\n    if s is Writable:\n        const value = ${read}\n        if value != null:\n            value.x = 2\n`, /readonly|read-only/);
  }
  const mixed = "type Mixed:\n    readonly id: number\n    value: number\ntype Mutable:\n    id: number\n    value: number\n";
  check(mixed + "def change(s: Mixed):\n    if s is Mutable:\n        s.value = 2\n");
  refuses(mixed + "def change(s: Mixed):\n    if s is Mutable:\n        s.id = 2\n", /readonly|read-only/);
  refuses(header + "def change(s: State | Mutable):\n    if s is Mutable:\n        s.x = 2\n", /readonly|read-only/);
});

test("runtime shape narrowing cannot widen the writable fields inside a readonly list", () => {
  const source = "type Narrow:\n    x: string\ntype Wide:\n    x: string | number\ntype Wides = List<Wide>\ndef change(s: readonly List<Narrow>):\n    if s is Wides:\n        s[0].x = 2\n";
  refuses(source, /Cannot assign number to string/);
});

test("checking an unknown against an optional type still requires a presence check", () => {
  refuses(state + "type OptionalState = State?\ndef change(s: unknown):\n    if s is OptionalState:\n        s.x = 2\n", /optional|nullable|may be null/);
});

test("checking an already typed callable preserves readonly result and parameter contracts", () => {
  const header = state + "type Reader = () -> readonly State\ntype WritableReader = () -> State\ntype Mutator = (State) -> null\ntype Observer = (readonly State) -> null\n";
  refuses(header + "def change(read: Reader):\n    if read is WritableReader:\n        read().x = 2\n", /readonly|read-only/);
  refuses(header + "def change(read: WritableReader):\n    if read is Reader:\n        read().x = 2\n", /readonly|read-only/);
  refuses(header + "def change(fn: Mutator, s: readonly State):\n    if fn is Observer:\n        fn(s)\n", /Cannot assign readonly State/);
});

test("runtime shape checks retain source-only fields in writable replacement domains", () => {
  const header = "type Full:\n    x: number\n    y: number\ntype Small:\n    x: number\n";
  for (const [source, target, write] of [
    ["List<Full>", "List<Small>", "s.append({x: 2})"],
    ["Set<Full>", "Set<Small>", "s.add({x: 2})"],
    ["Map<string, Full>", "Map<string, Small>", 's.set("key", {x: 2})'],
    ["Map<Full, number>", "Map<Small, number>", "s.set({x: 2}, 1)"],
    ["Record<Full>", "Record<Small>", 's["key"] = {x: 2}'],
  ]) {
    const before = header + `type Checked = ${target}\ndef change(s: ${source}):\n`;
    refuses(before + `    if s is Checked:\n        ${write}\n`, /missing required field 'y'/);
    refuses(before + `    match s:\n        case Checked as s:\n            ${write}\n`, /missing required field 'y'/);
    check(before + `    if s is Checked:\n        ${write!.replace("{x: 2}", "{x: 2, y: 3}")}\n`);
  }
  refuses(header + "type Holder:\n    value: Full\ntype Checked:\n    value: Small\ndef change(s: Holder):\n    if s is Checked:\n        s.value = {x: 2}\n", /missing required field 'y'/);
});

test("runtime checks cannot inject readonly values through an existing mutable owner", () => {
  for (const [source, target, write] of [
    ["List<State>", "List<readonly State>", "s.append(view)"],
    ["Set<State>", "Set<readonly State>", "s.add(view)"],
    ["Map<string, State>", "Map<string, readonly State>", 's.set("key", view)'],
    ["Map<State, number>", "Map<readonly State, number>", "s.set(view, 1)"],
    ["Record<State>", "Record<readonly State>", 's["key"] = view'],
  ]) {
    refuses(state + `type Checked = ${target}\ndef change(s: ${source}, view: readonly State):\n    if s is Checked:\n        ${write}\n`, /readonly|read-only/);
  }
  refuses(state + "type Holder:\n    value: State\ntype Checked:\n    value: readonly State\ndef change(s: Holder, view: readonly State):\n    if s is Checked:\n        s.value = view\n", /read-only field/);
});

test("dynamic Record checks protect required shape slots and preserve heterogeneous reads", () => {
  const header = "type State:\n    x: number\ntype Numbers = Record<number>\n";
  for (const write of ['s.remove("x")', "s.clear()", 's["x"] = 2']) {
    refuses(header + `def change(s: State):\n    if s is Numbers:\n        ${write}\n`, /readonly|read-only/);
  }
  refuses("type State:\n    x: number\n    y: string\ntype Values = Record<unknown>\ndef read(s: State):\n    if s is Values:\n        const value = s.get(\"y\")\n        if value != null:\n            print(value + 2)\n", /Cannot assign/);
  const result = compile("type State:\n    x: number\ntype Values = Record<number | string>\ndef read(s: State):\n    if s is Values:\n        const value = s.get(\"extra\")\n        if value is string:\n            print(value)\nconst extended = {x: 1, extra: \"kept\"}\nread(extended)\n");
  assert.deepEqual(result.diagnostics, []);
  const execution = executeModule(result.code!);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "kept\n");
});

test("runtime shape checks retain optional and readonly metadata on source-only fields", () => {
  const number = { kind: "number" } as const;
  const source: ValueType = { kind: "object", fields: new Map<string, ValueType>([["value", {
    kind: "object", fields: new Map([["x", number], ["extra", number]]),
    optionalFields: new Set(["extra"]), readonlyFields: new Set(["extra"]),
  }]]) } as const;
  const header = 'import js {source} from "fixture"\ntype Small:\n    x: number\ntype Checked:\n    value: Small\nif source is Checked:\n';
  const analysis = { imports: new Map([["source", source]]) };
  assert.deepEqual(compile(header + "    source.value = {x: 1}\n", { analysis }).diagnostics, []);
  const refused = compile(header + "    source.value.extra = 2\n", { analysis });
  assert.equal(refused.diagnostics.length, 1);
  assert.match(refused.diagnostics[0]!.message, /read-only field 'extra'/);
});

test("runtime overlap keeps readonly union arms when mutable collection types are invariant", () => {
  for (const [source, target, read] of [
    ["List<readonly State>", "List<State>", "s[0]"],
    ["Set<readonly State>", "Set<State>", "s.values()[0]"],
    ["Map<string, readonly State>", "Map<string, State>", "s.values()[0]"],
    ["Map<readonly State, number>", "Map<State, number>", "s.keys()[0]"],
    ["Record<readonly State>", "Record<State>", "s.values()[0]"],
  ]) {
    const header = state + `type Checked = ${target}\ndef change(s: ${source} | string):\n`;
    refuses(header + `    if s is Checked:\n        ${read}.x = 2\n`, /readonly|read-only/);
    refuses(header + `    match s:\n        case Checked as s:\n            ${read}.x = 2\n        case _: pass\n`, /readonly|read-only/);
  }
});

test("runtime callable overlap preserves known input contracts inside a union", () => {
  refuses('type Numeric = (number) -> number\ntype Textual = (string) -> string\ndef invoke(fn: Numeric | string):\n    if fn is Textual:\n        fn("text")\n', /Cannot assign string to number/);
});
