import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import { scanWebToken } from "../packages/web/src/lexer.ts";
import { repositoryRoot } from "./repository-root.ts";

/**
 * The P2c blind test's language finding, taken at every level its evidence
 * touched.
 *
 * **The verdict on the grammar is that a JSX children region is text, and the
 * defect was that nothing said so.** `docs/web-api.md` describes children as a
 * text run that is whitespace-normalized, with "text that must be preserved
 * exactly belongs in an interpolated string" as its one exact-text spelling.
 * `WEB-U13` had already ruled that the region has no comment form and refused
 * the two spellings it expected an author to reach for — an HTML comment
 * between children and a block comment inside an interpolation — with a message
 * naming `//` as the spelling that works. `//` inside the markup was the one
 * case that message names and the sink never closed: the line became a text
 * child, so two paragraphs of the consumer's own source comments were printed
 * on every conversation screen in a build where the formatter, `velar check`,
 * the unit tests and three browser engines were all green.
 *
 * Making `//` a comment there instead was not available: the charter's "always
 * a comment, in every position" is a claim about *code* positions, the same
 * boundary section 3 draws for `@`, and a children region is data for the Web
 * extension's grammar. `<a>https://host</a>` settles it — a comment reading
 * there eats the rest of the line.
 *
 * So the shape that can only have been a comment attempt is refused, and only
 * that shape: an opener standing at the start of its own physical line. A URL
 * in a sentence, an inline `a // b`, and a `//` that follows a tag on the same
 * line all stay the text they read as, and a line of literal text that really
 * does begin with an opener keeps the interpolated-string spelling.
 *
 * The last test is the gate blind spot rather than the defect. The browser
 * suites assert on data attributes and never looked at loose text, which is
 * exactly how a visible paragraph reached three engines unseen, so the DOM
 * assertion here is on the region's whole text.
 */

const root = repositoryRoot;

function compile(source: string): ReturnType<typeof compileCore> {
  return compileCore(source.trimStart(), { extensions: [velarCompilerExtension] });
}

function messages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => `${item.code} ${item.message}`);
}

/** The emitted text nodes, which is where the comment used to turn up. */
function textNodes(source: string): readonly string[] {
  const result = compile(source);
  assert.deepEqual(result.diagnostics, [], "the source under measurement must compile");
  return [...String(result.code).matchAll(/__velarDomCreateTextNode\("((?:[^"\\]|\\.)*)"\)/gu)].map((match) => match[1]!);
}

/** The children the scanner keeps, which is what a recovered parse renders from. */
function scannedChildren(markup: string): { readonly texts: readonly string[]; readonly codes: readonly string[] } {
  const scanned = scanWebToken({ source: markup, offset: 0, tokens: [] } as never) as {
    readonly token: { readonly payload: { readonly children: readonly { kind: string; value?: string }[] } };
    readonly diagnostics: readonly { readonly code: string }[];
  } | null;
  assert.ok(scanned, "the markup must scan as JSX");
  return {
    texts: scanned.token.payload.children.filter((child) => child.kind === "WebJsxTextSyntax").map((child) => child.value!),
    codes: scanned.diagnostics.map((item) => item.code),
  };
}

function component(markup: string): string {
  return `
component App:
    state failure: string? = null

    return ${markup}

@main:
    mount(<App />, "#app")
`;
}

const COMMENT_MESSAGE = "VEL5002 JSX has no comment form; move the comment outside the markup, or write '{\"// ...\"}' to render the line as text";

// ---------------------------------------------------------------------------
// P2c-1: the four comment spellings a children region refuses.
// ---------------------------------------------------------------------------

test("[P2c-1] the consumer's own shape — a '//' line among the children — is refused, not rendered", () => {
  assert.deepEqual(messages(component(`<section>
        // A ternary, and it stays one: it is a line of text with nothing behind it.
        {failure != null ? <span data-failure>{failure}</span> : ""}
    </section>`)), [COMMENT_MESSAGE]);
});

test("[P2c-1] every comment opener that starts its own line is refused, once per text run", () => {
  for (const [label, markup] of [
    ["a block comment on its own line", `<section>
        /* a note */
        <span>x</span>
    </section>`],
    ["a block comment across lines", `<section>
        /*
        a note
        */
        <span>x</span>
    </section>`],
    ["a block comment with text after it on the line", `<section>
        /* a note */ tail
    </section>`],
    ["a comment between two lines of text", `<section>
        alpha
        // a note
        beta
    </section>`],
    ["a comment as the last thing before the closing tag", `<section>
        <span>x</span>
        // a trailing note
    </section>`],
  ] as const) {
    assert.deepEqual(messages(component(markup)), [COMMENT_MESSAGE], label);
  }

  // Two comment lines in one text run are one text child and get one message,
  // for the same reason WEB-U13 gives: a comment attempt is one mistake.
  assert.deepEqual(messages(component(`<section>
        // first
        // second
        <span>x</span>
    </section>`)), [COMMENT_MESSAGE]);
});

test("[P2c-1] WEB-U13's two original spellings keep their own message", () => {
  assert.deepEqual(messages(`
mount(<div>
    <!-- a note -->
    <span>x</span>
</div>, "#app")
`), ["VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup"]);

  assert.deepEqual(messages(`
mount(<div>
    {/* a note */}
    <span>x</span>
</div>, "#app")
`), ["VEL5002 JSX has no comment form; write a '//' comment on its own line outside the markup"]);
});

// ---------------------------------------------------------------------------
// P2c-1: what stays text, which is the reason the rule is scoped to one shape.
// ---------------------------------------------------------------------------

test("[P2c-1] an opener that is not the first thing on its line is content and stays content", () => {
  for (const [label, markup, rendered] of [
    ["a URL inside a sentence", `<section>Visit https://example.com today</section>`, "Visit https://example.com today"],
    ["a URL alone on its line", `<section>
        https://example.com
    </section>`, "https://example.com"],
    ["an inline '//' between words", `<section>a // b</section>`, "a // b"],
    ["a protocol-relative address", `<section>
        //cdn.example.com/logo.png
    </section>`, null],
  ] as const) {
    if (rendered === null) {
      // The one shape the rule is knowingly strict about: an address written
      // protocol-relative reads exactly like a comment and has the same one
      // answer as any other literal opener line.
      assert.deepEqual(messages(component(markup)), [COMMENT_MESSAGE], label);
      continue;
    }
    assert.deepEqual(messages(component(markup)), [], label);
    assert.deepEqual(textNodes(component(markup)), [rendered], label);
  }

  // A '//' that follows a tag on the same physical line has that tag before it
  // and is text, which is what `previousPhysicalLineStart` is reading.
  assert.deepEqual(messages(component(`<section><span>x</span>// hi</section>`)), []);
  assert.deepEqual(textNodes(component(`<section><span>x</span>// hi</section>`)), ["x", "// hi"]);
});

test("[P2c-1] the interpolated string the message names renders the line as text", () => {
  const source = component(`<section>
        {"// A ternary, and it stays one."}
        <span>x</span>
    </section>`);
  assert.deepEqual(messages(source), []);
  assert.match(String(compile(source).code), /"\/\/ A ternary, and it stays one\."/u);
});

// ---------------------------------------------------------------------------
// P2c-1: recovery. The line is cut from the children as well as reported, so a
// tool that renders through a recovered parse still puts nothing on screen.
// ---------------------------------------------------------------------------

test("[P2c-1] a refused comment is removed from the text child, and its neighbours survive", () => {
  assert.deepEqual(scannedChildren(`<section>\n    alpha\n    // a note\n    beta\n</section>`), {
    texts: ["\n    alpha\n    \n    beta\n"],
    codes: ["VEL5002"],
  });

  assert.deepEqual(scannedChildren(`<section>\n    /*\n    a note\n    */\n    keep\n</section>`), {
    texts: ["\n    \n    keep\n"],
    codes: ["VEL5002"],
  });

  // Nothing but comment lines leaves whitespace, which normalizes to no node.
  assert.deepEqual(scannedChildren(`<section>\n    // one\n    // two\n</section>`).texts, ["\n    \n    \n"]);

  // And the text that is not a comment is untouched.
  assert.deepEqual(scannedChildren(`<section>\n    https://example.com\n</section>`), {
    texts: ["\n    https://example.com\n"],
    codes: [],
  });
});

// ---------------------------------------------------------------------------
// P2c-1: the formatter. It preserved the line verbatim and indented it like a
// comment, which is the half of the blind spot that made the shape look right.
// ---------------------------------------------------------------------------

test("[P2c-1] the legal spellings round-trip, and the refused one is not silently rewritten", () => {
  const legal = `component App:
    state failure: string? = null

    // A ternary, and it stays one: it is a line of text with nothing behind it.
    return <section>
        {"// this line really is text"}
        {failure != null ? <span data-failure>{failure}</span> : ""}
    </section>

@main: mount(<App />, "#app")
`;
  assert.deepEqual(messages(legal), []);
  assert.equal(formatSource(legal, { extensions: [velarCompilerExtension] }), legal);
  assert.equal(formatSource(formatSource(legal, { extensions: [velarCompilerExtension] }), { extensions: [velarCompilerExtension] }), legal);

  // The formatter is not the channel that answers this — it keeps the source it
  // was given, and `velar check` is what refuses it. Pinned so a later
  // formatter change cannot quietly move the line and hide the diagnostic.
  const refused = `component App:
    return <section>
        // A ternary, and it stays one.
        <span>x</span>
    </section>

@main: mount(<App />, "#app")
`;
  assert.equal(formatSource(refused, { extensions: [velarCompilerExtension] }), refused);
  assert.deepEqual(messages(refused), [COMMENT_MESSAGE]);
});

// ---------------------------------------------------------------------------
// The gate blind spot: a browser assertion that looks at loose text.
// ---------------------------------------------------------------------------

async function runCommand(command: string, args: readonly string[]): Promise<{ output: string; code: number | null }> {
  return await new Promise((resolvePromise) => {
    const child = spawn(command, [...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("close", (value) => resolvePromise({ output, code: value }));
  });
}

test("[P2c-1] the consumer's conversation shape carries no source comment into the DOM, on all three engines", { timeout: 900_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "velar-p2c1-"));
  try {
    await mkdir(join(directory, "src"), { recursive: true });
    await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
    await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
    await writeFile(join(directory, "velar.json"), JSON.stringify({
      formatVersion: 2,
      entry: "src/main.vel",
      outDir: "dist",
      extensions: ["@velarscript/web"],
      web: { title: "P2c conversation" },
    }), "utf8");

    // The consumer's own shape, with its comments where the diagnostic sends
    // them: two paragraphs about the markup, sitting above it.
    await writeFile(join(directory, "src", "main.vel"), `
state failure: string? = null

component ConversationError(reason: string):
    return <p data-conversation-error>{reason}</p>

def fail():
    failure = "the model did not answer"

component Transcript:
    // The transcript is a keyed row named by the session it shows, and not
    // rebuilt when the session's own fields change.
    // A ternary, and it stays one: it is a line of text with nothing behind it.
    return <section data-transcript>
        <h2>Conversation</h2>
        {failure != null ? <ConversationError reason={failure} /> : ""}
        <p data-literal>{"// this line really is text"}</p>
        <button type="button" data-fail on:click={fail}>fail</button>
    </section>

@main:
    mount(<Transcript />, "#app")
`, "utf8");

    // The assertion the browser gates were missing: the region's whole text,
    // not one data attribute inside it. A comment child would land in it.
    await writeFile(join(directory, "src", "comments.browser.test.vel"), `
import {expect} from "velar/test"
import {browser} from "velar/web-test"

test "no source comment reaches the transcript, in either state of the ternary":
    await browser.open("/")
    expect(await browser.text("[data-transcript]")).toBe("Conversation// this line really is textfail")
    await browser.click("[data-fail]")
    await browser.waitForText("[data-conversation-error]", "the model did not answer")
    expect(await browser.text("[data-transcript]")).toBe("Conversationthe model did not answer// this line really is textfail")

test "the interpolated string is the spelling that does render an opener as text":
    await browser.open("/")
    expect(await browser.text("[data-literal]")).toBe("// this line really is text")
`, "utf8");

    const result = await runCommand(process.execPath, [
      join(root, "packages", "cli", "src", "cli.ts"), "test", directory, "--browser=all",
    ]);
    assert.equal(result.code, 0, result.output);
    for (const engine of ["chromium", "firefox", "webkit"]) {
      assert.match(result.output, new RegExp(`✓ ${engine} :: "src/comments\\.browser\\.test\\.vel"`, "u"));
    }
    assert.match(result.output, /\n6 passed, 0 failed\n/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
