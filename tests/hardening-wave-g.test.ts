import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { compile as compileCore, formatSource } from "@velarscript/compiler";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";

// Wave G: D30 item 16 (reserved-word softening), D43 item 67 (the '@name'
// convention and the '$velar' retirement), and the three grid items completeness
// audit eleven filed against them -- the '{computed}' shorthand, the declaration
// / call-side 'from' asymmetry, and the W-1 Core/Web split.
//
// The centrepiece is the audit's own collision grid, reconstructed as a test:
// every softened word times every name position, in a Core module and in a Web
// module, plus the declaration shape each word still owns.

const CORE_SOFT_WORDS = ["type", "match", "from", "as"] as const;
const WEB_SOFT_WORDS = ["component", "state", "resource", "action", "watch", "look", "keyframes", "css", "expose", "exposes"] as const;
const SOFT_WORDS = [...CORE_SOFT_WORDS, ...WEB_SOFT_WORDS] as const;
const HARD_WORDS = ["enum", "class", "if", "for", "def", "const", "import"] as const;
// `case` is softened as a VelarScript word — it is a record field and a member
// name like its siblings — but JavaScript reserves the spelling, so no binding
// may take it. D30 item 16 listed it with the softened five; the emitted-code
// constraint the same item invokes for `enum` applies to `case` too.
const JAVASCRIPT_RESERVED_WORDS = ["case", "default", "typeof"] as const;

// One source per name position the audit measured. Each keeps the binding's
// value observable, so the grid is checked by execution, not only by parsing.
const POSITIONS: Readonly<Record<string, (word: string) => string>> = {
  binding: (word) => `const ${word} = "bound"\nprint(${word})\n`,
  parameter: (word) => `def echo(${word}: string) -> string:\n    return ${word}\nprint(echo("bound"))\n`,
  loopBinding: (word) => `for ${word} in ["bound"]:\n    print(${word})\n`,
  namedArgument: (word) => `def echo(${word}: string) -> string:\n    return ${word}\nprint(echo(${word} = "bound"))\n`,
  recordField: (word) => `const holder = {${word}: "bound"}\nprint(holder.${word})\n`,
  memberName: (word) => `type Holder:\n    ${word}: string\nconst holder: Holder = {${word}: "bound"}\nprint(holder.${word})\n`,
  recordShorthand: (word) => `const ${word} = "bound"\nconst holder = {${word}}\nprint(holder.${word})\n`,
};

function compile(source: string, web: boolean) {
  return web ? compileCore(source, { extensions: [velarCompilerExtension] }) : compileCore(source);
}

function messages(source: string, web: boolean): readonly string[] {
  return compile(source, web).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function executeModule(code: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--input-type=module"], { encoding: "utf8", input: code });
}

function runClean(source: string, web: boolean, label: string): string {
  const result = compile(source, web);
  assert.deepEqual(result.diagnostics.map((item) => `${item.code} ${item.message}`), [], label);
  const execution = executeModule(result.code ?? "");
  assert.equal(execution.status, 0, `${label}: ${execution.stderr}`);
  return String(execution.stdout);
}

function clean(source: string, web: boolean, label: string): void {
  assert.deepEqual(messages(source, web), [], label);
}

// ---------------------------------------------------------------------------
// The collision grid. Before this wave: the five Core words were rejected in
// every name position in both project kinds, and the Web words were accepted in
// a Core module and rejected in a Web one -- the W-1 portability break, spelled
// out position by position.
// ---------------------------------------------------------------------------

test("[wave G] every softened word is an ordinary name in every name position, in Core and in Web", () => {
  for (const word of SOFT_WORDS) {
    for (const [position, build] of Object.entries(POSITIONS)) {
      for (const web of [false, true]) {
        const label = `${word} / ${position} / ${web ? "web" : "core"}`;
        assert.equal(runClean(build(word), web, label).trim(), "bound", label);
      }
    }
  }
});

test("[wave G] Core and Web agree on every softened word — the W-1 split is closed", () => {
  for (const word of SOFT_WORDS) {
    for (const build of Object.values(POSITIONS)) {
      const source = build(word);
      assert.deepEqual(messages(source, false), messages(source, true), `${word} must compile the same way in both project kinds`);
    }
  }
});

// ---------------------------------------------------------------------------
// The other half of the grid: each word still owns its declaration.
// ---------------------------------------------------------------------------

test("[wave G] each softened Core word still parses in its own declaration position", () => {
  assert.equal(runClean(`
type Payload:
    id: string

const payload: Payload = {id: "bound"}
print(payload.id)
`.trimStart(), false, "type declaration"), "bound\n");

  assert.equal(runClean(`
const value = "ping"
match value:
    case "ping":
        print("bound")
    case _:
        print("other")
`.trimStart(), false, "match statement"), "bound\n");

  assert.equal(runClean(`
const value = "ping"
match (value):
    case "ping", "pong":
        print("bound")
    case _:
        print("other")
`.trimStart(), false, "parenthesized match subject"), "bound\n");

  assert.equal(runClean(`
type Payload:
    id: string

def describe(value: Payload|string) -> string:
    match value:
        case string as text:
            return text
        case _:
            return "record"

print(describe("bound"))
`.trimStart(), false, "case ... as pattern"), "bound\n");

  // The import and re-export productions still read their contextual words; the
  // module graph is a project concern, so only parse-level failures matter here.
  for (const source of [
    `import {readFile as read} from "velar/fs"\n`,
    `import * as fs from "velar/fs"\n`,
    `export {load as loadFile} from "./reader.vel"\n`,
  ]) {
    const reported = messages(source, false).filter((item) => item.startsWith("VEL1") || item.startsWith("VEL2"));
    assert.deepEqual(reported, [], source);
  }
});

test("[wave G] each softened Web word still parses in its own declaration position", () => {
  clean(`
import css unsafe "./theme.css" before look

const card = look:
    color = "red"

const spin = keyframes:
    from:
        opacity = 0
    to:
        opacity = 1

type Handle:
    reset: () -> null

component Panel(label: string) exposes Handle:
    state count = 0
    resource title: string = loadTitle()
    action bump():
        count = count + 1

    watch count:
        print("changed")

    def reset():
        count = 0

    expose {reset: reset}

    return <section look={card}>{label}{str(count)}{title.value ?? ""}</section>

async def loadTitle() -> string:
    return "t"
`.trimStart(), true, "every Web declaration head");
});

test("[wave G] a declaration and a same-named binding live in one module", () => {
  assert.equal(runClean(`
type Payload:
    type: string

const payload: Payload = {type: "bound"}
const type = payload.type
const match = type
match match:
    case "bound":
        print(type)
    case _:
        print("other")
`.trimStart(), false, "type and match as names beside their declarations"), "bound\n");

  clean(`
component Panel:
    const state = "ready"
    const watch = 1
    const look = "plain"
    state count = 0

    watch count:
        print(state + look + str(watch))

    return <p>{state}</p>
`.trimStart(), true, "Web declarations beside same-named bindings");
});

// ---------------------------------------------------------------------------
// Where the two readings could compete, the name wins.
// ---------------------------------------------------------------------------

test("[wave G] a call, an assignment, and a member read on a softened word keep the name reading", () => {
  assert.equal(runClean(`
def match(value: string) -> string:
    return value

def watch(value: string) -> string:
    return value

let type = "a"
type = "bound"
const holder = {look: "!"}
print(match(type) + watch("") + holder.look)
`.trimStart(), true, "call, assignment, and member read"), "bound!\n");
});

test("[wave G] a module named css still imports by name", () => {
  const messagesReported = messages(`
import css from "./theme.vel"

print(str(css))
`.trimStart(), true);
  assert.ok(!messagesReported.some((item) => item.includes("unsafe boundary")), JSON.stringify(messagesReported));
});

// ---------------------------------------------------------------------------
// The words that stay reserved now say so (D30's diagnostic half).
// ---------------------------------------------------------------------------

test("[wave G] a hard-reserved word in a name position is named by the diagnostic", () => {
  for (const word of HARD_WORDS) {
    assert.ok(
      messages(`const ${word} = 1\n`, false).some((item) => item.includes(`'${word}' is a VelarScript keyword and cannot be a binding name`)),
      `${word} binding`,
    );
    assert.ok(
      messages(`def probe(${word}: number) -> number:\n    return 1\n`, false)
        .some((item) => item.includes(`'${word}' is a VelarScript keyword and cannot be a parameter name`)),
      `${word} parameter`,
    );
  }

  assert.ok(
    messages(`for enum in [1]:\n    pass\n`, false).some((item) => item.includes("'enum' is a VelarScript keyword and cannot be a binding name")),
    "enum loop binding",
  );
  assert.deepEqual(
    messages(`const holder = {enum}\n`, false),
    ["VEL2020 'enum' is a VelarScript keyword, so no binding spells it; write 'enum: value'"],
  );
  assert.deepEqual(
    messages(`print(enum)\n`, false),
    ["VEL2002 'enum' is a VelarScript keyword and cannot be a name; choose another name"],
  );
});

test("[wave G] a Web block word in a Core module names the missing extension", () => {
  for (const word of ["look", "keyframes"]) {
    assert.ok(
      messages(`const value = ${word}:\n    color = "red"\n`, false)
        .some((item) => item === `VEL2035 '${word}:' belongs to @velarscript/web; add "@velarscript/web" to velar.json extensions, or move this module into a Web project`),
      word,
    );
  }
});

test("[wave G] 'case' is softened as a word but JavaScript still reserves the binding", () => {
  for (const word of JAVASCRIPT_RESERVED_WORDS) {
    assert.deepEqual(
      messages(`const ${word} = 1\n`, false),
      [`VEL3007 '${word}' is reserved by JavaScript and cannot be used as a VelarScript binding`],
      `${word} binding`,
    );
    assert.deepEqual(
      messages(`for ${word} in [1]:\n    print(str(${word}))\n`, false),
      [`VEL3007 '${word}' is reserved by JavaScript and cannot be used as a VelarScript binding`],
      `${word} loop binding`,
    );
    assert.deepEqual(
      messages(`const holder = {${word}}\n`, false),
      [`VEL3007 Write '${word}: value'; '${word}' is a name JavaScript reserves, so the shorthand has no binding of that name to read`],
      `${word} shorthand`,
    );
  }

  // The positions JavaScript itself allows stay open, and the match branch
  // keyword is untouched.
  assert.equal(runClean(`
type Holder:
    case: string

const holder: Holder = {case: "bound"}
match holder.case:
    case "bound":
        print(holder.case)
    case _:
        print("other")
`.trimStart(), false, "case as a field, a member, and a match branch"), "bound\n");
});

test("[wave G] a reserved parameter name reports once instead of cascading", () => {
  assert.deepEqual(
    messages(`def probe(enum: number, count: number) -> number:\n    return count\n`, false),
    ["VEL2001 'enum' is a VelarScript keyword and cannot be a parameter name; choose another name"],
  );
  assert.deepEqual(
    messages(`def probe(case: number) -> number:\n    return case\n`, false),
    ["VEL3007 'case' is reserved by JavaScript and cannot be used as a VelarScript binding"],
  );
});

// ---------------------------------------------------------------------------
// Grid item: '{cached}' silently captured the builtin. D71 rule 183 moved the
// reserved global from `computed` to `cached`, and D90 R15(b) removed `cached`
// itself — a derived value has one spelling now, the `computed` declaration.
// Neither word is a reserved global any more, so the rule is exercised on the
// reserved binding that remains. `computed` in a value position still names the
// declaration form, because a call is the habit Vue and the signals libraries
// teach; `cached` is nobody's habit and is an ordinary unknown name (D90 R22).
// ---------------------------------------------------------------------------

test("[wave G] a record shorthand naming a reserved binding is refused instead of capturing the builtin", () => {
  assert.deepEqual(
    messages(`component Panel:\n    const holder = {mount}\n    return <p>x</p>\n`, true),
    ["VEL3007 Write 'mount: value'; 'mount' is a reserved extension binding, so the shorthand has no binding of that name to read"],
  );
  assert.deepEqual(
    messages(`const holder = {print}\n`, false),
    ["VEL3007 Write 'print: value'; 'print' is a reserved Core binding, so the shorthand has no binding of that name to read"],
  );
  // The sibling reading: a softened word's shorthand resolves an ordinary
  // binding, and reports an unknown name when there is none.
  assert.deepEqual(
    messages(`component Panel:\n    const holder = {state}\n    return <p>x</p>\n`, true),
    ["VEL3001 Unknown name 'state'"],
  );
  // D71 rule 183: `computed` is a softened word too now, but a value position
  // still reaches the retired global, so it names the declaration form rather
  // than reporting an unknown name.
  assert.deepEqual(
    messages(`component Panel:\n    const holder = {computed}\n    return <p>x</p>\n`, true),
    ["VEL5055 'computed' declares a derived value — 'computed name = expression'. There is no function form, and 'computed' already caches"],
  );
  // D90 R22: `cached` is an ordinary unknown name.
  assert.deepEqual(
    messages(`component Panel:\n    const holder = {cached}\n    return <p>x</p>\n`, true),
    ["VEL3001 Unknown name 'cached'"],
  );
  clean(`const cached = 1\nconst holder = {cached}\nprint(str(holder.cached))\n`, false, "cached is an ordinary Core name");
  // The Web twin holds now too: the name is the author's in both modules, and
  // declaring it shadows the retired-spelling diagnostic rather than colliding.
  clean(`const cached = 1\nconst holder = {cached}\nprint(str(holder.cached))\n`, true, "cached is an ordinary Web name");
});

// ---------------------------------------------------------------------------
// Grid item: 'def f(from: ...)' cascaded while the call side special-cased
// 'from' as a named-argument label because stdlib signatures use it.
// ---------------------------------------------------------------------------

test("[wave G] the declaration and call sides of 'from' agree", () => {
  assert.equal(runClean(`
def slice(from: number, to: number) -> number:
    return to - from

print(str(slice(from = 1, to = 4)))
`.trimStart(), false, "from on both sides"), "3\n");

  // The call side no longer knows the word at all: an unknown label is reported
  // as an unknown label, exactly like any other name.
  assert.ok(
    messages(`def probe(count: number) -> number:\n    return count\nprint(str(probe(from = 1)))\n`, false)
      .some((item) => item.includes("Unknown named argument 'from'")),
    "unknown 'from' label",
  );
});

// ---------------------------------------------------------------------------
// D43 item 67: the '@name' namespace.
// ---------------------------------------------------------------------------

test("[wave G] the lifecycle hooks are '@mounted' and '@cleanup', and coexist with a user's own methods", () => {
  clean(`
component Panel:
    state ready = false

    def mounted():
        ready = true

    def cleanup():
        ready = false

    @mounted:
        mounted()

    @cleanup:
        cleanup()

    return <p>{str(ready)}</p>
`.trimStart(), true, "def mounted() beside @mounted:");
});

test("[wave G] the retired bare hook spelling gets one directed message and still analyzes its body", () => {
  const reported = messages(`
component Panel:
    mounted:
        print("in")

    return <p>x</p>
`.trimStart(), true);
  assert.deepEqual(reported, [
    "VEL5061 Use '@mounted:'; it is a compiler-owned component name, which leaves 'mounted' free for your own method",
  ]);
});

test("[wave G] an unknown compiler-owned name reports the component vocabulary", () => {
  assert.deepEqual(
    messages(`component Panel:\n    @started:\n        print("in")\n\n    return <p>x</p>\n`, true),
    ["VEL5061 Unknown compiler-owned name '@started' in a component; the component namespace contains only '@mounted:' and '@cleanup:'"],
  );
  assert.ok(
    messages(`@mounted:\n    print("in")\n`, false)
      .some((item) => item.includes("the module namespace contains only '@main:'")),
    "the module owns a closed compiler namespace",
  );
});

test("[wave G] '@' selects one closed compiler namespace and never creates a runtime value", () => {
  assert.deepEqual(
    messages(`class Handle:\n    @mounted:\n        pass\n`, false),
    ["VEL2022 Unknown compiler-owned name '@mounted' in a class; the class namespace contains only '@dispose:' and '@iterate:'"],
  );
  assert.deepEqual(
    messages(`component Panel:\n    @dispose:\n        pass\n\n    return <p>x</p>\n`, true),
    ["VEL5061 Unknown compiler-owned name '@dispose' in a component; the component namespace contains only '@mounted:' and '@cleanup:'"],
  );
  assert.ok(
    messages(`const hook = @mounted\n`, false)
      .some((item) => item.includes("'@mounted' is a compiler-owned contextual name and is not valid here")),
    "an @name is not a storable expression",
  );
});

test("[wave G] duplicate lifecycle hooks are reported with their '@' spelling", () => {
  assert.ok(
    messages(`component Panel:\n    @mounted:\n        print("a")\n\n    @mounted:\n        print("b")\n\n    return <p>x</p>\n`, true)
      .some((item) => item.includes("has more than one '@mounted' block")),
    "duplicate @mounted",
  );
});

// ---------------------------------------------------------------------------
// D43 item 67: one generated-name prefix.
// ---------------------------------------------------------------------------

test("[wave G] generated JavaScript uses one '__velar' prefix and '$velar' is free source", () => {
  const emitted = compile(`
component Panel:
    state count = 0
    return <p>{str(count)}</p>
`.trimStart(), true);
  assert.deepEqual(emitted.diagnostics, []);
  assert.ok(!(emitted.code ?? "").includes("$velar"), "no '$velar' name survives in emitted Web code");
  assert.match(emitted.code ?? "", /__velarComponentScope/u);

  clean(`const $velarRoot = 1\nprint(str($velarRoot))\n`, false, "'$velar' is an ordinary source spelling now");
  assert.ok(
    messages(`const __velarRoot = 1\n`, false).some((item) => item.includes("reserved compiler prefix '__velar'")),
    "'__velar' stays reserved",
  );
});

// ---------------------------------------------------------------------------
// The formatter reads the same shapes the parser does.
// ---------------------------------------------------------------------------

test("[wave G] the formatter keeps softened words and '@' hooks stable", () => {
  const samples: readonly (readonly [string, boolean])[] = [
    [`const type = 1\nconst match = 2\nconst state = 3\nprint(str(type + match + state))\n`, true],
    [`def match(value: number) -> number: return value\nprint(str(match(2)))\n`, false],
    [`const value = 1\nmatch value:\n    case 1: print("one")\n    case _: print("other")\n`, false],
    [`const value = 1\nmatch (value):\n    case 1: print("one")\n    case _: print("other")\n`, false],
    [`component Panel:\n    @mounted:\n        print("in")\n\n    @cleanup:\n        print("out")\n    return <p>x</p>\n`, true],
  ];
  for (const [source, web] of samples) {
    assert.equal(formatSource(source, web ? { extensions: [velarCompilerExtension] } : {}), source, source);
  }
});
