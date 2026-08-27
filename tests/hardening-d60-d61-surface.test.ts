import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";

// ---------------------------------------------------------------------------
// The four surface defects an author walks straight into: D61 rule 155 (a bool
// on an `aria-*` attribute asserted the opposite of what the author wrote),
// D60 rule 150 (seven Look properties published a name whose values could not
// be written), D60 rule 151 (`keyframes:` did not reuse the Look value checker
// the charter promises it reuses), and D60 rule 153 (a capability module failed
// at import instead of at the call).
//
// Each probe runs at the level its ruling's evidence was taken at. Rule 155's
// evidence was the rendered DOM, so its regression drives a real Chromium and
// reads the attribute back off the live element; the other three are compile
// and load-time facts and run the toolchain headless.
// ---------------------------------------------------------------------------

const root = repositoryRoot;
const cli = join(root, "packages", "cli", "src", "cli.ts");

after(removeTemporaryDirectories);

interface RunResult {
  readonly output: string;
  readonly code: number | null;
}

function run(arguments_: readonly string[]): Promise<RunResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("close", (code) => resolvePromise({ output, code }));
  });
}

async function webProject(prefix: string, files: ReadonlyMap<string, string>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D60/D61 surface", base: "/" },
  }), "utf8");
  for (const [name, contents] of files) await writeFile(join(directory, "src", name), contents, "utf8");
  return directory;
}

async function desktopProject(prefix: string, files: ReadonlyMap<string, string>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "desktop"), join(directory, "node_modules", "@velarscript", "desktop"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist/renderer",
    extensions: ["@velarscript/desktop"],
    desktop: {
      productName: "D60 rule 153",
      identifier: "dev.velarscript.d60r153",
      permissions: { files: ["project"], processes: [], network: [], environment: ["HOME"], secrets: [] },
    },
  }), "utf8");
  for (const [name, contents] of files) await writeFile(join(directory, "src", name), contents, "utf8");
  return directory;
}

// ---------------------------------------------------------------------------
// D61 rule 155 — an ARIA state is a literal token, not presence and absence.
// ---------------------------------------------------------------------------

test("[D61-155] a bool on aria-* renders the literal token in a real browser", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d61-155-aria-", new Map([
    ["main.vel", `component AriaProbe:
    state busy = false

    def toggle():
        busy = not busy

    return <section>
        <p data-probe aria-busy={busy} aria-hidden={busy} aria-label="probe">{f"busy {busy}"}</p>
        <button type="button" data-press aria-pressed={busy} disabled={busy} on:click={toggle}>press</button>
    </section>

@main: mount(<AriaProbe />, "#app")
`],
    // Before rule 155 every assertion below read "" or null: a true bool became
    // the empty string, which is not an ARIA token, and a false bool removed
    // the attribute -- so aria-busy={pending} claimed the opposite of the truth
    // while pending was true, and said nothing at all while it was false.
    ["aria.browser.test.vel", `import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "an aria bool is a literal token and never leaves the element":
    await browser.open()
    expect(await browser.attribute("[data-probe]", "aria-busy")).toBe("false")
    expect(await browser.attribute("[data-probe]", "aria-hidden")).toBe("false")
    expect(await browser.attribute("[data-press]", "aria-pressed")).toBe("false")
    expect(await browser.attribute("[data-probe]", "aria-label")).toBe("probe")
    expect(await browser.attribute("[data-press]", "disabled")).toBe(null)
    await browser.click("[data-press]")
    await browser.waitForText("[data-probe]", "busy true")
    expect(await browser.attribute("[data-probe]", "aria-busy")).toBe("true")
    expect(await browser.attribute("[data-probe]", "aria-hidden")).toBe("true")
    expect(await browser.attribute("[data-press]", "aria-pressed")).toBe("true")
    expect(await browser.attribute("[data-press]", "disabled")).toBe("")
`],
  ]));
  const result = await run(["test", directory, "--browser", "chromium"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /1 passed, 0 failed/u);
});

test("[D61-155] a static aria bool attribute renders the token, and other attributes are unchanged", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d61-155-static-", new Map([
    ["main.vel", `@main: mount(<p data-probe aria-hidden aria-label="static" hidden>bare</p>, "#app")
`],
    ["static.browser.test.vel", `import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "a bare aria attribute is the true token, a bare native attribute stays empty":
    await browser.open()
    expect(await browser.attribute("[data-probe]", "aria-hidden")).toBe("true")
    expect(await browser.attribute("[data-probe]", "aria-label")).toBe("static")
    expect(await browser.attribute("[data-probe]", "hidden")).toBe("")
`],
  ]));
  const result = await run(["test", directory, "--browser", "chromium"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /1 passed, 0 failed/u);
});

// ---------------------------------------------------------------------------
// D60 rule 150 — a published property has to be able to hold a real value.
// ---------------------------------------------------------------------------

test("[D60-150] the seven Look properties accept their own CSS keywords", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-150-keywords-", new Map([
    ["main.vel", `export const reachable = look:
    isolation = "isolate"
    contain = "content"
    backgroundSize = "cover"
    backgroundPosition = "center"
    transformOrigin = "left"
    transitionProperty = "background-color"
    transitionTimingFunction = "ease-in-out"

export const alsoReachable = look:
    contain = "layout"
    backgroundSize = "contain"
    backgroundPosition = "top"
    transformOrigin = "center"
    transitionProperty = "opacity"
    transitionTimingFunction = "step-start"

@main: mount(<div look={reachable} />, "#app")
`],
  ]));
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
});

test("[D60-150] the closed sets still reject a value the property does not have", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-150-closed-", new Map([
    // Every one of these was accepted before rule 150, because a keyword
    // property with no vocabulary of its own fell back to a generic default
    // list -- so `isolation = "none"` compiled into a declaration CSS discards.
    ["main.vel", `export const wrong = look:
    isolation = "none"

export const wrong2 = look:
    contain = "isolate"

export const wrong3 = look:
    transitionTimingFunction = "none"

export const wrong4 = look:
    transitionProperty = "not-a-property"

export const wrong5 = look:
    backgroundSize = "coverr"

@main: mount(<div />, "#app")
`],
  ]));
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  for (const property of ["isolation", "contain", "transitionTimingFunction", "transitionProperty", "backgroundSize"]) {
    assert.match(checked.output, new RegExp(`VEL5038: Look property '${property}' does not accept`, "u"), checked.output);
  }
});

// ---------------------------------------------------------------------------
// D60 rule 151 — charter section 17 says a stop reuses the Look property and
// value checker. It now does, so a design token is a design token in both.
// ---------------------------------------------------------------------------

test("[D60-151] a keyframe stop reads local and imported design tokens and named arguments", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-151-tokens-", new Map([
    ["theme.vel", `import {Color, Length, rgb} from "velar/look"

export const glow: Color = rgb(120, 150, 255)
export const lift: Length = 12px
export const dim = 0.35
export const grid = "grid"
`],
    ["main.vel", `import {shadow} from "velar/look"
import {dim, glow, lift} from "./theme.vel"

const spinTo: Angle = 1turn

export const tokens = keyframes:
    from:
        color = glow
        opacity = dim
        boxShadow = shadow(0px, 1px, 2px, glow, spread=0px, inset=true)
    to:
        translate = lift
        rotate = spinTo
        opacity = 1

@main: mount(<div />, "#app")
`],
  ]));
  // Before rule 151 every one of these lines was VEL5060: the stop grammar was
  // purely syntactic and answered null for any identifier, so a token had to be
  // transcribed back into a literal to be animated.
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
  const built = await run(["build", directory, "--out-dir", join(directory, "out")]);
  assert.equal(built.code, 0, built.output);
  const { readdir, readFile } = await import("node:fs/promises");
  const assets = join(directory, "out", "assets");
  const styles = (await readdir(assets)).filter((name) => name.endsWith(".css"));
  assert.ok(styles.length > 0, "the build must emit a stylesheet");
  const css = (await Promise.all(styles.map((name) => readFile(join(assets, name), "utf8")))).join("\n");
  // The tokens resolve to the same CSS the builders produce in a Look.
  assert.match(css, /@keyframes velar-kf-[0-9a-f]{32}\{from\{color:rgb\(120 150 255\);opacity:0\.35;box-shadow:inset 0px 1px 2px 0px rgb\(120 150 255\)\}to\{translate:12px;rotate:1turn;opacity:1\}\}/u, css);
});

test("[D60-151] a stop still rejects what cannot lower to static CSS", { timeout: 300_000 }, async () => {
  const directory = await webProject("velar-d60-151-dynamic-", new Map([
    ["main.vel", `def pick() -> number:
    return 1

const computed = pick()

export const frames = keyframes:
    from:
        opacity = computed
    to:
        opacity = 1

@main: mount(<div />, "#app")
`],
  ]));
  const checked = await run(["check", directory]);
  assert.notEqual(checked.code, 0);
  assert.match(checked.output, /VEL5060: A keyframe value must resolve to static CSS/u, checked.output);
});

// ---------------------------------------------------------------------------
// D60 rule 153 — a capability fails at the call, not at the import.
// ---------------------------------------------------------------------------

test("[D60-153] a pure function beside capability imports is unit-testable without a host", { timeout: 300_000 }, async () => {
  const directory = await desktopProject("velar-d60-153-load-", new Map([
    ["capabilities.vel", `import {platform} from "velar/desktop"
import {exists} from "velar/fs"
import {get} from "velar/env"
import {join} from "velar/path"

export def slug(name: string) -> string:
    return name.lower().replace(" ", "-")

export def hostLabel() -> string:
    return f"host: {platform()}"

export def setting(name: string) -> string?:
    return get(name)

export async def present(name: string) -> bool:
    return await exists(join([name]))
`],
    ["main.vel", `import {slug} from "./capabilities.vel"

component Shell:
    return <p>{slug("Release One")}</p>

@main: mount(<Shell />, "#app")
`],
    // Before rule 153 this module could not even be loaded: the Desktop host
    // ABI threw "VelarScript Desktop bridge is unavailable" while the module
    // initialized, so importing a capability made every pure function in the
    // same file untestable outside the host.
    ["capabilities.test.vel", `import {expect} from "velar/test"
import {hostLabel, setting, slug} from "./capabilities.vel"

test "a pure function loads beside four capability imports":
    expect(slug("Release One")).toBe("release-one")

test "the capability itself still fails, at the call":
    expect(() => hostLabel()).toThrow()
    expect(() => setting("HOME")).toThrow()
`],
  ]));
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
  const tested = await run(["test", directory]);
  assert.equal(tested.code, 0, tested.output);
  assert.match(tested.output, /2 passed, 0 failed/u);
});
