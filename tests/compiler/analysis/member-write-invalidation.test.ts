import assert from "node:assert/strict";
import test from "node:test";
import { rejects, run } from "../../support/core-program.ts";

/**
 * D115 P5 — D44 rule 73, one subject of the file that was
 * `class-and-core-correctness.test.ts` before it reached 1,167 lines.
 *
 * Batch N-1 (audit fix wave, core correctness): the D44 ruling 73 (member
 * writes invalidate only aliasable roots). What is held here is which facts a
 * member write may keep — a root whose type cannot alias the written one — and
 * every aliasing form that must still lose them. The bodies below are the
 * bodies that file had.
 */

// ---------------------------------------------------------------------------
// D44 rule 73: member writes invalidate only roots whose types could alias.
// ---------------------------------------------------------------------------

test("[D44 73] a member write on a type-disjoint root keeps the fact", () => {
  // The audit's original shape: writing a completely different variable's
  // member no longer kills the fact when the root types share no values.
  const recordRoots = run(`
type Box:
    value: string?
    label: string

type Counter:
    count: number

const box: Box = {value: "hi", label: "b"}
const other: Counter = {count: 1}
if box.value != null:
    other.count = 2
    print(box.value.upper())
`);
  assert.equal(recordRoots, "HI\n");

  // A class-typed root cannot alias a record root at all (rule 70 makes the
  // domains disjoint even at runtime).
  const classRoot = run(`
type Box:
    value: string?
    label: string

class Meter:
    let count: number = 0

const box: Box = {value: "hi", label: "b"}
const meter = Meter()
if box.value != null:
    meter.count = 2
    print(box.value.upper())
`);
  assert.equal(classRoot, "HI\n");
});

test("[D44 73] same-type roots and sibling fields still invalidate", () => {
  const optionalAccess = /Use optional access '\?\.'/u;
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const box2: Box = {value: null}
if box.value != null:
    box2.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  rejects(`
type Sides:
    left: string?
    right: string?

const pair: Sides = {left: "l", right: null}
if pair.left != null:
    pair.right = "r"
    print(pair.left.upper())
`, "VEL4001", optionalAccess);
});

test("[D44 73] every alias form keeps invalidating", () => {
  const optionalAccess = /Use optional access '\?\.'/u;
  // Alias declared before the check, written after it.
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
const alias = box
if box.value != null:
    alias.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // Alias declared after the check.
  rejects(`
type Box:
    value: string?

const box: Box = {value: "hi"}
if box.value != null:
    const alias = box
    alias.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // Chained alias: the write goes through a nested receiver whose type
  // matches the fact root, even though the outermost roots are unrelated.
  rejects(`
type Inner:
    value: string?

type Outer:
    inner: Inner

const outer: Outer = {inner: {value: "hi"}}
const mid = outer.inner
if mid.value != null:
    outer.inner.value = null
    print(mid.value.upper())
`, "VEL4001", optionalAccess);

  // Reverse: fact on the nested path, write through the alias.
  rejects(`
type Inner:
    value: string?

type Outer:
    inner: Inner

const outer: Outer = {inner: {value: "hi"}}
const mid = outer.inner
if outer.inner.value != null:
    mid.value = null
    print(outer.inner.value.upper())
`, "VEL4001", optionalAccess);

  // Function-returned alias.
  rejects(`
type Box:
    value: string?

def pick(box: Box) -> Box:
    return box

const box: Box = {value: "hi"}
const ref = pick(box)
if box.value != null:
    ref.value = null
    print(box.value.upper())
`, "VEL4001", optionalAccess);

  // List element alias.
  rejects(`
type Box:
    value: string?

const items: List<Box> = [{value: "hi"}]
const item = items[0]
if item.value != null:
    items[0].value = null
    print(item.value.upper())
`, "VEL4001", optionalAccess);

  // self.field against another instance of the same class.
  rejects(`
class Holder:
    let value: string? = "hi"

    def poke(other: Holder) -> string:
        if self.value != null:
            other.value = null
            return self.value.upper()
        return "none"

print(Holder().poke(Holder()))
`, "VEL4001", optionalAccess);
});
