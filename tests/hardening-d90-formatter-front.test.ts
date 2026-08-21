import assert from "node:assert/strict";
import test from "node:test";
import { compile, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// ---------------------------------------------------------------------------
// D90 audit, formatter fidelity. Four defects, all of them the same promise
// broken from a different side: charter line 422 says a text has exactly one
// formatted spelling, and charter lines 381-384 say a layout string's content
// is preserved exactly. Formatting a module must therefore never change what
// it means, and must reach that spelling on the first pass.
//
//   compiler-front-6  a void element whose open tag the formatter itself broke
//                     across lines was read back as ordinary statements, so the
//                     second pass produced `type = "text"` and `/ >`.
//   compiler-front-12 a non-void element written self-closing across lines
//                     opened a depth it never gave back, so every statement
//                     after it was copied verbatim and `--check` passed on an
//                     unformatted file.
//   compiler-front-13 an unterminated block comment or layout string gained one
//                     newline per run, so formatting never reached a fixed
//                     point at all.
//   compiler-front-17 a layout-string line carrying the margin plus payload
//                     spaces lost the payload, changing the constant the module
//                     compiles to.
//
// The tests named `[D90 audit]` are not wave findings. They pin the machinery
// those fixes introduced — the tag scan that spans a wrapped open tag, and the
// settled placeholder marker restore reads back — where it is substantial new
// code that the findings' own fixtures happen not to reach.
// ---------------------------------------------------------------------------

type Format = (source: string) => string;

const core: Format = (source) => formatSource(source);
const web: Format = (source) => formatSource(source, { extensions: [velarCompilerExtension] });

/**
 * Formatting is idempotent (charter line 422), so the settled spelling is
 * reached on the first pass and every later pass is a no-op. Every fixture in
 * this file goes through here — the two markup defects were both found as a
 * second pass that disagreed with the first.
 */
function settled(format: Format, source: string): string {
  const once = format(source);
  const twice = format(once);
  assert.equal(twice, once, `formatting is not idempotent:\n${JSON.stringify(source)}`);
  assert.equal(format(twice), once, `formatting is not idempotent:\n${JSON.stringify(source)}`);
  return once;
}

function webDiagnostics(source: string): readonly string[] {
  return compile(source, { extensions: [velarCompilerExtension] }).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function coreDiagnostics(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

test("[D90 compiler-front-6] a top-level void element survives its own broken open tag", () => {
  const source = "export component A:\n"
    + '    return <input type="text" name="aaaaaaaaaaaaaaaaaaaaa" value="bbbbbbbbbbbbbbbbbbbbbb" placeholder="ccccccccccccccccccc" />\n';
  assert.deepEqual(webDiagnostics(source), []);

  // The open tag alone overflows, so it takes a line per attribute — and the
  // lines it produced are read back as the tag they are, not as statements.
  const formatted = settled(web, source);
  assert.equal(formatted, [
    "export component A:",
    "    return <input",
    '        type="text"',
    '        name="aaaaaaaaaaaaaaaaaaaaa"',
    '        value="bbbbbbbbbbbbbbbbbbbbbb"',
    '        placeholder="ccccccccccccccccccc"',
    "    />",
    "",
  ].join("\n"));

  // Three passes, each one compiling: the corrupted form used to arrive on the
  // second pass and then stand still, so a single round-trip could not see it.
  let current = source;
  for (let pass = 0; pass < 3; pass += 1) {
    current = web(current);
    assert.deepEqual(webDiagnostics(current), [], `pass ${pass + 1}:\n${current}`);
  }
  assert.equal(current, formatted);

  // The same element nested one level keeps the shape D39 §54 asserts, which is
  // where the defect had been hiding: the enclosing element already held the
  // depth the top-level case never opened.
  assert.equal(settled(web, "component Probe:\n    return <section>\n"
    + '        <input look={eventInputLook} data-event-input aria-label="Native event probe" on:keydown={captureKey} on:beforeinput={captureInput} />\n'
    + "    </section>\n"), [
    "component Probe:",
    "    return <section>",
    "        <input",
    "            look={eventInputLook}",
    "            data-event-input",
    '            aria-label="Native event probe"',
    "            on:keydown={captureKey}",
    "            on:beforeinput={captureInput}",
    "        />",
    "    </section>",
    "",
  ].join("\n"));
});

test("[D90 compiler-front-12] a hand-wrapped self-closing element hands its depth back", () => {
  const tail = "\ndef other(a: number,b: number) -> number:\n    let  q   =   a+b\n    return q\n";
  const wrapped = "component Card(title: string):\n    return <b>{title}</b>\n\n"
    + "export component A:\n    return <div>\n        <Card\n            title=\"a\"\n        />\n    </div>\n"
    + tail;
  const collapsed = "component Card(title: string):\n    return <b>{title}</b>\n\n"
    + 'export component A:\n    return <div>\n        <Card title="a" />\n    </div>\n'
    + tail;

  const canonicalTail = "\ndef other(a: number, b: number) -> number:\n    let q = a + b\n    return q\n";
  const wrappedFormatted = settled(web, wrapped);
  const collapsedFormatted = settled(web, collapsed);

  // The author's line structure inside the element is kept (D39 §54), and the
  // module after it is formatted exactly as the collapsed spelling's is.
  assert.match(wrappedFormatted, /<Card\n {12}title="a"\n {8}\/>/u, wrappedFormatted);
  assert.ok(wrappedFormatted.endsWith(canonicalTail), wrappedFormatted);
  assert.ok(collapsedFormatted.endsWith(canonicalTail), collapsedFormatted);
  assert.equal(wrappedFormatted.slice(wrappedFormatted.indexOf("\ndef other")), collapsedFormatted.slice(collapsedFormatted.indexOf("\ndef other")));
  assert.deepEqual(webDiagnostics(wrappedFormatted), []);

  // A non-void element whose `>` — not `/>` — lands on a later line does open a
  // level, so its children stay children and its close still ends it.
  const opened = settled(web, "export component B:\n    return <div\n        class=\"shell\"\n    >\n        <span>{title}</span>\n    </div>\n"
    + tail);
  assert.ok(opened.endsWith(canonicalTail), opened);
});

test("[D90 compiler-front-6] a wrapped open tag reads its own quotes, holes and slashes", () => {
  // Whether a child level opened is answered by finding the tag's terminator,
  // so the scan that crosses the wrapped lines has to read an attribute value
  // the way the tag does: a `>`, a whole tag-shaped fragment or a `/>` inside a
  // quoted value is text, a `>` inside a `{...}` hole is an operator, and a `/`
  // in either place is not the tag's own slash. Read any of those wrongly and
  // the depth is off by one for the rest of the file, which is exactly how
  // compiler-front-12 stopped formatting the module below the element.
  const tail = "\ndef other(a: number,b: number) -> number:\n    let  q   =   a+b\n    return q\n";
  const canonicalTail = "\ndef other(a: number, b: number) -> number:\n    let q = a + b\n    return q\n";
  const elements = [
    '<a\n            href="a>b"\n        >\n            hello  world\n        </a>',
    '<a\n            href="a><b"\n        >\n            hello  world\n        </a>',
    '<a\n            href="a/>b"\n        >\n            hello  world\n        </a>',
    '<Row\n            flag={a > b}\n        />',
    '<Row\n            flag={f"{1}/{2}" == "1/2"}\n        />',
  ];
  for (const element of elements) {
    const declaration = element.includes("<Row") ? "component Row(flag: bool):\n    return <i>{str(flag)}</i>\n\n" : "";
    const source = `${declaration}const a = 1\nconst b = 2\n\nexport component A:\n    return <div>\n        ${element}\n    </div>\n${tail}`;
    assert.deepEqual(webDiagnostics(source), [], element);

    const formatted = settled(web, source);
    // The element keeps the line structure and the text the author gave it
    // (D39 §54) — `hello  world` is markup text, not two operands...
    assert.ok(formatted.includes(`        ${element}\n`), formatted);
    // ...and the depth it opened is handed back, so the module after it is
    // canonicalized rather than copied verbatim.
    assert.ok(formatted.endsWith(canonicalTail), formatted);
    assert.deepEqual(webDiagnostics(formatted), [], formatted);
  }
});

test("[D90 compiler-front-13] an unterminated comment or string does not grow the module", () => {
  const unterminated = [
    "let a = 1\n\n/*\n",
    'let a = "\n    x\n',
    'let a = "unterminated inline\n',
    'let a = f"unterminated {value}\n',
    "let a = 1\r\n\r\n/*\r\n",
    'let a = 1\n\n/*\n    still open',
  ];
  for (const source of unterminated) {
    const once = settled(core, source);
    // The one terminating newline is the only thing formatting may add here:
    // each run used to append another, so the file grew forever and
    // `format --check` could never go green.
    assert.equal(core(once).length, once.length, JSON.stringify(once));
    assert.ok(once.endsWith("\n") || once.endsWith("\r"), JSON.stringify(once));
  }

  // The well-formed control is stable, and still gains its terminator when the
  // author left it off.
  assert.equal(settled(core, "let a = 1\n"), "let a = 1\n");
  assert.equal(settled(core, "let a = 1"), "let a = 1\n");
  assert.equal(settled(core, "let a = 1\n\n\n"), "let a = 1\n");
  assert.equal(settled(core, "/*\n    closed\n*/\nlet a = 1\n"), "/*\n    closed\n*/\nlet a = 1\n");
});

test("[D90 compiler-front-13] a CRLF module, and one ending in a lone CR, settle at one length", () => {
  // The terminator is settled on the restored text and accepts a trailing `\n`
  // *or* `\r`. A module whose last line ending is a lone `\r` — the ending the
  // line split normalizes away, so only the placeholder still carries it — is
  // the case the `\r` half answers: asking about `\n` alone appends a second
  // terminator that the author never wrote.
  for (const source of ["let a = 1\r\n\r\n/*\r\n", 'let a = "\r\n    x\r\n', "let a = 1\r\n"]) {
    const once = settled(core, source);
    let current = once;
    for (let pass = 0; pass < 5; pass += 1) {
      current = core(current);
      assert.equal(current.length, once.length, `pass ${pass + 1} of ${JSON.stringify(source)}: ${JSON.stringify(current)}`);
    }
    assert.equal(current, once, JSON.stringify(source));
  }
  assert.equal(settled(core, "let a = 1\r\n\r\n/*\r"), "let a = 1\n\n/*\r");
  assert.equal(settled(core, 'let a = "\r    x\r'), 'let a = "\r    x\r');
});

test("[D90 compiler-front-17] a layout string keeps the whitespace that is its value", () => {
  // Line 3 carries the four-space margin plus two spaces of payload, so the
  // constant holds those two spaces (charter lines 381-384).
  const payload = 'export const s = "\n    a\n      \n    b\n"\n';
  assert.deepEqual(coreDiagnostics(payload), []);
  const before = compile(payload).code;
  assert.equal(before, 'export const s = "a\\n  \\nb";\n');
  const formattedPayload = settled(core, payload);
  assert.deepEqual(coreDiagnostics(formattedPayload), []);
  assert.equal(compile(formattedPayload).code, before);

  // W-28 stands: a line whose whole indentation is the margin carries no value,
  // so it is still emptied rather than re-margined into trailing whitespace.
  const marginExact = 'if true:\n  const text="\n      first\n      \n      second\n  "\n  print(text)\n';
  const formattedMargin = settled(core, marginExact);
  assert.equal(formattedMargin, 'if true:\n    const text = "\n        first\n\n        second\n    "\n    print(text)\n');
  assert.doesNotMatch(formattedMargin, /[ \t]+$/mu);
  assert.equal(compile(formattedMargin).code, compile(marginExact).code);

  // A line shorter than the margin carries no value either.
  const shortBlank = 'export const s = "\n    a\n  \n    b\n"\n';
  assert.equal(compile(settled(core, shortBlank)).code, compile(shortBlank).code);

  // The formatter may not delete the content that makes a program illegal: the
  // tab this literal holds is rejected before and after.
  const tabbed = 'export const s = "\n    a\n    \t\n    b\n"\n';
  assert.deepEqual(coreDiagnostics(tabbed).map((item) => item.split(" ")[0]), ["VEL1009"]);
  assert.deepEqual(coreDiagnostics(settled(core, tabbed)).map((item) => item.split(" ")[0]), ["VEL1009"]);
});

test("[D90 compiler-front-15] a call's type argument list keeps its spelling through the formatter", () => {
  // VelarScript infers type arguments, so `Map<string, number>()` is always an
  // error — and `velar format` was rewriting it to `Map < string, number > ()`,
  // a spelling that appears nowhere in the author's file, in exactly the moment
  // the teaching diagnostic is on screen. The formatter reads the same evidence
  // the parser reads instead.
  const kept = [
    "const m = Map<string, number>()\n",
    'const x = id<string>("a")\n',
    "const s = Set<string>()\n",
    "const v = mapValues<string, bool>([1])\n",
  ];
  for (const source of kept) assert.equal(settled(core, source), source);

  // The diagnostic is the same before and after formatting — the parser does
  // not read the spacing, so this holds whichever spelling reaches it.
  const empty = "const m = Map<string, number>()\n";
  assert.deepEqual(coreDiagnostics(settled(core, empty)), coreDiagnostics(empty));
  assert.match(coreDiagnostics(empty)[0] ?? "", /an empty 'Map\(\)' takes its type from the binding/u);

  // A comparison pair that only looks like a type argument list keeps its
  // operator spacing, and keeps compiling to the program it was.
  const comparison = [
    "def two(p: bool, q: bool) -> bool:",
    "    return p and q",
    "",
    "const Limit = 5",
    "const a = 1",
    "const g = 2",
    "const c = 3",
    "const near = two(a < Limit, g > (c))",
    "print(str(near))",
    "",
  ].join("\n");
  assert.equal(settled(core, comparison), comparison);
  assert.deepEqual(coreDiagnostics(comparison), []);

  // And an ordinary comparison chain is still spaced as operators.
  assert.equal(settled(core, "const r = a<b>(cc)\n"), "const r = a < b > (cc)\n");
});

test("[D90 audit] protecting multi-line strings scales with the module, not with its square", () => {
  // Not a wave finding: the triage named the formatter's placeholder mechanism.
  // It settled a fresh marker and restored each placeholder by rescanning the
  // whole module, so a module of k multi-line strings cost O(k x module) — 8000
  // of them took 1.15 s where the same bytes of ordinary code took 35 ms. The
  // ratio is the assertion because it calibrates itself to the machine.
  const protectedModule = (count: number): string =>
    `${Array.from({ length: count }, (_, index) => `const s${index} = "\n    line ${index}\n"`).join("\n")}\n`;
  const plainModule = (count: number): string =>
    `${Array.from({ length: count }, (_, index) => `const s${index} = "line ${index}"\nconst t${index} = ${index}\nconst u${index} = ${index}\n`).join("")}\n`;

  const measure = (source: string): number => {
    formatSource(source);
    const started = performance.now();
    formatSource(source);
    return performance.now() - started;
  };

  const count = 8000;
  const protectedCost = measure(protectedModule(count));
  const plainCost = measure(plainModule(count));
  assert.ok(protectedCost < plainCost * 10, `${count} multi-line strings cost ${protectedCost.toFixed(1)}ms against ${plainCost.toFixed(1)}ms of plain source`);

  // And the protection still round-trips: the placeholders are unique by
  // construction, so nothing collides and nothing is left behind.
  const sample = protectedModule(64);
  assert.equal(settled(core, sample), sample);
  assert.doesNotMatch(settled(core, sample), /__velar_formatter_/u);
});

test("[D90 audit] a module that spells the formatter's own placeholder keeps its text", () => {
  // The marker is settled once against the whole module, carrying the smallest
  // serial the module does not already write after it, so a module that spells
  // the marker itself — three of them here, each one the previous marker's
  // escape — cannot collide with a placeholder. Restore then matches the
  // settled marker and leaves the author's text where it stands.
  const source = 'const a = "__velar_formatter_multiline_string_0__"\n'
    + 'const b = "__velar_formatter__multiline_string_0__"\n'
    + 'const c = "__velar_formatter___multiline_string_0__"\n'
    + 'const layout = "\n    body\n"\n'
    + "/*\n    note\n*/\nprint(a + b + c + layout)\n";
  assert.deepEqual(coreDiagnostics(source), []);
  const before = compile(source).code;

  const formatted = settled(core, source);
  for (const marker of ["__velar_formatter_", "__velar_formatter__", "__velar_formatter___"]) {
    assert.equal(formatted.split(`"${marker}multiline_string_0__"`).length - 1, 1, formatted);
  }
  assert.deepEqual(coreDiagnostics(formatted), []);
  assert.equal(compile(formatted).code, before);

  // A module that writes serials after the marker is answered by the first
  // serial it leaves free, and its own text still comes back untouched.
  const written = 'const a = "__velar_formatter_0_multiline_string_0__"\n'
    + 'const b = "__velar_formatter_1_multiline_string_0__"\n'
    + 'const layout = "\n    body\n"\nprint(a + b + layout)\n';
  const settledWritten = settled(core, written);
  assert.ok(settledWritten.includes('"__velar_formatter_0_multiline_string_0__"'), settledWritten);
  assert.ok(settledWritten.includes('"__velar_formatter_1_multiline_string_0__"'), settledWritten);
  assert.deepEqual(coreDiagnostics(settledWritten), []);
  assert.equal(compile(settledWritten).code, compile(written).code);
});

test("[D90 audit] the settled marker does not grow with the module's own text", () => {
  // Not a wave finding: the marker used to gain one character per collision,
  // so a module spelling the marker followed by a long run of underscores grew
  // it without bound — past roughly 33000 the placeholder pattern outgrew the
  // regular-expression engine and `velar format` threw a SyntaxError instead of
  // formatting. The serial the marker carries now is bounded by the number of
  // serials the module writes, so the run is just text.
  const run = (length: number): string =>
    `const a = "__velar_formatter_${"_".repeat(length)}"\nconst layout = "\n    body\n"\nprint(a + layout)\n`;
  for (const length of [3, 33000, 60000]) {
    const source = run(length);
    const formatted = settled(core, source);
    assert.ok(formatted.includes(`"__velar_formatter_${"_".repeat(length)}"`), `run of ${length} underscores`);
    assert.deepEqual(coreDiagnostics(formatted), []);
    assert.equal(compile(formatted).code, compile(source).code);
  }
});

test("[D90 audit] an embedded block stays attached to its header whatever marker settles", () => {
  // Not a wave finding: the placeholder standing in for an embedded block is
  // attached to the word before it, and that attachment was recognised by the
  // marker spelled out in full. Any module that made the marker settle on
  // something else lost the attachment and the header came back as
  // `unsafe js \``, with the space that stops it being an embedded block.
  const block = ["unsafe js`", "    export const one = 1", "`", "print(1)", ""].join("\n");
  assert.deepEqual(coreDiagnostics(block), []);
  assert.equal(settled(core, block), block);

  const named = `const marker = "__velar_formatter_multiline_string_0__"\n${block}`;
  assert.deepEqual(coreDiagnostics(named), []);
  assert.equal(settled(core, named), named);
});

test("[D90 audit] a placeholder reads the indent of the line it landed on", () => {
  // Restore carries the text after its last line break forward as it appends,
  // and that carried tail is where a placeholder first on its line reads the
  // indent it re-margins a layout string or a block comment against.
  const layout = 'if true:\n  print(\n    "\n      payload\n    "\n  )\n';
  assert.equal(settled(core, layout), 'if true:\n    print(\n        "\n          payload\n        "\n    )\n');
  assert.equal(compile(settled(core, layout)).code, compile(layout).code);

  const comment = "if true:\n  /*\n  note\n  */\n  print(1)\n";
  assert.equal(settled(core, comment), "if true:\n    /*\n    note\n    */\n    print(1)\n");
  assert.equal(compile(settled(core, comment)).code, compile(comment).code);

  // And a second placeholder on a line an earlier one already wrote reads the
  // tail that one left behind, not the indent the line began with.
  const pair = 'const pair = ["\n    a\n", "\n    b\n"]\nprint(pair)\n';
  assert.equal(settled(core, pair), pair);
  assert.equal(compile(settled(core, pair)).code, compile(pair).code);
});
