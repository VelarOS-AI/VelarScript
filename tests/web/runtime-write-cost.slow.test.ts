import assert from "node:assert/strict";
import test from "node:test";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — what one update costs, from the file that was
 * `tests/web/runtime.slow.test.ts` before it reached 1,214 lines.
 *
 * Wave web: the JSX, DOM and component half of the emitted runtime. Every one
 * of these was a defect the DOM itself decided, so each runs the emitted
 * application in Chromium and asks the document what happened.
 *
 * Both probes here are about the size of the work an assignment causes: a write
 * to one element of a rendered List costs the same whatever the List's length,
 * and more observers than the queue bound is the flush budget's failure to
 * report rather than an exception thrown out of the assignment that crossed it.
 * The bodies below are the bodies that file had.
 */

function listApplication(size: number): string {
  return `
type Item:
    id: string
    title: string

state items: List<Item> = []

component App:
    def build():
        let next: List<Item> = []
        let index = 0
        while index < ${String(size)}:
            next.append({id: str(index), title: "t"})
            index = index + 1
        items = next

    def rewrite():
        let index = 0
        while index < 2000:
            items[index] = {id: str(index), title: "u"}
            index = index + 1

    return <main>
        <ul data-list>{items.map(row => <li key={row.id}>{row.title}</li>)}</ul>
        <button data-build on:click={build}>build</button>
        <button data-rewrite on:click={rewrite}>rewrite</button>
    </main>

mount(<App />, "#app")
`.trimStart();
}

async function rewriteCost(size: number): Promise<number> {
  let elapsed = 0;
  await mountInChromium(listApplication(size), async (page, failures) => {
    await page.click("[data-build]");
    await page.waitForFunction(
      `document.querySelectorAll('[data-list] li').length === ${String(size)}`,
      undefined,
      { timeout: 60_000 },
    );
    elapsed = await page.evaluate(
      "(() => { const started = performance.now(); document.querySelector('[data-rewrite]').click(); return performance.now() - started; })()",
    );
    assert.deepEqual(failures, []);
  });
  return elapsed;
}

test(
  "an element write on a rendered List costs the same whatever the List's length",
  { timeout: 300_000 },
  async () => {
    const small = await rewriteCost(2000);
    const large = await rewriteCost(40_000);
    // Containment used to be re-derived by scanning the whole container on
    // every write, so the same 2000 writes cost twenty times more at twenty
    // times the length. The bound is loose enough for a busy machine and far
    // inside the linear cost it replaces.
    assert.ok(
      large <= small * 6 + 250,
      `2000 element writes cost ${String(Math.round(small))}ms at 2000 rows and ${String(Math.round(large))}ms at 40000 rows`,
    );
  },
);

const attributeStormApplication = `
type Row:
    id: string

state theme = "light"
state rows: List<Row> = []

component Cell(id: string, theme: string):
    return <li ${Array.from({ length: 30 }, (_, index) => `data-x${String(index)}={theme}`).join(" ")} data-id={id}>x</li>

component App:
    def build():
        let next: List<Row> = []
        let index = 0
        while index < 3500:
            next.append({id: str(index)})
            index = index + 1
        rows = next

    def toggle():
        theme = theme == "light" ? "dark" : "light"

    return <main>
        <ul data-list>{rows.map(row => <Cell key={row.id} id={row.id} theme={theme} />)}</ul>
        <button data-build on:click={build}>build</button>
        <button data-toggle on:click={toggle}>toggle</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "more observers than the queue bound is the flush budget's failure, not the assignment's",
  { timeout: 300_000 },
  async () => {
    await mountInChromium(attributeStormApplication, async (page, failures) => {
      await page.click("[data-build]");
      await page.waitForFunction(
        "document.querySelectorAll('[data-id]').length === 3500",
        undefined,
        { timeout: 120_000 },
      );
      await page.click("[data-toggle]");
      // 105000 attribute observers on one cell. Throwing from the queue left
      // the writing cell's subscriber walk half finished, with the last rows
      // subscribed and never notified again; the budget instead reports once
      // and finishes the work on the following microtask.
      await page.waitForFunction(
        "Array.from(document.querySelectorAll('[data-id]')).every(node => node.getAttribute('data-x29') === 'dark')",
        undefined,
        { timeout: 120_000 },
      );
      assert.ok(
        failures.every((failure) =>
          /Reactive updates cannot run more than 100000 observers in one task/u.test(failure)
        ),
        failures.join(" | "),
      );
    });
  },
);
