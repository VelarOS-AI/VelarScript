import assert from "node:assert/strict";
import test from "node:test";
import { formatSource } from "@velarscript/compiler";

/**
 * SV-I5: a named argument is `name=value`, always (charter §7).
 *
 * The formatter is line-based, and a call broken across lines puts the call's
 * `(` on an earlier physical line — so the argument's own line held no opener
 * at all and the spacing rules could not tell a named argument from an
 * assignment. One canonical spelling became two: `name=value` on one line and
 * `name = value` on the next. A declaration's parameter default keeps its
 * spaces in both shapes, because a default is not a named argument.
 */

function formatted(source: string): string {
  return formatSource(source.trimStart());
}

const singleLine = `
def draw(width: number, height: number, label: string) -> string:
    return f"{width}x{height} {label}"

@main:
    print(draw(width=1, height=2, label="a"))
`;

const multiLine = `
def draw(width: number, height: number, label: string) -> string:
    return f"{width}x{height} {label}"

@main:
    print(draw(
        width=1,
        height=2,
        label="a",
    ))
`;

test("[SV-I5] a named argument is written tight on one line and across lines", () => {
  assert.match(formatted(singleLine), /print\(draw\(width=1, height=2, label="a"\)\)/u);
  const wrapped = formatted(multiLine);
  assert.match(wrapped, /^ {8}width=1,$/mu);
  assert.match(wrapped, /^ {8}height=2,$/mu);
  assert.match(wrapped, /^ {8}label="a",$/mu);
});

test("[SV-I5] the spaced spelling is rewritten to the canonical one", () => {
  const spaced = `
def draw(width: number, height: number) -> number:
    return width + height

@main:
    const total = draw(
        width = 1,
        height = 2,
    )
    print(f"{total}")
`;
  const output = formatted(spaced);
  assert.match(output, /^ {8}width=1,$/mu);
  assert.match(output, /^ {8}height=2,$/mu);
});

test("[SV-I5] formatting is a fixed point in both shapes", () => {
  for (const source of [singleLine, multiLine]) {
    const once = formatted(source);
    assert.equal(formatSource(once), once);
  }
});

test("[SV-I5] a parameter default is not a named argument, on one line or across lines", () => {
  const declaration = `
def wrapped(
    width: number = 1,
    height: number = 2,
) -> number:
    return width + height

def inline(width: number = 1) -> number:
    return width

@main:
    print(f"{wrapped() + inline()}")
`;
  const output = formatted(declaration);
  assert.match(output, /^ {4}width: number = 1,$/mu);
  assert.match(output, /^ {4}height: number = 2,$/mu);
  assert.match(output, /def inline\(width: number = 1\) -> number:/u);
  assert.equal(formatSource(output), output);
});
