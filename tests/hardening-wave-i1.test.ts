import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyMechanicalFixes, compile } from "@velarscript/compiler";
import { velarCompilerExtension as webCompilerExtension } from "../packages/web/src/compiler.ts";
import { compileProject } from "../packages/cli/src/project.ts";

const cliPath = fileURLToPath(new URL("../packages/cli/src/cli.ts", import.meta.url));

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function webMessages(source: string): readonly string[] {
  return compile(source, { extensions: [webCompilerExtension] }).diagnostics.map((item) => item.message);
}

function coreMessages(source: string): readonly string[] {
  return compile(source).diagnostics.map((item) => item.message);
}

async function projectCompile(source: string, web = false): Promise<{ readonly messages: readonly string[]; readonly code: string }> {
  const entry = join(tmpdir(), `velar-i1-${Math.random().toString(36).slice(2)}`, "main.vel");
  const project = await compileProject(entry, new Map([[entry, source]]),
    web ? { extensions: [webCompilerExtension] } : {});
  return {
    messages: [
      ...project.modules.flatMap((module) => module.result.diagnostics).map((item) => item.message),
      ...project.failures.map((item) => item.message),
    ],
    code: project.modules.map((module) => module.result.code ?? "").join("\n"),
  };
}

async function projectMessages(source: string, web = false): Promise<readonly string[]> {
  return (await projectCompile(source, web)).messages;
}

/**
 * The whole point of a migration diagnostic: the spelling it names has to be
 * the spelling that survives. This applies every rewrite the compile named and
 * answers with what is left, so a guidance loop shows up as a second round of
 * diagnostics rather than as a message a reader has to judge by eye.
 */
async function fixedOnce(source: string, web = false): Promise<{ readonly text: string; readonly passes: number; readonly remaining: readonly string[] }> {
  const entry = join(tmpdir(), `velar-i1-fix-${Math.random().toString(36).slice(2)}`, "main.vel");
  let text = source;
  let passes = 0;
  for (; passes < 8; passes += 1) {
    const project = await compileProject(entry, new Map([[entry, text]]), web ? { extensions: [webCompilerExtension] } : {});
    const diagnostics = project.modules.flatMap((module) => module.result.diagnostics);
    const applied = applyMechanicalFixes(text, diagnostics);
    if (applied.applied.length === 0) {
      return {
        text,
        passes,
        remaining: [...diagnostics.map((item) => item.message), ...project.failures.map((item) => item.message)],
      };
    }
    text = applied.text;
  }
  return { text, passes, remaining: ["fix did not converge"] };
}

async function scratch(files: ReadonlyMap<string, string>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "velar-i1-"));
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "main.vel",
    outDir: "dist",
    publicDir: "public",
    extensions: ["@velarscript/web"],
    web: { title: "I1", base: "/" },
  }), "utf8");
  for (const [name, contents] of files) await writeFile(join(directory, name), contents, "utf8");
  return directory;
}

// ---------------------------------------------------------------------------
// D52 rule 114 — the Look. prefix retires
// ---------------------------------------------------------------------------

test("[D52-114] velar/look is an ordinary named-import module again", async () => {
  const result = await projectCompile(`
import {border, minmax, rgb, spacing, tracks} from "velar/look"

const shell = look:
    gridTemplateColumns = tracks(240px, minmax(0px, 1fr))
    padding = spacing(16px, 20px)
    border = border(1px, rgb(10, 10, 10))

component App:
    return <main look={shell}>ok</main>
`.trimStart(), true);
  assert.deepEqual(result.messages, [], result.messages.join("\n"));
  // The builders are the module's real exports, so the emitted module imports
  // them by name rather than reaching a namespace object.
  assert.match(result.code, /from "velar\/look"/u);
  assert.doesNotMatch(result.code, /__velarLookNamespace/u);
});

test("[D52-114] a named import of a look builder earns no migration", async () => {
  const messages = await projectMessages(`
import {rgb} from "velar/look"

const shell = look:
    color = rgb(1, 2, 3)

component App:
    return <main look={shell}>ok</main>
`.trimStart(), true);
  assert.deepEqual(messages, [], messages.join("\n"));
});

test("[D52-114] Look.member teaches the named import in one step", () => {
  const messages = webMessages(`
const shell = look:
    padding = Look.spacing(16px, 20px)

component App:
    return <main look={shell}>ok</main>
`.trimStart());
  assert.deepEqual(messages, [
    'Use spacing(...); the \'Look.\' prefix is retired — import {spacing} from "velar/look"',
  ]);
});

test("[D52-114] the retired 'use Look.x directly' guidance is gone in every direction", async () => {
  // The two-round loop this wave most risks: a diagnostic that sends the author
  // to a spelling the next compile retires. No surviving message may name a
  // `Look.` prefix as a destination.
  const bare = webMessages(`
const shell = look:
    padding = spacing(16px, 20px)

component App:
    return <main look={shell}>ok</main>
`.trimStart());
  assert.ok(
    bare.includes('Import the builder — import {spacing} from "velar/look" — then call spacing(...)'),
    bare.join("\n"),
  );
  const imported = await projectMessages(`
import {spacing} from "velar/look"

const shell = look:
    padding = spacing(16px, 20px)

component App:
    return <main look={shell}>ok</main>
`.trimStart(), true);
  assert.deepEqual(imported, [], imported.join("\n"));
  for (const message of [...bare, ...webMessages("const shell = look:\n    padding = Look.spacing(16px)\n")]) {
    assert.doesNotMatch(message, /Look\.\w/u, message);
  }
});

test("[D52-114] every Look. diagnostic reaches a working spelling in one step", async () => {
  // Following the guidance is modelled by applying the rewrite it named. One
  // pass has to end at zero diagnostics: a second pass would mean the first
  // answer was not the surviving spelling.
  const source = `
const shell = look:
    padding = Look.spacing(16px, 20px)
    border = Look.border(1px, Look.rgb(10, 10, 10))
    background = Look.rgb(250, 250, 250)

component App:
    return <main look={shell}>ok</main>
`.trimStart();
  const fixed = await fixedOnce(source, true);
  assert.deepEqual(fixed.remaining, [], fixed.remaining.join("\n"));
  assert.match(fixed.text, /^import \{border, rgb, spacing\} from "velar\/look"$/mu);
  assert.doesNotMatch(fixed.text, /Look\./u);
});

test("[D52-114] Look. survives only as the type of a look value", async () => {
  const typed = await projectCompile(`
import {rgb} from "velar/look"

const shell: Look = look:
    color = rgb(1, 2, 3)

def paint(value: Look) -> Look:
    return value

component App:
    return <main look={paint(shell)}>ok</main>
`.trimStart(), true);
  assert.deepEqual(typed.messages, [], typed.messages.join("\n"));
  // The value position is gone: `Look` is no longer a namespace to read from.
  assert.ok(webMessages("const c = Look\nprint(str(c))\n").length > 0);
});

// ---------------------------------------------------------------------------
// D52 rule 116 — the Math. prefix arrives
// ---------------------------------------------------------------------------

test("[D52-116] Math. computes without an import", () => {
  const result = compile(`
const radius = Math.sqrt(16.0 / Math.pi)
const bounded = Math.clamp(radius, 0.0, 100.0)
print(str(Math.max(1.0, bounded, 2.0).round()))
print(str(Math.gcd(18, 12)))
`.trimStart());
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));
  assert.match(result.code ?? "", /import \* as __velarMathNamespace from "velar\/math"/u);
});

test("[D52-116] a named import from velar/math teaches the namespace in one step", async () => {
  const messages = await projectMessages('import {clamp, pi} from "velar/math"\n\nprint(str(clamp(1.0, 0.0, 2.0) + pi))\n');
  assert.deepEqual([...messages].sort(), [
    "Use Math.clamp directly; VelarScript's pure namespaces need no import",
    "Use Math.pi directly; VelarScript's pure namespaces need no import",
  ]);
});

test("[D52-116] every velar/math diagnostic reaches a working spelling in one step", async () => {
  const fixed = await fixedOnce('import {clamp, pi} from "velar/math"\n\nprint(str(clamp(1.0, 0.0, 2.0) + pi))\n');
  assert.deepEqual(fixed.remaining, [], fixed.remaining.join("\n"));
  assert.equal(fixed.text, "\nprint(str(Math.clamp(1.0, 0.0, 2.0) + Math.pi))\n");
});

test("[D52-116] an aliased velar/math import rewrites through the alias", async () => {
  const fixed = await fixedOnce('import {max as biggest} from "velar/math"\n\nprint(str(biggest(1.0, 2.0)))\n');
  assert.deepEqual(fixed.remaining, [], fixed.remaining.join("\n"));
  assert.equal(fixed.text, "\nprint(str(Math.max(1.0, 2.0)))\n");
});

test("[D52-116] a local that shadows a retired import keeps its own meaning", async () => {
  // The rewrite only claims equivalence for reads that actually reached the
  // import; a shadowing local is a different binding and is left alone.
  const fixed = await fixedOnce(`
import {sqrt} from "velar/math"

def local() -> string:
    const sqrt = "mine"
    return sqrt

print(str(sqrt(4.0)) + local())
`.trimStart());
  assert.deepEqual(fixed.remaining, [], fixed.remaining.join("\n"));
  assert.match(fixed.text, /const sqrt = "mine"/u);
  assert.match(fixed.text, /return sqrt\n/u);
  assert.match(fixed.text, /Math\.sqrt\(4\.0\)/u);
});

test("[D52-116] the number methods stay methods rather than joining Math.", async () => {
  const messages = await projectMessages('import {round, isFinite} from "velar/math"\n\nprint(str(round(1.5)) + str(isFinite(1.0)))\n');
  assert.ok(messages.some((message) => /Use 'value\.round\(\)'/u.test(message)), messages.join("\n"));
  assert.ok(messages.some((message) => /Use 'value\.isFinite\(\)'/u.test(message)), messages.join("\n"));
});

// ---------------------------------------------------------------------------
// Non-regression: Json., Promise., Text.
// ---------------------------------------------------------------------------

test("[D52-114/116] Json., Promise., and Text. are untouched", async () => {
  const result = compile(`
type User:
    id: string

async def load() -> string:
    await Promise.sleep(1ms)
    return Json.stringify({id: Text.slug("A B")})

const parsed = Json.parse("{\\"id\\": \\"a-b\\"}", User)
print(parsed.id + Text.dedent("  x") + str(Json.isSerializable(1)))
`.trimStart());
  assert.deepEqual(result.diagnostics, [], result.diagnostics.map((item) => item.message).join("\n"));

  for (const [source, expected] of [
    ['import {parse} from "velar/json"\nprint(str(parse("1")))\n', "Use Json.parse directly; VelarScript's pure namespaces need no import"],
    ['import {sleep} from "velar/async"\nawait sleep(1ms)\n', "Use Promise.sleep directly; VelarScript's pure namespaces need no import"],
    ['import {slug} from "velar/text"\nprint(slug("a b"))\n', "Use Text.slug directly; VelarScript's pure namespaces need no import"],
  ] as const) {
    const messages = await projectMessages(source);
    assert.ok(messages.includes(expected), `${source}: ${messages.join("\n")}`);
  }
});

test("[D51-106] all four namespaces are member-access heads and nothing else", () => {
  for (const namespace of ["Json", "Promise", "Text", "Math"]) {
    const messages = coreMessages(`const alias = ${namespace}\nprint(str(alias))\n`);
    assert.ok(
      messages.some((message) => new RegExp(`'${namespace}' is a namespace, not a value`, "u").test(message)),
      `${namespace}: ${messages.join("\n")}`,
    );
  }
  // A member read is still an ordinary value.
  const member = compile("const encode = Json.stringify\nprint(encode({a: 1}))\n");
  assert.deepEqual(member.diagnostics, [], member.diagnostics.map((item) => item.message).join("\n"));
});

// ---------------------------------------------------------------------------
// D51 rule 109 — Text stays a reserved type name
// ---------------------------------------------------------------------------

test("[D51-109] Text is still the bound name and still cannot name a user type", () => {
  const bound = compile(`
def label<T: Text>(value: T) -> string:
    return str(value)

print(label(1) + label("a") + label(true))
`.trimStart());
  assert.deepEqual(bound.diagnostics, [], bound.diagnostics.map((item) => item.message).join("\n"));

  for (const source of ["type Text:\n    id: string\n", "class Text:\n    const id: number = 1\n", "enum Text:\n    a\n"]) {
    const messages = coreMessages(source);
    assert.ok(
      messages.some((message) => /'Text' is a reserved type-parameter bound/u.test(message)),
      `${source}: ${messages.join("\n")}`,
    );
  }
  // Comparable and Data are unchanged by this wave.
  for (const name of ["Comparable", "Data"]) {
    const messages = coreMessages(`type ${name}:\n    id: string\n`);
    assert.ok(messages.some((message) => /is a reserved type-parameter bound/u.test(message)), `${name}: ${messages.join("\n")}`);
  }
});

// ---------------------------------------------------------------------------
// velar fix, end to end and idempotent
// ---------------------------------------------------------------------------

test("[D52-114/116] velar fix rewrites both directions once and then does nothing", async () => {
  const directory = await scratch(new Map([
    ["main.vel", `
import {clamp} from "velar/math"

const shell = look:
    padding = Look.spacing(16px, 20px)
    border = Look.border(1px, Look.rgb(10, 10, 10))

component App:
    return <main look={shell}>{str(clamp(1.0, 0.0, 2.0))}</main>
`.trimStart()],
  ]));
  try {
    const first = spawnSync(process.execPath, [cliPath, "fix", directory], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /0 diagnostics remain/u);

    const rewritten = await readFile(join(directory, "main.vel"), "utf8");
    assert.doesNotMatch(rewritten, /Look\./u);
    assert.match(rewritten, /^import \{border, rgb, spacing\} from "velar\/look"$/mu);
    assert.match(rewritten, /Math\.clamp\(1\.0, 0\.0, 2\.0\)/u);
    assert.doesNotMatch(rewritten, /from "velar\/math"/u);

    const second = spawnSync(process.execPath, [cliPath, "fix", directory], { encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /applied 0 mechanical fixes/u);
    assert.equal(await readFile(join(directory, "main.vel"), "utf8"), rewritten);

    const checked = spawnSync(process.execPath, [cliPath, "check", directory], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr + checked.stdout);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("[D52-114] a taken name blocks the rewrite and says how to import it anyway", async () => {
  // The rewrite only claims to be equivalent when the name it introduces
  // collides with nothing, so a module that already binds `spacing` is told to
  // alias rather than quietly rebound.
  const source = `
def spacing(value: number) -> number:
    return value

const shell = look:
    padding = Look.spacing(16px, 20px)

component App:
    return <main look={shell}>{str(spacing(1))}</main>
`.trimStart();
  const messages = webMessages(source);
  assert.ok(
    messages.some((message) => /already binds 'spacing'/u.test(message) && /as other/u.test(message)),
    messages.join("\n"),
  );
  const fixed = await fixedOnce(source, true);
  assert.match(fixed.text, /def spacing\(value: number\)/u);
  assert.match(fixed.text, /Look\.spacing/u);
});
