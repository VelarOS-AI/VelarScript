import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import type { Program } from "@velarscript/compiler/extension";
import type { WebUnsafeCssDeclaration } from "../packages/web/src/ast.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { cssTokens, type CssToken } from "../packages/web/src/css-tokens.ts";
import { velarWebInspectionExtension } from "../packages/web/src/inspection.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

after(removeTemporaryDirectories);

const compileWeb = (source: string, resourceContents: ReadonlyMap<string, string> = new Map()) =>
  compileCore(source, { extensions: [velarCompilerExtension], resourceContents });

const inlineCssSource = [
  "unsafe css`",
  "    .before::before {",
  '        content: "\\n ${token} {value}";',
  "    }",
  "` before look",
  "",
  "const cardLook = look:",
  '    color = "red"',
  "",
  "component Card:",
  '    return <article look={cardLook}>Card</article>',
  "",
  "unsafe css`",
  "    .after { color: purple; }",
  "` after look",
  "",
].join("\n");

test("[D53] inline unsafe CSS is raw and keeps the explicit before/Look/after order", () => {
  const result = compileWeb(inlineCssSource);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.styleSegments);
  assert.match(result.styleSegments.before, /\.before::before/u);
  assert.match(result.styleSegments.before, /content: "\\n \$\{token\} \{value\}"/u);
  assert.match(result.styleSegments.controlled, /data-velar-look/u);
  assert.match(result.styleSegments.after, /\.after \{ color: purple; \}/u);

  const before = (result.css ?? "").indexOf(".before::before");
  const controlled = (result.css ?? "").indexOf("data-velar-look");
  const after = (result.css ?? "").indexOf(".after");
  assert.ok(before >= 0 && controlled > before && after > controlled);
  assert.doesNotMatch(result.code ?? "", /\beval\s*\(|\bnew\s+Function\b|createElement\(\s*["']script["']/u);
});

test("[D53] formatting preserves every raw CSS payload byte", () => {
  const raw = [
    "    .before::before {",
    '        content: "\\n ${token} {value}";',
    "    }",
  ].join("\n");
  const options = { extensions: [velarCompilerExtension] } as const;
  const formatted = formatSource(inlineCssSource, options);
  assert.match(formatted, /^unsafe css`\n/u);
  assert.ok(formatted.includes(`${raw}\n`), formatted);
  assert.equal(formatSource(formatted, options), formatted);

  const compiled = compileWeb(formatted);
  assert.deepEqual(compiled.diagnostics, []);
  assert.match(compiled.styleSegments?.before ?? "", /content: "\\n \$\{token\} \{value\}"/u);
});

test("[D53] inline and external unsafe CSS share placement and analyzer policy", () => {
  const externalCss = '.same { background: url("/public/asset.svg"); }';
  const external = compileWeb('import css unsafe "./same.css" before look\n', new Map([["./same.css", externalCss]]));
  const inline = compileWeb([
    "unsafe css`",
    `    ${externalCss}`,
    "` before look",
    "",
  ].join("\n"));
  assert.deepEqual(external.diagnostics, []);
  assert.deepEqual(inline.diagnostics, []);
  assert.equal(inline.styleSegments?.before, external.styleSegments?.before);

  const hiddenDependencies = compileWeb([
    "unsafe css`",
    '    @import "./theme.css";',
    '    .icon { background: url("./icon.svg"); }',
    "` after look",
    "",
  ].join("\n"));
  const messages = hiddenDependencies.diagnostics.map((item) => `${item.code} ${item.message}`);
  assert.ok(messages.some((message) => /VEL5037 Inline unsafe CSS contains @import/u.test(message)), messages.join("\n"));
  assert.ok(messages.some((message) => /VEL5037 Inline unsafe CSS uses relative asset address url/u.test(message)), messages.join("\n"));
});

test("[D53] inline CSS is not a project resource, while the external form remains one", () => {
  const span = { start: 0, end: 1 };
  const inline: WebUnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "inline", css: ".inline {}", span },
    placement: "before",
    span,
  };
  const external: WebUnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "external", path: "./external.css", span },
    placement: "after",
    span,
  };
  const program = { kind: "Program", body: [inline, external], span } satisfies Program;
  assert.deepEqual(velarWebInspectionExtension.resources?.(program), [
    { source: "./external.css", kind: "unsafe CSS" },
  ]);
});

test("[D53] inline unsafe CSS is module-only and its order suffix is mandatory", () => {
  const nested = compileWeb([
    "def install():",
    "    unsafe css`",
    "        .nested { color: red; }",
    "    ` before look",
    "",
  ].join("\n"));
  assert.ok(
    nested.diagnostics.some((item) => item.code === "VEL5037" && /Unsafe CSS is module-level/u.test(item.message)),
    nested.diagnostics.map((item) => `${item.code} ${item.message}`).join("\n"),
  );

  const missingOrder = compileWeb([
    "unsafe css`",
    "    .missing-order { color: red; }",
    "`",
    "",
  ].join("\n"));
  const missingMessages = missingOrder.diagnostics.map((item) => `${item.code} ${item.message}`).join("\n");
  assert.match(missingMessages, /VEL5037 Unterminated inline unsafe CSS block/u);
  assert.match(missingMessages, /VEL5037 Unsafe CSS must explicitly declare 'before look' or 'after look'/u);
});

test("[D53] Core does not parse CSS and points to an installed unsafe-block extension", () => {
  const core = compileCore([
    "unsafe css`",
    "    .core-must-not-own-css { color: red; }",
    "` before look",
    "",
  ].join("\n"));
  assert.ok(
    core.diagnostics.some((item) => /unsafe block owned by an installed extension/u.test(item.message)),
    core.diagnostics.map((item) => `${item.code} ${item.message}`).join("\n"),
  );
});

// ---------------------------------------------------------------------------
// A-002 / A-003: both stylesheet gates read CSS tokens.
//
// One text scan used to answer both questions and got each one wrong in the
// opposite direction: a legal `)` inside a quoted URL ended the match early,
// so `url("./mark).svg")` walked past the gate and shipped an address that
// 404s once the stylesheet is extracted under assets/ (A-002, S1); and a
// `url(...)` written inside a string literal, which is text and not a
// reference, was refused (A-003). Sample-by-sample coverage is what let a
// scanner that never knew what a token was look tested, so the corpus below
// is organised by token shape -- quotes, escapes, comments, both url forms --
// and runs in both directions.
// ---------------------------------------------------------------------------

/**
 * The addresses the relative-url gate refuses in one stylesheet body, asserted
 * to be the same whether the CSS arrives inline or through an external file.
 */
function refusedCssUrls(css: string): readonly string[] {
  const indented = css.split("\n").map((line) => `    ${line}`).join("\n");
  const inline = compileWeb(`unsafe css\`\n${indented}\n\` before look\n`);
  const external = compileWeb('import css unsafe "./sheet.css" before look\n', new Map([["./sheet.css", css]]));
  const addresses = (diagnostics: readonly { readonly code: string; readonly message: string }[]): string[] => diagnostics
    .filter((item) => item.code === "VEL5037")
    .map((item) => / uses relative asset address [^(]+\((.*?)\); use a project-public /su.exec(item.message)?.[1])
    .filter((address): address is string => address !== undefined)
    .map((address) => JSON.parse(address) as string);
  assert.deepEqual(addresses(inline.diagnostics), addresses(external.diagnostics), css);
  return addresses(inline.diagnostics);
}

/** True when the hidden-dependency gate reads an @import at-rule in the body. */
function refusesCssImport(css: string): boolean {
  const indented = css.split("\n").map((line) => `    ${line}`).join("\n");
  const result = compileWeb(`unsafe css\`\n${indented}\n\` before look\n`);
  return result.diagnostics.some((item) => item.code === "VEL5037" && /contains @import/u.test(item.message));
}

test("[D53/A-002] a legal ) or quote inside a URL cannot walk past the relative-address gate", () => {
  const refused: readonly (readonly [string, string])[] = [
    // A-002 verbatim: a right parenthesis is a legal filename character, and
    // inside a quoted URL it is content, not the end of the reference.
    ['.icon { background-image: url("./mark).svg"); width: 20px; }', "./mark).svg"],
    [".icon { background-image: url('./mark).svg'); }", "./mark).svg"],
    ['.icon { background: url("./a(1).svg"); }', "./a(1).svg"],
    // The other delimiter a text scan trips over: the opposite quote.
    [".icon { background: url('./a\".svg'); }", "./a\".svg"],
    ['.icon { background: url("./a\'.svg"); }', "./a'.svg"],
    // An escape belongs to the token, and the address is the decoded one --
    // what the browser requests -- not the bytes around the backslash.
    [".icon { background: url(./mark\\).svg); }", "./mark).svg"],
    ['.icon { background: url("./mark\\29 .svg"); }', "./mark).svg"],
    [".icon { background: url(./mark\\29 .svg); }", "./mark).svg"],
    ['.icon { background: url("./mark\\".svg"); }', "./mark\".svg"],
    // The reference survives whitespace, newlines, comments, and neighbours.
    ['.icon {\n  background:\n    url(\n      "./multi.svg"\n    );\n}', "./multi.svg"],
    ['.a { content: ")"; background: url("./after-a-paren.svg"); }', "./after-a-paren.svg"],
    ['.a { background: url("./c.svg") /* trailing */; }', "./c.svg"],
    ['.a { mask-image: url("/rooted.svg"), url("./second.svg"); }', "./second.svg"],
    ['@font-face { font-family: A; src: url("./a.woff2") format("woff2"); }', "./a.woff2"],
    ['.a { background: -webkit-image-set(url("./nested.png") 1x); }', "./nested.png"],
    ['.a { width: 20px; background: url("./after-a-dimension.svg"); }', "./after-a-dimension.svg"],
    [':root { --icon: url("./custom-property.svg"); }', "./custom-property.svg"],
    ['@media print { .a { background: url("./in-an-at-rule.svg"); } }', "./in-an-at-rule.svg"],
  ];
  for (const [css, address] of refused) assert.deepEqual(refusedCssUrls(css), [address], css);
});

test("[D53/A-003] url(...) written as text is text: strings and comments are not references", () => {
  const accepted: readonly string[] = [
    // A-003 verbatim, then the same shape outside a `content` declaration.
    '.label::before { content: "url(./not-an-asset.svg)"; }',
    '[data-x="url(./not-an-asset.svg)"] { color: red; }',
    ".label::before { content: 'url(./not-an-asset.svg)'; }",
    '.a { content: "\\"url(./inside-an-escaped-quote.svg)\\""; }',
    '/* url("./commented-out.svg") */ .a { color: red; }',
    '/* content: "url(./commented-out.svg)" */ .a { color: red; }',
    // `url(` at the tail of a longer identifier is a different function.
    '.a { background: myurl("./not-the-url-function.svg"); }',
    '.a { background: -my-url("./not-the-url-function.svg"); }',
    // Addresses the ruling names as owned, including one an escape spells.
    '.a { background: url("/public/a.svg"); }',
    '.a { background: url(/public/a.svg); }',
    '.a { fill: url("#gradient"); }',
    '.a { background: url("data:image/svg+xml,%3Csvg%3E"); }',
    '.a { background: url("https://example.com/a.svg"); }',
    '.a { background: url("//example.com/a.svg"); }',
    '.a { background: url("\\2f public/escaped-root.svg"); }',
    // An empty url() names the document, and a bad-url or bad-string is a
    // declaration the browser drops -- neither one ever fetches an asset.
    ".a { background: url(); }",
    '.a { background: url(""); }',
    '.a { background: url("./bad\n-string.svg"); }',
    '.a { background: ur/**/l("./two-idents.svg"); }',
  ];
  for (const css of accepted) assert.deepEqual(refusedCssUrls(css), [], css);
});

test("[D53] the @import gate reads the same token stream as the address gate", () => {
  assert.ok(refusesCssImport('@import "./theme.css";'));
  assert.ok(refusesCssImport("@import url(./theme.css);"));
  assert.ok(refusesCssImport('@media print {@import "./theme.css";}'), "no separator in front of the at-keyword");
  assert.ok(refusesCssImport('@\\69 mport "./theme.css";'), "an escaped at-keyword names the same at-rule");
  assert.ok(refusesCssImport('@IMPORT "./theme.css";'), "at-rule names are case-insensitive");
  assert.ok(!refusesCssImport('.a { content: "@import \\"./theme.css\\";"; }'));
  assert.ok(!refusesCssImport('/* @import "./theme.css"; */ .a { color: red; }'));
  assert.ok(!refusesCssImport('.a { background: url(/not-an-@import.svg); }'));
  assert.ok(!refusesCssImport("@media print { .a { color: red; } }\n@layer base;\n@supports (display: grid) { .b { display: grid; } }"));
});

test("[D53] the CSS scanner reports url and at-keyword tokens over the CSS token grammar", () => {
  const tokensOf = (css: string): readonly CssToken[] => [...cssTokens(css)];
  // Strings end at their own quote, and their content is never a token.
  assert.deepEqual(tokensOf('a { content: "url(x) @import"; }'), []);
  assert.deepEqual(tokensOf('a { content: "\\" url(x)"; }'), []);
  assert.deepEqual(tokensOf('a { content: "url(\\\n x)"; }'), [], "a backslash-newline continues the string");
  // Comments are skipped whole, including an unterminated one.
  assert.deepEqual(tokensOf('/* url(x) */ a { color: red; }'), []);
  assert.deepEqual(tokensOf('/* url(x) a { background: url("./y.svg"); }'), []);
  // Both url forms, with escapes decoded to the address a browser requests.
  assert.deepEqual(tokensOf('a { background: url("./q).svg"); }'), [{ kind: "url", value: "./q).svg" }]);
  assert.deepEqual(tokensOf("a { background: url(./u\\).svg); }"), [{ kind: "url", value: "./u).svg" }]);
  assert.deepEqual(tokensOf('a { background: url("\\2f rooted.svg"); }'), [{ kind: "url", value: "/rooted.svg" }]);
  assert.deepEqual(tokensOf('a { background: url(   "./padded.svg"   ); }'), [{ kind: "url", value: "./padded.svg" }]);
  assert.deepEqual(tokensOf("a { background: url(  ./padded.svg  ); }"), [{ kind: "url", value: "./padded.svg" }]);
  assert.deepEqual(tokensOf('a { background: url("./\u{1F600}.svg"); }'), [{ kind: "url", value: "./\u{1F600}.svg" }]);
  // CSS Images 4 defines each top-level bare string option as a URL, and the
  // compatibility alias has identical arguments. Strings nested in type() or
  // a generated image are metadata/content rather than addresses.
  assert.deepEqual(tokensOf('a { background: image-set("./one.png" 1x, "./two.png" 2x type("image/png")); }'), [
    { kind: "asset-address", value: "./one.png", syntax: "image-set" },
    { kind: "asset-address", value: "./two.png", syntax: "image-set" },
  ]);
  assert.deepEqual(tokensOf('a { background: -webkit-image-set("./one.png" 1x); }'), [
    { kind: "asset-address", value: "./one.png", syntax: "-webkit-image-set" },
  ]);
  assert.deepEqual(tokensOf('a { background: image-set(linear-gradient(red, blue) 1x, "/root.png" 2x type("image/png")); }'), [
    { kind: "asset-address", value: "/root.png", syntax: "image-set" },
  ]);
  // src() is specified as URL syntax, but Chromium, Firefox, and WebKit do not
  // currently accept it as a background image or issue its request. D81's
  // browser-observation gate therefore keeps it out of this rule for now.
  assert.deepEqual(tokensOf('a { background: src("./not-requested.png"); }'), []);
  // A bad-url and a bad-string are dropped declarations, not references.
  assert.deepEqual(tokensOf('a { background: url(./bad url.svg); }'), []);
  assert.deepEqual(tokensOf('a { background: url("./bad\n.svg"); }'), []);
  assert.deepEqual(tokensOf('a { background: url("./missing-paren.svg" extra); }'), []);
  // Recovery after a bad-url resumes at the next token, not mid-string.
  assert.deepEqual(tokensOf('a { background: url(./bad url.svg); } b { background: url("./good.svg"); }'), [
    { kind: "url", value: "./good.svg" },
  ]);
  // At-keywords, and the identifiers that only look like one.
  assert.deepEqual(tokensOf('@media print { @import "./x.css"; }'), [
    { kind: "at-keyword", name: "media" },
    { kind: "at-keyword", name: "import" },
  ]);
  assert.deepEqual(tokensOf('a { background: url(/a@import.svg); }'), [{ kind: "url", value: "/a@import.svg" }]);
});

test("[D81-202] browser-requesting image-set strings share the relative asset-address gate", () => {
  assert.deepEqual(refusedCssUrls('.a { background: image-set("./one.png" 1x, "/two.png" 2x); }'), ["./one.png"]);
  assert.deepEqual(refusedCssUrls('.a { background: -webkit-image-set("../one.png" 1x); }'), ["../one.png"]);
  assert.deepEqual(refusedCssUrls('.a { background: image-set("/root.png" 1x, "data:image/png;base64,AA" 2x); }'), []);
  assert.deepEqual(refusedCssUrls('.a { background: src("./not-requested.png"); }'), []);
});

const cliPath = resolve("packages/cli/src/cli.ts");

/** A minimal buildable Web project whose only stylesheet is the given CSS. */
async function writeCssProject(directory: string, css: string, publicAssets: readonly string[]): Promise<void> {
  const scope = join(directory, "node_modules", "@velarscript");
  await mkdir(scope, { recursive: true });
  await symlink(resolve("packages/web"), join(scope, "web"), "dir");
  await mkdir(join(directory, "public"), { recursive: true });
  for (const asset of publicAssets) {
    await writeFile(join(directory, "public", asset), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n', "utf8");
  }
  await writeFile(join(directory, "velar.json"), JSON.stringify({ formatVersion: 2, entry: "main.vel", extensions: ["@velarscript/web"] }), "utf8");
  await writeFile(join(directory, "main.vel"), [
    "unsafe css`",
    ...css.split("\n").map((line) => `    ${line}`),
    "` before look",
    "",
    "component App:",
    '    return <main class="icon">Icon</main>',
    "",
    'mount(<App />, "#app")',
    "",
  ].join("\n"), "utf8");
}

function buildProject(directory: string): { readonly status: number | null; readonly output: string } {
  const execution = spawnSync(process.execPath, [cliPath, "build", directory, "--out-dir", join(directory, "dist")], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: execution.status, output: `${String(execution.stdout)}${String(execution.stderr)}` };
}

test("[D53/A-002] the extracted production stylesheet carries no address that would 404", async () => {
  // The harm A-002 named lands on the build product, not on `velar check`: the
  // stylesheet is extracted to a hashed file under assets/, so a relative
  // address that read fine next to index.html resolves one directory deeper
  // and 404s. Refusing it is therefore a claim about what dist/ contains.
  const refused = await makeTemporaryDirectory("velar-css-relative-build-");
  await writeCssProject(refused, '.icon { background-image: url("./mark).svg"); width: 20px; height: 20px; }', ["mark).svg"]);
  const refusedBuild = buildProject(refused);
  assert.equal(refusedBuild.status, 1, refusedBuild.output);
  assert.match(refusedBuild.output, /VEL5037/u);
  assert.match(refusedBuild.output, /uses relative asset address url\("\.\/mark\)\.svg"\)/u);
  assert.deepEqual(await readdir(join(refused, "dist")).catch(() => []), [], "a refused stylesheet leaves no build product");

  // The same file named the way the ruling asks builds, and every address in
  // the stylesheet the browser actually loads resolves from the site root to
  // a file the build really contains.
  const built = await makeTemporaryDirectory("velar-css-rooted-build-");
  await writeCssProject(built, [
    '.icon { background-image: url("/mark).svg"); width: 20px; height: 20px; }',
    '.escaped { background-image: url("\\2f mark\\29 .svg"); }',
    '.inline { background-image: url("data:image/svg+xml,%3Csvg%3E"); }',
  ].join("\n"), ["mark).svg"]);
  const build = buildProject(built);
  assert.equal(build.status, 0, build.output);
  const assets = await readdir(join(built, "dist", "assets"));
  const stylesheet = assets.find((name) => /^styles-[\da-f]+\.css$/u.test(name));
  assert.ok(stylesheet, JSON.stringify(assets));
  const styles = await readFile(join(built, "dist", "assets", stylesheet), "utf8");
  assert.match(styles, /url\("\/mark\)\.svg"\)/u);
  const addresses = [...cssTokens(styles)].filter((token) => token.kind === "url").map((token) => token.value);
  assert.equal(addresses.length, 3, styles);
  for (const address of addresses) {
    const rooted = address.startsWith("/") && !address.startsWith("//");
    assert.ok(
      rooted || address.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(address),
      `${JSON.stringify(address)} in assets/${stylesheet} resolves against dist/assets/, not the site root`,
    );
    if (rooted) {
      assert.deepEqual(
        await readFile(join(built, "dist", address.slice(1)), "utf8").then(() => "present", () => "missing"),
        "present",
        `${JSON.stringify(address)} is not in the build product`,
      );
    }
  }
});
