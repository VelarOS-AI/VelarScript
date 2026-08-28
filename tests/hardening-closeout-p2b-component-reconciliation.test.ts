import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { repositoryRoot } from "./repository-root.ts";

/**
 * The P2b wave's three reconciliation findings, taken at the level each one's
 * evidence was taken at.
 *
 * **P2b-7 was ruled DESIGNED, and the counts below are what settles it.** The
 * report was "a component element inside a component's render is rebuilt per
 * parent recompute", measured as 337 constructions of one child across a
 * 337-character streamed reveal. The premise does not hold: a component element
 * in a *static* child position is constructed exactly once and its props flow
 * through live prop cells, which is `__velarChild` doing what it was built to
 * do. What the consumer actually hit was two rebuild shapes stacked, both of
 * which the contracts name in so many words:
 *
 *   - the child sat inside a `{...}` interpolation, and `docs/web-api.md`'s
 *     update semantics say such a position is "the region the renderer owns and
 *     rebuilds"; VEL5050 says it again to the author's face -- "every other
 *     shape rebuilds its children on change";
 *   - the keyed list above it was keyed over records rebuilt on every recompute,
 *     which is exactly what advisory A4 exists to name: "the key must match, and
 *     the item that key names must still be the same value".
 *
 * Stacked, each masks the other -- which is why the wave's own note that
 * removing the ternary changed nothing was true and still not the whole cause.
 * These tests pin all four cells so the next reader gets the map rather than
 * the measurement: two shapes preserve the instance, two rebuild by contract.
 *
 * P2b-5 and P2b-9 were defects and are fixed here. P2b-5 is VEL5075; P2b-9 is
 * the runaway report naming the path it used to leave to bisection.
 */

const root = repositoryRoot;

function compile(source: string): ReturnType<typeof compileCore> {
  return compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
}

function codes(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.code);
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

interface Fixture {
  readonly application: string;
  readonly browserTests: string;
}

async function runCommand(command: string, args: readonly string[]): Promise<{ output: string; code: number | null }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("close", (value) => resolvePromise({ output, code: value }));
  });
}

async function runFixture(prefix: string, fixture: Fixture): Promise<{ output: string; code: number | null }> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "P2b reconciliation" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), fixture.application, "utf8");
    await writeFile(join(directory, "src", "reconciliation.browser.test.vel"), fixture.browserTests, "utf8");
    return await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// P2b-7: which positions keep a child instance, and which rebuild it.
// ---------------------------------------------------------------------------

test("[P2b-7] a child instance survives a parent update in a static position and in a keyed list written in place", { timeout: 300_000 }, async () => {
  // Four cells of one matrix, measured the way the wave measured its 337: a
  // module-level counter, because a counter inside the component is reset by
  // the very rebuild it is meant to detect. Twenty reveals; a preserved
  // instance therefore reads 1 and a rebuilt one reads 21.
  const result = await runFixture("velar-p2b7-", {
    application: `
type Row:
    key: string
    text: string

let staticBuilds = 0
let dynamicBuilds = 0
let rebuiltKeyBuilds = 0
let stableKeyBuilds = 0

state text = "a"
state rows: List<Row> = [{key: "r0", text: "a"}]
state reported = "none"

/// A static child position: '__velarChild', one instance, live prop cells.
component StaticChild(value: string):
    staticBuilds = staticBuilds + 1
    return <span data-static>{value}</span>

/// Inside a '{...}' interpolation: the region the renderer owns and rebuilds.
component DynamicChild(value: string):
    dynamicBuilds = dynamicBuilds + 1
    return <span data-dynamic>{value}</span>

/// Keyed over records rebuilt on every recompute: the A4 shape.
component RebuiltKeyChild(row: Row):
    rebuiltKeyBuilds = rebuiltKeyBuilds + 1
    return <span data-rebuilt-key>{row.text}</span>

/// Keyed over a list whose row is written in place: identity survives.
component StableKeyChild(row: Row):
    stableKeyBuilds = stableKeyBuilds + 1
    return <span data-stable-key>{row.text}</span>

def rebuiltRows(value: string) -> List<Row>:
    const built: List<Row> = []
    built.append({key: "r0", text: value})
    return built

def advance():
    text = text + "a"
    const first = rows.get(0)
    if first != null:
        first.text = text

def report():
    reported = f"static={staticBuilds} dynamic={dynamicBuilds} rebuiltKey={rebuiltKeyBuilds} stableKey={stableKeyBuilds}"

component App:
    computed rebuilt = rebuiltRows(text)

    return <main>
        <div data-a><StaticChild value={text} /></div>
        <div data-b>{text != "" ? <DynamicChild value={text} /> : <span data-empty>x</span>}</div>
        <div data-c>{rebuilt.map(row => <RebuiltKeyChild key={row.key} row={row} />)}</div>
        <div data-d>{rows.map(row => <StableKeyChild key={row.key} row={row} />)}</div>
        <button type="button" data-reveal on:click={advance}>reveal</button>
        <button type="button" data-report on:click={report}>report</button>
        <p data-counts>{reported}</p>
    </main>

@main:
    mount(<App />, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "twenty reveals build the preserved children once and the rebuilt ones every time":
    await browser.open("/")
    for step in range(20):
        await browser.click("[data-reveal]")
    await browser.click("[data-report]")
    const counts = await browser.text("[data-counts]")
    // A static child position and a keyed row written in place are the two
    // shapes that keep the instance: one construction across twenty updates.
    expect(counts).toContain("static=1")
    expect(counts).toContain("stableKey=1")
    // The other two rebuild, and the contracts say so: an interpolation is the
    // region the renderer owns and rebuilds (web-api.md, VEL5050), and a key
    // over a value rebuilt every recompute names nothing stable (A4).
    expect(counts).toContain("dynamic=21")
    expect(counts).toContain("rebuiltKey=21")
    // The prop really did flow to the preserved instance rather than the
    // instance being stale -- one construction, twenty-one distinct texts.
    expect(await browser.text("[data-static]")).toBe("aaaaaaaaaaaaaaaaaaaaa")
    expect(await browser.text("[data-stable-key]")).toBe("aaaaaaaaaaaaaaaaaaaaa")
`,
  });
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});

// ---------------------------------------------------------------------------
// P2b-5: a component element built where nothing owns its lifetime.
// ---------------------------------------------------------------------------

test("[P2b-5] a 'def' answering markup with a component element is refused where it is written", () => {
  // The wave's shape: `velar check` was silent and the runtime threw "JSX can
  // render only text, finite numbers, bool, enums, WebNode values, and Lists of
  // those values", taking the whole subtree with it. A component element
  // standing on its own lowers to `__velarInstantiate` and answers an instance;
  // only a child position lowers to `__velarChild` and answers a node. Both are
  // typed WebNode, which is the divergence.
  assert.deepEqual(codes(`
component Badge(text: string):
    return <em>{text}</em>

def pick(text: string) -> WebNode:
    return <Badge text={text} />

component App:
    return <main>{pick("x")}</main>

@main:
    mount(<App />, "#app")
`), ["VEL5075"]);
});

test("[P2b-5] the refusal names the helper, the element, and a position that owns one", () => {
  const [message] = messages(`
component Badge(text: string):
    return <em>{text}</em>

def pick(text: string) -> WebNode:
    return <Badge text={text} />

component App:
    return <main>{pick("x")}</main>

@main:
    mount(<App />, "#app")
`);
  assert.match(message ?? "", /VEL5075/u);
  assert.match(message ?? "", /'pick' answers markup with the component element '<Badge \/>'/u);
  assert.match(message ?? "", /instance rather than a node/u);
  assert.match(message ?? "", /<div><Badge \.\.\. \/><\/div>/u);
});

test("[P2b-5] a row-per-item helper reaches the same defect through '.map' and is caught there too", () => {
  // Measured on the same fixture: the arrow's root is the component element, so
  // every row is an instance and the list fails exactly as the single value
  // does. The recognizer walks the callback for the same reason VEL5074's does.
  assert.deepEqual(codes(`
component Badge(text: string):
    return <em>{text}</em>

def rows(labels: List<string>) -> List<WebNode>:
    return labels.map(label => <Badge text={label} />)

component App:
    return <main>{rows(["a"])}</main>

@main:
    mount(<App />, "#app")
`), ["VEL5075"]);
});

test("[P2b-5] a component element in a child position of returned markup stays legal", () => {
  // Both of these render today and must keep rendering: inside a JSX element
  // every position is a child position, so the element lowers to
  // `__velarChild` and answers a node. The walk stops at the first JSX element
  // on every path for exactly this reason.
  assert.deepEqual(messages(`
component Badge(text: string):
    return <em>{text}</em>

def card(value: string) -> WebNode:
    return <div><Badge text={value} /></div>

def choice(value: string) -> WebNode:
    return <div>{value != "" ? <Badge text={value} /> : <span>empty</span>}</div>

component App:
    return <main>{card("a")}{choice("b")}</main>

@main:
    mount(<App />, "#app")
`), []);
});

test("[P2b-5] the module-level instantiation site D90 R4-b rules on is untouched", () => {
  // `const root = <App />` evaluates to the instance `mount` takes, and
  // tests/hardening-closeout-live-props.test.ts pins its prop evaluation order.
  // The defect is the helper that answers markup, not the expression.
  assert.deepEqual(messages(`
component Child(first: string, second: string):
    return <p>{first}{second}</p>

const root = <Child first="a" second="b" />

@main:
    mount(root, "#app")
`), []);
  // And a component element built inside a `def` that answers something else is
  // an ordinary call, which is what tests/compiler.test.ts relies on.
  assert.deepEqual(messages(`
component Clear(label: string):
    return <span>{label}</span>

def name(label: string) -> string:
    const view = <Clear label={label} />
    return label

component App:
    return <main>{name("a")}</main>

@main:
    mount(<App />, "#app")
`), []);
});

test("[P2b-5] a 'def' answering native elements is untouched", () => {
  // The markup helper the rule must not catch: `blockNode`-style dispatch over
  // a closed vocabulary is the shape the wave was writing, and native elements
  // returned from a `def` have always been correct.
  assert.deepEqual(messages(`
def row(label: string) -> WebNode:
    return <li>{label}</li>

def rows(labels: List<string>) -> List<WebNode>:
    return labels.map(label => row(label))

component App:
    return <ul>{rows(["a", "b"])}</ul>

@main:
    mount(<App />, "#app")
`), []);
});

test("[P2b-5] a component's own nested helper stays legal", () => {
  // A `def` nested inside a component lowers through that component's scope,
  // so its component elements are `__velarChild` and answer nodes.
  assert.deepEqual(messages(`
component Badge(text: string):
    return <em>{text}</em>

component Nested:
    def pick(value: string) -> WebNode:
        return <Badge text={value} />
    return <main>{pick("a")}</main>

@main:
    mount(<Nested />, "#app")
`), []);
});

// ---------------------------------------------------------------------------
// P2b-9: the runaway report names the path.
// ---------------------------------------------------------------------------

test("[P2b-9] a render that reads the collection it is appending to is told which path did it", { timeout: 300_000 }, async () => {
  // The wave's most expensive debugging session ended on one line -- a position
  // taken from `paired.size` inside the loop appending to `paired`. The budget
  // caught it, but the report named neither the collection nor the scope and
  // the stack top was the graph's own trigger, so the cause was found by
  // bisection. The graph knows both at the moment it trips.
  const result = await runFixture("velar-p2b9-", {
    application: `
import {onError} from "velar/app"

state cells: List<string> = ["a", "b", "c"]
state reported = "none"

def paired(values: List<string>) -> List<string>:
    const built: List<string> = []
    for value in values:
        // The idiom the wave named: the position comes from the collection
        // being written, so the render tracks a read it then invalidates.
        built.append(f"{value}-{built.size}")
    return built

component Boom:
    return <span data-boom>{paired(cells).map(value => <em key={value}>{value}</em>)}</span>

component App:
    return <main>
        <p data-report>{reported}</p>
        <div data-holder><Boom /></div>
    </main>

def remember(message: string):
    reported = message

@main:
    onError(report => remember(report.error.message))
    mount(<App />, "#app")
`,
    browserTests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "the self-invalidation report names the component and the path":
    await browser.open("/")
    const message = await browser.text("[data-report]")
    expect(message).toContain("cannot invalidate itself more than 100 times")
    // The two things the old message left to bisection.
    expect(message).toContain("Boom")
    expect(message).toContain("the size or contents of a List")
    // And the spelling that ends it.
    expect(message).toContain("for value, index in")
`,
  });
  assert.match(result.output, /1 passed, 0 failed/u, result.output);
  assert.equal(result.code, 0, result.output);
});
