import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { createWebArtifacts } from "../packages/web/src/host.ts";
import { velarProjectExtension, webIconType, WEB_ICON_TYPES } from "../packages/web/src/project-config.ts";

// ---------------------------------------------------------------------------
// D66 ruling 1B — a Web application can name its own favicon.
//
// `host.ts` hardcoded `<link rel="icon" href="data:,">`, so no VelarScript web
// application could set one: the manifest had no key for it and `Head` owns
// only what changes during a component's life. A favicon is a document-level,
// build-time fact like `web.title`, so it belongs to the manifest.
//
// `data:,` stays the default. That is deliberate, not laziness: an empty inline
// icon stops the browser from requesting `/favicon.ico` on its own, which is
// the right behaviour offline and under the strict production CSP.
//
// The evidence behind the ruling was the built `dist/index.html` of a real
// project, so the probes below run the real CLI over real projects and read the
// document it wrote.
// ---------------------------------------------------------------------------

const root = resolve(new URL("..", import.meta.url).pathname);
const cli = join(root, "packages", "cli", "src", "cli.ts");
const markSvg = join(root, "assets", "brand", "velarscript-mark.svg");

after(removeTemporaryDirectories);

function run(directory: string, arguments_: readonly string[]): Promise<{ readonly output: string; readonly code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("close", (code) => resolvePromise({ output, code }));
  });
}

interface WebProjectOptions {
  readonly web?: Readonly<Record<string, unknown>>;
  /** `publicDir`-relative asset paths written with placeholder bytes. */
  readonly assets?: readonly string[];
}

async function webProject(prefix: string, options: WebProjectOptions = {}): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "public"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "D66 icon", ...options.web },
  }), "utf8");
  await writeFile(join(directory, "src", "main.vel"), "component App:\n    return <main>D66</main>\n\nmount(<App />, \"#app\")\n", "utf8");
  for (const asset of options.assets ?? []) {
    const path = join(directory, "public", asset);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, asset.endsWith(".svg") ? await readFile(markSvg, "utf8") : "icon-bytes", "utf8");
  }
  return directory;
}

/** The `<link rel="icon">` element the framework host wrote into a document. */
function iconLinkOf(html: string): string | null {
  return /<link rel="icon"[^>]*>/u.exec(html)?.[0] ?? null;
}

function document(web: Readonly<Record<string, unknown>>): string {
  return createWebArtifacts({
    config: velarProjectExtension.parse(web, "velar.json"),
    development: false,
    entryPath: "assets/main.js",
    stylesheetPath: null,
    styles: "",
    imports: {},
  }).html;
}

// ---------------------------------------------------------------------------
// The default, and the closed vocabulary that replaces it.
// ---------------------------------------------------------------------------

test("[D66-1B] an unset web.icon keeps the deliberate blank data: icon", async () => {
  assert.equal(iconLinkOf(document({ title: "No icon" })), `<link rel="icon" href="data:,">`);

  const directory = await webProject("velar-d66-icon-unset-");
  const build = await run(directory, ["build"]);
  assert.equal(build.code, 0, build.output);
  const html = await readFile(join(directory, "dist", "index.html"), "utf8");
  assert.equal(iconLinkOf(html), `<link rel="icon" href="data:,">`);
  // `data:` is already an img-src source, so the blank default is legal under
  // the production policy it exists to keep quiet.
  assert.match(html, /img-src 'self' data:/u);
});

test("[D66-1B] each allowed extension reaches the document with its own type", async () => {
  assert.deepEqual([...WEB_ICON_TYPES], [
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".ico", "image/x-icon"],
  ]);
  // One function answers "what type is this icon" for both the validator and
  // the document, so a directory that happens to carry a dot cannot make the
  // two disagree about where the extension starts.
  assert.equal(webIconType("brand.v2/mark.svg"), "image/svg+xml");
  assert.equal(webIconType("brand.svg/mark"), null);
  assert.equal(webIconType(".svg"), null);

  for (const [extension, type] of WEB_ICON_TYPES) {
    const icon = `brand/mark${extension}`;
    const directory = await webProject(`velar-d66-icon-${extension.slice(1)}-`, { web: { icon }, assets: [icon] });
    const build = await run(directory, ["build"]);
    assert.equal(build.code, 0, build.output);
    const html = await readFile(join(directory, "dist", "index.html"), "utf8");
    assert.equal(iconLinkOf(html), `<link rel="icon" type="${type}" href="/${icon}">`);
    // The href has to resolve in the shipped tree, not just parse.
    assert.ok((await readFile(join(directory, "dist", icon))).byteLength > 0);
  }
});

test("[D66-1B] an extension outside the closed set is a manifest error", async () => {
  for (const icon of ["brand/mark.gif", "brand/mark.jpeg", "brand/mark.webp", "brand/mark.SVG", "brand/mark"]) {
    const directory = await webProject("velar-d66-icon-extension-", { web: { icon }, assets: [] });
    const check = await run(directory, ["check"]);
    assert.equal(check.code, 1, check.output);
    assert.match(check.output, /'web\.icon' must name a \.svg, \.png, \.ico file/u);
  }
});

test("[D66-1B] web.icon stays inside publicDir", async () => {
  const rejected: readonly (readonly [icon: unknown, pattern: RegExp])[] = [
    ["/brand/mark.svg", /'web\.icon' must be a relative path inside 'publicDir'/u],
    ["brand\\mark.svg", /'web\.icon' must be a relative path inside 'publicDir'/u],
    ["brand/mark.svg?v=2", /'web\.icon' must be a relative path inside 'publicDir'/u],
    ["../mark.svg", /'web\.icon' must use canonical path segments inside 'publicDir'/u],
    ["brand/./mark.svg", /'web\.icon' must use canonical path segments inside 'publicDir'/u],
    ["brand//mark.svg", /'web\.icon' must use canonical path segments inside 'publicDir'/u],
    ["   ", /'web\.icon' must be a non-empty string without NUL bytes/u],
    [7, /'web\.icon' must be a non-empty string without NUL bytes/u],
  ];
  for (const [icon, pattern] of rejected) {
    assert.throws(() => velarProjectExtension.parse({ icon }, "velar.json"), pattern, String(icon));
  }
  // The key itself is spelled one way; the nearby habit fails closed.
  assert.throws(() => velarProjectExtension.parse({ favicon: "mark.svg" }, "velar.json"), /unknown 'web' field 'favicon'/u);
});

// ---------------------------------------------------------------------------
// The pointer has to be real. A manifest that names a file the build does not
// ship is the same defect class as the reserved-name and symbolic-link
// boundaries `publicDir` already enforces.
// ---------------------------------------------------------------------------

test("[D66-1B] a web.icon with no file behind it fails the build and names the path", async () => {
  const directory = await webProject("velar-d66-icon-missing-", { web: { icon: "brand/velarscript-mark.svg" } });
  // The manifest itself is valid, so `check` — which never reads publicDir —
  // still passes. The build is where the asset boundary lives.
  const check = await run(directory, ["check"]);
  assert.equal(check.code, 0, check.output);

  const build = await run(directory, ["build"]);
  assert.equal(build.code, 1, build.output);
  assert.match(
    build.output,
    /'web\.icon' names public asset 'brand\/velarscript-mark\.svg', but 'public\/brand\/velarscript-mark\.svg' does not exist/u,
  );
  // A failed build leaves no half-written output directory behind.
  await assert.rejects(readFile(join(directory, "dist", "index.html"), "utf8"), /ENOENT/u);
});

test("[D66-1B] a web.icon that is a directory or a link is not a shipped file", async () => {
  const directory = await webProject("velar-d66-icon-not-a-file-", { web: { icon: "brand/mark.png" } });
  await mkdir(join(directory, "public", "brand", "mark.png"), { recursive: true });
  const build = await run(directory, ["build"]);
  assert.equal(build.code, 1, build.output);
  assert.match(build.output, /'web\.icon' names public asset 'brand\/mark\.png', but 'public\/brand\/mark\.png' is not a regular file/u);
});

// ---------------------------------------------------------------------------
// The href is a path the browser has to resolve, so it carries the base the
// stylesheet and entry module already carry.
// ---------------------------------------------------------------------------

test("[D66-1B] the icon href carries web.base exactly as the stylesheet does", async () => {
  const icon = "brand/mark.svg";
  const directory = await webProject("velar-d66-icon-base-", { web: { icon, base: "/studio/" }, assets: [icon] });
  const build = await run(directory, ["build"]);
  assert.equal(build.code, 0, build.output);
  const html = await readFile(join(directory, "dist", "index.html"), "utf8");
  assert.equal(iconLinkOf(html), `<link rel="icon" type="image/svg+xml" href="/studio/brand/mark.svg">`);
  assert.match(html, /<link data-velar-styles rel="stylesheet" href="\/studio\/assets\/styles-[a-f0-9]+\.css">/u);

  // A base without its trailing slash normalizes the same way for both.
  assert.equal(
    iconLinkOf(document({ icon, base: "/studio" })),
    `<link rel="icon" type="image/svg+xml" href="/studio/brand/mark.svg">`,
  );
});

test("[D66-1B] the icon href is escaped like every other attribute the host writes", () => {
  assert.equal(
    iconLinkOf(document({ icon: `brand/a"b&c.png` })),
    `<link rel="icon" type="image/png" href="/brand/a&quot;b&amp;c.png">`,
  );
});

test("[D66-1B] the host refuses an icon it cannot type instead of writing type=\"undefined\"", () => {
  // Only the manifest validator can produce a VelarWebConfig today, and it
  // closes the extension set. This asserts the host does not depend on that
  // being true forever: a configuration that skipped validation is refused the
  // same way an unvalidated configuration already is.
  const unvalidated = { ...velarProjectExtension.parse({}, "velar.json"), icon: "brand/mark.gif" };
  assert.throws(
    () => createWebArtifacts({ config: unvalidated, development: false, entryPath: "assets/main.js", stylesheetPath: null, styles: "", imports: {} }),
    /cannot type the icon 'brand\/mark\.gif'; 'web\.icon' accepts \.svg, \.png, \.ico/u,
  );
});
