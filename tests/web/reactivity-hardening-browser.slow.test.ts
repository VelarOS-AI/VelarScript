import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../support/repository-root.ts";
import { runCommand as run } from "../support/run-command.ts";

/**
 * D115 P5 — the reactivity hardening regressions on a real page, from the file
 * that was `tests/web/reactivity.slow.test.ts` before it reached 1,018 lines.
 *
 * Eight of the hardening items (#2, #3, #4, #25, #26, #27, #29, #30) were
 * reported as things a browser did, so one application and one browser suite
 * carry all eight and the page is built and driven once. The project is written
 * out here rather than through a shared fixture writer because this suite
 * installs the target package itself and names its own test file, and both are
 * what the run reports. The bodies below are the bodies that file had.
 */

const root = repositoryRoot;

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
        emptyMap.getOrSet("M", "1")

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

@main:
    onError(report => captureRenderError(report.phase, report.error.message))
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
