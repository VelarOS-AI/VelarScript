import assert from "node:assert/strict";
import test from "node:test";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — the nodes a rendered position owns, from the file that was
 * `tests/web/runtime.slow.test.ts` before it reached 1,214 lines.
 *
 * Wave web: the JSX, DOM and component half of the emitted runtime. Every one
 * of these was a defect the DOM itself decided, so each runs the emitted
 * application in Chromium and asks the document what happened.
 *
 * Two positions here, and one rule between them: a keyed row moves the nodes it
 * has now rather than the ones it was built from, and a children slot is
 * rendered content the showing position owns and can render again. The bodies
 * below are the bodies that file had.
 */

const keyedApplication = `
type Item:
    id: string

state items: List<Item> = [{id: "a"}, {id: "b"}]
state phase: number = 0

component Row(id: string):
    return <>
        <li host data-id={id}>head</li>
        {phase > 0 ? <li data-dyn="yes">second</li> : <li data-dyn="no">first</li>}
    </>

component App:
    def advance():
        phase = 1

    def reorder():
        items = items.reversed()

    return <main>
        <ul data-list>{items.map(row => <Row key={row.id} id={row.id} />)}</ul>
        <button data-advance on:click={advance}>advance</button>
        <button data-reorder on:click={reorder}>reorder</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a keyed reorder moves the nodes a row has now, not the ones it was built from",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(keyedApplication, async (page, failures) => {
      const replaced = await page.evaluateHandle<readonly Element[]>(
        "Array.from(document.querySelectorAll('[data-dyn=\"no\"]'))",
      );
      await page.click("[data-advance]");
      await page.waitForFunction(
        "document.querySelectorAll('[data-dyn=\"yes\"]').length === 2",
      );
      await page.click("[data-reorder]");
      await page.waitForFunction(
        "Array.from(document.querySelectorAll('[data-id]')).map(node => node.dataset.id).join(',') === 'b,a'",
      );

      // The rows a reorder moves are the ones on screen. Before the fix the
      // cached node list put the destroyed nodes back into the document and
      // left the live ones stranded outside their own markers.
      assert.equal(
        await page.evaluate(
          "Array.from(document.querySelectorAll('[data-dyn]')).map(node => node.dataset.dyn).join(',')",
        ),
        "yes,yes",
      );
      assert.equal(
        await page.evaluate(
          (nodes: readonly Element[]) => nodes.filter((node) => node.isConnected).length,
          replaced,
        ),
        0,
      );
      // Every live node still sits between its own region markers, so it can
      // still be updated and removed.
      assert.equal(
        await page.evaluate(
          "Array.from(document.querySelector('[data-list]').childNodes).map(node => node.nodeType === 8 ? '#' + node.data : node.dataset.id ? 'head:' + node.dataset.id : 'dyn:' + node.dataset.dyn).join('|')",
        ),
        "#velar:keyed-start|head:b|#velar:start|dyn:yes|#velar:end|head:a|#velar:start|dyn:yes|#velar:end|#velar:keyed-end",
      );
      assert.deepEqual(failures, []);
    });
  },
);

const childrenApplication = `
state shown: bool = true

component Toggle(children: WebNode):
    return <div data-slot>{shown ? children : null}</div>

component Twice(children: WebNode):
    return <div data-twice><span data-first>{children}</span><span data-second>{children}</span></div>

component App:
    def flip():
        shown = not shown

    return <main>
        <Toggle><p data-inner>inner</p></Toggle>
        <Twice><em data-copy>copy</em></Twice>
        <button data-flip on:click={flip}>flip</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a children slot is rendered content the showing position owns and can render again",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(childrenApplication, async (page, failures) => {
      assert.equal(await page.textContent("[data-slot]"), "inner");
      await page.click("[data-flip]");
      await page.waitForFunction(
        "document.querySelector('[data-slot]').textContent === ''",
      );
      await page.click("[data-flip]");
      // In JSX false means not rendered, and rendering it again is what
      // rendering means. Before the fix the slot was a one-shot fragment: the
      // first time it was hidden the content was destroyed for good.
      await page.waitForFunction(
        "document.querySelector('[data-slot]').textContent === 'inner'",
      );
      // Two positions each render their own subtree.
      assert.equal(await page.textContent("[data-first]"), "copy");
      assert.equal(await page.textContent("[data-second]"), "copy");
      assert.equal(
        await page.evaluate("document.querySelectorAll('[data-copy]').length"),
        2,
      );
      assert.deepEqual(failures, []);
    });
  },
);
