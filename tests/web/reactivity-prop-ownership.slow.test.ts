import assert from "node:assert/strict";
import test from "node:test";
import { compileWeb as compile } from "../support/compile.ts";

/**
 * D115 P5 — who owns a prop and what a prop declaration promises, one subject
 * of the file that was `tests/web/reactivity.slow.test.ts` before it reached
 * 1,018 lines.
 *
 * Hardening items #27 and #28 are the ownership half: a prop belongs to the
 * component that declared it, and a keyed parent stays bounded rather than
 * re-reading its whole list through its children. Beside them is the boundary a
 * declaration draws around a mutable class and a Promise, which is the same
 * question asked of the two types that carry identity. Both are compile-time
 * facts and are checked where they are produced. The bodies below are the
 * bodies that file had.
 */

test("[#27/#28] Web hardening keeps prop ownership and keyed parents bounded", () => {
  const coreOnly = compile(
    `
const values = ["a"]
for value in values:
    print(value)
print(values.get(0))
print(values.pop())
`.trimStart(),
  );
  assert.deepEqual(coreOnly.diagnostics, []);
  assert.ok(coreOnly.code);
  assert.doesNotMatch(coreOnly.code, /__velarWeb(?:Collection|ListPop)/u);

  const ownership = compile(
    `
type Row:
    id: string
    title: string

component Child(row: readonly Row):
    const alias = row
    alias.title = "alias"
    overwrite(row)
    harmless(row)
    return <span>{row.title}</span>

def overwrite(row: Row):
    row.title = "helper"

def harmless(row: readonly Row):
    def nested(row: Row):
        row.title = "nested-only"

def mutateThroughArrow(items: List<string>):
    [0].map(_ => items.append("captured"))

component ListChild(items: readonly List<string>):
    const alias = items
    alias.append("forbidden")
    mutateThroughArrow(items)
    return <span>{items.size}</span>
`.trimStart(),
  );

  const readonly = ownership.diagnostics.filter(
    (diagnostic) => diagnostic.code === "VEL3002" || diagnostic.code === "VEL4001",
  );
  assert.equal(
    readonly.length,
    4,
    readonly.map((diagnostic) => diagnostic.message).join("\n"),
  );
  assert.ok(
    readonly.some((diagnostic) =>
      /through readonly Row/u.test(diagnostic.message),
    ),
  );
  assert.ok(
    readonly.some((diagnostic) =>
      /Cannot assign readonly Row to Row/u.test(diagnostic.message),
    ),
  );
  assert.ok(
    !readonly.some((diagnostic) =>
      /Cannot assign readonly Row to readonly Row/u.test(diagnostic.message),
    ),
  );
  assert.ok(
    readonly.some((diagnostic) =>
      /mutating method 'append' through readonly List<string>/u.test(diagnostic.message),
    ),
  );
  assert.ok(
    readonly.some((diagnostic) =>
      /Cannot assign readonly List<string> to List<string>/u.test(diagnostic.message),
    ),
  );

  const derivedOwnership = compile(
    `
type Inner:
    title: string

type NestedRow:
    title: string
    inner: Inner

def mutateTransitively(value: NestedRow):
    mutateDirectly(value)

def mutateDirectly(value: NestedRow):
    value.title = "helper"

def identity(value: readonly NestedRow) -> readonly NestedRow:
    return value

component TransitiveChild(row: readonly NestedRow):
    mutateTransitively(row)
    return <span>{row.title}</span>

component DestructuredChild(row: readonly NestedRow):
    const {inner} = row
    inner.title = "destructured"
    return <span>{row.inner.title}</span>

component ReturnedChild(row: readonly NestedRow):
    identity(row).title = "returned"
    return <span>{row.title}</span>

component CarrierChild(row: readonly NestedRow):
    const carrier = [row]
    carrier[0].title = "carried"
    return <span>{row.title}</span>

component ConditionalChild(row: readonly NestedRow, other: readonly NestedRow, choose: bool):
    const selected = choose ? row : other
    selected.title = "selected"
    return <span>{row.title}</span>

component SpreadChild(row: readonly NestedRow):
    const copy = {...row}
    copy.inner.title = "shared"
    return <span>{row.inner.title}</span>

component OwnedCopyControl(row: readonly NestedRow):
    const copy = {...row}
    copy.title = "owned copy"
    const carrier = [row]
    carrier.append(row)
    const owned = {title: row.title}
    owned.title = "owned field"
    return <span>{copy.title + owned.title}</span>
`.trimStart(),
  );
  const derivedReadonly = derivedOwnership.diagnostics.filter(
    (diagnostic) => diagnostic.code === "VEL3002" || diagnostic.code === "VEL4001",
  );
  assert.equal(
    derivedReadonly.length,
    6,
    derivedOwnership.diagnostics
      .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
      .join("\n"),
  );

  const keyed = compile(
    `
type Row:
    id: string
    title: string

component App:
    state rows: List<Row> = [{id: "a", title: "Alpha"}]
    state revision = 0
    return <main>{rows.filter(row => row.id != "" or revision >= 0).map(row => <span key={row.id}>{row.title}</span>)}</main>

@main: mount(<App />, "#app")
`.trimStart(),
  );
  assert.deepEqual(keyed.diagnostics, []);
  assert.ok(keyed.code);
  assert.match(
    keyed.code,
    /const trackedValue = __velarReactive\(rawValue\);/u,
  );
  assert.doesNotMatch(keyed.code, /__velarReactive\(value, source\)/u);
});

test("component props keep their declared mutable class and Promise boundaries", () => {
  const result = compile(`
type User:
    name: string

class Box:
    let title: string

    constructor(title: string):
        self.title = title

    def retitle():
        self.title = "method"

    def label() -> string:
        return self.title

def retitle(box: Box):
    box.title = "helper"

component ClassChild(box: Box, boxes: List<Box>, pending: Promise<User>):
    box.title = "direct"
    boxes[0].title = "nested"
    retitle(box)
    boxes.append(box)
    box.retitle()
    const selected = boxes.get(0)
    if selected != null:
        selected.title = "method result"
    action change():
        const user = await pending
        user.name = "resolved"
    return <span>{box.label()}</span>
`.trimStart());

  // D74: props keep the annotation the author wrote. Mutable data may contain
  // classes and use collection methods; Promise remains a capability boundary.
  assert.deepEqual(result.diagnostics, []);

  const hostAnnotation = compile(`
def inspect(element: readonly CanvasElement):
    return null
`.trimStart());
  assert.ok(hostAnnotation.diagnostics.some((diagnostic) => /CanvasElement is outside that boundary/u.test(diagnostic.message)));

  const nestedHost = compile(`
type CanvasHolder:
    canvas: CanvasElement

component CanvasChild(holder: CanvasHolder):
    holder.canvas.width = 320
    return <canvas></canvas>
`.trimStart());
  assert.deepEqual(nestedHost.diagnostics, []);
});
