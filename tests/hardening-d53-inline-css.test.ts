import assert from "node:assert/strict";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import type { Program } from "@velarscript/compiler/extension";
import type { WebUnsafeCssDeclaration } from "../packages/web/src/ast.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { velarWebInspectionExtension } from "../packages/web/src/inspection.ts";

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
  assert.ok(messages.some((message) => /VEL5037 Inline unsafe CSS uses relative url/u.test(message)), messages.join("\n"));
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
