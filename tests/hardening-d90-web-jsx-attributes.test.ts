import assert from "node:assert/strict";
import test from "node:test";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import {
  WEB_ARIA_ATTRIBUTES,
  WEB_ARIA_ENUMERATED_VALUES,
  WEB_ARIA_ROLES,
  WEB_ARIA_ROLE_SYNONYMS,
} from "../packages/web/src/elements.ts";

/**
 * D90 (coherence-3): the README promises that DOM attributes and ARIA are
 * checked surfaces. Nothing checked them, so the single most likely wrong
 * spelling on the Web surface — the React `className=` — compiled clean and
 * emitted a dead attribute, while the sibling reflex `onClick=` on the same
 * element was already refused. The rule that closes it diagnoses names that are
 * KNOWN wrong and never names that are merely unknown, so the negatives below
 * carry as much weight as the positives: a false positive on a legitimate
 * attribute blocks a correct program, which is worse than the old silence.
 *
 * D61 bounds the value half — `false`/`null` remove an attribute, `true` writes
 * an empty presence value, and text is written literally. A14 shortens an
 * expanded bool-to-text conditional to `str(value)` without changing output.
 *
 * coherence-6c: the `velar/storage` guidance used to reach only browser tests.
 */
function reported(source: string, path?: string): string[] {
  const result = compile(source, { extensions: [webCompilerExtension], ...(path ? { path } : {}) });
  return result.diagnostics.map((item) => `${item.code} ${item.message}`);
}

function attributeMessages(source: string): string[] {
  return reported(source).filter((item) => item.startsWith("VEL5070"));
}

function element(attributes: string): string {
  return `component Panel():\n    return <div ${attributes}>hi</div>\n`;
}

function applyFixes(source: string, edits: readonly { readonly span: { readonly start: number; readonly end: number }; readonly text: string }[]): string {
  return [...edits]
    .sort((left, right) => right.span.start - left.span.start)
    .reduce((text, edit) => `${text.slice(0, edit.span.start)}${edit.text}${text.slice(edit.span.end)}`, source);
}

test("[A14] native text attributes replace a hand-written bool conversion with str()", () => {
  const source = [
    "component Panel(open: bool, inside: List<string>):",
    '    return <div data-processed-activity={str(inside.size)} aria-expanded={open ? "true" : "false"}></div>',
    "",
  ].join("\n");
  const result = compile(source, { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A14"]);
  assert.deepEqual(result.advisories.map((item) => item.fix?.edits[0]?.text), ["str(open)"]);

  const fixed = applyFixes(source, result.advisories.flatMap((item) => item.fix?.edits ?? []));
  assert.equal(fixed, [
    "component Panel(open: bool, inside: List<string>):",
    "    return <div data-processed-activity={str(inside.size)} aria-expanded={str(open)}></div>",
    "",
  ].join("\n"));
  const clean = compile(fixed, { extensions: [webCompilerExtension] });
  assert.deepEqual(clean.diagnostics, []);
  assert.deepEqual(clean.advisories, []);
});

test("[A14] comment-looking text inside the preserved condition does not withhold the fix", () => {
  const source = [
    "component Panel(url: string):",
    '    return <div data-match={url == "https://example.test/*" ? "true" : "false"}></div>',
    "",
  ].join("\n");
  const result = compile(source, { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A14"]);
  assert.deepEqual(result.advisories.map((item) => item.fix?.edits[0]?.text), ['str(url == "https://example.test/*")']);
});

test("[A14] component props, HTML bool-presence attributes, optional bools, and existing str() calls stay untouched", () => {
  const source = [
    "component Child(label: string):",
    "    return <span>{label}</span>",
    "",
    "component Panel(open: bool, optionalOpen: bool?, count: number, inside: List<string>):",
    '    return <div data-count={str(count)} disabled={open ? "true" : "false"}>',
    '        <section DISABLED={open ? "true" : "false"} headingreset={open ? "true" : "false"}>still presence-controlled</section>',
    '        <Child label={open ? "true" : "false"} />',
    '        <i data-optional={optionalOpen ? "true" : "false"}></i>',
    "        <i data-size={str(/* retain why */ inside.size)}></i>",
    "    </div>",
    "",
  ].join("\n");
  const result = compile(source, { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories, []);
});

test("[A14] a comment keeps the guidance but withholds the mechanical edit", () => {
  const source = [
    "component Panel(open: bool):",
    '    return <div aria-expanded={open ? /* explain the token */ "true" : "false"}></div>',
    "",
  ].join("\n");
  const result = compile(source, { extensions: [webCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.advisories.map((item) => item.code), ["A14"]);
  assert.equal(result.advisories[0]?.fix, undefined);
});

test("[A14] invalid elements and custom-element attributes stay outside the native rewrite", () => {
  const invalid = compile([
    "component Panel(open: bool):",
    '    return <dv data-open={open ? "true" : "false"}></dv>',
    "",
  ].join("\n"), { extensions: [webCompilerExtension] });
  assert.ok(invalid.diagnostics.some((item) => item.code === "VEL5061"));
  assert.deepEqual(invalid.advisories, []);

  const custom = compile([
    "component Panel(open: bool):",
    '    return <my-widget data-open={open ? "true" : "false"}></my-widget>',
    "",
  ].join("\n"), { extensions: [webCompilerExtension] });
  assert.deepEqual(custom.diagnostics, []);
  assert.deepEqual(custom.advisories, []);
});

test("[D90] the React attribute reflexes name the VelarScript spelling and rewrite to it", () => {
  for (const [wrong, right] of [
    ["className=\"panel\"", "class=\"panel\""],
    ["tabIndex=\"2\"", "tabindex=\"2\""],
    ["readOnly=\"readonly\"", "readonly=\"readonly\""],
    ["ariaLabel=\"Close\"", "aria-label=\"Close\""],
  ] as const) {
    const source = element(wrong);
    const messages = attributeMessages(source);
    assert.equal(messages.length, 1, `${wrong}: ${messages.join(" | ")}`);
    assert.ok(messages[0]!.includes(`'${right.split("=")[0]!}'`), messages[0]!);
    // The named successor is compiled here as well as quoted, so the message
    // can never drift onto a spelling that does not exist.
    assert.deepEqual(reported(element(right)), []);
    // One pass of `velar fix` converges on that same clean source.
    const fixed = applyMechanicalFixes(source, compile(source, { extensions: [webCompilerExtension] }).diagnostics);
    assert.equal(fixed.text, element(right));
    assert.deepEqual(reported(fixed.text), []);
  }
});

test("[D90] htmlFor names 'for', which compiles clean on the label it belongs to", () => {
  const source = "component Panel():\n    return <label htmlFor=\"name\">Name</label>\n";
  const messages = attributeMessages(source);
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.includes("write 'for'"), messages[0]!);
  const fixed = applyMechanicalFixes(source, compile(source, { extensions: [webCompilerExtension] }).diagnostics);
  assert.equal(fixed.text, "component Panel():\n    return <label for=\"name\">Name</label>\n");
  assert.deepEqual(reported(fixed.text), []);
});

test("[D90] a React spelling whose successor takes a different value earns the clause, not a silent rewrite", () => {
  for (const [wrong, clause] of [
    ["defaultValue=\"a\"", "bind:value={state}"],
    ["defaultChecked=\"true\"", "bind:checked={state}"],
    ["dangerouslySetInnerHTML=\"<b>x</b>\"", "unsafe:html"],
    ["classList=\"a b\"", "class:name={condition}"],
  ] as const) {
    const source = element(wrong);
    const messages = attributeMessages(source);
    assert.equal(messages.length, 1, `${wrong}: ${messages.join(" | ")}`);
    assert.ok(messages[0]!.includes(clause), messages[0]!);
    // No mechanical fix: renaming alone would leave a value the successor does
    // not take, so the author decides.
    const fixed = applyMechanicalFixes(source, compile(source, { extensions: [webCompilerExtension] }).diagnostics);
    assert.equal(fixed.text, source);
  }
});

test("[D90] a misspelled ARIA attribute is answered with the ARIA name it is one edit from", () => {
  const source = element("aria-hiddn=\"true\"");
  const messages = attributeMessages(source);
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.includes("did you mean 'aria-hidden'?"), messages[0]!);
  const fixed = applyMechanicalFixes(source, compile(source, { extensions: [webCompilerExtension] }).diagnostics);
  assert.equal(fixed.text, element("aria-hidden=\"true\""));
  assert.deepEqual(reported(fixed.text), []);
});

test("[D90] an aria-* name outside the closed ARIA roster is refused even with no near spelling", () => {
  const messages = attributeMessages(element("aria-sparkle=\"true\""));
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(messages[0]!.includes("Unknown ARIA attribute 'aria-sparkle'"), messages[0]!);
  assert.ok(messages[0]!.includes("data-*"), messages[0]!);
});

test("[D90] an out-of-vocabulary ARIA token and role are named against their closed sets", () => {
  const hidden = attributeMessages(element("aria-hidden=\"maybe\""));
  assert.equal(hidden.length, 1, hidden.join(" | "));
  assert.ok(hidden[0]!.includes("takes one of true, false, undefined"), hidden[0]!);
  assert.ok(hidden[0]!.includes("'maybe'"), hidden[0]!);

  const role = attributeMessages(element("role=\"buton\""));
  assert.equal(role.length, 1, role.join(" | "));
  assert.ok(role[0]!.includes("did you mean 'button'?"), role[0]!);

  const live = attributeMessages(element("aria-live=\"loud\""));
  assert.equal(live.length, 1, live.join(" | "));
  assert.ok(live[0]!.includes("off, polite, assertive"), live[0]!);
});

test("[D90] ARIA accepts explicit text and dynamic presence expressions", () => {
  assert.deepEqual(reported("component Panel(pending: bool):\n    return <div aria-hidden={true} aria-busy={pending} aria-pressed={pending}>hi</div>\n"), []);
  assert.deepEqual(reported("component Panel(state: string):\n    return <div aria-live={state} role={state}>hi</div>\n"), []);
});

test("[D90] the check never fires on a name that is merely unknown", () => {
  for (const source of [
    element("data-x=\"1\" data-aria-button=\"1\""),
    element("foo=\"bar\" hx-get=\"/rows\""),
    "component Panel():\n    return <my-thing whatever=\"1\" className=\"panel\">hi</my-thing>\n",
    "component Panel():\n    return <svg viewBox=\"0 0 1 1\" preserveAspectRatio=\"xMidYMid\" aria-label=\"Chart\">\n        <path stroke-width=\"2\" pathLength=\"1\" />\n        <linearGradient gradientUnits=\"userSpaceOnUse\" spreadMethod=\"pad\" />\n    </svg>\n",
    "component Panel():\n    return <label for=\"name\" class=\"field\" tabindex=\"2\">Name</label>\n",
    element("role=\"alert\""),
    element("role=\"progressbar\" aria-valuenow=\"3\" aria-valuemin=\"0\" aria-valuemax=\"9\""),
    element("aria-current=\"page\" aria-invalid=\"spelling\" aria-sort=\"ascending\""),
  ]) {
    assert.deepEqual(reported(source), [], source);
  }
});

/**
 * The same shape one step sideways: `bind:` and `unsafe:` are closed
 * VelarScript vocabularies, so a suffix outside them named no binding and no
 * escape hatch and was emitted verbatim as a dead attribute. `class:` stays
 * open on purpose — its suffix is an author's own class name — and `look:` /
 * `style:` were already answered by VEL5038.
 */
test("[D90] a bind: or unsafe: suffix outside its closed family is refused, not emitted", () => {
  const unknown = reported("component Panel():\n    let text = \"\"\n    return <input bind:foo={text} />\n")
    .filter((item) => item.startsWith("VEL5019"));
  assert.equal(unknown.length, 1, unknown.join(" | "));
  assert.ok(unknown[0]!.includes("bind:value"), unknown[0]!);

  const near = reported("component Panel():\n    let text = \"\"\n    return <input bind:valu={text} />\n")
    .filter((item) => item.startsWith("VEL5019"));
  assert.equal(near.length, 1, near.join(" | "));
  assert.ok(near[0]!.includes("did you mean 'bind:value'?"), near[0]!);

  const bare = reported("component Panel():\n    let text = \"\"\n    return <input bind={text} />\n")
    .filter((item) => item.startsWith("VEL5019"));
  assert.equal(bare.length, 1, bare.join(" | "));
  assert.ok(bare[0]!.includes("Use 'bind:value={name}'"), bare[0]!);

  const hatch = reported(element("unsafe:script=\"alert(1)\"")).filter((item) => item.startsWith("VEL5015"));
  assert.equal(hatch.length, 1, hatch.join(" | "));
  assert.ok(hatch[0]!.includes("'unsafe:html'"), hatch[0]!);

  // The members of both families keep compiling, and an author's own class name
  // stays open.
  assert.deepEqual(reported("component Panel(markup: string, ready: bool):\n    return <div unsafe:html={markup} class:ready={ready}></div>\n"), []);
  assert.deepEqual(reported("component Panel():\n    state text = \"\"\n    state agreed = false\n    return <div>\n        <input bind:value={text} />\n        <input type=\"checkbox\" bind:checked={agreed} />\n    </div>\n"), []);
});

test("[D90] the on* prefix keeps owning every handler spelling, unshared with the name check", () => {
  const clicks = reported("component Panel(bump: () -> null):\n    return <div onClick={bump} role=\"button\">hi</div>\n");
  assert.equal(clicks.length, 1, clicks.join(" | "));
  assert.ok(clicks[0]!.startsWith("VEL5025"), clicks[0]!);
});

test("[D90] velar/storage is named in an ordinary module, and the browser test keeps its own answer", () => {
  const ordinary = reported("def read() -> string:\n    return str(localStorage)\n", "src/main.vel");
  const guidance = ordinary.find((item) => item.startsWith("VEL3008"));
  assert.ok(guidance, ordinary.join(" | "));
  assert.ok(guidance.includes('import {storage} from "velar/storage"'), guidance);
  assert.ok(ordinary.every((item) => !item.startsWith("VEL3001")), ordinary.join(" | "));

  const sessionGuidance = reported("def read() -> string:\n    return str(sessionStorage)\n", "src/main.vel")
    .find((item) => item.startsWith("VEL3008"));
  assert.ok(sessionGuidance, "sessionStorage earned no guidance");
  assert.ok(sessionGuidance.includes('import {session} from "velar/storage"'), sessionGuidance);

  const browserTest = reported("def read() -> string:\n    return str(localStorage)\n", "src/main.browser.test.vel")
    .find((item) => item.startsWith("VEL3008"));
  assert.ok(browserTest, "browser test earned no guidance");
  assert.ok(browserTest.includes("velar/web-test"), browserTest);
});

/**
 * The rule's own false-positive class, caught in review. `WEB_ARIA_ROLES` held
 * the core roster only, so every name from ARIA's published role modules — the
 * DPUB document roles and the Graphics roles — became a hard compile error, and
 * the message also called a standardized name unknown. Blocking a correct
 * program is the one outcome a KNOWN-WRONG rule must never have, and
 * `<svg role="graphics-symbol">` is the documented accessible-chart spelling.
 */
test("[D90] ARIA's published role modules are role names, not unknown ones", () => {
  for (const role of [
    "doc-abstract", "doc-chapter", "doc-biblioentry", "doc-endnote", "doc-toc", "doc-pagebreak", "doc-cover",
    "doc-glossref", "doc-noteref", "doc-pagelist", "doc-qna", "doc-subtitle",
    "graphics-document", "graphics-object", "graphics-symbol",
  ]) {
    assert.deepEqual(attributeMessages(element(`role="${role}"`)), [], role);
  }
  assert.deepEqual(
    attributeMessages("component Panel():\n    return <svg role=\"graphics-symbol\" aria-label=\"Chart\">\n        <path d=\"M0 0\" />\n    </svg>\n"),
    [],
  );
  // The module names join the same nearest-name answer as the core roster
  // rather than sitting in an unchecked escape hatch.
  const near = attributeMessages(element("role=\"doc-chapte\""));
  assert.equal(near.length, 1, near.join(" | "));
  assert.ok(near[0]!.includes("did you mean 'doc-chapter'?"), near[0]!);
});

test("[D90] a role with two published spellings is answered as a synonym, never as unknown", () => {
  const messages = attributeMessages(element("role=\"image\""));
  assert.equal(messages.length, 1, messages.join(" | "));
  assert.ok(!messages[0]!.includes("Unknown"), messages[0]!);
  assert.ok(messages[0]!.includes("VelarScript writes 'img'"), messages[0]!);
  assert.deepEqual(attributeMessages(element("role=\"img\"")), []);
});

test("[D90] an empty literal is the attribute's own default, not an out-of-vocabulary token", () => {
  for (const attributes of ["aria-hidden=\"\"", "aria-checked=\"\"", "aria-live=\"\"", "role=\"\""]) {
    assert.deepEqual(attributeMessages(element(attributes)), [], attributes);
  }
});

/**
 * `analyzeNativeJsxAttribute` runs for a custom element too — `bind:` and
 * `unsafe:` were refused on `<my-thing>` before this rule existed and still
 * are — so a message that called it "a native element" described the wrong
 * kind of element. The behaviour is unchanged; only the noun was wrong.
 */
test("[D90] the closed-family messages name the element kind the author actually wrote", () => {
  for (const [source, code] of [
    ["component Panel():\n    let v = \"\"\n    return <my-thing bind:foo={v}></my-thing>\n", "VEL5019"],
    ["component Panel():\n    return <my-thing unsafe:script=\"x\"></my-thing>\n", "VEL5015"],
    ["component Panel():\n    return <my-thing onward=\"x\"></my-thing>\n", "VEL5025"],
  ] as const) {
    const messages = reported(source).filter((item) => item.startsWith(code));
    assert.equal(messages.length, 1, messages.join(" | "));
    assert.ok(!messages[0]!.includes("native element"), messages[0]!);
  }
});

/**
 * A roster the compiler refuses to compile against itself would make every
 * message a lie, so the whole ARIA surface is driven through the compiler here
 * rather than trusted as a literal.
 */
test("[D90] every name in the ARIA rosters compiles clean on the element that carries it", () => {
  for (const role of WEB_ARIA_ROLES) {
    assert.deepEqual(attributeMessages(element(`role="${role}"`)), [], role);
  }
  for (const name of WEB_ARIA_ATTRIBUTES) {
    const vocabulary = WEB_ARIA_ENUMERATED_VALUES.get(name);
    const value = vocabulary ? [...vocabulary][0]! : "x";
    assert.deepEqual(attributeMessages(element(`${name}="${value}"`)), [], name);
  }
  for (const [, successor] of WEB_ARIA_ROLE_SYNONYMS) {
    assert.deepEqual(attributeMessages(element(`role="${successor}"`)), [], successor);
  }
});
