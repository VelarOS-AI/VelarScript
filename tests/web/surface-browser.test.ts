import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../support/repository-root.ts";
import { runCommand } from "../support/run-command.ts";
import { linkVelarExtension } from "../support/web-project.ts";

/**
 * D115 P5 — the live-page half of the Web surface audit, from the file that was
 * `tests/web/surface.test.ts` before it reached 1,464 lines.
 *
 * Four of the ledger's items were measured on a running page and are held at
 * that level here: the two Look forms that stay reactive, real computed layout
 * from Look lengths, bind member paths, and `bind:group`. One application and
 * one browser suite carry all four, so the page is built and driven once. The
 * fixture writer stays in this file rather than moving to `tests/support`,
 * because the project title and the test file's name are what a run reports and
 * they are this suite's.
 */

const root = repositoryRoot;

// ---------------------------------------------------------------------------
// Browser evidence: the ledger measured these four items on a live page.
// ---------------------------------------------------------------------------

async function runBrowserFixture(application: string, tests: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-web-surface-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await linkVelarExtension(directory, "web");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "Web surface hardening" },
    }), "utf8");
    await writeFile(join(directory, "src", "main.vel"), application, "utf8");
    await writeFile(join(directory, "src", "surface.browser.test.vel"), tests, "utf8");
    return await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser", "chromium",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const surfaceApplication = String.raw`
import {measure} from "velar/browser"

type Profile:
    name: string

const wideLook = look:
    width = 120px
    height = 20px

const narrowLook = look:
    width = 40px
    height = 20px

const textLook = look:
    width = 30px
    fontSize = 10px
    lineHeight = 3

component App:
    state wide = false
    state profile: Profile = {name: "start"}
    state plan = "team"
    state extras: List<string> = []
    state reading = "pending"

    let composed: Element? = null
    let directive: Element? = null
    let text: Element? = null
    let field: InputElement? = null

    def flip():
        wide = not wide

    def rename():
        profile.name = "written"

    // One reading covers every layout question: the composed Look, the
    // look: directive, an unitless lineHeight, and the bound input's DOM value.
    def sample():
        const first = composed
        const second = directive
        const third = text
        const input = field
        if first == null or second == null or third == null or input == null:
            return null
        reading = f"{str(measure(first).width)}|{str(measure(second).width)}|{str(measure(third).height)}|{input.value}"
        return null

    return <main>
        <div data-composed ref={composed} look={wide ? wideLook : narrowLook}></div>
        <div data-directive ref={directive} look:width={wide ? 120px : 40px} look:height={20px}></div>
        <div data-text ref={text} look={textLook}>ab</div>
        <input data-name ref={field} bind:value={profile.name} aria-label="Name" />
        <p data-name-echo>{profile.name}</p>
        <input data-solo type="radio" value="solo" bind:group={plan} aria-label="Solo" />
        <input data-team type="radio" value="team" bind:group={plan} aria-label="Team" />
        <input data-scale type="radio" value="scale" bind:group={plan} aria-label="Scale" />
        <p data-plan>{plan}</p>
        <input data-digest type="checkbox" value="digest" bind:group={extras} aria-label="Digest" />
        <input data-weekly type="checkbox" value="weekly" bind:group={extras} aria-label="Weekly" />
        <p data-extras>{f"{str(extras.size)}:{extras.join(",")}"}</p>
        <button data-flip type="button" on:click={flip}>flip</button>
        <button data-rename type="button" on:click={rename}>rename</button>
        <button data-sample type="button" on:click={sample}>sample</button>
        <p data-reading>{reading}</p>
    </main>

@main: mount(<App />, "#app")
`;

const surfaceTests = String.raw`
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "reactive look forms stay live and lengths reach layout":
    await browser.open("/")
    await browser.click("[data-sample]")
    // 40px wide from the composed Look and the look: directive; the unitless
    // lineHeight of 3 over a 10px font measures 30px tall.
    await browser.waitForText("[data-reading]", "40|40|30|start")
    await browser.click("[data-flip]")
    await browser.click("[data-sample]")
    await browser.waitForText("[data-reading]", "120|120|30|start")

test "bind member path binds both directions":
    await browser.open("/")
    expect(await browser.text("[data-name-echo]")).toBe("start")
    await browser.fill("[data-name]", "typed")
    await browser.waitForText("[data-name-echo]", "typed")
    await browser.click("[data-rename]")
    await browser.waitForText("[data-name-echo]", "written")
    await browser.click("[data-sample]")
    await browser.waitForText("[data-reading]", "40|40|30|written")

test "radio group switches three ways":
    await browser.open("/")
    expect(await browser.text("[data-plan]")).toBe("team")
    await browser.click("[data-solo]")
    await browser.waitForText("[data-plan]", "solo")
    await browser.click("[data-scale]")
    await browser.waitForText("[data-plan]", "scale")
    await browser.click("[data-team]")
    await browser.waitForText("[data-plan]", "team")

test "checkbox group adds and removes members":
    await browser.open("/")
    expect(await browser.text("[data-extras]")).toBe("0:")
    await browser.click("[data-digest]")
    await browser.waitForText("[data-extras]", "1:digest")
    await browser.click("[data-weekly]")
    await browser.waitForText("[data-extras]", "2:digest,weekly")
    await browser.click("[data-digest]")
    await browser.waitForText("[data-extras]", "1:weekly")
    await browser.click("[data-weekly]")
    await browser.waitForText("[data-extras]", "0:")
`;

test("[N-2c] the reactive Look forms, Look lengths, bind paths, and bind groups hold in Chromium", { timeout: 180_000 }, async () => {
  const output = await runBrowserFixture(surfaceApplication, surfaceTests);
  assert.match(output, /4 passed, 0 failed/u);
});
