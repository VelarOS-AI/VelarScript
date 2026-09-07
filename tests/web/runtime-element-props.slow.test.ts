import assert from "node:assert/strict";
import test from "node:test";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — what a rendered element carries, from the file that was
 * `tests/web/runtime.slow.test.ts` before it reached 1,214 lines.
 *
 * Wave web: the JSX, DOM and component half of the emitted runtime. Every one
 * of these was a defect the DOM itself decided, so each runs the emitted
 * application in Chromium and asks the document what happened.
 *
 * Three things an element is handed and has to keep: a caller's conditional
 * Look, which refines the condition without losing the component's resting
 * value; a prop nobody reads, which is not re-evaluated, beside the modifiers
 * on the handler next to it; and a URL attribute, which carries a location and
 * never a script scheme. The bodies below are the bodies that file had.
 */

// R3(b) at the level the defect was reported at: the caller writes the property
// only under a condition, so the component's resting value must survive.
const refinedLookApplication = `
export const inner = look:
    color = "black"
    padding = 20px
    if @hover:
        color = "red"

export const caller = look:
    if @hover:
        color = "blue"

component Inner:
    return <div look={inner} data-target>inner</div>

component App:
    return <main><Inner look={caller} /></main>

mount(<App />, "#app")
`.trimStart();

test(
  "a caller's conditional Look refines the condition and keeps the resting value",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(refinedLookApplication, async (page, failures) => {
      const applied = await page.evaluate(`(() => {
        const element = document.querySelector("[data-target]");
        return {
          tokens: element.getAttribute("data-velar-look"),
          base: element.style.getPropertyValue("--velar-look-base-color"),
          hover: element.style.getPropertyValue("--velar-look-hover-color"),
          padding: element.style.getPropertyValue("--velar-look-base-padding"),
        };
      })()`);
      assert.deepEqual(applied, {
        tokens: "base:color base:padding hover:color",
        base: "black",
        hover: "blue",
        padding: "20px",
      });
      assert.deepEqual(failures, []);
    });
  },
);

const surfaceApplication = `
let heavyRuns = ""

state count: number = 0
state dismissed: number = 0
state revision: number = 0

def heavy(value: number) -> string:
    heavyRuns = heavyRuns + "x"
    return str(value)

def at(_: number, text: string) -> string:
    return text

component Child(unused: string):
    return <p data-child>fixed</p>

component App:
    def dismiss():
        dismissed = dismissed + 1

    def bump():
        count = count + 1

    def refresh():
        revision = revision + 1

    return <main>
        <Child unused={heavy(count)} />
        <p data-heavy>{at(revision, heavyRuns)}</p>
        <div data-group role="group" on:click.self.once={dismiss}>
            <button data-inner type="button">child</button>
        </div>
        <p data-dismissed>{dismissed}</p>
        <button data-bump on:click={bump}>bump</button>
        <button data-refresh on:click={refresh}>refresh</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "an unread prop is not re-evaluated and on:click.self.once still fires for the element itself",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(surfaceApplication, async (page, failures) => {
      await page.click("[data-bump]");
      await page.click("[data-bump]");
      await page.click("[data-refresh]");
      await page.waitForFunction(
        "document.querySelector('[data-heavy]').textContent !== ''",
      );
      // The prop expression runs once, when the component reads the prop it
      // declared. Before the fix an eager observer pushed it on every change of
      // a value the child's DOM never shows.
      assert.equal(await page.textContent("[data-heavy]"), "x");

      // A bubbled click from a descendant is filtered by 'self', and must not
      // spend the 'once' registration on the way.
      await page.click("[data-inner]");
      assert.equal(await page.textContent("[data-dismissed]"), "0");
      await page.evaluate("document.querySelector('[data-group]').click()");
      await page.waitForFunction(
        "document.querySelector('[data-dismissed]').textContent === '1'",
      );
      await page.evaluate("document.querySelector('[data-group]').click()");
      await page.waitForTimeout(50);
      assert.equal(await page.textContent("[data-dismissed]"), "1");
      assert.deepEqual(failures, []);
    });
  },
);

const urlApplication = `
state target = "/settings"

component App:
    def attack():
        target = "javascript:globalThis.velarPwned = 1"

    return <main>
        <a data-link href={target}>open</a>
        <button data-attack on:click={attack}>attack</button>
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "URL attributes carry locations, never script schemes",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(urlApplication, async (page, failures) => {
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-link]').getAttribute('href')",
        ),
        "/settings",
      );
      await page.click("[data-attack]");
      await page.waitForTimeout(100);
      // The value is refused rather than written, so the anchor keeps the last
      // location it had and nothing executes.
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-link]').getAttribute('href')",
        ),
        "/settings",
      );
      await page.evaluate("document.querySelector('[data-link]').click()");
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate("globalThis.velarPwned ?? null"), null);
      assert.equal(failures.length, 1);
      assert.match(
        failures[0] ?? "",
        /JSX attribute 'href' rejected the 'javascript:' URL scheme/u,
      );
    });
  },
);
