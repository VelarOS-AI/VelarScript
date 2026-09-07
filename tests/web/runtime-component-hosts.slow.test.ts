import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { compile as compileCore } from "@velarscript/compiler";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";
import { mountInChromium } from "../support/mount-in-chromium.ts";

/**
 * D115 P5 — where a component's host boundary is, from the file that was
 * `tests/web/runtime.slow.test.ts` before it reached 1,214 lines.
 *
 * Wave web: the JSX, DOM and component half of the emitted runtime. Every one
 * of these was a defect the DOM itself decided, so each runs the emitted
 * application in Chromium and asks the document what happened.
 *
 * The subject held here is that boundary: a nested component's host stays its
 * own one level below its root, two levels below it, inside a nested component
 * of a nested component, and at the enclosing component's own root level —
 * together with the two shapes the walk must still refuse, a second host
 * decided at render time and a multi-root component with no host at all. The
 * last of those is the one probe here that never reaches a document, because
 * being refused before it renders is what it asserts. The bodies below are the
 * bodies that file had.
 */

const hostApplication = `
component Field:
    return <>
        <label>L</label>
        <input host data-field />
    </>

component Card:
    return <>
        <header data-header>H</header>
        <div host data-card>
            <Field />
        </div>
    </>

component Forwarded:
    return <Field />

component App:
    return <main>
        <Card look:color={"red"} />
        <Forwarded look:color={"blue"} />
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a nested component's host stays its own and the enclosing one keeps forwarding",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(hostApplication, async (page, failures) => {
      // The caller's look lands on the outer component's own host element, not
      // on the nested component's. Before the fix the subtree scan counted the
      // nested host as a second host and the whole region collapsed to a
      // region collapsed into the compiler-owned fatal state.
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-card]').getAttribute('data-velar-look')",
        ),
        "base:color",
      );
      assert.equal(
        await page.evaluate(
          "document.querySelector('[data-header]').getAttribute('data-velar-look')",
        ),
        null,
      );
      // A component whose root is another component still forwards to that
      // component's host in turn.
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('[data-field]')[1].getAttribute('data-velar-look')",
        ),
        "base:color",
      );
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('[data-field]')[0].getAttribute('data-velar-look')",
        ),
        null,
      );
      assert.equal(
        await page.evaluate(
          "document.querySelectorAll('#app main > *').length > 0",
        ),
        true,
      );
      assert.deepEqual(failures, []);
    });
  },
);

// Three nesting depths for one boundary: a nested component's host sits one
// level below its root, two levels below it, and inside a nested component of a
// nested component. Skipping the marked root alone left every one of these
// counted as a second host of the enclosing component.
const buriedHostApplication = `
component One:
    return <>
        <label>L</label>
        <div><input host data-one /></div>
    </>

component Two:
    return <>
        <label>L</label>
        <section><div><input host data-two /></div></section>
    </>

component Three:
    return <>
        <span>S</span>
        <div><One /></div>
        <p><input host data-three /></p>
    </>

component Card:
    return <>
        <header><One /></header>
        <div host data-card>D</div>
    </>

component Deep:
    return <>
        <header><Two /></header>
        <div host data-deep>D</div>
    </>

component Outer:
    return <>
        <header><Three /></header>
        <div host data-outer>D</div>
    </>

component App:
    return <main>
        <Card look:color={"red"} />
        <Deep look:color={"green"} />
        <Outer look:color={"blue"} />
    </main>

mount(<App />, "#app")
`.trimStart();

// The analyzer refuses a statically visible second host (VEL5043), so the
// runtime message is only reachable where the second host is decided at render
// time. That is also the case that proves the boundary walk still finds this
// component's own hosts at depth.
const twoHostApplication = `
state flag: bool = true

component Card:
    return <>
        <div><span host data-x>x</span></div>
        <div>{flag ? <span host data-y>y</span> : null}</div>
    </>

component App:
    return <main><Card look:color={"red"} /></main>

mount(<App />, "#app")
`.trimStart();

test(
  "a host buried in a nested component stays that component's at every depth",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(buriedHostApplication, async (page, failures) => {
      const looks = await page.evaluate(`(() => {
        const read = (selector) => {
          const element = document.querySelector(selector);
          return element === null ? null : [
            element.getAttribute("data-velar-look"),
            element.style.getPropertyValue("--velar-look-base-color"),
          ];
        };
        return {
          card: read("[data-card]"), deep: read("[data-deep]"), outer: read("[data-outer]"),
          one: read("[data-one]"), two: read("[data-two]"), three: read("[data-three]"),
          collapsed: document.querySelector("#app").querySelector("[data-velar-fatal]") !== null,
        };
      })()`);
      // Each caller's look lands on the outer component's own host, and the
      // buried hosts keep carrying nothing of the caller's.
      assert.deepEqual(looks, {
        card: ["base:color", "red"],
        deep: ["base:color", "green"],
        outer: ["base:color", "blue"],
        one: [null, ""],
        two: [null, ""],
        three: [null, ""],
        collapsed: false,
      });
      assert.deepEqual(failures, []);
    });
  },
);

// The same boundary standing at the root level. A nested component placed
// among the enclosing component's own root nodes carries its host on its own
// marked root, which the resolver read as a second host of the enclosing one —
// the buried-host defect one step sideways. 'Sibling' pairs it with an own host
// beside it, 'Deeper' with an own host below root level, 'Sides' with two nested
// components at once, and 'Chain' forwards twice with no own host at all.
const rootLevelHostApplication = `
component Leaf:
    return <>
        <i data-leaf>a</i>
        <b host data-leaf-host>b</b>
    </>

component Mid:
    return <Leaf />

component Sibling:
    return <>
        <header host data-sibling>H</header>
        <Leaf />
    </>

component Deeper:
    return <>
        <header><span host data-deeper>H</span></header>
        <Leaf />
    </>

component Sides:
    return <>
        <header host data-pair>H</header>
        <Leaf />
        <Leaf />
    </>

component Chain:
    return <Mid />

component App:
    return <main>
        <Sibling look:color={"red"} />
        <Deeper look:color={"green"} />
        <Sides look:color={"blue"} />
        <Chain look:color={"purple"} />
    </main>

mount(<App />, "#app")
`.trimStart();

test(
  "a nested component's host at the enclosing root level stays its own",
  { timeout: 120_000 },
  async () => {
    await mountInChromium(rootLevelHostApplication, async (page, failures) => {
      const looks = await page.evaluate(`(() => {
        const describe = (element) => element === null ? null : [
          element.getAttribute("data-velar-look"),
          element.style.getPropertyValue("--velar-look-base-color"),
        ];
        const read = (selector) => describe(document.querySelector(selector));
        return {
          sibling: read("[data-sibling]"), deeper: read("[data-deeper]"), pair: read("[data-pair]"),
          // Four Leaf instances in document order: Sibling's, Deeper's, Sides's
          // two, then Chain's, which is the only host forwarded to.
          leaves: Array.from(document.querySelectorAll("[data-leaf-host]"), describe),
          collapsed: document.querySelector("#app").querySelector("[data-velar-fatal]") !== null,
        };
      })()`);
      assert.deepEqual(looks, {
        sibling: ["base:color", "red"],
        deeper: ["base:color", "green"],
        pair: ["base:color", "blue"],
        leaves: [
          [null, ""],
          [null, ""],
          [null, ""],
          [null, ""],
          ["base:color", "purple"],
        ],
        collapsed: false,
      });
      assert.deepEqual(failures, []);
    });
  },
);

test(
  "a component that really declares two hosts still says so",
  { timeout: 120_000 },
  async () => {
    const result = compileCore(twoHostApplication, {
      extensions: [velarCompilerExtension],
    });
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
      await page.addScriptTag({ content: result.code ?? "", type: "module" });
      await page.waitForFunction(
        "document.querySelector('#app').childNodes.length > 0",
      );
      assert.deepEqual(failures, [
        "TypeError: A component can declare only one host element",
      ]);
    } finally {
      await browser.close();
    }
  },
);

test("a multi-root component with no host is refused before it renders", () => {
  const result = compileCore(
    [
      "component Card:",
      "    return <>",
      "        <div data-a>a</div>",
      "        <div data-b>b</div>",
      "    </>",
      "",
      "component App:",
      '    return <main><Card look:color={"red"} /></main>',
      "",
      'mount(<App />, "#app")',
      "",
    ].join("\n"),
    { extensions: [velarCompilerExtension] },
  );
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.message), [
    "Component 'Card' has multiple roots and must mark exactly one native element with 'host'",
  ]);
});
