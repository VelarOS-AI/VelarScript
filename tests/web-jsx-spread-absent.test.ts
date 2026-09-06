import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// D114 P6 item 1 (0.29.0 Web ledger JX-I3): JSX attribute spread is absent by
// design, and the refusal now says so.
//
// `<p {...props}>` used to draw two `VEL5002: Expected a JSX attribute` — one
// where the brace opened and one where it closed — and neither named the
// spread, so the author was told a spelling was missing rather than that this
// one does not exist. Charter section 19 named "magical JSX control-flow
// attributes" among the deliberately absent features and did not name this,
// which left the reader with neither the rule nor the remedy.
//
// The rule is the reason: a component's props are named by its contract, and a
// spread hides which of them an element sets. The remedy is to write them out.
// Look's `...spread` is a different `...`: a look block composes declarations,
// and that spelling is part of the language (section 17), so it stays legal.

function diagnostics(source: string): readonly string[] {
  return compileCore(source, { extensions: [velarCompilerExtension] }).diagnostics
    .map((item) => `${item.code} ${item.message}`);
}

test("[JX-I3] attribute spread earns one report that names the spread and the remedy", () => {
  assert.deepEqual(diagnostics(`type Props:
    title: string

export component Page():
    const props: Props = {title: "a"}
    return <p {...props}>x</p>
`), [
    "VEL5002 JSX has no attribute spread; a component's props are named by its contract, so write the attributes out",
  ]);
});

test("[JX-I3] a spread onto a component element is refused the same way", () => {
  assert.deepEqual(diagnostics(`component Card(title: string):
    return <p>{title}</p>

export component Page():
    const props = {title: "a"}
    return <Card {...props} />
`), [
    "VEL5002 JSX has no attribute spread; a component's props are named by its contract, so write the attributes out",
  ]);
});

test("[JX-I3] the attributes written out are the spelling that compiles", () => {
  assert.deepEqual(diagnostics(`component Card(title: string):
    return <p>{title}</p>

export component Page():
    return <Card title="a" />
`), []);
});

test("[JX-I3] a look block's '...spread' is a different '...' and stays legal", () => {
  assert.deepEqual(diagnostics(`export const base = look:
    color = "#fff"

export const wide = look:
    ...base
    fontSize = 20px
`), []);
});

test("[JX-I3] a braced region that is not a spread keeps the message it had, still once", () => {
  assert.deepEqual(diagnostics(`export component Page():
    const title = "a"
    return <p {title}>x</p>
`), ["VEL5002 Expected a JSX attribute"]);
});
