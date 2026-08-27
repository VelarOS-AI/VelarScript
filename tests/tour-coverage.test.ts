import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { CORE_STATEMENT_CONSTRUCTS } from "../packages/compiler/src/ast.ts";
import { CORE_CONTEXTUAL_KEYWORD_WORDS, CORE_NUMERIC_SUFFIXES } from "../packages/compiler/src/core-vocabulary.ts";
import { keywordKinds } from "../packages/compiler/src/token.ts";
import { velarCompilerExtension as desktopCompilerExtension } from "../packages/desktop/src/compiler.ts";
import { NODE_STATEMENT_CONSTRUCTS } from "../packages/node/src/server-ast.ts";
import { velarNodeCompilerExtension as nodeCompilerExtension } from "../packages/node/src/compiler.ts";
import { WEB_STATEMENT_CONSTRUCTS, webStatementConstructKey, type WebUnsafeCssDeclaration } from "../packages/web/src/ast.ts";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import { LOOK_PROPERTIES, LOOK_TARGETS } from "../packages/web/src/look.ts";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";

// ---------------------------------------------------------------------------
// D56 rules 129 and 130 — `scripts/check-tour-coverage.mjs` is the gate that
// turns "the tour shows every usage" from a claim into a check. The worst way
// for a coverage gate to fail is not to go red: it is to go green having
// examined nothing, which is why every test below either counts what the gate
// looked at or removes exactly one spelling from a copy of the tour and demands
// the gate name it.
// ---------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gate = join(root, "scripts", "check-tour-coverage.mjs");
const tour = join(root, "examples", "tour");

after(removeTemporaryDirectories);

function runGate(tourRoot: string) {
  const execution = spawnSync(process.execPath, [gate, tourRoot], { cwd: root, encoding: "utf8", timeout: 300_000 });
  return { status: execution.status, output: `${execution.stdout ?? ""}${execution.stderr ?? ""}` };
}

/** A private copy of the tour, so a mutation never touches the repository. */
async function copyOfTour(): Promise<string> {
  const directory = join(await makeTemporaryDirectory("velar-tour-coverage-"), "tour");
  await cp(tour, directory, { recursive: true, filter: (path) => !path.split("/").includes("dist") });
  return directory;
}

async function mutate(directory: string, file: string, replace: string, replacement: string): Promise<void> {
  const path = join(directory, file);
  const text = await readFile(path, "utf8");
  assert.ok(text.includes(replace), `${file} no longer contains ${JSON.stringify(replace)}; retarget this mutation`);
  await writeFile(path, text.replace(replace, replacement));
}

test("the coverage gate passes on the tour and reports what it examined", () => {
  const { status, output } = runGate(tour);
  assert.equal(status, 0, output);
  // Every category the gate owns has to appear with a non-zero required count.
  // A table that starts reading empty would otherwise sail through as 0/0.
  for (const category of [
    "hard-keyword", "contextual-keyword", "reserved-binding", "numeric-suffix", "extension-global",
    "permanent-namespace", "prelude-name", "namespace-member", "module-export", "type-parameter-bound",
    "web-test-member", "look-property", "look-hook", "look-target", "look-media-feature",
    "statement-construct",
  ]) {
    const line = output.split("\n").find((item) => item.trimStart().startsWith(`${category} `));
    assert.ok(line, `${category} is missing from the gate's report:\n${output}`);
    const counts = /(?<covered>\d+)\/(?<required>\d+)/u.exec(line)?.groups;
    assert.ok(counts, `${category} reports no counts:\n${line}`);
    assert.ok(Number(counts.required) > 0, `${category} required 0 names — its table read empty:\n${line}`);
    assert.equal(counts.covered, counts.required, `${category} is not fully covered:\n${line}`);
  }
  // The headline count is the honest answer to "how much did you check": it
  // must at least account for the forty hard keywords, the Look property table
  // and the standard-module surface.
  const checked = Number((/Checked (\d+) compiler-declared names/u.exec(output) ?? [])[1]);
  assert.ok(
    checked >= Object.keys(keywordKinds).length + LOOK_PROPERTIES.size + LOOK_TARGETS.size,
    `the gate reported only ${checked} names:\n${output}`,
  );
});

test("[D62-157/158] the gate requires Core's own contextual keywords and numeric suffixes", () => {
  // Both tables were holes this gate could only print: one had no enumerable
  // source at all, and the other was reachable only because the Web extension
  // republishes `ms` and `s` through LOOK_UNIT_TYPES, so a Core-only checkout
  // required neither. This test is the reverse direction of the roster — it
  // fails if the gate ever stops *requiring* Core's words, which the "covered
  // equals required" assertion above cannot notice on its own, because a table
  // that requires nothing is trivially fully covered.
  const { status, output } = runGate(tour);
  assert.equal(status, 0, output);
  const required = (category: string) => {
    const line = output.split("\n").find((item) => item.trimStart().startsWith(`${category} `));
    assert.ok(line, `${category} is missing from the gate's report:\n${output}`);
    return Number(/\d+\/(?<required>\d+)/u.exec(line)?.groups?.required);
  };
  // The Web extension publishes ten contextual keywords and thirteen numeric
  // suffixes; Core's words are disjoint from those, and its two suffixes
  // are the pair the Web extension republishes. Requiring *at least* Core's own
  // counts is what a Core-only checkout must also satisfy.
  assert.ok(required("contextual-keyword") >= CORE_CONTEXTUAL_KEYWORD_WORDS.length,
    `the gate required fewer contextual keywords than Core alone declares:\n${output}`);
  assert.ok(required("numeric-suffix") >= CORE_NUMERIC_SUFFIXES.length,
    `the gate required fewer numeric suffixes than Core alone declares:\n${output}`);
  // D79 closes the last four same-node-kind statement pairs through Core's
  // explicit construct projection, so the report now has no known hole.
  assert.match(output, /Not reverse-queryable \(holes, not exemptions\):\n\s+none — every vocabulary this gate names is read from a compiler-owned table\b/u);
  assert.doesNotMatch(output, /Core's own contextual keywords/u);
  assert.doesNotMatch(output, /Core's built-in numeric suffixes/u);
});

test("[D53-117] the gate requires every statement construct the compiler can parse", () => {
  // The blind spot this category closes: `extern js(…)` and `unsafe js` are
  // assembled from `extern`, `js`, and `unsafe` — three keywords chapter 13
  // already exercised through `extern module` and `import js unsafe` — so two
  // declaration forms reached a release with no `.vel` file anywhere using
  // them while seventeen name-by-name categories all stayed green. A construct
  // spelled out of covered spellings is invisible to a spelling check.
  const { status, output } = runGate(tour);
  assert.equal(status, 0, output);
  const line = output.split("\n").find((item) => item.trimStart().startsWith("statement-construct "));
  assert.ok(line, `the gate reports no statement-construct category:\n${output}`);
  const counts = /(?<covered>\d+)\/(?<required>\d+)/u.exec(line)?.groups;
  assert.ok(counts, `statement-construct reports no counts:\n${line}`);
  // Compared against the rosters themselves rather than against a number:
  // Each owner publishes its own complete construct roster, so a construct
  // added to Core or any active syntax extension raises both sides together.
  const required = Object.keys(CORE_STATEMENT_CONSTRUCTS).length
    + Object.keys(WEB_STATEMENT_CONSTRUCTS).length
    + Object.keys(NODE_STATEMENT_CONSTRUCTS).length;
  assert.equal(Number(counts.required), required, `the gate required ${counts.required} constructs; Core, Web, and Node declare ${required}:\n${output}`);
  assert.equal(counts.covered, counts.required, `the tour does not write every construct:\n${line}`);
});

test("[D53-117] an extension that owns a parser publishes the constructs its parser adds", () => {
  // An extension's statements never join `CoreStatement`, so its own roster is
  // the only table that can name them, and the gate treats a parser without one
  // as a failure rather than as an empty contribution.
  for (const extension of [webCompilerExtension, nodeCompilerExtension, desktopCompilerExtension]) {
    assert.ok(extension.parser, `${extension.id} no longer registers a parser; retarget this test`);
    assert.ok(extension.syntax, `${extension.id} owns a parser but publishes no statement-construct roster`);
    assert.ok(Object.keys(extension.syntax.statementConstructs).length > 0, `${extension.id} publishes an empty roster`);
  }
  // `unsafe css` is the one statement whose node kind spells two constructs,
  // and its `source` is a tagged union the Web extension already owns — so the
  // inline block cannot be covered by the `import css unsafe` beside it.
  const span = { start: 0, end: 1 };
  const inline: WebUnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "inline", css: ".inline {}", span },
    placement: "after",
    span,
  };
  const external: WebUnsafeCssDeclaration = {
    kind: "ExtensionStatement:web:unsafe-css",
    source: { kind: "external", path: "./external.css", span },
    placement: "before",
    span,
  };
  assert.equal(webStatementConstructKey(inline), "ExtensionStatement:web:unsafe-css/inline");
  assert.equal(webStatementConstructKey(external), "ExtensionStatement:web:unsafe-css/external");
  assert.equal(webStatementConstructKey({ kind: "VariableDeclaration" }), null);
});

test("removing one spelling from the tour turns the gate red and names it", async () => {
  // One deletion per vocabulary family, each the smallest edit that removes the
  // spelling and nothing else. The expected message is the whole point: a gate
  // that says "coverage incomplete" without naming the name is unactionable.
  // A spelling shown in more than one chapter needs every site removed, since
  // coverage is satisfied by any single one of them.
  const cases = [
    {
      family: "a resident-namespace member",
      expected: "namespace-member: Text.slug",
      edits: [{ file: "core/06-text-and-numbers.vel", replace: 'Text.slug("Velar Script 1.0")', replacement: 'Text.dedent("Velar Script 1.0")' }],
    },
    {
      family: "a Look property",
      expected: "look-property: hyphens:",
      edits: [{ file: "web/06-look.vel", replace: '    hyphens = "none"\n', replacement: "" }],
    },
    {
      family: "a Look target",
      expected: "look-target: @marker",
      edits: [{ file: "web/06-look.vel", replace: "    @marker:\n        color = ink\n", replacement: "" }],
    },
    {
      family: "a hard keyword",
      expected: "hard-keyword: continue",
      edits: [
        { file: "core/09-control-flow.vel", replace: "        if value < 0: continue\n", replacement: "        if value < 0: pass\n" },
        { file: "core/11-errors-and-assertions.vel", replace: "            if value < 0: continue\n", replacement: "            if value < 0: pass\n" },
      ],
    },
    {
      // Three sites now, not two: the inline block spells `css` as well, so
      // deleting only the imports leaves the word covered. Deleting every site
      // necessarily takes both `unsafe-css` constructs with it, and the gate
      // names those too — the assertion is that it names *this*.
      family: "an extension's contextual keyword",
      expected: "contextual-keyword: css",
      edits: [
        { file: "web/08-look-escape.vel", replace: 'import css unsafe "./before.css" before look\n', replacement: "" },
        { file: "web/08-look-escape.vel", replace: 'import css unsafe "./after.css" after look\n', replacement: "" },
        {
          file: "web/08-look-escape.vel",
          replace: "unsafe css`\n"
            + "    @media print {\n"
            + "        .tour-cascade-counter {\n"
            + "            break-inside: avoid;\n"
            + "            orphans: 3;\n"
            + "            widows: 3;\n"
            + "        }\n"
            + "    }\n"
            + "` after look\n\n",
          replacement: "",
        },
      ],
    },
    {
      family: "a type-parameter bound",
      expected: "type-parameter-bound: <T: Data>",
      edits: [{ file: "core/05-functions-and-calls.vel", replace: "<T: Data>", replacement: "<T: Comparable>" }],
    },
    {
      // D79: the ordinary class declarations remain, so this turns red only
      // when the construct projection distinguishes the abstract form.
      family: "an abstract class while its ordinary sibling remains",
      expected: "statement-construct: abstract class Name:",
      edits: [
        { file: "core/10-classes-and-ownership.vel", replace: "abstract class Entity:\n", replacement: "class Entity:\n" },
        { file: "core/10-classes-and-ownership.vel", replace: "    abstract def describe() -> string\n", replacement: "    def describe() -> string:\n        return \"entity\"\n" },
        { file: "core/10-classes-and-ownership.vel", replace: "    abstract get shortName() -> string\n", replacement: "    get shortName() -> string:\n        return self.id\n" },
      ],
    },
    {
      family: "a velar/web-test browser control",
      expected: "web-test-member: browser.box",
      edits: [{
        file: "web/13-browser.browser.test.vel",
        replace: 'const vocabularyBox = await browser.box("[data-vocabulary]")',
        replacement: "const vocabularyBox = {x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0}",
      }],
    },
    {
      // The Desktop browser chapter still uses browser.open. This only turns
      // red if the gate really owns Web chapter 13 rather than accepting use
      // anywhere in the tour as a substitute for that chapter's inventory.
      family: "a velar/web-test control also used outside the full showcase",
      expected: "web-test-member: browser.open",
      edits: [
        { file: "web/13-browser.browser.test.vel", replace: "    await browser.open()\n", replacement: "    pass\n" },
        { file: "web/13-browser.browser.test.vel", replace: '    await browser.open("/section/units")\n', replacement: "    pass\n" },
      ],
    },
    {
      // Both spellings go in one edit because they share a node kind, which is
      // the granularity limit the gate prints as a hole. Each replacement is an
      // ordinary VelarScript declaration of the same name and type, so the
      // chapter still compiles and the gate goes red for the construct alone.
      family: "an inline JavaScript block",
      expected: "statement-construct: extern js(capture: T)",
      edits: [
        {
          file: "core/13-javascript-boundary.vel",
          replace: "const tokenBytes = 16\n\nextern js(tokenBytes: number)`\n"
            + "    export function randomToken() {\n"
            + "        const buffer = new Uint8Array(tokenBytes)\n"
            + "        globalThis.crypto.getRandomValues(buffer)\n"
            + '        return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join("")\n'
            + "    }\n"
            + "`:\n"
            + "    export def randomToken() -> string\n",
          replacement: "def randomToken() -> string:\n    return \"deadbeef\"\n",
        },
        {
          file: "core/13-javascript-boundary.vel",
          replace: "unsafe js`\n"
            + "    export const engineRecord = { arch: globalThis.process.arch, node: globalThis.process.versions.node }\n"
            + "`\n",
          replacement: "const engineRecord: unknown = {arch: \"arm64\", node: \"24\"}\n",
        },
      ],
    },
    {
      // The two `import css unsafe` lines stay. They share this block's node
      // kind and would satisfy a gate that required the kind, which is exactly
      // how the inline form reached a release with no example.
      family: "an inline CSS block whose external sibling remains",
      expected: "statement-construct: unsafe css",
      edits: [{
        file: "web/08-look-escape.vel",
        replace: "unsafe css`\n"
          + "    @media print {\n"
          + "        .tour-cascade-counter {\n"
          + "            break-inside: avoid;\n"
          + "            orphans: 3;\n"
          + "            widows: 3;\n"
          + "        }\n"
          + "    }\n"
          + "` after look\n\n",
        replacement: "",
      }],
    },
    {
      // A-023: the `module-export` category had no red case at all. This is the
      // ordinary direction — the name leaves the tour entirely — and the test
      // below is its other half, where only the *usage* leaves.
      family: "a standard-module export",
      expected: 'module-export: import {watchVisibility} from "velar/browser"',
      edits: [
        {
          file: "web/10-browser-forms-files.vel",
          replace: "            watchVisibility(setVisible),\n",
          replacement: '            watchMedia("(max-width: 719px)", setVisible),\n',
        },
        {
          file: "web/10-browser-forms-files.vel",
          replace: ', watchVisibility} from "velar/browser"',
          replacement: '} from "velar/browser"',
        },
      ],
    },
    {
      family: "a velar/web-test computed-style control",
      expected: "web-test-member: browser.style",
      edits: [{
        file: "web/13-browser.browser.test.vel",
        replace: 'expect(await browser.style("[data-vocabulary]", "gap")).toBe("16px")',
        replacement: 'expect("16px").toBe("16px")',
      }],
    },
  ];

  for (const item of cases) {
    const directory = await copyOfTour();
    for (const edit of item.edits) {
      const path = join(directory, edit.file);
      const text = await readFile(path, "utf8");
      assert.ok(text.includes(edit.replace), `${item.family}: ${edit.file} no longer contains ${JSON.stringify(edit.replace)}; retarget this mutation`);
      await writeFile(path, text.replaceAll(edit.replace, edit.replacement));
    }
    const { status, output } = runGate(directory);
    assert.equal(status, 1, `${item.family}: the gate stayed green after the deletion:\n${output}`);
    assert.ok(output.includes(item.expected), `${item.family}: the gate did not name it:\n${output}`);
    await rm(directory, { recursive: true, force: true });
  }
});

test("[A-023] an import is not a usage: the name stays imported and the gate still goes red", async () => {
  // The other direction of the case above, and the one the gate was missing.
  // `observeModule` waited for a real `MemberExpression` before crediting a
  // namespace import, but credited every *named* import the moment it parsed —
  // so deleting the only call to `watchVisibility` while leaving its specifier
  // in the import list left `module-export` reporting 237/237 and exit 0.
  //
  // An import proves a name resolves. It shows no signature and no usage, and
  // this gate's own failure text says a name is missing when "no module uses
  // it". Testing only the deletion of imports is what let the two sentences
  // drift apart: every red case here removed a spelling from the source, and
  // none of them removed a *use* while the spelling stayed.
  const directory = await copyOfTour();
  await mutate(
    directory,
    "web/10-browser-forms-files.vel",
    "            watchVisibility(setVisible),\n",
    '            watchMedia("(max-width: 719px)", setVisible),\n',
  );
  const source = await readFile(join(directory, "web", "10-browser-forms-files.vel"), "utf8");
  assert.ok(source.includes("watchVisibility}"), `the import specifier must survive this mutation:\n${source}`);
  assert.equal(source.match(/watchVisibility/gu)?.length, 1, "watchVisibility must remain exactly once, as an import and nowhere else");
  const { status, output } = runGate(directory);
  assert.equal(status, 1, `the gate counted an unused import as coverage:\n${output}`);
  assert.ok(output.includes('module-export: import {watchVisibility} from "velar/browser"'), `the gate did not name it:\n${output}`);
  // And it says *why*, because "no module uses it" beside a visible import line
  // is the one message a reader would disbelieve.
  assert.match(output, /10-browser-forms-files\.vel imports the name and never references it — an import is not a usage/u);
  await rm(directory, { recursive: true, force: true });
});

test("[A-023] a namespace member is credited to the namespace, not to its spelling", async () => {
  // The other half of the same defect. The namespace branch did wait for a
  // real member read — but it matched the read by the import's *local name*,
  // so any binding spelled the same in any inner scope forged the module's
  // exports out of a read of itself. That is the forgery this file's header
  // says a text search would allow and a resolved judgment would not.
  const directory = await copyOfTour();
  // First make one export genuinely uncovered, so the gate has something to be
  // wrong about: `velar/url`'s `encode` reaches the tour only through chapter
  // 14's named import.
  await mutate(directory, "core/14-files-and-host.vel", "import {decode, encode, isExternal,", "import {decode, isExternal,");
  await mutate(directory, "core/14-files-and-host.vel", 'const encoded = encode("a b&c")', 'const encoded = decode("a%20b")');
  const missing = runGate(directory);
  assert.equal(missing.status, 1, missing.output);
  assert.ok(missing.output.includes('module-export: import {encode} from "velar/url"'), missing.output);

  // Now forge it: chapter 12 holds `import * as urls from "velar/url"`, and a
  // local record named `urls` in a function body used to satisfy the whole
  // module's inventory through `urls.encode`.
  await mutate(
    directory,
    "core/12-modules.vel",
    'const joinedUrl = urls.join("https://example.test", "api", "v1")',
    'const joinedUrl = urls.join("https://example.test", "api", "v1")\n\ndef forgeCoverage() -> string:\n    const urls = {encode: "forged"}\n    return urls.encode\n',
  );
  const forged = runGate(directory);
  assert.equal(forged.status, 1, `a shadowing local forged coverage of a module export:\n${forged.output}`);
  assert.ok(forged.output.includes('module-export: import {encode} from "velar/url"'), forged.output);
  await rm(directory, { recursive: true, force: true });
});

test("the gate reads a chapter no import reaches", async () => {
  // This test used to assert the opposite, and the reason it flipped is worth
  // keeping. D56 rule 128 recorded that `velar check` never looked at a module
  // the entry could not reach, so a chapter added without an import in
  // `main.vel` silently lost the compile half of its coverage; the tour's
  // "every chapter exports a name and `main.vel` imports it one by one" rule
  // was *derived* from that limitation, and this gate enforced it.
  //
  // `velar check` now compiles an unimported source as a root of its own
  // (stream-bench F4), so the limitation is gone and the derived rule with it.
  // A chapter nothing imports is read like any other, which is what the tour
  // wanted all along: the corpus is judged on what it spells, not on how it is
  // wired to an entry.
  const directory = await copyOfTour();
  await writeFile(join(directory, "core", "99-orphan.vel"), 'export const orphanName = "nobody imports this"\n');
  const { status, output } = runGate(directory);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /99-orphan\.vel/u, "an unimported chapter is compiled, so the gate has nothing to report about it");
});

test("the gate still refuses a chapter it cannot compile at all", async () => {
  // The branch that used to report an unreachable chapter now reports a gate
  // defect: every source should arrive with an index, and one that does not is
  // a module this gate failed to read. A chapter that does not parse is the
  // reachable way to prove the reporting path still fires.
  const directory = await copyOfTour();
  await writeFile(join(directory, "core", "99-broken.vel"), "export def broken( -> :\n");
  const { status, output } = runGate(directory);
  assert.equal(status, 1, output);
  assert.match(output, /99-broken\.vel/u);
});

test("coverage is judged on resolved references, not on the text of the tour", async () => {
  // A gate that grepped for `Text.slug` could be satisfied by a module that
  // declares its own `Text`. D57 rule 135 made that particular forgery
  // impossible — the binding is refused — and the gate reports the refusal
  // rather than counting the forged coverage.
  const directory = await copyOfTour();
  await mutate(
    directory,
    "core/06-text-and-numbers.vel",
    'const slugified = Text.slug("Velar Script 1.0")',
    'const Text = {slug: "forged"}\nconst slugified = Text.slug',
  );
  const { status, output } = runGate(directory);
  assert.equal(status, 1, output);
  assert.match(output, /VEL3007 'Text' is a reserved Core binding/u);
  await rm(directory, { recursive: true, force: true });
});

test("the coverage gate runs as part of npm run check", async () => {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.equal(manifest.scripts["check:tour-coverage"], "node scripts/check-tour-coverage.mjs");
  const gateCheck = manifest.scripts["gate:check"] ?? "";
  assert.ok(gateCheck.includes("npm run check:tour-coverage"), `gate:check does not run the tour coverage gate:\n${gateCheck}`);
});
