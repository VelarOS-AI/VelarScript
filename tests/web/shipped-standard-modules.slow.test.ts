import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { standardModuleSource } from "../../packages/cli/src/standard-modules.ts";
import { LOOK_TRANSITION_PROPERTY_KEYWORDS } from "../../packages/web/src/look.ts";
import { velarCompilerExtension } from "../../packages/web/src/compiler.ts";
import { runBrowserFixture } from "../support/web-marathon-fixture.ts";

/**
 * D115 P5 — the standard modules a build actually ships, one subject of the
 * file that was `tests/web/reactive-graph-and-runtime-abi.slow.test.ts` before
 * it reached 881 lines.
 *
 * Fix wave 2 of the marathon defect ledger
 * (docs/decisions/archive/MARATHON-DEFECTS.md): the Web runtime items. Each
 * probe stays at the level the ledger's evidence was taken at.
 *
 * The subject held here is the artefact each of these five defects was in: not
 * the compiler, but the two runtime module sources a build writes out —
 * `velar/web`, which publishes Link, NavLink, Head and Router, and
 * `velar/look`, which publishes the transition and asset builders. Three of
 * them load that source directly and drive it; the two prop-reading ones build
 * a page that imports it, because reading a prop again is something an update
 * does. The bodies below are the bodies that file had.
 */

// ---------------------------------------------------------------------------
// web-4 / web-24 / web-28 / web-38: the two runtime module sources the CLI
// ships as standard modules. Each probe runs the shipped module itself -- the
// browser one in Chromium, because the defect was a URL the browser executed.
// ---------------------------------------------------------------------------

/** The velar/* module source a build writes, with the Web extension active. */
function shippedModule(name: string): string {
  const source = standardModuleSource(name, { base: "/" }, [velarCompilerExtension]);
  assert.ok(source, `${name} has no standard module source`);
  return source;
}

interface LookModule {
  readonly transition: (property: string, duration: string, easing?: string, delay?: string) => string;
  readonly asset: (path: string) => string;
}

/** Imports velar/look the way a built application does: as its own module. */
async function lookModule(): Promise<LookModule> {
  const directory = await mkdtemp(join(tmpdir(), "velar-marathon-look-"));
  const file = join(directory, "look.mjs");
  await writeFile(file, shippedModule("velar/look"), "utf8");
  return await import(pathToFileURL(file).href) as LookModule;
}

interface LinkProbe {
  readonly javascriptTarget: string;
  readonly navLinkTarget: string;
  readonly whitespaceTarget: string;
  readonly relativeHref: string | null;
  readonly externalHref: string | null;
  readonly relativePrevented: boolean;
  readonly externalPrevented: boolean;
  readonly relativePath: string;
}

test("[web-4] Link and NavLink refuse a target whose scheme is code", { timeout: 180_000 }, async () => {
  // isExternal classified 'javascript:' as external, so Link wrote it to
  // node.href and its click handler returned before preventDefault -- native
  // anchor activation then ran the script. Executing the shipped module read
  // the probe back as 1 with location.pathname unchanged.
  // A Link reads its props inside an observer, the way every framework
  // component now does, so the probe installs the reactive registry the way a
  // built application does -- velar/app carries the runtime foundation -- before
  // importing the module under test.
  const sources = { runtime: shippedModule("velar/app"), web: shippedModule("velar/web") };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A real origin, because the click handler compares the anchor's origin
    // with the document's before it intercepts anything.
    await page.route("**/*", (route) => route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body></body></html>",
    }));
    await page.goto("https://velar.test/");
    const probe: LinkProbe = await page.evaluate(async (moduleSources: { runtime: string; web: string }) => {
      const load = (moduleSource: string): Promise<unknown> =>
        import(URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" })));
      await load(moduleSources.runtime);
      const web = await load(moduleSources.web) as {
        Link: (props: Record<string, unknown>) => { node: HTMLAnchorElement; __mount: () => void };
        NavLink: (props: Record<string, unknown>) => unknown;
      };
      const refusal = (build: () => unknown): string => {
        try { build(); return "accepted"; }
        catch (error) { return String(error); }
      };
      // A click that reaches the document is the one the browser would act on,
      // so reading defaultPrevented there says whether Link intercepted it --
      // and preventing it there keeps the probe's own page from navigating.
      let prevented = false;
      document.addEventListener("click", (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      });
      const click = (to: string): boolean => {
        const instance = web.Link({ to, children: "Open" });
        document.body.append(instance.node);
        instance.__mount();
        instance.node.click();
        return prevented;
      };
      return {
        javascriptTarget: refusal(() => web.Link({ to: "javascript:globalThis.__velarProbePwned = 1; void 0", children: "Open" })),
        navLinkTarget: refusal(() => web.NavLink({ to: "javascript:void 0", children: "Open" })),
        whitespaceTarget: refusal(() => web.Link({ to: " java\tscript:void 0", children: "Open" })),
        relativeHref: web.Link({ to: "/about", children: "Open" }).node.getAttribute("href"),
        externalHref: web.Link({ to: "https://example.com/x", children: "Open" }).node.getAttribute("href"),
        relativePrevented: click("/about"),
        externalPrevented: click("https://example.com/x"),
        relativePath: location.pathname,
      };
    }, sources);
    for (const rejection of [probe.javascriptTarget, probe.whitespaceTarget]) {
      assert.match(rejection, /^TypeError: Link target rejected the 'javascript:' URL scheme/u);
    }
    assert.match(probe.navLinkTarget, /^TypeError: NavLink target rejected the 'javascript:' URL scheme/u);
    // The two targets a Link is for keep working, and keep the split the click
    // handler has always made: an application path is intercepted, an external
    // one is left to the browser.
    assert.equal(probe.relativeHref, "/about");
    assert.equal(probe.externalHref, "https://example.com/x");
    assert.equal(probe.relativePrevented, true);
    assert.equal(probe.externalPrevented, false);
    assert.equal(probe.relativePath, "/about");
  } finally {
    await browser.close();
  }
});

test("[web-24] Head reads its props on every update instead of once at construction", { timeout: 180_000 }, async () => {
  // __velarSnapshotProps read every prop exactly once through
  // __velarInternalRead, which is both untracked and excluded from D70's
  // frozen-read report: a title built from state stayed at the value the first
  // render saw, with no diagnostic and no console report. Document metadata is
  // rendered output, so Head follows Vel's ordinary rules and takes live props.
  const output = await runBrowserFixture("velar-marathon-web-head-", {
    application: `
import {Head} from "velar/web"

state unread = 0
state showHead = true

def bump():
    unread += 1

def hide():
    showHead = false

component App:
    return <main>
        {showHead ? <Head title={f"Inbox ({unread})"} description={f"unread {unread}"} language="de" /> : null}
        <button data-bump on:click={bump}>bump</button>
        <button data-hide on:click={hide}>hide</button>
        <span data-unread>{str(unread)}</span>
    </main>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "Head metadata follows the state it is built from":
    await browser.open("/")
    expect(await browser.text("title")).toBe("Inbox (0)")
    expect(await browser.attribute("meta[name='description']", "content")).toBe("unread 0")
    expect(await browser.attribute("html", "lang")).toBe("de")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Inbox (1)")
    expect(await browser.attribute("meta[name='description']", "content")).toBe("unread 1")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "2")
    expect(await browser.text("title")).toBe("Inbox (2)")

test "a removed Head gives the document back":
    await browser.open("/")
    await browser.click("[data-bump]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Inbox (1)")
    await browser.click("[data-hide]")
    await browser.waitForText("[data-unread]", "1")
    expect(await browser.text("title")).toBe("Marathon Web hardening")
    expect(await browser.attribute("html", "lang")).toBe("en")
`,
  });
  assert.match(output, /2 passed, 0 failed/u);
});

test("[web-24b] Router, Link and NavLink read their props on every update too", { timeout: 180_000 }, async () => {
  // D90's R4-a revision: leaving Head live and the other three snapshotting put
  // two behaviours behind one idea, and an author had to remember which
  // framework component was which. One rule covers all four -- reactive state
  // changed, the component updates -- so a Link follows the target it was given,
  // a NavLink moves its aria-current with it, and a routes table built from
  // state re-renders the position it fills.
  const output = await runBrowserFixture("velar-marathon-web-live-props-", {
    application: `
import {Link, NavLink, RouteContext, Router, route} from "velar/web"

state target = "/"
state swapped = false

component Alpha(route: RouteContext):
    return <article data-page>alpha</article>

component Beta(route: RouteContext):
    return <article data-page>beta</article>

component App:
    computed routes = swapped ? [route("/", Beta)] : [route("/", Alpha)]

    def move():
        target = "/elsewhere"

    def swap():
        swapped = true

    return <main>
        <nav data-links aria-label="plain">
            <Link to={target} style:color={target == "/" ? "blue" : "green"}>go</Link>
        </nav>
        <nav data-navs aria-label="current">
            <NavLink to={target} exact={true}>here</NavLink>
        </nav>
        <Router routes={routes} />
        <p data-target>{target}</p>
        <button data-move on:click={move}>move</button>
        <button data-swap on:click={swap}>swap</button>
    </main>

@main: mount(<App />, "#app")
`,
    tests: `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "a Link and a NavLink follow the target they were given":
    await browser.open("/")
    expect(await browser.attribute("[data-links] a", "href")).toBe("/")
    expect(await browser.attribute("[data-navs] a", "aria-current")).toBe("page")
    // 'style:' on a component host decorates the instance root, and a Link is
    // a component host like any other.
    expect(await browser.style("[data-links] a", "color")).toBe("rgb(0, 0, 255)")
    await browser.click("[data-move]")
    await browser.waitForText("[data-target]", "/elsewhere")
    expect(await browser.style("[data-links] a", "color")).toBe("rgb(0, 128, 0)")
    expect(await browser.attribute("[data-links] a", "href")).toBe("/elsewhere")
    expect(await browser.attribute("[data-navs] a", "href")).toBe("/elsewhere")
    expect(await browser.attribute("[data-navs] a", "aria-current")).toBe(null)

test "a routes table built from state re-renders the Router":
    await browser.open("/")
    expect(await browser.text("[data-page]")).toBe("alpha")
    await browser.click("[data-swap]")
    await browser.waitForText("[data-page]", "beta")
`,
  });
  assert.match(output, /2 passed, 0 failed/u);
});

test("[web-28] the transition builder takes the vocabulary its longhand takes", async () => {
  // charter 3549 says the two transition longhands take the vocabularies the
  // matching builders take. transitionProperty read a closed set while the
  // builder read nothing, so the longhand taught the CSS spelling the builder
  // silently accepted and the browser discarded.
  assert.ok(LOOK_TRANSITION_PROPERTY_KEYWORDS.has("background-color"));
  assert.ok(!LOOK_TRANSITION_PROPERTY_KEYWORDS.has("backgroundColor"));
  const look = await lookModule();
  assert.throws(() => look.transition("backgroundColor", "200ms"), {
    name: "TypeError",
    message: "Transition property 'backgroundColor' is not a CSS property name; did you mean 'background-color'?",
  });
  assert.throws(() => look.transition("bakcground", "200ms"), {
    name: "TypeError",
    message: "Transition property 'bakcground' is not an animatable CSS property name",
  });
  // A property that does not interpolate is outside the set for the same reason
  // `keyframes:` rejects it, and the two aggregate keywords stay reachable.
  assert.throws(() => look.transition("display", "200ms"), { name: "TypeError" });
  assert.equal(look.transition("background-color", "200ms"), "background-color 200ms ease");
  assert.equal(look.transition("all", "200ms", "linear"), "all 200ms linear");
});

test("[web-38] asset() writes a CSS string, not a JSON string", async () => {
  // JSON and CSS agree on '"' and '\' and nothing else: CSS reads a backslash
  // before a non-hex character as that literal character, so JSON's "\n"
  // resolved to the letter 'n' and asset("a\nb") addressed the path "anb".
  const look = await lookModule();
  assert.equal(look.asset("a\nb"), 'url("a\\A b")');
  assert.equal(look.asset("a\tb"), 'url("a\\9 b")');
  assert.equal(look.asset("a\u007Fb"), 'url("a\\7F b")');
  assert.equal(look.asset('a"b\\c'), 'url("a\\"b\\\\c")');
  // Everything CSS can carry literally in a UTF-8 stylesheet stays literal.
  assert.equal(look.asset("/logo—2.png"), 'url("/logo—2.png")');
});
