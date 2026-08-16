import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { applyMechanicalFixes, compile as compileCore } from "@velarscript/compiler";
import { makeTemporaryDirectory, removeTemporaryDirectories } from "./temporary-directory.ts";
import { repositoryRoot } from "./repository-root.ts";
import { compileProject } from "../packages/cli/src/project.ts";
import { velarCompilerExtension } from "../packages/web/src/compiler.ts";
import {
  LOOK_KEYWORD_DECIDED_KINDS,
  LOOK_PROPERTY_KEYWORDS,
  LOOK_PROPERTY_VALUE_KINDS,
} from "../packages/web/src/look.ts";
import { WEB_OWNED_TYPE_NAMES } from "../packages/web/src/types.ts";

// ---------------------------------------------------------------------------
// D71 rule 182-184, D69 rule 178, D70 rule 179-180, D72 rule 186, D73 rule 187.
//
// Four of the five close the same family from different sides: a construct that
// compiles clean and then does nothing. `watch total:` held a whole block that
// could never run; a Look value outside a property's real grammar reached CSS
// as a declaration the browser drops; a reactive read frozen into setup showed
// the wrong text forever. The fifth, D71, is the design fix underneath two of
// them: `computed name = expression` is a declaration now, so the missing
// parentheses that produced the dead `watch` cannot be written.
//
// Every probe here sits at the level its ruling's evidence was taken at. The
// diagnostics are checked where they are produced; the frozen-read detector is
// a runtime behaviour and is driven through a real reactive graph in
// tests/browser.acceptance.ts, whose fixture project this file's siblings feed.
// ---------------------------------------------------------------------------

const root = repositoryRoot;
const cli = join(root, "packages", "cli", "src", "cli.ts");

after(removeTemporaryDirectories);

function compile(text: string) {
  return compileCore(text.trimStart(), { extensions: [velarCompilerExtension] });
}

function messages(text: string): readonly string[] {
  return compile(text).diagnostics.map((item) => `${item.code} ${item.message}`);
}

function run(arguments_: readonly string[]): Promise<{ readonly output: string; readonly code: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", rejectPromise);
    child.once("close", (code) => resolvePromise({ output, code }));
  });
}

async function webProject(prefix: string, modules: Readonly<Record<string, string>>): Promise<string> {
  const directory = await makeTemporaryDirectory(prefix);
  await mkdir(join(directory, "src"), { recursive: true });
  await mkdir(join(directory, "node_modules", "@velarscript"), { recursive: true });
  await symlink(join(root, "packages", "web"), join(directory, "node_modules", "@velarscript", "web"), "dir");
  await writeFile(join(directory, "velar.json"), JSON.stringify({
    formatVersion: 2,
    entry: "src/main.vel",
    outDir: "dist",
    extensions: ["@velarscript/web"],
    web: { title: "D69-D73", base: "/" },
  }), "utf8");
  for (const [name, source] of Object.entries(modules)) {
    await writeFile(join(directory, "src", name), source, "utf8");
  }
  return directory;
}

// ---------------------------------------------------------------------------
// D71 rule 182 — the four-cell grid, and `computed` as the read-only reactive
// half of it.
// ---------------------------------------------------------------------------

test("[D71-182] computed declares in all three scopes, reads bare, and is not assignable", () => {
  const module = `
state total = 0
computed banner = f"{total} open"

def scopedCounter() -> string:
    state local = 1
    computed doubled = local * 2
    return f"{doubled}"

export component App:
    state count = 0
    computed label = count * 2
    return <p>{label} {banner} {scopedCounter()}</p>
`;
  const result = compile(module);
  assert.deepEqual(result.diagnostics, []);
  // A bare read lowers through the same `.get()` a state read does; there is no
  // call anywhere in the output.
  assert.match(result.code ?? "", /const banner = __velarComputed\(\(\) => \(`\$\{total\.get\(\)\} open`\)\);/u);
  assert.match(result.code ?? "", /const label = __velarComputed\(\(\) => \(\(count\.get\(\) \* 2\)\)\);/u);
  assert.match(result.code ?? "", /label\.get\(\)/u);
});

test("[D71-182] a derived value refuses every writable position, and says why", () => {
  assert.deepEqual(
    messages(`
export component App:
    state count = 0
    computed doubled = count * 2

    action bump():
        doubled = 5

    return <p>{doubled}</p>
`),
    ["VEL5063 'doubled' is a computed value: it is recomputed from what it reads and is never assigned. Assign the state it reads, or declare it 'state doubled = ...' if this value is written directly"],
  );
  // `bind:` asks the same question through a different door: D47 rule 84's
  // writable-location test must keep answering no for a derived name.
  assert.deepEqual(
    messages(`
export component App:
    state text = ""
    computed shouted = text.upper()
    return <input bind:value={shouted} />
`),
    ["VEL5019 bind:value requires a writable reactive location: a state name, or a field or index path on one such as bind:value={form.name} or bind:value={items[0]}"],
  );
});

test("[D71-182] calling a derived value names the bare read, and carries the edit that reaches it", () => {
  const result = compile(`
export component App:
    state count = 0
    computed doubled = count * 2
    return <p>{doubled()}</p>
`);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0]?.code, "VEL5063");
  assert.match(result.diagnostics[0]?.message ?? "", /it is read bare like state, so write 'doubled' rather than 'doubled\(\)'/u);
  assert.ok(result.diagnostics[0]?.fix);
});

test("[D71-183] the retired computed function is answered once, with the rename it needs", () => {
  const result = compile("state count = 1\nconst reader = computed(() => count)\nprint(str(reader()))\n");
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics[0]?.code, "VEL5055");

  // In an expression position the migration is a pure rename, and `velar fix`
  // may take it: `cached` preserves behaviour exactly.
  const expression = compile("state count = 1\nconst bag = {read: computed(() => count)}\nprint(str(bag.read()))\n");
  assert.equal(expression.diagnostics.length, 1, JSON.stringify(expression.diagnostics));
  assert.match(expression.diagnostics[0]?.message ?? "", /The function that returns a cached reader is now 'cached'/u);
  assert.ok(expression.diagnostics[0]?.fix);
});

test("[D71-186] const bound to cached(...) is legal, because reading it is a visible call", () => {
  // D71 answers this question explicitly and asks for a test that pins the
  // answer: the accessor is an ordinary value, and `x()` says so at every read.
  assert.deepEqual(
    messages(`
export component App:
    state count = 0
    const reader = cached(() => count * 2)
    const bag = {read: cached(() => count)}
    return <p>{reader()} {bag.read()}</p>
`),
    [],
  );
});

test("[D71-183] an exported cached reader still needs its contract at the boundary", () => {
  assert.deepEqual(
    messages(`export const one = cached(() => 1)\n`),
    ["VEL4025 Exported cached readers need an explicit contract at the export boundary; write 'export const one: () -> T = cached(...)', or declare the derived value itself with 'export computed one = ...'"],
  );
  assert.deepEqual(messages(`export const one: () -> number = cached(() => 1)\n`), []);
  assert.deepEqual(messages(`export computed one = 1\n`), []);
});

test("[D71-183] the boundary contract is owned by the extension that owns the word", () => {
  // The core analyzer used to key this rule on the literal name `computed`.
  // After the rename that check could only fire on the retired spelling, where
  // it contradicted the migration standing next to it — it told the author to
  // annotate and keep writing `computed(...)` while the Web analyzer told them
  // `computed` is a declaration keyword now. Core owns no reactive vocabulary
  // at all, so the rule belongs to the extension that publishes `cached`.
  assert.deepEqual(
    messages(`export const one = computed(() => 1)\n`),
    ["VEL5055 A derived value is declared, not called: write 'computed one = ...' and read 'one' bare."],
  );
  // With no extension there is no `computed` and no `cached`, so the only
  // truthful answer is that the name is unknown.
  assert.deepEqual(
    compileCore(`export const one = computed(() => 1)\n`).diagnostics.map((item) => `${item.code} ${item.message}`),
    ["VEL3001 Unknown name 'computed'"],
  );
  // A module that declares its own `computed` function keeps it, and gets no
  // boundary complaint invented for a word core never owned.
  assert.deepEqual(
    compileCore(`def computed(read: () -> number) -> () -> number:\n    return read\n\nexport const one = computed(() => 1)\n`).diagnostics,
    [],
  );
});

test("[D71] velar fix carries a whole module from the retired spelling to the declaration", () => {
  let text = `
export state tasks: List<string> = []
export const openTasks: () -> number = computed(() => tasks.size)

export component App:
    state count = 0
    const doubled = computed(() => count * 2)
    const label = computed(() => f"{doubled()} of {openTasks()}")
    return <p>{label()}</p>
`.trimStart();
  for (let pass = 0; pass < 8; pass += 1) {
    const applied = applyMechanicalFixes(text, compile(text).diagnostics);
    if (applied.applied.length === 0) break;
    text = applied.text;
  }
  assert.equal(text, `
export state tasks: List<string> = []
export computed openTasks = tasks.size

export component App:
    state count = 0
    computed doubled = count * 2
    computed label = f"{doubled} of {openTasks}"
    return <p>{label}</p>
`.trimStart());
  assert.deepEqual(compile(text).diagnostics, []);
});

test("[D71-184] an exported computed crosses a module boundary as a live read-only value", async () => {
  const directory = await webProject("velar-d71-184-export-", {
    "store.vel": "export state tasks: List<string> = []\nexport computed openTasks = tasks.size\n",
    "main.vel": `
import {openTasks, tasks} from "./store.vel"

export component App:
    return <p>{openTasks} {tasks.size}</p>

mount(<App />, "#app")
`.trimStart(),
  });
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);

  // The importing module reads it bare and cannot write it -- neither by
  // assignment nor through the writable-location test `bind:` uses.
  await writeFile(join(directory, "src", "main.vel"), `
import {openTasks} from "./store.vel"

export component App:
    action bad():
        openTasks = 5
    return <div><input bind:value={openTasks} /><p>{openTasks}</p></div>

mount(<App />, "#app")
`.trimStart(), "utf8");
  const refused = await run(["check", directory]);
  assert.equal(refused.code, 1, refused.output);
  assert.match(refused.output, /VEL5063: 'openTasks' is a computed value derived in the module it comes from/u);
  assert.match(refused.output, /VEL5019: bind:value requires a writable reactive location/u);
});

test("[D71-184] a local state shadowing an imported computed is still writable state", async () => {
  // The import is demoted to the read-only reactive identity by name, so the
  // demotion has to stop at the import: a component's own `state` of the same
  // name is a shadow that really is writable, and compiling its assignment as a
  // plain store into the handle would be a miscompile rather than a diagnostic.
  const directory = await webProject("velar-d71-184-shadow-", {
    "store.vel": "export state tasks: List<string> = []\nexport computed openTasks = tasks.size\n",
    "main.vel": `
import {openTasks} from "./store.vel"

export component App:
    state openTasks = 0

    action bump():
        openTasks += 1

    return <p>{openTasks}</p>

mount(<App />, "#app")
`.trimStart(),
  });
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);
  const project = await compileProject(join(directory, "src", "main.vel"), new Map(), {
    sourceRoot: join(directory, "src"),
    projectRoot: directory,
    extensions: [velarCompilerExtension],
  });
  const main = project.modules.find((item) => item.relativePath.endsWith("main.vel"));
  assert.ok(main, project.modules.map((item) => item.relativePath).join(", "));
  assert.match(main.result.code ?? "", /openTasks\.set\(openTasks\.get\(\) \+ 1\);/u);
});

test("[D71-9] a derived value is not a readonly projection, because derivation is not an ownership boundary", () => {
  // D71 asks for this to be investigated rather than assumed. A component prop
  // is a readonly data view because it belongs to another component; a derived
  // value names an object this scope already owns, exactly as `const alias =
  // tasks[0]` does. Making `computed` readonly would refuse a write that the
  // identical `const` spelling allows, which is a difference the grid does not
  // have. Pinned so a later wave has to overturn the reason rather than the
  // omission.
  assert.deepEqual(
    messages(`
type Task:
    title: string

export component App:
    state tasks: List<Task> = [{title: "a"}]
    computed first = tasks[0]
    const alias = tasks[0]

    action edit():
        first.title = "one"
        alias.title = "two"

    return <p>{first.title}</p>
`),
    [],
  );
  assert.deepEqual(
    messages(`
type Task:
    title: string

export component Row(task: readonly Task):
    action edit():
        task.title = "changed"
    return <p>{task.title}</p>
`),
    ["VEL3002 Cannot mutate prop 'task': this component's author explicitly declared it 'readonly'. Cannot assign through readonly Task; it is a read-only view"],
  );
});

// ---------------------------------------------------------------------------
// D69 rule 178 — a watch subject that cannot change.
// ---------------------------------------------------------------------------

test("[D69-178] a watch subject that can never change is refused, and a reader that was not called is told to call it", () => {
  const module = `
export component App:
    state count = 0
    computed doubled = count * 2
    const plain = 7
    const reader = cached(() => count * 2)

    watch reader:
        print("dead")
    watch 5:
        print("dead")
    watch "x":
        print("dead")
    watch plain:
        print("dead")
    watch plain as now, before:
        print("dead")
    watch plain + 1:
        print("dead")

    return <p>{count} {doubled}</p>
`;
  assert.deepEqual(messages(module), [
    "VEL5064 'reader' is the reader itself, so watching it watches a value that never changes; write 'watch reader():' to watch what it reads",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run — 'plain' is not a reactive source; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run — 'plain' is not a reactive source; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
    "VEL5064 This watch subject never changes, so its body can never run; watch a 'state', a 'computed', a prop, or a resource field, or move these statements to where they should run",
  ]);
});

test("[D69-178] every reactive subject the ruling lists still passes", () => {
  assert.deepEqual(
    messages(`
async def load(n: number) -> number:
    return n

export component Panel(title: string):
    state count = 0
    state tasks: List<bool> = [false]
    computed doubled = count * 2
    const reader = cached(() => count * 2)
    resource data: number = load(count)

    watch count:
        print("state")
    watch doubled:
        print("computed")
    watch title:
        print("prop")
    watch tasks[0]:
        print("reactive field path")
    watch data.value:
        print("resource field")
    watch reader():
        print("a called reader")
    watch count + 1:
        print("an expression over a reactive read")
    watch count as now, before:
        print("with names")

    return <p>{count} {doubled}</p>
`),
    [],
  );
});

test("[D69-178] the rule refuses only what it can prove, so a call keeps its benefit of the doubt", () => {
  // The rejection cannot be "no reactive read is visible here": the whole D70
  // bug is a call whose reactivity lives in another module, and `alias.done` on
  // a const bound to a reactive element tracks through the deep graph. A rule
  // that fired on either of those would refuse live code, which is worse than
  // the hole it closes.
  assert.deepEqual(
    messages(`
type Composer:
    text: (english: string, chinese: string) -> string

state siteLocale = "zh"

export def useLocale() -> Composer:
    return {text: (english, chinese) => siteLocale == "zh" ? chinese : english}

export component App:
    const locale = useLocale()
    state tasks: List<string> = []
    const alias = tasks

    watch locale.text("English", "Chinese"):
        print("live through a call into another scope")
    watch alias.size:
        print("live through a const alias of a reactive list")

    return <p>{locale.text("English", "Chinese")}</p>
`),
    [],
  );
});

test("[D69-178] the neighbours judged with it keep their behaviour, on the record", () => {
  // A `cached(...)` with no reactive dependency is not the same defect: it
  // evaluates once and every read gets that value. Nothing is discarded, so
  // nothing is refused. The dead `watch` was refused because a *block of
  // statements* could never run.
  assert.deepEqual(messages(`export const five: () -> number = cached(() => 5)\nprint(str(five()))\n`), []);
  assert.deepEqual(messages(`computed five = 5\nprint(str(five))\n`), []);
  // Likewise a resource whose input is not reactive: it still loads once at
  // mount and still reloads on demand, so its whole job is done.
  assert.deepEqual(
    messages(`
async def load(id: string) -> string:
    return id

export component App:
    const id = "fixed"
    resource data: string = load(id)
    return <p>{data.value ?? "loading"}</p>
`),
    [],
  );
});

// ---------------------------------------------------------------------------
// D70 rules 179-180 — the frozen reactive read, reported on divergence.
// ---------------------------------------------------------------------------

test("[D70-180] the detector is installed only where the development host published its hooks", () => {
  const result = compile(`
export state locale = "zh"

export component App:
    const frozen = locale
    return <p>{frozen}</p>

mount(<App />, "#app")
`);
  assert.deepEqual(result.diagnostics, []);
  const code = result.code ?? "";
  // The gate is a single read of the published hooks at runtime-module load, so
  // a production build carries no map, no stack capture, and one already-false
  // constant on the read path.
  assert.match(code, /const __velarFrozenHooks = \(\(\) => \{\n {2}const hooks = globalThis\.__velarDevelopmentHooks;/u);
  assert.match(code, /if \(!__velarFrozenHooks\) return;/u);
  // Setup is bracketed so an event handler, an action, a lifecycle hook and a
  // watch body -- every legitimate point-in-time read -- are outside the window.
  assert.match(code, /const __velarComponentScope = __velarSetupBegin\(__velarScope\("App"\)\);/u);
  assert.match(code, /return __velarSetupEnd\(__velarComponent\(/u);
  // The report fires from the write path, not the read path: that is the whole
  // difference between a warning that is worth trusting and one people turn off.
  assert.match(code, /__velarReportFrozenReads\(cell, next\);/u);
});

// ---------------------------------------------------------------------------
// D72 rule 186 — a user type name never silently loses to a Web built-in.
// ---------------------------------------------------------------------------

test("[D72-186] a user declaration of a Web type name is refused where it is written", () => {
  assert.deepEqual(
    messages(`
type Event:
    kind: string

def describe(event: Event) -> string:
    return event.kind
`).filter((message) => message.startsWith("VEL5065")),
    ["VEL5065 'Event' is a Web type name, so it cannot also name a type; every use of it in a Web module resolves to the built-in. Rename this declaration"],
  );
});

test("[D72-186] the refusal is derived from the published table, name by name", () => {
  // Not the six event types D72 found, and not a list beside them: every name
  // the extension registers is protected, and adding one to the table extends
  // the protection with it. The floor keeps the loop from passing vacuously.
  assert.ok(WEB_OWNED_TYPE_NAMES.size >= 30, String(WEB_OWNED_TYPE_NAMES.size));
  for (const name of WEB_OWNED_TYPE_NAMES) {
    assert.deepEqual(
      messages(`type ${name}:\n    field: string\n`).filter((message) => message.startsWith("VEL5065")),
      [`VEL5065 '${name}' is a Web type name, so it cannot also name a type; every use of it in a Web module resolves to the built-in. Rename this declaration`],
      name,
    );
  }
});

test("[D72-186] every declaration form that introduces a name is covered", () => {
  const forms: readonly (readonly [source: string, noun: string])[] = [
    ["type Color:\n    hex: string\n", "type"],
    ["type Color = string\n", "type"],
    ["class Element:\n    def read() -> string:\n        return \"x\"\n", "class"],
    ["enum Blob:\n    small\n    large\n", "enum"],
    ["import {File} from \"./other.vel\"\n", "imported name"],
    ["import {thing as Look} from \"./other.vel\"\n", "import alias"],
  ];
  for (const [source, noun] of forms) {
    const name = /'(\w+)'/u.exec(messages(source).find((message) => message.startsWith("VEL5065")) ?? "")?.[1];
    assert.ok(name, source);
    assert.deepEqual(
      messages(source).filter((message) => message.startsWith("VEL5065")),
      [`VEL5065 '${name}' is a Web type name, so it cannot also name ${/^[aeiou]/iu.test(noun) ? "an" : "a"} ${noun}; every use of it in a Web module resolves to the built-in. Rename this declaration`],
      source,
    );
  }
});

test("[D72-186] importing a published type under its own name is the built-in, not a shadow", async () => {
  // `import {Color, Length} from "velar/look"` is how a module names the types
  // the extension publishes. Refusing it would refuse the spelling the tour and
  // the example application both use, so the probe runs the real project driver
  // that resolves the standard module.
  const directory = await webProject("velar-d72-186-import-", {
    "main.vel": `
import {Color, Length, rgb} from "velar/look"

export const brand: Color = rgb(20, 40, 80)
export const gutter: Length = 12px

export component App:
    return <p look:color={brand} look:padding={gutter}>x</p>

mount(<App />, "#app")
`.trimStart(),
  });
  const checked = await run(["check", directory]);
  assert.equal(checked.code, 0, checked.output);

  // An alias still loses the name, and is still refused where it is written.
  await writeFile(join(directory, "src", "main.vel"), `
import {rgb as Color} from "velar/look"

export component App:
    return <p>{str(Color(1, 2, 3))}</p>

mount(<App />, "#app")
`.trimStart(), "utf8");
  const refused = await run(["check", directory]);
  assert.equal(refused.code, 1, refused.output);
  assert.match(refused.output, /VEL5065: 'Color' is a Web type name, so it cannot also name an import alias/u);
});

// ---------------------------------------------------------------------------
// D73 rule 187 — every kind that decides a string keyword has a closed set.
// ---------------------------------------------------------------------------

test("[D73-187] every property that decides a string keyword publishes its own set", () => {
  const missing = [...LOOK_PROPERTY_VALUE_KINDS]
    .filter(([property, kind]) => LOOK_KEYWORD_DECIDED_KINDS.has(kind) && !LOOK_PROPERTY_KEYWORDS.has(property))
    .map(([property]) => property);
  assert.deepEqual(missing, []);
  // Vacuity floors on both halves: the widened kind set, and the count of
  // properties it now reaches. D65 rule 168 covered 77; this covers those plus
  // the nineteen the shared fallback used to decide, plus border and shadow.
  assert.ok(LOOK_KEYWORD_DECIDED_KINDS.size >= 10, String(LOOK_KEYWORD_DECIDED_KINDS.size));
  const decided = [...LOOK_PROPERTY_VALUE_KINDS].filter(([, kind]) => LOOK_KEYWORD_DECIDED_KINDS.has(kind));
  assert.ok(decided.length >= 104, String(decided.length));
});

test("[D73-187] no refusal promises a table that does not exist", () => {
  // The sentence this ruling was opened for. `use one of the closed X keywords`
  // told the author to go and find a table that had never been written; it is
  // gone from every branch, and each refusal now writes the property's own
  // values out or names the shape of the set that holds them.
  const probes: readonly (readonly [property: string, wrong: string, expected: RegExp])[] = [
    ["fontWeight", "nonsense", /write a number, or one of normal, bold, bolder, lighter/u],
    ["lineHeight", "dotted", /write a number or a length such as 1\.5 or 24px, or one of normal/u],
    ["rotate", "nonsense", /write an angle such as 45deg or 0\.25turn, or one of none/u],
    ["transitionDuration", "nonsense", /write a duration such as 200ms or 0\.3s, or one of inherit/u],
    ["opacity", "nonsense", /write a number, or one of inherit/u],
    ["zIndex", "nonsense", /write a number, or one of auto, inherit/u],
    ["gridAutoRows", "disc", /use the tracks\(\.\.\.\) builder, or one of auto, min-content, max-content/u],
    ["transition", "square", /use the transition\(property, duration, easing, delay\) builder, or one of none/u],
    ["border", "circle", /use the border\(width, color, style\) builder, or one of none/u],
    ["boxShadow", "circle", /use the shadow\(x, y, blur, color\) builder, or one of none/u],
    ["flex", "proximity", /write a number, or one of none, auto, content, min-content, max-content, fit-content/u],
    ["scale", "decimal", /write a number, or one of none/u],
  ];
  for (const [property, wrong, expected] of probes) {
    const reported = messages(`const heavy = look:\n    ${property} = "${wrong}"\n\nexport component App:\n    return <p look={heavy}>x</p>\n`);
    assert.equal(reported.length, 1, `${property}: ${JSON.stringify(reported)}`);
    assert.match(reported[0]!, expected, property);
    assert.doesNotMatch(reported[0]!, /one of the closed \w+ keywords/u, property);
  }
});

test("[D73-187] the values the shared list used to admit are refused, and the real ones are not", () => {
  // Side B of the D65 family, still open in these kinds until now:
  // `fontWeight = "circle"` compiled, emitted `font-weight: circle`, and the
  // browser dropped it.
  const admitted: readonly (readonly [property: string, wrong: string, right: string])[] = [
    ["fontWeight", "circle", "bolder"],
    ["lineHeight", "dotted", "normal"],
    ["gridAutoRows", "disc", "min-content"],
    ["transition", "square", "none"],
    ["flex", "proximity", "auto"],
    ["scale", "decimal", "none"],
    ["aspectRatio", "butt", "auto"],
  ];
  for (const [property, wrong, right] of admitted) {
    const heavy = (value: string) => `const heavy = look:\n    ${property} = "${value}"\n\nexport component App:\n    return <p look={heavy}>x</p>\n`;
    assert.equal(messages(heavy(wrong)).length, 1, `${property} = ${wrong}`);
    assert.deepEqual(messages(heavy(right)), [], `${property} = ${right}`);
  }
});

test("[D73-187] a published keyword is reachable, which is what makes it a surface", () => {
  // The three kinds whose type used to refuse every string would have published
  // sets nobody could write: `zIndex = "auto"` is the CSS initial value, and
  // the five CSS-wide keywords are legal on every property. A set that the type
  // forbids is the same defect in the other direction (D50 rule 92).
  for (const [property, value] of [["zIndex", "auto"], ["rotate", "none"], ["opacity", "inherit"], ["transitionDelay", "unset"]] as const) {
    assert.deepEqual(
      messages(`const heavy = look:\n    ${property} = "${value}"\n\nexport component App:\n    return <p look={heavy}>x</p>\n`),
      [],
      `${property} = ${value}`,
    );
  }
});

test("[D73-187] the load-time invariant is what holds the table, not a test", async () => {
  const directory = await webProject("velar-d73-187-load-", { "main.vel": "export component App:\n    return <p>x</p>\n" });
  assert.ok(directory);
  const table = join(root, "packages", "web", "src", "look.ts");
  const { readFile, writeFile: write } = await import("node:fs/promises");
  const source = await readFile(table, "utf8");
  const removed = source.replace(/^ {2}\["fontWeight", keywords\(.*\n/mu, "");
  assert.notEqual(removed, source);
  const broken = join(await makeTemporaryDirectory("velar-d73-187-broken-"), "broken.mts");
  await write(broken, removed, "utf8");
  await assert.rejects(
    () => import(broken),
    /Look property 'fontWeight' accepts string keywords and has no closed keyword set/u,
  );
});
