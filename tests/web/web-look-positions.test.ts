import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource, type ValueType } from "@velarscript/compiler";
import { velarCompilerExtension, webModuleInterfaces } from "../../packages/web/src/compiler.ts";

// D114 0.29.0 LK-I1. Charter §17 opens with one table read by two constructs:
//
//   > A `look:` or `keyframes:` block is a value, so it is written where a value
//   > is written: after `=`, after `return`, or inside a call, a collection, or a
//   > record. Section 14 lists those positions in full, and they are the same
//   > ones that decide whether `<` opens an element — one table, two constructs.
//
// `<` had all five positions. The block had two: the last three were refused,
// each with a cascade —
//
//   lk55  take(look:  → VEL2024 "Write '=' between the name and value for named
//                       argument 'look'" + VEL2024 "A named argument takes one value"
//   lk50  [look:      → VEL5038 + VEL2001 "Expected ']' after list elements"
//   lk56  {main: look: → VEL5038 + VEL2001 "Expected '}' after object fields"
//
// The cause was structural: the block opener waited for an `indent` token, and a
// bracket suspends newlines and indentation altogether (charter §2). Inside one
// the evidence is the source — the ':' ends its physical line, the body begins
// on a later line indented past the line that opened it — and the block closes
// on the first line at or below the opening line's indentation, which is where
// the bracket's own `)`/`]`/`}` is written.
//
// The one shape this must not claim is a record *key* spelled `look`, whose
// value sits on the next line: a key position is not a value position.

function compileWithLook(text: string) {
  const imports = new Map<string, ValueType>();
  const lookExports = webModuleInterfaces.get("velar/look")?.exports;
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"velar\/look"/gu)) {
    for (const raw of match[1]!.split(",")) {
      const [imported, local = imported] = raw.trim().split(/\s+as\s+/u);
      const type = imported ? lookExports?.get(imported) : undefined;
      if (type) imports.set(local!, type);
    }
  }
  return compileCore(text, { analysis: { imports }, extensions: [velarCompilerExtension] });
}

function messages(source: string): readonly string[] {
  return compileWithLook(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The layout rule, written out once: body indented past the opener, closer at the opener's indentation. */
const CALL_POSITION = `def take(value: Look) -> Look:
    return value

export const a = take(look:
    color = "red"
)
`;

const ELEMENT_POSITION = `export const looks: List<Look> = [look:
    color = "red"
]
`;

const RECORD_POSITION = `export const rec = {
    main: look:
        color = "red"
}
`;

const KEYFRAMES_RECORD_POSITION = `export const frames = {
    main: keyframes:
        from:
            opacity = 0
        to:
            opacity = 1
}
`;

const NAMED_ARGUMENT_POSITION = `def take(value: number, style: Look) -> Look:
    return style

export const a = take(1, style=look:
    color = "red"
)
`;

test("[LK-I1] a look block opens in an argument position", () => {
  assert.deepEqual(messages(CALL_POSITION), []);
});

test("[LK-I1] a look block opens in a collection element", () => {
  assert.deepEqual(messages(ELEMENT_POSITION), []);
});

test("[LK-I1] a look block opens in a record value", () => {
  assert.deepEqual(messages(RECORD_POSITION), []);
});

test("[LK-I1] a keyframes block opens in a record value", () => {
  assert.deepEqual(messages(KEYFRAMES_RECORD_POSITION), []);
});

test("[LK-I1] a look block opens as a named argument's value", () => {
  assert.deepEqual(messages(NAMED_ARGUMENT_POSITION), []);
});

test("[LK-I1] the new positions reach the stylesheet and the Look values", () => {
  const compiled = compileWithLook(`def take(value: Look) -> Look:
    return value

const fromCall = take(look:
    color = "red"
)

const fromList: List<Look> = [look:
    color = "green"
]

const fromRecord = {main: look:
    color = "blue"
}

export component App():
    return <div>
        <p look={fromCall}>a</p>
        <p look={fromList[0]}>b</p>
        <p look={fromRecord.main}>c</p>
    </div>
`);
  assert.deepEqual(compiled.diagnostics, []);
  // The rule reaches the compiler-owned stylesheet, and each block's own value
  // reaches the emitted Look — so all three were read as Look values rather than
  // as something the emitter dropped.
  assert.match(compiled.css ?? "", /\[data-velar-look~="base:color"\]\{color:var\(--velar-look-base-color\)\}/u);
  const code = compiled.code ?? "";
  for (const colour of ["red", "green", "blue"]) {
    assert.match(code, new RegExp(`"base:color": "${colour}"`, "u"), `${colour} is not an emitted Look value`);
  }
});

test("[LK-I1] the `=` and `return` positions are unchanged", () => {
  assert.deepEqual(messages(`export const a = look:
    color = "red"

def make() -> Look:
    return look:
        color = "blue"
`), []);
});

test("[LK-I1] JSX keeps every position it already had", () => {
  assert.deepEqual(messages(`export component P():
    const nodes: List<WebNode> = [<p>a</p>, <b>c</b>]
    const rec = {main: <p>a</p>}
    return <div>{nodes}{rec.main}</div>
`), []);
  assert.deepEqual(messages(`def take(node: WebNode) -> WebNode:
    return node

export component P():
    return <div>{take(<p>a</p>)}</div>
`), []);
});

test("[LK-I1] a record key named look is still a record key", () => {
  // The position right after `{` or `,` inside a record is a key, and a key is
  // not a value position — including when its value is written on the next line.
  assert.deepEqual(messages("export const rec = {look: 1}\n"), []);
  assert.deepEqual(messages(`export const rec = {
    look:
        1
}
`), []);
  assert.deepEqual(messages(`export const rec = {
    look: 1,
    keyframes: 2
}
`), []);
});

test("[LK-I1] a named argument spelled with ':' is still corrected", () => {
  // Only an extension block directly after `name:` is a block; everything else
  // in that shape is the mistyped named argument VEL2024 has always named.
  assert.deepEqual(messages(`def take(value: number) -> number:
    return value

export const n = take(value: 1)
`), ["VEL2024 Write '=' between the name and value for named argument 'value': value = value"]);
});

test("[LK-I1] the closing bracket takes the first dedented position, and may share it", () => {
  // The block's body owns its lines to the end, exactly as a statement-level one
  // does, so the bracket closes on the first line at or below the opening line's
  // indentation — alone, or ahead of whatever else that position carries.
  assert.deepEqual(messages(`def take(a: Look, b: number) -> number:
    return b

export const n = take(look:
    color = "red"
, 2)
`), []);
  assert.deepEqual(messages(`export const rec = {
    main: look:
        color = "red"
    , other: 1
}
`), []);
  // And it is not written at the end of a body line: that text is a Look entry.
  assert.notDeepEqual(messages(`def take(value: Look) -> Look:
    return value

export const a = take(look:
    color = "red")
`), []);
});

test("[LK-I1] a look block written where a value may not begin reports once", () => {
  // An `if` condition is not a value position, so the lexer opens no block
  // there; the opener's own message names the whole spelling rather than four
  // structural failures in a row.
  assert.deepEqual(messages(`export component P():
    if look:
        color = "red"
    :
        return <p>a</p>
    return <p>b</p>
`), [
    "VEL5038 A Look value is written as 'look:' followed by an indented block of 'property = value' entries",
  ]);
});

test("[LK-I1] a look block with no body still reports once", () => {
  assert.deepEqual(messages(`export const a = look:
export const b = 1
`), ["VEL5038 A Look block requires at least one indented 'property = value' entry"]);
});

const fixedPoint = (source: string): void => {
  const once = formatSource(source, { extensions: [velarCompilerExtension] });
  assert.equal(once, source, "the written layout is already the canonical one");
  assert.equal(formatSource(once, { extensions: [velarCompilerExtension] }), once, "formatting is idempotent");
  assert.deepEqual(compileWithLook(once).diagnostics, [], "the formatted source still compiles");
};

test("[LK-I1] every new position is a velar format fixed point", () => {
  fixedPoint(ELEMENT_POSITION);
  fixedPoint(RECORD_POSITION);
  fixedPoint(KEYFRAMES_RECORD_POSITION);
  // The call positions carry a `def` the formatter inlines, so they are checked
  // from their own canonical form rather than from the shape written above.
  fixedPoint(`def take(value: Look) -> Look: return value

export const a = take(look:
    color = "red"
)
`);
  fixedPoint(`def take(value: number, style: Look) -> Look: return style

export const a = take(1, style=look:
    color = "red"
)
`);
});
