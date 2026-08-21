import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "playwright";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { repositoryRoot } from "./repository-root.ts";

const root = repositoryRoot;

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

component Child(row: readonly Row):
    const alias = row
    alias.title = "alias"
    overwrite(row)
    harmless(row)
    return <span>{row.title}</span>

def overwrite(row: Row):
    row.title = "helper"

def harmless(row: readonly Row):
    def nested(row: Row):
        row.title = "nested-only"

def mutateThroughArrow(items: List<string>):
    [0].map(_ => items.append("captured"))

component ListChild(items: readonly List<string>):
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

def mutateTransitively(value: NestedRow):
    mutateDirectly(value)

def mutateDirectly(value: NestedRow):
    value.title = "helper"

def identity(value: readonly NestedRow) -> readonly NestedRow:
    return value

component TransitiveChild(row: readonly NestedRow):
    mutateTransitively(row)
    return <span>{row.title}</span>

component DestructuredChild(row: readonly NestedRow):
    const {inner} = row
    inner.title = "destructured"
    return <span>{row.inner.title}</span>

component ReturnedChild(row: readonly NestedRow):
    identity(row).title = "returned"
    return <span>{row.title}</span>

component CarrierChild(row: readonly NestedRow):
    const carrier = [row]
    carrier[0].title = "carried"
    return <span>{row.title}</span>

component ConditionalChild(row: readonly NestedRow, other: readonly NestedRow, choose: bool):
    const selected = choose ? row : other
    selected.title = "selected"
    return <span>{row.title}</span>

component SpreadChild(row: readonly NestedRow):
    const copy = {...row}
    copy.inner.title = "shared"
    return <span>{row.inner.title}</span>

component OwnedCopyControl(row: readonly NestedRow):
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

test("component props keep their declared mutable class and Promise boundaries", () => {
  const result = compile(`
type User:
    name: string

class Box:
    let title: string

    constructor(title: string):
        self.title = title

    def retitle():
        self.title = "method"

    def label() -> string:
        return self.title

def retitle(box: Box):
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
    action change():
        const user = await pending
        user.name = "resolved"
    return <span>{box.label()}</span>
`.trimStart());

  // D74: props keep the annotation the author wrote. Mutable data may contain
  // classes and use collection methods; Promise remains a capability boundary.
  assert.deepEqual(result.diagnostics, []);

  const hostAnnotation = compile(`
def inspect(element: readonly CanvasElement):
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

def captureRenderError(phase: string, message: string):
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

    def addEmpty():
        emptyList.append("L")
        emptySet.add("S")
        emptyMap.set("M", "1")

    def addPair():
        pairs.set("b", "2")

    def clearPairs():
        pairs.clear()

    def editObjectKey():
        for key, value in objectKeys:
            key.name = "changed"

    def flipPatterns():
        box.done = true

    def updateJson():
        root.inner.done = true
        jsonItems.append("b")

    def addArrival():
        arriving.append("first")

    def takeRow():
        held = rows.pop()
        const taken = held
        if taken != null:
            rows.append(taken)

    def editHeld():
        const taken = held
        if taken != null:
            taken.title = "EDITED"

    def churn():
        revision += 1

    def editRow():
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
        <p data-json-root>{Json.stringify(root)}</p>
        <p data-json-list>{Json.stringify(jsonItems)}</p>
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
test "empty collection iteration":
    await browser.open("/")
    await browser.click("[data-add-empty]")
    expect(await browser.text("[data-empty-list]")).toBe("L")
    expect(await browser.text("[data-empty-set]")).toBe("S")
    expect(await browser.text("[data-empty-map]")).toBe("M=1;")

test "two slot map tracks add and clear":
    await browser.open("/")
    await browser.click("[data-add-pair]")
    expect(await browser.text("[data-pairs]")).toBe("a=1;b=2;")
    await browser.click("[data-clear-pairs]")
    expect(await browser.text("[data-pairs]")).toBe("")
    await browser.click("[data-edit-object-key]")
    expect(await browser.text("[data-object-keys]")).toBe("changed=1;")

test "descriptor based deep reads":
    await browser.open("/")
    await browser.click("[data-flip]")
    expect(await browser.text("[data-destructure]")).toBe("done")
    expect(await browser.text("[data-match-record]")).toBe("done")
    expect(await browser.text("[data-match-list]")).toBe("done")
    expect(await browser.text("[data-spread]")).toBe("done")

test "json tracks nested records and lists":
    await browser.open("/")
    await browser.click("[data-json]")
    expect(await browser.text("[data-json-root]")).toBe(\`{"inner":{"done":true}}\`)
    expect(await browser.text("[data-json-list]")).toBe(\`["a","b"]\`)

test "out of range list get tracks arrival":
    await browser.open("/")
    await browser.click("[data-arrive]")
    expect(await browser.text("[data-arriving]")).toBe("first")

test "pop keeps record reactive":
    await browser.open("/")
    await browser.click("[data-take]")
    await browser.click("[data-edit-held]")
    expect(await browser.text("li")).toBe("EDITED")

test "keyed churn keeps current row reactive":
    await browser.open("/")
    for index in range(50):
        await browser.click("[data-churn]")
    await browser.click("[data-edit-row]")
    expect(await browser.text("li")).toBe("BOUND")

test "render self invalidation is bounded and reported":
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

// ---------------------------------------------------------------------------
// Wave web (rulings R1 and the queue-budget rulings): the flush settles every
// derived value and every watch to a fixed point before it writes the DOM, and
// the queue bound is the budget's failure to own rather than an exception
// thrown out of the assignment that happened to cross it. The reactive queue is
// a browser-lifetime thing, so these run the emitted application in Chromium.
// ---------------------------------------------------------------------------

async function mountInChromium(
  source: string,
  visit: (page: Page, failures: readonly string[]) => Promise<void>,
): Promise<void> {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, []);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on("pageerror", (error) => {
      failures.push(String(error));
    });
    await page.setContent(
      '<!doctype html><html><body><div id="app"></div></body></html>',
    );
    await page.addScriptTag({
      content: result.code ?? "",
      type: "module",
    });
    await page.waitForFunction(
      "document.querySelector('#app').childNodes.length > 0",
    );
    await visit(page, failures);
  } finally {
    await browser.close();
  }
}

// Six render-driven stages: each one writes state from a rendered position, so
// reaching the last of them takes six alternating settle-and-commit rounds. A
// tick() that is one microtask hop resolves at the first of them.
const tickCascadeStages = 6;

const settlingApplication = `
let watchLog = ""
let renderLog = ""
let evalLog = ""

state a: number = 0
state b: number = 0
state secondA: number = 0
state secondB: number = 0
state corrected: number = 0
state revision: number = 0
state subjectValue: number = 0
state unwatched: number = 0
state sink: number = 0
state trigger: number = 0
state tickReport = ""
${Array.from(
  { length: tickCascadeStages },
  (_, index) => `state rendered${index}: number = 0\nstate settled${index}: number = 0`,
).join("\n")}

// The observing watch is declared first here and second below: the output must
// be the same either way, and it must never carry an unsettled value.
watch a + b as sum, _:
    watchLog = watchLog + "one=" + str(sum) + ";"

watch a:
    b = a * 2

watch secondA:
    secondB = secondA * 2

watch secondA + secondB as total, _:
    watchLog = watchLog + "two=" + str(total) + ";"

watch corrected:
    if corrected > 5:
        corrected = 5

def subject() -> number:
    evalLog = evalLog + "e"
    return subjectValue

watch subject() as value, _:
    sink = value + unwatched

${Array.from({ length: tickCascadeStages }, (_, index) =>
  index === 0
    ? `watch trigger:\n    settled0 = trigger`
    : `watch rendered${index - 1}:\n    settled${index} = rendered${index - 1}`,
).join("\n\n")}

${Array.from(
  { length: tickCascadeStages },
  (_, index) =>
    `def stage${index}(value: number) -> string:\n    rendered${index} = value\n    return str(value)`,
).join("\n\n")}

def show(value: number) -> string:
    renderLog = renderLog + "n=" + str(value) + ";"
    return str(value)

def at(_: number, text: string) -> string:
    return text

component App:
    action runCascade():
        trigger = 1
        await tick()
        tickReport = str(rendered${tickCascadeStages - 1}) + "/" + str(settled${tickCascadeStages - 1})

    def runWatches():
        a = 1
        secondA = 1

    def correct():
        corrected = 10

    def bumpSubject():
        subjectValue = subjectValue + 1

    def bumpUnwatched():
        unwatched = unwatched + 1

    def refresh():
        revision = revision + 1

    return <main>
        <p data-watch-log>{at(revision, watchLog)}</p>
        <p data-render-log>{at(revision, renderLog)}</p>
        <p data-eval-log>{at(revision, evalLog)}</p>
        <p data-corrected>{show(corrected)}</p>
        <p data-tick>{tickReport}</p>
${Array.from(
  { length: tickCascadeStages },
  (_, index) => `        <p data-stage${index}>{stage${index}(settled${index})}</p>`,
).join("\n")}
        <button data-run on:click={runWatches}>run</button>
        <button data-correct on:click={correct}>correct</button>
        <button data-subject on:click={bumpSubject}>subject</button>
        <button data-unwatched on:click={bumpUnwatched}>unwatched</button>
        <button data-cascade on:click={runCascade}>cascade</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1] reactive updates settle before the DOM and keep watch declaration order out of the output",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(settlingApplication, async (page, failures) => {
      await page.click("[data-run]");
      await page.click("[data-correct]");
      await page.click("[data-subject]");
      await page.click("[data-unwatched]");
      await page.click("[data-cascade]");
      await page.waitForFunction(
        "document.querySelector('[data-tick]').textContent !== ''",
      );
      await page.click("[data-refresh]");
      await page.waitForFunction(
        "document.querySelector('[data-watch-log]').textContent !== ''",
      );

      // Both pairs settle to 3 and report it once. Before the fix the pair whose
      // observing watch was declared first reported the half-updated 1 as well,
      // so moving the two blocks past each other changed the program's output.
      assert.equal(
        await page.textContent("[data-watch-log]"),
        "one=3;two=3;",
      );
      // A corrective watch settles before the DOM is written, so the invalid 10
      // is never rendered.
      assert.equal(
        await page.textContent("[data-render-log]"),
        "n=0;n=5;",
      );
      assert.equal(await page.textContent("[data-corrected]"), "5");
      // The watch body's own reads belong to the body: one write to the watched
      // subject evaluates it once, and the write to the value only the body
      // reads evaluates it not at all.
      assert.equal(await page.textContent("[data-eval-log]"), "ee");
      // tick() drains the queues instead of hopping one microtask.
      assert.equal(await page.textContent("[data-tick]"), "1/1");
      assert.deepEqual(failures, []);
    });
  },
);

const overflowApplication = `
state stormA: number = 0
state stormB: number = 0
state unrelated: number = 0
state unrelatedRuns: number = 0

watch stormA:
    stormB = stormB + 1

watch stormB:
    stormA = stormA + 1

watch unrelated:
    unrelatedRuns = unrelatedRuns + 1

component App:
    def storm():
        stormA = stormA + 1
        unrelated = unrelated + 1

    def bumpUnrelated():
        unrelated = unrelated + 1

    return <main>
        <p data-runs>{unrelatedRuns}</p>
        <button data-storm on:click={storm}>storm</button>
        <button data-unrelated on:click={bumpUnrelated}>unrelated</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1] a runaway flush stops the observers that ran away and keeps the innocent ones",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(overflowApplication, async (page, failures) => {
      await page.click("[data-storm]");
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '1'",
        undefined,
        { timeout: 60_000 },
      );
      await page.click("[data-unrelated]");
      // The watch queued by an unrelated write in the same turn ran at most
      // once during the overrun, so it survives it: before the fix the overflow
      // stopped it for good and it never fired again.
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '2'",
        undefined,
        { timeout: 60_000 },
      );
      assert.equal(failures.length, 1);
      assert.match(
        failures[0] ?? "",
        /Reactive updates cannot run more than 100000 observers in one flush/u,
      );
    });
  },
);

// The budget stops a runaway by run count, so a cycle wide enough that the
// budget cannot run any of its observers four times reached the threshold
// nowhere: every observer was put back, the next flush repeated the pass, and
// the microtask chain never yielded. 100000 / 4 is 25000, so a cycle wider than
// that is the case, and it must end the same way a two-observer cycle does.
const wideCycleObservers = 30000;

const wideCycleApplication = `
state ticks: List<number> = []
state cells: List<number> = []
state unrelated: number = 0
state unrelatedRuns: number = 0

watch unrelated:
    unrelatedRuns = unrelatedRuns + 1

component Cell(index: number, total: number):
    watch ticks[index] as value, _:
        if value > 0:
            ticks[(index + 1) % total] = value + 1
    return <i></i>

component App:
    def build():
        let nextTicks: List<number> = []
        let ids: List<number> = []
        let index = 0
        while index < ${String(wideCycleObservers)}:
            nextTicks.append(0)
            ids.append(index)
            index = index + 1
        ticks = nextTicks
        cells = ids

    def storm():
        ticks[0] = ticks[0] + 1

    def bumpUnrelated():
        unrelated = unrelated + 1

    return <main>
        <p data-runs>{unrelatedRuns}</p>
        <div data-cells>{cells.map(id => <Cell key={str(id)} index={id} total={${String(wideCycleObservers)}} />)}</div>
        <button data-build on:click={build}>build</button>
        <button data-storm on:click={storm}>storm</button>
        <button data-unrelated on:click={bumpUnrelated}>unrelated</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "[R1] a runaway wider than the budget's run count still ends the turn",
  { timeout: 300_000 },
  async () => {
    await mountInChromium(wideCycleApplication, async (page, failures) => {
      await page.click("[data-build]");
      await page.waitForFunction(
        `document.querySelectorAll('[data-cells] i').length === ${String(wideCycleObservers)}`,
        undefined,
        { timeout: 120_000 },
      );
      await page.click("[data-storm]");
      // The page answers again, and an unrelated write still reaches its watch:
      // before the fix this click never landed, because the overrun stopped no
      // observer and rescheduled itself forever.
      await page.click("[data-unrelated]", { timeout: 60_000 });
      await page.waitForFunction(
        "document.querySelector('[data-runs]').textContent === '1'",
        undefined,
        { timeout: 60_000 },
      );
      assert.equal(failures.length, 1);
      assert.match(
        failures[0] ?? "",
        /Reactive updates cannot run more than 100000 observers in one flush/u,
      );
    });
  },
);

test("[R1] both flush drains carry the same overrun progress rules", async () => {
  // The registry drain in runtime-foundation.ts and the prelude drain in the
  // emitter template share the queues, so an overrun that made progress in one
  // and not the other would freeze the page whenever velar/app stamped the
  // registry first. Only their identifiers may differ.
  const drains = [
    await readFile(join(root, "packages", "web", "src", "runtime-foundation.ts"), "utf8"),
    await readFile(join(root, "packages", "web", "src", "emitter.ts"), "utf8"),
  ];
  for (const drain of drains) {
    // The threshold falls to the highest run count present, so an overrun that
    // ran nobody four times still stops the observers it did run.
    assert.match(drain, /if \(observer\.flushToken === token && observer\.flushRuns > threshold\) threshold = observer\.flushRuns;/u);
    assert.match(drain, /if \(threshold > 4\) threshold = 4;/u);
    assert.match(drain, /if \(threshold > 0 && observer\.flushToken === token && observer\.flushRuns >= threshold\)/u);
    // The token carries into the flush the overrun schedules, so run counts
    // accumulate across the chain and the unreached observers only shrink.
    assert.match(drain, /(?:__velarOverflowToken|overflowToken) = token;\n/u);
    assert.match(drain, /const token = (?:__velarOverflowToken|overflowToken) === null \? \{\} : (?:__velarOverflowToken|overflowToken);\n\s*(?:__velarOverflowToken|overflowToken) = null;/u);
  }
});

test("[R1] a watch that writes through a helper is classified as a writer", () => {
  // D90's R1-a revision made the compile ask the same question this runtime
  // classifier answers, so the two writing watches below must reach *different*
  // states or the fixture is itself the VEL5069 contention the revision
  // introduced. `relay` still reaches its write through a second helper, which
  // is what the third classification line is here to prove.
  const result = compile(
    `
state a: number = 0
state b: number = 0
state c: number = 0
let log = ""

def bump(value: number):
    b = value * 2

def shift(value: number):
    c = value * 3

def relay(value: number):
    shift(value)

def loops(value: number):
    loops(value)

def quiet(value: number):
    log = log + str(value)

watch a + b as sum, _:
    log = log + str(sum)

watch a:
    bump(a)

watch a:
    relay(a)

watch a:
    loops(a)

watch a:
    quiet(a)

mount(<i>{log}{c}</i>, "#app")
`.trimStart(),
  );
  assert.deepEqual(result.diagnostics, []);
  const produces = (result.code ?? "").split("\n")
    .filter((line) => line.includes("__velarGlobalScope,"))
    .map((line) => line.trim());
  // The observing watch, the direct helper, the helper's own helper, a helper
  // that only recurses, and a helper that writes no state -- in that order.
  assert.deepEqual(produces, [
    "}, __velarGlobalScope, false);",
    "}, __velarGlobalScope, true);",
    "}, __velarGlobalScope, true);",
    "}, __velarGlobalScope, false);",
    "}, __velarGlobalScope, false);",
  ]);
});

// R1 again, for the spelling that puts the write in a named function: moving
// the two watch blocks past each other must not change what the program prints,
// on the first firing as much as on every later one. The runtime promotes a
// watch to a writer only after it has been seen writing, so the first firing is
// the compile-time classifier's to get right.
function helperOrderApplication(writerFirst: boolean): string {
  const observing = `watch a + b as sum, _:\n    log = log + "sum=" + str(sum) + ";"`;
  const writing = `watch a:\n    bump(a)`;
  return `
let log = ""

state a: number = 0
state b: number = 0
state revision: number = 0

def bump(value: number):
    b = value * 2

${writerFirst ? writing : observing}

${writerFirst ? observing : writing}

def at(_: number, text: string) -> string:
    return text

component App:
    def run():
        a = 1

    def refresh():
        revision = revision + 1

    return <main>
        <p data-log>{at(revision, log)}</p>
        <button data-run on:click={run}>run</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();
}

test(
  "[R1] a watch that writes through a helper settles before the watches that observe",
  { timeout: 120_000 },
  async () => {
    const logs: string[] = [];
    for (const writerFirst of [false, true]) {
      await mountInChromium(helperOrderApplication(writerFirst), async (page, failures) => {
        await page.click("[data-run]");
        await page.click("[data-refresh]");
        logs.push((await page.textContent("[data-log]")) ?? "");
        assert.deepEqual(failures, []);
      });
    }
    // Before the fix the observing watch fired on the half-settled world when
    // it was declared first: ["sum=1;sum=3;", "sum=3;"].
    assert.deepEqual(logs, ["sum=3;", "sum=3;"]);
  },
);
