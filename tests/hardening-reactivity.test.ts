import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

const root = resolve(new URL("..", import.meta.url).pathname);

function compile(source: string) {
  return compileCore(source, { extensions: [velarCompilerExtension] });
}

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

component Child(row: Row):
    const alias = row
    alias.title = "alias"
    overwrite(row)
    harmless(row)
    return <span>{row.title}</span>

def overwrite(row: Row) -> null:
    row.title = "helper"

def harmless(row: readonly Row) -> null:
    def nested(row: Row) -> null:
        row.title = "nested-only"

def mutateThroughArrow(items: List<string>) -> null:
    [0].map(_ => items.append("captured"))

component ListChild(items: List<string>):
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

def mutateTransitively(value: NestedRow) -> null:
    mutateDirectly(value)

def mutateDirectly(value: NestedRow) -> null:
    value.title = "helper"

def identity(value: readonly NestedRow) -> readonly NestedRow:
    return value

component TransitiveChild(row: NestedRow):
    mutateTransitively(row)
    return <span>{row.title}</span>

component DestructuredChild(row: NestedRow):
    const {inner} = row
    inner.title = "destructured"
    return <span>{row.inner.title}</span>

component ReturnedChild(row: NestedRow):
    identity(row).title = "returned"
    return <span>{row.title}</span>

component CarrierChild(row: NestedRow):
    const carrier = [row]
    carrier[0].title = "carried"
    return <span>{row.title}</span>

component ConditionalChild(row: NestedRow, other: NestedRow, choose: bool):
    const selected = choose ? row : other
    selected.title = "selected"
    return <span>{row.title}</span>

component SpreadChild(row: NestedRow):
    const copy = {...row}
    copy.inner.title = "shared"
    return <span>{row.inner.title}</span>

component OwnedCopyControl(row: NestedRow):
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

mount(<App />, "#app")
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

test("component readonly data protects data props while bare class and Promise props stay behavioral", () => {
  const result = compile(`
type User:
    name: string

class Box:
    let title: string

    constructor(title: string):
        self.title = title

    def retitle() -> null:
        self.title = "method"

    def label() -> string:
        return self.title

def retitle(box: Box) -> null:
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
    action change() -> null:
        const user = await pending
        user.name = "resolved"
    return <span>{box.label()}</span>
`.trimStart());

  // D44 rule 72: the bare `box: Box` prop stays legal — it is visibly
  // behavioral and passes through unprotected — while the class buried in
  // the `boxes: List<Box>` data prop is rejected at the prop declaration.
  // The Promise prop remains a capability boundary and resolves mutable data.
  assert.equal(result.diagnostics.length, 2, result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  assert.equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "VEL3002").length, 0);
  assert.equal(result.diagnostics.filter((diagnostic) => diagnostic.code === "VEL4001").length, 2);
  assert.ok(result.diagnostics.some((diagnostic) => /A component prop is a readonly data view; 'boxes\[element\]' is class 'Box' — lift the class into its own prop, or model it as a data record/u.test(diagnostic.message)));
  assert.ok(result.diagnostics.some((diagnostic) => /mutating method 'append' through readonly List<Box>/u.test(diagnostic.message)));

  const hostAnnotation = compile(`
def inspect(element: readonly CanvasElement) -> null:
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

test(
  "[#2/#3/#4/#25/#26/#27/#29/#30] reactivity hardening regressions pass in Chromium",
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "velar-hardening-reactivity-"),
    );
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      await mkdir(join(directory, "node_modules", "@velarscript"), {
        recursive: true,
      });
      await symlink(
        join(root, "packages", "web"),
        join(directory, "node_modules", "@velarscript", "web"),
        "dir",
      );
      await writeFile(
        join(directory, "velar.json"),
        JSON.stringify({
          formatVersion: 2,
          entry: "src/main.vel",
          outDir: "dist",
          extensions: ["@velarscript/web"],
          web: { title: "Reactivity hardening" },
        }),
        "utf8",
      );
      await writeFile(
        join(directory, "src", "main.vel"),
        browserApplication,
        "utf8",
      );
      await writeFile(
        join(directory, "src", "hardening.browser.test.vel"),
        browserTests,
        "utf8",
      );

      const output = await run(process.execPath, [
        join(root, "packages", "cli", "src", "cli.ts"),
        "test",
        directory,
        "--browser",
        "chromium",
      ]);
      assert.match(output, /8 passed, 0 failed/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

const browserApplication = `
import {onError} from "velar/app"
import {range} from "velar/collections"
import {stringify} from "velar/json"

type Box:
    done: bool

type Root:
    inner: Box

type Row:
    id: string
    title: string

type Key:
    name: string

state renderError = ""

def captureRenderError(phase: string, message: string) -> null:
    renderError = phase + ":" + message

onError(report => captureRenderError(report.phase, report.error.message))

def listText(source: List<string>) -> string:
    let output = ""
    for item in source:
        output += item
    return output

def setText(source: Set<string>) -> string:
    let output = ""
    for item in source:
        output += item
    return output

def pairText(source: Map<string, string>) -> string:
    let output = ""
    for key, value in source:
        output += key + "=" + value + ";"
    return output

def keyText(source: Map<Key, string>) -> string:
    let output = ""
    for key, value in source:
        output += key.name + "=" + value + ";"
    return output

def destructured(box: Box) -> string:
    const {done} = box
    return done ? "done" : "open"

def matchedRecord(box: Box) -> string:
    match box:
        case {done: true}:
            return "done"
    return "open"

def matchedList(items: List<Box>) -> string:
    match items:
        case [{done: true}]:
            return "done"
    return "open"

def spreadLabel(box: Box) -> string:
    const copy = {...box}
    return copy.done ? "done" : "open"

component LoopGuard:
    state count = 1

    def bump() -> number:
        count += 1
        return count

    return <p data-loop>{bump()}</p>

component App:
    state emptyList: List<string> = []
    state emptySet: Set<string> = Set()
    state emptyMap: Map<string, string> = Map()
    state pairs: Map<string, string> = Map([["a", "1"]])
    state objectKeys: Map<Key, string> = Map([[{name: "first"}, "1"]])
    state box: Box = {done: false}
    state boxes: List<Box> = [box]
    state root: Root = {inner: {done: false}}
    state jsonItems: List<string> = ["a"]
    state arriving: List<string> = []
    state rows: List<Row> = [{id: "a", title: "Alpha"}]
    state revision = 0
    let held: Row? = null

    def addEmpty() -> null:
        emptyList.append("L")
        emptySet.add("S")
        emptyMap.set("M", "1")

    def addPair() -> null:
        pairs.set("b", "2")

    def clearPairs() -> null:
        pairs.clear()

    def editObjectKey() -> null:
        for key, value in objectKeys:
            key.name = "changed"

    def flipPatterns() -> null:
        box.done = true

    def updateJson() -> null:
        root.inner.done = true
        jsonItems.append("b")

    def addArrival() -> null:
        arriving.append("first")

    def takeRow() -> null:
        held = rows.pop()
        const taken = held
        if taken != null:
            rows.append(taken)

    def editHeld() -> null:
        const taken = held
        if taken != null:
            taken.title = "EDITED"

    def churn() -> null:
        revision += 1

    def editRow() -> null:
        rows[0].title = "BOUND"

    return <main>
        <p data-empty-list>{listText(emptyList)}</p>
        <p data-empty-set>{setText(emptySet)}</p>
        <p data-empty-map>{pairText(emptyMap)}</p>
        <p data-pairs>{pairText(pairs)}</p>
        <p data-object-keys>{keyText(objectKeys)}</p>
        <p data-destructure>{destructured(box)}</p>
        <p data-match-record>{matchedRecord(box)}</p>
        <p data-match-list>{matchedList(boxes)}</p>
        <p data-spread>{spreadLabel(box)}</p>
        <p data-json-root>{stringify(root)}</p>
        <p data-json-list>{stringify(jsonItems)}</p>
        <p data-arriving>{arriving.get(0) ?? "missing"}</p>
        <ul>{rows.filter(row => row.id != "" or revision >= 0).map(row => <li key={row.id}>{row.title}</li>)}</ul>
        <p data-render-error>{renderError}</p>
        <LoopGuard />
        <button data-add-empty on:click={addEmpty}>empty</button>
        <button data-add-pair on:click={addPair}>pair</button>
        <button data-clear-pairs on:click={clearPairs}>clear</button>
        <button data-edit-object-key on:click={editObjectKey}>key</button>
        <button data-flip on:click={flipPatterns}>flip</button>
        <button data-json on:click={updateJson}>json</button>
        <button data-arrive on:click={addArrival}>arrive</button>
        <button data-take on:click={takeRow}>take</button>
        <button data-edit-held on:click={editHeld}>edit held</button>
        <button data-churn on:click={churn}>churn</button>
        <button data-edit-row on:click={editRow}>edit row</button>
    </main>

mount(<App />, "#app")
`.trimStart();

const browserTests = `
import {expect} from "velar/test"
import {browser} from "velar/web-test"
import {range} from "velar/collections"

async def test_empty_collection_iteration() -> null:
    await browser.open("/")
    await browser.click("[data-add-empty]")
    expect(await browser.text("[data-empty-list]")).toBe("L")
    expect(await browser.text("[data-empty-set]")).toBe("S")
    expect(await browser.text("[data-empty-map]")).toBe("M=1;")

async def test_two_slot_map_tracks_add_and_clear() -> null:
    await browser.open("/")
    await browser.click("[data-add-pair]")
    expect(await browser.text("[data-pairs]")).toBe("a=1;b=2;")
    await browser.click("[data-clear-pairs]")
    expect(await browser.text("[data-pairs]")).toBe("")
    await browser.click("[data-edit-object-key]")
    expect(await browser.text("[data-object-keys]")).toBe("changed=1;")

async def test_descriptor_based_deep_reads() -> null:
    await browser.open("/")
    await browser.click("[data-flip]")
    expect(await browser.text("[data-destructure]")).toBe("done")
    expect(await browser.text("[data-match-record]")).toBe("done")
    expect(await browser.text("[data-match-list]")).toBe("done")
    expect(await browser.text("[data-spread]")).toBe("done")

async def test_json_tracks_nested_records_and_lists() -> null:
    await browser.open("/")
    await browser.click("[data-json]")
    expect(await browser.text("[data-json-root]")).toBe(\`{"inner":{"done":true}}\`)
    expect(await browser.text("[data-json-list]")).toBe(\`["a","b"]\`)

async def test_out_of_range_list_get_tracks_arrival() -> null:
    await browser.open("/")
    await browser.click("[data-arrive]")
    expect(await browser.text("[data-arriving]")).toBe("first")

async def test_pop_keeps_record_reactive() -> null:
    await browser.open("/")
    await browser.click("[data-take]")
    await browser.click("[data-edit-held]")
    expect(await browser.text("li")).toBe("EDITED")

async def test_keyed_churn_keeps_current_row_reactive() -> null:
    await browser.open("/")
    for index in range(50):
        await browser.click("[data-churn]")
    await browser.click("[data-edit-row]")
    expect(await browser.text("li")).toBe("BOUND")

async def test_render_self_invalidation_is_bounded_and_reported() -> null:
    await browser.open("/")
    await browser.waitForText("[data-render-error]", "render:A reactive render cannot invalidate itself more than 100 times")
    expect(await browser.text("[data-loop]")).toBe("102")
`.trimStart();

async function run(
  command: string,
  arguments_: readonly string[],
): Promise<string> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, arguments_, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise(output);
      else
        rejectPromise(
          new Error(output || `Command exited with ${String(code)}`),
  );
});
  });
}
