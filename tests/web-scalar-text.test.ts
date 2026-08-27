import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { compile } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

/**
 * F1 (`VelarOS-Desktop-Vel/bench/stream-bench/FINDINGS.md`): every JSX text
 * interpolation used to allocate a `velar:start`/`velar:end` comment pair and an
 * owned child scope, whatever its checked type. On the benchmark's 2,000-message
 * transcript that was 607,952 comment nodes for 303,976 token spans — the DOM
 * carried 1,247,243 nodes where the identical React element tree carried
 * 618,681, and the cold mount ran 5.4x slower on chromium and 8.5x on WebKit.
 *
 * An interpolation whose checked type is `string` or `number` renders as exactly
 * one text node, so it is one now: created once, updated by assigning its
 * character data, bracketed by nothing.
 *
 * This file pins the three things that change and the several that must not.
 * The type ruling is pinned at the emitter, where widening it would show up as a
 * changed lowering; the DOM shape and the update semantics are pinned in
 * Chromium, where the node count is the observable.
 */

function emitted(source: string): string {
  const result = compile(source, { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  return result.code ?? "";
}

/** The emitted lowering of a component's single interpolated child. */
function lowering(childType: string, child: string): string {
  const code = emitted(`
enum Role:
    user = "user"
    assistant = "assistant"

component Probe(value: ${childType}):
    return <span>${child}</span>
`.trimStart());
  const line = code.split("\n").find((entry) => entry.includes("const __velarRoot =")) ?? "";
  if (line.includes("__velarText(")) return "text";
  if (line.includes("__velarKeyed(")) return "keyed";
  if (line.includes("__velarDynamic(")) return "dynamic";
  return line;
}

test("[F1] the scalar-text fast path is taken for exactly the types that render as one text node", () => {
  // `string` and `number` are the whole qualifying set. __velarAppend answers a
  // string with one text node carrying it and a number with one text node
  // carrying String(value); neither can render zero nodes or more than one.
  assert.equal(lowering("string", "{value}"), "text");
  assert.equal(lowering("number", "{value}"), "text");
  // A conditional over two scalars is still one text node, so it qualifies as a
  // whole even though it is two leaves.
  assert.equal(lowering("string", "{value == \"\" ? \"empty\" : value}"), "text");
  assert.equal(lowering("number", "{value + 1}"), "text");

  // `bool` renders ZERO nodes -- __velarAppend returns on true and on false --
  // so a text node would be a child where the element previously had none.
  assert.equal(lowering("bool", "{value}"), "dynamic");
  // An optional renders zero nodes when null and one when present, so it needs
  // an anchor to come back to.
  assert.equal(lowering("string?", "{value}"), "dynamic");
  assert.equal(lowering("number?", "{value}"), "dynamic");
  // A union, an enum, and every markup-bearing type keep the full region: the
  // ruling admits a type only when its rendering is provably one text node, and
  // an enum's is not decided here even though it is text at runtime.
  assert.equal(lowering("string | number", "{value}"), "dynamic");
  assert.equal(lowering("Role", "{value}"), "dynamic");
  assert.equal(lowering("WebNode", "{value}"), "dynamic");
  assert.equal(lowering("List<string>", "{value}"), "dynamic");
});

test("[F1] a keyed interpolation and a nested-element expression keep the full dynamic region", () => {
  // A keyed list owns identity-preserving children and genuinely needs its
  // bracket; the keyed recognizer is asked first and always wins.
  const keyed = emitted(`
type Item:
    id: string
    label: string

component Probe(items: List<Item>):
    return <ul>{items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
`.trimStart());
  assert.match(keyed, /__velarKeyed\(__velarElement1,/u);
  // The row's own scalar child still takes the fast path, bound to the row scope.
  assert.match(keyed, /__velarText\(__velarElement2, \(\) => item\.label, __velarChildScope\)/u);

  // __velarText owns no child scope, so an expression that builds JSX of its own
  // -- legal wherever a function takes a WebNode and answers text -- must not
  // reach it, whatever its checked type says.
  const nested = emitted(`
def describe(node: WebNode) -> string:
    return "described"

component Probe:
    return <span>{describe(<b>label</b>)}</span>
`.trimStart());
  assert.match(nested, /__velarDynamic\(__velarElement1, \(__velarChildScope\) => describe\(/u);
  // Asserted on the component's own line: the runtime template always defines
  // __velarText, so a whole-output search would prove nothing.
  assert.doesNotMatch(nested.split("\n").find((line) => line.includes("const __velarRoot =")) ?? "", /__velarText\(/u);
});

async function mountInChromium(
  source: string,
  visit: (page: Page, failures: readonly string[]) => Promise<void>,
): Promise<void> {
  const result = compile(source, { extensions: [velarCompilerExtension] });
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => { failures.push(String(error)); });
    await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
    await page.addScriptTag({ content: result.code ?? "", type: "module" });
    await page.waitForFunction("document.querySelector('#app').childNodes.length > 0");
    await visit(page, failures);
  } finally {
    await browser.close();
  }
}

/** Counts every node under #app, and the comments among them, by node type. */
const CENSUS = `(() => {
  const walker = document.createTreeWalker(document.querySelector("#app"), NodeFilter.SHOW_ALL);
  const census = { total: 0, elements: 0, texts: 0, comments: 0, regionAnchors: 0 };
  while (walker.nextNode()) {
    const node = walker.currentNode;
    census.total += 1;
    if (node.nodeType === 1) census.elements += 1;
    if (node.nodeType === 3) census.texts += 1;
    if (node.nodeType === 8) {
      census.comments += 1;
      if (node.data === "velar:start" || node.data === "velar:end") census.regionAnchors += 1;
    }
  }
  return census;
})()`;

const MESSAGES = 40;
const TOKENS = 12;

// Written out as a literal rather than generated in Vel: `range` imports
// velar/collections, and this fixture is mounted from one inline script.
const transcript = Array.from({ length: MESSAGES }, (_ignored, message) => {
  const tokens = Array.from({ length: TOKENS }, (_token, position) => `{id: "t${position}", text: "w${position}"}`);
  return `{id: "m${message}", role: "assistant", tokens: [${tokens.join(", ")}]}`;
}).join(", ");

/**
 * The benchmark's message-row shape at a size a test can assert exactly: a role
 * header that is one scalar interpolation, and a paragraph of keyed token spans
 * whose bodies are one scalar interpolation each.
 */
const transcriptApplication = `
type Token:
    id: string
    text: string

type Message:
    id: string
    role: string
    tokens: List<Token>

state messages: List<Message> = [${transcript}]

component MessageRow(message: Message):
    return <article data-row>
        <h2 data-role>{message.role}</h2>
        <p data-body>{message.tokens.map(token => <span key={token.id}>{token.text}</span>)}</p>
    </article>

component App:
    return <main data-transcript>{messages.map(message => <MessageRow key={message.id} message={message} />)}</main>

mount(<App />, "#app")
`.trimStart();

test("[F1] a scalar interpolation renders one text node and no anchors, and the transcript's node count is exact",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(transcriptApplication, async (page, failures) => {
      const census = await page.evaluate<{
        total: number; elements: number; texts: number; comments: number; regionAnchors: number;
      }>(CENSUS);

      // Per message: article + h2 + p (3 elements) and one span per token.
      const elements = 1 + MESSAGES * (3 + TOKENS);
      // One text node for the role header, one per token span. Nothing else --
      // every text child in the fixture is an interpolation.
      const texts = MESSAGES * (1 + TOKENS);
      // The only comments left are the keyed brackets: one pair for the
      // transcript, one pair for each message's token list. A keyed list
      // genuinely needs its bracket; a scalar interpolation never did.
      const comments = 2 + MESSAGES * 2;

      assert.equal(census.regionAnchors, 0);
      assert.deepEqual(census, {
        total: elements + texts + comments,
        elements,
        texts,
        comments,
        regionAnchors: 0,
      });

      // The shape this replaces: two anchors per scalar interpolation, which on
      // this fixture is 2 * MESSAGES * (1 + TOKENS) extra nodes -- 1,040 against
      // the 1,203 the document now holds, so the tree was very nearly twice its
      // necessary size. Asserted as a floor so the saving cannot quietly shrink.
      assert.ok(census.total < elements + texts + comments + 2 * texts);

      // An element whose only child is a scalar interpolation holds exactly one
      // node, and it is the text.
      assert.deepEqual(
        await page.evaluate(`(() => {
          const role = document.querySelector("[data-role]");
          return { children: role.childNodes.length, type: role.firstChild.nodeType, text: role.textContent };
        })()`),
        { children: 1, type: 3, text: "assistant" },
      );
      assert.deepEqual(failures, []);
    });
  },
);

const updateApplication = `
type Row:
    id: string
    label: string
    count: number

state rows: List<Row> = [{id: "a", label: "alpha", count: 1}, {id: "b", label: "beta", count: 2}]
state heading: string = "one"
state total: number = 0
state blank: string = "x"

component RowView(row: Row):
    return <li data-id={row.id}>
        <span data-label>{row.label}</span>
        <span data-count>{row.count}</span>
        <input data-input type="text" />
    </li>

component App:
    def rename():
        rows[0].label = "renamed"

    def bump():
        rows[0].count = rows[0].count + 41

    def retitle():
        heading = "two"
        total = total + 7
        blank = ""

    def reorder():
        rows = rows.reversed()

    return <div>
        <button type="button" data-rename on:click={rename}>rename</button>
        <button type="button" data-bump on:click={bump}>bump</button>
        <button type="button" data-retitle on:click={retitle}>retitle</button>
        <button type="button" data-reorder on:click={reorder}>reorder</button>
        <h1 data-heading>{heading}</h1>
        <p data-total>{total}</p>
        <p data-blank>{blank}</p>
        <ul data-list>{rows.map(row => <RowView key={row.id} row={row} />)}</ul>
    </div>

mount(<App />, "#app")
`.trimStart();

test("[F1] a scalar interpolation updates in place: same node, new character data",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(updateApplication, async (page, failures) => {
      // The identity of every text node this test will watch, captured before
      // anything changes. An update that replaced a node instead of writing its
      // data would fail every isSameNode below.
      const before = await page.evaluateHandle<readonly Text[]>(`[
        document.querySelector("[data-heading]").firstChild,
        document.querySelector("[data-total]").firstChild,
        document.querySelector("[data-blank]").firstChild,
        document.querySelector("[data-label]").firstChild,
        document.querySelector("[data-count]").firstChild,
      ]`);

      assert.deepEqual(
        await page.evaluate(`[
          document.querySelector("[data-heading]").textContent,
          document.querySelector("[data-total]").textContent,
          document.querySelector("[data-label]").textContent,
          document.querySelector("[data-count]").textContent,
        ]`),
        ["one", "0", "alpha", "1"],
      );

      // A deep write into a row's field (D26) reaches the row's own text node.
      await page.click("[data-rename]");
      await page.click("[data-bump]");
      await page.click("[data-retitle]");
      await page.waitForFunction('document.querySelector("[data-heading]").textContent === "two"');

      assert.deepEqual(
        await page.evaluate(`[
          document.querySelector("[data-heading]").textContent,
          document.querySelector("[data-total]").textContent,
          document.querySelector("[data-label]").textContent,
          document.querySelector("[data-count]").textContent,
        ]`),
        ["two", "7", "renamed", "42"],
      );

      // Every one of those five is the same node it was before the update.
      assert.equal(
        await page.evaluate((nodes: readonly Text[]) => [
          document.querySelector("[data-heading]")!.firstChild!.isSameNode(nodes[0]!),
          document.querySelector("[data-total]")!.firstChild!.isSameNode(nodes[1]!),
          document.querySelector("[data-blank]")!.firstChild!.isSameNode(nodes[2]!),
          document.querySelector("[data-label]")!.firstChild!.isSameNode(nodes[3]!),
          document.querySelector("[data-count]")!.firstChild!.isSameNode(nodes[4]!),
        ].every((same) => same), before),
        true,
      );

      // A `string` that becomes empty keeps its text node and empties it, which
      // is what document.createTextNode("") produced before: same node count,
      // same textContent, no anchor left behind.
      assert.deepEqual(
        await page.evaluate(`(() => {
          const blank = document.querySelector("[data-blank]");
          return { children: blank.childNodes.length, type: blank.firstChild.nodeType, data: blank.firstChild.data };
        })()`),
        { children: 1, type: 3, data: "" },
      );
      assert.deepEqual(failures, []);
    });
  },
);

test("[F1] a scalar text node inside a keyed row survives a reorder, and the row's focus with it",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(updateApplication, async (page, failures) => {
      await page.click('[data-id="a"] [data-input]');
      await page.keyboard.type("typed");
      const before = await page.evaluateHandle<readonly Node[]>(`[
        document.querySelector('[data-id="a"] [data-label]').firstChild,
        document.querySelector('[data-id="a"] [data-input]'),
      ]`);

      // Driven through the element's own click(), which does not move focus:
      // a real click on the button would, and the point here is what the row's
      // update and reorder do to the focus, not what pressing a button does.
      await page.evaluate('document.querySelector("[data-rename]").click()');
      await page.waitForFunction('document.querySelector(\'[data-id="a"] [data-label]\').textContent === "renamed"');
      await page.evaluate('document.querySelector("[data-reorder]").click()');
      await page.waitForFunction(
        `Array.from(document.querySelectorAll("[data-id]")).map(node => node.dataset.id).join(",") === "b,a"`,
      );

      // The row moved and its text changed, and neither replaced a node: the
      // text node is the same one, the input is the same one, it still holds
      // what was typed into it, and it is still the focused element. A text
      // node that was rebuilt would have detached the row's subtree.
      assert.deepEqual(
        await page.evaluate((nodes: readonly Node[]) => ({
          sameText: document.querySelector('[data-id="a"] [data-label]')!.firstChild!.isSameNode(nodes[0]!),
          sameInput: document.querySelector('[data-id="a"] [data-input]')!.isSameNode(nodes[1]!),
          typed: (document.querySelector('[data-id="a"] [data-input]') as HTMLInputElement).value,
          focused: document.activeElement!.isSameNode(nodes[1]!),
        }), before),
        { sameText: true, sameInput: true, typed: "typed", focused: true },
      );
      assert.deepEqual(failures, []);
    });
  },
);

test("[F1] the types kept on the slow path still render exactly what they rendered",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(`
state flag: bool = true
state note: string? = null
state count: number = 3

component App:
    def toggle():
        flag = not flag
        note = note == null ? "shown" : null

    return <div>
        <button type="button" data-toggle on:click={toggle}>toggle</button>
        <span data-flag>{flag}</span>
        <span data-note>{note}</span>
        <span data-count>{count}</span>
    </div>

mount(<App />, "#app")
`.trimStart(), async (page, failures) => {
      // A bool renders nothing at all, and an absent optional renders nothing:
      // both hold only their two anchors, and neither holds a text node. This is
      // the reason they are not on the fast path.
      assert.deepEqual(
        await page.evaluate(`(() => {
          const read = (selector) => {
            const host = document.querySelector(selector);
            return {
              children: host.childNodes.length,
              texts: Array.from(host.childNodes).filter(node => node.nodeType === 3).length,
              text: host.textContent,
            };
          };
          return { flag: read("[data-flag]"), note: read("[data-note]"), count: read("[data-count]") };
        })()`),
        {
          flag: { children: 2, texts: 0, text: "" },
          note: { children: 2, texts: 0, text: "" },
          // The number is on the fast path: one text node, no anchors.
          count: { children: 1, texts: 1, text: "3" },
        },
      );

      await page.click("[data-toggle]");
      await page.waitForFunction('document.querySelector("[data-note]").textContent === "shown"');
      assert.deepEqual(
        await page.evaluate(`[
          document.querySelector("[data-flag]").textContent,
          document.querySelector("[data-note]").textContent,
          document.querySelector("[data-note]").childNodes.length,
        ]`),
        ["", "shown", 3],
      );
      assert.deepEqual(failures, []);
    });
  },
);
