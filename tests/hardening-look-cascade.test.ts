import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { compileProject as compileProjectCore } from "../packages/cli/src/project.ts";
import { projectStyles } from "../packages/cli/src/framework-host.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

// Wave "look-cascade" of the Web audit: ruling R3 — Look precedence becomes
// fixed and explicit. The winner between two Look declarations is decided by
// the conditions they name and by composition order, never by the byte order
// of the stylesheet, which the CLI builds by sorting module paths with the
// build machine's locale collation.

const webCompilerExtensions = Object.freeze([velarCompilerExtension]);
const compileWeb = (source: string) => compileCore(source, { extensions: webCompilerExtensions });
const compileProject = (entry: string) => compileProjectCore(entry, new Map(), { extensions: webCompilerExtensions });

/**
 * A DOM small enough to read and complete enough to answer the questions a
 * cascade ruling asks: which tokens an element ends up carrying, which custom
 * properties stand behind them, and how many writes it took to get there.
 */
const FAKE_DOM = `
let writes = 0;
class FakeNode {
  constructor(nodeType = 1, value = "") {
    this.nodeType = nodeType;
    this.value = value;
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    const properties = new Map();
    this.style = {
      properties,
      setProperty: (name, next) => { writes += 1; properties.set(name, String(next)); },
      removeProperty: (name) => { writes += 1; properties.delete(name); },
    };
  }
  append(...values) { this.childNodes.push(...values); }
  remove() {}
  setAttribute(name, value) { writes += 1; this.attributes.set(name, String(value)); }
  removeAttribute(name) { writes += 1; this.attributes.delete(name); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  fire(type) {
    const handler = this.listeners.get(type);
    if (handler) handler.call(this, { type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} });
  }
}
globalThis.domWrites = () => writes;
globalThis.resetWrites = () => { writes = 0; };
globalThis.Node = FakeNode;
globalThis.CharacterData = FakeNode;
// A text node's character data is now written in place, so the stand-in models
// the accessor the DOM writes it through instead of only its creation.
Object.defineProperty(FakeNode.prototype, "data", { configurable: true,
  get() { return this.textContent !== undefined ? this.textContent : this.value; },
  set(next) { if (this.textContent !== undefined) this.textContent = next; else this.value = next; } });
globalThis.document = {
  createElement() { return new FakeNode(); },
  createTextNode(value) { return new FakeNode(3, String(value)); },
  createComment(value) { return new FakeNode(8, String(value)); },
  createDocumentFragment() { return new FakeNode(11); },
};
`;

function runWeb(source: string, probe: string): { stdout: string; stderr: string; status: number | null } {
  const result = compileWeb(source);
  assert.deepEqual(result.diagnostics, []);
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${FAKE_DOM}\n${result.code ?? ""}\n${probe}`,
  });
  return { stdout: execution.stdout, stderr: execution.stderr, status: execution.status };
}

/** How many `[data-velar-look]` selectors the rule for `token` carries. */
function lookDepth(css: string, token: string): number {
  const match = new RegExp(`\\[data-velar-look~="${token.replace(/[+]/gu, "\\+")}"\\]((?:\\[data-velar-look\\])*)`, "u").exec(css);
  assert.ok(match, `no rule for ${token} in\n${css}`);
  return match![1]!.length / "[data-velar-look]".length;
}

test("[R3] an unrelated earlier look no longer decides a later look's winner", () => {
  const other = [
    "export const other = look:",
    "    if scheme.dark:",
    '        color = "blue"',
    "    if @hover:",
    '        color = "green"',
    "",
  ].join("\n");
  const alone = compileWeb(other);
  const preceded = compileWeb([
    "export const base = look:",
    "    if @hover:",
    '        color = "red"',
    "",
    other,
  ].join("\n"));
  assert.deepEqual(alone.diagnostics, []);
  assert.deepEqual(preceded.diagnostics, []);
  // Byte for byte the same sheet: the token's position no longer depends on
  // where it first appeared anywhere in the module.
  assert.equal(alone.css, preceded.css);
  // And the state rule outranks the media rule in both, so the element hovering
  // in dark mode resolves to the hover declaration either way.
  assert.ok(lookDepth(alone.css ?? "", "hover:color") > lookDepth(alone.css ?? "", "scheme-dark:color"));
});

test("[R3] a compound condition outranks the single condition it refines", () => {
  const result = compileWeb([
    "export const panel = look:",
    "    if scheme.dark and viewport.width <= 720px:",
    '        background = "red"',
    "    if scheme.dark:",
    '        background = "blue"',
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  const specific = lookDepth(result.css ?? "", "scheme-dark+viewport-width-lte-720px:background");
  const general = lookDepth(result.css ?? "", "scheme-dark:background");
  assert.ok(specific > general, `specific ${specific} must outrank general ${general}`);
});

test("[R3] the two spellings of one breakpoint are one condition", () => {
  const result = compileWeb([
    "export const a = look:",
    "    if not (viewport.width <= 720px):",
    "        padding = 10px",
    "",
    "export const b = look:",
    "    if viewport.width > 720px:",
    "        padding = 20px",
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  const css = result.css ?? "";
  assert.doesNotMatch(css, /not-lte/u);
  assert.equal((css.match(/viewport-width-gt-720px:padding/gu) ?? []).length, 1);
  assert.equal((css.match(/@media \(width > 720px\)/gu) ?? []).length, 1);
});

test("[R3] a caller's Look overrides a component property under every condition", () => {
  const source = [
    "export const baseLook = look:",
    "    padding = 20px",
    "    if viewport.width <= 720px:",
    "        padding = 8px",
    "",
    "export const callerLook = look:",
    "    padding = 40px",
    "",
    "component Inner:",
    "    return <div look={baseLook}>x</div>",
    "",
    "export component Page:",
    "    return <Inner look={callerLook} />",
    "",
  ].join("\n");
  const execution = runWeb(source, `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
console.log("padding=" + page.node.style.properties.get("--velar-look-base-padding"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  // The component's own breakpoint token is gone, so 40px is what the element
  // shows at both widths; the caller does not have to know the breakpoint.
  assert.equal(execution.stdout, "tokens=base:padding\npadding=40px\n");
});

test("[R3] composing with a spread is the explicit override spelling", () => {
  const execution = runWeb([
    "export const base = look:",
    '    color = "black"',
    "    if @hover:",
    '        color = "red"',
    "",
    "export const derived = look:",
    "    ...base",
    '    color = "blue"',
    "",
    "export component Page:",
    "    return <div look={derived}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
console.log("color=" + page.node.style.properties.get("--velar-look-base-color"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "tokens=base:color\ncolor=blue\n");
});

test("[R3] a pseudo-element target is its own surface, not another condition", () => {
  const execution = runWeb([
    "export const base = look:",
    "    @before:",
    '        content = "dot"',
    "",
    "export const derived = look:",
    "    ...base",
    '    content = "text"',
    "",
    "export component Page:",
    "    return <div look={derived}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "tokens=before:base:content base:content\n");
});

test("[R3] a caller that writes a property only under a condition keeps the resting value", () => {
  const execution = runWeb([
    "export const inner = look:",
    '    color = "black"',
    "    padding = 20px",
    "    if @hover:",
    '        color = "red"',
    "",
    "export const caller = look:",
    "    if @hover:",
    '        color = "blue"',
    "",
    "component Inner:",
    "    return <div look={inner}>x</div>",
    "",
    "export component Page:",
    "    return <Inner look={caller} />",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
console.log("base=" + page.node.style.properties.get("--velar-look-base-color"));
console.log("hover=" + page.node.style.properties.get("--velar-look-hover-color"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  // The caller wins the property under its own condition and never mentioned
  // the resting colour, so the component's black is still what the element
  // shows when it is not hovered.
  assert.equal(execution.stdout, 'tokens=base:color base:padding hover:color\nbase=black\nhover=blue\n');
});

test("[R3] a later conditional keeps an earlier pseudo-element value", () => {
  const execution = runWeb([
    "export const base = look:",
    "    @before:",
    '        content = "dot"',
    "",
    "export const derived = look:",
    "    ...base",
    "    @before:",
    "        if @hover:",
    '            content = "hot"',
    "",
    "export component Page:",
    "    return <div look={derived}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
console.log("base=" + page.node.style.properties.get("--velar-look-before-base-content"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, 'tokens=before:base:content before:hover:content\nbase="dot"\n');
});

test("[R3] neither of two conditional declarations erases the other", () => {
  const execution = runWeb([
    "export const base = look:",
    "    if @hover:",
    '        color = "red"',
    "",
    "export const derived = look:",
    "    ...base",
    "    if scheme.dark:",
    '        color = "blue"',
    "",
    "export component Page:",
    "    return <div look={derived}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
console.log("hover=" + page.node.style.properties.get("--velar-look-hover-color"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  // Only an unconditional declaration replaces a property outright, so the dark
  // scheme refines its own condition and the hover value stands.
  assert.equal(execution.stdout, 'tokens=hover:color scheme-dark:color\nhover=red\n');
});

test("[R3] declarations written in one look block still cascade against each other", () => {
  const execution = runWeb([
    "export const other = look:",
    "    if scheme.dark:",
    '        color = "blue"',
    "    if @hover:",
    '        color = "green"',
    "",
    "export component Page:",
    "    return <div look={other}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log("tokens=" + (page.node.attributes.get("data-velar-look") ?? ""));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "tokens=scheme-dark:color hover:color\n");
});

test("[R3] neither composition pass clears a property it refuses to write", () => {
  const result = compileWeb([
    "export const other = look:",
    '    color = "blue"',
    "",
    "export component Page:",
    "    return <div look={other}>x</div>",
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  // Composition runs in two places — the merge inside one built Look and the
  // merge across the sources attached to one element — and an unconditional
  // declaration drops the earlier conditions of its property in both. A rule
  // the assignment pass then refuses to read would leave the property gone
  // with nothing put in its place, which is the shape the conditional guard
  // exists to prevent, so both passes read a data descriptor first.
  for (const merge of ["function __velarMergeRules", "function __velarApplyLooks"]) {
    const start = code.indexOf(merge);
    assert.ok(start >= 0, `${merge} is missing from the emitted runtime`);
    const body = code.slice(start, code.indexOf("\n}\n", start));
    const guard = body.indexOf('if (!descriptor || !("value" in descriptor)) continue;');
    const clear = body.search(/delete [A-Za-z_$][\w$]*\[/u);
    assert.ok(guard >= 0, `${merge} never checks the descriptor`);
    assert.ok(clear >= 0, `${merge} never drops an earlier condition`);
    assert.ok(guard < clear, `${merge} drops an earlier condition before it checks the descriptor`);
  }
});

test("[R3] renaming a module cannot change which Look rule wins", async () => {
  const winners: string[] = [];
  const orders: string[] = [];
  for (const themeName of ["z-theme.vel", "a-a-theme.vel"]) {
    const directory = await makeTemporaryDirectory("velar-look-cascade-");
    const entry = join(directory, "main.vel");
    await writeFile(join(directory, "a-badge.vel"), [
      "export const badgeLook = look:",
      "    if @hover:",
      '        color = "red"',
      "",
    ].join("\n"), "utf8");
    await writeFile(join(directory, themeName), [
      "export const themeLook = look:",
      "    if scheme.dark:",
      '        color = "blue"',
      "",
    ].join("\n"), "utf8");
    await writeFile(entry, [
      'import {badgeLook} from "./a-badge.vel"',
      `import {themeLook} from "./${themeName}"`,
      "component App:",
      "    return <div look={[themeLook, badgeLook]}>App</div>",
      "",
    ].join("\n"), "utf8");
    const project = await compileProject(entry);
    assert.deepEqual(project.failures, []);
    const styles = projectStyles(project);
    orders.push(styles.indexOf("hover:color") < styles.indexOf("scheme-dark:color") ? "hover-first" : "dark-first");
    winners.push(lookDepth(styles, "hover:color") > lookDepth(styles, "scheme-dark:color") ? "hover" : "dark");
  }
  // The rename really does flip the byte order the CLI concatenates in, and the
  // winner really is unmoved by it.
  assert.notEqual(orders[0], orders[1]);
  assert.deepEqual(winners, ["hover", "hover"]);
});

test("[LOK-U15] a one-property Look change costs one DOM write", () => {
  const execution = runWeb([
    "export const card = look:",
    "    padding = 20px",
    "    margin = 4px",
    "    borderRadius = 8px",
    '    color = "red"',
    "    opacity = 1",
    '    display = "grid"',
    "",
    "export component Page:",
    "    state hot = true",
    "    def toggle():",
    "        hot = not hot",
    '    return <button look={card} look:background={hot ? "red" : "blue"} on:click={toggle}>x</button>',
    "",
  ].join("\n"), `
const page = Page();
await __velarSettled();
resetWrites();
page.node.fire("click");
await __velarSettled();
console.log("writes=" + domWrites());
console.log("background=" + page.node.style.properties.get("--velar-look-base-background"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout, "writes=1\nbackground=blue\n");
});

test("[LOK-U14] a keyword the compiler cannot read is refused before it reaches the DOM", () => {
  const execution = runWeb([
    "export component Page(mode: string):",
    "    return <div look:display={mode}>x</div>",
    "",
  ].join("\n"), `
try { Page({ mode: "grdi" }); console.log("accepted"); }
catch (error) { console.log(error.message); }
console.log((Page({ mode: "grid" }).node.style.properties.get("--velar-look-base-display")));
`);
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /^Look property 'display' does not accept 'grdi'; use one of .*\bgrid\b/u);
  assert.match(execution.stdout, /\ngrid\n$/u);
});

test("[LOK-U13] content is written with CSS string escapes, not JavaScript ones", () => {
  const execution = runWeb([
    "export const badge = look:",
    "    @before:",
    '        content = "line1\\nline2\\tx\\"q\\\\z"',
    "",
    "export component Page:",
    "    return <div look={badge}>x</div>",
    "",
  ].join("\n"), `
const page = Page();
console.log(page.node.style.properties.get("--velar-look-before-base-content"));
`);
  assert.equal(execution.status, 0, execution.stderr);
  // \\A and \\9 are the CSS spellings of newline and tab; the quote and the
  // backslash are the two characters CSS and JSON agree on.
  assert.equal(execution.stdout, '"line1\\A line2\\9 x\\"q\\\\z"\n');
});

test("[LOK-U9] a keyframe stop cannot write an unbalanced at-rule", () => {
  const result = compileWeb([
    "export const spin = keyframes:",
    "    from:",
    '        transform = "rotate(0deg)"',
    "    to:",
    '        transform = "rotate(360deg)} } .victim { display: none "',
    "",
  ].join("\n"));
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0]?.code, "VEL5060");
  assert.doesNotMatch(result.css ?? "", /\.victim/u);
});

test("[LOK-U11] two keyframe structures keep two names, and the runtime accepts the wider digest", () => {
  const forged = compileWeb([
    "export const a = keyframes:",
    "    from:",
    '        transform = "a"',
    "    to:",
    '        transform = "b"',
    "",
    "export const b = keyframes:",
    "    from:",
    '        transform = "a}|100{transform:b"',
    "",
  ].join("\n"));
  // The forged spelling is refused before identity is even at stake.
  assert.equal(forged.diagnostics.length, 1);

  const result = compileWeb([
    "export const fade = keyframes:",
    "    from:",
    "        opacity = 0",
    "    to:",
    "        opacity = 1",
    "",
    "export const grow = keyframes:",
    "    from:",
    "        opacity = 0",
    "    to:",
    "        opacity = 0.5",
    "",
  ].join("\n"));
  assert.deepEqual(result.diagnostics, []);
  const names = [...new Set([...(result.css ?? "").matchAll(/@keyframes (velar-kf-[0-9a-f]+)/gu)].map((match) => match[1]!))];
  assert.equal(names.length, 2);
  for (const name of names) assert.match(name, /^velar-kf-[0-9a-f]{32}$/u);

  // The emitted runtime's name guard has to accept what the compiler now
  // generates: the 8-hex shape it used to demand rejects every name.
  const execution = spawnSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `${FAKE_DOM}\n${result.code ?? ""}\nconsole.log(fade.name + " " + grow.name);\n`,
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stdout.trim(), names.join(" "));
});
